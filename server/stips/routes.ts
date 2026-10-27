import express from "express";
import multer from "multer";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { db, transaction } from "../db.js";
import {
  metadataSchema,
  priceDraftSchema,
  mappingSchema,
  publicationIssues,
  officialUrl,
} from "./schema.js";
import { MAX_DOCUMENT_BYTES } from "./extract.js";
import {
  ingestDocument,
  documentById,
  updateMetadata,
  applyMapping,
  createManual,
  editRow,
  publishRow,
  withdrawRow,
  publishedPrices,
  stipsAudit,
} from "./service.js";
import { probeAccess, runCrawl } from "./crawler.js";
const id = z.string().uuid(),
  reason = z.string().trim().min(1).max(1000);
export const publicStips = express.Router(),
  adminStips = express.Router();
publicStips.get("/", async (_req, res) => res.json(await publishedPrices()));
async function sendDocument(req: any, res: any, admin: boolean) {
  const doc = await documentById(id.parse(req.params.id), db, true);
  if (
    !admin &&
    !(
      await db.query(
        "SELECT id FROM stips_rows WHERE document_id=$1 AND published IS NOT NULL AND withdrawn=false LIMIT 1",
        [doc.id],
      )
    ).rows.length
  )
    return res.status(404).json({ error: "Dokument nije objavljen." });
  await stipsAudit(db, req.user.id, "stips_document_read", doc.id);
  res.setHeader("Content-Type", doc.mime);
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="stips-bilten.${doc.mime === "application/pdf" ? "pdf" : "html"}"; filename*=UTF-8''${encodeURIComponent(doc.filename)}`,
  );
  res.setHeader("Content-Security-Policy", "sandbox; default-src 'none'");
  res.send(Buffer.from(doc.content));
}
publicStips.get("/documents/:id/file", async (req: any, res) =>
  sendDocument(req, res, false),
);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_DOCUMENT_BYTES,
    files: 1,
    fields: 12,
    fieldSize: 4000,
  },
}).single("file");
adminStips.get("/", async (_req, res) => {
  const documents = (
    await db.query(
      "SELECT d.id,d.title,d.filename,d.mime,d.source_url,d.received_at,d.published_at::text,d.period_start::text,d.period_end::text,d.extraction_status,d.pages,d.sha256,(SELECT COUNT(*) FROM stips_rows r WHERE r.document_id=d.id) AS rows_count,(SELECT COUNT(*) FROM stips_rows r WHERE r.document_id=d.id AND r.published IS NOT NULL AND r.withdrawn=false) AS published_count FROM stips_documents d ORDER BY d.received_at DESC",
    )
  ).rows;
  res.json({
    documents,
    settings: (
      await db.query("SELECT * FROM stips_crawler_settings WHERE id=1")
    ).rows[0],
    runs: (
      await db.query(
        "SELECT * FROM stips_fetch_runs ORDER BY started_at DESC LIMIT 30",
      )
    ).rows,
  });
});
adminStips.post("/upload", upload, async (req: any, res) => {
  if (!req.file) throw Error("Izaberite PDF ili HTML bilten.");
  const meta = metadataSchema.parse({
    ...req.body,
    publishedAt: req.body.publishedAt || null,
    periodStart: req.body.periodStart || null,
    periodEnd: req.body.periodEnd || null,
    termsConfirmed: req.body.termsConfirmed === "true",
  });
  const name = String(req.file.originalname);
  let mime: "application/pdf" | "text/html";
  if (/\.pdf$/i.test(name)) mime = "application/pdf";
  else if (/\.html?$/i.test(name)) mime = "text/html";
  else throw Error("Podržani su samo PDF i HTML dokumenti.");
  res.json(
    await ingestDocument(req.file.buffer, mime, name, meta, req.user.id),
  );
});
adminStips.get("/documents/:id", async (req, res) => {
  const doc = await documentById(id.parse(req.params.id));
  const rows = (
    await db.query(
      "SELECT * FROM stips_rows WHERE document_id=$1 ORDER BY page,table_index,source_row,source_column,id",
      [doc.id],
    )
  ).rows;
  res.json({
    document: doc,
    rows: rows.map((r) => ({
      ...r,
      publicationIssues: publicationIssues(
        priceDraftSchema.parse(r.draft),
        doc,
      ),
    })),
  });
});
adminStips.get("/documents/:id/file", async (req: any, res) =>
  sendDocument(req, res, true),
);
adminStips.put("/documents/:id", async (req: any, res) => {
  await updateMetadata(
    id.parse(req.params.id),
    metadataSchema.parse(req.body),
    req.user.id,
  );
  res.json({ ok: true });
});
adminStips.post("/documents/:id/map", async (req: any, res) =>
  res.json(
    await applyMapping(
      id.parse(req.params.id),
      mappingSchema.parse(req.body),
      req.user.id,
    ),
  ),
);
adminStips.post("/documents/:id/rows", async (req: any, res) => {
  const b = z
    .object({
      draft: priceDraftSchema,
      page: z.number().int().min(1).max(40),
      quote: z.string().trim().min(1).max(8000),
    })
    .parse(req.body);
  res.json(
    await createManual(
      id.parse(req.params.id),
      b.draft,
      b.page,
      b.quote,
      req.user.id,
    ),
  );
});
adminStips.put("/rows/:id", async (req: any, res) => {
  const b = z
    .object({
      draft: priceDraftSchema,
      quote: z.string().trim().min(1).max(8000),
      reason,
    })
    .parse(req.body);
  await editRow(
    id.parse(req.params.id),
    b.draft,
    b.quote,
    b.reason,
    req.user.id,
  );
  res.json({ ok: true });
});
adminStips.post("/rows/:id/publish", async (req: any, res) =>
  res.json(
    await publishRow(
      id.parse(req.params.id),
      reason.parse(req.body.reason),
      req.user.id,
    ),
  ),
);
adminStips.post("/rows/:id/withdraw", async (req: any, res) => {
  await withdrawRow(
    id.parse(req.params.id),
    reason.parse(req.body.reason),
    req.user.id,
  );
  res.json({ ok: true });
});
adminStips.get("/rows/:id/history", async (req, res) =>
  res.json(
    (
      await db.query(
        "SELECT * FROM stips_row_history WHERE row_id=$1 ORDER BY at DESC",
        [id.parse(req.params.id)],
      )
    ).rows,
  ),
);
adminStips.put("/settings", async (req: any, res) => {
  const b = z
    .object({
      enabled: z.boolean(),
      listingUrls: z.array(officialUrl).min(1).max(3),
      intervalHours: z.number().int().min(6).max(168),
      maxDocuments: z.number().int().min(1).max(10),
      termsConfirmed: z.boolean(),
      termsNote: z.string().trim().max(2000),
    })
    .parse(req.body);
  if (b.enabled && (!b.termsConfirmed || !b.termsNote))
    throw Error(
      "Za automatsko preuzimanje dokumentujte proveru uslova korišćenja.",
    );
  await transaction(async (tx) => {
    await tx.query(
      "UPDATE stips_crawler_settings SET enabled=$1,listing_urls=$2,interval_hours=$3,max_documents=$4,terms_confirmed=$5,terms_note=$6,updated_by=$7,updated_at=now(),next_check_at=now() WHERE id=1",
      [
        b.enabled,
        JSON.stringify(b.listingUrls),
        b.intervalHours,
        b.maxDocuments,
        b.termsConfirmed,
        b.termsNote,
        req.user.id,
      ],
    );
    await stipsAudit(tx, req.user.id, "stips_settings", "STIPS", {
      enabled: b.enabled,
      listingUrls: b.listingUrls,
      intervalHours: b.intervalHours,
    });
  });
  res.json({ ok: true });
});
adminStips.post("/probe", async (req: any, res) => {
  const result = await probeAccess();
  await stipsAudit(db, req.user.id, "stips_probe", "STIPS", {
    status: result.status,
  });
  res.json(result);
});
adminStips.post("/fetch", async (req: any, res) =>
  res.json(await runCrawl(req.user.id)),
);
adminStips.use((err: any, _req: any, res: any, next: any) => {
  if (err instanceof multer.MulterError)
    return res.status(413).json({
      error: "Otpremanje nije uspelo. Dozvoljen je jedan dokument do 8 MB.",
    });
  next(err);
});
