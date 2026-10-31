import Decimal from "decimal.js";
Decimal.set({ precision: 36, rounding: Decimal.ROUND_HALF_UP });
export const D = (x: Decimal.Value) => new Decimal(x);
export const moneyText = (x: Decimal.Value) =>
  D(x).toDecimalPlaces(2).toFixed(2);
export function convertQuantity(
  quantity: string,
  from: string,
  to: string,
): Decimal {
  if (from === to) return D(quantity);
  const units: Record<string, [string, string]> = {
    kg: ["mass", "1"],
    t: ["mass", "1000"],
    ha: ["area", "10000"],
    m2: ["area", "1"],
    l: ["volume", "1"],
    kom: ["count", "1"],
    biljka: ["plants", "1"],
    grlo: ["heads", "1"],
    vreća: ["bags", "1"],
  };
  if (!units[from] || !units[to] || units[from][0] !== units[to][0])
    throw Error(`Neusklađene jedinice: ${from} / ${to}`);
  return D(quantity).mul(units[from][1]).div(units[to][1]);
}
export function safeYield(q: string | null, y: string | null) {
  return !y || D(y).lte(0)
    ? { value: null, status: "Nedostaje prinos" }
    : {
        value: D(q || 0)
          .div(y)
          .toString(),
        status: "ok",
      };
}
export function margin(revenue: string, cost: string) {
  const r = D(revenue),
    value = r.sub(cost);
  return {
    amount: value.toString(),
    percent: r.isZero() ? null : value.div(r).mul(100).toString(),
  };
}
export function validateModel(model: any): string[] {
  const errors: string[] = [];
  if (!model.reviewed)
    errors.push(
      "Potrebna potvrda izvora, jedinica, alternativa i osnove obračuna.",
    );
  if (
    !["ha", "m2", "seedlings", "bag", "head_year", "head_cycle"].includes(
      model.basis,
    )
  )
    errors.push("Nepoznata obračunska osnova.");
  if (!model.reference || D(model.reference).lte(0))
    errors.push("Nedostaje referentna osnova.");
  const allocations = Object.values(model.byproductAllocations || {}).map(
    (a: any) => D(a),
  );
  if (
    allocations.some((a) => a.lt(0)) ||
    allocations.reduce((s, a) => s.add(a), D(0)).gt(100)
  )
    errors.push(
      "Raspodela troška nusproizvoda mora biti između 0 i 100%, sa ostatkom za glavni proizvod.",
    );
  for (const g of model.groups || []) {
    if (!model.groupBases?.[g.id] || D(model.groupBases[g.id]).lte(0))
      errors.push(`Blok ${g.id}: nedostaje potvrđena osnova potrošnje.`);
  }
  const alternatives = new Map<string, number>();
  for (let n = 0; n < model.items.length; n++) {
    const i = model.items[n],
      previous = model.items[n - 1];
    const group =
      i.alternativeGroup ||
      (/\bili\b/i.test(i.name)
        ? i.id
        : previous && /\bili\b/i.test(previous.name)
          ? previous.id
          : null);
    if (group && i.included !== false)
      alternatives.set(group, (alternatives.get(group) || 0) + 1);
  }
  for (const [g, n] of alternatives)
    if (n > 1) errors.push(`Alternativa ${g}: odaberite samo jednu stavku.`);
  if (model.basis === "bag" && !model.unitConfirmed)
    errors.push("Potvrdite jedinicu vreća za šampinjone.");
  for (const i of model.items) {
    if (i.pricingGroup === "diesel" && i.unit !== "l")
      errors.push(
        `${i.id}: zajednička cena goriva zahteva potrošnju u litrima.`,
      );
    if (i.included === false) {
      if (!i.exclusionReason) errors.push(`${i.id}: razlog isključenja.`);
      continue;
    }
    if (i.quantity === null || i.quantity === undefined || i.quantity === "") {
      errors.push(`${i.id}: nedostaje količina.`);
      continue;
    }
    if (i.group && (D(i.share || 0).lt(0) || D(i.share || 0).gt(100)))
      errors.push(`${i.id}: udeo mora biti od 0 do 100%.`);
    const effective =
      i.group && model.groupBases?.[i.group]
        ? D(model.groupBases[i.group])
            .mul(i.share || 0)
            .div(100)
        : D(i.quantity);
    if (effective.lt(0)) {
      errors.push(`${i.id}: negativna količina.`);
      continue;
    }
    if (
      effective.gt(0) &&
      (i.price === null || i.price === undefined || i.price === "")
    )
      errors.push(`${i.id}: nedostaje cena.`);
    if (
      i.price !== null &&
      i.price !== undefined &&
      i.price !== "" &&
      (D(i.price).lt(0) ||
        (D(i.price).isZero() && effective.gt(0) && !i.zeroReason))
    )
      errors.push(
        `${i.id}: nulta cena zahteva razlog; negativna nije dozvoljena.`,
      );
    if (!i.unitConfirmed) errors.push(`${i.id}: jedinica nije potvrđena.`);
    if (i.flags?.includes("alternative") && !i.alternativeConfirmed)
      errors.push(`${i.id}: alternativa nije odabrana.`);
  }
  for (const group of model.groups || []) {
    const sum = model.items
      .filter((i: any) => i.group === group.id && i.included !== false)
      .reduce((s: Decimal, i: any) => s.add(i.share || 0), D(0));
    if (!sum.eq(100))
      errors.push(`Blok ${group.id}: zbir udela je ${sum}%, mora biti 100%.`);
  }
  return errors;
}
export function normalizedScale(model: any, p: any): Decimal {
  if (!p.scale)
    throw Error("Nedostaje ostvarena površina, broj grla ili biljaka.");
  let n = D(p.scale);
  if (n.lte(0)) throw Error("Ostvarena osnova mora biti pozitivna.");
  if (model.basis === "ha")
    n = convertQuantity(p.scale, p.scaleUnit || "ha", "ha");
  if (model.basis === "m2")
    n = convertQuantity(p.scale, p.scaleUnit || "m2", "m2");
  if (model.basis === "head_year") {
    if (!p.start || !p.end)
      throw Error("Nedostaje period za prosečan broj grla.");
    const days = (Date.parse(p.end) - Date.parse(p.start)) / 86400000 + 1;
    const year = Number(p.start.slice(0, 4));
    const yearDays =
      (Date.UTC(year + 1, 0, 1) - Date.UTC(year, 0, 1)) / 86400000;
    if (days <= 0 || p.start.slice(0, 4) !== p.end.slice(0, 4))
      throw Error("Godišnji period mora biti unutar jedne godine.");
    n = n.mul(days).div(yearDays);
  }
  return n.div(model.reference);
}
export function calculateNorm(model: any, p: any) {
  const errors = validateModel(model);
  let factor: Decimal;
  try {
    factor = normalizedScale(model, p);
  } catch (e) {
    errors.push((e as Error).message);
    return { total: null, lines: [], errors };
  }
  if (
    model.weights &&
    model.basis === "head_cycle" &&
    (p.buyWeight !== undefined || p.sellWeight !== undefined)
  ) {
    if (p.buyWeight == null || p.sellWeight == null)
      errors.push("Nedostaje kupovna/prodajna težina.");
  }
  const lines = model.items
    .filter((i: any) => i.included !== false)
    .map((i: any) => {
      let q = D(i.quantity || 0);
      // Feed blocks retain independent bases. Reweight within each block, never sum all blocks together.
      if (i.group && i.share != null) {
        const basis = (model.groupBases || {})[i.group];
        if (!basis) {
          errors.push(
            `Nedostaje potvrđena osnova hranidbenog bloka ${i.group}.`,
          );
        } else {
          let base = D(basis);
          if (model.weights && p.sellWeight != null) {
            const w = model.weights;
            const original = D(w.sell).sub(w.buy || 0);
            const actual = D(p.sellWeight).sub(p.buyWeight || 0);
            if (actual.lte(0))
              errors.push("Prodajna težina mora biti veća od kupovne.");
            else if (original.gt(0)) base = base.mul(actual).div(original);
          }
          q = base.mul(i.share).div(100);
        }
      }
      const quantity = q.mul(factor);
      if (quantity.gt(0) && (i.price == null || i.price === ""))
        errors.push(`${i.id}: nedostaje cena pri pozitivnoj količini.`);
      const cost =
        i.price == null || i.price === ""
          ? null
          : quantity.mul(i.price).toString();
      return {
        id: i.id,
        name: i.name,
        unit: i.unit,
        quantity: quantity.toString(),
        price: i.price,
        cost,
      };
    });
  return {
    total: errors.length
      ? null
      : lines
          .reduce((s: Decimal, i: any) => s.add(i.cost || 0), D(0))
          .toString(),
    lines,
    errors: [...new Set(errors)],
  };
}
export function currencySnapshot(
  amount: string,
  currency: "RSD" | "EUR",
  date: string,
  rate: any,
) {
  if (!rate)
    throw Error("Nedostaje zvanični kurs za datum događaja. Sačuvajte nacrt.");
  const n = D(amount);
  if (n.lt(0)) throw Error("Iznos ne može biti negativan.");
  return {
    original: n.toString(),
    currency,
    date,
    rsd: (currency === "RSD" ? n : n.mul(rate.rate)).toString(),
    eur: (currency === "EUR" ? n : n.div(rate.rate)).toString(),
    rate: String(rate.rate),
    rateDate: String(rate.valid_from).slice(0, 10),
    validTo: String(rate.valid_to).slice(0, 10),
    source: rate.source_url,
  };
}
export function fiveYears(observations: any[], currentYear: number) {
  const finished = observations.filter((o) => o.period < currentYear);
  const last = finished.length
    ? Math.max(...finished.map((o) => o.period))
    : currentYear - 1;
  const points = Array.from({ length: 5 }, (_, i) => {
    const year = last - 4 + i;
    const row = finished.find((o) => o.period === year);
    const previous = finished.find((o) => o.period === year - 1);
    return {
      period: year,
      value: row?.value ?? null,
      status: row?.status ?? "Nema potvrđenih podataka",
      change:
        row?.value != null &&
        previous?.value != null &&
        !D(previous.value).isZero()
          ? D(row.value)
              .sub(previous.value)
              .div(previous.value)
              .mul(100)
              .toString()
          : null,
      observation: row || null,
    };
  });
  const values = points.filter((o) => o.value != null);
  return {
    points,
    mean: values.length
      ? values
          .reduce((s, o) => s.add(o.value), D(0))
          .div(values.length)
          .toString()
      : null,
    count: values.length,
    current: observations.filter((o) => o.period >= currentYear),
  };
}
