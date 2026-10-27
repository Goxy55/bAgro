import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { client, closeDatabase } from "../server/db.js";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
const directory = process.env.BACKUP_DIR || "./data/backups";
await mkdir(directory, { recursive: true, mode: 0o700 });
const filename = `${directory}/agro-${new Date().toISOString().replace(/[:.]/g, "-")}.${client instanceof PGlite ? "tar.gz" : "dump"}`;
if (client instanceof PGlite) {
  const dump = await client.dumpDataDir("gzip");
  await writeFile(filename, Buffer.from(await dump.arrayBuffer()), {
    mode: 0o600,
  });
} else {
  const u = new URL(process.env.DATABASE_URL!);
  execFileSync("pg_dump", ["--format=custom", "--file", filename], {
    env: {
      ...process.env,
      PGHOST: u.hostname,
      PGPORT: u.port || "5432",
      PGUSER: decodeURIComponent(u.username),
      PGPASSWORD: decodeURIComponent(u.password),
      PGDATABASE: u.pathname.slice(1),
      PGSSLMODE: process.env.DATABASE_SSL === "true" ? "verify-full" : "prefer",
    },
    stdio: ["ignore", "ignore", "inherit"],
  });
}
const bytes = await readFile(filename);
await writeFile(
  filename + ".sha256",
  createHash("sha256").update(bytes).digest("hex") + "\n",
  { mode: 0o600 },
);
await closeDatabase();
console.log(`Backup sa kontrolnom sumom: ${filename}`);
