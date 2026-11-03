import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import type { Response } from "express";
import { moneyText } from "./domain.js";
const safe = (value: any) =>
  typeof value === "string" && /^\s*[=+@-]/.test(value) ? "'" + value : value;
const numeric = (value: any) => (value == null ? null : Number(value));
const valueText = (value: any) =>
  value == null ? "Nepotpun podatak" : moneyText(value) + " RSD";
export async function exportMonthlyWip(
  r: any,
  format: "pdf" | "xlsx",
  res: Response,
) {
  const metadata = [
    ["Gazdinstvo", r.farm.name],
    ["Sezona", String(r.farm.year)],
    ["Mesec pregleda — zaključno", r.asOf],
    ["Generisano", r.generatedAt],
    ["Valuta", "RSD"],
    ["Metod", r.method],
    ["Status", r.status],
    [
      "Verzija kalendarskih pravila",
      r.policy ? `${r.policy.name} (${r.policy.id})` : "Nije potvrđena",
    ],
    ["Pravila", r.policy ? JSON.stringify(r.policy.policy) : "Nisu potvrđena"],
    ["Pokrivenost", r.coverage],
    ["Zaokruživanje", r.rounding],
    ["Izvori", r.sources.join("; ")],
  ];
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="agro-ulaganja-${r.asOf}.${format}"`,
  );
  if (format === "xlsx") {
    res.type(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    const book = new ExcelJS.Workbook();
    book.creator = "Agro portal";
    book.created = new Date(r.generatedAt);
    const meta = book.addWorksheet("Metodologija");
    metadata.forEach((row) => meta.addRow(row));
    meta.columns = [{ width: 34 }, { width: 120 }];
    const summary = book.addWorksheet("Pregled");
    summary.addRow([
      "Proizvodnja",
      "Normativno ulaganje do meseca RSD",
      "Poznat deo ulaganja RSD",
      "Ulaganje u mesecu RSD",
      "Zaliha u zemlji RSD",
      "Stanje proizvodnje",
      "Normativna verzija",
      "Status / nedostajući podaci",
    ]);
    for (const p of r.results)
      summary.addRow([
        p.name,
        numeric(p.cumulative),
        numeric(p.knownCumulative),
        numeric(p.currentMonth),
        numeric(p.wipValue),
        p.state === "completed"
          ? `Završena ${p.completedOn}`
          : p.state === "growing"
            ? "U toku"
            : "Nije potvrđeno",
        p.version?.name || "Nema odobrenog normativa",
        p.errors.join("; ") || "Obračun po normativu",
      ]);
    summary.addRow([
      "UKUPNO",
      numeric(r.totals.cumulative),
      numeric(r.totals.knownCumulative),
      numeric(r.totals.currentMonth),
      numeric(r.totals.wipValue),
    ]);
    summary.columns = [
      { width: 40 },
      { width: 26 },
      { width: 26 },
      { width: 26 },
      { width: 26 },
      { width: 28 },
      { width: 35 },
      { width: 80 },
    ];
    const monthly = book.addWorksheet("Mesečni pregled");
    monthly.addRow([
      "Proizvodnja",
      "Mesec",
      "Povećanje u mesecu RSD",
      "Kumulativno ulaganje RSD",
      "Poznat deo kumulativno RSD",
      "U obuhvatu pregleda",
    ]);
    const lines = book.addWorksheet("Troškovnik");
    lines.addRow([
      "Proizvodnja",
      "Vrsta troška — B",
      "Mesec normativa — C",
      "Cena RSD/jm — D",
      "Normirana potrošnja — E",
      "Jedinica",
      "Referentna osnova",
      "Trošak referentne osnove RSD — F",
      "Količina za površinu",
      "Trošak cele površine RSD",
      "Utrošena normativna količina do meseca",
      "Kumulativno do meseca RSD",
      "Verzija normativa",
      "Poreklo meseca",
      "Napomene / nedostajući podaci",
    ]);
    const distribution = book.addWorksheet("Raspodela");
    distribution.addRow([
      "Proizvodnja",
      "Vrsta troška",
      "Mesec",
      "Udeo — brojilac",
      "Udeo — imenilac",
      "Količina",
      "Trošak RSD",
      "Izvor raspodele",
    ]);
    for (const p of r.results) {
      for (const m of p.months)
        monthly.addRow([
          p.name,
          m.month,
          numeric(m.increase),
          numeric(m.cumulative),
          numeric(m.knownCumulative),
          m.included ? "Da" : "Kasniji mesec — nije uključen u sadašnji zbir",
        ]);
      for (const l of p.lines) {
        lines.addRow([
          p.name,
          l.name,
          l.rawMonth,
          numeric(l.price),
          numeric(l.normQuantity),
          l.unit,
          `${l.reference} ${l.basis}`,
          numeric(l.perReferenceCost),
          numeric(l.quantity),
          numeric(l.fullCost),
          numeric(l.recognizedQuantity),
          numeric(l.cumulative),
          p.version?.name,
          l.monthSource ? `${p.version?.sheet}!${l.monthSource}` : null,
          [...l.notes, ...l.errors].join("; "),
        ]);
        for (const a of l.allocation)
          distribution.addRow([
            p.name,
            l.name,
            a.month,
            Number(a.numerator),
            Number(a.denominator),
            numeric(a.quantity),
            numeric(a.amount),
            a.sourceCell,
          ]);
      }
    }
    monthly.columns = [
      { width: 40 },
      { width: 16 },
      ...Array.from({ length: 3 }, () => ({ width: 27 })),
      { width: 48 },
    ];
    lines.columns = Array.from({ length: 15 }, (_, i) => ({
      width: i === 0 || i === 1 ? 40 : i === 14 ? 90 : 25,
    }));
    distribution.columns = Array.from({ length: 8 }, (_, i) => ({
      width: i === 0 || i === 1 ? 40 : 24,
    }));
    for (const sheet of book.worksheets) {
      sheet.views = [{ state: "frozen", ySplit: 1 }];
      sheet.eachRow((row) => {
        row.alignment = { vertical: "top", wrapText: true };
        row.eachCell((cell) => {
          if (typeof cell.value === "string") cell.value = safe(cell.value);
          if (typeof cell.value === "number") cell.numFmt = "#,##0.00######";
        });
      });
      sheet.getRow(1).font = { bold: true };
      if (sheet !== meta)
        sheet.autoFilter = {
          from: { row: 1, column: 1 },
          to: { row: Math.max(1, sheet.rowCount), column: sheet.columnCount },
        };
    }
    for (const sheet of [summary, monthly, lines, distribution])
      for (let column = 1; column <= sheet.columnCount; column++)
        if (String(sheet.getRow(1).getCell(column).value).includes("RSD"))
          sheet.getColumn(column).numFmt = "#,##0.00";
    await book.xlsx.write(res);
    res.end();
    return;
  }
  res.type("application/pdf");
  const doc = new PDFDocument({ size: "A4", margin: 38 });
  doc.pipe(res);
  doc.registerFont("Serbian", "public/fonts/DejaVuSans.ttf");
  doc.font("Serbian");
  doc.fontSize(20).fillColor("#254c38").text("Agro portal");
  doc.fontSize(14).text("Kumulativna ulaganja i zalihe u zemlji");
  doc.fillColor("#222").fontSize(9);
  for (const [k, v] of metadata) doc.text(`${k}: ${v}`);
  doc.moveDown();
  doc
    .fontSize(12)
    .text(`Kumulativno ulaganje: ${valueText(r.totals.cumulative)}`);
  doc.text(`Zalihe u zemlji: ${valueText(r.totals.wipValue)}`);
  doc.moveDown();
  for (const p of r.results) {
    if (doc.y > 620) doc.addPage();
    doc.fontSize(13).fillColor("#254c38").text(p.name);
    doc
      .fillColor("#222")
      .fontSize(9)
      .text(
        `Normativ: ${p.version?.name || "Nema odobrenog normativa"} · ${p.version?.sheet || ""} ${p.version?.range || ""}`,
      );
    doc.text(
      `Ulaganje do ${r.asOf}: ${valueText(p.cumulative)} · Poznat deo: ${valueText(p.knownCumulative)}`,
    );
    doc.text(`Zaliha u zemlji: ${valueText(p.wipValue)} · ${p.stageMessage}`);
    if (p.errors.length) doc.text("Nepotpuni podaci: " + p.errors.join("; "));
    doc.moveDown(0.4);
    for (const m of p.months.filter((m: any) => m.included)) {
      if (doc.y > 730) doc.addPage();
      doc
        .fontSize(8)
        .text(
          `${m.month}: mesečno ${valueText(m.increase)}; kumulativno ${valueText(m.cumulative)}`,
        );
    }
    for (const l of p.lines) {
      if (doc.y > 690) doc.addPage();
      doc
        .moveDown(0.4)
        .fontSize(9)
        .text(
          `${l.name} (${l.id}) · mesec normativa ${l.rawMonth || "Iz bloka / potvrđene raspodele"}`,
        );
      doc
        .fontSize(8)
        .text(
          `Cena: ${l.price ?? "Nedostaje"} RSD/${l.unit}; normirana potrošnja: ${l.normQuantity ?? "Nedostaje"} ${l.unit}/${l.reference} ${l.basis}; trošak referentne osnove: ${valueText(l.perReferenceCost)}`,
        );
      doc.text(
        `Količina za površinu: ${l.quantity ?? "Nedostaje"} ${l.unit}; ukupno: ${valueText(l.fullCost)}; do ${r.asOf}: ${valueText(l.cumulative)}`,
      );
      if (l.notes.length || l.errors.length)
        doc.text([...l.notes, ...l.errors].join("; "));
    }
    doc.moveDown();
  }
  doc.end();
}
