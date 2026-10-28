import { load } from "cheerio";
import * as XLSX from "@e965/xlsx";
import { stipsUrl, parseSerbianNumber } from "../stips/schema.js";
import { D } from "../domain.js";

export const INPUTS_URL =
  "https://www.stips.minpolj.gov.rs/index.php/srl/strana/inputi";
export const INPUT_PARSER = "stips-inputs-1";
export type InputCategory = "pesticidi" | "djubriva" | "seme";
export type InputReport = {
  url: string;
  title: string;
  year: number;
  month: number;
  category: InputCategory;
};
const clean = (v: unknown) =>
  String(v ?? "")
    .replace(/\s+/g, " ")
    .trim();
const months = [
  "januar",
  "februar",
  "mart",
  "april",
  "maj",
  "jun",
  "jul",
  "avgust",
  "septembar",
  "oktobar",
  "novembar",
  "decembar",
];
export function periodInText(text: string) {
  const s = text.toLowerCase();
  for (let i = 0; i < months.length; i++) {
    const match = s.match(new RegExp(`\\b${months[i]}\\s+(20\\d{2})\\b`));
    if (match) return { year: Number(match[1]), month: i + 1 };
  }
  return null;
}
export function monthDates(year: number, month: number) {
  return {
    start: `${year}-${String(month).padStart(2, "0")}-01`,
    end: new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10),
  };
}
export function discoverInputReports(
  html: string,
  base = INPUTS_URL,
): InputReport[] {
  const $ = load(html),
    reports = new Map<string, InputReport>();
  $("main tr").each((_, row) => {
    const cells = $(row).children("th,td");
    const year = Number(clean(cells.first().text()));
    if (year < 2000 || year > 2100) return;
    cells.slice(1).each((i, cell) => {
      $(cell)
        .find("a[href]")
        .each((_, a) => {
          const title = clean($(a).attr("title") || $(a).text());
          const hint = title + " " + $(a).find("img").attr("alt");
          const category: InputCategory | null = /pesticid/i.test(hint)
            ? "pesticidi"
            : /đubr|djubr/i.test(hint)
              ? "djubriva"
              : /semen|seme\b/i.test(hint)
                ? "seme"
                : null;
          if (!category || i > 11) return;
          try {
            const url = stipsUrl($(a).attr("href") || "", base);
            // The grid determines discovery; the workbook heading determines the imported period.
            reports.set(url, { url, title, year, month: i + 1, category });
          } catch {
            /* Ignore off-site or insecure links. */
          }
        });
    });
  });
  return [...reports.values()].sort(
    (a, b) =>
      b.year - a.year ||
      b.month - a.month ||
      a.category.localeCompare(b.category),
  );
}
export function inputAttachment(html: string, pageUrl: string) {
  const $ = load(html),
    links = new Map<string, string>();
  $("main a[href]").each((_, a) => {
    try {
      const url = stipsUrl($(a).attr("href") || "", pageUrl);
      if (/\.xlsx?(?:$|\?)/i.test(url)) links.set(url, clean($(a).text()));
    } catch {
      /* Only the official HTTPS origin is eligible. */
    }
  });
  if (links.size !== 1)
    throw Error(
      "Nije pronađen jedan nedvosmislen XLS/XLSX prilog; potreban je pregled izvora.",
    );
  return { url: [...links.keys()][0], title: clean($("h1").first().text()) };
}
export type InputCell = {
  sheet: string;
  cell: string;
  product: string;
  manufacturer: string;
  packaging: string;
  place: string;
  price: string | null;
  raw: unknown;
  status: "available" | "missing" | "review";
};
export function extractInputWorkbook(
  bytes: Buffer,
  report: InputReport,
  pageTitle: string,
) {
  if (bytes.length > 8 * 1024 * 1024) throw Error("Prilog je veći od 8 MB.");
  const zip = bytes.subarray(0, 2).toString() === "PK";
  const ole = bytes
    .subarray(0, 8)
    .equals(Buffer.from("d0cf11e0a1b11ae1", "hex"));
  if (!zip && !ole) throw Error("Prilog nije prepoznat kao XLS/XLSX dokument.");
  const wb = XLSX.read(Buffer.from(bytes), {
    type: "buffer",
    cellFormula: true,
    cellHTML: false,
    bookVBA: false,
    sheetRows: 1001,
  });
  if (!wb.SheetNames.length || wb.SheetNames.length > 20)
    throw Error("Neočekivan broj sheetova u cenovniku.");
  const cells: InputCell[] = [],
    warnings: string[] = [],
    periods = new Set<string>();
  for (const name of wb.SheetNames) {
    const s = wb.Sheets[name],
      range = XLSX.utils.decode_range(s["!fullref"] || s["!ref"] || "A1");
    if (range.e.r >= 1000 || range.e.c >= 80)
      throw Error("Tabela prelazi podržanih 1000 redova / 80 kolona.");
    const value = (r: number, c: number) => s[XLSX.utils.encode_cell({ r, c })];
    let header = -1;
    for (let r = 0; r <= Math.min(range.e.r, 10); r++) {
      const text = Array.from({ length: 3 }, (_, c) =>
        clean(value(r, c)?.v),
      ).join(" ");
      const p = periodInText(text);
      if (p) periods.add(`${p.year}-${String(p.month).padStart(2, "0")}`);
      if (
        clean(value(r, 3)?.v) === "Beograd" &&
        clean(value(r, 4)?.v) === "Čačak"
      )
        header = r;
    }
    if (header < 0)
      throw Error(
        `${name}: nije potvrđeno zaglavlje mesta; uvoz je zaustavljen.`,
      );
    const places: { column: number; place: string }[] = [];
    for (let c = 3; c <= range.e.c; c++) {
      const place = clean(value(header, c)?.v);
      if (!place) continue;
      if (/^(srbija|ukupno|prosek)$/i.test(place))
        throw Error("Nacionalni zbir ne sme biti lokalno mesto.");
      places.push({ column: c, place });
    }
    if (!places.length) throw Error(`${name}: nema mesta.`);
    for (let r = header + 1; r <= range.e.r; r++) {
      const product = clean(value(r, 0)?.v),
        packaging = clean(value(r, 2)?.v);
      if (!product || !packaging || /^proizvod\b/i.test(product)) continue;
      for (const { column, place } of places) {
        const c = value(r, column),
          raw = c?.v ?? null;
        let price: string | null = null,
          status: InputCell["status"] = "missing";
        if (c?.f)
          status = "review"; // Never execute formulas or trust their cached result.
        else if (raw !== null && !/^\s*[-–—/]?\s*$/.test(String(raw))) {
          price =
            typeof raw === "number" && Number.isFinite(raw) && raw >= 0
              ? D(raw).toString()
              : typeof raw === "string"
                ? parseSerbianNumber(raw)
                : null;
          status = price !== null && D(price).gt(0) ? "available" : "review";
        }
        cells.push({
          sheet: name,
          cell: XLSX.utils.encode_cell({ r, c: column }),
          product,
          manufacturer: clean(value(r, 1)?.v),
          packaging,
          place,
          price,
          status,
          raw: c?.f ? { formula: c.f, cached: raw } : raw,
        });
      }
    }
  }
  if (!cells.length || cells.length > 30000)
    throw Error("Nema podataka ili cenovnik prelazi 30000 opažanja.");
  if (periods.size !== 1)
    throw Error(
      "Period nije jednoznačno potvrđen u zaglavljima Excel dokumenta.",
    );
  const [year, month] = [...periods][0].split("-").map(Number);
  if (year !== report.year)
    throw Error("Godina u prilogu ne odgovara izabranoj godini arhive.");
  const pagePeriod = periodInText(pageTitle);
  if (
    month !== report.month ||
    (pagePeriod && (pagePeriod.month !== month || pagePeriod.year !== year))
  )
    warnings.push(
      "Period u naslovu/poziciji arhive razlikuje se od priloga. Za cene je sačuvan period iz zaglavlja Excel dokumenta.",
    );
  const review = cells.filter((c) => c.status === "review").length;
  if (review)
    warnings.push(
      `${review} izvornih vrednosti zahteva proveru; ne koriste se kao potvrđene cene.`,
    );
  warnings.push(
    "Osnova cene po pakovanju/kg/l nije automatski potvrđena. Izbor za normativ zahteva proveru administratora.",
  );
  return { cells, warnings, period: monthDates(year, month), year, month };
}
