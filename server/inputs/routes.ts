import { Router } from "express";
import { z } from "zod";
import { db } from "../db.js";
import { id, date } from "../validation.js";
import { officialUrl } from "../stips/schema.js";
import { INPUTS_URL } from "./extract.js";
import { inputSource } from "./source.js";
import {
  importInputReport,
  inputAudit,
  inputReferenceSchema,
  referencePrice,
} from "./service.js";
export const adminInputPrices = Router();
adminInputPrices.get("/", async (_req, res) => {
  const documents = (
    await db.query(
      "SELECT id,sha256,source_url,file_url,title,filename,category,period_start::text,period_end::text,published_at::text,received_at,warnings,counts FROM stips_input_documents ORDER BY period_start DESC,received_at DESC",
    )
  ).rows;
  const runs = (
    await db.query(
      "SELECT * FROM stips_input_runs ORDER BY started_at DESC LIMIT 30",
    )
  ).rows;
  res.json({ documents, runs, listingUrl: INPUTS_URL });
});
adminInputPrices.post("/discover", async (req: any, res) => {
  const reports = await inputSource.listing(true);
  await inputAudit(db, req.user.id, "input_discovery", INPUTS_URL, {
    reports: reports.length,
  });
  res.json({
    reports,
    checkedAt: new Date().toISOString(),
    listingUrl: INPUTS_URL,
  });
});
adminInputPrices.post("/import", async (req: any, res) => {
  const b = z.object({ url: officialUrl }).parse(req.body);
  res.json(await importInputReport(b.url, req.user.id));
});
adminInputPrices.get("/prices", async (req, res) => {
  const q = z
    .object({
      year: z.coerce.number().int().min(2000).max(2100).optional(),
      category: z.enum(["pesticidi", "djubriva", "seme"]).optional(),
      place: z.string().max(100).optional(),
      documentId: id.optional(),
      q: z.string().max(200).default(""),
      status: z.enum(["available", "missing", "review"]).optional(),
      page: z.coerce.number().int().min(1).max(10000).default(1),
    })
    .parse(req.query);
  const params: any[] = [],
    clauses: string[] = [];
  const where = (sql: string, value: any) => {
    params.push(value);
    clauses.push(sql.replace("?", "$" + params.length));
  };
  if (q.year) where("EXTRACT(YEAR FROM d.period_start)=?", q.year);
  if (q.category) where("d.category=?", q.category);
  if (q.place) where("p.place=?", q.place);
  if (q.documentId) where("d.id=?", q.documentId);
  if (q.status) where("p.status=?", q.status);
  if (q.q)
    where(
      "(p.product || ' ' || p.manufacturer || ' ' || p.packaging || ' ' || p.sheet) ILIKE ?",
      "%" + q.q.replace(/[\\%_]/g, "\\$&") + "%",
    );
  const from =
    " FROM stips_input_prices p JOIN stips_input_documents d ON d.id=p.document_id" +
    (clauses.length ? " WHERE " + clauses.join(" AND ") : "");
  const total = Number(
    (await db.query("SELECT COUNT(*) AS n" + from, params)).rows[0].n,
  );
  const rows = (
    await db.query(
      "SELECT p.id,p.document_id,p.sheet,p.cell,p.product,p.manufacturer,p.packaging,p.place,p.price_rsd::text,p.raw_value,p.status,d.source_url,d.file_url,d.sha256,d.category,d.period_start::text,d.period_end::text,d.published_at::text,d.received_at,d.title,d.warnings,'RSD' AS currency,'dominantna cena' AS price_type,NULL AS market_level" +
        from +
        " ORDER BY d.period_start DESC,p.product,p.packaging,p.place,p.id LIMIT 100 OFFSET $" +
        (params.length + 1),
      [...params, (q.page - 1) * 100],
    )
  ).rows;
  const places = (
    await db.query(
      "SELECT DISTINCT place FROM stips_input_prices ORDER BY place",
    )
  ).rows.map((r) => r.place);
  res.json({ rows, total, page: q.page, pageSize: 100, places });
});
adminInputPrices.get("/documents/:id/file", async (req: any, res) => {
  const r = (
    await db.query(
      "SELECT content,filename FROM stips_input_documents WHERE id=$1",
      [id.parse(req.params.id)],
    )
  ).rows[0];
  if (!r) return res.status(404).json({ error: "Cenovnik nije pronađen." });
  await inputAudit(db, req.user.id, "input_original_read", req.params.id);
  const ext = /\.xlsx$/i.test(r.filename) ? "xlsx" : "xls";
  res.setHeader(
    "Content-Type",
    ext === "xlsx"
      ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      : "application/vnd.ms-excel",
  );
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="stips-inputi.${ext}"; filename*=UTF-8''${encodeURIComponent(r.filename)}`,
  );
  res.send(Buffer.from(r.content));
});
adminInputPrices.post("/reference", async (req, res) => {
  const b = z
    .object({
      reference: inputReferenceSchema,
      unit: z.string().max(30),
      validFrom: date,
    })
    .parse(req.body);
  res.json(await referencePrice(db, b.reference, b.unit, b.validFrom));
});
