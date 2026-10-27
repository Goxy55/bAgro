import { z } from "zod";
import { D } from "../domain.js";
export const STIPS_ORIGIN = "https://www.stips.minpolj.gov.rs";
export const USER_AGENT = "AgroPortal-STIPS/1.0";
export function stipsUrl(input: string, base = STIPS_ORIGIN): string {
  const u = new URL(input, base);
  if (
    u.protocol !== "https:" ||
    !["www.stips.minpolj.gov.rs", "stips.minpolj.gov.rs"].includes(
      u.hostname.toLowerCase(),
    ) ||
    u.username ||
    u.password ||
    (u.port && u.port !== "443")
  )
    throw Error(
      "Dozvoljene su isključivo javne HTTPS adrese zvaničnog STIPS sajta.",
    );
  u.hash = "";
  return u.href;
}
export const officialUrl = z
  .url()
  .max(2000)
  .transform((s) => stipsUrl(s));
const nullableDate = z.iso.date().nullable();
export const metadataSchema = z
  .object({
    title: z.string().trim().min(1).max(300),
    sourceUrl: officialUrl,
    publishedAt: nullableDate,
    periodStart: nullableDate,
    periodEnd: nullableDate,
    termsConfirmed: z.boolean(),
    termsNote: z.string().trim().max(2000),
  })
  .refine(
    (v) => !v.periodStart || !v.periodEnd || v.periodStart <= v.periodEnd,
    "Kraj perioda ne može biti pre početka.",
  );
const price = z
  .string()
  .regex(/^\d{1,14}(\.\d{1,6})?$/)
  .nullable();
export const priceDraftSchema = z.object({
  product: z.string().trim().max(200).default(""),
  place: z.string().trim().max(200).default(""),
  market: z.string().trim().max(200).default(""),
  priceType: z
    .enum(["otkupna", "veleprodajna", "maloprodajna", ""])
    .default(""),
  unit: z.enum(["kg", "t", "l", "kom", "grlo", ""]).default(""),
  currency: z.enum(["RSD", "EUR", ""]).default(""),
  price: price.default(null),
  priceMin: price.default(null),
  priceMax: price.default(null),
  periodStart: nullableDate.default(null),
  periodEnd: nullableDate.default(null),
  quality: z.string().trim().max(300).default(""),
  zeroReason: z.string().trim().max(300).default(""),
});
export type PriceDraft = z.infer<typeof priceDraftSchema>;
export type Metadata = z.infer<typeof metadataSchema>;
export type RawTable = { page: number; rows: string[][] };
export function publicationIssues(
  d: PriceDraft,
  doc: {
    published_at: any;
    period_start: any;
    period_end: any;
    terms_confirmed: boolean;
    terms_note: string;
  },
): string[] {
  const issues: string[] = [];
  if (!doc.terms_confirmed || !doc.terms_note.trim())
    issues.push(
      "Potvrdite proveru uslova korišćenja i navedite osnov preuzimanja.",
    );
  if (!doc.published_at) issues.push("Nedostaje datum objave biltena.");
  if (!d.product) issues.push("Nedostaje proizvod.");
  if (
    !d.place ||
    /^(srbija|serbia|rs|republika srbija|srbija ukupno|србија|република србија|србија укупно|рс)$/iu.test(
      d.place.replace(/\s+/g, " "),
    )
  )
    issues.push(
      "Navedite konkretno mesto; lokalna cena nije nacionalni prosek Srbije.",
    );
  if (!d.market) issues.push("Nedostaje konkretno tržište ili obuhvat otkupa.");
  if (!d.priceType) issues.push("Nedostaje vrsta cene.");
  if (!d.unit) issues.push("Nedostaje jedinica.");
  if (!d.currency) issues.push("Nedostaje valuta.");
  const start = d.periodStart || doc.period_start,
    end = d.periodEnd || doc.period_end;
  if (!start || !end) issues.push("Nedostaje period na koji se cena odnosi.");
  else if (String(start) > String(end)) issues.push("Neispravan period cene.");
  if (d.price === null && (d.priceMin === null || d.priceMax === null))
    issues.push("Unesite cenu ili oba kraja izvornog raspona.");
  if (
    d.priceMin !== null &&
    d.priceMax !== null &&
    D(d.priceMin).gt(d.priceMax)
  )
    issues.push("Donja cena je veća od gornje.");
  if (
    (d.price !== null && d.priceMin !== null && D(d.price).lt(d.priceMin)) ||
    (d.price !== null && d.priceMax !== null && D(d.price).gt(d.priceMax))
  )
    issues.push("Cena je izvan navedenog raspona.");
  if (
    [d.price, d.priceMin, d.priceMax].some(
      (v) => v !== null && D(v).isZero(),
    ) &&
    !d.zeroReason
  )
    issues.push("Nulta cena zahteva izričit razlog. Praznina nije nula.");
  return issues;
}
export function parseSerbianNumber(input: string): string | null {
  let v = input
    .trim()
    .replace(/\u00a0|\s/g, "")
    .replace(/(?:RSD|EUR|din\.?|€)$/i, "");
  if (!v || /^[-–—/]+$/.test(v)) return null;
  if (/^\d{1,3}(\.\d{3})+(,\d{1,6})?$/.test(v))
    v = v.replaceAll(".", "").replace(",", ".");
  else if (/^\d+(,\d{1,6})?$/.test(v)) v = v.replace(",", ".");
  else if (!/^\d+(\.\d{1,2})?$/.test(v)) return null;
  return /^\d{1,14}(\.\d{1,6})?$/.test(v) ? D(v).toString() : null;
}
export function priceFromCell(value: string) {
  const range = value.trim().match(/^(.*?)\s*[-–—]\s*(.*?)$/);
  if (range) {
    const min = parseSerbianNumber(range[1]),
      max = parseSerbianNumber(range[2]);
    if (min !== null && max !== null && D(min).lte(max))
      return { price: null, priceMin: min, priceMax: max };
  }
  return { price: parseSerbianNumber(value), priceMin: null, priceMax: null };
}
export const mappingSchema = z.object({
  tableIndex: z.number().int().min(0),
  startRow: z.number().int().min(0),
  productColumn: z.number().int().min(0),
  unitColumn: z.number().int().min(0).nullable(),
  qualityColumn: z.number().int().min(0).nullable().default(null),
  unit: z.enum(["kg", "t", "l", "kom", "grlo", ""]).default(""),
  currency: z.enum(["RSD", "EUR"]),
  priceType: z.enum(["otkupna", "veleprodajna", "maloprodajna"]),
  columns: z
    .array(
      z.object({
        column: z.number().int().min(0),
        place: z.string().trim().min(1).max(200),
        market: z.string().trim().min(1).max(200),
      }),
    )
    .min(1)
    .max(40),
});
export type TableMapping = z.infer<typeof mappingSchema>;
export function normalizedUnit(v: string) {
  const s = v.toLocaleLowerCase("sr-Latn").trim().replaceAll(".", "");
  return (
    (
      {
        kg: "kg",
        kilogram: "kg",
        кг: "kg",
        килограм: "kg",
        t: "t",
        tona: "t",
        т: "t",
        тона: "t",
        l: "l",
        lit: "l",
        litar: "l",
        л: "l",
        литар: "l",
        kom: "kom",
        komad: "kom",
        ком: "kom",
        комад: "kom",
        grlo: "grlo",
        грло: "grlo",
      } as Record<string, string>
    )[s] || ""
  );
}
export function mappedRows(table: RawTable, m: TableMapping, meta: Metadata) {
  if (m.startRow >= table.rows.length)
    throw Error("Početni red je izvan tabele.");
  const out = [];
  for (let r = m.startRow; r < table.rows.length; r++) {
    const cells = table.rows[r],
      product = cells[m.productColumn]?.trim();
    if (!product) continue;
    for (const c of m.columns) {
      const cell = cells[c.column] || "";
      if (!cell.trim() || /^[-–—/]+$/.test(cell.trim())) continue;
      const parsed = priceFromCell(cell);
      const d = priceDraftSchema.parse({
        product,
        place: c.place,
        market: c.market,
        priceType: m.priceType,
        currency: m.currency,
        unit:
          m.unitColumn === null
            ? m.unit
            : normalizedUnit(cells[m.unitColumn] || ""),
        quality: m.qualityColumn === null ? "" : cells[m.qualityColumn] || "",
        ...parsed,
        periodStart: meta.periodStart,
        periodEnd: meta.periodEnd,
      });
      out.push({
        sourceKey: `table:${m.tableIndex}:row:${r}:column:${c.column}`,
        page: table.page,
        tableIndex: m.tableIndex,
        sourceRow: r,
        sourceColumn: c.column,
        cells,
        quote: cells.join(" | "),
        draft: d,
        issues:
          parsed.price === null && parsed.priceMin === null
            ? ["Cena nije jednoznačno prepoznata; potreban ručni pregled."]
            : [],
      });
    }
  }
  if (out.length > 2000)
    throw Error("Mapiranje daje više od 2000 predloga. Podelite uvoz.");
  return out;
}
