import "dotenv/config";
import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const file = process.env.RESTORE_FILE,
  target = process.env.RESTORE_DATA_DIR;
if (!file || !target)
  throw Error(
    "Postavite RESTORE_FILE i novi prazni RESTORE_DATA_DIR. Postojeća baza se ne prepisuje.",
  );
const bytes = await readFile(file),
  expected = (await readFile(file + ".sha256", "utf8")).trim();
if (createHash("sha256").update(bytes).digest("hex") !== expected)
  throw Error("Kontrolna suma backup-a nije ispravna.");
await mkdir(target, { recursive: true });
if ((await readdir(target)).length)
  throw Error("Odredište nije prazno. Koristite novi direktorijum.");
const db = new PGlite({ dataDir: target, loadDataDir: new Blob([bytes]) });
await db.waitReady;
const counts = await db.query("SELECT COUNT(*) AS n FROM farms");
await db.close();
await writeFile(
  `${target}.restore-verified.json`,
  JSON.stringify({
    restoredAt: new Date().toISOString(),
    sha256: expected,
    farms: counts.rows,
  }),
  { mode: 0o600 },
);
console.log(
  "Baza je vraćena i pročitana u novom direktorijumu. Podesite DATA_DIR na tu putanju i pokrenite server.",
);
