import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import * as XLSX from "@e965/xlsx";
import {
  packagingBasis,
  materialName,
  matchMaterial,
  costKey,
  suggestPrices,
} from "../server/pricing/suggestions.js";
import type { PricingTable } from "../shared/pricing.js";
import type { PriceSuggestions } from "../shared/price-suggestions.js";

test("STIPS povezivanje razlikuje formulacije, seme, jedinice i nepotvrđenu osnovu", () => {
  assert.equal(
    materialName("NPK đubrivo 15:15:15"),
    materialName("NPK (15:15:15)"),
  );
  assert.equal(
    matchMaterial(
      "Meteor (herbicid) ili",
      "Meteor (metsulfuron-metil)",
      "pesticidi",
    ),
    "exact",
  );
  assert.equal(
    matchMaterial("NPK đubrivo 15:15:15", "NPK (16:16:16)", "djubriva"),
    null,
  );
  assert.equal(matchMaterial("Đubrivo KAN 27% N", "KAN", "djubriva"), "review");
  assert.equal(matchMaterial("Decis", "Decis 25 EC", "pesticidi"), "review");
  assert.equal(matchMaterial("Decis 25 EC", "Decis 100 EC", "pesticidi"), null);
  assert.equal(
    materialName("NPK đubrivo 15:15:15 - 1 put"),
    materialName("NPK đubrivo 15:15:15"),
  );
  assert.equal(matchMaterial("Seme", "TEST hibrid kukuruza", "seme"), null);
  assert.equal(matchMaterial("Tritikale", "TRITIKALE", "seme"), null);
  assert.equal(matchMaterial("UREA", "UREA", "djubriva", true), null);
  assert.equal(
    matchMaterial("Transport đubriva", "NPK (15:15:15)", "djubriva"),
    null,
  );
  assert.deepEqual(packagingBasis("25kg"), { unit: "kg", quantity: "25" });
  assert.deepEqual(packagingBasis("250 gr"), { unit: "kg", quantity: "0.25" });
  assert.deepEqual(packagingBasis("2,5 gr"), {
    unit: "kg",
    quantity: "0.0025",
  });
  assert.deepEqual(packagingBasis("100 ml"), { unit: "l", quantity: "0.1" });
  assert.deepEqual(packagingBasis("lit"), { unit: "l", quantity: "1" });
  assert.equal(packagingBasis("25000 sj"), null);
  assert.equal(packagingBasis("2 x 25 kg"), null);
  assert.equal(packagingBasis("0kg"), null);
});

const temp = await mkdtemp(join(tmpdir(), "agro-stips-suggestions-"));
process.env.DATA_DIR = join(temp, "pg");
process.env.APP_URL = "http://localhost:3000";
process.env.BETTER_AUTH_SECRET =
  "STIPS-suggestions-TEST-only-secret-0123456789";
const { app } = await import("../server/app.js");
const { db, closeDatabase } = await import("../server/db.js");
const { importSource } = await import("../server/importer.js");
const { ingestInput } = await import("../server/inputs/service.js");
const server = app.listen(0, "127.0.0.1");
await new Promise<void>((r) => server.once("listening", r));
const base = `http://127.0.0.1:${(server.address() as any).port}/api`;
type User = { cookie: string };
async function req(
  u: User | undefined,
  path: string,
  body?: any,
  method?: string,
  origin = "http://localhost:3000",
) {
  return fetch(base + path, {
    method: method || (body ? "POST" : "GET"),
    headers: {
      Origin: origin,
      "Content-Type": "application/json",
      ...(u ? { Cookie: u.cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}
async function ok(u: User, path: string, body?: any, method?: string) {
  const r = await req(u, path, body, method),
    b = await r.json();
  assert.ok(r.ok, `${r.status} ${JSON.stringify(b)}`);
  return b;
}
async function signup(email: string) {
  const r = await req(undefined, "/auth/sign-up/email", {
    email,
    password: "TEST-suggestions-password-2026!",
    name: "TEST STIPS",
  });
  assert.equal(r.status, 200);
  return {
    cookie: r.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; "),
  };
}
async function ingest(month: number, price: number, extra = false) {
  const title = `TEST INPUTI ${month === 9 ? "SEPTEMBAR" : "OKTOBAR"} 2026`;
  const rows: any[][] = [
    [title, null, null, "Beograd", "Čačak"],
    ["PROIZVOD", "PROIZVOĐAČ", "PAKOVANJE"],
    ["NPK (15:15:15)", "TEST A", "25kg", price, price - 500],
    ["NPK (16:16:16)", "TEST A", "25kg", 9999, 9999],
    ["UREA", "TEST A", "25kg", 1000, 1000],
    ["TEST seme sorte A", "TEST A", "25kg", 2500, 2500],
    ["NPK (8:16:24)", "TEST A", "25kg", null, null],
  ];
  if (extra) rows.push(["NPK (15:15:15)", "TEST B", "50kg", 9000, 9000]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet(rows),
    "TEST ĐUBRIVA",
  );
  const bytes = Buffer.from(
    XLSX.write(wb, { type: "buffer", bookType: "xlsx" }),
  );
  return ingestInput(
    bytes,
    {
      year: 2026,
      month,
      title,
      category: "djubriva",
      url: `https://www.stips.minpolj.gov.rs/node/TEST-${month}-${price}`,
    },
    title,
    `https://www.stips.minpolj.gov.rs/TEST-${month}-${price}.xlsx`,
    "TEST operator",
  );
}
let admin: User,
  member: User,
  selected: string[],
  table: PricingTable,
  preview: PriceSuggestions;
const load = async () =>
  (await ok(
    admin,
    "/admin/pricing/table?versionIds=" + selected.join(","),
  )) as PricingTable;
const suggest = (t = table, extra: any = {}) =>
  ok(admin, "/admin/pricing/stips-suggestions", {
    versionIds: selected,
    revision: t.revision,
    asOf: "2026-09-30",
    place: "Beograd",
    ...extra,
  }) as Promise<PriceSuggestions>;
const priceRow = (p: PriceSuggestions) =>
  p.rows.find((r) => r.name === "NPK đubrivo 15:15:15")!;
function change(p: PriceSuggestions, extra: any = {}) {
  const row = priceRow(p),
    c = row.candidates[0];
  return {
    key: row.key,
    price: c.amount,
    currency: "RSD",
    unit: c.unit,
    confirmUnit: true,
    zeroReason: "",
    reference: {
      observationId: c.observationId,
      unitsPerPrice: c.unitsPerPrice,
      date: c.date,
      confirmedProduct: true,
      confirmedBasis: true,
      allowHistorical: false,
      note: "TEST grupno potvrđen proizvod i pakovanje",
    },
    ...extra,
  };
}
function body(t: PricingTable, rows: any[]) {
  return {
    versionIds: selected,
    revision: t.revision,
    date: "2026-01-01",
    reason: "TEST grupna primena STIPS cena",
    rows,
  };
}
test("STIPS predlozi, grupna primena i trajno pamćenje potvrđenih veza", async (t) => {
  await t.test(
    "Izolovana priprema: dva nacrta, bez tržišnih ili privatnih test podataka u radnoj bazi",
    async () => {
      await importSource();
      admin = await signup("admin@stips-suggestions.test");
      member = await signup("member@stips-suggestions.test");
      const uid = (
        await db.query(
          "SELECT id FROM ba_user WHERE email='admin@stips-suggestions.test'",
        )
      ).rows[0].id;
      await db.query("INSERT INTO app_admins VALUES($1)", [uid]);
      // Use two real template IDs without depending on archive ordering.
      const originals = (
        await db.query(
          "SELECT id FROM norm_versions ORDER BY template_id LIMIT 2",
        )
      ).rows;
      selected = (
        await ok(admin, "/admin/pricing/drafts", {
          sourceIds: originals.map((r) => r.id),
          requestId: randomUUID(),
          name: "TEST STIPS",
          validFrom: "2026-01-01",
          validTo: "2026-12-31",
          reason: "TEST",
        })
      ).ids;
      const names = [
        "NPK đubrivo 15:15:15",
        "Đubrivo urea 46% N",
        "Seme",
        "Oranje",
        "NPK đubrivo 8:16:24",
        "Đubrivo KAN 27% N",
      ];
      for (const [i, id] of selected.entries()) {
        const v = (await ok(admin, "/admin")).versions.find(
          (v: any) => v.id === id,
        );
        const model = {
          ...v.model,
          reviewed: false,
          groups: [],
          items: names.map((name, n) => ({
            id: "TEST-" + n,
            name,
            quantity: n === 0 ? (i === 0 ? "300" : "200") : "1",
            unit: n === 3 ? "l goriva/usluga — potvrditi" : "kg/l — potvrditi",
            price: n === 1 ? "2" : null,
            unitConfirmed: false,
          })),
        };
        await ok(
          admin,
          "/admin/versions/" + id,
          { model, reason: "TEST količine", revision: v.revision },
          "PUT",
        );
      }
      await ingest(9, 2500);
      await ingest(10, 3000, true);
      table = await load();
    },
  );
  await t.test(
    "Predlog prepoznaje NPK, mesto, pakovanje i datum bez menjanja cena",
    async () => {
      const before = JSON.stringify(
        (
          await db.query(
            "SELECT id,model FROM norm_versions WHERE id=ANY($1::uuid[]) ORDER BY id",
            [selected],
          )
        ).rows,
      );
      preview = await suggest();
      const row = priceRow(preview),
        c = row.candidates[0];
      assert.equal(row.status, "matched");
      assert.equal(c.unit, "kg");
      assert.equal(c.unitsPerPrice, "25");
      assert.equal(c.amount, "100");
      assert.equal(c.periodStart, "2026-09-01");
      assert.equal(c.date, "2026-09-30");
      assert.equal(c.pendingRate, true);
      assert.equal(c.place, "Beograd");
      assert.equal(row.candidates.length, 1);
      assert.equal(row.selectedId, c.observationId);
      const local = await suggest(table, { place: "Čačak" });
      assert.equal(priceRow(local).candidates[0].amount, "80");
      const originalRow = table.rows.find(
        (r) => r.name === "NPK đubrivo 15:15:15",
      )!;
      const tonnes = await suggestPrices(
        db,
        { ...table, rows: [{ ...originalRow, unit: "t" }] },
        { asOf: "2026-09-30", place: "Beograd" },
      );
      assert.equal(tonnes.rows[0].candidates[0].unitsPerPrice, "0.025");
      assert.equal(tonnes.rows[0].candidates[0].amount, "100000");
      const litres = await suggestPrices(
        db,
        { ...table, rows: [{ ...originalRow, unit: "l" }] },
        { asOf: "2026-09-30", place: "Beograd" },
      );
      assert.equal(litres.rows[0].candidates.length, 0);
      assert.equal(
        preview.rows.find((r) => r.name.startsWith("Đubrivo urea"))?.status,
        "filled",
      );
      assert.equal(
        preview.rows.filter((r) => r.name.startsWith("Seme")).length,
        2,
      );
      assert.ok(
        preview.rows
          .filter((r) => r.name.startsWith("Seme"))
          .every((r) => r.candidates.length === 0),
      );
      assert.equal(
        preview.rows.find((r) => r.name === "Oranje")?.status,
        "missing",
      );
      assert.equal(
        preview.rows.find((r) => r.name.includes("8:16:24"))?.candidates.length,
        0,
      );
      assert.equal(
        before,
        JSON.stringify(
          (
            await db.query(
              "SELECT id,model FROM norm_versions WHERE id=ANY($1::uuid[]) ORDER BY id",
              [selected],
            )
          ).rows,
        ),
      );
      assert.equal(
        Number(
          (await db.query("SELECT count(*) AS n FROM input_price_links"))
            .rows[0].n,
        ),
        0,
      );
    },
  );
  await t.test(
    "Samo admin i ispravan Origin; nepostojeće i arhivske verzije se odbijaju",
    async () => {
      const payload = {
        versionIds: selected,
        revision: table.revision,
        asOf: "2026-09-30",
      };
      assert.equal(
        (await req(undefined, "/admin/pricing/stips-suggestions", payload))
          .status,
        401,
      );
      assert.equal(
        (await req(member, "/admin/pricing/stips-suggestions", payload)).status,
        403,
      );
      assert.equal(
        (
          await req(
            admin,
            "/admin/pricing/stips-suggestions",
            payload,
            undefined,
            "https://attacker.test",
          )
        ).status,
        403,
      );
      assert.equal(
        (
          await req(admin, "/admin/pricing/stips-suggestions", {
            ...payload,
            versionIds: [randomUUID()],
          })
        ).status,
        422,
      );
      const archive = (
        await db.query(
          "SELECT id FROM norm_versions WHERE status='archive' LIMIT 1",
        )
      ).rows[0].id;
      assert.equal(
        (
          await req(admin, "/admin/pricing/stips-suggestions", {
            ...payload,
            versionIds: [archive],
          })
        ).status,
        422,
      );
      assert.equal(
        (
          await req(admin, "/admin/pricing/stips-suggestions", {
            ...payload,
            revision: "0".repeat(64),
          })
        ).status,
        409,
      );
      assert.equal(
        (
          await req(admin, "/admin/pricing/stips-suggestions", {
            ...payload,
            asOf: "2099-01-01",
          })
        ).status,
        422,
      );
    },
  );
  await t.test(
    "Jedna primena puni obe kulture i čuva RSD i vezu dok nedostaje kurs",
    async () => {
      const result = await ok(
        admin,
        "/admin/pricing/table",
        body(table, [change(preview)]),
        "PUT",
      );
      assert.equal(result.changedVersions, 2);
      assert.ok(result.warnings.some((w: string) => w.includes("2026-09-30")));
      const row = result.table.rows.find(
        (r: any) => r.name === "NPK đubrivo 15:15:15",
      );
      assert.ok(
        row.occurrences.every(
          (o: any) =>
            o.priceEur === null &&
            o.unitConfirmed &&
            o.lastInput.amount === "100" &&
            o.lastInput.pendingRate,
        ),
      );
      assert.deepEqual(row.occurrences.map((o: any) => o.quantity).sort(), [
        "200",
        "300",
      ]);
      assert.equal(
        Number(
          (await db.query("SELECT count(*) AS n FROM input_price_links"))
            .rows[0].n,
        ),
        1,
      );
      const implicit = await suggest(result.table);
      assert.equal(priceRow(implicit).status, "filled");
      assert.equal(
        (
          await req(
            admin,
            "/admin/pricing/table",
            body(table, [change(preview)]),
            "PUT",
          )
        ).status,
        409,
      );
      table = result.table;
    },
  );
  await t.test(
    "Zapamćena veza bira isti proizvod među više ponuda i preračunava provereni kurs",
    async () => {
      await db.query(
        "INSERT INTO exchange_rates(id,valid_from,valid_to,rate,source_url,published_at,author) VALUES($1,'2026-09-30','2026-09-30',100,'https://www.nbs.rs/TEST-SYNTHETIC','2026-09-30','TEST')",
        [randomUUID()],
      );
      preview = await suggest(table, { includeExisting: true });
      assert.equal(priceRow(preview).candidates[0].match, "approved");
      const result = await ok(
        admin,
        "/admin/pricing/table",
        body(table, [change(preview)]),
        "PUT",
      );
      assert.equal(
        priceRow(await suggest(result.table, { includeExisting: true }))
          .candidates[0].pendingRate,
        false,
      );
      const row = result.table.rows.find(
        (r: any) => r.name === "NPK đubrivo 15:15:15",
      );
      assert.equal(row.priceEur, "1");
      assert.deepEqual(row.occurrences.map((o: any) => o.costEur).sort(), [
        "200",
        "300",
      ]);
      const october = priceRow(
        await suggest(result.table, {
          asOf: "2026-10-20",
          includeExisting: true,
        }),
      );
      assert.equal(october.candidates.length, 2);
      assert.equal(october.candidates[0].manufacturer, "TEST A");
      assert.equal(october.candidates[0].amount, "120");
      assert.equal(october.candidates[0].date, "2026-10-20");
      assert.equal(october.status, "matched");
      assert.equal(october.selectedId, october.candidates[0].observationId);
      assert.equal(october.candidates[1].manufacturer, "TEST B");
      assert.equal(
        Number(
          (await db.query("SELECT count(*) AS n FROM input_price_links"))
            .rows[0].n,
        ),
        1,
      );
      table = result.table;
    },
  );
  await t.test(
    "Greška druge stavke poništava i izmenu cene i zapamćene veze",
    async () => {
      preview = await suggest(table, { includeExisting: true });
      const prior = JSON.stringify(
        (await db.query("SELECT * FROM input_price_links")).rows,
      );
      const valid = change(preview, {
        reference: { ...change(preview).reference, unitsPerPrice: "1" },
        price: "2500",
      });
      assert.equal(
        (
          await req(
            admin,
            "/admin/pricing/table",
            body(table, [valid, { ...valid, key: "0".repeat(64) }]),
            "PUT",
          )
        ).status,
        422,
      );
      assert.equal(
        JSON.stringify(
          (await db.query("SELECT * FROM input_price_links")).rows,
        ),
        prior,
      );
      assert.equal((await load()).revision, table.revision);
    },
  );
  await t.test(
    "Nova verzija pamti proizvod, ali stariji izvor zahteva odluku; generičko seme ostaje zasebno",
    async () => {
      const old = selected;
      selected = (
        await ok(admin, "/admin/pricing/drafts", {
          sourceIds: old,
          requestId: randomUUID(),
          name: "TEST sledeća godina",
          validFrom: "2027-01-01",
          validTo: "2027-12-31",
          reason: "TEST",
        })
      ).ids;
      const next = await load(),
        p = await suggest(next, { asOf: "2026-10-20" }),
        r = priceRow(p);
      assert.equal(r.candidates[0].match, "approved");
      assert.equal(r.candidates[0].historical, true);
      assert.equal(r.status, "review");
      assert.equal(r.selectedId, r.candidates[0].observationId);
      const seedRows = next.rows.filter((r) => r.name.startsWith("Seme"));
      assert.notEqual(costKey(seedRows[0]), costKey(seedRows[1]));
      const forced = change(p);
      assert.equal(
        (await req(admin, "/admin/pricing/table", body(next, [forced]), "PUT"))
          .status,
        422,
      );
      const active = (
        await db.query(
          "SELECT count(*) AS n FROM norm_versions WHERE status='active'",
        )
      ).rows[0].n;
      assert.equal(Number(active), 0);
    },
  );
}).finally(async () => {
  await new Promise<void>((r, j) => server.close((e) => (e ? j(e) : r())));
  await closeDatabase();
  await rm(temp, { recursive: true, force: true });
});
