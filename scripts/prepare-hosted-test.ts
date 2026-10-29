import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
if (!process.env.DATABASE_URL)
  throw Error(
    "Priprema hostovane testne verzije zahteva zaseban PostgreSQL (DATABASE_URL).",
  );
const { db, closeDatabase } = await import("../server/db.js");
const { importSource } = await import("../server/importer.js");
async function run(script: string, args: string[] = []) {
  const child = spawn(process.execPath, ["--import", "tsx", script, ...args], {
    env: process.env,
    stdio: "inherit",
  });
  await new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0
        ? resolve()
        : reject(Error(`Priprema ${script} nije završena.`)),
    );
  });
}
try {
  await importSource();
  if (process.env.SEED_PUBLIC_REFERENCES !== "true")
    console.log(
      "Baza i arhivski katalog spremni; automatska priprema javnih izvora nije uključena.",
    );
  else {
    const completed = new Set(
      (
        await db.query(
          "SELECT entity FROM audit_log WHERE action='hosted_reference_seed'",
        )
      ).rows.map((r) => r.entity),
    );
    const year = new Date().getUTCFullYear();
    for (const stage of [
      {
        id: "RZS-initial",
        run: async () => {
          await run("scripts/collect-rzs.ts");
          await run("scripts/import-rzs.ts", ["--archive", "data/rzs"]);
        },
      },
      {
        id: "STIPS-inputs-initial",
        run: () =>
          run("scripts/import-inputs.ts", [
            String(year - 2),
            String(year - 1),
            String(year),
          ]),
      },
    ]) {
      if (completed.has(stage.id)) {
        console.log(
          `${stage.id}: javni podaci su već pripremljeni; nema automatskog osvežavanja pri svakom deploy-u.`,
        );
        continue;
      }
      try {
        await stage.run();
        await db.query(
          "INSERT INTO audit_log(id,user_id,action,entity,metadata) VALUES($1,'operator:hosted-setup','hosted_reference_seed',$2,$3)",
          [randomUUID(), stage.id, JSON.stringify({ completed: true })],
        );
      } catch {
        console.error(
          `${stage.id}: izvor trenutno nije pripremljen. Prethodni provereni podaci su sačuvani; aplikacija može raditi uz prazno/nepotpuno stanje. Proverite prethodni zapis i ponovite uvoz kroz administraciju ili Shell.`,
        );
      }
    }
  }
  console.log(
    "Priprema završena. Nisu kreirani korisnici, privatna gazdinstva, sintetičke cene, kursevi ili aktivni normativi.",
  );
} finally {
  await closeDatabase();
}
