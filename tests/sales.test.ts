import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = await mkdtemp(join(tmpdir(), "agro-sales-"));
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

test("Prodaja: iznos je količina × cena po jedinici, računa ga server", async (t) => {
  const r = await fetch(base + "/api/auth/sign-up/email", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "http://localhost:3000",
    },
    body: JSON.stringify({
      email: "prodaja@test.local",
      password: "Local-test-only-2026!",
      name: "t",
    }),
  });
  const u: U = {
    cookie: r.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; "),
  };
  u.farm = (
    await ok(u, "/farms", {
      name: "TEST Prodaja",
      municipality: "",
      year: 2026,
      currency: "RSD",
    })
  ).id;
  const prod = await ok(u, "/productions", {
    templateId: "s0-B1",
    name: "TEST ječam",
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
  const sale = (extra: any = {}, details: any = {}) =>
    call(u, "/events", {
      kind: "sale",
      productionId: prod.id,
      date: "2026-08-01",
      title: "Prodaja ječma",
      status: "final",
      currency: "RSD",
      details: {
        product: "ječam",
        quantity: "100",
        unit: "kg",
        unitPrice: "35.5",
        ...details,
      },
      ...extra,
    });
  const money = async () =>
    (await ok(u, "/events"))
      .filter((e: any) => e.kind === "sale")
      .map((e: any) => e.money?.original);

  await t.test("Bez unetog iznosa: količina × cena", async () => {
    assert.equal((await sale()).status, 200);
    assert.deepEqual(await money(), ["3550"]);
  });
  await t.test("Zaokruživanje na dve decimale (HALF_UP)", async () => {
    assert.equal(
      (await sale({}, { quantity: "3", unitPrice: "0.335" })).status,
      200,
    );
    assert.ok((await money()).includes("1.01"));
  });
  await t.test(
    "Iznos koji se ne slaže sa količinom × cenom se odbija",
    async () => {
      const r = await sale({ amount: "9999" });
      assert.equal(r.status, 422);
      assert.match((await r.json()).error, /količinom × cenom/);
      assert.equal(
        (await sale({ amount: "3550.00" })).status,
        200,
        "usklađen iznos prolazi",
      );
    },
  );
  await t.test(
    "Nacrt bez cene čuva se bez iznosa; završena prodaja ga traži",
    async () => {
      const draft = await sale({ status: "draft" }, { unitPrice: undefined });
      assert.equal(draft.status, 200);
      const final = await sale({}, { unitPrice: undefined });
      assert.equal(final.status, 422);
    },
  );
  await t.test("Zaliha se i dalje proverava", async () => {
    const r = await sale({}, { quantity: "100000" });
    assert.equal(r.status, 422);
    assert.match((await r.json()).error, /Nedovoljno zaliha/);
  });
});

test.after(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  await closeDatabase();
});
