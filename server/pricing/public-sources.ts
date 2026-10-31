import { createHash, randomUUID } from "node:crypto";
import { load } from "cheerio";
import { fetch, EnvHttpProxyAgent } from "undici";
import robotsParser from "robots-parser";
import type { Conn } from "../db.js";
import { D } from "../domain.js";
import { materialName } from "./identity.js";

export const publicSources = [
  {
    id: "ratar",
    name: "Ratar — javni cenovnik",
    origin: "https://www.ratar.rs",
    search: "/search",
    parameter: "proizvod",
  },
  {
    id: "poljokomerc",
    name: "Poljokomerc — javni cenovnik",
    origin: "https://poljokomerc.rs",
    search: "/",
    parameter: "s",
  },
  {
    id: "hemoslavija",
    name: "Hemoslavija — javni cenovnik",
    origin: "https://www.hemoslavijaprodavnica.com",
    search: "/shop.php",
    parameter: "search",
  },
] as const;
export type PublicSourceId = (typeof publicSources)[number]["id"];
export type Composition = {
  ingredients: { name: string; amount: string; unit: string }[];
  formulation: string;
};
export type PublicProduct = {
  name: string;
  unit: string | null;
  packageQuantity: string | null;
  price: string | null;
  basis: string;
  available: boolean;
  availability: string;
  composition: Composition | null;
  description: string;
  crop: string | null;
};
const clean = (s: string) => s.replace(/\s+/g, " ").trim();
export function publicUrl(sourceId: PublicSourceId, input: string) {
  const source = publicSources.find((s) => s.id === sourceId)!;
  const u = new URL(input, source.origin);
  if (
    u.protocol !== "https:" ||
    u.origin !== source.origin ||
    u.username ||
    u.password ||
    u.port ||
    /add-to-cart|checkout|cart|korpa|wp-admin/i.test(
      decodeURIComponent(u.pathname + u.search),
    )
  )
    throw Error("Adresa nije dozvoljeni javni proizvodni cenovnik.");
  u.hash = "";
  if (sourceId === "hemoslavija" && u.pathname.endsWith("detail.php")) {
    const id = u.searchParams.get("artsif");
    if (!id || !/^\d+$/.test(id))
      throw Error("Neispravan identitet proizvoda.");
    u.search = "";
    u.searchParams.set("artsif", id);
  }
  return u.href;
}
export function decimalPrice(
  text: string,
  style: "rs" | "us" = "rs",
): string | null {
  const match = text.replace(/[\s\u00a0]/g, "").match(/\d[\d.,]*/);
  if (!match) return null;
  let raw = match[0];
  if (style === "us") raw = raw.replace(/,/g, "");
  else if (raw.includes(",")) raw = raw.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(?:\.\d{3})+$/.test(raw)) raw = raw.replace(/\./g, "");
  if (!/^\d+(?:\.\d+)?$/.test(raw)) return null;
  const n = D(raw);
  return n.gt(0) && n.lt("1000000000") ? n.toString() : null;
}
export function packageInName(name: string, unitHint = "") {
  if (/paket|\d+\s*[x×]\s*\d|\d+\s*(?:ml|kg|g|l)\s*\+/i.test(name)) return null;
  const seeds = name.match(
    /(\d{2,3}(?:[.\s]\d{3})+|\d{4,7})\s*(?:zrna|semena)\b/i,
  );
  if (seeds)
    return {
      unit: "seed",
      quantity: D(seeds[1].replace(/[.\s]/g, "")).toString(),
    };
  const hits = [...name.matchAll(/(\d+(?:[.,]\d+)?)\s*(kg|gr|g|ml|lit|l)\b/gi)];
  if (hits.length !== 1) {
    if (
      !hits.length &&
      /1\s*\/\s*1/.test(name) &&
      /^(?:lit|l)$/i.test(unitHint)
    )
      return { unit: "l", quantity: "1" };
    return null;
  }
  const [, n, u] = hits[0],
    value = D(n.replace(",", "."));
  if (value.lte(0)) return null;
  return {
    unit: /kg|gr|^g$/i.test(u) ? "kg" : "l",
    quantity: /^(g|gr|ml)$/i.test(u)
      ? value.div(1000).toString()
      : value.toString(),
  };
}
export function parseComposition(text: string): Composition | null {
  const normalized = clean(text).replace(/(\d),(\d)/g, "$1.$2");
  const match = normalized.match(
    /aktivn[ae]\s+(?:materij[ae]|supstanc[ae])\s*:?\s*([\s\S]{1,800})/i,
  );
  if (!match) return null;
  const segment = match[1].split(
    /OBLIK|FORMULACIJA|DELOVANJE|PRIMENA|KARENCA|SPEKTAR|UPOTREBA/i,
  )[0];
  const matches = [
    ...segment.matchAll(
      /([A-Za-zČĆŠŽĐčćšžđ0-9][A-Za-zČĆŠŽĐčćšžđ\-\s().,]{1,100}?)\s+(\d+(?:\.\d+)?)\s*(g\s*\/\s*l|g\s*\/\s*kg|%)/gi,
    ),
  ];
  const values = matches.map((m) => ({
    name: materialName(
      m[1]
        .replace(/\([^)]*\)/g, "")
        .replace(/^.*?:/, "")
        .replace(/^[\s+;,]+/, ""),
    ),
    amount: D(m[2]).toString(),
    unit: m[3].toLowerCase().replace(/\s/g, ""),
  }));
  const form =
    normalized
      .match(
        /(?:formulacij[ae]|oblik[^:]{0,35})\s*:?[^.;]{0,90}?\b(OD|EC|SC|WG|WP|SL|SG|SE|FS|CS)\b/i,
      )?.[1]
      ?.toUpperCase() ||
    normalized.match(/\((OD|EC|SC|WG|WP|SL|SG|SE|FS|CS)\)/)?.[1];
  const remainder = matches.reduce(
    (rest, m) => rest.replace(m[0], " "),
    segment,
  );
  return values.length &&
    form &&
    /^[\s+,;.&-]*$/.test(remainder) &&
    values.every((v) => v.name && D(v.amount).gt(0))
    ? {
        ingredients: values.sort((a, b) => a.name.localeCompare(b.name)),
        formulation: form,
      }
    : null;
}
export function sameComposition(a: Composition | null, b: Composition | null) {
  return (
    !!a &&
    !!b &&
    a.formulation === b.formulation &&
    JSON.stringify(a.ingredients) === JSON.stringify(b.ingredients)
  );
}
export function productBase(name: string) {
  return materialName(
    name
      .replace(/\d+(?:[.,]\d+)?\s*(?:kg|gr|g|ml|lit|l)\b/gi, "")
      .replace(/\b1\s*\/\s*1\b/g, "")
      .replace(/\s*\|.*$/, ""),
  );
}
export function parsePublicProduct(
  sourceId: PublicSourceId,
  bytes: Buffer,
  url: string,
): PublicProduct {
  publicUrl(sourceId, url);
  if (bytes.length > 4 * 1024 * 1024)
    throw Error("Javni cenovnik prelazi 4 MB.");
  const $ = load(bytes.toString("utf8"));
  let name = "",
    price: string | null = null,
    description = "",
    unitHint = "",
    available = true,
    availability = "nije navedena";
  const bodyText = clean($("body").text());
  if (sourceId === "poljokomerc") {
    name = clean($("h1.product_title").first().text());
    description = clean($("#tab-description").text());
    const products: any[] = [];
    $('script[type="application/ld+json"]').each((_, e) => {
      try {
        const doc = JSON.parse($(e).html() || "null");
        for (const row of doc?.["@graph"] || [doc])
          if (row?.["@type"] === "Product") products.push(row);
      } catch {}
    });
    for (const p of products) {
      const offer = p.offers;
      if (!offer || Array.isArray(offer) || offer.priceCurrency !== "RSD")
        continue;
      try {
        if (publicUrl(sourceId, offer.url) !== publicUrl(sourceId, url))
          continue;
      } catch {
        continue;
      }
      if (
        offer.priceValidUntil &&
        String(offer.priceValidUntil) < new Date().toISOString().slice(0, 10)
      )
        continue;
      price = decimalPrice(String(offer.price), "us");
      availability = String(offer.availability || "nije navedena");
      available = !/OutOfStock|Discontinued|PreOrder/.test(availability);
    }
    if (!price) {
      const box = $(".summary-inner > p.price,.summary > p.price").first();
      price = decimalPrice(
        box.find("ins").length
          ? box.find("ins").text()
          : box.clone().find("del").remove().end().text(),
      );
    }
    if ($(".summary .out-of-stock").length) available = false;
  } else if (sourceId === "ratar") {
    name = clean($("h1").first().text());
    const exact = $("h2").filter((_, e) =>
      /^CENA\s*:/i.test(clean($(e).text())),
    );
    if (exact.length === 1) price = decimalPrice(exact.text());
    description = clean(
      $(".block_content")
        .filter((_, e) => /AKTIVNA MATERIJA|OPIS|DELOVANJE/i.test($(e).text()))
        .first()
        .text(),
    );
    available = !/nema na (?:stanju|lageru)|nije (?:na stanju|dostupno)/i.test(
      bodyText,
    );
  } else {
    name = clean($("meta[property='og:title']").attr("content") || "")
      .split("|")[0]
      .trim();
    description =
      clean($("#opis,#description,.tab-content").first().text()) ||
      bodyText.split("Opis proizvoda")[1]?.split("Deklaracija")[0] ||
      "";
    $("tr").each((_, r) => {
      const cells = $(r).children("td");
      const label = clean(cells.first().text());
      if (label === "Cena (mpc)")
        price = decimalPrice(cells.eq(1).text(), "us");
      if (label === "Na lageru") {
        availability = clean(cells.eq(1).text());
        available = !/nema|nedostup/i.test(availability);
      }
    });
    const heading = $("h5")
      .filter((_, e) => /Šifra:|JM:/.test($(e).text()))
      .first()
      .text();
    unitHint = heading.match(/JM:\s*([A-Z]+)/)?.[1] || "";
  }
  if (!name || name.length > 300)
    throw Error(
      "Struktura proizvoda nije prepoznata; prethodne cene ostaju sačuvane.",
    );
  const pack = packageInName(name, unitHint);
  const cropMatch = materialName(name + " " + description.slice(0, 700)).match(
    /(?:seme|hibrid|sorta)\s+(kukuruza|psenice|soje|secerne repe)/i,
  );
  const crop = cropMatch
    ? (
        {
          kukuruza: "KUKURUZ",
          psenice: "PŠENICA",
          soje: "SOJA",
          "secerne repe": "ŠEĆERNA REPA",
        } as Record<string, string>
      )[cropMatch[1].toLowerCase()]
    : null;
  return {
    name,
    price,
    unit: pack?.unit || null,
    packageQuantity: pack?.quantity || null,
    available,
    availability,
    basis: /pdv[^.]{0,20}(?:uračunat|uključen)|sa pdv/i.test(bodyText)
      ? "objavljena cena sa navedenim PDV-om; bez dostave"
      : "objavljena javna cena; PDV nije potvrđen; bez dostave",
    composition: parseComposition(description),
    description: description.slice(0, 3000),
    crop,
  };
}
export function discoverPublicProducts(
  sourceId: PublicSourceId,
  html: string,
  base: string,
) {
  const $ = load(html),
    urls = new Set<string>();
  $(
    sourceId === "poljokomerc"
      ? ".product-element-bottom .wd-entities-title a[href]"
      : "a[href]",
  ).each((_, e) => {
    const href = $(e).attr("href")!;
    try {
      const u = publicUrl(sourceId, new URL(href, base).href);
      const text = clean($(e).text());
      const valid =
        sourceId === "ratar"
          ? /Poruči|Vidi|Naruči/.test(text) && !/[?]/.test(u)
          : sourceId === "poljokomerc"
            ? new URL(u).pathname.startsWith("/proizvod/")
            : new URL(u).pathname.endsWith("detail.php");
      if (valid && !/paket|lista želja/i.test(text + u)) urls.add(u);
    } catch {}
  });
  return [...urls];
}
export async function savePublicProduct(
  tx: Conn,
  sourceId: PublicSourceId,
  url: string,
  bytes: Buffer,
  actor: string,
) {
  const p = parsePublicProduct(sourceId, bytes, url),
    signature = createHash("sha256").update(JSON.stringify(p)).digest("hex");
  const previous = (
    await tx.query(
      "SELECT id,metadata FROM public_price_documents WHERE source_url=$1 ORDER BY retrieved_at DESC LIMIT 1",
      [url],
    )
  ).rows[0];
  const now = new Date().toISOString();
  if (previous?.metadata.signature === signature) {
    await tx.query(
      "UPDATE public_price_documents SET metadata=$1 WHERE id=$2",
      [
        JSON.stringify({ ...previous.metadata, lastCheckedAt: now }),
        previous.id,
      ],
    );
    return {
      reused: true,
      priced: !!p.price && !!p.unit && !!p.packageQuantity,
    };
  }
  const id = randomUUID(),
    sha = createHash("sha256").update(bytes).digest("hex");
  const inserted = (
    await tx.query(
      "INSERT INTO public_price_documents(id,source_id,source_url,sha256,content,metadata) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(source_url,sha256) DO NOTHING RETURNING id",
      [
        id,
        sourceId,
        url,
        sha,
        bytes,
        JSON.stringify({ signature, lastCheckedAt: now, product: p }),
      ],
    )
  ).rows[0];
  if (!inserted) return { reused: true, priced: !!p.price && !!p.unit };
  if (p.price && p.unit && p.packageQuantity)
    await tx.query(
      "INSERT INTO public_input_prices(id,document_id,product,unit,package_quantity,price_rsd,composition,price_basis,available,product_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
      [
        randomUUID(),
        id,
        p.name,
        p.unit,
        p.packageQuantity,
        p.price,
        p.composition ? JSON.stringify(p.composition) : null,
        p.basis,
        p.available,
        productBase(p.name),
      ],
    );
  await tx.query(
    "INSERT INTO audit_log(id,user_id,action,entity,metadata) VALUES($1,$2,'public_price_import',$3,$4)",
    [
      randomUUID(),
      actor,
      id,
      JSON.stringify({
        sourceId,
        url,
        sha256: sha,
        signature,
        priced: !!p.price && !!p.unit,
      }),
    ],
  );
  return { reused: false, priced: !!p.price && !!p.unit };
}
export class PublicPriceReader {
  private dispatcher = new EnvHttpProxyAgent();
  private policies = new Map<string, ReturnType<typeof robotsParser>>();
  private last = 0;
  async close() {
    await this.dispatcher.close();
  }
  private async raw(
    sourceId: PublicSourceId,
    input: string,
    limit: number,
    policy?: ReturnType<typeof robotsParser>,
  ) {
    let url = publicUrl(sourceId, input);
    for (let hop = 0; hop < 4; hop++) {
      if (policy?.isAllowed(url, "AgroPortal-PriceAudit/1.0") === false)
        throw Error("Politika izvora ne dozvoljava preusmerenu adresu.");
      const r = await fetch(url, {
        dispatcher: this.dispatcher,
        redirect: "manual",
        signal: AbortSignal.timeout(20000),
        headers: {
          "User-Agent": "AgroPortal-PriceAudit/1.0",
          Accept: "text/html,text/plain",
        },
      });
      if ([301, 302, 303, 307, 308].includes(r.status)) {
        const dest = r.headers.get("location");
        await r.body?.cancel();
        if (!dest) throw Error("Preusmerenje bez adrese.");
        url = publicUrl(sourceId, new URL(dest, url).href);
        continue;
      }
      const chunks: Buffer[] = [];
      let length = 0;
      for await (const chunk of r.body!) {
        const b = Buffer.from(chunk);
        length += b.length;
        if (length > limit) throw Error("Odgovor izvora je prevelik.");
        chunks.push(b);
      }
      return { status: r.status, url, bytes: Buffer.concat(chunks) };
    }
    throw Error("Previše preusmerenja izvora.");
  }
  async read(sourceId: PublicSourceId, input: string) {
    const source = publicSources.find((s) => s.id === sourceId)!;
    if (!this.policies.has(sourceId)) {
      const r = await this.raw(
        sourceId,
        source.origin + "/robots.txt",
        128 * 1024,
      );
      if (![200, 404].includes(r.status))
        throw Error("Politika izvora nije dostupna.");
      this.policies.set(
        sourceId,
        robotsParser(
          source.origin + "/robots.txt",
          r.status === 404 ? "" : r.bytes.toString("utf8"),
        ),
      );
    }
    const policy = this.policies.get(sourceId)!,
      url = publicUrl(sourceId, input);
    if (policy.isAllowed(url, "AgroPortal-PriceAudit/1.0") === false)
      throw Error("Politika izvora ne dozvoljava preuzimanje.");
    const delay = Math.max(
      1000,
      (policy.getCrawlDelay("AgroPortal-PriceAudit/1.0") || 0) * 1000,
    );
    if (delay > 60000) throw Error("Izvor zahteva duži razmak između zahteva.");
    await new Promise((r) =>
      setTimeout(r, Math.max(0, delay - (Date.now() - this.last))),
    );
    this.last = Date.now();
    const r = await this.raw(sourceId, url, 4 * 1024 * 1024, policy);
    if (r.status !== 200)
      throw Error(
        `Izvor je vratio HTTP ${r.status}; prethodni podaci su sačuvani.`,
      );
    return r;
  }
  async search(sourceId: PublicSourceId, query: string) {
    const source = publicSources.find((s) => s.id === sourceId)!,
      url = new URL(source.search, source.origin);
    url.searchParams.set(source.parameter, query);
    if (sourceId === "poljokomerc")
      url.searchParams.set("post_type", "product");
    const page = await this.read(sourceId, url.href);
    return discoverPublicProducts(
      sourceId,
      page.bytes.toString("utf8"),
      page.url,
    );
  }
}
