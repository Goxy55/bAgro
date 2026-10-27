import { importSource } from "../server/importer.js";
import { closeDatabase } from "../server/db.js";
console.log(await importSource());
await closeDatabase();
