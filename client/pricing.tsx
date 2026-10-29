import React, { useMemo, useRef, useState } from "react";
import { api } from "./api";
import type { PricingRow, PricingTable } from "../shared/pricing";
import type { InputReferenceSelection } from "../shared/inputs";
import { InputPricePicker } from "./input-prices";
import { StipsPriceSuggestions } from "./price-suggestions";

type Any = any;
type Edit = {
  price: string;
  currency: "EUR" | "RSD";
  unit: string;
  confirmUnit: boolean;
  zeroReason: string;
  reference?: InputReferenceSelection;
  referenceLabel?: string;
};
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
const number = (n: string | null) =>
  n === null
    ? "—"
    : new Intl.NumberFormat("sr-Latn-RS", { maximumFractionDigits: 6 }).format(
        Number(n),
      );
const baseEdit = (row: PricingRow): Edit => ({
  price: row.priceEur ?? "",
  currency: "EUR",
  unit: row.unit,
  confirmUnit: row.occurrences.every((o) => o.unitConfirmed),
  zeroReason: row.occurrences.find((o) => o.zeroReason)?.zeroReason || "",
});
export function SharedPriceTable({
  data,
  onDone,
  onEdit,
}: {
  data: Any;
  onDone: () => Promise<void>;
  onEdit: (id: string) => void;
}) {
  const [sheet, setSheet] = useState("Usevi"),
    [sourceIds, setSourceIds] = useState<string[]>([]),
    [sourceChoice, setSourceChoice] = useState<Record<string, string>>({}),
    [draftIds, setDraftIds] = useState<string[]>([]),
    [table, setTable] = useState<PricingTable | null>(null),
    [edits, setEdits] = useState<Record<string, Edit>>({}),
    [query, setQuery] = useState(""),
    [priceDate, setPriceDate] = useState(""),
    [reason, setReason] = useState(""),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [warnings, setWarnings] = useState<string[]>([]),
    [busy, setBusy] = useState(false),
    [showCreate, setShowCreate] = useState(false);
  const [sourceRow, setSourceRow] = useState<PricingRow | null>(null);
  const requestId = useRef(crypto.randomUUID());
  const dirty = Object.keys(edits).length;
  const sources = useMemo(() => {
    const candidates = new Map<string, Any[]>();
    for (const v of data.versions.filter(
      (v: Any) => v.model.sheet === sheet && v.status !== "draft",
    )) {
      candidates.set(v.template_id, [
        ...(candidates.get(v.template_id) || []),
        v,
      ]);
    }
    return [...candidates.entries()].map(([templateId, versions]) => {
      const sorted = [...versions].sort(
        (a, b) =>
          Number(b.status === "active") - Number(a.status === "active") ||
          String(b.created_at).localeCompare(String(a.created_at)),
      );
      return {
        templateId,
        versions: sorted,
        selected: sourceChoice[templateId] || sorted[0].id,
        name: sorted[0].template_name,
      };
    });
  }, [data.versions, sheet, sourceChoice]);
  const drafts = data.versions.filter(
    (v: Any) => v.status === "draft" && v.model.sheet === sheet,
  );
  const toggle = (values: string[], id: string) =>
    values.includes(id) ? values.filter((v) => v !== id) : [...values, id];
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
  async function open(ids: string[]) {
    const result = (await api(
      "/admin/pricing/table?versionIds=" + ids.join(","),
    )) as PricingTable;
    setTable(result);
    setDraftIds(ids);
    setEdits({});
    setWarnings([]);
    setPriceDate(result.validFrom);
    setQuery("");
  }
  function change(row: PricingRow, value: Partial<Edit>) {
    setEdits((e) => ({
      ...e,
      [row.key]: {
        ...(e[row.key] || baseEdit(row)),
        ...(("price" in value || "currency" in value || "unit" in value) &&
        !("reference" in value)
          ? { reference: undefined, referenceLabel: undefined }
          : {}),
        ...value,
      },
    }));
  }
  async function saveRows(rows: any[], saveReason: string) {
    if (!table) return;
    const result = await api(
      "/admin/pricing/table",
      {
        versionIds: table.versions.map((v) => v.id),
        revision: table.revision,
        date: priceDate,
        reason: saveReason,
        rows,
      },
      "PUT",
    );
    setTable(result.table);
    setEdits({});
    setWarnings(result.warnings);
    await onDone();
    setMessage(
      `Cene su sačuvane u ${result.changedVersions} nacrta. Normirane količine nisu menjane.`,
    );
  }
  return (
    <>
      {!table && (
        <section
          className="panel pricing-panel"
          aria-labelledby="stips-start-title"
        >
          <h2 id="stips-start-title">Popuni cene iz STIPS-a</h2>
          <p>
            Predlozi cena prikazuju se kada otvorite nacrte za izabrane kulture.
          </p>
          <ol>
            <li>
              Ako već imate nacrte, označite po jedan za svaku kulturu i
              kliknite <strong>Otvori zajedničku tabelu</strong>.
            </li>
            <li>
              Za novi cenovnik izaberite kulture, naziv i period u odeljku{" "}
              <strong>Novi nacrti za više kultura</strong>, pa kliknite{" "}
              <strong>Pripremi izabrane nacrte</strong>.
            </li>
            <li>
              U otvorenom cenovniku pregledajte STIPS predloge i potvrdite
              grupnu primenu cena.
            </li>
          </ol>
        </section>
      )}
      {sourceRow && table && (
        <InputPricePicker
          name={sourceRow.name}
          unit={(edits[sourceRow.key] || baseEdit(sourceRow)).unit}
          validFrom={table.validFrom}
          onClose={() => setSourceRow(null)}
          onPick={(selected) => {
            change(sourceRow, {
              price: selected.amount,
              currency: "RSD",
              reference: selected.reference,
              referenceLabel: selected.label,
            });
            setSourceRow(null);
          }}
        />
      )}
      <section className="panel pricing-panel">
        <div className="panel-head">
          <div>
            <h2>Zajednički cenovnik normativa</h2>
            <p>
              Jedna stavka i cena, zasebna normirana količina za svaku kulturu.
            </p>
          </div>
          <button
            type="button"
            className="secondary"
            disabled={busy || !!dirty}
            onClick={() => {
              setShowCreate(!showCreate);
              requestId.current = crypto.randomUUID();
            }}
          >
            Novi nacrti za više kultura
          </button>
        </div>
        <label className="field">
          <span>Izvorna kategorija</span>
          <select
            aria-label="Izvorna kategorija cenovnika"
            value={sheet}
            disabled={busy || !!dirty}
            onChange={(e) => {
              setSheet(e.target.value);
              setSourceIds([]);
              setDraftIds([]);
              setTable(null);
              setMessage("");
              setWarnings([]);
            }}
          >
            {data.sheets
              .filter((s: Any) => s.role === "production")
              .map((s: Any) => (
                <option key={s.id}>{s.original_name}</option>
              ))}
          </select>
        </label>
        <p className="hint">
          Unos se čuva u izabranim nacrtima za isti period. Odobrene verzije,
          arhiva 2017 i istorijski izveštaji ostaju zaštićeni. Aktiviranje se
          radi kroz pregled pojedinačnog normativa.
        </p>
        {(showCreate || !drafts.length) && (
          <form
            className="pricing-create"
            onSubmit={(e) => {
              e.preventDefault();
              const values = Object.fromEntries(new FormData(e.currentTarget));
              void run(async () => {
                const result = await api("/admin/pricing/drafts", {
                  sourceIds: sources
                    .filter((s) => sourceIds.includes(s.templateId))
                    .map((s) => s.selected),
                  requestId: requestId.current,
                  name: values.name,
                  validFrom: values.validFrom,
                  validTo: values.validTo,
                  reason: values.reason,
                });
                requestId.current = crypto.randomUUID();
                await onDone();
                await open(result.ids);
                setShowCreate(false);
                setMessage(
                  `Pripremljeno nacrta: ${result.ids.length}. Izvorne količine su zadržane; nove cene su prazne.`,
                );
              });
            }}
          >
            <h3>Pripremi novu seriju normativa</h3>
            <p className="hint">
              Izaberite kulture i izvornu verziju. Cene se ne preuzimaju iz
              2017. Postojeće verzije se ne prepisuju.
            </p>
            <div className="toolbar">
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() => setSourceIds(sources.map((s) => s.templateId))}
              >
                Izaberi sve kulture
              </button>
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() => setSourceIds([])}
              >
                Poništi izbor kultura
              </button>
            </div>
            <div className="pricing-choices">
              {sources.map((s) => (
                <div key={s.templateId}>
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      aria-label={`Izvor ${s.name}`}
                      checked={sourceIds.includes(s.templateId)}
                      disabled={busy}
                      onChange={() =>
                        setSourceIds(toggle(sourceIds, s.templateId))
                      }
                    />
                    <span>{s.name}</span>
                  </label>
                  <label className="field">
                    <span>Izvorna verzija</span>
                    <select
                      aria-label={`Izvorna verzija ${s.name}`}
                      disabled={busy}
                      value={s.selected}
                      onChange={(e) =>
                        setSourceChoice((c) => ({
                          ...c,
                          [s.templateId]: e.target.value,
                        }))
                      }
                    >
                      {s.versions.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.name} ·{" "}
                          {v.status === "active" ? "aktivna" : "arhiva"} ·{" "}
                          {String(v.valid_from).slice(0, 10)}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              ))}
            </div>
            <div className="form-grid">
              <label className="field">
                <span>Naziv nove serije</span>
                <input
                  aria-label="Naziv nove serije"
                  name="name"
                  required
                  maxLength={300}
                />
              </label>
              <label className="field">
                <span>Razlog nove serije</span>
                <input
                  aria-label="Razlog nove serije"
                  name="reason"
                  required
                  maxLength={300}
                />
              </label>
              <label className="field">
                <span>Važi od</span>
                <input
                  aria-label="Cenovnik važi od"
                  name="validFrom"
                  type="date"
                  defaultValue={`${new Date().getFullYear()}-01-01`}
                  required
                />
              </label>
              <label className="field">
                <span>Važi do</span>
                <input
                  aria-label="Cenovnik važi do"
                  name="validTo"
                  type="date"
                  defaultValue={`${new Date().getFullYear()}-12-31`}
                  required
                />
              </label>
            </div>
            <button className="primary" disabled={busy || !sourceIds.length}>
              {busy ? "Priprema…" : "Pripremi izabrane nacrte"}
            </button>
          </form>
        )}
        {drafts.length > 0 && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void run(() => open(draftIds));
            }}
          >
            <h3>Izaberi nacrte za zajednički unos</h3>
            <div className="pricing-choices pricing-drafts">
              {drafts.map((v: Any) => (
                <label className="checkbox" key={v.id}>
                  <input
                    type="checkbox"
                    aria-label={`Nacrt ${v.template_name} · ${v.name} · ${v.id.slice(0, 8)}`}
                    checked={draftIds.includes(v.id)}
                    disabled={busy || !!dirty}
                    onChange={() => setDraftIds(toggle(draftIds, v.id))}
                  />
                  <span>
                    <strong>{v.template_name}</strong>
                    <small>
                      {v.name} · {String(v.valid_from).slice(0, 10)} —{" "}
                      {String(v.valid_to).slice(0, 10)}
                    </small>
                  </span>
                </label>
              ))}
            </div>
            <button
              className="secondary"
              disabled={busy || !!dirty || !draftIds.length}
            >
              Otvori zajedničku tabelu
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
      {warnings.length > 0 && (
        <div className="alert" role="status">
          <div>
            {warnings.map((w) => (
              <p key={w}>{w}</p>
            ))}
          </div>
        </div>
      )}
      {table && (
        <form
          className="panel pricing-panel"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await saveRows(
                Object.entries(edits).map(([key, value]) => ({
                  key,
                  ...value,
                  price: value.price === "" ? null : value.price,
                })),
                reason,
              );
            });
          }}
        >
          <div className="panel-head">
            <div>
              <h2>Cene po vrstama troška</h2>
              <p>
                {table.validFrom} — {table.validTo} · {table.rows.length} redova
                · {table.versions.length} kultura / kategorija
              </p>
            </div>
            <span className="badge amber">
              Nacrti · bez automatskog aktiviranja
            </span>
          </div>
          <StipsPriceSuggestions
            table={table}
            disabled={busy || !!dirty}
            onApply={(rows, why) => run(() => saveRows(rows, why))}
          />
          <details className="pricing-manual">
            <summary>Ručni unos i raspored cena po kulturama</summary>
            <div className="form-grid">
              <label className="field">
                <span>Pretraga stavki</span>
                <input
                  aria-label="Pretraga zajedničkih stavki"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Npr. NPK, oranje, seme…"
                />
              </label>
              <label className="field">
                <span>Datum referentne cene / kursa</span>
                <input
                  aria-label="Datum cene cenovnika"
                  type="date"
                  value={priceDate}
                  onChange={(e) => setPriceDate(e.target.value)}
                  required
                  disabled={busy}
                />
              </label>
            </div>
            <p className="hint">
              Količine i iznosi u kolonama odnose se na referentnu osnovu svake
              karte. Red „Seme“ i drugi materijali zavisni od kulture imaju
              zasebne cene. kg i t, kao i nejasne jedinice, ne spajaju se
              automatski. Promena valute unosa koristi zvanični kurs za navedeni
              datum.
            </p>
            <div
              className="table-scroll pricing-scroll"
              tabIndex={0}
              role="region"
              aria-label="Tabela zajedničkih cena po kulturama"
            >
              <table className="pricing-table">
                <caption>
                  Jedna cena po stavci i jedinici; količine po kulturama se ne
                  menjaju.
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Vrsta troška / izvor</th>
                    <th scope="col">Jedinična cena</th>
                    <th scope="col">Jedinica mere</th>
                    {table.versions.map((v) => (
                      <th scope="col" key={v.id}>
                        {v.name}
                        <small>
                          Za {v.reference} {v.basis}
                        </small>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {table.rows
                    .filter((row) =>
                      row.name
                        .toLocaleLowerCase()
                        .includes(query.toLocaleLowerCase()),
                    )
                    .map((row) => {
                      const edit = edits[row.key] || baseEdit(row);
                      return (
                        <tr
                          key={row.key}
                          data-price-row={row.key}
                          className={edits[row.key] ? "pricing-dirty" : ""}
                        >
                          <th scope="row">
                            <strong>{row.name}</strong>
                            <small>
                              {row.cultureSpecific
                                ? "Cena zasebna za kulturu / kategoriju"
                                : "Zajednička cena za prikazane kulture"}
                            </small>
                            <details>
                              <summary>
                                Izvorne stavke ({row.occurrences.length})
                              </summary>
                              {row.occurrences.map((o) => (
                                <p key={o.versionId + o.itemId}>
                                  {
                                    table.versions.find(
                                      (v) => v.id === o.versionId,
                                    )?.name
                                  }
                                  : {o.sheet}!{o.quantityCell || o.itemId} ·
                                  cena {o.priceCell || "ručni unos hraniva"}
                                  <br />
                                  {o.name}
                                  {o.alternativeGroup
                                    ? " · alternativa: " + o.alternativeGroup
                                    : ""}
                                  {o.lastInput
                                    ? ` · poslednji unos ${o.lastInput.amount} ${o.lastInput.currency} (${o.lastInput.date})${o.lastInput.pendingRate ? " — čeka kurs" : ""}`
                                    : ""}
                                  {o.lastInput?.reference && (
                                    <small className="input-price-reference">
                                      STIPS: {o.lastInput.reference.product} ·{" "}
                                      {o.lastInput.reference.place} ·{" "}
                                      {o.lastInput.reference.periodStart.slice(
                                        0,
                                        7,
                                      )}{" "}
                                      · {o.lastInput.reference.sheet}!
                                      {o.lastInput.reference.cell} ·{" "}
                                      <a
                                        href={o.lastInput.reference.sourceUrl}
                                        target="_blank"
                                        rel="noreferrer"
                                      >
                                        Izvor cene
                                      </a>
                                    </small>
                                  )}
                                </p>
                              ))}
                            </details>
                          </th>
                          <td>
                            <label className="field">
                              <span>Nova / važeća cena</span>
                              <input
                                aria-label={`Cena ${row.name}`}
                                type="number"
                                step="any"
                                min="0"
                                disabled={busy}
                                value={edit.price}
                                placeholder={
                                  row.mixed
                                    ? "Različite cene"
                                    : "Nedostaje cena"
                                }
                                onChange={(e) =>
                                  change(row, { price: e.target.value })
                                }
                              />
                            </label>
                            <label className="field">
                              <span>Valuta unosa</span>
                              <select
                                aria-label={`Valuta ${row.name}`}
                                value={edit.currency}
                                disabled={busy}
                                onChange={(e) =>
                                  change(row, {
                                    currency: e.target.value as "EUR" | "RSD",
                                  })
                                }
                              >
                                <option>EUR</option>
                                <option>RSD</option>
                              </select>
                            </label>
                            <small>
                              {row.mixed
                                ? "Postojeće cene se razlikuju; novi unos ih usklađuje."
                                : `Sačuvano: ${number(row.priceEur)} EUR / jm`}
                            </small>
                            <button
                              type="button"
                              className="text-button"
                              disabled={
                                busy ||
                                ![
                                  "kg",
                                  "t",
                                  "l",
                                  "kom",
                                  "sj",
                                  "biljka",
                                ].includes(edit.unit)
                              }
                              onClick={() => setSourceRow(row)}
                            >
                              Izaberi STIPS cenu
                            </button>
                            {!["kg", "t", "l", "kom", "sj", "biljka"].includes(
                              edit.unit,
                            ) && (
                              <small>
                                Za izbor cene prvo izaberite jedinicu materijala
                                u koloni „Jedinica mere“.
                              </small>
                            )}
                            {edit.reference && (
                              <small className="input-price-reference">
                                Izabrano: {edit.referenceLabel} · {edit.price}{" "}
                                RSD/{edit.unit} · datum kursa{" "}
                                {edit.reference.date}
                              </small>
                            )}
                            {/^0(?:\.0*)?$/.test(edit.price) && (
                              <label className="field">
                                <span>Razlog nulte cene</span>
                                <input
                                  aria-label={`Razlog nule ${row.name}`}
                                  value={edit.zeroReason}
                                  disabled={busy}
                                  onChange={(e) =>
                                    change(row, { zeroReason: e.target.value })
                                  }
                                  maxLength={300}
                                />
                              </label>
                            )}
                          </td>
                          <td>
                            <label className="field">
                              <span>Jedinica</span>
                              <select
                                aria-label={`Jedinica ${row.name}`}
                                value={edit.unit}
                                disabled={busy}
                                onChange={(e) =>
                                  change(row, { unit: e.target.value })
                                }
                              >
                                {!units.includes(row.unit) && (
                                  <option value={row.unit}>
                                    {row.unit || "Nije potvrđena"}
                                  </option>
                                )}
                                {units.map((u) => (
                                  <option key={u}>{u}</option>
                                ))}
                              </select>
                            </label>
                            <label className="checkbox">
                              <input
                                aria-label={`Potvrđena jedinica ${row.name}`}
                                type="checkbox"
                                checked={edit.confirmUnit}
                                disabled={busy}
                                onChange={(e) =>
                                  change(row, { confirmUnit: e.target.checked })
                                }
                              />
                              <span>Jedinica potvrđena</span>
                            </label>
                          </td>
                          {table.versions.map((v) => (
                            <td key={v.id}>
                              {row.occurrences
                                .filter((o) => o.versionId === v.id)
                                .map((o) => (
                                  <div className="pricing-cell" key={o.itemId}>
                                    <strong>
                                      {number(o.quantity)} {row.unit}
                                    </strong>
                                    <small>
                                      {o.included
                                        ? `${number(o.costEur)} EUR`
                                        : "Isključena stavka"}
                                    </small>
                                    {!o.unitConfirmed && (
                                      <small>Jedinica čeka proveru</small>
                                    )}
                                    {o.quantity === null && (
                                      <small>Nedostaje osnova količine</small>
                                    )}
                                  </div>
                                ))}
                            </td>
                          ))}
                        </tr>
                      );
                    })}
                </tbody>
                <tfoot>
                  <tr>
                    <th scope="row" colSpan={3}>
                      Zbir poznatih uključenih stavki · EUR
                      <br />
                      <small>Potpunost se proverava pre aktiviranja.</small>
                    </th>
                    {table.versions.map((v) => (
                      <td key={v.id}>
                        <strong>{number(v.knownCostEur)} EUR</strong>
                        <small>
                          {v.errors.length
                            ? `${v.errors.length} nalaza za pregled`
                            : "Kompletne stavke"}
                        </small>
                        <button
                          type="button"
                          className="text-button"
                          disabled={busy || !!dirty}
                          onClick={() => onEdit(v.id)}
                        >
                          Pregledaj {v.name}
                        </button>
                      </td>
                    ))}
                  </tr>
                </tfoot>
              </table>
            </div>
            <label className="field">
              <span>Razlog izmene zajedničkih cena</span>
              <input
                aria-label="Razlog izmene zajedničkih cena"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                required
                maxLength={300}
                disabled={busy}
              />
            </label>
            <div className="toolbar">
              <button className="primary" disabled={busy || !dirty}>
                {busy ? "Čuvanje…" : `Sačuvaj cene u nacrtima (${dirty})`}
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
            <p className="hint">
              Čuvaju se samo izmenjeni redovi u svim prikazanim kulturama u
              kojima stavka postoji. Prazna cena ostaje nepotpun podatak; nula
              zahteva razlog. Količine, izbor alternativa i obuhvat troškova
              ostaju u pojedinačnim kartama.
            </p>
          </details>
        </form>
      )}
    </>
  );
}
