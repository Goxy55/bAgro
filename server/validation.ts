import { z } from "zod";
export const id = z.string().uuid();
export const text = z.string().trim().min(1).max(300);
export const dec = z
  .string()
  .regex(
    /^\d{1,18}(\.\d{1,12})?$/,
    "Unesite pozitivan decimalni broj sa tačkom.",
  );
export const date = z.iso.date();
export const currency = z.enum(["RSD", "EUR"]);
export const unit = z.enum([
  "kg",
  "t",
  "ha",
  "m2",
  "l",
  "kom",
  "biljka",
  "grlo",
  "vreća",
]);
export const url = z
  .url()
  .max(2000)
  .refine((u) => u.startsWith("https://"), "Izvor mora biti HTTPS.");
export const farmSchema = z.object({
  name: text,
  municipality: z.string().max(200).default(""),
  year: z.number().int().min(2000).max(2100),
  currency,
});
export const productionSchema = z.object({
  templateId: text,
  name: text,
  year: z.number().int().min(2000).max(2100),
  status: z.enum(["draft", "final"]),
  details: z.object({
    scale: dec.optional(),
    scaleUnit: unit.optional(),
    output: dec.optional(),
    outputUnit: unit.optional(),
    product: z.string().max(200).optional(),
    start: date.optional(),
    end: date.optional(),
    houses: dec.optional(),
    plants: dec.optional(),
    buyWeight: dec.optional(),
    sellWeight: dec.optional(),
    mortality: dec.optional(),
    headChange: z.string().max(100).optional(),
    note: z.string().max(2000).optional(),
  }),
});
export const eventSchema = z.object({
  kind: z.enum(["sale", "cost", "subsidy", "other_income"]),
  productionId: id.nullable().optional(),
  date: date.nullable().optional(),
  title: text,
  status: z.enum(["draft", "final", "requested", "approved", "received"]),
  amount: dec.optional(),
  currency,
  details: z.object({
    quantity: dec.optional(),
    unit: unit.optional(),
    unitPrice: dec.optional(),
    product: z.string().max(200).optional(),
    counterparty: z.string().max(300).optional(),
    note: z.string().max(2000).optional(),
    normItemId: z.string().max(60).optional(),
    replaceNorm: z.boolean().optional(),
    combinedAdditional: z.boolean().optional(),
    inventoryPurchase: z.boolean().optional(),
    stockType: z.enum(["product", "material"]).optional(),
    byproduct: z.boolean().optional(),
  }),
});
