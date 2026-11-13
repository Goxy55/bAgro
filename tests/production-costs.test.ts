import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { D } from "../server/domain.js";
const inventory = JSON.parse(
  readFileSync(new URL("../source/inventory.json", import.meta.url), "utf8"),
);
function model(id = "s0-B36") {
  const c = structuredClone(inventory.cards.find((c: any) => c.id === id));
  c.currency = "RSD";
  c.reviewed = true;
  const chosen = new Set<string>();
  for (const i of c.items) {
    i.price = "1";
    i.unit = "kg";
    i.unitConfirmed = true;
    i.alternativeConfirmed = true;
    if (i.alternativeGroup && Number(i.quantity) > 0) {
      if (chosen.has(i.alternativeGroup) || i.id === "F54") {
        i.included = false;
        i.exclusionReason = "TEST jedne izvorne alternative";
      } else chosen.add(i.alternativeGroup);
    }
  }
  return c;
}
const temp = await mkdtemp("/tmp/agro-production-costs-TEST-");
process.env.DATABASE_URL = "";
process.env.DATA_DIR = temp + "/pg";
process.env.APP_URL = "http://localhost:3000";
process.env.BETTER_AUTH_SECRET = "TEST-production-costs-secret-0123456789012";
const { app } = await import("../server/app.js");
const { db, transaction, closeDatabase } = await import("../server/db.js");
const { importSource } = await import("../server/importer.js");
const { elapsedShare, friendlyProblem } =
  await import("../server/production-costs.js");
const server = app.listen(0, "127.0.0.1");
await new Promise<void>((r) => server.once("listening", r));
const base = `http://127.0.0.1:${(server.address() as any).port}/api`;
type User = { id: string; cookie: string; farm?: string };
async function request(
  u: User | undefined,
  path: string,
  body?: any,
  method?: string,
) {
  return fetch(base + path, {
    method: method || (body ? "POST" : "GET"),
    headers: {
      Origin: "http://localhost:3000",
      "Content-Type": "application/json",
      ...(u ? { Cookie: u.cookie } : {}),
      ...(u?.farm ? { "X-Farm-Id": u.farm } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}
async function ok(
  u: User | undefined,
  path: string,
  body?: any,
  method?: string,
) {
  const r = await request(u, path, body, method),
    v = await r.json();
  assert.ok(r.ok, `${path} ${r.status}: ${JSON.stringify(v)}`);
  return v;
}
async function signup(email: string): Promise<User> {
  const r = await request(undefined, "/auth/sign-up/email", {
      email,
      password: "TEST-monthly-password-2026!",
      name: "TEST",
    }),
    v = await r.json();
  assert.equal(r.status, 200);
  return {
    id: v.user.id,
    cookie: r.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; "),
  };
}

const today = new Date().toISOString().slice(0, 10);
const YEAR = Number(today.slice(0, 4));

test("Proteklo vreme i razumljive poruke", () => {
  assert.equal(
    elapsedShare("2026-01-01", "2026-12-31", "2026-07-02")?.toFixed(3),
    "0.501",
  );
  assert.equal(
    elapsedShare("2026-01-01", "2026-12-31", "2025-12-01")?.toString(),
    "0",
  );
  assert.equal(
    elapsedShare("2026-01-01", "2026-12-31", "2027-03-01")?.toString(),
    "1",
  );
  assert.equal(elapsedShare("2026-06-01", "2026-05-01", "2026-06-01"), null);
  assert.match(
    friendlyProblem("Nema aktivnog odobrenog normativa za period."),
    /nema odobrenog cenovnika/,
  );
  assert.match(
    friendlyProblem("Nedostaje kurs za EUR normativ na 2026-05-01."),
    /kurs/,
  );
  assert.equal(friendlyProblem("Nešto drugo"), "Nešto drugo");
});

test("Troškovi proizvodnje: ukupno i do danas, pregled pre čuvanja", async (t) => {
  await importSource();
  const admin = await signup("admin@pcosts.test"),
    a = await signup("farma@pcosts.test");
  await db.query("INSERT INTO app_admins VALUES($1)", [admin.id]);
  a.farm = (
    await ok(a, "/farms", {
      name: "TEST Farma",
      municipality: "TEST",
      year: YEAR,
      currency: "RSD",
    })
  ).id;
  const activate = async (templateId: string) => {
    const m = model(templateId);
    m.groupBases = Object.fromEntries(
      (m.groups || []).map((g: any) => [g.id, "100"]),
    );
    return db.query(
      "INSERT INTO norm_versions(id,template_id,name,status,valid_from,valid_to,author,reason,model) VALUES($1,$2,'TEST dinarski normativ','active',$3,$4,$5,'TEST sintetička cena 1 RSD',$6)",
      [
        randomUUID(),
        templateId,
        `${YEAR}-01-01`,
        `${YEAR}-12-31`,
        admin.id,
        JSON.stringify(m),
      ],
    );
  };
  await t.test(
    "Bez odobrenog cenovnika: razumljiva poruka, bez izmišljenih iznosa",
    async () => {
      const created = await ok(a, "/productions", {
        templateId: "s0-B36",
        name: "TEST pšenica",
        year: YEAR,
        status: "draft",
        details: {
          scale: "2.5",
          scaleUnit: "ha",
          start: `${YEAR}-01-01`,
          end: `${YEAR}-12-31`,
        },
      });
      const r = await ok(a, "/production-costs");
      assert.equal(r.items[created.id].planned, null);
      assert.equal(r.items[created.id].toDate, null);
      assert.match(r.items[created.id].problems[0], /nema odobrenog cenovnika/);
      assert.match(
        friendlyProblem("Blok B18: nedostaje potvrđena osnova potrošnje."),
        /hranidbene osnove/,
      );
      assert.equal(r.totals.planned, null);
      assert.equal(r.totals.incomplete, 1);
    },
  );
  await t.test(
    "Biljna proizvodnja: isti rezultat kao Zalihe na parceli",
    async () => {
      await activate("s0-B36");
      const list = await ok(a, "/productions");
      const wheat = list.find((p: any) => p.template_id === "s0-B36");
      const cost = (await ok(a, "/production-costs")).items[wheat.id];
      const month = today.slice(0, 7);
      const wip = (await ok(a, `/wip?asOf=${month}&productionId=${wheat.id}`))
        .results[0];
      assert.ok(wip.fullCost, JSON.stringify(wip.errors));
      assert.equal(cost.method, "calendar");
      assert.equal(cost.planned, wip.fullCost);
      assert.equal(cost.toDate, wip.cumulative);
      assert.ok(D(cost.toDate).lte(cost.planned));
      // pregled pre čuvanja daje isti iznos za istu površinu
      const preview = await ok(a, "/production-costs/preview", {
        templateId: "s0-B36",
        scale: "2.5",
        scaleUnit: "ha",
      });
      assert.equal(preview.planned, cost.planned);
      assert.equal(preview.toDate, cost.toDate);
      // dvostruka površina daje dvostruk trošak
      const double = await ok(a, "/production-costs/preview", {
        templateId: "s0-B36",
        scale: "5",
        scaleUnit: "ha",
      });
      assert.equal(
        D(double.planned).toString(),
        D(cost.planned).mul(2).toString(),
      );
      assert.equal(
        (
          await ok(a, "/production-costs/preview", {
            templateId: "s0-B36",
            scale: "25000",
            scaleUnit: "m2",
          })
        ).planned,
        cost.planned,
      );
    },
  );
  await t.test(
    "Stoka: godišnji normativ srazmerno danima, ciklus traži završetak",
    async () => {
      await activate("s7-A2");
      const preview = (end?: string) =>
        ok(a, "/production-costs/preview", {
          templateId: "s7-A2",
          scale: "10",
          start: `${YEAR}-01-01`,
          end: end || `${YEAR}-12-31`,
        });
      const full = await preview();
      assert.equal(full.method, "pro-rata", JSON.stringify(full));
      assert.ok(full.planned);
      const share = elapsedShare(`${YEAR}-01-01`, `${YEAR}-12-31`, today)!;
      assert.equal(
        full.toDate,
        D(full.planned).mul(share).toDecimalPlaces(2).toString(),
      );
      // Sačuvana evidencija bez unetog perioda koristi celu obračunsku godinu.
      const cows = await ok(a, "/productions", {
        templateId: "s7-A2",
        name: "TEST krave",
        year: YEAR,
        status: "draft",
        details: { scale: "10", start: `${YEAR}-01-01`, end: `${YEAR}-12-31` },
      });
      await db.query(
        "UPDATE production_periods SET details=details-'end'-'start' WHERE id=$1",
        [cows.id],
      );
      const stored = (await ok(a, "/production-costs")).items[cows.id];
      assert.equal(stored.method, "pro-rata", JSON.stringify(stored));
      assert.equal(stored.planned, full.planned);
      await activate("s7-G21");
      const cycle = await ok(a, "/production-costs/preview", {
        templateId: "s7-G21",
        scale: "10",
      });
      assert.ok(cycle.planned, JSON.stringify(cycle));
      assert.equal(cycle.toDate, null);
      assert.match(cycle.note, /završetak ciklusa/);
      const ended = await ok(a, "/production-costs/preview", {
        templateId: "s7-G21",
        scale: "10",
        start: `${YEAR}-01-01`,
        end: `${YEAR}-12-31`,
      });
      assert.ok(ended.toDate);
    },
  );
  await t.test("Autorizacija i validacija", async () => {
    assert.equal((await request(undefined, "/production-costs")).status, 401);
    assert.equal(
      (
        await request(a, "/production-costs/preview", {
          templateId: "x",
          scale: "1",
        })
      ).status,
      422,
    );
    assert.equal(
      (
        await request(a, "/production-costs/preview", {
          templateId: "s0-B36",
          scale: "-1",
        })
      ).status,
      422,
    );
  });
});

test.after(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  await closeDatabase();
});
