import { randomUUID, createHash } from "node:crypto";
import { z } from "zod";
import { fetch, EnvHttpProxyAgent } from "undici";
import robotsParser from "robots-parser";
import type { Conn } from "../db.js";
import { id, text, date } from "../validation.js";
import { D, convertQuantity } from "../domain.js";
import { materialName } from "./identity.js";
import type { PriceSuggestionRow } from "../../shared/price-suggestions.js";
import type { PricingTable } from "../../shared/pricing.js";
import { costKey } from "./identity.js";

export const rzsPriceUrl =
  "https://data.stat.gov.rs/Home/Result/0302010302?languageCode=sr-Latn";
const rawRow = z.object({
  Indikator: z
    .string()
    .startsWith("Prosečne godišnje otkupne cene poljoprivrednih proizvoda"),
  "Teritorija - RPJ": z.literal("REPUBLIKA SRBIJA"),
  Proizvod: text,
  Period: z.string().regex(/^\d{4}$/),
  Vrednost: z.string(),
  IDStatusPodatka: z.string(),
  IDStatusPoverljivosti: z.string(),
  IDJedinicaMere: z.string(),
});
export function extractRzsPrices(content: Buffer) {
  if (content.length > 4 * 1024 * 1024) throw Error("RZS izvod prelazi 4 MB.");
  // Parse only the literal JSON array used by the source pivot table; never evaluate its scripts.
  const match = content
    .toString("utf8")
    .match(/\$\("#pivotTableOutput"\)\.pivotUI\(\s*(\[[\s\S]*?\])\s*,\s*\{/);
  if (!match)
    throw Error(
      "RZS struktura tabele nije prepoznata; prethodne cene su sačuvane.",
    );
  const rows = z.array(rawRow).min(1).max(10000).parse(JSON.parse(match[1]));
  const keys = new Set<string>();
  return rows.map((r) => {
    const key = r.Proizvod.trim() + ":" + r.Period;
    if (keys.has(key)) throw Error("Ponovljena dimenzija RZS cene.");
    keys.add(key);
    const available =
      ["A", "P", "R", "K"].includes(r.IDStatusPodatka) &&
      r.IDStatusPoverljivosti === "F" &&
      /^\d+(?:\.\d+)?$/.test(r.Vrednost) &&
      D(r.Vrednost).gt(0);
    return {
      product: r.Proizvod.trim(),
      year: Number(r.Period),
      price: available ? r.Vrednost : null,
      status: r.IDStatusPodatka,
      raw: r,
    };
  });
}
export async function ingestRzsPrices(
  conn: Conn,
  content: Buffer,
  actor: string,
) {
  const rows = extractRzsPrices(content),
    sha = createHash("sha256").update(content).digest("hex");
  const doc = (
    await conn.query(
      "INSERT INTO rzs_price_documents(id,sha256,source_url,content,author) VALUES($1,$2,$3,$4,$5) ON CONFLICT(sha256) DO NOTHING RETURNING id",
      [randomUUID(), sha, rzsPriceUrl, content, actor],
    )
  ).rows[0];
  if (!doc) return { reused: true, rows: rows.length };
  for (const r of rows)
    await conn.query(
      "INSERT INTO rzs_reference_prices(id,document_id,product,year,price_rsd,source_status,raw) VALUES($1,$2,$3,$4,$5,$6,$7)",
      [
        randomUUID(),
        doc.id,
        r.product,
        r.year,
        r.price,
        r.status,
        JSON.stringify(r.raw),
      ],
    );
  await conn.query(
    "INSERT INTO audit_log(id,user_id,action,entity,metadata) VALUES($1,$2,'rzs_prices_import',$3,$4)",
    [
      randomUUID(),
      actor,
      doc.id,
      JSON.stringify({ sha256: sha, rows: rows.length, source: rzsPriceUrl }),
    ],
  );
  return { reused: false, rows: rows.length };
}
export async function retrieveRzsPrices() {
  const dispatcher = new EnvHttpProxyAgent();
  try {
    const robots = await fetch("https://data.stat.gov.rs/robots.txt", {
      dispatcher,
      redirect: "error",
      signal: AbortSignal.timeout(10000),
    });
    if (![200, 404].includes(robots.status)) {
      await robots.body?.cancel();
      throw Error(
        "Nije moguće proveriti politiku RZS izvora; prethodni podaci su sačuvani.",
      );
    }
    const rules = robots.status === 200 ? await robots.text() : "";
    if (robots.status === 404) await robots.body?.cancel();
    if (rules.length > 128 * 1024) throw Error("RZS robots.txt je prevelik.");
    const policy = robotsParser("https://data.stat.gov.rs/robots.txt", rules);
    if (policy.isAllowed(rzsPriceUrl, "AgroPortal-RZS/1.0") === false)
      throw Error("Politika izvora ne dozvoljava preuzimanje izabrane tabele.");
    const delay = Math.max(
      1000,
      (policy.getCrawlDelay("AgroPortal-RZS/1.0") || 0) * 1000,
    );
    if (delay > 60000)
      throw Error(
        "Politika izvora zahteva predug razmak; koristite provereni admin uvoz.",
      );
    await new Promise((resolve) => setTimeout(resolve, delay));
    const response = await fetch(rzsPriceUrl, {
      dispatcher,
      redirect: "error",
      signal: AbortSignal.timeout(25000),
      headers: { "User-Agent": "AgroPortal-RZS/1.0", Accept: "text/html" },
    });
    if (response.status !== 200)
      throw Error(`RZS HTTP ${response.status}; prethodni podaci su sačuvani.`);
    const parts: Buffer[] = [];
    let size = 0;
    for await (const chunk of response.body!) {
      const b = Buffer.from(chunk);
      size += b.length;
      if (size > 4 * 1024 * 1024) throw Error("RZS odgovor prelazi 4 MB.");
      parts.push(b);
    }
    return Buffer.concat(parts);
  } finally {
    await dispatcher.close();
  }
}
export const rzsReferenceSchema = z.object({
  observationId: id,
  sourceUnit: z.enum(["kg", "t", "l", "kom"]),
  date,
  confirmedProduct: z.literal(true),
  confirmedBasis: z.literal(true),
  confirmedProxy: z.literal(true),
  allowHistorical: z.boolean(),
  note: z.string().trim().min(5).max(1000),
});
export async function rzsReferencePrice(
  conn: Conn,
  ref: z.infer<typeof rzsReferenceSchema>,
  unit: string,
  validFrom: string,
) {
  const r = (
    await conn.query(
      "SELECT p.*,p.price_rsd::text,d.source_url,d.sha256,d.retrieved_at FROM rzs_reference_prices p JOIN rzs_price_documents d ON d.id=p.document_id WHERE p.id=$1",
      [ref.observationId],
    )
  ).rows[0];
  if (!r?.price_rsd || D(r.price_rsd).lte(0))
    throw Error("RZS cena nije dostupna.");
  if (!["kg", "t", "l", "kom"].includes(unit))
    throw Error("RZS cena zahteva jasnu jedinicu.");
  if (ref.date.slice(0, 4) !== String(r.year))
    throw Error("Datum reference mora pripadati godini RZS cene.");
  if (`${r.year}-12-31` < validFrom && !ref.allowHistorical)
    throw Error("Godišnja RZS referenca zahteva potvrdu starijeg perioda.");
  // A statistical purchase price is an explicit admin-approved proxy, never
  // represented as a supplier's offer or an actual farm purchase.
  const amount = D(r.price_rsd)
    .mul(convertQuantity("1", unit, ref.sourceUnit))
    .toDecimalPlaces(12)
    .toString();
  return {
    amount,
    date: ref.date,
    snapshot: {
      kind: "rzs_purchase_price",
      observationId: r.id,
      documentId: r.document_id,
      sha256: r.sha256,
      sourceUrl: r.source_url,
      product: r.product,
      place: "Srbija",
      periodStart: `${r.year}-01-01`,
      periodEnd: `${r.year}-12-31`,
      originalPriceRsd: r.price_rsd,
      sourceUnit: ref.sourceUnit,
      unit,
      sourceUnitConfirmedByAdmin: true,
      priceType: "Godišnja otkupna cena — odobrena referenca inputa",
      sourceStatus: r.source_status,
      retrievedAt: r.retrieved_at,
      referenceDate: ref.date,
      note: ref.note,
      historicalAccepted: ref.allowHistorical,
      confirmedProduct: true,
      confirmedBasis: true,
      confirmedProxy: true,
      sheet: "RZS 0302010302",
      cell: `${r.product} / ${r.year}`,
    },
  };
}
export function matchRzsInput(row: any, product: string) {
  const name = materialName(row.occurrences[0]?.name || row.name),
    p = materialName(product);
  const livestock = row.occurrences.some((o: any) =>
    o.sheet.startsWith("Stočarstvo"),
  );
  // Commodity/feed and seed identities remain distinct. No mapping of broader
  // livestock categories, fertilizer indices or retail prices to material costs.
  if (livestock)
    return (
      name === p &&
      ["kukuruz", "psenica", "ovas", "raz", "soja", "lucerka"].includes(p)
    );
  if (!/^(seme|semenski materijal)(\s|$)/.test(name)) return false;
  const culture = materialName(row.name.split(" · ").slice(1).join(" · "));
  return (
    (culture === "psenica" && p === "psenica seme") ||
    (culture === "soja" && p === "soja seme") ||
    (culture === "suncokret" && p === "suncokret seme") ||
    (culture === "krompir" && p === "krompir semenski")
  );
}
export async function addRzsSuggestions(
  conn: Conn,
  table: PricingTable,
  rows: PriceSuggestionRow[],
  asOf: string,
) {
  const observations = (
    await conn.query(
      "SELECT DISTINCT ON(p.product) p.*,p.price_rsd::text,d.source_url,d.retrieved_at FROM rzs_reference_prices p JOIN rzs_price_documents d ON d.id=p.document_id WHERE p.year<$1 ORDER BY p.product,p.year DESC,d.retrieved_at DESC,p.id",
      [Number(asOf.slice(0, 4))],
    )
  ).rows;
  const links = (await conn.query("SELECT * FROM rzs_input_links")).rows;
  for (const r of rows) {
    if (r.candidates.length || r.status === "filled" || r.status === "excluded")
      continue;
    const original = table.rows.find((row) => row.key === r.key)!;
    const ambiguousUnit = /^kg\/l [—-] potvrditi$/.test(r.unit);
    if (!["kg", "t", "l", "kom"].includes(r.unit) && !ambiguousUnit) continue;
    for (const o of observations) {
      if (!o.price_rsd) continue;
      const link = links.find(
        (l) =>
          l.cost_key === costKey(original) &&
          (l.unit === r.unit || ambiguousUnit) &&
          l.product === o.product,
      );
      if (!link && !matchRzsInput(original, o.product)) continue;
      // kg is offered for these seed/feed candidates, never confirmed by the
      // extractor. The form requires explicit source-unit and model approval.
      const targetUnit = ambiguousUnit ? link?.unit || "kg" : r.unit;
      const sourceUnit = link?.source_unit || targetUnit;
      let amount: string, divisor: string;
      try {
        const factor = convertQuantity("1", targetUnit, sourceUnit);
        amount = D(o.price_rsd).mul(factor).toDecimalPlaces(12).toString();
        divisor = D(1).div(factor).toString();
      } catch {
        continue;
      }
      const date = `${o.year}-12-31`;
      const rate = (
        await conn.query(
          "SELECT id FROM exchange_rates WHERE valid_from<=$1 AND valid_to>=$1 LIMIT 1",
          [date],
        )
      ).rows[0];
      r.candidates.push({
        sourceKind: "rzs",
        sourceUnit: link?.source_unit,
        priceType: "Godišnja otkupna cena — referenca za pregled",
        observationId: o.id,
        product: o.product,
        manufacturer: "RZS",
        packaging: link
          ? `Admin potvrdio osnovu: ${sourceUnit}`
          : "Jedinica u izvodu nije navedena — potvrditi",
        place: "Srbija",
        unit: targetUnit,
        unitsPerPrice: divisor,
        amount,
        originalPrice: o.price_rsd,
        periodStart: `${o.year}-01-01`,
        periodEnd: date,
        date,
        sourceUrl: o.source_url,
        sheet: "RZS 0302010302",
        cell: `${o.product} / ${o.year}`,
        historical: date < table.validFrom,
        pendingRate: !rate,
        match: link ? "approved" : "review",
      });
      if (link) r.selectedId = o.id;
    }
    if (r.candidates.length) {
      r.status = "review";
      r.message =
        "RZS dopuna: godišnja otkupna cena. Potvrdite proizvod, izvornu jedinicu i primenu kao referencu inputa.";
    } else
      r.message =
        "Nema odgovarajuće proverene STIPS ili RZS cene za ovaj input.";
  }
  return observations.length;
}
