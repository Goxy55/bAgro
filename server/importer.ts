import { readFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { db, transaction } from "./db.js";
export async function importSource() {
  const inventory = JSON.parse(await readFile("source/inventory.json", "utf8"));
  const hash = createHash("sha256")
    .update(await readFile("source/izvor-2017.xlsx"))
    .digest("hex");
  if (hash !== inventory.sha256)
    throw Error("Original se ne slaže sa inventarom. Ponovite ekstrakciju.");
  if (
    (await db.query("SELECT hash FROM source_imports WHERE hash=$1", [hash]))
      .rows.length
  )
    return { imported: false, cards: inventory.cards.length };
  await transaction(async (tx) => {
    await tx.query(
      "INSERT INTO source_imports(hash,name,inventory) VALUES($1,$2,$3)",
      [
        hash,
        inventory.name,
        JSON.stringify({
          fixtures: inventory.fixtures,
          issues: inventory.issues,
        }),
      ],
    );
    for (const s of inventory.sheets)
      await tx.query(
        "INSERT INTO source_sheets(id,source_hash,original_name,position,role,inventory) VALUES($1,$2,$3,$4,$5,$6)",
        [`s${s.index}`, hash, s.name, s.index, s.role, JSON.stringify(s)],
      );
    for (const c of inventory.cards) {
      await tx.query(
        "INSERT INTO templates(id,sheet_id,name,basis,reference,intensity,model) VALUES($1,$2,$3,$4,$5,$6,$7)",
        [
          c.id,
          `s${inventory.sheets.find((s: any) => s.name === c.sheet).index}`,
          c.name,
          c.basis,
          c.reference,
          c.intensity || null,
          JSON.stringify(c),
        ],
      );
      await tx.query(
        "INSERT INTO norm_versions(id,template_id,name,status,valid_from,valid_to,author,reason,model) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        [
          randomUUID(),
          c.id,
          inventory.name,
          "archive",
          "2017-01-01",
          "2017-12-31",
          "Izvorni Excel",
          "Veran arhivski uvoz, nije odobren cenovnik.",
          JSON.stringify(c),
        ],
      );
    }
  });
  return { imported: true, cards: inventory.cards.length };
}
