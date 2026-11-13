import { Router } from "express";
import { z } from "zod";
import { db, transaction, type Conn } from "./db.js";
import { D } from "./domain.js";
import { normFor, rateFor } from "./reports.js";
import { calculateMonthlyCosts } from "./monthly-costs.js";
import { todayInSerbia } from "../shared/dates.js";
import { dec, date, unit } from "./validation.js";
import { UserError } from "./errors.js";
import { rateLimit } from "./rate-limit.js";

/**
 * Ukupan normativni trošak proizvodnje i trošak do današnjeg dana.
 *
 * - Površinske proizvodnje (ha, m²): mesečni kalendar potvrđen od administratora,
 *   isti obračun kao „Zalihe na parceli“. Tekući mesec se računa ceo.
 * - Stoka sa godišnjim normativom: proporcionalno protekloj porciji perioda.
 * - Stoka po ciklusu: proporcionalno do očekivanog završetka, ako je unet.
 * - Rasad i šampinjoni: samo ukupan trošak.
 */
export type CostMethod = "calendar" | "pro-rata" | null;
export type ProductionCost = {
  /** Ukupan trošak za celu sezonu ili ciklus (RSD) ili null kada se ne može izračunati. */
  planned: string | null;
  /** Trošak do današnjeg dana (RSD) ili null. */
  toDate: string | null;
  method: CostMethod;
  asOf: string;
  currency: "RSD";
  /** Razumljiva objašnjenja šta nedostaje; prazno kada je sve izračunato. */
  problems: string[];
  /** Napomena o načinu obračuna za prikaz korisniku. */
  note: string | null;
};

export function friendlyProblem(message: string): string {
  if (/aktivn\w* odobren\w* normativ|Nema aktivnog/.test(message))
    return "Za ovu kulturu još nema odobrenog cenovnika; trošak se ne može izračunati.";
  if (/pravila mesečnog rasporeda/.test(message))
    return "Administrator još nije potvrdio mesečni raspored troškova.";
  if (/kurs/i.test(message))
    return "Nedostaje kurs za preračun EUR cena u dinare (administrator ga unosi).";
  if (/potvrđena osnova (potrošnje|hranidbenog bloka)/.test(message))
    return "Administrator još nije potvrdio hranidbene osnove za ovu vrstu stoke.";
  if (/Nedostaje potvrđena cena|nedostaje cena/i.test(message))
    return "U cenovniku nedostaju cene za neke stavke; trošak je nepotpun.";
  return message;
}
const unique = (a: string[]) => [...new Set(a)];

const dayNumber = (d: string) => Date.parse(d) / 86400000;
export function elapsedShare(start: string, end: string, today: string) {
  const total = dayNumber(end) - dayNumber(start) + 1;
  if (total <= 0) return null;
  const done = Math.min(
    Math.max(dayNumber(today) - dayNumber(start) + 1, 0),
    total,
  );
  return D(done).div(total);
}

export type CostContext = { policy: any | null; rates: Map<string, any> };
export async function costContext(conn: Conn): Promise<CostContext> {
  const policy =
    (
      await conn.query(
        "SELECT * FROM cost_calendar_policies WHERE status='active'",
      )
    ).rows[0] || null;
  return { policy, rates: new Map() };
}
async function fxFor(conn: Conn, ctx: CostContext, day: string) {
  if (!ctx.rates.has(day))
    ctx.rates.set(day, (await rateFor(day, conn)) || null);
  return ctx.rates.get(day);
}

/** p: { template_id, basis, year, details } kao red proizvodnje (ili nacrt za pregled). */
export async function costFor(
  conn: Conn,
  p: any,
  ctx: CostContext,
  today = todayInSerbia(),
): Promise<ProductionCost> {
  const base: ProductionCost = {
    planned: null,
    toDate: null,
    method: null,
    asOf: today,
    currency: "RSD",
    problems: [],
    note: null,
  };
  try {
    if (["ha", "m2"].includes(p.basis))
      return await surfaceCost(conn, p, ctx, today, base);
    return await normCost(conn, p, today, base);
  } catch (e) {
    return { ...base, problems: [friendlyProblem((e as Error).message)] };
  }
}

async function surfaceCost(
  conn: Conn,
  p: any,
  ctx: CostContext,
  today: string,
  out: ProductionCost,
): Promise<ProductionCost> {
  const details = p.details || {};
  const priceStart =
    details.start && details.start > `${p.year}-01-01`
      ? details.start
      : `${p.year}-01-01`;
  const priceEnd =
    details.end && details.end < `${p.year}-12-31`
      ? details.end
      : `${p.year}-12-31`;
  const problems: string[] = [];
  if (priceStart > priceEnd)
    problems.push("Period proizvodnje nije usklađen sa obračunskom sezonom.");
  const version = (
    await conn.query(
      "SELECT * FROM norm_versions WHERE template_id=$1 AND status='active' AND valid_from<=$2 AND valid_to>=$3 ORDER BY created_at DESC,id DESC LIMIT 1",
      [p.template_id, priceStart, priceEnd],
    )
  ).rows[0];
  if (!version)
    problems.push("Nema aktivnog odobrenog normativa za ovu kulturu i sezonu.");
  if (!ctx.policy)
    problems.push(
      "Administrator treba jednom da potvrdi pravila mesečnog rasporeda.",
    );
  if (problems.length)
    return { ...out, problems: unique(problems.map(friendlyProblem)) };
  let factor = "1";
  if ((version.model.currency || "EUR") === "EUR") {
    const rate = await fxFor(conn, ctx, today);
    if (!rate)
      return {
        ...out,
        problems: [
          friendlyProblem(`Nedostaje kurs za EUR normativ na ${today}.`),
        ],
      };
    factor = String(rate.rate);
  }
  // Mesec pregleda je tekući, ograničen na sezonu; posle sezone je sve proteklo.
  const seasonEnd = `${p.year}-12`;
  const month = today.slice(0, 7) > seasonEnd ? seasonEnd : today.slice(0, 7);
  const calc = calculateMonthlyCosts(
    version.model,
    p.template_id,
    { ...p, details },
    month,
    ctx.policy.policy,
    factor,
  );
  const beforeSeason = month < `${p.year - 1}-01`;
  return {
    ...out,
    planned: calc.fullCost,
    toDate: beforeSeason ? "0" : calc.cumulative,
    method: "calendar",
    problems: unique(calc.errors.map(friendlyProblem)),
    note: "Prema mesečnom rasporedu troškova kulture; tekući mesec je uračunat ceo.",
  };
}

async function normCost(
  conn: Conn,
  p: any,
  today: string,
  out: ProductionCost,
): Promise<ProductionCost> {
  const stored = p.details || {};
  // Godišnji normativ stoke: bez unetog perioda važi cela obračunska godina.
  const details =
    p.basis === "head_year"
      ? {
          ...stored,
          start: stored.start || `${p.year}-01-01`,
          end: stored.end || `${p.year}-12-31`,
        }
      : stored;
  const norm = await normFor({ ...p, details }, conn);
  if (norm.total == null || !norm.money?.rsd)
    return {
      ...out,
      problems: unique(norm.errors.map(friendlyProblem)),
    };
  const planned = norm.money.rsd as string;
  const problems = unique(norm.errors.map(friendlyProblem));
  if (p.basis === "head_year") {
    const share = elapsedShare(
      details.start || `${p.year}-01-01`,
      details.end || `${p.year}-12-31`,
      today,
    );
    return {
      ...out,
      planned,
      toDate: share
        ? D(planned).mul(share).toDecimalPlaces(2).toString()
        : null,
      method: "pro-rata",
      problems,
      note: "Godišnji normativ srazmerno broju proteklih dana u periodu.",
    };
  }
  if (p.basis === "head_cycle") {
    if (!details.end)
      return {
        ...out,
        planned,
        problems,
        note: "Unesite očekivani završetak ciklusa da bi se prikazao trošak do danas.",
      };
    const share = elapsedShare(
      details.start || `${p.year}-01-01`,
      details.end,
      today,
    );
    return {
      ...out,
      planned,
      toDate: share
        ? D(planned).mul(share).toDecimalPlaces(2).toString()
        : null,
      method: "pro-rata",
      problems,
      note: "Normativ ciklusa srazmerno proteklom delu ciklusa.",
    };
  }
  return {
    ...out,
    planned,
    problems,
    note: "Za ovu vrstu proizvodnje prikazuje se samo ukupan trošak.",
  };
}

export const productionCosts = Router();
const sum = (rows: (string | null)[]) =>
  rows.reduce<ReturnType<typeof D> | null>(
    (s, v) => (s && v != null ? s.add(v) : null),
    D(0),
  );

productionCosts.get("/production-costs", async (req: any, res) => {
  if (!req.farm) throw new UserError("Najpre otvorite gazdinstvo.");
  const today = todayInSerbia();
  const items: Record<string, ProductionCost> = {};
  await transaction(async (tx) => {
    await tx.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
    const ctx = await costContext(tx);
    const rows = (
      await tx.query(
        `SELECT p.*,t.basis FROM production_periods p JOIN templates t ON t.id=p.template_id
         WHERE p.farm_id=$1 AND p.year=$2 ORDER BY p.name,p.id`,
        [req.farm.id, req.farm.year],
      )
    ).rows;
    for (const p of rows) items[p.id] = await costFor(tx, p, ctx, today);
  });
  const all = Object.values(items);
  res.json({
    asOf: today,
    currency: "RSD",
    items,
    totals: {
      planned: sum(all.map((c) => c.planned))?.toString() ?? null,
      toDate: sum(all.map((c) => c.toDate))?.toString() ?? null,
      knownPlanned: sum(all.map((c) => c.planned ?? "0"))?.toString() ?? "0",
      knownToDate: sum(all.map((c) => c.toDate ?? "0"))?.toString() ?? "0",
      incomplete: all.filter((c) => c.planned == null || c.toDate == null)
        .length,
    },
  });
});

const previewSchema = z.object({
  templateId: z.string().min(1).max(60),
  scale: dec,
  scaleUnit: unit.optional(),
  start: date.optional(),
  end: date.optional(),
});
productionCosts.post(
  "/production-costs/preview",
  rateLimit({ windowMs: 60_000, max: 60 }),
  async (req: any, res) => {
    if (!req.farm) throw new UserError("Najpre otvorite gazdinstvo.");
    const b = previewSchema.parse(req.body);
    const template = (
      await db.query("SELECT id,basis FROM templates WHERE id=$1", [
        b.templateId,
      ])
    ).rows[0];
    if (!template) throw new UserError("Predložak ne postoji.");
    const ctx = await costContext(db);
    const cost = await costFor(
      db,
      {
        template_id: template.id,
        basis: template.basis,
        year: req.farm.year,
        details: {
          scale: b.scale,
          scaleUnit: b.scaleUnit,
          start: b.start || `${req.farm.year}-01-01`,
          end:
            b.end ||
            (template.basis === "head_cycle"
              ? undefined
              : `${req.farm.year}-12-31`),
        },
      },
      ctx,
    );
    res.json(cost);
  },
);
