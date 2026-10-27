export interface PricingOccurrence {
  versionId: string;
  templateId: string;
  itemId: string;
  name: string;
  quantity: string | null;
  priceEur: string | null;
  costEur: string | null;
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
  } | null;
}
export interface PricingRow {
  key: string;
  name: string;
  unit: string;
  cultureSpecific: boolean;
  priceEur: string | null;
  mixed: boolean;
  occurrences: PricingOccurrence[];
}
export interface PricingTable {
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
    knownCostEur: string;
    errors: string[];
  }[];
  rows: PricingRow[];
}
