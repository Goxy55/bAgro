import assert from "node:assert/strict";
import { chromium } from "@playwright/test";

const base = process.env.INPUTS_E2E_URL || "http://localhost:3500";
const email = process.env.INPUTS_E2E_EMAIL,
  password = process.env.INPUTS_E2E_PASSWORD;
if (!email || !password)
  throw Error(
    "Postavite INPUTS_E2E_EMAIL/PASSWORD za admina u zasebnoj sintetičkoj TEST bazi.",
  );
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } }),
  errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
try {
  await page.goto(base);
  await page.getByLabel("Email adresa", { exact: true }).fill(email);
  await page.getByLabel("Lozinka", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Prijavi se", exact: true }).click();
  await Promise.race([
    page.getByLabel("Naziv gazdinstva", { exact: true }).waitFor(),
    page.getByRole("button", { name: "Administracija", exact: true }).waitFor(),
  ]);
  if (await page.getByLabel("Naziv gazdinstva", { exact: true }).isVisible()) {
    await page
      .getByLabel("Naziv gazdinstva", { exact: true })
      .fill("TEST STIPS inputi — nisu stvarne cene");
    await page.getByLabel("Opština", { exact: true }).fill("TEST mesto");
    await page.getByRole("button", { name: "Sačuvaj", exact: true }).click();
  }
  await page
    .getByRole("button", { name: "Administracija", exact: true })
    .click();
  await page
    .getByRole("button", { name: "STIPS · cene inputa", exact: true })
    .click();
  await page.getByLabel("Pretraga STIPS inputa").fill("TEST NPK");
  await page
    .getByRole("cell", { name: "TEST NPK (15:15:15)", exact: false })
    .waitFor();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: "docs/screens/inputs-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(
    () =>
      document.querySelector(".sidebar")!.getBoundingClientRect().right <= 1,
  );
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  );
  const mobileTable = page.getByRole("region", {
    name: "STIPS cene inputa po mestima",
  });
  await mobileTable.evaluate((el) => {
    el.scrollLeft = el.scrollWidth;
  });
  const sourceBounds = await page
      .locator(".input-price-table tbody td:last-child")
      .boundingBox(),
    regionBounds = await mobileTable.boundingBox();
  assert.ok(
    sourceBounds &&
      regionBounds &&
      sourceBounds.x >= regionBounds.x - 1 &&
      sourceBounds.x + sourceBounds.width <=
        regionBounds.x + regionBounds.width + 1,
    "Izvorne kolone nisu dostupne pomeranjem tabele na telefonu.",
  );
  await mobileTable.evaluate((el) => {
    el.scrollLeft = 0;
  });
  await page.screenshot({
    path: "docs/screens/inputs-mobile.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page
    .getByRole("button", { name: "Zajednički cenovnik", exact: true })
    .click();
  if (!(await page.getByLabel("Izvor JEČAM", { exact: true }).isVisible()))
    await page
      .getByRole("button", { name: "Novi nacrti za više kultura", exact: true })
      .click();
  await page.getByLabel("Izvor JEČAM", { exact: true }).check();
  await page.getByLabel("Izvor PŠENICA", { exact: true }).check();
  await page
    .getByLabel("Naziv nove serije", { exact: true })
    .fill("TEST STIPS reference");
  await page
    .getByLabel("Razlog nove serije", { exact: true })
    .fill("TEST sintetički pregled izvora");
  await page.getByLabel("Cenovnik važi od", { exact: true }).fill("2026-01-01");
  await page.getByLabel("Cenovnik važi do", { exact: true }).fill("2026-12-31");
  await page
    .getByRole("button", { name: "Pripremi izabrane nacrte", exact: true })
    .click();
  await page.locator(".pricing-table").waitFor();
  await page
    .getByLabel("Pretraga zajedničkih stavki")
    .fill("NPK đubrivo 15:15:15");
  await page
    .getByLabel("Jedinica NPK đubrivo 15:15:15", { exact: true })
    .selectOption("kg");
  await page
    .getByLabel("Potvrđena jedinica NPK đubrivo 15:15:15", { exact: true })
    .check();
  await page
    .getByRole("button", { name: "Izaberi STIPS cenu", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    "Izbor cene izlazi iz mobilnog dijaloga.",
  );
  await dialog.getByLabel("Pretraga STIPS inputa").fill("TEST NPK");
  await dialog
    .getByRole("button", { name: "Izaberi cenu", exact: true })
    .first()
    .click();
  await dialog.getByLabel("Količina u osnovi STIPS cene").fill("25");
  await dialog.getByLabel("Datum vrednovanja STIPS cene").fill("2026-09-30");
  await dialog
    .getByLabel("Obrazloženje STIPS cene")
    .fill("TEST: potvrđen sintetički proizvod i cena za celo pakovanje 25 kg.");
  await dialog
    .getByLabel("Proverio/la sam da proizvod", { exact: false })
    .check();
  await dialog.getByLabel("Proverio/la sam izvor", { exact: false }).check();
  await dialog
    .getByRole("button", { name: "Prenesi izabranu cenu u unos", exact: true })
    .click();
  await dialog.waitFor({ state: "hidden" });
  await page.setViewportSize({ width: 1440, height: 1050 });
  assert.equal(
    await page
      .getByLabel("Cena NPK đubrivo 15:15:15", { exact: true })
      .inputValue(),
    "100",
  );
  assert.equal(
    await page
      .getByLabel("Valuta NPK đubrivo 15:15:15", { exact: true })
      .inputValue(),
    "RSD",
  );
  await page
    .getByLabel("Razlog izmene zajedničkih cena")
    .fill("TEST sačuvan izvor i kurs izvornog meseca");
  await page.getByRole("button", { name: /^Sačuvaj cene u nacrtima/ }).click();
  await page
    .getByText(
      "Cene su sačuvane u 2 nacrta. Normirane količine nisu menjane.",
      { exact: true },
    )
    .waitFor();
  for (const cell of await page
    .locator(".pricing-table tbody .pricing-cell")
    .all())
    assert.match(await cell.innerText(), /300 EUR/);
  await page.locator(".pricing-table summary").click();
  assert.match(
    await page.locator(".pricing-table tbody").innerText(),
    /STIPS: TEST NPK/,
  );
  assert.match(
    await page.locator(".pricing-table tbody").innerText(),
    /2026-09/,
  );
  await page
    .getByRole("button", { name: "Izaberi STIPS cenu", exact: true })
    .click();
  await page.getByRole("dialog").press("Escape");
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  assert.deepEqual(errors, []);
  console.log(
    "Browser: arhiva inputa, 390px, eksplicitan delilac, kurs izvornog meseca, dva nacrta, sačuvan izvor i Escape — prolaze; bez pageerror-a.",
  );
} finally {
  await browser.close();
}
