import React, { useEffect, useState } from "react";
import {
  Download,
  Upload,
  RefreshCw,
  FileText,
  Check,
  ChevronRight,
  ArrowLeft,
  AlertCircle,
  Plus,
} from "lucide-react";
import { api, uploadStips, downloadStips } from "./api";
type Any = any;
const n = (v: Any) =>
  v == null
    ? "—"
    : new Intl.NumberFormat("sr-Latn-RS", { maximumFractionDigits: 6 }).format(
        Number(v),
      );
const formatDate = (v: Any) =>
  v ? new Date(v).toLocaleDateString("sr-Latn-RS") : "—";
const priceText = (d: Any) =>
  d.price != null
    ? `${n(d.price)} ${d.currency}/${d.unit}`
    : d.priceMin != null && d.priceMax != null
      ? `${n(d.priceMin)}–${n(d.priceMax)} ${d.currency}/${d.unit}`
      : "Nedostaje cena";
function Message({ children, error = false }: Any) {
  return (
    <div
      className={error ? "form-error" : "alert"}
      role={error ? "alert" : "status"}
    >
      {children}
    </div>
  );
}
function Input({ label, options, type = "text", ...props }: Any) {
  return (
    <label className={type === "checkbox" ? "checkbox" : "field"}>
      {type !== "checkbox" && <span>{label}</span>}
      {options ? (
        <select aria-label={label} {...props}>
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
        <textarea aria-label={label} {...props} />
      ) : (
        <input
          aria-label={label}
          type={type}
          step={type === "number" ? "any" : undefined}
          min={type === "number" ? 0 : undefined}
          {...props}
        />
      )}{" "}
      {type === "checkbox" && label}
    </label>
  );
}
function Form({
  children,
  onSubmit,
  button = "Sačuvaj",
  secondary = false,
}: Any) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        try {
          await onSubmit(new FormData(e.currentTarget), e.currentTarget);
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      {children}
      {error && <Message error>{error}</Message>}
      <div className="form-actions">
        <button className={secondary ? "secondary" : "primary"} disabled={busy}>
          {busy ? "Obrada…" : button}
          <ChevronRight size={16} />
        </button>
      </div>
    </form>
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
              {row.map((c: Any, j: number) => (
                <td key={j}>{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function Empty({ text = "Nema potvrđenih podataka" }: Any) {
  return (
    <div className="empty">
      <FileText size={28} />
      <h3>{text}</h3>
      <p>
        Prikazuju se samo proverene i odobrene lokalne cene sa izvornim
        dokumentom.
      </p>
    </div>
  );
}
export function StipsMarket() {
  const [data, setData] = useState<Any>(),
    [error, setError] = useState(""),
    [product, setProduct] = useState(""),
    [place, setPlace] = useState(""),
    [type, setType] = useState("");
  async function load() {
    try {
      setData(await api("/stips"));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    load();
  }, []);
  const rows = (data?.prices || []).filter(
    (p: Any) =>
      (!product || p.product === product) &&
      (!place || p.place === place) &&
      (!type || p.priceType === type),
  );
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>STIPS · lokalne tržišne cene</h2>
          <p>Pregled po mestima, vrstama cene i periodima</p>
        </div>
        <button className="secondary" onClick={load}>
          <RefreshCw size={16} />
          Osveži
        </button>
      </div>
      <Message>
        Svaka cena važi za navedeno mesto, tržište, kvalitet i period. Otkupna,
        veleprodajna i maloprodajna cena nisu ista vrsta podatka.
      </Message>
      {error && <Message error>{error}</Message>}
      {data?.source.last_error && (
        <Message>
          Poslednja provera preuzimanja nije uspela: {data.source.last_error}{" "}
          Poslednji odobreni podaci su sačuvani.
        </Message>
      )}
      {data?.prices.length > 0 && (
        <div className="form-grid">
          <Input
            label="STIPS proizvod"
            value={product}
            onChange={(e: Any) => setProduct(e.target.value)}
            options={[
              { value: "", label: "Svi proizvodi" },
              ...[
                ...new Set<string>(data.prices.map((p: Any) => p.product)),
              ].sort(),
            ]}
          />
          <Input
            label="Mesto / područje"
            value={place}
            onChange={(e: Any) => setPlace(e.target.value)}
            options={[
              { value: "", label: "Sva mesta" },
              ...[
                ...new Set<string>(data.prices.map((p: Any) => p.place)),
              ].sort(),
            ]}
          />
          <Input
            label="Vrsta cene"
            value={type}
            onChange={(e: Any) => setType(e.target.value)}
            options={[
              { value: "", label: "Sve vrste cene" },
              "otkupna",
              "veleprodajna",
              "maloprodajna",
            ]}
          />
        </div>
      )}
      {rows.length ? (
        <Table
          heads={[
            "Proizvod / kvalitet",
            "Mesto i tržište",
            "Vrsta",
            "Cena / raspon",
            "Period i svežina",
            "Izvor i provera",
          ]}
          rows={rows.map((p: Any) => [
            <>
              <strong>{p.product}</strong>
              <small>{p.quality || "Kvalitet nije posebno naveden"}</small>
            </>,
            <>
              {p.place}
              <small>{p.market}</small>
            </>,
            p.priceType,
            priceText(p),
            <>
              {formatDate(p.periodStart)}–{formatDate(p.periodEnd)}
              <small>Period završen pre {p.ageDays} dana</small>
            </>,
            <>
              <a href={p.sourceUrl} target="_blank" rel="noreferrer">
                {p.documentTitle} ↗
              </a>
              <small>
                Objava {formatDate(p.sourcePublishedAt)} · provera{" "}
                {formatDate(p.verifiedAt)} · rev. {p.revision}
              </small>
              <button
                className="text-button"
                onClick={async () => {
                  try {
                    await downloadStips(p.documentId);
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                Preuzmi izvornu kopiju
              </button>
            </>,
          ])}
        />
      ) : (
        <Empty />
      )}
      <p className="hint">
        Preuzimanje ne objavljuje cene automatski. Podaci ne predstavljaju
        potvrđenu tražnju kupca, preporuku prodajne cene ili godišnju RZS
        statistiku.
      </p>
    </section>
  );
}
export function StipsAdmin({ onDone }: Any) {
  const [data, setData] = useState<Any>(),
    [documentId, setDocumentId] = useState(""),
    [upload, setUpload] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function load() {
    try {
      setData(await api("/admin/stips"));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    load();
  }, []);
  async function run(path: string) {
    setBusy(true);
    setError("");
    try {
      const result = await api("/admin/stips/" + path, {});
      setMessage(
        path === "probe"
          ? result.message
          : `Provera završena: ${result.imported} novih, ${result.duplicates} već uvezenih. ${result.errors.join(" ")}`,
      );
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (documentId)
    return (
      <DocumentReview
        id={documentId}
        onBack={() => {
          setDocumentId("");
          load();
        }}
        onDone={onDone}
      />
    );
  return (
    <>
      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>STIPS — bilteni i pregled pre objave</h2>
            <p>Original → izdvojene tabele → ljudska provera → lokalne cene</p>
          </div>
          <button className="primary" onClick={() => setUpload(!upload)}>
            <Upload size={16} />
            Uvezi bilten
          </button>
        </div>
        <Message>
          Nijedna izdvojena cena ne postaje vidljiva korisnicima bez
          eksplicitnog odobrenja administratora. Automatsko preuzimanje je
          početno isključeno.
        </Message>
        {error && <Message error>{error}</Message>}
        {message && <Message>{message}</Message>}
        {upload && (
          <UploadForm
            onDone={async (r: Any) => {
              setMessage(
                r.duplicate
                  ? "Ovaj sadržaj je već uvezen; nisu napravljeni duplikati."
                  : "Dokument je sačuvan za pregled.",
              );
              setUpload(false);
              setDocumentId(r.id);
              await load();
            }}
          />
        )}
        <div className="toolbar">
          <button
            className="secondary"
            disabled={busy}
            onClick={() => run("probe")}
          >
            <RefreshCw size={16} />
            {busy ? "Provera…" : "Proveri pristup sajtu"}
          </button>
          <button
            className="secondary"
            disabled={busy}
            onClick={() => run("fetch")}
          >
            Preuzmi dostupne biltene
          </button>
          <button className="text-button" onClick={load}>
            Osveži status
          </button>
        </div>
        {data?.documents.length ? (
          <Table
            heads={[
              "Dokument",
              "Period",
              "Izdvajanje",
              "Redovi / objavljeno",
              "Pregled",
            ]}
            rows={data.documents.map((d: Any) => [
              <>
                {d.title}
                <small>
                  {d.filename} · primljeno {formatDate(d.received_at)}
                </small>
              </>,
              `${formatDate(d.period_start)}–${formatDate(d.period_end)}`,
              d.extraction_status === "needs_manual"
                ? "Potreban ručni unos / OCR"
                : "Izdvojeno — potrebno pregledati",
              `${d.rows_count} / ${d.published_count}`,
              <button
                className="text-button"
                onClick={() => setDocumentId(d.id)}
              >
                Otvori dokument
              </button>,
            ])}
          />
        ) : (
          <Empty text="Još nema uvezenih biltena" />
        )}
      </section>
      {data && (
        <details>
          <summary>Podešavanja preuzimanja i uslovi korišćenja</summary>
          <CrawlerSettings settings={data.settings} onDone={load} />
        </details>
      )}
      {data?.runs.length > 0 && (
        <section className="panel">
          <h2>Evidencija preuzimanja</h2>
          <Table
            heads={["Vreme", "Status", "Otkriveno / uvezeno", "Greške"]}
            rows={data.runs.map((r: Any) => [
              new Date(r.started_at).toLocaleString("sr-Latn-RS"),
              r.status,
              `${r.discovered} / ${r.imported}`,
              r.errors.join(" ") || "—",
            ])}
          />
        </section>
      )}
    </>
  );
}
function MetadataFields({ doc }: Any) {
  return (
    <>
      <Input
        label="Naslov biltena"
        name="title"
        defaultValue={doc?.title || ""}
        required
      />
      <Input
        label="Zvanična STIPS adresa izvornog dokumenta"
        name="sourceUrl"
        type="url"
        placeholder="https://www.stips.minpolj.gov.rs/…"
        defaultValue={doc?.source_url || ""}
        required
      />
      <div className="form-grid">
        <Input
          label="Datum objave biltena"
          name="publishedAt"
          type="date"
          defaultValue={doc?.published_at || ""}
        />
        <Input
          label="Cene se odnose na period od"
          name="periodStart"
          type="date"
          defaultValue={doc?.period_start || ""}
        />
        <Input
          label="Cene se odnose na period do"
          name="periodEnd"
          type="date"
          defaultValue={doc?.period_end || ""}
        />
      </div>
      <Input
        label="Provereni uslovi korišćenja / osnov preuzimanja"
        name="termsNote"
        type="textarea"
        defaultValue={doc?.terms_note || ""}
      />
      <Input
        label="Potvrđujem da sam proverio uslove preuzimanja i ponovne upotrebe"
        name="termsConfirmed"
        type="checkbox"
        defaultChecked={!!doc?.terms_confirmed}
      />
      <p className="hint">
        Datumi koji nisu poznati mogu ostati prazni u nacrtu. Potrebni su pre
        objavljivanja cene. Naziv fajla ili datum preuzimanja ne zamenjuju
        period podatka.
      </p>
    </>
  );
}
const metadata = (f: FormData) => ({
  title: String(f.get("title") || ""),
  sourceUrl: String(f.get("sourceUrl") || ""),
  publishedAt: f.get("publishedAt") || null,
  periodStart: f.get("periodStart") || null,
  periodEnd: f.get("periodEnd") || null,
  termsConfirmed: f.get("termsConfirmed") === "on",
  termsNote: String(f.get("termsNote") || ""),
});
function UploadForm({ onDone }: Any) {
  return (
    <div className="stips-upload">
      <h3>Ručni uvoz originala</h3>
      <Form
        button="Izdvoji podatke i sačuvaj nacrt"
        onSubmit={async (f: FormData) => {
          const outgoing = new FormData();
          for (const [k, v] of Object.entries(metadata(f)))
            outgoing.set(k, v === null ? "" : String(v));
          const file = f.get("file");
          if (!(file instanceof File) || !file.size)
            throw Error("Izaberite PDF ili HTML dokument.");
          outgoing.set("file", file);
          await onDone(await uploadStips(outgoing));
        }}
      >
        <Input
          label="PDF ili sačuvana HTML stranica (do 8 MB, PDF do 40 strana)"
          name="file"
          type="file"
          accept=".pdf,.html,.htm"
          required
        />
        <MetadataFields />
      </Form>
    </div>
  );
}
function CrawlerSettings({ settings, onDone }: Any) {
  return (
    <Form
      button="Sačuvaj STIPS podešavanja"
      onSubmit={async (f: FormData) => {
        await api(
          "/admin/stips/settings",
          {
            enabled: f.get("enabled") === "on",
            listingUrls: String(f.get("urls"))
              .split("\n")
              .map((v) => v.trim())
              .filter(Boolean),
            intervalHours: Number(f.get("interval")),
            maxDocuments: Number(f.get("maximum")),
            termsConfirmed: f.get("terms") === "on",
            termsNote: String(f.get("note") || ""),
          },
          "PUT",
        );
        await onDone();
      }}
    >
      <Input
        label="Automatski proveravaj nove biltene"
        type="checkbox"
        name="enabled"
        defaultChecked={settings.enabled}
      />
      <Input
        label="Stvarne STIPS stranice sa direktnim PDF linkovima — najviše 3, po jedna adresa u redu"
        type="textarea"
        name="urls"
        rows={3}
        defaultValue={settings.listing_urls.join("\n")}
        required
      />
      <div className="form-grid">
        <Input
          label="Razmak provera (6–168 sati)"
          name="interval"
          type="number"
          defaultValue={settings.interval_hours}
          min={6}
          max={168}
          required
        />
        <Input
          label="Najviše biltena po proveri (1–10)"
          name="maximum"
          type="number"
          defaultValue={settings.max_documents}
          min={1}
          max={10}
          required
        />
      </div>
      <Input
        label="Dokumentovana provera uslova izvora"
        type="textarea"
        name="note"
        defaultValue={settings.terms_note}
      />
      <Input
        label="Potvrđeni uslovi preuzimanja i ponovne upotrebe"
        type="checkbox"
        name="terms"
        defaultChecked={settings.terms_confirmed}
      />
      <p className="hint">
        Preuzimač poštuje robots.txt, ograničava veličinu i broj dokumenata i
        prihvata isključivo zvanični STIPS HTTPS domen. Greška ostavlja
        poslednje proverene podatke. Nema zaobilaženja prijave, mrežnih zabrana
        ili TLS provere.
      </p>
      <p className="hint">
        Poslednja uspešna provera: {formatDate(settings.last_success_at)} ·
        sledeća: {formatDate(settings.next_check_at)}. Automatsko objavljivanje
        nije uključeno.
      </p>
    </Form>
  );
}
function DocumentReview({ id, onBack, onDone }: Any) {
  const [data, setData] = useState<Any>(),
    [row, setRow] = useState<Any>(),
    [manual, setManual] = useState(false),
    [error, setError] = useState(""),
    [page, setPage] = useState(0);
  async function load() {
    try {
      setData(await api("/admin/stips/documents/" + id));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    load();
  }, [id]);
  if (!data) return <p>{error || "Čitanje dokumenta…"}</p>;
  const doc = data.document;
  return (
    <>
      <button className="text-button back" onClick={onBack}>
        <ArrowLeft size={16} />
        Svi STIPS bilteni
      </button>
      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>{doc.title}</h2>
            <p>
              {doc.filename} · {doc.pages} strana · SHA-256{" "}
              {doc.sha256.slice(0, 16)}…
            </p>
          </div>
          <button
            className="secondary"
            onClick={async () => {
              try {
                await downloadStips(id, true, doc.filename);
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            <Download size={16} />
            Original
          </button>
        </div>
        {error && <Message error>{error}</Message>}
        {doc.extraction_warnings.map((w: string) => (
          <Message key={w}>{w}</Message>
        ))}
        <details>
          <summary>Metapodaci biltena i provera izvora</summary>
          <Form
            onSubmit={async (f: FormData) => {
              await api("/admin/stips/documents/" + id, metadata(f), "PUT");
              await load();
            }}
          >
            <MetadataFields doc={doc} />
          </Form>
          <p className="hint">
            Izmena metapodataka ne menja ranije objavljene snapshot-e;
            relevantan red ponovo odobrite da biste objavili novu reviziju.
          </p>
        </details>
        <details>
          <summary>Izdvojeni izvorni tekst — samo za pregled</summary>
          <pre className="stips-raw">
            {doc.text_content ||
              "Nema prepoznatog teksta. Pročitajte original i koristite ručni unos."}
          </pre>
        </details>
      </section>
      {doc.tables.length > 0 && (
        <details>
          <summary>Pregled tabela i mapiranje kolona na mesta</summary>
          <TableMapper document={doc} onDone={load} />
        </details>
      )}
      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>
              Predlozi cena <span className="count">{data.rows.length}</span>
            </h2>
            <p>
              Pregledajte izvorni red pre odobravanja. Prazno polje nije nula.
            </p>
          </div>
          <button
            className="secondary"
            onClick={() => {
              setManual(true);
              setRow(null);
            }}
          >
            <Plus size={16} />
            Ručni unos
          </button>
        </div>
        {(manual || row) && (
          <PriceEditor
            key={row?.id || "new"}
            row={row}
            document={doc}
            onCancel={() => {
              setManual(false);
              setRow(null);
            }}
            onDone={async () => {
              setManual(false);
              setRow(null);
              await load();
              await onDone?.();
            }}
          />
        )}
        {data.rows.length ? (
          <>
            <Table
              heads={[
                "Strana / izvorni red",
                "Predlog proizvoda",
                "Mesto / cena",
                "Provera",
                "Radnja",
              ]}
              rows={data.rows.slice(page * 30, page * 30 + 30).map((r: Any) => [
                <span>
                  Str. {r.page}
                  <small>{r.raw_quote.slice(0, 180)}</small>
                </span>,
                r.draft.product || "Nije prepoznato",
                <>
                  {r.draft.place || "Nedostaje mesto"}
                  <small>{priceText(r.draft)}</small>
                </>,
                r.withdrawn
                  ? "Povučeno"
                  : r.published
                    ? `Objavljeno · rev. ${r.revision}`
                    : `Nacrt · ${r.publicationIssues.length} dopuna`,
                <button
                  className="text-button"
                  onClick={() => {
                    setManual(false);
                    setRow(r);
                  }}
                >
                  Pregledaj red
                </button>,
              ])}
            />
            <div className="toolbar stips-pagination">
              <button
                className="secondary"
                disabled={!page}
                onClick={() => setPage(page - 1)}
              >
                Prethodna
              </button>
              <span>
                {page + 1} / {Math.max(1, Math.ceil(data.rows.length / 30))}
              </span>
              <button
                className="secondary"
                disabled={(page + 1) * 30 >= data.rows.length}
                onClick={() => setPage(page + 1)}
              >
                Sledeća
              </button>
            </div>
          </>
        ) : (
          <Empty text="Nema izdvojenih redova — koristite ručni unos" />
        )}
      </section>
    </>
  );
}
function TableMapper({ document: doc, onDone }: Any) {
  const [index, setIndex] = useState(0),
    [columns, setColumns] = useState<Any[]>([]);
  const table = doc.tables[index],
    width = Math.max(0, ...table.rows.map((r: string[]) => r.length)),
    choices = Array.from({ length: width }, (_, i) => ({
      value: String(i),
      label: `Kolona ${i + 1} · ${(table.rows[0]?.[i] || "").slice(0, 35)}`,
    }));
  return (
    <div>
      <Input
        label="Tabela"
        value={index}
        onChange={(e: Any) => {
          setIndex(Number(e.target.value));
          setColumns([]);
        }}
        options={doc.tables.map((t: Any, i: number) => ({
          value: i,
          label: `Tabela ${i + 1} · strana ${t.page}`,
        }))}
      />
      <Table
        heads={Array.from({ length: width }, (_, i) => `Kolona ${i + 1}`)}
        rows={table.rows.slice(0, 8)}
      />
      <p className="hint">
        Prikazano prvih 8 redova. Mapiranje pretvara kolone mesta u zasebne
        predloge cena. Redovi se ne objavljuju automatski.
      </p>
      <Form
        key={index}
        button="Napravi predloge po mestima"
        onSubmit={async (f: FormData) => {
          await api("/admin/stips/documents/" + doc.id + "/map", {
            tableIndex: index,
            startRow: Number(f.get("start")) - 1,
            productColumn: Number(f.get("product")),
            unitColumn:
              f.get("unitColumn") === "fixed"
                ? null
                : Number(f.get("unitColumn")),
            qualityColumn:
              f.get("quality") === "none" ? null : Number(f.get("quality")),
            unit: String(f.get("unit")),
            currency: String(f.get("currency")),
            priceType: String(f.get("priceType")),
            columns,
          });
          await onDone();
        }}
      >
        <div className="form-grid">
          <Input
            label="Prvi red sa podacima (broj od 1)"
            type="number"
            name="start"
            defaultValue={2}
            min={1}
            required
          />
          <Input label="Kolona proizvoda" name="product" options={choices} />
          <Input
            label="Kolona jedinice"
            name="unitColumn"
            options={[
              { value: "fixed", label: "Ista jedinica za ovu tabelu" },
              ...choices,
            ]}
          />
          <Input
            label="Zajednička jedinica (ako nema kolone)"
            name="unit"
            options={[
              { value: "", label: "Izaberite" },
              "kg",
              "t",
              "l",
              "kom",
              "grlo",
            ]}
          />
          <Input
            label="Kolona kvaliteta / sorte"
            name="quality"
            options={[
              { value: "none", label: "Nema posebne kolone" },
              ...choices,
            ]}
          />
          <Input
            label="Valuta ove tabele"
            name="currency"
            options={[{ value: "", label: "Izaberite" }, "RSD", "EUR"]}
            required
          />
          <Input
            label="Vrsta cene ove tabele"
            name="priceType"
            options={[
              { value: "", label: "Izaberite" },
              "otkupna",
              "veleprodajna",
              "maloprodajna",
            ]}
            required
          />
        </div>
        <h3>Kolone sa cenama po mestu</h3>
        {choices.map((c) => {
          const item = columns.find((v) => v.column === Number(c.value));
          return (
            <div className="stips-mapping-column" key={c.value}>
              <Input
                label={c.label}
                type="checkbox"
                checked={!!item}
                onChange={(e: Any) =>
                  setColumns(
                    e.target.checked
                      ? [
                          ...columns,
                          { column: Number(c.value), place: "", market: "" },
                        ]
                      : columns.filter((v) => v.column !== Number(c.value)),
                  )
                }
              />
              {item && (
                <div className="form-grid">
                  <Input
                    label={`Mesto za kolonu ${Number(c.value) + 1}`}
                    value={item.place}
                    onChange={(e: Any) =>
                      setColumns(
                        columns.map((v) =>
                          v === item ? { ...v, place: e.target.value } : v,
                        ),
                      )
                    }
                    required
                  />
                  <Input
                    label={`Tržište / obuhvat za kolonu ${Number(c.value) + 1}`}
                    value={item.market}
                    onChange={(e: Any) =>
                      setColumns(
                        columns.map((v) =>
                          v === item ? { ...v, market: e.target.value } : v,
                        ),
                      )
                    }
                    required
                  />
                </div>
              )}
            </div>
          );
        })}
        <p className="hint">
          Pregledani ili objavljeni redovi se ne prepisuju novim mapiranjem.
          Raspon ostaje raspon; srednja cena se ne izmišlja.
        </p>
      </Form>
    </div>
  );
}
function PriceEditor({ row, document: doc, onDone, onCancel }: Any) {
  const [rowId, setRowId] = useState(row?.id || ""),
    [draft, setDraft] = useState<Any>(
      row?.draft || {
        product: "",
        place: "",
        market: "",
        priceType: "",
        unit: "",
        currency: "",
        price: null,
        priceMin: null,
        priceMax: null,
        periodStart: doc.period_start,
        periodEnd: doc.period_end,
        quality: "",
        zeroReason: "",
      },
    ),
    [quote, setQuote] = useState(row?.raw_quote || ""),
    [reason, setReason] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [history, setHistory] = useState<Any[]>();
  const change = (key: string, value: Any) =>
    setDraft({ ...draft, [key]: value });
  async function save(publish: boolean, form: HTMLFormElement) {
    setBusy(true);
    setError("");
    try {
      if (!reason.trim()) throw Error("Navedite razlog izmene ili odobrenja.");
      let id = rowId;
      if (!id) {
        id = (
          await api("/admin/stips/documents/" + doc.id + "/rows", {
            draft,
            page: Number(new FormData(form).get("page")),
            quote,
          })
        ).id;
        setRowId(id);
      } else
        await api("/admin/stips/rows/" + id, { draft, quote, reason }, "PUT");
      if (publish)
        await api("/admin/stips/rows/" + id + "/publish", { reason });
      await onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="stips-editor">
      <div className="panel-head">
        <h3>{row ? "Pregled i odobrenje reda" : "Ručni unos sa originala"}</h3>
        <button className="text-button" onClick={onCancel}>
          Zatvori pregled
        </button>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save(
            (e.nativeEvent as SubmitEvent).submitter?.getAttribute("value") ===
              "publish",
            e.currentTarget,
          );
        }}
      >
        <div className="form-grid">
          <Input
            label="STIPS proizvod"
            value={draft.product}
            onChange={(e: Any) => change("product", e.target.value)}
          />
          <Input
            label="Konkretno mesto / područje otkupa"
            value={draft.place}
            onChange={(e: Any) => change("place", e.target.value)}
          />
          <Input
            label="Pijaca, kvantaš ili obuhvat otkupa"
            value={draft.market}
            onChange={(e: Any) => change("market", e.target.value)}
          />
          <Input
            label="Vrsta proverene cene"
            value={draft.priceType}
            onChange={(e: Any) => change("priceType", e.target.value)}
            options={[
              { value: "", label: "Izaberite" },
              "otkupna",
              "veleprodajna",
              "maloprodajna",
            ]}
          />
          <Input
            label="Jedinica cene"
            value={draft.unit}
            onChange={(e: Any) => change("unit", e.target.value)}
            options={[
              { value: "", label: "Izaberite" },
              "kg",
              "t",
              "l",
              "kom",
              "grlo",
            ]}
          />
          <Input
            label="Valuta cene"
            value={draft.currency}
            onChange={(e: Any) => change("currency", e.target.value)}
            options={[{ value: "", label: "Izaberite" }, "RSD", "EUR"]}
          />
          {["price", "priceMin", "priceMax"].map((k, i) => (
            <Input
              key={k}
              label={
                [
                  "Cena (ako je izvor navodi)",
                  "Donja cena raspona",
                  "Gornja cena raspona",
                ][i]
              }
              type="number"
              value={draft[k] ?? ""}
              onChange={(e: Any) =>
                change(k, e.target.value === "" ? null : e.target.value)
              }
            />
          ))}
          <Input
            label="Period cene od"
            type="date"
            value={draft.periodStart || ""}
            onChange={(e: Any) => change("periodStart", e.target.value || null)}
          />
          <Input
            label="Period cene do"
            type="date"
            value={draft.periodEnd || ""}
            onChange={(e: Any) => change("periodEnd", e.target.value || null)}
          />
          <Input
            label="Kvalitet, sorta ili pakovanje"
            value={draft.quality}
            onChange={(e: Any) => change("quality", e.target.value)}
          />
          <Input
            label="Razlog eksplicitne nulte cene"
            value={draft.zeroReason}
            onChange={(e: Any) => change("zeroReason", e.target.value)}
          />
          <Input
            label="Strana originala"
            name="page"
            type="number"
            min={1}
            max={doc.pages}
            defaultValue={row?.page || 1}
            disabled={!!rowId}
          />
        </div>
        <Input
          label="Izvorni red / citat za proveru"
          type="textarea"
          value={quote}
          onChange={(e: Any) => setQuote(e.target.value)}
          required
        />
        <Input
          label="Razlog izmene / odobrenja"
          value={reason}
          onChange={(e: Any) => setReason(e.target.value)}
          required
        />
        {error && <Message error>{error}</Message>}
        <div className="toolbar">
          <button className="secondary" value="draft" disabled={busy}>
            Sačuvaj nacrt
          </button>
          <button className="primary" value="publish" disabled={busy}>
            <Check size={16} />
            {busy ? "Obrada…" : "Odobri i objavi cenu"}
          </button>
          {row?.published && !row.withdrawn && (
            <button
              className="secondary"
              type="button"
              disabled={busy}
              onClick={async () => {
                try {
                  if (!reason.trim())
                    throw Error("Navedite razlog povlačenja.");
                  await api("/admin/stips/rows/" + row.id + "/withdraw", {
                    reason,
                  });
                  await onDone();
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              Povuci objavu
            </button>
          )}
        </div>
      </form>
      {rowId && (
        <button
          className="text-button"
          onClick={async () => {
            try {
              setHistory(await api("/admin/stips/rows/" + rowId + "/history"));
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          Prikaži istoriju revizija
        </button>
      )}
      {history && (
        <Table
          heads={["Radnja", "Vreme", "Prethodna revizija", "Razlog"]}
          rows={history.map((h) => [
            h.action,
            formatDate(h.at),
            h.revision,
            h.reason,
          ])}
        />
      )}
    </div>
  );
}
