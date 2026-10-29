import { z } from "zod";
import { createHash } from "node:crypto";
import { D } from "./domain.js";
import type { StatisticImport } from "./statistics.js";

export const annualRzsDatasets = ["130102IND01", "1302020101IND01"] as const;
export const rzsMetadata = z.object({
  id: z.enum(annualRzsDatasets),
  title: z.string().min(1),
  jsonUrl: z.url().refine((s) => {
    const u = new URL(s);
    return (
      u.protocol === "https:" &&
      u.hostname === "opendata.stat.gov.rs" &&
      !u.username &&
      !u.password &&
      !u.port
    );
  }),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  recordCount: z.number().int().positive(),
  actualRecords: z.number().int().positive(),
  updatedAt: z.string(),
  retrievedAt: z.string().refine((s) => Number.isFinite(Date.parse(s))),
});
const latin: Record<string, string> = {
  А: "A",
  Б: "B",
  В: "V",
  Г: "G",
  Д: "D",
  Ђ: "Đ",
  Е: "E",
  Ж: "Ž",
  З: "Z",
  И: "I",
  Ј: "J",
  К: "K",
  Л: "L",
  Љ: "Lj",
  М: "M",
  Н: "N",
  Њ: "Nj",
  О: "O",
  П: "P",
  Р: "R",
  С: "S",
  Т: "T",
  Ћ: "Ć",
  У: "U",
  Ф: "F",
  Х: "H",
  Ц: "C",
  Ч: "Č",
  Џ: "Dž",
  Ш: "Š",
};
for (const [c, l] of Object.entries(latin))
  latin[c.toLowerCase()] = l.toLowerCase();
export const serbianLatin = (s: string) =>
  [...s].map((c) => latin[c] ?? c).join("");
const statuses: Record<
  string,
  StatisticImport["observations"][number]["status"]
> = {
  A: "konačan",
  P: "prethodan",
  R: "revidiran",
  K: "ispravljen",
  O: "nedostaje podatak",
  M: "neprimenljiv",
  N: "nije značajna",
};
export function rzsDate(s: string) {
  const m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})\.$/);
  if (!m) throw Error("Datum ažuriranja RZS skupa nije prepoznat.");
  const result = `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  if (
    !Number.isFinite(Date.parse(result)) ||
    new Date(result).toISOString().slice(0, 10) !== result
  )
    throw Error("Neispravan datum RZS skupa.");
  return result;
}
const rowSchema = z.object({
  idindikator: z.string(),
  IDTer: z.string(),
  nTer: z.string(),
  mes: z.literal("00"),
  god: z.string().regex(/^\d{4}$/),
  vrednost: z.number().finite().nonnegative().nullable(),
  IDStatusPodatka: z.string(),
  nStatusPodatka: z.string(),
  IDVrPod: z.number().int(),
  nVrPod: z.string(),
  IDProizvod: z.string().optional(),
  nProizvod: z.string().optional(),
  IDPoljProizvod: z.string().optional(),
  nPoljProizvod: z.string().optional(),
  idJedinicaMere: z.string().nullable(),
  nJedinicaMere: z.string().nullable(),
});
export function buildRzsImports(
  bytes: Buffer,
  metadata: unknown,
): StatisticImport[] {
  const meta = rzsMetadata.parse(metadata);
  if (bytes.length > 32 * 1024 * 1024) throw Error("RZS izvod prelazi 32 MB.");
  if (createHash("sha256").update(bytes).digest("hex") !== meta.sha256)
    throw Error("RZS original ne odgovara SHA-256 kontroli.");
  // Preserve source decimal literals; never round official values through a JS double.
  const exactValues: (string | null)[] = [];
  const parsed = JSON.parse(
    bytes.toString("utf8").replace(/^\uFEFF/, ""),
    function (key, value, ...extra: any[]) {
      if (key === "vrednost") {
        if (value === null) exactValues.push(null);
        else {
          const source = extra[0]?.source;
          if (typeof value !== "number" || typeof source !== "string")
            throw Error(
              "RZS izvod zahteva JSON broj i podršku runtime-a za izvorni decimalni zapis.",
            );
          exactValues.push(D(source).toFixed());
        }
      }
      return value;
    },
  );
  const rows = z.array(rowSchema).parse(parsed);
  if (exactValues.length !== rows.length)
    throw Error(
      "Izvorne decimalne vrednosti nisu jednoznačno povezane sa redovima.",
    );
  if (rows.length !== meta.recordCount || rows.length !== meta.actualRecords)
    throw Error(
      "Broj redova ne odgovara RZS katalogu; moguća nepotpuna datoteka.",
    );
  const updated = rzsDate(meta.updatedAt),
    imports = new Map<string, StatisticImport>();
  const seen = new Set<string>();
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (r.idindikator !== meta.id)
      throw Error("Izvod sadrži drugi RZS pokazatelj.");
    if (r.IDTer !== "RS") continue; // Keep regional originals in the archive, outside national series.
    if (r.nTer !== "РЕПУБЛИКА СРБИЈА")
      throw Error("Šifra RS nema potvrđen nacionalni naziv teritorije.");
    const plant = meta.id === "130102IND01",
      productId = plant ? r.IDProizvod : r.IDPoljProizvod,
      rawProduct = plant ? r.nProizvod : r.nPoljProizvod;
    if (!productId || !rawProduct)
      throw Error("Nedostaje šifra ili naziv proizvoda.");
    let unit: string, indicator: string;
    if (plant) {
      const expected: Record<
        number,
        { unit: string; indicator: string; label: string }
      > = {
        1: {
          unit: "ha",
          indicator: "Površina",
          label: "пожњевена површина, ha / родна површина, ha",
        },
        2: { unit: "t", indicator: "Proizvodnja", label: "укупан принос, t" },
        3: { unit: "t/ha", indicator: "Prinos", label: "принос, t/ha" },
      };
      const v = expected[r.IDVrPod];
      if (!v || r.nVrPod !== v.label)
        throw Error(
          "Nepoznata ili promenjena osnova biljnog pokazatelja; potreban pregled.",
        );
      unit = v.unit;
      indicator = v.indicator;
    } else {
      if (
        r.idJedinicaMere !== "THS" ||
        r.nJedinicaMere !== "хиљада" ||
        r.IDVrPod < 1 ||
        r.IDVrPod > 7
      )
        throw Error("Nepoznata jedinica/osnova bilansa stoke.");
      unit = "hiljada grla";
      indicator = serbianLatin(r.nVrPod);
    }
    const status = statuses[r.IDStatusPodatka];
    if (!status) throw Error("Nepoznat izvorni status; potreban pregled.");
    if (["O", "M", "N"].includes(r.IDStatusPodatka) && r.vrednost !== null)
      throw Error("Status nedostajućeg podatka sadrži iznos.");
    if (["A", "P", "R", "K"].includes(r.IDStatusPodatka) && r.vrednost === null)
      throw Error("Brojčani status nema vrednost; potreban pregled.");
    const key = `RZS-${meta.id}-RS-${productId}-${r.IDVrPod}`;
    const rowKey = key + ":" + r.god;
    if (seen.has(rowKey))
      throw Error(
        "Ponovljen nacionalni podatak za isti proizvod, pokazatelj i godinu.",
      );
    seen.add(rowKey);
    const product = serbianLatin(rawProduct),
      mapping = JSON.stringify({
        dataset: meta.id,
        territory: "RS",
        productField: plant ? "IDProizvod" : "IDPoljProizvod",
        productId,
        IDVrPod: r.IDVrPod,
        mes: "00",
        unit,
      });
    let payload = imports.get(key);
    if (!payload) {
      payload = {
        source: {
          id: `RZS-${meta.id}`,
          name: `RZS — ${serbianLatin(meta.title)}`,
          url: meta.jsonUrl,
          terms:
            "RZS otvoreni podaci: besplatna ponovna upotreba uz izvor, datum preuzimanja i opis izmena. Izmena: latinica, samo RS, izdvojeni godišnji pokazatelji; bez preračuna vrednosti.",
        },
        series: {
          id: key,
          product,
          indicator,
          unit,
          geography: "Srbija",
          currency: null,
          priceType: null,
          sourceUrl: meta.jsonUrl,
          mapping,
          definition: `RZS: ${serbianLatin(meta.title)}. ${serbianLatin(r.nVrPod)}. Teritorija RS; nacionalni podatak, bez automatskog izjednačavanja sa gazdinstvom.`,
        },
        observations: [],
      };
      imports.set(key, payload);
    }
    if (payload.series.product !== product)
      throw Error(
        "Naziv proizvoda se menja unutar iste šifre; potreban pregled mapiranja.",
      );
    payload.observations.push({
      period: Number(r.god),
      value: exactValues[i],
      status,
      publishedAt: null,
      sourceUpdatedAt: updated,
      retrievedAt: new Date(meta.retrievedAt).toISOString(),
      sourceUrl: meta.jsonUrl,
      sourceStatus: {
        code: r.IDStatusPodatka,
        label: r.nStatusPodatka,
        documentHash: meta.sha256,
        sourceRow: i + 1,
      },
    });
  }
  if (!imports.size)
    throw Error("Nema potvrđenih godišnjih podataka za teritoriju RS.");
  return [...imports.values()];
}
