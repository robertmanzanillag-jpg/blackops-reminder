import assert from "node:assert/strict";
import test from "node:test";
import { resolveSessionRuntimeSettings } from "../server/session-config-core";

test("disables session auth in production without SESSION_SECRET", () => {
  const settings = resolveSessionRuntimeSettings({
    NODE_ENV: "production",
    SESSION_SECRET: undefined,
    DATABASE_URL: "postgres://example",
  } as NodeJS.ProcessEnv);

  assert.equal(settings.enabled, false);
  assert.equal(settings.storeKind, "disabled");
});

test("uses Postgres session store when DATABASE_URL is configured", () => {
  const settings = resolveSessionRuntimeSettings({
    NODE_ENV: "production",
    SESSION_SECRET: "secret",
    DATABASE_URL: "postgres://example",
  } as NodeJS.ProcessEnv);

  assert.equal(settings.enabled, true);
  assert.equal(settings.storeKind, "postgres");
  assert.equal(settings.secureCookie, true);
});

test("uses memory session store for local development without DATABASE_URL", () => {
  const settings = resolveSessionRuntimeSettings({
    NODE_ENV: "development",
    SESSION_SECRET: undefined,
    DATABASE_URL: undefined,
  } as NodeJS.ProcessEnv);

  assert.equal(settings.enabled, true);
  assert.equal(settings.storeKind, "memory");
  assert.equal(settings.secureCookie, false);
});
