import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildRzsImports, rzsDate, serbianLatin } from "../server/rzs.js";

const row = (extra: any = {}) => ({
  idindikator: "130102IND01",
  IDProizvod: "01000",
  nProizvod: "ТЕСТ Пшеница",
  IDVrPod: 2,
  nVrPod: "укупан принос, t",
  IDTer: "RS",
  nTer: "РЕПУБЛИКА СРБИЈА",
  mes: "00",
  god: "2025",
  vrednost: 200,
  idJedinicaMere: null,
  nJedinicaMere: null,
  IDStatusPodatka: "A",
  nStatusPodatka: "Коначан податак",
  ...extra,
});
function packet(rows: any[], extra: any = {}) {
  const bytes = Buffer.from(JSON.stringify(rows));
  return {
    bytes,
    meta: {
      id: "130102IND01",
      title: "ТЕСТ Биљна производња — синтетички подаци",
      jsonUrl: "https://opendata.stat.gov.rs/TEST-rzs-fixture.json",
      sha256: createHash("sha256").update(bytes).digest("hex"),
      recordCount: rows.length,
      actualRecords: rows.length,
      updatedAt: "25.9.2026.",
      retrievedAt: "2026-10-29T17:54:59.031Z",
      ...extra,
    },
  };
}
function build(rows: any[], extra: any = {}) {
  const p = packet(rows, extra);
  return buildRzsImports(p.bytes, p.meta);
}
test("RZS nacionalne serije ne sabiraju regionalne nivoe i čuvaju jedinice i dimenzije", () => {
  const data = build([
    row(),
    row({ IDTer: "RS12", nTer: "Војводина", vrednost: 190 }),
    row({
      IDVrPod: 1,
      nVrPod: "пожњевена површина, ha / родна површина, ha",
      vrednost: 100,
    }),
    row({ IDVrPod: 3, nVrPod: "принос, t/ha", vrednost: 2 }),
    row({ IDProizvod: "35000", nProizvod: "ТЕСТ Малине" }),
    row({ IDProizvod: "35001", nProizvod: "ТЕСТ Купине" }),
  ]);
  assert.equal(data.length, 5);
  assert.equal(
    data.reduce((n, p) => n + p.observations.length, 0),
    5,
  );
  assert.ok(data.every((p) => p.series.geography === "Srbija"));
  assert.deepEqual(
    data
      .filter((p) => p.series.product === "TEST Pšenica")
      .map((p) => p.series.unit)
      .sort(),
    ["ha", "t", "t/ha"],
  );
  assert.equal(data[0].observations[0].value, "200");
  assert.notEqual(data[3].series.id, data[4].series.id);
  assert.equal(serbianLatin("Љубичица и њива"), "Ljubičica i njiva");
});
test("RZS objava ostaje nepoznata; ažuriranje skupa, status i originalna ćelija imaju zasebno poreklo", () => {
  const data = build([
    row(),
    row({
      god: "2026",
      IDStatusPodatka: "P",
      nStatusPodatka: "Претходни податак",
    }),
    row({
      god: "2024",
      vrednost: null,
      IDStatusPodatka: "O",
      nStatusPodatka: "Не располаже се податком",
    }),
  ]);
  const obs = data[0].observations;
  assert.equal(obs[0].publishedAt, null);
  assert.equal(obs[0].sourceUpdatedAt, "2026-09-25");
  assert.equal(obs[0].retrievedAt, "2026-10-29T17:54:59.031Z");
  assert.equal(obs[0].sourceStatus!.sourceRow, 1);
  assert.equal(obs[1].status, "prethodan");
  assert.equal(obs[2].value, null);
  assert.equal(obs[2].status, "nedostaje podatak");
  assert.throws(() => rzsDate("31.2.2026."), /Neispravan/);
});
test("RZS hiljade grla ostaju u izvornoj skali", () => {
  const stock = row({
    idindikator: "1302020101IND01",
    IDPoljProizvod: "41",
    nPoljProizvod: "ТЕСТ Говеда",
    IDProizvod: undefined,
    nProizvod: undefined,
    IDVrPod: 1,
    nVrPod: "Број грла на почетку године",
    vrednost: 1000,
    idJedinicaMere: "THS",
    nJedinicaMere: "хиљада",
  });
  const data = build([stock], {
    id: "1302020101IND01",
    title: "ТЕСТ Биланс стоке",
  });
  assert.equal(data[0].series.unit, "hiljada grla");
  assert.equal(data[0].observations[0].value, "1000");
});
test("RZS izvorni decimalni zapis ostaje precizan bez zaokruživanja kroz double", () => {
  const p = packet([row()]);
  const bytes = Buffer.from(
    p.bytes
      .toString()
      .replace('"vrednost":200', '"vrednost":0.10000000000000001'),
  );
  const result = buildRzsImports(bytes, {
    ...p.meta,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  });
  assert.equal(result[0].observations[0].value, "0.10000000000000001");
});
test("RZS nepoznat status, promenjena jedinica, duplikat, pogrešan hash i mesečni izvod se odbijaju", () => {
  assert.throws(
    () => build([row({ IDStatusPodatka: "Z" })]),
    /Nepoznat izvorni status/,
  );
  assert.throws(() => build([row({ nVrPod: "укупан принос, kg" })]), /osnova/);
  assert.throws(
    () => build([row({ vrednost: 0, IDStatusPodatka: "O" })]),
    /iznos/,
  );
  assert.throws(() => build([row(), row()]), /Ponovljen/);
  assert.throws(() => build([row({ mes: "01" })]));
  const p = packet([row()]);
  assert.throws(() => buildRzsImports(Buffer.from("[]"), p.meta), /SHA-256/);
  assert.throws(
    () => buildRzsImports(p.bytes, { ...p.meta, recordCount: 2 }),
    /Broj redova/,
  );
  assert.throws(() =>
    buildRzsImports(p.bytes, { ...p.meta, id: "03020203IND01" }),
  );
});

const temp = await mkdtemp(join(tmpdir(), "agro-rzs-test-"));
process.env.DATA_DIR = join(temp, "pg");
process.env.BETTER_AUTH_SECRET = "RZS-TEST-only-secret-012345678901234567890";
process.env.APP_URL = "http://localhost:3000";
const { app } = await import("../server/app.js"),
  { db, closeDatabase } = await import("../server/db.js");
const server = app.listen(0, "127.0.0.1");
await new Promise<void>((r) => server.once("listening", r));
const base = `http://127.0.0.1:${(server.address() as any).port}/api`;
type User = { cookie: string };
async function request(u: User | undefined, path: string, body?: any) {
  return fetch(base + path, {
    method: body ? "POST" : "GET",
    headers: {
      Origin: "http://localhost:3000",
      "Content-Type": "application/json",
      ...(u ? { Cookie: u.cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}
async function ok(u: User | undefined, path: string, body?: any) {
  const r = await request(u, path, body),
    b = await r.json();
  assert.ok(r.ok, JSON.stringify(b));
  return b;
}
async function signup(email: string) {
  const r = await request(undefined, "/auth/sign-up/email", {
    email,
    password: "RZS-TEST-password-2026!",
    name: "TEST RZS",
  });
  assert.equal(r.status, 200);
  return {
    cookie: r.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; "),
  };
}
test("RZS godišnji izvod kroz autorizovan API", async (t) => {
  const admin = await signup("admin@rzs.test"),
    member = await signup("member@rzs.test");
  await db.query(
    "INSERT INTO app_admins(user_id) SELECT id FROM ba_user WHERE email='admin@rzs.test'",
  );
  const payload = build([
    row(),
    row({
      god: "2026",
      IDStatusPodatka: "P",
      nStatusPodatka: "Претходни податак",
    }),
  ])[0];
  await t.test("Čitanje zahteva prijavu, uvoz zahteva admina", async () => {
    assert.equal((await request(undefined, "/market")).status, 401);
    assert.equal(
      (await request(member, "/admin/statistics", payload)).status,
      403,
    );
    const result = await ok(admin, "/admin/statistics", payload);
    assert.equal(result.changed, 2);
    const second = await ok(admin, "/admin/statistics", payload);
    assert.equal(second.changed, 0);
  });
  await t.test(
    "Nema izmišljenog datuma objave; pet godina i tekući preliminarni podatak ostaju odvojeni",
    async () => {
      const r = await ok(member, "/market"),
        series = r.series[0],
        o = (await db.query("SELECT * FROM observations WHERE period=2025"))
          .rows[0];
      assert.equal(o.published_at, null);
      assert.ok(o.source_updated_at);
      assert.equal(o.source_status.code, "A");
      assert.equal(o.revision, 1);
      assert.equal(series.summary.count, 1);
      assert.equal(series.summary.points.at(-1).period, 2025);
      assert.equal(series.summary.current[0].period, 2026);
      assert.equal(series.summary.current[0].status, "prethodan");
      assert.equal(series.summary.points[0].value, null);
    },
  );
  await t.test(
    "Izmena čuva prethodni izvor/status i promena značenja ne prepisuje seriju",
    async () => {
      const changed = structuredClone(payload);
      changed.observations[0].value = "201";
      changed.observations[0].status = "revidiran";
      changed.observations[0].sourceStatus!.code = "R";
      changed.observations[0].sourceStatus!.label = "Ревидиран податак";
      await ok(admin, "/admin/statistics", changed);
      const o = (await db.query("SELECT * FROM observations WHERE period=2025"))
        .rows[0];
      assert.equal(o.revision, 2);
      assert.equal(o.history[0].sourceStatus.code, "A");
      assert.equal(o.history[0].value, "200");
      assert.equal(o.history[0].publishedAt, null);
      changed.series.definition = "TEST promenjeno značenje";
      assert.equal(
        (await request(admin, "/admin/statistics", changed)).status,
        422,
      );
      assert.equal(
        (await db.query("SELECT revision FROM observations WHERE period=2025"))
          .rows[0].revision,
        2,
      );
    },
  );
});
test.after(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  await closeDatabase();
  await rm(temp, { recursive: true, force: true });
});
