import { readFileSync } from "node:fs";
import { D, normalizedScale, validateModel } from "./domain.js";

export type CalendarPolicy = {
  inheritMonths: boolean;
  rangeRule: "equal" | "first" | "manual";
  seasonRule: "cycle" | "calendar";
  preferAuxiliary: boolean;
};
export const proposedCalendarPolicy: CalendarPolicy = {
  inheritMonths: true,
  rangeRule: "equal",
  seasonRule: "cycle",
  preferAuxiliary: true,
};
export const calendarMethod = "source-month-calendar-v1";
const source = JSON.parse(
  readFileSync(
    new URL("../source/monthly-calendar-audit.json", import.meta.url),
    "utf8",
  ),
);
const cards = new Map<string, any>(
  source.cards.map((c: any) => [c.templateId, c]),
);
const roman = [
  "I",
  "II",
  "III",
  "IV",
  "V",
  "VI",
  "VII",
  "VIII",
  "IX",
  "X",
  "XI",
  "XII",
];
export type MonthPart = { month: number; yearStep: number };
export function parseMonths(raw: unknown): MonthPart[] {
  if (typeof raw !== "string" && typeof raw !== "number")
    throw Error("Nedostaje mesec.");
  const s = String(raw)
    .trim()
    .toUpperCase()
    .replace(/[–—]/g, "-")
    .replace(/\s/g, "");
  if (!s || s.includes("/"))
    throw Error(
      "Nejasan zapis meseca; administrator treba da potvrdi raspored.",
    );
  const number = (part: string) => {
    const n = roman.indexOf(part) + 1;
    if (n) return n;
    if (/^(?:[1-9]|1[0-2])$/.test(part)) return Number(part);
    throw Error("Neprepoznat mesec: " + part);
  };
  const result: MonthPart[] = [];
  let step = 0,
    previous = 0;
  for (const token of s.split(",")) {
    const pair = token.split("-");
    if (pair.length > 2) throw Error("Nejasan raspon meseci.");
    const from = number(pair[0]),
      to = pair.length === 2 ? number(pair[1]) : from;
    if (previous && from < previous) step++;
    const count = ((to - from + 12) % 12) + 1;
    for (let n = 0; n < count; n++) {
      const month = ((from + n - 1) % 12) + 1;
      result.push({ month, yearStep: step + Math.floor((from + n - 1) / 12) });
    }
    step = result.at(-1)!.yearStep;
    previous = to;
  }
  if (
    new Set(result.map((r) => r.month + ":" + r.yearStep)).size !==
    result.length
  )
    throw Error("Mesec se ponavlja u istom rasporedu.");
  if (result.some((r) => r.yearStep > 1))
    throw Error(
      "Raspored meseci prelazi više od jednog prelaza godine; potvrdite raspored.",
    );
  return result;
}
type Rational = { n: bigint; d: bigint };
const gcd = (a: bigint, b: bigint): bigint => (b ? gcd(b, a % b) : a);
function rational(n: string, d: string): Rational {
  if (
    !/^\d{1,18}$/.test(n) ||
    !/^\d{1,18}$/.test(d) ||
    BigInt(n) <= 0 ||
    BigInt(d) <= 0
  )
    throw Error("Neispravna raspodela meseci.");
  const divisor = gcd(BigInt(n), BigInt(d));
  return { n: BigInt(n) / divisor, d: BigInt(d) / divisor };
}
function sumOne(values: Rational[]) {
  const sum = values.reduce(
    (s, v) => {
      const n = s.n * v.d + v.n * s.d,
        d = s.d * v.d,
        g = gcd(n, d);
      return { n: n / g, d: d / g };
    },
    { n: 0n, d: 1n },
  );
  return sum.n === sum.d;
}
function percentage(value: string): Rational {
  if (
    !/^\d{1,3}(?:\.\d{1,8})?$/.test(value) ||
    D(value).lte(0) ||
    D(value).gt(100)
  )
    throw Error("Udeo mora biti veći od 0 i najviše 100%.");
  const decimals = value.split(".")[1]?.length || 0;
  return rational(
    value.replace(".", ""),
    (100n * 10n ** BigInt(decimals)).toString(),
  );
}
export function validateCalendarOverrides(items: any[]) {
  const errors: string[] = [];
  for (const item of items) {
    if (
      item.calendarYearOffset != null &&
      ![-1, 0, 1].includes(item.calendarYearOffset)
    )
      errors.push(`${item.id}: neispravna godina mesečnog rasporeda.`);
    if (item.monthDistribution == null) continue;
    try {
      if (
        !Array.isArray(item.monthDistribution) ||
        !item.monthDistribution.length ||
        item.monthDistribution.length > 12
      )
        throw Error("neispravna mesečna raspodela");
      const parts = item.monthDistribution.map((p: any) => {
        if (!Number.isInteger(p.month) || p.month < 1 || p.month > 12)
          throw Error("nepoznat mesec");
        return percentage(String(p.share));
      });
      if (
        new Set(item.monthDistribution.map((p: any) => p.month)).size !==
          parts.length ||
        !sumOne(parts)
      )
        throw Error(
          "mesečni udeli moraju dati tačno 100%, bez ponavljanja meseca",
        );
    } catch (e) {
      errors.push(`${item.id}: ${(e as Error).message}.`);
    }
  }
  return errors;
}
const monthString = (year: number, month: number) =>
  `${year}-${String(month).padStart(2, "0")}`;
export function calendarFor(
  model: any,
  templateId: string,
  year: number,
  policy: CalendarPolicy,
) {
  const card = cards.get(templateId),
    items: any[] = [],
    warnings: string[] = [];
  let context: { value: unknown; cell: string } | null = null,
    priorFirst = 0,
    split = -1;
  for (let n = 0; n < model.items.length; n++) {
    const item = model.items[n],
      row = String(item.id).match(/\d+/)?.[0];
    const evidence =
      card?.sheet === model.sheet
        ? card.items.find(
            (i: any) =>
              i.id === item.id &&
              i.name === item.name &&
              i.quantityCell === item.quantityCell,
          )
        : null;
    if (item.month != null && String(item.month).trim())
      context = { value: item.month, cell: row ? "C" + row : item.id };
    const raw =
      item.month != null && String(item.month).trim()
        ? item.month
        : policy.inheritMonths
          ? context?.value
          : null;
    const notes: string[] = [],
      errors: string[] = [];
    let months: MonthPart[] = [];
    try {
      months = parseMonths(raw);
    } catch (e) {
      errors.push((e as Error).message);
    }
    const first = months[0]?.month;
    if (first && split < 0 && priorFirst >= 7 && first <= 6) split = n;
    if (first) priorFirst = first;
    if (item.month == null && raw != null)
      notes.push(
        `Mesec preuzet iz pripadajućeg bloka ${model.sheet}!${context?.cell}.`,
      );
    if (
      evidence &&
      String(evidence.originalMonth ?? "") !== String(item.month ?? "")
    )
      notes.push(
        `Mesec je izmenjen u odobrenom normativu; izvorni ${evidence.monthCell}: ${evidence.originalMonth ?? "prazno"}.`,
      );
    const data: any = {
      item,
      evidence,
      months,
      errors,
      notes,
      index: n,
      rawMonth: item.month ?? null,
      monthSource: context?.cell || null,
    };
    items.push(data);
  }
  for (const data of items) {
    const { item, evidence, months, errors, notes, index } = data;
    let parts: {
      month: number;
      yearStep: number;
      weight: Rational;
      sourceCell?: string;
    }[] = [];
    if (item.monthDistribution != null) {
      try {
        if (
          !Array.isArray(item.monthDistribution) ||
          !item.monthDistribution.length ||
          item.monthDistribution.length > 12
        )
          throw Error("Neispravna mesečna raspodela.");
        const list = item.monthDistribution.map((p: any) => {
          if (!Number.isInteger(p.month) || p.month < 1 || p.month > 12)
            throw Error("Nepoznat mesec raspodele.");
          return {
            month: p.month,
            yearStep:
              months.find((m: MonthPart) => m.month === p.month)?.yearStep ??
              (policy.seasonRule === "cycle" &&
              split >= 0 &&
              index < split &&
              months[0] &&
              p.month < months[0].month
                ? 1
                : 0),
            weight: percentage(String(p.share)),
          };
        });
        if (
          new Set(list.map((p: any) => p.month)).size !== list.length ||
          !sumOne(list.map((p: any) => p.weight))
        )
          throw Error(
            "Mesečni udeli moraju dati tačno 100%, bez ponavljanja meseca.",
          );
        parts = list;
        errors.length = 0;
        notes.push("Mesečna raspodela iz odobrene verzije normativa.");
      } catch (e) {
        errors.push((e as Error).message);
      }
    } else if (months.length && !errors.length) {
      const helper = evidence?.helperWeights || [];
      const unchanged =
        evidence &&
        String(evidence.originalMonth ?? "") === String(item.month ?? "");
      let validHelper = false;
      if (
        policy.preferAuxiliary &&
        unchanged &&
        helper.length &&
        !card?.helperErrors?.length
      ) {
        try {
          const weighted = helper.map((p: any) => ({
            ...p,
            weight: rational(p.numerator, p.denominator),
          }));
          validHelper =
            sumOne(weighted.map((p: any) => p.weight)) &&
            weighted.every((p: any) =>
              months.some((m: any) => m.month === p.month),
            );
          if (validHelper) {
            parts = weighted.map((p: any) => ({
              month: p.month,
              yearStep: months.find((m: any) => m.month === p.month).yearStep,
              weight: p.weight,
              sourceCell: p.cell,
            }));
            notes.push(
              "Usaglašena izvorna raspodela iz pomoćnog sheeta Zalihe na parceli.",
            );
          } else
            notes.push(
              "Pomoćna formula nije usaglašena sa kolonom C ili zbirom 1; koristi se raspored kolone C.",
            );
        } catch {
          notes.push("Pomoćna raspodela zahteva pregled; nije primenjena.");
        }
      }
      if (!validHelper) {
        if (months.length === 1)
          parts = [{ ...months[0], weight: { n: 1n, d: 1n } }];
        else if (policy.rangeRule === "manual")
          errors.push("Višemesečni red zahteva admin raspodelu.");
        else if (policy.rangeRule === "first") {
          parts = [{ ...months[0], weight: { n: 1n, d: 1n } }];
          notes.push(
            "Ceo normativni trošak u prvom mesecu — odobreno opšte pravilo.",
          );
        } else {
          parts = months.map((m: MonthPart) => ({
            ...m,
            weight: { n: 1n, d: BigInt(months.length) },
          }));
          notes.push(
            "Ravnomerna normativna raspodela po navedenim mesecima — nije dokaz pojedinačnog izvršenja.",
          );
        }
      }
    }
    let yearOffset =
      policy.seasonRule === "cycle" && split >= 0 && index < split ? -1 : 0;
    if (item.calendarYearOffset != null) {
      if (![-1, 0, 1].includes(item.calendarYearOffset))
        errors.push("Neispravan pomeraj godine.");
      else yearOffset = item.calendarYearOffset;
    }
    data.parts = parts
      .map((p) => ({
        ...p,
        date: monthString(
          year + yearOffset + (policy.seasonRule === "cycle" ? p.yearStep : 0),
          p.month,
        ),
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
    if (
      policy.seasonRule === "cycle" &&
      item.calendarYearOffset == null &&
      data.parts.some((p: any) => Number(p.date.slice(0, 4)) > year)
    ) {
      errors.push(
        "Zimski raspon nema potvrđenu godinu; administrator treba da odredi godinu ovog troška u normativu.",
      );
      data.parts = [];
    }
    data.yearOffset = yearOffset;
  }
  return {
    items,
    warnings,
    sourceHash: card?.sheet === model.sheet ? source.sourceHash : null,
    method: calendarMethod,
  };
}
export function calculateMonthlyCosts(
  model: any,
  templateId: string,
  production: any,
  asOf: string,
  policy: CalendarPolicy,
  rsdFactor = "1",
) {
  const errors: string[] = [],
    warnings: string[] = [];
  if (!["ha", "m2"].includes(model.basis))
    return {
      supported: false,
      lines: [],
      months: [],
      cumulative: null,
      knownCumulative: "0",
      currentMonth: null,
      fullCost: null,
      errors: [
        "Mesečna ulaganja u zemlji podržana su za biljne proizvodnje sa površinom.",
      ],
      warnings,
    };
  let scale;
  try {
    scale = normalizedScale(model, production.details);
  } catch (e) {
    return {
      supported: true,
      lines: [],
      months: [],
      cumulative: null,
      knownCumulative: "0",
      currentMonth: null,
      fullCost: null,
      errors: [(e as Error).message],
      warnings,
    };
  }
  const schedule = calendarFor(model, templateId, production.year, policy),
    monthly = new Map<
      string,
      { known: ReturnType<typeof D>; missing: boolean }
    >();
  const included = schedule.items.filter((d) => d.item.included !== false),
    globalErrors = validateModel(model).filter(
      (error) => !model.items.some((i: any) => error.startsWith(i.id + ":")),
    );
  const sourceCard = cards.get(templateId);
  const gaps =
    sourceCard?.sheet === model.sheet
      ? (sourceCard.missingSourceRows || []).filter(
          (gap: any) => !model.items.some((i: any) => i.id === gap.id),
        )
      : [];
  if (gaps.length)
    globalErrors.push(
      `Izvorna karta ima ${gaps.length} redova koji nisu u odobrenom modelu (${gaps.map((g: any) => g.id).join(", ")}). Potreban je admin pregled pre potpunog mesečnog obračuna.`,
    );
  errors.push(...globalErrors);
  let allFullKnown = true,
    full = D(0),
    known = D(0),
    current = D(0),
    totalMissing = false;
  const lines = included.map((data) => {
    const { item, parts, notes } = data,
      issues = [...data.errors];
    let quantity: ReturnType<typeof D> | null = null,
      fullCost: ReturnType<typeof D> | null = null,
      unitPrice: ReturnType<typeof D> | null = null;
    try {
      if (item.quantity == null || item.quantity === "")
        throw Error("Nedostaje normirana potrošnja.");
      quantity = D(item.quantity).mul(scale);
      if (quantity.lt(0)) throw Error("Potrošnja ne može biti negativna.");
      if (item.price != null && item.price !== "")
        unitPrice = D(item.price).mul(rsdFactor);
      if (quantity.isZero()) {
        fullCost = D(0);
        issues.length = 0;
      } else if (
        unitPrice != null &&
        unitPrice.gte(0) &&
        (!unitPrice.isZero() || item.zeroReason)
      )
        fullCost = quantity.mul(unitPrice);
    } catch (e) {
      issues.push((e as Error).message);
      quantity = null;
    }
    if (fullCost != null) full = full.add(fullCost);
    else allFullKnown = false;
    const active = quantity == null || quantity.gt(0);
    const allocation: any[] = [];
    let consumed = D(0),
      due = D(0),
      thisMonth = D(0),
      assigned = D(0),
      quantityAssigned = D(0),
      uncertain =
        active &&
        (!parts.length || parts.some((p: any) => p.date <= asOf)) &&
        !!issues.length;
    for (let n = 0; n < parts.length; n++) {
      const part = parts[n],
        last = n === parts.length - 1;

      const value =
        fullCost == null
          ? null
          : last
            ? fullCost.sub(assigned)
            : fullCost
                .mul(part.weight.n.toString())
                .div(part.weight.d.toString());
      const amount =
        quantity == null
          ? null
          : last
            ? quantity.sub(quantityAssigned)
            : quantity
                .mul(part.weight.n.toString())
                .div(part.weight.d.toString());
      if (value != null) assigned = assigned.add(value);
      if (amount != null) quantityAssigned = quantityAssigned.add(amount);
      allocation.push({
        month: part.date,
        numerator: part.weight.n.toString(),
        denominator: part.weight.d.toString(),
        amount: value?.toString() ?? null,
        quantity: amount?.toString() ?? null,
        sourceCell: part.sourceCell
          ? `Zalihe na parceli!${part.sourceCell}`
          : `${model.sheet}!${data.monthSource || item.id}`,
      });
      if (!active) continue;
      const m = monthly.get(part.date) || { known: D(0), missing: false };
      if (
        value == null ||
        !item.unitConfirmed ||
        (item.flags?.includes("alternative") && !item.alternativeConfirmed)
      )
        m.missing = true;
      else m.known = m.known.add(value);
      monthly.set(part.date, m);
      if (part.date <= asOf) {
        if (amount != null) consumed = consumed.add(amount);
        if (value == null) uncertain = true;
        else due = due.add(value);
        if (part.date === asOf && value != null)
          thisMonth = thisMonth.add(value);
      }
    }
    const happens = parts.some((p: any) => p.date <= asOf);
    if (active && happens) {
      if (!item.unitConfirmed) issues.push("Jedinica nije potvrđena.");
      if (item.flags?.includes("alternative") && !item.alternativeConfirmed)
        issues.push("Alternativa nije potvrđena.");
      if (fullCost == null) issues.push("Nedostaje potvrđena cena.");
      uncertain ||= issues.length > 0;
    }
    if (active && !parts.length) {
      uncertain = true;
      if (!issues.length) issues.push("Nedostaje mesečni raspored.");
    }
    if (uncertain) {
      totalMissing = true;
      errors.push(...issues.map((i) => `${item.name} (${item.id}): ${i}`));
    }
    known = known.add(due);
    current = current.add(thisMonth);
    return {
      id: item.id,
      name: item.name,
      unit: item.unit,
      rawMonth: data.rawMonth,
      monthSource: data.monthSource,
      yearOffset: data.yearOffset,
      price: unitPrice?.toString() ?? null,
      normQuantity: item.quantity ?? null,
      reference: String(model.reference),
      basis: model.basis,
      quantity: quantity?.toString() ?? null,
      recognizedQuantity: quantity == null ? null : consumed.toString(),
      fullCost: fullCost?.toString() ?? null,
      perReferenceCost:
        quantity != null && unitPrice != null
          ? quantity.div(scale).mul(unitPrice).toString()
          : null,
      cumulative: uncertain ? null : due.toString(),
      knownCumulative: due.toString(),
      currentMonth: uncertain ? null : thisMonth.toString(),
      allocation,
      errors: [...new Set(issues)],
      notes,
    };
  });
  let cumulative = D(0),
    unresolved =
      errors.some((e) => !lines.some((l) => e.startsWith(l.name + " ("))) ||
      lines.some(
        (l) =>
          l.errors.length &&
          !l.allocation.length &&
          D(l.normQuantity || 0).gt(0),
      );
  const dates = [...monthly.keys(), asOf].sort();
  const first = dates[0];
  const last = dates.at(-1)!;
  const months: any[] = [];
  if (first && last) {
    let year = Number(first.slice(0, 4)),
      month = Number(first.slice(5));
    for (let n = 0; n < 36; n++) {
      const date = monthString(year, month);
      if (date > last) break;
      const m = monthly.get(date) || { known: D(0), missing: false };
      cumulative = cumulative.add(m.known);
      unresolved ||= m.missing;
      months.push({
        month: date,
        knownIncrease: m.known.toString(),
        increase: m.missing ? null : m.known.toString(),
        knownCumulative: cumulative.toString(),
        cumulative: unresolved ? null : cumulative.toString(),
        included: date <= asOf,
      });
      month++;
      if (month === 13) {
        month = 1;
        year++;
      }
    }
  }
  return {
    supported: true,
    lines,
    months,
    cumulative: totalMissing || globalErrors.length ? null : known.toString(),
    knownCumulative: known.toString(),
    currentMonth:
      totalMissing || globalErrors.length ? null : current.toString(),
    fullCost: allFullKnown ? full.toString() : null,
    errors: [...new Set(errors)],
    warnings,
    sourceHash: schedule.sourceHash,
    method: calendarMethod,
  };
}
