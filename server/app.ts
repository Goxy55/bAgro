import express from "express";
import { toNodeHandler, fromNodeHeaders } from "better-auth/node";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { auth } from "./auth.js";
import { db, transaction, Conn } from "./db.js";
import { importSource } from "./importer.js";
import { D, validateModel, convertQuantity, fiveYears } from "./domain.js";
import { normFor, report, rateFor, snapshotMoney } from "./reports.js";
import {
  id,
  text,
  dec,
  date,
  currency,
  unit,
  url,
  farmSchema,
  productionSchema,
  eventSchema,
} from "./validation.js";
import { exportReport } from "./exports.js";
import { publicStips, adminStips } from "./stips/routes.js";
import { runtime } from "./runtime.js";
export const app = express();
app.disable("x-powered-by");
app.set("trust proxy", runtime.trustProxyHops);
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader("Cache-Control", "no-store");
  next();
});
app.get("/healthz", async (_req, res) => {
  try {
    await db.query("SELECT 1");
    res.json({ status: "ok" });
  } catch {
    res.status(503).json({ status: "unavailable" });
  }
});
app.use("/api/auth", (req, res, next) => {
  req.headers["x-agro-client-ip"] =
    req.ip || req.socket.remoteAddress || "127.0.0.1";
  next();
});
app.all("/api/auth/*splat", toNodeHandler(auth));
app.use(express.json({ limit: "4mb" }));
app.use("/api", async (req: any, res, next) => {
  try {
    if (
      !["GET", "HEAD"].includes(req.method) &&
      req.headers.origin !== runtime.baseURL
    )
      return res.status(403).json({ error: "Neispravno poreklo zahteva." });
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });
    if (!session)
      return res.status(401).json({ error: "Potrebna je prijava." });
    req.user = session.user;
    req.admin = !!(
      await db.query("SELECT user_id FROM app_admins WHERE user_id=$1", [
        session.user.id,
      ])
    ).rows.length;
    const memberships = (
      await db.query(
        "SELECT f.*,m.role FROM farms f JOIN memberships m ON m.farm_id=f.id WHERE m.user_id=$1 ORDER BY f.name",
        [session.user.id],
      )
    ).rows;
    req.farms = memberships;
    const chosen = req.headers["x-farm-id"];
    req.farm = chosen
      ? memberships.find((f) => f.id === chosen)
      : memberships[0];
    if (chosen && !req.farm) {
      await audit(db, req.user.id, null, "denied", "farm_access");
      return res.status(403).json({ error: "Nemate pristup gazdinstvu." });
    }
    await audit(
      db,
      req.user.id,
      req.farm?.id || null,
      "access",
      req.method + " " + req.path,
    );
    next();
  } catch (e) {
    next(e);
  }
});
const audit = async (
  conn: Conn,
  user: string,
  farm: string | null,
  action: string,
  entity: string,
  metadata: any = {},
) =>
  conn.query(
    "INSERT INTO audit_log(id,farm_id,user_id,action,entity,metadata) VALUES($1,$2,$3,$4,$5,$6)",
    [randomUUID(), farm, user, action, entity, JSON.stringify(metadata)],
  );
function farm(req: any) {
  if (!req.farm) throw Error("Najpre otvorite gazdinstvo.");
  return req.farm.id;
}
async function production(conn: Conn, f: string, p: string) {
  const row = (
    await conn.query(
      "SELECT * FROM production_periods WHERE id=$1 AND farm_id=$2",
      [id.parse(p), f],
    )
  ).rows[0];
  if (!row) throw Error("Proizvodnja nije pronađena.");
  return row;
}
async function lock(conn: Conn, f: string) {
  await conn.query("SELECT id FROM farms WHERE id=$1 FOR UPDATE", [f]);
}
async function stock(
  conn: Conn,
  f: string,
  p: string | null,
  product: string,
  u: string,
  stockType = "product",
) {
  const rows = (
    await conn.query(
      "SELECT unit,quantity,value_rsd,value_eur FROM inventory_movements WHERE farm_id=$1 AND production_id IS NOT DISTINCT FROM $2::uuid AND product=$3 AND stock_type=$4",
      [f, p, product, stockType],
    )
  ).rows;
  let quantity = D(0),
    value = D(0),
    eur = D(0);
  for (const r of rows) {
    quantity = quantity.add(convertQuantity(r.quantity, r.unit, u));
    value = value.add(r.value_rsd || 0);
    eur = eur.add(r.value_eur || 0);
  }
  return { quantity, value, eur };
}
async function move(conn: Conn, o: any) {
  await conn.query(
    "INSERT INTO inventory_movements(id,farm_id,production_id,date,product,unit,quantity,kind,value_rsd,method,link_id,note,stock_type,value_eur) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)",
    [
      randomUUID(),
      o.farm,
      o.production || null,
      o.date,
      o.product,
      o.unit,
      o.quantity,
      o.kind,
      o.value ?? null,
      o.method || null,
      o.link || null,
      o.note || null,
      o.stockType || "product",
      o.valueEUR ?? null,
    ],
  );
}
app.get("/api/bootstrap", async (req: any, res) => {
  res.json({
    user: req.user,
    admin: req.admin,
    farms: req.farms,
    farm: req.farm || null,
    sheets: (
      await db.query(
        "SELECT id,original_name,position,role FROM source_sheets ORDER BY position",
      )
    ).rows,
    templates: (
      await db.query(
        "SELECT id,sheet_id,name,basis,reference,intensity FROM templates ORDER BY sheet_id,id",
      )
    ).rows,
  });
});
app.post("/api/farms", async (req: any, res) => {
  const b = farmSchema.parse(req.body);
  const f = randomUUID();
  await transaction(async (tx) => {
    await tx.query(
      "INSERT INTO farms(id,name,municipality,year,currency,owner_id) VALUES($1,$2,$3,$4,$5,$6)",
      [f, b.name, b.municipality, b.year, b.currency, req.user.id],
    );
    await tx.query("INSERT INTO memberships VALUES($1,$2,'owner')", [
      f,
      req.user.id,
    ]);
    await audit(tx, req.user.id, f, "create", "farm");
  });
  res.json({ id: f });
});
app.put("/api/farm", async (req: any, res) => {
  const f = farm(req);
  const b = farmSchema.parse(req.body);
  if (req.farm.role !== "owner") throw Error("Samo vlasnik menja profil.");
  await transaction(async (tx) => {
    await tx.query(
      "UPDATE farms SET name=$1,municipality=$2,year=$3,currency=$4 WHERE id=$5",
      [b.name, b.municipality, b.year, b.currency, f],
    );
    await audit(tx, req.user.id, f, "update", "farm");
  });
  res.json({ ok: true });
});
app.get("/api/productions", async (req: any, res) => {
  const f = farm(req);
  const rows = (
    await db.query(
      "SELECT p.*,t.name AS template_name,t.basis,t.intensity,s.original_name AS category FROM production_periods p JOIN templates t ON t.id=p.template_id JOIN source_sheets s ON s.id=t.sheet_id WHERE farm_id=$1 AND year=$2 ORDER BY p.name",
      [f, req.farm.year],
    )
  ).rows;
  await audit(db, req.user.id, f, "read", "productions");
  res.json(rows);
});
app.post("/api/productions", async (req: any, res) => {
  const f = farm(req),
    b = productionSchema.parse(req.body),
    p = randomUUID();
  const template = (
    await db.query("SELECT * FROM templates WHERE id=$1", [b.templateId])
  ).rows[0];
  if (!template) throw Error("Predložak ne postoji.");
  if (
    template.name.includes("MALINA") &&
    !["malina", "kupina"].includes(b.details.product || "")
  )
    throw Error("Izaberite stvarni proizvod: malina ili kupina.");
  if (b.details.start && b.details.end && b.details.start > b.details.end)
    throw Error("Neispravan period.");
  if (
    b.status === "final" &&
    (!b.details.scale ||
      b.details.output == null ||
      !b.details.outputUnit ||
      !b.details.start ||
      !b.details.end)
  )
    throw Error(
      "Za završenu evidenciju unesite osnovu, period, proizvodnju i jedinicu.",
    );
  if (
    b.details.start &&
    (!b.details.start.startsWith(String(b.year)) ||
      !b.details.end?.startsWith(String(b.year)))
  )
    throw Error("Period mora pripadati obračunskoj godini.");
  await transaction(async (tx) => {
    await lock(tx, f);
    await tx.query(
      "INSERT INTO production_periods(id,farm_id,template_id,name,year,details,status) VALUES($1,$2,$3,$4,$5,$6,$7)",
      [p, f, b.templateId, b.name, b.year, JSON.stringify(b.details), b.status],
    );
    if (b.status === "final" && D(b.details.output!).gt(0))
      await move(tx, {
        farm: f,
        production: p,
        date: b.details.end,
        product: b.details.product || template.name,
        unit: b.details.outputUnit,
        quantity: b.details.output,
        kind: "production",
        method: "Količinska evidencija; vrednost prema snimljenom obračunu.",
      });
    await audit(tx, req.user.id, f, "create", p);
  });
  res.json({ id: p });
});
app.patch("/api/productions/:id", async (req: any, res) => {
  const f = farm(req),
    b = z
      .object({
        actualComplete: z.boolean().optional(),
        details: productionSchema.shape.details.optional(),
        status: z.enum(["draft", "final"]).optional(),
      })
      .parse(req.body);
  await transaction(async (tx) => {
    await lock(tx, f);
    const p = await production(tx, f, req.params.id);
    if (b.details && p.status !== "draft")
      throw Error(
        "Završenu količinsku evidenciju menjajte sledljivom korekcijom zaliha.",
      );
    const details = b.details || p.details;
    const status = b.status || p.status;
    const template = (
      await tx.query("SELECT * FROM templates WHERE id=$1", [p.template_id])
    ).rows[0];
    if (
      template.name.includes("MALINA") &&
      !["malina", "kupina"].includes(details.product || "")
    )
      throw Error("Izaberite stvarni proizvod: malina ili kupina.");
    if (
      details.start &&
      (!details.start.startsWith(String(p.year)) ||
        !details.end?.startsWith(String(p.year)) ||
        details.start > details.end)
    )
      throw Error("Period mora biti ispravan i unutar obračunske godine.");
    if (status === "final" && p.status === "draft") {
      if (
        !details.scale ||
        details.output == null ||
        !details.outputUnit ||
        !details.end ||
        !details.start
      )
        throw Error("Nedostaju obavezni ostvareni podaci.");
      const t = (
        await tx.query("SELECT name FROM templates WHERE id=$1", [
          p.template_id,
        ])
      ).rows[0];
      if (D(details.output).gt(0))
        await move(tx, {
          farm: f,
          production: p.id,
          date: details.end,
          product: details.product || t.name,
          unit: details.outputUnit,
          quantity: details.output,
          kind: "production",
        });
    }
    if (b.actualComplete) {
      if (status !== "final")
        throw Error("Prvo završite ostvarene podatke proizvodnje.");
      const drafts = (
        await tx.query(
          "SELECT id FROM business_events WHERE farm_id=$1 AND production_id=$2 AND status='draft'",
          [f, p.id],
        )
      ).rows;
      if (drafts.length) throw Error("Postoje nedovršeni poslovni događaji.");
    }
    await tx.query(
      "UPDATE production_periods SET details=$1,status=$2,actual_complete=$3 WHERE id=$4 AND farm_id=$5",
      [
        JSON.stringify(details),
        status,
        b.actualComplete ?? p.actual_complete,
        p.id,
        f,
      ],
    );
    await audit(tx, req.user.id, f, "update", p.id, {
      actualComplete: b.actualComplete,
    });
  });
  res.json({ ok: true });
});
app.get("/api/events", async (req: any, res) => {
  const f = farm(req);
  await audit(db, req.user.id, f, "read", "events");
  res.json(
    (
      await db.query(
        "SELECT *,date::text AS date FROM business_events WHERE farm_id=$1 ORDER BY created_at DESC",
        [f],
      )
    ).rows,
  );
});
const saveEvent = async (req: any, res: any) => {
  const f = farm(req),
    b = eventSchema.parse(req.body),
    eid = req.params.id ? id.parse(req.params.id) : randomUUID();
  if (b.status !== "draft" && (!b.date || !b.amount))
    throw Error("Nedostaju datum ili iznos; sačuvajte nacrt.");
  if (
    b.kind === "sale" &&
    b.status !== "draft" &&
    (!b.productionId ||
      !b.details.quantity ||
      !b.details.unit ||
      !b.details.product)
  )
    throw Error("Prodaja zahteva proizvodnju, proizvod, količinu i jedinicu.");
  if (b.kind === "sale" && !["draft", "final"].includes(b.status))
    throw Error("Neispravan status prodaje.");
  if (
    b.details.unitPrice &&
    b.details.quantity &&
    b.amount &&
    D(b.details.unitPrice).mul(b.details.quantity).sub(b.amount).abs().gt(".01")
  )
    throw Error("Ukupan iznos se ne slaže sa količinom × cenom.");
  if (b.kind !== "subsidy" && !["draft", "final"].includes(b.status))
    throw Error("Status važi samo za subvencije.");
  if (b.details.replaceNorm && (!b.details.normItemId || b.kind !== "cost"))
    throw Error("Zamena zahteva vezu sa normativnom stavkom.");
  if (
    b.kind === "cost" &&
    b.details.inventoryPurchase &&
    (!b.details.product || !b.details.quantity || !b.details.unit)
  )
    throw Error("Nabavka zalihe zahteva proizvod, količinu i jedinicu.");
  await transaction(async (tx) => {
    await lock(tx, f);
    if (req.params.id) {
      const old = (
        await tx.query(
          "SELECT status FROM business_events WHERE id=$1 AND farm_id=$2",
          [eid, f],
        )
      ).rows[0];
      if (!old || old.status !== "draft")
        throw Error("Menjati se može samo vaš nacrt.");
      await tx.query("DELETE FROM business_events WHERE id=$1 AND farm_id=$2", [
        eid,
        f,
      ]);
    }
    if (b.productionId) await production(tx, f, b.productionId);
    const m =
      b.amount && b.date
        ? b.status === "draft"
          ? (await rateFor(b.date, tx))
            ? await snapshotMoney(b.amount, b.currency, b.date, tx)
            : null
          : await snapshotMoney(b.amount, b.currency, b.date, tx)
        : null;
    if (b.details.replaceNorm) {
      const duplicate = (
        await tx.query(
          "SELECT id FROM business_events WHERE farm_id=$1 AND production_id=$2 AND status<>'draft' AND details->>'replaceNorm'='true' AND details->>'normItemId'=$3",
          [f, b.productionId, b.details.normItemId],
        )
      ).rows;
      if (duplicate.length)
        throw Error("Normativna stavka već ima eksplicitnu zamenu.");
    }
    if (b.kind === "sale" && b.status === "final") {
      const s = await stock(
        tx,
        f,
        b.productionId!,
        b.details.product!,
        b.details.unit!,
      );
      if (s.quantity.lt(b.details.quantity!))
        throw Error(
          "Nedovoljno zaliha. Unesite obrazloženo početno stanje ili korekciju.",
        );
      await move(tx, {
        farm: f,
        production: b.productionId,
        date: b.date,
        product: b.details.product,
        unit: b.details.unit,
        quantity: D(b.details.quantity!).neg().toString(),
        kind: "sale",
        link: eid,
      });
    }
    if (
      b.kind === "cost" &&
      b.details.inventoryPurchase &&
      b.status === "final"
    )
      await move(tx, {
        farm: f,
        production: b.productionId,
        date: b.date,
        product: b.details.product,
        unit: b.details.unit,
        quantity: b.details.quantity,
        kind: "purchase",
        value: m?.rsd,
        valueEUR: m?.eur,
        method: "stvarni nabavni trošak; trošak priznati pri potrošnji",
        link: eid,
        stockType: b.details.stockType || "material",
      });
    await tx.query(
      "INSERT INTO business_events(id,farm_id,production_id,kind,date,title,status,money,details) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
      [
        eid,
        f,
        b.productionId || null,
        b.kind,
        b.date || null,
        b.title,
        b.status,
        m ? JSON.stringify(m) : null,
        JSON.stringify({
          ...b.details,
          originalAmount: b.amount,
          originalCurrency: b.currency,
        }),
      ],
    );
    await audit(tx, req.user.id, f, "create", eid, { kind: b.kind });
  });
  res.json({ id: eid });
};
app.post("/api/events", saveEvent);
app.put("/api/events/:id", saveEvent);
app.post("/api/payments", async (req: any, res) => {
  const f = farm(req),
    b = z
      .object({
        eventId: id.optional(),
        date,
        direction: z.enum(["in", "out", "own_transfer"]),
        category: text,
        amount: dec,
        currency,
        note: z.string().max(2000).default(""),
      })
      .parse(req.body);
  if (D(b.amount).lte(0)) throw Error("Uplata mora biti pozitivna.");
  await transaction(async (tx) => {
    await lock(tx, f);
    const m = await snapshotMoney(b.amount, b.currency, b.date, tx);
    if (b.eventId) {
      const e = (
        await tx.query(
          "SELECT * FROM business_events WHERE id=$1 AND farm_id=$2",
          [b.eventId, f],
        )
      ).rows[0];
      if (!e || e.status === "draft" || !e.money)
        throw Error("Događaj ne postoji ili je nacrt.");
      if ((e.kind === "cost" ? "out" : "in") !== b.direction)
        throw Error("Smer plaćanja ne odgovara događaju.");
      if (e.kind === "subsidy" && e.status === "requested")
        throw Error("Potraživana subvencija prvo mora biti odobrena.");
      const old = (
        await tx.query(
          "SELECT money FROM payments WHERE farm_id=$1 AND event_id=$2",
          [f, b.eventId],
        )
      ).rows;
      const inEvent = (m: any) =>
        D(m.original).mul(
          m.currency === e.money.currency
            ? 1
            : m.currency === "EUR"
              ? m.rate
              : D(1).div(m.rate),
        );
      const total = old
        .reduce<ReturnType<typeof D>>((s, p) => s.add(inEvent(p.money)), D(0))
        .add(inEvent(m));
      if (total.gt(D(e.money.original).add(".01")))
        throw Error("Uplate prelaze iznos događaja.");
    }
    await tx.query(
      "INSERT INTO payments(id,farm_id,event_id,date,direction,category,money,note) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
      [
        randomUUID(),
        f,
        b.eventId || null,
        b.date,
        b.direction,
        b.category,
        JSON.stringify(m),
        b.note,
      ],
    );
    await audit(tx, req.user.id, f, "create", "payment");
  });
  res.json({ ok: true });
});
app.post("/api/subsidies/:id/approve", async (req: any, res) => {
  const f = farm(req);
  await transaction(async (tx) => {
    const e = (
      await tx.query(
        "SELECT * FROM business_events WHERE id=$1 AND farm_id=$2 AND kind='subsidy'",
        [id.parse(req.params.id), f],
      )
    ).rows[0];
    if (!e || !e.money) throw Error("Nedostaje subvencija ili kurs.");
    await tx.query(
      "UPDATE business_events SET status='approved' WHERE id=$1 AND farm_id=$2",
      [e.id, f],
    );
    await audit(tx, req.user.id, f, "approve", e.id);
  });
  res.json({ ok: true });
});
app.post("/api/opening", async (req: any, res) => {
  const f = farm(req),
    b = z.object({ amount: dec, currency }).parse(req.body);
  const m = await snapshotMoney(b.amount, b.currency, `${req.farm.year}-01-01`);
  await transaction(async (tx) => {
    await tx.query(
      "INSERT INTO opening_balances(farm_id,year,money) VALUES($1,$2,$3) ON CONFLICT(farm_id,year) DO UPDATE SET money=EXCLUDED.money",
      [f, req.farm.year, JSON.stringify(m)],
    );
    await audit(tx, req.user.id, f, "update", "opening");
  });
  res.json({ ok: true });
});
app.get("/api/inventory", async (req: any, res) => {
  const f = farm(req);
  await audit(db, req.user.id, f, "read", "inventory");
  const movements = (
    await db.query(
      "SELECT *,date::text AS date FROM inventory_movements WHERE farm_id=$1 ORDER BY inventory_movements.date DESC",
      [f],
    )
  ).rows;
  const balances = new Map<string, any>();
  for (const m of movements) {
    const u = m.unit === "t" ? "kg" : m.unit === "ha" ? "m2" : m.unit;
    const key = [m.production_id, m.product, u, m.stock_type].join("|");
    const row = balances.get(key) || {
      productionId: m.production_id,
      product: m.product,
      unit: u,
      stockType: m.stock_type,
      quantity: D(0),
    };
    row.quantity = row.quantity.add(convertQuantity(m.quantity, m.unit, u));
    balances.set(key, row);
  }
  res.json({
    balances: [...balances.values()].map((b) => ({
      ...b,
      quantity: b.quantity.toString(),
    })),
    movements,
    transfers: (
      await db.query("SELECT * FROM internal_transfers WHERE farm_id=$1", [f])
    ).rows,
    feed: (
      await db.query("SELECT * FROM feed_consumption WHERE farm_id=$1", [f])
    ).rows,
    wip: (
      await db.query(
        "SELECT * FROM wip_observations WHERE farm_id=$1 ORDER BY month",
        [f],
      )
    ).rows,
  });
});
async function tracedUnit(
  p: any,
  method: string,
  tx: Conn,
  productName?: string,
) {
  let quantity = p.details.output,
    quantityUnit = p.details.outputUnit;
  const norm = await normFor(p, tx);
  const allocations = norm.version?.model.byproductAllocations || {};
  let share = D(100)
    .sub(
      Object.values(allocations).reduce<ReturnType<typeof D>>(
        (s, a: any) => s.add(a),
        D(0),
      ),
    )
    .div(100);
  if (
    productName &&
    productName !==
      (p.details.product ||
        (
          await tx.query("SELECT name FROM templates WHERE id=$1", [
            p.template_id,
          ])
        ).rows[0].name)
  ) {
    if (allocations[productName] == null)
      throw Error("Nusproizvod nema odobrenu raspodelu troška.");
    const by = (
      await tx.query(
        "SELECT quantity,unit FROM inventory_movements WHERE farm_id=$1 AND production_id=$2 AND product=$3 AND kind='byproduct'",
        [p.farm_id, p.id, productName],
      )
    ).rows;
    if (!by.length) throw Error("Nedostaje ostvarena količina nusproizvoda.");
    quantityUnit = by[0].unit;
    quantity = by
      .reduce<ReturnType<typeof D>>(
        (s, m) => s.add(convertQuantity(m.quantity, m.unit, quantityUnit)),
        D(0),
      )
      .toString();
    share = D(allocations[productName]).div(100);
  }
  if (quantity == null || D(quantity).lte(0))
    throw Error("Nedostaje ostvarena proizvodnja za vrednovanje po trošku.");
  if (method === "normative") {
    if (!norm.money) throw Error(norm.errors.join(" "));
    return {
      unit: quantityUnit,
      value: D(norm.money.rsd).mul(share).div(quantity),
      eur: D(norm.money.eur).mul(share).div(quantity),
      snapshot: { version: norm.version.id, money: norm.money },
    };
  }
  if (!p.actual_complete)
    throw Error("Stvarna evidencija nije potvrđena kao kompletna.");
  const rows = (
    await tx.query(
      "SELECT money FROM business_events WHERE farm_id=$1 AND production_id=$2 AND kind='cost' AND status='final' AND COALESCE(details->>'inventoryPurchase','false')<>'true'",
      [p.farm_id, p.id],
    )
  ).rows;
  const feed = (
    await tx.query(
      "SELECT value_rsd,value_eur FROM feed_consumption WHERE farm_id=$1 AND production_id=$2",
      [p.farm_id, p.id],
    )
  ).rows;
  return {
    unit: quantityUnit,
    value: rows
      .reduce<ReturnType<typeof D>>((s, e) => s.add(e.money.rsd), D(0))
      .add(
        feed.reduce<ReturnType<typeof D>>((s, e) => s.add(e.value_rsd), D(0)),
      )
      .mul(share)
      .div(quantity),
    eur: rows
      .reduce<ReturnType<typeof D>>((s, e) => s.add(e.money.eur), D(0))
      .add(
        feed.reduce<ReturnType<typeof D>>((s, e) => s.add(e.value_eur), D(0)),
      )
      .mul(share)
      .div(quantity),
    snapshot: { actualComplete: true },
  };
}
app.post("/api/inventory", async (req: any, res) => {
  const f = farm(req),
    b = z
      .object({
        productionId: id.optional(),
        date,
        product: text,
        unit,
        stockType: z.enum(["product", "material"]).default("product"),
        quantity: dec,
        kind: z.enum([
          "opening",
          "correction_in",
          "correction_out",
          "household",
          "writeoff",
          "byproduct",
        ]),
        method: z.enum(["normative", "actual"]).default("normative"),
        amount: dec.optional(),
        currency: currency.optional(),
        note: text,
      })
      .parse(req.body);
  if (D(b.quantity).lte(0)) throw Error("Količina mora biti pozitivna.");
  await transaction(async (tx) => {
    await lock(tx, f);
    const p = b.productionId ? await production(tx, f, b.productionId) : null;
    const s = await stock(
      tx,
      f,
      b.productionId || null,
      b.product,
      b.unit,
      b.stockType,
    );
    const outgoing = ["correction_out", "household", "writeoff"].includes(
      b.kind,
    );
    if (outgoing && s.quantity.lt(b.quantity))
      throw Error("Negativno stanje zaliha nije dozvoljeno.");
    let v: any = null,
      vEUR: any = null;
    let note = b.note;
    if (b.kind === "household") {
      if (!p) throw Error("Izaberite izvornu proizvodnju.");
      const trace = await tracedUnit(p, b.method, tx, b.product);
      v = trace.value.mul(convertQuantity(b.quantity, b.unit, trace.unit));
      vEUR = trace.eur.mul(convertQuantity(b.quantity, b.unit, trace.unit));
      note += ` · ${JSON.stringify(trace.snapshot)}`;
    } else if (b.amount) {
      if (!b.currency) throw Error("Nedostaje valuta.");
      const m = await snapshotMoney(b.amount, b.currency, b.date, tx);
      v = D(m.rsd);
      vEUR = D(m.eur);
    }
    await move(tx, {
      farm: f,
      production: b.productionId,
      date: b.date,
      product: b.product,
      unit: b.unit,
      quantity: D(b.quantity)
        .mul(outgoing ? -1 : 1)
        .toString(),
      kind: b.kind,
      valueEUR: vEUR
        ? D(vEUR)
            .mul(outgoing ? -1 : 1)
            .toString()
        : null,
      value: v
        ? D(v)
            .mul(outgoing ? -1 : 1)
            .toString()
        : null,
      method: b.method,
      note,
      stockType: b.stockType,
    });
    await audit(tx, req.user.id, f, "create", "inventory", { kind: b.kind });
  });
  res.json({ ok: true });
});
app.post("/api/transfers", async (req: any, res) => {
  const f = farm(req),
    b = z
      .object({
        from: id,
        to: id,
        date,
        product: text,
        unit,
        quantity: dec,
        method: z.enum(["normative", "actual"]),
      })
      .parse(req.body);
  if (b.from === b.to || D(b.quantity).lte(0))
    throw Error("Prenos zahteva različite proizvodnje i pozitivnu količinu.");
  const tid = randomUUID();
  await transaction(async (tx) => {
    await lock(tx, f);
    const from = await production(tx, f, b.from);
    await production(tx, f, b.to);
    const s = await stock(tx, f, b.from, b.product, b.unit);
    if (s.quantity.lt(b.quantity)) throw Error("Nedovoljno zaliha.");
    const trace = await tracedUnit(from, b.method, tx, b.product);
    const value = trace.value
      .mul(convertQuantity(b.quantity, b.unit, trace.unit))
      .toString();
    const valueEUR = trace.eur
      .mul(convertQuantity(b.quantity, b.unit, trace.unit))
      .toString();
    await tx.query(
      "INSERT INTO internal_transfers(id,farm_id,from_production,to_production,quantity,product,unit,value_rsd,method,date,value_eur) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
      [
        tid,
        f,
        b.from,
        b.to,
        b.quantity,
        b.product,
        b.unit,
        value,
        b.method,
        b.date,
        valueEUR,
      ],
    );
    for (const incoming of [false, true])
      await move(tx, {
        farm: f,
        production: incoming ? b.to : b.from,
        date: b.date,
        product: b.product,
        unit: b.unit,
        quantity: D(b.quantity)
          .mul(incoming ? 1 : -1)
          .toString(),
        kind: incoming ? "transfer_in" : "transfer_out",
        value: D(value)
          .mul(incoming ? 1 : -1)
          .toString(),
        valueEUR: D(valueEUR)
          .mul(incoming ? 1 : -1)
          .toString(),
        method: b.method,
        link: tid,
        note: JSON.stringify(trace.snapshot),
      });
    await audit(tx, req.user.id, f, "create", tid, {
      kind: "internal_transfer",
    });
  });
  res.json({ id: tid });
});
app.post("/api/feed", async (req: any, res) => {
  const f = farm(req),
    b = z
      .object({
        productionId: id,
        date,
        product: text,
        quantity: dec,
        unit,
        stockType: z.enum(["product", "material"]).default("product"),
        normItemId: z.string().max(60).optional(),
      })
      .parse(req.body);
  if (D(b.quantity).lte(0)) throw Error("Količina mora biti pozitivna.");
  await transaction(async (tx) => {
    await lock(tx, f);
    await production(tx, f, b.productionId);
    const s = await stock(
      tx,
      f,
      b.productionId,
      b.product,
      b.unit,
      b.stockType,
    );
    if (s.quantity.lt(b.quantity) || s.quantity.lte(0))
      throw Error("Nedovoljno hrane ili repromaterijala na stanju.");
    if (s.value.lte(0))
      throw Error("Nedostaje sledljiva nabavna/proizvodna vrednost hrane.");
    const value = s.value.div(s.quantity).mul(b.quantity).toString();
    const valueEUR = s.eur.div(s.quantity).mul(b.quantity).toString();
    const fid = randomUUID();
    await tx.query(
      "INSERT INTO feed_consumption(id,farm_id,production_id,date,product,quantity,unit,value_rsd,origin,norm_item_id,value_eur) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
      [
        fid,
        f,
        b.productionId,
        b.date,
        b.product,
        b.quantity,
        b.unit,
        value,
        "stock",
        b.normItemId || null,
        valueEUR,
      ],
    );
    await move(tx, {
      farm: f,
      production: b.productionId,
      date: b.date,
      product: b.product,
      unit: b.unit,
      quantity: D(b.quantity).neg().toString(),
      kind: "feed_use",
      value: D(value).neg().toString(),
      valueEUR: D(valueEUR).neg().toString(),
      method: "Sledljivi trošak iz zalihe",
      link: fid,
      stockType: b.stockType,
    });
    await audit(tx, req.user.id, f, "create", fid);
  });
  res.json({ ok: true });
});
app.post("/api/wip", async (req: any, res) => {
  const f = farm(req),
    b = z
      .object({
        productionId: id,
        month: date,
        amount: dec,
        currency,
        note: text,
      })
      .parse(req.body);
  await production(db, f, b.productionId);
  const m = await snapshotMoney(b.amount, b.currency, b.month);
  await transaction(async (tx) => {
    await tx.query(
      "INSERT INTO wip_observations(id,farm_id,production_id,month,money,note) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(farm_id,production_id,month) DO UPDATE SET money=EXCLUDED.money,note=EXCLUDED.note",
      [randomUUID(), f, b.productionId, b.month, JSON.stringify(m), b.note],
    );
    await audit(tx, req.user.id, f, "upsert", "wip");
  });
  res.json({ ok: true });
});
function approvedModelView(model: any) {
  const copy = structuredClone(model);
  delete copy.notes;
  delete copy.cachedTotal;
  delete copy.recalculatedHistorical;
  if (copy.weights) delete copy.weights.formula;
  copy.items = copy.items?.map((item: any) => {
    const row = { ...item };
    for (const key of [
      "formula",
      "originalPrice",
      "originalQuantity",
      "cachedCost",
    ])
      delete row[key];
    return row;
  });
  return copy;
}
function publicReport(r: any) {
  const copy = structuredClone(r);
  for (const p of copy.results) {
    if (p.norm.version?.model)
      p.norm.version.model = approvedModelView(p.norm.version.model);
  }
  return copy;
}
app.get("/api/report", async (req: any, res) => {
  const f = farm(req),
    p = req.query.productionId ? id.parse(req.query.productionId) : undefined;
  const r = await report(f, p);
  await audit(db, req.user.id, f, "read", "report");
  res.json(publicReport(r));
});
app.get("/api/snapshots", async (req: any, res) => {
  const f = farm(req);
  res.json(
    (
      await db.query(
        "SELECT id,production_id,generated_at,previous_id FROM report_snapshots WHERE farm_id=$1 ORDER BY generated_at DESC",
        [f],
      )
    ).rows,
  );
});
app.post("/api/snapshots", async (req: any, res) => {
  const f = farm(req),
    b = z.object({ productionId: id.optional(), reason: text }).parse(req.body);
  const r = await report(f, b.productionId);
  const sid = randomUUID();
  await transaction(async (tx) => {
    await lock(tx, f);
    const previous = (
      await tx.query(
        "SELECT id FROM report_snapshots WHERE farm_id=$1 AND production_id IS NOT DISTINCT FROM $2::uuid ORDER BY generated_at DESC LIMIT 1",
        [f, b.productionId || null],
      )
    ).rows[0];
    await tx.query(
      "INSERT INTO report_snapshots(id,farm_id,production_id,previous_id,payload) VALUES($1,$2,$3,$4,$5)",
      [
        sid,
        f,
        b.productionId || null,
        previous?.id || null,
        JSON.stringify({ ...r, recalculationReason: b.reason }),
      ],
    );
    await audit(tx, req.user.id, f, "snapshot", sid, { reason: b.reason });
  });
  res.json({ id: sid });
});
app.get("/api/export/:format", async (req: any, res) => {
  const f = farm(req);
  const format = z.enum(["pdf", "xlsx"]).parse(req.params.format);
  let r: any;
  if (req.query.snapshotId) {
    r = (
      await db.query(
        "SELECT payload FROM report_snapshots WHERE id=$1 AND farm_id=$2",
        [id.parse(req.query.snapshotId), f],
      )
    ).rows[0]?.payload;
    if (!r) throw Error("Snimljeni obračun nije pronađen.");
  } else
    r = await report(
      f,
      req.query.productionId ? id.parse(req.query.productionId) : undefined,
    );
  await audit(db, req.user.id, f, "export", format);
  await exportReport(r, format, res);
});
app.get("/api/handbook", async (req: any, res) => {
  res.json(
    (
      await db.query(
        "SELECT v.id,v.name,v.model,v.valid_from,v.valid_to,t.name AS template_name FROM norm_versions v JOIN templates t ON t.id=v.template_id WHERE v.status='active' ORDER BY t.name",
      )
    ).rows.map((v) => ({ ...v, model: approvedModelView(v.model) })),
  );
});
app.use("/api/stips", publicStips);
app.get("/api/market", async (_req, res) => {
  const series = (await db.query("SELECT * FROM statistic_series")).rows;
  const observations = (await db.query("SELECT * FROM observations")).rows;
  res.json({
    series: series.map((s) => ({
      ...s,
      summary: fiveYears(
        observations.filter((o) => o.series_id === s.id),
        new Date().getUTCFullYear(),
      ),
    })),
    buyers: (await db.query("SELECT * FROM buyers")).rows,
    offers: (
      await db.query(
        "SELECT *,expires_at::text AS expires_at FROM buyer_offers WHERE approved=true AND expires_at>=CURRENT_DATE",
      )
    ).rows,
    requirements: (await db.query("SELECT * FROM market_requirements")).rows,
    sources: (await db.query("SELECT * FROM data_sources")).rows,
  });
});
app.use("/api/admin", (req: any, res, next) =>
  req.admin
    ? next()
    : res.status(403).json({ error: "Potreban je administratorski nalog." }),
);
app.use("/api/admin/stips", adminStips);
app.get("/api/admin", async (req: any, res) => {
  await audit(db, req.user.id, null, "admin_read", "catalog");
  res.json({
    versions: (
      await db.query(
        "SELECT v.*,t.name AS template_name FROM norm_versions v JOIN templates t ON t.id=v.template_id ORDER BY t.name,v.created_at",
      )
    ).rows,
    issues: (
      await db.query("SELECT inventory FROM source_imports")
    ).rows.flatMap((r) => r.inventory.issues),
    sheets: (await db.query("SELECT * FROM source_sheets ORDER BY position"))
      .rows,
    rates: (
      await db.query(
        "SELECT *,valid_from::text AS valid_from,valid_to::text AS valid_to FROM exchange_rates ORDER BY exchange_rates.valid_from DESC",
      )
    ).rows,
    audit: (
      await db.query(
        "SELECT id,user_id,action,entity,at FROM audit_log ORDER BY at DESC LIMIT 100",
      )
    ).rows,
  });
});
app.post("/api/admin/import", async (req: any, res) => {
  const result = await importSource();
  await audit(db, req.user.id, null, "import", "2017");
  res.json(result);
});
app.post("/api/admin/versions", async (req: any, res) => {
  const b = z
    .object({
      sourceId: id,
      name: text,
      validFrom: date,
      validTo: date,
      reason: text,
    })
    .parse(req.body);
  const s = (
    await db.query("SELECT * FROM norm_versions WHERE id=$1", [b.sourceId])
  ).rows[0];
  if (!s) throw Error("Izvorna verzija ne postoji.");
  if (b.validFrom > b.validTo) throw Error("Neispravan period.");
  const vid = randomUUID();
  const model = structuredClone(s.model);
  model.reviewed = false;
  for (const i of model.items) {
    i.price = null;
    i.unitConfirmed = false;
  }
  await transaction(async (tx) => {
    await tx.query(
      "INSERT INTO norm_versions(id,template_id,name,status,valid_from,valid_to,author,reason,model) VALUES($1,$2,$3,'draft',$4,$5,$6,$7,$8)",
      [
        vid,
        s.template_id,
        b.name,
        b.validFrom,
        b.validTo,
        req.user.id,
        b.reason,
        JSON.stringify(model),
      ],
    );
    await audit(tx, req.user.id, null, "clone", vid);
  });
  res.json({ id: vid });
});
app.put("/api/admin/versions/:id", async (req: any, res) => {
  const b = z
    .object({
      model: z.any(),
      reason: text,
      activate: z.boolean().default(false),
    })
    .parse(req.body);
  if (!b.model || !Array.isArray(b.model.items) || b.model.items.length > 500)
    throw Error("Neispravan deklarativni model.");
  const errors = validateModel(b.model);
  if (b.activate && errors.length)
    return res.status(422).json({ error: errors.join("\n") });
  await transaction(async (tx) => {
    const v = (
      await tx.query("SELECT * FROM norm_versions WHERE id=$1 FOR UPDATE", [
        id.parse(req.params.id),
      ])
    ).rows[0];
    if (!v || v.status !== "draft")
      throw Error(
        "Menjati se može samo nacrt; za aktivnu verziju napravite novu verziju.",
      );
    if (b.activate) {
      const overlap = (
        await tx.query(
          "SELECT id FROM norm_versions WHERE template_id=$1 AND status='active' AND valid_from<=$2 AND valid_to>=$3",
          [v.template_id, v.valid_to, v.valid_from],
        )
      ).rows;
      if (overlap.length)
        throw Error(
          "Period se preklapa sa aktivnom verzijom. Arhivirajte prethodnu verziju eksplicitno.",
        );
    }
    await tx.query(
      "UPDATE norm_versions SET model=$1,reason=$2,status=$3 WHERE id=$4",
      [
        JSON.stringify(b.model),
        b.reason,
        b.activate ? "active" : "draft",
        v.id,
      ],
    );
    await audit(
      tx,
      req.user.id,
      null,
      b.activate ? "activate" : "update",
      v.id,
      { reason: b.reason },
    );
  });
  res.json({ ok: true, errors });
});
app.post("/api/admin/versions/:id/archive", async (req: any, res) => {
  const reason = text.parse(req.body.reason);
  await transaction(async (tx) => {
    await tx.query("UPDATE norm_versions SET status='archive' WHERE id=$1", [
      id.parse(req.params.id),
    ]);
    await audit(tx, req.user.id, null, "archive", req.params.id, { reason });
  });
  res.json({ ok: true });
});
app.post("/api/admin/rates", async (req: any, res) => {
  const b = z
    .object({
      validFrom: date,
      validTo: date,
      rate: dec,
      source: url,
      publishedAt: date,
    })
    .parse(req.body);
  if (
    !["nbs.rs", "webappcenter.nbs.rs", "www.nbs.rs"].includes(
      new URL(b.source).hostname,
    ) ||
    D(b.rate).lte(0) ||
    b.validFrom > b.validTo
  )
    throw Error("Kurs mora imati provereni NBS izvor i ispravan period.");
  await transaction(async (tx) => {
    const overlaps = (
      await tx.query(
        "SELECT id FROM exchange_rates WHERE valid_from<=$1 AND valid_to>=$2 AND valid_from<>$2",
        [b.validTo, b.validFrom],
      )
    ).rows;
    if (overlaps.length)
      throw Error(
        "Važenje se preklapa. Koristite tačan interval važenja liste.",
      );
    await tx.query(
      "INSERT INTO exchange_rates(id,valid_from,valid_to,rate,source_url,published_at,author) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(valid_from) DO UPDATE SET valid_to=EXCLUDED.valid_to,rate=EXCLUDED.rate,source_url=EXCLUDED.source_url,published_at=EXCLUDED.published_at,author=EXCLUDED.author,checked_at=now()",
      [
        randomUUID(),
        b.validFrom,
        b.validTo,
        b.rate,
        b.source,
        b.publishedAt,
        req.user.id,
      ],
    );
    await audit(tx, req.user.id, null, "upsert", "exchange_rate", {
      date: b.validFrom,
    });
  });
  res.json({ ok: true });
});
app.post("/api/admin/statistics", async (req: any, res) => {
  const b = z
    .object({
      source: z.object({ id: text, name: text, url, terms: text }),
      series: z.object({
        id: text,
        product: text,
        indicator: text,
        definition: text,
        mapping: text,
        geography: text,
        unit: text,
        currency: z.string().max(10).nullable(),
        priceType: z.string().max(100).nullable(),
        sourceUrl: url,
      }),
      observations: z
        .array(
          z.object({
            period: z.number().int().min(1900).max(2100),
            value: dec.nullable(),
            status: z.enum([
              "konačan",
              "prethodan",
              "procenjen",
              "nepotpuna godina",
            ]),
            publishedAt: date,
            sourceUrl: url,
          }),
        )
        .max(200),
    })
    .parse(req.body);
  if (b.series.currency && !b.series.priceType)
    throw Error("Monetarna serija zahteva vrstu cene.");
  if (b.observations.some((o) => o.period > new Date().getUTCFullYear()))
    throw Error(
      "Buduće projekcije nisu ostvareni statistički podaci prve faze.",
    );
  if (
    b.series.geography === "Srbija" &&
    (b.source.id.toLowerCase().includes("stips") ||
      new URL(b.source.url).hostname.includes("stips"))
  )
    throw Error("STIPS lokalne cene nisu nacionalni godišnji pokazatelj.");
  await transaction(async (tx) => {
    await tx.query(
      "INSERT INTO data_sources(id,name,url,terms) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,url=EXCLUDED.url,terms=EXCLUDED.terms,checked_at=now()",
      [b.source.id, b.source.name, b.source.url, b.source.terms],
    );
    const s = b.series;
    const existing = (
      await tx.query("SELECT * FROM statistic_series WHERE id=$1", [s.id])
    ).rows[0];
    if (
      existing &&
      (existing.product !== s.product ||
        existing.unit !== s.unit ||
        existing.geography !== s.geography ||
        existing.indicator !== s.indicator ||
        existing.mapping !== s.mapping)
    )
      throw Error(
        "Promena definicije/mapiranja zahteva novi identitet serije.",
      );
    await tx.query(
      "INSERT INTO statistic_series(id,source_id,product,indicator,definition,mapping,geography,unit,currency,price_type,source_url) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT(id) DO NOTHING",
      [
        s.id,
        b.source.id,
        s.product,
        s.indicator,
        s.definition,
        s.mapping,
        s.geography,
        s.unit,
        s.currency,
        s.priceType,
        s.sourceUrl,
      ],
    );
    for (const o of b.observations) {
      const old = (
        await tx.query(
          "SELECT * FROM observations WHERE series_id=$1 AND period=$2",
          [s.id, o.period],
        )
      ).rows[0];
      if (
        old &&
        String(old.value) === String(o.value) &&
        old.status === o.status &&
        old.source_url === o.sourceUrl
      )
        continue;
      const history = old
        ? [
            ...old.history,
            {
              value: old.value,
              status: old.status,
              revision: old.revision,
              publishedAt: old.published_at,
              retrievedAt: old.retrieved_at,
            },
          ]
        : [];
      await tx.query(
        "INSERT INTO observations(id,series_id,period,value,status,published_at,source_url,revision,history) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(series_id,period) DO UPDATE SET value=EXCLUDED.value,status=EXCLUDED.status,published_at=EXCLUDED.published_at,source_url=EXCLUDED.source_url,revision=EXCLUDED.revision,history=EXCLUDED.history,retrieved_at=now()",
        [
          old?.id || randomUUID(),
          s.id,
          o.period,
          o.value,
          o.status,
          o.publishedAt,
          o.sourceUrl,
          old ? old.revision + 1 : 1,
          JSON.stringify(history),
        ],
      );
    }
    await audit(tx, req.user.id, null, "import", s.id);
  });
  res.json({ ok: true });
});
app.post("/api/admin/market/:kind", async (req: any, res) => {
  const kind = z
    .enum(["buyers", "offers", "requirements"])
    .parse(req.params.kind);
  const mid = randomUUID();
  await transaction(async (tx) => {
    if (kind === "buyers") {
      const b = z
        .object({
          name: text,
          products: text,
          area: text,
          contact: text,
          sourceUrl: url,
          verifiedAt: date,
        })
        .parse(req.body);
      await tx.query("INSERT INTO buyers VALUES($1,$2,$3,$4,$5,$6,$7)", [
        mid,
        b.name,
        b.products,
        b.area,
        b.contact,
        b.sourceUrl,
        b.verifiedAt,
      ]);
    }
    if (kind === "offers") {
      const b = z
        .object({
          buyerId: id,
          product: text,
          quantity: dec,
          unit,
          quality: text,
          delivery: text,
          period: text,
          expiresAt: date,
          sourceUrl: url,
          verifiedAt: date,
          approved: z.boolean(),
        })
        .parse(req.body);
      await tx.query(
        "INSERT INTO buyer_offers VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
        [
          mid,
          b.buyerId,
          b.product,
          b.quantity,
          b.unit,
          b.quality,
          b.delivery,
          b.period,
          b.expiresAt,
          b.sourceUrl,
          b.verifiedAt,
          b.approved,
        ],
      );
    }
    if (kind === "requirements") {
      const b = z
        .object({
          buyerId: id.nullable(),
          product: text,
          market: text,
          kind: z.enum(["zahtev kupca", "propis", "standard"]),
          description: text,
          sourceUrl: url,
          verifiedAt: date,
        })
        .parse(req.body);
      await tx.query(
        "INSERT INTO market_requirements VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
        [
          mid,
          b.buyerId,
          b.product,
          b.market,
          b.kind,
          b.description,
          b.sourceUrl,
          b.verifiedAt,
        ],
      );
    }
    await audit(tx, req.user.id, null, "create", kind);
  });
  res.json({ id: mid });
});
app.use("/api", (_req, res) =>
  res.status(404).json({ error: "Endpoint ne postoji." }),
);
app.use((err: any, _req: any, res: any, _next: any) => {
  if (err instanceof z.ZodError)
    return res.status(422).json({
      error: err.issues
        .map((i: any) => `${i.path.join(".")}: ${i.message}`)
        .join("\n"),
    });
  if (err.code) {
    console.error("Database error code:", err.code);
    return res
      .status(422)
      .json({ error: "Podaci nisu usklađeni sa pravilima baze." });
  }
  console.error(err.message);
  res.status(422).json({ error: err.message || "Greška pri obradi." });
});
