import { Router } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db, transaction, type Conn } from "../db.js";
import { id, text, date, dec, currency } from "../validation.js";
import { D } from "../domain.js";
import { rateFor } from "../reports.js";
import {
  buildPricingTable,
  hash,
  normalizedPriceUnit,
  priceUnits,
  type PricingVersion,
} from "./model.js";

export const adminPricing = Router();
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
    const rate = b.rows.some((r) => r.currency === "RSD" && r.price !== null)
      ? await rateFor(b.date, tx)
      : null;
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
      const amount = r.price === null ? null : D(r.price).toString();
      const pending = amount !== null && r.currency === "RSD" && !rate;
      const eur =
        amount === null || pending
          ? null
          : r.currency === "EUR"
            ? amount
            : D(amount).div(rate!.rate).toString();
      if (pending)
        warnings.push(
          `${row.name}: unos RSD je sačuvan, ali nedostaje zvanični kurs za ${b.date}; EUR cena ostaje prazna.`,
        );
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
                  date: b.date,
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
