import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { annualRzsDatasets, buildRzsImports } from "../server/rzs.js";
const args = process.argv.slice(2),
  index = args.indexOf("--archive");
if (index < 0 || !args[index + 1])
  throw Error(
    "Upotreba: npm run import:rzs -- --archive /putanja/do/RZS/paketa [--preview]",
  );
const directory = resolve(args[index + 1]),
  metadata = JSON.parse(
    await readFile(resolve(directory, "preuzimanje.json"), "utf8"),
  );
if (!Array.isArray(metadata))
  throw Error("Nedostaje evidencija originalnog preuzimanja.");
const imports = [];
for (const id of annualRzsDatasets) {
  const sources = metadata.filter((m) => m.id === id);
  if (sources.length !== 1) throw Error(`Nije jednoznačan izvor ${id}.`);
  imports.push(
    ...buildRzsImports(
      await readFile(resolve(directory, `${id}.json`)),
      sources[0],
    ),
  );
}
const out = resolve(process.env.RZS_PREVIEW_DIR || "data/rzs-priprema");
await mkdir(out, { recursive: true, mode: 0o700 });
await writeFile(
  resolve(out, "godisnje-nacionalne-serije.json"),
  JSON.stringify(imports, null, 2) + "\n",
  { mode: 0o600 },
);
const count = imports.reduce((n, p) => n + p.observations.length, 0);
console.log(
  `Provereno: ${imports.length} nacionalnih godišnjih serija, ${count} opažanja. Datum objave nije izmišljen.`,
);
if (!args.includes("--preview")) {
  const { importStatistics } = await import("../server/statistics.js"),
    { closeDatabase } = await import("../server/db.js");
  let changed = 0;
  try {
    for (const payload of imports)
      changed += (await importStatistics(payload, "operator:rzs-cli")).changed;
    console.log(
      `Uvezeno/izmenjeno opažanja: ${changed}. Privatni poslovni podaci i cenovnici nisu menjani.`,
    );
  } finally {
    await closeDatabase();
  }
} else console.log("Samo priprema; baza nije otvarana.");
