import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { orm } from "./db.js";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomBytes, randomUUID } from "node:crypto";
import nodemailer from "nodemailer";
import { runtime } from "./runtime.js";
let secret = process.env.BETTER_AUTH_SECRET;
if (!secret) {
  if (process.env.NODE_ENV === "production")
    throw Error("BETTER_AUTH_SECRET je obavezan u produkciji.");
  await mkdir("data", { recursive: true });
  try {
    secret = await readFile("data/auth-secret", "utf8");
  } catch {
    secret = randomBytes(32).toString("hex");
    await writeFile("data/auth-secret", secret, { mode: 0o600 });
  }
}
const baseURL = runtime.baseURL;
export const auth = betterAuth({
  database: drizzleAdapter(orm, { provider: "pg" }),
  baseURL,
  secret,
  trustedOrigins: [baseURL],
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 12,
    requireEmailVerification: false,
    sendResetPassword: async ({ user, url }) => {
      if (process.env.SMTP_URL) {
        await nodemailer.createTransport(process.env.SMTP_URL).sendMail({
          from: process.env.MAIL_FROM,
          to: user.email,
          subject: "Agro portal — promena lozinke",
          text: `Link važi ograničeno vreme: ${url}`,
        });
      } else if (process.env.NODE_ENV !== "production") {
        const mailDir = process.env.MAIL_DIR || "data/mail";
        await mkdir(mailDir, { recursive: true, mode: 0o700 });
        await writeFile(
          `${mailDir}/${randomUUID()}.json`,
          JSON.stringify({ to: user.email, url }),
          { mode: 0o600 },
        );
      } else throw Error("SMTP nije podešen. Obratite se administratoru.");
    },
  },
  session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 12 },
  rateLimit: { enabled: true, window: 60, max: 60 },
  advanced: {
    ipAddress: { ipAddressHeaders: ["x-agro-client-ip"] },
    useSecureCookies: baseURL.startsWith("https://"),
  },
});
