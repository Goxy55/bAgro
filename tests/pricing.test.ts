import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  buildPricingTable,
  hash,
  versionRevision,
} from "../server/pricing/model.js";
import type { PricingTable, PricingRow } from "../shared/pricing.js";
import { D } from "../server/domain.js";

const inventory = JSON.parse(await readFile("source/inventory.json", "utf8"));
test("Zajedničke izvorne stavke zadržavaju kulture, jedinice i pojedinačne ćelije", () => {
  const cards = inventory.cards.filter((c: any) => c.sheet === "Usevi");
  const before = JSON.stringify(cards);
  const table = buildPricingTable(
    cards.map((c: any) => ({
      id: c.id,
      template_id: c.id,
      template_name: c.name,
      status: "draft",
      valid_from: "2026-01-01",
      valid_to: "2026-12-31",
      reason: "TEST",
      model: c,
    })),
  );
  assert.equal(table.versions.length, 15);
  assert.equal(
    table.rows.reduce((n, r) => n + r.occurrences.length, 0),
    330,
  );
  const fertilizer = table.rows.find((r) => r.name === "NPK đubrivo 15:15:15")!;
  assert.equal(fertilizer.occurrences.length, 11);
  assert.equal(
    table.rows.filter((r) => r.name.startsWith("Seme · ")).length,
    9,
  );
  assert.ok(
    fertilizer.occurrences.every(
      (o) => o.quantityCell && o.priceCell && o.sheet === "Usevi",
    ),
  );
  assert.equal(JSON.stringify(cards), before);
});
test("Revizija cenovnika je stabilna kroz PostgreSQL JSONB redosled ključeva", () => {
  assert.equal(
    hash({ b: 2, a: { z: 3, y: 4 } }),
    hash({ a: { y: 4, z: 3 }, b: 2 }),
  );
  const v: any = {
    id: "test",
    status: "draft",
    valid_from: "2026-01-01",
    valid_to: "2026-12-31",
    reason: "TEST",
    model: { a: 1, b: 2 },
  };
  assert.equal(
    versionRevision(v),
    versionRevision({
      ...v,
      valid_from: new Date("2026-01-01"),
      model: { b: 2, a: 1 },
    }),
  );
});

const temp = await mkdtemp(join(tmpdir(), "bagro-pricing-test-"));
process.env.DATA_DIR = join(temp, "pg");
process.env.BETTER_AUTH_SECRET =
  "Pricing-TEST-only-secret-01234567890123456789";
process.env.APP_URL = "http://localhost:3000";
const { app } = await import("../server/app.js");
const { db, closeDatabase } = await import("../server/db.js");
const { importSource } = await import("../server/importer.js");
const server = app.listen(0, "127.0.0.1");
await new Promise<void>((r) => server.once("listening", r));
const base = `http://127.0.0.1:${(server.address() as any).port}/api`;
type Account = { cookie: string };
async function request(
  user: Account | undefined,
  path: string,
  body?: any,
  method?: string,
) {
  return fetch(base + path, {
    method: method || (body ? "POST" : "GET"),
    headers: {
      Origin: "http://localhost:3000",
      "Content-Type": "application/json",
      ...(user ? { Cookie: user.cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}
async function ok(
  user: Account | undefined,
  path: string,
  body?: any,
  method?: string,
) {
  const r = await request(user, path, body, method),
    v = await r.json();
  assert.ok(r.ok, `${path}: ${r.status} ${JSON.stringify(v)}`);
  return v;
}
async function signup(email: string) {
  const r = await request(undefined, "/auth/sign-up/email", {
    email,
    password: "Pricing-TEST-password-2026!",
    name: "TEST cenovnik",
  });
  assert.equal(r.status, 200);
  return {
    cookie: r.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; "),
  };
}
let admin: Account,
  member: Account,
  selected: string[],
  originalIds: string[],
  last: PricingTable;
const fixture = (q: string) => ({
  basis: "ha",
  reference: "1",
  reviewed: true,
  sheet: "Usevi",
  range: "TEST-fixture",
  groups: [],
  items: [
    {
      id: "fert",
      name: "NPK đubrivo 15:15:15",
      quantity: q,
      price: null,
      unit: "kg",
      unitConfirmed: true,
    },
    {
      id: "seed",
      name: "Seme",
      quantity: "100",
      price: "1",
      unit: "kg",
      unitConfirmed: true,
    },
    {
      id: "tons",
      name: "NPK đubrivo 15:15:15",
      quantity: "0.3",
      price: "1000",
      unit: "t",
      unitConfirmed: true,
    },
  ],
});
const current = async () => (await ok(admin, "/admin")).versions;
const load = async (ids = selected) =>
  (await ok(
    admin,
    "/admin/pricing/table?versionIds=" + ids.join(","),
  )) as PricingTable;
const rowFor = (t: PricingTable, unit = "kg") =>
  t.rows.find((r) => r.name === "NPK đubrivo 15:15:15" && r.unit === unit)!;
const change = (r: PricingRow, price: string | null, extra: any = {}) => ({
  key: r.key,
  price,
  currency: "EUR",
  unit: r.unit,
  confirmUnit: false,
  zeroReason: "",
  ...extra,
});
const save = async (t: PricingTable, rows: any[], extra: any = {}) =>
  ok(
    admin,
    "/admin/pricing/table",
    {
      versionIds: t.versions.map((v) => v.id),
      revision: t.revision,
      date: "2026-02-01",
      reason: "TEST zajednički unos",
      rows,
      ...extra,
    },
    "PUT",
  );
async function resetModels() {
  const all = await current();
  for (let n = 0; n < selected.length; n++) {
    const v = all.find((v: any) => v.id === selected[n]);
    await ok(
      admin,
      "/admin/versions/" + v.id,
      {
        model: fixture(n === 0 ? "300" : "200"),
        reason: "TEST sintetičke količine",
        revision: v.revision,
      },
      "PUT",
    );
  }
}
test("Admin zajednički cenovnik: transakcije, obračuni i zaštićene verzije", async (t) => {
  await importSource();
  admin = await signup("admin@pricing.test");
  member = await signup("member@pricing.test");
  const user = (
    await db.query("SELECT id FROM ba_user WHERE email='admin@pricing.test'")
  ).rows[0];
  await db.query("INSERT INTO app_admins(user_id) VALUES($1)", [user.id]);
  const originals = (await current()).filter((v: any) =>
    ["s0-B1", "s0-B36"].includes(v.template_id),
  );
  originalIds = originals.map((v: any) => v.id);
  const originalModels = hash(originals.map((v: any) => [v.id, v.model]));
  await t.test(
    "Običan korisnik ne može čitati ili pisati zajednički cenovnik",
    async () => {
      assert.equal(
        (
          await request(
            undefined,
            "/admin/pricing/table?versionIds=" + originalIds.join(","),
          )
        ).status,
        401,
      );
      assert.equal(
        (
          await request(
            member,
            "/admin/pricing/table?versionIds=" + originalIds.join(","),
          )
        ).status,
        403,
      );
      assert.equal(
        (await request(member, "/admin/pricing/drafts", {})).status,
        403,
      );
      assert.equal(
        (await request(member, "/admin/pricing/table", {}, "PUT")).status,
        403,
      );
    },
  );
  await t.test(
    "Grupno pravljenje nacrta ne prenosi istorijske cene i ponavljanje ne duplira verzije",
    async () => {
      const body = {
        sourceIds: originalIds,
        requestId: randomUUID(),
        name: "TEST novi cenovnik",
        validFrom: "2026-01-01",
        validTo: "2026-12-31",
        reason: "TEST grupni unos",
      };
      const first = await ok(admin, "/admin/pricing/drafts", body),
        second = await ok(admin, "/admin/pricing/drafts", body);
      selected = first.ids;
      assert.deepEqual([...second.ids].sort(), [...first.ids].sort());
      assert.equal(second.reused, true);
      const all = await current();
      for (const v of all.filter((v: any) => selected.includes(v.id))) {
        const source = originals.find(
          (s: any) => s.template_id === v.template_id,
        );
        assert.equal(v.status, "draft");
        assert.ok(
          v.model.items.every((i: any) => i.price === null && !i.unitConfirmed),
        );
        assert.deepEqual(
          v.model.items.map((i: any) => i.quantity),
          source.model.items.map((i: any) => i.quantity),
        );
      }
      assert.equal(
        hash(
          all
            .filter((v: any) => originalIds.includes(v.id))
            .map((v: any) => [v.id, v.model]),
        ),
        originalModels,
      );
      assert.equal(
        (
          await request(admin, "/admin/pricing/drafts", {
            ...body,
            name: "TEST druga namena istog zahteva",
          })
        ).status,
        409,
      );
    },
  );
  await t.test(
    "Jedna cena daje različite troškove po normiranim količinama; kg/t i seme ostaju odvojeni",
    async () => {
      await resetModels();
      const table = await load();
      assert.equal(table.rows.length, 4);
      assert.equal(
        table.rows.filter((r) => r.name.startsWith("Seme · ")).length,
        2,
      );
      const result = await save(table, [change(rowFor(table), "2")]);
      last = result.table;
      assert.deepEqual(
        rowFor(last)
          .occurrences.map((o) => o.quantity)
          .sort(),
        ["200", "300"],
      );
      assert.deepEqual(
        rowFor(last)
          .occurrences.map((o) => o.costEur)
          .sort(),
        ["400", "600"],
      );
      assert.equal(rowFor(last, "t").priceEur, "1000");
      assert.equal(
        (await load()).revision,
        last.revision,
        "Database JSONB round-trip must preserve the revision",
      );
      const again = await save(last, [change(rowFor(last), "3")]);
      last = again.table;
      assert.ok(rowFor(last).occurrences.every((o) => o.priceEur === "3"));
    },
  );
  await t.test(
    "Zastarela tabela i pojedinačni editor ne prepisuju novije cene",
    async () => {
      const all = await current(),
        old = all.find((v: any) => v.id === selected[0]);
      const stale = await load();
      last = (await save(stale, [change(rowFor(stale), "4")])).table;
      const response = await request(
        admin,
        "/admin/pricing/table",
        {
          versionIds: selected,
          revision: stale.revision,
          date: "2026-01-01",
          reason: "TEST stari prozor",
          rows: [change(rowFor(stale), "9")],
        },
        "PUT",
      );
      assert.equal(response.status, 409);
      assert.equal(
        (
          await request(
            admin,
            "/admin/versions/" + old.id,
            {
              model: old.model,
              reason: "TEST zastareli pojedinačni prozor",
              revision: old.revision,
            },
            "PUT",
          )
        ).status,
        409,
      );
      assert.equal(rowFor(await load()).priceEur, "4");
    },
  );
  await t.test(
    "NBS RSD cena čuva datum, originalni iznos i istorijski kurs",
    async () => {
      await ok(admin, "/admin/rates", {
        validFrom: "2026-01-01",
        validTo: "2026-12-31",
        rate: "120",
        publishedAt: "2026-01-01",
        source:
          "https://webappcenter.nbs.rs/ExchangeRateWebApp/ExchangeRate/CurrentMiddleRate",
      });
      const table = await load();
      last = (
        await save(table, [change(rowFor(table), "240", { currency: "RSD" })])
      ).table;
      assert.equal(rowFor(last).priceEur, "2");
      const v = (await current()).find((v: any) => v.id === selected[0]);
      assert.ok(D(v.model.items[0].priceInput.rate.value).eq("120"));
      assert.equal(v.model.items[0].priceInput.amount, "240");
      assert.equal(v.model.items[0].priceInput.date, "2026-02-01");
    },
  );
  await t.test(
    "Nedostajući kurs čuva RSD nacrt bez izmišljene EUR cene ili aktiviranja",
    async () => {
      const table = await load(),
        result = await save(
          table,
          [change(rowFor(table), "240", { currency: "RSD" })],
          { date: "2027-01-02" },
        );
      assert.ok(result.warnings.length);
      assert.equal(rowFor(result.table).priceEur, null);
      assert.ok(
        rowFor(result.table).occurrences.every((o) => o.lastInput?.pendingRate),
      );
      const v = (await current()).find((v: any) => v.id === selected[0]);
      assert.equal(
        (
          await request(
            admin,
            "/admin/versions/" + v.id,
            {
              model: v.model,
              reason: "TEST nepotpun kurs",
              activate: true,
              revision: v.revision,
            },
            "PUT",
          )
        ).status,
        422,
      );
    },
  );
  await t.test(
    "Nula zahteva razlog; prazna cena ostaje nepoznata",
    async () => {
      const table = await load();
      assert.equal(
        (
          await request(
            admin,
            "/admin/pricing/table",
            {
              versionIds: selected,
              revision: table.revision,
              date: "2026-01-01",
              reason: "TEST",
              rows: [change(rowFor(table), "0")],
            },
            "PUT",
          )
        ).status,
        422,
      );
      assert.equal((await load()).revision, table.revision);
      let result = await save(table, [
        change(rowFor(table), "0", {
          zeroReason: "TEST potvrđen besplatan input",
        }),
      ]);
      assert.ok(
        rowFor(result.table).occurrences.every(
          (o: any) => o.costEur === "0" && !!o.zeroReason,
        ),
      );
      result = await save(result.table, [change(rowFor(result.table), null)]);
      assert.equal(rowFor(result.table).priceEur, null);
    },
  );
  await t.test(
    "Cela primena se poništava ako jedna stavka ili jedinica nije ispravna",
    async () => {
      const table = await load();
      const invalid = change(rowFor(table, "t"), "2", {
        unit: "kg",
        confirmUnit: true,
      });
      assert.equal(
        (
          await request(
            admin,
            "/admin/pricing/table",
            {
              versionIds: selected,
              revision: table.revision,
              date: "2026-01-01",
              reason: "TEST atomarnost",
              rows: [change(rowFor(table), "7"), invalid],
            },
            "PUT",
          )
        ).status,
        422,
      );
      assert.equal((await load()).revision, table.revision);
      const missing = { ...change(rowFor(table), "7"), key: "f".repeat(64) };
      assert.equal(
        (
          await request(
            admin,
            "/admin/pricing/table",
            {
              versionIds: selected,
              revision: table.revision,
              date: "2026-01-01",
              reason: "TEST nepostojeća stavka",
              rows: [missing],
            },
            "PUT",
          )
        ).status,
        422,
      );
    },
  );
  await t.test(
    "Potvrda nejasne jedinice ne menja članstvo drugih redova tokom iste transakcije",
    async () => {
      const all = await current(),
        v = all.find((v: any) => v.id === selected[0]);
      const model = fixture("300");
      model.items.push({
        id: "unclear",
        name: "NPK đubrivo 15:15:15",
        quantity: "5",
        price: null,
        unit: "kg/l — potvrditi",
        unitConfirmed: false,
      });
      await ok(
        admin,
        "/admin/versions/" + v.id,
        { model, reason: "TEST nejasna jedinica", revision: v.revision },
        "PUT",
      );
      const table = await load(),
        unknown = rowFor(table, "kg/l — potvrditi");
      const result = await save(table, [
        change(unknown, "7", { unit: "kg", confirmUnit: true }),
        change(rowFor(table), "3"),
      ]);
      const saved = (await current()).find((v: any) => v.id === selected[0]);
      assert.equal(
        saved.model.items.find((i: any) => i.id === "unclear").price,
        "7",
      );
      assert.equal(
        saved.model.items.find((i: any) => i.id === "fert").price,
        "3",
      );
      assert.equal(rowFor(result.table).mixed, true);
    },
  );
  await t.test(
    "Periodi i višestruke verzije iste kulture ne mogu se slučajno pomešati",
    async () => {
      const other = await ok(admin, "/admin/pricing/drafts", {
        sourceIds: [originalIds[0]],
        requestId: randomUUID(),
        name: "TEST druga godina",
        validFrom: "2027-01-01",
        validTo: "2027-12-31",
        reason: "TEST period",
      });
      const sameTemplate = (await current()).find(
        (v: any) => v.id === other.ids[0],
      ).template_id;
      const all = await current();
      const match = selected.find(
        (vid) =>
          all.find((v: any) => v.id === vid).template_id === sameTemplate,
      )!;
      const different = selected.find((vid) => vid !== match)!;
      assert.equal(
        (
          await request(
            admin,
            "/admin/pricing/table?versionIds=" +
              [match, other.ids[0]].join(","),
          )
        ).status,
        422,
      );
      assert.equal(
        (
          await request(
            admin,
            "/admin/pricing/table?versionIds=" +
              [different, other.ids[0]].join(","),
          )
        ).status,
        422,
      );
    },
  );
  await t.test(
    "Odobren normativ se koristi u obračunu; aktivne/arhivske verzije i snapshot ostaju nepromenljivi",
    async () => {
      await resetModels();
      let table = await load();
      table = (await save(table, [change(rowFor(table), "1")])).table;
      const versions = await current();
      for (const vid of selected) {
        const v = versions.find((v: any) => v.id === vid);
        await ok(
          admin,
          "/admin/versions/" + vid,
          {
            model: v.model,
            reason: "TEST odobreno",
            activate: true,
            revision: v.revision,
          },
          "PUT",
        );
      }
      const farm = await ok(admin, "/farms", {
        name: "TEST cenovnik farma",
        municipality: "TEST",
        year: 2026,
        currency: "EUR",
      });
      const chosen = versions.find((v: any) => v.id === selected[0]);
      const production = await ok(admin, "/productions", {
        templateId: chosen.template_id,
        name: "TEST 2.5ha zajednička cena",
        year: 2026,
        status: "final",
        details: {
          scale: "2.5",
          scaleUnit: "ha",
          output: "2500",
          outputUnit: "kg",
          product: "TEST ječam",
          start: "2026-01-01",
          end: "2026-12-31",
        },
      });
      const report = await ok(admin, "/report?productionId=" + production.id);
      assert.equal(report.results[0].normativeTotal, "1750");
      const snapshotId = randomUUID();
      await db.query(
        "INSERT INTO report_snapshots(id,farm_id,production_id,payload) VALUES($1,$2,$3,$4)",
        [snapshotId, farm.id, production.id, JSON.stringify(report)],
      );
      const frozen = hash(
        (
          await db.query("SELECT payload FROM report_snapshots WHERE id=$1", [
            snapshotId,
          ])
        ).rows[0].payload,
      );
      assert.equal(
        (
          await request(
            admin,
            "/admin/pricing/table?versionIds=" + selected.join(","),
          )
        ).status,
        422,
      );
      assert.equal(
        (
          await request(
            admin,
            "/admin/pricing/table",
            {
              versionIds: [...selected, originalIds[0]],
              revision: table.revision,
              date: "2026-01-01",
              reason: "TEST zabranjeno",
              rows: [change(rowFor(table), "9")],
            },
            "PUT",
          )
        ).status,
        422,
      );
      assert.equal(
        hash(
          (
            await db.query("SELECT payload FROM report_snapshots WHERE id=$1", [
              snapshotId,
            ])
          ).rows[0].payload,
        ),
        frozen,
      );
      assert.equal(
        hash(
          (await current())
            .filter((v: any) => originalIds.includes(v.id))
            .map((v: any) => [v.id, v.model]),
        ),
        originalModels,
      );
      assert.ok(
        (
          await db.query(
            "SELECT id FROM audit_log WHERE action='shared_price_update'",
          )
        ).rows.length > 0,
      );
    },
  );
});
test.after(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  await closeDatabase();
  await rm(temp, { recursive: true, force: true });
});
