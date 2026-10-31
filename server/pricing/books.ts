import { Router } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db, transaction, type Conn } from "../db.js";
import { id, text, date, currency } from "../validation.js";
import { validateModel } from "../domain.js";
import {
  buildPricingTable,
  hash,
  normalizedPriceUnit,
  priceUnits,
  type PricingVersion,
} from "./model.js";
import { reconcileDraftRates } from "./rates.js";
import { modelInCurrency } from "./currency.js";
import { costKey } from "./identity.js";

export const adminPriceBooks = Router();
async function audit(
  tx: Conn,
  user: string,
  action: string,
  entity: string,
  metadata: unknown,
) {
  await tx.query(
    "INSERT INTO audit_log(id,user_id,action,entity,metadata) VALUES($1,$2,$3,$4,$5)",
    [randomUUID(), user, action, entity, JSON.stringify(metadata)],
  );
}
async function load(tx: Conn, bookId: string, lock = false) {
  const book = (
    await tx.query(
      "SELECT *,valid_from::text,valid_to::text FROM price_books WHERE id=$1" +
        (lock ? " FOR UPDATE" : ""),
      [bookId],
    )
  ).rows[0];
  if (!book) throw Error("Cenovnik nije pronađen.");
  const versions = (
    await tx.query<PricingVersion>(
      "SELECT v.*,v.valid_from::text,v.valid_to::text,t.name AS template_name FROM norm_versions v JOIN templates t ON t.id=v.template_id WHERE price_book_id=$1 ORDER BY v.id" +
        (lock ? " FOR UPDATE OF v" : ""),
      [bookId],
    )
  ).rows;
  return { book, versions };
}
function review(versions: PricingVersion[], confirmUnits: boolean) {
  return versions.map((v) => {
    const model = structuredClone(v.model);
    for (const i of model.items)
      if (i.priceInput) i.priceInput.proposed = false;
    model.reviewed = true;
    if (confirmUnits)
      for (const i of model.items)
        if (i.flags?.includes("alternative")) i.alternativeConfirmed = true;
    if (confirmUnits)
      for (const i of model.items) {
        const unit = normalizedPriceUnit(i.unit);
        if (priceUnits.includes(unit)) {
          i.unit = unit;
          i.unitConfirmed = true;
        }
      }
    return { ...v, model };
  });
}
export async function readiness(
  tx: Conn,
  bookId: string,
  confirmUnits: boolean,
) {
  const loaded = await load(tx, bookId, true);
  const { book } = loaded;
  const versions = loaded.versions.filter((v) => v.status === "draft");
  if (book.status === "archive")
    throw Error("Menjati se može samo nacrt cenovnika.");
  if (!versions.length) throw Error("Cenovnik nema nacrte za potvrdu.");
  if (
    (
      await tx.query(
        "SELECT id FROM price_preparations WHERE book_id=$1 AND status='running'",
        [bookId],
      )
    ).rows.length
  )
    throw Error("Priprema cena je u toku; sačekajte završetak.");
  const table = buildPricingTable(versions);
  const reviewed = review(versions, confirmUnits);
  const issues = reviewed.flatMap((v) =>
    validateModel(v.model).map((message) => ({
      versionId: v.id,
      culture: v.template_name,
      message: message.replace(/^([^:]+):/, (_all: string, itemId: string) => {
        const i = v.model.items.find((i: any) => i.id === itemId);
        return i ? `${i.name} (${itemId}):` : `${itemId}:`;
      }),
    })),
  );
  const materialPrices = new Map<string, Set<string>>();
  const reviewedTable = buildPricingTable([
    ...reviewed,
    ...loaded.versions
      .filter((v) => v.status === "active")
      .map((v) => ({ ...v, status: "draft" })),
  ]);
  for (const row of reviewedTable.rows)
    for (const occurrence of row.occurrences) {
      if (
        !occurrence.included ||
        occurrence.quantity === "0" ||
        occurrence.price === null
      )
        continue;
      const key = row.groupKey + ":" + row.unit;
      const prices = materialPrices.get(key) || new Set<string>();
      prices.add(occurrence.price);
      materialPrices.set(key, prices);
    }
  for (const row of reviewedTable.rows)
    if ((materialPrices.get(row.groupKey + ":" + row.unit)?.size || 0) > 1) {
      for (const versionId of new Set(
        row.occurrences
          .filter((o) => versions.some((v) => v.id === o.versionId))
          .map((o) => o.versionId),
      ))
        issues.push({
          versionId,
          culture: versions.find((v) => v.id === versionId)!.template_name,
          message: `${row.name}: različite cene istog inputa. Usaglasite kroz zajedničku tabelu.`,
        });
    }
  if (!versions.length)
    issues.push({
      versionId: "",
      culture: "Katalog",
      message: "Nema proizvodnih normativa.",
    });
  const overlaps = (
    await tx.query(
      "SELECT old.id,old.name,t.name AS culture,next.id AS next_id FROM norm_versions old JOIN norm_versions next ON next.template_id=old.template_id JOIN templates t ON t.id=old.template_id WHERE next.price_book_id=$1 AND next.status='draft' AND old.status='active' AND old.valid_from<=next.valid_to AND old.valid_to>=next.valid_from ORDER BY old.id",
      [bookId],
    )
  ).rows;
  const readyVersions = reviewed.filter(
    (v) => !issues.some((i) => i.versionId === v.id),
  );
  const readyIds = new Set(readyVersions.map((v) => v.id));
  return {
    book,
    versions,
    reviewed,
    readyVersions,
    table,
    issues,
    overlaps: overlaps.filter((o) => readyIds.has(o.next_id)),
  };
}
adminPriceBooks.get("/", async (req: any, res) => {
  const books = (
    await db.query(
      "SELECT b.*,b.valid_from::text,b.valid_to::text,(SELECT count(*)::int FROM norm_versions v WHERE v.price_book_id=b.id) AS cultures,(SELECT count(*)::int FROM norm_versions v WHERE v.price_book_id=b.id AND v.status='draft') AS pending,(SELECT count(*)::int FROM norm_versions v WHERE v.price_book_id=b.id AND v.status='active') AS approved FROM price_books b ORDER BY created_at DESC,id",
    )
  ).rows;
  // Existing drafts are offered by name/period, without selecting cultures again.
  const legacy = (
    await db.query(
      "SELECT name,valid_from::text,valid_to::text,count(DISTINCT template_id)::int AS cultures FROM norm_versions WHERE status='draft' AND price_book_id IS NULL GROUP BY name,valid_from,valid_to ORDER BY valid_from DESC,name",
    )
  ).rows;
  await audit(db, req.user.id, "admin_price_read", "price_books", {});
  res.json({ books, legacy });
});
adminPriceBooks.get("/:id", async (req: any, res) => {
  const { book, versions } = await load(db, id.parse(req.params.id));
  await audit(db, req.user.id, "admin_price_read", book.id, {});
  res.json({
    book,
    table:
      book.status !== "archive" && versions.some((v) => v.status === "draft")
        ? buildPricingTable(versions.filter((v) => v.status === "draft"))
        : null,
    versions: versions.map((v) => ({
      id: v.id,
      name: v.template_name,
      status: v.status,
      model: v.model,
    })),
  });
});
adminPriceBooks.post("/", async (req: any, res) => {
  const b = z
    .object({
      requestId: id,
      name: text,
      validFrom: date,
      validTo: date,
      reason: text,
      adoptExisting: z.boolean().default(false),
      currency: currency.default("RSD"),
    })
    .parse(req.body);
  if (b.validFrom > b.validTo) throw Error("Neispravan period cenovnika.");
  const result = await transaction(async (tx) => {
    // Serializes catalog-level changes by all administrators, including creation retries.
    await tx.query("SELECT id FROM templates ORDER BY id FOR UPDATE");
    const existing = (
      await tx.query("SELECT * FROM price_books WHERE request_id=$1", [
        b.requestId,
      ])
    ).rows[0];
    if (existing) {
      const original = (
        await tx.query(
          "SELECT metadata FROM audit_log WHERE action='price_book_create' AND entity=$1 ORDER BY at,id LIMIT 1",
          [existing.id],
        )
      ).rows[0]?.metadata;
      if (
        existing.author !== req.user.id ||
        !original ||
        hash([
          original.name,
          original.validFrom,
          original.validTo,
          original.reason,
          original.adoptExisting,
          original.currency || "EUR",
        ]) !==
          hash([
            b.name,
            b.validFrom,
            b.validTo,
            b.reason,
            b.adoptExisting,
            b.currency,
          ])
      )
        throw Object.assign(
          Error("Zahtev je već upotrebljen za drugi cenovnik."),
          { status: 409 },
        );
      return { id: existing.id, reused: true };
    }
    const bookId = randomUUID();
    await tx.query(
      "INSERT INTO price_books(id,request_id,name,valid_from,valid_to,author,reason,currency) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
      [
        bookId,
        b.requestId,
        b.name,
        b.validFrom,
        b.validTo,
        req.user.id,
        b.reason,
        b.currency,
      ],
    );
    // Exactly one source per original template, preserving both livestock intensities.
    const sources = (
      await tx.query<PricingVersion>(
        "SELECT DISTINCT ON (v.template_id) v.*,v.valid_from::text,v.valid_to::text,t.name AS template_name FROM norm_versions v JOIN templates t ON t.id=v.template_id ORDER BY v.template_id,(v.status='active') DESC,v.created_at DESC,v.id",
      )
    ).rows;
    if (!sources.length) throw Error("Prvo uvezite izvorni katalog.");
    let adopted = 0;
    const origins: {
      templateId: string;
      sourceVersionId: string;
      versionId: string;
      adopted: boolean;
    }[] = [];
    for (const source of sources) {
      const old = b.adoptExisting
        ? (
            await tx.query(
              "SELECT id,model FROM norm_versions WHERE template_id=$1 AND status='draft' AND price_book_id IS NULL AND name=$2 AND valid_from=$3 AND valid_to=$4 ORDER BY created_at DESC,id DESC LIMIT 1 FOR UPDATE",
              [source.template_id, b.name, b.validFrom, b.validTo],
            )
          ).rows[0]
        : null;
      if (old) {
        await tx.query(
          "UPDATE norm_versions SET price_book_id=$1,model=$3 WHERE id=$2",
          [
            bookId,
            old.id,
            JSON.stringify(modelInCurrency(old.model, b.currency, true)),
          ],
        );
        adopted++;
        origins.push({
          templateId: source.template_id,
          sourceVersionId: old.id,
          versionId: old.id,
          adopted: true,
        });
        continue;
      }
      const model = modelInCurrency(
        source.model,
        b.currency,
        source.status === "active" || !!source.price_book_id,
      );
      delete model.priceDraftRequestId;
      delete model.priceDraftRequestHash;
      const versionId = randomUUID();
      await tx.query(
        "INSERT INTO norm_versions(id,template_id,name,status,valid_from,valid_to,author,reason,model,price_book_id) VALUES($1,$2,$3,'draft',$4,$5,$6,$7,$8,$9)",
        [
          versionId,
          source.template_id,
          b.name,
          b.validFrom,
          b.validTo,
          req.user.id,
          b.reason,
          JSON.stringify(model),
          bookId,
        ],
      );
      origins.push({
        templateId: source.template_id,
        sourceVersionId: source.id,
        versionId,
        adopted: false,
      });
    }
    await audit(tx, req.user.id, "price_book_create", bookId, {
      ...b,
      cultures: sources.length,
      adopted,
      origins,
    });
    return { id: bookId, cultures: sources.length, adopted };
  });
  res.json(result);
});
const approval = z.object({
  revision: z.string().regex(/^[a-f0-9]{64}$/),
  confirmUnits: z.boolean(),
  confirmed: z.boolean().default(false),
  replaceOverlaps: z.boolean().default(false),
  reason: text,
});
for (const action of ["check", "activate"] as const)
  adminPriceBooks.post(`/:id/${action}`, async (req: any, res) => {
    const b = approval.parse(req.body);
    const result = await transaction(async (tx) => {
      await tx.query("SELECT id FROM templates ORDER BY id FOR UPDATE");
      const r = await readiness(tx, id.parse(req.params.id), b.confirmUnits);
      if (r.table.revision !== b.revision)
        throw Object.assign(
          Error("Cenovnik je promenjen. Ponovo ga otvorite pre potvrde."),
          { status: 409 },
        );
      if (action === "check") {
        await audit(tx, req.user.id, "price_book_check", r.book.id, {
          issues: r.issues.length,
          confirmUnits: b.confirmUnits,
        });
        return {
          ready: r.readyVersions.length > 0,
          readyCount: r.readyVersions.length,
          pendingCount: r.versions.length - r.readyVersions.length,
          issues: r.issues,
          overlaps: r.overlaps,
        };
      }
      if (!b.confirmed || !b.confirmUnits)
        throw Error(
          "Potvrdite zajednički pregled jedinica, izvora i normativa.",
        );
      if (!r.readyVersions.length)
        return {
          ready: false,
          readyCount: 0,
          issues: r.issues,
          overlaps: r.overlaps,
        };
      if (r.overlaps.length && !b.replaceOverlaps)
        throw Error(
          "Postoji aktivan cenovnik za isti period. Potvrdite zamenu i arhiviranje prethodnih verzija.",
        );
      for (const old of r.overlaps) {
        await tx.query(
          "UPDATE norm_versions SET status='archive' WHERE id=$1",
          [old.id],
        );
        await audit(tx, req.user.id, "archive", old.id, {
          reason: b.reason,
          replacedBy: r.book.id,
        });
      }
      // A proposal becomes a reusable approved mapping only after this human confirmation.
      const accepted = new Set<string>();
      for (const row of buildPricingTable(r.readyVersions).rows)
        for (const occurrence of row.occurrences) {
          if (!occurrence.included || occurrence.quantity === "0") continue;
          const ref: any = occurrence.lastInput?.reference,
            k = costKey(row),
            identity = k + ":" + row.unit;
          if (!ref || accepted.has(identity)) continue;
          if (ref.kind === "stips_input" && ref.unitsPerPrice) {
            await tx.query(
              "INSERT INTO input_price_links(cost_key,unit,product,manufacturer,packaging,units_per_price,observation_id,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(cost_key,unit) DO UPDATE SET product=EXCLUDED.product,manufacturer=EXCLUDED.manufacturer,packaging=EXCLUDED.packaging,units_per_price=EXCLUDED.units_per_price,observation_id=EXCLUDED.observation_id,updated_by=EXCLUDED.updated_by,updated_at=now()",
              [
                k,
                row.unit,
                ref.product,
                ref.manufacturer,
                ref.packaging,
                ref.unitsPerPrice,
                ref.observationId,
                req.user.id,
              ],
            );
            accepted.add(identity);
          } else if (
            ref.kind === "rzs_purchase_price" &&
            ref.sourceUnitConfirmedByAdmin
          ) {
            await tx.query(
              "INSERT INTO rzs_input_links(cost_key,unit,source_unit,product,observation_id,updated_by) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(cost_key,unit) DO UPDATE SET source_unit=EXCLUDED.source_unit,product=EXCLUDED.product,observation_id=EXCLUDED.observation_id,updated_by=EXCLUDED.updated_by,updated_at=now()",
              [
                k,
                row.unit,
                ref.sourceUnit,
                ref.product,
                ref.observationId,
                req.user.id,
              ],
            );
            accepted.add(identity);
          }
          if (accepted.has(identity))
            await audit(
              tx,
              req.user.id,
              "price_reference_approved",
              r.book.id,
              { key: k, unit: row.unit, reference: ref },
            );
        }
      for (const v of r.readyVersions) {
        await tx.query(
          "UPDATE norm_versions SET status='active',model=$1,reason=$2 WHERE id=$3",
          [JSON.stringify(v.model), b.reason, v.id],
        );
        await audit(tx, req.user.id, "activate", v.id, {
          reason: b.reason,
          priceBookId: r.book.id,
        });
      }
      await tx.query(
        "UPDATE price_books SET status='archive' WHERE status='active' AND id<>$1 AND NOT EXISTS(SELECT 1 FROM norm_versions v WHERE v.price_book_id=price_books.id AND v.status IN ('active','draft'))",
        [r.book.id],
      );
      await tx.query(
        "UPDATE price_books SET status='active',reason=$1 WHERE id=$2",
        [b.reason, r.book.id],
      );
      await audit(tx, req.user.id, "price_book_activate", r.book.id, {
        reason: b.reason,
        cultures: r.readyVersions.length,
        replaced: r.overlaps.map((v) => v.id),
      });
      return {
        ready: true,
        activated: true,
        cultures: r.readyVersions.length,
        remaining: r.versions.length - r.readyVersions.length,
        issues: r.issues,
        overlaps: [],
      };
    });
    res.status(action === "activate" && !result.ready ? 422 : 200).json({
      ...result,
      ...(action === "activate" && !result.ready
        ? {
            error:
              "Cenovnik nije kompletan. Ponovite grupnu proveru i rešite prikazane nalaze.",
          }
        : {}),
    });
  });
adminPriceBooks.post("/:id/reconcile-rates", async (req: any, res) => {
  // Also repairs drafts saved before this release when the matching rate already existed.
  const result = await transaction(async (tx) => {
    const r = await load(tx, id.parse(req.params.id), true);
    if (r.book.status === "archive")
      throw Error("Preračunavaju se samo nacrti.");
    return reconcileDraftRates(tx, req.user.id);
  });
  res.json(result);
});
adminPriceBooks.post("/:id/archive", async (req: any, res) => {
  const reason = text.parse(req.body.reason);
  await transaction(async (tx) => {
    await tx.query("SELECT id FROM templates ORDER BY id FOR UPDATE");
    const { book, versions } = await load(tx, id.parse(req.params.id), true);
    if (
      (
        await tx.query(
          "SELECT id FROM price_preparations WHERE book_id=$1 AND status='running'",
          [book.id],
        )
      ).rows.length
    )
      throw Error("Priprema je u toku; sačekajte završetak pre arhiviranja.");
    for (const v of versions) {
      await tx.query("UPDATE norm_versions SET status='archive' WHERE id=$1", [
        v.id,
      ]);
      await audit(tx, req.user.id, "archive", v.id, {
        reason,
        priceBookId: book.id,
      });
    }
    await tx.query(
      "UPDATE price_books SET status='archive',reason=$1 WHERE id=$2",
      [reason, book.id],
    );
    await audit(tx, req.user.id, "price_book_archive", book.id, { reason });
  });
  res.json({ ok: true });
});
