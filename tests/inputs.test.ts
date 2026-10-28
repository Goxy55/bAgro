import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import * as XLSX from "@e965/xlsx";
import {
  discoverInputReports,
  extractInputWorkbook,
  inputAttachment,
  INPUTS_URL,
  type InputReport,
} from "../server/inputs/extract.js";
import { D } from "../server/domain.js";

const report: InputReport = {
  url: "https://www.stips.minpolj.gov.rs/node/999999",
  title: "TEST đubriva septembar 2026",
  category: "djubriva",
  year: 2026,
  month: 9,
};
const listing = `<main><table><tr><th>2026</th>${Array.from({ length: 12 }, (_, i) => `<td>${i === 8 ? `<a href="/node/999999" title="TEST mineralna đubriva septembar 2026"><img alt="djubriva"></a><a href="https://attacker.test/data.xls" title="Pesticidi septembar 2026">loš link</a>` : ""}</td>`).join("")}</tr></table></main>`;
function workbook(
  bookType: "xlsx" | "biff8" = "xlsx",
  month = "SEPTEMBAR",
  changedPrice = 2500,
) {
  const sheet = XLSX.utils.aoa_to_sheet([
    [
      `TEST PREGLED CENA / MINERALNA ĐUBRIVA ${month} 2026`,
      null,
      null,
      "Beograd",
      "Čačak",
    ],
    ["PROIZVOD", "PROIZVOĐAČ", "PAKOVANJE"],
    ["dominantna cena (RSD)"],
    ["TEST NPK (15:15:15)", "TEST proizvođač", "25 kg", changedPrice, null],
    ["TEST bez proizvođača", null, "kg", "13'0", "-"],
    ["TEST izričita nula", "TEST", "kg", 0, "1.234,50"],
    ["TEST formula", "TEST", "25kg", null, null],
  ]);
  sheet.D7 = { t: "n", v: 2500, f: "100*25" };
  sheet.E7 = { t: "n", v: 999, f: 'HYPERLINK("https://attacker.test")' };
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, "TEST ĐUBRIVA");
  return Buffer.from(XLSX.write(wb, { type: "buffer", bookType }));
}
const xlsx = workbook(),
  xls = workbook("biff8");
test("INPUTI otkriva samo stvarne linkove zvanične godišnje tabele", () => {
  const r = discoverInputReports(listing);
  assert.equal(r.length, 1);
  assert.equal(r[0].url, report.url);
  assert.equal(r[0].month, 9);
  assert.equal(r[0].category, "djubriva");
  assert.equal(discoverInputReports("<main>Nema podataka</main>").length, 0);
  assert.throws(
    () =>
      inputAttachment(
        '<main><a href="https://attacker.test/a.xls">xls</a></main>',
        report.url,
      ),
    /jedan nedvosmislen/,
  );
});
test("XLS i XLSX zadržavaju pakovanja, praznine, nejasne zapise i formule bez izvršavanja", () => {
  for (const bytes of [xlsx, xls]) {
    const p = extractInputWorkbook(bytes, report, report.title);
    assert.equal(p.cells.length, 8);
    assert.equal(
      p.cells.filter((c) => c.status === "available").length,
      bytes === xlsx ? 2 : 4,
    );
    assert.equal(p.cells.filter((c) => c.status === "missing").length, 2);
    assert.equal(p.cells.find((c) => c.cell === "D4")!.price, "2500");
    assert.equal(p.cells.find((c) => c.cell === "D4")!.packaging, "25 kg");
    assert.equal(p.cells.find((c) => c.cell === "D5")!.status, "review");
    assert.equal(p.cells.find((c) => c.cell === "D5")!.manufacturer, "");
    assert.equal(p.cells.find((c) => c.cell === "D6")!.status, "review");
    assert.equal(p.cells.find((c) => c.cell === "E6")!.price, "1234.5");
    // The fixture writer emits formula records only in XLSX. Real XLS formula
    // cells are retained by the reader too (covered by the live source audit).
    if (bytes === xlsx) {
      assert.equal(p.cells.find((c) => c.cell === "D7")!.price, null);
      assert.match(
        JSON.stringify(p.cells.find((c) => c.cell === "D7")!.raw),
        /100\*25/,
      );
      assert.equal(p.cells.find((c) => c.cell === "E7")!.status, "review");
    }
  }
});
test("Period dolazi iz sadržaja, razlika u naslovu je vidljiva; nepoznata struktura se odbija", () => {
  const p = extractInputWorkbook(
    workbook("xlsx", "OKTOBAR"),
    report,
    report.title,
  );
  assert.equal(p.period.start, "2026-10-01");
  assert.ok(p.warnings.some((w) => w.includes("razlikuje")));
  assert.throws(
    () => extractInputWorkbook(xlsx, { ...report, year: 2025 }, report.title),
    /Godina/,
  );
  assert.throws(
    () =>
      extractInputWorkbook(
        Buffer.from("<html>xls</html>"),
        report,
        report.title,
      ),
    /XLS\/XLSX/,
  );
});

const temp = await mkdtemp(join(tmpdir(), "agro-inputs-test-"));
process.env.DATA_DIR = join(temp, "pg");
process.env.BETTER_AUTH_SECRET =
  "Inputs-TEST-secret-only-012345678901234567890";
process.env.APP_URL = "http://localhost:3000";
const { app } = await import("../server/app.js");
const { db, closeDatabase } = await import("../server/db.js");
const { ingestInput, importInputReport, referencePrice, inputReferenceSchema } =
  await import("../server/inputs/service.js");
const { createInputSource } = await import("../server/inputs/source.js");
const server = app.listen(0, "127.0.0.1");
await new Promise<void>((r) => server.once("listening", r));
const base = `http://127.0.0.1:${(server.address() as any).port}/api`;
type Account = { cookie: string };
async function request(
  account: Account | undefined,
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
      ...(account ? { Cookie: account.cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}
async function ok(
  account: Account | undefined,
  path: string,
  body?: any,
  method?: string,
) {
  const r = await request(account, path, body, method),
    v = await r.json();
  assert.ok(r.ok, `${path}: ${r.status} ${JSON.stringify(v)}`);
  return v;
}
async function signup(email: string) {
  const r = await request(undefined, "/auth/sign-up/email", {
    email,
    password: "TEST-inputs-password-2026!",
    name: "TEST inputi",
  });
  assert.equal(r.status, 200);
  return {
    cookie: r.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; "),
  };
}
let docId: string,
  observationId: string,
  admin: Account,
  member: Account,
  versionIds: string[];
const ref = () => ({
  observationId,
  unitsPerPrice: "25",
  date: "2026-09-30",
  confirmedProduct: true as const,
  confirmedBasis: true as const,
  allowHistorical: false,
  note: "TEST: proverena cena celog pakovanja 25 kg.",
});
test("INPUTI — arhiva, autorizacija i eksplicitna primena", async (t) => {
  await t.test(
    "Dva uvoza istog originala ne dupliraju dokument ili ćelije",
    async () => {
      const a = await ingestInput(
        xlsx,
        report,
        report.title,
        "https://www.stips.minpolj.gov.rs/TEST-inputs.xlsx",
        "TEST-operator",
      );
      const b = await ingestInput(
        xlsx,
        report,
        report.title,
        "https://www.stips.minpolj.gov.rs/TEST-inputs.xlsx",
        "TEST-operator",
      );
      docId = a.id;
      assert.equal(b.id, a.id);
      assert.equal(b.duplicate, true);
      assert.equal(
        (await db.query("SELECT COUNT(*) AS n FROM stips_input_prices")).rows[0]
          .n,
        8,
      );
      const original = (
        await db.query(
          "SELECT content,sha256 FROM stips_input_documents WHERE id=$1",
          [docId],
        )
      ).rows[0];
      assert.equal(
        createHash("sha256")
          .update(Buffer.from(original.content))
          .digest("hex"),
        original.sha256,
      );
      assert.deepEqual(Buffer.from(original.content), xlsx);
      observationId = (
        await db.query(
          "SELECT id FROM stips_input_prices WHERE document_id=$1 AND cell='D4'",
          [docId],
        )
      ).rows[0].id;
    },
  );
  await t.test(
    "Samo admin pristupa arhivi, cenama, preuzimanju i primeni; Origin je obavezan",
    async () => {
      admin = await signup("admin@inputs.test");
      member = await signup("member@inputs.test");
      const uid = (
        await db.query("SELECT id FROM ba_user WHERE email='admin@inputs.test'")
      ).rows[0].id;
      await db.query("INSERT INTO app_admins(user_id) VALUES($1)", [uid]);
      for (const path of [
        "/admin/input-prices",
        "/admin/input-prices/prices",
        `/admin/input-prices/documents/${docId}/file`,
      ]) {
        assert.equal((await request(undefined, path)).status, 401);
        assert.equal((await request(member, path)).status, 403);
      }
      assert.equal(
        (
          await request(member, "/admin/input-prices/import", {
            url: report.url,
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await request(
            admin,
            "/admin/input-prices/reference",
            { reference: ref(), unit: "kg", validFrom: "2026-01-01" },
            undefined,
            "https://attacker.test",
          )
        ).status,
        403,
      );
      const file = await request(
        admin,
        `/admin/input-prices/documents/${docId}/file`,
      );
      assert.deepEqual(Buffer.from(await file.arrayBuffer()), xlsx);
      const rows = await ok(
        admin,
        "/admin/input-prices/prices?year=2026&category=djubriva&q=TEST%20NPK&status=available",
      );
      assert.equal(rows.total, 1);
      assert.equal(rows.rows[0].packaging, "25 kg");
      assert.equal(
        (await ok(admin, "/admin/input-prices/prices?year=2025")).total,
        0,
      );
      assert.equal(
        (await ok(admin, "/admin/input-prices/prices?status=missing")).total,
        2,
      );
      assert.equal(
        (await ok(admin, "/admin/input-prices/prices?status=review")).total,
        4,
      );
    },
  );
  await t.test(
    "Cena pakovanja nema automatski delilac; identitet, datum i istorija traže potvrdu",
    async () => {
      const r = await referencePrice(
        db,
        inputReferenceSchema.parse(ref()),
        "kg",
        "2026-01-01",
      );
      assert.equal(r.amount, "100");
      assert.equal(r.snapshot.originalPriceRsd, "2500");
      assert.equal(r.snapshot.unitsPerPrice, "25");
      assert.equal(
        (
          await referencePrice(
            db,
            inputReferenceSchema.parse({ ...ref(), unitsPerPrice: "1" }),
            "kg",
            "2026-01-01",
          )
        ).amount,
        "2500",
      );
      assert.throws(() =>
        inputReferenceSchema.parse({ ...ref(), unitsPerPrice: "0" }),
      );
      assert.throws(() =>
        inputReferenceSchema.parse({ ...ref(), confirmedProduct: false }),
      );
      await assert.rejects(
        referencePrice(
          db,
          inputReferenceSchema.parse({ ...ref(), date: "2026-10-01" }),
          "kg",
          "2026-01-01",
        ),
        /mesecu/,
      );
      await assert.rejects(
        referencePrice(
          db,
          inputReferenceSchema.parse(ref()),
          "kg",
          "2027-01-01",
        ),
        /istorijske/,
      );
      await referencePrice(
        db,
        inputReferenceSchema.parse({ ...ref(), allowHistorical: true }),
        "kg",
        "2027-01-01",
      );
      const missing = (
        await db.query(
          "SELECT id FROM stips_input_prices WHERE status='missing' LIMIT 1",
        )
      ).rows[0].id;
      await assert.rejects(
        referencePrice(
          db,
          inputReferenceSchema.parse({ ...ref(), observationId: missing }),
          "kg",
          "2026-01-01",
        ),
        /nedostaje/,
      );
    },
  );
  await t.test(
    "Eksplicitna primena u dva nacrta koristi izvorni mesec kursa i čuva snapshot",
    async () => {
      const { importSource } = await import("../server/importer.js");
      await importSource();
      const templates = (
        await db.query("SELECT id FROM templates ORDER BY id LIMIT 2")
      ).rows;
      versionIds = [];
      const uid = (
        await db.query("SELECT id FROM ba_user WHERE email='admin@inputs.test'")
      ).rows[0].id;
      for (const [index, quantity] of [
        [0, "300"],
        [1, "200"],
      ] as const) {
        const tid = templates[index].id,
          vid = randomUUID();
        const model = {
          sheet: "Usevi",
          basis: "ha",
          reference: "1",
          reviewed: false,
          items: [
            {
              id: "npk",
              name: "TEST NPK (15:15:15)",
              unit: "kg",
              quantity,
              price: null,
              unitConfirmed: false,
            },
          ],
        };
        await db.query(
          "INSERT INTO norm_versions(id,template_id,name,status,valid_from,valid_to,author,reason,model) VALUES($1,$2,'TEST','draft','2026-01-01','2026-12-31',$3,'TEST',$4)",
          [vid, tid, uid, JSON.stringify(model)],
        );
        versionIds.push(vid);
      }
      await db.query(
        "INSERT INTO exchange_rates(id,rate,valid_from,valid_to,source_url,published_at,author) VALUES($1,100,'2026-09-30','2026-09-30','https://www.nbs.rs/TEST-inputs','2026-09-30',$2)",
        [randomUUID(), uid],
      );
      const table = await ok(
        admin,
        "/admin/pricing/table?versionIds=" + versionIds.join(","),
      );
      const body = {
        versionIds,
        revision: table.revision,
        date: "2026-01-01",
        reason: "TEST eksplicitni izbor STIPS inputa",
        rows: [
          {
            key: table.rows[0].key,
            price: "100",
            currency: "RSD",
            unit: "kg",
            confirmUnit: true,
            zeroReason: "",
            reference: ref(),
          },
        ],
      };
      const forged = structuredClone(body);
      forged.rows[0].price = "1";
      assert.equal(
        (await request(admin, "/admin/pricing/table", forged, "PUT")).status,
        422,
      );
      const result = await ok(admin, "/admin/pricing/table", body, "PUT");
      assert.equal(result.changedVersions, 2);
      const versions = (
        await db.query(
          "SELECT status,model FROM norm_versions WHERE id=ANY($1::uuid[])",
          [versionIds],
        )
      ).rows;
      for (const v of versions) {
        assert.equal(v.status, "draft");
        assert.equal(v.model.items[0].price, "1");
        assert.equal(v.model.items[0].priceInput.date, "2026-09-30");
        assert.equal(
          v.model.items[0].priceInput.reference.observationId,
          observationId,
        );
        assert.equal(v.model.items[0].priceInput.reference.packaging, "25 kg");
      }
      const costs = result.table.rows[0].occurrences
        .map((o: any) => o.costEur)
        .sort();
      assert.deepEqual(costs, ["200", "300"]);
      assert.equal(
        result.table.rows[0].occurrences[0].lastInput.reference.place,
        "Beograd",
      );
      // A newer document has a new hash; the prior selected price and saved model remain unchanged.
      await ingestInput(
        workbook("xlsx", "SEPTEMBAR", 3000),
        report,
        report.title,
        "https://www.stips.minpolj.gov.rs/TEST-inputs-revision.xlsx",
        "TEST-operator",
      );
      assert.equal(
        (
          await referencePrice(
            db,
            inputReferenceSchema.parse(ref()),
            "kg",
            "2026-01-01",
          )
        ).amount,
        "100",
      );
      const after = (
        await db.query("SELECT model FROM norm_versions WHERE id=$1", [
          versionIds[0],
        ])
      ).rows[0].model;
      assert.equal(
        after.items[0].priceInput.reference.originalPriceRsd,
        "2500",
      );
    },
  );
  await t.test(
    "Nedostajući kurs čuva referencu u nacrtu sa praznom EUR cenom",
    async () => {
      const table = await ok(
        admin,
        "/admin/pricing/table?versionIds=" + versionIds.join(","),
      );
      const r = await ok(
        admin,
        "/admin/pricing/table",
        {
          versionIds,
          revision: table.revision,
          date: "2026-01-01",
          reason: "TEST nedostajući kurs",
          rows: [
            {
              key: table.rows[0].key,
              price: "100",
              currency: "RSD",
              unit: "kg",
              confirmUnit: true,
              reference: { ...ref(), date: "2026-09-29" },
            },
          ],
        },
        "PUT",
      );
      assert.equal(r.warnings.length, 1);
      assert.equal(r.table.rows[0].priceEur, null);
      const model = (
        await db.query("SELECT model FROM norm_versions WHERE id=$1", [
          versionIds[0],
        ])
      ).rows[0].model;
      assert.equal(model.items[0].priceInput.pendingRate, true);
      assert.equal(
        model.items[0].priceInput.reference.observationId,
        observationId,
      );
    },
  );
  await t.test(
    "Kontrolisano preuzimanje prati robots i samo otkrivene priloge, greška čuva arhivu",
    async () => {
      const calls: string[] = [];
      const fetcher = async (
        url: string,
        _limit: number,
        allowed?: (u: string) => boolean,
      ) => {
        assert.ok(!allowed || allowed(url));
        calls.push(url);
        const bytes = url.endsWith("robots.txt")
          ? Buffer.from("User-agent: *\nDisallow: /admin/\n")
          : url === INPUTS_URL
            ? Buffer.from(listing)
            : url === report.url
              ? Buffer.from(
                  '<main><h1>TEST đubriva septembar 2026</h1><a href="/TEST-inputs.xlsx">Original</a></main>',
                )
              : xlsx;
        return {
          status: 200,
          url,
          bytes,
          type: url.endsWith("xlsx") ? "application/octet-stream" : "text/html",
        };
      };
      const source = createInputSource(fetcher, async () => {});
      await importInputReport(report.url, "TEST-source", source);
      assert.equal(calls.length, 4);
      await assert.rejects(
        source.document("https://www.stips.minpolj.gov.rs/node/123"),
        /proverene/,
      );
      const total = (
        await db.query("SELECT COUNT(*) AS n FROM stips_input_prices")
      ).rows[0].n;
      const failure = createInputSource(
        async (url) => ({
          status: 503,
          url,
          bytes: Buffer.alloc(0),
          type: "text/html",
        }),
        async () => {},
      );
      await assert.rejects(
        importInputReport(report.url, "TEST-failure", failure),
        /robots/,
      );
      assert.equal(
        (await db.query("SELECT COUNT(*) AS n FROM stips_input_prices")).rows[0]
          .n,
        total,
      );
      assert.equal(
        (
          await db.query(
            "SELECT COUNT(*) AS n FROM stips_input_runs WHERE status='error'",
          )
        ).rows[0].n,
        1,
      );
      const denied = createInputSource(
        async (url) => ({
          status: 200,
          url,
          bytes: Buffer.from("User-agent: *\nDisallow: /index.php/\n"),
          type: "text/plain",
        }),
        async () => {},
      );
      await assert.rejects(denied.listing(), /robots/);
    },
  );
});
test.after(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  await closeDatabase();
  await rm(temp, { recursive: true, force: true });
});
