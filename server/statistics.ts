import { z } from "zod";
import { randomUUID } from "node:crypto";
import { db, transaction } from "./db.js";
import { text, url, date } from "./validation.js";
import { D } from "./domain.js";

export const statisticsSchema = z.object({
  source: z.object({ id: text, name: text, url, terms: text }),
  series: z.object({
    id: text,
    product: text,
    indicator: text,
    definition: text,
    mapping: text,
    geography: text,
    unit: text,
    currency: z.string().max(10).nullable(),
    priceType: z.string().max(100).nullable(),
    sourceUrl: url,
  }),
  observations: z
    .array(
      z.object({
        period: z.number().int().min(1900).max(2100),
        value: z
          .string()
          .regex(/^\d{1,18}(\.\d{1,40})?$/)
          .nullable(),
        status: z.enum([
          "konačan",
          "prethodan",
          "procenjen",
          "nepotpuna godina",
          "revidiran",
          "ispravljen",
          "nedostaje podatak",
          "neprimenljiv",
          "nije značajna",
        ]),
        publishedAt: date.nullable().default(null),
        sourceUpdatedAt: date.nullable().default(null),
        retrievedAt: z.iso.datetime().optional(),
        sourceUrl: url,
        sourceStatus: z
          .object({
            code: z.string().min(1).max(10),
            label: text,
            documentHash: z
              .string()
              .regex(/^[a-f0-9]{64}$/)
              .optional(),
            sourceRow: z.number().int().min(1).optional(),
          })
          .nullable()
          .default(null),
      }),
    )
    .max(200),
});
export type StatisticImport = z.infer<typeof statisticsSchema>;
const datePart = (v: any) =>
  v == null
    ? null
    : v instanceof Date
      ? v.toISOString().slice(0, 10)
      : String(v).slice(0, 10);
const statusKey = (s: any) =>
  s == null
    ? null
    : JSON.stringify([
        s.code,
        s.label,
        s.documentHash ?? null,
        s.sourceRow ?? null,
      ]);
export async function importStatistics(input: unknown, actor: string) {
  const b = statisticsSchema.parse(input);
  if (b.series.currency && !b.series.priceType)
    throw Error("Monetarna serija zahteva vrstu cene.");
  if (b.observations.some((o) => o.period > new Date().getUTCFullYear()))
    throw Error(
      "Buduće projekcije nisu ostvareni statistički podaci prve faze.",
    );
  if (
    new Set(b.observations.map((o) => o.period)).size !== b.observations.length
  )
    throw Error("Godina se ponavlja u istoj seriji.");
  if (
    b.series.geography === "Srbija" &&
    (b.source.id.toLowerCase().includes("stips") ||
      new URL(b.source.url).hostname.includes("stips"))
  )
    throw Error("STIPS lokalne cene nisu nacionalni godišnji pokazatelj.");
  if (
    b.observations.some(
      (o) =>
        ["nedostaje podatak", "neprimenljiv", "nije značajna"].includes(
          o.status,
        ) && o.value !== null,
    )
  )
    throw Error(
      "Nedostajući/neprimenljiv podatak mora ostati prazan, a ne nula.",
    );
  return transaction(async (tx) => {
    // Serialize overlapping imports of the same source; revisions cannot overwrite each other.
    await tx.query(
      "INSERT INTO data_sources(id,name,url,terms) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,url=EXCLUDED.url,terms=EXCLUDED.terms,checked_at=now()",
      [b.source.id, b.source.name, b.source.url, b.source.terms],
    );
    const s = b.series,
      existing = (
        await tx.query(
          "SELECT * FROM statistic_series WHERE id=$1 FOR UPDATE",
          [s.id],
        )
      ).rows[0];
    if (
      existing &&
      (existing.source_id !== b.source.id ||
        existing.product !== s.product ||
        existing.unit !== s.unit ||
        existing.geography !== s.geography ||
        existing.indicator !== s.indicator ||
        existing.definition !== s.definition ||
        existing.mapping !== s.mapping ||
        existing.currency !== s.currency ||
        existing.price_type !== s.priceType)
    )
      throw Error(
        "Promena definicije/mapiranja zahteva novi identitet serije.",
      );
    await tx.query(
      "INSERT INTO statistic_series(id,source_id,product,indicator,definition,mapping,geography,unit,currency,price_type,source_url) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT(id) DO NOTHING",
      [
        s.id,
        b.source.id,
        s.product,
        s.indicator,
        s.definition,
        s.mapping,
        s.geography,
        s.unit,
        s.currency,
        s.priceType,
        s.sourceUrl,
      ],
    );
    let changed = 0;
    for (const o of b.observations) {
      const old = (
        await tx.query(
          "SELECT * FROM observations WHERE series_id=$1 AND period=$2 FOR UPDATE",
          [s.id, o.period],
        )
      ).rows[0];
      const sameValue =
        old &&
        (old.value == null
          ? o.value === null
          : o.value !== null && D(old.value).eq(o.value));
      if (
        sameValue &&
        old.status === o.status &&
        old.source_url === o.sourceUrl &&
        datePart(old.published_at) === o.publishedAt &&
        datePart(old.source_updated_at) === o.sourceUpdatedAt &&
        statusKey(old.source_status) === statusKey(o.sourceStatus)
      )
        continue;
      const history = old
        ? [
            ...old.history,
            {
              value: old.value,
              status: old.status,
              revision: old.revision,
              publishedAt: old.published_at,
              sourceUpdatedAt: old.source_updated_at,
              sourceStatus: old.source_status,
              sourceUrl: old.source_url,
              retrievedAt: old.retrieved_at,
            },
          ]
        : [];
      await tx.query(
        "INSERT INTO observations(id,series_id,period,value,status,published_at,source_url,revision,history,source_updated_at,source_status,retrieved_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,COALESCE($12::timestamptz,now())) ON CONFLICT(series_id,period) DO UPDATE SET value=EXCLUDED.value,status=EXCLUDED.status,published_at=EXCLUDED.published_at,source_url=EXCLUDED.source_url,revision=EXCLUDED.revision,history=EXCLUDED.history,source_updated_at=EXCLUDED.source_updated_at,source_status=EXCLUDED.source_status,retrieved_at=EXCLUDED.retrieved_at",
        [
          old?.id || randomUUID(),
          s.id,
          o.period,
          o.value,
          o.status,
          o.publishedAt,
          o.sourceUrl,
          old ? old.revision + 1 : 1,
          JSON.stringify(history),
          o.sourceUpdatedAt,
          JSON.stringify(o.sourceStatus),
          o.retrievedAt || null,
        ],
      );
      changed++;
    }
    await tx.query(
      "INSERT INTO audit_log(id,user_id,action,entity,metadata) VALUES($1,$2,'import',$3,$4)",
      [
        randomUUID(),
        actor,
        s.id,
        JSON.stringify({ observations: b.observations.length, changed }),
      ],
    );
    return { changed, observations: b.observations.length, seriesId: s.id };
  });
}
