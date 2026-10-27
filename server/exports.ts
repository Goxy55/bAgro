import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import type { Response } from "express";
import { D, moneyText } from "./domain.js";
export function reportRows(r: any) {
  return r.results.map((p: any) => [
    p.name,
    p.revenue,
    p.subsidies,
    p.normativeCost,
    p.actualCost,
    p.withSubsidies?.amount ?? null,
    p.withSubsidies?.percent ?? null,
    p.version?.name || "Nema aktivne verzije",
    p.missing.join("; ") || "Potpuno",
  ]);
}
const titles = [
  "Proizvodnja",
  "Prihod",
  "Subvencije",
  "Norm. trošak",
  "Stvarni trošak",
  "Marža sa subv.",
  "Marža %",
  "Verzija normativa",
  "Status",
];
const safe = (s: any) =>
  typeof s === "string" && /^[\s]*[=+@-]/.test(s) ? `'${s}` : s;
export async function exportReport(
  r: any,
  format: "pdf" | "xlsx",
  res: Response,
) {
  const metadata = [
    ["Gazdinstvo", r.farm.name],
    ["Period", String(r.farm.year)],
    ["Generisano", r.generatedAt],
    ["Valuta", r.currency],
    ["Metod", r.method],
    ["Status", r.status],
    ["Osnova", r.farm.basis],
    ["Pokrivenost troškova", r.coverage],
    ["Zaokruživanje", r.rounding],
    ["Izvori", r.sources.join("; ") || "Nema potvrđenih referentnih podataka"],
  ];
  const rows = reportRows(r);
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="agro-${r.farm.year}.${format}"`,
  );
  if (format === "xlsx") {
    res.type(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    const book = new ExcelJS.Workbook();
    book.creator = "Agro portal";
    book.created = new Date(r.generatedAt);
    const meta = book.addWorksheet("Metodologija");
    metadata.forEach((row) => meta.addRow(row.map(safe)));
    meta.columns = [{ width: 28 }, { width: 110 }];
    meta.eachRow(
      (row) => (row.alignment = { wrapText: true, vertical: "top" }),
    );
    const sheet = book.addWorksheet("Rezultati");
    sheet.addRow(titles);
    rows.forEach((row: any[]) =>
      sheet.addRow(
        row.map((x: any, i: number) =>
          i >= 1 && i <= 6 ? (x === null ? null : Number(x)) : safe(x),
        ),
      ),
    );
    sheet.addRow([
      "UKUPNO",
      Number(r.totals.revenue),
      Number(r.totals.subsidies),
      r.totals.normativeCost === null ? null : Number(r.totals.normativeCost),
      Number(r.totals.actualCost),
      r.totals.margin ? Number(r.totals.margin.amount) : null,
      r.totals.margin?.percent ? Number(r.totals.margin.percent) : null,
    ]);
    sheet.columns = titles.map((_, i) => ({
      width: i === 0 ? 30 : i >= 7 ? 55 : 21,
    }));
    sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    sheet.getRow(1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF254C38" },
    };
    for (let c = 2; c <= 7; c++) sheet.getColumn(c).numFmt = "#,##0.00";
    sheet.views = [{ state: "frozen", ySplit: 1 }];
    sheet.autoFilter = { from: "A1", to: `I${rows.length + 1}` };
    const cash = book.addWorksheet("Novčani tok");
    cash.addRow([
      "Mesec",
      "Početno stanje",
      "Prilivi",
      "Odlivi",
      "Neto tok",
      "Završno stanje",
    ]);
    r.cashflow.forEach((m: any) =>
      cash.addRow([
        m.month,
        ...["opening", "incoming", "outgoing", "net", "closing"].map((k) =>
          m[k] === null ? null : Number(m[k]),
        ),
      ]),
    );
    cash.columns = Array.from({ length: 6 }, () => ({ width: 23 }));
    const events = book.addWorksheet("Događaji i kursevi");
    events.addRow([
      "Opis",
      "Datum",
      "Vrsta",
      "Status",
      "Original",
      "Valuta",
      "RSD",
      "EUR",
      "Kurs",
      "Lista od",
      "Izvor",
    ]);
    r.events.forEach((e: any) =>
      events.addRow([
        safe(e.title),
        e.date,
        e.kind,
        e.status,
        e.money ? Number(e.money.original) : null,
        e.money?.currency,
        e.money ? Number(e.money.rsd) : null,
        e.money ? Number(e.money.eur) : null,
        e.money ? Number(e.money.rate) : null,
        e.money?.rateDate,
        e.money?.source,
      ]),
    );
    events.columns = Array.from({ length: 11 }, (_, i) => ({
      width: i === 0 || i === 10 ? 50 : 20,
    }));
    const norms = book.addWorksheet("Snapshot normativa");
    norms.addRow([
      "Proizvodnja",
      "Verzija",
      "Izvor",
      "Stavka",
      "Količina",
      "Jedinica",
      "Cena EUR",
      "Iznos EUR",
    ]);
    r.results.forEach((p: any) =>
      p.norm.lines.forEach((l: any) =>
        norms.addRow([
          safe(p.name),
          safe(p.version?.name || ""),
          p.norm.version?.model.sheet,
          safe(l.name),
          Number(l.quantity),
          safe(l.unit),
          l.price == null ? null : Number(l.price),
          l.cost == null ? null : Number(l.cost),
        ]),
      ),
    );
    norms.columns = Array.from({ length: 8 }, (_, i) => ({
      width: i === 0 || i === 3 ? 40 : 24,
    }));
    book.eachSheet((s) =>
      s.eachRow((row) =>
        row.eachCell((cell) => {
          if (typeof cell.value === "string") cell.value = safe(cell.value);
        }),
      ),
    );
    await book.xlsx.write(res);
    res.end();
    return;
  }
  res.type("application/pdf");
  const doc = new PDFDocument({ size: "A4", margin: 38 });
  doc.pipe(res);
  doc.registerFont("Serbian", "public/fonts/DejaVuSans.ttf");
  doc.font("Serbian");
  doc.fontSize(24).fillColor("#254c38").text("Agro portal");
  doc.fontSize(15).text("Izveštaj gazdinstva");
  doc.moveDown();
  doc.fontSize(9).fillColor("#222");
  for (const [label, value] of metadata) {
    doc.text(`${label}: ${value}`);
    doc.moveDown(0.25);
  }
  doc.moveDown();
  // Wide result tables are laid out as per-production panels with repeating headers, avoiding clipped columns.
  for (const row of rows) {
    if (doc.y > 590) doc.addPage();
    doc.fontSize(13).fillColor("#254c38").text(String(row[0]));
    doc.fontSize(9).fillColor("#222");
    for (let i = 1; i < row.length; i++)
      doc.text(
        `${titles[i]}: ${row[i] === null ? "Nedostaje podatak" : i <= 6 ? moneyText(row[i]) : row[i]}${i >= 1 && i <= 5 ? " " + r.currency : ""}`,
      );
    const p = r.results[rows.indexOf(row)];
    doc.text(
      `Normativni izvor: ${p.norm.version?.model.sheet || "Nije odobren"} / ${p.norm.version?.model.range || "—"}`,
    );
    doc.text(
      `Ukupan normativni trošak ostvarene proizvodnje: ${p.normativeTotal === null ? "Nepotpun obračun" : moneyText(p.normativeTotal)} ${r.currency}`,
    );
    if (r.productionId && p.norm.lines.length) {
      doc
        .moveDown()
        .fontSize(11)
        .text("Detalj odobrenih normativnih stavki · EUR");
      for (const line of p.norm.lines) {
        if (doc.y > 710) {
          doc.addPage();
          doc.fontSize(11).text("Normativne stavke — nastavak · EUR");
        }
        doc
          .fontSize(8)
          .text(
            `${line.id} · ${line.name}\n${line.quantity} ${line.unit} × ${line.price ?? "Nedostaje cena"} EUR = ${line.cost == null ? "Nepotpun podatak" : moneyText(line.cost)} EUR`,
          );
        doc.moveDown(0.4);
      }
    }
    doc.moveDown();
  }
  if (doc.y > 590) doc.addPage();
  doc.fontSize(13).text("Zbir gazdinstva");
  doc
    .fontSize(10)
    .text(
      `Prihod: ${moneyText(r.totals.revenue)} ${r.currency}\nSubvencije: ${moneyText(r.totals.subsidies)} ${r.currency}\nObračunska marža: ${r.totals.margin ? moneyText(r.totals.margin.amount) : "Nepotpun obračun"} ${r.currency}\nMarža bez subvencija: ${r.totals.withoutSubsidies ? moneyText(r.totals.withoutSubsidies.amount) : "Nepotpun obračun"} ${r.currency}`,
    );
  doc.addPage();
  doc.fontSize(16).text("Ostvareni novčani tok");
  doc.fontSize(9);
  for (const m of r.cashflow) {
    doc
      .moveDown(0.7)
      .text(
        `${m.month} · prilivi ${moneyText(m.incoming)} · odlivi ${moneyText(m.outgoing)} · neto ${moneyText(m.net)} ${r.currency}\nPočetno: ${m.opening === null ? "Nije uneto" : moneyText(m.opening)} · Završno: ${m.closing === null ? "Nije definisano" : moneyText(m.closing)}`,
      );
  }
  doc.end();
}
