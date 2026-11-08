import { Router } from "express";
import { z } from "zod";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import nodemailer from "nodemailer";
import { db, transaction, type Conn } from "./db.js";
import { auth } from "./auth.js";
import { runtime } from "./runtime.js";
import { UserError } from "./errors.js";
import { rateLimit } from "./rate-limit.js";
import { id } from "./validation.js";

export const INVITE_DAYS = 7;
export const ANONYMIZED_FARM = "Obrisano gazdinstvo";
export const hashToken = (t: string) =>
  createHash("sha256").update(t).digest("hex");

async function audit(
  conn: Conn,
  user: string,
  farm: string | null,
  action: string,
  entity: string,
  metadata: any = {},
) {
  await conn.query(
    "INSERT INTO audit_log(id,farm_id,user_id,action,entity,metadata) VALUES($1,$2,$3,$4,$5,$6)",
    [randomUUID(), farm, user, action, entity, JSON.stringify(metadata)],
  );
}
function owner(req: any) {
  if (!req.farm) throw new UserError("Najpre otvorite gazdinstvo.");
  if (req.farm.role !== "owner")
    throw new UserError("Ovu radnju može da izvrši samo vlasnik gazdinstva.");
  return req.farm.id as string;
}

/** Šalje pozivnicu; bez SMTP-a vlasnik link prosleđuje sam (prikazuje se u aplikaciji). */
async function deliverInvite(to: string, url: string, farm: string) {
  const text = `Pozvani ste na gazdinstvo „${farm}“ u Agro portalu. Link važi ${INVITE_DAYS} dana: ${url}`;
  if (process.env.SMTP_URL) {
    await nodemailer.createTransport(process.env.SMTP_URL).sendMail({
      from: process.env.MAIL_FROM,
      to,
      subject: "Agro portal — poziv na gazdinstvo",
      text,
    });
    return true;
  }
  if (process.env.NODE_ENV !== "production") {
    const dir = process.env.MAIL_DIR || "data/mail";
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await writeFile(
      `${dir}/${randomUUID()}.json`,
      JSON.stringify({ to, url }),
      { mode: 0o600 },
    );
  }
  return false;
}

export const members = Router();
const roleSchema = z.enum(["member", "viewer"]);

members.get("/members", async (req: any, res) => {
  if (!req.farm) throw new UserError("Najpre otvorite gazdinstvo.");
  const rows = (
    await db.query(
      `SELECT u.id AS user_id,u.name,u.email,m.role FROM memberships m
       JOIN ba_user u ON u.id=m.user_id WHERE m.farm_id=$1
       ORDER BY (m.role='owner') DESC,u.name`,
      [req.farm.id],
    )
  ).rows;
  const invites =
    req.farm.role === "owner"
      ? (
          await db.query(
            `SELECT id,email,role,created_at,expires_at,(expires_at<now()) AS expired
             FROM farm_invites WHERE farm_id=$1 AND accepted_at IS NULL ORDER BY created_at`,
            [req.farm.id],
          )
        ).rows
      : [];
  res.json({ you: req.user.id, role: req.farm.role, members: rows, invites });
});

members.post("/invites", async (req: any, res) => {
  const f = owner(req);
  const b = z
    .object({ email: z.email().max(254), role: roleSchema })
    .parse(req.body);
  const email = b.email.trim().toLowerCase();
  const existing = (
    await db.query(
      `SELECT 1 FROM memberships m JOIN ba_user u ON u.id=m.user_id
       WHERE m.farm_id=$1 AND lower(u.email)=$2`,
      [f, email],
    )
  ).rows.length;
  if (existing) throw new UserError("Ta osoba je već član gazdinstva.");
  const token = randomBytes(32).toString("base64url");
  const inviteId = randomUUID();
  await transaction(async (tx) => {
    await tx.query(
      "DELETE FROM farm_invites WHERE farm_id=$1 AND lower(email)=$2 AND accepted_at IS NULL",
      [f, email],
    );
    await tx.query(
      `INSERT INTO farm_invites(id,farm_id,email,role,token_hash,invited_by,expires_at)
       VALUES($1,$2,$3,$4,$5,$6,now()+make_interval(days=>$7))`,
      [inviteId, f, email, b.role, hashToken(token), req.user.id, INVITE_DAYS],
    );
    await audit(tx, req.user.id, f, "invite", inviteId, { role: b.role });
  });
  const url = `${runtime.baseURL}/?invite=${token}`;
  let emailed = false;
  try {
    emailed = await deliverInvite(email, url, req.farm.name);
  } catch (e) {
    console.error("Slanje pozivnice nije uspelo:", (e as Error).message);
  }
  // Link se vraća samo vlasniku koji je pozivnicu napravio.
  res.json({ id: inviteId, url, emailed, expiresInDays: INVITE_DAYS });
});

members.delete("/invites/:id", async (req: any, res) => {
  const f = owner(req);
  const r = await db.query(
    "DELETE FROM farm_invites WHERE id=$1 AND farm_id=$2 AND accepted_at IS NULL RETURNING id",
    [id.parse(req.params.id), f],
  );
  if (!r.rows.length) throw new UserError("Pozivnica nije pronađena.");
  await audit(db, req.user.id, f, "invite_revoked", req.params.id);
  res.json({ ok: true });
});

members.post(
  "/invites/accept",
  rateLimit({ windowMs: 60_000, max: 10 }),
  async (req: any, res) => {
    const { token } = z
      .object({ token: z.string().min(20).max(200) })
      .parse(req.body);
    const farmId = await transaction(async (tx) => {
      const inv = (
        await tx.query(
          `SELECT * FROM farm_invites WHERE token_hash=$1 AND accepted_at IS NULL
           AND expires_at>now() FOR UPDATE`,
          [hashToken(token)],
        )
      ).rows[0];
      if (!inv || inv.email.toLowerCase() !== req.user.email.toLowerCase())
        throw new UserError(
          "Pozivnica nije važeća, istekla je ili je namenjena drugoj email adresi.",
        );
      await tx.query(
        "INSERT INTO memberships(farm_id,user_id,role) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
        [inv.farm_id, req.user.id, inv.role],
      );
      await tx.query("UPDATE farm_invites SET accepted_at=now() WHERE id=$1", [
        inv.id,
      ]);
      await audit(tx, req.user.id, inv.farm_id, "invite_accepted", inv.id, {
        role: inv.role,
      });
      return inv.farm_id as string;
    });
    res.json({ farmId });
  },
);

members.patch("/members/:userId", async (req: any, res) => {
  const f = owner(req);
  const { role } = z.object({ role: roleSchema }).parse(req.body);
  const r = await db.query(
    "UPDATE memberships SET role=$1 WHERE farm_id=$2 AND user_id=$3 AND role<>'owner' RETURNING user_id",
    [role, f, req.params.userId],
  );
  if (!r.rows.length) throw new UserError("Član nije pronađen.");
  await audit(db, req.user.id, f, "member_role", req.params.userId, { role });
  res.json({ ok: true });
});

members.delete("/members/:userId", async (req: any, res) => {
  if (!req.farm) throw new UserError("Najpre otvorite gazdinstvo.");
  const self = req.params.userId === req.user.id;
  if (!self) owner(req);
  const r = await db.query(
    "DELETE FROM memberships WHERE farm_id=$1 AND user_id=$2 AND role<>'owner' RETURNING user_id",
    [req.farm.id, req.params.userId],
  );
  if (!r.rows.length)
    throw new UserError(
      self
        ? "Vlasnik ne može napustiti gazdinstvo; obrišite nalog ili uklonite članove."
        : "Član nije pronađen.",
    );
  await audit(
    db,
    req.user.id,
    req.farm.id,
    "member_removed",
    req.params.userId,
  );
  res.json({ ok: true });
});

// ---- Nalog: izvoz podataka i anonimizacija ----
export const account = Router();
const sensitive = rateLimit({ windowMs: 60_000, max: 5 });

/** Tabele sa kolonom farm_id, otkrivene iz šeme da novi moduli ne ostanu van izvoza. */
async function farmTables(conn: Conn) {
  return (
    await conn.query(
      `SELECT DISTINCT table_name FROM information_schema.columns
       WHERE table_schema='public' AND column_name='farm_id'
       AND table_name NOT IN ('audit_log','memberships','farm_invites')
       ORDER BY table_name`,
    )
  ).rows.map((r) => r.table_name as string);
}

export async function personalData(conn: Conn, userId: string) {
  const user = (
    await conn.query(
      `SELECT id,name,email,"createdAt" AS created_at FROM ba_user WHERE id=$1`,
      [userId],
    )
  ).rows[0];
  const memberships = (
    await conn.query(
      `SELECT f.id AS farm_id,f.name AS farm_name,m.role FROM memberships m
       JOIN farms f ON f.id=m.farm_id WHERE m.user_id=$1 ORDER BY f.name`,
      [userId],
    )
  ).rows;
  const tables = await farmTables(conn);
  const farms: Record<string, any> = {};
  for (const m of memberships.filter((m) => m.role === "owner")) {
    const data: Record<string, any[]> = {};
    for (const t of tables)
      data[t] = (
        await conn.query(
          `SELECT * FROM "${t.replace(/"/g, '""')}" WHERE farm_id=$1`,
          [m.farm_id],
        )
      ).rows;
    data.farms = (
      await conn.query("SELECT * FROM farms WHERE id=$1", [m.farm_id])
    ).rows;
    data.members = (
      await conn.query(
        `SELECT u.name,u.email,m.role FROM memberships m JOIN ba_user u ON u.id=m.user_id WHERE m.farm_id=$1`,
        [m.farm_id],
      )
    ).rows;
    farms[m.farm_id] = data;
  }
  const activity = (
    await conn.query(
      "SELECT action,entity,at,metadata FROM audit_log WHERE user_id=$1 ORDER BY at DESC LIMIT 5000",
      [userId],
    )
  ).rows;
  return {
    exportedAt: new Date().toISOString(),
    note: "Podaci vašeg naloga i gazdinstava čiji ste vlasnik. Za gazdinstva gde ste član izvozi se samo članstvo.",
    user,
    memberships,
    farms,
    activity,
  };
}

account.get("/export", sensitive, async (req: any, res) => {
  const data = await personalData(db, req.user.id);
  await audit(db, req.user.id, null, "account_export", req.user.id);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    'attachment; filename="agro-moji-podaci.json"',
  );
  res.send(JSON.stringify(data, null, 2));
});

/** Anonimizacija: nalog i lični tekstovi se brišu, poslovni brojevi ostaju bez veze sa osobom. */
export async function anonymizeUser(tx: Conn, userId: string) {
  const user = (
    await tx.query("SELECT email FROM ba_user WHERE id=$1", [userId])
  ).rows[0];
  if (!user) throw new UserError("Nalog nije pronađen.");
  const owned = (
    await tx.query(
      "SELECT farm_id FROM memberships WHERE user_id=$1 AND role='owner'",
      [userId],
    )
  ).rows.map((r) => r.farm_id as string);
  for (const f of owned) {
    await tx.query("UPDATE farms SET name=$2,municipality='' WHERE id=$1", [
      f,
      ANONYMIZED_FARM,
    ]);
    await tx.query(
      "UPDATE production_periods SET details=details-'note' WHERE farm_id=$1",
      [f],
    );
    await tx.query(
      "UPDATE business_events SET details=details-'note'-'counterparty' WHERE farm_id=$1",
      [f],
    );
    await tx.query("UPDATE payments SET note=NULL WHERE farm_id=$1", [f]);
    await tx.query(
      "UPDATE inventory_movements SET note=NULL WHERE farm_id=$1",
      [f],
    );
    await tx.query("UPDATE wip_observations SET note='' WHERE farm_id=$1", [f]);
    for (const t of ["report_snapshots", "wip_snapshots"])
      await tx.query(
        `UPDATE ${t} SET payload=jsonb_set(jsonb_set(payload,'{farm,name}',to_jsonb($2::text)),'{farm,municipality}','""')
         WHERE farm_id=$1 AND payload->'farm' IS NOT NULL`,
        [f, ANONYMIZED_FARM],
      );
    await tx.query("DELETE FROM farm_invites WHERE farm_id=$1", [f]);
  }
  await tx.query("DELETE FROM memberships WHERE user_id=$1 AND role<>'owner'", [
    userId,
  ]);
  await tx.query(
    "DELETE FROM farm_invites WHERE lower(email)=lower($1) OR invited_by=$2",
    [user.email, userId],
  );
  await tx.query(`DELETE FROM ba_session WHERE "userId"=$1`, [userId]);
  await tx.query(`DELETE FROM ba_account WHERE "userId"=$1`, [userId]);
  await tx.query(
    "DELETE FROM ba_verification WHERE lower(identifier)=lower($1)",
    [user.email],
  );
  await tx.query(
    `UPDATE ba_user SET name='Obrisan korisnik',email='deleted-'||id||'@deleted.invalid',
     image=NULL,"emailVerified"=false,"updatedAt"=now() WHERE id=$1`,
    [userId],
  );
  await audit(tx, userId, null, "account_anonymized", userId, {
    farms: owned.length,
  });
}

account.delete("/", sensitive, async (req: any, res) => {
  const b = z
    .object({
      password: z.string().min(1).max(200),
      confirm: z.literal("OBRIŠI"),
    })
    .parse(req.body);
  if (req.admin)
    throw new UserError(
      "Administratorski nalog ne može se obrisati ovde. Prvo ukinite administratorsku ulogu.",
    );
  const blocked = (
    await db.query(
      `SELECT f.name FROM memberships o JOIN farms f ON f.id=o.farm_id
       WHERE o.user_id=$1 AND o.role='owner'
       AND EXISTS(SELECT 1 FROM memberships x WHERE x.farm_id=o.farm_id AND x.user_id<>$1)`,
      [req.user.id],
    )
  ).rows;
  if (blocked.length)
    throw new UserError(
      `Pre brisanja naloga uklonite ostale članove sa gazdinstva: ${blocked.map((r) => r.name).join(", ")}.`,
    );
  try {
    await auth.api.signInEmail({
      body: { email: req.user.email, password: b.password },
    });
  } catch {
    throw new UserError("Lozinka nije ispravna.");
  }
  await transaction((tx) => anonymizeUser(tx, req.user.id));
  res.json({ ok: true });
});
