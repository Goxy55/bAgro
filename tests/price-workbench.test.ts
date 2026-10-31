import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import {
  decimalPrice,
  packageInName,
  parseComposition,
  sameComposition,
  parsePublicProduct,
  discoverPublicProducts,
  publicUrl,
  savePublicProduct,
} from "../server/pricing/public-sources.js";
import {
  publicCandidates,
  publicPricePool,
} from "../server/pricing/public-prices.js";
import { D, currencySnapshot } from "../server/domain.js";
import * as XLSX from "@e965/xlsx";

const temp = await mkdtemp("/tmp/agro-workbench-TEST-");
process.env.DATABASE_URL = "";
process.env.DATA_DIR = temp + "/pg";
process.env.APP_URL = "http://localhost:3000";
process.env.BETTER_AUTH_SECRET = "TEST-workbench-secret-01234567890123456789";
const { app } = await import("../server/app.js");
const { db, transaction, closeDatabase } = await import("../server/db.js");
const { importSource } = await import("../server/importer.js");
const { startPreparation, waitPreparation, pilotTemplates } =
  await import("../server/pricing/preparation.js");
const server = app.listen(0, "127.0.0.1");
await new Promise<void>((r) => server.once("listening", r));
const base = `http://127.0.0.1:${(server.address() as any).port}/api`;
type User = { id: string; cookie: string; farm?: string };
async function req(
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
      ...(user?.farm ? { "X-Farm-Id": user.farm } : {}),
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
  const r = await req(user, path, body, method),
    b = await r.json();
  assert.ok(r.ok, `${path}: ${r.status} ${JSON.stringify(b)}`);
  return b;
}
async function signup(email: string): Promise<User> {
  const r = await req(undefined, "/auth/sign-up/email", {
      email,
      name: "TEST",
      password: "TEST-workbench-password-2026!",
    }),
    u = await r.json();
  assert.equal(r.status, 200);
  return {
    id: u.user.id,
    cookie: r.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; "),
  };
}
const hemo = (name: string, price = "1,000.00", description = "") =>
  Buffer.from(
    `<meta property="og:title" content="${name} | TEST"><h5>Šifra: 1 JM: KOM</h5><table><tr><td>Cena (mpc)</td><td>${price} RSD</td></tr><tr><td>Na lageru</td><td>1 Ima</td></tr></table><div id="opis">${description}</div>`,
  );

test("Javne cene: samo odgovarajući proizvod, javna cena i nedvosmisleno pakovanje", () => {
  assert.equal(decimalPrice("1.950,50 din"), "1950.5");
  assert.equal(decimalPrice("1,784.48", "us"), "1784.48");
  assert.deepEqual(packageInName("Sekator 150 ml"), {
    unit: "l",
    quantity: "0.15",
  });
  assert.equal(packageInName("Paket 2 x 150 ml + 1l"), null);
  assert.equal(packageInName("Seme 1 SJ"), null);
  assert.deepEqual(packageInName("Seme kukuruza 25.000 zrna"), {
    unit: "seed",
    quantity: "25000",
  });
  const r = parsePublicProduct(
    "ratar",
    Buffer.from(
      "<h1>Sekator 150 ml</h1><h2>CENA: 1950 din.</h2><p>Za registrovane kupce 1891.50</p><div>Drugi proizvod 100 din</div>",
    ),
    "https://www.ratar.rs/sekator-150-ml",
  );
  assert.equal(r.price, "1950");
  const p = parsePublicProduct(
    "poljokomerc",
    Buffer.from(
      '<h1 class="product_title">Sekator 150ml</h1><div class="summary"><div class="navigation"><p class="price">10.000 din</p></div><div class="summary-inner"><p class="price"><del>2.000,00 din</del><ins>1.890,00 din</ins></p></div></div>',
    ),
    "https://poljokomerc.rs/proizvod/sekator/",
  );
  assert.equal(p.price, "1890");
  assert.equal(
    parsePublicProduct(
      "hemoslavija",
      hemo("Sekator 150ml", "1,784.48"),
      "https://www.hemoslavijaprodavnica.com/detail.php?artsif=1",
    ).price,
    "1784.48",
  );
  assert.deepEqual(
    discoverPublicProducts(
      "poljokomerc",
      '<header><a href="/proizvod/pogresan/">Meni</a></header><div class="product-element-bottom"><h3 class="wd-entities-title"><a href="/proizvod/pravi/">Sekator</a></h3></div>',
      "https://poljokomerc.rs/",
    ),
    ["https://poljokomerc.rs/proizvod/pravi/"],
  );
  assert.throws(() => publicUrl("ratar", "https://127.0.0.1/private"));
  assert.throws(() =>
    publicUrl("poljokomerc", "https://poljokomerc.rs/?%61dd-to-cart=1"),
  );
  const a = parseComposition(
    "AKTIVNA MATERIJA: alfa 100 g/l + beta 25 g/l OBLIK FORMULACIJE: EC",
  );
  assert.ok(a);
  assert.equal(
    sameComposition(
      a,
      parseComposition(
        "AKTIVNA MATERIJA: beta 25 g/l + alfa 100 g/l OBLIK FORMULACIJE: EC",
      ),
    ),
    true,
  );
  assert.equal(
    sameComposition(
      a,
      parseComposition(
        "AKTIVNA MATERIJA: alfa 50 g/l + beta 25 g/l OBLIK FORMULACIJE: EC",
      ),
    ),
    false,
  );
  assert.equal(sameComposition(a, null), false);
  assert.equal(
    parseComposition(
      "AKTIVNA MATERIJA: alfa 100 g/l + beta 20 mg/l OBLIK FORMULACIJE: EC",
    ),
    null,
    "Neprepoznata komponenta ne sme biti odbačena iz potpisa sastava",
  );
  const row: any = {
    name: "Original",
    unit: "l",
    occurrences: [{ name: "Original" }],
  };
  const pool: any[] = [
    {
      product: "Original",
      composition: a,
      specOnly: true,
      source_url: "https://example.rs/original",
    },
    {
      id: "TEST-proxy",
      product: "Drugi brend 1l",
      composition: a,
      unit: "l",
      package_quantity: "1",
      price_rsd: "1000",
      checked_at: "2026-10-31",
    },
  ];
  assert.equal(publicCandidates(row, pool)[0].match, "proxy");
  assert.equal(
    publicCandidates(row, [{ ...pool[0], composition: null }, pool[1]]).length,
    0,
  );
  assert.equal(
    publicCandidates(row, [pool[0], { ...pool[1], unit: "kg" }]).length,
    0,
  );
  assert.equal(
    publicCandidates(
      {
        name: "Kukuruz",
        unit: "kg",
        occurrences: [{ name: "Kukuruz" }],
      } as any,
      [
        {
          product: "Kukuruz 25kg",
          metadata: { product: { crop: "KUKURUZ" } },
          unit: "kg",
          package_quantity: "25",
          price_rsd: "1000",
          checked_at: "2026-10-31",
        },
      ],
    ).length,
    0,
    "Deklarisano seme nije cena stočne hrane",
  );
  const money = currencySnapshot("100000", "RSD", "2026-10-01", null);
  assert.equal(money.rsd, "100000");
  assert.equal(money.eur, null);
  assert.equal(money.rate, null);
});

test("Jedan dinarski troškovnik: četiri izvorne kulture, delimična aktivacija, poslovanje bez kursa", async (t) => {
  const admin = await signup("admin@workbench.test"),
    a = await signup("farma-a@workbench.test"),
    b = await signup("farma-b@workbench.test");
  await db.query("INSERT INTO app_admins VALUES($1)", [admin.id]);
  await importSource();
  a.farm = (
    await ok(a, "/farms", {
      name: "TEST Farma A",
      municipality: "TEST",
      year: 2026,
      currency: "RSD",
    })
  ).id;
  b.farm = (
    await ok(b, "/farms", {
      name: "TEST Farma B",
      municipality: "TEST",
      year: 2026,
      currency: "RSD",
    })
  ).id;
  const book = await ok(admin, "/admin/price-books", {
    requestId: randomUUID(),
    name: "TEST RSD bez kursa",
    validFrom: "2026-01-01",
    validTo: "2026-12-31",
    reason: "TEST sintetičke cene, nikada poslovni podaci",
  });
  let view = await ok(admin, `/admin/price-books/${book.id}/workbench`),
    table = view.table;
  assert.equal(view.book.currency, "RSD");
  assert.equal(table.currency, "RSD");
  await t.test(
    "Admin izvori su zaštićeni; SJ ne pretpostavlja broj semena",
    async () => {
      assert.equal(
        (
          await req(a, `/admin/price-books/${book.id}/prepare`, {
            revision: table.revision,
          })
        ).status,
        403,
      );
      assert.equal(
        (await req(b, `/admin/price-books/${book.id}/workbench`)).status,
        403,
      );
      assert.equal(
        (await req(b, `/admin/price-books/${book.id}/preparation`)).status,
        403,
      );
      const seed = table.rows.find(
        (r: any) =>
          r.name.includes("Seme (sj)") &&
          r.occurrences.some((o: any) => o.templateId === "s0-B103"),
      );
      assert.equal(
        publicCandidates(seed, [
          {
            id: "TEST",
            product: "Seme kukuruza 25.000 zrna",
            metadata: { product: { crop: "KUKURUZ" } },
            unit: "seed",
            package_quantity: "25000",
            price_rsd: "1000",
            checked_at: new Date().toISOString(),
          },
        ]).length,
        0,
      );
    },
  );
  let releaseSource!: () => void;
  const sourceGate = new Promise<void>((resolve) => {
    releaseSource = resolve;
  });
  const dependencies = {
    refreshOfficial: async (_actor: string, warn: (s: string) => void) => {
      await sourceGate;
      warn("TEST: mreža izvora nije dostupna; sačuvani podaci ostaju.");
    },
    collectPublic: async (table: any, actor: string) => {
      let number = 1000;
      const seen = new Set<string>();
      for (const row of table.rows.filter(
        (r: any) =>
          r.pricingGroup !== "diesel" &&
          r.occurrences.some(
            (o: any) =>
              pilotTemplates.includes(o.templateId) && Number(o.quantity) > 0,
          ),
      )) {
        let name = row.occurrences[0].name,
          unit = "l",
          description = "";
        if (row.cultureSpecific) {
          const crop = row.name.split(" · ").slice(1).join(" · ");
          name =
            crop === "PŠENICA"
              ? "Seme pšenice"
              : crop === "SOJA"
                ? "Seme soje"
                : crop === "KUKURUZ"
                  ? "Seme kukuruza"
                  : "Seme šećerne repe";
          if (row.unit === "sj") name += " 25.000 zrna";
          else {
            name += " 1 kg";
            unit = "kg";
          }
        } else {
          if (/NPK|KAN|urea/i.test(name)) {
            unit = "kg";
            description = "Sadržaj azota 27 % i 46 % — TEST.";
          }
          name += " 1 " + unit;
        }
        if (seen.has(name)) continue;
        seen.add(name);
        await transaction((tx) =>
          savePublicProduct(
            tx,
            "hemoslavija",
            `https://www.hemoslavijaprodavnica.com/detail.php?artsif=${number++}`,
            hemo(name, "1,000.00", description),
            actor,
          ),
        );
      }
    },
  };
  await t.test(
    "Priprema predlaže cene u nacrt; ponavljanje ne duplira izvore i ne aktivira ništa",
    async () => {
      const job = await startPreparation(
        book.id,
        admin.id,
        {
          revision: table.revision,
          fuel: "200",
          seedUnits: { "s0-B103": "25000", "s0-B206": "100000" },
        },
        dependencies,
      );
      try {
        const retry = await req(
          admin,
          `/admin/price-books/${book.id}/prepare`,
          { revision: table.revision, fuel: "200" },
        );
        assert.equal(retry.status, 202);
        assert.equal((await retry.json()).id, job.id);
        const check = await req(admin, `/admin/price-books/${book.id}/check`, {
          revision: table.revision,
          confirmUnits: true,
          reason: "TEST zaključana priprema",
        });
        assert.equal(check.status, 422);
      } finally {
        releaseSource();
      }
      await waitPreparation(job.id);
      view = await ok(admin, `/admin/price-books/${book.id}/workbench`);
      table = view.table;
      assert.equal(view.job.status, "complete", JSON.stringify(view.job));
      assert.equal(view.job.warnings.length, 1);
      assert.ok(
        view.check.readyCount >= 4,
        JSON.stringify(
          view.check.issues.filter((i: any) =>
            table.versions
              .filter((v: any) => pilotTemplates.includes(v.templateId))
              .some((v: any) => v.id === i.versionId),
          ),
        ),
      );
      assert.ok(view.versions.every((v: any) => v.status === "draft"));
      assert.equal(
        (await db.query("SELECT count(*)::int AS n FROM exchange_rates"))
          .rows[0].n,
        0,
      );
      const fuel = table.rows.find((r: any) => r.pricingGroup === "diesel");
      assert.equal(fuel.price, "200");
      assert.ok(fuel.occurrences.length > 700);
      const id = (
        await db.query(
          "SELECT id,source_url,content FROM public_price_documents ORDER BY id LIMIT 1",
        )
      ).rows[0];
      const before = (
        await db.query("SELECT count(*)::int AS n FROM public_price_documents")
      ).rows[0].n;
      await transaction((tx) =>
        savePublicProduct(
          tx,
          "hemoslavija",
          id.source_url,
          Buffer.from(id.content),
          admin.id,
        ),
      );
      assert.equal(
        (
          await db.query(
            "SELECT count(*)::int AS n FROM public_price_documents",
          )
        ).rows[0].n,
        before,
      );
    },
  );
  let production: any,
    sale: any,
    snapshot: any,
    activeIds: string[] = [];
  await t.test(
    "Jedna potvrda aktivira samo spremne; nekompletne ostaju za zajedničku dopunu",
    async () => {
      const ready = view.check.readyCount,
        result = await ok(admin, `/admin/price-books/${book.id}/activate`, {
          revision: table.revision,
          confirmUnits: true,
          confirmed: true,
          reason: "TEST grupna potvrda",
        });
      assert.equal(result.cultures, ready);
      assert.equal(result.remaining, 88 - ready);
      assert.ok(result.remaining > 0);
      view = await ok(admin, `/admin/price-books/${book.id}/workbench`);
      assert.equal(view.book.status, "active");
      assert.equal(view.table.versions.length, 88 - ready);
      const active = (
        await db.query(
          "SELECT * FROM norm_versions WHERE price_book_id=$1 AND status='active'",
          [book.id],
        )
      ).rows;
      activeIds = active.map((v: any) => v.id);
      assert.ok(
        pilotTemplates.every((id) =>
          active.some((v: any) => v.template_id === id),
        ),
      );
      const wheat = active.find((v: any) => v.template_id === "s0-B36");
      assert.ok(wheat);
      assert.equal(
        wheat.model.items.filter(
          (i: any) =>
            i.alternativeGroup === "B54" &&
            i.included !== false &&
            Number(i.quantity) > 0,
        ).length,
        1,
      );
      assert.ok(
        wheat.model.items.every((i: any) => i.priceInput?.proposed !== true),
      );
      const shared = view.table.rows.find(
        (r: any) =>
          r.occurrences.some((o: any) => o.price !== null) &&
          active.some((v: any) =>
            v.model.items.some(
              (i: any) =>
                i.included !== false &&
                i.name === r.occurrences[0].name &&
                i.unit === r.unit &&
                Number(i.quantity) > 0,
            ),
          ),
      );
      assert.ok(shared);
      const conflict = await req(
        admin,
        "/admin/pricing/table",
        {
          versionIds: view.table.versions.map((v: any) => v.id),
          revision: view.table.revision,
          date: "2026-10-01",
          reason: "TEST ne sme promeniti potvrđeni zajednički input",
          rows: [
            {
              key: shared.key,
              price: D(shared.price).add(1).toString(),
              currency: "RSD",
              unit: shared.unit,
              confirmUnit: true,
            },
          ],
        },
        "PUT",
      );
      assert.equal(conflict.status, 409);
      const response = await req(
        admin,
        "/admin/pricing/table",
        {
          versionIds: view.table.versions.map((v: any) => v.id),
          revision: view.table.revision,
          date: "2026-10-01",
          reason: "TEST dopuna preostalih nacrta",
          rows: [
            {
              key: view.table.rows[0].key,
              price: "10",
              currency: "RSD",
              unit: view.table.rows[0].unit,
              confirmUnit: false,
            },
          ],
        },
        "PUT",
      );
      assert.equal(response.status, 200, await response.text());
    },
  );
  await t.test(
    "Sve četiri kulture daju 2,5 × izvorni dinarski trošak; nema izmišljenog EUR",
    async () => {
      for (const templateId of pilotTemplates) {
        const p = await ok(a, "/productions", {
          templateId,
          name: "TEST " + templateId,
          year: 2026,
          status: "final",
          details: {
            scale: "2.5",
            scaleUnit: "ha",
            output: "1000",
            outputUnit: "kg",
            product: "TEST proizvod",
            start: "2026-01-01",
            end: "2026-12-31",
          },
        });
        const r = await ok(a, "/report?productionId=" + p.id),
          v = (
            await db.query(
              "SELECT model FROM norm_versions WHERE template_id=$1 AND status='active'",
              [templateId],
            )
          ).rows[0].model;
        const expected = v.items
          .filter((i: any) => i.included !== false)
          .reduce(
            (s: any, i: any) => s.add(D(i.quantity || 0).mul(i.price || 0)),
            D(0),
          )
          .mul("2.5")
          .toString();
        assert.equal(r.currency, "RSD");
        assert.equal(r.results[0].normativeTotal, expected);
        assert.equal(r.results[0].norm.money.eur, null);
        assert.equal(r.results[0].norm.errors.length, 0);
        if (templateId === "s0-B36") production = p;
      }
      assert.equal(
        (await req(b, "/report?productionId=" + production.id)).status,
        422,
      );
      assert.equal(
        (await req(b, "/export/xlsx?productionId=" + production.id)).status,
        422,
      );
      const eur = await req(
        a,
        "/report?currency=EUR&productionId=" + production.id,
      );
      assert.equal(eur.status, 422);
      assert.match((await eur.json()).error, /EUR/);
    },
  );
  await t.test(
    "Prodaja i delimična naplata imaju različite mesece; kurs ne blokira RSD",
    async () => {
      sale = await ok(a, "/events", {
        kind: "sale",
        productionId: production.id,
        date: "2026-09-01",
        title: "TEST prodaja",
        status: "final",
        amount: "100000",
        currency: "RSD",
        details: { quantity: "1000", unit: "kg", product: "TEST proizvod" },
      });
      await ok(a, "/payments", {
        eventId: sale.id,
        date: "2026-10-01",
        direction: "in",
        amount: "40000",
        currency: "RSD",
        category: "sale",
      });
      const r = await ok(a, "/report?productionId=" + production.id);
      assert.equal(r.results[0].revenue, "100000");
      assert.equal(r.results[0].norm.money.rate, null);
      assert.equal(
        r.cashflow.find((m: any) => m.month === "2026-09").incoming,
        "0",
      );
      assert.equal(
        r.cashflow.find((m: any) => m.month === "2026-10").incoming,
        "40000",
      );
      assert.equal(r.cashflow[0].opening, null);
      snapshot = await ok(a, "/snapshots", {
        productionId: production.id,
        reason: "TEST RSD snapshot",
      });
      const file = await req(a, "/export/xlsx?productionId=" + production.id);
      assert.equal(file.status, 200);
      const wb = XLSX.read(Buffer.from(await file.arrayBuffer()));
      assert.ok(wb.SheetNames.length > 1);
      const pdf = await req(a, "/export/pdf?productionId=" + production.id);
      assert.equal(pdf.status, 200);
      assert.equal(
        Buffer.from(await pdf.arrayBuffer())
          .subarray(0, 4)
          .toString(),
        "%PDF",
      );
    },
  );
  await t.test(
    "Stvarni RSD trošak zamenjuje jednu stavku bez dupliranja i bez kursa",
    async () => {
      const before = (await ok(a, "/report?productionId=" + production.id))
        .results[0];
      const line = before.norm.lines.find((i: any) => i.id === "F43");
      await ok(a, "/events", {
        kind: "cost",
        productionId: production.id,
        date: "2026-09-02",
        title: "TEST stvarni trošak",
        status: "final",
        amount: "60000",
        currency: "RSD",
        details: { normItemId: line.id, replaceNorm: true },
      });
      const r = (await ok(a, "/report?productionId=" + production.id))
        .results[0];
      assert.equal(r.normativeTotal, before.normativeTotal);
      assert.equal(
        r.combinedCost,
        D(before.normativeTotal).sub(line.cost).add(60000).toString(),
      );
      assert.equal(r.actualResult.amount, "40000");
      assert.equal(r.actualResult.percent, "40");
      assert.match(r.actualStatus, /Privremeno/);
    },
  );
  await t.test(
    "Interni prenos i potrošnja čuvaju uparene RSD vrednosti i praznu EUR konverziju",
    async () => {
      const corn = (
        await db.query(
          "SELECT id FROM production_periods WHERE farm_id=$1 AND template_id='s0-B103'",
          [a.farm],
        )
      ).rows[0];
      const before = await ok(a, "/report");
      const transfer = await ok(a, "/transfers", {
        from: corn.id,
        to: production.id,
        date: "2026-10-02",
        product: "TEST proizvod",
        unit: "kg",
        quantity: "1000",
        method: "normative",
      });
      const moves = (
        await db.query(
          "SELECT quantity::text,value_rsd::text,value_eur FROM inventory_movements WHERE farm_id=$1 AND link_id=$2",
          [a.farm, transfer.id],
        )
      ).rows;
      assert.equal(moves.length, 2);
      assert.equal(
        moves.reduce((s: any, m: any) => s.add(m.quantity), D(0)).toString(),
        "0",
      );
      assert.equal(
        moves.reduce((s: any, m: any) => s.add(m.value_rsd), D(0)).toString(),
        "0",
      );
      assert.ok(moves.every((m: any) => m.value_eur === null));
      await ok(a, "/feed", {
        productionId: production.id,
        date: "2026-10-03",
        product: "TEST proizvod",
        quantity: "500",
        unit: "kg",
      });
      const consumption = (
        await db.query(
          "SELECT value_rsd::text,value_eur FROM feed_consumption WHERE farm_id=$1",
          [a.farm],
        )
      ).rows[0];
      assert.ok(D(consumption.value_rsd).gt(0));
      assert.equal(consumption.value_eur, null);
      const after = await ok(a, "/report");
      assert.equal(after.totals.revenue, before.totals.revenue);
      assert.equal(after.totals.netCash, before.totals.netCash);
    },
  );
  await t.test(
    "Naknadni kurs ne prepisuje istorijski RSD snapshot niti aktivne modele",
    async () => {
      const before = (
        await db.query("SELECT payload FROM report_snapshots WHERE id=$1", [
          snapshot.id,
        ])
      ).rows[0].payload;
      await ok(admin, "/admin/rates", {
        validFrom: "2026-01-01",
        validTo: "2026-12-31",
        rate: "117",
        source: "https://www.nbs.rs/TEST",
        publishedAt: "2026-01-01",
      });
      assert.deepEqual(
        (
          await db.query("SELECT payload FROM report_snapshots WHERE id=$1", [
            snapshot.id,
          ])
        ).rows[0].payload,
        before,
      );
      assert.equal(before.results[0].norm.money.eur, null);
      assert.equal(
        (
          await db.query(
            "SELECT count(*)::int AS n FROM norm_versions WHERE id=ANY($1::uuid[]) AND status='active'",
            [activeIds],
          )
        ).rows[0].n,
        activeIds.length,
      );
    },
  );
});

test.after(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  await closeDatabase();
  await rm(temp, { recursive: true, force: true });
});
