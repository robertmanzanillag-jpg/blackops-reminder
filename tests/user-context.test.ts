import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_DEV_USER_ID,
  LOCAL_AUTH_USER_COOKIE_NAME,
  allowsDevUserFallback,
  createSignedLocalAuthCookieValue,
  exceptProductionBatchMutations,
  getSystemUserId,
  isProductionBatchMutationRequest,
  isPublicApiPath,
  isPublicApiRequest,
  onlyProductionBatchMutations,
  requestHasRawQuery,
  requireAppUser,
  sanitizeProductionBatchJsonParserError,
  resolveAuthenticatedUserId,
  resolveCurrentUserId,
} from "../server/user-context";

const productionBatchMutationPath = "/api/ai-media-studio/production-batches/plan_000000000000000000000002/prepare-scripts";

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

test("strict authenticated identity never accepts development request fallbacks", () => {
  withEnv({ NODE_ENV: "development", ALLOW_DEV_USER_FALLBACK: "true" }, () => {
    assert.equal(resolveCurrentUserId(requestWithHeader("dev-bridge-user")), "dev-bridge-user");
    assert.equal(resolveAuthenticatedUserId(requestWithHeader("dev-bridge-user")), null);
    assert.equal(resolveAuthenticatedUserId(requestWithHeader()), null);
  });
});

test("strict authenticated identity accepts session and signed cookie sources", () => {
  withEnv({ NODE_ENV: "development", ALLOW_DEV_USER_FALLBACK: "true", SESSION_SECRET: "strict-session-secret" }, () => {
    assert.equal(
      resolveAuthenticatedUserId(requestWithHeader("ignored-dev-bridge", { session: { userId: "signed-in-user" } })),
      "signed-in-user",
    );

    const cookieValue = createSignedLocalAuthCookieValue("cookie-user");
    assert.ok(cookieValue);
    assert.equal(
      resolveAuthenticatedUserId(requestWithHeader("ignored-dev-bridge", {
        headers: { cookie: `${LOCAL_AUTH_USER_COOKIE_NAME}=${encodeURIComponent(cookieValue)}` },
      })),
      "cookie-user",
    );
  });
});

test("production-batch session wrappers run early only for the two protected mutation templates", () => {
  let middlewareCalls = 0;
  let nextCalls = 0;
  const middleware = (_req: any, _res: any, next: () => void) => { middlewareCalls += 1; next(); };
  const early = onlyProductionBatchMutations(middleware);
  const normal = exceptProductionBatchMutations(middleware);
  const response = {} as any;
  const next = () => { nextCalls += 1; };

  early({ method: "GET", originalUrl: "/clippers/legal/privacy" } as any, response, next);
  assert.deepEqual({ middlewareCalls, nextCalls }, { middlewareCalls: 0, nextCalls: 1 });
  normal({ method: "GET", originalUrl: "/clippers/legal/privacy" } as any, response, next);
  assert.deepEqual({ middlewareCalls, nextCalls }, { middlewareCalls: 1, nextCalls: 2 });

  early({ method: "POST", originalUrl: productionBatchMutationPath } as any, response, next);
  assert.deepEqual({ middlewareCalls, nextCalls }, { middlewareCalls: 2, nextCalls: 3 });
  normal({ method: "POST", originalUrl: productionBatchMutationPath } as any, response, next);
  assert.deepEqual({ middlewareCalls, nextCalls }, { middlewareCalls: 2, nextCalls: 4 });

  assert.equal(isProductionBatchMutationRequest("POST", productionBatchMutationPath.replace("prepare", "approve")), true);
  assert.equal(isProductionBatchMutationRequest("POST", productionBatchMutationPath.toUpperCase()), true);
  assert.equal(isProductionBatchMutationRequest("POST", `${productionBatchMutationPath}/`), true);
  assert.equal(isProductionBatchMutationRequest("GET", productionBatchMutationPath), false);
  assert.equal(isProductionBatchMutationRequest("POST", "/api/auth/login"), false);
  assert.equal(requestHasRawQuery(`${productionBatchMutationPath}?__proto__`), true);
  assert.equal(requestHasRawQuery(productionBatchMutationPath), false);
});

test("production-batch parser sanitizer maps only known body-parser errors", () => {
  const request = { method: "POST", originalUrl: productionBatchMutationPath } as any;
  for (const [type, expectedStatus] of [
    ["entity.parse.failed", 400],
    ["entity.verify.failed", 400],
    ["request.aborted", 400],
    ["request.size.invalid", 400],
    ["entity.too.large", 413],
    ["charset.unsupported", 415],
    ["encoding.unsupported", 415],
  ] as const) {
    let status = 0;
    let body: unknown;
    sanitizeProductionBatchJsonParserError({ type, message: "caller-controlled-detail" }, request, {
      status(value: number) { status = value; return this; },
      json(value: unknown) { body = value; return this; },
    } as any, () => assert.fail(`known parser error ${type} must be handled`));
    assert.equal(status, expectedStatus);
    assert.doesNotMatch(JSON.stringify(body), /caller-controlled-detail|iso-8859-1|encoding/iu);
  }

  for (const code of ["Z_BUF_ERROR", "Z_DATA_ERROR", "Z_NEED_DICT", "Z_STREAM_ERROR"]) {
    let status = 0;
    let body: unknown;
    sanitizeProductionBatchJsonParserError({ code, status: 400, message: "incorrect header check" }, request, {
      status(value: number) { status = value; return this; },
      json(value: unknown) { body = value; return this; },
    } as any, () => assert.fail(`known zlib error ${code} must be handled`));
    assert.equal(status, 400);
    assert.deepEqual(body, { error: "Production batch JSON body is invalid", code: "INVALID_JSON_BODY" });
  }

  const unrelated = { type: "database.failed" };
  let forwarded: unknown;
  sanitizeProductionBatchJsonParserError(unrelated, request, {} as any, (error) => { forwarded = error; });
  assert.equal(forwarded, unrelated);
  const unrelatedZlib = { code: "Z_DATA_ERROR", status: 500 };
  sanitizeProductionBatchJsonParserError(unrelatedZlib, request, {} as any, (error) => { forwarded = error; });
  assert.equal(forwarded, unrelatedZlib);
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
  assert.equal(withEnv({ NODE_ENV: "test", DEFAULT_USER_ID: "<real-user-id>", ALLOW_DEV_USER_FALLBACK: undefined }, () => getSystemUserId()), DEFAULT_DEV_USER_ID);
  assert.throws(
    () => withEnv({ NODE_ENV: "production", DEFAULT_USER_ID: undefined, ALLOW_DEV_USER_FALLBACK: undefined }, () => getSystemUserId()),
    /DEFAULT_USER_ID is required/,
  );
  assert.throws(
    () => withEnv({ NODE_ENV: "production", DEFAULT_USER_ID: "<real-user-id>", ALLOW_DEV_USER_FALLBACK: undefined }, () => getSystemUserId()),
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
  assert.equal(isPublicApiPath("/api/ai-media-studio/webhooks/providers/heygen"), true);
  assert.equal(isPublicApiPath("/api/ai-media-studio/webhooks/providers/heygen/accounts/endpoint_123456789012345"), true);
  assert.equal(isPublicApiPath("/api/ai-media-studio/webhooks/providers/future_provider-2"), true);
  assert.equal(isPublicApiPath("/api/ai-media-studio/webhooks/providers/heygen/accounts/short"), false);
  assert.equal(isPublicApiPath("/api/ai-media-studio/webhooks/providers/heygen/extra"), false);
  assert.equal(isPublicApiPath("/api/ai-media-studio/webhooks/providers/HeyGen"), false);
  assert.equal(isPublicApiPath("/api/ai-media-studio/webhooks/providers/HeyGen/accounts/endpoint_123456789012345"), false);
  assert.equal(isPublicApiPath("/api/ai-media-studio/webhooks/providers"), false);
  assert.equal(isPublicApiPath("/api/ai-media-studio/jobs"), false);
  assert.equal(isPublicApiPath("/api/shopify/oauth/callback"), false);
  assert.equal(isPublicApiPath("/api/shopify/oauth/start"), false);
  assert.equal(isPublicApiPath("/api/shopify/install"), false);
  assert.equal(isPublicApiPath("/api/clippers/oauth/tiktok/callback"), false);
  assert.equal(isPublicApiPath("/api/clippers/oauth/youtube/callback"), false);
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

test("auth middleware only bypasses user auth for exact media provider webhook endpoints", () => {
  withEnv({ NODE_ENV: "production", DEFAULT_USER_ID: undefined, ALLOW_DEV_USER_FALLBACK: undefined }, () => {
    let nextCalled = false;
    requireAppUser(
      requestWithHeader(undefined, {
        path: "/api/ai-media-studio/webhooks/providers/heygen/accounts/endpoint_123456789012345",
        originalUrl: "/api/ai-media-studio/webhooks/providers/heygen/accounts/endpoint_123456789012345?delivery=retry",
      }),
      {} as any,
      () => { nextCalled = true; },
    );

    assert.equal(nextCalled, true);
    nextCalled = false;
    requireAppUser(
      requestWithHeader(undefined, {
        path: "/api/ai-media-studio/webhooks/providers/heygen/accounts/short",
        originalUrl: "/api/ai-media-studio/webhooks/providers/heygen/accounts/short?delivery=retry",
      }),
      {
        status(code: number) {
          assert.equal(code, 401);
          return this;
        },
        json() {},
      } as any,
      () => { nextCalled = true; },
    );
    assert.equal(nextCalled, false);
  });
});

test("auth middleware rejects Clippers OAuth callbacks without owner context", () => {
  withEnv({ NODE_ENV: "production", DEFAULT_USER_ID: undefined, ALLOW_DEV_USER_FALLBACK: undefined }, () => {
    let statusCode: number | null = null;
    let body: unknown = null;
    let nextCalled = false;
    requireAppUser(
      requestWithHeader(undefined, { path: "/api/clippers/oauth/tiktok/callback" }),
      {
        status(code: number) {
          statusCode = code;
          return this;
        },
        json(payload: unknown) {
          body = payload;
          return this;
        },
      } as any,
      () => { nextCalled = true; },
    );

    assert.equal(nextCalled, false);
    assert.equal(statusCode, 401);
    assert.deepEqual(body, { error: "Authentication required", reason: "missing_user_context" });
  });
});

test("public API request classification uses original URL for mounted middleware", () => {
  const mountedClipperCallback = requestWithHeader(undefined, {
    baseUrl: "/api/clippers",
    path: "/oauth/tiktok/callback",
    originalUrl: "/api/clippers/oauth/tiktok/callback?code=oauth-code&state=csrf",
  });

  assert.equal(isPublicApiRequest(mountedClipperCallback), false);
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
