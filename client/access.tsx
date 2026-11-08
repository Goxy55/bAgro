import React, { useEffect, useState } from "react";
import { api, selectedFarm } from "./api";

type Member = { user_id: string; name: string; email: string; role: string };
type Invite = {
  id: string;
  email: string;
  role: string;
  expires_at: string;
  expired: boolean;
};
const ROLE: Record<string, string> = {
  owner: "Vlasnik",
  member: "Član (unosi podatke)",
  viewer: "Pregled (samo čita)",
};

export function MembersPanel() {
  const [data, setData] = useState<{
    you: string;
    role: string;
    members: Member[];
    invites: Invite[];
  }>();
  const [error, setError] = useState(""),
    [link, setLink] = useState<{ url: string; emailed: boolean }>(),
    [busy, setBusy] = useState(false);
  async function load() {
    try {
      setData(await api("/members"));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    load();
  }, []);
  async function run(fn: () => Promise<unknown>) {
    setError("");
    setBusy(true);
    try {
      await fn();
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!data) return error ? <div className="form-error">{error}</div> : null;
  const owner = data.role === "owner";
  return (
    <section className="panel narrow">
      <h2>Članovi gazdinstva</h2>
      <p className="hint">
        Vlasnik poziva druge osobe emailom. <strong>Član</strong> unosi
        evidenciju, a <strong>pregled</strong> samo čita izveštaje. Samo vlasnik
        upravlja članovima.
      </p>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Ime</th>
              <th>Email</th>
              <th>Uloga</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data.members.map((m) => (
              <tr key={m.user_id}>
                <td>{m.name}</td>
                <td>{m.email}</td>
                <td>
                  {owner && m.role !== "owner" ? (
                    <select
                      aria-label={"Uloga: " + m.email}
                      value={m.role}
                      disabled={busy}
                      onChange={(e) =>
                        run(() =>
                          api(
                            "/members/" + m.user_id,
                            { role: e.target.value },
                            "PATCH",
                          ),
                        )
                      }
                    >
                      <option value="member">{ROLE.member}</option>
                      <option value="viewer">{ROLE.viewer}</option>
                    </select>
                  ) : (
                    ROLE[m.role]
                  )}
                </td>
                <td>
                  {m.role !== "owner" && (owner || m.user_id === data.you) && (
                    <button
                      className="text-button"
                      disabled={busy}
                      onClick={() =>
                        confirm(
                          m.user_id === data.you
                            ? "Napustiti ovo gazdinstvo?"
                            : `Ukloniti ${m.email} sa gazdinstva?`,
                        ) &&
                        run(async () => {
                          await api(
                            "/members/" + m.user_id,
                            undefined,
                            "DELETE",
                          );
                          if (m.user_id === data.you) location.reload();
                        })
                      }
                    >
                      {m.user_id === data.you ? "Napusti" : "Ukloni"}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {owner && (
        <>
          {data.invites.length > 0 && (
            <>
              <h3>Poslate pozivnice</h3>
              <ul>
                {data.invites.map((i) => (
                  <li key={i.id}>
                    {i.email} · {ROLE[i.role]} ·{" "}
                    {i.expired
                      ? "istekla"
                      : "važi do " +
                        new Date(i.expires_at).toLocaleDateString(
                          "sr-Latn",
                        )}{" "}
                    <button
                      className="text-button"
                      disabled={busy}
                      onClick={() =>
                        run(() => api("/invites/" + i.id, undefined, "DELETE"))
                      }
                    >
                      Opozovi
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
          <h3>Pozovi osobu</h3>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = e.currentTarget,
                v = Object.fromEntries(new FormData(f));
              run(async () => {
                const r = await api("/invites", v);
                setLink({ url: r.url, emailed: r.emailed });
                f.reset();
              });
            }}
          >
            <label className="field">
              <span>Email adresa *</span>
              <input
                name="email"
                type="email"
                required
                aria-label="Email adresa"
              />
            </label>
            <label className="field">
              <span>Uloga</span>
              <select name="role" aria-label="Uloga" defaultValue="viewer">
                <option value="viewer">{ROLE.viewer}</option>
                <option value="member">{ROLE.member}</option>
              </select>
            </label>
            <div className="form-actions">
              <button className="primary" disabled={busy}>
                Napravi pozivnicu
              </button>
            </div>
          </form>
          {link && (
            <div className="alert" role="status">
              <div>
                {link.emailed
                  ? "Pozivnica je poslata emailom. "
                  : "Email nije podešen — pošaljite ovaj link osobi lično. "}
                Važi 7 dana i radi samo za pozvanu email adresu, nakon prijave
                ili registracije:
                <br />
                <input
                  readOnly
                  aria-label="Link pozivnice"
                  value={link.url}
                  style={{ width: "100%" }}
                  onFocus={(e) => e.currentTarget.select()}
                />
              </div>
            </div>
          )}
        </>
      )}
      {error && (
        <div className="form-error" role="alert">
          {error}
        </div>
      )}
    </section>
  );
}

export function AccountPanel() {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function exportData() {
    setError("");
    try {
      const res = await fetch("/api/account/export", {
        headers: selectedFarm ? { "X-Farm-Id": selectedFarm } : {},
      });
      if (!res.ok) throw Error((await res.json()).error || "Izvoz nije uspeo.");
      const href = URL.createObjectURL(await res.blob()),
        a = document.createElement("a");
      a.href = href;
      a.download = "agro-moji-podaci.json";
      a.click();
      setTimeout(() => URL.revokeObjectURL(href), 1000);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <section className="panel narrow">
      <h2>Moji podaci i nalog</h2>
      <p className="hint">
        Izvoz sadrži podatke vašeg naloga i gazdinstava čiji ste vlasnik (JSON).
        Brisanje naloga je trajno: lični podaci, lozinka i sesije se uklanjaju,
        a poslovni brojevi gazdinstva ostaju anonimizovani, bez veze sa vama.
      </p>
      <div className="form-actions">
        <button className="secondary" onClick={exportData}>
          Izvezi moje podatke
        </button>
      </div>
      <h3>Brisanje naloga</h3>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const v = Object.fromEntries(new FormData(e.currentTarget));
          setError("");
          setBusy(true);
          try {
            await api("/account", v, "DELETE");
            location.reload();
          } catch (err) {
            setError((err as Error).message);
            setBusy(false);
          }
        }}
      >
        <label className="field">
          <span>Lozinka *</span>
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            required
            aria-label="Lozinka"
          />
        </label>
        <label className="field">
          <span>Za potvrdu upišite OBRIŠI *</span>
          <input
            name="confirm"
            required
            pattern="OBRIŠI"
            aria-label="Potvrda brisanja"
          />
        </label>
        <div className="form-actions">
          <button className="secondary" disabled={busy}>
            Trajno obriši nalog
          </button>
        </div>
      </form>
      {error && (
        <div className="form-error" role="alert">
          {error}
        </div>
      )}
    </section>
  );
}
