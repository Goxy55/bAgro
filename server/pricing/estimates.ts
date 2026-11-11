import type { Conn } from "../db.js";
import { D } from "../domain.js";
import type { PricingRow, PricingTable } from "../../shared/pricing.js";
import type {
  PriceEstimateCandidate,
  PriceEstimateGroup,
  PriceEstimateRow,
  PriceEstimates,
} from "../../shared/price-estimates.js";
import { materialName, costKey } from "./identity.js";
import { suggestPrices, packagingBasis, compatible } from "./suggestions.js";

const STOP = new Set([
  "kg",
  "l",
  "lit",
  "vreca",
  "pakovanje",
  "za",
  "i",
  "ili",
  "put",
  "herbicid",
  "fungicid",
  "insekticid",
]);
export function tokens(name: string): string[] {
  return materialName(name)
    .split(" ")
    .filter((t) => t.length >= 2 && !STOP.has(t));
}
type Nutrients =
  | { kind: "npk"; v: [number, number, number] }
  | { kind: "single"; el: string; v: number };
/** NPK odnos (npr. 15:15:15) ili jedan hranljivi element (27 % N). */
export function parseNutrients(name: string): Nutrients | null {
  const s = materialName(name).replace(/\s+/g, "");
  const npk = s.match(/(\d{1,2})[:\-/](\d{1,2})[:\-/](\d{1,2})/);
  if (npk) return { kind: "npk", v: [+npk[1], +npk[2], +npk[3]] };
  const single = s.match(/(\d{1,2})%?(n|p|k)\b/);
  return single ? { kind: "single", el: single[2], v: +single[1] } : null;
}
export function nutrientSignature(name: string): string | null {
  const n = parseNutrients(name);
  return !n ? null : n.kind === "npk" ? n.v.join("-") : `${n.v}${n.el}`;
}
/**
 * Sličnost naziva i sastava, 0–1. Reči (bez brojeva) čine osnovu; kod đubriva
 * se meri blizina odnosa hraniva, a kod ostalih različita brojčana oznaka
 * (npr. koncentracija) umanjuje ocenu.
 */
export function similarity(a: string, b: string) {
  const ta = tokens(a),
    tb = tokens(b);
  const words = (t: string[]) => new Set(t.filter((x) => !/\d/.test(x)));
  const wa = words(ta),
    wb = words(tb);
  if (!wa.size || !wb.size) return { score: 0, reason: "" };
  const shared = [...wa].filter((t) => wb.has(t));
  const wordScore = shared.length / new Set([...wa, ...wb]).size;
  if (!shared.length) return { score: 0, reason: "" };
  const na = parseNutrients(a),
    nb = parseNutrients(b);
  const parts = [`zajedničke reči: ${shared.join(", ")}`];
  let score = wordScore;
  if (na && nb) {
    let closeness = 0;
    if (na.kind === "npk" && nb.kind === "npk") {
      const diff = na.v.reduce((s, x, i) => s + Math.abs(x - nb.v[i]), 0);
      closeness = Math.max(
        0,
        1 -
          diff /
            Math.max(
              na.v.reduce((s, x) => s + x, 0),
              nb.v.reduce((s, x) => s + x, 0),
            ),
      );
      parts.push(
        diff === 0
          ? `isti odnos hraniva (${na.v.join(":")})`
          : `sličan odnos hraniva (${na.v.join(":")} ≈ ${nb.v.join(":")})`,
      );
    } else if (
      na.kind === "single" &&
      nb.kind === "single" &&
      na.el === nb.el
    ) {
      closeness = Math.max(0, 1 - Math.abs(na.v - nb.v) / Math.max(na.v, nb.v));
      parts.push(`isto hranivo (${na.el.toUpperCase()}), ${na.v}% ≈ ${nb.v}%`);
    }
    score = 0.5 * wordScore + 0.5 * closeness;
  } else {
    const numsA = ta.filter((x) => /\d/.test(x)).join(" "),
      numsB = tb.filter((x) => /\d/.test(x)).join(" ");
    if (numsA && numsB && numsA !== numsB) {
      score *= 0.75;
      parts.push("različita brojčana oznaka (npr. koncentracija)");
    }
  }
  return { score: Math.round(score * 100) / 100, reason: parts.join("; ") };
}
function median(values: ReturnType<typeof D>[]) {
  const s = [...values].sort((x, y) => x.cmp(y)),
    m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : s[m - 1].add(s[m]).div(2);
}
const eligible = (row: PricingRow) =>
  row.pricingGroup !== "diesel" &&
  !/goriva|usluga/.test(row.unit) &&
  !row.occurrences.some((o) => o.sheet.startsWith("Stočarstvo")) &&
  !/^(?:seme|rasad|sadnice|sadni materijal|semenski materijal)(?:\s|$)/.test(
    materialName(row.occurrences[0]?.name || row.name),
  ) &&
  !row.occurrences.every((o) => !o.included || o.quantity === "0");

export const MIN_SCORE = 0.4;

export async function estimatePrices(
  conn: Conn,
  table: PricingTable,
  options: { asOf: string; place?: string },
): Promise<PriceEstimates> {
  // Samo stavke bez ikakvog predloga i bez sačuvane cene; ostalo rešava postojeći izbor.
  const base = await suggestPrices(conn, table, options);
  const missing = new Set(
    base.rows.filter((r) => r.status === "missing").map((r) => r.key),
  );
  const observations = (
    await conn.query(
      `SELECT p.id,p.product,p.manufacturer,p.packaging,p.place,p.price_rsd::text AS price_rsd,d.category,d.source_url,d.period_start::text
       FROM stips_input_prices p JOIN stips_input_documents d ON d.id=p.document_id
       WHERE p.status='available' AND p.price_rsd>0 AND d.period_start<=$1
         AND d.category IN ('pesticidi','djubriva') AND p.place=$2
       ORDER BY d.period_start DESC,d.received_at DESC,p.id`,
      [options.asOf, base.place],
    )
  ).rows;
  const latest = new Map<string, (typeof observations)[number]>();
  for (const o of observations) {
    const key = JSON.stringify([o.product, o.manufacturer, o.packaging]);
    if (!latest.has(key)) latest.set(key, o);
  }
  const sources = [...latest.values()];
  const rows: PriceEstimateRow[] = [];
  for (const row of table.rows) {
    if (!missing.has(row.key) || !eligible(row)) continue;
    const name = row.occurrences[0]?.name || row.name;
    const candidates: PriceEstimateCandidate[] = [];
    const compatibleAll: {
      o: (typeof sources)[number];
      amount: ReturnType<typeof D>;
    }[] = [];
    for (const o of sources) {
      const basis = packagingBasis(o.packaging);
      const unitMatch = basis ? compatible(row.unit, basis.unit) : null;
      if (!basis || !unitMatch) continue;
      const divisor = D(basis.quantity).mul(unitMatch.factor);
      const amount = D(o.price_rsd).div(divisor);
      compatibleAll.push({ o, amount });
      const { score, reason } = similarity(name, o.product);
      if (score < MIN_SCORE) continue;
      candidates.push({
        observationId: o.id,
        product: o.product,
        manufacturer: o.manufacturer,
        packaging: o.packaging,
        place: o.place,
        category: o.category,
        unit: unitMatch.unit,
        unitsPerPrice: divisor.toString(),
        amount: amount.toDecimalPlaces(12).toString(),
        originalPrice: o.price_rsd,
        periodStart: o.period_start,
        sourceUrl: o.source_url,
        score,
        reason,
      });
    }
    candidates.sort(
      (a, b) =>
        b.score - a.score ||
        b.periodStart.localeCompare(a.periodStart) ||
        a.product.localeCompare(b.product),
    );
    const top = candidates.slice(0, 5);
    let group: PriceEstimateGroup | null = null;
    if (top.length) {
      const same = compatibleAll.filter(
        (c) => c.o.category === top[0].category,
      );
      if (same.length >= 3) {
        const prices = same.map((c) => c.amount);
        group = {
          category: top[0].category,
          unit: top[0].unit,
          count: same.length,
          min: prices
            .reduce((a, b) => (b.lt(a) ? b : a))
            .toDecimalPlaces(2)
            .toString(),
          median: median(prices).toDecimalPlaces(2).toString(),
          max: prices
            .reduce((a, b) => (b.gt(a) ? b : a))
            .toDecimalPlaces(2)
            .toString(),
        };
      }
    }
    if (top.length || group)
      rows.push({
        key: row.key,
        groupKey: costKey(row),
        name: row.name,
        unit: row.unit,
        candidates: top,
        group,
      });
  }
  return {
    revision: table.revision,
    asOf: options.asOf,
    place: base.place,
    rows,
  };
}

/** Ponovo izračunava cenu iz izvornog opažanja; klijentu se ne veruje. */
export async function estimateAmount(
  conn: Conn,
  observationId: string,
  rowUnit: string,
) {
  const o = (
    await conn.query(
      `SELECT p.id,p.product,p.packaging,p.price_rsd::text AS price_rsd,d.category,d.period_start::text
       FROM stips_input_prices p JOIN stips_input_documents d ON d.id=p.document_id
       WHERE p.id=$1 AND p.status='available' AND p.price_rsd>0`,
      [observationId],
    )
  ).rows[0];
  if (!o || !["pesticidi", "djubriva"].includes(o.category)) return null;
  const basis = packagingBasis(o.packaging);
  const unitMatch = basis ? compatible(rowUnit, basis.unit) : null;
  if (!basis || !unitMatch) return null;
  return {
    amount: D(o.price_rsd)
      .div(D(basis.quantity).mul(unitMatch.factor))
      .toDecimalPlaces(12)
      .toString(),
    product: o.product as string,
    packaging: o.packaging as string,
    periodStart: o.period_start as string,
  };
}
