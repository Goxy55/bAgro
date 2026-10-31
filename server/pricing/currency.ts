import { D } from "../domain.js";

export function modelInCurrency(
  input: any,
  target: "RSD" | "EUR",
  keepPrices: boolean,
) {
  const model = structuredClone(input),
    previous = model.currency || "EUR";
  model.currency = target;
  model.reviewed = false;
  for (const item of model.items) {
    item.unitConfirmed = false;
    if (!keepPrices) {
      item.price = null;
      item.zeroReason = null;
      delete item.priceInput;
      continue;
    }
    if (previous === target) continue;
    const p = item.priceInput;
    const value =
      target === "RSD"
        ? (p?.rsd ?? (p?.currency === "RSD" ? p.amount : null))
        : (p?.eur ?? (p?.currency === "EUR" ? p.amount : null));
    if (item.price != null)
      item.priorCurrencyPrice = {
        currency: previous,
        amount: String(item.price),
        input: p || null,
      };
    item.price = value == null ? null : D(value).toString();
    if (p) p.storedCurrency = target;
  }
  return model;
}
