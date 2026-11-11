import React, { useState } from "react";
import { api } from "./api";
import { todayInSerbia } from "../shared/dates";
import type { PricingTable } from "../shared/pricing";
import type {
  PriceEstimateCandidate,
  PriceEstimateRow,
  PriceEstimates,
} from "../shared/price-estimates";

const number = (v: string) =>
  new Intl.NumberFormat("sr-Latn-RS", { maximumFractionDigits: 2 }).format(
    Number(v),
  );

/**
 * Procena cene po sličnom artiklu za stavke bez izvora. Nikad se ne primenjuje
 * sama: administrator bira artikal i izričito potvrđuje da je cena procena.
 */
export function PriceEstimatesPanel({
  table,
  disabled,
  onApply,
}: {
  table: PricingTable;
  disabled: boolean;
  onApply: (rows: any[], reason: string) => Promise<void>;
}) {
  const [data, setData] = useState<PriceEstimates | null>(null),
    [choice, setChoice] = useState<Record<string, string>>({}),
    [on, setOn] = useState<Record<string, boolean>>({}),
    [accepted, setAccepted] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const working = busy || disabled;
  async function search() {
    setBusy(true);
    setError("");
    setAccepted(false);
    try {
      const r: PriceEstimates = await api("/admin/pricing/estimates", {
        versionIds: table.versions.map((v) => v.id),
        revision: table.revision,
        asOf: [table.validTo, todayInSerbia()].sort()[0],
      });
      setData(r);
      setChoice(
        Object.fromEntries(
          r.rows.map((row) => [
            row.key,
            row.candidates[0]?.observationId || "",
          ]),
        ),
      );
      setOn({});
    } catch (e) {
      setError((e as Error).message);
      setData(null);
    } finally {
      setBusy(false);
    }
  }
  const pick = (row: PriceEstimateRow): PriceEstimateCandidate | undefined =>
    row.candidates.find((c) => c.observationId === choice[row.key]);
  const selected =
    data?.rows.flatMap((row) => {
      const c = pick(row);
      return c && on[row.key] ? [{ row, c }] : [];
    }) || [];
  async function apply() {
    if (!data || !accepted || !selected.length || working) return;
    setBusy(true);
    setError("");
    try {
      await onApply(
        selected.map(({ row, c }) => ({
          key: row.key,
          price: c.amount,
          currency: "RSD",
          unit: c.unit,
          confirmUnit: true,
          zeroReason: "",
          estimate: {
            observationId: c.observationId,
            basis: `Procena po sličnom artiklu: ${c.product} (${c.packaging}), sličnost ${Math.round(c.score * 100)}%${c.reason ? " — " + c.reason : ""}`,
            confirmed: true,
          },
        })),
        `Procena cena po sličnim artiklima (STIPS, ${data.place || "bez mesta"}, do ${data.asOf})`,
      );
      await search();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <details className="pricing-manual">
      <summary>Procena cene po sličnom artiklu (za stavke bez izvora)</summary>
      <p>
        Za stavke koje nisu pronađene u STIPS/RZS cenovnicima traže se slični
        artikli iste kategorije (isti sastav ili naziv). Rezultat je{" "}
        <strong>procena, ne izvorna cena</strong>: čuva se u nacrtu, označena je
        u obračunu i svaka se potvrđuje posebno. Prosek grupe je samo orijentir.
      </p>
      <div className="form-actions">
        <button
          type="button"
          className="secondary"
          disabled={working}
          onClick={search}
        >
          {busy && !data ? "Traženje…" : "Pronađi slične artikle"}
        </button>
      </div>
      {error && (
        <div className="form-error" role="alert">
          {error}
        </div>
      )}
      {data && !data.rows.length && (
        <p>Nema stavki za koje se može predložiti procena.</p>
      )}
      {data && data.rows.length > 0 && (
        <>
          <div className="table-scroll">
            <table className="suggestions-table">
              <thead>
                <tr>
                  <th scope="col">Stavka bez izvora</th>
                  <th scope="col">Sličan artikal</th>
                  <th scope="col">Procenjena cena</th>
                  <th scope="col">Orijentir grupe</th>
                  <th scope="col">Primeni</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row) => {
                  const c = pick(row);
                  return (
                    <tr key={row.key}>
                      <th scope="row">
                        <strong>{row.name}</strong>
                        <small>{row.unit}</small>
                      </th>
                      <td>
                        {row.candidates.length ? (
                          <>
                            <select
                              aria-label={`Sličan artikal za ${row.name}`}
                              value={choice[row.key] || ""}
                              disabled={working}
                              onChange={(e) => {
                                setChoice({
                                  ...choice,
                                  [row.key]: e.target.value,
                                });
                                setAccepted(false);
                              }}
                            >
                              {row.candidates.map((x) => (
                                <option
                                  key={x.observationId}
                                  value={x.observationId}
                                >
                                  {x.product} · {x.packaging} ·{" "}
                                  {Math.round(x.score * 100)}%
                                </option>
                              ))}
                            </select>
                            {c && <small>{c.reason}</small>}
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td>
                        {c ? (
                          <>
                            <strong>
                              {number(c.amount)} RSD/{c.unit}
                            </strong>
                            <small className="pending-price">PROCENA</small>
                            <small>
                              Cena od {c.periodStart},{" "}
                              <a
                                href={c.sourceUrl}
                                target="_blank"
                                rel="noreferrer"
                              >
                                izvor ↗
                              </a>
                            </small>
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td>
                        {row.group ? (
                          <small>
                            {row.group.count} artikala ({row.group.category}):{" "}
                            {number(row.group.min)} – {number(row.group.max)}{" "}
                            RSD/{row.group.unit}, medijana{" "}
                            {number(row.group.median)}. Samo orijentir.
                          </small>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td>
                        {c && (
                          <label className="checkbox">
                            <input
                              type="checkbox"
                              aria-label={`Primeni procenu za ${row.name}`}
                              checked={!!on[row.key]}
                              disabled={working}
                              onChange={(e) => {
                                setOn({ ...on, [row.key]: e.target.checked });
                                setAccepted(false);
                              }}
                            />
                            <span>Primeni</span>
                          </label>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={accepted}
              disabled={working || !selected.length}
              onChange={(e) => setAccepted(e.target.checked)}
              aria-label="Potvrđujem procenu"
            />
            <span>
              Potvrđujem da su izabrane cene{" "}
              <strong>procene po sličnom artiklu</strong>, a ne izvorne cene, i
              da će biti označene u obračunu.
            </span>
          </label>
          <div className="form-actions">
            <button
              type="button"
              className="primary"
              disabled={working || !accepted || !selected.length}
              onClick={apply}
            >
              Sačuvaj procene u nacrtu ({selected.length})
            </button>
          </div>
        </>
      )}
    </details>
  );
}
