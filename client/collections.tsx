import React, { useState } from "react";
import { api } from "./api";
import { todayInSerbia } from "../shared/dates";

type Any = any;
const nf = (v: string | number | null | undefined) =>
  v == null
    ? "—"
    : new Intl.NumberFormat("sr-Latn-RS", {
        maximumFractionDigits: 2,
        minimumFractionDigits: 0,
      }).format(Number(v));
const money = (v: string | null | undefined, cur = "RSD") =>
  v == null ? "—" : `${nf(v)} ${cur}`;

/** Jedna linija za karticu proizvodnje: prodato, naplaćeno, ostaje. */
export function CollectionSummary({ rec }: { rec?: Any }) {
  if (!rec || (!rec.sales.length && !rec.advanceRows.length)) return null;
  return (
    <div className="collection-line">
      <span>
        Prodato <strong>{money(rec.sold)}</strong>
      </span>
      <span>
        Naplaćeno <strong>{money(rec.collected)}</strong>
      </span>
      <span>
        Ostaje <strong>{money(rec.outstanding)}</strong>
      </span>
      {Number(rec.overdue) > 0 && (
        <small className="pending-price">Dospelo: {money(rec.overdue)}</small>
      )}
      {Number(rec.advances) > 0 && (
        <small>Avans bez prodaje: {money(rec.advances)}</small>
      )}
    </div>
  );
}

function statusLabel(s: Any) {
  if (s.status === "paid") return ["Naplaćeno", "green"];
  if (s.overdue) return [`Kasni ${s.daysOverdue} d`, "amber"];
  if (s.status === "partial") return ["Delimično", "amber"];
  return ["Čeka naplatu", ""];
}

function Err({ text }: { text: string }) {
  return text ? (
    <div className="form-error" role="alert">
      {text}
    </div>
  ) : null;
}

/** Naplata za jednu proizvodnju: prodaje, uplate po prodaji i avansi. */
export function CollectionsPanel({
  production,
  rec,
  onChanged,
}: {
  production: Any;
  rec?: Any;
  onChanged: () => Promise<void>;
}) {
  const [form, setForm] = useState<Any>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const sales: Any[] = rec?.sales || [];
  const advances: Any[] = rec?.advanceRows || [];
  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await fn();
      setForm(null);
      await onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const open = sales.filter((s) => s.status !== "paid");
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>Naplata</h2>
          <p>Prodato, naplaćeno i ostaje za ovu proizvodnju</p>
        </div>
        <button
          className="secondary"
          disabled={busy}
          onClick={() => setForm({ type: "advance" })}
        >
          Primljen avans
        </button>
      </div>
      {rec && (
        <div className="metrics three">
          <article className="metric">
            <div>
              <span>Prodato</span>
            </div>
            <strong>
              {nf(rec.sold)} <small>RSD</small>
            </strong>
            <p>{sales.length} prodaja</p>
          </article>
          <article className="metric accent">
            <div>
              <span>Naplaćeno</span>
            </div>
            <strong>
              {nf(rec.collected)} <small>RSD</small>
            </strong>
            <p>
              {Number(rec.advances) > 0
                ? `+ avans ${nf(rec.advances)} RSD nije raspoređen`
                : "Uplate vezane za prodaje"}
            </p>
          </article>
          <article className="metric">
            <div>
              <span>Ostaje da se naplati</span>
            </div>
            <strong>
              {nf(rec.outstanding)} <small>RSD</small>
            </strong>
            <p>
              {Number(rec.overdue) > 0
                ? `Dospelo: ${nf(rec.overdue)} RSD`
                : "Nema dospelih potraživanja"}
            </p>
          </article>
        </div>
      )}
      {!sales.length && !advances.length ? (
        <p className="hint">
          Nema evidentiranih prodaja. Prodaju unesite u „Prodaja i troškovi“, pa
          ovde evidentirajte naplatu.
        </p>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Prodaja</th>
                <th>Kupac</th>
                <th>Rok plaćanja</th>
                <th>Iznos</th>
                <th>Naplaćeno</th>
                <th>Ostaje</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {sales.map((s) => {
                const [label, tone] = statusLabel(s);
                return (
                  <tr key={s.id}>
                    <td>
                      <strong>{s.title}</strong>
                      <small>{s.date}</small>
                    </td>
                    <td>{s.buyer || "—"}</td>
                    <td>{s.dueDate || "—"}</td>
                    <td>{money(s.amount, s.currency)}</td>
                    <td>{money(s.collected, s.currency)}</td>
                    <td>{money(s.remaining, s.currency)}</td>
                    <td>
                      <span className={"badge " + tone}>{label}</span>
                    </td>
                    <td>
                      {s.status !== "paid" && (
                        <button
                          className="text-button"
                          disabled={busy}
                          onClick={() => setForm({ type: "collect", sale: s })}
                        >
                          Evidentiraj naplatu
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {advances.length > 0 && (
        <>
          <h3>Avansi bez prodaje</h3>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Datum</th>
                  <th>Kupac</th>
                  <th>Iznos</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {advances.map((a) => (
                  <tr key={a.id}>
                    <td>{a.date}</td>
                    <td>{a.buyer || "—"}</td>
                    <td>{money(a.amount, a.currency)}</td>
                    <td>
                      {open.some((s) => s.currency === a.currency) && (
                        <button
                          className="text-button"
                          disabled={busy}
                          onClick={() =>
                            setForm({ type: "allocate", advance: a })
                          }
                        >
                          Poveži sa prodajom
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {form?.type === "collect" && (
        <form
          className="inline-form"
          onSubmit={(e) => {
            e.preventDefault();
            const v = Object.fromEntries(new FormData(e.currentTarget)) as Any;
            run(() =>
              api("/payments", {
                eventId: form.sale.id,
                direction: "in",
                category: "Naplata prodaje",
                date: v.date,
                amount: v.amount,
                currency: form.sale.currency,
                note: v.note || "",
              }),
            );
          }}
        >
          <h3>
            Naplata: {form.sale.title}
            {form.sale.buyer ? ` · ${form.sale.buyer}` : ""}
          </h3>
          <div className="form-grid">
            <label className="field">
              <span>Naplaćeni iznos ({form.sale.currency}) *</span>
              <input
                name="amount"
                type="number"
                step="any"
                min="0"
                required
                aria-label="Naplaćeni iznos"
                defaultValue={form.sale.remaining}
              />
              <small>
                Preostalo: {money(form.sale.remaining, form.sale.currency)}
              </small>
            </label>
            <label className="field">
              <span>Datum uplate *</span>
              <input
                name="date"
                type="date"
                required
                defaultValue={todayInSerbia()}
                aria-label="Datum uplate"
              />
            </label>
            <label className="field">
              <span>Napomena</span>
              <input name="note" aria-label="Napomena" maxLength={500} />
            </label>
          </div>
          <Err text={error} />
          <div className="form-actions">
            <button
              type="button"
              className="secondary"
              onClick={() => setForm(null)}
            >
              Otkaži
            </button>
            <button className="primary" disabled={busy}>
              Sačuvaj naplatu
            </button>
          </div>
        </form>
      )}

      {form?.type === "advance" && (
        <form
          className="inline-form"
          onSubmit={(e) => {
            e.preventDefault();
            const v = Object.fromEntries(new FormData(e.currentTarget)) as Any;
            run(() =>
              api("/payments", {
                advance: true,
                productionId: production.id,
                direction: "in",
                category: "Avans",
                date: v.date,
                amount: v.amount,
                currency: v.currency,
                buyer: v.buyer || undefined,
                note: v.note || "",
              }),
            );
          }}
        >
          <h3>Primljen avans za {production.name}</h3>
          <div className="form-grid">
            <label className="field">
              <span>Kupac</span>
              <input name="buyer" aria-label="Kupac" maxLength={300} />
            </label>
            <label className="field">
              <span>Iznos *</span>
              <input
                name="amount"
                type="number"
                step="any"
                min="0"
                required
                aria-label="Iznos avansa"
              />
            </label>
            <label className="field">
              <span>Valuta</span>
              <select name="currency" aria-label="Valuta" defaultValue="RSD">
                <option>RSD</option>
                <option>EUR</option>
              </select>
            </label>
            <label className="field">
              <span>Datum uplate *</span>
              <input
                name="date"
                type="date"
                required
                defaultValue={todayInSerbia()}
                aria-label="Datum uplate avansa"
              />
            </label>
            <label className="field">
              <span>Napomena</span>
              <input
                name="note"
                aria-label="Napomena uz avans"
                maxLength={500}
              />
            </label>
          </div>
          <p className="hint">
            Avans je novac koji ste već primili, a koji još nije vezan za
            prodaju. Kasnije ga povežite sa prodajom.
          </p>
          <Err text={error} />
          <div className="form-actions">
            <button
              type="button"
              className="secondary"
              onClick={() => setForm(null)}
            >
              Otkaži
            </button>
            <button className="primary" disabled={busy}>
              Sačuvaj avans
            </button>
          </div>
        </form>
      )}

      {form?.type === "allocate" && (
        <form
          className="inline-form"
          onSubmit={(e) => {
            e.preventDefault();
            const v = Object.fromEntries(new FormData(e.currentTarget)) as Any;
            run(() =>
              api(`/payments/${form.advance.id}/allocate`, {
                eventId: v.eventId,
                ...(v.amount ? { amount: v.amount } : {}),
              }),
            );
          }}
        >
          <h3>
            Poveži avans {money(form.advance.amount, form.advance.currency)}
            {form.advance.buyer ? ` (${form.advance.buyer})` : ""} sa prodajom
          </h3>
          <div className="form-grid">
            <label className="field">
              <span>Prodaja *</span>
              <select name="eventId" required aria-label="Prodaja">
                {open
                  .filter((s) => s.currency === form.advance.currency)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.title}
                      {s.buyer ? ` · ${s.buyer}` : ""} · ostaje{" "}
                      {money(s.remaining, s.currency)}
                    </option>
                  ))}
              </select>
            </label>
            <label className="field">
              <span>Iznos (prazno = koliko može)</span>
              <input
                name="amount"
                type="number"
                step="any"
                min="0"
                aria-label="Iznos za povezivanje"
              />
            </label>
          </div>
          <Err text={error} />
          <div className="form-actions">
            <button
              type="button"
              className="secondary"
              onClick={() => setForm(null)}
            >
              Otkaži
            </button>
            <button className="primary" disabled={busy}>
              Poveži
            </button>
          </div>
        </form>
      )}
      {!form && <Err text={error} />}
    </section>
  );
}
