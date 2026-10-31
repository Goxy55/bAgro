import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";

// Read source declarations only. No workbook formulas are evaluated here.
const inventory = JSON.parse(await readFile("source/inventory.json", "utf8"));
const hash = createHash("sha256")
  .update(await readFile("source/izvor-2017.xlsx"))
  .digest("hex");
if (hash !== inventory.sha256)
  throw Error("Inventar ne odgovara originalnom Excelu.");
const references = new Map<
  string,
  { sheet: string; cell: string; formula: string }[]
>();
const summaries: { sheet: string; cell: string; formula: string }[] = [];
for (const sheet of inventory.sheets) {
  const cells = new Map<string, any>(sheet.cells.map((c: any) => [c.cell, c]));
  for (const entry of sheet.cells) {
    if (
      typeof entry.original !== "string" ||
      entry.original.trim().toLowerCase() !== "potrošnja goriva"
    )
      continue;
    const row = entry.cell.match(/\d+$/)[0],
      cell = "E" + row,
      formula = cells.get(cell)?.formula;
    if (typeof formula !== "string" || !/^=E\d+(?:\+E\d+)*$/.test(formula))
      throw Error(
        `${sheet.name}!${cell}: neprepoznata deklaracija potrošnje goriva.`,
      );
    const source = { sheet: sheet.name, cell, formula };
    summaries.push(source);
    for (const ref of formula.match(/E\d+/g)!) {
      const key = sheet.name + "!" + ref;
      references.set(key, [...(references.get(key) || []), source]);
    }
  }
}
const items: any[] = [],
  unresolved: any[] = [];
const used = new Set<string>();
for (const card of inventory.cards)
  for (const item of card.items) {
    const key = card.sheet + "!" + item.quantityCell,
      evidence = references.get(key);
    const record = {
      templateId: card.id,
      itemId: item.id,
      sheet: card.sheet,
      name: item.name,
      quantityCell: item.quantityCell,
    };
    if (evidence) {
      used.add(key);
      items.push({ ...record, summaryCells: evidence.map((e) => e.cell) });
    } else if (String(item.unit).includes("goriva/usluga"))
      unresolved.push(record);
  }
const missingReferences = [...references.keys()].filter(
  (key) => !used.has(key),
);
const audit = {
  sourceHash: hash,
  method:
    "Izričite reference iz izvornih formula Potrošnja goriva; cena nije kriterijum klasifikacije.",
  summaries,
  items,
  unresolved,
  missingReferences,
};
await writeFile(
  "source/fuel-operations.json",
  JSON.stringify(audit, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    summaries: summaries.length,
    verified: items.length,
    unresolved: unresolved.length,
    missingReferences,
  }),
);
