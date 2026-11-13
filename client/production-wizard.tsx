import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Apple,
  Beef,
  Carrot,
  Flower2,
  Leaf,
  Sprout,
  Warehouse,
  Wheat,
  ArrowUpRight,
} from "lucide-react";
import { api } from "./api";

type Any = any;

/** Tipovi proizvodnje onako kako ih korisnik zna; svaki objedinjuje izvorne kategorije kataloga. */
export const TYPES = [
  {
    id: "ratarstvo",
    label: "Ratarstvo",
    hint: "pšenica, kukuruz, soja…",
    sheets: ["Usevi"],
    icon: Wheat,
  },
  {
    id: "povrtarstvo",
    label: "Povrtarstvo",
    hint: "krompir, luk, grašak…",
    sheets: ["Povrće"],
    icon: Carrot,
  },
  {
    id: "vocarstvo",
    label: "Voćarstvo",
    hint: "šljiva, jabuka, malina…",
    sheets: ["Voće"],
    icon: Apple,
  },
  {
    id: "plastenici",
    label: "Plastenici",
    hint: "paradajz, paprika, salata…",
    sheets: ["Plastenici"],
    icon: Warehouse,
  },
  {
    id: "stocarstvo",
    label: "Stočarstvo",
    hint: "krave, svinje, ovce, živina…",
    sheets: ["Stočarstvo niži nivo intenz.", "Stočarstvo viši nivo intenz."],
    icon: Beef,
  },
  {
    id: "bilje",
    label: "Začinsko i lekovito bilje",
    hint: "nana, kamilica, matičnjak…",
    sheets: ["Aromatično i lekovito bilje"],
    icon: Flower2,
  },
  {
    id: "ostalo",
    label: "Ostalo",
    hint: "livade, šampinjoni",
    sheets: ["Ostalo"],
    icon: Leaf,
  },
] as const;
export type TypeId = (typeof TYPES)[number]["id"];

export const typeOfSheet = (sheetName: string) =>
  TYPES.find((t) => (t.sheets as readonly string[]).includes(sheetName));

/** Katalog ima nazive velikim slovima; prikazuju se kao obična rečenica. */
export const pretty = (name: string) =>
  name === name.toUpperCase() && /[A-ZŠĐČĆŽ]/.test(name)
    ? name.charAt(0) + name.slice(1).toLowerCase()
    : name;
const nf = (v: string | number | null | undefined, d = 0) =>
  v == null
    ? "—"
    : new Intl.NumberFormat("sr-Latn-RS", {
        maximumFractionDigits: d,
        minimumFractionDigits: d,
      }).format(Number(v));
const money = (v: string | null | undefined) =>
  v == null ? "—" : `${nf(v)} RSD`;

type Basis = "ha" | "m2" | "seedlings" | "bag" | "head_year" | "head_cycle";
export function quantityLabels(basis: Basis) {
  switch (basis) {
    case "ha":
      return {
        label: "Površina pod usevom",
        units: ["ha", "m2"],
        unitDefault: "ha",
      };
    case "m2":
      return {
        label: "Površina plastenika",
        units: ["m2", "ha"],
        unitDefault: "m2",
      };
    case "seedlings":
      return { label: "Broj biljaka", units: [], unitDefault: undefined };
    case "bag":
      return { label: "Broj vreća", units: [], unitDefault: undefined };
    case "head_year":
      return { label: "Prosečan broj grla", units: [], unitDefault: undefined };
    default:
      return {
        label: "Broj grla u ciklusu",
        units: [],
        unitDefault: undefined,
      };
  }
}
const UNIT_LABEL: Record<string, string> = {
  ha: "hektara (ha)",
  m2: "kvadratnih metara (m²)",
};

function CostPreview({ cost, loading }: { cost: Any; loading: boolean }) {
  if (loading && !cost) return <p className="hint">Računanje troška…</p>;
  if (!cost) return null;
  return (
    <div className="cost-preview" aria-live="polite">
      <div>
        <span>Ukupan trošak po normativu</span>
        <strong>{money(cost.planned)}</strong>
      </div>
      <div>
        <span>Trošak do danas</span>
        <strong>{money(cost.toDate)}</strong>
      </div>
      {cost.note && <small>{cost.note}</small>}
      {cost.problems?.map((p: string) => (
        <small key={p} className="pending-price">
          {p}
        </small>
      ))}
    </div>
  );
}

export function NewProductionWizard({ boot, data, onDone }: Any) {
  const [step, setStep] = useState(1),
    [typeId, setTypeId] = useState<TypeId | "">(""),
    [species, setSpecies] = useState(""),
    [intensity, setIntensity] = useState(""),
    [templateId, setTemplateId] = useState(""),
    [query, setQuery] = useState(""),
    [scale, setScale] = useState(""),
    [scaleUnit, setScaleUnit] = useState("ha"),
    [start, setStart] = useState(`${boot.farm.year}-01-01`),
    [end, setEnd] = useState(""),
    [name, setName] = useState(""),
    [cost, setCost] = useState<Any>(null),
    [loading, setLoading] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const type = TYPES.find((t) => t.id === typeId);
  const sheetNames = new Map<string, string>(
    boot.sheets.map((s: Any) => [s.id, s.original_name]),
  );
  const templates: Any[] = useMemo(
    () =>
      type
        ? boot.templates.filter((t: Any) =>
            (type.sheets as readonly string[]).includes(
              sheetNames.get(t.sheet_id) || "",
            ),
          )
        : [],
    [typeId, boot.templates],
  );
  const livestock = typeId === "stocarstvo";
  // Stoka: izbor vrste, zatim intenziteta; ostali: direktno kultura.
  const names = [...new Set(templates.map((t) => t.name))].filter((n) =>
    n.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const template = boot.templates.find((t: Any) => t.id === templateId);
  const basis = template?.basis as Basis | undefined;
  const q = basis ? quantityLabels(basis) : null;
  const validScale =
    /^\d{1,18}([.,]\d{1,12})?$/.test(scale.trim()) &&
    Number(scale.replace(",", ".")) > 0;
  const scaleValue = scale.trim().replace(",", ".");

  function chooseTemplate(id: string) {
    const t = boot.templates.find((x: Any) => x.id === id);
    setTemplateId(id);
    setScaleUnit(quantityLabels(t.basis).unitDefault || "ha");
    setEnd("");
    setCost(null);
    setStep(3);
  }
  // Godišnje osnove traže završetak perioda (podrazumevano kraj godine); ciklus ga nema dok se ne unese.
  const endValue = () =>
    end
      ? { end }
      : basis === "head_cycle"
        ? {}
        : { end: `${boot.farm.year}-12-31` };
  // Pregled troška dok se unosi količina (bez čuvanja).
  const seq = useRef(0);
  useEffect(() => {
    if (step !== 3 || !template || !validScale) {
      setCost(null);
      return;
    }
    const mine = ++seq.current;
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const r = await api("/production-costs/preview", {
          templateId: template.id,
          scale: scaleValue,
          ...(q?.units.length ? { scaleUnit } : {}),
          start,
          ...endValue(),
        });
        if (mine === seq.current) setCost(r);
      } catch (e) {
        if (mine === seq.current)
          setCost({
            planned: null,
            toDate: null,
            problems: [(e as Error).message],
          });
      } finally {
        if (mine === seq.current) setLoading(false);
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [step, templateId, scaleValue, validScale, scaleUnit, start, end]);

  const defaultName = template
    ? pretty(template.name) +
      (template.intensity ? ` (${template.intensity} intenzitet)` : "")
    : "";
  const finalName = (() => {
    const base = name.trim() || defaultName;
    const taken = new Set((data.productions || []).map((p: Any) => p.name));
    if (!taken.has(base)) return base;
    let n = 2;
    while (taken.has(`${base} (${n})`)) n++;
    return `${base} (${n})`;
  })();

  async function save() {
    if (!template || !validScale || busy) return;
    setBusy(true);
    setError("");
    try {
      const created = await api("/productions", {
        templateId: template.id,
        name: finalName,
        year: boot.farm.year,
        status: "draft",
        details: {
          scale: scaleValue,
          ...(q?.units.length ? { scaleUnit } : {}),
          start,
          ...endValue(),
          product: pretty(template.name),
        },
      });
      await onDone(created.id);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  const crumbs = ["Vrsta", "Kultura", "Količina"];
  return (
    <div className="wizard">
      <ol className="wizard-steps" aria-label="Koraci">
        {crumbs.map((c, i) => (
          <li
            key={c}
            className={step === i + 1 ? "current" : step > i + 1 ? "done" : ""}
            aria-current={step === i + 1 ? "step" : undefined}
          >
            <span>{i + 1}</span>
            {c}
          </li>
        ))}
      </ol>

      {step === 1 && (
        <>
          <h3>Šta proizvodite?</h3>
          <div className="wizard-tiles">
            {TYPES.map((t) => {
              const Icon = t.icon;
              return (
                <button
                  type="button"
                  key={t.id}
                  className="tile"
                  onClick={() => {
                    setTypeId(t.id);
                    setSpecies("");
                    setIntensity("");
                    setQuery("");
                    setStep(2);
                  }}
                >
                  <Icon size={26} />
                  <strong>{t.label}</strong>
                  <small>{t.hint}</small>
                </button>
              );
            })}
          </div>
        </>
      )}

      {step === 2 && type && (
        <>
          <h3>
            {livestock
              ? "Koju vrstu stoke gajite?"
              : `Koju kulturu gajite? (${type.label})`}
          </h3>
          {names.length > 8 && (
            <label className="field">
              <span>Pretraga</span>
              <input
                aria-label="Pretraga kulture"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Počnite da kucate naziv"
              />
            </label>
          )}
          {!livestock || !species ? (
            <div className="wizard-list">
              {names.map((n) => (
                <button
                  type="button"
                  key={n}
                  className="tile small"
                  onClick={() => {
                    if (livestock) setSpecies(n);
                    else chooseTemplate(templates.find((t) => t.name === n).id);
                  }}
                >
                  {pretty(n)}
                </button>
              ))}
              {!names.length && (
                <p className="hint">Nema rezultata za „{query}“.</p>
              )}
            </div>
          ) : (
            <>
              <p>
                <strong>{pretty(species)}</strong> — izaberite intenzitet
                proizvodnje:
              </p>
              <div className="wizard-list">
                {templates
                  .filter((t) => t.name === species)
                  .map((t) => (
                    <button
                      type="button"
                      key={t.id}
                      className="tile small"
                      onClick={() => {
                        setIntensity(t.intensity || "");
                        chooseTemplate(t.id);
                      }}
                    >
                      {t.intensity === "niži"
                        ? "Niži intenzitet"
                        : t.intensity === "viši"
                          ? "Viši intenzitet"
                          : t.name}
                    </button>
                  ))}
              </div>
              <button
                type="button"
                className="text-button"
                onClick={() => setSpecies("")}
              >
                ← Druga vrsta
              </button>
            </>
          )}
          <div className="form-actions">
            <button
              type="button"
              className="secondary"
              onClick={() => setStep(1)}
            >
              ← Nazad
            </button>
          </div>
        </>
      )}

      {step === 3 && template && q && (
        <>
          <h3>
            {pretty(template.name)}
            {template.intensity && ` · ${template.intensity} intenzitet`}
          </h3>
          <div className="form-grid">
            <label className="field">
              <span>{q.label} *</span>
              <input
                aria-label={q.label}
                inputMode="decimal"
                autoFocus
                value={scale}
                onChange={(e) => setScale(e.target.value)}
                placeholder="npr. 2,5"
              />
            </label>
            {q.units.length > 0 && (
              <label className="field">
                <span>Jedinica</span>
                <select
                  aria-label="Jedinica površine"
                  value={scaleUnit}
                  onChange={(e) => setScaleUnit(e.target.value)}
                >
                  {q.units.map((u) => (
                    <option key={u} value={u}>
                      {UNIT_LABEL[u]}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="field">
              <span>Početak</span>
              <input
                aria-label="Početak"
                type="date"
                value={start}
                onChange={(e) => setStart(e.target.value)}
              />
            </label>
            {basis === "head_cycle" && (
              <label className="field">
                <span>Očekivani završetak ciklusa (opciono)</span>
                <input
                  aria-label="Očekivani završetak ciklusa"
                  type="date"
                  value={end}
                  onChange={(e) => setEnd(e.target.value)}
                />
              </label>
            )}
          </div>
          {scale && !validScale && (
            <div className="form-error" role="alert">
              Unesite pozitivan broj, npr. 2,5.
            </div>
          )}
          {basis === "head_year" && (
            <p className="hint">
              Normativ je godišnji; trošak do danas računa se srazmerno
              proteklom delu godine.
            </p>
          )}
          {["ha", "m2"].includes(basis!) && (
            <p className="hint">
              Trošak prati standardni raspored radova i materijala za ovu
              kulturu.
            </p>
          )}
          <CostPreview cost={cost} loading={loading} />
          <details>
            <summary>Naziv proizvodnje (opciono)</summary>
            <label className="field">
              <span>Naziv, npr. parcela ili staja</span>
              <input
                aria-label="Naziv proizvodnje"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={defaultName}
                maxLength={120}
              />
            </label>
          </details>
          {error && (
            <div className="form-error" role="alert">
              {error}
            </div>
          )}
          <div className="form-actions">
            <button
              type="button"
              className="secondary"
              onClick={() => setStep(2)}
            >
              ← Nazad
            </button>
            <button
              type="button"
              className="primary"
              disabled={!validScale || busy}
              onClick={save}
            >
              {busy ? "Čuvanje…" : "Sačuvaj proizvodnju"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/** Kartica troška za pregled i detalj proizvodnje. */
export function CostBar({ cost }: { cost?: Any }) {
  if (!cost) return null;
  const share =
    cost.planned && cost.toDate && Number(cost.planned) > 0
      ? Math.min(
          100,
          Math.round((Number(cost.toDate) / Number(cost.planned)) * 100),
        )
      : null;
  return (
    <div className="cost-bar">
      <div className="cost-figures">
        <span>
          Ukupan trošak sezone
          <strong>{money(cost.planned)}</strong>
        </span>
        <span>
          Do danas
          <strong>{money(cost.toDate)}</strong>
        </span>
      </div>
      {share != null && (
        <div
          className="progress"
          role="progressbar"
          aria-valuenow={share}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Udeo troška do danas"
        >
          <i style={{ width: share + "%" }} />
        </div>
      )}
      {share != null && (
        <small>{share}% planiranog troška je do danas nastalo</small>
      )}
      {cost.problems?.map((p: string) => (
        <small key={p} className="pending-price">
          {p}
        </small>
      ))}
      {!cost.problems?.length && cost.note && <small>{cost.note}</small>}
    </div>
  );
}

export function ProductionsPage({ data, boot, onSelect, onAdd }: Any) {
  const [filter, setFilter] = useState("all");
  const costs = data.costs;
  const all: Any[] = data.productions || [];
  const typeOf = (p: Any) => typeOfSheet(p.category);
  const present = TYPES.filter((t) => all.some((p) => typeOf(p)?.id === t.id));
  const items = all.filter((p) => filter === "all" || typeOf(p)?.id === filter);
  const quantity = (p: Any) => {
    const s = p.details?.scale;
    if (!s) return "količina nije uneta";
    const u =
      p.basis === "head_year" || p.basis === "head_cycle"
        ? "grla"
        : p.basis === "seedlings"
          ? "biljaka"
          : p.basis === "bag"
            ? "vreća"
            : p.details.scaleUnit || p.basis;
    return `${new Intl.NumberFormat("sr-Latn-RS", { maximumFractionDigits: 2 }).format(Number(s))} ${u}`;
  };
  if (!all.length)
    return (
      <section className="panel empty-start">
        <Sprout size={34} />
        <h2>Dodajte prvu proizvodnju</h2>
        <p>
          Izaberite vrstu proizvodnje i unesite površinu ili broj grla. Trošak
          se sam izračuna prema odobrenom cenovniku.
        </p>
        <button className="primary" onClick={onAdd}>
          Dodaj proizvodnju
        </button>
      </section>
    );
  return (
    <>
      {costs && (
        <div className="metrics three">
          <article className="metric accent">
            <div>
              <span>Ukupan trošak svih proizvodnji</span>
            </div>
            <strong>
              {nf(costs.totals.planned ?? costs.totals.knownPlanned)}{" "}
              <small>RSD</small>
            </strong>
            <p>
              {costs.totals.planned == null
                ? "Zbir poznatih; neke proizvodnje su nepotpune"
                : "Po odobrenom cenovniku"}
            </p>
          </article>
          <article className="metric">
            <div>
              <span>Trošak do danas</span>
            </div>
            <strong>
              {nf(costs.totals.toDate ?? costs.totals.knownToDate)}{" "}
              <small>RSD</small>
            </strong>
            <p>Na dan {costs.asOf}</p>
          </article>
          <article className="metric">
            <div>
              <span>Proizvodnje</span>
            </div>
            <strong>{all.length}</strong>
            <p>
              {costs.totals.incomplete
                ? `${costs.totals.incomplete} sa nepotpunim obračunom`
                : "Sve obračunate"}
            </p>
          </article>
        </div>
      )}
      <div className="type-chips" role="group" aria-label="Vrsta proizvodnje">
        <button
          className={filter === "all" ? "active" : ""}
          onClick={() => setFilter("all")}
        >
          Sve ({all.length})
        </button>
        {present.map((t) => (
          <button
            key={t.id}
            className={filter === t.id ? "active" : ""}
            onClick={() => setFilter(t.id)}
          >
            {t.label} ({all.filter((p) => typeOf(p)?.id === t.id).length})
          </button>
        ))}
      </div>
      <div className="production-grid">
        {items.map((p) => {
          const t = typeOf(p),
            Icon = t?.icon || Sprout;
          return (
            <button
              className="production-card"
              key={p.id}
              onClick={() => onSelect(p.id)}
            >
              <div>
                <span className="crop-icon">
                  <Icon size={23} />
                </span>
              </div>
              <small>{t?.label || p.category}</small>
              <h2>{p.name}</h2>
              <p>
                {quantity(p)}
                {p.intensity && ` · ${p.intensity} intenzitet`}
              </p>
              <CostBar cost={costs?.items?.[p.id]} />
              <div className="card-bottom">
                Otvori proizvodnju
                <ArrowUpRight size={18} />
              </div>
            </button>
          );
        })}
      </div>
    </>
  );
}
