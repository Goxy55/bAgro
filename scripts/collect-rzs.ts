import { fetch, EnvHttpProxyAgent } from "undici";
import { load } from "cheerio";
import robotsParser from "robots-parser";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";
const args = process.argv.slice(2),
  outIndex = args.indexOf("--out");
if (outIndex >= 0 && !args[outIndex + 1])
  throw Error("Posle --out navedite direktorijum.");
const out = resolve(outIndex >= 0 ? args[outIndex + 1] : "data/rzs"),
  root = "https://opendata.stat.gov.rs",
  catalogUrl = root + "/odata/",
  agent = "AgroPortal-RZS/1.0";
const selected = [
  "130102IND01",
  "1302020101IND01",
  "13020201040401IND01",
  "03020201IND02",
  "03020202IND01",
  "03020203IND01",
];
await mkdir(resolve(out, "originali"), { recursive: true, mode: 0o700 });
const dispatcher = new EnvHttpProxyAgent();
let last = 0,
  delay = 1000,
  policy: ReturnType<typeof robotsParser> | undefined;
function official(input: string) {
  const u = new URL(input);
  if (
    u.protocol !== "https:" ||
    u.hostname !== "opendata.stat.gov.rs" ||
    u.username ||
    u.password ||
    u.port
  )
    throw Error("Dozvoljen je samo zvanični RZS HTTPS izvor.");
  return u.href;
}
async function atomic(name: string, bytes: Buffer | string) {
  const file = resolve(out, name),
    tmp = file + "." + randomUUID() + ".tmp";
  await writeFile(tmp, bytes, { mode: 0o600 });
  await rename(tmp, file);
}
async function retrieve(input: string, limit: number) {
  let target = official(input);
  for (let hop = 0; hop < 4; hop++) {
    if (policy && policy.isAllowed(target, agent) === false)
      throw Error("robots.txt zabranjuje izabranu putanju.");
    const remaining = delay - (Date.now() - last);
    if (remaining > 0) await new Promise((r) => setTimeout(r, remaining));
    last = Date.now();
    const r = await fetch(target, {
      dispatcher,
      redirect: "manual",
      signal: AbortSignal.timeout(60000),
      headers: {
        "User-Agent": agent,
        Accept: "application/json,text/html,text/plain;q=0.8",
      },
    });
    if ([301, 302, 303, 307, 308].includes(r.status)) {
      const location = r.headers.get("location");
      await r.body?.cancel();
      if (!location) throw Error("Preusmerenje nema odredište.");
      target = official(new URL(location, target).href);
      continue;
    }
    if (r.status !== 200) {
      await r.body?.cancel();
      if (r.status === 404 && target === root + "/robots.txt")
        return {
          url: target,
          bytes: Buffer.alloc(0),
          type: "text/plain",
          status: 404,
        };
      throw Error(`RZS HTTP ${r.status}; prethodni izvod je sačuvan.`);
    }
    if (Number(r.headers.get("content-length") || 0) > limit) {
      await r.body?.cancel();
      throw Error("RZS odgovor je prevelik.");
    }
    const chunks: Uint8Array[] = [];
    let size = 0;
    for await (const c of r.body!) {
      size += c.length;
      if (size > limit) throw Error("RZS odgovor je prevelik.");
      chunks.push(c);
    }
    return {
      url: target,
      bytes: Buffer.concat(chunks),
      type: r.headers.get("content-type") || "",
      status: r.status,
    };
  }
  throw Error("Previše RZS preusmerenja.");
}
try {
  const robots = await retrieve(root + "/robots.txt", 128 * 1024);
  policy = robotsParser(root + "/robots.txt", robots.bytes.toString("utf8"));
  delay = Math.max(1000, (policy.getCrawlDelay(agent) || 0) * 1000);
  if (delay > 60000)
    throw Error("robots.txt zahteva razmak duži od 60 sekundi.");
  await atomic("robots.txt", robots.bytes);
  const listing = await retrieve(catalogUrl, 3 * 1024 * 1024);
  if (!/html/i.test(listing.type)) throw Error("RZS katalog nije HTML.");
  const $ = load(listing.bytes.toString("utf8")),
    catalog: any[] = [];
  $('[onclick*="PrikaziLink"]').each((_, e) => {
    const m = ($(e).attr("onclick") || "").match(
      /^PrikaziLink\('([^']+)','([^']+)','([\s\S]*)'\);?$/,
    );
    if (!m) return;
    try {
      const jsonUrl = official(m[2]),
        csvUrl = official(m[1]),
        id = new URL(jsonUrl).pathname.match(
          /\/dataset\/([^/]+)\/1\/json$/,
        )?.[1];
      if (!id) return;
      const parent = $(e).closest("li"),
        description = parent.text().replace(/\s+/g, " ").trim();
      catalog.push({
        id,
        title: m[3],
        csvUrl,
        jsonUrl,
        category: parent.attr("class"),
        description,
        recordCount: Number(
          description.match(/Број слогова:\s*(\d+)/)?.[1] || 0,
        ),
        updatedAt:
          description.match(/Датум ажурирања:\s*([\d.]+)/)?.[1] || null,
      });
    } catch {
      /* Never execute onclick code or follow other origins. */
    }
  });
  if (!catalog.length) throw Error("Struktura RZS kataloga nije prepoznata.");
  await atomic("service-response", listing.bytes);
  await atomic("katalog.json", JSON.stringify(catalog, null, 2));
  let previous: any[] = [];
  try {
    previous = JSON.parse(
      await readFile(resolve(out, "preuzimanje.json"), "utf8"),
    );
    if (!Array.isArray(previous))
      throw Error("Neispravna prethodna evidencija.");
  } catch (e: any) {
    if (e.code !== "ENOENT") throw e;
  }
  const results = new Map(previous.map((m) => [m.id, m])),
    errors: string[] = [];
  for (const id of selected) {
    try {
      const candidates = catalog.filter((m) => m.id === id);
      if (candidates.length !== 1)
        throw Error("Skup nije jednoznačno pronađen u katalogu.");
      const meta = candidates[0];
      const file = await retrieve(meta.jsonUrl, 32 * 1024 * 1024);
      if (!/json/i.test(file.type)) throw Error("Izvod nije JSON.");
      const rows = JSON.parse(
        file.bytes.toString("utf8").replace(/^\uFEFF/, ""),
      );
      if (
        !Array.isArray(rows) ||
        rows.length !== meta.recordCount ||
        rows.some((r) => r.idindikator !== id)
      )
        throw Error("Izvod je nepotpun ili sadrži druge pokazatelje.");
      const sha256 = createHash("sha256").update(file.bytes).digest("hex"),
        record = {
          ...meta,
          requestedUrl: meta.jsonUrl,
          finalUrl: file.url,
          httpStatus: file.status,
          contentType: file.type,
          bytes: file.bytes.length,
          sha256,
          retrievedAt: new Date().toISOString(),
          actualRecords: rows.length,
          topLevelType: "list",
        };
      await atomic(`originali/${id}-${sha256}.json`, file.bytes);
      await atomic(`${id}.json`, file.bytes);
      await atomic(`${id}-izvor.json`, JSON.stringify(record, null, 2));
      results.set(id, record);
      await atomic(
        "preuzimanje.json",
        JSON.stringify([...results.values()], null, 2),
      );
      console.log(`${id}: ${rows.length} zapisa; original sačuvan.`);
    } catch (e) {
      const message = `${id}: ${(e as Error).message}`;
      errors.push(message);
      console.error(message);
    }
  }
  await atomic(
    "poslednja-provera.json",
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        catalogUrl,
        errors,
        previousDataRetained: true,
      },
      null,
      2,
    ),
  );
  if (errors.length) process.exitCode = 1;
} finally {
  await dispatcher.close();
}
