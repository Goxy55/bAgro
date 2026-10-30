import { Router } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db, transaction, type Conn } from "../db.js";
import { id, text, date, dec, currency } from "../validation.js";
import { D } from "../domain.js";
import { todayInSerbia } from "../../shared/dates.js";
import { rateFor } from "../reports.js";
import { inputReferenceSchema, referencePrice } from "../inputs/service.js";
import { costKey, suggestPrices } from "./suggestions.js";
import {
  rzsReferenceSchema,
  rzsReferencePrice,
  retrieveRzsPrices,
  ingestRzsPrices,
  rzsPriceUrl,
} from "./rzs-prices.js";
import {
  buildPricingTable,
  hash,
  normalizedPriceUnit,
  priceUnits,
  type PricingVersion,
} from "./model.js";

export const adminPricing = Router();
adminPricing.get("/rzs-prices", async (req: any, res) => {
  const rows = (
    await db.query(
      "SELECT count(*)::int AS count,max(year) AS latest_year FROM rzs_reference_prices",
    )
  ).rows[0];
  const document = (
    await db.query(
      "SELECT source_url,retrieved_at,sha256 FROM rzs_price_documents ORDER BY retrieved_at DESC LIMIT 1",
    )
  ).rows[0];
  await audit(db, req.user.id, "admin_price_read", "rzs_reference_prices", {});
  res.json({ ...rows, document: document || null, source: rzsPriceUrl });
});
adminPricing.post("/rzs-prices/refresh", async (req: any, res) => {
  const content = await retrieveRzsPrices();
  res.json(
    await transaction((tx) => ingestRzsPrices(tx, content, req.user.id)),
  );
});
const ids = z
  .array(id)
  .min(1)
  .max(100)
  .refine((a) => new Set(a).size === a.length, "Ponovljen izbor verzije.");
const conflict = (message: string) =>
  Object.assign(Error(message), { status: 409 });
async function versions(conn: Conn, selected: string[], lock = false) {
  const rows = (
    await conn.query<PricingVersion>(
      "SELECT v.*,t.name AS template_name,v.valid_from::text AS valid_from,v.valid_to::text AS valid_to FROM norm_versions v JOIN templates t ON t.id=v.template_id WHERE v.id=ANY($1::uuid[]) ORDER BY t.name,v.id" +
        (lock ? " FOR UPDATE OF v" : ""),
      [selected],
    )
  ).rows;
  if (rows.length !== selected.length)
    throw Error("Jedna od izabranih verzija ne postoji.");
  const bookIds = [
    ...new Set(rows.map((v) => v.price_book_id).filter(Boolean)),
  ];
  if (bookIds.length) {
    if (
      bookIds.length !== 1 ||
      rows.some((v) => v.price_book_id !== bookIds[0])
    )
      throw Error(
        "Zajednički cenovnik se otvara u celini, bez mešanja različitih cenovnika.",
      );
    const count = (
      await conn.query(
        "SELECT count(*)::int AS count FROM norm_versions WHERE price_book_id=$1",
        [bookIds[0]],
      )
    ).rows[0].count;
    if (count !== rows.length)
      throw Error(
        "Otvorite ceo imenovani cenovnik. Cene se raspoređuju na sve njegove kulture.",
      );
  }
  return rows;
}
async function audit(
  conn: Conn,
  user: string,
  action: string,
  entity: string,
  metadata: unknown,
) {
  await conn.query(
    "INSERT INTO audit_log(id,user_id,action,entity,metadata) VALUES($1,$2,$3,$4,$5)",
    [randomUUID(), user, action, entity, JSON.stringify(metadata)],
  );
}
adminPricing.get("/table", async (req, res) => {
  const selected = ids.parse(z.string().parse(req.query.versionIds).split(","));
  const table = buildPricingTable(await versions(db, selected));
  await audit(
    db,
    (req as any).user.id,
    "admin_price_read",
    "shared_price_table",
    { versions: selected },
  );
  res.json(table);
});
adminPricing.post("/stips-suggestions", async (req: any, res) => {
  const b = z
    .object({
      versionIds: ids,
      revision: z.string().regex(/^[a-f0-9]{64}$/),
      asOf: date,
      place: z.string().trim().max(100).optional(),
      includeExisting: z.boolean().default(false),
    })
    .parse(req.body);
  if (b.asOf > todayInSerbia())
    throw Error("Datum izbora STIPS cena ne može biti u budućnosti.");
  const table = buildPricingTable(await versions(db, b.versionIds));
  if (table.revision !== b.revision)
    throw conflict(
      "Cenovnik je u međuvremenu promenjen. Ponovo otvorite tabelu.",
    );
  const result = await suggestPrices(db, table, b);
  await audit(
    db,
    req.user.id,
    "stips_price_suggestions",
    "shared_price_table",
    {
      versionIds: b.versionIds,
      asOf: b.asOf,
      place: result.place,
      matched: result.rows.filter((r) => r.status === "matched").length,
    },
  );
  res.json(result);
});
adminPricing.post("/drafts", async (req: any, res) => {
  const b = z
    .object({
      sourceIds: ids,
      requestId: id,
      name: text,
      validFrom: date,
      validTo: date,
      reason: text,
    })
    .parse(req.body);
  if (b.validFrom > b.validTo) throw Error("Neispravan period važenja.");
  const fingerprint = hash({
    ...b,
    sourceIds: [...b.sourceIds].sort(),
    requestId: undefined,
  });
  const result = await transaction(async (tx) => {
    // Serialize retries from the same author even if a reused request ID names
    // a different set of sources; no uniqueness is inferred from a JSON field.
    await tx.query("SELECT id FROM ba_user WHERE id=$1 FOR UPDATE", [
      req.user.id,
    ]);
    const source = await versions(tx, b.sourceIds, true);
    if (new Set(source.map((v) => v.template_id)).size !== source.length)
      throw Error("Za svaku kulturu izaberite samo jednu izvornu verziju.");
    const existing = (
      await tx.query(
        "SELECT id,model FROM norm_versions WHERE author=$1 AND model->>'priceDraftRequestId'=$2",
        [req.user.id, b.requestId],
      )
    ).rows;
    if (existing.length) {
      if (
        existing.length !== source.length ||
        existing.some((v) => v.model.priceDraftRequestHash !== fingerprint)
      )
        throw conflict(
          "Ovaj zahtev je već upotrebljen za drugačiji skup nacrta.",
        );
      return { ids: existing.map((v) => v.id), reused: true };
    }
    const created: string[] = [];
    for (const s of source) {
      const model = structuredClone(s.model);
      model.reviewed = false;
      model.priceDraftRequestId = b.requestId;
      model.priceDraftRequestHash = fingerprint;
      for (const item of model.items) {
        item.price = null;
        item.unitConfirmed = false;
        item.zeroReason = null;
        delete item.priceInput;
      }
      const vid = randomUUID();
      await tx.query(
        "INSERT INTO norm_versions(id,template_id,name,status,valid_from,valid_to,author,reason,model) VALUES($1,$2,$3,'draft',$4,$5,$6,$7,$8)",
        [
          vid,
          s.template_id,
          b.name,
          b.validFrom,
          b.validTo,
          req.user.id,
          b.reason,
          JSON.stringify(model),
        ],
      );
      created.push(vid);
      await audit(tx, req.user.id, "clone", vid, {
        sourceId: s.id,
        reason: b.reason,
        priceDraftRequestId: b.requestId,
      });
    }
    return { ids: created, reused: false };
  });
  res.json(result);
});
adminPricing.put("/table", async (req: any, res) => {
  const b = z
    .object({
      versionIds: ids,
      revision: z.string().regex(/^[a-f0-9]{64}$/),
      date,
      reason: text,
      rows: z
        .array(
          z.object({
            key: z.string().regex(/^[a-f0-9]{64}$/),
            price: dec.nullable(),
            currency,
            unit: z.string().trim().min(1).max(100),
            confirmUnit: z.boolean(),
            zeroReason: z.string().trim().max(300).default(""),
            reference: inputReferenceSchema.optional(),
            rzsReference: rzsReferenceSchema.optional(),
          }),
        )
        .min(1)
        .max(2000),
    })
    .parse(req.body);
  if (new Set(b.rows.map((r) => r.key)).size !== b.rows.length)
    throw Error("Ista vrsta troška je uneta više puta.");
  const result = await transaction(async (tx) => {
    const selected = await versions(tx, b.versionIds, true);
    const table = buildPricingTable(selected);
    if (table.revision !== b.revision)
      throw conflict(
        "Cenovnik je u međuvremenu promenjen. Ponovo otvorite tabelu pre čuvanja.",
      );
    const batchId = randomUUID(),
      warnings: string[] = [];
    const updates = new Map<string, any>();
    const rates = new Map<string, Awaited<ReturnType<typeof rateFor>>>();
    for (const r of b.rows) {
      const row = table.rows.find((row) => row.key === r.key);
      if (!row) throw Error("Stavka ne pripada izabranom skupu normativa.");
      const unit = normalizedPriceUnit(r.unit);
      const originalUnit = normalizedPriceUnit(row.unit);
      if (r.confirmUnit && !priceUnits.includes(unit))
        throw Error(`${row.name}: izaberite jasnu normalizovanu jedinicu.`);
      if (unit !== originalUnit && !r.confirmUnit)
        throw Error(`${row.name}: promena jedinice zahteva potvrdu.`);
      if (unit !== originalUnit && priceUnits.includes(originalUnit))
        throw Error(
          `${row.name}: promena poznate jedinice zahteva zasebnu konverziju normativa; količine se ovde ne menjaju.`,
        );
      if (
        r.price !== null &&
        D(r.price).isZero() &&
        !r.zeroReason &&
        row.occurrences.some((o) => o.quantity === null || D(o.quantity).gt(0))
      )
        throw Error(`${row.name}: nulta cena zahteva izričit razlog.`);
      if (r.reference && r.rzsReference)
        throw Error("Izaberite jedan izvor cene.");
      const source = r.rzsReference
        ? await rzsReferencePrice(tx, r.rzsReference, unit, table.validFrom)
        : r.reference
          ? await referencePrice(tx, r.reference, unit, table.validFrom)
          : null;
      if (
        source &&
        (r.currency !== "RSD" ||
          r.price === null ||
          !D(r.price).eq(source.amount))
      )
        throw Error(
          "Izabrana referentna cena ne odgovara unosu. Ponovite izbor izvora ili uklonite vezu ručnom izmenom cene.",
        );
      const priceDate = source?.date || b.date;
      const amount =
        source?.amount ?? (r.price === null ? null : D(r.price).toString());
      if (amount !== null && r.currency === "RSD" && !rates.has(priceDate))
        rates.set(priceDate, await rateFor(priceDate, tx));
      const rate = rates.get(priceDate) || null;
      const pending = amount !== null && r.currency === "RSD" && !rate;
      const eur =
        amount === null || pending
          ? null
          : r.currency === "EUR"
            ? amount
            : D(amount).div(rate!.rate).toString();
      if (pending)
        warnings.push(
          `${row.name}: unos RSD je sačuvan, ali nedostaje zvanični kurs za ${priceDate}; EUR cena ostaje prazna.`,
        );
      if (source && r.rzsReference) {
        const key = costKey(row);
        const before = (
          await tx.query(
            "SELECT * FROM rzs_input_links WHERE cost_key=$1 AND unit=$2",
            [key, unit],
          )
        ).rows[0];
        await tx.query(
          "INSERT INTO rzs_input_links(cost_key,unit,source_unit,product,observation_id,updated_by) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(cost_key,unit) DO UPDATE SET source_unit=EXCLUDED.source_unit,product=EXCLUDED.product,observation_id=EXCLUDED.observation_id,updated_by=EXCLUDED.updated_by,updated_at=now()",
          [
            key,
            unit,
            r.rzsReference.sourceUnit,
            source.snapshot.product,
            r.rzsReference.observationId,
            req.user.id,
          ],
        );
        await audit(tx, req.user.id, "rzs_price_link", key, {
          batchId,
          reason: b.reason,
          before: before || null,
          after: {
            unit,
            sourceUnit: r.rzsReference.sourceUnit,
            product: source.snapshot.product,
            observationId: r.rzsReference.observationId,
          },
        });
      }
      if (source && r.reference) {
        const key = costKey(row),
          previous = (
            await tx.query(
              "SELECT * FROM input_price_links WHERE cost_key=$1 AND unit=$2",
              [key, unit],
            )
          ).rows[0];
        await tx.query(
          `INSERT INTO input_price_links(cost_key,unit,product,manufacturer,packaging,units_per_price,observation_id,updated_by)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8)
           ON CONFLICT(cost_key,unit) DO UPDATE SET product=EXCLUDED.product,manufacturer=EXCLUDED.manufacturer,packaging=EXCLUDED.packaging,units_per_price=EXCLUDED.units_per_price,observation_id=EXCLUDED.observation_id,updated_by=EXCLUDED.updated_by,updated_at=now()`,
          [
            key,
            unit,
            source.snapshot.product,
            (source.snapshot as any).manufacturer,
            (source.snapshot as any).packaging,
            r.reference!.unitsPerPrice,
            source.snapshot.observationId,
            req.user.id,
          ],
        );
        await audit(tx, req.user.id, "stips_price_link", key, {
          batchId,
          reason: b.reason,
          before: previous || null,
          after: {
            unit,
            product: source.snapshot.product,
            manufacturer: (source.snapshot as any).manufacturer,
            packaging: (source.snapshot as any).packaging,
            unitsPerPrice: r.reference!.unitsPerPrice,
            observationId: source.snapshot.observationId,
          },
        });
      }
      for (const v of selected) {
        const changes: any[] = [];
        const memberIds = new Set(
          row.occurrences
            .filter((o) => o.versionId === v.id)
            .map((o) => o.itemId),
        );
        for (const item of v.model.items) {
          if (!memberIds.has(item.id)) continue;
          const before = {
            price: item.price,
            unit: item.unit,
            unitConfirmed: !!item.unitConfirmed,
            zeroReason: item.zeroReason,
          };
          item.price = eur;
          item.zeroReason =
            r.price !== null && D(r.price).isZero()
              ? r.zeroReason || null
              : null;
          if (r.confirmUnit) {
            item.unit = unit;
            item.unitConfirmed = true;
          }
          item.priceInput =
            amount === null
              ? null
              : {
                  amount,
                  currency: r.currency,
                  date: priceDate,
                  reference: source?.snapshot || null,
                  eur,
                  unit: item.unit,
                  pendingRate: !!pending,
                  batchId,
                  author: req.user.id,
                  rate:
                    r.currency === "RSD" && rate
                      ? {
                          value: String(rate.rate),
                          validFrom: rate.valid_from,
                          validTo: rate.valid_to,
                          source: rate.source_url,
                        }
                      : null,
                };
          changes.push({
            itemId: item.id,
            before,
            after: {
              price: item.price,
              unit: item.unit,
              unitConfirmed: !!item.unitConfirmed,
              zeroReason: item.zeroReason,
            },
            input: item.priceInput,
          });
        }
        if (changes.length)
          updates.set(v.id, [...(updates.get(v.id) || []), ...changes]);
      }
    }
    for (const v of selected) {
      const changes = updates.get(v.id);
      if (!changes) continue;
      await tx.query(
        "UPDATE norm_versions SET model=$1,reason=$2 WHERE id=$3",
        [JSON.stringify(v.model), b.reason, v.id],
      );
      v.reason = b.reason;
      await audit(tx, req.user.id, "shared_price_update", v.id, {
        batchId,
        reason: b.reason,
        date: b.date,
        changes,
      });
    }
    return {
      table: buildPricingTable(selected),
      batchId,
      changedVersions: updates.size,
      warnings,
    };
  });
  res.json(result);
});
