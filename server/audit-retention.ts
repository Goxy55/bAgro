import { db } from "./db.js";

const DAY = 24 * 60 * 60 * 1000;

/** AUDIT_RETENTION_DAYS: broj dana čuvanja (podrazumevano 365); 0 isključuje brisanje. */
export function auditRetentionDays(env: NodeJS.ProcessEnv = process.env) {
  const raw = env.AUDIT_RETENTION_DAYS;
  if (raw === undefined || raw === "") return 365;
  if (!/^\d{1,5}$/.test(raw))
    throw Error(
      "AUDIT_RETENTION_DAYS mora biti ceo broj dana (0 = bez brisanja).",
    );
  return Number(raw);
}

/** Briše audit zapise starije od roka, u serijama da ne zaključa tabelu. */
export async function purgeAudit(days: number): Promise<number> {
  if (days <= 0) return 0;
  let total = 0;
  for (;;) {
    const r: any = await db.query(
      `WITH old AS (
         SELECT id FROM audit_log
         WHERE at < now() - make_interval(days => $1) LIMIT 5000
       ) DELETE FROM audit_log WHERE id IN (SELECT id FROM old) RETURNING id`,
      [days],
    );
    total += r.rows.length;
    if (r.rows.length < 5000) return total;
  }
}

export function startAuditRetention(days = auditRetentionDays()) {
  if (days <= 0) return () => {};
  const run = () =>
    purgeAudit(days)
      .then(
        (n) =>
          n &&
          console.log(`Audit: obrisano ${n} zapisa starijih od ${days} dana.`),
      )
      .catch((e) => console.error("Audit retencija nije uspela:", e.message));
  void run();
  const timer = setInterval(run, DAY);
  timer.unref();
  return () => clearInterval(timer);
}
