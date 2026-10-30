import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { todayInSerbia } from "../shared/dates.js";
import {
  extractRzsPrices,
  ingestRzsPrices,
} from "../server/pricing/rzs-prices.js";

const temp = await mkdtemp(join(tmpdir(), "agro-price-books-TEST-"));
process.env.DATA_DIR = join(temp, "pg");
// Opt-in dedicated native PostgreSQL test DB; never inherit a business DB URL.
const nativeTest = process.env.PRICE_BOOKS_TEST_DATABASE_URL;
if (nativeTest) {
  const target = new URL(nativeTest);
  if (
    !["localhost", "127.0.0.1"].includes(target.hostname) ||
    !target.pathname.endsWith("_test")
  )
    throw Error("Koristite zasebnu lokalnu bazu sa nastavkom _test.");
}
process.env.DATABASE_URL = nativeTest || "";
process.env.APP_URL = "http://localhost:3000";
process.env.BETTER_AUTH_SECRET = "TEST-price-book-secret-01234567890123456789";
const { app } = await import("../server/app.js");
const { db, transaction, closeDatabase } = await import("../server/db.js");
const { importSource } = await import("../server/importer.js");
const { normFor } = await import("../server/reports.js");
const server = app.listen(0, "127.0.0.1");
await new Promise<void>((r) => server.once("listening", r));
const url = `http://127.0.0.1:${(server.address() as any).port}/api`;
type User = { cookie: string; id: string };
async function request(
  user: User | undefined,
  path: string,
  body?: any,
  method?: string,
) {
  return fetch(url + path, {
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
  const r = await request(user, path, body, method);
  const value = await r.json();
  assert.ok(r.ok, `${path}: ${r.status} ${JSON.stringify(value)}`);
  return value;
}
async function signup(email: string): Promise<User> {
  const r = await request(undefined, "/auth/sign-up/email", {
    name: "TEST",
    email,
    password: "TEST-price-books-password-2026!",
  });
  assert.equal(r.status, 200);
  const data = await r.json();
  return {
    id: data.user.id,
    cookie: r.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; "),
  };
}
const rzsRow = (extra: any = {}) => ({
  Indikator: "Prosečne godišnje otkupne cene poljoprivrednih proizvoda [nema] ",
  "Teritorija - RPJ": "REPUBLIKA SRBIJA",
  Proizvod: "Pšenica seme",
  Period: "2025",
  Vrednost: "50",
  IDStatusPodatka: "A",
  IDStatusPoverljivosti: "F",
  IDJedinicaMere: "0",
  ...extra,
});
const source = (rows: any[]) =>
  Buffer.from(
    `<script>$("#pivotTableOutput").pivotUI(${JSON.stringify(rows)}, {"hiddenAttributes": []});</script>`,
  );
test("Datum kursa koristi Srbiju na granici UTC dana, godine i letnjeg računanja vremena", () => {
  assert.equal(todayInSerbia(new Date("2026-10-30T23:30:00Z")), "2026-10-31");
  assert.equal(todayInSerbia(new Date("2026-06-15T22:30:00Z")), "2026-06-16");
  assert.equal(todayInSerbia(new Date("2026-12-31T23:30:00Z")), "2027-01-01");
});
test("RZS cene: bez izvršavanja skripta, nedostajući/poverljivi podaci i nepoznata jedinica ostaju odvojeni", () => {
  const rows = extractRzsPrices(
    source([
      rzsRow(),
      rzsRow({ Proizvod: "Kukuruz", Vrednost: "", IDStatusPodatka: "O" }),
      rzsRow({ Proizvod: "Soja", IDStatusPoverljivosti: "C" }),
    ]),
  );
  assert.equal(rows[0].price, "50");
  assert.equal(rows[0].raw.IDJedinicaMere, "0");
  assert.equal(rows[1].price, null);
  assert.equal(rows[2].price, null);
  assert.throws(
    () =>
      extractRzsPrices(
        Buffer.from('<script>throw new Error("TEST MUST NEVER RUN")</script>'),
      ),
    /struktura/,
  );
  assert.throws(
    () => extractRzsPrices(source([rzsRow(), rzsRow()])),
    /Ponovljena/,
  );
  assert.throws(() =>
    extractRzsPrices(source([rzsRow({ "Teritorija - RPJ": "Beograd" })])),
  );
});

test("Zajednički cenovnik, naknadni kurs, grupno odobrenje i RZS dopuna", async (t) => {
  let admin: User, member: User, book: any, table: any;
  const load = async () => {
    const result = await ok(admin, "/admin/price-books/" + book.id);
    table = result.table;
    return result;
  };
  const edit = (
    row: any,
    price: string,
    currency = "EUR",
    extra: any = {},
  ) => ({
    key: row.key,
    price,
    currency,
    unit: row.unit,
    confirmUnit: true,
    zeroReason: "",
    ...extra,
  });
  const save = async (rows: any[], date = "2026-10-01") => {
    const result = await ok(
      admin,
      "/admin/pricing/table",
      {
        versionIds: table.versions.map((v: any) => v.id),
        revision: table.revision,
        date,
        reason: "TEST globalni unos",
        rows,
      },
      "PUT",
    );
    table = result.table;
    return result;
  };
  const approval = () => ({
    revision: table.revision,
    confirmUnits: true,
    confirmed: true,
    reason: "TEST grupna potvrda",
  });
  await t.test(
    "Ceo katalog se priprema jednom, ponavljanje zahteva ne duplira i običan korisnik nema pristup",
    async () => {
      await importSource();
      admin = await signup("admin@price-books.test");
      member = await signup("member@price-books.test");
      await db.query("INSERT INTO app_admins VALUES($1)", [admin.id]);
      const body = {
        requestId: randomUUID(),
        name: "TEST zajednički 2026",
        validFrom: "2026-01-01",
        validTo: "2026-12-31",
        reason: "TEST nema poslovnih podataka",
      };
      book = await ok(admin, "/admin/price-books", body);
      assert.equal(book.cultures, 88);
      const retry = await ok(admin, "/admin/price-books", body);
      assert.equal(retry.id, book.id);
      assert.equal(retry.reused, true);
      assert.equal((await request(member, "/admin/price-books")).status, 403);
      assert.equal(
        (await request(undefined, "/admin/price-books")).status,
        401,
      );
      assert.equal(
        (
          await request(member, `/admin/price-books/${book.id}/activate`, {
            revision: "0".repeat(64),
            confirmUnits: true,
            confirmed: true,
            reason: "TEST",
          })
        ).status,
        403,
      );
      await load();
      assert.equal(table.versions.length, 88);
      assert.equal(
        table.rows.some((r: any) => r.priceEur !== null),
        false,
      );
      assert.equal(
        (
          await db.query(
            "SELECT count(*)::int AS n FROM norm_versions WHERE status='active'",
          )
        ).rows[0].n,
        0,
      );
    },
  );
  await t.test(
    "Kurs se prikazuje nezavisno od kompletnosti troškovnika; naknadni kurs rešava samo nacrte za odgovarajući datum",
    async () => {
      const row = table.rows.find(
        (r: any) => r.name === "NPK đubrivo 15:15:15",
      );
      const saved = await save([edit(row, "100", "RSD", { unit: "kg" })]);
      assert.ok(saved.warnings.length);
      assert.ok(
        table.rows
          .find((r: any) => r.name === row.name && r.unit === "kg")
          .occurrences.every(
            (o: any) => o.lastInput.pendingRate && o.priceEur === null,
          ),
      );
      const wrong = await ok(admin, "/admin/rates", {
        validFrom: "2026-10-02",
        validTo: "2026-10-03",
        rate: "110",
        source: "https://www.nbs.rs/TEST-only-rate",
        publishedAt: "2026-10-02",
      });
      assert.equal(wrong.reconciled.items, 0);
      const rate = await ok(admin, "/admin/rates", {
        validFrom: "2026-10-01",
        validTo: "2026-10-01",
        rate: "100",
        source: "https://www.nbs.rs/TEST-only-rate",
        publishedAt: "2026-10-01",
      });
      assert.ok(rate.reconciled.items > 1);
      await load();
      assert.ok(
        table.rows
          .find((r: any) => r.name === row.name && r.unit === "kg")
          .occurrences.every(
            (o: any) => o.priceEur === "1" && !o.lastInput.pendingRate,
          ),
      );
      const result = await normFor({
        template_id: table.versions[0].templateId,
        year: 2026,
        details: {
          start: "2026-01-01",
          end: "2026-10-01",
          scale: "2.5",
          scaleUnit: "ha",
        },
      });
      assert.equal(result.money, null);
      assert.equal(result.exchangeRate.value, "100");
      assert.equal(result.exchangeRate.date, "2026-10-01");
      assert.match(result.errors.join(" "), /aktivnog/);
      const absent = await normFor({
        template_id: table.versions[0].templateId,
        year: 2026,
        details: { end: "2026-12-31" },
      });
      assert.equal(absent.exchangeRate.value, null);
      assert.equal(absent.exchangeRate.date, "2026-12-31");
    },
  );
  await t.test(
    "RZS godišnje cene dopunjavaju seme/hranu, ne indekse, i čuvaju potvrdu jedinice i poreklo",
    async () => {
      const raw = source([
        rzsRow(),
        rzsRow({ Proizvod: "Kukuruz", Vrednost: "25" }),
      ]);
      const first = await transaction((tx) =>
        ingestRzsPrices(tx, raw, admin.id),
      );
      assert.equal(first.rows, 2);
      const second = await transaction((tx) =>
        ingestRzsPrices(tx, raw, admin.id),
      );
      assert.equal(second.reused, true);
      const suggest = await ok(admin, "/admin/pricing/stips-suggestions", {
        versionIds: table.versions.map((v: any) => v.id),
        revision: table.revision,
        asOf: "2026-10-01",
      });
      const wheat = suggest.rows.find((r: any) => r.name === "Seme · PŠENICA");
      assert.ok(wheat);
      const candidate = wheat.candidates.find(
        (c: any) => c.sourceKind === "rzs",
      );
      assert.ok(candidate);
      assert.equal(candidate.sourceUnit, undefined);
      assert.equal(wheat.selectedId, null);
      assert.equal(candidate.product, "Pšenica seme");
      const row = table.rows.find((r: any) => r.key === wheat.key);
      const ref = {
        observationId: candidate.observationId,
        sourceUnit: "kg",
        date: "2025-12-31",
        confirmedProduct: true,
        confirmedBasis: true,
        confirmedProxy: true,
        allowHistorical: true,
        note: "TEST potvrđena izvorna jedinica i primena reference",
      };
      const bad = await request(
        admin,
        "/admin/pricing/table",
        {
          versionIds: table.versions.map((v: any) => v.id),
          revision: table.revision,
          date: "2026-10-01",
          reason: "TEST",
          rows: [
            edit(row, "50", "RSD", {
              unit: "kg",
              rzsReference: { ...ref, confirmedProxy: false },
            }),
          ],
        },
        "PUT",
      );
      assert.equal(bad.status, 422);
      await save([edit(row, "50", "RSD", { unit: "kg", rzsReference: ref })]);
      assert.equal(
        table.rows.find((r: any) => r.name === row.name && r.unit === "kg")
          .occurrences[0].lastInput.pendingRate,
        true,
      );
      await ok(admin, "/admin/rates", {
        validFrom: "2025-12-31",
        validTo: "2025-12-31",
        rate: "100",
        source: "https://www.nbs.rs/TEST-only-rate-2025",
        publishedAt: "2025-12-31",
      });
      await load();
      const occurrence = table.rows.find(
        (r: any) => r.name === row.name && r.unit === "kg",
      ).occurrences[0];
      assert.equal(occurrence.priceEur, "0.5");
      assert.equal(occurrence.lastInput.reference.kind, "rzs_purchase_price");
      assert.equal(
        occurrence.lastInput.reference.priceType,
        "Godišnja otkupna cena — odobrena referenca inputa",
      );
      assert.equal(
        (await db.query("SELECT * FROM rzs_input_links")).rows.length,
        1,
      );
    },
  );
  await t.test(
    "Grupna potvrda ne aktivira nepotpun cenovnik niti zaobilazi nejasne jedinice, alternative i hranidbene blokove",
    async () => {
      const check = await ok(
        admin,
        `/admin/price-books/${book.id}/check`,
        approval(),
      );
      assert.equal(check.ready, false);
      assert.ok(check.issues.some((i: any) => /cena/.test(i.message)));
      assert.ok(
        check.issues.some((i: any) =>
          /jedinica|Alternativa|osnova/.test(i.message),
        ),
      );
      const invalid = await request(
        admin,
        `/admin/price-books/${book.id}/activate`,
        approval(),
      );
      assert.equal(invalid.status, 422);
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
  await t.test(
    "Jedno odobrenje aktivira sve kulture, zajednički materijal daje različite troškove po normiranoj količini",
    async () => {
      // Explicit TEST-only complete models allow verification of atomic approval
      // without pretending that the real archival models have been reviewed.
      for (const [n, v] of table.versions.entries()) {
        const model = {
          basis: "ha",
          reference: "1",
          reviewed: false,
          items: [
            {
              id: "TEST-input",
              name: "TEST zajednički input",
              quantity: n === 0 ? "300" : "200",
              unit: "kg",
              price: null,
              unitConfirmed: false,
            },
          ],
          groups: [],
          sheet: "Usevi",
          range: "TEST",
        };
        await db.query("UPDATE norm_versions SET model=$1 WHERE id=$2", [
          JSON.stringify(model),
          v.id,
        ]);
      }
      await load();
      const row = table.rows[0];
      assert.equal(row.occurrences.length, 88);
      const stale = table.revision;
      await save([edit(row, "2")]);
      const outdated = await request(
        admin,
        `/admin/price-books/${book.id}/activate`,
        { ...approval(), revision: stale },
      );
      assert.equal(outdated.status, 409);
      const inconsistent = (
        await db.query("SELECT model FROM norm_versions WHERE id=$1", [
          table.versions[0].id,
        ])
      ).rows[0].model;
      inconsistent.items[0].price = "3";
      await db.query("UPDATE norm_versions SET model=$1 WHERE id=$2", [
        JSON.stringify(inconsistent),
        table.versions[0].id,
      ]);
      await load();
      const inconsistentCheck = await ok(
        admin,
        `/admin/price-books/${book.id}/check`,
        approval(),
      );
      assert.equal(inconsistentCheck.ready, false);
      assert.ok(
        inconsistentCheck.issues.some((i: any) =>
          i.message.includes("različite cene"),
        ),
      );
      await save([edit(table.rows[0], "2")]);
      const check = await ok(
        admin,
        `/admin/price-books/${book.id}/check`,
        approval(),
      );
      assert.equal(check.ready, true);
      const result = await ok(
        admin,
        `/admin/price-books/${book.id}/activate`,
        approval(),
      );
      assert.equal(result.activated, true);
      assert.equal(result.cultures, 88);
      const versions = (
        await db.query("SELECT * FROM norm_versions WHERE price_book_id=$1", [
          book.id,
        ])
      ).rows;
      assert.ok(versions.every((v) => v.status === "active"));
      const norms = await Promise.all(
        [
          versions.find((v) => v.model.items[0].quantity === "300")!,
          versions.find((v) => v.model.items[0].quantity === "200")!,
        ].map((v) =>
          normFor({
            template_id: v.template_id,
            year: 2026,
            details: {
              start: "2026-01-01",
              end: "2026-10-01",
              scale: "2.5",
              scaleUnit: "ha",
            },
          }),
        ),
      );
      assert.ok(norms.every((n) => n.money && n.errors.length === 0));
      assert.ok(norms.some((n) => n.total === "1500"));
      assert.ok(norms.some((n) => n.total === "1000"));
      const frozen = versions[0].model;
      await ok(admin, "/admin/rates", {
        validFrom: "2026-10-01",
        validTo: "2026-10-01",
        rate: "101",
        source: "https://www.nbs.rs/TEST-correction",
        publishedAt: "2026-10-01",
      });
      assert.deepEqual(
        (
          await db.query("SELECT model FROM norm_versions WHERE id=$1", [
            versions[0].id,
          ])
        ).rows[0].model,
        frozen,
      );
    },
  );
  await t.test(
    "Zamena važećeg cenovnika zahteva grupnu potvrdu, prethodne verzije ostaju u arhivi",
    async () => {
      const old = book;
      book = await ok(admin, "/admin/price-books", {
        requestId: randomUUID(),
        name: "TEST nova verzija",
        validFrom: "2026-01-01",
        validTo: "2026-12-31",
        reason: "TEST eksplicitna zamena",
      });
      await load();
      const check = await ok(
        admin,
        `/admin/price-books/${book.id}/check`,
        approval(),
      );
      assert.equal(check.ready, true);
      assert.equal(check.overlaps.length, 88);
      const blocked = await request(
        admin,
        `/admin/price-books/${book.id}/activate`,
        approval(),
      );
      assert.equal(blocked.status, 422);
      assert.equal(
        (await db.query("SELECT status FROM price_books WHERE id=$1", [old.id]))
          .rows[0].status,
        "active",
      );
      await ok(admin, `/admin/price-books/${book.id}/activate`, {
        ...approval(),
        replaceOverlaps: true,
      });
      assert.equal(
        (await db.query("SELECT status FROM price_books WHERE id=$1", [old.id]))
          .rows[0].status,
        "archive",
      );
      assert.ok(
        (
          await db.query(
            "SELECT status FROM norm_versions WHERE price_book_id=$1",
            [old.id],
          )
        ).rows.every((v) => v.status === "archive"),
      );
      assert.equal(
        (
          await db.query(
            "SELECT count(*)::int n FROM norm_versions WHERE status='active'",
          )
        ).rows[0].n,
        88,
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
