import assert from "node:assert/strict";
import { chromium } from "@playwright/test";

// Use an isolated TEST database with a marked fixture: NPK 25 kg = 2500 RSD,
// Beograd, September 2026, synthetic FX 100 RSD/EUR on 2026-09-30.
const base = process.env.SUGGESTIONS_E2E_URL || "http://localhost:3700",
  email = process.env.SUGGESTIONS_E2E_EMAIL,
  password = process.env.SUGGESTIONS_E2E_PASSWORD;
if (!email || !password)
  throw Error(
    "Postavite SUGGESTIONS_E2E_EMAIL/PASSWORD za zasebnu TEST bazu, nikad za poslovnu bazu.",
  );
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1080 } }),
  errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
try {
  let healthy = false;
  for (let i = 0; i < 120; i++) {
    try {
      if (
        (await fetch(base + "/healthz", { signal: AbortSignal.timeout(1000) }))
          .ok
      ) {
        healthy = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  assert.ok(healthy, "Zasebni TEST server nije spreman.");
  await page.goto(base);
  await page.getByLabel("Email adresa", { exact: true }).fill(email);
  await page.getByLabel("Lozinka", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Prijavi se", exact: true }).click();
  await page
    .getByLabel("Naziv gazdinstva", { exact: true })
    .fill("TEST grupne STIPS reference — sintetički podaci");
  await page.getByLabel("Opština", { exact: true }).fill("TEST mesto");
  await page.getByRole("button", { name: "Sačuvaj", exact: true }).click();
  await page
    .getByRole("button", { name: "Administracija", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Popuni cenovnik iz STIPS-a", exact: true })
    .click();
  await page.locator(".legacy-pricing > summary").click();
  await page
    .getByRole("heading", { name: "Popuni cene iz STIPS-a", exact: true })
    .waitFor();
  await page.getByLabel("Izvor JEČAM", { exact: true }).check();
  await page.getByLabel("Izvor PŠENICA", { exact: true }).check();
  await page
    .getByLabel("Naziv nove serije", { exact: true })
    .fill("TEST STIPS grupna primena");
  await page
    .getByLabel("Razlog nove serije", { exact: true })
    .fill("TEST: nije važeći poslovni cenovnik");
  await page.getByLabel("Cenovnik važi od", { exact: true }).fill("2026-01-01");
  await page.getByLabel("Cenovnik važi do", { exact: true }).fill("2026-12-31");
  await page
    .getByRole("button", { name: "Pripremi izabrane nacrte", exact: true })
    .click();
  const row = page
    .locator(".suggestions-table tbody tr")
    .filter({ hasText: "NPK đubrivo 15:15:15" });
  await row.waitFor();
  assert.match(await row.innerText(), /100 RSD\/kg/);
  assert.match(await row.innerText(), /25kg/);
  assert.equal(
    await page.getByLabel("Referentno mesto STIPS cena").inputValue(),
    "Beograd",
  );
  assert.equal(
    await page.locator(".pricing-manual").evaluate((el: any) => el.open),
    false,
  );
  assert.equal(
    await page
      .getByRole("button", { name: /^Primeni referentne cene u cenovniku/ })
      .isDisabled(),
    true,
  );
  await page.screenshot({
    path: "docs/screens/stips-suggestions-desktop.png",
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
    "Stranica prelazi širinu telefona.",
  );
  const region = page.getByRole("region", {
    name: "STIPS predlozi cena po vrstama troška",
  });
  await region.evaluate((el) => {
    el.scrollLeft = el.scrollWidth;
  });
  const bounds = await region.boundingBox(),
    last = await row.locator("td:last-child").boundingBox();
  assert.ok(
    bounds &&
      last &&
      last.x >= bounds.x - 1 &&
      last.x + last.width <= bounds.x + bounds.width + 1,
    "Poslednja kolona nije dostupna na telefonu.",
  );
  await region.evaluate((el) => {
    el.scrollLeft = 0;
  });
  await page.screenshot({
    path: "docs/screens/stips-suggestions-mobile.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1080 });
  await page.getByLabel("Potvrđujem referentne proizvode i osnovu cene").check();
  const saved = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/admin/pricing/table") &&
      r.request().method() === "PUT",
  );
  await page
    .getByRole("button", { name: /^Primeni referentne cene u cenovniku/ })
    .click();
  const response = await saved;
  assert.equal(response.status(), 200);
  const data = await response.json();
  assert.equal(data.changedVersions, 2);
  const npk = data.table.rows.find(
    (r: any) => r.name === "NPK đubrivo 15:15:15",
  );
  assert.equal(npk.priceEur, "1");
  assert.equal(npk.occurrences.length, 2);
  assert.ok(
    npk.occurrences.every(
      (o: any) =>
        o.priceEur === "1" &&
        o.unitConfirmed &&
        o.lastInput.reference.place === "Beograd",
    ),
  );
  await page
    .getByText(
      "Cene su sačuvane u 2 nacrta. Normirane količine nisu menjane.",
      { exact: true },
    )
    .waitFor();
  await page.getByRole("button", { name: /^Već popunjene/ }).click();
  await row.getByText("1 EUR/kg", { exact: true }).waitFor();
  await page.reload();
  await page
    .getByRole("button", { name: "Administracija", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Zajednički cenovnik", exact: true })
    .click();
  await page.locator(".legacy-pricing > summary").click();
  for (const input of await page
    .locator(".pricing-drafts input[type=checkbox]")
    .all())
    await input.check();
  await page
    .getByRole("button", { name: "Otvori zajedničku tabelu", exact: true })
    .click();
  await row.getByText("1 EUR/kg", { exact: true }).waitFor();
  const repeated = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/admin/pricing/stips-suggestions") &&
      r.request().postDataJSON()?.includeExisting === true,
  );
  await page.getByLabel("Ponudi zamenu postojećih cena").check();
  const remembered = await (await repeated).json();
  assert.equal(
    remembered.rows.find((r: any) => r.name === "NPK đubrivo 15:15:15")
      .candidates[0].match,
    "approved",
  );
  await row
    .getByText("Zapamćena veza proizvoda i pakovanja", { exact: true })
    .waitFor();
  assert.equal(
    await page
      .getByLabel("Potvrđujem referentne proizvode i osnovu cene")
      .isChecked(),
    false,
  );
  // A second application of the same material is still one price decision.
  const versions = (await (await page.request.get(base + "/api/admin")).json())
    .versions;
  for (const column of data.table.versions) {
    const v = versions.find((v: any) => v.id === column.id),
      model = structuredClone(v.model),
      original = model.items.find(
        (i: any) => i.name === "NPK đubrivo 15:15:15",
      );
    model.items.push({
      ...original,
      id: "TEST-second-application",
      name: "NPK đubrivo 15:15:15 - 1 put",
      quantity: "10",
      price: null,
      priceInput: null,
    });
    const update = await page.request.put(
      base + "/api/admin/versions/" + v.id,
      {
        headers: { Origin: base },
        data: {
          model,
          revision: v.revision,
          reason: "TEST ponovljena primena istog materijala",
        },
      },
    );
    assert.equal(update.status(), 200);
  }
  await page
    .getByRole("button", { name: "Otvori zajedničku tabelu", exact: true })
    .click();
  await page.getByLabel("Ponudi zamenu postojećih cena").check();
  await row.getByText("Izvornih stavki: 2", { exact: true }).waitFor();
  assert.equal(
    await page
      .locator(".suggestions-table tbody tr")
      .filter({ hasText: "NPK đubrivo 15:15:15" })
      .count(),
    1,
  );
  await row.getByText("Osnova pakovanja", { exact: true }).click();
  await page
    .getByLabel("Osnova STIPS cene za NPK đubrivo 15:15:15", { exact: true })
    .fill("50");
  await page.getByLabel("Potvrđujem referentne proizvode i osnovu cene").check();
  const groupedSave = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/admin/pricing/table") &&
      r.request().method() === "PUT",
  );
  await page
    .getByRole("button", { name: /^Primeni referentne cene u cenovniku/ })
    .click();
  const groupedResponse = await groupedSave;
  assert.equal(groupedResponse.status(), 200);
  const groupedData = await groupedResponse.json();
  assert.equal(groupedResponse.request().postDataJSON().rows.length, 2);
  assert.ok(
    groupedData.table.rows
      .filter((r: any) => r.name.startsWith("NPK đubrivo 15:15:15"))
      .every((r: any) => r.priceEur === "0.5"),
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS: automatski predlog i pakovanje, jedna potvrda / dve kulture, RSD/EUR, čuvanje i reload, zapamćena veza, telefon bez skrola stranice i bez pageerror-a.",
  );
} finally {
  await browser.close();
}
