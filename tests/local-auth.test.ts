import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import express from "express";
import type { User } from "@shared/schema";
import { hashPassword, isLocalAuthEnabled, isLocalAuthRegistrationAllowed, normalizeUsername, verifyPassword } from "../server/local-auth-core";
import { registerLocalAuthRoutes, saveLocalAuthSession } from "../server/local-auth";
import { storage } from "../server/storage";

function withEnv<T>(env: Record<string, string | undefined>, fn: () => T | Promise<T>): T | Promise<T> {
  const previous = new Map<string, string | undefined>();
  for (const key of Object.keys(env)) {
    previous.set(key, process.env[key]);
    if (env[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = env[key];
    }
  }

  const restore = () => {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  };

  try {
    const result = fn();
    if (result && typeof (result as Promise<T>).then === "function") {
      return (result as Promise<T>).finally(restore);
    }
    restore();
    return result;
  } catch (error) {
    restore();
    throw error;
  }
}

test("normalizes usernames for local auth", () => {
  assert.equal(normalizeUsername("  Robert@Example.COM  "), "robert@example.com");
});

test("hashes and verifies local auth passwords", async () => {
  const stored = await hashPassword("correct horse battery staple");

  assert.match(stored, /^scrypt\$/);
  assert.equal(await verifyPassword("correct horse battery staple", stored), true);
  assert.equal(await verifyPassword("wrong password", stored), false);
  assert.equal(await verifyPassword("correct horse battery staple", "plain-text"), false);
});

test("local auth defaults to dev/test and session-backed production", () => {
  assert.equal(withEnv({ NODE_ENV: "development", LOCAL_AUTH_ENABLED: undefined, SESSION_SECRET: undefined }, () => isLocalAuthEnabled()), true);
  assert.equal(withEnv({ NODE_ENV: "production", LOCAL_AUTH_ENABLED: undefined, SESSION_SECRET: undefined }, () => isLocalAuthEnabled()), false);
  assert.equal(withEnv({ NODE_ENV: "production", LOCAL_AUTH_ENABLED: undefined, SESSION_SECRET: "production-session-secret" }, () => isLocalAuthEnabled()), true);
  assert.equal(withEnv({ NODE_ENV: "production", LOCAL_AUTH_ENABLED: "true" }, () => isLocalAuthEnabled()), true);
  assert.equal(withEnv({ NODE_ENV: "production", LOCAL_AUTH_ENABLED: "false", SESSION_SECRET: "production-session-secret" }, () => isLocalAuthEnabled()), false);
});

test("local registration defaults to dev/test and requires opt-in for production", () => {
  assert.equal(withEnv({ NODE_ENV: "test", ALLOW_LOCAL_AUTH_REGISTRATION: undefined }, () => isLocalAuthRegistrationAllowed()), true);
  assert.equal(withEnv({ NODE_ENV: "production", ALLOW_LOCAL_AUTH_REGISTRATION: undefined }, () => isLocalAuthRegistrationAllowed()), false);
  assert.equal(withEnv({ NODE_ENV: "production", ALLOW_LOCAL_AUTH_REGISTRATION: "true" }, () => isLocalAuthRegistrationAllowed()), true);
});

test("local auth session save reports store failures without hanging", async () => {
  await saveLocalAuthSession({
    session: {
      save(callback) {
        callback(new Error("session store unavailable"));
      },
    },
  } as never).then(
    () => assert.fail("expected the session-store error"),
    (error: Error) => assert.match(error.message, /session store unavailable/),
  );
});

test("local auth session save succeeds when the store callback succeeds", async () => {
  await saveLocalAuthSession({
    session: {
      save(callback) {
        callback();
      },
    },
  } as never);
});

test("local auth login falls back to signed cookie when session store save fails", async () => {
  await withEnv({
    NODE_ENV: "production",
    LOCAL_AUTH_ENABLED: "true",
    SESSION_SECRET: "production-session-secret-with-enough-length",
    ALLOW_DEV_USER_FALLBACK: undefined,
  }, async () => {
    const password = "correct horse battery staple";
    const user: User = {
      id: "user-cookie-fallback",
      username: "robert@example.com",
      password: await hashPassword(password),
    };
    const originalGetUserByUsername = storage.getUserByUsername;
    const originalGetUser = storage.getUser;
    const originalCheckPersistentRateLimit = storage.checkPersistentRateLimit;
    (storage as typeof storage & { getUserByUsername: typeof storage.getUserByUsername }).getUserByUsername = async (username: string) => (
      username === user.username ? user : undefined
    );
    (storage as typeof storage & { getUser: typeof storage.getUser }).getUser = async (id: string) => (
      id === user.id ? user : undefined
    );
    (storage as typeof storage & { checkPersistentRateLimit: typeof storage.checkPersistentRateLimit }).checkPersistentRateLimit = async () => ({
      allowed: true,
      remaining: 19,
      resetAt: Date.now() + 60_000,
    });

    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as any).session = {
        userId: undefined,
        save(callback: (error?: Error) => void) {
          callback(new Error("session store unavailable"));
        },
      };
      next();
    });
    registerLocalAuthRoutes(app);

    const server = createServer(app);
    try {
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const address = server.address();
      assert.ok(address && typeof address === "object");
      const origin = `http://127.0.0.1:${address.port}`;

      const loginResponse = await fetch(`${origin}/api/auth/login`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin,
        },
        body: JSON.stringify({ username: user.username, password }),
      });
      const loginPayload = await loginResponse.json();

      assert.equal(loginResponse.status, 200);
      assert.equal(loginPayload.authenticated, true);
      assert.equal(loginPayload.sessionBacked, false);
      assert.equal(loginPayload.cookieBacked, true);

      const setCookie = loginResponse.headers.get("set-cookie") || "";
      assert.match(setCookie, /blackops\.uid=/);
      const authCookie = setCookie.split(";")[0];

      const meResponse = await fetch(`${origin}/api/auth/me`, {
        headers: { cookie: authCookie },
      });
      const mePayload = await meResponse.json();

      assert.equal(meResponse.status, 200);
      assert.equal(mePayload.authenticated, true);
      assert.equal(mePayload.sessionBacked, false);
      assert.equal(mePayload.cookieBacked, true);
      assert.deepEqual(mePayload.user, { id: user.id, username: user.username });
    } finally {
      storage.getUserByUsername = originalGetUserByUsername;
      storage.getUser = originalGetUser;
      storage.checkPersistentRateLimit = originalCheckPersistentRateLimit;
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
  });
});
