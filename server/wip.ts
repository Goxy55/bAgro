import { Router } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db, transaction, type Conn } from "./db.js";
import { D } from "./domain.js";
import { id, text, date } from "./validation.js";
import { rateFor } from "./reports.js";
import { hash } from "./pricing/model.js";
import {
  calculateMonthlyCosts,
  proposedCalendarPolicy,
  calendarMethod,
} from "./monthly-costs.js";
import { todayInSerbia } from "../shared/dates.js";
import { exportMonthlyWip } from "./wip-exports.js";

const month = z
  .string()
  .regex(/^\d{4}-(?:0[1-9]|1[0-2])$/)
  .refine(
    (v) => v <= todayInSerbia().slice(0, 7),
    "Za ostvareni pregled izaberite tekući ili prethodni mesec.",
  );
const policySchema = z.object({
  inheritMonths: z.boolean(),
  rangeRule: z.enum(["equal", "first", "manual"]),
  seasonRule: z.enum(["cycle", "calendar"]),
  preferAuxiliary: z.boolean(),
});
const querySchema = z.object({ asOf: month, productionId: id.optional() });
const farm = (req: any) => {
  if (!req.farm) throw Error("Izaberite gazdinstvo.");
  return req.farm.id as string;
};
const audit = async (
  tx: Conn,
  user: string,
  farmId: string | null,
  action: string,
  entity: string,
  metadata: any = {},
) =>
  tx.query(
    "INSERT INTO audit_log(id,user_id,farm_id,action,entity,metadata) VALUES($1,$2,$3,$4,$5,$6)",
    [randomUUID(), user, farmId, action, entity, JSON.stringify(metadata)],
  );
export const adminCostCalendar = Router();
adminCostCalendar.get("/", async (req: any, res) => {
  const current =
    (
      await db.query(
        "SELECT * FROM cost_calendar_policies WHERE status='active'",
      )
    ).rows[0] || null;
  await audit(
    db,
    req.user.id,
    null,
    "admin_calendar_read",
    "cost_calendar_policies",
  );
  res.json({
    current,
    proposal: proposedCalendarPolicy,
    method: calendarMethod,
  });
});
adminCostCalendar.post("/", async (req: any, res) => {
  const b = z
    .object({
      requestId: id,
      name: text,
      reason: text,
      policy: policySchema,
      confirmed: z.literal(true),
      expectedPolicyId: id.nullable().default(null),
    })
    .parse(req.body);
  const result = await transaction(async (tx) => {
    await tx.query("SELECT id FROM templates ORDER BY id FOR UPDATE");
    const prior = (
      await tx.query(
        "SELECT * FROM cost_calendar_policies WHERE request_id=$1",
        [b.requestId],
      )
    ).rows[0];
    if (prior) {
      if (
        prior.author !== req.user.id ||
        hash([prior.name, prior.reason, prior.policy]) !==
          hash([b.name, b.reason, b.policy])
      )
        throw Error("Zahtev je već iskorišćen za druga pravila.");
      return { id: prior.id, reused: true };
    }
    const current = (
      await tx.query(
        "SELECT id FROM cost_calendar_policies WHERE status='active'",
      )
    ).rows[0];
    if ((current?.id || null) !== b.expectedPolicyId)
      throw Object.assign(
        Error(
          "Kalendarska pravila su u međuvremenu promenjena. Ponovo ih učitajte pre izmene.",
        ),
        { status: 409 },
      );
    const policyId = randomUUID();
    await tx.query(
      "UPDATE cost_calendar_policies SET status='archive' WHERE status='active'",
    );
    await tx.query(
      "INSERT INTO cost_calendar_policies(id,request_id,name,status,policy,author,reason) VALUES($1,$2,$3,'active',$4,$5,$6)",
      [
        policyId,
        b.requestId,
        b.name,
        JSON.stringify(b.policy),
        req.user.id,
        b.reason,
      ],
    );
    await audit(tx, req.user.id, null, "calendar_policy_activate", policyId, b);
    return { id: policyId };
  });
  res.json(result);
});
export async function monthlyWip(
  farmId: string,
  asOf: string,
  productionId?: string,
) {
  return transaction(async (tx) => {
    await tx.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
    const profile = (
      await tx.query("SELECT * FROM farms WHERE id=$1", [farmId])
    ).rows[0];
    if (!profile) throw Error("Gazdinstvo nije pronađeno.");
    if (asOf < `${profile.year - 1}-01` || asOf > `${profile.year + 1}-12`)
      throw Error(
        "Mesec pregleda mora pripadati obračunskoj sezoni ili susednoj godini.",
      );
    const policy =
      (
        await tx.query(
          "SELECT * FROM cost_calendar_policies WHERE status='active'",
        )
      ).rows[0] || null;
    const productions = (
      await tx.query(
        "SELECT p.*,t.name AS template_name,t.basis FROM production_periods p JOIN templates t ON t.id=p.template_id WHERE p.farm_id=$1 AND p.year=$2" +
          (productionId ? " AND p.id=$3" : "") +
          " ORDER BY p.name,p.id",
        productionId
          ? [farmId, profile.year, productionId]
          : [farmId, profile.year],
      )
    ).rows;
    if (productionId && !productions.length)
      throw Error("Proizvodnja nije pronađena.");
    const end = new Date(
      Date.UTC(Number(asOf.slice(0, 4)), Number(asOf.slice(5)), 0),
    )
      .toISOString()
      .slice(0, 10);
    const exchangeDate = end > todayInSerbia() ? todayInSerbia() : end;
    let cachedRate: any | undefined;
    const results: any[] = [];
    for (const p of productions) {
      if (!["ha", "m2"].includes(p.basis)) continue;
      const errors: string[] = [],
        warnings: string[] = [];
      // Preparation may precede the accounting year. Use one approved season's
      // price version for all its normative quantities, including prior-year work.
      const priceStart =
        p.details.start && p.details.start > `${p.year}-01-01`
          ? p.details.start
          : `${p.year}-01-01`;
      const priceEnd =
        p.details.end && p.details.end < `${p.year}-12-31`
          ? p.details.end
          : `${p.year}-12-31`;
      if (priceStart > priceEnd)
        errors.push("Period proizvodnje nije usklađen sa obračunskom sezonom.");
      const version =
        (
          await tx.query(
            "SELECT *,valid_from::text,valid_to::text FROM norm_versions WHERE template_id=$1 AND status='active' AND valid_from<=$2 AND valid_to>=$3 ORDER BY created_at DESC,id DESC LIMIT 1",
            [p.template_id, priceStart, priceEnd],
          )
        ).rows[0] || null;
      let calculation: any = {
        supported: true,
        lines: [],
        months: [],
        cumulative: null,
        knownCumulative: "0",
        currentMonth: null,
        fullCost: null,
        errors: [],
        warnings: [],
      };
      let fx: any = null;
      if (!policy)
        errors.push(
          "Administrator treba jednom da potvrdi pravila mesečnog rasporeda.",
        );
      if (!version)
        errors.push(
          "Nema aktivnog odobrenog normativa za obračunski period proizvodnje.",
        );
      if (policy && version) {
        let factor = "1";
        if ((version.model.currency || "EUR") === "EUR") {
          if (cachedRate === undefined)
            cachedRate = (await rateFor(exchangeDate, tx)) || null;
          fx = cachedRate
            ? {
                value: String(cachedRate.rate),
                validFrom: cachedRate.valid_from,
                validTo: cachedRate.valid_to,
                source: cachedRate.source_url,
                date: exchangeDate,
              }
            : null;
          if (fx) factor = fx.value;
          else
            errors.push(
              `Nedostaje kurs za EUR normativ na ${exchangeDate}. RSD normativ ne zahteva kurs.`,
            );
        }
        if (!errors.length)
          calculation = calculateMonthlyCosts(
            version.model,
            p.template_id,
            p,
            asOf,
            policy.policy,
            factor,
          );
      }
      errors.push(...calculation.errors);
      warnings.push(...calculation.warnings);
      const completedOn = p.details.completedOn || null;
      const state = p.details.cultivationStatus || "unknown";
      let wipValue: string | null = null,
        stageMessage = "Potvrdite da li je proizvodnja u toku ili završena.";
      if (
        state === "growing" ||
        (state === "completed" && completedOn && completedOn.slice(0, 7) > asOf)
      ) {
        wipValue = calculation.cumulative;
        stageMessage =
          "Normativna vrednost proizvodnje u toku na kraju izabranog meseca.";
      }
      if (
        state === "completed" &&
        completedOn &&
        completedOn.slice(0, 7) <= asOf
      ) {
        wipValue = "0";
        stageMessage =
          "Proizvodnja je završena; kumulativni trošak ostaje u istoriji, bez zalihe u zemlji.";
      }
      results.push({
        id: p.id,
        name: p.name,
        template: p.template_name,
        year: p.year,
        details: p.details,
        state,
        completedOn,
        wipValue,
        stageMessage,
        ...calculation,
        errors: [...new Set(errors)],
        warnings,
        version: version
          ? {
              id: version.id,
              name: version.name,
              validFrom: version.valid_from,
              validTo: version.valid_to,
              currency: version.model.currency || "EUR",
              sheet: version.model.sheet,
              range: version.model.range,
            }
          : null,
        normSnapshot: version ? { id: version.id, model: version.model } : null,
        exchangeRate: fx,
      });
    }
    const sum = (field: string) =>
      results.reduce((n, r) => n.add(r[field] ?? 0), D(0)).toString();
    const allKnown = (field: string) =>
      results.length > 0 && results.every((r) => r[field] != null);
    return {
      farm: profile,
      asOf,
      productionId: productionId || null,
      currency: "RSD",
      generatedAt: new Date().toISOString(),
      method: "Kumulativno normativno ulaganje po mesecima",
      calendarMethod,
      policy,
      results,
      totals: {
        cumulative: allKnown("cumulative") ? sum("cumulative") : null,
        knownCumulative: sum("knownCumulative"),
        currentMonth: allKnown("currentMonth") ? sum("currentMonth") : null,
        wipValue: allKnown("wipValue") ? sum("wipValue") : null,
        knownWipValue: sum("wipValue"),
        incomplete: results.filter((r) => r.cumulative == null).length,
        unknownState: results.filter((r) => r.state === "unknown").length,
      },
      status:
        results.length && results.every((r) => r.cumulative != null)
          ? "Obračun po odobrenom normativu"
          : "Nepotpun obračun",
      rounding:
        "Decimalna aritmetika; puna preciznost do prikaza na 2 decimale. Poslednji mesečni udeo preuzima ostatak, bez dupliranja norme.",
      coverage:
        "Normirani materijal i odobrene operacije × evidentirana površina. Kalendar je obračunska pretpostavka; nije dokaz izvršenja, stvarnog rashoda ili plaćanja. Izabrani cenovnik sezone primenjen je na ceo obuhvaćeni ciklus. Mesečna kumulativna stanja se ne sabiraju kao novi troškovi.",
      sources: [
        ...new Set(
          results.flatMap((r) =>
            r.version
              ? [
                  `${r.version.sheet} ${r.version.range}`,
                  r.sourceHash
                    ? "Izvor 2017 — raspored meseci; cene iz odobrene verzije"
                    : "Raspored i cene iz odobrene admin verzije",
                ]
              : [],
          ),
        ),
      ],
    };
  });
}
function publicWip(input: any) {
  const value = structuredClone(input);
  for (const r of value.results) delete r.normSnapshot;
  return value;
}
export const privateWip = Router();
privateWip.get("/", async (req: any, res) => {
  const f = farm(req),
    b = querySchema.parse(req.query),
    r = await monthlyWip(f, b.asOf, b.productionId);
  res.json(publicWip(r));
});
privateWip.patch("/productions/:id/state", async (req: any, res) => {
  const f = farm(req),
    productionId = id.parse(req.params.id),
    b = z
      .object({
        state: z.enum(["unknown", "growing", "completed"]),
        completedOn: date.optional(),
        note: text,
      })
      .parse(req.body);
  if (
    b.state === "completed" &&
    (!b.completedOn || b.completedOn > todayInSerbia())
  )
    throw Error("Unesite stvarni datum završetka, najkasnije danas.");
  await transaction(async (tx) => {
    await tx.query("SELECT id FROM farms WHERE id=$1 FOR UPDATE", [f]);
    const p = (
      await tx.query(
        "SELECT * FROM production_periods WHERE id=$1 AND farm_id=$2 FOR UPDATE",
        [productionId, f],
      )
    ).rows[0];
    if (!p) throw Error("Proizvodnja nije pronađena.");
    const details = { ...p.details, cultivationStatus: b.state };
    if (b.state === "completed") details.completedOn = b.completedOn;
    else delete details.completedOn;
    await tx.query(
      "UPDATE production_periods SET details=$1 WHERE id=$2 AND farm_id=$3",
      [JSON.stringify(details), productionId, f],
    );
    await audit(tx, req.user.id, f, "wip_state", productionId, {
      before: {
        state: p.details.cultivationStatus || "unknown",
        completedOn: p.details.completedOn || null,
      },
      after: b,
    });
  });
  res.json({ ok: true });
});
privateWip.get("/snapshots", async (req: any, res) => {
  const f = farm(req);
  res.json(
    (
      await db.query(
        "SELECT id,production_id,as_of,generated_at,previous_id FROM wip_snapshots WHERE farm_id=$1 ORDER BY generated_at DESC,id",
        [f],
      )
    ).rows,
  );
});
privateWip.post("/snapshots", async (req: any, res) => {
  const f = farm(req),
    b = querySchema.extend({ reason: text }).parse(req.body),
    payload = await monthlyWip(f, b.asOf, b.productionId),
    snapshotId = randomUUID();
  await transaction(async (tx) => {
    await tx.query("SELECT id FROM farms WHERE id=$1 FOR UPDATE", [f]);
    const previous = (
      await tx.query(
        "SELECT id FROM wip_snapshots WHERE farm_id=$1 AND production_id IS NOT DISTINCT FROM $2::uuid AND as_of=$3 ORDER BY generated_at DESC,id DESC LIMIT 1",
        [f, b.productionId || null, b.asOf],
      )
    ).rows[0];
    await tx.query(
      "INSERT INTO wip_snapshots(id,farm_id,production_id,as_of,previous_id,author,reason,payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
      [
        snapshotId,
        f,
        b.productionId || null,
        b.asOf,
        previous?.id || null,
        req.user.id,
        b.reason,
        JSON.stringify(payload),
      ],
    );
    await audit(tx, req.user.id, f, "snapshot", "monthly_wip", {
      id: snapshotId,
      asOf: b.asOf,
      reason: b.reason,
    });
  });
  res.json({ id: snapshotId });
});
privateWip.get("/export/:format", async (req: any, res) => {
  const f = farm(req),
    format = z.enum(["pdf", "xlsx"]).parse(req.params.format);
  let payload: any;
  if (req.query.snapshotId) {
    payload = (
      await db.query(
        "SELECT payload FROM wip_snapshots WHERE farm_id=$1 AND id=$2",
        [f, id.parse(req.query.snapshotId)],
      )
    ).rows[0]?.payload;
    if (!payload) throw Error("Snimljeni obračun nije pronađen.");
  } else {
    const b = querySchema.parse(req.query);
    payload = await monthlyWip(f, b.asOf, b.productionId);
  }
  await audit(db, req.user.id, f, "export", "monthly_wip", {
    asOf: payload.asOf,
    format,
  });
  await exportMonthlyWip(payload, format, res);
});
