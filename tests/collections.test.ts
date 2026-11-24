import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = await mkdtemp(join(tmpdir(), "agro-collections-"));
process.env.DATA_DIR = join(dir, "pg");
process.env.BETTER_AUTH_SECRET =
  "test-only-secret-never-for-production-0123456789";
process.env.APP_URL = "http://localhost:3000";
process.env.MAIL_DIR = join(dir, "mail");
const { app } = await import("../server/app.js");
const { closeDatabase } = await import("../server/db.js");
const { importSource } = await import("../server/importer.js");
await importSource();
const server = app.listen(0, "127.0.0.1");
await new Promise<void>((r) => server.once("listening", r));
const base = `http://127.0.0.1:${(server.address() as any).port}`;
type U = { cookie: string; farm?: string };
async function call(u: U, path: string, body?: any, method?: string) {
  return fetch(base + "/api" + path, {
    method: method || (body ? "POST" : "GET"),
    headers: {
      "Content-Type": "application/json",
      Origin: "http://localhost:3000",
      Cookie: u.cookie,
      ...(u.farm ? { "X-Farm-Id": u.farm } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}
async function ok(u: U, path: string, body?: any, method?: string) {
  const r = await call(u, path, body, method);
  const b = await r.json();
  assert.ok(r.ok, `${path}: ${r.status} ${JSON.stringify(b)}`);
  return b;
}

const today = new Date().toISOString().slice(0, 10);
const YEAR = Number(today.slice(0, 4));
async function signup(email: string): Promise<U> {
  const r = await fetch(base + "/api/auth/sign-up/email", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "http://localhost:3000",
    },
    body: JSON.stringify({
      email,
      password: "Local-test-only-2026!",
      name: "t",
    }),
  });
  assert.ok(r.ok, await r.clone().text());
  return {
    cookie: r.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; "),
  };
}

test("Naplata uz prodaju, rokovi, avans i raspoređivanje", async (t) => {
  const u = await signup("naplata@test.local");
  const other = await signup("drugi@test.local");
  u.farm = (
    await ok(u, "/farms", {
      name: "TEST Naplata",
      municipality: "",
      year: YEAR,
      currency: "RSD",
    })
  ).id;
  other.farm = (
    await ok(other, "/farms", {
      name: "TEST Drugi",
      municipality: "",
      year: YEAR,
      currency: "RSD",
    })
  ).id;
  const prod = await ok(u, "/productions", {
    templateId: "s0-B1",
    name: "TEST ječam",
    year: YEAR,
    status: "final",
    details: {
      scale: "1",
      scaleUnit: "ha",
      output: "1000",
      outputUnit: "kg",
      product: "ječam",
      start: `${YEAR}-01-01`,
      end: `${YEAR}-12-31`,
    },
  });
  const sale = (
    title: string,
    quantity: string,
    unitPrice: string,
    extra: any = {},
  ) =>
    ok(u, "/events", {
      kind: "sale",
      productionId: prod.id,
      date: `${YEAR}-01-01`,
      title,
      status: "final",
      currency: "RSD",
      details: { product: "ječam", quantity, unit: "kg", unitPrice, ...extra },
    });
  const pay = (body: any) =>
    call(u, "/payments", {
      date: `${YEAR}-01-10`,
      currency: "RSD",
      category: "Naplata prodaje",
      note: "",
      direction: "in",
      ...body,
    });
  const rec = async () => (await ok(u, "/receivables")).items[prod.id];
  let s1: any, s2: any;

  await t.test(
    "Prodaja nosi kupca i rok plaćanja; pregled potraživanja",
    async () => {
      s1 = (
        await sale("Prodaja A", "100", "35.5", {
          counterparty: "Petrović",
          dueDate: `${YEAR}-01-02`,
        })
      ).id;
      s2 = (
        await sale("Prodaja B", "200", "40", {
          counterparty: "Marić",
          dueDate: `${YEAR + 1}-01-01`,
        })
      ).id;
      const bad = await call(u, "/events", {
        kind: "sale",
        productionId: prod.id,
        date: `${YEAR}-02-01`,
        title: "x",
        status: "final",
        currency: "RSD",
        details: {
          product: "ječam",
          quantity: "1",
          unit: "kg",
          unitPrice: "1",
          dueDate: `${YEAR}-01-01`,
        },
      });
      assert.equal(bad.status, 422, "rok pre datuma");
      const r = await rec();
      assert.equal(r.sold, "11550");
      assert.equal(r.outstanding, "11550");
      assert.equal(r.collected, "0");
      assert.equal(r.sales.length, 2);
      const a = r.sales.find((x: any) => x.id === s1);
      assert.equal(a.buyer, "Petrović");
      assert.equal(a.status, "open");
      if (today > `${YEAR}-01-02`) {
        assert.equal(a.overdue, true);
        assert.ok(a.daysOverdue > 0);
        assert.equal(r.overdue, "3550");
      }
      assert.equal(r.sales.find((x: any) => x.id === s2).overdue, false);
    },
  );

  await t.test(
    "Delimična naplata, sabiranje i zaštita od prekoračenja",
    async () => {
      assert.equal((await pay({ eventId: s1, amount: "1000" })).status, 200);
      let r = await rec();
      const a = r.sales.find((x: any) => x.id === s1);
      assert.equal(a.collected, "1000");
      assert.equal(a.remaining, "2550");
      assert.equal(a.status, "partial");
      assert.equal(r.collected, "1000");
      assert.equal(
        (await pay({ eventId: s1, amount: "5000" })).status,
        422,
        "više od preostalog",
      );
      assert.equal((await pay({ eventId: s1, amount: "2550" })).status, 200);
      r = await rec();
      assert.equal(r.sales.find((x: any) => x.id === s1).status, "paid");
      assert.equal(
        r.sales.find((x: any) => x.id === s1).overdue,
        false,
        "naplaćeno ne kasni",
      );
      assert.equal(r.outstanding, "8000");
    },
  );

  await t.test("Avans: priliv za proizvodnju bez prodaje", async () => {
    assert.equal(
      (
        await pay({
          advance: true,
          eventId: s2,
          productionId: prod.id,
          amount: "5000",
          category: "Avans",
        })
      ).status,
      422,
    );
    assert.equal(
      (
        await pay({
          advance: true,
          productionId: prod.id,
          direction: "out",
          amount: "5000",
          category: "Avans",
        })
      ).status,
      422,
    );
    assert.equal(
      (await pay({ advance: true, amount: "5000", category: "Avans" })).status,
      422,
      "traži proizvodnju",
    );
    assert.equal(
      (
        await pay({
          advance: true,
          productionId: prod.id,
          amount: "5000",
          buyer: "Marić",
          category: "Avans",
        })
      ).status,
      200,
    );
    const r = await rec();
    assert.equal(r.advances, "5000");
    assert.equal(r.advanceRows[0].buyer, "Marić");
    assert.equal(
      r.outstanding,
      "8000",
      "avans ne umanjuje potraživanje dok se ne rasporedi",
    );
    const report = await ok(u, `/report?productionId=${prod.id}`);
    assert.equal(report.cashTotals.incoming, "8550", "avans je novčani priliv");
  });

  await t.test(
    "Raspoređivanje avansa na prodaju (deo, pa ostatak)",
    async () => {
      const advance = (await rec()).advanceRows[0].id;
      const allocate = (id: string, body: any, who = u) =>
        call(who, `/payments/${id}/allocate`, body);
      assert.equal(
        (await allocate(advance, { eventId: s1 })).status,
        422,
        "prodaja A je naplaćena",
      );
      assert.equal(
        (await allocate(advance, { eventId: s2, amount: "9000" })).status,
        422,
        "više od avansa",
      );
      assert.equal(
        (await allocate(advance, { eventId: s2, amount: "2000" })).status,
        200,
      );
      let r = await rec();
      assert.equal(r.sales.find((x: any) => x.id === s2).collected, "2000");
      assert.equal(r.advances, "3000");
      assert.equal(r.advanceRows[0].amount, "3000");
      assert.equal(
        (await allocate(advance, { eventId: s2 }, other)).status,
        422,
        "tuđe gazdinstvo",
      );
      assert.equal(
        (await allocate(advance, { eventId: s2 })).status,
        200,
        "ostatak avansa",
      );
      r = await rec();
      assert.equal(r.advanceRows.length, 0);
      assert.equal(r.sales.find((x: any) => x.id === s2).collected, "5000");
      assert.equal(r.outstanding, "3000");
      const report = await ok(u, "/report");
      assert.equal(
        report.cashTotals.incoming,
        "8550",
        "raspoređivanje ne menja priliv",
      );
    },
  );
});

test.after(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  await closeDatabase();
});
