import React, { useEffect, useState } from "react";
import { api } from "./api";
import { todayInSerbia } from "../shared/dates";
import type { PricingTable } from "../shared/pricing";
import type { FuelPreview } from "../shared/fuel";

export function FuelPrice({
  table,
  disabled,
  onDirty,
  onApply,
}: {
  table: PricingTable;
  disabled: boolean;
  onDirty: (dirty: boolean) => void;
  onApply: (
    fuel: {
      price: string;
      currency: "RSD" | "EUR";
      confirmed: true;
      zeroReason: string;
    },
    date: string,
    reason: string,
  ) => Promise<void>;
}) {
  const [preview, setPreview] = useState<FuelPreview | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [price, setPrice] = useState(""),
    [currency, setCurrency] = useState<"RSD" | "EUR">("RSD"),
    [date, setDate] = useState(todayInSerbia()),
    [reason, setReason] = useState(
      "Zajednička cena goriva za mašinske operacije",
    ),
    [confirmed, setConfirmed] = useState(false),
    [zeroReason, setZeroReason] = useState("");
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    setConfirmed(false);
    api(
      "/admin/pricing/fuel?versionIds=" +
        table.versions.map((v) => v.id).join(","),
    )
      .then((p: FuelPreview) => {
        if (!active) return;
        setPreview(p);
        setPrice(p.current?.amount || "");
        setCurrency(p.current?.currency || "RSD");
        setDate(p.current?.date || todayInSerbia());
        onDirty(false);
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [table.revision]);
  function edit(fn: () => void) {
    fn();
    setConfirmed(false);
    onDirty(true);
  }
  return (
    <section className="panel fuel-panel" aria-labelledby="fuel-price-title">
      <div className="panel-head">
        <div>
          <h2 id="fuel-price-title">
            Mašinske operacije — zajednička cena goriva
          </h2>
          <p>Jedna cena po litru za sve povezane operacije i kulture.</p>
        </div>
        <span className="badge">Gorivo · l</span>
      </div>
      {loading && <p role="status">Proveravam operacije i izvor potrošnje…</p>}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {preview && !loading && (
        <>
          <p>
            <strong>
              {preview.eligible} stavki u {preview.cultures} kultura /
              kategorija.
            </strong>{" "}
            Svaka zadržava svoj naziv i normiranu potrošnju; menja se zajednička
            cena litra.
          </p>
          <p className="hint">
            Obuhvaćene su stavke koje izvor izričito uključuje u „Potrošnju
            goriva“ i već potvrđene veze. Ovo je trošak goriva; cena usluge,
            rada i mehanizacije vodi se zasebno.
          </p>
          {preview.mixed && (
            <div className="alert">
              Operacije imaju različite cene ili datume. Unesite jednu cenu
              kojom želite da ih usaglasite.
            </div>
          )}
          {preview.current?.pendingRate && (
            <p className="pending-price">
              RSD cena je sačuvana; čeka zvanični NBS kurs za{" "}
              {preview.current.date}. Naknadni unos kursa dopunjava nacrte.
            </p>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!confirmed || !price || !preview.eligible) return;
              void onApply(
                { price, currency, confirmed: true, zeroReason },
                date,
                reason,
              );
            }}
          >
            <fieldset
              disabled={disabled || !preview.eligible}
              className="book-fieldset"
            >
              <div className="form-grid four">
                <label className="field">
                  <span>Cena goriva po litru</span>
                  <input
                    aria-label="Cena goriva po litru"
                    type="number"
                    min="0"
                    step="any"
                    value={price}
                    required
                    onChange={(e) => edit(() => setPrice(e.target.value))}
                  />
                </label>
                <label className="field">
                  <span>Valuta</span>
                  <select
                    aria-label="Valuta goriva"
                    value={currency}
                    onChange={(e) =>
                      edit(() => setCurrency(e.target.value as "RSD" | "EUR"))
                    }
                  >
                    <option>RSD</option>
                    <option>EUR</option>
                  </select>
                </label>
                <label className="field">
                  <span>Jedinica</span>
                  <input
                    value="litar (l)"
                    readOnly
                    aria-label="Jedinica goriva"
                  />
                </label>
                <label className="field">
                  <span>Datum cene / kursa</span>
                  <input
                    aria-label="Datum cene goriva"
                    type="date"
                    value={date}
                    required
                    onChange={(e) => edit(() => setDate(e.target.value))}
                  />
                </label>
              </div>
              {price !== "" && Number(price) === 0 && (
                <label className="field">
                  <span>Razlog nulte cene goriva</span>
                  <input
                    value={zeroReason}
                    required
                    maxLength={300}
                    onChange={(e) => edit(() => setZeroReason(e.target.value))}
                  />
                </label>
              )}
              <label className="field">
                <span>Razlog izmene</span>
                <input
                  aria-label="Razlog izmene goriva"
                  value={reason}
                  required
                  maxLength={300}
                  onChange={(e) => edit(() => setReason(e.target.value))}
                />
              </label>
              <label className="checkbox">
                <input
                  aria-label="Potvrđujem zajedničku cenu goriva"
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => {
                    setConfirmed(e.target.checked);
                    onDirty(true);
                  }}
                />
                <span>
                  Potvrđujem jednu cenu po litru za prikazane operacije.
                  Potrošnja u litrima, površine, alternative i obuhvat ostaju
                  sačuvani.
                </span>
              </label>
              <button
                className="primary"
                disabled={!confirmed || price === "" || !preview.eligible}
              >
                Primeni cenu goriva na sve operacije
              </button>
              <button
                type="button"
                className="secondary"
                disabled={disabled}
                onClick={() => {
                  setPrice(preview.current?.amount || "");
                  setCurrency(preview.current?.currency || "RSD");
                  setDate(preview.current?.date || todayInSerbia());
                  setConfirmed(false);
                  setZeroReason("");
                  setReason("Zajednička cena goriva za mašinske operacije");
                  onDirty(false);
                }}
              >
                Odbaci izmenu goriva
              </button>
            </fieldset>
          </form>
          <details className="fuel-operations">
            <summary>
              Operacije povezane sa cenom goriva ({preview.operations.length}{" "}
              naziva)
            </summary>
            <div
              className="table-scroll"
              role="region"
              tabIndex={0}
              aria-label="Operacije sa zajedničkom cenom goriva"
            >
              <table>
                <thead>
                  <tr>
                    <th>Operacija</th>
                    <th>Kulture</th>
                    <th>Stavke</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.operations.map((o) => (
                    <tr key={o.name}>
                      <td>{o.name}</td>
                      <td>{o.cultures}</td>
                      <td>{o.items}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
          {preview.blockedUnits.length > 0 && (
            <details>
              <summary>
                {preview.blockedUnits.length} stavki ima već potvrđenu drugu
                jedinicu
              </summary>
              <p>Njihove količine ne pretvaramo automatski u litre.</p>
              <ul>
                {preview.blockedUnits.map((o, n) => (
                  <li key={n}>
                    {o.culture} · {o.name} · {o.unit}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {preview.unresolved > 0 && (
            <p className="hint">
              {preview.unresolved} stavki sa nejasnom osnovom ostaje odvojeno.
              Materijali i ručni rad ne uključuju se automatski u gorivo.
            </p>
          )}
        </>
      )}
    </section>
  );
}
