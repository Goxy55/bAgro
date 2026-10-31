import { Router } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db, transaction, type Conn } from "../db.js";
import { id, dec } from "../validation.js";
import { todayInSerbia } from "../../shared/dates.js";
import { D } from "../domain.js";
import { buildPricingTable, type PricingVersion } from "./model.js";
import { bindFuel, previewFuel } from "./fuel.js";
import { applyPrices } from "./routes.js";
import { readiness } from "./books.js";
import { suggestPrices } from "./suggestions.js";
import { inputSource } from "../inputs/source.js";
import { importInputReport } from "../inputs/service.js";
import { retrieveRzsPrices, ingestRzsPrices } from "./rzs-prices.js";
import {
  PublicPriceReader,
  publicSources,
  savePublicProduct,
  type PublicSourceId,
} from "./public-sources.js";
import {
  publicCandidates,
  publicPricePool,
  commercialName,
} from "./public-prices.js";
import type { PricingRow, PricingTable } from "../../shared/pricing.js";

export const pilotTemplates = ["s0-B36", "s0-B103", "s0-B243", "s0-B206"];
const optionsSchema = z.object({
  revision: z.string().regex(/^[a-f0-9]{64}$/),
  fuel: dec.refine((v) => D(v).gt(0)).optional(),
  seedUnits: z
    .record(
      z.string(),
      dec.refine((v) => D(v).isInteger() && D(v).gt(0)),
    )
    .default({}),
});
type Options = z.infer<typeof optionsSchema>;
const jobs = new Map<string, Promise<void>>();
export async function interruptPreparations() {
  await db.query(
    "UPDATE price_preparations SET status='failed',finished_at=now(),progress='Priprema je prekinuta ponovnim pokretanjem servera. Sačuvane cene ostaju u nacrtu.' WHERE status='running'",
  );
}
export async function bookDrafts(conn: Conn, bookId: string, lock = false) {
  const rows = (
    await conn.query<PricingVersion>(
      "SELECT v.*,v.valid_from::text,v.valid_to::text,t.name AS template_name FROM norm_versions v JOIN templates t ON t.id=v.template_id WHERE v.price_book_id=$1 AND v.status='draft' ORDER BY t.name,v.id" +
        (lock ? " FOR UPDATE OF v" : ""),
      [bookId],
    )
  ).rows;
  if (!rows.length) throw Error("Cenovnik nema nacrte za pripremu.");
  return rows;
}
const positive = (row: PricingRow) =>
  row.occurrences.some(
    (o) => o.included && (o.quantity == null || D(o.quantity).gt(0)),
  );
// Deterministic representative, not a fictitious national average or cheapest-market claim.
export async function candidateRows(table: PricingTable, conn: Conn = db) {
  const asOf = todayInSerbia(),
    suggestions = await suggestPrices(conn, table, {
      asOf,
      includeExisting: true,
    }),
    pool = await publicPricePool(conn);
  const rows: any[] = [];
  for (const row of table.rows) {
    if (
      !positive(row) ||
      row.pricingGroup === "diesel" ||
      row.occurrences.some((o) => o.price !== null && !o.lastInput?.reference)
    )
      continue;
    const stips = suggestions.rows
      .find((s) => s.key === row.key)
      ?.candidates.filter((c) => c.match === "exact" || c.match === "approved")
      .sort(
        (a, b) =>
          b.periodStart.localeCompare(a.periodStart) ||
          Number(a.match !== "approved") - Number(b.match !== "approved") ||
          a.product.localeCompare(b.product) ||
          a.packaging.localeCompare(b.packaging),
      );
    const official = stips?.find((c) => c.sourceKind !== "rzs" || c.sourceUnit);
    const retail = publicCandidates(row, pool).find(
      (p) => p.checked_at.slice(0, 10) <= asOf,
    );
    // Recent exact retail evidence precedes old official observations; proxies remain identifiable.
    const useRetail =
      retail &&
      (!official ||
        (retail.match === "exact" &&
          retail.checked_at.slice(0, 10) > official.periodEnd));
    if (useRetail) {
      rows.push({
        key: row.key,
        price: retail.amount,
        currency: "RSD",
        unit: retail.targetUnit,
        confirmUnit: true,
        publicReference: {
          observationId: retail.id,
          date: todayInSerbia(new Date(retail.retrieved_at)),
          confirmedProduct: true,
          confirmedBasis: true,
          confirmedProxy: retail.match === "proxy",
          note: "Predlog javne cenovne reference; čeka grupni pregled administratora.",
        },
      });
    } else if (official) {
      rows.push({
        key: row.key,
        price: official.amount,
        currency: "RSD",
        unit: official.unit,
        confirmUnit: true,
        ...(official.sourceKind === "rzs"
          ? {
              rzsReference: {
                observationId: official.observationId,
                date: official.date,
                sourceUnit: official.sourceUnit,
                confirmedProduct: true,
                confirmedBasis: true,
                confirmedProxy: true,
                allowHistorical: true,
                note: "Ranije provereno RZS mapiranje; čeka grupni pregled.",
              },
            }
          : {
              reference: {
                observationId: official.observationId,
                unitsPerPrice: official.unitsPerPrice,
                date: official.date,
                confirmedProduct: true,
                confirmedBasis: true,
                allowHistorical: true,
                note: "STIPS lokalna referenca; čeka grupni pregled administratora.",
              },
            }),
      });
    }
  }
  return rows;
}
async function tableFor(bookId: string) {
  return buildPricingTable(await bookDrafts(db, bookId));
}
async function chooseAlternatives(bookId: string, actor: string) {
  await transaction(async (tx) => {
    const versions = await bookDrafts(tx, bookId, true);
    for (const v of versions) {
      const groups = new Map<string, any[]>();
      for (let n = 0; n < v.model.items.length; n++) {
        const i = v.model.items[n],
          prev = v.model.items[n - 1];
        const group =
          i.alternativeGroup ||
          (/\bili\b/i.test(i.name)
            ? i.id
            : prev && /\bili\b/i.test(prev.name)
              ? prev.id
              : null);
        if (group) {
          const a = groups.get(group) || [];
          a.push(i);
          groups.set(group, a);
        }
      }
      let changed = false;
      for (const [group, items] of groups) {
        const active = items.filter(
          (i) =>
            i.included !== false && i.quantity != null && D(i.quantity).gt(0),
        );
        if (active.length < 2) continue;
        const chosen = active.find(
          (i) => i.price != null && !i.priceInput?.pendingRate,
        );
        if (!chosen) continue;
        for (const i of active) {
          i.alternativeGroup = group;
          i.preparationAlternative = {
            chosenId: chosen.id,
            author: actor,
            at: new Date().toISOString(),
            reason:
              "Jedna dostupna izvorna alternativa; predlog čeka grupni pregled.",
          };
          if (i !== chosen) {
            i.included = false;
            i.exclusionReason =
              "Alternativa — predložena je stavka " + chosen.id;
          }
        }
        changed = true;
      }
      if (changed) {
        await tx.query("UPDATE norm_versions SET model=$1 WHERE id=$2", [
          JSON.stringify(v.model),
          v.id,
        ]);
        await tx.query(
          "INSERT INTO audit_log(id,user_id,action,entity,metadata) VALUES($1,$2,'price_alternatives_proposed',$3,$4)",
          [randomUUID(), actor, v.id, JSON.stringify({ bookId })],
        );
      }
    }
  });
}
export type PreparationDependencies = {
  refreshOfficial: (actor: string, warn: (s: string) => void) => Promise<void>;
  collectPublic: (
    table: PricingTable,
    actor: string,
    progress: (s: string) => Promise<void>,
    warn: (s: string) => void,
  ) => Promise<void>;
};
const defaultDependencies: PreparationDependencies = {
  async refreshOfficial(actor, warn) {
    try {
      const listing = await inputSource.listing(true);
      for (const category of ["pesticidi", "djubriva", "seme"]) {
        const report = listing
          .filter((r) => r.category === category)
          .sort((a, b) => b.year - a.year || b.month - a.month)[0];
        if (!report) continue;
        const prior = (
          await db.query(
            "SELECT received_at FROM stips_input_documents WHERE source_url=$1 ORDER BY received_at DESC LIMIT 1",
            [report.url],
          )
        ).rows[0];
        if (
          !prior ||
          Date.now() - new Date(prior.received_at).getTime() > 86400000
        )
          try {
            await importInputReport(report.url, actor);
          } catch (e) {
            warn("STIPS " + category + ": " + (e as Error).message);
          }
      }
    } catch (e) {
      warn("STIPS: " + (e as Error).message);
    }
    try {
      const latest = (
        await db.query(
          "SELECT retrieved_at FROM rzs_price_documents ORDER BY retrieved_at DESC LIMIT 1",
        )
      ).rows[0];
      if (
        !latest ||
        Date.now() - new Date(latest.retrieved_at).getTime() > 86400000
      ) {
        const bytes = await retrieveRzsPrices();
        await transaction((tx) => ingestRzsPrices(tx, bytes, actor));
      }
    } catch (e) {
      warn("RZS: " + (e as Error).message);
    }
  },
  async collectPublic(table, actor, progress, warn) {
    const reader = new PublicPriceReader(),
      started = Date.now(),
      seen = new Set<string>();
    let requests = 0,
      remaining = false;
    try {
      const proposed = new Set((await candidateRows(table)).map((r) => r.key));
      const rows = table.rows
        .filter(
          (r) =>
            positive(r) &&
            r.pricingGroup !== "diesel" &&
            !r.occurrences.some(
              (o) => o.price !== null && !o.lastInput?.reference,
            ) &&
            !proposed.has(r.key),
        )
        .sort(
          (a, b) =>
            Number(
              !a.occurrences.some((o) => pilotTemplates.includes(o.templateId)),
            ) -
              Number(
                !b.occurrences.some((o) =>
                  pilotTemplates.includes(o.templateId),
                ),
              ) || a.name.localeCompare(b.name),
        );
      for (const row of rows) {
        if (requests >= 120 || Date.now() - started > 8 * 60000) {
          remaining = true;
          break;
        }
        const material = row.occurrences[0]?.name || row.name;
        let query = row.cultureSpecific
          ? "seme " + row.name.split(" · ").slice(1).join(" · ").toLowerCase()
          : commercialName(material)
              .replace(/\bili\b/g, "")
              .trim();
        const crop = row.name.split(" · ").slice(1).join(" · ");
        if (row.cultureSpecific)
          query =
            (
              {
                PŠENICA: "seme pšenice",
                KUKURUZ: "seme kukuruza",
                SOJA: "seme soje",
                "ŠEĆERNA REPA": "seme šećerne repe",
              } as Record<string, string>
            )[crop] || query;
        else if (/\bkan\b/.test(query)) query = "kan";
        else if (/\burea\b/.test(query)) query = "urea";
        if (
          query.length < 3 ||
          /goriv|usluga|veterinar|ručno|snaga|ishrana/.test(query)
        )
          continue;
        if (seen.has(query)) continue;
        seen.add(query);
        await progress("Tražim javne cene: " + row.name);
        for (const source of publicSources) {
          if (requests >= 120 || Date.now() - started > 8 * 60000) {
            remaining = true;
            break;
          }
          try {
            const cache = (
              await db.query(
                "SELECT urls,checked_at FROM public_price_searches WHERE source_id=$1 AND query=$2",
                [source.id, query],
              )
            ).rows[0];
            let urls: string[];
            const fresh =
              cache &&
              Date.now() - new Date(cache.checked_at).getTime() < 86400000;
            if (fresh) urls = cache.urls;
            else {
              requests++;
              urls = await reader.search(source.id, query);
              await db.query(
                "INSERT INTO public_price_searches(source_id,query,urls) VALUES($1,$2,$3) ON CONFLICT(source_id,query) DO UPDATE SET checked_at=now(),urls=EXCLUDED.urls",
                [source.id, query, JSON.stringify(urls)],
              );
            }
            for (const url of urls.slice(0, 2)) {
              const prior = (
                await db.query(
                  "SELECT metadata,retrieved_at FROM public_price_documents WHERE source_url=$1 ORDER BY retrieved_at DESC LIMIT 1",
                  [url],
                )
              ).rows[0];
              if (
                prior &&
                Date.now() -
                  new Date(
                    prior.metadata.lastCheckedAt || prior.retrieved_at,
                  ).getTime() <
                  86400000
              )
                continue;
              requests++;
              const page = await reader.read(source.id as PublicSourceId, url);
              await transaction((tx) =>
                savePublicProduct(tx, source.id, page.url, page.bytes, actor),
              );
            }
            if (
              publicCandidates(row, await publicPricePool(db)).some(
                (p) => p.match === "exact",
              )
            )
              break;
          } catch (e) {
            warn(source.name + ": " + (e as Error).message);
          }
        }
      }
      if (remaining)
        warn(
          "Dostignut je limit jedne pripreme. Sačuvane su pronađene cene; ponovna priprema koristi keš i nastavlja preostale inpute.",
        );
    } finally {
      await reader.close();
    }
  },
};
export async function runPreparation(
  jobId: string,
  bookId: string,
  actor: string,
  options: Options,
  deps = defaultDependencies,
) {
  const warnings: string[] = [];
  const warn = (s: string) => {
    if (!warnings.includes(s) && warnings.length < 40) warnings.push(s);
  };
  const progress = async (s: string) => {
    await db.query(
      "UPDATE price_preparations SET progress=$1,warnings=$2 WHERE id=$3",
      [s, JSON.stringify(warnings), jobId],
    );
  };
  try {
    await progress("Povezujem gorivo i proveravam osnovu normativa…");
    await transaction(async (tx) => {
      const versions = await bookDrafts(tx, bookId, true),
        table = buildPricingTable(versions);
      if (table.revision !== options.revision)
        throw Error("Cenovnik je promenjen pre početka pripreme.");
      if (previewFuel(versions).eligible)
        bindFuel(versions, actor, "Zajednička priprema dinarskog cenovnika");
      for (const v of versions) {
        for (const i of v.model.items)
          if (/^seme\s*\(sj\)/i.test(i.name) && /potvrditi/.test(i.unit)) {
            i.unit = "sj";
            i.unitConfirmed = false;
            i.sourceUnitReview = {
              originalUnit: "kg/l — potvrditi",
              reason: "Izvorni naziv seme (sj)",
              author: actor,
            };
          }
        if (options.seedUnits[v.template_id])
          v.model.seedUnitSize = options.seedUnits[v.template_id];
        await tx.query("UPDATE norm_versions SET model=$1 WHERE id=$2", [
          JSON.stringify(v.model),
          v.id,
        ]);
      }
    });
    let table = await tableFor(bookId);
    if (options.fuel && table.rows.some((r) => r.pricingGroup === "diesel")) {
      const r = await applyPrices(
        {
          versionIds: table.versions.map((v) => v.id),
          revision: table.revision,
          date: todayInSerbia(),
          reason: "Jedna dinarska cena goriva — predlog administratora",
          rows: [],
          fuel: { price: options.fuel, currency: "RSD", confirmed: true },
        },
        actor,
        true,
      );
      table = r.table;
    }
    await progress("Proveravam poslednja izdanja STIPS i RZS…");
    await deps.refreshOfficial(actor, warn);
    await deps.collectPublic(table, actor, progress, warn);
    await progress("Raspoređujem proverljive cenovne predloge po kulturama…");
    const rows = await candidateRows(table);
    if (rows.length)
      await applyPrices(
        {
          versionIds: table.versions.map((v) => v.id),
          revision: table.revision,
          date: todayInSerbia(),
          reason:
            "Automatski predlog cena iz dokumentovanih izvora — čeka grupnu potvrdu",
          rows,
        },
        actor,
        true,
      );
    await chooseAlternatives(bookId, actor);
    await db.query(
      "UPDATE price_preparations SET status='complete',finished_at=now(),progress='Priprema je završena. Pregledajte predloge i potvrdite spremne proizvodnje.',warnings=$1,result=$2 WHERE id=$3",
      [
        JSON.stringify(warnings),
        JSON.stringify({ proposedRows: rows.length }),
        jobId,
      ],
    );
  } catch (e) {
    await db.query(
      "UPDATE price_preparations SET status='failed',finished_at=now(),progress=$1,warnings=$2 WHERE id=$3",
      [(e as Error).message, JSON.stringify(warnings), jobId],
    );
  }
  await db.query(
    "INSERT INTO audit_log(id,user_id,action,entity,metadata) VALUES($1,$2,'price_preparation_finish',$3,$4)",
    [randomUUID(), actor, bookId, JSON.stringify({ jobId, warnings })],
  );
}
export async function startPreparation(
  bookId: string,
  actor: string,
  input: unknown,
  deps?: PreparationDependencies,
) {
  const options = optionsSchema.parse(input);
  let created = false;
  const job = await transaction(async (tx) => {
    await tx.query("SELECT id FROM templates ORDER BY id FOR UPDATE");
    await tx.query("SELECT id FROM price_books WHERE id=$1 FOR UPDATE", [
      bookId,
    ]);
    const running = (
      await tx.query(
        "SELECT * FROM price_preparations WHERE book_id=$1 AND status='running'",
        [bookId],
      )
    ).rows[0];
    if (running) return running;
    if (
      (
        await tx.query(
          "SELECT id FROM price_preparations WHERE status='running'",
        )
      ).rows.length
    )
      throw Error("Drugi cenovnik se trenutno priprema. Sačekajte završetak.");
    const table = buildPricingTable(await bookDrafts(tx, bookId));
    if (table.revision !== options.revision)
      throw Error("Cenovnik je promenjen. Ponovo otvorite prikaz.");
    for (const templateId of Object.keys(options.seedUnits))
      if (
        !table.rows.some(
          (r) =>
            r.cultureSpecific &&
            (r.unit === "sj" || /seme\s*\(sj\)/i.test(r.name)) &&
            r.occurrences.some((o) => o.templateId === templateId),
        )
      )
        throw Error(
          "Osnova SJ se unosi samo za seme odgovarajuće proizvodnje.",
        );
    const id = randomUUID();
    const result = (
      await tx.query(
        "INSERT INTO price_preparations(id,book_id,author,status) VALUES($1,$2,$3,'running') RETURNING *",
        [id, bookId, actor],
      )
    ).rows[0];
    await tx.query(
      "INSERT INTO audit_log(id,user_id,action,entity,metadata) VALUES($1,$2,'price_preparation_start',$3,$4)",
      [randomUUID(), actor, bookId, JSON.stringify({ jobId: id, ...options })],
    );
    created = true;
    return result;
  });
  if (created) {
    const promise = runPreparation(
      job.id,
      bookId,
      actor,
      options,
      deps,
    ).finally(() => jobs.delete(job.id));
    jobs.set(job.id, promise);
    void promise.catch((e) =>
      console.error("Priprema cena prekinuta:", (e as Error).message),
    );
  }
  return job;
}
export async function waitPreparation(id: string) {
  await jobs.get(id);
}
export const adminPreparation = Router();
adminPreparation.post("/:id/prepare", async (req: any, res) =>
  res
    .status(202)
    .json(
      await startPreparation(id.parse(req.params.id), req.user.id, req.body),
    ),
);
adminPreparation.get("/:id/preparation", async (req: any, res) => {
  const bookId = id.parse(req.params.id);
  const job =
    (
      await db.query(
        "SELECT id,status,progress,warnings,result,started_at,finished_at FROM price_preparations WHERE book_id=$1 ORDER BY started_at DESC,id DESC LIMIT 1",
        [bookId],
      )
    ).rows[0] || null;
  res.json({ job });
});
adminPreparation.get("/:id/workbench", async (req: any, res) => {
  const bookId = id.parse(req.params.id);
  const book = (
    await db.query(
      "SELECT *,valid_from::text,valid_to::text FROM price_books WHERE id=$1",
      [bookId],
    )
  ).rows[0];
  if (!book) throw Error("Cenovnik nije pronađen.");
  const job =
    (
      await db.query(
        "SELECT * FROM price_preparations WHERE book_id=$1 ORDER BY started_at DESC,id DESC LIMIT 1",
        [bookId],
      )
    ).rows[0] || null;
  const versions = (
    await db.query(
      "SELECT v.id,v.template_id,v.status,v.model,t.name AS name FROM norm_versions v JOIN templates t ON t.id=v.template_id WHERE price_book_id=$1 ORDER BY t.name,v.id",
      [bookId],
    )
  ).rows;
  const drafts = versions.filter((v) => v.status === "draft");
  const table = drafts.length ? await tableFor(bookId) : null;
  const check =
    table && job?.status !== "running" && book.status !== "archive"
      ? await transaction(async (tx) => {
          const r = await readiness(tx, bookId, true);
          return {
            readyCount: r.readyVersions.length,
            pendingCount: r.versions.length - r.readyVersions.length,
            issues: r.issues,
            overlaps: r.overlaps,
          };
        })
      : null;
  await db.query(
    "INSERT INTO audit_log(id,user_id,action,entity,metadata) VALUES($1,$2,'admin_price_read',$3,'{}')",
    [randomUUID(), req.user.id, bookId],
  );
  res.json({
    book,
    job,
    versions: versions.map((v) => ({
      ...v,
      model: { seedUnitSize: v.model.seedUnitSize },
    })),
    table,
    check,
    pilots: pilotTemplates,
  });
});
