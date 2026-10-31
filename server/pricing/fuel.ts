import { readFileSync } from "node:fs";
import { D } from "../domain.js";
import type { PricingVersion } from "./model.js";
import { buildPricingTable, normalizedPriceUnit, priceUnits } from "./model.js";
import type { FuelPreview } from "../../shared/fuel.js";

const audit = JSON.parse(
  readFileSync(
    new URL("../../source/fuel-operations.json", import.meta.url),
    "utf8",
  ),
);
const evidence = new Map<string, any>(
  audit.items.map((r: any) => [r.templateId + ":" + r.itemId, r]),
);
export function sourceFuel(version: PricingVersion, item: any) {
  const source = evidence.get(version.template_id + ":" + item.id);
  // A source ID alone is insufficient after a model edit or synthetic import.
  return source &&
    version.model.sheet === source.sheet &&
    item.quantityCell === source.quantityCell &&
    item.name === source.name
    ? source
    : null;
}
export function isFuelCandidate(version: PricingVersion, item: any) {
  const unit = normalizedPriceUnit(item.unit);
  const linked = item.pricingGroup === "diesel" && unit === "l";
  const source = sourceFuel(version, item);
  if (!linked && !source) return false;
  // Preserve approved service/area/hour units. Do not reinterpret quantities.
  return unit === "l" || (!priceUnits.includes(unit) && !!source);
}
export function previewFuel(versions: PricingVersion[]): FuelPreview {
  const table = buildPricingTable(versions),
    groups = new Map<string, { templates: Set<string>; count: number }>();
  const eligible: { v: PricingVersion; item: any }[] = [],
    blockedUnits: FuelPreview["blockedUnits"] = [];
  let unresolved = 0;
  for (const v of versions)
    for (const item of v.model.items) {
      if (isFuelCandidate(v, item)) {
        eligible.push({ v, item });
        const group = groups.get(item.name) || {
          templates: new Set<string>(),
          count: 0,
        };
        group.templates.add(v.template_id);
        group.count++;
        groups.set(item.name, group);
      } else if (sourceFuel(v, item))
        blockedUnits.push({
          name: item.name,
          culture: v.template_name,
          unit: item.unit,
        });
      else if (String(item.unit).includes("goriva/usluga")) unresolved++;
    }
  const inputs = eligible.map(({ item }) => item.priceInput);
  const first = inputs[0];
  const consistentInput =
    first &&
    inputs.every(
      (p) =>
        p &&
        p.amount === first.amount &&
        p.currency === first.currency &&
        p.date === first.date &&
        p.unit === "l",
    );
  const prices = new Set(
    eligible.map(({ item }) =>
      item.price == null || item.price === "" ? null : D(item.price).toString(),
    ),
  );
  return {
    revision: table.revision,
    eligible: eligible.length,
    linked: eligible.filter(({ item }) => item.pricingGroup === "diesel")
      .length,
    cultures: new Set(eligible.map(({ v }) => v.template_id)).size,
    operations: [...groups]
      .map(([name, g]) => ({
        name,
        cultures: g.templates.size,
        items: g.count,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "sr-Latn")),
    blockedUnits,
    unresolved,
    mixed: prices.size > 1 || (!consistentInput && inputs.some(Boolean)),
    current: consistentInput
      ? {
          amount: first.amount,
          currency: first.currency,
          date: first.date,
          pendingRate: inputs.some((p) => p?.pendingRate),
        }
      : prices.size === 1 &&
          eligible[0]?.item.price != null &&
          eligible[0]?.item.price !== ""
        ? {
            amount: String(eligible[0].item.price),
            currency: "EUR",
            date: table.validFrom,
            pendingRate: false,
          }
        : null,
  };
}
export function bindFuel(
  versions: PricingVersion[],
  actor: string,
  reason: string,
) {
  const changes: { versionId: string; items: any[] }[] = [];
  for (const v of versions) {
    const items: any[] = [];
    for (const item of v.model.items) {
      if (!isFuelCandidate(v, item)) continue;
      const before = {
        unit: item.unit,
        unitConfirmed: !!item.unitConfirmed,
        pricingGroup: item.pricingGroup || null,
        fuelBinding: item.fuelBinding || null,
      };
      item.unit = "l";
      item.unitConfirmed = true;
      item.pricingGroup = "diesel";
      const source = sourceFuel(v, item);
      if (!item.fuelBinding)
        item.fuelBinding = {
          kind: source ? "source_fuel_sum" : "admin_confirmed",
          sourceHash: source ? audit.sourceHash : null,
          sheet: source?.sheet,
          quantityCell: source?.quantityCell,
          summaryCells: source?.summaryCells,
          author: actor,
          reason,
        };
      items.push({
        itemId: item.id,
        before,
        after: {
          unit: item.unit,
          unitConfirmed: true,
          pricingGroup: item.pricingGroup,
          fuelBinding: item.fuelBinding,
        },
      });
    }
    if (items.length) changes.push({ versionId: v.id, items });
  }
  if (!changes.length)
    throw Error(
      "Nema potvrđenih stavki goriva. Potvrdite jedinice operacija u normativu.",
    );
  return changes;
}
