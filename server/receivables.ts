import { Router } from "express";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { db, transaction, type Conn } from "./db.js";
import { D } from "./domain.js";
import { todayInSerbia } from "../shared/dates.js";
import { dec, id } from "./validation.js";
import { UserError } from "./errors.js";

const TOLERANCE = D("0.005");

/** Iznos plaćanja izražen u valuti događaja; različita valuta traži kurs plaćanja. */
function inEventCurrency(m: any, currency: string) {
  if (m.currency === currency) return D(m.original);
  if (!m.rate)
    throw new UserError(
      "Za plaćanje u različitoj valuti potreban je kurs na datum plaćanja.",
    );
  return D(m.original).mul(m.currency === "EUR" ? m.rate : D(1).div(m.rate));
}
/** Isti kurs i datum, drugi iznos (za deljenje avansa). */
export function scaleMoney(m: any, original: string) {
  const n = D(original);
  const rate = m.rate ? D(m.rate) : null;
  return {
    ...m,
    original: n.toString(),
    rsd: (m.currency === "RSD" ? n : n.mul(rate!)).toString(),
    eur:
      m.currency === "EUR"
        ? n.toString()
        : rate
          ? n.div(rate).toString()
          : null,
  };
}

export type SaleRow = {
  id: string;
  title: string;
  buyer: string | null;
  date: string | null;
  dueDate: string | null;
  currency: string;
  amount: string;
  collected: string;
  remaining: string;
  remainingRsd: string;
  status: "paid" | "partial" | "open";
  overdue: boolean;
  daysOverdue: number;
};
export type AdvanceRow = {
  id: string;
  date: string;
  buyer: string | null;
  currency: string;
  amount: string;
  amountRsd: string;
  note: string;
};
export type ProductionReceivables = {
  sold: string;
  collected: string;
  outstanding: string;
  overdue: string;
  advances: string;
  sales: SaleRow[];
  advanceRows: AdvanceRow[];
};

const days = (a: string, b: string) =>
  Math.round((Date.parse(a) - Date.parse(b)) / 86400000);

export async function receivables(
  conn: Conn,
  farmId: string,
  year: number,
  today = todayInSerbia(),
) {
  const events = (
    await conn.query(
      `SELECT id,production_id,title,date::text AS date,money,details FROM business_events
       WHERE farm_id=$1 AND kind='sale' AND status='final' AND money IS NOT NULL
         AND production_id IS NOT NULL AND EXTRACT(YEAR FROM date)=$2
       ORDER BY date,created_at`,
      [farmId, year],
    )
  ).rows;
  const payments = (
    await conn.query(
      `SELECT id,event_id,production_id,advance,buyer,note,date::text AS date,money
       FROM payments WHERE farm_id=$1 AND direction='in' ORDER BY date,id`,
      [farmId],
    )
  ).rows;
  const items: Record<string, ProductionReceivables> = {};
  const ensure = (pid: string) =>
    (items[pid] ??= {
      sold: "0",
      collected: "0",
      outstanding: "0",
      overdue: "0",
      advances: "0",
      sales: [],
      advanceRows: [],
    });
  for (const e of events) {
    const row = ensure(e.production_id);
    const paid = payments
      .filter((p) => p.event_id === e.id)
      .reduce<ReturnType<typeof D>>(
        (s, p) => s.add(inEventCurrency(p.money, e.money.currency)),
        D(0),
      );
    let remaining = D(e.money.original).sub(paid);
    if (remaining.lt(0)) remaining = D(0);
    const remainingRsd = D(e.money.original).gt(0)
      ? remaining.mul(e.money.rsd).div(e.money.original)
      : D(0);
    const status = remaining.lte(TOLERANCE)
      ? "paid"
      : paid.gt(0)
        ? "partial"
        : "open";
    const dueDate = e.details?.dueDate || null;
    const overdue = !!dueDate && dueDate < today && status !== "paid";
    row.sales.push({
      id: e.id,
      title: e.title,
      buyer: e.details?.counterparty || null,
      date: e.date,
      dueDate,
      currency: e.money.currency,
      amount: e.money.original,
      collected: paid.toString(),
      remaining: remaining.toString(),
      remainingRsd: remainingRsd.toString(),
      status,
      overdue,
      daysOverdue: overdue ? days(today, dueDate) : 0,
    });
    row.sold = D(row.sold).add(e.money.rsd).toString();
    row.outstanding = D(row.outstanding).add(remainingRsd).toString();
    if (overdue) row.overdue = D(row.overdue).add(remainingRsd).toString();
  }
  for (const p of payments.filter((p) => p.advance && p.production_id)) {
    const row = ensure(p.production_id);
    row.advanceRows.push({
      id: p.id,
      date: p.date,
      buyer: p.buyer,
      currency: p.money.currency,
      amount: p.money.original,
      amountRsd: p.money.rsd,
      note: p.note || "",
    });
    row.advances = D(row.advances).add(p.money.rsd).toString();
  }
  for (const row of Object.values(items))
    row.collected = D(row.sold).sub(row.outstanding).toString();
  const all = Object.values(items);
  const sum = (f: (r: ProductionReceivables) => string) =>
    all.reduce((s, r) => s.add(f(r)), D(0)).toString();
  return {
    asOf: today,
    currency: "RSD",
    items,
    totals: {
      sold: sum((r) => r.sold),
      collected: sum((r) => r.collected),
      outstanding: sum((r) => r.outstanding),
      overdue: sum((r) => r.overdue),
      advances: sum((r) => r.advances),
    },
  };
}

export const collections = Router();
collections.get("/receivables", async (req: any, res) => {
  if (!req.farm) throw new UserError("Najpre otvorite gazdinstvo.");
  res.json(await receivables(db, req.farm.id, req.farm.year));
});

/** Deo ili ceo avans se vezuje za prodaju iste proizvodnje (ista valuta). */
collections.post("/payments/:id/allocate", async (req: any, res) => {
  if (!req.farm) throw new UserError("Najpre otvorite gazdinstvo.");
  const f = req.farm.id as string;
  const b = z.object({ eventId: id, amount: dec.optional() }).parse(req.body);
  await transaction(async (tx) => {
    await tx.query("SELECT id FROM farms WHERE id=$1 FOR UPDATE", [f]);
    const p = (
      await tx.query(
        "SELECT * FROM payments WHERE id=$1 AND farm_id=$2 AND advance=true",
        [id.parse(req.params.id), f],
      )
    ).rows[0];
    if (!p) throw new UserError("Avans nije pronađen ili je već raspoređen.");
    const e = (
      await tx.query(
        "SELECT * FROM business_events WHERE id=$1 AND farm_id=$2 AND kind='sale' AND status='final' AND money IS NOT NULL",
        [b.eventId, f],
      )
    ).rows[0];
    if (!e) throw new UserError("Prodaja nije pronađena.");
    if (e.production_id !== p.production_id)
      throw new UserError("Avans se vezuje samo za prodaju iste proizvodnje.");
    if (e.money.currency !== p.money.currency)
      throw new UserError("Avans i prodaja moraju biti u istoj valuti.");
    const paid = (
      await tx.query(
        "SELECT money FROM payments WHERE farm_id=$1 AND event_id=$2",
        [f, e.id],
      )
    ).rows.reduce<ReturnType<typeof D>>(
      (s, r) => s.add(inEventCurrency(r.money, e.money.currency)),
      D(0),
    );
    const remaining = D(e.money.original).sub(paid);
    if (remaining.lte(TOLERANCE))
      throw new UserError("Ova prodaja je već u potpunosti naplaćena.");
    const available = D(p.money.original);
    const amount = b.amount
      ? D(b.amount)
      : available.lt(remaining)
        ? available
        : remaining;
    if (amount.lte(0) || amount.gt(available))
      throw new UserError("Iznos mora biti pozitivan i ne veći od avansa.");
    if (amount.gt(remaining.add("0.01")))
      throw new UserError("Iznos prelazi preostali iznos prodaje.");
    if (amount.gte(available)) {
      await tx.query(
        "UPDATE payments SET event_id=$1,advance=false,category='Naplata prodaje',buyer=COALESCE(buyer,$2) WHERE id=$3",
        [e.id, e.details?.counterparty || null, p.id],
      );
    } else {
      await tx.query("UPDATE payments SET money=$1 WHERE id=$2", [
        JSON.stringify(scaleMoney(p.money, available.sub(amount).toString())),
        p.id,
      ]);
      await tx.query(
        "INSERT INTO payments(id,farm_id,event_id,date,direction,category,money,note,production_id,buyer,advance) VALUES($1,$2,$3,$4,'in','Naplata prodaje',$5,$6,$7,$8,false)",
        [
          randomUUID(),
          f,
          e.id,
          p.date,
          JSON.stringify(scaleMoney(p.money, amount.toString())),
          p.note || "Deo avansa",
          p.production_id,
          p.buyer || e.details?.counterparty || null,
        ],
      );
    }
    await tx.query(
      "INSERT INTO audit_log(id,farm_id,user_id,action,entity,metadata) VALUES($1,$2,$3,'advance_allocated',$4,$5)",
      [
        randomUUID(),
        f,
        req.user.id,
        p.id,
        JSON.stringify({ eventId: e.id, amount: amount.toString() }),
      ],
    );
  });
  res.json({ ok: true });
});
