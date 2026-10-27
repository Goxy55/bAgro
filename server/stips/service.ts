import { createHash, randomUUID } from "node:crypto";
import { db, transaction, Conn, Row } from "../db.js";
import { extractDocument, EXTRACTOR_VERSION } from "./extract.js";
import {
  Metadata,
  metadataSchema,
  PriceDraft,
  priceDraftSchema,
  publicationIssues,
  RawTable,
  TableMapping,
  mappedRows,
} from "./schema.js";
export async function stipsAudit(
  tx: Conn,
  actor: string,
  action: string,
  entity: string,
  metadata: any = {},
) {
  await tx.query(
    "INSERT INTO audit_log(id,farm_id,user_id,action,entity,metadata) VALUES($1,NULL,$2,$3,$4,$5)",
    [randomUUID(), actor, action, entity, JSON.stringify(metadata)],
  );
}
interface DocumentRow extends Row {
  published_at: string | null;
  period_start: string | null;
  period_end: string | null;
  terms_confirmed: boolean;
  terms_note: string;
}
export async function documentById(
  id: string,
  conn: Conn = db,
  withContent = false,
) {
  const doc = (
    await conn.query<DocumentRow>(
      `SELECT id,sha256,filename,title,mime,source_url,published_at::text,period_start::text,period_end::text,terms_confirmed,terms_note,received_at,received_by,extracted_at,extractor_version,extraction_status,text_content,tables,pages,extraction_warnings${withContent ? ",content" : ""} FROM stips_documents WHERE id=$1`,
      [id],
    )
  ).rows[0];
  if (!doc) throw Error("STIPS dokument nije pronađen.");
  return doc;
}
export async function addCandidate(
  tx: Conn,
  documentId: string,
  c: any,
  actor: string,
  origin = "auto",
) {
  return (
    await tx.query(
      "INSERT INTO stips_rows(id,document_id,source_key,origin,page,table_index,source_row,source_column,raw_cells,raw_quote,draft,issues,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT(document_id,source_key) DO NOTHING RETURNING id",
      [
        randomUUID(),
        documentId,
        c.sourceKey,
        origin,
        c.page,
        c.tableIndex ?? null,
        c.sourceRow ?? null,
        c.sourceColumn ?? null,
        JSON.stringify(c.cells || []),
        c.quote,
        JSON.stringify(c.draft),
        JSON.stringify(c.issues || []),
        actor,
      ],
    )
  ).rows[0];
}
export async function ingestDocument(
  bytes: Buffer,
  mime: "application/pdf" | "text/html",
  filename: string,
  metadata: Metadata,
  actor: string,
) {
  const meta = metadataSchema.parse(metadata),
    hash = createHash("sha256").update(bytes).digest("hex");
  const existing = (
    await db.query("SELECT id FROM stips_documents WHERE sha256=$1", [hash])
  ).rows[0];
  if (existing) return { id: existing.id, duplicate: true, createdRows: 0 };
  const result = await extractDocument(bytes, mime),
    documentId = randomUUID();
  return transaction(async (tx) => {
    const inserted = (
      await tx.query(
        "INSERT INTO stips_documents(id,sha256,filename,title,mime,content,source_url,published_at,period_start,period_end,terms_confirmed,terms_note,received_by,extracted_at,extractor_version,extraction_status,text_content,tables,pages,extraction_warnings) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,now(),$14,$15,$16,$17,$18,$19) ON CONFLICT(sha256) DO NOTHING RETURNING id",
        [
          documentId,
          hash,
          filename.slice(0, 200),
          meta.title,
          mime,
          bytes,
          meta.sourceUrl,
          meta.publishedAt,
          meta.periodStart,
          meta.periodEnd,
          meta.termsConfirmed,
          meta.termsNote,
          actor,
          EXTRACTOR_VERSION,
          result.status,
          result.text,
          JSON.stringify(result.tables),
          result.pages,
          JSON.stringify(result.warnings),
        ],
      )
    ).rows[0];
    if (!inserted)
      return {
        id: (
          await tx.query("SELECT id FROM stips_documents WHERE sha256=$1", [
            hash,
          ])
        ).rows[0].id,
        duplicate: true,
        createdRows: 0,
      };
    for (const c of result.candidates)
      await addCandidate(tx, documentId, c, actor);
    await stipsAudit(tx, actor, "stips_import", documentId, {
      hash,
      rows: result.candidates.length,
      mime,
    });
    return {
      id: documentId,
      duplicate: false,
      createdRows: result.candidates.length,
    };
  });
}
export async function updateMetadata(
  documentId: string,
  metadata: Metadata,
  actor: string,
) {
  const m = metadataSchema.parse(metadata);
  return transaction(async (tx) => {
    const previous = await documentById(documentId, tx);
    await tx.query(
      "UPDATE stips_documents SET title=$1,source_url=$2,published_at=$3,period_start=$4,period_end=$5,terms_confirmed=$6,terms_note=$7 WHERE id=$8",
      [
        m.title,
        m.sourceUrl,
        m.publishedAt,
        m.periodStart,
        m.periodEnd,
        m.termsConfirmed,
        m.termsNote,
        documentId,
      ],
    );
    await stipsAudit(tx, actor, "stips_metadata", documentId, {
      previous: {
        source: previous.source_url,
        published: previous.published_at,
        start: previous.period_start,
        end: previous.period_end,
        terms: previous.terms_confirmed,
      },
      next: m,
    });
  });
}
export async function applyMapping(
  documentId: string,
  mapping: TableMapping,
  actor: string,
) {
  return transaction(async (tx) => {
    await tx.query("SELECT id FROM stips_documents WHERE id=$1 FOR UPDATE", [
      documentId,
    ]);
    const doc = await documentById(documentId, tx),
      tables = doc.tables as RawTable[];
    const table = tables[mapping.tableIndex];
    if (!table) throw Error("Tabela nije pronađena.");
    const reviewed = (
      await tx.query(
        "SELECT id FROM stips_rows WHERE document_id=$1 AND table_index=$2 AND (edited=true OR published IS NOT NULL)",
        [documentId, mapping.tableIndex],
      )
    ).rows;
    if (reviewed.length)
      throw Error(
        "Tabela već ima ručno pregledane ili objavljene redove. Mapiranje ih ne prepisuje; nastavite pojedinačni pregled.",
      );
    const meta = {
      title: doc.title,
      sourceUrl: doc.source_url,
      publishedAt: doc.published_at,
      periodStart: doc.period_start,
      periodEnd: doc.period_end,
      termsConfirmed: doc.terms_confirmed,
      termsNote: doc.terms_note,
    };
    const proposed = mappedRows(table, mapping, meta);
    // Replace only untouched staging candidates. No approved observation or history is ever deleted.
    await tx.query(
      "DELETE FROM stips_rows WHERE document_id=$1 AND table_index=$2 AND edited=false AND published IS NULL",
      [documentId, mapping.tableIndex],
    );
    for (const c of proposed)
      await addCandidate(tx, documentId, c, actor, "mapped");
    await stipsAudit(tx, actor, "stips_map", documentId, {
      mapping,
      rows: proposed.length,
    });
    return { createdRows: proposed.length };
  });
}
export async function createManual(
  documentId: string,
  draft: PriceDraft,
  page: number,
  quote: string,
  actor: string,
) {
  const doc = await documentById(documentId);
  if (page > doc.pages || page < 1)
    throw Error("Stranica nije u opsegu dokumenta.");
  const row = await transaction(async (tx) => {
    const c = await addCandidate(
      tx,
      documentId,
      {
        sourceKey: `manual:${randomUUID()}`,
        page,
        quote,
        draft: priceDraftSchema.parse(draft),
        issues: ["Ručni unos sa originala — potrebna potvrda izvora."],
      },
      actor,
      "manual",
    );
    await stipsAudit(tx, actor, "stips_manual", c.id);
    return c;
  });
  return { id: row.id };
}
export async function editRow(
  rowId: string,
  draft: PriceDraft,
  quote: string,
  reason: string,
  actor: string,
) {
  return transaction(async (tx) => {
    const row = (
      await tx.query("SELECT * FROM stips_rows WHERE id=$1 FOR UPDATE", [rowId])
    ).rows[0];
    if (!row) throw Error("STIPS red nije pronađen.");
    const d = priceDraftSchema.parse(draft),
      doc = await documentById(row.document_id, tx);
    await tx.query(
      "INSERT INTO stips_row_history(id,row_id,action,previous_draft,previous_published,revision,reason,actor) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
      [
        randomUUID(),
        rowId,
        "draft_save",
        JSON.stringify(row.draft),
        row.published ? JSON.stringify(row.published) : null,
        row.revision,
        reason,
        actor,
      ],
    );
    await tx.query(
      "UPDATE stips_rows SET draft=$1,raw_quote=$2,issues=$3,edited=true,updated_by=$4,updated_at=now() WHERE id=$5",
      [
        JSON.stringify(d),
        quote,
        JSON.stringify(publicationIssues(d, doc)),
        actor,
        rowId,
      ],
    );
    await stipsAudit(tx, actor, "stips_draft", rowId, { reason });
  });
}
export async function publishRow(rowId: string, reason: string, actor: string) {
  return transaction(async (tx) => {
    const row = (
      await tx.query("SELECT * FROM stips_rows WHERE id=$1 FOR UPDATE", [rowId])
    ).rows[0];
    if (!row) throw Error("STIPS red nije pronađen.");
    const doc = await documentById(row.document_id, tx),
      draft = priceDraftSchema.parse(row.draft),
      issues = publicationIssues(draft, doc);
    if (!row.raw_quote.trim())
      issues.push("Nedostaje izvorni red ili citat za proveru.");
    if (issues.length) throw Error(issues.join("\n"));
    const published = {
      ...draft,
      periodStart: draft.periodStart || doc.period_start,
      periodEnd: draft.periodEnd || doc.period_end,
      geography: "Lokalno tržište / područje otkupa",
      sourceUrl: doc.source_url,
      documentId: doc.id,
      documentTitle: doc.title,
      documentHash: doc.sha256,
      sourcePublishedAt: doc.published_at,
      retrievedAt: doc.received_at,
      verifiedAt: new Date().toISOString(),
      verifiedBy: actor,
      page: row.page,
      sourceQuote: row.raw_quote,
      extractorVersion: doc.extractor_version,
    };
    const sort = (v: any): any =>
      v && typeof v === "object" && !Array.isArray(v)
        ? Object.fromEntries(
            Object.keys(v)
              .sort()
              .map((k) => [k, sort(v[k])]),
          )
        : Array.isArray(v)
          ? v.map(sort)
          : v;
    const equivalent = (p: any) => {
      const q = { ...p };
      delete q.verifiedAt;
      delete q.verifiedBy;
      return JSON.stringify(sort(JSON.parse(JSON.stringify(q))));
    };
    if (
      row.published &&
      !row.withdrawn &&
      equivalent(row.published) === equivalent(published)
    )
      return { revision: row.revision, unchanged: true };
    await tx.query(
      "INSERT INTO stips_row_history(id,row_id,action,previous_draft,previous_published,revision,reason,actor) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
      [
        randomUUID(),
        rowId,
        "publish",
        JSON.stringify(row.draft),
        row.published ? JSON.stringify(row.published) : null,
        row.revision,
        reason,
        actor,
      ],
    );
    await tx.query(
      "UPDATE stips_rows SET published=$1,revision=revision+1,withdrawn=false,edited=true,issues=$2,updated_by=$3,updated_at=now() WHERE id=$4",
      [JSON.stringify(published), "[]", actor, rowId],
    );
    await stipsAudit(tx, actor, "stips_publish", rowId, {
      reason,
      revision: row.revision + 1,
    });
    return { revision: row.revision + 1, unchanged: false };
  });
}
export async function withdrawRow(
  rowId: string,
  reason: string,
  actor: string,
) {
  return transaction(async (tx) => {
    const r = (
      await tx.query("SELECT * FROM stips_rows WHERE id=$1 FOR UPDATE", [rowId])
    ).rows[0];
    if (!r) throw Error("STIPS red nije pronađen.");
    await tx.query(
      "INSERT INTO stips_row_history(id,row_id,action,previous_draft,previous_published,revision,reason,actor) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
      [
        randomUUID(),
        rowId,
        "withdraw",
        JSON.stringify(r.draft),
        r.published ? JSON.stringify(r.published) : null,
        r.revision,
        reason,
        actor,
      ],
    );
    await tx.query(
      "UPDATE stips_rows SET withdrawn=true,updated_by=$1,updated_at=now() WHERE id=$2",
      [actor, rowId],
    );
    await stipsAudit(tx, actor, "stips_withdraw", rowId, { reason });
  });
}
export async function publishedPrices() {
  const rows = (
    await db.query(
      "SELECT id,published,revision FROM stips_rows WHERE published IS NOT NULL AND withdrawn=false ORDER BY published->>'periodEnd' DESC,id",
    )
  ).rows;
  const settings = (
    await db.query(
      "SELECT last_success_at,last_error,enabled,next_check_at FROM stips_crawler_settings WHERE id=1",
    )
  ).rows[0];
  return {
    prices: rows.map((r) => ({
      id: r.id,
      ...r.published,
      revision: r.revision,
      ageDays: Math.max(
        0,
        Math.floor((Date.now() - Date.parse(r.published.periodEnd)) / 86400000),
      ),
    })),
    source: { ...settings, automaticallyPublished: false },
    notice:
      "STIPS prikazuje konkretna lokalna tržišta. Ove cene nisu nacionalni godišnji proseci Srbije.",
  };
}
