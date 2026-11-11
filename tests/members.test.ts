import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = await mkdtemp(join(tmpdir(), "agro-members-"));
process.env.DATA_DIR = join(dir, "pg");
process.env.BETTER_AUTH_SECRET =
  "test-only-secret-never-for-production-0123456789";
process.env.APP_URL = "http://localhost:3000";
process.env.MAIL_DIR = join(dir, "mail");
const { app } = await import("../server/app.js");
const { db, closeDatabase } = await import("../server/db.js");
const { importSource } = await import("../server/importer.js");
await importSource();
const server = app.listen(0, "127.0.0.1");
await new Promise<void>((r) => server.once("listening", r));
const base = `http://127.0.0.1:${(server.address() as any).port}`;
const PASSWORD = "Local-test-only-2026!";
type U = { cookie: string; email: string; farm?: string };
async function call(
  u: U | undefined,
  path: string,
  body?: any,
  method?: string,
) {
  return fetch(base + "/api" + path, {
    method: method || (body ? "POST" : "GET"),
    headers: {
      "Content-Type": "application/json",
      Origin: "http://localhost:3000",
      ...(u ? { Cookie: u.cookie } : {}),
      ...(u?.farm ? { "X-Farm-Id": u.farm } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}
async function signup(email: string): Promise<U> {
  const r = await call(undefined, "/auth/sign-up/email", {
    email,
    password: PASSWORD,
    name: email.split("@")[0],
  });
  assert.ok(r.ok, await r.clone().text());
  return {
    email,
    cookie: r.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; "),
  };
}
const json = async (r: Response) => r.json() as Promise<any>;

test("Članovi, pozivnice, izvoz i anonimizacija", async (t) => {
  const owner = await signup("vlasnik@test.local");
  const viewer = await signup("pregled@test.local");
  const stranger = await signup("stranac@test.local");
  const created = await json(
    await call(owner, "/farms", {
      name: "TEST Gazdinstvo Ana",
      municipality: "Šabac",
      year: 2026,
      currency: "RSD",
    }),
  );
  owner.farm = created.id;
  let token = "";

  await t.test(
    "Samo vlasnik poziva; link je jednokratan i za tu adresu",
    async () => {
      assert.equal(
        (
          await call(viewer, "/invites", {
            email: "x@test.local",
            role: "viewer",
          })
        ).status,
        422,
      );
      const r = await json(
        await call(owner, "/invites", {
          email: "Pregled@Test.local",
          role: "viewer",
        }),
      );
      assert.match(r.url, /\/\?invite=[\w-]{40,}/);
      assert.equal(r.emailed, false);
      token = new URL(r.url).searchParams.get("invite")!;
      const stored = (await db.query("SELECT token_hash FROM farm_invites"))
        .rows[0];
      assert.notEqual(
        stored.token_hash,
        token,
        "token se ne čuva u izvornom obliku",
      );

      assert.equal(
        (await call(stranger, "/invites/accept", { token })).status,
        422,
      );
      assert.equal(
        (await call(viewer, "/invites/accept", { token: "x".repeat(30) }))
          .status,
        422,
      );
      const ok = await call(viewer, "/invites/accept", { token });
      assert.equal(ok.status, 200);
      assert.equal(
        (await call(viewer, "/invites/accept", { token })).status,
        422,
        "ponovna upotreba",
      );
      viewer.farm = (await json(ok)).farmId;
    },
  );

  await t.test("Pregledač čita, ali ne menja", async () => {
    assert.equal((await call(viewer, "/productions")).status, 200);
    const w = await call(viewer, "/productions", {
      templateId: "s0-B1",
      name: "x",
      year: 2026,
      status: "draft",
      details: {},
    });
    assert.equal(w.status, 403);
    assert.equal(
      (await call(viewer, "/snapshots", { reason: "x" })).status,
      403,
    );
  });

  await t.test("Član unosi podatke, ali ne upravlja članovima", async () => {
    assert.equal(
      (
        await call(
          owner,
          `/members/${(await json(await call(owner, "/members"))).members.find((m: any) => m.email === "pregled@test.local").user_id}`,
          { role: "member" },
          "PATCH",
        )
      ).status,
      200,
    );
    const w = await call(viewer, "/productions", {
      templateId: "s0-B1",
      name: "TEST",
      year: 2026,
      status: "draft",
      details: {},
    });
    assert.notEqual(w.status, 403);
    assert.equal(
      (
        await call(viewer, "/invites", {
          email: "novi@test.local",
          role: "member",
        })
      ).status,
      422,
    );
    const list = await json(await call(viewer, "/members"));
    assert.equal(list.invites.length, 0, "član ne vidi pozivnice");
    assert.equal(list.members.length, 2);
  });

  await t.test("Istekla pozivnica ne važi; nova zamenjuje staru", async () => {
    await call(owner, "/invites", {
      email: "stranac@test.local",
      role: "viewer",
    });
    const second = await json(
      await call(owner, "/invites", {
        email: "stranac@test.local",
        role: "viewer",
      }),
    );
    assert.equal(
      (
        await db.query(
          "SELECT count(*)::int n FROM farm_invites WHERE accepted_at IS NULL",
        )
      ).rows[0].n,
      1,
    );
    await db.query(
      "UPDATE farm_invites SET expires_at=now()-interval '1 day' WHERE accepted_at IS NULL",
    );
    assert.equal(
      (
        await call(stranger, "/invites/accept", {
          token: new URL(second.url).searchParams.get("invite")!,
        })
      ).status,
      422,
    );
  });

  await t.test("Izvoz sadrži podatke vlasnika bez tajni", async () => {
    await call(owner, "/productions", {
      templateId: "s0-B1",
      name: "TEST njiva",
      year: 2026,
      status: "draft",
      details: { note: "privatna beleška" },
    });
    const r = await call(owner, "/account/export");
    assert.equal(r.status, 200);
    assert.match(r.headers.get("content-disposition") || "", /attachment/);
    const text = await r.text();
    const data = JSON.parse(text);
    assert.equal(data.user.email, "vlasnik@test.local");
    const farm = data.farms[owner.farm!];
    assert.equal(farm.farms[0].name, "TEST Gazdinstvo Ana");
    assert.equal(farm.production_periods.length, 2);
    assert.equal(farm.members.length, 2);
    assert.ok(!/token_hash|password/i.test(text));
    const asViewer = JSON.parse(
      await (await call(viewer, "/account/export")).text(),
    );
    assert.deepEqual(
      asViewer.farms,
      {},
      "član ne izvozi tuđe poslovne podatke",
    );
  });

  await t.test("Brisanje: lozinka, članovi, anonimizacija", async () => {
    const del = (u: U, body: any) => call(u, "/account", body, "DELETE");
    assert.equal(
      (await del(owner, { password: PASSWORD, confirm: "x" })).status,
      422,
    );
    assert.equal(
      (await del(owner, { password: "pogresna-lozinka-1", confirm: "OBRIŠI" }))
        .status,
      422,
    );
    const blocked = await json(
      await del(owner, { password: PASSWORD, confirm: "OBRIŠI" }),
    );
    assert.match(blocked.error, /uklonite ostale članove/);

    const members = (await json(await call(owner, "/members"))).members;
    const other = members.find((m: any) => m.email === "pregled@test.local");
    assert.equal(
      (await call(owner, `/members/${other.user_id}`, undefined, "DELETE"))
        .status,
      200,
    );
    assert.equal(
      (await call({ ...viewer, farm: undefined }, "/bootstrap")).status,
      200,
      "uklonjenom članu ostaje njegov nalog",
    );
    assert.equal(
      (await call(owner, `/members/${owner.farm}`, undefined, "DELETE")).status,
      422,
    );

    const ok = await del(owner, { password: PASSWORD, confirm: "OBRIŠI" });
    assert.equal(ok.status, 200, await ok.clone().text());
    assert.equal(
      (await call(owner, "/bootstrap")).status,
      401,
      "sesija je ukinuta",
    );
    const login = await call(undefined, "/auth/sign-in/email", {
      email: "vlasnik@test.local",
      password: PASSWORD,
    });
    assert.ok(!login.ok);

    const u = (
      await db.query(
        `SELECT name,email FROM ba_user WHERE email LIKE 'deleted-%'`,
      )
    ).rows;
    assert.equal(u.length, 1);
    assert.equal(u[0].name, "Obrisan korisnik");
    assert.equal(
      (
        await db.query(
          `SELECT count(*)::int n FROM ba_account WHERE "accountId" IS NOT NULL AND "userId" IN (SELECT id FROM ba_user WHERE email LIKE 'deleted-%')`,
        )
      ).rows[0].n,
      0,
    );
    const farm = (
      await db.query("SELECT name,municipality FROM farms WHERE id=$1", [
        owner.farm,
      ])
    ).rows[0];
    assert.deepEqual(
      { ...farm },
      { name: "Obrisano gazdinstvo", municipality: "" },
    );
    const prod = (
      await db.query(
        "SELECT name,details FROM production_periods WHERE farm_id=$1",
        [owner.farm],
      )
    ).rows[0];
    assert.equal(prod.details.note, undefined);
    assert.equal(
      (await db.query("SELECT count(*)::int n FROM farm_invites")).rows[0].n,
      0,
    );
  });

  await t.test("Administrator ne briše nalog ovde", async () => {
    const admin = stranger;
    await db.query(
      "INSERT INTO app_admins SELECT id FROM ba_user WHERE email='stranac@test.local'",
    );
    const r = await json(
      await call(
        admin,
        "/account",
        { password: PASSWORD, confirm: "OBRIŠI" },
        "DELETE",
      ),
    );
    assert.match(r.error, /Administratorski/);
  });
});

test.after(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  await closeDatabase();
});
