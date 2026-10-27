import { readFile } from "node:fs/promises";
import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
const base = process.env.STIPS_E2E_URL || "http://localhost:3200";
const email = process.env.STIPS_E2E_EMAIL,
  password = process.env.STIPS_E2E_PASSWORD;
if (!email || !password)
  throw Error(
    "Postavite STIPS_E2E_EMAIL i STIPS_E2E_PASSWORD za admin TEST nalog u odvojenoj test bazi.",
  );
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox"],
});
const stamp = String(Date.now()),
  place = "TEST Beograd " + stamp;
const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } }),
  errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
try {
  await page.goto(base);
  await page.getByLabel("Email adresa").fill(email);
  await page.getByLabel("Lozinka", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Prijavi se", exact: true }).click();
  await page.waitForFunction(
    () =>
      document.body.textContent?.includes("Naziv gazdinstva") ||
      document.body.textContent?.includes("Pregled gazdinstva"),
  );
  if (await page.getByLabel("Naziv gazdinstva", { exact: true }).count()) {
    await page
      .getByLabel("Naziv gazdinstva", { exact: true })
      .fill("TEST STIPS — browser");
    await page.getByLabel("Opština", { exact: true }).fill("TEST mesto");
    await page.getByRole("button", { name: "Sačuvaj", exact: true }).click();
  }
  await page
    .getByRole("button", { name: "Administracija", exact: true })
    .click();
  await page
    .getByRole("button", { name: "STIPS bilteni", exact: true })
    .click();
  await page.getByRole("button", { name: "Uvezi bilten", exact: true }).click();
  await page
    .getByLabel("PDF ili sačuvana HTML stranica (do 8 MB, PDF do 40 strana)")
    .setInputFiles({
      name: "TEST-fixture.html",
      mimeType: "text/html",
      buffer: Buffer.concat([
        await readFile("tests/fixtures/stips-synthetic.html"),
        Buffer.from("<!-- TEST " + stamp + " -->"),
      ]),
    });
  await page
    .getByLabel("Naslov biltena", { exact: true })
    .fill("TEST bilten — sintetičke cene " + stamp);
  await page
    .getByLabel("Zvanična STIPS adresa izvornog dokumenta")
    .fill("https://www.stips.minpolj.gov.rs/TEST-browser-fixture.html");
  await page.getByLabel("Datum objave biltena").fill("2026-10-19");
  await page.getByLabel("Cene se odnose na period od").fill("2026-10-12");
  await page.getByLabel("Cene se odnose na period do").fill("2026-10-18");
  await page
    .getByLabel("Provereni uslovi korišćenja / osnov preuzimanja")
    .fill("TEST — lokalna sintetička datoteka, nije stvaran STIPS podatak.");
  await page
    .getByLabel(
      "Potvrđujem da sam proverio uslove preuzimanja i ponovne upotrebe",
    )
    .check();
  await page
    .getByRole("button", { name: "Izdvoji podatke i sačuvaj nacrt" })
    .click();
  await page
    .getByRole("heading", {
      name: "TEST bilten — sintetičke cene " + stamp,
      exact: true,
    })
    .waitFor();
  await page
    .getByText("Pregled tabela i mapiranje kolona na mesta", { exact: true })
    .click();
  await page.getByLabel("Kolona proizvoda", { exact: true }).selectOption("0");
  await page.getByLabel("Kolona jedinice", { exact: true }).selectOption("1");
  await page.getByLabel("Valuta ove tabele").selectOption("RSD");
  await page.getByLabel("Vrsta cene ove tabele").selectOption("veleprodajna");
  await page.getByLabel("Kolona 3 · TEST Beograd", { exact: true }).check();
  await page.getByLabel("Mesto za kolonu 3").fill(place);
  await page.getByLabel("Tržište / obuhvat za kolonu 3").fill("TEST kvantaš");
  await page
    .getByRole("button", { name: "Napravi predloge po mestima" })
    .click();
  await page
    .getByRole("button", { name: "Pregledaj red", exact: true })
    .first()
    .click();
  await page
    .getByLabel("Razlog izmene / odobrenja", { exact: true })
    .fill("TEST browser — poređenje sa sintetičkim originalom");
  await page
    .getByRole("button", { name: "Odobri i objavi cenu", exact: true })
    .click();
  await page.getByText("Objavljeno · rev. 1", { exact: true }).waitFor();
  await page.screenshot({
    path: "docs/screens/stips-admin.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Tržište Srbije", exact: true })
    .click();
  await page
    .getByRole("button", { name: "STIPS · lokalne cene", exact: true })
    .click();
  await page
    .getByLabel("Mesto / područje", { exact: true })
    .selectOption(place);
  await page.getByText("100,5 RSD/kg", { exact: true }).waitFor();
  await page.locator("tbody tr").filter({ hasText: place }).waitFor();
  await page.screenshot({
    path: "docs/screens/stips-market.png",
    fullPage: true,
  });
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Preuzmi izvornu kopiju" })
    .first()
    .click();
  assert.ok((await download).suggestedFilename().endsWith(".html"));
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    "Mobilna stranica ima horizontalni skrol",
  );
  await page.screenshot({
    path: "docs/screens/stips-mobile.png",
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  console.log(
    "PASS STIPS browser: prijava admina, uvoz, mapiranje, pregled, eksplicitna objava, lokalno tržište, preuzimanje HTML originala, telefon bez skrola; bez browser grešaka.",
  );
} finally {
  await browser.close();
}
