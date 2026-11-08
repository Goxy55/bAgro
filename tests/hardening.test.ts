import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import {
  classifyError,
  UserError,
  INTERNAL_MESSAGE,
} from "../server/errors.js";

const dir = await mkdtemp(join(tmpdir(), "agro-hardening-"));
process.env.DATA_DIR = join(dir, "pg");
process.env.BETTER_AUTH_SECRET =
  "test-only-secret-never-for-production-0123456789";
process.env.APP_URL = "http://localhost:3000";
process.env.MAIL_DIR = join(dir, "mail");
const { app } = await import("../server/app.js");
const { db, client, closeDatabase } = await import("../server/db.js");
const { purgeAudit, auditRetentionDays } =
  await import("../server/audit-retention.js");
const server = app.listen(0, "127.0.0.1");
await new Promise<void>((r) => server.once("listening", r));
const base = `http://127.0.0.1:${(server.address() as any).port}`;
const headers = {
  "Content-Type": "application/json",
  Origin: "http://localhost:3000",
};

test("Klasifikacija grešaka: poslovne ostaju 422, interne ne cure korisniku", () => {
  assert.deepEqual(classifyError(new UserError("Poruka")), {
    status: 422,
    message: "Poruka",
    internal: false,
  });
  assert.equal(classifyError(new Error("Nedovoljna zaliha.")).status, 422);
  assert.equal(
    classifyError(Object.assign(new Error("x"), { status: 409 })).status,
    409,
  );
  const zod = z.object({ a: z.string() }).safeParse({}).error!;
  assert.equal(classifyError(zod).status, 422);
  assert.equal(classifyError({ code: "23505", message: "dup" }).status, 422);
  assert.equal(classifyError({ code: "22P02" }).status, 422);
  for (const e of [
    new TypeError("Cannot read properties of undefined"),
    Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }),
    Object.assign(new Error("deadlock"), { code: "40P01" }),
    "string",
    undefined,
  ]) {
    const c = classifyError(e);
    assert.equal(c.status, 500);
    assert.equal(c.internal, true);
    assert.equal(c.message, INTERNAL_MESSAGE);
  }
  const big = Object.assign(new Error("request entity too large"), {
    status: 413,
    expose: true,
  });
  assert.equal(classifyError(big).status, 413);
});

test("AUDIT_RETENTION_DAYS", () => {
  assert.equal(auditRetentionDays({}), 365);
  assert.equal(auditRetentionDays({ AUDIT_RETENTION_DAYS: "90" }), 90);
  assert.equal(auditRetentionDays({ AUDIT_RETENTION_DAYS: "0" }), 0);
  assert.throws(() => auditRetentionDays({ AUDIT_RETENTION_DAYS: "-1" }));
  assert.throws(() => auditRetentionDays({ AUDIT_RETENTION_DAYS: "abc" }));
});

test("Audit, zaglavlja i retencija", async (t) => {
  const signup = await fetch(base + "/api/auth/sign-up/email", {
    method: "POST",
    headers,
    body: JSON.stringify({
      email: "hardening@example.test",
      password: "Local-test-only-2026!",
      name: "hardening",
    }),
  });
  assert.ok(signup.ok, signup.status + " " + (await signup.clone().text()));
  const cookie = signup.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  const authed = { ...headers, Cookie: cookie };
  const count = async () =>
    (await db.query("SELECT count(*)::int n FROM audit_log")).rows[0].n;

  await t.test("GET se ne beleži, izmena se beleži", async () => {
    const created = await fetch(base + "/api/farms", {
      method: "POST",
      headers: authed,
      body: JSON.stringify({
        name: "TEST Audit",
        municipality: "",
        year: 2026,
        currency: "RSD",
      }),
    });
    assert.equal(created.status, 200);
    const before = await count();
    for (const path of ["/api/bootstrap", "/api/productions", "/api/events"]) {
      const r = await fetch(base + path, { headers: authed });
      assert.equal(r.status, 200, path);
    }
    assert.equal(await count(), before);
    const r = await fetch(base + "/api/farms", {
      method: "POST",
      headers: authed,
      body: JSON.stringify({
        name: "TEST Audit 2",
        municipality: "",
        year: 2026,
        currency: "RSD",
      }),
    });
    assert.equal(r.status, 200);
    assert.ok((await count()) > before);
  });

  await t.test("API je no-store i nosi X-Request-Id", async () => {
    const r = await fetch(base + "/api/bootstrap", { headers: authed });
    assert.equal(r.headers.get("cache-control"), "no-store");
    assert.match(r.headers.get("x-request-id") || "", /^[0-9a-f-]{36}$/);
  });

  await t.test("Poslovna greška 422, nepoznata ruta 404", async () => {
    const r = await fetch(base + "/api/productions", {
      method: "POST",
      headers: authed,
      body: JSON.stringify({
        templateId: "nepostoji",
        name: "x",
        year: 2026,
        status: "draft",
        details: {},
      }),
    });
    assert.equal(r.status, 422);
    assert.equal(
      (await fetch(base + "/api/nema", { headers: authed })).status,
      404,
    );
  });

  await t.test("Neispravan JSON nije 500 ni 422", async () => {
    const r = await fetch(base + "/api/farms", {
      method: "POST",
      headers: authed,
      body: "{nije json",
    });
    assert.equal(r.status, 400);
  });

  await t.test("Retencija briše samo stare zapise", async () => {
    const user = (await db.query("SELECT id FROM ba_user LIMIT 1")).rows[0].id;
    await db.query(
      "INSERT INTO audit_log(id,user_id,action,entity,at) VALUES (gen_random_uuid(),$1,'test','old',now()-interval '400 days'),(gen_random_uuid(),$1,'test','new',now()-interval '10 days')",
      [user],
    );
    assert.equal(await purgeAudit(0), 0);
    assert.equal(await purgeAudit(365), 1);
    const left = (
      await db.query("SELECT entity FROM audit_log WHERE action='test'")
    ).rows;
    assert.deepEqual(
      left.map((r: any) => r.entity),
      ["new"],
    );
  });
});

test.after(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  await closeDatabase();
  void client;
});
