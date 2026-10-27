import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(process.env.E2E_URL || "http://localhost:3100");
await page
  .getByRole("button", { name: "Nemate nalog? Registrujte se" })
  .click();
await page.getByLabel("Ime i prezime").fill("TEST korisnik");
await page.getByLabel("Email adresa").fill(`e2e-${Date.now()}@test.local`);
await page
  .getByLabel("Lozinka", { exact: false })
  .fill("Test-only-password-2026!");
await page.getByRole("button", { name: "Kreiraj nalog" }).click();
await page.getByLabel("Naziv gazdinstva").fill("TEST Gazdinstvo · browser");
await page.getByLabel("Opština").fill("Novi Sad");
await page.getByRole("button", { name: "Sačuvaj", exact: true }).click();
await page
  .getByRole("heading", { name: "Dobro došli na svoje gazdinstvo." })
  .waitFor();
await page
  .getByRole("button", { name: "Dodaj proizvodnju", exact: true })
  .first()
  .click();
const modal = page.getByRole("dialog");
await modal.getByLabel("Naziv vaše proizvodnje").fill("TEST Ječam 2026");
await modal.getByLabel("Ostvarena korišćena površina").fill("2.5");
await modal.getByLabel("Ostvarena količina proizvoda").fill("2500");
await modal.getByLabel("Status unosa").selectOption("final");
await modal.getByRole("button", { name: "Sačuvaj proizvodnju" }).click();
await page.getByText("TEST Ječam 2026").first().waitFor();
await page.screenshot({ path: "docs/screens/desktop.png", fullPage: true });
await page
  .getByRole("button", { name: "Prodaja i troškovi", exact: true })
  .click();
await page.getByRole("button", { name: "Novi događaj" }).click();
const em = page.getByRole("dialog");
await em
  .getByLabel("Proizvodnja", { exact: false })
  .selectOption({ label: "TEST Ječam 2026" });
await em.getByLabel("Opis / vrsta").fill("TEST prodaja bez kursa");
await em.getByLabel("Količina", { exact: true }).fill("100");
await em.getByLabel("Ukupan iznos").fill("10000");
await em.getByLabel("Status", { exact: true }).selectOption("draft");
await em.getByRole("button", { name: "Sačuvaj", exact: true }).click();
await page.getByText("TEST prodaja bez kursa", { exact: true }).waitFor();
await page.getByRole("button", { name: "Dopuni nacrt" }).click();
assert.equal(
  await page.getByRole("dialog").getByLabel("Ukupan iznos").inputValue(),
  "10000",
);
await page.getByRole("button", { name: "Zatvori", exact: true }).click();
await page.getByRole("button", { name: "Tržište Srbije", exact: true }).click();
await page
  .getByRole("heading", { name: "Nema potvrđenih podataka", exact: true })
  .waitFor();
await page.setViewportSize({ width: 390, height: 844 });
await page.getByRole("button", { name: "Navigacija" }).click();
await page
  .getByRole("button", { name: "Pregled gazdinstva", exact: true })
  .click();
await page
  .getByRole("heading", { name: "Dobro došli na svoje gazdinstvo." })
  .waitFor();
assert.ok(
  await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  "Horizontalni skrol stranice",
);
await page.screenshot({ path: "docs/screens/mobile.png", fullPage: true });
await page.reload();
await page
  .getByRole("heading", { name: "Dobro došli na svoje gazdinstvo." })
  .waitFor();
assert.equal(errors.length, 0, errors.join("\n"));
await browser.close();
console.log(
  "PASS: registracija, profil farme, proizvodnja, nacrt prodaje i dopuna, tržište bez podataka, sesija posle reload-a, telefon bez horizontalnog skrola; nema browser grešaka.",
);
