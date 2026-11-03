import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import express from "express";
import { chromium } from "@playwright/test";
// TEST only: original schedules with synthetic 1 RSD input prices, in an isolated database.
const directory = await mkdtemp("/tmp/agro-monthly-browser-TEST-"),
  port = 3724,
  base = `http://localhost:${port}`;
process.env.DATABASE_URL = "";
process.env.DATA_DIR = directory + "/pg";
process.env.APP_URL = base;
process.env.BETTER_AUTH_SECRET =
  "TEST-monthly-browser-secret-012345678901234567";
const { app } = await import("../server/app.js");
const { db, closeDatabase } = await import("../server/db.js");
const { auth } = await import("../server/auth.js");
const { importSource } = await import("../server/importer.js");
await importSource();
const email = "admin@monthly-browser.test",
  password = "TEST-monthly-browser-password!";
const account = await auth.api.signUpEmail({
  body: { email, password, name: "TEST mesečna ulaganja" },
});
await db.query("INSERT INTO app_admins VALUES($1)", [account.user.id]);
const farmId = randomUUID();
await db.query(
  "INSERT INTO farms(id,name,municipality,year,currency,owner_id) VALUES($1,'TEST mesečna ulaganja','TEST',2026,'RSD',$2)",
  [farmId, account.user.id],
);
await db.query(
  "INSERT INTO memberships(farm_id,user_id,role) VALUES($1,$2,'owner')",
  [farmId, account.user.id],
);
const inventory = JSON.parse(await readFile("source/inventory.json", "utf8"));
for (const templateId of ["s0-B36", "s0-B103", "s0-B243", "s0-B206"]) {
  const m = structuredClone(
    inventory.cards.find((c: any) => c.id === templateId),
  );
  m.currency = "RSD";
  m.reviewed = true;
  const chosen = new Set();
  for (const i of m.items) {
    i.price = "1";
    i.unit = "kg";
    i.unitConfirmed = true;
    i.alternativeConfirmed = true;
    if (i.alternativeGroup && Number(i.quantity) > 0) {
      if (chosen.has(i.alternativeGroup) || i.id === "F54") {
        i.included = false;
        i.exclusionReason = "TEST jedne alternative";
      } else chosen.add(i.alternativeGroup);
    }
  }
  await db.query(
    "INSERT INTO norm_versions(id,template_id,name,status,valid_from,valid_to,author,reason,model) VALUES($1,$2,'TEST normativ 1 RSD','active','2026-01-01','2026-12-31',$3,'TEST sintetičke cene',$4)",
    [randomUUID(), templateId, account.user.id, JSON.stringify(m)],
  );
  const details = {
    scale: "2.5",
    scaleUnit: "ha",
    start: "2026-01-01",
    end: "2026-12-31",
    cultivationStatus: "growing",
  };
  await db.query(
    "INSERT INTO production_periods(id,farm_id,template_id,name,year,status,details) VALUES($1,$2,$3,$4,2026,'draft',$5)",
    [
      randomUUID(),
      farmId,
      templateId,
      "TEST " + m.name,
      JSON.stringify(details),
    ],
  );
}
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
try {
  await page.goto(base);
  await page.getByLabel("Email adresa", { exact: true }).fill(email);
  await page.getByLabel("Lozinka", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Prijavi se", exact: true }).click();
  await page
    .getByRole("button", { name: "Zalihe na parceli", exact: true })
    .click();
  await page
    .getByRole("heading", {
      name: "Normativno ulaganje i zalihe u zemlji",
      exact: true,
    })
    .waitFor();
  assert.equal(
    await page
      .getByText(
        "Administrator treba jednom da potvrdi pravila mesečnog rasporeda.",
        { exact: true },
      )
      .count(),
    0,
  );
  await page
    .getByLabel("Mesec pregleda — zaključno", { exact: true })
    .fill("2026-05");
  const wheat = page.locator(".monthly-production").filter({
    has: page.locator("summary strong", { hasText: "TEST PŠENICA" }),
  });
  await wheat.locator("summary").click();
  await page.getByText("2.049,18 RSD").first().waitFor();
  const monthly = wheat.getByRole("region", {
    name: "Mesečni pregled TEST PŠENICA",
    exact: true,
  });
  assert.match(await monthly.innerText(), /2025-10/);
  assert.match(await monthly.innerText(), /1.533,15/);
  assert.match(await monthly.innerText(), /2.049,18/);
  const detail = wheat.getByRole("region", {
    name: "Redovi troškovnika TEST PŠENICA",
    exact: true,
  });
  assert.match(await detail.innerText(), /Duet ultra/);
  assert.match(await detail.innerText(), /2026-05/);
  await page
    .getByRole("button", { name: "Sačuvaj mesečni obračun", exact: true })
    .click();
  await page
    .getByRole("status")
    .filter({ hasText: "Mesečni obračun je sačuvan" })
    .waitFor();
  const downloadWait = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Excel mesečnog ulaganja", exact: true })
    .click();
  const download = await downloadWait;
  assert.match(download.suggestedFilename(), /\.xlsx$/);
  await mkdir("docs/screens", { recursive: true });
  await page.screenshot({
    path: "docs/screens/monthly-wip-desktop.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await monthly.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    "Mesečna tabela i oba iznosa moraju stati na ekran telefona",
  );
  await page.screenshot({
    path: "docs/screens/monthly-wip-mobile.png",
    fullPage: true,
    animations: "disabled",
  });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  );
  await detail.evaluate((el) => {
    el.scrollLeft = el.scrollWidth;
  });
  assert.ok(await detail.evaluate((el) => el.scrollLeft > 0));
  await page
    .getByLabel("Mesec pregleda — zaključno", { exact: true })
    .fill("2025-10");
  await wheat.locator("summary").filter({ hasText: "1.533,15 RSD" }).waitFor();
  await page
    .getByLabel("Mesec pregleda — zaključno", { exact: true })
    .fill("2026-07");
  await wheat.locator("summary").filter({ hasText: "2.134,18 RSD" }).waitFor();
  await wheat
    .getByLabel("Stanje proizvodnje TEST PŠENICA", { exact: true })
    .selectOption("completed");
  await wheat.locator('input[name="completedOn"]').fill("2026-07-20");
  await wheat
    .getByRole("button", { name: "Sačuvaj stanje proizvodnje", exact: true })
    .click();
  await wheat
    .locator("summary")
    .filter({ hasText: "Zaliha u zemlji: 0,00 RSD" })
    .waitFor();
  await page.reload();
  await page.getByRole("button", { name: "Navigacija", exact: true }).click();
  await page
    .getByRole("button", { name: "Zalihe na parceli", exact: true })
    .click();
  await page
    .getByLabel("Mesec pregleda — zaključno", { exact: true })
    .fill("2026-07");
  await wheat
    .locator("summary")
    .filter({ hasText: "Zaliha u zemlji: 0,00 RSD" })
    .waitFor();
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int AS n FROM wip_snapshots WHERE farm_id=$1",
        [farmId],
      )
    ).rows[0].n,
    1,
  );
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int AS n FROM payments WHERE farm_id=$1",
        [farmId],
      )
    ).rows[0].n,
    0,
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS: potvrđena početna pravila, četiri kulture, prethodna jesen, mesečni i kumulativni iznosi, snapshot, XLSX, zatvaranje zalihe bez gubitka istorije, reload i telefon 390 px bez JS grešaka.",
  );
} catch (e) {
  console.error((e as Error).message);
  console.error((await page.locator("body").innerText()).slice(0, 6000));
  await page.screenshot({
    path: "/tmp/agro-monthly-browser-failure.png",
    fullPage: true,
    animations: "disabled",
  });
  throw e;
} finally {
  await browser.close();
  server.closeAllConnections();
  await new Promise<void>((r) => server.close(() => r()));
  await closeDatabase();
  await rm(directory, { recursive: true, force: true });
}
