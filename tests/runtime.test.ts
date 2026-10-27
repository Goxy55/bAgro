import test from "node:test";
import assert from "node:assert/strict";
import { runtimeConfig } from "../server/runtime.js";

test("Javna objava zahteva HTTPS, eksplicitnu adresu i stabilnu tajnu", () => {
  const env = {
    NODE_ENV: "production",
    APP_URL: "https://agro.example.test",
    BETTER_AUTH_SECRET: "synthetic-test-secret-with-at-least-32-characters",
    TRUST_PROXY_HOPS: "1",
  };
  assert.deepEqual(runtimeConfig(env), {
    baseURL: env.APP_URL,
    trustProxyHops: 1,
  });
  assert.throws(() => runtimeConfig({ ...env, APP_URL: undefined }), /APP_URL/);
  assert.throws(
    () => runtimeConfig({ ...env, APP_URL: "http://agro.example.test" }),
    /HTTPS/,
  );
  assert.throws(
    () => runtimeConfig({ ...env, APP_URL: "https://agro.example.test/path" }),
    /APP_URL/,
  );
  assert.throws(
    () => runtimeConfig({ ...env, BETTER_AUTH_SECRET: "short" }),
    /BETTER_AUTH_SECRET/,
  );
  assert.throws(
    () => runtimeConfig({ ...env, TRUST_PROXY_HOPS: "true" }),
    /TRUST_PROXY_HOPS/,
  );
  assert.equal(
    runtimeConfig({ ...env, APP_URL: "http://127.0.0.1:3000" }).baseURL,
    "http://127.0.0.1:3000",
  );
});
