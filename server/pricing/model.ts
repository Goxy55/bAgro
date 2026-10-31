import { createHash } from "node:crypto";
import { costKey } from "./identity.js";
import { D, validateModel } from "../domain.js";
import type { PricingTable, PricingRow } from "../../shared/pricing.js";

export interface PricingVersion {
  id: string;
  template_id: string;
  template_name: string;
  status: string;
  valid_from: string;
  valid_to: string;
  reason: string;
  model: any;
  price_book_id?: string | null;
}
function canonical(value: any): any {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  return value;
}
export const hash = (value: unknown) =>
  createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
const datePart = (value: string | Date) =>
  value instanceof Date
    ? value.toISOString().slice(0, 10)
    : String(value).slice(0, 10);
const normalize = (value: string) =>
  String(value).normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();
export const normalizedPriceUnit = (unit: string) =>
  normalize(unit).replace(/^m²$/, "m2");
export const priceUnits = [
  "kg",
  "t",
  "l",
  "kom",
  "biljka",
  "grlo",
  "vreća",
  "ha",
  "m2",
  "sj",
  "usluga",
  "sat",
  "kwh",
];
export function versionRevision(v: PricingVersion) {
  return hash([
    v.id,
    v.status,
    datePart(v.valid_from),
    datePart(v.valid_to),
    v.reason,
    v.model,
  ]);
}
export function priceIdentity(v: PricingVersion, item: any) {
  if (item.pricingGroup === "diesel" && normalizedPriceUnit(item.unit) === "l")
    return {
      key: hash(["shared-diesel-price", "l"]),
      specific: false,
      name: "Mašinske operacije — gorivo",
    };
  const name = normalize(item.name);
  // These generic labels do not identify the same purchasable material/service
  // across cultures or animal categories. Keep their prices template-specific.
  const specific =
    /^(?:seme|rasad|sadnice|sadni materijal|semenski materijal|veterinarski troškovi|veterinarske usluge)(?:\s|\(|$)/u.test(
      name,
    );
  return {
    key: hash([
      name,
      normalizedPriceUnit(item.unit),
      specific ? v.template_id : null,
    ]),
    specific,
    name: String(item.name).trim() + (specific ? " · " + v.template_name : ""),
  };
}
function effectiveQuantity(model: any, item: any): string | null {
  if (item.group) {
    const base = model.groupBases?.[item.group];
    if (base == null || item.share == null) return null;
    return D(base).mul(item.share).div(100).toString();
  }
  return item.quantity == null || item.quantity === ""
    ? null
    : D(item.quantity).toString();
}
export function buildPricingTable(versions: PricingVersion[]): PricingTable {
  if (!versions.length)
    throw Error("Izaberite najmanje jedan nacrt normativa.");
  if (versions.some((v) => v.status !== "draft"))
    throw Error(
      "Zajednički cenovnik menja samo nacrte. Za aktivnu ili arhivsku verziju prvo napravite novi nacrt.",
    );
  if (new Set(versions.map((v) => v.template_id)).size !== versions.length)
    throw Error(
      "Izaberite samo jednu verziju za svaku kulturu ili kategoriju.",
    );
  const period = (v: PricingVersion) => [
    datePart(v.valid_from),
    datePart(v.valid_to),
  ];
  if (new Set(versions.map((v) => JSON.stringify(period(v)))).size !== 1)
    throw Error(
      "Svi nacrti zajedničkog cenovnika moraju imati isti period važenja.",
    );
  const rows = new Map<string, PricingRow>();
  const columns: PricingTable["versions"] = [];
  for (const v of versions) {
    let known = D(0);
    for (const item of v.model.items) {
      const identity = priceIdentity(v, item);
      let row = rows.get(identity.key);
      if (!row) {
        row = {
          key: identity.key,
          name: identity.name,
          unit: item.unit,
          cultureSpecific: identity.specific,
          ...(item.pricingGroup === "diesel" &&
          normalizedPriceUnit(item.unit) === "l"
            ? { pricingGroup: "diesel" as const }
            : {}),
          priceEur: null,
          mixed: false,
          occurrences: [],
        };
        rows.set(identity.key, row);
      }
      const quantity = effectiveQuantity(v.model, item);
      const price =
        item.price == null || item.price === ""
          ? null
          : D(item.price).toString();
      const cost =
        quantity !== null && price !== null
          ? D(quantity).mul(price).toString()
          : null;
      if (cost !== null && item.included !== false) known = known.add(cost);
      const input = item.priceInput;
      // A later manual item edit can invalidate the original shared-price metadata.
      const matchingInput =
        input &&
        input.eur === price &&
        normalizedPriceUnit(input.unit) === normalizedPriceUnit(item.unit);
      row.occurrences.push({
        versionId: v.id,
        templateId: v.template_id,
        itemId: item.id,
        name: item.name,
        quantity,
        priceEur: price,
        costEur: cost,
        included: item.included !== false,
        unitConfirmed: !!item.unitConfirmed,
        zeroReason: item.zeroReason || null,
        sheet: v.model.sheet,
        quantityCell: item.quantityCell || null,
        priceCell: item.priceCell || null,
        alternativeGroup: item.alternativeGroup || null,
        lastInput: matchingInput
          ? {
              amount: input.amount,
              currency: input.currency,
              date: input.date,
              pendingRate: input.pendingRate,
              reference: input.reference,
            }
          : null,
      });
    }
    columns.push({
      id: v.id,
      templateId: v.template_id,
      name: v.model.intensity
        ? `${v.template_name} · ${v.model.intensity}`
        : v.template_name,
      culture: v.template_name,
      basis: v.model.basis,
      reference: String(v.model.reference),
      knownCostEur: known.toString(),
      errors: validateModel(v.model),
    });
  }
  for (const row of rows.values()) {
    row.groupKey = costKey(row);
    const prices = [...new Set(row.occurrences.map((o) => o.priceEur))];
    row.mixed = prices.length > 1;
    row.priceEur = prices.length === 1 ? prices[0] : null;
  }
  return {
    revision: hash(
      [...versions]
        .sort((a, b) => a.id.localeCompare(b.id))
        .map(versionRevision),
    ),
    validFrom: period(versions[0])[0],
    validTo: period(versions[0])[1],
    versions: columns,
    rows: [...rows.values()].sort((a, b) =>
      a.name.localeCompare(b.name, "sr-Latn"),
    ),
  };
}
