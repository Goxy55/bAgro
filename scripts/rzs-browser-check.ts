import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";
const base = process.env.RZS_E2E_URL || "http://localhost:3501",
  email = process.env.RZS_E2E_EMAIL,
  password = process.env.RZS_E2E_PASSWORD;
if (!email || !password)
  throw Error(
    "Postavite RZS_E2E_EMAIL/PASSWORD za TEST nalog u zasebnoj bazi sa proverenim javnim RZS podacima.",
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
  await expect
    .poll(
      async () => {
        try {
          return (
            await page.request.get(base + "/healthz", { timeout: 1000 })
          ).ok();
        } catch {
          return false;
        }
      },
      { timeout: 20000 },
    )
    .toBe(true);
  await page.goto(base);
  await page.getByLabel("Email adresa", { exact: true }).fill(email);
  await page.getByLabel("Lozinka", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Prijavi se", exact: true }).click();
  await Promise.race([
    page.getByLabel("Naziv gazdinstva", { exact: true }).waitFor(),
    page.getByRole("button", { name: "Tržište Srbije", exact: true }).waitFor(),
  ]);
  if (await page.getByLabel("Naziv gazdinstva", { exact: true }).isVisible()) {
    await page
      .getByLabel("Naziv gazdinstva", { exact: true })
      .fill("TEST izolovana provera — javni RZS podaci");
    await page.getByLabel("Opština", { exact: true }).fill("TEST mesto");
    await page.getByRole("button", { name: "Sačuvaj", exact: true }).click();
  }
  await page
    .getByRole("button", { name: "Tržište Srbije", exact: true })
    .click();
  await page.getByLabel("Proizvod", { exact: true }).selectOption("Pšenica");
  await page
    .getByRole("heading", { name: "Pšenica · Proizvodnja", exact: true })
    .waitFor();
  assert.equal(await page.locator(".stat-chart").count(), 3);
  await page
    .getByRole("cell", { name: /Objava: nije navedena/ })
    .first()
    .waitFor();
  const text = await page.locator("main").innerText();
  assert.match(text, /2021/);
  assert.match(text, /2025/);
  assert.match(text, /2026/);
  assert.match(text, /2026-09-25/);
  assert.match(text, /prethodan/);
  assert.ok(!text.includes("null"));
  for (const chart of await page.locator(".stat-chart").all())
    assert.equal(await chart.locator(":scope > div").count(), 5);
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({
    path: "docs/screens/rzs-desktop.png",
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
  await page.screenshot({
    path: "docs/screens/rzs-mobile.png",
    fullPage: true,
  });
  await page.getByLabel("Proizvod", { exact: true }).selectOption("Goveda");
  await page
    .getByRole("heading", {
      name: "Goveda · Broj grla na početku godine",
      exact: true,
    })
    .waitFor();
  assert.equal(await page.locator(".stat-chart").count(), 7);
  assert.match(await page.locator("main").innerText(), /hiljada grla/);
  assert.equal(
    await page.getByText(/Tekuća nepotpuna godina je odvojena:/).count(),
    0,
  );
  assert.deepEqual(errors, []);
  console.log(
    "RZS browser: izbor proizvoda, godišnji pokazatelji i jedinice, nepoznata objava, ažuriranje skupa, 2026 odvojeno, 390px bez spoljnog skrola; bez pageerror-a.",
  );
} finally {
  await browser.close();
}
