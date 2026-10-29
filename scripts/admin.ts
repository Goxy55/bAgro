import { auth } from "../server/auth.js";
import { db, closeDatabase, transaction } from "../server/db.js";
import { randomUUID } from "node:crypto";
const args = process.argv.slice(2),
  existingOnly = args[0] === "--existing";
const email = (existingOnly ? args[1] : process.env.ADMIN_EMAIL)
    ?.trim()
    .toLowerCase(),
  password = process.env.ADMIN_PASSWORD;
try {
  if (args.length && !existingOnly)
    throw Error(
      "Nepoznata opcija. Upotreba: npm run admin -- --existing vas-email",
    );
  if (existingOnly && (!email || args.length !== 2))
    throw Error(
      "Upotreba: npm run admin -- --existing vas-email. Nalog prvo registrujte u aplikaciji.",
    );
  if (!existingOnly && (!email || !password || password.length < 12))
    throw Error(
      "Postavite ADMIN_EMAIL i ADMIN_PASSWORD (najmanje 12 znakova) preko okruženja.",
    );
  let user = (await db.query("SELECT id FROM ba_user WHERE email=$1", [email]))
    .rows[0];
  if (!user) {
    if (existingOnly)
      throw Error(
        "Nalog nije pronađen. Prvo se registrujte kroz aplikaciju, pa ponovite komandu.",
      );
    const result = await auth.api.signUpEmail({
      body: {
        email: email!,
        password: password!,
        name: process.env.ADMIN_NAME || "Administrator",
      },
    });
    user = result.user;
  }
  await transaction(async (tx) => {
    await tx.query(
      "INSERT INTO app_admins(user_id) VALUES($1) ON CONFLICT DO NOTHING",
      [user.id],
    );
    await tx.query(
      "INSERT INTO audit_log(id,user_id,action,entity,metadata) VALUES($1,'operator:admin-cli','admin_grant',$2,$3)",
      [randomUUID(), user.id, JSON.stringify({ existingAccount: existingOnly })],
    );
  });
  console.log("Administratorska uloga je dodeljena navedenom nalogu.");
} finally {
  await closeDatabase();
}
