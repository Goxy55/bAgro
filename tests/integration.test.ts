import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import ExcelJS from "exceljs";
const dir = await mkdtemp(join(tmpdir(), "agro-test-"));
process.env.DATA_DIR = join(dir, "pg");
process.env.BETTER_AUTH_SECRET =
  "test-only-secret-never-for-production-0123456789";
process.env.APP_URL = "http://localhost:3000";
process.env.MAIL_DIR = join(dir, "mail");
const { app } = await import("../server/app.js");
const { db, client } = await import("../server/db.js");
const { importSource } = await import("../server/importer.js");
const { D } = await import("../server/domain.js");
const { reportRows } = await import("../server/exports.js");
const server = app.listen(0, "127.0.0.1");
await new Promise<void>((r) => server.once("listening", r));
const address = server.address() as any;
const base = `http://127.0.0.1:${address.port}`;
type User = { cookie: string; farm?: string };
async function req(
  user: User | undefined,
  path: string,
  body?: any,
  method?: string,
) {
  return fetch(base + "/api" + path, {
    method: method || (body ? "POST" : "GET"),
    headers: {
      "Content-Type": "application/json",
      Origin: "http://localhost:3000",
      ...(user ? { Cookie: user.cookie } : {}),
      ...(user?.farm ? { "X-Farm-Id": user.farm } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}
async function ok(
  u: User | undefined,
  path: string,
  body?: any,
  method?: string,
) {
  const r = await req(u, path, body, method);
  const b = await r.json();
  assert.ok(r.ok, `${path}: ${r.status} ${JSON.stringify(b)}`);
  return b;
}
async function signup(email: string) {
  const r = await req(undefined, "/auth/sign-up/email", {
    email,
    password: "Local-test-only-2026!",
    name: email.split("@")[0],
  });
  assert.ok(r.ok, await r.clone().text());
  return {
    cookie: r.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; "),
  } as User;
}
async function production(
  u: User,
  name: string,
  template = "s0-B1",
  scale = "1",
  output = "1000",
  product = "ječam",
) {
  return ok(u, "/productions", {
    templateId: template,
    name,
    year: 2026,
    status: "final",
    details: {
      scale,
      scaleUnit: "ha",
      output,
      outputUnit: "kg",
      product,
      start: "2026-01-01",
      end: "2026-12-31",
    },
  });
}
let admin: User,
  a: User,
  b: User,
  p: any,
  q: any,
  savedId: string,
  versionId: string;
test("Funkcionalna prva faza: PostgreSQL, autentikacija, izolacija i poslovna pravila", async (t) => {
  await t.test("Idempotentan izvorni uvoz", async () => {
    assert.equal((await importSource()).cards, 88);
    assert.equal((await importSource()).imported, false);
    assert.equal(
      (await db.query("SELECT COUNT(*) AS n FROM templates")).rows[0].n,
      88,
    );
  });
  await t.test(
    "Obavezna prijava, dve odvojene farme i admin nalog",
    async () => {
      assert.equal((await req(undefined, "/bootstrap")).status, 401);
      admin = await signup("admin@test.local");
      a = await signup("farma-a@test.local");
      b = await signup("farma-b@test.local");
      const owner = (
        await db.query("SELECT id FROM ba_user WHERE email='admin@test.local'")
      ).rows[0];
      await db.query("INSERT INTO app_admins VALUES($1)", [owner.id]);
      a.farm = (
        await ok(a, "/farms", {
          name: "TEST Farma A",
          year: 2026,
          municipality: "Test",
          currency: "RSD",
        })
      ).id;
      b.farm = (
        await ok(b, "/farms", {
          name: "TEST Farma B",
          year: 2026,
          municipality: "Test",
          currency: "RSD",
        })
      ).id;
      assert.equal((await req(a, "/admin")).status, 403);
      assert.equal(
        (await req({ ...a, farm: b.farm }, "/productions")).status,
        403,
      );
    },
  );
  await t.test(
    "Neproveren ili nedostajući kurs ne finalizuje rezultat",
    async () => {
      const r = await req(a, "/events", {
        kind: "other_income",
        date: "2026-01-01",
        title: "Bez kursa",
        status: "final",
        amount: "1",
        currency: "EUR",
        details: {},
      });
      assert.equal(r.status, 422);
      assert.match((await r.json()).error, /kurs/);
    },
  );
  await t.test(
    "Admin odobrava novu verziju, bez savremenih cena iz arhive",
    async () => {
      await ok(admin, "/admin/rates", {
        validFrom: "2026-01-01",
        validTo: "2026-12-31",
        rate: "120",
        source:
          "https://webappcenter.nbs.rs/ExchangeRateWebApp/ExchangeRate/CurrentMiddleRate",
        publishedAt: "2026-01-01",
      });
      const versions = (await ok(admin, "/admin")).versions;
      const archive = versions.find((v: any) => v.template_id === "s0-B1");
      versionId = (
        await ok(admin, "/admin/versions", {
          sourceId: archive.id,
          name: "TEST normativ — nije tržišna cena",
          validFrom: "2026-01-01",
          validTo: "2026-12-31",
          reason: "Automatizovani test",
        })
      ).id;
      const model = {
        basis: "ha",
        reference: "1",
        reviewed: true,
        sheet: "Usevi",
        range: "F27",
        items: [
          {
            id: "test",
            name: "Test materijal",
            quantity: "1",
            price: "500",
            unit: "kg",
            unitConfirmed: true,
          },
        ],
        groups: [],
      };
      await ok(
        admin,
        "/admin/versions/" + versionId,
        { model, reason: "Testiran sintetički cenovnik", activate: true },
        "PUT",
      );
    },
  );
  await t.test(
    "Produkcija, 2,5 ha i izvoz ne otkrivaju drugu farmu",
    async () => {
      p = await production(a, "TEST ječam");
      q = await production(b, "TEST druga farma");
      const scaled = await production(a, "TEST 2.5ha", "s0-B1", "2.5", "2500");
      const report = await ok(a, "/report?productionId=" + scaled.id);
      assert.equal(report.results[0].normativeTotal, "150000");
      assert.equal((await req(a, "/report?productionId=" + q.id)).status, 422);
      assert.equal(
        (await req(a, "/export/xlsx?productionId=" + q.id)).status,
        422,
      );
      assert.equal(
        (await req({ ...a, farm: b.farm }, "/export/pdf")).status,
        403,
      );
      const r = await req(a, "/events", {
        kind: "cost",
        productionId: q.id,
        date: "2026-02-01",
        title: "Tuđi trošak",
        status: "final",
        amount: "1",
        currency: "RSD",
        details: {},
      });
      assert.equal(r.status, 422);
    },
  );
  await t.test(
    "Prodaja i delimična naplata u različitim mesecima",
    async () => {
      const sale = (
        await ok(a, "/events", {
          kind: "sale",
          productionId: p.id,
          date: "2026-02-01",
          title: "TEST Prodaja ječma",
          status: "final",
          amount: "100000",
          currency: "RSD",
          details: {
            product: "ječam",
            quantity: "1000",
            unit: "kg",
            unitPrice: "100",
          },
        })
      ).id;
      await ok(a, "/payments", {
        eventId: sale,
        date: "2026-03-01",
        direction: "in",
        category: "Naplata prodaje",
        amount: "40000",
        currency: "RSD",
      });
      const r = await ok(a, "/report?productionId=" + p.id);
      assert.equal(r.results[0].withSubsidies.amount, "40000");
      assert.equal(r.results[0].withSubsidies.percent, "40");
      assert.equal(r.cashflow[1].incoming, "0");
      assert.equal(r.cashflow[2].incoming, "40000");
      assert.equal(r.cashflow[2].closing, null);
      assert.equal(r.outstanding[0].remaining, "60000");
      assert.equal(
        (
          await req(a, "/payments", {
            eventId: sale,
            date: "2026-03-01",
            direction: "in",
            category: "Duplikat",
            amount: "70000",
            currency: "RSD",
          })
        ).status,
        422,
      );
    },
  );
  await t.test("Zahtevana subvencija nije prihod ili uplata", async () => {
    const subsidy = await ok(a, "/events", {
      kind: "subsidy",
      productionId: p.id,
      date: "2026-02-01",
      title: "TEST Potraživanje",
      status: "requested",
      amount: "10000",
      currency: "RSD",
      details: {},
    });
    assert.equal(
      (await ok(a, "/report?productionId=" + p.id)).totals.subsidies,
      "0",
    );
    await ok(a, "/subsidies/" + subsidy.id + "/approve", {});
    await ok(a, "/payments", {
      eventId: subsidy.id,
      date: "2026-04-01",
      direction: "in",
      category: "Subvencija",
      amount: "10000",
      currency: "RSD",
    });
    const r = await ok(a, "/report?productionId=" + p.id);
    assert.equal(r.totals.subsidies, "10000");
    assert.equal(r.cashflow[3].incoming, "10000");
    assert.equal(
      (
        await req(a, "/payments", {
          eventId: subsidy.id,
          date: "2026-04-01",
          direction: "in",
          category: "Duplikat",
          amount: "10000",
          currency: "RSD",
        })
      ).status,
      422,
    );
  });
  await t.test(
    "Stvarni trošak je eksplicitna zamena, snapshot ostaje nepromenljiv",
    async () => {
      await ok(a, "/events", {
        kind: "cost",
        productionId: p.id,
        date: "2026-02-01",
        title: "TEST zamena",
        status: "final",
        amount: "50000",
        currency: "RSD",
        details: { normItemId: "test", replaceNorm: true },
      });
      const r = await ok(a, "/report?productionId=" + p.id);
      assert.equal(r.results[0].normativeCost, "60000");
      assert.equal(r.results[0].combinedCost, "50000");
      savedId = (
        await ok(a, "/snapshots", {
          productionId: p.id,
          reason: "Kontrolni snapshot",
        })
      ).id;
      await ok(admin, "/admin/versions/" + versionId + "/archive", {
        reason: "Promena test cenovnika",
      });
      assert.equal(
        (await ok(a, "/report?productionId=" + p.id)).results[0].normativeCost,
        null,
      );
      const snapshot = (
        await db.query("SELECT payload FROM report_snapshots WHERE id=$1", [
          savedId,
        ])
      ).rows[0].payload;
      assert.equal(snapshot.results[0].normativeCost, "60000");
      assert.equal(
        (await req(b, "/export/xlsx?snapshotId=" + savedId)).status,
        422,
      );
      await db.query("UPDATE norm_versions SET status='active' WHERE id=$1", [
        versionId,
      ]);
    },
  );
  await t.test(
    "Interni prenos 1000 kg, uparen trag i bez eksternog prihoda / plaćanja",
    async () => {
      const crop = await production(
        a,
        "TEST sopstvena hrana",
        "s0-B1",
        "1",
        "2000",
        "ječam",
      );
      const animal = await production(
        a,
        "TEST stočarstvo",
        "s7-A2",
        "1",
        "1000",
        "mleko",
      );
      const before = await ok(a, "/report");
      await ok(a, "/transfers", {
        from: crop.id,
        to: animal.id,
        date: "2026-07-01",
        product: "ječam",
        quantity: "1000",
        unit: "kg",
        method: "normative",
      });
      const inv = await ok(a, "/inventory");
      const pair = inv.movements.filter((m: any) =>
        m.kind.startsWith("transfer_"),
      );
      assert.equal(pair.length, 2);
      assert.equal(D(pair[0].quantity).add(pair[1].quantity).toString(), "0");
      assert.equal(D(pair[0].value_rsd).add(pair[1].value_rsd).toString(), "0");
      const after = await ok(a, "/report");
      assert.equal(before.totals.revenue, after.totals.revenue);
      assert.equal(before.totals.netCash, after.totals.netCash);
      await ok(a, "/feed", {
        productionId: animal.id,
        date: "2026-07-02",
        product: "ječam",
        quantity: "1000",
        unit: "kg",
        stockType: "product",
        normItemId: "feed",
      });
      assert.equal((await ok(a, "/inventory")).feed[0].value_rsd, "30000");
      const archive = (await ok(admin, "/admin")).versions.find(
        (v: any) => v.template_id === "s7-A2",
      );
      const version = (
        await ok(admin, "/admin/versions", {
          sourceId: archive.id,
          name: "TEST hrana",
          validFrom: "2026-01-01",
          validTo: "2026-12-31",
          reason: "Test hrane",
        })
      ).id;
      await ok(
        admin,
        "/admin/versions/" + version,
        {
          model: {
            basis: "head_year",
            reference: "1",
            reviewed: true,
            items: [
              {
                id: "feed",
                name: "ječam",
                quantity: "1000",
                price: "1",
                unit: "kg",
                unitConfirmed: true,
              },
            ],
            groups: [],
          },
          reason: "Test porekla hrane",
          activate: true,
        },
        "PUT",
      );
      await ok(a, "/events", {
        kind: "sale",
        productionId: animal.id,
        date: "2026-08-01",
        title: "TEST mleko",
        status: "final",
        amount: "100000",
        currency: "RSD",
        details: { product: "mleko", quantity: "1000", unit: "kg" },
      });
      const result = await ok(a, "/report?productionId=" + animal.id);
      assert.equal(result.results[0].normativeCost, "30000");
      assert.equal(result.results[0].withSubsidies.amount, "70000");
      assert.equal(
        (await ok(a, "/report?productionId=" + crop.id)).results[0]
          .normativeCost,
        "0",
      );
    },
  );
  await t.test(
    "Nabavka zalihe i kasnija potrošnja ne dupliraju trošak",
    async () => {
      await ok(a, "/events", {
        kind: "cost",
        productionId: p.id,
        date: "2026-08-01",
        title: "TEST repromaterijal",
        status: "final",
        amount: "12000",
        currency: "RSD",
        details: {
          inventoryPurchase: true,
          stockType: "material",
          product: "TEST materijal",
          quantity: "100",
          unit: "kg",
        },
      });
      await ok(a, "/feed", {
        productionId: p.id,
        date: "2026-08-02",
        product: "TEST materijal",
        quantity: "50",
        unit: "kg",
        stockType: "material",
      });
      const r = await ok(a, "/report?productionId=" + p.id);
      assert.equal(r.results[0].actualCost, "56000");
      assert.equal(
        (
          await req(a, "/feed", {
            productionId: p.id,
            date: "2026-08-02",
            product: "TEST materijal",
            quantity: "60",
            unit: "kg",
            stockType: "material",
          })
        ).status,
        422,
      );
    },
  );
  await t.test(
    "PDF/XLSX koriste iste serverske iznose i podržavaju srpski tekst",
    async () => {
      const r = await ok(a, "/report?productionId=" + p.id);
      const x = await req(a, "/export/xlsx?productionId=" + p.id);
      assert.equal(x.status, 200);
      const book = new ExcelJS.Workbook();
      await book.xlsx.load(Buffer.from(await x.arrayBuffer()) as any);
      const sheet = book.getWorksheet("Rezultati")!;
      const expected = reportRows(r)[0];
      assert.equal(sheet.getCell("B2").value, Number(expected[1]));
      assert.equal(sheet.getCell("F2").value, Number(expected[5]));
      assert.equal(
        book.getWorksheet("Metodologija")!.getCell("B4").value,
        "RSD",
      );
      const pdf = await req(a, "/export/pdf?productionId=" + p.id);
      const bytes = Buffer.from(await pdf.arrayBuffer());
      assert.equal(bytes.subarray(0, 4).toString(), "%PDF");
      assert.ok(bytes.length > 10000);
    },
  );
  await t.test(
    "Idempotentna statistika, praznine i zabrana lažne nacionalne STIPS cene",
    async () => {
      const s = {
        source: {
          id: "TEST-RZS",
          name: "TEST fixture",
          url: "https://data.stat.gov.rs/",
          terms: "Samo sintetički test podaci",
        },
        series: {
          id: "TEST-series",
          product: "TEST ječam",
          indicator: "Proizvodnja",
          definition: "Test fixture",
          mapping: "Test bez objave nacionalne vrednosti",
          geography: "Srbija",
          unit: "t",
          currency: null,
          priceType: null,
          sourceUrl: "https://data.stat.gov.rs/",
        },
        observations: [
          {
            period: 2025,
            value: "10",
            status: "konačan",
            publishedAt: "2026-01-01",
            sourceUrl: "https://data.stat.gov.rs/",
          },
        ],
      };
      await ok(admin, "/admin/statistics", s);
      await ok(admin, "/admin/statistics", s);
      assert.equal(
        (await db.query("SELECT COUNT(*) AS n FROM observations")).rows[0].n,
        1,
      );
      s.observations[0].value = "11";
      await ok(admin, "/admin/statistics", s);
      const o = (await db.query("SELECT * FROM observations")).rows[0];
      assert.equal(o.revision, 2);
      assert.equal(o.history.length, 1);
      s.source.id = "stips";
      assert.equal((await req(admin, "/admin/statistics", s)).status, 422);
    },
  );
  await t.test(
    "Nusproizvod zahteva odobrenu raspodelu i ne meša kg sa komadima",
    async () => {
      const crop = await production(
        a,
        "TEST glavni i nusproizvod",
        "s0-B1",
        "1",
        "1000",
        "TEST zrno",
      );
      await ok(a, "/inventory", {
        productionId: crop.id,
        date: "2026-07-01",
        product: "TEST slama",
        quantity: "100",
        unit: "kom",
        stockType: "product",
        kind: "byproduct",
        method: "normative",
        note: "TEST ostvarene bale",
      });
      await ok(a, "/events", {
        kind: "sale",
        productionId: crop.id,
        date: "2026-08-01",
        title: "TEST prodaja bala",
        status: "final",
        amount: "10000",
        currency: "RSD",
        details: {
          product: "TEST slama",
          quantity: "50",
          unit: "kom",
          byproduct: true,
        },
      });
      assert.equal(
        (await ok(a, "/report?productionId=" + crop.id)).results[0]
          .normativeCost,
        null,
      );
      await ok(admin, "/admin/versions/" + versionId + "/archive", {
        reason: "TEST raspodela",
      });
      const id = (
        await ok(admin, "/admin/versions", {
          sourceId: versionId,
          name: "TEST raspodela nusproizvoda",
          validFrom: "2026-01-01",
          validTo: "2026-12-31",
          reason: "Test",
        })
      ).id;
      await ok(
        admin,
        "/admin/versions/" + id,
        {
          model: {
            basis: "ha",
            reference: "1",
            reviewed: true,
            byproductAllocations: { "TEST slama": "20" },
            items: [
              {
                id: "test",
                name: "TEST trošak",
                quantity: "1",
                price: "500",
                unit: "kg",
                unitConfirmed: true,
              },
            ],
            groups: [],
          },
          reason: "Dokumentovana TEST raspodela",
          activate: true,
        },
        "PUT",
      );
      const r = await ok(a, "/report?productionId=" + crop.id);
      assert.equal(r.results[0].normativeCost, "6000");
      assert.equal(r.results[0].withSubsidies.amount, "4000");
      assert.equal(r.results[0].byproducts[0].value, "6000");
      await ok(admin, "/admin/versions/" + id + "/archive", {
        reason: "Kraj testa",
      });
      await db.query("UPDATE norm_versions SET status='active' WHERE id=$1", [
        versionId,
      ]);
    },
  );
  await t.test(
    "Nacrt se može dopuniti i finalizovati bez duplikata",
    async () => {
      const draft = await ok(a, "/events", {
        kind: "other_income",
        title: "TEST nacrt",
        status: "draft",
        currency: "EUR",
        details: {},
      });
      await ok(
        a,
        "/events/" + draft.id,
        {
          kind: "other_income",
          title: "TEST dopunjen",
          status: "final",
          date: "2026-09-01",
          amount: "10",
          currency: "EUR",
          details: {},
        },
        "PUT",
      );
      const rows = (
        await db.query("SELECT * FROM business_events WHERE id=$1", [draft.id])
      ).rows;
      assert.equal(rows.length, 1);
      assert.equal(rows[0].money.rsd, "1200");
      assert.equal(
        (
          await req(
            b,
            "/events/" + draft.id,
            {
              kind: "other_income",
              title: "Napad",
              status: "draft",
              currency: "EUR",
              details: {},
            },
            "PUT",
          )
        ).status,
        422,
      );
    },
  );
  await t.test(
    "EUR prikaz koristi istorijske EUR vrednosti bez današnjeg kursa",
    async () => {
      await ok(
        a,
        "/farm",
        {
          name: "TEST Farma A",
          municipality: "Test",
          year: 2026,
          currency: "EUR",
        },
        "PUT",
      );
      const r = await ok(a, "/report?productionId=" + p.id);
      assert.equal(r.currency, "EUR");
      assert.equal(r.results[0].normativeCost, "500");
      assert.ok(
        D(r.results[0].revenue).sub(D(100000).div(120)).abs().lt("0.00000001"),
      );
      await ok(
        a,
        "/farm",
        {
          name: "TEST Farma A",
          municipality: "Test",
          year: 2026,
          currency: "RSD",
        },
        "PUT",
      );
    },
  );
  await t.test(
    "Reset lozinke preko održavane autentikacije i privatne razvojne poruke",
    async () => {
      await ok(b, "/auth/request-password-reset", {
        email: "farma-b@test.local",
        redirectTo: "http://localhost:3000/reset-password",
      });
      const files = await readdir(process.env.MAIL_DIR!);
      assert.equal(files.length, 1);
      const message = JSON.parse(
        await readFile(join(process.env.MAIL_DIR!, files[0]), "utf8"),
      );
      const path = new URL(message.url).pathname;
      const token = path.slice(path.lastIndexOf("/") + 1);
      await ok(undefined, "/auth/reset-password", {
        token,
        newPassword: "New-test-only-password-2026!",
      });
      const login = await req(undefined, "/auth/sign-in/email", {
        email: "farma-b@test.local",
        password: "New-test-only-password-2026!",
      });
      assert.equal(login.status, 200);
    },
  );
  await t.test("Zaštita porekla obrazaca i audit čitanja / izvoz", async () => {
    const r = await fetch(base + "/api/farms", {
      method: "POST",
      headers: {
        Cookie: a.cookie,
        "Content-Type": "application/json",
        Origin: "https://foreign.invalid",
      },
      body: "{}",
    });
    assert.equal(r.status, 403);
    const rows = (
      await db.query("SELECT action FROM audit_log WHERE farm_id=$1", [a.farm])
    ).rows;
    assert.ok(rows.some((r) => r.action === "export"));
    assert.ok(rows.some((r) => r.action === "read"));
  });
});
test.after(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
  if ("close" in client) await client.close();
  else await client.end();
  await rm(dir, { recursive: true, force: true });
});
