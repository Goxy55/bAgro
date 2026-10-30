import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { chromium } from "@playwright/test";
import * as XLSX from "@e965/xlsx";
import { todayInSerbia } from "../shared/dates.js";

// Entirely isolated TEST fixtures. This script never reads a production account,
// business database or hosting token, and never makes live source requests.
const directory = await mkdtemp("/tmp/agro-book-browser-TEST-");
const port = Number(process.env.BOOKS_E2E_PORT || 3710),
  base = `http://localhost:${port}`;
process.env.DATABASE_URL = "";
process.env.DATA_DIR = directory + "/pg";
process.env.APP_URL = base;
process.env.BETTER_AUTH_SECRET = "TEST-book-browser-secret-012345678901234567";
const { db, transaction, closeDatabase } = await import("../server/db.js");
const { auth } = await import("../server/auth.js");
const { importSource } = await import("../server/importer.js");
const { ingestInput } = await import("../server/inputs/service.js");
const { ingestRzsPrices } = await import("../server/pricing/rzs-prices.js");
const email = "admin@price-book-TEST.example",
  password = "TEST-price-book-browser-password!";
const today = todayInSerbia();
try {
  await importSource();
  const user = await auth.api.signUpEmail({
    body: { email, password, name: "TEST zajednički cenovnik" },
  });
  await db.query("INSERT INTO app_admins VALUES($1)", [user.user.id]);
  const versions = (
    await db.query(
      "SELECT v.id,t.name FROM norm_versions v JOIN templates t ON t.id=v.template_id",
    )
  ).rows;
  for (const v of versions) {
    const model = {
      basis: "ha",
      reference: "1",
      reviewed: false,
      groups: [],
      sheet: "Usevi",
      range: "TEST fixture",
      items: [
        {
          id: "TEST-npk",
          name: "NPK đubrivo 15:15:15",
          quantity: v.name === "PŠENICA" ? "300" : "200",
          price: null,
          unit: "kg",
          unitConfirmed: false,
        },
        {
          id: "TEST-service",
          name: "TEST dopunska usluga",
          quantity: "1",
          price: null,
          unit: "sat",
          unitConfirmed: false,
        },
        ...(v.name === "PŠENICA"
          ? [
              {
                id: "TEST-seed",
                name: "Seme",
                quantity: "100",
                price: null,
                unit: "kg",
                unitConfirmed: false,
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
  for (const day of ["2025-12-31", "2026-09-30", today])
    await db.query(
      "INSERT INTO exchange_rates(id,valid_from,valid_to,rate,source_url,published_at,author) VALUES($1,$2,$2,100,'https://www.nbs.rs/TEST-SYNTHETIC',$2,'TEST') ON CONFLICT(valid_from) DO NOTHING",
      [randomUUID(), day],
    );
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ["TEST ĐUBRIVA SEPTEMBAR 2026", null, null, "Beograd", "Čačak"],
      ["PROIZVOD", "PROIZVOĐAČ", "PAKOVANJE"],
      ["NPK (15:15:15)", "TEST proizvođač", "25kg", 2500, 2000],
    ]),
    "TEST ĐUBRIVA",
  );
  await ingestInput(
    Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" })),
    {
      year: 2026,
      month: 9,
      title: "TEST ĐUBRIVA SEPTEMBAR 2026",
      category: "djubriva",
      url: "https://www.stips.minpolj.gov.rs/node/TEST-BOOK",
    },
    "TEST ĐUBRIVA SEPTEMBAR 2026",
    "https://www.stips.minpolj.gov.rs/TEST-BOOK.xlsx",
    "TEST operator",
  );
  const raw = [
    {
      Indikator:
        "Prosečne godišnje otkupne cene poljoprivrednih proizvoda [nema] ",
      "Teritorija - RPJ": "REPUBLIKA SRBIJA",
      Proizvod: "Pšenica seme",
      Period: "2025",
      Vrednost: "50",
      IDStatusPodatka: "A",
      IDStatusPoverljivosti: "F",
      IDJedinicaMere: "0",
    },
  ];
  await transaction((tx) =>
    ingestRzsPrices(
      tx,
      Buffer.from(
        `<script>$("#pivotTableOutput").pivotUI(${JSON.stringify(raw)}, {});</script>`,
      ),
      "TEST",
    ),
  );
} finally {
  await closeDatabase();
}
const child = spawn(process.execPath, ["--import", "tsx", "server/index.ts"], {
  env: { ...process.env, NODE_ENV: "production", PORT: String(port) },
  stdio: ["ignore", "pipe", "pipe"],
});
let logs = "";
child.stdout.on("data", (b) => {
  logs += b.toString();
});
child.stderr.on("data", (b) => {
  logs += b.toString();
});
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } }),
  errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
try {
  let ready = false;
  for (let n = 0; n < 100; n++) {
    try {
      if ((await fetch(base + "/healthz")).ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  assert.ok(ready, logs);
  await page.goto(base);
  await page.getByLabel("Email adresa", { exact: true }).fill(email);
  await page.getByLabel("Lozinka", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Prijavi se", exact: true }).click();
  await page
    .getByLabel("Naziv gazdinstva", { exact: true })
    .fill("TEST cenovnik — sintetički podaci");
  await page.getByLabel("Opština", { exact: true }).fill("TEST");
  await page.getByRole("button", { name: "Sačuvaj", exact: true }).click();
  await page
    .getByRole("button", { name: "Administracija", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Popuni cenovnik iz STIPS-a", exact: true })
    .click();
  await page
    .getByLabel("Naziv cenovnika", { exact: true })
    .fill("TEST kompletan cenovnik 2026");
  await page
    .locator('input[name="reason"]')
    .first()
    .fill("TEST grupno odobrenje, nije poslovni cenovnik");
  await page
    .getByRole("button", { name: "Pripremi kompletan cenovnik", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "TEST kompletan cenovnik 2026", exact: true })
    .waitFor();
  assert.match(
    await page.locator("body").innerText(),
    /88 kultura \/ kategorija/,
  );
  assert.equal(
    await page.getByLabel("Izvor JEČAM", { exact: true }).isVisible(),
    false,
  );
  const npk = page
    .locator(".suggestions-table tbody tr")
    .filter({ hasText: "NPK đubrivo 15:15:15" });
  await npk.waitFor();
  assert.match(await npk.innerText(), /100 RSD\/kg/);
  await page
    .getByLabel("Potvrđujem referentne proizvode i osnovu cene", {
      exact: true,
    })
    .check();
  await page
    .getByRole("button", { name: /^Primeni referentne cene u cenovniku/ })
    .click();
  await page
    .getByRole("status")
    .filter({ hasText: /Sačuvano u 88/ })
    .waitFor();
  const seed = page
    .locator(".suggestions-table tbody tr")
    .filter({ hasText: "Seme · PŠENICA" });
  await seed.waitFor();
  const product = seed.getByRole("combobox").first();
  await product.selectOption({ index: 1 });
  await page
    .getByLabel("Izvorna jedinica RZS za Seme · PŠENICA", { exact: true })
    .selectOption("kg");
  await page
    .getByLabel("Prihvatam starije referentne cene", { exact: true })
    .check();
  await page
    .getByLabel("Odobravam RZS otkupne cene kao referencu inputa", {
      exact: true,
    })
    .check();
  await page
    .getByLabel("Potvrđujem referentne proizvode i osnovu cene", {
      exact: true,
    })
    .check();
  await page
    .getByRole("button", { name: /^Primeni referentne cene u cenovniku/ })
    .click();
  await page
    .getByRole("status")
    .filter({ hasText: /Sačuvano u 1 kultura/ })
    .waitFor();
  await page
    .getByLabel("Zajednička cena TEST dopunska usluga", { exact: true })
    .fill("3000");
  await page
    .getByLabel("Razlog izmene svih cena", { exact: true })
    .fill("TEST zajednička cena za sve kulture");
  await page.getByRole("button", { name: /^Sačuvaj i rasporedi cene/ }).click();
  await page
    .getByRole("status")
    .filter({ hasText: /Sačuvano u 88/ })
    .waitFor();
  await page
    .getByLabel("Potvrđujem jedinice celog cenovnika", { exact: true })
    .check();
  await page
    .getByRole("button", { name: "Proveri ceo cenovnik", exact: true })
    .click();
  await page
    .getByRole("status")
    .filter({ hasText: "Cenovnik je kompletan" })
    .waitFor();
  await page
    .getByText("Samo nedostajuće ili neusaglašene cene", { exact: true })
    .click();
  await mkdir("docs/screens", { recursive: true });
  await page.screenshot({
    path: "docs/screens/price-book-desktop.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  );
  const region = page.getByRole("region", {
    name: "Zajednička tabela inputa",
    exact: true,
  });
  await region.evaluate((el) => {
    el.scrollLeft = el.scrollWidth;
  });
  const regionBox = await region.boundingBox(),
    lastCell = await region
      .locator("tbody tr:first-child td:last-child")
      .boundingBox();
  assert.ok(
    regionBox &&
      lastCell &&
      lastCell.x + lastCell.width <= regionBox.x + regionBox.width + 2,
    "Poslednja kolona mora biti dostupna pomeranjem tabele.",
  );
  await region.evaluate((el) => {
    el.scrollLeft = 0;
  });
  await page.screenshot({
    path: "docs/screens/price-book-mobile.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.getByLabel("Odobravam ceo cenovnik", { exact: true }).check();
  await page
    .getByRole("button", {
      name: "Potvrdi i aktiviraj ceo cenovnik",
      exact: true,
    })
    .click();
  await page
    .getByRole("heading", {
      name: "TEST kompletan cenovnik 2026 · Aktivan cenovnik",
      exact: true,
    })
    .waitFor();
  const result = await page.evaluate(async () => {
    const r = await fetch("/api/admin");
    return r.json();
  });
  const versions = result.versions.filter(
    (v: any) => v.name === "TEST kompletan cenovnik 2026",
  );
  assert.equal(versions.length, 88);
  assert.ok(versions.every((v: any) => v.status === "active"));
  assert.ok(
    versions.every(
      (v: any) =>
        v.model.items.find((i: any) => i.id === "TEST-npk").price === "1",
    ),
  );
  assert.ok(
    versions.every(
      (v: any) =>
        v.model.items.find((i: any) => i.id === "TEST-service").price === "30",
    ),
  );
  assert.equal(
    versions
      .find((v: any) => v.template_name === "PŠENICA")
      .model.items.find((i: any) => i.id === "TEST-seed").price,
    "0.5",
  );
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.reload();
  await page
    .getByRole("button", { name: "Administracija", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Zajednički cenovnik", exact: true })
    .click();
  await page
    .locator(".price-book-list button")
    .filter({ hasText: "TEST kompletan cenovnik 2026" })
    .click();
  await page
    .getByRole("heading", {
      name: "TEST kompletan cenovnik 2026 · Aktivan cenovnik",
      exact: true,
    })
    .waitFor();
  assert.deepEqual(errors, []);
  console.log(
    "PASS: imenovani cenovnik za svih 88 predložaka, zajednički STIPS/RZS i ručni unos, eksplicitna RZS jedinica, jedna grupna aktivacija, trajnost posle reload-a, telefon 390px i bez browser grešaka. Samo zasebna TEST baza.",
  );
} catch (e) {
  console.error(logs.slice(-2500));
  throw e;
} finally {
  await browser.close();
  child.kill("SIGTERM");
  await new Promise<void>((resolve) => {
    if (child.exitCode !== null) return resolve();
    child.once("exit", () => resolve());
    setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, 10000).unref();
  });
  await rm(directory, { recursive: true, force: true });
}
