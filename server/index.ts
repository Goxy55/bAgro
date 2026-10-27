import "dotenv/config";
import express from "express";
import { app } from "./app.js";
import { importSource } from "./importer.js";
import { closeDatabase } from "./db.js";
import { createServer } from "vite";
import { startStipsScheduler } from "./stips/crawler.js";
await importSource();
const stopStipsScheduler = startStipsScheduler();
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
  app.use(express.static("dist", { index: false }));
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
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.on(signal, () =>
    server.close(async () => {
      stopStipsScheduler();
      await closeDatabase();
      process.exit(0);
    }),
  );
