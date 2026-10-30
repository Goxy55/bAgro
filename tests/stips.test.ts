import test from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import PDFDocument from "pdfkit";
import { PGlite } from "@electric-sql/pglite";
import {
  officialUrl,
  normalizedUnit,
  parseSerbianNumber,
  priceFromCell,
  stipsUrl,
  mappedRows,
} from "../server/stips/schema.js";
import { extractDocument, htmlTables } from "../server/stips/extract.js";
const temp = await mkdtemp(join(tmpdir(), "agro-stips-test-"));
process.env.DATA_DIR = join(temp, "pg");
process.env.BETTER_AUTH_SECRET = "STIPS-test-only-secret-01234567890123456789";
process.env.APP_URL = "http://localhost:3000";
// Upgrade a real pre-existing v1 database; retain its farm and owner.
const old = new PGlite(process.env.DATA_DIR);
await old.exec(await readFile("migrations/001_initial.sql", "utf8"));
await old.exec(
  "CREATE TABLE schema_migrations(name text PRIMARY KEY,applied_at timestamptz DEFAULT now());INSERT INTO schema_migrations(name) VALUES('001_initial');",
);
const preservedFarm = randomUUID();
await old.query(
  'INSERT INTO ba_user(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$2,$3,false,now(),now())',
  ["old-owner", "TEST existing owner", "existing@stips.test"],
);
await old.query(
  "INSERT INTO farms(id,name,year,currency,owner_id) VALUES($1,'TEST existing farm',2026,'RSD','old-owner')",
  [preservedFarm],
);
await old.close();
const { app } = await import("../server/app.js");
const { db, migrate, closeDatabase } = await import("../server/db.js");
const { ingestDocument, documentById } =
  await import("../server/stips/service.js");
const { runCrawl, discoverPdfs, probeAccess } =
  await import("../server/stips/crawler.js");
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
  const multipart = body instanceof FormData;
  return fetch(base + path, {
    method: method || (body ? "POST" : "GET"),
    headers: {
      Origin: "http://localhost:3000",
      ...(multipart ? {} : { "Content-Type": "application/json" }),
      ...(user ? { Cookie: user.cookie } : {}),
    },
    body: body ? (multipart ? body : JSON.stringify(body)) : undefined,
  });
}
async function ok(
  user: Account | undefined,
  path: string,
  body?: any,
  method?: string,
) {
  const res = await request(user, path, body, method);
  const value = await res.json();
  assert.ok(res.ok, `${path}: ${res.status} ${JSON.stringify(value)}`);
  return value;
}
async function signup(email: string) {
  const res = await request(undefined, "/auth/sign-up/email", {
    email,
    password: "STIPS-test-password-2026!",
    name: "TEST STIPS",
  });
  assert.equal(res.status, 200);
  return {
    cookie: res.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; "),
  };
}
const html = await readFile("tests/fixtures/stips-synthetic.html");
const metadata = {
  title: "TEST sintetički bilten — nisu stvarne cene",
  sourceUrl: "https://www.stips.minpolj.gov.rs/TEST-fixture.html",
  publishedAt: "2026-10-19",
  periodStart: "2026-10-12",
  periodEnd: "2026-10-18",
  termsConfirmed: true,
  termsNote:
    "Samo sintetička test datoteka; nije podatak preuzet sa STIPS sajta.",
};
function uploadForm(
  bytes = html,
  filename = "TEST-fixture.html",
  meta: any = metadata,
) {
  const f = new FormData();
  for (const [k, v] of Object.entries(meta))
    f.set(k, v === null ? "" : String(v));
  f.set("file", new Blob([bytes]), filename);
  return f;
}
async function fixturePdf(scanned = false) {
  const doc = new PDFDocument({ size: "A4", margin: 35 }),
    chunks: Buffer[] = [];
  doc.on("data", (b) => chunks.push(b));
  const end = new Promise<void>((r) => doc.on("end", r));
  if (scanned) {
    doc.rect(40, 40, 100, 100).fill("#eee");
  } else {
    doc
      .font("public/fonts/DejaVuSans.ttf")
      .fontSize(11)
      .text(
        "TEST bilten — sintetički podaci, nisu stvarne STIPS cene.",
        35,
        30,
      );
    const xs = [35, 235, 310, 435, 555],
      ys = [80, 110, 140, 170];
    for (const x of xs) doc.moveTo(x, ys[0]).lineTo(x, ys.at(-1)!).stroke();
    for (const y of ys) doc.moveTo(xs[0], y).lineTo(xs.at(-1)!, y).stroke();
    const rows = [
      ["Proizvod", "Jedinica", "TEST mesto A", "TEST mesto B"],
      ["TEST krompir", "kg", "100,50", "90–110"],
      ["TEST jabuka", "kg", "80", "85"],
    ];
    rows.forEach((row, r) =>
      row.forEach((cell, c) =>
        doc.fontSize(9).text(cell, xs[c] + 4, ys[r] + 8, {
          width: xs[c + 1] - xs[c] - 8,
          lineBreak: false,
        }),
      ),
    );
  }
  doc.end();
  await end;
  return Buffer.concat(chunks);
}
let admin: Account,
  user: Account,
  documentId: string,
  rowId: string,
  pdf: Buffer;
test("STIPS — proverljiv uvoz i objava lokalnih cena", async (t) => {
  await t.test(
    "Migracija v1→v2 čuva postojeću farmu i ponavljanje ne briše podatke",
    async () => {
      assert.equal(
        (await db.query("SELECT name FROM farms WHERE id=$1", [preservedFarm]))
          .rows[0].name,
        "TEST existing farm",
      );
      assert.equal(
        (await db.query("SELECT name FROM schema_migrations")).rows.length,
        6,
      );
      await migrate();
      assert.equal(
        (await db.query("SELECT name FROM schema_migrations")).rows.length,
        6,
      );
      assert.equal(
        (await db.query("SELECT enabled FROM stips_crawler_settings")).rows[0]
          .enabled,
        false,
      );
    },
  );
  await t.test(
    "Srpske decimale, rasponi i praznine nisu izmišljene nule/proseci",
    () => {
      assert.equal(parseSerbianNumber("1.234,50"), "1234.5");
      assert.equal(parseSerbianNumber(" 100,50 "), "100.5");
      assert.equal(parseSerbianNumber("—"), null);
      assert.equal(parseSerbianNumber("0"), "0");
      assert.equal(normalizedUnit("кг"), "kg");
      assert.equal(normalizedUnit("грло"), "grlo");
      assert.equal(parseSerbianNumber("100/120"), null);
      assert.deepEqual(priceFromCell("90–110"), {
        price: null,
        priceMin: "90",
        priceMax: "110",
      });
      assert.deepEqual(priceFromCell("110–90"), {
        price: null,
        priceMin: null,
        priceMax: null,
      });
    },
  );
  await t.test(
    "Samo zvanični HTTPS domen; nema privatnih i spoljnih odredišta",
    () => {
      for (const bad of [
        "http://www.stips.minpolj.gov.rs/",
        "https://127.0.0.1/",
        "https://evil.test/",
        "https://www.stips.minpolj.gov.rs.evil.test/x",
        "https://secret@www.stips.minpolj.gov.rs/x",
        "https://www.stips.minpolj.gov.rs:8443/x",
      ])
        assert.throws(() => stipsUrl(bad));
      assert.equal(
        stipsUrl("/bilten.pdf"),
        "https://www.stips.minpolj.gov.rs/bilten.pdf",
      );
      const found = discoverPdfs(
        '<a href="/TEST.pdf">TEST</a><a href="https://evil.test/x.pdf">x</a><a href="javascript:alert(1)">x</a><a href="/TEST.pdf">dup</a>',
        "https://www.stips.minpolj.gov.rs/",
      );
      assert.equal(found.length, 1);
    },
  );
  await t.test(
    "HTML se čita bez izvršavanja skripti, PDF tabele iz stvarne geometrije",
    async () => {
      const extracted = await extractDocument(html, "text/html");
      assert.equal(extracted.tables.length, 1);
      assert.equal(extracted.tables[0].rows.length, 3);
      assert.ok(!extracted.text.includes("throw new Error"));
      pdf = await fixturePdf();
      const parsed = await extractDocument(pdf, "application/pdf");
      assert.equal(parsed.pages, 1);
      assert.ok(parsed.text.includes("sintetički"));
      assert.ok(
        parsed.tables.length > 0,
        "PDF tabela mora biti stvarno izdvojena",
      );
      assert.ok(
        parsed.tables[0].rows.some((row) =>
          row.some((c) => c.includes("100,50")),
        ),
      );
      const scanned = await extractDocument(
        await fixturePdf(true),
        "application/pdf",
      );
      assert.equal(scanned.status, "needs_manual");
      assert.ok(scanned.warnings.some((w) => w.includes("OCR")));
    },
  );
  await t.test(
    "Uvoz i administratorske promene zahtevaju prijavu i ulogu",
    async () => {
      assert.equal((await request(undefined, "/admin/stips")).status, 401);
      admin = await signup("admin@stips.test");
      user = await signup("farmer@stips.test");
      await db.query(
        "INSERT INTO app_admins(user_id) SELECT id FROM ba_user WHERE email=$1",
        ["admin@stips.test"],
      );
      assert.equal((await request(user, "/admin/stips")).status, 403);
      assert.equal(
        (await request(user, "/admin/stips/upload", uploadForm())).status,
        403,
      );
      assert.equal((await request(user, "/stips")).status, 200);
    },
  );
  await t.test(
    "Binarni original, hash i ponovljen uvoz bez duplikata",
    async () => {
      const imported = await ok(admin, "/admin/stips/upload", uploadForm());
      documentId = imported.id;
      assert.equal(imported.duplicate, false);
      const duplicate = await ok(admin, "/admin/stips/upload", uploadForm());
      assert.equal(duplicate.id, documentId);
      assert.equal(duplicate.duplicate, true);
      assert.equal(
        (await db.query("SELECT COUNT(*) AS n FROM stips_documents")).rows[0].n,
        1,
      );
      assert.ok(
        Buffer.from((await documentById(documentId, db, true)).content).equals(
          html,
        ),
      );
      assert.equal((await ok(user, "/stips")).prices.length, 0);
      assert.equal(
        (await request(user, "/stips/documents/" + documentId + "/file"))
          .status,
        404,
      );
    },
  );
  await t.test(
    "Mapiranje matrice pravi lokalne redove i zadržava cenovni raspon",
    async () => {
      const mapping = {
        tableIndex: 0,
        startRow: 1,
        productColumn: 0,
        unitColumn: 1,
        qualityColumn: null,
        unit: "",
        currency: "RSD",
        priceType: "veleprodajna",
        columns: [
          { column: 2, place: "TEST Beograd", market: "TEST kvantaš" },
          { column: 3, place: "TEST Novi Sad", market: "TEST kvantaš" },
        ],
      };
      assert.equal(
        (
          await ok(
            admin,
            "/admin/stips/documents/" + documentId + "/map",
            mapping,
          )
        ).createdRows,
        3,
      );
      assert.equal(
        (
          await ok(
            admin,
            "/admin/stips/documents/" + documentId + "/map",
            mapping,
          )
        ).createdRows,
        3,
      );
      const doc = await ok(admin, "/admin/stips/documents/" + documentId);
      assert.equal(doc.rows.length, 3);
      const range = doc.rows.find((r: any) => r.draft.priceMin === "90");
      assert.equal(range.draft.price, null);
      rowId = doc.rows.find((r: any) => r.draft.price === "100.5").id;
      assert.equal((await ok(user, "/stips")).prices.length, 0);
    },
  );
  await t.test(
    "Nedostajuća metadata i nulta cena blokiraju objavu",
    async () => {
      const state = await ok(admin, "/admin/stips/documents/" + documentId);
      await ok(
        admin,
        "/admin/stips/documents/" + documentId,
        { ...metadata, publishedAt: null, termsConfirmed: false },
        "PUT",
      );
      const r = await request(
        admin,
        "/admin/stips/rows/" + rowId + "/publish",
        { reason: "TEST provera" },
      );
      assert.equal(r.status, 422);
      assert.match((await r.json()).error, /datum objave/);
      await ok(admin, "/admin/stips/documents/" + documentId, metadata, "PUT");
      const zero = state.rows.find((r: any) => r.draft.price === "0");
      assert.equal(
        (
          await request(admin, "/admin/stips/rows/" + zero.id + "/publish", {
            reason: "TEST",
          })
        ).status,
        422,
      );
    },
  );
  await t.test(
    "Eksplicitna objava, original dostupan i ponavljanje je idempotentno",
    async () => {
      const first = await ok(admin, "/admin/stips/rows/" + rowId + "/publish", {
        reason: "TEST provereno prema originalu",
      });
      assert.equal(first.revision, 1);
      assert.equal(
        (
          await ok(admin, "/admin/stips/rows/" + rowId + "/publish", {
            reason: "TEST ponovljeno",
          })
        ).revision,
        1,
      );
      const market = await ok(user, "/stips");
      assert.equal(market.prices.length, 1);
      assert.equal(market.prices[0].price, "100.5");
      assert.equal(market.prices[0].place, "TEST Beograd");
      assert.equal(market.prices[0].sourcePublishedAt, metadata.publishedAt);
      assert.equal(market.prices[0].sourceUrl, metadata.sourceUrl);
      const download = await request(
        user,
        "/stips/documents/" + documentId + "/file",
      );
      assert.equal(download.status, 200);
      assert.match(
        download.headers.get("content-disposition") || "",
        /attachment/,
      );
      assert.match(
        download.headers.get("content-security-policy") || "",
        /sandbox/,
      );
      assert.ok(Buffer.from(await download.arrayBuffer()).equals(html));
    },
  );
  await t.test(
    "Uređeni nacrt ne menja objavljeni rezultat; nova revizija čuva istoriju",
    async () => {
      const state = await ok(admin, "/admin/stips/documents/" + documentId),
        r = state.rows.find((r: any) => r.id === rowId);
      await ok(
        admin,
        "/admin/stips/rows/" + rowId,
        {
          draft: { ...r.draft, price: "101" },
          quote: r.raw_quote,
          reason: "TEST ispravka",
        },
        "PUT",
      );
      assert.equal((await ok(user, "/stips")).prices[0].price, "100.5");
      await ok(admin, "/admin/stips/rows/" + rowId + "/publish", {
        reason: "TEST potvrđena ispravka",
      });
      assert.equal((await ok(user, "/stips")).prices[0].revision, 2);
      assert.equal((await ok(user, "/stips")).prices[0].price, "101");
      const history = await ok(
        admin,
        "/admin/stips/rows/" + rowId + "/history",
      );
      assert.ok(
        history.some((h: any) => h.previous_published?.price === "100.5"),
      );
      assert.equal(
        (
          await request(
            user,
            "/admin/stips/rows/" + rowId,
            { draft: r.draft, quote: r.raw_quote, reason: "napad" },
            "PUT",
          )
        ).status,
        403,
      );
      assert.equal(
        (
          await request(
            admin,
            "/admin/stips/documents/" + documentId + "/map",
            {
              tableIndex: 0,
              startRow: 1,
              productColumn: 0,
              unitColumn: 1,
              currency: "RSD",
              priceType: "veleprodajna",
              columns: [{ column: 2, place: "X", market: "X" }],
            },
          )
        ).status,
        422,
      );
    },
  );
  await t.test(
    "Lokalna cena ne može se proglasiti nacionalnom; povlačenje ostavlja istoriju",
    async () => {
      const state = await ok(admin, "/admin/stips/documents/" + documentId),
        r = state.rows.find((r: any) => r.id === rowId);
      await ok(
        admin,
        "/admin/stips/rows/" + rowId,
        {
          draft: { ...r.draft, place: "Srbija" },
          quote: r.raw_quote,
          reason: "TEST negativna provera",
        },
        "PUT",
      );
      assert.equal(
        (
          await request(admin, "/admin/stips/rows/" + rowId + "/publish", {
            reason: "TEST",
          })
        ).status,
        422,
      );
      assert.equal((await ok(user, "/stips")).prices[0].place, "TEST Beograd");
      await ok(admin, "/admin/stips/rows/" + rowId + "/withdraw", {
        reason: "TEST povlačenje",
      });
      assert.equal((await ok(user, "/stips")).prices.length, 0);
      await ok(
        admin,
        "/admin/stips/rows/" + rowId,
        { draft: r.draft, quote: r.raw_quote, reason: "TEST vraćanje" },
        "PUT",
      );
      await ok(admin, "/admin/stips/rows/" + rowId + "/publish", {
        reason: "TEST ponovna provera",
      });
    },
  );
  await t.test(
    "Ručni unos za skenirani PDF i odbijanje pogrešnog formata / prevelikog fajla",
    async () => {
      const scan = await ok(
        admin,
        "/admin/stips/upload",
        uploadForm(await fixturePdf(true), "TEST-sken.pdf", {
          ...metadata,
          title: "TEST sken",
          sourceUrl: "https://www.stips.minpolj.gov.rs/TEST-sken.pdf",
        }),
      );
      const row = await ok(
        admin,
        "/admin/stips/documents/" + scan.id + "/rows",
        {
          draft: {
            product: "TEST proizvod",
            place: "TEST mesto",
            market: "TEST pijaca",
            priceType: "maloprodajna",
            unit: "kg",
            currency: "RSD",
            price: "10",
          },
          page: 1,
          quote: "TEST ručno provereno sa strane 1",
        },
      );
      await ok(admin, "/admin/stips/rows/" + row.id + "/publish", {
        reason: "TEST ručni pregled",
      });
      assert.equal(
        (
          await request(
            admin,
            "/admin/stips/upload",
            uploadForm(Buffer.from("Nije PDF"), "TEST.pdf"),
          )
        ).status,
        422,
      );
      assert.equal(
        (
          await request(
            admin,
            "/admin/stips/upload",
            uploadForm(Buffer.alloc(8 * 1024 * 1024 + 1), "TEST.pdf"),
          )
        ).status,
        413,
      );
    },
  );
  await t.test(
    "Preuzimač: stvarni linkovi iz HTML-a, robots pravila, duplikati i nijedna automatska objava",
    async () => {
      await ok(
        admin,
        "/admin/stips/settings",
        {
          enabled: false,
          listingUrls: ["https://www.stips.minpolj.gov.rs/"],
          intervalHours: 24,
          maxDocuments: 2,
          termsConfirmed: true,
          termsNote:
            "TEST izvor, svi odgovori su lokalne sintetičke fixture vrednosti.",
        },
        "PUT",
      );
      const calls: string[] = [],
        pauses: number[] = [];
      const fetcher = async (
        url: string,
        _limit: number,
        allowed?: (u: string) => boolean,
      ) => {
        if (allowed && !allowed(url))
          throw Error("TEST robots zabranjuje putanju.");
        calls.push(url);
        if (url.endsWith("/robots.txt"))
          return {
            status: 200,
            type: "text/plain",
            bytes: Buffer.from(
              "User-agent: *\nDisallow: /forbidden.pdf\nCrawl-delay: 2",
            ),
            url,
          };
        if (url.endsWith("/"))
          return {
            status: 200,
            type: "text/html",
            bytes: Buffer.from(
              '<a href="/TEST-pdf.pdf">TEST sintetički PDF</a><a href="/forbidden.pdf">Zabranjeno</a><a href="https://evil.test/evil.pdf">Spolja</a>',
            ),
            url,
          };
        return { status: 200, type: "application/pdf", bytes: pdf, url };
      };
      const result = await runCrawl("TEST crawler", fetcher, async (ms) => {
        pauses.push(ms);
      });
      assert.equal(result.imported, 1);
      assert.equal(result.status, "partial");
      assert.ok(result.errors.some((e) => e.includes("robots")));
      assert.ok(pauses.some((ms) => ms > 0));
      assert.ok(
        !calls.some(
          (u) => u.includes("evil.test") || u.endsWith("/forbidden.pdf"),
        ),
      );
      const second = await runCrawl("TEST crawler", fetcher, async () => {});
      assert.equal(second.imported, 0);
      assert.equal(second.duplicates, 1);
      assert.equal((await ok(user, "/stips")).prices.length, 2);
    },
  );
  await t.test(
    "Greška 403 ne briše odobrene podatke ili poslednju uspešnu proveru",
    async () => {
      await db.query(
        "UPDATE stips_crawler_settings SET last_success_at=$1 WHERE id=1",
        ["2026-10-20T12:00:00Z"],
      );
      const before = (await ok(user, "/stips")).prices.length;
      const fail = async (url: string) => ({
        url,
        status: 403,
        type: "text/plain",
        bytes: Buffer.alloc(0),
      });
      const probe = await probeAccess(fail);
      assert.equal(probe.accessible, false);
      assert.equal(probe.status, 403);
      const result = await runCrawl("TEST failed", fail, async () => {});
      assert.equal(result.status, "failed");
      assert.match(result.errors.join(" "), /403/);
      const market = await ok(user, "/stips");
      assert.equal(market.prices.length, before);
      assert.equal(
        new Date(market.source.last_success_at).toISOString(),
        "2026-10-20T12:00:00.000Z",
      );
      assert.match(market.source.last_error, /403/);
      assert.equal(
        (await db.query("SELECT lease_until FROM stips_crawler_settings"))
          .rows[0].lease_until,
        null,
      );
    },
  );
  await t.test(
    "Uslovi i poreklo zahteva se proveravaju i na STIPS endpoint-ima",
    async () => {
      assert.equal(
        (
          await request(
            admin,
            "/admin/stips/settings",
            {
              enabled: true,
              listingUrls: ["https://www.stips.minpolj.gov.rs/"],
              intervalHours: 24,
              maxDocuments: 2,
              termsConfirmed: false,
              termsNote: "",
            },
            "PUT",
          )
        ).status,
        422,
      );
      const r = await fetch(base + "/admin/stips/probe", {
        method: "POST",
        headers: {
          Cookie: admin.cookie,
          Origin: "https://foreign.test",
          "Content-Type": "application/json",
        },
        body: "{}",
      });
      assert.equal(r.status, 403);
      const actions = (
        await db.query(
          "SELECT action FROM audit_log WHERE action LIKE 'stips_%'",
        )
      ).rows;
      assert.ok(actions.some((r) => r.action === "stips_publish"));
      assert.ok(actions.some((r) => r.action === "stips_fetch"));
    },
  );
});
test.after(async () => {
  await new Promise<void>((r, e) =>
    server.close((error) => (error ? e(error) : r())),
  );
  await closeDatabase();
  await rm(temp, { recursive: true, force: true });
});
