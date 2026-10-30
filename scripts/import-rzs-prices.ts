import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
const args = process.argv.slice(2);
if (args.length > 1)
  throw Error(
    "Upotreba: npm run import:rzs-prices -- [preuzeta-stranica.html]",
  );
const { db, transaction, closeDatabase } = await import("../server/db.js");
const { retrieveRzsPrices, ingestRzsPrices } =
  await import("../server/pricing/rzs-prices.js");
try {
  const bytes = args[0]
    ? await readFile(resolve(args[0]))
    : await retrieveRzsPrices();
  const result = await transaction((tx) =>
    ingestRzsPrices(tx, bytes, "operator:rzs-prices-import"),
  );
  console.log(JSON.stringify(result));
  console.log(
    "RZS otkupne cene su reference za pregled. Jedinice i primena kao cena inputa zahtevaju administratorovu potvrdu. Nije aktiviran cenovnik.",
  );
} finally {
  await closeDatabase();
}
