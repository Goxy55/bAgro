import React, { useEffect, useState } from "react";
import Decimal from "decimal.js";
import { api } from "./api";
import type { PricingTable } from "../shared/pricing";
import type {
  PriceSuggestion,
  PriceSuggestionRow,
  PriceSuggestions,
} from "../shared/price-suggestions";

const Money = Decimal.clone({ precision: 36, rounding: Decimal.ROUND_HALF_UP });
const number = (value: string) =>
  new Intl.NumberFormat("sr-Latn-RS", { maximumFractionDigits: 6 }).format(
    Number(value),
  );
const groupKey = (row: PriceSuggestionRow) => row.groupKey + ":" + row.unit;
function grouped(rows: PriceSuggestionRow[]) {
  const groups = new Map<string, PriceSuggestionRow[]>();
  for (const r of rows)
    groups.set(groupKey(r), [...(groups.get(groupKey(r)) || []), r]);
  return [...groups.values()];
}
type Choice = { id: string; divisor: string; enabled: boolean };
export function StipsPriceSuggestions({
  table,
  disabled,
  onApply,
}: {
  table: PricingTable;
  disabled: boolean;
  onApply: (rows: any[], reason: string) => Promise<void>;
}) {
  const [asOf, setAsOf] = useState(
      () => [table.validTo, new Date().toISOString().slice(0, 10)].sort()[0],
    ),
    [place, setPlace] = useState(""),
    [includeExisting, setIncludeExisting] = useState(false),
    [preview, setPreview] = useState<PriceSuggestions | null>(null),
    [choices, setChoices] = useState<Record<string, Choice>>({}),
    [accepted, setAccepted] = useState(false),
    [historical, setHistorical] = useState(false),
    [filter, setFilter] = useState("suggestions"),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let active = true;
    if (!asOf || asOf.length !== 10) return;
    setLoading(true);
    setError("");
    setAccepted(false);
    setHistorical(false);
    api("/admin/pricing/stips-suggestions", {
      versionIds: table.versions.map((v) => v.id),
      revision: table.revision,
      asOf,
      place: place || undefined,
      includeExisting,
    })
      .then((p: PriceSuggestions) => {
        if (!active) return;
        setPreview(p);
        setFilter(
          p.rows.some((r) => r.candidates.length)
            ? "suggestions"
            : p.rows.some((r) => r.status === "filled")
              ? "filled"
              : "missing",
        );
        setChoices(
          Object.fromEntries(
            p.rows.map((r) => {
              const c = r.candidates.find(
                (c) => c.observationId === r.selectedId,
              );
              return [
                r.key,
                {
                  id: c?.observationId || "",
                  divisor: c?.unitsPerPrice || "",
                  enabled: !!c && !c.historical,
                },
              ];
            }),
          ),
        );
      })
      .catch((e) => {
        if (active) {
          setError(e.message);
          setPreview(null);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [table.revision, asOf, place, includeExisting, refresh]);
  const selected =
    preview?.rows.flatMap((r) => {
      const choice = choices[r.key],
        candidate = r.candidates.find((c) => c.observationId === choice?.id);
      return candidate && choice?.enabled
        ? [{ row: r, candidate, choice }]
        : [];
    }) || [];
  const historicalOffered = preview?.rows.some((r) =>
    r.candidates.some((c) => c.historical),
  );
  const old = selected.some((s) => s.candidate.historical),
    invalid = selected.some((s) => !validDivisor(s.choice.divisor));
  const working = disabled || loading;
  function choose(key: string, c: PriceSuggestion | undefined) {
    const row = preview?.rows.find((r) => r.key === key);
    if (!row) return;
    setChoices((v) => {
      const next = { ...v };
      for (const r of preview!.rows.filter(
        (r) => groupKey(r) === groupKey(row),
      )) {
        const same = r.candidates.find(
          (candidate) => candidate.observationId === c?.observationId,
        );
        if (!c || same)
          next[r.key] = {
            id: same?.observationId || "",
            divisor: same?.unitsPerPrice || "",
            enabled: !!same,
          };
      }
      return next;
    });
    setAccepted(false);
  }
  function editGroup(row: PriceSuggestionRow, patch: Partial<Choice>) {
    setChoices((v) => {
      const next = { ...v };
      for (const r of preview!.rows.filter(
        (r) => groupKey(r) === groupKey(row),
      ))
        if (v[r.key]?.id === v[row.key]?.id)
          next[r.key] = { ...v[r.key], ...patch };
      return next;
    });
    setAccepted(false);
  }
  async function apply() {
    if (
      !preview ||
      !accepted ||
      !selected.length ||
      invalid ||
      (old && !historical) ||
      working
    )
      return;
    const reason = `STIPS referentne cene — ${preview.place}, izbor do ${preview.asOf}`;
    await onApply(
      selected.map(({ row, candidate: c, choice }) => ({
        key: row.key,
        price: new Money(c.originalPrice)
          .div(choice.divisor)
          .toDecimalPlaces(12)
          .toString(),
        currency: "RSD",
        unit: c.unit,
        confirmUnit: true,
        zeroReason: "",
        reference: {
          observationId: c.observationId,
          unitsPerPrice: choice.divisor,
          date: c.date,
          confirmedProduct: true,
          confirmedBasis: true,
          allowHistorical: c.historical && historical,
          note: `${reason}. Administrator je grupno potvrdio proizvod i osnovu: izvorna cena za ${choice.divisor} ${c.unit}.`,
        },
      })),
      reason,
    );
  }
  return (
    <section
      className="stips-suggestions"
      aria-labelledby="stips-suggestions-title"
    >
      <div className="panel-head">
        <div>
          <h3 id="stips-suggestions-title">Popuni cene iz STIPS-a</h3>
          <p>
            Prepoznate stavke dobijaju predlog cene. Potvrđene veze pamte se za
            sledeći cenovnik.
          </p>
        </div>
        <button
          type="button"
          className="secondary"
          disabled={working}
          onClick={() => setRefresh((n) => n + 1)}
        >
          Ponovi prepoznavanje
        </button>
      </div>
      <div className="form-grid">
        <label className="field">
          <span>Cene dostupne do</span>
          <input
            aria-label="STIPS cene do datuma"
            type="date"
            value={asOf}
            max={new Date().toISOString().slice(0, 10)}
            disabled={working}
            onChange={(e) => setAsOf(e.target.value)}
          />
        </label>
        <label className="field">
          <span>Referentno mesto</span>
          <select
            aria-label="Referentno mesto STIPS cena"
            value={place || preview?.place || ""}
            disabled={working || !preview?.places.length}
            onChange={(e) => setPlace(e.target.value)}
          >
            {!preview?.places.length && (
              <option value="">Nema preuzetih cena</option>
            )}
            {preview?.places.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </label>
      </div>
      <label className="checkbox">
        <input
          type="checkbox"
          aria-label="Ponudi zamenu postojećih cena"
          checked={includeExisting}
          disabled={working}
          onChange={(e) => setIncludeExisting(e.target.checked)}
        />
        <span>Ponudi i zamenu postojećih cena u nacrtima</span>
      </label>
      <p className="hint">
        Koristi se najnoviji raspoloživi mesec svakog proizvoda do izabranog
        datuma, za prikazano mesto. To su lokalne referentne cene. Datum kursa
        je prikazan uz svaku cenu; datum objave nije potvrđen. Osnova pakovanja
        je predlog koji potvrđujete pre primene.
      </p>
      {disabled && (
        <p className="hint">Prvo sačuvajte ili odbacite izmene ručnog unosa.</p>
      )}
      {loading && <p role="status">Prepoznajem stavke i pakovanja…</p>}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {preview && !loading && (
        <>
          <div className="tabs" aria-label="Pregled STIPS povezivanja">
            {[
              [
                "suggestions",
                "Predlozi",
                grouped(preview.rows.filter((r) => r.candidates.length)).length,
              ],
              [
                "missing",
                "Bez STIPS cene",
                grouped(preview.rows.filter((r) => r.status === "missing"))
                  .length,
              ],
              [
                "filled",
                "Već popunjene",
                grouped(preview.rows.filter((r) => r.status === "filled"))
                  .length,
              ],
            ].map(([key, label, count]) => (
              <button
                key={key}
                type="button"
                className={filter === key ? "active" : ""}
                onClick={() => setFilter(String(key))}
              >
                {label} ({count})
              </button>
            ))}
          </div>
          <div
            className="table-scroll"
            role="region"
            aria-label="STIPS predlozi cena po vrstama troška"
            tabIndex={0}
          >
            <table className="suggestions-table">
              <thead>
                <tr>
                  <th scope="col">Stavka troškovnika</th>
                  <th scope="col">STIPS proizvod i pakovanje</th>
                  <th scope="col">Referentna cena</th>
                  <th scope="col">Primena / status</th>
                </tr>
              </thead>
              <tbody>
                {grouped(
                  preview.rows.filter((r) =>
                    filter === "suggestions"
                      ? r.candidates.length
                      : filter === "missing"
                        ? r.status === "missing"
                        : r.status === "filled",
                  ),
                ).map((group) => {
                  const r = group[0],
                    keys = new Set(group.map((r) => r.key)),
                    currents = table.rows.filter((t) => keys.has(t.key)),
                    mixed =
                      currents.some((t) => t.mixed) ||
                      new Set(
                        currents.map((t) =>
                          JSON.stringify([
                            t.priceEur,
                            t.occurrences[0]?.lastInput?.amount,
                            t.occurrences[0]?.lastInput?.currency,
                          ]),
                        ),
                      ).size > 1;
                  const choice = choices[r.key],
                    c = r.candidates.find(
                      (c) => c.observationId === choice?.id,
                    ),
                    current = table.rows.find((t) => t.key === r.key),
                    saved = current?.occurrences.find(
                      (o) => o.lastInput,
                    )?.lastInput;
                  return (
                    <tr key={r.key} data-suggestion-row={r.key}>
                      <th scope="row">
                        <strong>{r.name}</strong>
                        {group.length > 1 && (
                          <details>
                            <summary>Izvornih stavki: {group.length}</summary>
                            {group.map((r) => (
                              <small key={r.key}>{r.name}</small>
                            ))}
                          </details>
                        )}
                        <small>
                          {
                            new Set(
                              currents.flatMap((t) =>
                                t.occurrences.map((o) => o.versionId),
                              ),
                            ).size
                          }{" "}
                          kultura / kategorija
                        </small>
                      </th>
                      <td>
                        {r.candidates.length ? (
                          <>
                            <select
                              aria-label={`STIPS proizvod za ${r.name}`}
                              value={choice?.id || ""}
                              disabled={working}
                              onChange={(e) =>
                                choose(
                                  r.key,
                                  r.candidates.find(
                                    (c) => c.observationId === e.target.value,
                                  ),
                                )
                              }
                            >
                              <option value="">
                                Izaberite predlog ({r.candidates.length})
                              </option>
                              {r.candidates.map((c) => (
                                <option
                                  key={c.observationId}
                                  value={c.observationId}
                                >
                                  {c.product} ·{" "}
                                  {c.manufacturer ||
                                    "bez navedenog proizvođača"}{" "}
                                  · {c.packaging} · {c.periodStart.slice(0, 7)}
                                </option>
                              ))}
                            </select>
                            {c && (
                              <>
                                <small>
                                  {c.place} · {c.periodStart.slice(0, 7)} ·{" "}
                                  {number(c.originalPrice)} RSD za izvorno
                                  pakovanje {c.packaging}
                                </small>
                                <a
                                  href={c.sourceUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  Izvor: {c.sheet}!{c.cell}
                                </a>
                                <details>
                                  <summary>Osnova pakovanja</summary>
                                  <label className="field">
                                    <span>
                                      Izvorna cena važi za koliko {c.unit}?
                                    </span>
                                    <input
                                      aria-label={`Osnova STIPS cene za ${r.name}`}
                                      type="number"
                                      min="0.000000001"
                                      step="any"
                                      value={choice.divisor}
                                      disabled={working}
                                      onChange={(e) => {
                                        editGroup(r, {
                                          divisor: e.target.value,
                                        });
                                      }}
                                    />
                                  </label>
                                  <small>
                                    Prikazana količina se koristi kao delilac.
                                    Ispravite ako cena u izvoru važi za drugu
                                    osnovu.
                                  </small>
                                </details>
                              </>
                            )}
                          </>
                        ) : saved?.reference ? (
                          <>
                            <strong>{saved.reference.product}</strong>
                            <small>
                              {saved.reference.place} ·{" "}
                              {saved.reference.periodStart.slice(0, 7)}
                            </small>
                            <a
                              href={saved.reference.sourceUrl}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Izvor sačuvane cene
                            </a>
                          </>
                        ) : (
                          <span>{r.message}</span>
                        )}
                      </td>
                      <td>
                        {c && validDivisor(choice.divisor) ? (
                          <>
                            <strong>
                              {number(
                                new Money(c.originalPrice)
                                  .div(choice.divisor)
                                  .toDecimalPlaces(12)
                                  .toString(),
                              )}{" "}
                              RSD/{c.unit}
                            </strong>
                            <small>Datum kursa: {c.date}</small>
                            {c.pendingRate && (
                              <small className="pending-price">
                                Čeka NBS kurs — RSD se čuva, EUR ostaje nepotpun
                              </small>
                            )}
                            {c.historical && (
                              <small className="pending-price">
                                Starija referentna cena
                              </small>
                            )}
                          </>
                        ) : r.status === "filled" && mixed ? (
                          <small>
                            Različite cene — otvorite detalj po kulturama
                          </small>
                        ) : r.status === "filled" ? (
                          <>
                            {saved && (
                              <strong>
                                {number(saved.amount)} {saved.currency}/
                                {current?.unit}
                              </strong>
                            )}
                            {current?.priceEur !== null &&
                              current?.priceEur !== undefined && (
                                <small>
                                  {number(current.priceEur)} EUR/
                                  {current.unit}
                                </small>
                              )}
                            {current?.mixed && (
                              <small>
                                Različite cene — otvorite detalj po kulturama
                              </small>
                            )}
                            {saved?.pendingRate && (
                              <small className="pending-price">
                                Čeka NBS kurs za {saved.date}
                              </small>
                            )}
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td>
                        {c && (
                          <label className="checkbox">
                            <input
                              type="checkbox"
                              aria-label={`Primeni STIPS cenu za ${r.name}`}
                              checked={choice.enabled}
                              disabled={working}
                              onChange={(e) => {
                                editGroup(r, { enabled: e.target.checked });
                              }}
                            />
                            <span>Primeni</span>
                          </label>
                        )}
                        <small>
                          {c?.match === "approved"
                            ? "Zapamćena veza proizvoda i pakovanja"
                            : c?.match === "review"
                              ? "Proverite sastav ili formulaciju izabranog proizvoda."
                              : r.message}
                        </small>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {filter === "suggestions" &&
            !preview.rows.some((r) => r.candidates.length) && (
              <p>
                Nema predloga za ovaj izbor. Proverite preuzete STIPS cenovnike,
                mesto i datum ili otvorite nepokrivene stavke.
              </p>
            )}
          {historicalOffered && (
            <label className="checkbox">
              <input
                type="checkbox"
                aria-label="Prihvatam starije STIPS reference"
                checked={historical}
                disabled={working}
                onChange={(e) => {
                  const accept = e.target.checked;
                  setHistorical(accept);
                  setAccepted(false);
                  setChoices((v) => {
                    const next = { ...v };
                    for (const r of preview.rows) {
                      const c = r.candidates.find(
                        (c) => c.observationId === v[r.key]?.id,
                      );
                      if (c?.historical)
                        next[r.key] = { ...v[r.key], enabled: accept };
                    }
                    return next;
                  });
                }}
              />
              <span>
                Prihvatam označene starije reference za ovaj cenovnik; ne
                predstavljaju novu tržišnu cenu.
              </span>
            </label>
          )}
          <label className="checkbox suggestion-approval">
            <input
              type="checkbox"
              aria-label="Potvrđujem STIPS proizvode i osnovu cene"
              checked={accepted}
              disabled={working || !selected.length}
              onChange={(e) => setAccepted(e.target.checked)}
            />
            <span>
              Pregledao sam izabrane proizvode, potvrdio jedinice normativa i da
              izvorne cene važe za prikazanu osnovu pakovanja/jedinice.
            </span>
          </label>
          <button
            type="button"
            className="primary"
            disabled={
              working ||
              !accepted ||
              !selected.length ||
              invalid ||
              (old && !historical)
            }
            onClick={() => void apply()}
          >
            Primeni STIPS cene u nacrtima (
            {new Set(selected.map((s) => groupKey(s.row))).size})
          </button>
          <p className="hint">
            Cene se primenjuju na sve izabrane kulture u kojima stavka postoji.
            Pamti se potvrđena veza proizvoda i pakovanja, uz izvor i autora.
            Aktivacija normativa ostaje posebna radnja; količine, alternative i
            stvarna plaćanja se ne menjaju.
          </p>
        </>
      )}
    </section>
  );
}
function validDivisor(value: string) {
  try {
    return new Money(value).isFinite() && new Money(value).gt(0);
  } catch {
    return false;
  }
}
