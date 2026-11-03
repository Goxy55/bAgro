import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import ExcelJS from "exceljs";
import { PDFParse } from "pdf-parse";
import {
  calculateMonthlyCosts,
  calendarFor,
  parseMonths,
  proposedCalendarPolicy as policy,
} from "../server/monthly-costs.js";
import { D } from "../server/domain.js";
const inventory = JSON.parse(
  readFileSync(new URL("../source/inventory.json", import.meta.url), "utf8"),
);
function model(id = "s0-B36") {
  const c = structuredClone(inventory.cards.find((c: any) => c.id === id));
  c.currency = "RSD";
  c.reviewed = true;
  const chosen = new Set<string>();
  for (const i of c.items) {
    i.price = "1";
    i.unit = "kg";
    i.unitConfirmed = true;
    i.alternativeConfirmed = true;
    if (i.alternativeGroup && Number(i.quantity) > 0) {
      if (chosen.has(i.alternativeGroup) || i.id === "F54") {
        i.included = false;
        i.exclusionReason = "TEST jedne izvorne alternative";
      } else chosen.add(i.alternativeGroup);
    }
  }
  return c;
}
const p = { year: 2026, details: { scale: "2.5", scaleUnit: "ha" } };
test("Meseci se čitaju deklarativno; raspon i diskretni meseci ne dupliraju normu", () => {
  assert.deepEqual(
    parseMonths("IV–VIII").map((m) => m.month),
    [4, 5, 6, 7, 8],
  );
  assert.deepEqual(
    parseMonths("III, V, VII").map((m) => m.month),
    [3, 5, 7],
  );
  assert.deepEqual(parseMonths("XII-III"), [
    { month: 12, yearStep: 0 },
    { month: 1, yearStep: 1 },
    { month: 2, yearStep: 1 },
    { month: 3, yearStep: 1 },
  ]);
  for (const invalid of [
    null,
    "IV/VI,VII",
    "I,I",
    "=process.exit()",
    "XIII",
    "13",
    "I--III",
  ])
    assert.throws(() => parseMonths(invalid));
});
test("Izvorna pšenica: B/C/D/E/F, prethodna jesen, prenos preko januara i izostavljeni F57", () => {
  const m = model();
  for (const [date, expected] of [
    ["2025-09", "0"],
    ["2025-10", "1533.15"],
    ["2026-01", "1533.15"],
    ["2026-02", "2038.15"],
    ["2026-05", "2049.175"],
    ["2026-07", "2134.175"],
  ]) {
    const result = calculateMonthlyCosts(m, m.id, p, date, policy);
    assert.equal(
      result.cumulative,
      expected,
      date + JSON.stringify(result.errors),
    );
    assert.equal(result.errors.length, 0);
    assert.equal(
      result.months.find((r) => r.month === date)?.cumulative,
      expected,
    );
  }
  const result = calculateMonthlyCosts(m, m.id, p, "2026-05", policy),
    duet = result.lines.find((l) => l.id === "F57")!;
  assert.equal(duet.cumulative, "1.25");
  assert.equal(duet.allocation[0].month, "2026-05");
  assert.match(duet.notes.join(" "), /C53/);
  const npk = result.lines.find((l) => l.id === "F41")!;
  assert.equal(npk.normQuantity, "300");
  assert.equal(npk.price, "1");
  assert.equal(npk.perReferenceCost, "300");
  assert.equal(npk.quantity, "750");
  assert.equal(npk.fullCost, "750");
  const calendarYear = calculateMonthlyCosts(m, m.id, p, "2026-02", {
    ...policy,
    seasonRule: "calendar",
  });
  assert.equal(calendarYear.cumulative, "505");
});
test("Izvorna šećerna repa: šest tretmana u pet meseci i zasebni meseci pojedinih preparata", () => {
  const m = model("s0-B206"),
    r = calculateMonthlyCosts(m, m.id, p, "2026-08", policy);
  const operation = r.lines.find((l) => l.id === "F224")!;
  assert.deepEqual(
    operation.allocation.map((a) => [a.month, a.amount]),
    [
      ["2026-04", "4.9"],
      ["2026-05", "4.9"],
      ["2026-06", "9.8"],
      ["2026-07", "4.9"],
      ["2026-08", "4.9"],
    ],
  );
  assert.equal(
    operation.allocation.reduce((s, a) => s.add(a.amount!), D(0)).toString(),
    operation.fullCost,
  );
  const betanal = r.lines.find((l) => l.id === "F226")!;
  assert.deepEqual(
    betanal.allocation.map((a) => [a.month, a.amount]),
    [
      ["2026-04", "5"],
      ["2026-05", "5"],
    ],
  );
  const fusilade = r.lines.find((l) => l.id === "F227")!;
  assert.equal(fusilade.allocation[0].month, "2026-07");
  const april = calculateMonthlyCosts(m, m.id, p, "2026-04", policy);
  assert.equal(april.lines.find((l) => l.id === "F227")?.cumulative, "0");
  const equal = calculateMonthlyCosts(m, m.id, p, "2026-08", {
    ...policy,
    preferAuxiliary: false,
  });
  assert.deepEqual(
    equal.lines.find((l) => l.id === "F224")!.allocation.map((a) => a.amount),
    ["5.88", "5.88", "5.88", "5.88", "5.88"],
  );
});
test("Sve četiri početne kulture zadržavaju ukupan trošak i količine pri mesečnoj raspodeli", () => {
  for (const id of ["s0-B36", "s0-B103", "s0-B243", "s0-B206"]) {
    const m = model(id),
      r = calculateMonthlyCosts(m, id, p, "2026-12", policy);
    assert.equal(r.cumulative, r.fullCost, id);
    for (const line of r.lines)
      if (line.allocation.length)
        assert.equal(
          line.allocation.reduce((n, a) => n.add(a.quantity!), D(0)).toString(),
          line.quantity,
        );
  }
});
test("Poznata izvorna neslaganja heljde ne prikazuju se kao potpun mesečni obračun", () => {
  const m = model("s0-B486"),
    r = calculateMonthlyCosts(m, m.id, p, "2026-07", policy);
  assert.equal(r.cumulative, null);
  assert.match(r.errors.join(" "), /F490/);
  assert.match(r.errors.join(" "), /F496/);
});
test("Kukuruz: priprema jul–novembar prethodne godine; pomoćni oktobar ne prepisuje jul iz C", () => {
  const m = model("s0-B103"),
    r = calculateMonthlyCosts(m, m.id, p, "2025-07", policy);
  assert.equal(r.cumulative, "133.1");
  const row = r.lines.find((l) => l.id === "F107")!;
  assert.equal(row.allocation[0].month, "2025-07");
  assert.match(row.notes.join(" "), /nije usaglašena/);
  const nov = calculateMonthlyCosts(m, m.id, p, "2025-11", policy);
  assert.equal(nov.cumulative, "953.2");
  const final = calculateMonthlyCosts(m, m.id, p, "2026-10", policy);
  assert.equal(final.cumulative, final.fullCost);
  assert.equal(
    final.months
      .filter((r) => r.included)
      .reduce((s, m) => s.add(m.increase!), D(0))
      .toString(),
    final.cumulative,
  );
});
function simple(items: any[], extra: any = {}) {
  return {
    reviewed: true,
    currency: "RSD",
    basis: "ha",
    reference: "1",
    groups: [],
    sheet: "TEST",
    items: items.map((i: any) => ({
      unit: "kg",
      unitConfirmed: true,
      price: "10",
      ...i,
    })),
    ...extra,
  };
}
test("Prazna cena/količina/mesec nisu nule; kasnija nepoznata cena ne blokira raniji mesec", () => {
  const m = simple([
    { id: "A", name: "TEST ranije", quantity: "2", month: "III" },
    { id: "B", name: "TEST kasnije", quantity: "5", month: "VI", price: null },
  ]);
  assert.equal(
    calculateMonthlyCosts(m, "TEST", p, "2026-03", policy).cumulative,
    "50",
  );
  assert.equal(
    calculateMonthlyCosts(m, "TEST", p, "2026-06", policy).cumulative,
    null,
  );
  m.items[1].quantity = "0";
  assert.equal(
    calculateMonthlyCosts(m, "TEST", p, "2026-06", policy).cumulative,
    "50",
  );
  m.items[0].price = "0";
  assert.equal(
    calculateMonthlyCosts(m, "TEST", p, "2026-06", policy).cumulative,
    null,
  );
  m.items[0].zeroReason = "TEST izričito besplatno";
  assert.equal(
    calculateMonthlyCosts(m, "TEST", p, "2026-06", policy).cumulative,
    "0",
  );
  m.items[0].quantity = "";
  assert.equal(
    calculateMonthlyCosts(m, "TEST", p, "2026-06", policy).cumulative,
    null,
  );
  const missing = simple([
    { id: "A", name: "TEST bez meseca", quantity: "1", month: null },
  ]);
  assert.equal(
    calculateMonthlyCosts(missing, "TEST", p, "2026-06", policy).cumulative,
    null,
  );
});
test("Ručno odobrena raspodela, tačni ukupni iznosi i različite proizvodne osnove", () => {
  const m = simple([
    {
      id: "A",
      name: "TEST raspodela",
      quantity: "1",
      month: "III-V",
      monthDistribution: [
        { month: 3, share: "25" },
        { month: 5, share: "75" },
      ],
    },
  ]);
  assert.equal(
    calculateMonthlyCosts(m, "TEST", p, "2026-03", policy).cumulative,
    "6.25",
  );
  assert.equal(
    calculateMonthlyCosts(m, "TEST", p, "2026-05", policy).cumulative,
    "25",
  );
  m.items[0].monthDistribution[1].share = "50";
  assert.equal(
    calculateMonthlyCosts(m, "TEST", p, "2026-05", policy).cumulative,
    null,
  );
  const house = simple(
    [{ id: "A", name: "TEST plastenik", quantity: "10", month: "IV" }],
    { basis: "m2", reference: "100" },
  );
  assert.equal(
    calculateMonthlyCosts(
      house,
      "TEST",
      { year: 2026, details: { scale: "250", scaleUnit: "m2" } },
      "2026-04",
      policy,
    ).cumulative,
    "250",
  );
  assert.equal(
    calculateMonthlyCosts(
      house,
      "TEST",
      { year: 2026, details: { scale: "2.5", scaleUnit: "ha" } },
      "2026-04",
      policy,
    ).cumulative,
    "25000",
  );
  assert.equal(
    calculateMonthlyCosts(
      { ...house, basis: "head_cycle" },
      "TEST",
      p,
      "2026-04",
      policy,
    ).supported,
    false,
  );
  const split = simple([
    {
      id: "A",
      name: "TEST trećine",
      quantity: "1",
      price: "1",
      month: "III-V",
    },
  ]);
  const r = calculateMonthlyCosts(
    split,
    "TEST",
    { year: 2026, details: { scale: "1", scaleUnit: "ha" } },
    "2026-05",
    { ...policy, preferAuxiliary: false },
  );
  assert.equal(
    r.months.reduce((s, m) => s.add(m.increase!), D(0)).toString(),
    "1",
  );
});

test("Zimski raspon zahteva potvrdu godine umesto pretpostavke naredne sezone", () => {
  const m = simple([
    { id: "A", name: "TEST zimski raspored", quantity: "1", month: "XII-III" },
  ]);
  assert.equal(
    calculateMonthlyCosts(m, "TEST", p, "2026-03", policy).cumulative,
    null,
  );
  m.items[0].calendarYearOffset = -1;
  assert.equal(
    calculateMonthlyCosts(m, "TEST", p, "2026-03", policy).cumulative,
    "25",
  );
});

const temp = await mkdtemp("/tmp/agro-monthly-costs-TEST-");
process.env.DATABASE_URL = "";
process.env.DATA_DIR = temp + "/pg";
process.env.APP_URL = "http://localhost:3000";
process.env.BETTER_AUTH_SECRET = "TEST-monthly-costs-secret-012345678901234567";
const { app } = await import("../server/app.js");
const { db, transaction, closeDatabase } = await import("../server/db.js");
const { importSource } = await import("../server/importer.js");
const server = app.listen(0, "127.0.0.1");
await new Promise<void>((r) => server.once("listening", r));
const base = `http://127.0.0.1:${(server.address() as any).port}/api`;
type User = { id: string; cookie: string; farm?: string };
async function request(
  u: User | undefined,
  path: string,
  body?: any,
  method?: string,
) {
  return fetch(base + path, {
    method: method || (body ? "POST" : "GET"),
    headers: {
      Origin: "http://localhost:3000",
      "Content-Type": "application/json",
      ...(u ? { Cookie: u.cookie } : {}),
      ...(u?.farm ? { "X-Farm-Id": u.farm } : {}),
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
  const r = await request(u, path, body, method),
    v = await r.json();
  assert.ok(r.ok, `${path} ${r.status}: ${JSON.stringify(v)}`);
  return v;
}
async function signup(email: string): Promise<User> {
  const r = await request(undefined, "/auth/sign-up/email", {
      email,
      password: "TEST-monthly-password-2026!",
      name: "TEST",
    }),
    v = await r.json();
  assert.equal(r.status, 200);
  return {
    id: v.user.id,
    cookie: r.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; "),
  };
}

test("Mesečna ulaganja kroz autorizovan API, snapshot i izvoz", async (t) => {
  await importSource();
  const admin = await signup("admin@monthly.test"),
    a = await signup("farma-a@monthly.test"),
    b = await signup("farma-b@monthly.test");
  await db.query("INSERT INTO app_admins VALUES($1)", [admin.id]);
  for (const user of [a, b])
    user.farm = (
      await ok(user, "/farms", {
        name: user === a ? "TEST Farma A" : "TEST Farma B",
        municipality: "TEST",
        year: 2026,
        currency: "RSD",
      })
    ).id;
  const initialPolicy = await ok(admin, "/admin/cost-calendar");
  assert.deepEqual(initialPolicy.current.policy, policy);
  // Only this isolated TEST database exercises the missing-policy fallback.
  await db.query("UPDATE cost_calendar_policies SET status='archive'");
  const crops: any[] = [];
  for (const templateId of ["s0-B36", "s0-B103", "s0-B243", "s0-B206"]) {
    const m = model(templateId);
    await db.query(
      "INSERT INTO norm_versions(id,template_id,name,status,valid_from,valid_to,author,reason,model) VALUES($1,$2,'TEST dinarski normativ','active','2026-01-01','2026-12-31',$3,'TEST sintetička cena 1 RSD, nikada poslovna cena',$4)",
      [randomUUID(), templateId, admin.id, JSON.stringify(m)],
    );
    crops.push(
      await ok(a, "/productions", {
        templateId,
        name: "TEST " + m.name,
        year: 2026,
        status: "draft",
        details: {
          scale: "2.5",
          scaleUnit: "ha",
          start: "2026-01-01",
          end: "2026-12-31",
        },
      }),
    );
  }
  const wheat = crops[0];
  let snapshot: any;
  const query = (m = "2026-05") => `/wip?asOf=${m}&productionId=${wheat.id}`;
  await t.test(
    "Prijava, dve farme, admin pravila i nepotvrđena politika bez izmišljene raspodele",
    async () => {
      assert.equal((await request(undefined, query())).status, 401);
      assert.equal((await request(b, query())).status, 422);
      assert.equal(
        (await request({ ...a, farm: b.farm }, query())).status,
        403,
      );
      assert.equal((await request(b, "/admin/cost-calendar")).status, 403);
      assert.equal(
        (
          await request(a, "/admin/cost-calendar", {
            requestId: randomUUID(),
            name: "TEST",
            reason: "TEST",
            policy,
            confirmed: true,
          })
        ).status,
        403,
      );
      const r = await ok(a, query());
      assert.equal(r.policy, null);
      assert.equal(r.results[0].cumulative, null);
      assert.equal(r.results[0].wipValue, null);
      const body = {
        requestId: randomUUID(),
        name: "TEST pravila kalendara",
        reason: "TEST odobrene pretpostavke",
        policy,
        confirmed: true,
      };
      const first = await ok(admin, "/admin/cost-calendar", body),
        second = await ok(admin, "/admin/cost-calendar", body);
      assert.equal(first.id, second.id);
    },
  );
  await t.test(
    "Izračun bez prinosa i bez kursa; potvrda rasta ne stvara rashod, uplatu ni gotov proizvod",
    async () => {
      const r = await ok(a, query());
      assert.equal(r.results[0].cumulative, "2049.175");
      assert.equal(r.results[0].wipValue, null);
      assert.equal(r.results[0].version.currency, "RSD");
      assert.equal(r.results[0].normSnapshot, undefined);
      await ok(
        a,
        `/wip/productions/${wheat.id}/state`,
        { state: "growing", note: "TEST usev u toku" },
        "PATCH",
      );
      const growing = await ok(a, query());
      assert.equal(growing.results[0].wipValue, "2049.175");
      assert.equal(
        (await db.query("SELECT count(*)::int AS n FROM exchange_rates"))
          .rows[0].n,
        0,
      );
      for (const table of [
        "payments",
        "business_events",
        "inventory_movements",
      ])
        assert.equal(
          (
            await db.query(
              `SELECT count(*)::int AS n FROM ${table} WHERE farm_id=$1`,
              [a.farm],
            )
          ).rows[0].n,
          0,
        );
      await ok(
        a,
        `/productions/${wheat.id}`,
        { details: { start: "2025-10-01", end: "2026-07-31" } },
        "PATCH",
      );
      assert.equal(
        (await ok(a, query())).results[0].cumulative,
        "2049.175",
        "Cenovnik sezone pokriva i pripremu prethodne godine",
      );
      assert.equal(
        (await ok(a, `/report?productionId=${wheat.id}`)).results[0]
          .normativeTotal,
        "2134.175",
      );
      assert.equal(
        (await ok(a, query())).results[0].state,
        "growing",
        "Dopuna proizvodnje čuva stanje useva",
      );
      const october = await ok(a, query("2025-10"));
      assert.equal(october.results[0].cumulative, "1533.15");
      await ok(a, "/wip", {
        productionId: wheat.id,
        month: "2026-05-31",
        amount: "500",
        currency: "RSD",
        note: "TEST ranije ručno kumulativno stanje",
      });
      assert.equal((await ok(a, query())).results[0].cumulative, "2049.175");
    },
  );
  await t.test(
    "Sačuvan obračun sadrži istoriju norme i pravila, a tuđi izvoz i izmena su odbijeni",
    async () => {
      snapshot = await ok(a, "/wip/snapshots", {
        asOf: "2026-05",
        productionId: wheat.id,
        reason: "TEST zaključen mesec",
      });
      const stored = (
        await db.query("SELECT payload FROM wip_snapshots WHERE id=$1", [
          snapshot.id,
        ])
      ).rows[0].payload;
      assert.equal(
        stored.results[0].normSnapshot.model.items.find(
          (i: any) => i.id === "F57",
        ).price,
        "1",
      );
      assert.equal(stored.policy.policy.preferAuxiliary, true);
      assert.equal(
        (await request(b, `/wip/export/xlsx?snapshotId=${snapshot.id}`)).status,
        422,
      );
      assert.equal(
        (
          await request(
            b,
            `/wip/productions/${wheat.id}/state`,
            {
              state: "completed",
              completedOn: "2026-07-20",
              note: "TEST nije moja proizvodnja",
            },
            "PATCH",
          )
        ).status,
        422,
      );
      assert.deepEqual(await ok(b, "/wip/snapshots"), []);
    },
  );
  await t.test(
    "PDF, XLSX i ekran imaju iste iznose; prave numeričke ćelije i srpski PDF tekst",
    async () => {
      const r = await ok(a, query()),
        excel = await request(
          a,
          `/wip/export/xlsx?asOf=2026-05&productionId=${wheat.id}`,
        );
      assert.equal(excel.status, 200);
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(Buffer.from(await excel.arrayBuffer()) as any);
      assert.equal(
        workbook.getWorksheet("Pregled")!.getCell("B2").value,
        Number(r.results[0].cumulative),
      );
      assert.equal(
        workbook.getWorksheet("Pregled")!.getCell("E2").value,
        Number(r.results[0].wipValue),
      );
      assert.ok(workbook.getWorksheet("Troškovnik")!.rowCount > 20);
      const pdf = await request(
        a,
        `/wip/export/pdf?asOf=2026-05&productionId=${wheat.id}`,
      );
      assert.equal(pdf.status, 200);
      const parser = new PDFParse({
        data: Buffer.from(await pdf.arrayBuffer()),
      });
      try {
        const text = (await parser.getText()).text;
        assert.match(text, /2049\.18/);
        assert.match(text, /PŠENICA/);
        assert.match(text, /Duet ultra/);
      } finally {
        await parser.destroy();
      }
    },
  );
  await t.test(
    "Završetak useva zatvara zalihu, zadržava istorijski trošak i snimljeni mesec",
    async () => {
      await ok(
        a,
        `/wip/productions/${wheat.id}/state`,
        {
          state: "completed",
          completedOn: "2026-07-20",
          note: "TEST završena proizvodnja",
        },
        "PATCH",
      );
      assert.equal((await ok(a, query("2026-07"))).results[0].wipValue, "0");
      assert.equal(
        (await ok(a, query("2026-07"))).results[0].cumulative,
        "2134.175",
      );
      assert.equal((await ok(a, query())).results[0].wipValue, "2049.175");
      assert.equal(
        (
          await db.query("SELECT payload FROM wip_snapshots WHERE id=$1", [
            snapshot.id,
          ])
        ).rows[0].payload.results[0].state,
        "growing",
      );
    },
  );
  await t.test(
    "Nova cena ili kalendarska pravila ne prepisuju sačuvani obračun",
    async () => {
      const before = (
        await db.query("SELECT payload FROM wip_snapshots WHERE id=$1", [
          snapshot.id,
        ])
      ).rows[0].payload;
      await transaction(async (tx) => {
        const old = (
          await tx.query(
            "SELECT * FROM norm_versions WHERE template_id='s0-B36' AND status='active'",
          )
        ).rows[0];
        await tx.query(
          "UPDATE norm_versions SET status='archive' WHERE id=$1",
          [old.id],
        );
        const m = structuredClone(old.model);
        for (const i of m.items) i.price = "2";
        await tx.query(
          "INSERT INTO norm_versions(id,template_id,name,status,valid_from,valid_to,author,reason,model) VALUES($1,'s0-B36','TEST nova cena','active','2026-01-01','2026-12-31',$2,'TEST eksplicitna nova verzija',$3)",
          [randomUUID(), admin.id, JSON.stringify(m)],
        );
      });
      assert.equal((await ok(a, query())).results[0].cumulative, "4098.35");
      await ok(admin, "/admin/cost-calendar", {
        requestId: randomUUID(),
        name: "TEST nova pravila",
        expectedPolicyId: (await ok(admin, "/admin/cost-calendar")).current.id,
        reason: "TEST ne menja snapshot",
        policy: { ...policy, seasonRule: "calendar" },
        confirmed: true,
      });
      assert.deepEqual(
        (
          await db.query("SELECT payload FROM wip_snapshots WHERE id=$1", [
            snapshot.id,
          ])
        ).rows[0].payload,
        before,
      );
      const second = await ok(a, "/wip/snapshots", {
        asOf: "2026-05",
        productionId: wheat.id,
        reason: "TEST izričit ponovni obračun",
      });
      assert.equal(
        (
          await db.query("SELECT previous_id FROM wip_snapshots WHERE id=$1", [
            second.id,
          ])
        ).rows[0].previous_id,
        snapshot.id,
      );
      const file = await request(
        a,
        `/wip/export/xlsx?snapshotId=${snapshot.id}`,
      );
      const book = new ExcelJS.Workbook();
      await book.xlsx.load(Buffer.from(await file.arrayBuffer()) as any);
      assert.equal(book.getWorksheet("Pregled")!.getCell("B2").value, 2049.175);
    },
  );
});
test.after(async () => {
  server.closeAllConnections();
  await new Promise<void>((r) => server.close(() => r()));
  await closeDatabase();
  await rm(temp, { recursive: true, force: true });
});
