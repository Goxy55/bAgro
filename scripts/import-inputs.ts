import { writeFile, mkdir, readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { z } from "zod";
import { db, closeDatabase } from "../server/db.js";
import { inputSource } from "../server/inputs/source.js";
import { importInputReport, ingestInput } from "../server/inputs/service.js";
import { officialUrl } from "../server/stips/schema.js";
const args = process.argv.slice(2),
  archiveIndex = args.indexOf("--archive");
const fromArchive = archiveIndex >= 0 ? args[archiveIndex + 1] : undefined;
if (archiveIndex >= 0 && !fromArchive)
  throw Error("Nedostaje putanja posle --archive.");
if (archiveIndex >= 0) args.splice(archiveIndex, 2);
const years = args.map(Number);
if (
  !years.length ||
  years.some((y) => !Number.isInteger(y) || y < 2009 || y > 2100)
)
  throw Error(
    "Upotreba: npm run import:inputs -- 2024 2025 2026. Za PGlite prvo zaustavite server.",
  );
const actor = "operator:stips-inputi-cli";
const archive = resolve(process.env.STIPS_ARCHIVE_DIR || "data/stips-inputi");
await mkdir(archive, { recursive: true, mode: 0o700 });
let failed = 0;
try {
  if (fromArchive) {
    const directory = resolve(fromArchive),
      manifestPath = resolve(directory, "izvori.json");
    if ((await stat(manifestPath)).size > 2 * 1024 * 1024)
      throw Error("Manifest je prevelik.");
    const manifest = z
      .object({
        documents: z
          .array(
            z.object({
              sha256: z.string().regex(/^[a-f0-9]{64}$/),
              source_url: officialUrl,
              file_url: officialUrl,
              title: z.string().max(300),
              category: z.enum(["pesticidi", "djubriva", "seme"]),
              period_start: z.iso.date(),
              received_at: z.iso.datetime(),
              localFile: z.string().regex(/^originali\/[a-f0-9-]+\.xlsx?$/),
            }),
          )
          .max(200),
      })
      .parse(JSON.parse(await readFile(manifestPath, "utf8")));
    for (const doc of manifest.documents.filter((d) =>
      years.includes(Number(d.period_start.slice(0, 4))),
    )) {
      const filename = resolve(directory, doc.localFile);
      if ((await stat(filename)).size > 8 * 1024 * 1024)
        throw Error("Prilog je prevelik.");
      const bytes = await readFile(filename);
      if (createHash("sha256").update(bytes).digest("hex") !== doc.sha256)
        throw Error(`SHA-256 nije usaglašen: ${doc.localFile}`);
      const report = {
        url: doc.source_url,
        title: doc.title,
        year: Number(doc.period_start.slice(0, 4)),
        month: Number(doc.period_start.slice(5, 7)),
        category: doc.category,
      };
      const result = await ingestInput(
        bytes,
        report,
        doc.title,
        doc.file_url,
        actor,
        doc.received_at,
      );
      console.log(
        `${result.duplicate ? "Već postoji" : "Uvezeno iz arhive"}: ${doc.title} — ${result.counts.available} brojčanih cena.`,
      );
    }
    console.log(
      "Provereni arhivski originali su uvezeni. Nije izvršena nova mrežna provera niti aktiviranje normativa.",
    );
  } else {
    const all = await inputSource.listing(true),
      reports = all.filter((r) => years.includes(r.year));
    if (!reports.length) throw Error("Arhiva nema objave za izabrane godine.");
    console.log(
      `Pronađeno cenovnika: ${reports.length}. Godine: ${years.join(", ")}.`,
    );
    for (const r of reports) {
      try {
        const result = await importInputReport(r.url, actor);
        const doc = (
          await db.query(
            "SELECT filename,content,sha256,source_url,file_url,period_start::text,period_end::text,counts,warnings FROM stips_input_documents WHERE id=$1",
            [result.id],
          )
        ).rows[0];
        const { content, ...metadata } = doc;
        // Use the generated ID in the local name; never trust a remote filename as a path.
        const ext = /\.xlsx$/i.test(doc.filename) ? "xlsx" : "xls";
        await writeFile(
          resolve(archive, `${result.id}.${ext}`),
          Buffer.from(content),
          { mode: 0o600 },
        );
        await writeFile(
          resolve(archive, `${result.id}.json`),
          JSON.stringify(metadata, null, 2) + "\n",
          { mode: 0o600 },
        );
        console.log(
          `${result.duplicate ? "Već postoji" : "Uvezeno"}: ${r.title} — ${result.counts.available} brojčanih cena; za proveru ${result.counts.review}.`,
        );
      } catch (e) {
        failed++;
        console.error(`Neuspeh ${r.url}: ${(e as Error).message}`);
      }
    }
    console.log(
      `Završeno. Neuspelih izvora: ${failed}. Originali su u privatnom folderu ${archive}. Normativi nisu aktivirani.`,
    );
  }
} finally {
  await closeDatabase();
}
if (failed) process.exitCode = 1;
