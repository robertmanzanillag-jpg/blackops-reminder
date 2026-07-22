import assert from "node:assert/strict";
import test from "node:test";
import {
  createStrictMoneyActionRequestGuard,
  StrictMoneyActionRequestError,
  type StrictMoneyActionHttpRequest,
} from "../server/ai-media-studio/strict-money-action-request";

interface TestRequest extends StrictMoneyActionHttpRequest {
  method: string;
  headers: Record<string, string>;
  session?: { userId?: string };
  body?: unknown;
}

const canonicalOrigin = "https://studio.kong.example:8443";

function request(overrides: Partial<TestRequest> = {}): TestRequest {
  const headers = {
    "content-type": "application/json; charset=utf-8",
    origin: canonicalOrigin,
    "sec-fetch-site": "same-origin",
    ...(overrides.headers ?? {}),
  };
  return {
    method: "POST",
    session: { userId: "owner-a" },
    ...overrides,
    headers,
    get(name) { return this.headers[name.toLowerCase()]; },
  };
}

function guard() {
  return createStrictMoneyActionRequestGuard<TestRequest>({
    canonicalAppUrl: `${canonicalOrigin}/`,
    resolveAuthenticatedUserId(req) {
      return req.session?.userId ?? null;
    },
  });
}

function rejectsWith(code: StrictMoneyActionRequestError["code"], input: TestRequest): void {
  assert.throws(() => guard().authorize(input), (error: unknown) =>
    error instanceof StrictMoneyActionRequestError && error.code === code);
}

test("strict money guard accepts only an authenticated same-origin POST JSON browser request", () => {
  const principal = guard().authorize(request());
  assert.equal(principal.authenticatedUserId, "owner-a");
  assert.equal(principal.canonicalOrigin, canonicalOrigin);
  assert.equal(principal.transport, "same-origin-browser");
  assert.equal(Object.isFrozen(principal), true);
});

test("strict money guard rejects scheme, subdomain and port origin mismatches", () => {
  for (const origin of [
    "http://studio.kong.example:8443",
    "https://attacker.studio.kong.example:8443",
    "https://kong.example:8443",
    "https://studio.kong.example",
    "https://studio.kong.example:9443",
  ]) rejectsWith("CROSS_ORIGIN_DENIED", request({ headers: { origin } }));
});

test("strict money guard requires Origin and exact same-origin browser fetch metadata", () => {
  const missingOrigin = request();
  delete missingOrigin.headers.origin;
  rejectsWith("ORIGIN_REQUIRED", missingOrigin);

  for (const fetchSite of ["same-site", "cross-site", "none", ""] as const) {
    rejectsWith("CROSS_ORIGIN_DENIED", request({ headers: { "sec-fetch-site": fetchSite } }));
  }
  const missingFetchSite = request();
  delete missingFetchSite.headers["sec-fetch-site"];
  rejectsWith("CROSS_ORIGIN_DENIED", missingFetchSite);
});

test("strict money guard requires POST and the application/json media type", () => {
  rejectsWith("METHOD_NOT_ALLOWED", request({ method: "GET" }));
  rejectsWith("METHOD_NOT_ALLOWED", request({ method: "post" }));
  for (const contentType of [
    "text/plain",
    "application/x-www-form-urlencoded",
    "multipart/form-data",
    "application/merge-patch+json",
    "",
  ]) rejectsWith("JSON_REQUIRED", request({ headers: { "content-type": contentType } }));

  assert.equal(guard().authorize(request({ headers: { "content-type": "Application/JSON ; charset=UTF-8" } }))
    .authenticatedUserId, "owner-a");
});

test("x-user and body principal fallbacks cannot replace a real authenticated session", () => {
  const headerFallback = request({
    session: undefined,
    headers: { "x-user-id": "attacker", "x-test-user": "attacker" },
    body: { principal: "attacker", userId: "attacker" },
  });
  rejectsWith("UNAUTHENTICATED", headerFallback);

  const malformedSession = request({ session: { userId: " owner-a " } });
  rejectsWith("UNAUTHENTICATED", malformedSession);
});

test("canonical authority is explicit server configuration and never Host or forwarded-host", () => {
  const spoofed = request({
    headers: {
      origin: "https://attacker.example",
      host: "attacker.example",
      "x-forwarded-host": "studio.kong.example:8443",
      "x-forwarded-proto": "https",
    },
  });
  rejectsWith("CROSS_ORIGIN_DENIED", spoofed);

  for (const canonicalAppUrl of [
    "",
    "studio.kong.example",
    "ftp://studio.kong.example",
    "https://user:password@studio.kong.example",
    "https://studio.kong.example/app",
    "https://studio.kong.example?host=attacker",
    " https://studio.kong.example",
    "http://studio.kong.example",
  ]) {
    assert.throws(() => createStrictMoneyActionRequestGuard<TestRequest>({
      canonicalAppUrl,
      resolveAuthenticatedUserId: () => "owner-a",
    }), (error: unknown) => error instanceof StrictMoneyActionRequestError
      && error.code === "INVALID_CONFIGURATION");
  }
});

test("insecure origins are restricted to an explicit local/test loopback escape hatch", () => {
  for (const canonicalAppUrl of [
    "http://localhost:5010",
    "http://127.0.0.1:5010",
    "http://[::1]:5010",
  ]) {
    assert.throws(() => createStrictMoneyActionRequestGuard<TestRequest>({
      canonicalAppUrl,
      resolveAuthenticatedUserId: () => "owner-a",
    }), (error: unknown) => error instanceof StrictMoneyActionRequestError
      && error.code === "INVALID_CONFIGURATION");

    const localGuard = createStrictMoneyActionRequestGuard<TestRequest>({
      canonicalAppUrl,
      allowInsecureLoopback: true,
      resolveAuthenticatedUserId: () => "owner-a",
    });
    const localRequest = request({ headers: { origin: new URL(canonicalAppUrl).origin } });
    assert.equal(localGuard.authorize(localRequest).authenticatedUserId, "owner-a");
  }

  assert.throws(() => createStrictMoneyActionRequestGuard<TestRequest>({
    canonicalAppUrl: "http://studio.kong.example",
    allowInsecureLoopback: true,
    resolveAuthenticatedUserId: () => "owner-a",
  }), (error: unknown) => error instanceof StrictMoneyActionRequestError
    && error.code === "INVALID_CONFIGURATION");
});

test("non-browser clients remain denied without a separate server-owned capability boundary", () => {
  const nonBrowser = request();
  delete nonBrowser.headers.origin;
  delete nonBrowser.headers["sec-fetch-site"];
  rejectsWith("ORIGIN_REQUIRED", nonBrowser);
});
