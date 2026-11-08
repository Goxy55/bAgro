import "dotenv/config";
import express from "express";
import { app } from "./app.js";
import { importSource } from "./importer.js";
import { closeDatabase, transaction } from "./db.js";
import { reconcileDraftRates } from "./pricing/rates.js";
import { createServer } from "vite";
import { startStipsScheduler } from "./stips/crawler.js";
import { startAuditRetention } from "./audit-retention.js";
await importSource();
const { interruptPreparations } = await import("./pricing/preparation.js");
await interruptPreparations();
await transaction((tx) => reconcileDraftRates(tx, "operator:startup"));
const stopStipsScheduler = startStipsScheduler();
const stopAuditRetention = startAuditRetention();
const port = Number(process.env.PORT || 3000);
app.use((req, res, next) => {
  if (
    /^\/(?:data|source|server|scripts|tests|migrations)(?:\/|$)|^\/\.(?:env|git|aws|codex)/i.test(
      req.path,
    )
  )
    return res.sendStatus(404);
  next();
});
if (process.env.NODE_ENV === "production") {
  app.use(
    express.static("dist", {
      index: false,
      setHeaders(res, file) {
        // Vite imenuje fajlove po sadržaju, pa su u /assets/ nepromenljivi.
        if (/[\\/]assets[\\/]/.test(file))
          res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      },
    }),
  );
  app.get("*splat", (_req, res) =>
    res.sendFile("index.html", { root: "dist" }),
  );
} else {
  const vite = await createServer({
    server: { middlewareMode: true },
    appType: "spa",
  });
  app.use(vite.middlewares);
}
const server = app.listen(port, "0.0.0.0", () =>
  console.log(`Agro portal server listening on port ${port}`),
);
let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal}: zatvaranje servera.`);
  // Tvrdi rok: Render šalje SIGKILL posle maxShutdownDelaySeconds (60 s).
  const hardExit = setTimeout(() => {
    console.error("Zatvaranje nije završeno na vreme; prekid procesa.");
    process.exit(1);
  }, 40000);
  hardExit.unref();
  stopStipsScheduler();
  stopAuditRetention();
  // Prekini neaktivne keep-alive veze odmah, a aktivnim zahtevima daj 25 s.
  server.closeIdleConnections();
  const forceClose = setTimeout(() => server.closeAllConnections(), 25000);
  forceClose.unref();
  try {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    clearTimeout(forceClose);
    await closeDatabase();
    process.exit(0);
  } catch (e) {
    console.error("Greška pri zatvaranju:", e);
    process.exit(1);
  }
}
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.on(signal, () => void shutdown(signal));
