export interface PriceSuggestion {
  sourceKind?: "stips" | "rzs";
  sourceUnit?: string;
  priceType?: string;
  observationId: string;
  product: string;
  manufacturer: string;
  packaging: string;
  place: string;
  unit: string;
  unitsPerPrice: string;
  amount: string;
  originalPrice: string;
  periodStart: string;
  periodEnd: string;
  date: string;
  sourceUrl: string;
  sheet: string;
  cell: string;
  historical: boolean;
  pendingRate: boolean;
  match: "approved" | "exact" | "review";
}
export interface PriceSuggestionRow {
  key: string;
  groupKey: string;
  name: string;
  unit: string;
  status: "matched" | "review" | "missing" | "filled" | "excluded";
  message: string;
  selectedId: string | null;
  candidates: PriceSuggestion[];
}
export interface PriceSuggestions {
  revision: string;
  asOf: string;
  place: string;
  places: string[];
  rzsCount?: number;
  rows: PriceSuggestionRow[];
}
