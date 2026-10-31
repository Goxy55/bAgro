import { writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import {
  PublicPriceReader,
  parsePublicProduct,
  type PublicSourceId,
} from "../server/pricing/public-sources.js";
import { D } from "../server/domain.js";
const samples: [PublicSourceId, string][] = [
  ["ratar", "https://www.ratar.rs/sekator-150-ml"],
  [
    "poljokomerc",
    "https://poljokomerc.rs/proizvod/sekator-od-150ml-poljokomerc/",
  ],
  [
    "hemoslavija",
    "https://www.hemoslavijaprodavnica.com/detail.php?artsif=7273",
  ],
];
const reader = new PublicPriceReader(),
  results: any[] = [];
try {
  for (const [id, url] of samples) {
    try {
      const r = await reader.read(id, url),
        p = parsePublicProduct(id, r.bytes, r.url);
      results.push({
        source: id,
        url: r.url,
        checkedAt: new Date().toISOString(),
        http: r.status,
        sha256: createHash("sha256").update(r.bytes).digest("hex"),
        product: p.name,
        priceRsd: p.price,
        packageQuantity: p.packageQuantity,
        unit: p.unit,
        unitPriceRsd:
          p.price && p.packageQuantity
            ? D(p.price).div(p.packageQuantity).toString()
            : null,
        availability: p.availability,
        priceBasis: p.basis,
        composition: p.composition,
      });
    } catch (e) {
      results.push({
        source: id,
        url,
        error: (e as Error).message,
        checkedAt: new Date().toISOString(),
      });
    }
  }
} finally {
  await reader.close();
}
const path = "source/public-price-audit-2026-10-31.json";
await writeFile(
  path,
  JSON.stringify(
    {
      purpose:
        "Provera strukture javnih cenovnika; nije nacionalni prosek, preporuka zaštite bilja ili aktivan cenovnik.",
      method:
        "Javni GET posle robots.txt; bez naloga, kupovine i kontaktiranja prodavaca. Cena registrovanih kupaca se ne koristi.",
      results,
    },
    null,
    2,
  ) + "\n",
);
console.log(
  JSON.stringify({
    path,
    verified: results.filter((r) => r.http === 200).length,
    failures: results
      .filter((r) => r.error)
      .map((r) => ({ source: r.source, error: r.error })),
  }),
);
