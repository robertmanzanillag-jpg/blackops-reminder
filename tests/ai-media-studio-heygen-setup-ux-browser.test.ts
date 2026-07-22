import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import react from "@vitejs/plugin-react";
import { chromium, type Page } from "playwright";
import { createServer as createViteServer, type Plugin } from "vite";

const repositoryRoot = process.cwd();
const navigationEntry = path.resolve(repositoryRoot, "tests/fixtures/ai-media-studio-heygen-navigation-browser-entry.tsx");
const invalidationEntry = path.resolve(repositoryRoot, "tests/fixtures/ai-media-studio-heygen-roster-invalidation-browser-entry.tsx");
const virtualHooksId = "\0virtual:heygen-navigation-hooks";

const readyReadiness = {
  version: 1,
  source: "postgresql_read_only",
  observedAt: "2030-01-01T00:00:00.000Z",
  status: "ready_for_roster_ids",
  target: { minAvatars: 5, maxAvatars: 10, videosPerAvatar: 10, minVideos: 50, maxVideos: 100 },
  secretHandling: { channel: "deployment_secret_manager", channelState: "configured", browserInputAllowed: false, requestBodyAllowed: false, valueObserved: false },
  roster: { state: "not_configured" },
  steps: [
    { id: "secure_credential_handoff", state: "complete", owner: "robert", reasonCode: "account_ready_for_roster", actionCode: "no_roster_action_required" },
    { id: "unique_account_metadata", state: "complete", owner: "system", reasonCode: "account_ready_for_roster", actionCode: "no_roster_action_required" },
    { id: "roster_mapping", state: "action_required", owner: "robert", reasonCode: "roster_not_configured", actionCode: "enter_5_to_10_avatar_voice_pairs" },
    { id: "blocked_plan_materialization", state: "blocked", owner: "system", reasonCode: "roster_not_configured", actionCode: "no_roster_action_required" },
    { id: "external_sandbox_requirements", state: "blocked", owner: "operator", reasonCode: "external_checks_not_started", actionCode: "complete_live_sandbox_prerequisites" },
  ],
  effects: { providerNetworkCall: false, liveVerification: false, generation: false, admission: false, spend: false, deployment: false, migrationApply: false, publishing: false },
};

const virtualHooksSource = String.raw`
export function useHeyGenOnboardingReadiness() {
  const state = window.__heyGenNavigationHarness.state;
  return {
    data: state === "ready" ? ${JSON.stringify(readyReadiness)} : undefined,
    isLoading: state === "loading",
    isError: state === "error",
    isFetching: false,
    refetch: async () => ({ data: undefined }),
  };
}
export function useHeyGenRoster() {
  return { data: null, isLoading: false, isError: false, isFetching: false, refetch: async () => ({ data: null }) };
}
export function useHeyGenRosterDailyPlan() {
  return { data: null, isLoading: false, isError: false, isFetching: false, refetch: async () => ({ data: null }) };
}
export function useConfigureHeyGenRoster() {
  return { data: undefined, isPending: false, isError: false, mutate() {} };
}
`;

function navigationHooksPlugin(): Plugin {
  return {
    name: "heygen-navigation-hooks",
    enforce: "pre",
    resolveId(source, importer) {
      if (source === "./hooks" && importer?.includes("/client/src/features/ai-media-studio/core/")) return virtualHooksId;
      return null;
    },
    load(id) { return id === virtualHooksId ? virtualHooksSource : null; },
  };
}

async function launchBrowser() {
  const bundledBrowser = chromium.executablePath();
  const systemChrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  return chromium.launch({ headless: true, executablePath: existsSync(bundledBrowser) ? bundledBrowser : systemChrome });
}

async function clickSetupAndAssert(page: Page, state: "loading" | "error" | "ready", mobile: boolean) {
  await page.evaluate((nextState) => {
    history.replaceState(null, "", "#overview");
    (window as any).__heyGenNavigationHarness.render(nextState);
  }, state);
  const expectedHeading = state === "loading"
    ? "Secure HeyGen onboarding"
    : state === "error"
      ? "Secure HeyGen onboarding unavailable"
      : "Prepare local provider configuration";
  await page.getByRole("heading", { name: expectedHeading }).waitFor();
  if (mobile) await page.getByRole("button", { name: "Open studio navigation" }).click();
  const setupLink = mobile
    ? page.getByRole("dialog").getByRole("link", { name: "HeyGen setup" })
    : page.locator("aside").getByRole("link", { name: "HeyGen setup" });
  await setupLink.click();
  await page.waitForFunction(() => window.location.hash === "#heygen-setup");
  assert.equal(await page.locator("#heygen-setup").count(), 1);
  if (mobile) await page.getByRole("button", { name: "Open studio navigation" }).click();
  const activeLink = mobile
    ? page.getByRole("dialog").getByRole("link", { name: "HeyGen setup" })
    : page.locator("aside").getByRole("link", { name: "HeyGen setup" });
  assert.equal(await activeLink.getAttribute("aria-current"), "location");
  if (mobile) await page.keyboard.press("Escape");
}

test("shared StudioShell navigation resolves the HeyGen setup anchor on desktop and mobile in every onboarding state", async (t) => {
  const cacheDir = mkdtempSync(path.join(tmpdir(), "ams-heygen-navigation-vite-"));
  t.after(() => rmSync(cacheDir, { recursive: true, force: true }));
  const vite = await createViteServer({
    configFile: false,
    root: repositoryRoot,
    cacheDir,
    appType: "custom",
    logLevel: "silent",
    plugins: [navigationHooksPlugin(), react()],
    optimizeDeps: { force: true, entries: [navigationEntry] },
    resolve: { alias: { "@": path.resolve(repositoryRoot, "client/src"), "@shared": path.resolve(repositoryRoot, "shared") } },
    server: { middlewareMode: true, hmr: false },
  });
  t.after(() => vite.close());
  const server = createHttpServer((request, response) => {
    if (request.url === "/") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(`<!doctype html><html><head><style>@media(min-width:1024px){header{display:none}}@media(max-width:1023px){aside{display:none}}</style></head><body><div id="root"></div><script>window.__heyGenNavigationHarness={state:"loading"}</script><script type="module" src="/${path.relative(repositoryRoot, navigationEntry)}"></script></body></html>`);
      return;
    }
    if (request.url === "/favicon.ico") { response.writeHead(204); response.end(); return; }
    vite.middlewares(request, response, () => { response.writeHead(404); response.end("Not found"); });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const browser = await launchBrowser();
  t.after(() => browser.close());

  for (const mobile of [false, true]) {
    const page = await browser.newPage({ viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 } });
    const browserErrors: string[] = [];
    page.on("pageerror", (error) => browserErrors.push(error.message));
    page.on("console", (message) => { if (message.type() === "error") browserErrors.push(message.text()); });
    page.on("response", (response) => { if (response.status() >= 400) browserErrors.push(`HTTP ${response.status()}: ${response.url()}`); });
    await page.goto(`http://127.0.0.1:${address.port}/`);
    try {
      await page.waitForFunction(() => typeof (window as any).__heyGenNavigationHarness.render === "function", undefined, { timeout: 15_000 });
    } catch (error) {
      throw new Error(`Navigation harness did not initialize: ${browserErrors.join(" | ") || "no browser errors"}`, { cause: error });
    }
    for (const state of ["loading", "error", "ready"] as const) await clickSetupAndAssert(page, state, mobile);
    assert.deepEqual(browserErrors, []);
    await page.close();
  }
});

test("successful real roster mutation refetches the active onboarding readiness query", async (t) => {
  const cacheDir = mkdtempSync(path.join(tmpdir(), "ams-heygen-invalidation-vite-"));
  t.after(() => rmSync(cacheDir, { recursive: true, force: true }));
  const vite = await createViteServer({
    configFile: false,
    root: repositoryRoot,
    cacheDir,
    appType: "custom",
    logLevel: "silent",
    plugins: [react()],
    optimizeDeps: { force: true, entries: [invalidationEntry] },
    resolve: { alias: { "@": path.resolve(repositoryRoot, "client/src"), "@shared": path.resolve(repositoryRoot, "shared") } },
    server: { middlewareMode: true, hmr: false },
  });
  t.after(() => vite.close());
  let readinessRequests = 0;
  let rosterRequests = 0;
  const server = createHttpServer((request, response) => {
    if (request.url === "/") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(`<!doctype html><html><body><div id="root"></div><script type="module" src="/${path.relative(repositoryRoot, invalidationEntry)}"></script></body></html>`);
      return;
    }
    if (request.url === "/api/ai-media-studio/provider-configurations/heygen/onboarding-readiness" && request.method === "GET") {
      readinessRequests += 1;
      response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ ...readyReadiness, observedAt: `2030-01-01T00:00:0${readinessRequests}.000Z` }));
      return;
    }
    if (request.url === "/api/ai-media-studio/provider-configurations/heygen/roster" && request.method === "POST") {
      rosterRequests += 1;
      request.resume();
      response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ roster: {
        rosterId: "roster_aaaaaaaaaaaaaaaaaaaaaaaa", status: "configured", avatarCount: 5,
        videosPerAvatar: 10, plannedVideoCount: 50, configuredAt: "2030-01-01T00:00:00.000Z",
        members: Array.from({ length: 5 }, (_, index) => ({
          memberId: `member_${String(index + 1).padStart(24, "0")}`, name: `Creator ${index + 1}`,
          language: "en-US", accent: "Neutral", gender: "unspecified", videosPlanned: 10,
        })),
      } }));
      return;
    }
    if (request.url === "/favicon.ico") { response.writeHead(204); response.end(); return; }
    vite.middlewares(request, response, () => { response.writeHead(404); response.end("Not found"); });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const browser = await launchBrowser();
  t.after(() => browser.close());
  const page = await browser.newPage();
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") browserErrors.push(message.text()); });
  page.on("response", (response) => { if (response.status() >= 400) browserErrors.push(`HTTP ${response.status()}: ${response.url()}`); });
  await page.goto(`http://127.0.0.1:${address.port}/`);
  try {
    await page.getByText("Readiness observation: 2030-01-01T00:00:01.000Z").waitFor({ timeout: 15_000 });
  } catch (error) {
    throw new Error(`Mutation harness did not initialize: ${browserErrors.join(" | ") || "no browser errors"}`, { cause: error });
  }
  await page.getByRole("button", { name: "Save roster" }).click();
  await page.getByText("Readiness observation: 2030-01-01T00:00:02.000Z").waitFor();
  await page.getByRole("status").waitFor();
  assert.equal(rosterRequests, 1);
  assert.equal(readinessRequests, 2);
  assert.deepEqual(browserErrors, []);
});
