import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Sprout,
  LayoutDashboard,
  Tractor,
  ArrowLeftRight,
  Package,
  ChartNoAxesCombined,
  BookOpen,
  Settings,
  ShieldCheck,
  LogOut,
  Plus,
  ArrowUpRight,
  Download,
  Menu,
  X,
  ChevronRight,
  CircleAlert,
  Leaf,
  CalendarDays,
  Wallet,
  Check,
  Search,
  RefreshCw,
} from "lucide-react";
import { api, download, selectFarm } from "./api";
import "./styles.css";
import { StipsAdmin, StipsMarket } from "./stips";
import { StipsInputAdmin } from "./input-prices";
import { SharedPriceTable } from "./pricing";
type Any = any;
const number = (v: Any, digits = 2) =>
  v == null
    ? "—"
    : new Intl.NumberFormat("sr-Latn-RS", {
        maximumFractionDigits: digits,
        minimumFractionDigits: digits,
      }).format(Number(v));
const today = () => new Date().toISOString().slice(0, 10);
const year = () => new Date().getFullYear();
const labels: Record<string, string> = {
  sale: "Prodaja",
  cost: "Trošak",
  subsidy: "Subvencija",
  other_income: "Ostali prihodi",
  draft: "Nacrt",
  final: "Evidentirano",
  requested: "Potraživana",
  approved: "Odobrena",
  received: "Primljena",
  active: "Aktivan",
  archive: "Arhiva",
  production: "Proizvodnja",
  purchase: "Nabavka",
  opening: "Početno stanje",
  correction_in: "Korekcija +",
  correction_out: "Korekcija −",
  household: "Sopstvena potrošnja",
  writeoff: "Otpis",
  transfer_in: "Interni ulaz",
  transfer_out: "Interni izlaz",
  feed_use: "Potrošnja",
  byproduct: "Nusproizvod",
};
const units = ["kg", "t", "l", "kom", "biljka", "grlo", "vreća", "ha", "m2"];
function Badge({ children, tone = "neutral" }: Any) {
  return <span className={"badge " + tone}>{children}</span>;
}
function Empty({
  title = "Nema evidentiranih podataka",
  text = "Unesite prvi zapis da biste videli pregled.",
  action,
}: Any) {
  return (
    <div className="empty">
      <Leaf size={30} />
      <h3>{title}</h3>
      <p>{text}</p>
      {action}
    </div>
  );
}
function Alert({ children }: Any) {
  return (
    <div className="alert">
      <CircleAlert size={18} />
      <div>{children}</div>
    </div>
  );
}
function Field({
  label,
  name,
  type = "text",
  options,
  required = false,
  value,
  onChange,
  defaultValue,
  help,
  ...rest
}: Any) {
  return (
    <label className={type === "checkbox" ? "checkbox" : "field"}>
      {type !== "checkbox" && (
        <span>
          {label}
          {required && " *"}
        </span>
      )}
      {options ? (
        <select
          aria-label={label}
          name={name}
          required={required}
          value={value}
          onChange={onChange}
          defaultValue={defaultValue}
          {...rest}
        >
          {options.map((o: Any) =>
            typeof o === "string" ? (
              <option key={o}>{o}</option>
            ) : (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ),
          )}
        </select>
      ) : type === "textarea" ? (
        <textarea
          aria-label={label}
          name={name}
          required={required}
          value={value}
          onChange={onChange}
          defaultValue={defaultValue}
          {...rest}
        />
      ) : (
        <input
          aria-label={label}
          name={name}
          type={type}
          required={required}
          value={value}
          onChange={onChange}
          defaultValue={defaultValue}
          step={type === "number" ? "any" : undefined}
          min={type === "number" ? "0" : undefined}
          {...rest}
        />
      )}{" "}
      {type === "checkbox" && <span>{label}</span>}
      {help && <small>{help}</small>}
    </label>
  );
}
function Form({
  children,
  onSubmit,
  label = "Sačuvaj",
  secondary = false,
}: Any) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setError("");
        setBusy(true);
        try {
          await onSubmit(
            Object.fromEntries(new FormData(e.currentTarget)),
            e.currentTarget,
          );
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      {children}
      {error && (
        <div className="form-error" role="alert">
          {error}
        </div>
      )}
      <div className="form-actions">
        <button className={secondary ? "secondary" : "primary"} disabled={busy}>
          {busy ? "Čuvanje…" : label}
          <ChevronRight size={16} />
        </button>
      </div>
    </form>
  );
}
function Modal({ title, children, onClose }: Any) {
  useEffect(() => {
    const f = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", f);
    return () => window.removeEventListener("keydown", f);
  }, [onClose]);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="modal-title">
          <h2>{title}</h2>
          <button
            className="icon-button"
            aria-label="Zatvori"
            onClick={onClose}
          >
            <X />
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}
function App() {
  const [boot, setBoot] = useState<Any>(),
    [data, setData] = useState<Any>({}),
    [page, setPage] = useState("overview"),
    [detail, setDetail] = useState(""),
    [modal, setModal] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [mobile, setMobile] = useState(false),
    [loading, setLoading] = useState(true);
  async function load() {
    setError("");
    try {
      const b = await api("/bootstrap");
      setBoot(b);
      if (b.farm) {
        selectFarm(b.farm.id);
        const [
          report,
          productions,
          events,
          inventory,
          market,
          handbook,
          snapshots,
        ] = await Promise.all(
          [
            "/report",
            "/productions",
            "/events",
            "/inventory",
            "/market",
            "/handbook",
            "/snapshots",
          ].map((p) => api(p)),
        );
        setData({
          report,
          productions,
          events,
          inventory,
          market,
          handbook,
          snapshots,
        });
      }
    } catch (e) {
      if ((e as Error).message.includes("prijava")) setBoot(null);
      else setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);
  async function saved() {
    setModal("");
    setNotice("Podaci su sačuvani.");
    await load();
    setTimeout(() => setNotice(""), 4000);
  }
  async function action(fn: () => Promise<Any>) {
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const nav = [
    ["overview", "Pregled gazdinstva", LayoutDashboard],
    ["productions", "Moje proizvodnje", Tractor],
    ["events", "Prodaja i troškovi", ArrowLeftRight],
    ["inventory", "Zalihe i potrošnja", Package],
    ["cash", "Novčani tok", Wallet],
    ["market", "Tržište Srbije", ChartNoAxesCombined],
    ["handbook", "Priručnik", BookOpen],
    ["wip", "Zalihe na parceli", CalendarDays],
  ] as const;
  if (loading)
    return (
      <div className="loading">
        <Sprout /> Priprema pregleda…
      </div>
    );
  if (!boot) return <Auth onSuccess={load} />;
  if (!boot.farm)
    return (
      <div className="onboarding">
        <Brand />
        <h1>Dobro došli u Agro portal.</h1>
        <p>Otvorite profil gazdinstva. Podaci su dostupni samo vašem nalogu.</p>
        <FarmForm onDone={saved} />
        {error && <Alert>{error}</Alert>}
      </div>
    );
  const titles: Any = {
    overview: [
      "Dobro došli na svoje gazdinstvo.",
      "Jasan pogled na ostvarenu proizvodnju i poslovanje.",
    ],
    productions: [
      "Moje proizvodnje",
      "Od ostvarenih količina do obračunske marže.",
    ],
    events: [
      "Prodaja, troškovi i subvencije",
      "Poslovni događaj i njegovo plaćanje vode se odvojeno.",
    ],
    inventory: [
      "Zalihe i interna potrošnja",
      "Svaka količina ima poreklo. Svaki prenos ima trag.",
    ],
    cash: [
      "Ostvareni novčani tok",
      "Samo stvarno evidentirane uplate i isplate.",
    ],
    market: [
      "Tržište Srbije",
      "Provereni pokazatelji i dokumentovane poslovne informacije.",
    ],
    handbook: ["Priručnik", "Odobreni normativi i transparentna metodologija."],
    wip: ["Zalihe na parceli", "Kumulativna ulaganja u proizvodnju u toku."],
    settings: [
      "Podešavanja gazdinstva",
      "Profil, period i osnovna valuta prikaza.",
    ],
    admin: [
      "Administracija",
      "Izvori, odobravanje normativa i evidencija promena.",
    ],
  };
  const changePage = (p: string) => {
    setPage(p);
    setDetail("");
    setMobile(false);
  };
  return (
    <div className="app">
      <aside className={"sidebar " + (mobile ? "open" : "")}>
        <Brand />
        <div className="workspace">
          <span className="farm-mark">
            <Tractor size={21} />
          </span>
          <div>
            <strong>{boot.farm.name}</strong>
            <small>{boot.farm.municipality || "Moje gazdinstvo"}</small>
          </div>
        </div>
        <div className="nav-label">GAZDINSTVO</div>
        <nav>
          {nav.map(([id, label, Icon]) => (
            <button
              key={id}
              className={page === id ? "selected" : ""}
              onClick={() => changePage(id)}
            >
              <Icon size={19} />
              {label}
              {id === "productions" && (
                <span className="nav-count">
                  {data.productions?.length || 0}
                </span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <button onClick={() => changePage("settings")}>
            <Settings size={18} />
            Podešavanja
          </button>
          {boot.admin && (
            <button onClick={() => changePage("admin")}>
              <ShieldCheck size={18} />
              Administracija
            </button>
          )}
          <div className="profile">
            <span className="avatar">
              {boot.user.name.slice(0, 2).toUpperCase()}
            </span>
            <div>
              <strong>{boot.user.name}</strong>
              <small>
                {boot.farm.role === "owner"
                  ? "Vlasnik gazdinstva"
                  : "Član gazdinstva"}
              </small>
            </div>
            <button
              className="icon-button"
              aria-label="Odjavi se"
              onClick={() =>
                action(async () => {
                  await api("/auth/sign-out", {});
                  selectFarm("");
                  location.reload();
                })
              }
            >
              <LogOut size={17} />
            </button>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <button
            className="mobile-menu icon-button"
            onClick={() => setMobile(!mobile)}
            aria-label="Navigacija"
          >
            <Menu />
          </button>
          <span>
            Gazdinstvo <ChevronRight size={14} />
            <strong>{titles[page][0].replace(".", "")}</strong>
          </span>
          <div className="top-controls">
            {boot.farms.length > 1 && (
              <select
                aria-label="Gazdinstvo"
                value={boot.farm.id}
                onChange={(e) => {
                  selectFarm(e.target.value);
                  load();
                }}
              >
                {boot.farms.map((f: Any) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            )}
            <span className="period-chip">
              <CalendarDays size={15} />
              {boot.farm.year}. godina
            </span>
            <span className="currency-chip">{boot.farm.currency}</span>
          </div>
        </header>
        <main>
          <div className="page-title">
            <div>
              <div className="eyebrow">AGRO PORTAL / {boot.farm.year}</div>
              <h1>
                {detail
                  ? data.productions?.find((p: Any) => p.id === detail)?.name
                  : titles[page][0]}
              </h1>
              <p>{titles[page][1]}</p>
            </div>
            <div className="page-actions">
              {page !== "admin" && (
                <button
                  className="secondary"
                  onClick={() => setModal("export")}
                >
                  <Download size={16} />
                  Izveštaj
                </button>
              )}
              {["overview", "productions"].includes(page) && (
                <button
                  className="primary"
                  onClick={() => setModal("production")}
                >
                  <Plus size={17} />
                  Dodaj proizvodnju
                </button>
              )}
              {page === "events" && (
                <button className="primary" onClick={() => setModal("event")}>
                  <Plus size={17} />
                  Novi događaj
                </button>
              )}
              {page === "cash" && (
                <button className="primary" onClick={() => setModal("payment")}>
                  <Plus size={17} />
                  Uplata / isplata
                </button>
              )}
            </div>
          </div>
          {error && (
            <Alert>
              <button
                className="dismiss"
                onClick={() => setError("")}
                aria-label="Ukloni poruku"
              >
                ×
              </button>
              {error}
            </Alert>
          )}
          {notice && (
            <div className="success" role="status">
              <Check size={18} />
              {notice}
            </div>
          )}
          {page === "overview" && data.report && (
            <Overview
              r={data.report}
              onProduction={(id: string) => {
                setPage("productions");
                setDetail(id);
              }}
              onAdd={() => setModal("production")}
              onEvents={() => setPage("events")}
              onCash={() => setPage("cash")}
            />
          )}
          {page === "productions" &&
            (detail ? (
              <ProductionDetail
                id={detail}
                data={data}
                boot={boot}
                onBack={() => setDetail("")}
                saved={saved}
                setModal={setModal}
                action={action}
              />
            ) : (
              <Productions
                data={data}
                boot={boot}
                onSelect={setDetail}
                onAdd={() => setModal("production")}
              />
            ))}
          {page === "events" && (
            <Events
              data={data}
              onAdd={() => setModal("event")}
              pay={() => setModal("payment")}
              action={action}
              saved={saved}
            />
          )}
          {page === "inventory" && (
            <Inventory data={data} onAction={setModal} />
          )}
          {page === "cash" && (
            <Cash
              r={data.report}
              onOpening={() => setModal("opening")}
              onPayment={() => setModal("payment")}
            />
          )}
          {page === "market" && <Market data={data.market} />}
          {page === "handbook" && <Handbook data={data.handbook} />}
          {page === "wip" && (
            <section className="panel">
              <div className="panel-head">
                <h2>Ulaganja po mesecima</h2>
                <button className="secondary" onClick={() => setModal("wip")}>
                  <Plus size={16} />
                  Dodaj mesečno stanje
                </button>
              </div>
              <Alert>
                Svaki unos je kumulativno stanje ulaganja. Mesečni iznosi se ne
                sabiraju kao novi rashodi i ne ulaze u novčani tok. Izvor:
                „Zalihe na parceli“.
              </Alert>
              {data.inventory?.wip.length ? (
                <Table
                  heads={[
                    "Proizvodnja",
                    "Mesec",
                    "Kumulativno ulaganje",
                    "Napomena",
                  ]}
                  rows={data.inventory.wip.map((x: Any) => [
                    data.productions.find((p: Any) => p.id === x.production_id)
                      ?.name,
                    x.month,
                    `${number(x.money[boot.farm.currency.toLowerCase()])} ${boot.farm.currency}`,
                    x.note,
                  ])}
                />
              ) : (
                <Empty
                  title="Još nema unetih ulaganja"
                  text="Ovo je zaseban pregled proizvodnje u toku, odvojen od gotovih proizvoda i plaćanja."
                />
              )}
            </section>
          )}
          {page === "settings" && (
            <section className="panel narrow">
              <h2>Profil gazdinstva</h2>
              <FarmForm farm={boot.farm} onDone={saved} />
              <button className="text-button" onClick={() => setModal("farm")}>
                Otvori dodatno gazdinstvo
              </button>
            </section>
          )}
          {page === "admin" && <Admin onDone={load} />}
          <footer>
            Agro portal{" "}
            <span>Ostvareno poslovanje · Transparentan obračun</span>
            <span>Bez poreskog obračuna i pune dobiti</span>
          </footer>
        </main>
      </div>
      {modal && (
        <Modal
          title={
            (
              {
                production: "Nova proizvodnja",
                event: "Novi poslovni događaj",
                payment: "Evidencija uplate / isplate",
                opening: "Početno stanje novca",
                inventory: "Promena zaliha",
                transfer: "Interni prenos",
                feed: "Stvarna potrošnja iz zalihe",
                wip: "Kumulativno ulaganje",
                export: "Izvoz i istorija obračuna",
                farm: "Dodatno gazdinstvo",
              } as Any
            )[modal]
          }
          onClose={() => setModal("")}
        >
          {modal === "production" && (
            <ProductionForm boot={boot} onDone={saved} />
          )}
          {modal === "event" && (
            <EventForm data={data} initialProduction={detail} onDone={saved} />
          )}
          {modal === "payment" && <PaymentForm data={data} onDone={saved} />}
          {modal === "farm" && <FarmForm onDone={saved} />}
          {modal === "opening" && (
            <Form
              onSubmit={async (v: Any) => {
                await api("/opening", v);
                await saved();
              }}
            >
              <p>
                Stanje na početku {boot.farm.year}. godine. Bez ovog podatka
                prikazuje se samo neto tok.
              </p>
              <div className="form-grid">
                <Field
                  label="Početni iznos"
                  name="amount"
                  type="number"
                  required
                />
                <Field
                  label="Valuta"
                  name="currency"
                  options={["RSD", "EUR"]}
                />
              </div>
            </Form>
          )}
          {modal === "inventory" && <StockForm data={data} onDone={saved} />}
          {modal === "transfer" && <TransferForm data={data} onDone={saved} />}
          {modal === "feed" && <FeedForm data={data} onDone={saved} />}
          {modal === "wip" && (
            <Form
              onSubmit={async (v: Any) => {
                await api("/wip", v);
                await saved();
              }}
            >
              <div className="form-grid">
                <ProductionField data={data} />
                <Field
                  name="month"
                  label="Datum mesečnog stanja"
                  type="date"
                  required
                />
                <Field
                  label="Kumulativni iznos"
                  name="amount"
                  type="number"
                  required
                />
                <Field
                  label="Valuta"
                  name="currency"
                  options={["RSD", "EUR"]}
                />
              </div>
              <Field label="Osnova i napomena" name="note" required />
              <Alert>
                Ovaj unos ne stvara novo plaćanje niti automatski rashod.
              </Alert>
            </Form>
          )}
          {modal === "export" && (
            <ExportPanel
              data={data}
              detail={detail}
              action={action}
              saved={saved}
            />
          )}
        </Modal>
      )}
    </div>
  );
}
function Brand() {
  return (
    <div className="brand">
      <div>
        <Sprout size={24} />
      </div>
      <span>
        agro<span>portal</span>
        <small>VAŠ PARTNER U PROIZVODNJI</small>
      </span>
    </div>
  );
}
function Auth({ onSuccess }: Any) {
  const token = new URLSearchParams(location.search).get("token");
  const [mode, setMode] = useState(token ? "reset" : "login"),
    [notice, setNotice] = useState("");
  return (
    <div className="auth-layout">
      <section className="auth-story">
        <Brand />
        <div>
          <span className="eyebrow">ZA GAZDINSTVA KOJA ZNAJU ŠTA RADE</span>
          <h1>
            Vaš trud.
            <br />
            Vaša proizvodnja.
            <br />
            <em>Jasna računica.</em>
          </h1>
          <p>
            Od njive do prodaje — pratite ostvarene rezultate svog gazdinstva na
            jednom mestu.
          </p>
          <div className="auth-pills">
            <span>
              <Check size={16} />
              Zaseban nalog
            </span>
            <span>
              <Check size={16} />
              Sledljivi podaci
            </span>
          </div>
        </div>
        <small>AGRO PORTAL · SRBIJA</small>
      </section>
      <section className="auth-form">
        <div>
          <span className="eyebrow">DOBRO DOŠLI</span>
          <h2>
            {mode === "login"
              ? "Prijavite se na svoje gazdinstvo"
              : mode === "register"
                ? "Otvorite svoj nalog"
                : mode === "reset"
                  ? "Postavite novu lozinku"
                  : "Obnova pristupa"}
          </h2>
          <p>
            {mode === "register"
              ? "Vaši poslovni podaci pripadaju vašem gazdinstvu."
              : "Nastavite tamo gde ste stali."}
          </p>
          {notice && <Alert>{notice}</Alert>}
          <Form
            label={
              mode === "login"
                ? "Prijavi se"
                : mode === "register"
                  ? "Kreiraj nalog"
                  : mode === "reset"
                    ? "Promeni lozinku"
                    : "Pošalji link"
            }
            onSubmit={async (v: Any) => {
              if (mode === "register") {
                await api("/auth/sign-up/email", { ...v });
                await onSuccess();
              }
              if (mode === "login") {
                await api("/auth/sign-in/email", v);
                await onSuccess();
              }
              if (mode === "forgot") {
                await api("/auth/request-password-reset", {
                  email: v.email,
                  redirectTo: location.origin + "/reset-password",
                });
                setNotice(
                  "Ako nalog postoji, uputstvo je poslato. U lokalnom razvoju administrator preuzima poruku iz zaštićenog data/mail direktorijuma.",
                );
              }
              if (mode === "reset") {
                await api("/auth/reset-password", {
                  token,
                  newPassword: v.password,
                });
                setMode("login");
                setNotice("Lozinka je promenjena.");
                history.replaceState({}, "", "/");
              }
            }}
          >
            {mode === "register" && (
              <Field
                label="Ime i prezime"
                name="name"
                autoComplete="name"
                required
              />
            )}
            {mode !== "reset" && (
              <Field
                label="Email adresa"
                name="email"
                type="email"
                autoComplete="email"
                required
              />
            )}
            {["login", "register", "reset"].includes(mode) && (
              <Field
                label="Lozinka"
                name="password"
                type="password"
                autoComplete={
                  mode === "login" ? "current-password" : "new-password"
                }
                minLength={12}
                help="Najmanje 12 znakova"
                required
              />
            )}
          </Form>
          <div className="auth-links">
            <button
              className="text-button"
              onClick={() => {
                setMode(mode === "register" ? "login" : "register");
                setNotice("");
              }}
            >
              {mode === "register"
                ? "Već imate nalog? Prijavite se"
                : "Nemate nalog? Registrujte se"}
            </button>
            <button
              className="text-button"
              onClick={() => setMode(mode === "forgot" ? "login" : "forgot")}
            >
              {mode === "forgot"
                ? "Povratak na prijavu"
                : "Zaboravljena lozinka?"}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
function FarmForm({ farm, onDone }: Any) {
  return (
    <Form
      onSubmit={async (v: Any) => {
        const result = await api(
          farm ? "/farm" : "/farms",
          { ...v, year: Number(v.year) },
          farm ? "PUT" : "POST",
        );
        if (result.id) selectFarm(result.id);
        await onDone();
      }}
    >
      <Field
        label="Naziv gazdinstva"
        name="name"
        defaultValue={farm?.name}
        required
      />
      <div className="form-grid">
        <Field
          label="Opština"
          name="municipality"
          defaultValue={farm?.municipality}
        />
        <Field
          label="Obračunska godina"
          name="year"
          type="number"
          defaultValue={farm?.year || year()}
          required
        />
        <Field
          label="Osnovna valuta prikaza"
          name="currency"
          options={["RSD", "EUR"]}
          defaultValue={farm?.currency || "RSD"}
        />
      </div>
      <p className="hint">
        Statistički podaci u prvoj fazi odnose se na Srbiju ukupno.
      </p>
    </Form>
  );
}
function Table({ heads, rows }: Any) {
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            {heads.map((h: string) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row: Any, i: number) => (
            <tr key={i}>
              {row.map((cell: Any, j: number) => (
                <td key={j}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function Metric({ label, value, unit, help, icon: Icon, accent = false }: Any) {
  return (
    <article className={"metric " + (accent ? "accent" : "")}>
      <div>
        <span>{label}</span>
        {Icon && <Icon size={19} />}
      </div>
      <strong>
        {value}
        <small>{unit}</small>
      </strong>
      <p>{help}</p>
    </article>
  );
}
function Overview({ r, onProduction, onAdd, onEvents, onCash }: Any) {
  const t = r.totals;
  return (
    <>
      <div className="season-banner">
        <div className="season-icon">
          <Sprout size={26} />
        </div>
        <div>
          <strong>Svaka sezona zaslužuje jasnu računicu.</strong>
          <p>Vaši ostvareni rezultati za {r.farm.year}. godinu.</p>
        </div>
        <Badge tone="green">Ostvareno poslovanje</Badge>
      </div>
      <div className="metrics">
        <Metric
          label="Ostvareni prihodi"
          value={number(t.revenue)}
          unit={r.currency}
          help="Eksterna prodaja i ostali priznati prihodi"
          icon={ArrowUpRight}
        />
        <Metric
          label="Trošak po normativu"
          value={number(t.normativeCost)}
          unit={r.currency}
          help={
            t.normativeCost === null
              ? "Nedostaje aktivan cenovnik ili podaci"
              : "Pripisani varijabilni trošak perioda"
          }
          icon={Tractor}
        />
        <Metric
          label="Obračunska marža"
          value={number(t.margin?.amount)}
          unit={r.currency}
          help={
            t.margin
              ? `${number(t.margin.percent)}% na prikazani prihod sa subvencijama`
              : "Nepotpun obračun — bez pretpostavljenih nula"
          }
          accent
          icon={ChartNoAxesCombined}
        />
        <Metric
          label="Neto novčani tok"
          value={number(t.netCash)}
          unit={r.currency}
          help="Stvarne uplate minus stvarne isplate"
          icon={Wallet}
        />
      </div>
      {(r.results.some((p: Any) => p.missing.length) || !r.results.length) && (
        <Alert>
          <strong>Pregled ima nepotpune podatke.</strong>{" "}
          {r.results.length
            ? "Detalji su označeni uz svaku proizvodnju."
            : "Dodajte ostvarenu proizvodnju da biste započeli obračun."}{" "}
          Cene iz 2017. su arhivske i nisu aktivan cenovnik.
        </Alert>
      )}
      <div className="dashboard-grid">
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>
                Moje proizvodnje{" "}
                <span className="count">{r.results.length}</span>
              </h2>
              <p>Ostvareni rezultati, po proizvodnji</p>
            </div>
            <button className="text-button" onClick={onAdd}>
              <Plus size={16} />
              Dodaj
            </button>
          </div>
          {r.results.length ? (
            <Table
              heads={["Proizvodnja", "Prihod", "Obračunska marža", "Status"]}
              rows={r.results.map((p: Any) => [
                <button
                  className="production-link"
                  onClick={() => onProduction(p.id)}
                >
                  <span className="crop-icon">
                    <Leaf size={18} />
                  </span>
                  <span>
                    {p.name}
                    <small>{p.template}</small>
                  </span>
                </button>,
                `${number(p.revenue)} ${r.currency}`,
                `${number(p.withSubsidies?.amount)} ${r.currency}`,
                <Badge tone={p.missing.length ? "amber" : "green"}>
                  {p.missing.length ? "Nepotpuno" : "Obračunato"}
                </Badge>,
              ])}
            />
          ) : (
            <Empty
              title="Vaša prva proizvodnja počinje ovde"
              text="Izaberite kulturu ili kategoriju životinja iz izvornog kataloga."
              action={
                <button className="primary" onClick={onAdd}>
                  <Plus size={16} />
                  Dodaj proizvodnju
                </button>
              }
            />
          )}
        </section>
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>Za vašu pažnju</h2>
              <p>Otvorene stavke gazdinstva</p>
            </div>
            <CircleAlert size={18} />
          </div>
          <button className="attention-row" onClick={onEvents}>
            <span className="attention-icon">
              <ArrowUpRight size={20} />
            </span>
            <div>
              <strong>Nenaplaćena prodaja</strong>
              <small>
                {
                  r.outstanding.filter(
                    (o: Any) => o.kind === "sale" && Number(o.remaining) > 0,
                  ).length
                }{" "}
                otvorenih stavki
              </small>
            </div>
            <ChevronRight size={16} />
          </button>
          <button className="attention-row" onClick={onEvents}>
            <span className="attention-icon">
              <Wallet size={20} />
            </span>
            <div>
              <strong>Neplaćeni troškovi</strong>
              <small>
                {
                  r.outstanding.filter(
                    (o: Any) => o.kind === "cost" && Number(o.remaining) > 0,
                  ).length
                }{" "}
                otvorenih stavki
              </small>
            </div>
            <ChevronRight size={16} />
          </button>
          <div className="attention-row">
            <span className="attention-icon">
              <Leaf size={20} />
            </span>
            <div>
              <strong>Priznate subvencije</strong>
              <small>
                {number(t.subsidies)} {r.currency}
              </small>
            </div>
          </div>
          <div className="method-note">
            <ShieldCheck size={20} />
            <p>
              Normativi su pod kontrolom administratora. Vaš unos ne menja
              referentni katalog.
            </p>
          </div>
        </section>
      </div>
      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Novac kroz godinu</h2>
            <p>Prilivi i odlivi po stvarnim datumima plaćanja · {r.currency}</p>
          </div>
          <button className="text-button" onClick={onCash}>
            Detaljan pregled <ArrowUpRight size={16} />
          </button>
        </div>
        <CashChart rows={r.cashflow} />
        <div className="chart-key">
          <span>
            <i />
            Prilivi
          </span>
          <span>
            <i />
            Odlivi
          </span>
        </div>
      </section>
      <p className="methodology">
        <ShieldCheck size={16} />
        {r.coverage}
      </p>
    </>
  );
}
function CashChart({ rows }: Any) {
  const max = Math.max(
    1,
    ...rows.flatMap((r: Any) => [Number(r.incoming), Number(r.outgoing)]),
  );
  return (
    <div className="cash-chart" aria-label="Mesečni prilivi i odlivi">
      <div className="chart-baseline" />
      {rows.map((r: Any, i: number) => (
        <div className="chart-month" key={r.month}>
          <div className="chart-bars">
            <div
              title={`Prilivi ${number(r.incoming)}`}
              style={{ height: Math.max(2, (Number(r.incoming) / max) * 120) }}
            />
            <div
              title={`Odlivi ${number(r.outgoing)}`}
              style={{ height: Math.max(2, (Number(r.outgoing) / max) * 120) }}
            />
          </div>
          <small>
            {
              [
                "jan",
                "feb",
                "mar",
                "apr",
                "maj",
                "jun",
                "jul",
                "avg",
                "sep",
                "okt",
                "nov",
                "dec",
              ][i]
            }
          </small>
        </div>
      ))}
    </div>
  );
}
function Productions({ data, boot, onSelect, onAdd }: Any) {
  const [category, setCategory] = useState("all");
  const items =
    data.productions?.filter(
      (p: Any) => category === "all" || p.category === category,
    ) || [];
  return (
    <>
      <div className="filter-row">
        <Field
          label="Izvorna kategorija"
          value={category}
          onChange={(e: Any) => setCategory(e.target.value)}
          options={[
            { value: "all", label: "Sve kategorije" },
            ...boot.sheets
              .filter((s: Any) => s.role === "production")
              .map((s: Any) => s.original_name),
          ]}
        />
        <Badge>{data.productions?.length || 0} aktivnih evidencija</Badge>
      </div>
      {items.length ? (
        <div className="production-grid">
          {items.map((p: Any) => {
            const r = data.report.results.find((r: Any) => r.id === p.id);
            return (
              <button
                className="production-card"
                key={p.id}
                onClick={() => onSelect(p.id)}
              >
                <div>
                  <span className="crop-icon">
                    <Sprout size={23} />
                  </span>
                  <Badge tone={p.status === "draft" ? "amber" : "green"}>
                    {labels[p.status]}
                  </Badge>
                </div>
                <small>{p.category}</small>
                <h2>{p.name}</h2>
                <p>
                  {p.template_name}
                  {p.intensity && ` · ${p.intensity} intenzitet`}
                </p>
                <div className="production-card-data">
                  <span>
                    Ostvarena osnova
                    <strong>
                      {p.details.scale || "—"} {p.details.scaleUnit || p.basis}
                    </strong>
                  </span>
                  <span>
                    Prihod
                    <strong>
                      {number(r?.revenue)} {data.report.currency}
                    </strong>
                  </span>
                </div>
                <div className="card-bottom">
                  {r?.missing.length
                    ? "Potrebna dopuna podataka"
                    : "Pogledaj rezultat"}
                  <ArrowUpRight size={18} />
                </div>
              </button>
            );
          })}
        </div>
      ) : (
        <section className="panel">
          <Empty
            title="Nema proizvodnji u ovom pregledu"
            action={
              <button className="primary" onClick={onAdd}>
                Dodaj proizvodnju
              </button>
            }
          />
        </section>
      )}
    </>
  );
}
function ProductionField({
  data,
  name = "productionId",
  optional = false,
  value,
  onChange,
}: Any) {
  return (
    <Field
      label="Proizvodnja"
      name={name}
      required={!optional}
      value={value}
      onChange={onChange}
      options={[
        {
          value: "",
          label: optional ? "Gazdinstvo ukupno" : "Izaberite proizvodnju",
        },
        ...(data.productions || []).map((p: Any) => ({
          value: p.id,
          label: p.name,
        })),
      ]}
    />
  );
}
function ProductionForm({ boot, onDone, existing }: Any) {
  const [tid, setTid] = useState(
      existing?.template_id || boot.templates[0]?.id,
    ),
    [cat, setCat] = useState(
      boot.templates.find((t: Any) => t.id === tid)?.sheet_id || "s0",
    );
  const t = boot.templates.find((t: Any) => t.id === tid);
  const basis = t?.basis;
  return (
    <Form
      label={existing ? "Sačuvaj dopunu" : "Sačuvaj proizvodnju"}
      onSubmit={async (v: Any) => {
        const details = Object.fromEntries(
          [
            "scale",
            "scaleUnit",
            "output",
            "outputUnit",
            "product",
            "start",
            "end",
            "houses",
            "plants",
            "buyWeight",
            "sellWeight",
            "mortality",
            "headChange",
            "note",
          ]
            .filter((k) => v[k] !== "" && v[k] != null)
            .map((k) => [k, v[k]]),
        );
        if (existing)
          await api(
            "/productions/" + existing.id,
            { details, status: v.status },
            "PATCH",
          );
        else
          await api("/productions", {
            templateId: tid,
            name: v.name,
            year: Number(v.year),
            details,
            status: v.status,
          });
        await onDone();
      }}
    >
      <div className="form-grid">
        {!existing && (
          <>
            <Field
              label="Izvorna kategorija"
              value={cat}
              onChange={(e: Any) => {
                setCat(e.target.value);
                setTid(
                  boot.templates.find((t: Any) => t.sheet_id === e.target.value)
                    ?.id,
                );
              }}
              options={boot.sheets
                .filter((s: Any) => s.role === "production")
                .map((s: Any) => ({ value: s.id, label: s.original_name }))}
            />
            <Field
              label="Kultura / kategorija / intenzivnost"
              value={tid}
              onChange={(e: Any) => setTid(e.target.value)}
              options={boot.templates
                .filter((t: Any) => t.sheet_id === cat)
                .map((t: Any) => ({
                  value: t.id,
                  label: t.name + (t.intensity ? ` · ${t.intensity}` : ""),
                }))}
            />
            <Field label="Naziv vaše proizvodnje" name="name" required />
            <Field
              label="Godina / sezona"
              name="year"
              type="number"
              defaultValue={boot.farm.year}
              required
            />
          </>
        )}
        <Field
          label={
            basis === "head_year"
              ? "Prosečan broj grla u periodu"
              : basis === "head_cycle"
                ? "Ostvareni broj grla u ciklusu"
                : basis === "seedlings"
                  ? "Proizvedene biljke"
                  : basis === "bag"
                    ? "Broj vreća — admin potvrđuje jedinicu"
                    : "Ostvarena korišćena površina"
          }
          name="scale"
          type="number"
          defaultValue={existing?.details.scale}
        />
        {["ha", "m2"].includes(basis) && (
          <Field
            label="Jedinica površine"
            name="scaleUnit"
            options={["ha", "m2"]}
            defaultValue={existing?.details.scaleUnit || basis}
          />
        )}
        <Field
          label="Početak perioda"
          name="start"
          type="date"
          defaultValue={existing?.details.start || `${boot.farm.year}-01-01`}
        />
        <Field
          label="Kraj perioda"
          name="end"
          type="date"
          defaultValue={existing?.details.end || `${boot.farm.year}-12-31`}
        />
        {t?.name.includes("MALINA") ? (
          <Field
            label="Stvarni proizvod"
            name="product"
            options={["malina", "kupina"]}
            defaultValue={existing?.details.product}
            required
          />
        ) : (
          <Field
            label="Stvarni proizvod (za zalihe i prodaju)"
            name="product"
            defaultValue={existing?.details.product || t?.name}
            key={tid}
          />
        )}
        <Field
          label="Ostvarena količina proizvoda"
          name="output"
          type="number"
          defaultValue={existing?.details.output}
        />
        <Field
          label="Jedinica proizvoda"
          name="outputUnit"
          options={units}
          defaultValue={existing?.details.outputUnit || "kg"}
        />
      </div>
      <details>
        <summary>Dodatni ostvareni podaci</summary>
        <div className="form-grid">
          {basis === "m2" && (
            <>
              <Field label="Broj plastenika" name="houses" type="number" />
              <Field label="Broj strukova" name="plants" type="number" />
            </>
          )}
          {basis?.startsWith("head") && (
            <>
              <Field
                label="Kupovna težina kg/grlu"
                name="buyWeight"
                type="number"
              />
              <Field
                label="Prodajna težina kg/grlu"
                name="sellWeight"
                type="number"
              />
              <Field
                label="Mortalitet / otpis grla"
                name="mortality"
                type="number"
              />
              <Field label="Promene broja grla" name="headChange" />
            </>
          )}
          <Field label="Napomena" name="note" type="textarea" />
        </div>
      </details>
      {basis === "m2" && (
        <Alert>
          Normativ se proporcionalno skalira prema ukupnoj površini m² / 100.
          Broj plastenika nije zamena za površinu.
        </Alert>
      )}
      {basis === "head_year" && (
        <p className="hint">
          Koristi se prosečan broj grla i udeo dana perioda u godini. Ne unosite
          samo stanje na kraju godine.
        </p>
      )}
      {basis === "head_cycle" && (
        <p className="hint">
          Normativ po ciklusu se ne skalira godišnje. Proverite stvarnu kupovnu
          i prodajnu težinu.
        </p>
      )}
      <Field
        label="Status unosa"
        name="status"
        options={[
          { value: "draft", label: "Nacrt — dozvoli nepotpune podatke" },
          {
            value: "final",
            label: "Ostvarena proizvodnja — evidentiraj količinu na zalihi",
          },
        ]}
        defaultValue={existing?.status || "draft"}
      />
      <p className="hint">
        Normativni rezultat ostaje nepotpun dok administrator ne odobri
        kompletan cenovnik i kurs.
      </p>
    </Form>
  );
}
function ProductionDetail({
  id,
  data,
  boot,
  onBack,
  saved,
  setModal,
  action,
}: Any) {
  const p = data.productions.find((p: Any) => p.id === id),
    r = data.report.results.find((p: Any) => p.id === id);
  const [tab, setTab] = useState("result"),
    [editing, setEditing] = useState(false);
  if (!p || !r) return null;
  const events = data.events.filter((e: Any) => e.production_id === id);
  return (
    <>
      <button className="text-button back" onClick={onBack}>
        ← Sve proizvodnje
      </button>
      <div className="detail-summary">
        <span className="crop-icon">
          <Sprout size={28} />
        </span>
        <div>
          <h2>{p.template_name}</h2>
          <p>
            {p.category} · {p.year}
            {p.intensity && ` · ${p.intensity} intenzitet`}
          </p>
        </div>
        <Badge tone="amber">
          {r.missing.length ? "Privremeno / nepotpuno" : "Obračunato"}
        </Badge>
      </div>
      <div className="tabs">
        {[
          ["result", "Rezultati"],
          ["inputs", "Ostvareni podaci"],
          ["events", "Prodaja i troškovi"],
          ["source", "Izvor normativa"],
        ].map(([k, l]) => (
          <button
            key={k}
            className={tab === k ? "active" : ""}
            onClick={() => setTab(k)}
          >
            {l}
          </button>
        ))}
      </div>
      {tab === "result" && (
        <>
          <div className="metrics three">
            <Metric
              label="Prihod od prodaje"
              value={number(r.revenue)}
              unit={data.report.currency}
              help="Bez internih prenosa"
            />
            <Metric
              label="Obračunska marža sa subvencijama"
              value={number(r.withSubsidies?.amount)}
              unit={data.report.currency}
              help={`${number(r.withSubsidies?.percent)}% na prihod sa subvencijama`}
              accent
            />
            <Metric
              label="Marža bez subvencija"
              value={number(r.withoutSubsidies?.amount)}
              unit={data.report.currency}
              help={`${number(r.withoutSubsidies?.percent)}% na prihod bez subvencija`}
            />
          </div>
          {r.missing.length > 0 && (
            <Alert>
              <strong>Za dopunu:</strong>
              <ul>
                {r.missing.map((m: string) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            </Alert>
          )}
          <section className="panel">
            <h2>Tri odvojena pogleda na rezultat</h2>
            <Table
              heads={[
                "Metod",
                "Pripisani trošak",
                "Rezultat sa subvencijama",
                "Status",
              ]}
              rows={[
                [
                  <strong>Obračun po normativu</strong>,
                  number(r.normativeCost),
                  number(r.withSubsidies?.amount),
                  r.version?.name || "Nema aktivne verzije",
                ],
                [
                  "Evidentirani stvarni rezultat",
                  number(r.actualCost),
                  number(r.actualResult.amount),
                  r.actualStatus,
                ],
                [
                  "Kombinovani obračun",
                  number(r.combinedCost),
                  number(r.combinedResult?.amount),
                  `${r.replacements.length} eksplicitnih zamena normativa`,
                ],
              ]}
            />
            <p className="hint">
              Sve vrednosti su u {data.report.currency}. Trošak je pripisan
              eksterno prodatom delu proizvodnje; neprodati deo i sopstvena
              potrošnja prikazuju se zasebno. Dodatni stvarni troškovi ne
              dupliraju automatski normativ.
            </p>
            <button
              className="secondary"
              onClick={() =>
                action(async () => {
                  await api(
                    "/productions/" + id,
                    { actualComplete: !p.actual_complete },
                    "PATCH",
                  );
                  await saved();
                })
              }
            >
              {p.actual_complete
                ? "Ponovo otvori stvarnu evidenciju"
                : "Potvrdi kompletnost stvarne evidencije"}
            </button>
          </section>
          <div className="two-panels">
            <section className="panel">
              <h2>Količine i nenovčane stavke</h2>
              <dl>
                <dt>Ukupan trošak ostvarene proizvodnje</dt>
                <dd>
                  {number(r.normativeTotal)} {data.report.currency}
                </dd>
                <dt>Proizvedeno</dt>
                <dd>
                  {number(r.output)} {p.details.outputUnit}
                </dd>
                <dt>Eksterno prodato</dt>
                <dd>
                  {number(r.sold)} {p.details.outputUnit}
                </dd>
                <dt>Završna zaliha</dt>
                <dd>
                  {number(r.stock)} {p.details.outputUnit}
                </dd>
                <dt>Vrednost zalihe po normativu</dt>
                <dd>
                  {number(r.stockValue)} {data.report.currency}
                </dd>
                {r.byproducts?.map((b: Any) => (
                  <React.Fragment key={b.product}>
                    <dt>Nusproizvod: {b.product}</dt>
                    <dd>
                      {number(b.ending)} {b.unit} · {number(b.value)}{" "}
                      {data.report.currency}
                    </dd>
                  </React.Fragment>
                ))}
                <dt>Sopstvena potrošnja po trošku</dt>
                <dd>
                  {number(r.household)} {data.report.currency}
                </dd>
              </dl>
              <p className="hint">
                Sopstvena potrošnja je nenovčano povlačenje, bez prihoda od
                prodaje. Interni prenosi ne stvaraju eksterni prihod.
              </p>
            </section>
            <section className="panel">
              <h2>Trag obračuna</h2>
              <p>
                Verzija:{" "}
                <strong>{r.version?.name || "Nema odobrenog normativa"}</strong>
              </p>
              <p>
                Kursna lista:{" "}
                {r.norm.money?.rateDate || "Nema potvrđenog kursa"}
              </p>
              <p>Kurs EUR/RSD: {r.norm.money?.rate || "—"}</p>
              <p className="hint">{data.report.coverage}</p>
              <button className="secondary" onClick={() => setModal("export")}>
                <Download size={16} />
                Sačuvaj / izvezi obračun
              </button>
            </section>
          </div>
        </>
      )}
      {tab === "inputs" && (
        <section className="panel narrow">
          <h2>Ostvareni unos</h2>
          {p.status === "draft" ? (
            <ProductionForm boot={boot} existing={p} onDone={saved} />
          ) : (
            <>
              <dl>
                {Object.entries(p.details).map(([k, v]) => (
                  <React.Fragment key={k}>
                    <dt>
                      {(
                        {
                          scale: "Osnova",
                          scaleUnit: "Jedinica osnove",
                          output: "Količina proizvoda",
                          outputUnit: "Jedinica proizvoda",
                          start: "Početak",
                          end: "Kraj",
                          product: "Proizvod",
                          note: "Napomena",
                          buyWeight: "Kupovna težina",
                          sellWeight: "Prodajna težina",
                          mortality: "Mortalitet",
                          headChange: "Promene broja grla",
                          houses: "Broj plastenika",
                          plants: "Broj strukova",
                        } as Any
                      )[k] || k}
                    </dt>
                    <dd>{String(v)}</dd>
                  </React.Fragment>
                ))}
              </dl>
              <p className="hint">
                Završene količine koriguju se sledljivom promenom zaliha sa
                obrazloženjem.
              </p>
            </>
          )}
        </section>
      )}
      {tab === "events" && (
        <Events
          data={{ ...data, events }}
          onAdd={() => setModal("event")}
          pay={() => setModal("payment")}
          action={action}
          saved={saved}
        />
      )}
      {tab === "source" && (
        <section className="panel">
          <h2>Odobren normativ i poreklo</h2>
          {r.norm.lines.length ? (
            <>
              <p>
                {r.version?.name} · {r.norm.version?.model.sheet} ·{" "}
                {r.norm.version?.model.range}
              </p>
              <Table
                heads={[
                  "Stavka",
                  "Količina",
                  "Jedinica",
                  "Cena EUR",
                  "Ukupno EUR",
                ]}
                rows={r.norm.lines.map((i: Any) => [
                  i.name,
                  number(i.quantity, 6),
                  i.unit,
                  number(i.price, 6),
                  number(i.cost, 6),
                ])}
              />
            </>
          ) : (
            <Empty
              title="Nema aktivnog kompletnog normativa"
              text="Arhivski izvor 2017 ne koristi se automatski za nove obračune. Administrator mora odobriti verziju, jedinice i cene."
            />
          )}
        </section>
      )}
    </>
  );
}
function EventForm({ data, initialProduction, onDone, existing }: Any) {
  const [kind, setKind] = useState(existing?.kind || "sale"),
    [productionId, setProduction] = useState(
      existing?.production_id || initialProduction || "",
    ),
    [status, setStatus] = useState(existing?.status || "final");
  const p = data.productions.find((p: Any) => p.id === productionId),
    r = data.report.results.find((r: Any) => r.id === productionId);
  return (
    <Form
      onSubmit={async (v: Any) => {
        const details = Object.fromEntries(
          [
            "quantity",
            "unit",
            "unitPrice",
            "product",
            "counterparty",
            "note",
            "normItemId",
          ]
            .filter((k) => v[k])
            .map((k) => [k, v[k]]),
        );
        for (const k of [
          "replaceNorm",
          "combinedAdditional",
          "inventoryPurchase",
          "byproduct",
        ])
          details[k] = v[k] === "on";
        details.stockType = v.stockType || "material";
        await api(
          existing ? "/events/" + existing.id : "/events",
          {
            kind,
            productionId: productionId || null,
            date: v.date || null,
            title: v.title,
            status,
            amount: v.amount || undefined,
            currency: v.currency,
            details,
          },
          existing ? "PUT" : "POST",
        );
        await onDone();
      }}
    >
      <div className="form-grid">
        <Field
          label="Vrsta događaja"
          value={kind}
          onChange={(e: Any) => {
            setKind(e.target.value);
            setStatus(e.target.value === "subsidy" ? "requested" : "final");
          }}
          options={["sale", "cost", "subsidy", "other_income"].map((value) => ({
            value,
            label: labels[value],
          }))}
        />
        <ProductionField
          data={data}
          optional={kind !== "sale"}
          value={productionId}
          onChange={(e: Any) => setProduction(e.target.value)}
        />
        <Field
          label="Opis / vrsta"
          name="title"
          defaultValue={existing?.title}
          required
        />
        <Field
          label="Datum nastanka / priznavanja"
          name="date"
          type="date"
          defaultValue={existing?.date || today()}
        />
      </div>
      <div className="form-grid">
        {["sale", "cost"].includes(kind) && (
          <>
            <Field
              label="Proizvod ili materijal"
              name="product"
              key={productionId}
              defaultValue={
                existing?.details.product ||
                (kind === "sale" ? p?.details.product || p?.template_name : "")
              }
            />
            <Field
              label="Količina"
              name="quantity"
              type="number"
              defaultValue={existing?.details.quantity}
            />
            <Field
              label="Jedinica"
              name="unit"
              options={units}
              defaultValue={
                existing?.details.unit || p?.details.outputUnit || "kg"
              }
            />
            <Field
              label="Jedinična cena (opciona kontrola)"
              name="unitPrice"
              type="number"
              defaultValue={existing?.details.unitPrice}
            />
          </>
        )}
        <Field
          label="Ukupan iznos"
          name="amount"
          type="number"
          defaultValue={
            existing?.money?.original || existing?.details.originalAmount
          }
        />
        <Field
          label="Valuta unosa"
          name="currency"
          options={["RSD", "EUR"]}
          defaultValue={
            existing?.money?.currency ||
            existing?.details.originalCurrency ||
            "RSD"
          }
        />
      </div>
      <details>
        <summary>
          Dodatni podaci{kind === "cost" ? " i veza sa normativom" : ""}
        </summary>
        <div className="form-grid">
          <Field label="Kupac / dobavljač" name="counterparty" />
          <Field label="Napomena" name="note" type="textarea" />
          {kind === "sale" && (
            <Field
              label="Prodaja nusproizvoda"
              name="byproduct"
              type="checkbox"
            />
          )}
          {kind === "cost" && (
            <>
              <Field
                label="Povezana normativna stavka"
                name="normItemId"
                options={[
                  { value: "", label: "Bez veze sa normativom" },
                  ...(r?.norm.lines || []).map((i: Any) => ({
                    value: i.id,
                    label: `${i.id} · ${i.name}`,
                  })),
                ]}
              />
              <Field
                label="Eksplicitno zameni ovu normativnu stavku u kombinovanom obračunu"
                name="replaceNorm"
                type="checkbox"
              />
              <Field
                label="Dodaj kao poseban trošak samo u kombinovanom obračunu"
                name="combinedAdditional"
                type="checkbox"
              />
              <Field
                label="Nabavka zalihe — rashod tek pri potrošnji"
                name="inventoryPurchase"
                type="checkbox"
              />
              <Field
                label="Vrsta nabavljene zalihe"
                name="stockType"
                options={[
                  { value: "material", label: "Repromaterijal / hrana" },
                  { value: "product", label: "Gotov proizvod" },
                ]}
              />
            </>
          )}
        </div>
      </details>
      <Field
        label="Status"
        value={status}
        onChange={(e: Any) => setStatus(e.target.value)}
        options={(kind === "subsidy"
          ? ["draft", "requested", "approved", "received"]
          : ["draft", "final"]
        ).map((value) => ({ value, label: labels[value] }))}
      />
      <Alert>
        {kind === "subsidy"
          ? "Potraživana subvencija nije priznati prihod niti uplata. Status „primljena“ ne stvara automatsko plaćanje — uplatu evidentirajte zasebno."
          : "Ovaj unos ne stvara uplatu ili isplatu. Plaćanje evidentirajte posebno."}{" "}
        Kada nedostaje kurs, sačuvajte nacrt.
      </Alert>
    </Form>
  );
}
function Events({ data, onAdd, pay, action, saved }: Any) {
  const [filter, setFilter] = useState("all"),
    [editing, setEditing] = useState<Any>();
  const events = (data.events || []).filter(
    (e: Any) => filter === "all" || e.kind === filter,
  );
  return (
    <section className="panel">
      {editing && (
        <Modal title="Dopunite nacrt događaja" onClose={() => setEditing(null)}>
          <EventForm
            data={data}
            existing={editing}
            onDone={async () => {
              setEditing(null);
              await saved();
            }}
          />
        </Modal>
      )}
      <div className="panel-head">
        <div>
          <h2>Poslovni događaji</h2>
          <p>Iznos i kurs se čuvaju na datum događaja</p>
        </div>
        <button className="secondary" onClick={onAdd}>
          <Plus size={16} />
          Dodaj
        </button>
      </div>
      <div className="filter-row">
        <Field
          label="Vrsta događaja"
          value={filter}
          onChange={(e: Any) => setFilter(e.target.value)}
          options={[
            { value: "all", label: "Svi događaji" },
            ...["sale", "cost", "subsidy", "other_income"].map((value) => ({
              value,
              label: labels[value],
            })),
          ]}
        />
        <button className="text-button" onClick={pay}>
          Evidentiraj plaćanje <ChevronRight size={16} />
        </button>
      </div>
      {events.length ? (
        <Table
          heads={[
            "Opis / proizvodnja",
            "Vrsta",
            "Datum",
            "Iznos",
            "Status",
            "Radnja",
          ]}
          rows={events.map((e: Any) => [
            <>
              <strong>{e.title}</strong>
              <small>
                {data.productions?.find((p: Any) => p.id === e.production_id)
                  ?.name || "Gazdinstvo"}
              </small>
            </>,
            labels[e.kind],
            e.date || "Nije unet",
            e.money
              ? `${number(e.money.original)} ${e.money.currency}`
              : e.details.originalAmount
                ? `${number(e.details.originalAmount)} ${e.details.originalCurrency} · bez kursa`
                : "Nedostaje iznos",
            <Badge
              tone={
                e.status === "draft" || e.status === "requested"
                  ? "amber"
                  : "green"
              }
            >
              {labels[e.status]}
            </Badge>,
            e.kind === "subsidy" && e.status === "requested" ? (
              <button
                className="text-button"
                onClick={() =>
                  action(async () => {
                    await api("/subsidies/" + e.id + "/approve", {});
                    await saved();
                  })
                }
              >
                Potvrdi odobrenje
              </button>
            ) : e.status === "draft" ? (
              <button className="text-button" onClick={() => setEditing(e)}>
                Dopuni nacrt
              </button>
            ) : (
              <button className="text-button" onClick={pay}>
                Plaćanje
              </button>
            ),
          ])}
        />
      ) : (
        <Empty
          title="Nema poslovnih događaja"
          text="Evidentirajte prodaju, dodatni stvarni trošak ili subvenciju."
        />
      )}
    </section>
  );
}
function PaymentForm({ data, onDone }: Any) {
  const [eid, setEid] = useState(""),
    [direction, setDirection] = useState("in");
  const events = data.events.filter(
    (e: Any) => e.status !== "draft" && e.status !== "requested" && e.money,
  );
  return (
    <Form
      onSubmit={async (v: Any) => {
        await api("/payments", { ...v, eventId: eid || undefined, direction });
        await onDone();
      }}
    >
      <Field
        label="Povezan poslovni događaj"
        value={eid}
        onChange={(e: Any) => {
          setEid(e.target.value);
          const event = events.find((x: Any) => x.id === e.target.value);
          if (event) setDirection(event.kind === "cost" ? "out" : "in");
        }}
        options={[
          { value: "", label: "Ostali novčani događaj / sopstveni računi" },
          ...events.map((e: Any) => ({
            value: e.id,
            label: `${e.title} · ${number(e.money.original)} ${e.money.currency}`,
          })),
        ]}
      />
      <div className="form-grid">
        <Field
          label="Smer"
          value={direction}
          onChange={(e: Any) => setDirection(e.target.value)}
          options={[
            { value: "in", label: "Priliv" },
            { value: "out", label: "Odliv" },
            { value: "own_transfer", label: "Prenos između sopstvenih računa" },
          ]}
        />
        <Field
          label="Kategorija"
          name="category"
          options={[
            "Naplata prodaje",
            "Plaćanje troška",
            "Uplata subvencije",
            "Zajam",
            "Ulaganje vlasnika",
            "Povlačenje vlasnika",
            "Prenos sopstvenih sredstava",
            "Ostalo",
          ]}
        />
        <Field
          label="Datum uplate / isplate"
          name="date"
          type="date"
          defaultValue={today()}
          required
        />
        <Field
          label="Iznos ovog plaćanja"
          name="amount"
          type="number"
          required
        />
        <Field
          label="Valuta plaćanja"
          name="currency"
          options={["RSD", "EUR"]}
        />
      </div>
      <Field label="Napomena" name="note" />
      <p className="hint">
        Podržana su delimična plaćanja. Kurs je na datum ovog plaćanja; interni
        prenosi novca ne ulaze u eksterni neto tok. Zajam i ulaganje vlasnika
        nisu automatski prihod za maržu.
      </p>
    </Form>
  );
}
function Cash({ r, onOpening, onPayment }: Any) {
  if (!r) return null;
  return (
    <>
      <div className="metrics three">
        <Metric
          label="Prilivi u periodu"
          value={number(r.cashTotals.incoming)}
          unit={r.currency}
          help="Stvarno primljen novac"
        />
        <Metric
          label="Odlivi u periodu"
          value={number(r.cashTotals.outgoing)}
          unit={r.currency}
          help="Stvarno isplaćen novac"
        />
        <Metric
          label="Neto novčani tok"
          value={number(r.totals.netCash)}
          unit={r.currency}
          help="Ne predstavlja dobit gazdinstva"
          accent
        />
      </div>
      {r.cashflow[0].opening === null && (
        <Alert>
          Početno stanje novca nije uneto. Neto tok je poznat; saldo nije
          pretpostavljen.{" "}
          <button className="text-button" onClick={onOpening}>
            Unesi početno stanje
          </button>
        </Alert>
      )}
      <section className="panel">
        <div className="panel-head">
          <h2>Mesečni pregled · {r.currency}</h2>
          <button className="secondary" onClick={onOpening}>
            Početno stanje
          </button>
        </div>
        <CashChart rows={r.cashflow} />
        <Table
          heads={[
            "Mesec",
            "Početno stanje",
            "Prilivi",
            "Odlivi",
            "Neto tok",
            "Završno stanje",
          ]}
          rows={r.cashflow.map((m: Any) => [
            m.month,
            ...["opening", "incoming", "outgoing", "net", "closing"].map((k) =>
              number(m[k]),
            ),
          ])}
        />
      </section>
      <section className="panel">
        <div className="panel-head">
          <h2>Uplate i isplate</h2>
          <button className="secondary" onClick={onPayment}>
            Evidentiraj plaćanje
          </button>
        </div>
        {r.payments.length ? (
          <Table
            heads={[
              "Datum",
              "Smer",
              "Kategorija",
              "Original",
              "RSD",
              "EUR",
              "Kurs / lista",
            ]}
            rows={r.payments.map((p: Any) => [
              p.date,
              p.direction === "in"
                ? "Priliv"
                : p.direction === "out"
                  ? "Odliv"
                  : "Sopstveni računi",
              p.category,
              `${number(p.money.original)} ${p.money.currency}`,
              number(p.money.rsd),
              number(p.money.eur),
              `${p.money.rate} / ${p.money.rateDate}`,
            ])}
          />
        ) : (
          <Empty
            title="Nema evidentiranih plaćanja"
            text="Normativi i datumi agrotehničkih operacija ne stvaraju novčane tokove."
          />
        )}
      </section>
      <section className="panel">
        <h2>Preostala potraživanja i obaveze</h2>
        <Table
          heads={["Opis", "Vrsta", "Preostalo"]}
          rows={r.outstanding.map((o: Any) => [
            o.title,
            labels[o.kind],
            `${number(o.remaining)} ${o.currency}`,
          ])}
        />
      </section>
    </>
  );
}
function StockForm({ data, onDone }: Any) {
  return (
    <Form
      onSubmit={async (v: Any) => {
        await api("/inventory", {
          ...v,
          productionId: v.productionId || undefined,
          amount: v.amount || undefined,
        });
        await onDone();
      }}
    >
      <div className="form-grid">
        <ProductionField data={data} optional />
        <Field
          label="Vrsta promene"
          name="kind"
          options={[
            "opening",
            "correction_in",
            "correction_out",
            "household",
            "writeoff",
            "byproduct",
          ].map((value) => ({ value, label: labels[value] }))}
        />
        <Field
          label="Proizvod / materijal (tačan naziv)"
          name="product"
          required
        />
        <Field
          label="Tip zalihe"
          name="stockType"
          options={[
            { value: "product", label: "Gotov proizvod" },
            { value: "material", label: "Repromaterijal / hrana" },
          ]}
        />
        <Field label="Količina" name="quantity" type="number" required />
        <Field label="Jedinica" name="unit" options={units} />
        <Field
          label="Datum"
          name="date"
          type="date"
          defaultValue={today()}
          required
        />
        <Field
          label="Osnova vrednovanja"
          name="method"
          options={[
            { value: "normative", label: "Sledljivi normativni trošak" },
            { value: "actual", label: "Kompletan stvarni trošak" },
          ]}
        />
      </div>
      <details>
        <summary>Početna ili korektivna vrednost</summary>
        <div className="form-grid">
          <Field
            label="Ukupna vrednost po trošku (ne tržišna cena)"
            name="amount"
            type="number"
          />
          <Field label="Valuta" name="currency" options={["RSD", "EUR"]} />
        </div>
      </details>
      <Field
        label="Obrazloženje početnog stanja / korekcije"
        name="note"
        type="textarea"
        required
      />
      <p className="hint">
        Sopstvena potrošnja se vrednuje automatski iz povezane proizvodnje.
        Nabavku evidentirajte u troškovima kao nabavku zalihe, a njenu potrošnju
        zasebno.
      </p>
    </Form>
  );
}
function TransferForm({ data, onDone }: Any) {
  return (
    <Form
      onSubmit={async (v: Any) => {
        await api("/transfers", v);
        await onDone();
      }}
    >
      <div className="form-grid">
        <ProductionField data={data} name="from" />
        <ProductionField data={data} name="to" />
        <Field
          label="Proizvod (tačan naziv iz zalihe)"
          name="product"
          required
        />
        <Field label="Količina" name="quantity" type="number" required />
        <Field label="Jedinica" name="unit" options={units} />
        <Field
          label="Datum"
          name="date"
          type="date"
          defaultValue={today()}
          required
        />
        <Field
          label="Troškovna osnova"
          name="method"
          options={[
            {
              value: "normative",
              label: "Odobren normativni trošak proizvodnje",
            },
            { value: "actual", label: "Kompletan stvarni trošak proizvodnje" },
          ]}
        />
      </div>
      <Alert>
        Jedna transakcija pravi uparen izlaz i ulaz iste količine i vrednosti.
        Interni prenos ne stvara eksterni prihod niti novčani tok. Potrošnju u
        odredišnoj proizvodnji evidentirajte zasebno.
      </Alert>
    </Form>
  );
}
function FeedForm({ data, onDone }: Any) {
  const [pid, setPid] = useState("");
  const r = data.report.results.find((r: Any) => r.id === pid);
  return (
    <Form
      onSubmit={async (v: Any) => {
        await api("/feed", {
          ...v,
          productionId: pid,
          normItemId: v.normItemId || undefined,
        });
        await onDone();
      }}
    >
      <div className="form-grid">
        <ProductionField
          data={data}
          value={pid}
          onChange={(e: Any) => setPid(e.target.value)}
        />
        <Field label="Proizvod / materijal iz zalihe" name="product" required />
        <Field
          label="Tip zalihe"
          name="stockType"
          options={[
            { value: "product", label: "Proizvod / sopstvena hrana" },
            { value: "material", label: "Kupljeni repromaterijal / hrana" },
          ]}
        />
        <Field
          label="Potrošena količina"
          name="quantity"
          type="number"
          required
        />
        <Field label="Jedinica" name="unit" options={units} />
        <Field
          label="Datum potrošnje"
          name="date"
          type="date"
          defaultValue={today()}
          required
        />
        <Field
          label="Normativna stavka koja koristi sopstvenu hranu"
          name="normItemId"
          options={[
            { value: "", label: "Bez normativne veze" },
            ...(r?.norm.lines || []).map((i: Any) => ({
              value: i.id,
              label: `${i.id} · ${i.name}`,
            })),
          ]}
        />
      </div>
      <p className="hint">
        Potrošnja prenosi sledljivu vrednost iz zalihe u proizvodnju. Prethodna
        nabavka se ne priznaje drugi put kao trošak.
      </p>
    </Form>
  );
}
function Inventory({ data, onAction }: Any) {
  const inv = data.inventory;
  if (!inv) return null;
  const balances = inv.balances || [];
  return (
    <>
      <div className="toolbar">
        <button className="primary" onClick={() => onAction("inventory")}>
          <Plus size={16} />
          Promena zaliha
        </button>
        <button className="secondary" onClick={() => onAction("transfer")}>
          <ArrowLeftRight size={16} />
          Interni prenos
        </button>
        <button className="secondary" onClick={() => onAction("feed")}>
          Evidentiraj potrošnju
        </button>
      </div>
      <section className="panel">
        <h2>Stanje po proizvodu</h2>
        {balances.length ? (
          <Table
            heads={["Proizvod", "Proizvodnja", "Tip", "Stanje"]}
            rows={balances.map((m: Any) => [
              m.product,
              data.productions.find((p: Any) => p.id === m.productionId)
                ?.name || "Gazdinstvo",
              m.stockType === "material" ? "Repromaterijal" : "Gotov proizvod",
              `${number(m.quantity, 3)} ${m.unit}`,
            ])}
          />
        ) : (
          <Empty
            title="Zalihe još nisu evidentirane"
            text="Stanje se formira iz početnog stanja, ostvarene proizvodnje, nabavki i izlaza."
          />
        )}
      </section>
      <section className="panel">
        <h2>Promene zaliha</h2>
        <Table
          heads={[
            "Datum",
            "Proizvod",
            "Promena",
            "Količina",
            "Metod / napomena",
          ]}
          rows={inv.movements.map((m: Any) => [
            m.date,
            m.product,
            labels[m.kind],
            `${number(m.quantity, 3)} ${m.unit}`,
            <span>
              {m.method || "Količinska evidencija"}
              <small>{m.note}</small>
            </span>,
          ])}
        />
      </section>
      <section className="panel">
        <h2>Bilans hrane i repromaterijala</h2>
        <p className="hint">
          Normativna potreba i stvarna potrošnja vode se odvojeno. Deficit ne
          stvara automatsku nabavku, trošak ili plaćanje.
        </p>
        <Table
          heads={[
            "Proizvodnja",
            "Hranivo / stavka",
            "Normativna potreba",
            "Evidentirana potrošnja",
          ]}
          rows={data.report.results.flatMap((r: Any) =>
            (r.norm.lines || [])
              .filter(
                (l: Any) =>
                  r.norm.version?.model.items.find((i: Any) => i.id === l.id)
                    ?.group,
              )
              .map((l: Any) => [
                r.name,
                l.name,
                `${number(l.quantity, 3)} ${l.unit}`,
                `${number(
                  inv.feed
                    .filter(
                      (f: Any) =>
                        f.production_id === r.id && f.norm_item_id === l.id,
                    )
                    .reduce((s: number, f: Any) => s + Number(f.quantity), 0),
                  3,
                )} kg`,
              ]),
          )}
        />
        {!data.report.results.some((r: Any) => r.norm.lines.length) && (
          <Empty
            title="Nedostaje odobren hranidbeni normativ"
            text="Bez potvrđene osnove i prinosa ne računamo izmišljeni deficit."
          />
        )}
      </section>
    </>
  );
}
function ExportPanel({ data, detail, action, saved }: Any) {
  const [scope, setScope] = useState(detail || "");
  return (
    <>
      <Field
        label="Obuhvat izveštaja"
        value={scope}
        onChange={(e: Any) => setScope(e.target.value)}
        options={[
          { value: "", label: "Gazdinstvo ukupno" },
          ...data.productions.map((p: Any) => ({ value: p.id, label: p.name })),
        ]}
      />
      <p>
        Ekran, PDF i XLSX koriste isti serverski obračun, period, valutu, metod
        i izvore.
      </p>
      <div className="toolbar">
        <button
          className="primary"
          onClick={() => action(() => download("pdf", scope || undefined))}
        >
          <Download size={16} />
          PDF
        </button>
        <button
          className="secondary"
          onClick={() => action(() => download("xlsx", scope || undefined))}
        >
          <Download size={16} />
          Excel
        </button>
      </div>
      <hr />
      <h3>Sačuvaj nepromenljiv obračun</h3>
      <Form
        label="Sačuvaj snapshot"
        onSubmit={async (v: Any) => {
          await api("/snapshots", {
            productionId: scope || undefined,
            reason: v.reason,
          });
          await saved();
        }}
      >
        <Field
          label="Razlog snimanja / ponovnog obračuna"
          name="reason"
          required
        />
        <p className="hint">
          Čuvaju se stavke normativa, kurs i prethodna verzija izveštaja.
          Kasnija promena cenovnika ne menja ovu istoriju.
        </p>
      </Form>
      <h3>Sačuvana istorija</h3>
      {data.snapshots?.length ? (
        <Table
          heads={["Datum", "Obuhvat", "Preuzmi"]}
          rows={data.snapshots.map((s: Any) => [
            new Date(s.generated_at).toLocaleString("sr-Latn-RS"),
            s.production_id
              ? data.productions.find((p: Any) => p.id === s.production_id)
                  ?.name
              : "Gazdinstvo",
            <div className="toolbar">
              <button
                className="text-button"
                onClick={() => action(() => download("pdf", undefined, s.id))}
              >
                PDF
              </button>
              <button
                className="text-button"
                onClick={() => action(() => download("xlsx", undefined, s.id))}
              >
                XLSX
              </button>
            </div>,
          ])}
        />
      ) : (
        <p className="hint">Nema snimljenih obračuna.</p>
      )}
    </>
  );
}
function Market({ data }: Any) {
  const [tab, setTab] = useState("statistics"),
    [selected, setSelected] = useState("all");
  if (!data) return null;
  return (
    <>
      <div className="tabs">
        {[
          ["statistics", "Nacionalna statistika"],
          ["stips", "STIPS · lokalne cene"],
          ["buyers", "Otkupljivači"],
          ["offers", "Dokumentovane potrebe"],
          ["requirements", "Zahtevi tržišta"],
        ].map(([key, label]) => (
          <button
            key={key}
            className={tab === key ? "active" : ""}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "stips" && <StipsMarket />}
      {tab === "statistics" && (
        <>
          <div className="source-banner">
            <ChartNoAxesCombined size={25} />
            <div>
              <strong>
                Srbija ukupno · poslednjih pet dostupnih završenih godina
              </strong>
              <p>
                Izvorne jedinice i definicije. Bez interpolacije i izmišljenih
                vrednosti.
              </p>
            </div>
            <Badge>RZS</Badge>
          </div>
          {!data.series.length ? (
            <section className="panel">
              <Empty
                title="Nema potvrđenih podataka"
                text="Živo preuzimanje izvora nije provereno zbog mrežnog ograničenja. Provereni besplatni izvodi mogu se uvesti u administraciji."
              />
              <div className="source-links">
                <a
                  href="https://data.stat.gov.rs/"
                  target="_blank"
                  rel="noreferrer"
                >
                  RZS — diseminaciona baza <ArrowUpRight size={15} />
                </a>
                <a
                  href="https://www.stips.minpolj.gov.rs/"
                  target="_blank"
                  rel="noreferrer"
                >
                  STIPS — lokalna tržišta i bilteni <ArrowUpRight size={15} />
                </a>
              </div>
            </section>
          ) : (
            <>
              <Field
                label="Proizvod"
                value={selected}
                onChange={(e: Any) => setSelected(e.target.value)}
                options={[
                  "all",
                  ...new Set(data.series.map((s: Any) => s.product)),
                ].map((p) => ({
                  value: p,
                  label: p === "all" ? "Svi proizvodi" : p,
                }))}
              />
              {data.series
                .filter(
                  (s: Any) => selected === "all" || s.product === selected,
                )
                .map((s: Any) => (
                  <section className="panel" key={s.id}>
                    <div className="panel-head">
                      <div>
                        <h2>
                          {s.product} · {s.indicator}
                        </h2>
                        <p>
                          {s.geography} · {s.unit} {s.currency} · {s.price_type}
                        </p>
                      </div>
                      <Badge>{s.summary.count}/5 opažanja</Badge>
                    </div>
                    <p>{s.definition}</p>
                    <div className="stat-chart">
                      {s.summary.points.map((o: Any) => {
                        const max = Math.max(
                          1,
                          ...s.summary.points.map((p: Any) =>
                            Number(p.value || 0),
                          ),
                        );
                        return (
                          <div key={o.period}>
                            <span>
                              {o.value === null
                                ? "Nema podatka"
                                : number(o.value, 2)}
                            </span>
                            <i
                              style={{
                                height:
                                  o.value === null
                                    ? 2
                                    : Math.max(
                                        2,
                                        (Number(o.value) / max) * 110,
                                      ),
                                opacity: o.value === null ? 0.2 : 1,
                              }}
                            />
                            <small>{o.period}</small>
                          </div>
                        );
                      })}
                    </div>
                    <Table
                      heads={[
                        "Godina",
                        "Vrednost",
                        "Godišnja promena",
                        "Status",
                        "Objava / preuzimanje",
                      ]}
                      rows={s.summary.points.map((o: Any) => [
                        o.period,
                        o.value === null ? "Nema podatka" : number(o.value),
                        o.change === null ? "—" : number(o.change) + "%",
                        o.status,
                        o.observation
                          ? `${String(o.observation.published_at).slice(0, 10)} / ${String(o.observation.retrieved_at).slice(0, 10)}`
                          : "—",
                      ])}
                    />
                    <p>
                      Jednostavan prosek:{" "}
                      <strong>
                        {number(s.summary.mean)} {s.unit}
                      </strong>{" "}
                      · {s.summary.count} opažanja
                    </p>
                    {s.summary.current.length > 0 && (
                      <Alert>
                        Tekuća nepotpuna godina je odvojena:{" "}
                        {s.summary.current
                          .map(
                            (o: Any) =>
                              `${o.period}: ${number(o.value)} (${o.status})`,
                          )
                          .join(", ")}
                      </Alert>
                    )}
                    <p className="hint">
                      Mapiranje: {s.mapping}. Svežina: poslednje provereno{" "}
                      {s.summary.points
                        .filter((o: Any) => o.observation)
                        .at(-1)
                        ?.observation?.retrieved_at?.slice(0, 10) || "—"}
                      . Nacionalni prinos ne predstavlja prinos svakog
                      gazdinstva.
                    </p>
                    <a href={s.source_url} target="_blank" rel="noreferrer">
                      Izvorni podaci ↗
                    </a>
                  </section>
                ))}
            </>
          )}
        </>
      )}
      {tab === "buyers" && (
        <section className="panel">
          <h2>Javni poslovni imenik</h2>
          <p className="hint">
            Imenik nije potvrđena narudžbina. Kontakti su javni poslovni podaci.
          </p>
          {data.buyers.length ? (
            <Table
              heads={[
                "Otkupljivač",
                "Proizvodi",
                "Područje",
                "Javni kontakt",
                "Provera / izvor",
              ]}
              rows={data.buyers.map((b: Any) => [
                b.name,
                b.products,
                b.area,
                b.contact,
                <a href={b.source_url} target="_blank" rel="noreferrer">
                  {String(b.verified_at).slice(0, 10)} ↗
                </a>,
              ])}
            />
          ) : (
            <Empty
              title="Nema potvrđenih podataka"
              text="Otkupljivači će biti prikazani nakon provere javnog izvora."
            />
          )}
        </section>
      )}
      {tab === "offers" && (
        <section className="panel">
          <h2>Dokumentovane potrebe kupaca</h2>
          {data.offers.length ? (
            <Table
              heads={[
                "Kupac / proizvod",
                "Količina",
                "Kvalitet",
                "Isporuka / period",
                "Važi do / izvor",
              ]}
              rows={data.offers.map((o: Any) => [
                `${data.buyers.find((b: Any) => b.id === o.buyer_id)?.name} · ${o.product}`,
                `${number(o.quantity, 3)} ${o.unit}`,
                o.quality,
                `${o.delivery} · ${o.period}`,
                <a href={o.source_url} target="_blank" rel="noreferrer">
                  {o.expires_at} ↗
                </a>,
              ])}
            />
          ) : (
            <Empty
              title="Nema potvrđenih aktivnih potreba"
              text="Ističu se samo administratorski proverene, dokumentovane potrebe. Statistička ponuda nije narudžbina kupca."
            />
          )}
        </section>
      )}
      {tab === "requirements" && (
        <section className="panel">
          <h2>Kvalitet, pakovanje, sertifikacija i isporuka</h2>
          {data.requirements.length ? (
            <Table
              heads={["Proizvod", "Vrsta zahteva", "Opis", "Tržište / izvor"]}
              rows={data.requirements.map((r: Any) => [
                r.product,
                r.kind,
                r.description,
                <a href={r.source_url} target="_blank" rel="noreferrer">
                  {r.market} ↗
                </a>,
              ])}
            />
          ) : (
            <Empty
              title="Nema potvrđenih podataka"
              text="Zahtev konkretnog kupca, propis i sertifikacioni standard prikazuju se odvojeno."
            />
          )}
        </section>
      )}
    </>
  );
}
function Handbook({ data }: Any) {
  return (
    <>
      <section className="panel">
        <h2>Kako čitati rezultate</h2>
        <div className="method-grid">
          <div>
            <span>01</span>
            <h3>Obračun po normativu</h3>
            <p>
              Ostvarena osnova × fiksni, odobreni normativ. Rezultat je
              obračunska marža uz navedenu pokrivenost troškova.
            </p>
          </div>
          <div>
            <span>02</span>
            <h3>Stvarno evidentirano</h3>
            <p>
              Samo uneti prihodi i varijabilni troškovi. Do potvrde kompletnosti
              rezultat je privremen.
            </p>
          </div>
          <div>
            <span>03</span>
            <h3>Novčani tok</h3>
            <p>
              Samo izvršena plaćanja na stvarne datume. Normativ ne predstavlja
              dokaz nastalog rashoda ili plaćanja.
            </p>
          </div>
        </div>
        <Alert>
          Izvorni „Priručnik“ objedinjuje postojeće karte i ne stvara dodatne
          proizvodnje ili dvostruke troškove. Izvor 2017 je istorijska arhiva,
          bez aktuelnih preporuka zaštite bilja.
        </Alert>
      </section>
      <section className="panel">
        <h2>Odobreni normativi</h2>
        {data?.length ? (
          data.map((v: Any) => (
            <details key={v.id}>
              <summary>
                {v.template_name} · {v.name}
              </summary>
              <p>
                {String(v.valid_from).slice(0, 10)} —{" "}
                {String(v.valid_to).slice(0, 10)} · izvor {v.model.sheet} /{" "}
                {v.model.range}
              </p>
              <Table
                heads={["Stavka", "Količina", "Jedinica", "Cena EUR"]}
                rows={v.model.items
                  .filter((i: Any) => i.included !== false)
                  .map((i: Any) => [
                    i.name,
                    number(i.quantity, 6),
                    i.unit,
                    number(i.price, 6),
                  ])}
              />
            </details>
          ))
        ) : (
          <Empty
            title="Nema odobrenih aktivnih normativa"
            text="Administrator mora pregledati izvorne jedinice, rešiti sporne stavke i odobriti važeće cene."
          />
        )}
      </section>
    </>
  );
}
function Admin({ onDone }: Any) {
  const [data, setData] = useState<Any>(),
    [tab, setTab] = useState("catalog"),
    [version, setVersion] = useState<Any>(),
    [source, setSource] = useState(""),
    [query, setQuery] = useState(""),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  async function load() {
    try {
      setData(await api("/admin"));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    load();
  }, []);
  async function done() {
    await load();
    await onDone();
    setMessage("Administratorska promena je zabeležena.");
  }
  if (!data) return <p>{error || "Učitavanje administracije…"}</p>;
  return (
    <>
      {error && <Alert>{error}</Alert>}
      {message && <div className="success">{message}</div>}
      <div className="tabs">
        {[
          ["catalog", "Katalog i verzije"],
          ["pricing", "Zajednički cenovnik"],
          ["inputPrices", "STIPS · cene inputa"],
          ["issues", "Sporne stavke izvora"],
          ["rates", "NBS kursevi"],
          ["statistics", "Uvoz statistike"],
          ["stips", "STIPS bilteni"],
          ["market", "Kupci i zahtevi"],
          ["audit", "Audit log"],
        ].map(([k, l]) => (
          <button
            key={k}
            className={tab === k ? "active" : ""}
            onClick={() => {
              setTab(k);
              setVersion(null);
            }}
          >
            {l}
          </button>
        ))}
      </div>
      {tab === "pricing" && (
        <SharedPriceTable
          data={data}
          onDone={done}
          onEdit={(id: string) => {
            setVersion(data.versions.find((v: Any) => v.id === id));
            setTab("catalog");
          }}
        />
      )}
      {tab === "inputPrices" && <StipsInputAdmin />}
      {tab === "catalog" &&
        (version ? (
          <NormEditor
            version={version}
            onBack={() => setVersion(null)}
            onDone={async () => {
              setVersion(null);
              await done();
            }}
          />
        ) : (
          <>
            <section className="panel">
              <div className="panel-head">
                <div>
                  <h2>Katalog iz izvora 2017</h2>
                  <p>
                    88 predložaka · 10 izvornih sheetova · original bez izmena
                  </p>
                </div>
                <Form
                  label="Ponovi idempotentan uvoz"
                  secondary
                  onSubmit={async () => {
                    await api("/admin/import", {});
                    await done();
                  }}
                />
              </div>
              <div className="filter-row">
                <Field
                  label="Pretraga izvornog naziva"
                  value={query}
                  onChange={(e: Any) => setQuery(e.target.value)}
                  placeholder="Npr. pšenica, krave…"
                />
                <Badge tone="amber">Arhivske cene nisu aktivne</Badge>
              </div>
              <Table
                heads={["Proizvodnja", "Verzija / period", "Status", "Radnja"]}
                rows={data.versions
                  .filter((v: Any) =>
                    v.template_name.toLowerCase().includes(query.toLowerCase()),
                  )
                  .map((v: Any) => [
                    <>
                      <strong>{v.template_name}</strong>
                      <small>
                        {v.model.sheet} · {v.model.range}
                      </small>
                    </>,
                    <>
                      {v.name}
                      <small>
                        {String(v.valid_from).slice(0, 10)} —{" "}
                        {String(v.valid_to).slice(0, 10)}
                      </small>
                    </>,
                    <Badge tone={v.status === "active" ? "green" : "amber"}>
                      {labels[v.status]}
                    </Badge>,
                    <div className="toolbar">
                      <button
                        className="text-button"
                        onClick={() => setVersion(v)}
                      >
                        {v.status === "draft" ? "Uredi" : "Pregled"}
                      </button>
                      <button
                        className="text-button"
                        onClick={() => setSource(v.id)}
                      >
                        Nova verzija
                      </button>
                      {v.status === "active" && (
                        <button
                          className="text-button"
                          onClick={async () => {
                            try {
                              await api(
                                "/admin/versions/" + v.id + "/archive",
                                { reason: "Zamena novom odobrenom verzijom" },
                              );
                              await done();
                            } catch (e) {
                              setError((e as Error).message);
                            }
                          }}
                        >
                          Arhiviraj
                        </button>
                      )}
                    </div>,
                  ])}
              />
            </section>
            {source && (
              <Modal
                title="Nova verzija — cene se ne preuzimaju iz arhive"
                onClose={() => setSource("")}
              >
                <Form
                  label="Napravi nacrt"
                  onSubmit={async (v: Any) => {
                    await api("/admin/versions", { sourceId: source, ...v });
                    setSource("");
                    await done();
                  }}
                >
                  <Field
                    label="Naziv cenovnika / verzije"
                    name="name"
                    required
                  />
                  <div className="form-grid">
                    <Field
                      label="Važi od"
                      name="validFrom"
                      type="date"
                      required
                    />
                    <Field
                      label="Važi do"
                      name="validTo"
                      type="date"
                      required
                    />
                  </div>
                  <Field label="Razlog izmene" name="reason" required />
                  <Alert>
                    Izvorne količine se zadržavaju. Cene su prazne dok ne
                    unesete i odobrite novi cenovnik.
                  </Alert>
                </Form>
              </Modal>
            )}
          </>
        ))}
      {tab === "issues" && (
        <section className="panel">
          <h2>Sporne stavke i zavisnosti</h2>
          <p>
            Sve stavke su zadržane uz izvorni sheet i ćeliju. Ne izvršavaju se
            formule ili kod iz teksta.
          </p>
          <Table
            heads={["Sheet", "Ćelija", "Vrsta", "Izvorni sadržaj"]}
            rows={data.issues.map((i: Any) => [
              i.sheet,
              i.cell,
              i.kind,
              i.detail,
            ])}
          />
          <details>
            <summary>
              Izvorne istorijske napomene (samo administratorski pregled)
            </summary>
            {data.versions
              .filter((v: Any) => v.status === "archive")
              .flatMap((v: Any) =>
                (v.model.notes || []).map((n: Any) => (
                  <p key={v.id + n.cell}>
                    <strong>
                      {v.model.sheet}!{n.cell}
                    </strong>{" "}
                    · {n.text}
                  </p>
                )),
              )}
          </details>
        </section>
      )}
      {tab === "rates" && (
        <>
          <section className="panel narrow">
            <h2>Proverena zvanična kursna lista</h2>
            <p>
              Ne postoji pretpostavljen kurs. Za vikend ili praznik unesite
              tačan period važenja prethodne zvanične liste.
            </p>
            <Form
              onSubmit={async (v: Any) => {
                await api("/admin/rates", v);
                await done();
              }}
            >
              <div className="form-grid">
                <Field label="Važi od" name="validFrom" type="date" required />
                <Field
                  label="Važi do (uključivo)"
                  name="validTo"
                  type="date"
                  required
                />
                <Field
                  label="RSD za 1 EUR"
                  name="rate"
                  type="number"
                  required
                />
                <Field
                  label="Datum objave"
                  name="publishedAt"
                  type="date"
                  required
                />
              </div>
              <Field
                label="Zvanični NBS URL proverenog izvora"
                name="source"
                type="url"
                required
              />
              <Alert>
                Mrežno preuzimanje NBS nije potvrđeno. Administrator unosi samo
                kurs proveren u zvaničnoj listi. Izmena ne menja istorijske
                snapshot-e.
              </Alert>
            </Form>
          </section>
          <section className="panel">
            <h2>Uvezene liste</h2>
            <Table
              heads={["Važi od", "Važi do", "EUR/RSD", "Izvor"]}
              rows={data.rates.map((r: Any) => [
                r.valid_from,
                r.valid_to,
                r.rate,
                <a href={r.source_url} target="_blank" rel="noreferrer">
                  NBS ↗
                </a>,
              ])}
            />
          </section>
        </>
      )}
      {tab === "statistics" && (
        <section className="panel">
          <h2>Proverljiv uvoz statističkih podataka</h2>
          <p>
            Uvoz je deklarativan JSON, sa definicijom serije, mapiranjem i
            izvorima za svako opažanje. Ponovljen isti unos ne stvara duplikate;
            izmena čuva prethodnu reviziju.
          </p>
          <p className="hint">
            Proverite uslove korišćenja pre preuzimanja. Šira tarifna grupa mora
            biti opisana kao šira grupa, bez predstavljanja kao jedna kultura.
            Nedostajuća vrednost je null.
          </p>
          <Form
            label="Validiraj i uvezi"
            onSubmit={async (v: Any) => {
              await api("/admin/statistics", JSON.parse(v.json));
              await done();
            }}
          >
            <Field
              label="JSON proverenog izvoda (format: docs/statistics-import.example.json)"
              name="json"
              type="textarea"
              rows={14}
              required
            />
          </Form>
          <div className="source-links">
            <a
              href="https://opendata.stat.gov.rs/odata/"
              target="_blank"
              rel="noreferrer"
            >
              RZS otvoreni podaci ↗
            </a>
            <a
              href="https://data.stat.gov.rs/Home/Result/0302010302?languageCode=sr-Latn"
              target="_blank"
              rel="noreferrer"
            >
              RZS otkupne cene ↗
            </a>
          </div>
        </section>
      )}
      {tab === "market" && <AdminMarket onDone={done} />}
      {tab === "stips" && <StipsAdmin onDone={onDone} />}
      {tab === "audit" && (
        <section className="panel">
          <h2>Evidencija promena i pristupa</h2>
          <p>
            Poslednjih 100 događaja, bez tajni i sadržaja privatnih izveštaja.
          </p>
          <Table
            heads={["Vreme", "Korisnik", "Radnja", "Objekat"]}
            rows={data.audit.map((a: Any) => [
              new Date(a.at).toLocaleString("sr-Latn-RS"),
              a.user_id,
              a.action,
              a.entity,
            ])}
          />
        </section>
      )}
    </>
  );
}
function NormEditor({ version, onDone, onBack }: Any) {
  const [model, setModel] = useState<Any>(structuredClone(version.model)),
    [status, setStatus] = useState("draft");
  const editable = version.status === "draft";
  const update = (i: number, key: string, v: Any) =>
    setModel((m: Any) => ({
      ...m,
      items: m.items.map((item: Any, n: number) =>
        n === i ? { ...item, [key]: v } : item,
      ),
    }));
  return (
    <section className="panel">
      <button className="text-button" onClick={onBack}>
        ← Katalog
      </button>
      <h2>
        {version.template_name} · {version.name}
      </h2>
      <p>
        Izvor: {model.sheet}!{model.range} · {model.basis} / {model.reference}
      </p>
      <Alert>
        Odobravate obuhvaćene varijabilne troškove, ne kompletnu cenu koštanja.
        Izvorne napomene nisu aktuelna preporuka preparata. Svaka nulta cena,
        alternativa i nejasna jedinica zahtevaju eksplicitnu odluku.
      </Alert>
      <Form
        label={status === "active" ? "Odobri i aktiviraj" : "Sačuvaj nacrt"}
        onSubmit={async (v: Any) => {
          if (!editable) return;
          await api(
            "/admin/versions/" + version.id,
            {
              model,
              reason: v.reason,
              activate: status === "active",
              revision: version.revision,
            },
            "PUT",
          );
          await onDone();
        }}
      >
        <fieldset disabled={!editable}>
          <div className="form-grid">
            <Field
              label="Deklarativna obračunska osnova"
              value={model.basis}
              onChange={(e: Any) =>
                setModel({ ...model, basis: e.target.value })
              }
              options={[
                "ha",
                "m2",
                "seedlings",
                "bag",
                "head_year",
                "head_cycle",
              ]}
            />
            <Field
              label="Referentna količina"
              type="number"
              value={model.reference}
              onChange={(e: Any) =>
                setModel({ ...model, reference: e.target.value })
              }
            />
            <Field
              label="Potvrđene jedinice, osnova perioda i izvorni model"
              type="checkbox"
              checked={!!model.reviewed}
              onChange={(e: Any) =>
                setModel({ ...model, reviewed: e.target.checked })
              }
            />
            {model.basis === "bag" && (
              <Field
                label="Potvrđujem jedinicu vreća za šampinjone"
                type="checkbox"
                checked={!!model.unitConfirmed}
                onChange={(e: Any) =>
                  setModel({ ...model, unitConfirmed: e.target.checked })
                }
              />
            )}
          </div>
          <details>
            <summary>Raspodela zajedničkog troška na nusproizvode</summary>
            <p className="hint">
              Glavni proizvod dobija preostali udeo do 100%. Unesite tačan naziv
              nusproizvoda i dokumentovan udeo troška. Bez odobrene raspodele
              rezultat nusproizvoda ostaje nepotpun.
            </p>
            {Object.entries(model.byproductAllocations || {}).map(
              ([name, share]) => (
                <div className="form-grid" key={name}>
                  <Field
                    label={name + " · udeo troška %"}
                    type="number"
                    value={String(share)}
                    onChange={(e: Any) =>
                      setModel({
                        ...model,
                        byproductAllocations: {
                          ...model.byproductAllocations,
                          [name]: e.target.value,
                        },
                      })
                    }
                  />
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => {
                      const a = { ...model.byproductAllocations };
                      delete a[name];
                      setModel({ ...model, byproductAllocations: a });
                    }}
                  >
                    Ukloni raspodelu
                  </button>
                </div>
              ),
            )}
            <Field
              label="Naziv dodatnog nusproizvoda (Enter dodaje)"
              onKeyDown={(e: Any) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  const name = e.target.value.trim();
                  if (name) {
                    setModel({
                      ...model,
                      byproductAllocations: {
                        ...model.byproductAllocations,
                        [name]: "0",
                      },
                    });
                    e.target.value = "";
                  }
                }
              }}
            />
          </details>
          {(model.groups || []).map((g: Any) => (
            <div className="feed-group" key={g.id}>
              <strong>Nezavisan hranidbeni blok {g.id}</strong>
              <p>{g.source} · Zbir udela u ovom bloku mora biti 100%.</p>
              <Field
                label="Potvrđena ukupna potrošnja bloka kg/grlu po izvornoj osnovi"
                type="number"
                value={model.groupBases?.[g.id] || ""}
                onChange={(e: Any) =>
                  setModel({
                    ...model,
                    groupBases: { ...model.groupBases, [g.id]: e.target.value },
                  })
                }
              />
            </div>
          ))}
          <div className="norm-items">
            {model.items.map((i: Any, n: number) => (
              <div key={i.id} className="norm-item">
                <div className="norm-heading">
                  <strong>
                    {i.id} · {i.name}
                  </strong>
                  <Badge>
                    {i.quantityCell} × {i.priceCell || "cena hraniva"}
                  </Badge>
                </div>
                <div className="form-grid four">
                  <Field
                    label="Normirana količina"
                    type="number"
                    value={i.quantity ?? ""}
                    onChange={(e: Any) =>
                      update(n, "quantity", e.target.value || null)
                    }
                  />
                  <Field
                    label="Cena EUR / jedinici"
                    type="number"
                    value={i.price ?? ""}
                    onChange={(e: Any) =>
                      update(
                        n,
                        "price",
                        e.target.value === "" ? null : e.target.value,
                      )
                    }
                  />
                  <Field
                    label="Normalizovana jedinica"
                    value={i.unit}
                    onChange={(e: Any) => update(n, "unit", e.target.value)}
                  />
                  <Field
                    label="Jedinica potvrđena"
                    type="checkbox"
                    checked={!!i.unitConfirmed}
                    onChange={(e: Any) =>
                      update(n, "unitConfirmed", e.target.checked)
                    }
                  />
                  {i.group && (
                    <Field
                      label="Udeo u bloku %"
                      type="number"
                      value={i.share || "0"}
                      onChange={(e: Any) => update(n, "share", e.target.value)}
                    />
                  )}
                </div>
                <div className="form-grid">
                  <Field
                    label="Uključena stavka"
                    type="checkbox"
                    checked={i.included !== false}
                    onChange={(e: Any) =>
                      update(n, "included", e.target.checked)
                    }
                  />
                  {i.included === false && (
                    <Field
                      label="Razlog isključenja / neprimenljivosti"
                      value={i.exclusionReason || ""}
                      onChange={(e: Any) =>
                        update(n, "exclusionReason", e.target.value)
                      }
                    />
                  )}
                  <Field
                    label="Razlog eksplicitne nulte cene"
                    value={i.zeroReason || ""}
                    onChange={(e: Any) =>
                      update(n, "zeroReason", e.target.value)
                    }
                  />
                  {i.flags?.includes("alternative") && (
                    <Field
                      label="Alternativa eksplicitno pregledana i izabrana"
                      type="checkbox"
                      checked={!!i.alternativeConfirmed}
                      onChange={(e: Any) =>
                        update(n, "alternativeConfirmed", e.target.checked)
                      }
                    />
                  )}
                </div>
                {i.flags?.length > 0 && (
                  <p className="hint">Nalazi: {i.flags.join(", ")}</p>
                )}
              </div>
            ))}
          </div>
          <Field
            label="Razlog izmene / odobrenja"
            name="reason"
            defaultValue={version.reason}
            required
          />
          <Field
            label="Akcija"
            value={status}
            onChange={(e: Any) => setStatus(e.target.value)}
            options={[
              { value: "draft", label: "Sačuvaj nacrt" },
              { value: "active", label: "Proveri kompletnost i aktiviraj" },
            ]}
          />
        </fieldset>
        {!editable && (
          <p className="hint">
            Ova verzija je nepromenljiva. Za izmene napravite novu verziju iz
            kataloga.
          </p>
        )}
      </Form>
    </section>
  );
}
function AdminMarket({ onDone }: Any) {
  const [kind, setKind] = useState("buyers"),
    [buyers, setBuyers] = useState<Any[]>([]);
  useEffect(() => {
    api("/market").then((d) => setBuyers(d.buyers));
  }, []);
  return (
    <section className="panel narrow">
      <h2>Dokumentovani tržišni podaci</h2>
      <Field
        label="Vrsta zapisa"
        value={kind}
        onChange={(e: Any) => setKind(e.target.value)}
        options={[
          { value: "buyers", label: "Javni poslovni imenik" },
          { value: "offers", label: "Konkretna potreba kupca" },
          {
            value: "requirements",
            label: "Zahtev kvaliteta, pakovanja ili isporuke",
          },
        ]}
      />
      <Form
        key={kind}
        onSubmit={async (v: Any) => {
          if (kind === "requirements") v.buyerId = v.buyerId || null;
          if (kind === "offers") v.approved = v.approved === "on";
          await api("/admin/market/" + kind, v);
          await onDone();
          setBuyers((await api("/market")).buyers);
        }}
      >
        {kind === "buyers" ? (
          <>
            <Field label="Poslovni naziv" name="name" required />
            <Field label="Proizvodi" name="products" required />
            <Field label="Područje otkupa" name="area" required />
            <Field label="Javni poslovni kontakt" name="contact" required />
          </>
        ) : (
          <>
            <Field
              label="Kupac"
              name="buyerId"
              required={kind === "offers"}
              options={[
                { value: "", label: "Opšti zahtev / izaberite kupca" },
                ...buyers.map((b: Any) => ({ value: b.id, label: b.name })),
              ]}
            />
            <Field label="Proizvod" name="product" required />
            {kind === "offers" ? (
              <>
                <div className="form-grid">
                  <Field
                    label="Dokumentovana količina"
                    name="quantity"
                    type="number"
                    required
                  />
                  <Field label="Jedinica" name="unit" options={units} />
                  <Field label="Period isporuke" name="period" required />
                  <Field
                    label="Važi do"
                    name="expiresAt"
                    type="date"
                    required
                  />
                </div>
                <Field
                  label="Kvalitet, pakovanje, sertifikacija"
                  name="quality"
                  type="textarea"
                  required
                />
                <Field label="Uslovi isporuke" name="delivery" required />
                <Field
                  label="Provereno — odobravam objavu"
                  name="approved"
                  type="checkbox"
                />{" "}
              </>
            ) : (
              <>
                <Field label="Tržište" name="market" required />
                <Field
                  label="Poreklo obaveze"
                  name="kind"
                  options={["zahtev kupca", "propis", "standard"]}
                />
                <Field
                  label="Dokumentovan opis zahteva"
                  name="description"
                  type="textarea"
                  required
                />
              </>
            )}
          </>
        )}
        <Field label="Izvorni javni URL" name="sourceUrl" type="url" required />
        <Field label="Datum provere" name="verifiedAt" type="date" required />
        <p className="hint">
          Bez izmišljenih kontakata, tražnje ili sertifikacionih obaveza. Ne
          šalju se automatske ponude kupcima.
        </p>
      </Form>
    </section>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
