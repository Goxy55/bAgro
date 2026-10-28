import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { db, transaction, type Conn } from "../db.js";
import { date, dec, id } from "../validation.js";
import { D } from "../domain.js";
import {
  INPUT_PARSER,
  extractInputWorkbook,
  type InputReport,
} from "./extract.js";
import { inputSource } from "./source.js";

export async function inputAudit(
  conn: Conn,
  actor: string,
  action: string,
  entity: string,
  metadata: unknown = {},
) {
  await conn.query(
    "INSERT INTO audit_log(id,user_id,action,entity,metadata) VALUES($1,$2,$3,$4,$5)",
    [randomUUID(), actor, action, entity, JSON.stringify(metadata)],
  );
}
export async function ingestInput(
  bytes: Buffer,
  report: InputReport,
  pageTitle: string,
  fileUrl: string,
  actor: string,
  receivedAt?: string,
) {
  if (receivedAt) z.iso.datetime().parse(receivedAt);
  const sha = createHash("sha256").update(bytes).digest("hex");
  const parsed = extractInputWorkbook(bytes, report, pageTitle);
  return transaction(async (tx) => {
    const docId = randomUUID(),
      counts = {
        observations: parsed.cells.length,
        available: parsed.cells.filter((c) => c.status === "available").length,
        missing: parsed.cells.filter((c) => c.status === "missing").length,
        review: parsed.cells.filter((c) => c.status === "review").length,
      };
    const created = await tx.query(
      "INSERT INTO stips_input_documents(id,sha256,source_url,file_url,title,filename,content,category,period_start,period_end,received_by,parser_version,warnings,counts,received_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,COALESCE($15::timestamptz,now())) ON CONFLICT(sha256) DO NOTHING RETURNING id",
      [
        docId,
        sha,
        report.url,
        fileUrl,
        pageTitle || report.title,
        decodeURIComponent(new URL(fileUrl).pathname.split("/").at(-1)!),
        bytes,
        report.category,
        parsed.period.start,
        parsed.period.end,
        actor,
        INPUT_PARSER,
        JSON.stringify(parsed.warnings),
        JSON.stringify(counts),
        receivedAt || null,
      ],
    );
    if (!created.rows.length) {
      const existing = (
        await tx.query(
          "SELECT id,category,period_start::text FROM stips_input_documents WHERE sha256=$1",
          [sha],
        )
      ).rows[0];
      if (
        existing.category !== report.category ||
        existing.period_start !== parsed.period.start
      )
        throw Error(
          "Isti prilog ima neusaglašenu kategoriju ili period; potreban pregled.",
        );
      await inputAudit(tx, actor, "input_duplicate", existing.id, {
        sha256: sha,
      });
      return {
        id: existing.id,
        duplicate: true,
        counts,
        warnings: parsed.warnings,
      };
    }
    for (let offset = 0; offset < parsed.cells.length; offset += 500) {
      const rows = parsed.cells
        .slice(offset, offset + 500)
        .map((c) => ({ ...c, id: randomUUID(), raw: c.raw ?? null }));
      await tx.query(
        `INSERT INTO stips_input_prices(id,document_id,sheet,cell,product,manufacturer,packaging,place,price_rsd,raw_value,status)
        SELECT x.id::uuid,$1::uuid,x.sheet,x.cell,x.product,x.manufacturer,x.packaging,x.place,x.price::numeric,COALESCE(x.raw,'null'::jsonb),x.status
        FROM jsonb_to_recordset($2::jsonb) AS x(id text,sheet text,cell text,product text,manufacturer text,packaging text,place text,price text,raw jsonb,status text)`,
        [docId, JSON.stringify(rows)],
      );
    }
    await inputAudit(tx, actor, "input_import", docId, {
      sha256: sha,
      source: report.url,
      fileUrl,
      period: parsed.period,
      counts,
      warnings: parsed.warnings,
    });
    return { id: docId, duplicate: false, counts, warnings: parsed.warnings };
  });
}
export async function importInputReport(
  url: string,
  actor: string,
  source = inputSource,
) {
  const runId = randomUUID();
  await transaction(async (tx) => {
    await tx.query(
      "UPDATE stips_input_runs SET status='error',completed_at=now(),error='Prethodni posao je istekao; poslednji podaci su zadržani.' WHERE source_url=$1 AND status='running' AND started_at<now()-interval '5 minutes'",
      [url],
    );
    const inserted = await tx.query(
      "INSERT INTO stips_input_runs(id,source_url,actor,status) VALUES($1,$2,$3,'running') ON CONFLICT DO NOTHING RETURNING id",
      [runId, url, actor],
    );
    if (!inserted.rows.length) throw Error("Ovaj cenovnik se već preuzima.");
  });
  try {
    const r = await source.document(url),
      result = await ingestInput(
        r.bytes,
        r.report,
        r.pageTitle,
        r.fileUrl,
        actor,
      );
    await db.query(
      "UPDATE stips_input_runs SET status=$1,document_id=$2,completed_at=now() WHERE id=$3",
      [result.duplicate ? "duplicate" : "imported", result.id, runId],
    );
    return result;
  } catch (e) {
    await db.query(
      "UPDATE stips_input_runs SET status='error',completed_at=now(),error=$1 WHERE id=$2",
      [(e as Error).message.slice(0, 2000), runId],
    );
    throw e;
  }
}
export const inputReferenceSchema = z.object({
  observationId: id,
  unitsPerPrice: dec.refine(
    (v) => D(v).gt(0),
    "Osnova izvorne cene mora biti pozitivna.",
  ),
  date,
  confirmedProduct: z.literal(true),
  confirmedBasis: z.literal(true),
  allowHistorical: z.boolean(),
  note: z.string().trim().min(5).max(1000),
});
export type InputReference = z.infer<typeof inputReferenceSchema>;
export async function referencePrice(
  conn: Conn,
  ref: InputReference,
  unit: string,
  validFrom: string,
) {
  const r = (
    await conn.query(
      `SELECT p.*,p.price_rsd::text AS price_rsd,d.sha256,d.source_url,d.file_url,d.category,d.period_start::text,d.period_end::text,d.received_at,d.title FROM stips_input_prices p JOIN stips_input_documents d ON d.id=p.document_id WHERE p.id=$1`,
      [ref.observationId],
    )
  ).rows[0];
  if (
    !r ||
    r.status !== "available" ||
    r.price_rsd === null ||
    D(r.price_rsd).lte(0)
  )
    throw Error(
      "Izvorna vrednost nedostaje ili zahteva proveru; ne može se primeniti kao cena.",
    );
  if (!["kg", "t", "l", "kom", "sj", "biljka"].includes(unit))
    throw Error(
      "Izaberite potvrđenu jedinicu materijala pre izbora STIPS cene.",
    );
  if (ref.date < r.period_start || ref.date > r.period_end)
    throw Error("Datum vrednovanja/kursa mora pripadati mesecu izvorne cene.");
  if (r.period_end < validFrom && !ref.allowHistorical)
    throw Error(
      "Stariji izvor zahteva izričitu potvrdu istorijske referentne cene.",
    );
  const amount = D(r.price_rsd)
    .div(ref.unitsPerPrice)
    .toDecimalPlaces(12)
    .toString();
  return {
    amount,
    date: ref.date,
    snapshot: {
      kind: "stips_input",
      observationId: r.id,
      documentId: r.document_id,
      sha256: r.sha256,
      sourceUrl: r.source_url,
      fileUrl: r.file_url,
      title: r.title,
      category: r.category,
      sheet: r.sheet,
      cell: r.cell,
      product: r.product,
      manufacturer: r.manufacturer,
      packaging: r.packaging,
      place: r.place,
      originalPriceRsd: r.price_rsd,
      periodStart: r.period_start,
      periodEnd: r.period_end,
      retrievedAt: r.received_at,
      publicationDate: null,
      marketLevel: null,
      unitsPerPrice: ref.unitsPerPrice,
      unit,
      referenceDate: ref.date,
      note: ref.note,
      historicalAccepted: ref.allowHistorical,
      confirmedProduct: true,
      confirmedBasis: true,
      rounding:
        "Jedinična RSD cena: 12 decimala, ROUND_HALF_UP; izvorni iznos sačuvan bez promene.",
    },
  };
}
