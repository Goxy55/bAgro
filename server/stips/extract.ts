import { load } from "cheerio";
import { PDFParse } from "pdf-parse";
import {
  priceDraftSchema,
  priceFromCell,
  normalizedUnit,
  RawTable,
} from "./schema.js";
export const EXTRACTOR_VERSION = "stips-generic-1";
export const MAX_DOCUMENT_BYTES = 8 * 1024 * 1024;
const MAX_TEXT = 500000,
  MAX_ROWS = 2000;
function clean(s: string) {
  return s
    .replace(/\u00a0/g, " ")
    .replace(/[ \t\r]+/g, " ")
    .trim();
}
export function htmlTables(html: string) {
  const $ = load(html);
  $("script,style,noscript,iframe").remove();
  const tables: RawTable[] = [];
  $("table").each((_i, t) => {
    const rows: string[][] = [];
    $(t)
      .find("tr")
      .each((_r, tr) => {
        if ($(tr).closest("table")[0] !== t) return;
        const cells = $(tr)
          .children("th,td")
          .map((_c, td) => clean($(td).text()))
          .get();
        if (cells.some(Boolean)) rows.push(cells);
      });
    if (rows.length) tables.push({ page: 1, rows });
  });
  return { tables, text: clean($("body").text()).slice(0, MAX_TEXT) };
}
function latin(s: string) {
  const cy = "абвгдђежзијклљмнњопрстћуфхцчџш",
    la = [
      "a",
      "b",
      "v",
      "g",
      "d",
      "đ",
      "e",
      "ž",
      "z",
      "i",
      "j",
      "k",
      "l",
      "lj",
      "m",
      "n",
      "nj",
      "o",
      "p",
      "r",
      "s",
      "t",
      "ć",
      "u",
      "f",
      "h",
      "c",
      "č",
      "dž",
      "š",
    ];
  return s
    .toLowerCase()
    .split("")
    .map((c) => (cy.includes(c) ? la[cy.indexOf(c)] : c))
    .join("")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}
export function rawCandidates(tables: RawTable[]) {
  const candidates = [];
  for (let t = 0; t < tables.length; t++) {
    const table = tables[t];
    let header = -1;
    let indices: Record<string, number> = {};
    for (let r = 0; r < Math.min(5, table.rows.length); r++) {
      const h = table.rows[r].map(latin),
        p = h.findIndex((v) => /proizvod|kultura|roba/.test(v)),
        v = h.findIndex((v) => /cena|dominantna/.test(v));
      if (p >= 0 && v >= 0) {
        header = r;
        indices = {
          product: p,
          price: v,
          unit: h.findIndex((v) => /jedinica|^jm$|mera/.test(v)),
          place: h.findIndex((v) => /mesto|grad|lokacija/.test(v)),
          market: h.findIndex((v) => /trziste|pijaca/.test(v)),
          currency: h.findIndex((v) => /valuta/.test(v)),
        };
        break;
      }
    }
    for (let r = header >= 0 ? header + 1 : 0; r < table.rows.length; r++) {
      const cells = table.rows[r];
      if (!cells.some((v) => /\d/.test(v))) continue;
      const draft = priceDraftSchema.parse(
        header < 0
          ? {}
          : {
              product: cells[indices.product] || "",
              ...priceFromCell(cells[indices.price] || ""),
              unit: normalizedUnit(cells[indices.unit] || ""),
              place: cells[indices.place] || "",
              market: cells[indices.market] || "",
              currency: /^RSD$/i.test(cells[indices.currency] || "")
                ? "RSD"
                : /^EUR$/i.test(cells[indices.currency] || "")
                  ? "EUR"
                  : "",
            },
      );
      candidates.push({
        sourceKey: `raw:${t}:${r}`,
        page: table.page,
        tableIndex: t,
        sourceRow: r,
        sourceColumn: null,
        cells,
        quote: cells.join(" | "),
        draft,
        issues: [
          "Automatski predlog — obavezna provera reda, kolona, jedinice i obuhvata.",
        ],
      });
      if (candidates.length > MAX_ROWS)
        throw Error("Previše redova u dokumentu. Uvezite manji bilten.");
    }
  }
  return candidates;
}
export async function extractDocument(
  bytes: Buffer,
  mime: "application/pdf" | "text/html",
) {
  if (bytes.length > MAX_DOCUMENT_BYTES || !bytes.length)
    throw Error("Dokument mora imati od 1 bajta do 8 MB.");
  let text = "",
    tables: RawTable[] = [],
    pages = 1;
  const warnings: string[] = [];
  if (mime === "text/html") {
    const html = bytes.toString("utf8");
    if (!/<(?:!doctype\s+html|html|table)\b/i.test(html))
      throw Error("HTML dokument nije prepoznat.");
    ({ text, tables } = htmlTables(html));
  } else {
    if (!bytes.subarray(0, 5).equals(Buffer.from("%PDF-")))
      throw Error("Fajl nema PDF potpis.");
    const parser = new PDFParse({
      data: new Uint8Array(bytes),
      isEvalSupported: false,
      disableFontFace: true,
      stopAtErrors: true,
    });
    try {
      const info = await parser.getInfo();
      pages = info.total;
      if (pages > 40) throw Error("Najviše 40 stranica po dokumentu.");
      const result = await parser.getText({
        cellSeparator: "\t",
        lineEnforce: true,
      });
      text = result.text.slice(0, MAX_TEXT);
      const found = await parser.getTable();
      tables = found.pages.flatMap((p) =>
        p.tables.map((rows) => ({
          page: p.num,
          rows: rows.map((row) => row.map(clean)),
        })),
      );
      if (!tables.length) {
        tables = result.pages
          .map((p) => ({
            page: p.num,
            rows: p.text
              .split("\n")
              .filter((v) => v.trim())
              .map((line) => line.split(/\t| {2,}/).map(clean)),
          }))
          .filter((t) => t.rows.some((r) => r.length > 1));
        warnings.push(
          "Mreža tabele nije prepoznata; proverite položaj svake kolone ili unesite cenu ručno.",
        );
      }
    } finally {
      await parser.destroy();
    }
  }
  if (text.length < 30)
    warnings.push(
      "Dokument nema dovoljno čitljivog teksta. Moguć skenirani PDF: potreban OCR ili ručni unos sa originala.",
    );
  if (!tables.length)
    warnings.push(
      "Nisu prepoznate tabele. Dostupan je ručni unos proverene cene uz stranicu i citat.",
    );
  const count = tables.reduce((n, t) => n + t.rows.length, 0);
  if (count > MAX_ROWS)
    throw Error("Dokument sadrži više od 2000 redova; uvezite manji dokument.");
  return {
    text,
    tables,
    pages,
    warnings,
    candidates: rawCandidates(tables),
    status: tables.length ? "extracted" : "needs_manual",
  };
}
