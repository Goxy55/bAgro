import React from "react";

type Item = {
  code: "fx" | "drafts" | "unsold" | "unconfirmed" | "estimated";
  label: string;
  count: number;
  amount: string | null;
  costAmount?: string;
  incomeAmount?: string;
  withoutAmount: number;
  basis: string;
  names: string[];
  action: "rates" | "events" | "inventory" | "productions" | "pricing";
};
export type ImpactData = {
  currency: string;
  note: string;
  items: Item[];
};
const fmt = (v: string | number) =>
  new Intl.NumberFormat("sr-Latn-RS", { maximumFractionDigits: 0 }).format(
    Number(v),
  );
const ACTION: Record<Item["action"], string> = {
  rates: "Unesi kurs",
  pricing: "Otvori cenovnik",
  events: "Otvori događaje",
  inventory: "Otvori zalihe",
  productions: "Otvori proizvodnje",
};

function amountText(i: Item, cur: string) {
  if (i.code === "drafts")
    return (
      `troškovi ${fmt(i.costAmount || 0)} ${cur} · prihodi ${fmt(i.incomeAmount || 0)} ${cur}` +
      (i.withoutAmount ? ` · ${i.withoutAmount} bez iznosa` : "")
    );
  if (i.amount == null) return "ne može se proceniti";
  if (i.code === "estimated") return `${fmt(i.amount)} ${cur} u normativu`;
  return (
    `oko ${fmt(i.amount)} ${cur}` +
    (i.withoutAmount ? ` (+${i.withoutAmount} bez procene)` : "")
  );
}

/** Pregled grešaka i nepotpunosti, sa procenjenim iznosom gde je moguće. */
export function ImpactCard({
  impact,
  admin,
  onGo,
}: {
  impact?: ImpactData;
  admin: boolean;
  onGo: (target: Item["action"]) => void;
}) {
  if (!impact?.items.length) return null;
  return (
    <section className="panel" aria-label="Šta nedostaje i koliko to vredi">
      <div className="panel-head">
        <div>
          <h2>Šta nedostaje i koliko to vredi</h2>
          <p>{impact.note}</p>
        </div>
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Problem</th>
              <th>Procena uticaja</th>
              <th>Kako je izračunato</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {impact.items.map((i) => (
              <tr key={i.code}>
                <td>
                  <strong>{i.label}</strong>
                  <br />
                  <small>
                    {i.count}
                    {i.names.length
                      ? " · " + i.names.slice(0, 3).join(", ")
                      : ""}
                  </small>
                </td>
                <td>
                  <strong>{amountText(i, impact.currency)}</strong>
                </td>
                <td>
                  <small>{i.basis}</small>
                </td>
                <td>
                  {(i.action === "rates" || i.action === "pricing") &&
                  !admin ? (
                    <small>Obratite se administratoru</small>
                  ) : (
                    <button
                      className="text-button"
                      onClick={() => onGo(i.action)}
                    >
                      {ACTION[i.action]}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
