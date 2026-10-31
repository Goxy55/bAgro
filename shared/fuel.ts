export interface FuelPreview {
  revision: string;
  operations: { name: string; cultures: number; items: number }[];
  eligible: number;
  linked: number;
  cultures: number;
  unresolved: number;
  blockedUnits: { name: string; culture: string; unit: string }[];
  current: {
    amount: string;
    currency: "RSD" | "EUR";
    date: string;
    pendingRate: boolean;
  } | null;
  mixed: boolean;
}
