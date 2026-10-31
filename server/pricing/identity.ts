import type { PricingRow } from "../../shared/pricing.js";
import { hash } from "./model.js";

// Remove application counts and descriptive roles, never product grades or concentrations.
export function materialName(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/đ/gi, "dj")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\((?:herbicidi?|fungicidi?|inse[ck]ticidi?)\)/g, " ")
    .replace(/\s*-\s*\d+\.?\s*put(?:a)?\.?\s*$/g, "")
    .replace(/(?:\s+ili|\s*\+)\s*$/g, "")
    .replace(/\b(?:djubrivo|djubriva)\b/g, "")
    .replace(/[^a-z0-9:%]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}
export function costKey(row: PricingRow) {
  if (row.pricingGroup === "diesel") return hash(["shared-diesel-price", "l"]);
  return hash([
    materialName(row.occurrences[0]?.name || row.name),
    row.occurrences.some((o) => o.sheet.startsWith("Stočarstvo"))
      ? "livestock-input"
      : "crop-input",
    row.cultureSpecific ? row.occurrences[0]?.templateId : null,
  ]);
}
