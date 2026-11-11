import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import * as XLSX from "@e965/xlsx";
import {
  similarity,
  tokens,
  nutrientSignature,
} from "../server/pricing/estimates.js";
import { buildImpact } from "../server/impact.js";
import type { PricingTable } from "../shared/pricing.js";
import type { PriceEstimates } from "../shared/price-estimates.js";

test("Sličnost: sastav hraniva, koncentracija i nepovezani artikli", () => {
  assert.deepEqual(tokens("NPK đubrivo 15:15:15"), ["npk", "15:15:15"]);
  assert.equal(nutrientSignature("NPK (15:15:15)"), "15-15-15");
  assert.equal(nutrientSignature("Đubrivo KAN 27% N"), "27n");
  assert.ok(similarity("NPK đubrivo 15:15:20", "NPK (15:15:15)").score > 0.9);
  assert.equal(similarity("NPK 15:15:15", "NPK (15:15:15)").score, 1);
  assert.equal(similarity("UREA 46% N", "NPK (15:15:15)").score, 0);
  const pesticide = similarity("Decis 25 EC", "Decis 100 EC");
  assert.ok(pesticide.score < 1 && pesticide.score >= 0.4);
  assert.match(pesticide.reason, /koncentracija/);
  assert.equal(similarity("Seme kukuruza", "UREA").score, 0);
});

test("Procena po stavci u kartici uticaja", () => {
  const r = buildImpact({
    key: "rsd",
    currency: "RSD",
    productions: [
      {
        id: "p",
        name: "P",
        missingRate: null,
        stock: "0",
        stockValue: null,
        actualComplete: true,
        estimated: { cost: "2500", total: "10000", lines: 2 },
      },
    ],
    drafts: [],
    nearestRate: null,
  });
  const item = r.items.find((i) => i.code === "estimated")!;
  assert.equal(item.amount, "2500");
  assert.equal(item.count, 2);
  assert.match(item.basis, /25% troška normativa/);
});

const temp = await mkdtemp(join(tmpdir(), "agro-estimates-"));
process.env.DATA_DIR = join(temp, "pg");
process.env.APP_URL = "http://localhost:3000";
process.env.BETTER_AUTH_SECRET = "Estimates-TEST-only-secret-0123456789";
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

let admin: User, selected: string[], table: PricingTable;
const load = async () =>
  (await ok(
    admin,
    "/admin/pricing/table?versionIds=" + selected.join(","),
  )) as PricingTable;
const estimates = (t = table) =>
  ok(admin, "/admin/pricing/estimates", {
    versionIds: selected,
    revision: t.revision,
    asOf: "2026-09-30",
    place: "Beograd",
  }) as Promise<PriceEstimates>;
const body = (t: PricingTable, rows: any[]) => ({
  versionIds: selected,
  revision: t.revision,
  date: "2026-01-01",
  reason: "TEST procena cena",
  rows,
});

test("Procena cene po sličnom artiklu: predlog, potvrda i oznaka u nacrtu", async (t) => {
  await t.test("Priprema: dva nacrta i STIPS cene", async () => {
    await importSource();
    admin = await signup("admin@estimates.test");
    const uid = (
      await db.query(
        "SELECT id FROM ba_user WHERE email='admin@estimates.test'",
      )
    ).rows[0].id;
    await db.query("INSERT INTO app_admins VALUES($1)", [uid]);
    const originals = (
      await db.query(
        "SELECT id FROM norm_versions ORDER BY template_id LIMIT 2",
      )
    ).rows;
    selected = (
      await ok(admin, "/admin/pricing/drafts", {
        sourceIds: originals.map((r) => r.id),
        requestId: randomUUID(),
        name: "TEST procena",
        validFrom: "2026-01-01",
        validTo: "2026-12-31",
        reason: "TEST",
      })
    ).ids;
    const names = [
      "NPK đubrivo 15:15:20",
      "Đubrivo urea 46% N",
      "Seme",
      "Oranje",
      "Đubrivo KAN 27% N",
    ];
    for (const id of selected) {
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
          quantity: "1",
          unit: n === 3 ? "l goriva/usluga — potvrditi" : "kg/l — potvrditi",
          price: n === 1 ? "2" : null,
          unitConfirmed: false,
        })),
      };
      await ok(
        admin,
        "/admin/versions/" + id,
        { model, reason: "TEST", revision: v.revision },
        "PUT",
      );
    }
    await ingest(9, 2500);
    table = await load();
  });

  let estimate: any;
  await t.test(
    "Predlog: slični artikli, orijentir grupe, bez uključenih stavki",
    async () => {
      const e = await estimates();
      const names = e.rows.map((r) => r.name);
      assert.deepEqual(
        names,
        ["NPK đubrivo 15:15:20"],
        "samo stavka bez izvora; seme, usluga i stavka sa cenom nisu",
      );
      const row = e.rows[0];
      assert.equal(row.candidates[0].product, "NPK (15:15:15)");
      assert.equal(row.candidates[0].amount, "100");
      assert.ok(row.candidates[0].score > 0.9);
      assert.ok(row.candidates[0].score >= row.candidates[1].score);
      assert.equal(row.group?.count, 4);
      assert.equal(row.group?.min, "40");
      assert.equal(row.group?.median, "100");
      estimate = row;
    },
  );

  await t.test(
    "Primena zahteva potvrdu i tačnu cenu izvora; ostaje označena",
    async () => {
      const c = estimate.candidates[0];
      const row = (extra: any = {}) => ({
        key: estimate.key,
        price: c.amount,
        currency: "RSD",
        unit: c.unit,
        confirmUnit: true,
        zeroReason: "",
        estimate: {
          observationId: c.observationId,
          basis: "TEST procena po sličnom artiklu",
          confirmed: true,
        },
        ...extra,
      });
      const put = (rows: any[]) =>
        req(admin, "/admin/pricing/table", body(table, rows), "PUT");
      assert.equal(
        (
          await put([
            row({
              estimate: {
                observationId: c.observationId,
                basis: "TEST osnova",
              },
            }),
          ])
        ).status,
        422,
        "potvrda je obavezna",
      );
      assert.equal(
        (await put([row({ price: "50" })])).status,
        422,
        "cena mora odgovarati izvoru",
      );
      assert.equal(
        (
          await put([
            row({
              reference: {
                observationId: c.observationId,
                unitsPerPrice: "25",
                date: "2026-09-30",
                confirmedProduct: true,
                confirmedBasis: true,
                allowHistorical: false,
                note: "TEST referenca",
              },
            }),
          ])
        ).status,
        422,
        "procena se ne meša sa referencom",
      );
      const saved = await ok(
        admin,
        "/admin/pricing/table",
        body(table, [row()]),
        "PUT",
      );
      const saved_row = saved.table.rows.find(
        (r: any) => r.name === estimate.name,
      );
      const input = saved_row.occurrences[0].lastInput;
      assert.equal(input.amount, "100");
      assert.equal(input.estimate.method, "similar");
      assert.equal(input.estimate.similarTo, "NPK (15:15:15)");
      assert.match(input.estimate.basis, /procena/);
      assert.ok(input.estimate.confirmedAt);
      // nije stvorena potvrđena veza proizvoda
      assert.equal(
        (await db.query("SELECT count(*)::int n FROM input_price_links"))
          .rows[0].n,
        0,
      );
      // stavka više nije bez izvora
      const after = await estimates(await load());
      assert.equal(after.rows.length, 0);
    },
  );
});

test.after(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  await closeDatabase();
});
