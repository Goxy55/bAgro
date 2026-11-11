/** Procena cene za stavku bez izvora: nikad izvorna cena, uvek nacrt za potvrdu. */
export interface PriceEstimateCandidate {
  observationId: string;
  product: string;
  manufacturer: string;
  packaging: string;
  place: string;
  category: string;
  unit: string;
  unitsPerPrice: string;
  /** Cena po jedinici stavke troškovnika (RSD). */
  amount: string;
  originalPrice: string;
  periodStart: string;
  sourceUrl: string;
  /** Sličnost naziva i sastava, 0–1. */
  score: number;
  reason: string;
}
export interface PriceEstimateGroup {
  category: string;
  unit: string;
  count: number;
  min: string;
  median: string;
  max: string;
}
export interface PriceEstimateRow {
  key: string;
  groupKey: string;
  name: string;
  unit: string;
  candidates: PriceEstimateCandidate[];
  /** Samo orijentir, ne može se primeniti kao cena. */
  group: PriceEstimateGroup | null;
}
export interface PriceEstimates {
  revision: string;
  asOf: string;
  place: string;
  rows: PriceEstimateRow[];
}
