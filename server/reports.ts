import { db, Conn, transaction } from "./db.js";
import {
  calculateNorm,
  D,
  margin,
  convertQuantity,
  currencySnapshot,
} from "./domain.js";
export async function rateFor(date: string, conn: Conn = db) {
  return (
    await conn.query(
      "SELECT *,valid_from::text AS valid_from,valid_to::text AS valid_to FROM exchange_rates WHERE valid_from<=$1 AND valid_to>=$1 ORDER BY exchange_rates.valid_from DESC LIMIT 1",
      [date],
    )
  ).rows[0];
}
export async function snapshotMoney(
  amount: string,
  currency: "RSD" | "EUR",
  date: string,
  conn: Conn = db,
) {
  return currencySnapshot(amount, currency, date, await rateFor(date, conn));
}
export async function normFor(p: any, conn: Conn = db) {
  const date = p.details.end || `${p.year}-12-31`,
    start = p.details.start || `${p.year}-01-01`;
  const rate = await rateFor(date, conn);
  const exchangeRate = {
    date,
    value: rate ? D(rate.rate).toString() : null,
    validFrom: rate?.valid_from || null,
    validTo: rate?.valid_to || null,
    source: rate?.source_url || null,
  };
  const version = (
    await conn.query(
      "SELECT *,valid_from::text AS valid_from,valid_to::text AS valid_to FROM norm_versions WHERE template_id=$1 AND status='active' AND valid_from<=$2 AND valid_to>=$3 ORDER BY created_at DESC LIMIT 1",
      [p.template_id, start, date],
    )
  ).rows[0];
  if (!version)
    return {
      total: null,
      lines: [],
      errors: ["Nema aktivnog kompletnog normativa za ceo period."],
      version: null,
      money: null,
      exchangeRate,
    };
  const calc = calculateNorm(version.model, p.details);
  return {
    ...calc,
    version,
    exchangeRate,
    money:
      calc.total && rate
        ? currencySnapshot(calc.total, "EUR", date, rate)
        : null,
    errors: [
      ...calc.errors,
      ...(!rate ? [`Nedostaje zvanični kurs za datum obračuna ${date}.`] : []),
    ],
  };
}
export async function report(farmId: string, productionId?: string) {
  return transaction(async (tx) => {
    await tx.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
    return reportData(farmId, productionId, tx);
  });
}
async function reportData(
  farmId: string,
  productionId: string | undefined,
  conn: Conn,
) {
  const farm = (await conn.query("SELECT * FROM farms WHERE id=$1", [farmId]))
    .rows[0];
  const key = farm.currency === "EUR" ? "eur" : "rsd";
  const valueKey = key === "eur" ? "value_eur" : "value_rsd";
  const prods = (
    await conn.query(
      "SELECT p.*,t.name AS template_name,t.basis FROM production_periods p JOIN templates t ON t.id=p.template_id WHERE p.farm_id=$1 AND p.year=$2" +
        (productionId ? " AND p.id=$3" : ""),
      productionId ? [farmId, farm.year, productionId] : [farmId, farm.year],
    )
  ).rows;
  if (productionId && !prods.length) throw Error("Proizvodnja nije pronađena.");
  const allEvents = (
    await conn.query(
      "SELECT *,date::text AS date FROM business_events WHERE farm_id=$1 AND EXTRACT(YEAR FROM date)=$2",
      [farmId, farm.year],
    )
  ).rows;
  const transfers = (
    await conn.query("SELECT * FROM internal_transfers WHERE farm_id=$1", [
      farmId,
    ])
  ).rows;
  const feed = (
    await conn.query(
      "SELECT * FROM feed_consumption WHERE farm_id=$1 AND EXTRACT(YEAR FROM date)=$2",
      [farmId, farm.year],
    )
  ).rows;
  const movements = (
    await conn.query("SELECT * FROM inventory_movements WHERE farm_id=$1", [
      farmId,
    ])
  ).rows;
  const results: any[] = [];
  for (const p of prods) {
    const events = allEvents.filter(
      (e) =>
        e.production_id === p.id &&
        e.status !== "draft" &&
        e.status !== "requested",
    );
    const norm = await normFor(p, conn);
    const details = p.details;
    const missing = [...norm.errors];
    const sales = events.filter((e) => e.kind === "sale");
    const revenue = sales.reduce<ReturnType<typeof D>>(
      (s, e) => s.add(e.money?.[key] || 0),
      D(0),
    );
    const subsidies = events
      .filter((e) => e.kind === "subsidy")
      .reduce<ReturnType<typeof D>>((s, e) => s.add(e.money?.[key] || 0), D(0));
    const other = events
      .filter((e) => e.kind === "other_income")
      .reduce<ReturnType<typeof D>>((s, e) => s.add(e.money?.[key] || 0), D(0));
    const costs = events.filter(
      (e) => e.kind === "cost" && !e.details.inventoryPurchase,
    );
    let actual = costs.reduce<ReturnType<typeof D>>(
      (s, e) => s.add(e.money?.[key] || 0),
      D(0),
    );
    actual = actual.add(
      feed
        .filter((f) => f.production_id === p.id)
        .reduce<ReturnType<typeof D>>((s, f) => s.add(f[valueKey]), D(0)),
    );
    const product = details.product || p.template_name;
    const producedByproducts = movements.filter(
      (m) => m.production_id === p.id && m.kind === "byproduct",
    );
    const allocations = norm.version?.model.byproductAllocations || {};
    const mainShare = D(100)
      .sub(
        Object.values(allocations).reduce<ReturnType<typeof D>>(
          (s, a: any) => s.add(a),
          D(0),
        ),
      )
      .div(100);
    let sold = D(0),
      fraction = D(0),
      allocationError = false;
    const output = details.output != null ? D(details.output) : null;
    for (const sale of sales) {
      try {
        if (sale.details.product === product) {
          sold = sold.add(
            convertQuantity(
              sale.details.quantity,
              sale.details.unit,
              details.outputUnit,
            ),
          );
        } else {
          const by = producedByproducts.filter(
            (m) => m.product === sale.details.product,
          );
          const base = by[0]?.unit;
          const qty = base
            ? by.reduce<ReturnType<typeof D>>(
                (s, m) => s.add(convertQuantity(m.quantity, m.unit, base)),
                D(0),
              )
            : D(0);
          if (allocations[sale.details.product] == null || qty.lte(0)) {
            missing.push(
              `Nusproizvod ${sale.details.product}: nedostaje odobrena raspodela zajedničkog troška ili ostvarena količina.`,
            );
            allocationError = true;
          } else
            fraction = fraction.add(
              convertQuantity(sale.details.quantity, sale.details.unit, base)
                .div(qty)
                .mul(allocations[sale.details.product])
                .div(100),
            );
        }
      } catch {
        missing.push("Prodaja i proizvodnja imaju neusklađene jedinice.");
        allocationError = true;
      }
    }
    if (output && output.gt(0))
      fraction = fraction.add(
        DecimalMin(sold.div(output), D(1)).mul(mainShare),
      );
    else if (output?.isZero()) fraction = D(1);
    else {
      missing.push("Nedostaje ostvarena količina.");
      allocationError = true;
    }
    let normative = norm.money ? D(norm.money[key]) : null;
    // Actual entries never silently add to normative costs. Replacements are explicit and traceable.
    let combined = normative;
    const replacements = [];
    for (const c of costs.filter((c) => c.details.replaceNorm)) {
      const line = norm.lines.find((l: any) => l.id === c.details.normItemId);
      if (!line || line.cost === null || !norm.money) {
        missing.push(`Zamena ${c.title}: nedostaje normativna veza.`);
        continue;
      }
      const previous = D(line.cost).mul(key === "rsd" ? norm.money.rate : 1);
      combined = combined?.sub(previous).add(c.money[key]) || null;
      replacements.push({
        eventId: c.id,
        line: line.id,
        previous: previous.toString(),
        actual: c.money[key],
      });
    }
    if (combined)
      combined = combined.add(
        costs
          .filter((c) => c.details.combinedAdditional && !c.details.replaceNorm)
          .reduce<ReturnType<typeof D>>((s, c) => s.add(c.money[key]), D(0)),
      );
    const transferredOut = transfers.filter((t) => t.from_production === p.id);
    const transferredIn = transfers.filter((t) => t.to_production === p.id);
    // Traced feed replaces only the corresponding normative quantity; excess actual use remains separate.
    const covered = new Map<string, ReturnType<typeof D>>();
    for (const f of feed.filter((f) => f.production_id === p.id)) {
      const own = transfers.some(
        (t) => t.to_production === p.id && t.product === f.product,
      );
      if (!f.norm_item_id) {
        if (own) {
          missing.push("Potrošnja sopstvene hrane nema normativnu vezu.");
          normative = null;
          combined = null;
        }
        continue;
      }
      const line = norm.lines.find((l: any) => l.id === f.norm_item_id);
      if (!line || !norm.money || line.price == null) {
        missing.push("Potrošnja hrane nema odobrenu normativnu vezu.");
        normative = null;
        combined = null;
        continue;
      }
      try {
        const q = convertQuantity(f.quantity, f.unit, line.unit);
        const used = covered.get(line.id) || D(0);
        const available = D(line.quantity).sub(used);
        const applied = DecimalMin(q, available.gt(0) ? available : D(0));
        covered.set(line.id, used.add(applied));
        const old = applied
          .mul(line.price)
          .mul(key === "rsd" ? norm.money.rate : 1);
        const traced = D(f[valueKey]).div(q).mul(applied);
        const delta = traced.sub(old);
        normative = normative?.add(delta) || null;
        combined = combined?.add(delta) || null;
      } catch {
        missing.push("Neusklađena jedinica hrane i normativne stavke.");
        normative = null;
        combined = null;
      }
    }
    const household = movements
      .filter((m) => m.production_id === p.id && m.kind === "household")
      .reduce<ReturnType<typeof D>>((s, m) => s.add(m[valueKey] || 0), D(0))
      .abs();
    const unsold = movements
      .filter(
        (m) =>
          m.production_id === p.id &&
          m.kind !== "feed_use" &&
          m.product === (details.product || p.template_name),
      )
      .reduce<ReturnType<typeof D>>((s, m) => s.add(m.quantity), D(0));
    const byproducts = [
      ...new Set(producedByproducts.map((m) => m.product)),
    ].map((name) => {
      const original = producedByproducts.filter((m) => m.product === name),
        u = original[0].unit;
      const quantity = original.reduce<ReturnType<typeof D>>(
        (s, m) => s.add(convertQuantity(m.quantity, m.unit, u)),
        D(0),
      );
      const ending = movements
        .filter((m) => m.production_id === p.id && m.product === name)
        .reduce<ReturnType<typeof D>>(
          (s, m) => s.add(convertQuantity(m.quantity, m.unit, u)),
          D(0),
        );
      return {
        product: name,
        unit: u,
        quantity: quantity.toString(),
        ending: ending.toString(),
        costShare: allocations[name] ?? null,
        value:
          allocations[name] != null && normative && quantity.gt(0)
            ? normative
                .mul(allocations[name])
                .div(100)
                .mul(ending)
                .div(quantity)
                .toString()
            : null,
      };
    });
    if (byproducts.some((b) => D(b.ending).gt(0)))
      missing.push("Postoje neprodati nusproizvodi.");
    if (p.status === "draft") missing.push("Proizvodnja je nacrt.");
    if (allEvents.some((e) => e.production_id === p.id && e.status === "draft"))
      missing.push("Postoje nedovršeni poslovni događaji.");
    if (unsold.gt(0) || !p.actual_complete)
      missing.push("Privremeno — ciklus ili evidencija nije završena.");
    // Source crop costs of internal transfers stay in the receiving production through traced feed consumption;
    // an internal transfer itself creates neither revenue nor a second farm expense.
    const assignedNorm = !allocationError
      ? normative?.mul(fraction) || null
      : null;
    const assignedCombined = !allocationError
      ? combined?.mul(fraction) || null
      : null;
    const assignedActual = actual.mul(fraction);
    results.push({
      id: p.id,
      name: p.name,
      template: p.template_name,
      details,
      year: p.year,
      norm,
      version: norm.version
        ? {
            id: norm.version.id,
            name: norm.version.name,
            validFrom: norm.version.valid_from,
            validTo: norm.version.valid_to,
          }
        : null,
      revenue: revenue.toString(),
      subsidies: subsidies.toString(),
      other: other.toString(),
      normativeTotal: normative?.toString() ?? null,
      normativeCost: assignedNorm?.toString() ?? null,
      actualCost: assignedActual.toString(),
      combinedCost: assignedCombined?.toString() ?? null,
      withoutSubsidies: assignedNorm
        ? margin(revenue.add(other).toString(), assignedNorm.toString())
        : null,
      withSubsidies: assignedNorm
        ? margin(
            revenue.add(other).add(subsidies).toString(),
            assignedNorm.toString(),
          )
        : null,
      actualWithoutSubsidies: margin(
        revenue.add(other).toString(),
        assignedActual.toString(),
      ),
      actualResult: margin(
        revenue.add(other).add(subsidies).toString(),
        assignedActual.toString(),
      ),
      actualStatus: p.actual_complete
        ? "Evidencija potvrđena"
        : "Privremeno — evidencija nije završena",
      combinedWithoutSubsidies: assignedCombined
        ? margin(revenue.add(other).toString(), assignedCombined.toString())
        : null,
      combinedResult: assignedCombined
        ? margin(
            revenue.add(other).add(subsidies).toString(),
            assignedCombined.toString(),
          )
        : null,
      missing: [...new Set(missing)],
      replacements,
      byproducts,
      sold: sold.toString(),
      output: output?.toString() ?? null,
      stock: unsold.toString(),
      household: household.toString(),
      stockValue:
        output?.gt(0) && normative
          ? normative.mul(mainShare).mul(unsold).div(output).toString()
          : null,
      internalOut: transferredOut,
      internalIn: transferredIn,
    });
  }
  const farmEvents = productionId
    ? []
    : allEvents.filter(
        (e) =>
          !e.production_id && e.status !== "draft" && e.status !== "requested",
      );
  const sum = (field: string) =>
    results.reduce<ReturnType<typeof D>>(
      (s, r: any) => s.add(r[field] || 0),
      D(0),
    );
  const revenue = sum("revenue").add(
    farmEvents
      .filter((e) => e.kind === "other_income" || e.kind === "sale")
      .reduce<ReturnType<typeof D>>((s, e) => s.add(e.money?.[key] || 0), D(0)),
  );
  const subsidies = sum("subsidies").add(
    farmEvents
      .filter((e) => e.kind === "subsidy")
      .reduce<ReturnType<typeof D>>((s, e) => s.add(e.money?.[key] || 0), D(0)),
  );
  const actual = sum("actualCost").add(
    farmEvents
      .filter((e) => e.kind === "cost" && !e.details.inventoryPurchase)
      .reduce<ReturnType<typeof D>>((s, e) => s.add(e.money?.[key] || 0), D(0)),
  );
  const complete =
    results.length > 0 && results.every((r) => r.normativeCost !== null);
  const normCost = complete ? sum("normativeCost") : null;
  const payments = (
    await conn.query(
      "SELECT *,date::text AS date FROM payments WHERE farm_id=$1 AND EXTRACT(YEAR FROM date)=$2 ORDER BY payments.date",
      [farmId, farm.year],
    )
  ).rows.filter(
    (p) =>
      !productionId ||
      allEvents.find((e) => e.id === p.event_id)?.production_id ===
        productionId,
  );
  const opening = (
    await conn.query(
      "SELECT money FROM opening_balances WHERE farm_id=$1 AND year=$2",
      [farmId, farm.year],
    )
  ).rows[0]?.money;
  let balance = opening ? D(opening[key]) : null;
  const cashflow = Array.from({ length: 12 }, (_, i) => {
    const month = `${farm.year}-${String(i + 1).padStart(2, "0")}`;
    const entries = payments.filter((p) => p.date.startsWith(month));
    const incoming = entries
      .filter((p) => p.direction === "in")
      .reduce<ReturnType<typeof D>>((s, p) => s.add(p.money[key]), D(0));
    const outgoing = entries
      .filter((p) => p.direction === "out")
      .reduce<ReturnType<typeof D>>((s, p) => s.add(p.money[key]), D(0));
    const net = incoming.sub(outgoing);
    const start = balance?.toString() ?? null;
    if (balance) balance = balance.add(net);
    return {
      month,
      opening: start,
      incoming: incoming.toString(),
      outgoing: outgoing.toString(),
      net: net.toString(),
      closing: balance?.toString() ?? null,
    };
  });
  const outstanding = allEvents
    .filter(
      (e) =>
        (!productionId || e.production_id === productionId) &&
        e.status !== "draft" &&
        ["sale", "cost"].includes(e.kind),
    )
    .map((e) => {
      const paid = payments
        .filter((p) => p.event_id === e.id)
        .reduce<ReturnType<typeof D>>(
          (s, p) =>
            s.add(
              D(p.money.original).mul(
                p.money.currency === e.money.currency
                  ? 1
                  : p.money.currency === "EUR"
                    ? p.money.rate
                    : D(1).div(p.money.rate),
              ),
            ),
          D(0),
        );
      return {
        id: e.id,
        title: e.title,
        kind: e.kind,
        currency: e.money.currency,
        remaining: D(e.money.original).sub(paid).toString(),
      };
    });
  return {
    farm,
    productionId: productionId || null,
    generatedAt: new Date().toISOString(),
    currency: farm.currency,
    displayCurrency: farm.currency,
    method: "Obračun po normativu",
    coverage:
      "Izvorni materijal, hraniva, gorivo, veterinarski i odobreni varijabilni troškovi. Bez amortizacije, porodičnog rada, opštih troškova i poreskog obračuna.",
    status:
      results.some((r) => r.missing.length) || !results.length
        ? "Nepotpun / privremen obračun"
        : "Obračun perioda",
    results,
    totals: {
      revenue: revenue.add(sum("other")).toString(),
      subsidies: subsidies.toString(),
      normativeCost: normCost?.toString() ?? null,
      actualCost: actual.toString(),
      margin: normCost
        ? margin(
            revenue.add(sum("other")).add(subsidies).toString(),
            normCost.toString(),
          )
        : null,
      withoutSubsidies: normCost
        ? margin(revenue.add(sum("other")).toString(), normCost.toString())
        : null,
      netCash: cashflow
        .reduce<ReturnType<typeof D>>((s, m) => s.add(m.net), D(0))
        .toString(),
    },
    cashflow,
    cashTotals: {
      incoming: cashflow
        .reduce<ReturnType<typeof D>>((s, m) => s.add(m.incoming), D(0))
        .toString(),
      outgoing: cashflow
        .reduce<ReturnType<typeof D>>((s, m) => s.add(m.outgoing), D(0))
        .toString(),
    },
    outstanding,
    payments,
    events: allEvents.filter(
      (e) => !productionId || e.production_id === productionId,
    ),
    sources: [
      ...new Set(results.map((r) => r.norm.money?.source).filter(Boolean)),
    ],
    rounding:
      "Decimalna aritmetika, 36 cifara; prikaz novca na 2 decimale HALF_UP. Procenti na 2 decimale. Izvorni i konvertovani iznosi čuvaju punu preciznost.",
  };
}
function DecimalMin(a: ReturnType<typeof D>, b: ReturnType<typeof D>) {
  return a.lt(b) ? a : b;
}
