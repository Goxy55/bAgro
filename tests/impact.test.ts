import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = await mkdtemp(join(tmpdir(), "agro-impact-"));
process.env.DATA_DIR = join(dir, "pg");
process.env.BETTER_AUTH_SECRET =
  "test-only-secret-never-for-production-0123456789";
process.env.APP_URL = "http://localhost:3000";
process.env.MAIL_DIR = join(dir, "mail");
const { app } = await import("../server/app.js");
const { db, closeDatabase } = await import("../server/db.js");
const { importSource } = await import("../server/importer.js");
const { buildImpact } = await import("../server/impact.js");
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

test("buildImpact: stavke, iznosi i nedostajući podaci", () => {
  const prod = (o: any = {}) => ({
    id: "p",
    name: "P",
    missingRate: null,
    stock: "0",
    stockValue: null,
    actualComplete: true,
    ...o,
  });
  const none = buildImpact({
    key: "rsd",
    currency: "RSD",
    productions: [prod()],
    drafts: [],
    nearestRate: null,
  });
  assert.deepEqual(none.items, []);
  const r = buildImpact({
    key: "rsd",
    currency: "RSD",
    productions: [
      prod({
        missingRate: { eurTotal: "500", date: "2026-12-31" },
        stock: "10",
        stockValue: "250.5",
        actualComplete: false,
      }),
      prod({ id: "q", name: "Q", stock: "5", stockValue: null }),
    ],
    drafts: [
      { id: "1", title: "Đubrivo", kind: "cost", amount: "1000" },
      { id: "2", title: "Prodaja", kind: "sale", amount: "4000" },
      { id: "3", title: "Bez iznosa", kind: "cost", amount: null },
    ],
    nearestRate: { rate: "117", validFrom: "2026-01-01", kind: "fixed" },
  });
  const by = Object.fromEntries(r.items.map((i) => [i.code, i]));
  assert.equal(by.fx.amount, "58500");
  assert.match(by.fx.basis, /fiksni/);
  assert.equal(by.drafts.count, 3);
  assert.equal(by.drafts.costAmount, "1000");
  assert.equal(by.drafts.incomeAmount, "4000");
  assert.equal(by.drafts.withoutAmount, 1);
  assert.equal(by.unsold.amount, "250.5");
  assert.equal(by.unsold.withoutAmount, 1);
  assert.equal(by.unconfirmed.amount, null);
  const noRate = buildImpact({
    key: "rsd",
    currency: "RSD",
    productions: [prod({ missingRate: { eurTotal: "500", date: "d" } })],
    drafts: [],
    nearestRate: null,
  });
  assert.equal(noRate.items[0].amount, null);
  assert.equal(noRate.items[0].withoutAmount, 1);
});

test("Fiksni kurs i procena uticaja u izveštaju", async (t) => {
  const admin = await signup("admin-impact@test.local");
  await db.query(
    "INSERT INTO app_admins SELECT id FROM ba_user WHERE email='admin-impact@test.local'",
  );
  const farm = await ok(admin, "/farms", {
    name: "TEST Impact",
    municipality: "",
    year: 2026,
    currency: "RSD",
  });
  admin.farm = farm.id;

  // aktivan normativ u EUR (bez model.currency), 500 EUR po hektaru
  const archive = (await ok(admin, "/admin")).versions.find(
    (v: any) => v.template_id === "s0-B1",
  );
  const versionId = (
    await ok(admin, "/admin/versions", {
      sourceId: archive.id,
      name: "TEST normativ",
      validFrom: "2026-01-01",
      validTo: "2026-12-31",
      reason: "Automatizovani test",
    })
  ).id;
  await ok(
    admin,
    "/admin/versions/" + versionId,
    {
      model: {
        basis: "ha",
        reference: "1",
        reviewed: true,
        sheet: "Usevi",
        range: "F27",
        items: [
          {
            id: "t",
            name: "Materijal",
            quantity: "1",
            price: "500",
            unit: "kg",
            unitConfirmed: true,
            priceInput: {
              amount: "500",
              currency: "EUR",
              date: "2026-01-01",
              estimate: {
                method: "similar",
                basis: "TEST procena",
                similarTo: "TEST artikal",
              },
            },
          },
        ],
        groups: [],
      },
      reason: "Test",
      activate: true,
    },
    "PUT",
  );
  await ok(admin, "/productions", {
    templateId: "s0-B1",
    name: "TEST njiva",
    year: 2026,
    status: "final",
    details: {
      scale: "1",
      scaleUnit: "ha",
      output: "1000",
      outputUnit: "kg",
      product: "ječam",
      start: "2026-01-01",
      end: "2026-12-31",
    },
  });
  await ok(admin, "/events", {
    kind: "cost",
    date: "2026-03-01",
    title: "Đubrivo nacrt",
    status: "draft",
    amount: "1000",
    currency: "RSD",
    details: {},
  });
  const items = async () => {
    const r = await ok(admin, "/report");
    return {
      r,
      by: Object.fromEntries(r.impact.items.map((i: any) => [i.code, i])),
    };
  };

  await t.test(
    "Bez kursa: karta ima procenu, obračun ostaje nepotpun",
    async () => {
      const { r, by } = await items();
      assert.equal(r.totals.normativeCost, null);
      assert.equal(by.fx.amount, null);
      assert.equal(by.drafts.costAmount, "1000");
      assert.equal(by.unsold.count, 1);
      assert.equal(by.unconfirmed.count, 1);
      assert.equal(r.impact.estimate, true);
    },
  );

  await t.test("Najbliži poznati kurs daje procenu, a ne obračun", async () => {
    await ok(admin, "/admin/rates", {
      fixed: true,
      validFrom: "2025-01-01",
      validTo: "2025-12-31",
      rate: "110",
      note: "Test kurs za 2025.",
    });
    const { r, by } = await items();
    assert.equal(by.fx.amount, "55000");
    assert.equal(r.totals.normativeCost, null, "procena ne postaje obračun");
  });

  await t.test(
    "Fiksni kurs za godinu uklanja grešku i označen je u obračunu",
    async () => {
      assert.equal(
        (
          await call(admin, "/admin/rates", {
            fixed: true,
            validFrom: "2026-01-01",
            validTo: "2026-12-31",
            rate: "117",
          })
        ).status,
        422,
        "obrazloženje je obavezno",
      );
      await ok(admin, "/admin/rates", {
        fixed: true,
        validFrom: "2026-01-01",
        validTo: "2026-12-31",
        rate: "117",
        note: "Kurs za 2026. po odluci vlasnika",
      });
      assert.equal(
        (
          await call(admin, "/admin/rates", {
            fixed: true,
            validFrom: "2026-06-01",
            validTo: "2026-07-01",
            rate: "118",
            note: "preklapanje",
          })
        ).status,
        422,
      );
      const { r, by } = await items();
      assert.equal(by.fx, undefined);
      assert.equal(r.results[0].norm.money.rsd, "58500");
      assert.equal(r.results[0].norm.exchangeRate.fixed, true);
      assert.match(
        r.results[0].norm.money.source,
        /Fiksni kurs gazdinstva \(nije zvanični NBS kurs\)/,
      );
      assert.equal(r.results[0].norm.money.rateKind, "fixed");
    },
  );

  await t.test(
    "Zvanični kurs ima prednost, fiksni se može ukloniti",
    async () => {
      await ok(admin, "/admin/rates", {
        validFrom: "2026-12-01",
        validTo: "2026-12-31",
        rate: "120",
        source: "https://www.nbs.rs/kurs",
        publishedAt: "2026-12-01",
      });
      assert.equal(
        (await ok(admin, "/report")).results[0].norm.money.rsd,
        "60000",
      );
      const rates = (await ok(admin, "/admin")).rates;
      const official = rates.find((x: any) => x.kind === "official");
      const fixed = rates.find(
        (x: any) => x.kind === "fixed" && x.valid_from === "2026-01-01",
      );
      assert.equal(
        (await call(admin, "/admin/rates/" + official.id, undefined, "DELETE"))
          .status,
        422,
      );
      await ok(admin, "/admin/rates/" + fixed.id, undefined, "DELETE");
      assert.equal(
        (await ok(admin, "/report")).results[0].norm.money.rsd,
        "60000",
      );
    },
  );
});

test.after(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  await closeDatabase();
});
