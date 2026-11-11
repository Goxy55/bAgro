import { D } from "./domain.js";

/**
 * Procena uticaja nedostajućih ili nepotvrđenih podataka. Ovo je pregledna
 * procena za korisnika: ne ulazi u obračun, marže ni izvoze kao stvarni iznos.
 */
export type ImpactProduction = {
  id: string;
  name: string;
  /** Normativ u EUR kada postoji, a nedostaje kurs za datum obračuna. */
  missingRate: { eurTotal: string; date: string } | null;
  stock: string;
  stockValue: string | null;
  actualComplete: boolean;
};
export type ImpactDraft = {
  id: string;
  title: string;
  kind: string;
  amount: string | null;
};
export type ImpactItem = {
  code: "fx" | "drafts" | "unsold" | "unconfirmed";
  label: string;
  count: number;
  /** Procenjeni iznos u valuti prikaza; null kada se ne može proceniti. */
  amount: string | null;
  costAmount?: string;
  incomeAmount?: string;
  withoutAmount: number;
  basis: string;
  names: string[];
  action: "rates" | "events" | "inventory" | "productions";
};
export type Impact = {
  estimate: true;
  currency: "RSD" | "EUR";
  note: string;
  items: ImpactItem[];
};

export function buildImpact(i: {
  key: "rsd" | "eur";
  currency: "RSD" | "EUR";
  productions: ImpactProduction[];
  drafts: ImpactDraft[];
  nearestRate: { rate: string; validFrom: string; kind: string } | null;
}): Impact {
  const items: ImpactItem[] = [];
  const names = (rows: { name: string }[]) =>
    rows.map((r) => r.name).slice(0, 8);

  const fx = i.productions.filter((p) => p.missingRate);
  if (fx.length) {
    const eur = fx.reduce((s, p) => s.add(p.missingRate!.eurTotal), D(0));
    const amount =
      i.key === "eur"
        ? eur
        : i.nearestRate
          ? eur.mul(i.nearestRate.rate)
          : null;
    items.push({
      code: "fx",
      label: "Nedostaje kurs za obračun normativa",
      count: fx.length,
      amount: amount?.toString() ?? null,
      withoutAmount: amount ? 0 : fx.length,
      basis:
        i.key === "eur"
          ? "Normativ u EUR."
          : i.nearestRate
            ? `Normativ u EUR × ${i.nearestRate.rate} (${i.nearestRate.kind === "fixed" ? "fiksni" : "zvanični"} kurs od ${i.nearestRate.validFrom}, najbliži poznati).`
            : "Nema nijednog kursa; unesite fiksni ili zvanični kurs.",
      names: names(fx),
      action: "rates",
    });
  }

  if (i.drafts.length) {
    const sum = (f: (d: ImpactDraft) => boolean) =>
      i.drafts
        .filter((d) => d.amount != null && f(d))
        .reduce((s, d) => s.add(d.amount!), D(0))
        .toString();
    items.push({
      code: "drafts",
      label: "Nedovršeni poslovni događaji",
      count: i.drafts.length,
      amount: null,
      costAmount: sum((d) => d.kind === "cost"),
      incomeAmount: sum((d) => d.kind !== "cost"),
      withoutAmount: i.drafts.filter((d) => d.amount == null).length,
      basis:
        "Zbir iznosa iz nacrta; troškovi i prihodi su odvojeni. Nacrt bez iznosa ili kursa nije uračunat.",
      names: i.drafts.map((d) => d.title).slice(0, 8),
      action: "events",
    });
  }

  const unsold = i.productions.filter((p) => D(p.stock).gt(0));
  if (unsold.length) {
    const priced = unsold.filter((p) => p.stockValue != null);
    items.push({
      code: "unsold",
      label: "Neprodata količina",
      count: unsold.length,
      amount: priced.length
        ? priced.reduce((s, p) => s.add(p.stockValue!), D(0)).toString()
        : null,
      withoutAmount: unsold.length - priced.length,
      basis:
        "Vrednost po normativnom trošku proizvodnje. To nije prihod; stvarna prodajna cena može biti drugačija.",
      names: names(unsold),
      action: "inventory",
    });
  }

  const open = i.productions.filter((p) => !p.actualComplete);
  if (open.length)
    items.push({
      code: "unconfirmed",
      label: "Evidencija stvarnih troškova nije potvrđena",
      count: open.length,
      amount: null,
      withoutAmount: open.length,
      basis:
        "Iznos se ne može proceniti dok se evidencija ne potvrdi; rezultat ostaje privremen.",
      names: names(open),
      action: "productions",
    });

  return {
    estimate: true,
    currency: i.currency,
    note: "Procena radi lakšeg pregleda. Ne ulazi u obračun, maržu ni izvoze kao stvarni iznos.",
    items,
  };
}
