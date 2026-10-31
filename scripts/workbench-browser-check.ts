import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { chromium } from "@playwright/test";
import express from "express";
import * as XLSX from "@e965/xlsx";
// Isolated synthetic TEST data only. The Prepare request uses test source dependencies,
// while retaining real database preparation, shared pricing, review and activation.
const dir = await mkdtemp("/tmp/agro-workbench-browser-TEST-");
const port = 3721,
  base = `http://localhost:${port}`;
process.env.DATABASE_URL = "";
process.env.DATA_DIR = dir + "/pg";
process.env.APP_URL = base;
process.env.BETTER_AUTH_SECRET =
  "TEST-workbench-browser-secret-012345678901234567";
const { app } = await import("../server/app.js");
const { db, closeDatabase } = await import("../server/db.js");
const { auth } = await import("../server/auth.js");
const { importSource } = await import("../server/importer.js");
const { ingestInput } = await import("../server/inputs/service.js");
const { startPreparation } = await import("../server/pricing/preparation.js");
await importSource();
const email = "admin@workbench-browser.test",
  password = "TEST-workbench-browser-password!";
const { user } = await auth.api.signUpEmail({
  body: { email, password, name: "TEST administrator" },
});
await db.query("INSERT INTO app_admins VALUES($1)", [user.id]);
for (const v of (await db.query("SELECT * FROM norm_versions")).rows) {
  const pilot = ["s0-B36", "s0-B103", "s0-B243", "s0-B206"].includes(
    v.template_id,
  );
  const model = {
    currency: "EUR",
    basis: "ha",
    reference: "1",
    reviewed: false,
    groups: [],
    sheet: "Usevi",
    range: "TEST fixture — nije izvorni poslovni model",
    items: [
      {
        id: "TEST-npk",
        name: "NPK 15:15:15",
        quantity: "300",
        price: null,
        unit: "kg",
        unitConfirmed: false,
      },
      {
        id: "TEST-manual",
        name: pilot ? "TEST zajednički input" : "TEST nepotvrđena usluga",
        quantity: "1",
        price: null,
        unit: "sat",
        unitConfirmed: false,
      },
      ...(v.template_id === "s0-B36"
        ? [
            {
              id: "F43",
              name: "Oranje",
              quantity: "20.28",
              quantityCell: "E43",
              price: null,
              unit: "l goriva/usluga — potvrditi",
            },
            {
              id: "F44",
              name: "Tanjiranje",
              quantity: "3.78",
              quantityCell: "E44",
              price: null,
              unit: "l goriva/usluga — potvrditi",
            },
          ]
        : []),
    ],
  };
  await db.query("UPDATE norm_versions SET model=$1 WHERE id=$2", [
    JSON.stringify(model),
    v.id,
  ]);
}
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(
  wb,
  XLSX.utils.aoa_to_sheet([
    ["TEST ĐUBRIVA SEPTEMBAR 2026", null, null, "Beograd", "Čačak"],
    ["PROIZVOD", "PROIZVOĐAČ", "PAKOVANJE"],
    ["NPK (15:15:15)", "TEST proizvođač", "25kg", 2500, 2500],
  ]),
  "TEST ĐUBRIVA",
);
await ingestInput(
  Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" })),
  {
    url: "https://www.stips.minpolj.gov.rs/node/99001",
    title: "TEST ĐUBRIVA SEPTEMBAR 2026",
    year: 2026,
    month: 9,
    category: "djubriva",
  },
  "TEST ĐUBRIVA SEPTEMBAR 2026",
  "https://www.stips.minpolj.gov.rs/TEST.xlsx",
  user.id,
);
app.use(express.static("dist"));
app.get("*splat", (_req, res) => res.sendFile("index.html", { root: "dist" }));
const server = app.listen(port, "127.0.0.1");
await new Promise<void>((r) => server.once("listening", r));
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } }),
  errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.route("**/api/admin/price-books/*/prepare", async (route) => {
  try {
    const bookId = new URL(route.request().url()).pathname.split("/").at(-2)!;
    const job = await startPreparation(
      bookId,
      user.id,
      route.request().postDataJSON(),
      { refreshOfficial: async () => {}, collectPublic: async () => {} },
    );
    await route.fulfill({
      status: 202,
      contentType: "application/json",
      body: JSON.stringify(job),
    });
  } catch (e) {
    await route.fulfill({
      status: 422,
      contentType: "application/json",
      body: JSON.stringify({ error: (e as Error).message }),
    });
  }
});
try {
  await page.goto(base);
  await page.getByLabel("Email adresa", { exact: true }).fill(email);
  await page.getByLabel("Lozinka", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Prijavi se", exact: true }).click();
  await page
    .getByLabel("Naziv gazdinstva", { exact: true })
    .fill("TEST — sintetički podaci");
  await page.getByLabel("Opština", { exact: true }).fill("TEST");
  await page.getByRole("button", { name: "Sačuvaj", exact: true }).click();
  await page
    .getByRole("button", { name: "Administracija", exact: true })
    .click();
  const screen = page.locator(".price-workbench");
  await page
    .getByRole("button", { name: "Novi cenovnik", exact: true })
    .click();
  await screen
    .getByLabel("Naziv cenovnika", { exact: true })
    .fill("TEST RSD troškovnik");
  await screen
    .getByRole("button", { name: "Kreiraj dinarski cenovnik", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "TEST RSD troškovnik", exact: true })
    .waitFor();
  await page
    .getByLabel("Zajednička cena goriva RSD/l", { exact: true })
    .fill("200");
  await page
    .getByRole("button", { name: "Pripremi cene iz izvora", exact: true })
    .click();
  await page
    .getByText(
      "Priprema je završena. Pregledajte predloge i potvrdite spremne proizvodnje.",
      { exact: true },
    )
    .waitFor({ timeout: 30000 });
  const shared = page
    .locator(".price-workbench")
    .last()
    .locator("details")
    .filter({ has: page.locator("summary", { hasText: "Nedostajuće cene" }) })
    .first();
  await shared
    .getByLabel("Cena TEST zajednički input", { exact: true })
    .fill("3000");
  await page
    .getByRole("button", { name: /^Sačuvaj zajedničke izmene/ })
    .click();
  await page
    .getByText(
      "Izmene su raspoređene na sve nacrte ovog cenovnika koji koriste isti input i jedinicu.",
      { exact: true },
    )
    .waitFor();
  assert.match(
    await page.locator(".price-readiness").innerText(),
    /4 spremnih/,
  );
  const wheat = page
    .locator(".production-price-list details")
    .filter({ has: page.locator("summary strong", { hasText: "PŠENICA" }) });
  await wheat.locator("summary").click();
  assert.match(await wheat.innerText(), /STIPS referenca/);
  assert.match(await wheat.innerText(), /Beograd/);
  await mkdir("docs/screens", { recursive: true });
  await page.screenshot({
    path: "docs/screens/workbench-desktop.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  );
  await page.screenshot({
    path: "docs/screens/workbench-mobile.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.getByLabel(/Pregledao\/la sam izvore/).check();
  await page
    .getByRole("button", {
      name: "Potvrdi spremne proizvodnje (4)",
      exact: true,
    })
    .click();
  await page
    .getByText("Aktivirano 4 proizvodnji. 84 ostaje u nacrtu za dopunu.", {
      exact: true,
    })
    .waitFor();
  await page.reload();
  await page.getByRole("button", { name: "Navigacija", exact: true }).click();
  await page
    .getByRole("button", { name: "Administracija", exact: true })
    .click();
  await page
    .getByRole("button", { name: /TEST RSD troškovnik · RSD/ })
    .first()
    .click();
  assert.match(
    await page.locator(".price-readiness").innerText(),
    /4 aktivnih/,
  );
  assert.equal(
    (await db.query("SELECT count(*)::int AS n FROM exchange_rates")).rows[0].n,
    0,
  );
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int AS n FROM norm_versions WHERE status='active'",
      )
    ).rows[0].n,
    4,
  );
  assert.equal(
    (await db.query("SELECT count(*)::int AS n FROM input_price_links")).rows[0]
      .n,
    1,
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS: priprema, jedna zajednička dopuna, četiri aktivne proizvodnje, 84 nacrta, RSD bez kursa, desktop/390px/reload, bez JS grešaka.",
  );
} catch (e) {
  console.error((e as Error).message);
  console.error((await page.locator("body").innerText()).slice(0, 6000));
  await page.screenshot({
    path: "/tmp/agro-workbench-browser-failure.png",
    fullPage: true,
    animations: "disabled",
  });
  throw e;
} finally {
  await browser.close();
  server.closeAllConnections();
  await new Promise<void>((r) => server.close(() => r()));
  await closeDatabase();
  await rm(dir, { recursive: true, force: true });
}
