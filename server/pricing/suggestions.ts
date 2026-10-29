import type { Conn } from "../db.js";
import { D } from "../domain.js";
import type { PricingRow, PricingTable } from "../../shared/pricing.js";
import type {
  PriceSuggestion,
  PriceSuggestions,
} from "../../shared/price-suggestions.js";
import { hash, normalizedPriceUnit } from "./model.js";

// Remove application counts and descriptive roles, never product grades or concentrations.
export function materialName(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/đ/gi, "dj")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\((?:herbicidi?|fungicidi?|inse[ck]ticidi?)\)/g, " ")
    .replace(/\s*-\s*\d+\.?\s*put(?:a)?\.?\s*$/g, "")
    .replace(/(?:\s+ili|\s*\+)\s*$/g, "")
    .replace(/\b(?:djubrivo|djubriva)\b/g, "")
    .replace(/[^a-z0-9:%]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}
export function costKey(row: PricingRow) {
  return hash([
    materialName(row.occurrences[0]?.name || row.name),
    row.occurrences.some((o) => o.sheet.startsWith("Stočarstvo"))
      ? "livestock-input"
      : "crop-input",
    row.cultureSpecific ? row.occurrences[0]?.templateId : null,
  ]);
}
export function packagingBasis(
  packaging: string,
): { unit: string; quantity: string } | null {
  const s = packaging.toLowerCase().trim().replace(/,/g, ".");
  const match = s.match(/^(\d+(?:\.\d+)?)?\s*(kg|gr|g|ml|lit|l)\.?$/);
  if (!match) return null;
  const n = D(match[1] || 1);
  if (n.lte(0)) return null;
  const u = match[2];
  return {
    unit: ["kg", "gr", "g"].includes(u) ? "kg" : "l",
    quantity: (["gr", "g", "ml"].includes(u) ? n.div(1000) : n).toString(),
  };
}
const productBase = (name: string) =>
  materialName(name.replace(/\([^\d)]*\)/g, " "));
export function matchMaterial(
  cost: string,
  product: string,
  category: string,
  livestock = false,
): "exact" | "review" | null {
  // A grain name does not make seed a feed price; these input lists do not
  // establish feed-grade material or veterinary service identities.
  if (livestock || category === "seme") return null;
  const a = materialName(cost),
    b = materialName(product),
    base = productBase(product);
  if (
    !a ||
    /^(?:seme|rasad|sadnice|sadni materijal|semenski materijal)(?:\s|$)/.test(a)
  )
    return null;
  if (a === b || a === base) return "exact";
  if (category === "djubriva") {
    // Bare KAN/UREA in the source does not itself establish the nutrient percentage.
    if (
      (/^kan\s+27\s*%?\s*n$/.test(a) && b === "kan") ||
      (/^urea\s+46\s*%?\s*n$/.test(a) && b === "urea")
    )
      return "review";
  }
  // Brand-only historical names can offer a candidate, but never silently approve a formulation.
  if (a.length >= 4 && base.startsWith(a + " ") && !/\d/.test(a))
    return "review";
  return null;
}
function compatible(
  rowUnit: string,
  sourceUnit: string,
): { unit: string; factor: string } | null {
  const unit = normalizedPriceUnit(rowUnit);
  if (unit === "kg/l — potvrditi" || unit === "kg/l - potvrditi")
    return { unit: sourceUnit, factor: "1" };
  if (unit === sourceUnit) return { unit, factor: "1" };
  if (unit === "t" && sourceUnit === "kg") return { unit, factor: "0.001" };
  return null;
}
export async function suggestPrices(
  conn: Conn,
  table: PricingTable,
  options: { asOf: string; place?: string; includeExisting?: boolean },
): Promise<PriceSuggestions> {
  const observations = (
    await conn.query(
      `SELECT p.id,p.product,p.manufacturer,p.packaging,p.place,p.sheet,p.cell,p.price_rsd::text AS price_rsd,d.category,d.source_url,d.period_start::text,d.period_end::text,d.received_at
     FROM stips_input_prices p JOIN stips_input_documents d ON d.id=p.document_id
     WHERE p.status='available' AND p.price_rsd>0 AND d.period_start<=$1
     ORDER BY d.period_start DESC,d.received_at DESC,p.id`,
      [options.asOf],
    )
  ).rows;
  const counts = new Map<string, number>();
  for (const o of observations)
    counts.set(o.place, (counts.get(o.place) || 0) + 1);
  const places = [...counts.keys()].sort((a, b) =>
    a.localeCompare(b, "sr-Latn"),
  );
  const place =
    options.place ||
    [...counts].sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "sr-Latn"),
    )[0]?.[0] ||
    "";
  if (options.place && !places.includes(options.place))
    throw Error(
      "Izabrano mesto nema proverene STIPS cene do navedenog datuma.",
    );
  const latest = new Map<string, (typeof observations)[number]>();
  for (const o of observations.filter((o) => o.place === place)) {
    const key = JSON.stringify([
      o.product,
      o.manufacturer,
      o.packaging,
      o.place,
    ]);
    if (!latest.has(key)) latest.set(key, o);
  }
  const links = (await conn.query("SELECT * FROM input_price_links")).rows;
  const sourceRows = [...latest.values()],
    rates = new Map<string, boolean>();
  for (const o of sourceRows) {
    const date = options.asOf < o.period_end ? options.asOf : o.period_end;
    if (!rates.has(date))
      rates.set(
        date,
        !!(
          await conn.query(
            "SELECT id FROM exchange_rates WHERE valid_from<=$1 AND valid_to>=$1 LIMIT 1",
            [date],
          )
        ).rows.length,
      );
  }
  const rows = table.rows.map((row) => {
    const result: {
      key: string;
      groupKey: string;
      name: string;
      unit: string;
      status: "matched" | "review" | "missing" | "filled" | "excluded";
      message: string;
      selectedId: string | null;
      candidates: PriceSuggestion[];
    } = {
      key: row.key,
      groupKey: costKey(row),
      name: row.name,
      unit: row.unit,
      status: "missing",
      message: "Nema potvrđenog podudaranja u STIPS cenovnicima inputa.",
      selectedId: null,
      candidates: [],
    };
    if (row.occurrences.every((o) => !o.included || o.quantity === "0"))
      return {
        ...result,
        status: "excluded" as const,
        message: "Stavka je isključena ili nema normirane potrošnje.",
      };
    if (
      !options.includeExisting &&
      row.occurrences.some((o) => o.priceEur !== null || o.lastInput)
    )
      return {
        ...result,
        status: "filled" as const,
        message:
          "Postojeća cena je sačuvana; uključite osvežavanje ako želite zamenu.",
      };
    if (/goriva|usluga/.test(row.unit))
      return {
        ...result,
        message: "Ovaj STIPS skup ne pokriva cenu goriva ili ove usluge.",
      };
    const approved = links.filter((l) => l.cost_key === costKey(row));
    for (const o of sourceRows) {
      const link = approved.find(
        (l) =>
          l.product === o.product &&
          l.manufacturer === o.manufacturer &&
          l.packaging === o.packaging &&
          (normalizedPriceUnit(row.unit) === l.unit || /kg\/l/.test(row.unit)),
      );
      const match = link
        ? "approved"
        : matchMaterial(
            row.occurrences[0]?.name || row.name,
            o.product,
            o.category,
            row.occurrences.some((o) => o.sheet.startsWith("Stočarstvo")),
          );
      if (!match) continue;
      const basis = packagingBasis(o.packaging),
        unitMatch = basis ? compatible(row.unit, basis.unit) : null;
      if (!link && !unitMatch) continue;
      const unit = link?.unit || unitMatch!.unit,
        divisor = link
          ? D(link.units_per_price).toString()
          : D(basis!.quantity).mul(unitMatch!.factor).toString(),
        date = options.asOf < o.period_end ? options.asOf : o.period_end,
        age =
          (Number(options.asOf.slice(0, 4)) -
            Number(o.period_start.slice(0, 4))) *
            12 +
          Number(options.asOf.slice(5, 7)) -
          Number(o.period_start.slice(5, 7));
      result.candidates.push({
        observationId: o.id,
        product: o.product,
        manufacturer: o.manufacturer,
        packaging: o.packaging,
        place: o.place,
        unit,
        unitsPerPrice: divisor,
        amount: D(o.price_rsd).div(divisor).toDecimalPlaces(12).toString(),
        originalPrice: o.price_rsd,
        periodStart: o.period_start,
        periodEnd: o.period_end,
        date,
        sourceUrl: o.source_url,
        sheet: o.sheet,
        cell: o.cell,
        historical: o.period_end < table.validFrom || age > 12,
        pendingRate: !rates.get(date),
        match,
      });
    }
    // Keep alternatives available for explicit replacement, while preferring
    // the approved identity/basis over name matches for the initial selection.
    const rank = { approved: 0, exact: 1, review: 2 };
    result.candidates.sort(
      (a, b) =>
        rank[a.match] - rank[b.match] ||
        b.periodStart.localeCompare(a.periodStart) ||
        a.product.localeCompare(b.product) ||
        a.manufacturer.localeCompare(b.manufacturer) ||
        a.packaging.localeCompare(b.packaging),
    );
    const preferred = result.candidates.filter((c) => c.match === "approved")
      .length
      ? result.candidates.filter((c) => c.match === "approved")
      : result.candidates.filter((c) => c.match === "exact").length
        ? result.candidates.filter((c) => c.match === "exact")
        : result.candidates;
    const unique = preferred.length === 1 ? preferred[0] : null;
    const missingLink =
      approved.length > 0 &&
      !result.candidates.some((c) => c.match === "approved");
    if (
      unique &&
      (unique.match === "approved" || unique.match === "exact") &&
      !missingLink
    )
      result.selectedId = unique.observationId;
    if (
      unique &&
      (unique.match === "approved" || unique.match === "exact") &&
      !unique.historical &&
      !missingLink
    ) {
      result.status = "matched";
      result.message =
        unique.match === "approved"
          ? "Zapamćena veza proizvoda i osnove cene."
          : "Prepoznat proizvod; proverite prikazanu osnovu pakovanja.";
    } else if (result.candidates.length) {
      result.status = "review";
      result.message = missingLink
        ? "Zapamćeni proizvod/pakovanje nema dostupnu cenu za izabrano mesto; proverite alternativu."
        : unique?.historical
          ? "Starija referenca zahteva potvrdu."
          : unique?.match === "review"
            ? "Proverite sastav ili formulaciju proizvoda."
            : "Izaberite proizvod/proizvođača i pakovanje jednom; veza će biti zapamćena.";
    }
    result.candidates = result.candidates.slice(0, 30);
    return result;
  });
  return { revision: table.revision, asOf: options.asOf, place, places, rows };
}
