import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_DEV_USER_ID,
  LOCAL_AUTH_USER_COOKIE_NAME,
  allowsDevUserFallback,
  createSignedLocalAuthCookieValue,
  getSystemUserId,
  isPublicApiPath,
  isPublicApiRequest,
  requireAppUser,
  resolveCurrentUserId,
} from "../server/user-context";

function requestWithHeader(headerValue?: string, extras: Record<string, unknown> = {}) {
  return {
    ...extras,
    header: (name: string) => {
      if (name.toLowerCase() !== "x-user-id") return undefined;
      return headerValue;
    },
  } as any;
}

function withEnv<T>(env: Record<string, string | undefined>, fn: () => T): T {
  const previous = new Map<string, string | undefined>();
  for (const key of Object.keys(env)) {
    previous.set(key, process.env[key]);
    if (env[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = env[key];
    }
  }

  try {
    return fn();
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

test("resolves user id from provider-neutral request user", () => {
  const userId = withEnv({ NODE_ENV: "production", DEFAULT_USER_ID: undefined, ALLOW_DEV_USER_FALLBACK: undefined }, () =>
    resolveCurrentUserId(requestWithHeader(undefined, { user: { id: "user-from-passport" } })),
  );

  assert.equal(userId, "user-from-passport");
});

test("resolves user id from session before dev fallback", () => {
  const userId = withEnv({ NODE_ENV: "production", DEFAULT_USER_ID: undefined, ALLOW_DEV_USER_FALLBACK: undefined }, () =>
    resolveCurrentUserId(requestWithHeader(undefined, { session: { userId: "user-from-session" } })),
  );

  assert.equal(userId, "user-from-session");
});

test("resolves user id from signed local auth cookie", () => {
  const userId = withEnv({ NODE_ENV: "production", SESSION_SECRET: "production-session-secret", DEFAULT_USER_ID: undefined, ALLOW_DEV_USER_FALLBACK: undefined }, () => {
    const cookieValue = createSignedLocalAuthCookieValue("user-from-cookie");
    assert.ok(cookieValue);
    return resolveCurrentUserId(requestWithHeader(undefined, {
      headers: { cookie: `${LOCAL_AUTH_USER_COOKIE_NAME}=${encodeURIComponent(cookieValue)}` },
    }));
  });

  assert.equal(userId, "user-from-cookie");
});

test("rejects tampered signed local auth cookies", () => {
  const userId = withEnv({ NODE_ENV: "production", SESSION_SECRET: "production-session-secret", DEFAULT_USER_ID: undefined, ALLOW_DEV_USER_FALLBACK: undefined }, () => {
    const cookieValue = createSignedLocalAuthCookieValue("user-from-cookie");
    assert.ok(cookieValue);
    const parts = cookieValue.split(".");
    parts[1] = Buffer.from("evil-from-cookie", "utf8").toString("base64url");
    const tamperedCookie = parts.join(".");
    return resolveCurrentUserId(requestWithHeader(undefined, {
      headers: { cookie: `${LOCAL_AUTH_USER_COOKIE_NAME}=${encodeURIComponent(tamperedCookie)}` },
    }));
  });

  assert.equal(userId, null);
});

test("allows x-user-id as a development bridge only when request fallbacks are enabled", () => {
  const userId = withEnv({ NODE_ENV: "development", DEFAULT_USER_ID: undefined, ALLOW_DEV_USER_FALLBACK: undefined }, () =>
    resolveCurrentUserId(requestWithHeader("user-from-header")),
  );

  assert.equal(userId, "user-from-header");
  assert.equal(withEnv({ NODE_ENV: "production", DEFAULT_USER_ID: undefined, ALLOW_DEV_USER_FALLBACK: undefined }, () =>
    resolveCurrentUserId(requestWithHeader("spoofed-user")),
  ), null);
});

test("does not use explicit DEFAULT_USER_ID as request authentication", () => {
  const userId = withEnv({ NODE_ENV: "production", DEFAULT_USER_ID: "configured-user", ALLOW_DEV_USER_FALLBACK: undefined }, () =>
    resolveCurrentUserId(requestWithHeader()),
  );

  assert.equal(userId, null);
});

test("limits mock fallback to dev/test unless explicitly enabled", () => {
  assert.equal(withEnv({ NODE_ENV: "development", DEFAULT_USER_ID: undefined, ALLOW_DEV_USER_FALLBACK: undefined }, () => allowsDevUserFallback()), true);
  assert.equal(withEnv({ NODE_ENV: "production", DEFAULT_USER_ID: undefined, ALLOW_DEV_USER_FALLBACK: undefined }, () => allowsDevUserFallback()), false);
  assert.equal(withEnv({ NODE_ENV: "production", DEFAULT_USER_ID: undefined, ALLOW_DEV_USER_FALLBACK: "true" }, () => resolveCurrentUserId(requestWithHeader())), DEFAULT_DEV_USER_ID);
  assert.equal(withEnv({ NODE_ENV: "production", DEFAULT_USER_ID: undefined, ALLOW_DEV_USER_FALLBACK: undefined }, () => resolveCurrentUserId(requestWithHeader())), null);
});

test("requires DEFAULT_USER_ID for system jobs when dev fallback is disabled", () => {
  assert.equal(withEnv({ NODE_ENV: "test", DEFAULT_USER_ID: undefined, ALLOW_DEV_USER_FALLBACK: undefined }, () => getSystemUserId()), DEFAULT_DEV_USER_ID);
  assert.equal(withEnv({ NODE_ENV: "production", DEFAULT_USER_ID: "system-user", ALLOW_DEV_USER_FALLBACK: undefined }, () => getSystemUserId()), "system-user");
  assert.throws(
    () => withEnv({ NODE_ENV: "production", DEFAULT_USER_ID: undefined, ALLOW_DEV_USER_FALLBACK: undefined }, () => getSystemUserId()),
    /DEFAULT_USER_ID is required/,
  );
});

test("classifies public callback and webhook paths", () => {
  assert.equal(isPublicApiPath("/api/auth/me"), true);
  assert.equal(isPublicApiPath("/api/auth/login"), true);
  assert.equal(isPublicApiPath("/api/auth/register"), true);
  assert.equal(isPublicApiPath("/api/auth/logout"), true);
  assert.equal(isPublicApiPath("/api/telegram/webhook"), true);
  assert.equal(isPublicApiPath("/api/google-drive/oauth/callback"), true);
  assert.equal(isPublicApiPath("/api/canva/oauth/callback"), true);
  assert.equal(isPublicApiPath("/api/zoho/callback"), true);
  assert.equal(isPublicApiPath("/api/clippers/oauth/tiktok/callback"), true);
  assert.equal(isPublicApiPath("/api/clippers/oauth/youtube/callback"), true);
  assert.equal(isPublicApiPath("/api/clippers/oauth/tiktok/start"), false);
  assert.equal(isPublicApiPath("/api/tasks"), false);
});

test("auth middleware allows public API callbacks without user context", () => {
  withEnv({ NODE_ENV: "production", DEFAULT_USER_ID: undefined, ALLOW_DEV_USER_FALLBACK: undefined }, () => {
    let nextCalled = false;
    requireAppUser(
      requestWithHeader(undefined, { path: "/api/google-drive/oauth/callback" }),
      {} as any,
      () => { nextCalled = true; },
    );

    assert.equal(nextCalled, true);
  });
});

test("auth middleware allows dynamic Clippers OAuth callbacks without user context", () => {
  withEnv({ NODE_ENV: "production", DEFAULT_USER_ID: undefined, ALLOW_DEV_USER_FALLBACK: undefined }, () => {
    let nextCalled = false;
    requireAppUser(
      requestWithHeader(undefined, { path: "/api/clippers/oauth/tiktok/callback" }),
      {} as any,
      () => { nextCalled = true; },
    );

    assert.equal(nextCalled, true);
  });
});

test("public API request classification uses original URL for mounted middleware", () => {
  const mountedClipperCallback = requestWithHeader(undefined, {
    baseUrl: "/api/clippers",
    path: "/oauth/tiktok/callback",
    originalUrl: "/api/clippers/oauth/tiktok/callback?code=oauth-code&state=csrf",
  });

  assert.equal(isPublicApiRequest(mountedClipperCallback), true);
});

test("auth middleware rejects protected APIs without user context", () => {
  withEnv({ NODE_ENV: "production", DEFAULT_USER_ID: undefined, ALLOW_DEV_USER_FALLBACK: undefined }, () => {
    let statusCode: number | null = null;
    let body: unknown = null;
    let nextCalled = false;
    const res = {
      status(code: number) {
        statusCode = code;
        return this;
      },
      json(payload: unknown) {
        body = payload;
      },
    };

    requireAppUser(
      requestWithHeader(undefined, { path: "/api/tasks" }),
      res as any,
      () => { nextCalled = true; },
    );

    assert.equal(nextCalled, false);
    assert.equal(statusCode, 401);
    assert.deepEqual(body, { error: "Authentication required", reason: "missing_user_context" });
  });
});
