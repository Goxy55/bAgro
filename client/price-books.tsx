import React, { useEffect, useRef, useState } from "react";
import { api } from "./api";
import type { PricingRow, PricingTable } from "../shared/pricing";
import { StipsPriceSuggestions } from "./price-suggestions";
import { todayInSerbia } from "../shared/dates";

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
const number = (v: string | null) =>
  v == null
    ? "—"
    : new Intl.NumberFormat("sr-Latn-RS", { maximumFractionDigits: 6 }).format(
        Number(v),
      );
const key = (r: PricingRow) => r.groupKey || r.key;
const mixed = (rows: PricingRow[]) =>
  new Set(
    rows
      .flatMap((r) => r.occurrences)
      .filter((o) => o.included && o.quantity !== "0")
      .map((o) => o.priceEur),
  ).size > 1;
function groups(rows: PricingRow[]) {
  const result = new Map<string, PricingRow[]>();
  for (const r of rows) {
    const k = key(r) + ":" + r.unit;
    result.set(k, [...(result.get(k) || []), r]);
  }
  return [...result.values()];
}
type Edit = {
  price: string;
  currency: "RSD" | "EUR";
  unit: string;
  zeroReason: string;
};
const base = (rows: PricingRow[]): Edit => {
  const inputs = rows.flatMap((r) => r.occurrences).map((o) => o.lastInput);
  const input = inputs[0];
  if (
    input &&
    inputs.every(
      (p) => p?.amount === input.amount && p.currency === input.currency,
    )
  )
    return {
      price: input.amount,
      currency: input.currency,
      unit: rows[0].unit,
      zeroReason:
        rows[0].occurrences.find((o) => o.zeroReason)?.zeroReason || "",
    };
  const prices = [...new Set(rows.map((r) => r.priceEur))];
  return {
    price: prices.length === 1 ? (prices[0] ?? "") : "",
    currency: prices.length === 1 && prices[0] !== null ? "EUR" : "RSD",
    unit: rows[0].unit,
    zeroReason: rows[0].occurrences.find((o) => o.zeroReason)?.zeroReason || "",
  };
};
export function PriceBooks({
  onDone,
  onEdit,
}: {
  onDone: () => Promise<void>;
  onEdit: (id: string) => void;
}) {
  const [catalog, setCatalog] = useState<any>({ books: [], legacy: [] }),
    [loaded, setLoaded] = useState(false),
    [book, setBook] = useState<any>(null),
    [table, setTable] = useState<PricingTable | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [create, setCreate] = useState(false),
    [edits, setEdits] = useState<Record<string, Edit>>({}),
    [date, setDate] = useState(todayInSerbia()),
    [reason, setReason] = useState(""),
    [query, setQuery] = useState(""),
    [onlyMissing, setOnlyMissing] = useState(true),
    [confirmUnits, setConfirmUnits] = useState(false),
    [confirmed, setConfirmed] = useState(false),
    [replace, setReplace] = useState(false),
    [check, setCheck] = useState<any>(null),
    [rzs, setRzs] = useState<any>(null);
  const requestId = useRef(crypto.randomUUID());
  async function refresh() {
    setCatalog(await api("/admin/price-books"));
    setLoaded(true);
    setRzs(await api("/admin/pricing/rzs-prices"));
  }
  useEffect(() => {
    void refresh().catch((e) => setError(e.message));
  }, []);
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
  async function open(id: string) {
    const r = await api("/admin/price-books/" + id);
    setBook(r.book);
    setTable(r.table);
    setEdits({});
    setCheck(null);
    setConfirmed(false);
    setConfirmUnits(false);
    setReplace(false);
    setCreate(false);
  }
  async function save(rows: any[], why: string) {
    if (!table) return;
    const r = await api(
      "/admin/pricing/table",
      {
        versionIds: table.versions.map((v) => v.id),
        revision: table.revision,
        date,
        reason: why,
        rows,
      },
      "PUT",
    );
    setTable(r.table);
    setEdits({});
    setCheck(null);
    setConfirmed(false);
    await onDone();
    setMessage(
      `Sačuvano u ${r.changedVersions} kultura / kategorija.${r.warnings.length ? " " + r.warnings.join(" ") : ""}`,
    );
  }
  const dirty = Object.keys(edits).length;
  return (
    <>
      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Jedan cenovnik za sva gazdinstva</h2>
            <p>
              Administrator unosi cenu inputa jednom. Sve kulture koriste svoje
              normative i zajednički odobrene cene.
            </p>
          </div>
          <button
            type="button"
            className="primary"
            disabled={busy || !!dirty}
            onClick={() => {
              setCreate(!create);
              requestId.current = crypto.randomUUID();
            }}
          >
            Novi cenovnik
          </button>
        </div>
        {!loaded && <p>Učitavanje cenovnika…</p>}
        <div className="price-book-list">
          {catalog.books.map((b: any) => (
            <button
              type="button"
              className={book?.id === b.id ? "secondary active" : "secondary"}
              key={b.id}
              disabled={busy || !!dirty}
              onClick={() => void run(() => open(b.id))}
            >
              <strong>{b.name}</strong>
              <small>
                {b.valid_from} — {b.valid_to} · {b.cultures} kultura ·{" "}
                {b.status === "draft"
                  ? "Nacrt"
                  : b.status === "active"
                    ? "Aktivan"
                    : "Arhiva"}
              </small>
            </button>
          ))}
        </div>
        {catalog.legacy.length > 0 && (
          <details>
            <summary>Preuzmi već unete nacrte u zajednički cenovnik</summary>
            <p>
              Cene i ispravke se zadržavaju. Kulture koje nedostaju dopunjavaju
              se iz kataloga, bez arhivskih cena.
            </p>
            {catalog.legacy.map((v: any) => (
              <button
                type="button"
                className="secondary"
                key={[v.name, v.valid_from, v.valid_to].join(":")}
                disabled={busy || !!dirty}
                onClick={() =>
                  void run(async () => {
                    const r = await api("/admin/price-books", {
                      requestId: crypto.randomUUID(),
                      name: v.name,
                      validFrom: v.valid_from,
                      validTo: v.valid_to,
                      reason:
                        "Objedinjavanje postojećih nacrta u zajednički cenovnik",
                      adoptExisting: true,
                    });
                    await refresh();
                    await open(r.id);
                    await onDone();
                  })
                }
              >
                {v.name} · {v.valid_from} — {v.valid_to} · Objedini nacrte
              </button>
            ))}
          </details>
        )}
        {(create || (!catalog.books.length && loaded)) && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const v = Object.fromEntries(new FormData(e.currentTarget));
              void run(async () => {
                const r = await api("/admin/price-books", {
                  ...v,
                  requestId: requestId.current,
                });
                requestId.current = crypto.randomUUID();
                await refresh();
                await open(r.id);
                await onDone();
                setMessage(
                  `Cenovnik obuhvata ceo katalog: ${r.cultures} kultura / kategorija. Unesite nedostajuće cene u zajedničkoj tabeli.`,
                );
              });
            }}
          >
            <h3>Novi cenovnik za ceo katalog</h3>
            <div className="form-grid">
              <label className="field">
                <span>Naziv cenovnika</span>
                <input
                  name="name"
                  aria-label="Naziv cenovnika"
                  required
                  maxLength={300}
                  placeholder="Npr. Referentni cenovnik 2026"
                />
              </label>
              <label className="field">
                <span>Razlog nove verzije</span>
                <input name="reason" required maxLength={300} />
              </label>
              <label className="field">
                <span>Važi od</span>
                <input
                  name="validFrom"
                  type="date"
                  defaultValue={`${Number(todayInSerbia().slice(0, 4))}-01-01`}
                  required
                />
              </label>
              <label className="field">
                <span>Važi do</span>
                <input
                  name="validTo"
                  type="date"
                  defaultValue={`${Number(todayInSerbia().slice(0, 4))}-12-31`}
                  required
                />
              </label>
            </div>
            <p className="hint">
              Sve kulture i oba stočarska intenziteta uključuju se automatski.
              Odobrene savremene cene mogu se preneti u nacrt; cene iz arhive
              2017 se ne aktiviraju.
            </p>
            <button className="primary" disabled={busy}>
              Pripremi kompletan cenovnik
            </button>
          </form>
        )}
      </section>
      {error && (
        <div className="form-error" role="alert">
          {error}
        </div>
      )}
      {message && (
        <div className="success" role="status">
          {message}
        </div>
      )}
      {book && !table && (
        <section className="panel">
          <h2>
            {book.name} ·{" "}
            {book.status === "active" ? "Aktivan cenovnik" : "Arhiva"}
          </h2>
          <p>
            {book.valid_from} — {book.valid_to}
          </p>
          <p>
            Gazdinstva automatski koriste odobrene normative za svoje kulture i
            period. Za promenu cena napravite novi cenovnik. Sačuvani izveštaji
            čuvaju prethodne iznose.
          </p>
          {book.status === "active" && (
            <button
              className="secondary"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await api(`/admin/price-books/${book.id}/archive`, {
                    reason: "Administrator je grupno arhivirao cenovnik",
                  });
                  await refresh();
                  await open(book.id);
                  await onDone();
                })
              }
            >
              Arhiviraj ceo cenovnik
            </button>
          )}
        </section>
      )}
      {book && table && (
        <>
          <section className="panel">
            <div className="panel-head">
              <div>
                <h2>{book.name}</h2>
                <p>
                  {table.validFrom} — {table.validTo} · ceo katalog ·{" "}
                  {table.versions.length} kultura / kategorija
                </p>
              </div>
              <span className="badge amber">Nacrt</span>
            </div>
            <p>
              Cene se raspoređuju na sve odgovarajuće karte. Seme različitih
              kultura i različite jedinice ostaju zasebne stavke.
            </p>
            <div className="toolbar">
              <button
                className="secondary"
                disabled={busy || !!dirty}
                onClick={() =>
                  void run(async () => {
                    const r = await api(
                      `/admin/price-books/${book.id}/reconcile-rates`,
                      {},
                    );
                    await open(book.id);
                    setMessage(
                      `Preračunato ${r.items} stavki koje su čekale kurs.`,
                    );
                    await onDone();
                  })
                }
              >
                Uskladi cene sa unetim kursevima
              </button>
              <button
                className="secondary"
                disabled={busy || !!dirty}
                onClick={() =>
                  void run(async () => {
                    const r = await api(
                      "/admin/pricing/rzs-prices/refresh",
                      {},
                    );
                    await refresh();
                    await open(book.id);
                    setMessage(
                      `RZS: preuzeto ${r.rows} godišnjih opažanja${r.reused ? "; original već postoji" : ""}.`,
                    );
                  })
                }
              >
                Preuzmi RZS dopunu cena
              </button>
            </div>
            <p className="hint">
              RZS:{" "}
              {rzs?.count
                ? `${rzs.count} opažanja, poslednja godina ${rzs.latest_year}`
                : "Nema preuzetih cena"}
              . Dopuna se nudi kada nema odgovarajuće STIPS cene. Godišnja
              otkupna cena zahteva potvrdu jedinice i primene kao reference
              inputa. Indeksi nisu jedinične cene.
            </p>
            <StipsPriceSuggestions
              key={book.id + ":" + (rzs?.document?.sha256 || "")}
              table={table}
              disabled={busy || !!dirty}
              onApply={(rows, why) => run(() => save(rows, why))}
            />
          </section>
          <form
            className="panel"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                const rows = groups(table.rows).flatMap((g) => {
                  const edit = edits[key(g[0]) + ":" + g[0].unit];
                  return edit
                    ? g.map((r) => ({
                        key: r.key,
                        ...edit,
                        price: edit.price === "" ? null : edit.price,
                        confirmUnit: units.includes(edit.unit),
                      }))
                    : [];
                });
                await save(rows, reason);
              });
            }}
          >
            <h2>Zajednička tabela inputa</h2>
            <p>Unesite nedostajuću cenu jednom, bez izbora kulture.</p>
            <div className="form-grid">
              <label className="field">
                <span>Pretraži inpute</span>
                <input
                  aria-label="Pretraži inpute"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </label>
              <label className="field">
                <span>Datum ručno unetih cena / kursa</span>
                <input
                  type="date"
                  aria-label="Datum zajedničkih cena"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  required
                />
              </label>
            </div>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={onlyMissing}
                onChange={(e) => setOnlyMissing(e.target.checked)}
              />
              <span>Samo nedostajuće ili neusaglašene cene</span>
            </label>
            <div
              className="table-scroll"
              role="region"
              tabIndex={0}
              aria-label="Zajednička tabela inputa"
            >
              <table className="book-inputs">
                <thead>
                  <tr>
                    <th>Input / obuhvat</th>
                    <th>Cena i valuta</th>
                    <th>Jedinica</th>
                    <th>Status / izvor</th>
                  </tr>
                </thead>
                <tbody>
                  {groups(table.rows)
                    .filter((g) =>
                      g.some((r) =>
                        r.name
                          .toLocaleLowerCase()
                          .includes(query.toLocaleLowerCase()),
                      ),
                    )
                    .filter(
                      (g) =>
                        !onlyMissing ||
                        edits[key(g[0]) + ":" + g[0].unit] ||
                        mixed(g) ||
                        g.some(
                          (r) =>
                            r.mixed ||
                            r.occurrences.some(
                              (o) =>
                                o.included &&
                                o.quantity !== "0" &&
                                o.priceEur === null,
                            ),
                        ),
                    )
                    .map((g) => {
                      const k = key(g[0]) + ":" + g[0].unit,
                        edit = edits[k] || base(g),
                        occ = g.flatMap((r) => r.occurrences),
                        input = occ.find((o) => o.lastInput)?.lastInput,
                        pending = occ.filter((o) => o.lastInput?.pendingRate);
                      const update = (v: Partial<Edit>) =>
                        setEdits((prev) => ({
                          ...prev,
                          [k]: { ...(prev[k] || base(g)), ...v },
                        }));
                      return (
                        <tr key={k}>
                          <td>
                            <strong>{g[0].name}</strong>
                            <small>
                              {new Set(occ.map((o) => o.templateId)).size}{" "}
                              kultura / kategorija
                            </small>
                            <details>
                              <summary>Gde se primenjuje</summary>
                              {[
                                ...new Set(
                                  occ.map(
                                    (o) =>
                                      table.versions.find(
                                        (v) => v.id === o.versionId,
                                      )?.name,
                                  ),
                                ),
                              ].join(", ")}
                            </details>
                          </td>
                          <td>
                            <input
                              aria-label={`Zajednička cena ${g[0].name}`}
                              type="number"
                              min="0"
                              step="any"
                              value={edit.price}
                              disabled={busy}
                              onChange={(e) =>
                                update({ price: e.target.value })
                              }
                            />
                            <select
                              aria-label={`Valuta inputa ${g[0].name}`}
                              value={edit.currency}
                              disabled={busy}
                              onChange={(e) =>
                                update({
                                  currency: e.target.value as "RSD" | "EUR",
                                })
                              }
                            >
                              <option>RSD</option>
                              <option>EUR</option>
                            </select>
                            {edit.price !== "" && Number(edit.price) === 0 && (
                              <input
                                aria-label={`Razlog nulte cene ${g[0].name}`}
                                placeholder="Obavezan razlog nulte cene"
                                required
                                value={edit.zeroReason}
                                onChange={(e) =>
                                  update({ zeroReason: e.target.value })
                                }
                              />
                            )}
                          </td>
                          <td>
                            <select
                              aria-label={`Jedinica inputa ${g[0].name}`}
                              value={edit.unit}
                              disabled={busy}
                              onChange={(e) => update({ unit: e.target.value })}
                            >
                              {!units.includes(edit.unit) && (
                                <option>{edit.unit}</option>
                              )}
                              {units.map((u) => (
                                <option key={u}>{u}</option>
                              ))}
                            </select>
                          </td>
                          <td>
                            {pending.length ? (
                              <>
                                <strong>Čeka kurs</strong>
                                {[
                                  ...new Set(
                                    pending.map((o) => o.lastInput!.date),
                                  ),
                                ].map((d) => (
                                  <small key={d}>
                                    Potreban NBS kurs za {d}
                                  </small>
                                ))}
                              </>
                            ) : occ.every(
                                (o) =>
                                  !o.included ||
                                  o.quantity === "0" ||
                                  o.priceEur !== null,
                              ) ? (
                              <span className="badge green">Cena postoji</span>
                            ) : (
                              <span className="badge amber">
                                Nedostaje cena
                              </span>
                            )}
                            {input?.reference && (
                              <a
                                href={input.reference.sourceUrl}
                                target="_blank"
                                rel="noreferrer"
                              >
                                {input.reference.kind === "rzs_purchase_price"
                                  ? "RZS · "
                                  : "STIPS · "}
                                {input.reference.product} ·{" "}
                                {input.reference.periodStart} · izvor ↗
                              </a>
                            )}
                            {mixed(g) && (
                              <small>
                                Različite cene u kartama — zajednički unos ih
                                usaglašava.
                              </small>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
            <label className="field">
              <span>Razlog izmene zajedničkih cena</span>
              <input
                aria-label="Razlog izmene svih cena"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                required
                maxLength={300}
              />
            </label>
            <div className="toolbar">
              <button className="primary" disabled={busy || !dirty}>
                Sačuvaj i rasporedi cene ({dirty})
              </button>
              <button
                type="button"
                className="secondary"
                disabled={busy || !dirty}
                onClick={() => setEdits({})}
              >
                Odbaci izmene
              </button>
            </div>
          </form>
          <section className="panel">
            <h2>Grupna provera i aktivacija</h2>
            <p>
              Jedna potvrda obuhvata ceo cenovnik. Nerešeni podaci ostaju
              vidljivi i sprečavaju aktivaciju; nijedna kultura se ne aktivira
              delimično.
            </p>
            <label className="checkbox">
              <input
                type="checkbox"
                aria-label="Potvrđujem jedinice celog cenovnika"
                checked={confirmUnits}
                disabled={busy || !!dirty}
                onChange={(e) => {
                  setConfirmUnits(e.target.checked);
                  setCheck(null);
                  setConfirmed(false);
                }}
              />
              <span>
                Pregledao sam sve jasne jedinice, izvorne normative i obračunske
                osnove celog cenovnika. Nejasne jedinice, hranidbene osnove i
                alternative rešavaju se posebno.
              </span>
            </label>
            <button
              type="button"
              className="secondary"
              disabled={busy || !!dirty}
              onClick={() =>
                void run(async () => {
                  setCheck(
                    await api(`/admin/price-books/${book.id}/check`, {
                      revision: table.revision,
                      confirmUnits,
                      reason: "Grupna provera cenovnika",
                    }),
                  );
                })
              }
            >
              Proveri ceo cenovnik
            </button>
            {check && (
              <>
                <p role="status">
                  {check.ready
                    ? "Cenovnik je kompletan i spreman za grupnu aktivaciju."
                    : `Pre aktivacije rešite ${check.issues.length} nalaza.`}
                </p>
                {check.issues.length > 0 && (
                  <div className="book-issues">
                    {table.versions
                      .filter((v) =>
                        check.issues.some((i: any) => i.versionId === v.id),
                      )
                      .map((v) => (
                        <details key={v.id}>
                          <summary>
                            {v.name} ·{" "}
                            {
                              check.issues.filter(
                                (i: any) => i.versionId === v.id,
                              ).length
                            }{" "}
                            nalaza
                          </summary>
                          <ul>
                            {check.issues
                              .filter((i: any) => i.versionId === v.id)
                              .map((i: any, n: number) => (
                                <li key={n}>{i.message}</li>
                              ))}
                          </ul>
                          <button
                            className="secondary"
                            disabled={busy}
                            onClick={() => onEdit(v.id)}
                          >
                            Reši posebnosti: {v.name}
                          </button>
                        </details>
                      ))}
                  </div>
                )}
                {check.overlaps.length > 0 && (
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      checked={replace}
                      onChange={(e) => setReplace(e.target.checked)}
                    />
                    <span>
                      Zameni i arhiviraj {check.overlaps.length} prethodnih
                      aktivnih verzija koje se preklapaju. Sačuvani istorijski
                      izveštaji zadržavaju prethodne iznose.
                    </span>
                  </label>
                )}
                {check.ready && (
                  <>
                    <label className="checkbox">
                      <input
                        type="checkbox"
                        aria-label="Odobravam ceo cenovnik"
                        checked={confirmed}
                        onChange={(e) => setConfirmed(e.target.checked)}
                      />
                      <span>
                        Odobravam cenovnik „{book.name}“ za sve prikazane
                        kulture i sva gazdinstva.
                      </span>
                    </label>
                    <button
                      className="primary"
                      disabled={
                        busy ||
                        !!dirty ||
                        !confirmed ||
                        !confirmUnits ||
                        (check.overlaps.length > 0 && !replace)
                      }
                      onClick={() =>
                        void run(async () => {
                          await api(`/admin/price-books/${book.id}/activate`, {
                            revision: table.revision,
                            confirmUnits,
                            confirmed,
                            replaceOverlaps: replace,
                            reason: "Grupno odobrenje cenovnika " + book.name,
                          });
                          await refresh();
                          await open(book.id);
                          await onDone();
                          setMessage(
                            "Ceo cenovnik je aktiviran. Gazdinstva koriste odobrene cene za odgovarajući period.",
                          );
                        })
                      }
                    >
                      Potvrdi i aktiviraj ceo cenovnik
                    </button>
                  </>
                )}
              </>
            )}
          </section>
        </>
      )}
    </>
  );
}
