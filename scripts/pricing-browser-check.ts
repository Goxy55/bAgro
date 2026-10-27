import assert from "node:assert/strict";
import { chromium } from "@playwright/test";

const base = process.env.PRICING_E2E_URL || "http://localhost:3400";
const email = process.env.PRICING_E2E_EMAIL,
  password = process.env.PRICING_E2E_PASSWORD;
if (!email || !password)
  throw Error(
    "Postavite PRICING_E2E_EMAIL/PASSWORD za admin TEST nalog u zasebnoj bazi.",
  );
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
try {
  await page.goto(base);
  await page.getByLabel("Email adresa", { exact: true }).fill(email);
  await page.getByLabel("Lozinka", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Prijavi se", exact: true }).click();
  await page
    .getByLabel("Naziv gazdinstva", { exact: true })
    .fill("TEST zajednički cenovnik — browser");
  await page.getByLabel("Opština", { exact: true }).fill("TEST mesto");
  await page.getByRole("button", { name: "Sačuvaj", exact: true }).click();
  await page
    .getByRole("button", { name: "Administracija", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Zajednički cenovnik", exact: true })
    .click();
  await page.getByLabel("Izvor JEČAM", { exact: true }).check();
  await page.getByLabel("Izvor PŠENICA", { exact: true }).check();
  await page
    .getByLabel("Naziv nove serije", { exact: true })
    .fill("TEST zajednički cenovnik 2026");
  await page
    .getByLabel("Razlog nove serije", { exact: true })
    .fill("TEST pregled dve kulture — nije aktuelan cenovnik");
  await page.getByLabel("Cenovnik važi od", { exact: true }).fill("2026-01-01");
  await page.getByLabel("Cenovnik važi do", { exact: true }).fill("2026-12-31");
  await page
    .getByRole("button", { name: "Pripremi izabrane nacrte", exact: true })
    .click();
  await page.locator(".pricing-table").waitFor();
  await page
    .getByLabel("Pretraga zajedničkih stavki")
    .fill("NPK đubrivo 15:15:15");
  assert.equal(await page.locator(".pricing-table tbody tr").count(), 1);
  await page
    .getByLabel("Cena NPK đubrivo 15:15:15", { exact: true })
    .fill("0.5");
  await page
    .getByLabel("Jedinica NPK đubrivo 15:15:15", { exact: true })
    .selectOption("kg");
  await page
    .getByLabel("Potvrđena jedinica NPK đubrivo 15:15:15", { exact: true })
    .check();
  await page
    .getByLabel("Razlog izmene zajedničkih cena")
    .fill("TEST sintetička cena — browser provera");
  await page.getByRole("button", { name: /^Sačuvaj cene u nacrtima/ }).click();
  await page
    .getByText(
      "Cene su sačuvane u 2 nacrta. Normirane količine nisu menjane.",
      { exact: true },
    )
    .waitFor();
  const cells = page.locator(".pricing-table tbody .pricing-cell");
  assert.equal(await cells.count(), 2);
  for (const cell of await cells.all()) {
    assert.match(await cell.innerText(), /300 kg/);
    assert.match(await cell.innerText(), /150 EUR/);
  }
  await page.getByLabel("Pretraga zajedničkih stavki").fill("Seme ·");
  assert.equal(await page.locator(".pricing-table tbody tr").count(), 2);
  await page
    .getByLabel("Pretraga zajedničkih stavki")
    .fill("NPK đubrivo 15:15:15");
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForFunction(() => scrollY === 0);
  await page.screenshot({
    path: "docs/screens/pricing-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(
    () =>
      document.querySelector(".sidebar")!.getBoundingClientRect().right <= 1,
  );
  const scroll = page.getByRole("region", {
    name: "Tabela zajedničkih cena po kulturama",
  });
  await scroll.evaluate((el) => {
    el.scrollLeft = el.scrollWidth;
  });
  const last = page.locator(".pricing-table tbody tr td:last-child");
  const cellBounds = await last.boundingBox(),
    scrollBounds = await scroll.boundingBox();
  assert.ok(
    cellBounds &&
      scrollBounds &&
      cellBounds.x >= scrollBounds.x - 1 &&
      cellBounds.x + cellBounds.width <=
        scrollBounds.x + scrollBounds.width + 1,
    "Kulture nisu dostupne skrolovanjem tabele na telefonu.",
  );
  await scroll.evaluate((el) => {
    el.scrollLeft = 0;
  });
  await page.evaluate(() => window.scrollTo(0, 0));
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    "Mobilna stranica ima horizontalni skrol izvan tabele.",
  );
  await page.screenshot({
    path: "docs/screens/pricing-mobile.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.reload();
  await page
    .getByRole("button", { name: "Administracija", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Zajednički cenovnik", exact: true })
    .click();
  await page
    .getByRole("checkbox", { name: /^Nacrt JEČAM · TEST zajednički/ })
    .check();
  await page
    .getByRole("checkbox", { name: /^Nacrt PŠENICA · TEST zajednički/ })
    .check();
  await page
    .getByRole("button", { name: "Otvori zajedničku tabelu", exact: true })
    .click();
  await page
    .getByLabel("Pretraga zajedničkih stavki")
    .fill("NPK đubrivo 15:15:15");
  assert.equal(
    await page
      .getByLabel("Cena NPK đubrivo 15:15:15", { exact: true })
      .inputValue(),
    "0.5",
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS pricing browser: batch drafts, single price for two cultures, unchanged quantities, distinct seeds, saved price after reload, mobile table without page overflow, no browser errors.",
  );
} finally {
  await browser.close();
}
