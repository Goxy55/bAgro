import "dotenv/config";
import { PGlite } from "@electric-sql/pglite";
import { Pool } from "pg";
import { drizzle as embeddedDrizzle } from "drizzle-orm/pglite";
import { drizzle as pgDrizzle } from "drizzle-orm/node-postgres";
import { readFile, mkdir } from "node:fs/promises";
import lockfile from "proper-lockfile";
import * as schema from "./auth-schema.js";
export type Row = Record<string, any>;
export interface Conn {
  query<T extends Row = Row>(
    sql: string,
    params?: any[],
  ): Promise<{ rows: T[] }>;
}
const directory = process.env.DATA_DIR || "./data/postgres";
if (!process.env.DATABASE_URL) await mkdir(directory, { recursive: true });
const releaseLock = process.env.DATABASE_URL
  ? undefined
  : await lockfile
      .lock(directory, { stale: 10000, update: 5000, retries: 0 })
      .catch(() => {
        throw Error(
          "Lokalna PostgreSQL baza je već otvorena. Za CLI uvoz/admin/backup prvo zaustavite server. Ako je proces prekinut, sačekajte 10 sekundi i ponovite.",
        );
      });
export const client = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl:
        process.env.DATABASE_SSL === "true"
          ? { rejectUnauthorized: true }
          : undefined,
    })
  : new PGlite(directory);
export const orm =
  client instanceof Pool
    ? pgDrizzle(client, { schema })
    : embeddedDrizzle(client, { schema });
export const db = client as Conn;
export async function transaction<T>(fn: (tx: Conn) => Promise<T>): Promise<T> {
  if (client instanceof PGlite)
    return client.transaction((tx) => fn(tx as Conn));
  const tx = await client.connect();
  try {
    await tx.query("BEGIN");
    const x = await fn(tx);
    await tx.query("COMMIT");
    return x;
  } catch (e) {
    await tx.query("ROLLBACK");
    throw e;
  } finally {
    tx.release();
  }
}
export async function migrate() {
  await db.query(
    "CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz DEFAULT now())",
  );
  for (const name of [
    "001_initial",
    "002_stips",
    "003_stips_inputs",
    "004_statistic_provenance",
  ]) {
    if (
      (
        await db.query("SELECT name FROM schema_migrations WHERE name=$1", [
          name,
        ])
      ).rows.length
    )
      continue;
    await transaction(async (tx) => {
      const sql = await readFile(
        new URL(`../migrations/${name}.sql`, import.meta.url),
        "utf8",
      );
      if (client instanceof PGlite) await (tx as any).exec(sql);
      else await tx.query(sql);
      await tx.query("INSERT INTO schema_migrations(name) VALUES($1)", [name]);
    });
  }
}
await migrate();

export async function closeDatabase() {
  if (client instanceof PGlite) await client.close();
  else await client.end();
  if (releaseLock) await releaseLock();
}
