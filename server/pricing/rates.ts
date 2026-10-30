import { randomUUID } from "node:crypto";
import type { Conn } from "../db.js";
import { D } from "../domain.js";

// Only unresolved draft inputs are reconciled. Approved versions and saved
// reports retain their original conversion and provenance.
export async function reconcileDraftRates(conn: Conn, actor: string) {
  const versions = (
    await conn.query(
      "SELECT id,model FROM norm_versions WHERE status='draft' AND EXISTS (SELECT 1 FROM jsonb_array_elements(model->'items') i WHERE i->'priceInput'->>'pendingRate'='true') ORDER BY id FOR UPDATE",
    )
  ).rows;
  let items = 0,
    changedVersions = 0;
  for (const v of versions) {
    const changes: any[] = [];
    for (const item of v.model.items) {
      const p = item.priceInput;
      if (
        !p?.pendingRate ||
        p.currency !== "RSD" ||
        item.price != null ||
        p.eur != null ||
        p.unit !== item.unit
      )
        continue;
      const r = (
        await conn.query(
          "SELECT rate::text,valid_from::text,valid_to::text,source_url FROM exchange_rates WHERE valid_from<=$1 AND valid_to>=$1 ORDER BY valid_from DESC LIMIT 1",
          [p.date],
        )
      ).rows[0];
      if (!r) continue;
      item.price = D(p.amount).div(r.rate).toString();
      p.eur = item.price;
      p.pendingRate = false;
      p.rate = {
        value: r.rate,
        validFrom: r.valid_from,
        validTo: r.valid_to,
        source: r.source_url,
      };
      changes.push({
        itemId: item.id,
        date: p.date,
        amount: p.amount,
        eur: item.price,
        rate: p.rate,
      });
    }
    if (!changes.length) continue;
    await conn.query("UPDATE norm_versions SET model=$1 WHERE id=$2", [
      JSON.stringify(v.model),
      v.id,
    ]);
    await conn.query(
      "INSERT INTO audit_log(id,user_id,action,entity,metadata) VALUES($1,$2,'resolve_draft_rates',$3,$4)",
      [randomUUID(), actor, v.id, JSON.stringify({ changes })],
    );
    items += changes.length;
    changedVersions++;
  }
  return { items, versions: changedVersions };
}
