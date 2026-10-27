export function runtimeConfig(env: NodeJS.ProcessEnv = process.env) {
  const production = env.NODE_ENV === "production";
  if (production && !env.APP_URL)
    throw Error("APP_URL je obavezan u produkciji.");
  const baseURL = env.APP_URL || "http://localhost:3000";
  const url = new URL(baseURL);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.origin !== baseURL ||
    url.username ||
    url.password
  )
    throw Error(
      "APP_URL mora biti puna adresa bez putanje i završne kose crte.",
    );
  if (
    production &&
    url.protocol !== "https:" &&
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
  )
    throw Error("Javno produkciono okruženje zahteva HTTPS APP_URL.");
  if (production && (env.BETTER_AUTH_SECRET?.length || 0) < 32)
    throw Error("BETTER_AUTH_SECRET mora imati najmanje 32 nasumična znaka.");
  const hops = env.TRUST_PROXY_HOPS || "0";
  if (!/^[0-5]$/.test(hops))
    throw Error("TRUST_PROXY_HOPS mora biti broj od 0 do 5.");
  return { baseURL, trustProxyHops: Number(hops) };
}

export const runtime = runtimeConfig();
