import React, { useEffect, useRef, useState } from "react";
import { api } from "./api";
import type { InputReferenceSelection } from "../shared/inputs";
type Any = any;
const categories: Record<string, string> = {
  pesticidi: "Pesticidi",
  djubriva: "Mineralna đubriva",
  seme: "Semenski materijal",
};
const num = (v: string | null) =>
  v === null
    ? "—"
    : new Intl.NumberFormat("sr-Latn-RS", { maximumFractionDigits: 6 }).format(
        Number(v),
      );
const url = "https://www.stips.minpolj.gov.rs/index.php/srl/strana/inputi";
function SourceNotice() {
  return (
    <p className="hint">
      Izvorne dominantne cene u RSD po mestu i pakovanju. Nedostajuće vrednosti
      nisu nule. Nema nacionalnog ili godišnjeg proseka. Osnovu cene po
      pakovanju/kg/l administrator proverava pre primene. Istorijski nazivi
      preparata nisu aktuelne preporuke zaštite bilja.
    </p>
  );
}
export function InputPricesGrid({
  onSelect,
  refresh = 0,
  initialQuery = "",
}: {
  onSelect?: (row: Any) => void;
  refresh?: number;
  initialQuery?: string;
}) {
  const [year, setYear] = useState(String(new Date().getFullYear())),
    [category, setCategory] = useState(""),
    [place, setPlace] = useState(""),
    [query, setQuery] = useState(initialQuery),
    [status, setStatus] = useState("available"),
    [page, setPage] = useState(1),
    [data, setData] = useState<Any>(),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setError("");
    const timer = setTimeout(() => {
      const q = new URLSearchParams({ year, q: query, page: String(page) });
      if (category) q.set("category", category);
      if (place) q.set("place", place);
      if (status) q.set("status", status);
      void api("/admin/input-prices/prices?" + q)
        .then((r) => {
          if (active) setData(r);
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    }, 200);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [year, category, place, query, status, page, refresh]);
  const currentYear = new Date().getFullYear();
  return (
    <>
      <div className="form-grid">
        <label className="field">
          <span>Godina cena</span>
          <select
            aria-label="Godina STIPS cena"
            value={year}
            onChange={(e) => {
              setYear(e.target.value);
              setPage(1);
            }}
          >
            {Array.from(
              { length: Math.max(1, currentYear - 2008) },
              (_, i) => currentYear - i,
            ).map((y) => (
              <option key={y}>{y}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Vrsta inputa</span>
          <select
            aria-label="Vrsta STIPS inputa"
            value={category}
            onChange={(e) => {
              setCategory(e.target.value);
              setPage(1);
            }}
          >
            <option value="">Sve vrste</option>
            {Object.entries(categories).map(([k, v]) => (
              <option value={k} key={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Mesto</span>
          <select
            aria-label="Mesto STIPS cene"
            value={place}
            onChange={(e) => {
              setPlace(e.target.value);
              setPage(1);
            }}
          >
            <option value="">Sva pojedinačna mesta</option>
            {data?.places.map((p: string) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Proizvod, proizvođač, pakovanje ili sheet</span>
          <input
            aria-label="Pretraga STIPS inputa"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(1);
            }}
            placeholder="Izvorni naziv, npr. NPK ili PŠENICA"
          />
        </label>
        <label className="field">
          <span>Status izvorne vrednosti</span>
          <select
            aria-label="Status STIPS vrednosti"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
          >
            <option value="available">
              Brojčane cene · osnova čeka proveru
            </option>
            <option value="missing">Nedostaje podatak</option>
            <option value="review">Nejasan zapis / potrebna provera</option>
            <option value="">Svi zapisi</option>
          </select>
        </label>
      </div>
      {error && (
        <div className="form-error" role="alert">
          {error}
        </div>
      )}
      {!data ? (
        <p>Učitavanje cena…</p>
      ) : (
        <>
          <p className="hint">
            Pronađeno zapisa: {data.total}. Prikaz {data.page} /{" "}
            {Math.max(1, Math.ceil(data.total / data.pageSize))}. Cene pripadaju
            navedenim mesecima, nisu današnji cenovnik.
          </p>
          {!data.rows.length ? (
            <p>
              Nema potvrđenih podataka za izabrane filtere. Proverite pretragu
              ili preuzmite cenovnike iz arhive.
            </p>
          ) : (
            <div
              className="table-scroll"
              tabIndex={0}
              role="region"
              aria-label="STIPS cene inputa po mestima"
            >
              <table className="input-price-table">
                <thead>
                  <tr>
                    <th>Proizvod / grupa</th>
                    <th>Proizvođač / poreklo</th>
                    <th>Pakovanje iz izvora</th>
                    <th>Mesto</th>
                    <th>Izvorna cena RSD</th>
                    <th>Period i izvor</th>
                    {onSelect && <th>Izbor</th>}
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r: Any) => (
                    <tr key={r.id}>
                      <td>
                        <strong>{r.product}</strong>
                        <small>
                          {categories[r.category]} · {r.sheet}
                        </small>
                      </td>
                      <td>{r.manufacturer || "Nije navedeno"}</td>
                      <td>
                        {r.packaging}
                        <small>Osnova cene zahteva proveru</small>
                      </td>
                      <td>{r.place}</td>
                      <td>
                        {r.status === "available"
                          ? num(r.price_rsd)
                          : r.status === "missing"
                            ? "Nedostaje podatak"
                            : "Potrebna provera"}
                        {r.status === "review" && (
                          <small>
                            Izvorni zapis: {JSON.stringify(r.raw_value)}
                          </small>
                        )}
                      </td>
                      <td>
                        {r.period_start.slice(0, 7)}
                        <small>
                          {r.sheet}!{r.cell}
                        </small>
                        <a href={r.source_url} target="_blank" rel="noreferrer">
                          STIPS izvor
                        </a>
                      </td>
                      {onSelect && (
                        <td>
                          <button
                            type="button"
                            className="secondary"
                            disabled={r.status !== "available"}
                            onClick={() => onSelect(r)}
                          >
                            Izaberi cenu
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="toolbar">
            <button
              type="button"
              className="secondary"
              disabled={page === 1}
              onClick={() => setPage(page - 1)}
            >
              Prethodna strana
            </button>
            <button
              type="button"
              className="secondary"
              disabled={page * data.pageSize >= data.total}
              onClick={() => setPage(page + 1)}
            >
              Sledeća strana
            </button>
          </div>
        </>
      )}
    </>
  );
}
export function StipsInputAdmin() {
  const [data, setData] = useState<Any>(),
    [reports, setReports] = useState<Any[]>([]),
    [year, setYear] = useState(String(new Date().getFullYear())),
    [selected, setSelected] = useState<string[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [refresh, setRefresh] = useState(0);
  const load = async () => {
    setData(await api("/admin/input-prices"));
    setRefresh((v) => v + 1);
  };
  useEffect(() => {
    void load().catch((e) => setError(e.message));
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
  const choices = reports.filter((r) => String(r.year) === year);
  return (
    <>
      <section className="panel input-prices-panel">
        <div className="panel-head">
          <div>
            <h2>STIPS · cene inputa</h2>
            <p>Referentna arhiva za zajednički cenovnik normativa</p>
          </div>
          <a href={url} target="_blank" rel="noreferrer">
            Zvanična arhiva INPUTI
          </a>
        </div>
        <SourceNotice />
        <p>
          Preuzimanje čuva original i pojedinačne vrednosti. Normativ ostaje
          nacrt dok administrator ne proveri i odobri njegovu verziju.
        </p>
        <div className="toolbar">
          <label className="field">
            <span>Godina za preuzimanje</span>
            <select
              aria-label="Godina preuzimanja inputa"
              value={year}
              disabled={busy}
              onChange={(e) => {
                setYear(e.target.value);
                setSelected([]);
              }}
            >
              {Array.from(
                { length: Math.max(1, new Date().getFullYear() - 2008) },
                (_, i) => new Date().getFullYear() - i,
              ).map((y) => (
                <option key={y}>{y}</option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={busy}
            className="secondary"
            onClick={() =>
              void run(async () => {
                const r = await api("/admin/input-prices/discover", {});
                setReports(r.reports);
                setSelected(
                  r.reports
                    .filter((v: Any) => String(v.year) === year)
                    .map((v: Any) => v.url),
                );
                setMessage(
                  "Pronađeni su stvarni linkovi iz zvanične godišnje tabele.",
                );
              })
            }
          >
            Pronađi cenovnike
          </button>
        </div>
        {!!reports.length && (
          <>
            <div className="pricing-choices">
              {choices.map((r) => (
                <label className="checkbox" key={r.url}>
                  <input
                    type="checkbox"
                    disabled={busy}
                    checked={selected.includes(r.url)}
                    onChange={() =>
                      setSelected((v) =>
                        v.includes(r.url)
                          ? v.filter((u) => u !== r.url)
                          : [...v, r.url],
                      )
                    }
                  />
                  <span>
                    {r.title || categories[r.category]}
                    <small>
                      Kolona arhive: {r.year}-{String(r.month).padStart(2, "0")}
                    </small>
                  </span>
                </label>
              ))}
            </div>
            {!choices.length && (
              <p>Nema objava za ovu godinu u proveravanoj arhivi.</p>
            )}
            <button
              type="button"
              disabled={busy || !selected.length}
              onClick={() =>
                void run(async () => {
                  const failures: string[] = [];
                  let imported = 0,
                    duplicates = 0;
                  for (let i = 0; i < selected.length; i++) {
                    setMessage(`Preuzimanje ${i + 1}/${selected.length}…`);
                    try {
                      const r = await api("/admin/input-prices/import", {
                        url: selected[i],
                      });
                      if (r.duplicate) duplicates++;
                      else imported++;
                    } catch (e) {
                      failures.push((e as Error).message);
                    }
                  }
                  await load();
                  setMessage(
                    `Preuzeto novih cenovnika: ${imported}. Već sačuvano: ${duplicates}.`,
                  );
                  if (failures.length) setError(failures.join(" · "));
                })
              }
            >
              {busy
                ? "Preuzimanje u toku…"
                : `Preuzmi izabrane cenovnike (${selected.length})`}
            </button>
          </>
        )}
        {message && (
          <div className="success" role="status">
            {message}
          </div>
        )}
        {error && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}
        {!!data?.runs.filter((r: Any) => r.status === "error").length && (
          <details>
            <summary>Neuspele provere — prethodni podaci su sačuvani</summary>
            {data.runs
              .filter((r: Any) => r.status === "error")
              .map((r: Any) => (
                <p key={r.id}>
                  {r.started_at}: {r.error}
                </p>
              ))}
          </details>
        )}
        <details>
          <summary>
            Originalni cenovnici i nalazi ({data?.documents.length || 0})
          </summary>
          {data?.documents.map((d: Any) => (
            <article key={d.id} className="input-document">
              <strong>{d.title}</strong>
              <p>
                {d.period_start} — {d.period_end} · brojčanih cena:{" "}
                {d.counts.available} · nedostaje: {d.counts.missing} · za
                proveru: {d.counts.review}
              </p>
              <p className="hint">
                Preuzeto{" "}
                {new Date(d.received_at).toLocaleDateString("sr-Latn-RS")} ·
                datum objave nije potvrđen · SHA-256 {d.sha256}
              </p>
              {d.warnings.map((w: string) => (
                <p className="hint" key={w}>
                  {w}
                </p>
              ))}
              <a href={`/api/admin/input-prices/documents/${d.id}/file`}>
                Preuzmi originalni Excel
              </a>{" "}
              ·{" "}
              <a href={d.source_url} target="_blank" rel="noreferrer">
                Izvorna stranica
              </a>
            </article>
          ))}
        </details>
      </section>
      <section className="panel input-prices-panel">
        <h2>Preuzete cene</h2>
        <InputPricesGrid refresh={refresh} />
        <p className="hint">
          Za primenu otvorite Zajednički cenovnik i uz odgovarajuću stavku
          izaberite „Izaberi STIPS cenu“.
        </p>
      </section>
    </>
  );
}
export function InputPricePicker({
  name,
  unit,
  validFrom,
  onPick,
  onClose,
}: {
  name: string;
  unit: string;
  validFrom: string;
  onPick: (r: {
    reference: InputReferenceSelection;
    amount: string;
    label: string;
  }) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    [chosen, setChosen] = useState<Any>(),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    dialog.current?.showModal();
    return () => dialog.current?.close();
  }, []);
  return (
    <dialog
      className="input-price-dialog"
      ref={dialog}
      onCancel={onClose}
      aria-labelledby="input-price-title"
    >
      <div className="modal-title">
        <h2 id="input-price-title">STIPS cena za: {name}</h2>
        <button type="button" className="secondary" onClick={onClose}>
          Zatvori izbor cene
        </button>
      </div>
      <SourceNotice />
      {!chosen ? (
        <InputPricesGrid
          onSelect={(r) => {
            setChosen(r);
            setError("");
          }}
        />
      ) : (
        <>
          <p>
            <strong>{chosen.product}</strong> · {chosen.sheet} ·{" "}
            {chosen.manufacturer || "proizvođač nije naveden"}
          </p>
          <p>
            {num(chosen.price_rsd)} RSD · {chosen.packaging} · {chosen.place} ·{" "}
            {chosen.period_start.slice(0, 7)}
          </p>
          <a href={chosen.source_url} target="_blank" rel="noreferrer">
            Proveri izvorni cenovnik
          </a>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              const reference: InputReferenceSelection = {
                observationId: chosen.id,
                unitsPerPrice: String(f.get("unitsPerPrice")),
                date: String(f.get("date")),
                confirmedProduct: true,
                confirmedBasis: true,
                allowHistorical: f.get("historical") === "on",
                note: String(f.get("note")),
              };
              setBusy(true);
              setError("");
              void api("/admin/input-prices/reference", {
                reference,
                unit,
                validFrom,
              })
                .then((r) =>
                  onPick({
                    reference,
                    amount: r.amount,
                    label: `${chosen.product} · ${chosen.place} · ${chosen.period_start.slice(0, 7)} · ${chosen.packaging}`,
                  }),
                )
                .catch((e) => setError(e.message))
                .finally(() => setBusy(false));
            }}
          >
            <label className="field">
              <span>Za koliko {unit} važi izvorna cena?</span>
              <input
                aria-label="Količina u osnovi STIPS cene"
                name="unitsPerPrice"
                type="number"
                min="0.000001"
                step="any"
                required
              />
              <small>
                Unesite 1 samo ako cena važi za jednu {unit}. Ako je cena za
                celo pakovanje, unesite njegovu potvrđenu količinu u {unit}.
                Pakovanje nije automatski delilac.
              </small>
            </label>
            <label className="field">
              <span>Datum vrednovanja / NBS kursa u izvornom mesecu</span>
              <input
                aria-label="Datum vrednovanja STIPS cene"
                name="date"
                type="date"
                min={chosen.period_start}
                max={chosen.period_end}
                required
              />
            </label>
            <label className="field">
              <span>Obrazloženje povezivanja proizvoda i osnove cene</span>
              <textarea
                aria-label="Obrazloženje STIPS cene"
                name="note"
                required
                minLength={5}
                maxLength={1000}
              />
            </label>
            <label className="checkbox">
              <input type="checkbox" required />
              <span>
                Proverio/la sam da proizvod, formulacija/sorta i namena
                odgovaraju stavci normativa.
              </span>
            </label>
            <label className="checkbox">
              <input type="checkbox" required />
              <span>
                Proverio/la sam izvor i količinu na koju se cena odnosi;
                prihvatam preračun u {unit}.
              </span>
            </label>
            <label className="checkbox">
              <input
                type="checkbox"
                name="historical"
                required={chosen.period_end < validFrom}
              />
              <span>
                Prihvatam stariji izvor kao istorijsku referencu za ovaj nacrt,
                uz sačuvan izvorni period.
              </span>
            </label>
            {error && (
              <div className="form-error" role="alert">
                {error}
              </div>
            )}
            <div className="toolbar">
              <button type="submit" disabled={busy}>
                Prenesi izabranu cenu u unos
              </button>
              <button
                className="secondary"
                type="button"
                disabled={busy}
                onClick={() => setChosen(null)}
              >
                Izaberi drugu cenu
              </button>
            </div>
            <p className="hint">
              Ovo priprema unos. Čuvanje u normativima se radi zasebnim dugmetom
              u zajedničkoj tabeli. Bez kursa EUR iznos ostaje nepotpun.
            </p>
          </form>
        </>
      )}
    </dialog>
  );
}
