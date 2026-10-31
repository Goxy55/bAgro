import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { bindFuel, previewFuel, sourceFuel } from "../server/pricing/fuel.js";
import {
  buildPricingTable,
  type PricingVersion,
} from "../server/pricing/model.js";
import { calculateNorm, D, validateModel } from "../server/domain.js";

const inventory = JSON.parse(await readFile("source/inventory.json", "utf8"));
const fuelAudit = JSON.parse(
  await readFile("source/fuel-operations.json", "utf8"),
);
const sourceVersions = (): PricingVersion[] =>
  inventory.cards.map((c: any) => ({
    id: randomUUID(),
    template_id: c.id,
    template_name: c.name,
    status: "draft",
    valid_from: "2026-01-01",
    valid_to: "2026-12-31",
    reason: "TEST",
    model: structuredClone(c),
  }));
test("Gorivo se prepoznaje po eksplicitnom izvornom zbiru, bez spajanja usluga, materijala i ručnog rada", () => {
  const versions = sourceVersions(),
    before = JSON.stringify(versions);
  const preview = previewFuel(versions);
  assert.equal(preview.eligible, 714);
  assert.equal(fuelAudit.summaries.length, 54);
  assert.equal(fuelAudit.sourceHash, inventory.sha256);
  assert.equal(preview.linked, 0);
  assert.ok(preview.unresolved > 0);
  assert.equal(JSON.stringify(versions), before, "Preview ne menja normative");
  const field = versions.find((v) => v.template_name === "JEČAM")!,
    greenhouse = versions.find(
      (v) => v.template_name === "PARADAJZ" && v.model.sheet === "Plastenici",
    )!;
  assert.ok(
    sourceFuel(
      field,
      field.model.items.find((i: any) => i.name === "Oranje"),
    ),
  );
  assert.equal(
    sourceFuel(
      greenhouse,
      greenhouse.model.items.find((i: any) => i.name.startsWith("Konopac")),
    ),
    null,
  );
  const changes = bindFuel(versions, "TEST admin", "TEST zajednički litar");
  assert.equal(
    changes.reduce((n, c) => n + c.items.length, 0),
    714,
  );
  assert.ok(
    greenhouse.model.items
      .filter(
        (i: any) => i.name.startsWith("Konopac") || i.name === "Navodnjavanje",
      )
      .every((i: any) => !i.pricingGroup),
  );
  const tagged = buildPricingTable(versions).rows.filter(
    (r) => r.pricingGroup === "diesel",
  );
  assert.equal(tagged.length, 1);
  assert.equal(tagged[0].occurrences.length, 714);
  assert.equal(tagged[0].unit, "l");
  const reserved = sourceVersions(),
    barley = reserved.find((v) => v.template_name === "JEČAM")!;
  barley.model.items.find((i: any) => i.name === "Oranje").unit = "usluga";
  const blocked = previewFuel(reserved);
  assert.equal(blocked.eligible, 713);
  assert.ok(
    blocked.blockedUnits.some(
      (o) => o.name === "Oranje" && o.unit === "usluga",
    ),
  );
  bindFuel(reserved, "TEST", "TEST čuvanje potvrđene usluge");
  assert.equal(
    barley.model.items.find((i: any) => i.name === "Oranje").unit,
    "usluga",
  );
});
test("Jedna cena litra zadržava razne potrošnje i skaliranje površine, bez dupliranja troška", () => {
  const versions = sourceVersions(),
    barley = versions.find((v) => v.template_name === "JEČAM")!;
  barley.model.items = barley.model.items.filter((i: any) =>
    ["Oranje", "Tanjiranje"].includes(i.name),
  );
  barley.model.reviewed = true;
  barley.model.groups = [];
  const before = barley.model.items.map((i: any) => ({
    id: i.id,
    quantity: i.quantity,
    name: i.name,
  }));
  bindFuel([barley], "TEST", "TEST gorivo");
  for (const i of barley.model.items) i.price = "2";
  assert.deepEqual(
    barley.model.items.map((i: any) => ({
      id: i.id,
      quantity: i.quantity,
      name: i.name,
    })),
    before,
  );
  const result = calculateNorm(barley.model, { scale: "2.5", scaleUnit: "ha" });
  assert.deepEqual(result.errors, []);
  assert.equal(result.total, "120.3");
  assert.equal(result.lines.length, 2);
  assert.equal(result.lines[0].quantity, "50.7");
  assert.equal(result.lines[1].quantity, "9.45");
  for (const item of barley.model.items)
    item.priceInput = {
      amount: "200",
      currency: "RSD",
      date: "2026-10-15",
      unit: "l",
      eur: item.price,
      pendingRate: false,
    };
  barley.model.items[0].price = "2.1";
  assert.equal(
    previewFuel([barley]).mixed,
    true,
    "Različite konverzije ne smeju se sakriti iza istog originalnog RSD iznosa.",
  );
  barley.model.items[0].unit = "kg";
  assert.ok(
    validateModel(barley.model).some((e) => e.includes("potrošnju u litrima")),
  );
});

const temp = await mkdtemp(join(tmpdir(), "agro-fuel-TEST-"));
process.env.DATABASE_URL = "";
process.env.DATA_DIR = join(temp, "pg");
process.env.APP_URL = "http://localhost:3000";
process.env.BETTER_AUTH_SECRET = "TEST-fuel-secret-01234567890123456789";
const { app } = await import("../server/app.js");
const { db, closeDatabase } = await import("../server/db.js");
const { importSource } = await import("../server/importer.js");
const server = app.listen(0, "127.0.0.1");
await new Promise<void>((r) => server.once("listening", r));
const base = `http://127.0.0.1:${(server.address() as any).port}/api`;
type User = { cookie: string; id: string };
async function request(
  user: User | undefined,
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
  user: User | undefined,
  path: string,
  body?: any,
  method?: string,
) {
  const r = await request(user, path, body, method),
    v = await r.json();
  assert.ok(r.ok, `${path}: ${r.status} ${JSON.stringify(v)}`);
  return v;
}
async function signup(email: string): Promise<User> {
  const r = await request(undefined, "/auth/sign-up/email", {
    name: "TEST",
    email,
    password: "TEST-fuel-password-2026!",
  });
  assert.equal(r.status, 200);
  const b = await r.json();
  return {
    id: b.user.id,
    cookie: r.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; "),
  };
}
test("Zajednička cena goriva kroz autorizovan API i istoriju nacrta", async (t) => {
  let admin: User,
    member: User,
    table: any,
    original: any[],
    selected: string[];
  const load = async () => {
    table = await ok(
      admin,
      "/admin/pricing/table?versionIds=" + selected.join(","),
    );
  };
  const fuelBody = (price: string | null = "200", extra: any = {}) => ({
    versionIds: selected,
    revision: table.revision,
    date: "2026-10-15",
    reason: "TEST jedinstvena cena litra",
    rows: [],
    fuel: { price, currency: "RSD", confirmed: true, zeroReason: "" },
    ...extra,
  });
  await t.test(
    "Priprema celog kataloga; samo administrator vidi i menja zajedničko gorivo",
    async () => {
      await importSource();
      admin = await signup("admin@fuel.TEST");
      member = await signup("member@fuel.TEST");
      await db.query("INSERT INTO app_admins VALUES($1)", [admin.id]);
      original = (
        await db.query(
          "SELECT id,model FROM norm_versions WHERE status='archive' ORDER BY id",
        )
      ).rows;
      const book = await ok(admin, "/admin/price-books", {
        requestId: randomUUID(),
        name: "TEST gorivo 2026",
        validFrom: "2026-01-01",
        validTo: "2026-12-31",
        reason: "TEST",
      });
      const opened = await ok(admin, "/admin/price-books/" + book.id);
      table = opened.table;
      selected = table.versions.map((v: any) => v.id);
      assert.equal(
        (
          await request(
            member,
            "/admin/pricing/fuel?versionIds=" + selected.join(","),
          )
        ).status,
        403,
      );
      assert.equal(
        (
          await request(
            undefined,
            "/admin/pricing/fuel?versionIds=" + selected.join(","),
          )
        ).status,
        401,
      );
      assert.equal(
        (await request(member, "/admin/pricing/table", fuelBody(), "PUT"))
          .status,
        403,
      );
      const preview = await ok(
        admin,
        "/admin/pricing/fuel?versionIds=" + selected.join(","),
      );
      assert.equal(preview.eligible, 714);
      assert.equal(preview.current, null);
      const missingConfirm = await request(
        admin,
        "/admin/pricing/table",
        fuelBody("200", {
          fuel: {
            price: "200",
            currency: "RSD",
            confirmed: false,
            zeroReason: "",
          },
        }),
        "PUT",
      );
      assert.equal(missingConfirm.status, 422);
    },
  );
  await t.test(
    "Neobrazložena nula i delimičan izbor poništavaju celu klasifikaciju i cene",
    async () => {
      const zero = await request(
        admin,
        "/admin/pricing/table",
        fuelBody("0"),
        "PUT",
      );
      assert.equal(zero.status, 422);
      assert.match((await zero.json()).error, /nulta cena/);
      const subset = await request(
        admin,
        "/admin/pricing/table",
        fuelBody("200", { versionIds: [selected[0]] }),
        "PUT",
      );
      assert.equal(subset.status, 422);
      await load();
      assert.ok(table.rows.every((r: any) => !r.pricingGroup));
      assert.equal(
        (
          await db.query(
            "SELECT count(*)::int n FROM audit_log WHERE action='fuel_classification'",
          )
        ).rows[0].n,
        0,
      );
    },
  );
  await t.test(
    "Jednim unosom klasifikuju se 714 operacija; prazni kurs čuva RSD bez izmišljene EUR cene",
    async () => {
      const quantities = table.rows
        .flatMap((r: any) => r.occurrences)
        .map((o: any) => [o.versionId, o.itemId, o.quantity])
        .sort();
      const stale = table.revision,
        r = await ok(admin, "/admin/pricing/table", fuelBody(), "PUT");
      table = r.table;
      const rows = table.rows.filter((r: any) => r.pricingGroup === "diesel");
      assert.equal(rows.length, 1);
      assert.equal(rows[0].occurrences.length, 714);
      assert.ok(
        rows[0].occurrences.every(
          (o: any) =>
            o.unitConfirmed &&
            o.priceEur === null &&
            o.lastInput.amount === "200" &&
            o.lastInput.pendingRate,
        ),
      );
      assert.deepEqual(
        table.rows
          .flatMap((r: any) => r.occurrences)
          .map((o: any) => [o.versionId, o.itemId, o.quantity])
          .sort(),
        quantities,
      );
      const outdated = await request(
        admin,
        "/admin/pricing/table",
        fuelBody("210", { revision: stale }),
        "PUT",
      );
      assert.equal(outdated.status, 409);
      assert.ok(
        table.rows
          .filter((r: any) => !r.pricingGroup)
          .every((r: any) => r.priceEur === null),
      );
      assert.deepEqual(
        (
          await db.query(
            "SELECT id,model FROM norm_versions WHERE status='archive' ORDER BY id",
          )
        ).rows,
        original,
      );
    },
  );
  await t.test(
    "Naknadni kurs i ponovljena zajednička cena čuvaju broj i potrošnju operacija, izvore i audit",
    async () => {
      await ok(admin, "/admin/rates", {
        validFrom: "2026-10-15",
        validTo: "2026-10-15",
        rate: "100",
        source: "https://www.nbs.rs/TEST-fuel-rate",
        publishedAt: "2026-10-15",
      });
      await load();
      assert.ok(
        table.rows
          .find((r: any) => r.pricingGroup === "diesel")
          .occurrences.every(
            (o: any) => o.priceEur === "2" && !o.lastInput.pendingRate,
          ),
      );
      const count = table.rows.flatMap((r: any) => r.occurrences).length;
      const r = await ok(admin, "/admin/pricing/table", fuelBody("210"), "PUT");
      table = r.table;
      assert.equal(table.rows.flatMap((r: any) => r.occurrences).length, count);
      assert.ok(
        table.rows
          .find((r: any) => r.pricingGroup === "diesel")
          .occurrences.every((o: any) => D(o.priceEur).eq("2.1")),
      );
      const models = (
        await db.query(
          "SELECT model FROM norm_versions WHERE id=ANY($1::uuid[])",
          [selected],
        )
      ).rows;
      const tagged = models
        .flatMap((v) => v.model.items)
        .filter((i: any) => i.pricingGroup === "diesel");
      assert.equal(tagged.length, 714);
      assert.ok(
        tagged.every(
          (i: any) =>
            i.fuelBinding.sourceHash === inventory.sha256 &&
            i.fuelBinding.summaryCells.length,
        ),
      );
      const audit = (
        await db.query(
          "SELECT metadata FROM audit_log WHERE action='fuel_classification' LIMIT 1",
        )
      ).rows[0].metadata;
      assert.ok(
        audit.batchId &&
          audit.reason &&
          audit.items[0].before.unit &&
          audit.items[0].after.pricingGroup === "diesel",
      );
      assert.equal(
        (
          await db.query(
            "SELECT count(*)::int n FROM norm_versions WHERE status='active'",
          )
        ).rows[0].n,
        0,
      );
    },
  );
});
test.after(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((e) => (e ? reject(e) : resolve())),
  );
  await closeDatabase();
  await rm(temp, { recursive: true, force: true });
});
