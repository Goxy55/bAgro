import React, { useEffect, useRef, useState } from "react";
import { api, selectedFarm } from "./api";
import { todayInSerbia } from "../shared/dates";
const n = (v: any, precision = 2) =>
  v == null
    ? "—"
    : new Intl.NumberFormat("sr-Latn-RS", { maximumFractionDigits: 2 }).format(
        Number(v),
      );
const money = (v: any) =>
  v == null
    ? "Nepotpun podatak"
    : `${new Intl.NumberFormat("sr-Latn-RS", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(v))} RSD`;
export function CalendarPolicyEditor({
  onDone,
}: {
  onDone?: () => Promise<void>;
}) {
  const [data, setData] = useState<any>(null),
    [policy, setPolicy] = useState<any>(null),
    [confirmed, setConfirmed] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const requestId = useRef(crypto.randomUUID());
  async function load() {
    const r = await api("/admin/cost-calendar");
    setData(r);
    setPolicy(r.current?.policy || r.proposal);
  }
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, []);
  if (!data)
    return (
      <p role={error ? "alert" : "status"}>
        {error || "Učitavanje kalendarskih pravila…"}
      </p>
    );
  return (
    <details className="calendar-policy" open={!data.current}>
      <summary>
        Pravila mesečnog troškovnika{" "}
        {data.current
          ? `· ${data.current.name}`
          : "— jedna zajednička potvrda administratora"}
      </summary>
      <p>
        Pravila važe za sva gazdinstva. Menjaju samo raspored obračunskog
        ulaganja; sačuvani mesečni obračuni zadržavaju prethodnu verziju.
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          const f = new FormData(e.currentTarget);
          try {
            await api("/admin/cost-calendar", {
              requestId: requestId.current,
              name: f.get("name"),
              reason: f.get("reason"),
              policy,
              confirmed,
              expectedPolicyId: data.current?.id || null,
            });
            requestId.current = crypto.randomUUID();
            setConfirmed(false);
            await load();
            await onDone?.();
            setMessage("Pravila su potvrđena. Mesečni pregled je osvežen.");
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="form-grid">
          <label className="field">
            <span>Naziv verzije pravila</span>
            <input
              name="name"
              required
              maxLength={300}
              defaultValue={`Raspored ulaganja ${todayInSerbia()}`}
            />
          </label>
          <label className="field">
            <span>Raspon ili više meseci</span>
            <select
              value={policy.rangeRule}
              onChange={(e) => {
                setPolicy({ ...policy, rangeRule: e.target.value });
                setConfirmed(false);
              }}
            >
              <option value="equal">Ravnomerna podela ukupne norme</option>
              <option value="first">Ceo trošak u prvom mesecu</option>
              <option value="manual">
                Admin raspodela za svaki višemesečni red
              </option>
            </select>
          </label>
          <label className="field">
            <span>Priprema prethodne godine</span>
            <select
              value={policy.seasonRule}
              onChange={(e) => {
                setPolicy({ ...policy, seasonRule: e.target.value });
                setConfirmed(false);
              }}
            >
              <option value="cycle">
                Cela sezona, uključujući prethodnu godinu
              </option>
              <option value="calendar">Svi meseci u kalendarskoj godini</option>
            </select>
          </label>
          <label className="field">
            <span>Razlog potvrde / izmene</span>
            <input
              name="reason"
              required
              maxLength={300}
              defaultValue="Pregled izvornog rasporeda i pravila obračuna"
            />
          </label>
        </div>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={policy.inheritMonths}
            onChange={(e) => {
              setPolicy({ ...policy, inheritMonths: e.target.checked });
              setConfirmed(false);
            }}
          />{" "}
          Prazna kolona C inputa preuzima mesec pripadajućeg bloka operacija.
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={policy.preferAuxiliary}
            onChange={(e) => {
              setPolicy({ ...policy, preferAuxiliary: e.target.checked });
              setConfirmed(false);
            }}
          />{" "}
          Koristi izričitu raspodelu iz „Zalihe na parceli“ kada se meseci i
          zbir potpuno usaglase sa kartom.
        </label>
        <p className="hint">
          Primer: šećerna repa IV–VIII ima raspodelu 1/6, 1/6, 2/6, 1/6, 1/6.
          Neusaglašena pomoćna formula se ne kopira. Količina reda se kroz sve
          mesece raspoređuje samo jednom.
        </p>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
          />{" "}
          Potvrđujem ova pravila za normativno ulaganje po mesecima.
        </label>
        <button
          type="button"
          className="secondary"
          disabled={busy}
          onClick={() => void load().catch((e) => setError(e.message))}
        >
          Ponovo učitaj pravila
        </button>
        <button className="primary" disabled={busy || !confirmed}>
          Potvrdi kalendarska pravila
        </button>
        {error && (
          <p className="alert" role="alert">
            {error}
          </p>
        )}
        {message && (
          <p className="success" role="status">
            {message}
          </p>
        )}
      </form>
    </details>
  );
}
async function downloadWip(
  format: string,
  asOf: string,
  productionId: string,
  snapshotId?: string,
) {
  const q = new URLSearchParams({ asOf });
  if (productionId) q.set("productionId", productionId);
  if (snapshotId) q.set("snapshotId", snapshotId);
  const r = await fetch(`/api/wip/export/${format}?${q}`, {
    headers: selectedFarm ? { "X-Farm-Id": selectedFarm } : {},
  });
  if (!r.ok) throw Error((await r.json()).error);
  const href = URL.createObjectURL(await r.blob()),
    a = document.createElement("a");
  a.href = href;
  a.download = `agro-ulaganja-${asOf}.${format}`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}
function Rows({
  heads,
  rows,
  label,
}: {
  heads: string[];
  rows: any[][];
  label: string;
}) {
  return (
    <div
      className="table-wrap monthly-table"
      role="region"
      aria-label={label}
      tabIndex={0}
    >
      <table>
        <thead>
          <tr>
            {heads.map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {row.map((cell, j) => (
                <td key={j}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
export function MonthlyWip({
  farmYear,
  productions,
  admin,
  productionId = "",
}: {
  farmYear: number;
  productions: any[];
  admin: boolean;
  productionId?: string;
}) {
  const today = todayInSerbia(),
    initialMonth =
      farmYear < Number(today.slice(0, 4))
        ? `${farmYear}-12`
        : today.slice(0, 7);
  const [asOf, setAsOf] = useState(initialMonth),
    [scope, setScope] = useState(productionId),
    [report, setReport] = useState<any>(null),
    [snapshots, setSnapshots] = useState<any[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const sequence = useRef(0);
  async function load() {
    const seq = ++sequence.current;
    setError("");
    try {
      const q = new URLSearchParams({ asOf });
      if (scope) q.set("productionId", scope);
      const [r, s] = await Promise.all([
        api("/wip?" + q),
        api("/wip/snapshots"),
      ]);
      if (seq === sequence.current) {
        setReport(r);
        setSnapshots(s);
      }
    } catch (e) {
      if (seq === sequence.current) {
        setError((e as Error).message);
        setReport(null);
      }
    }
  }
  useEffect(() => {
    void load();
    return () => {
      sequence.current++;
    };
  }, [asOf, scope]);
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
  return (
    <section className="panel monthly-wip">
      <div className="panel-head">
        <div>
          <h2>Normativno ulaganje i zalihe u zemlji</h2>
          <p>
            Odobrena cena × normirana potrošnja × vaša površina, kumulativno od
            početka sezone do izabranog meseca.
          </p>
        </div>
      </div>
      <div className="form-grid">
        <label className="field">
          <span>Mesec pregleda — zaključno</span>
          <input
            aria-label="Mesec pregleda — zaključno"
            type="month"
            value={asOf}
            max={today.slice(0, 7)}
            min={`${farmYear - 1}-01`}
            onChange={(e) => {
              if (e.target.value) setAsOf(e.target.value);
            }}
          />
        </label>
        {!productionId && (
          <label className="field">
            <span>Proizvodnja</span>
            <select
              aria-label="Proizvodnja za mesečna ulaganja"
              value={scope}
              onChange={(e) => setScope(e.target.value)}
            >
              <option value="">Sve biljne proizvodnje</option>
              {productions
                .filter((p) => !String(p.basis || "").startsWith("head"))
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
            </select>
          </label>
        )}
      </div>
      <p className="hint">
        Pregled obuhvata ceo izabrani mesec. Za tekući mesec uključuje mesečnu
        normativnu potrošnju kao obračunsku pretpostavku. Ne predstavlja dokaz
        izvršenja operacije ili gotovinskog plaćanja.
      </p>
      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="success" role="status">
          {message}
        </p>
      )}
      {admin && <CalendarPolicyEditor onDone={load} />}
      {!report && !error && <p role="status">Učitavanje mesečnog obračuna…</p>}
      {report && (
        <>
          {!report.policy && (
            <p className="alert">
              Administrator treba jednom da potvrdi pravila mesečnog rasporeda.
              Nije primenjena pretpostavljena raspodela.
            </p>
          )}
          <div className="monthly-totals">
            <article>
              <small>Kumulativno normativno ulaganje</small>
              <strong>{money(report.totals.cumulative)}</strong>
              {report.totals.cumulative == null && (
                <small>
                  Poznat deo: {money(report.totals.knownCumulative)}
                </small>
              )}
            </article>
            <article>
              <small>Ulaganje u izabranom mesecu</small>
              <strong>{money(report.totals.currentMonth)}</strong>
            </article>
            <article>
              <small>Vrednost zaliha u zemlji</small>
              <strong>{money(report.totals.wipValue)}</strong>
              <small>
                {report.totals.unknownState
                  ? `Stanje nije potvrđeno za ${report.totals.unknownState} proizvodnji.`
                  : "Odvojeno od gotovih proizvoda i novčanog toka."}
              </small>
            </article>
          </div>
          <p>
            {report.status} ·{" "}
            {report.policy?.name || "Nema odobrenih kalendarskih pravila"}
          </p>
          <div className="toolbar">
            <button
              className="secondary"
              disabled={busy}
              onClick={() => void run(() => downloadWip("pdf", asOf, scope))}
            >
              PDF mesečnog ulaganja
            </button>
            <button
              className="secondary"
              disabled={busy}
              onClick={() => void run(() => downloadWip("xlsx", asOf, scope))}
            >
              Excel mesečnog ulaganja
            </button>
            <button
              className="primary"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await api("/wip/snapshots", {
                    asOf,
                    ...(scope ? { productionId: scope } : {}),
                    reason:
                      "Snimak kumulativnog ulaganja i korišćenih normativa",
                  });
                  await load();
                  setMessage(
                    "Mesečni obračun je sačuvan sa normativima, pravilima rasporeda i kursom ako je korišćen.",
                  );
                })
              }
            >
              Sačuvaj mesečni obračun
            </button>
          </div>
          {!report.results.length && (
            <p>
              Nema evidentiranih biljnih proizvodnji sa površinom za ovu sezonu.
            </p>
          )}
          {report.results.map((p: any) => (
            <details
              className="monthly-production"
              key={p.id}
              open={!!productionId}
            >
              <summary>
                <strong>{p.name}</strong>
                <span>
                  Ulaganje do {asOf}: {money(p.cumulative)} · Zaliha u zemlji:{" "}
                  {money(p.wipValue)}
                </span>
              </summary>
              <p>
                {p.details.scale || "Nedostaje površina"}{" "}
                {p.details.scaleUnit || "ha"} ·{" "}
                {p.version?.name || "Nema aktivnog normativa"} ·{" "}
                {p.version?.sheet} {p.version?.range}
              </p>
              {p.exchangeRate && (
                <p className="hint">
                  Kurs obračuna: {p.exchangeRate.value} RSD/EUR · datum{" "}
                  {p.exchangeRate.date} · lista {p.exchangeRate.validFrom}–
                  {p.exchangeRate.validTo}
                </p>
              )}
              {p.errors.length > 0 && (
                <div className="alert">
                  <ul>
                    {p.errors.map((e: string, i: number) => (
                      <li key={i}>{e}</li>
                    ))}
                  </ul>
                </div>
              )}
              <p>{p.stageMessage}</p>
              <form
                className="monthly-state"
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  void run(async () => {
                    const state = f.get("state"),
                      completedOn = f.get("completedOn");
                    await api(
                      `/wip/productions/${p.id}/state`,
                      {
                        state,
                        ...(state === "completed" ? { completedOn } : {}),
                        note: "Potvrda stvarnog stanja proizvodnje za zalihe u zemlji",
                      },
                      "PATCH",
                    );
                    await load();
                    setMessage(
                      "Stanje proizvodnje je sačuvano. Kumulativni trošak ostaje u istoriji.",
                    );
                  });
                }}
              >
                <label className="field">
                  <span>Stanje proizvodnje {p.name}</span>
                  <select
                    name="state"
                    defaultValue={p.state}
                    aria-label={`Stanje proizvodnje ${p.name}`}
                  >
                    <option value="unknown">Nije potvrđeno</option>
                    <option value="growing">U toku</option>
                    <option value="completed">Završena</option>
                  </select>
                </label>
                <label className="field">
                  <span>Datum završetka (za završenu proizvodnju)</span>
                  <input
                    name="completedOn"
                    type="date"
                    max={today}
                    defaultValue={p.completedOn || ""}
                  />
                </label>
                <button className="secondary" disabled={busy}>
                  Sačuvaj stanje proizvodnje
                </button>
              </form>
              <p className="hint">
                Potvrda završetka zatvara zalihu u zemlji od tog meseca.
                Količina gotovog proizvoda evidentira se kroz unos proizvodnje;
                ovde ne nastaje nova prodaja ili uplata.
              </p>
              <h3>Mesečna povećanja i kumulativno stanje</h3>
              <Rows
                label={`Mesečni pregled ${p.name}`}
                heads={["Mesec", "Trošak u mesecu RSD", "Kumulativno RSD"]}
                rows={p.months
                  .filter((m: any) => m.included)
                  .map((m: any) => [m.month, n(m.increase), n(m.cumulative)])}
              />
              <h3>Redovi troškovnika</h3>
              <Rows
                label={`Redovi troškovnika ${p.name}`}
                heads={[
                  "Vrsta troška — B",
                  "Mesec — C",
                  "Cena RSD/jm — D",
                  "Normirana potrošnja — E",
                  "Trošak osnove RSD — F",
                  "Količina za površinu",
                  "Ukupno za površinu RSD",
                  "Do izabranog meseca RSD",
                ]}
                rows={p.lines.map((l: any) => [
                  <>
                    <strong>{l.name}</strong>
                    <small>
                      {l.id} · {l.notes.join(" ")}
                      {l.errors.length ? " · " + l.errors.join(" ") : ""}
                    </small>
                  </>,
                  <>
                    {l.rawMonth || "Iz pripadajućeg bloka"}
                    <small>
                      {l.allocation
                        .map(
                          (a: any) =>
                            `${a.month}: ${a.numerator}/${a.denominator}`,
                        )
                        .join("; ")}
                    </small>
                  </>,
                  n(l.price),
                  `${n(l.normQuantity, 6)} ${l.unit} / ${l.reference} ${{ ha: "ha", m2: "m²" }[l.basis as "ha" | "m2"] || l.basis}`,
                  n(l.perReferenceCost),
                  `${n(l.quantity, 6)} ${l.unit}`,
                  n(l.fullCost),
                  n(l.cumulative),
                ])}
              />
              <p className="hint">
                Širu tabelu troškovnika možete pomerati vodoravno da vidite
                cenu, potrošnju i sve iznose.
              </p>
              <p className="hint">
                Mesečna stanja predstavljaju kumulativni zbir. Ne sabiraju se
                međusobno kao novi troškovi. Za izmenu normativa ili rasporeda
                administrator pravi novu verziju; snimljeni obračuni ostaju
                nepromenjeni.
              </p>
            </details>
          ))}
          {snapshots.length > 0 && (
            <details>
              <summary>Sačuvani mesečni obračuni ({snapshots.length})</summary>
              <Rows
                label="Sačuvani mesečni obračuni"
                heads={["Mesec", "Obuhvat", "Generisano", "Preuzmi"]}
                rows={snapshots.map((s) => [
                  s.as_of,
                  s.production_id
                    ? productions.find((p) => p.id === s.production_id)?.name ||
                      "Proizvodnja"
                    : "Gazdinstvo",
                  new Date(s.generated_at).toLocaleString("sr-Latn-RS"),
                  <div className="toolbar">
                    <button
                      className="text-button"
                      onClick={() =>
                        void run(() => downloadWip("pdf", s.as_of, "", s.id))
                      }
                    >
                      PDF
                    </button>
                    <button
                      className="text-button"
                      onClick={() =>
                        void run(() => downloadWip("xlsx", s.as_of, "", s.id))
                      }
                    >
                      XLSX
                    </button>
                  </div>,
                ])}
              />
            </details>
          )}
        </>
      )}
    </section>
  );
}
