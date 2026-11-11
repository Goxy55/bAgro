import { ZodError } from "zod";

/** Poslovna greška čija je poruka namenjena korisniku (HTTP 422). */
export class UserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserError";
  }
}

export type ClassifiedError = {
  status: number;
  message: string;
  /** Interna greška: u log ide ceo zapis, korisniku samo generička poruka. */
  internal: boolean;
};

export const INTERNAL_MESSAGE = "Došlo je do interne greške. Pokušajte ponovo.";

/**
 * Određuje HTTP status i poruku za grešku iz rute.
 *
 * Postojeći kod baca običan `Error("…")` sa porukom na srpskom za poslovna
 * pravila; to se i dalje tretira kao greška korisnika (422). Sve ostalo —
 * ugrađene podklase (TypeError…), sistemske i mrežne greške, greške baze van
 * klase integriteta (23xxx) i podataka (22xxx) — ne izlaže se korisniku.
 */
export function classifyError(err: any): ClassifiedError {
  if (err instanceof UserError)
    return { status: 422, message: err.message, internal: false };
  if (err?.status === 409)
    return { status: 409, message: err.message, internal: false };
  if (err instanceof ZodError)
    return {
      status: 422,
      message: err.issues
        .map((i: any) => `${i.path.join(".")}: ${i.message}`)
        .join("\n"),
      internal: false,
    };
  // Greške express.json (neispravan JSON, prevelik zahtev).
  if (
    typeof err?.status === "number" &&
    err.status >= 400 &&
    err.status < 500 &&
    err.expose
  )
    return {
      status: err.status,
      message:
        err.status === 413 ? "Zahtev je prevelik." : "Zahtev nije ispravan.",
      internal: false,
    };
  if (typeof err?.code === "string") {
    if (/^2[23]/.test(err.code))
      return {
        status: 422,
        message: "Podaci nisu usklađeni sa pravilima baze.",
        internal: false,
      };
    return { status: 500, message: INTERNAL_MESSAGE, internal: true };
  }
  if (err && err.constructor === Error)
    return {
      status: 422,
      message: err.message || "Greška pri obradi.",
      internal: false,
    };
  return { status: 500, message: INTERNAL_MESSAGE, internal: true };
}
