import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  D,
  margin,
  convertQuantity,
  normalizedScale,
  calculateNorm,
  validateModel,
  safeYield,
  currencySnapshot,
  fiveYears,
} from "../server/domain.js";
const item = {
  id: "A",
  name: "Materijal",
  quantity: "1",
  price: "500",
  unit: "kg",
  unitConfirmed: true,
};
const model = {
  basis: "ha",
  reference: "1",
  reviewed: true,
  items: [item],
  groups: [],
};
test("88 izvornih karata, 10 sheetova, 44 spoljne formule i pet tačnih regresija", async () => {
  const a = JSON.parse(await readFile("source/inventory.json", "utf8"));
  assert.equal(a.cards.length, 88);
  assert.equal(a.sheets.length, 10);
  assert.equal(a.issues.filter((i: any) => i.kind === "external").length, 44);
  for (const f of a.fixtures)
    assert.ok(D(f.expected).sub(f.calculated).abs().lte(".000001"));
  assert.deepEqual(
    a.sheets.filter((s: any) => s.role === "auxiliary").map((s: any) => s.name),
    ["Zalihe na parceli", "Priručnik"],
  );
});
test("ha, m² i zasebni delioci rasada", () => {
  assert.equal(
    calculateNorm(model, { scale: "2.5", scaleUnit: "ha" }).total,
    "1250",
  );
  assert.equal(
    normalizedScale(
      { ...model, basis: "m2", reference: "100" },
      { scale: "250", scaleUnit: "m2" },
    ).toString(),
    "2.5",
  );
  assert.equal(convertQuantity("25000", "m2", "ha").toString(), "2.5");
  assert.equal(convertQuantity("1", "t", "kg").toString(), "1000");
  assert.throws(() => convertQuantity("1", "kg", "l"));
  assert.equal(
    normalizedScale(
      { ...model, basis: "seedlings", reference: "80000" },
      { scale: "80000" },
    ).toString(),
    "1",
  );
  assert.equal(
    normalizedScale(
      { ...model, basis: "seedlings", reference: "5000" },
      { scale: "5000" },
    ).toString(),
    "1",
  );
});
test("Marža na prihod, bez deljenja nulom", () => {
  assert.deepEqual(margin("100000", "60000"), {
    amount: "40000",
    percent: "40",
  });
  assert.equal(margin("0", "50").percent, null);
  assert.equal(safeYield("100", "0").status, "Nedostaje prinos");
  assert.equal(safeYield("100", null).value, null);
});
test("Prazna cena nije nula; eksplicitna nula mora imati razlog", () => {
  assert.equal(
    calculateNorm(
      { ...model, items: [{ ...item, price: null }] },
      { scale: "1" },
    ).total,
    null,
  );
  assert.ok(
    validateModel({ ...model, items: [{ ...item, price: "0" }] }).length,
  );
  assert.deepEqual(
    validateModel({
      ...model,
      items: [
        { ...item, price: "0", zeroReason: "Sopstveni unos — potvrđeno" },
      ],
    }),
    [],
  );
  assert.deepEqual(
    validateModel({
      ...model,
      items: [{ ...item, quantity: "0", price: null }],
    }),
    [],
  );
});
test("Nezavisni hranidbeni blokovi i godišnja/ciklus osnova", () => {
  const m = {
    ...model,
    basis: "head_cycle",
    groups: [{ id: "a" }, { id: "b" }],
    groupBases: { a: "100", b: "200" },
    items: [
      { ...item, group: "a", share: "100" },
      { ...item, id: "B", group: "b", share: "100" },
    ],
  };
  assert.equal(calculateNorm(m, { scale: "1" }).total, "150000");
  assert.deepEqual(validateModel(m), []);
  assert.ok(
    validateModel({
      ...m,
      items: [...m.items, { ...item, id: "C", group: "a", share: "20" }],
    }).length,
  );
  assert.equal(
    normalizedScale(
      { ...model, basis: "head_cycle" },
      { scale: "3", start: "2026-01-01", end: "2026-06-30" },
    ).toString(),
    "3",
  );
  assert.ok(
    normalizedScale(
      { ...model, basis: "head_year" },
      { scale: "3", start: "2026-01-01", end: "2026-06-30" },
    ).lt(3),
  );
});
test("Valutni snapshot i poslednja važeća lista", () => {
  const rate = {
    rate: "117.2",
    valid_from: "2026-10-23",
    valid_to: "2026-10-25",
    source_url: "https://nbs.rs/test",
  };
  const s = currencySnapshot("100", "EUR", "2026-10-25", rate);
  assert.equal(s.rsd, "11720");
  assert.equal(s.rateDate, "2026-10-23");
  assert.equal(s.date, "2026-10-25");
  assert.equal(currencySnapshot("11720", "RSD", "2026-10-25", rate).eur, "100");
  assert.throws(() => currencySnapshot("1", "EUR", "2026-01-01", null));
});
test("Nedostajuća statistika nije nula, prosek koristi dostupna opažanja", () => {
  const result = fiveYears(
    [
      { period: 2025, value: "10", status: "konačan" },
      { period: 2023, value: "20", status: "konačan" },
      { period: 2026, value: "2", status: "nepotpuna godina" },
    ],
    2026,
  );
  assert.equal(result.points.length, 5);
  assert.equal(result.points[3].value, null);
  assert.equal(result.count, 2);
  assert.equal(result.mean, "15");
  assert.equal(result.current.length, 1);
});
test("Alternative i efektivna cena hrane ne mogu se prikriti nulom izvornog reda", () => {
  const m = {
    ...model,
    items: [
      { ...item, id: "A", alternativeGroup: "g" },
      { ...item, id: "B", alternativeGroup: "g" },
    ],
  };
  assert.ok(validateModel(m).some((e) => e.includes("Alternativa")));
  const feed = {
    ...model,
    groups: [{ id: "a" }],
    groupBases: { a: "100" },
    items: [{ ...item, group: "a", quantity: "0", share: "100", price: null }],
  };
  assert.equal(calculateNorm(feed, { scale: "1" }).total, null);
});
