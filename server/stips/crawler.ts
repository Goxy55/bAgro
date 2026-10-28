import { fetch, EnvHttpProxyAgent } from "undici";
import { load } from "cheerio";
import robotsParser from "robots-parser";
import { randomUUID } from "node:crypto";
import { db, transaction } from "../db.js";
import { ingestDocument, stipsAudit } from "./service.js";
import { STIPS_ORIGIN, USER_AGENT, stipsUrl } from "./schema.js";
import { MAX_DOCUMENT_BYTES } from "./extract.js";
export type Retrieved = {
  status: number;
  bytes: Buffer;
  type: string;
  url: string;
};
export type Retrieve = (
  url: string,
  limit: number,
  allowed?: (url: string) => boolean,
) => Promise<Retrieved>;
let dispatcher: EnvHttpProxyAgent | undefined;
export const retrieve: Retrieve = async (input, limit, allowed) => {
  dispatcher ??= new EnvHttpProxyAgent();
  let target = stipsUrl(input);
  for (let hop = 0; hop < 4; hop++) {
    if (allowed && !allowed(target))
      throw Error("robots.txt ne dozvoljava preuzimanje izabranog dokumenta.");
    let response;
    try {
      response = await fetch(target, {
        dispatcher,
        redirect: "manual",
        signal: AbortSignal.timeout(20000),
        headers: {
          "User-Agent": USER_AGENT,
          Accept:
            "application/pdf,text/html,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/plain;q=0.8",
        },
      });
    } catch {
      throw Error(
        "Pristup STIPS izvoru nije uspeo preko postojeće mrežne/proxy veze. Proverite mrežni pristup i TLS; verifikacija nije isključena.",
      );
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const next = response.headers.get("location");
      await response.body?.cancel();
      if (!next) throw Error("STIPS preusmerenje nema odredište.");
      target = stipsUrl(next, target);
      continue;
    }
    if (response.status !== 200) {
      await response.body?.cancel();
      return {
        status: response.status,
        bytes: Buffer.alloc(0),
        type: response.headers.get("content-type") || "",
        url: target,
      };
    }
    if (Number(response.headers.get("content-length") || 0) > limit) {
      await response.body?.cancel();
      throw Error("STIPS odgovor je veći od dozvoljene veličine.");
    }
    const parts: Uint8Array[] = [];
    let size = 0;
    const reader = response.body?.getReader();
    if (reader) {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > limit) {
            await reader.cancel();
            throw Error("STIPS odgovor je veći od dozvoljene veličine.");
          }
          parts.push(value);
        }
      } finally {
        reader.releaseLock();
      }
    }
    return {
      status: response.status,
      bytes: Buffer.concat(parts),
      type: response.headers.get("content-type") || "",
      url: target,
    };
  }
  throw Error("Previše STIPS preusmerenja.");
};
export function discoverPdfs(html: string, base: string) {
  const $ = load(html),
    links = new Map<string, string>();
  $("a[href]").each((_i, a) => {
    try {
      const url = stipsUrl($(a).attr("href") || "", base);
      if (/\.pdf(?:$|\?)/i.test(url))
        links.set(
          url,
          $(a).text().replace(/\s+/g, " ").trim().slice(0, 300) ||
            "STIPS bilten",
        );
    } catch {
      /* External, credentialed and non-HTTPS targets are not fetched. */
    }
  });
  return [...links].slice(0, 200).map(([url, title]) => ({ url, title }));
}
export async function probeAccess(fetcher: Retrieve = retrieve) {
  const r = await fetcher(STIPS_ORIGIN + "/", 2 * 1024 * 1024);
  return {
    url: r.url,
    status: r.status,
    accessible: r.status === 200,
    checkedAt: new Date().toISOString(),
    message:
      r.status === 200
        ? "Početna stranica je dostupna. To još ne potvrđuje format biltena ili pravo ponovne upotrebe."
        : `STIPS pristup nije dostupan: HTTP ${r.status}. Ručni uvoz ostaje omogućen.`,
  };
}
export async function runCrawl(
  actor: string,
  fetcher: Retrieve = retrieve,
  pause: (ms: number) => Promise<void> = (ms) =>
    new Promise((resolve) => setTimeout(resolve, ms)),
) {
  const runId = randomUUID();
  const settings = await transaction(async (tx) => {
    const s = (
      await tx.query(
        "UPDATE stips_crawler_settings SET lease_until=now()+interval '10 minutes' WHERE id=1 AND (lease_until IS NULL OR lease_until<now()) RETURNING *",
      )
    ).rows[0];
    if (!s) throw Error("Preuzimanje STIPS biltena je već u toku.");
    if (!s.terms_confirmed || !s.terms_note.trim())
      throw Error(
        "Najpre dokumentujte proveru uslova preuzimanja u podešavanjima STIPS izvora.",
      );
    await tx.query(
      "INSERT INTO stips_fetch_runs(id,status,actor) VALUES($1,'running',$2)",
      [runId, actor],
    );
    return s;
  });
  let imported = 0,
    duplicates = 0;
  const errors: string[] = [],
    links: { url: string; title: string }[] = [];
  try {
    const robotsByHost = new Map<string, ReturnType<typeof robotsParser>>();
    async function robots(url: string) {
      const origin = new URL(stipsUrl(url)).origin;
      if (!robotsByHost.has(origin)) {
        const r = await fetcher(origin + "/robots.txt", 128 * 1024);
        if (r.status !== 200 && r.status !== 404)
          throw Error(
            `Ne može se proveriti robots.txt: HTTP ${r.status}. Preuzimanje je zaustavljeno.`,
          );
        robotsByHost.set(
          origin,
          robotsParser(
            origin + "/robots.txt",
            r.status === 404 ? "" : r.bytes.toString("utf8"),
          ),
        );
      }
      return robotsByHost.get(origin)!;
    }
    const lastRequests = new Map<string, number>();
    const polite: Retrieve = async (url, limit, allowed) => {
      const host = new URL(url).origin;
      const policy = robotsByHost.get(host);
      const delay = Math.max(
        1000,
        (policy?.getCrawlDelay(USER_AGENT) || 0) * 1000,
      );
      if (delay > 60000)
        throw Error(
          "robots.txt zahteva razmak duži od 60 sekundi; koristite ručni uvoz.",
        );
      const elapsed = Date.now() - (lastRequests.get(host) || 0);
      if (elapsed < delay) await pause(delay - elapsed);
      lastRequests.set(host, Date.now());
      return fetcher(url, limit, allowed);
    };
    for (const listing of settings.listing_urls as string[]) {
      try {
        const url = stipsUrl(listing);
        await robots(url);
        const allowed = (u: string) => {
          const policy = robotsByHost.get(new URL(u).origin);
          return !!policy && policy.isAllowed(u, USER_AGENT) !== false;
        };
        const r = await polite(url, 2 * 1024 * 1024, allowed);
        if (r.status !== 200)
          throw Error(`STIPS stranica nije dostupna: HTTP ${r.status}.`);
        if (!/html/i.test(r.type))
          throw Error(
            "STIPS izvor nije prepoznata HTML stranica sa linkovima ka biltenima.",
          );
        for (const l of discoverPdfs(r.bytes.toString("utf8"), r.url))
          if (!links.some((v) => v.url === l.url)) links.push(l);
      } catch (e) {
        errors.push((e as Error).message);
      }
    }
    for (const l of links.slice(0, settings.max_documents)) {
      try {
        await robots(l.url);
        const allowed = (u: string) =>
          !!robotsByHost.get(new URL(u).origin) &&
          robotsByHost.get(new URL(u).origin)!.isAllowed(u, USER_AGENT) !==
            false;
        const r = await polite(l.url, MAX_DOCUMENT_BYTES, allowed);
        if (r.status !== 200)
          throw Error(`Bilten nije dostupan: HTTP ${r.status}.`);
        if (!r.bytes.subarray(0, 5).equals(Buffer.from("%PDF-")))
          throw Error("Preuzeta adresa nema PDF sadržaj.");
        let filename = "stips-bilten.pdf";
        try {
          filename = decodeURIComponent(
            new URL(r.url).pathname.split("/").pop() || filename,
          );
        } catch {}
        const result = await ingestDocument(
          r.bytes,
          "application/pdf",
          filename,
          {
            title: l.title,
            sourceUrl: r.url,
            publishedAt: null,
            periodStart: null,
            periodEnd: null,
            termsConfirmed: true,
            termsNote: settings.terms_note,
          },
          actor,
        );
        if (result.duplicate) duplicates++;
        else imported++;
      } catch (e) {
        errors.push((e as Error).message);
      }
    }
    if (!links.length && !errors.length)
      errors.push(
        "Na izabranim stranicama nisu pronađeni direktni PDF linkovi. Proverite stvarnu stranicu biltena ili koristite ručni uvoz.",
      );
  } catch (e) {
    errors.push((e as Error).message);
  }
  const status = errors.length ? (imported ? "partial" : "failed") : "success";
  await transaction(async (tx) => {
    await tx.query(
      "UPDATE stips_fetch_runs SET completed_at=now(),status=$1,discovered=$2,imported=$3,duplicates=$4,errors=$5,links=$6 WHERE id=$7",
      [
        status,
        links.length,
        imported,
        duplicates,
        JSON.stringify(errors),
        JSON.stringify(links),
        runId,
      ],
    );
    await tx.query(
      "UPDATE stips_crawler_settings SET lease_until=NULL,next_check_at=now()+(interval_hours*interval '1 hour'),last_success_at=CASE WHEN $1='success' THEN now() ELSE last_success_at END,last_error=$2 WHERE id=1",
      [status, errors.length ? errors.join(" ") : null],
    );
    await stipsAudit(tx, actor, "stips_fetch", runId, {
      status,
      discovered: links.length,
      imported,
      duplicates,
    });
  });
  return {
    id: runId,
    status,
    discovered: links.length,
    imported,
    duplicates,
    errors,
  };
}
export function startStipsScheduler() {
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      const s = (
        await db.query(
          "SELECT enabled,next_check_at FROM stips_crawler_settings WHERE id=1",
        )
      ).rows[0];
      if (
        s?.enabled &&
        (!s.next_check_at || Date.parse(s.next_check_at) <= Date.now())
      )
        await runCrawl("scheduler");
    } catch (e) {
      console.error("STIPS scheduler:", (e as Error).message);
    } finally {
      busy = false;
    }
  };
  const timer = setInterval(tick, 60000);
  timer.unref();
  return () => clearInterval(timer);
}
