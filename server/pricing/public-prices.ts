import { z } from "zod";
import type { Conn } from "../db.js";
import { D, convertQuantity } from "../domain.js";
import { id, date } from "../validation.js";
import { todayInSerbia } from "../../shared/dates.js";
import type { PricingRow, PricingTable } from "../../shared/pricing.js";
import { materialName } from "./identity.js";
import {
  productBase,
  sameComposition,
  type Composition,
} from "./public-sources.js";

export function commercialName(name: string) {
  return productBase(
    name
      .replace(/\([^)]*\)/g, "")
      .replace(/\b\d+(?:[.,]\d+)?\s*(?:EC|WG|WP|SL|SC|OD|SG|FS|CS)\b/gi, "")
      .replace(/\b(?:EC|WG|WP|SL|SC|OD|SG|FS|CS)\b/gi, ""),
  )
    .replace(/\b1 put\b/g, "")
    .trim();
}
export function exactPublicMatch(row: PricingRow, product: any) {
  const target = commercialName(row.occurrences[0]?.name || row.name),
    candidate = commercialName(product.product);
  if (row.pricingGroup === "diesel") return false;
  if (!row.cultureSpecific && product.metadata?.product?.crop) return false;
  if (row.cultureSpecific) {
    const crop = materialName(row.name.split(" · ").slice(1).join(" · "));
    return (
      /^(seme|semenski materijal)(\s|$)/.test(target) &&
      materialName(product.metadata?.product?.crop || "") === crop
    );
  }
  const grade = (s: string) =>
    s
      .match(/(?:npk|n p k)\s*(\d+)\s*[: ]\s*(\d+)\s*[: ]\s*(\d+)/)
      ?.slice(1)
      .join(":");
  if (grade(target)) return grade(target) === grade(candidate);
  if (/\bkan\b/.test(target))
    return (
      /\bkan\b/.test(candidate) &&
      /27\s*%/.test(candidate + " " + product.metadata?.product?.description)
    );
  if (/\burea\b/.test(target))
    return (
      /\burea\b/.test(candidate) &&
      /46\s*%/.test(candidate + " " + product.metadata?.product?.description)
    );
  return !!target && target === candidate;
}
export async function publicPricePool(conn: Conn) {
  const prices = (
    await conn.query(`WITH latest AS (
    SELECT DISTINCT ON(source_url) * FROM public_price_documents
    ORDER BY source_url,COALESCE((metadata->>'lastCheckedAt')::timestamptz,retrieved_at) DESC,retrieved_at DESC
  ) SELECT p.*,p.price_rsd::text,p.package_quantity::text,d.source_id,d.source_url,d.sha256,d.metadata,
    d.retrieved_at,COALESCE((d.metadata->>'lastCheckedAt')::timestamptz,d.retrieved_at)::text AS checked_at
    FROM latest d JOIN public_input_prices p ON p.document_id=d.id WHERE p.available=true`)
  ).rows;
  const specs = (
    await conn.query(
      "SELECT DISTINCT ON(source_url) source_url,metadata FROM public_price_documents WHERE metadata->'product'->'composition' IS NOT NULL ORDER BY source_url,retrieved_at DESC",
    )
  ).rows.map((d) => ({
    product: d.metadata.product.name,
    composition: d.metadata.product.composition,
    metadata: d.metadata,
    source_url: d.source_url,
    specOnly: true,
  }));
  return [...prices, ...specs];
}
export function publicCandidates(row: PricingRow, pool: any[]) {
  const originalSpecs = pool.filter(
    (p) => exactPublicMatch(row, p) && p.composition,
  );
  return pool
    .flatMap((p) => {
      if (p.specOnly) return [];
      const exact = exactPublicMatch(row, p);
      const proxy =
        !exact &&
        originalSpecs.some((spec) =>
          sameComposition(spec.composition, p.composition),
        );
      if (!exact && !proxy) return [];
      const originalUnit = row.unit.toLowerCase();
      const isSeedUnit =
        row.cultureSpecific &&
        /seme\s*\(sj\)/i.test(row.occurrences[0]?.name || row.name);
      const unit = isSeedUnit
        ? "sj"
        : /kg\/l.*potvrditi/.test(originalUnit)
          ? p.unit
          : originalUnit;
      if (unit === "seed") return [];
      let factor: string;
      try {
        factor =
          unit === "sj" && p.unit === "seed" && row.seedUnitSize
            ? D(row.seedUnitSize).toString()
            : convertQuantity("1", unit, p.unit).toString();
      } catch {
        return [];
      }
      return [
        {
          ...p,
          match: proxy ? "proxy" : "exact",
          targetUnit: unit,
          amount: D(p.price_rsd)
            .div(p.package_quantity)
            .mul(factor)
            .toDecimalPlaces(12)
            .toString(),
          baseline: proxy
            ? originalSpecs.find((spec) =>
                sameComposition(spec.composition, p.composition),
              )
            : null,
        },
      ];
    })
    .sort(
      (a, b) =>
        Number(a.match === "proxy") - Number(b.match === "proxy") ||
        b.checked_at.localeCompare(a.checked_at) ||
        a.source_url.localeCompare(b.source_url),
    );
}
export const publicReferenceSchema = z.object({
  observationId: id,
  date,
  confirmedProduct: z.literal(true),
  confirmedBasis: z.literal(true),
  confirmedProxy: z.boolean().default(false),
  note: z.string().trim().min(5).max(1000),
});
export async function resolvePublicPrice(
  conn: Conn,
  ref: z.infer<typeof publicReferenceSchema>,
  row: PricingRow,
) {
  const pool = await publicPricePool(conn),
    candidate = publicCandidates(row, pool).find(
      (p) => p.id === ref.observationId,
    );
  if (!candidate)
    throw Error(
      "Javna cena nema proverljivo podudaranje proizvoda, sastava ili jedinice.",
    );
  if (candidate.match === "proxy" && !ref.confirmedProxy)
    throw Error("Zamenska cenovna referenca zahteva potvrdu.");
  const sourceDay = todayInSerbia(new Date(candidate.retrieved_at));
  if (ref.date !== sourceDay)
    throw Error(
      "Datum javne reference mora odgovarati datumu preuzimanja izvora.",
    );
  return {
    amount: candidate.amount,
    date: ref.date,
    snapshot: {
      kind: "public_input",
      observationId: candidate.id,
      documentId: candidate.document_id,
      sha256: candidate.sha256,
      sourceUrl: candidate.source_url,
      product: candidate.product,
      originalProduct: row.name,
      proxy: candidate.match === "proxy",
      composition: candidate.composition,
      baselineComposition: candidate.baseline?.composition || null,
      baselineSourceUrl: candidate.baseline?.source_url || null,
      place: "Javni cenovnik prodavca — Srbija",
      periodStart: sourceDay,
      periodEnd: sourceDay,
      retrievedAt: candidate.retrieved_at,
      checkedAt: candidate.checked_at,
      publicationDate: null,
      priceType: "Javna prodajna cena — referenca inputa",
      priceBasis: candidate.price_basis,
      unit: candidate.targetUnit,
      packageQuantity: candidate.package_quantity,
      sourceUnit: candidate.unit,
      originalPriceRsd: candidate.price_rsd,
      sheet: candidate.source_id,
      cell: candidate.product,
      note: ref.note,
      confirmedProduct: true,
      confirmedBasis: true,
      confirmedProxy: ref.confirmedProxy,
    },
  };
}
