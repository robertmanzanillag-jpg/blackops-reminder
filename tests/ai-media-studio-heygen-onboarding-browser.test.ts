import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import react from "@vitejs/plugin-react";
import { chromium } from "playwright";
import { createServer as createViteServer, type Plugin } from "vite";

const repositoryRoot = process.cwd();
const entryPath = path.resolve(repositoryRoot, "tests/fixtures/ai-media-studio-heygen-onboarding-browser-entry.tsx");
const virtualHooksId = "\0virtual:heygen-onboarding-hooks";

const virtualHooksSource = String.raw`
const roster = {
  rosterId: "roster_aaaaaaaaaaaaaaaaaaaaaaaa", status: "configured", avatarCount: 5,
  videosPerAvatar: 10, plannedVideoCount: 50, configuredAt: "2030-01-01T00:00:00.000Z",
  members: Array.from({ length: 5 }, (_, index) => ({
    memberId: "member_" + String(index + 1).padStart(24, "0"), name: "Creator " + (index + 1),
    language: "en-US", accent: "Neutral", gender: "unspecified", videosPlanned: 10,
  })),
};
export function useHeyGenRoster(enabled) {
  window.__heyGenOnboardingHarness.observations.push({ kind: "roster", enabled });
  return { data: { roster }, isLoading: false, isError: false, isFetching: false, refetch: async () => ({ data: { roster } }) };
}
export function useHeyGenRosterDailyPlan(enabled) {
  window.__heyGenOnboardingHarness.observations.push({ kind: "daily-plan", enabled });
  return { data: null, isLoading: false, isError: false, isFetching: false, refetch: async () => ({ data: null }) };
}
export function useConfigureHeyGenRoster() {
  return { data: undefined, isPending: false, isError: false, mutate(input) { window.__heyGenOnboardingHarness.mutations.push(input); } };
}
`;

function browserHarnessPlugin(): Plugin {
  return {
    name: "heygen-onboarding-browser-harness",
    enforce: "pre",
    resolveId(source, importer) {
      if (source === "./hooks" && importer?.endsWith("/client/src/features/ai-media-studio/core/heygen-roster-setup.tsx")) return virtualHooksId;
      return null;
    },
    load(id) { return id === virtualHooksId ? virtualHooksSource : null; },
  };
}

test("configured HeyGen roster stays summarized until confirmed replacement and cancel preserves it", async (t) => {
  const cacheDir = mkdtempSync(path.join(tmpdir(), "ams-heygen-onboarding-vite-"));
  t.after(() => rmSync(cacheDir, { recursive: true, force: true }));
  const vite = await createViteServer({
    configFile: false,
    root: repositoryRoot,
    cacheDir,
    appType: "custom",
    logLevel: "silent",
    plugins: [browserHarnessPlugin(), react()],
    optimizeDeps: { force: true },
    resolve: { alias: { "@": path.resolve(repositoryRoot, "client/src"), "@shared": path.resolve(repositoryRoot, "shared") } },
    server: { middlewareMode: true, hmr: false },
  });
  t.after(() => vite.close());

  const httpServer = createHttpServer((request, response) => {
    if (request.url === "/favicon.ico") { response.writeHead(204); response.end(); return; }
    if (request.url === "/") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(`<!doctype html><html><body><main><div id="root"></div></main><script>window.__heyGenOnboardingHarness={mutations:[],observations:[]}</script><script type="module" src="/${path.relative(repositoryRoot, entryPath)}"></script></body></html>`);
      return;
    }
    vite.middlewares(request, response, () => { response.writeHead(404); response.end("Not found"); });
  });
  await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve, reject) => httpServer.close((error) => error ? reject(error) : resolve())));
  const address = httpServer.address();
  assert.ok(address && typeof address === "object");

  const bundledBrowser = chromium.executablePath();
  const systemChrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  const browser = await chromium.launch({ headless: true, executablePath: existsSync(bundledBrowser) ? bundledBrowser : systemChrome });
  t.after(() => browser.close());
  const page = await browser.newPage();
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") browserErrors.push(message.text()); });
  page.on("response", (response) => { if (response.status() >= 400) browserErrors.push(`HTTP ${response.status()}: ${response.url()}`); });
  await page.goto(`http://127.0.0.1:${address.port}/`);
  await page.waitForTimeout(500);
  if (browserErrors.some((message) => message.includes("Outdated Optimize Dep") || message.includes("HTTP 504"))) {
    browserErrors.length = 0;
    await page.reload();
    await page.waitForTimeout(500);
  }
  assert.deepEqual(browserErrors, []);

  await assert.doesNotReject(page.getByText("Roster configured: 5 avatars and 50 planned videos.").waitFor());
  assert.equal(await page.getByRole("textbox", { name: "HeyGen avatar ID" }).count(), 0);
  await page.getByRole("button", { name: "Replace roster" }).click();
  await assert.doesNotReject(page.getByRole("alertdialog").waitFor());
  await page.getByRole("button", { name: "Keep current roster" }).click();
  assert.equal(await page.getByRole("textbox", { name: "HeyGen avatar ID" }).count(), 0);
  assert.equal(await page.getByText("Creator 1 · en-US · 10 planned").count(), 1);

  await page.getByRole("button", { name: "Replace roster" }).click();
  await page.getByRole("button", { name: "Open replacement form" }).click();
  assert.equal(await page.getByRole("textbox", { name: "HeyGen avatar ID" }).count(), 5);
  assert.equal(await page.getByRole("textbox", { name: /API key|secret|token/iu }).count(), 0);
  assert.deepEqual(await page.evaluate(() => (window as any).__heyGenOnboardingHarness.mutations), []);

  await page.evaluate(() => (window as any).__heyGenOnboardingHarness.render("roster_configured_blocked"));
  await page.getByRole("textbox", { name: "HeyGen avatar ID" }).first().waitFor({ state: "detached" });
  assert.equal(await page.getByRole("textbox", { name: "HeyGen avatar ID" }).count(), 0);
  await page.getByRole("button", { name: "Replace roster" }).click();
  assert.equal(await page.getByRole("button", { name: "Open replacement form" }).isEnabled(), true);
  await page.getByRole("button", { name: "Keep current roster" }).click();
  await page.evaluate(() => (window as any).__heyGenOnboardingHarness.render("stale_roster_binding"));
  await page.getByRole("button", { name: "Replace stale roster" }).click();
  await page.getByRole("button", { name: "Keep blocked roster" }).click();
  assert.equal(await page.getByRole("textbox", { name: "HeyGen avatar ID" }).count(), 0);
  await page.getByRole("button", { name: "Replace stale roster" }).click();
  await page.getByRole("button", { name: "Open replacement form" }).click();
  assert.equal(await page.getByRole("textbox", { name: "HeyGen avatar ID" }).count(), 5);
  await page.evaluate(() => (window as any).__heyGenOnboardingHarness.render("awaiting_secure_credential"));
  await page.waitForTimeout(50);
  const observations = await page.evaluate(() => (window as any).__heyGenOnboardingHarness.observations.slice(-2));
  assert.deepEqual(observations, [{ kind: "roster", enabled: false }, { kind: "daily-plan", enabled: false }]);
  assert.deepEqual(browserErrors, []);
});
