import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

function readAppSource() {
  return readFileSync(resolve(process.cwd(), "client/src/App.tsx"), "utf8");
}

function loadAuthResolver() {
  const source = readAppSource();
  const start = source.indexOf("const PREVIEW_USER =");
  const end = source.indexOf("function getLocalPreviewAuth");
  assert.notEqual(start, -1, "App preview user should remain present");
  assert.notEqual(end, -1, "App auth resolver should remain ahead of the browser storage helper");

  const executableResolver = source
    .slice(start, end)
    .replaceAll("export ", "")
    .replace("hostname: string, isDevelopment: boolean", "hostname, isDevelopment")
    .replace("}: AuthResolutionOptions): AuthMe", "})")
    .replace("response: Response,", "response,")
    .replace("options: AuthResolutionOptions,", "options,")
    .replace("): Promise<AuthMe>", ")")
    .replace(" as AuthMe", "");

  return new Function(`${executableResolver}; return { resolveAuthResponse };`)();
}

const resolver = loadAuthResolver();
const production = { hostname: "blackops.example.com", isDevelopment: false, localAuth: null };

test("production auth 5xx fails closed instead of creating a preview user", async () => {
  const auth = await resolver.resolveAuthResponse(
    new Response(JSON.stringify({ error: "upstream unavailable" }), {
      status: 503,
      headers: { "content-type": "application/json" },
    }),
    production,
  );

  assert.deepEqual(auth, { authenticated: false, authServiceUnavailable: true });
  assert.equal(auth.user, undefined);
});

test("production non-JSON auth response fails closed", async () => {
  const auth = await resolver.resolveAuthResponse(
    new Response("gateway maintenance", {
      status: 200,
      headers: { "content-type": "text/html" },
    }),
    production,
  );

  assert.deepEqual(auth, { authenticated: false, authServiceUnavailable: true });
});

test("localhost keeps the intentional preview fallback", async () => {
  const auth = await resolver.resolveAuthResponse(
    new Response("gateway maintenance", {
      status: 502,
      headers: { "content-type": "text/plain" },
    }),
    { hostname: "localhost", isDevelopment: false, localAuth: null },
  );

  assert.equal(auth.authenticated, true);
  assert.equal(auth.usingDevFallback, true);
  assert.equal(auth.user?.username, "robert");
});

test("an explicit development build keeps the preview fallback", async () => {
  const auth = await resolver.resolveAuthResponse(
    new Response("not json", {
      status: 200,
      headers: { "content-type": "text/plain" },
    }),
    { hostname: "dev-preview.example.com", isDevelopment: true, localAuth: null },
  );

  assert.equal(auth.authenticated, true);
  assert.equal(auth.usingDevFallback, true);
});

test("the unavailable-auth UI gate precedes protected routing", () => {
  const source = readAppSource();
  const unavailableGate = source.indexOf("if (auth?.authServiceUnavailable)");
  const authenticatedGate = source.indexOf("if (!auth?.authenticated)");
  const protectedRoutes = source.indexOf("<Switch>");

  assert.ok(unavailableGate >= 0);
  assert.ok(unavailableGate < authenticatedGate);
  assert.ok(authenticatedGate < protectedRoutes);
  assert.match(source, /role="alert"/);
});
