import React, { useEffect, useRef, useState } from "react";
import { api } from "./api";
import type { PricingRow, PricingTable } from "../shared/pricing";
import { todayInSerbia } from "../shared/dates";
const n = (v: any) =>
  v == null
    ? "—"
    : new Intl.NumberFormat("sr-Latn-RS", { maximumFractionDigits: 6 }).format(
        Number(v),
      );
const units = [
  "kg",
  "t",
  "l",
  "kom",
  "biljka",
  "grlo",
  "vreća",
  "ha",
  "m2",
  "sj",
  "usluga",
  "sat",
  "kwh",
];
type Edit = { price: string; unit: string; zeroReason: string };
const needed = (r: PricingRow) =>
  r.occurrences.some(
    (o) => o.included && (o.quantity == null || Number(o.quantity) > 0),
  );
export function PriceBooks({
  onDone,
  onEdit,
}: {
  onDone: () => Promise<void>;
  onEdit: (id: string) => void;
}) {
  const [catalog, setCatalog] = useState<any>({ books: [], legacy: [] }),
    [view, setView] = useState<any>(null),
    [create, setCreate] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [fuel, setFuel] = useState(""),
    [seed, setSeed] = useState<Record<string, string>>({}),
    [edits, setEdits] = useState<Record<string, Edit>>({}),
    [confirmed, setConfirmed] = useState(false),
    [replace, setReplace] = useState(false),
    [query, setQuery] = useState(""),
    [missing, setMissing] = useState(true);
  const requestId = useRef(crypto.randomUUID()),
    selected = useRef("");
  const table: PricingTable | null = view?.table || null,
    running = view?.job?.status === "running",
    dirty = Object.keys(edits).length;
  const refresh = async () => setCatalog(await api("/admin/price-books"));
  async function open(id: string, reset = true) {
    selected.current = id;
    const result = await api(`/admin/price-books/${id}/workbench`);
    if (selected.current !== id) return;
    setView(result);
    if (reset) {
      setEdits({});
      setConfirmed(false);
      setReplace(false);
      setCreate(false);
      const r = result.table?.rows.find(
        (r: PricingRow) => r.pricingGroup === "diesel",
      );
      const input = r?.occurrences.find(
        (o: any) => o.lastInput?.currency === "RSD",
      )?.lastInput;
      setFuel(
        input?.amount ||
          (result.table?.currency === "RSD" ? r?.price : "") ||
          "",
      );
      setSeed(
        Object.fromEntries(
          result.versions
            .filter((v: any) => v.model.seedUnitSize)
            .map((v: any) => [v.template_id, String(v.model.seedUnitSize)]),
        ),
      );
    }
  }
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void refresh().catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    if (!running) return;
    let stopped = false;
    const timer = setInterval(() => {
      const id = selected.current;
      if (!stopped)
        void api(`/admin/price-books/${id}/preparation`)
          .then(async (r) => {
            if (!stopped && selected.current === id) {
              if (r.job?.status !== "running") {
                await open(id, false);
                await refresh();
                await onDone();
              } else setView((old: any) => ({ ...old, job: r.job }));
            }
          })
          .catch((e) => {
            if (!stopped) setError(e.message);
          });
    }, 2000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [running]);
  function edit(r: PricingRow, value: Partial<Edit>) {
    const k = (r.groupKey || r.key) + ":" + r.unit;
    setEdits((old) => ({
      ...old,
      [k]: {
        ...(old[k] || {
          price: r.price || "",
          unit: r.unit,
          zeroReason: r.occurrences.find((o) => o.zeroReason)?.zeroReason || "",
        }),
        ...value,
      },
    }));
    setConfirmed(false);
  }
  async function save() {
    if (!table) return;
    const rows = table.rows.flatMap((r) => {
      const e = edits[(r.groupKey || r.key) + ":" + r.unit];
      return e
        ? [
            {
              key: r.key,
              price: e.price === "" ? null : e.price.replace(",", "."),
              currency: table.currency,
              unit: e.unit,
              confirmUnit: true,
              zeroReason: e.zeroReason,
            },
          ]
        : [];
    });
    await api(
      "/admin/pricing/table",
      {
        versionIds: table.versions.map((v) => v.id),
        revision: table.revision,
        date: todayInSerbia(),
        reason: "Admin pregled zajedničkog cenovnika — ručna izmena",
        rows,
      },
      "PUT",
    );
    await open(view.book.id, false);
    setEdits({});
    setConfirmed(false);
    await onDone();
    setMessage(
      "Izmene su raspoređene na sve nacrte ovog cenovnika koji koriste isti input i jedinicu.",
    );
  }
  const editable = !busy && !running;
  const grouped = new Map<string, PricingRow>();
  for (const r of table?.rows || []) {
    if (r.pricingGroup === "diesel" || !needed(r)) continue;
    const key = (r.groupKey || r.key) + ":" + r.unit;
    if (!grouped.has(key)) grouped.set(key, r);
  }
  const editRow = (r: PricingRow) => {
    const k = (r.groupKey || r.key) + ":" + r.unit,
      e = edits[k] || {
        price: r.price || "",
        unit: r.unit,
        zeroReason: r.occurrences.find((o) => o.zeroReason)?.zeroReason || "",
      };
    const reference: any = r.occurrences.find((o) => o.lastInput?.reference)
      ?.lastInput?.reference;
    return (
      <tr key={r.key}>
        <td>
          <strong>{r.name}</strong>
          {reference ? (
            <small>
              <a href={reference.sourceUrl} target="_blank" rel="noreferrer">
                {reference.proxy
                  ? "Zamenska cenovna referenca"
                  : reference.kind === "public_input"
                    ? "Javni cenovnik"
                    : reference.kind === "rzs_purchase_price"
                      ? "RZS referenca"
                      : "STIPS referenca"}{" "}
                · {reference.product}
              </a>
              <br />
              {reference.place} · {reference.periodStart}
              {reference.checkedAt
                ? ` · provereno ${new Date(reference.checkedAt).toLocaleDateString("sr-Latn-RS")}`
                : ""}
              <br />
              {reference.priceBasis || reference.priceType}
              {reference.proxy && (
                <> · originalni normativ i količina ostaju sačuvani</>
              )}
            </small>
          ) : (
            <small>
              {r.price == null
                ? "Nema potvrđene cene — unesite cenu ili proverite izvor."
                : "Admin cena / preneta dokumentovana cena"}
            </small>
          )}
        </td>
        <td>
          <label className="field">
            <span className="sr-only">
              Cena ({table?.currency}/{e.unit})
            </span>
            <input
              aria-label={`Cena ${r.name}`}
              inputMode="decimal"
              value={e.price}
              disabled={!editable}
              onChange={(v) => edit(r, { price: v.target.value })}
            />
          </label>
          {e.price === "0" && (
            <label className="field">
              <span>Razlog nulte cene</span>
              <input
                value={e.zeroReason}
                onChange={(v) => edit(r, { zeroReason: v.target.value })}
              />
            </label>
          )}
        </td>
        <td>
          {units.includes(r.unit) ? (
            r.unit
          ) : (
            <label className="field">
              <span>Potvrdite jedinicu</span>
              <select
                aria-label={`Jedinica ${r.name}`}
                value={e.unit}
                disabled={!editable}
                onChange={(v) => edit(r, { unit: v.target.value })}
              >
                <option value={r.unit}>{r.unit}</option>
                {units.map((u) => (
                  <option key={u}>{u}</option>
                ))}
              </select>
            </label>
          )}
        </td>
      </tr>
    );
  };
  const productionCards = (priority: boolean) =>
    (table?.versions || [])
      .filter((v) => view.pilots.includes(v.templateId) === priority)
      .map((v) => {
        const issues =
            view.check?.issues.filter((i: any) => i.versionId === v.id) || [],
          rows = table!.rows.filter((r) =>
            r.occurrences.some((o) => o.versionId === v.id),
          );
        return (
          <details key={v.id}>
            <summary>
              <strong>{v.name}</strong>
              <span>
                {issues.length
                  ? `${issues.length} stavki za dopunu`
                  : "Spremno"}{" "}
                · poznati trošak {n(v.knownCost)} {table!.currency} /{" "}
                {n(v.reference)}{" "}
                {(
                  {
                    ha: "ha",
                    m2: "m²",
                    seedlings: "biljaka",
                    bag: "vreća",
                    head_year: "grlo/godina",
                    head_cycle: "grlo/ciklus",
                  } as Record<string, string>
                )[v.basis] || v.basis}
              </span>
            </summary>
            {issues.length > 0 && (
              <ul>
                {issues.map((i: any, j: number) => (
                  <li key={j}>{i.message}</li>
                ))}
              </ul>
            )}
            <div className="table-wrap">
              <table className="price-entry-table">
                <thead>
                  <tr>
                    <th>Input / izvor</th>
                    <th>{table!.currency}/jedinici</th>
                    <th>Jedinica</th>
                  </tr>
                </thead>
                <tbody>
                  {rows
                    .filter((r) => r.pricingGroup !== "diesel" && needed(r))
                    .map(editRow)}
                </tbody>
              </table>
            </div>
            <p>
              Cena istog inputa menja se zajednički i za ostale nacrte.
              Originalni preparati i normirane količine ostaju sačuvani.
            </p>
            <button
              className="secondary"
              disabled={!!dirty || !editable}
              onClick={() => onEdit(v.id)}
            >
              Otvori detalj normativa i alternative
            </button>
          </details>
        );
      });
  return (
    <>
      <section className="panel price-workbench">
        <div className="panel-head">
          <div>
            <h2>Pripremi troškovnik</h2>
            <p>
              Jedan cenovnik za sva gazdinstva. Cene se raspoređuju po izvornim
              normativima; vi pregledate i potvrđujete spremne proizvodnje.
            </p>
          </div>
          <button
            className="primary"
            disabled={busy || running || !!dirty}
            onClick={() => {
              setCreate(!create);
              requestId.current = crypto.randomUUID();
            }}
          >
            Novi cenovnik
          </button>
        </div>
        {error && (
          <p className="alert" role="alert">
            {error}
          </p>
        )}
        {message && (
          <p className="notice" role="status">
            {message}
          </p>
        )}
        {create && (
          <form
            className="price-create"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void run(async () => {
                const b = await api("/admin/price-books", {
                  requestId: requestId.current,
                  name: f.get("name"),
                  validFrom: f.get("from"),
                  validTo: f.get("to"),
                  reason: "Priprema zajedničkog dinarskog cenovnika",
                  currency: "RSD",
                });
                await refresh();
                await open(b.id);
              });
            }}
          >
            <label className="field">
              <span>Naziv cenovnika</span>
              <input
                name="name"
                required
                defaultValue={`Cenovnik ${todayInSerbia().slice(0, 4)}`}
                maxLength={300}
              />
            </label>
            <label className="field">
              <span>Važi od</span>
              <input
                name="from"
                type="date"
                required
                defaultValue={todayInSerbia().slice(0, 4) + "-01-01"}
              />
            </label>
            <label className="field">
              <span>Važi do</span>
              <input
                name="to"
                type="date"
                required
                defaultValue={todayInSerbia().slice(0, 4) + "-12-31"}
              />
            </label>
            <button className="primary" disabled={busy}>
              Kreiraj dinarski cenovnik
            </button>
          </form>
        )}
        <div className="price-book-list">
          {catalog.books.map((b: any) => (
            <button
              key={b.id}
              className={view?.book.id === b.id ? "selected" : ""}
              disabled={busy || running || !!dirty}
              onClick={() => void run(() => open(b.id))}
            >
              <strong>
                {b.name} · {b.currency}
              </strong>
              <small>
                {b.valid_from} — {b.valid_to} · {b.approved} aktivnih ·{" "}
                {b.pending} nacrta{b.status === "archive" ? " · arhiva" : ""}
              </small>
            </button>
          ))}
        </div>
        {!catalog.books.length && !create && (
          <p>
            Napravite novi dinarski cenovnik. Izvorne cene iz 2017. ostaju
            arhiva.
          </p>
        )}
      </section>
      {view && (
        <section className="panel price-workbench">
          <div className="panel-head">
            <div>
              <h2>{view.book.name}</h2>
              <p>
                {view.book.valid_from} — {view.book.valid_to} ·{" "}
                {view.book.currency}
                {view.book.currency === "RSD"
                  ? " · Kurs nije uslov za dinarski obračun."
                  : " · Stariji EUR cenovnik. Za rad bez kursa napravite novi RSD cenovnik."}
              </p>
            </div>
          </div>
          {table && (
            <>
              <div className="price-prepare-controls">
                <label className="field">
                  <span>Gorivo — jedna cena za sve operacije (RSD/l)</span>
                  <input
                    aria-label="Zajednička cena goriva RSD/l"
                    inputMode="decimal"
                    value={fuel}
                    disabled={!editable}
                    onChange={(e) => setFuel(e.target.value)}
                  />
                  <small>
                    Za potvrđenu potrošnju goriva; količine po kulturi se ne
                    menjaju. Prazno polje čuva postojeću cenu. Cena goriva se
                    čuva pri pripremi cena iz izvora.
                  </small>
                </label>
                <button
                  className="primary"
                  disabled={!editable || !!dirty}
                  onClick={() =>
                    void run(async () => {
                      await api(`/admin/price-books/${view.book.id}/prepare`, {
                        revision: table.revision,
                        ...(fuel ? { fuel: fuel.replace(",", ".") } : {}),
                        seedUnits: Object.fromEntries(
                          Object.entries(seed).filter(([, v]) => v),
                        ),
                      });
                      await open(view.book.id, false);
                    })
                  }
                >
                  {running ? "Priprema je u toku…" : "Pripremi cene iz izvora"}
                </button>
              </div>
              <details>
                <summary>Osnova pakovanja semena (SJ)</summary>
                <p>
                  Za cenu pakovanja u broju semena potreban je potvrđen broj
                  semena po jednoj izvornoj SJ. Bez tog podatka ostaje moguć
                  ručni unos RSD/SJ.
                </p>
                {table.versions
                  .filter((v) =>
                    table.rows.some(
                      (r) =>
                        r.cultureSpecific &&
                        (r.unit === "sj" || /seme\s*\(sj\)/i.test(r.name)) &&
                        r.occurrences.some((o) => o.versionId === v.id),
                    ),
                  )
                  .map((v) => (
                    <label className="field" key={v.id}>
                      <span>{v.culture} — semena u 1 SJ</span>
                      <input
                        inputMode="numeric"
                        value={seed[v.templateId] || ""}
                        disabled={!editable}
                        onChange={(e) =>
                          setSeed({ ...seed, [v.templateId]: e.target.value })
                        }
                      />
                    </label>
                  ))}
              </details>
              <p>
                Izvori: STIPS, RZS i javni cenovnici Ratar, Poljokomerc i
                Hemoslavija. Cene različitih mesta, pakovanja i godišnjih otkupa
                ostaju označene svojim obuhvatom. Zamenska cena zahteva
                dokumentovan jednak sastav, koncentraciju i odgovarajuću
                jedinicu.
              </p>
            </>
          )}
          {view.job && (
            <div role="status" aria-live="polite">
              <p className={view.job.status === "failed" ? "alert" : "notice"}>
                {view.job.progress || "Priprema počinje…"}
              </p>
              {view.job.warnings?.length > 0 && (
                <details>
                  <summary>
                    Napomene izvora ({view.job.warnings.length})
                  </summary>
                  <ul>
                    {view.job.warnings.map((w: string, i: number) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}
          {table && !running && (
            <>
              <div className="price-readiness">
                <strong>
                  {view.check?.readyCount || 0} spremnih za potvrdu
                </strong>
                <span>
                  {view.check?.pendingCount || 0} sa preostalim podacima
                </span>
                <span>
                  {
                    view.versions.filter((v: any) => v.status === "active")
                      .length
                  }{" "}
                  aktivnih
                </span>
              </div>
              <details open>
                <summary>
                  Nedostajuće cene — zajednički unos (
                  {
                    [...grouped.values()].filter(
                      (r) => r.price == null || r.mixed,
                    ).length
                  }
                  )
                </summary>
                <div className="filter-row">
                  <label className="field">
                    <span>Pretraga inputa</span>
                    <input
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={missing}
                      onChange={(e) => setMissing(e.target.checked)}
                    />{" "}
                    Samo nedostajuće ili neusaglašene cene
                  </label>
                </div>
                <div className="table-wrap">
                  <table className="price-entry-table">
                    <thead>
                      <tr>
                        <th>Input i poreklo cene</th>
                        <th>{table.currency}/jedinici</th>
                        <th>Jedinica</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...grouped.values()]
                        .filter(
                          (r) =>
                            (!missing || r.price == null || r.mixed) &&
                            r.name
                              .toLocaleLowerCase()
                              .includes(query.toLocaleLowerCase()),
                        )
                        .map(editRow)}
                    </tbody>
                  </table>
                </div>
                {dirty > 0 && (
                  <button
                    className="primary"
                    disabled={!editable}
                    onClick={() => void run(save)}
                  >
                    Sačuvaj zajedničke izmene ({dirty})
                  </button>
                )}
              </details>
              <h3>Proizvodnje — pregled i izuzeci</h3>
              <p>
                Prve testne kulture su na vrhu. Proširite samo proizvodnju koju
                želite da pregledate ili izmenite.
              </p>
              <div className="production-price-list">
                {productionCards(true)}
                {table.versions.some(
                  (v) => !view.pilots.includes(v.templateId),
                ) && (
                  <details>
                    <summary>
                      Ostale proizvodnje (
                      {
                        table.versions.filter(
                          (v) => !view.pilots.includes(v.templateId),
                        ).length
                      }
                      )
                    </summary>
                    {productionCards(false)}
                  </details>
                )}
              </div>
              <div className="price-approval">
                <label>
                  <input
                    type="checkbox"
                    checked={confirmed}
                    disabled={!editable || !!dirty}
                    onChange={(e) => setConfirmed(e.target.checked)}
                  />{" "}
                  Pregledao/la sam izvore, jedinice, odabrane alternative i
                  osnovu obračuna spremnih proizvodnji. Potvrđujem predložene
                  cenovne reference.
                </label>
                {view.check?.overlaps.length > 0 && (
                  <label>
                    <input
                      type="checkbox"
                      checked={replace}
                      onChange={(e) => setReplace(e.target.checked)}
                    />{" "}
                    Zamenjujem prethodne aktivne verzije za iste proizvodnje i
                    period. Snimljeni obračuni ostaju nepromenjeni.
                  </label>
                )}
                <button
                  className="primary"
                  disabled={
                    !editable ||
                    !!dirty ||
                    !confirmed ||
                    !view.check?.readyCount ||
                    (view.check.overlaps.length > 0 && !replace)
                  }
                  onClick={() =>
                    void run(async () => {
                      const r = await api(
                        `/admin/price-books/${view.book.id}/activate`,
                        {
                          revision: table.revision,
                          confirmUnits: true,
                          confirmed: true,
                          replaceOverlaps: replace,
                          reason:
                            "Grupna potvrda spremnih proizvodnji i pregled cenovnih referenci",
                        },
                      );
                      await open(view.book.id);
                      await refresh();
                      await onDone();
                      setMessage(
                        `Aktivirano ${r.cultures} proizvodnji. ${r.remaining} ostaje u nacrtu za dopunu.`,
                      );
                    })
                  }
                >
                  Potvrdi spremne proizvodnje ({view.check?.readyCount || 0})
                </button>
                <p>
                  Nepotpune proizvodnje ostaju u nacrtu. Normativni trošak ne
                  predstavlja plaćanje niti kompletnu cenu koštanja.
                </p>
              </div>
            </>
          )}
          {!table && (
            <p>
              Cenovnik nema preostale nacrte. Aktivne verzije se koriste u
              obračunima; za promenu cena kreirajte novi cenovnik.
            </p>
          )}
          {view.versions.some((v: any) => v.status !== "draft") && (
            <details>
              <summary>Potvrđene i arhivirane proizvodnje</summary>
              <ul>
                {view.versions
                  .filter((v: any) => v.status !== "draft")
                  .map((v: any) => (
                    <li key={v.id}>
                      {v.name} · {v.status === "active" ? "aktivna" : "arhiva"}
                    </li>
                  ))}
              </ul>
            </details>
          )}
        </section>
      )}
    </>
  );
}
