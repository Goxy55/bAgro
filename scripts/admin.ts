import { auth } from "../server/auth.js";
import { db, closeDatabase } from "../server/db.js";
const email = process.env.ADMIN_EMAIL,
  password = process.env.ADMIN_PASSWORD;
if (!email || !password || password.length < 12)
  throw Error(
    "Postavite ADMIN_EMAIL i ADMIN_PASSWORD (najmanje 12 znakova) preko okruženja.",
  );
let user = (await db.query("SELECT id FROM ba_user WHERE email=$1", [email]))
  .rows[0];
if (!user) {
  const result = await auth.api.signUpEmail({
    body: { email, password, name: process.env.ADMIN_NAME || "Administrator" },
  });
  user = result.user;
}
await db.query(
  "INSERT INTO app_admins(user_id) VALUES($1) ON CONFLICT DO NOTHING",
  [user.id],
);
console.log("Administratorska uloga je dodeljena navedenom nalogu.");
await closeDatabase();
