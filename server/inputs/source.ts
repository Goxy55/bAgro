import robotsParser from "robots-parser";
import { retrieve, type Retrieve } from "../stips/crawler.js";
import { USER_AGENT, stipsUrl } from "../stips/schema.js";
import {
  INPUTS_URL,
  discoverInputReports,
  inputAttachment,
  type InputReport,
} from "./extract.js";

export function createInputSource(
  fetcher: Retrieve = retrieve,
  pause = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
) {
  const policies = new Map<string, ReturnType<typeof robotsParser>>();
  let last = 0,
    queue = Promise.resolve();
  async function read(url: string, limit: number) {
    const previous = queue;
    let release!: () => void;
    queue = new Promise<void>((r) => {
      release = r;
    });
    await previous;
    try {
      const target = stipsUrl(url),
        origin = new URL(target).origin;
      if (!policies.has(origin)) {
        const r = await fetcher(origin + "/robots.txt", 128 * 1024);
        last = Date.now();
        if (r.status !== 200 && r.status !== 404)
          throw Error(`robots.txt nije dostupan: HTTP ${r.status}.`);
        policies.set(
          origin,
          robotsParser(
            origin + "/robots.txt",
            r.status === 404 ? "" : r.bytes.toString("utf8"),
          ),
        );
      }
      const delay = Math.max(
        1000,
        (policies.get(origin)!.getCrawlDelay(USER_AGENT) || 0) * 1000,
      );
      if (delay > 60000)
        throw Error("Izvor zahteva duži razmak; koristite ručni uvoz.");
      if (Date.now() - last < delay) await pause(delay - (Date.now() - last));
      const allowed = (u: string) =>
        policies.get(new URL(stipsUrl(u)).origin)?.isAllowed(u, USER_AGENT) !==
          false && policies.has(new URL(u).origin);
      if (!allowed(target))
        throw Error("robots.txt ne dozvoljava ovu putanju.");
      last = Date.now();
      const r = await fetcher(target, limit, allowed);
      if (r.status !== 200)
        throw Error(
          `STIPS izvor nije dostupan: HTTP ${r.status}. Poslednji podaci su zadržani.`,
        );
      if (r.bytes.length > limit)
        throw Error("Odgovor prelazi dozvoljenu veličinu.");
      return r;
    } finally {
      release();
    }
  }
  let listingCache: { at: number; reports: InputReport[] } | undefined;
  async function listing(force = false) {
    if (!force && listingCache && Date.now() - listingCache.at < 15 * 60 * 1000)
      return listingCache.reports;
    const r = await read(INPUTS_URL, 2 * 1024 * 1024);
    if (!/html/i.test(r.type)) throw Error("Arhiva inputa nije HTML stranica.");
    const reports = discoverInputReports(r.bytes.toString("utf8"), r.url);
    if (!reports.length)
      throw Error(
        "Arhiva nema prepoznate cenovnike; struktura izvora zahteva proveru.",
      );
    listingCache = { at: Date.now(), reports };
    return reports;
  }
  async function document(url: string) {
    const report = (await listing()).find((r) => r.url === stipsUrl(url));
    if (!report)
      throw Error(
        "Izabrana adresa nije cenovnik iz proverene STIPS arhive inputa.",
      );
    const page = await read(report.url, 2 * 1024 * 1024);
    if (!/html/i.test(page.type)) throw Error("Stranica cenovnika nije HTML.");
    const attachment = inputAttachment(page.bytes.toString("utf8"), page.url);
    const file = await read(attachment.url, 8 * 1024 * 1024);
    return {
      report,
      pageTitle: attachment.title,
      fileUrl: file.url,
      bytes: file.bytes,
    };
  }
  return { listing, document };
}
export const inputSource = createInputSource();
