import test from "node:test";
import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import { rateLimit } from "../server/rate-limit.js";

function run(limit: ReturnType<typeof rateLimit>, user = "u1") {
  let status = 200;
  const headers: Record<string, string> = {};
  const res: any = {
    setHeader: (k: string, v: string) => (headers[k] = v),
    status(c: number) {
      status = c;
      return this;
    },
    json() {},
  };
  limit({ user: { id: user }, ip: "1.1.1.1" } as any, res, () => {});
  return { status, headers };
}

test("Rate limit: prozor, po korisniku, reset", () => {
  let t = 0;
  const limit = rateLimit({ windowMs: 1000, max: 2, now: () => t });
  assert.equal(run(limit).status, 200);
  assert.equal(run(limit).status, 200);
  const blocked = run(limit);
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers["Retry-After"]) >= 1);
  assert.equal(run(limit, "u2").status, 200);
  t = 1001;
  assert.equal(run(limit).status, 200);
});

test("Migracije se čitaju iz direktorijuma i imenovane su po redu", async () => {
  const files = (await readdir(new URL("../migrations/", import.meta.url)))
    .filter((f) => f.endsWith(".sql"))
    .sort();
  files.forEach((f, i) =>
    assert.ok(f.startsWith(String(i + 1).padStart(3, "0") + "_"), f),
  );
});
