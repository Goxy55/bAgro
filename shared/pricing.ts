export interface PricingOccurrence {
  versionId: string;
  templateId: string;
  itemId: string;
  name: string;
  quantity: string | null;
  price: string | null;
  cost: string | null;
  included: boolean;
  unitConfirmed: boolean;
  zeroReason: string | null;
  sheet: string;
  quantityCell: string | null;
  priceCell: string | null;
  alternativeGroup: string | null;
  lastInput: {
    amount: string;
    currency: "EUR" | "RSD";
    date: string;
    pendingRate: boolean;
    reference?: {
      kind?: string;
      priceType?: string;
      product: string;
      place: string;
      periodStart: string;
      sourceUrl: string;
      sheet: string;
      cell: string;
    };
  } | null;
}
export interface PricingRow {
  seedUnitSize?: string;
  key: string;
  groupKey?: string;
  pricingGroup?: "diesel";
  name: string;
  unit: string;
  cultureSpecific: boolean;
  price: string | null;
  mixed: boolean;
  occurrences: PricingOccurrence[];
}
export interface PricingTable {
  currency: "RSD" | "EUR";
  revision: string;
  validFrom: string;
  validTo: string;
  versions: {
    id: string;
    templateId: string;
    name: string;
    culture: string;
    basis: string;
    reference: string;
    knownCost: string;
    errors: string[];
  }[];
  rows: PricingRow[];
}
