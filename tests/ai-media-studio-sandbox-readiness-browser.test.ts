import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import path from "node:path";
import test from "node:test";
import react from "@vitejs/plugin-react";
import { chromium } from "playwright";
import { createServer as createViteServer, type Plugin } from "vite";

const repositoryRoot = process.cwd();
const workbenchPath = path.resolve(repositoryRoot, "client/src/features/ai-media-studio/core/production-batch-workbench.tsx");
const entryPath = path.resolve(repositoryRoot, "tests/fixtures/ai-media-studio-sandbox-readiness-browser-entry.tsx");
const virtualApiId = "\0virtual:sandbox-readiness-api";

const virtualApiSource = String.raw`
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
function packetFor(input, requestNumber) {
  const videoNumber = Number.parseInt(input.slotId.slice(-2), 16) % 10 || 10;
  const creatorName = input.planId.endsWith("2") ? "Faye" : videoNumber === 1 ? "Ada" : "Bea";
  const gateCodes = ["batch_approval", "slot_binding", "source_eligibility", "provider_binding_local", "governance_coverage", "external_requirements"];
  return { sandboxReadiness: {
    version: 1, source: "derived_read_only", subject: input,
    observedAt: "2026-07-21T12:11:00.000Z", status: "locally_ready_for_external_sandbox",
    format: { aspectRatio: "9:16", orientation: "vertical" },
    preview: { creatorName: creatorName + " request " + requestNumber, videoNumber,
      source: { title: "Browser source " + videoNumber, category: "experiences" },
      script: { key: "script_000000000000000000000001", title: "Browser video " + videoNumber,
        angle: "Browser angle", hook: "Browser hook", script: "Browser approved script",
        cta: "Browser CTA", caption: "Browser caption", hashtags: ["#kong"], seoKeywords: ["kong media"] } },
    canGenerate: false, sandboxExecutionAllowed: false, spendAuthorized: false, noSpend: true,
    authoritativeForAdmission: false,
    effects: { intentCreated: false, evidenceCreated: false, snapshotCreated: false,
      reservationCreated: false, renderCreated: false, outboxCreated: false, providerCalled: false },
    summary: { totalGates: 6, passedGates: 5, blockedGates: 0, pendingExternalGates: 1 },
    gates: gateCodes.map((code, index) => index < 5
      ? { code, state: "passed", reasonCode: "ready", nextActionCode: "none" }
      : { code, state: "pending_external", reasonCode: "external_setup_required", nextActionCode: "complete_external_requirements" }),
    externalRequirements: ["provider_live_verification", "maximum_quote", "human_sandbox_cost_approval", "owned_storage_readiness", "callback_readiness"]
      .map((code) => ({ code, state: "required_external" })),
  }};
}
function executionControlFor(input, requestNumber, mode) {
  const videoNumber = Number.parseInt(input.slotId.slice(-2), 16) % 10 || 10;
  const creatorName = input.planId.endsWith("2") ? "Faye" : videoNumber === 1 ? "Ada" : "Bea";
  return { executionControl: {
    version: 1, source: "postgresql_read_only", subject: { ...input, slotAttempt: 1 },
    observedAt: "2026-07-21T12:12:00.000Z",
    selection: { selectionKey: "selection_000000000000000000000001",
      creator: { label: creatorName + " control " + requestNumber },
      avatar: { key: "resource_000000000000000000000001", label: "Public avatar " + videoNumber },
      voice: { key: "resource_000000000000000000000002", label: "Public voice " + videoNumber } },
    format: { aspectRatio: "9:16", container: "mp4" },
    binding: { state: mode === "blocked" ? "stale" : "current", credentialVersion: 1 },
    providerVerification: mode === "blocked" ? { state: "not_requested" }
      : { state: "verified", evidenceKey: "evidence_000000000000000000000003",
        observedAt: "2026-07-21T12:00:00.000Z", expiresAt: "2030-07-21T13:00:00.000Z" },
    maximumQuote: mode === "blocked" ? { state: "missing" }
      : { state: "quoted", amountMicroUsd: "1250000", currency: "USD",
        evidenceKey: "evidence_000000000000000000000001", observedAt: "2026-07-21T12:01:00.000Z", expiresAt: "2030-07-21T13:01:00.000Z" },
    humanApproval: mode === "blocked" ? { state: "not_requested" }
      : { state: "approved", evidenceKey: "evidence_000000000000000000000002",
        observedAt: "2026-07-21T12:02:00.000Z", expiresAt: "2030-07-21T13:02:00.000Z" },
    execute: { state: "disabled", postAvailable: false, reasonCodes: mode === "blocked"
      ? ["binding_stale", "provider_verification_not_requested", "maximum_quote_missing", "human_approval_not_requested", "one_shot_executor_not_installed"]
      : ["one_shot_executor_not_installed"] },
    effects: { providerCalled: false, secretResolved: false, verificationPerformed: false, quoteRequested: false,
      approvalRecorded: false, reservationCreated: false, renderCreated: false, outboxCreated: false,
      spendCommitted: false, publishingCreated: false },
    authoritativeForAdmission: false, canGenerate: false, spendAuthorized: false,
  }};
}
export const mediaStudioCoreApi = {
  async productionBatchSandboxReadiness(input) {
    const harness = window.__sandboxHarness;
    harness.calls.push({ ...input });
    const requestNumber = harness.calls.length;
    await fetch("/api/ai-media-studio/production-batches/" + encodeURIComponent(input.planId)
      + "/sandbox-readiness/" + encodeURIComponent(input.slotId), { credentials: "include", cache: "no-store" });
    await wait(harness.delayMs);
    if (harness.failNext) {
      harness.failNext = false;
      throw new Error("Safe browser test failure");
    }
    return packetFor(input, requestNumber);
  },
  async oneVideoExecutionControl(input) {
    const harness = window.__sandboxHarness;
    harness.executionCalls.push({ ...input });
    const requestNumber = harness.executionCalls.length;
    await fetch("/api/ai-media-studio/production-batches/" + encodeURIComponent(input.planId)
      + "/one-video-execution-control/" + encodeURIComponent(input.slotId), { credentials: "include", cache: "no-store" });
    await wait(harness.delayMs);
    return executionControlFor(input, requestNumber, harness.controlMode);
  },
};
`;

function browserHarnessPlugin(): Plugin {
  return {
    name: "sandbox-readiness-browser-harness",
    enforce: "pre",
    resolveId(source, importer) {
      if (source === "./api" && importer?.endsWith("/client/src/features/ai-media-studio/core/hooks.ts")) {
        return virtualApiId;
      }
      return null;
    },
    load(id) {
      return id === virtualApiId ? virtualApiSource : null;
    },
    transform(code, id) {
      if (path.resolve(id) === workbenchPath) {
        return `${code}\nexport { SandboxReadinessPanel as __SandboxReadinessPanelForBrowserTest };`;
      }
      return null;
    },
  };
}

test("SandboxReadinessPanel browser click path is read-only, accessible, retryable, and batch-safe", async (t) => {
  const vite = await createViteServer({
    configFile: false,
    root: repositoryRoot,
    appType: "custom",
    logLevel: "error",
    plugins: [browserHarnessPlugin(), react()],
    resolve: {
      alias: {
        "@": path.resolve(repositoryRoot, "client/src"),
        "@shared": path.resolve(repositoryRoot, "shared"),
      },
    },
    server: { middlewareMode: true, hmr: false },
  });
  t.after(() => vite.close());

  const httpServer = createHttpServer((request, response) => {
    if (request.url === "/favicon.ico") {
      response.writeHead(204); response.end(); return;
    }
    if (request.url === "/") {
      const html = `<!doctype html><html><body><main><div id="root"></div></main><script>
        window.__sandboxHarness = { calls: [], executionCalls: [], delayMs: 80, failNext: false, controlMode: "ready" };
      </script><script type="module" src="/${path.relative(repositoryRoot, entryPath)}"></script></body></html>`;
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(html);
      return;
    }
    if (request.url?.startsWith("/api/ai-media-studio/")) {
      response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      response.end("{}");
      return;
    }
    vite.middlewares(request, response, () => {
      response.writeHead(404); response.end("Not found");
    });
  });
  await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve, reject) => httpServer.close((error) => error ? reject(error) : resolve())));
  const address = httpServer.address();
  assert.ok(address && typeof address === "object");

  const bundledBrowser = chromium.executablePath();
  const systemChrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  const browser = await chromium.launch({
    headless: true,
    executablePath: existsSync(bundledBrowser) ? bundledBrowser : systemChrome,
  });
  t.after(() => browser.close());
  const page = await browser.newPage();
  const capturedApiRequests: { url: string; method: string }[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/ai-media-studio/")) capturedApiRequests.push({ url: request.url(), method: request.method() });
  });
  const consoleErrors: string[] = [];
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("requestfailed", (request) => consoleErrors.push(
    `Request failed: ${request.url()} (${request.failure()?.errorText ?? "unknown"})`,
  ));
  page.on("response", (response) => {
    if (response.status() >= 400) consoleErrors.push(`HTTP ${response.status()}: ${response.url()}`);
  });
  await page.goto(`http://127.0.0.1:${address.port}/`);

  const selector = page.getByRole("combobox", { name: "Approved public slot", exact: true });
  await assert.doesNotReject(selector.waitFor());
  assert.equal(await selector.getAttribute("aria-describedby"), "sandbox-approved-slot-help");
  assert.equal(await selector.inputValue(), "slot_000000000000000000000001");
  await assert.doesNotReject(page.getByText("Ada request 1").waitFor());
  await assert.doesNotReject(page.getByText("Ada control 1").waitFor());
  const executeButton = page.getByRole("button", { name: "Execute one approved video", exact: true });
  assert.equal(await executeButton.count(), 1);
  assert.equal(await executeButton.isDisabled(), true);
  assert.ok(await executeButton.getAttribute("aria-describedby"));
  assert.equal(await page.getByText("$1.25 USD", { exact: false }).count(), 1);
  assert.equal(await page.getByText("Refresh does not contact HeyGen.", { exact: false }).count(), 1);

  await page.evaluate(() => { (window as any).__sandboxHarness.controlMode = "blocked"; });
  await page.getByRole("button", { name: "Refresh execution evidence" }).click();
  await assert.doesNotReject(page.getByText("A server-attested maximum quote is missing.").waitFor());
  assert.equal(await page.getByText("Missing", { exact: true }).count(), 1);
  assert.ok(await page.getByText("Not requested", { exact: true }).count() >= 2);
  await page.evaluate(() => { (window as any).__sandboxHarness.controlMode = "ready"; });
  await page.getByRole("button", { name: "Refresh execution evidence" }).click();
  await assert.doesNotReject(page.getByText("$1.25 USD", { exact: false }).waitFor());

  await page.locator("body").click({ position: { x: 2, y: 2 } });
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  assert.equal(await selector.evaluate((element) => document.activeElement === element), true);
  await selector.selectOption("slot_000000000000000000000002");
  assert.equal(await selector.inputValue(), "slot_000000000000000000000002");
  await assert.doesNotReject(page.getByText("Bea request 2").waitFor());
  await assert.doesNotReject(page.getByText(/Bea control \d+/u).waitFor());
  const selectedCall = await page.evaluate(() => (window as any).__sandboxHarness.calls.at(-1));
  assert.deepEqual(selectedCall, {
    planId: "plan_000000000000000000000001",
    batchId: "batch_000000000000000000000001",
    slotId: "slot_000000000000000000000002",
  });
  const queryKeys = await page.evaluate(() => (window as any).__sandboxHarness.queryClient
    .getQueryCache().getAll().map((query: any) => query.queryKey));
  assert.ok(queryKeys.some((key: unknown[]) => key.at(-1) === "slot_000000000000000000000002"));

  await page.getByRole("button", { name: "Refresh readiness packet" }).click();
  await assert.doesNotReject(page.getByText("Refreshing the selected slot packet…").waitFor());
  await assert.doesNotReject(page.getByText("Bea request 3").waitFor());
  await page.getByRole("button", { name: "Refresh execution evidence" }).click();
  await assert.doesNotReject(page.getByText(/Bea control \d+/u).waitFor());

  await page.evaluate(() => { (window as any).__sandboxHarness.delayMs = 250; });
  await selector.selectOption("slot_000000000000000000000001");
  await selector.selectOption("slot_000000000000000000000002");
  await page.waitForTimeout(350);
  assert.equal(await selector.inputValue(), "slot_000000000000000000000002");
  assert.equal(await page.getByText(/Ada control \d+/u).count(), 0, "a late response for the old slot must not repaint evidence");
  await page.evaluate(() => { (window as any).__sandboxHarness.delayMs = 80; });

  await page.evaluate(() => { (window as any).__sandboxHarness.failNext = true; });
  await selector.selectOption("slot_000000000000000000000001");
  await assert.doesNotReject(page.getByRole("alert").getByText("Safe browser test failure").waitFor());
  await page.getByRole("button", { name: "Retry" }).click();
  await assert.doesNotReject(page.getByText(/Ada request \d+/u).waitFor());

  const unsafeControls = page.getByRole("button", { name: /^(Generate|Spend)\b/iu });
  assert.equal(await unsafeControls.count(), 0);
  assert.equal(await page.getByText("No spend · No provider call · No execution.").count(), 1);
  assert.equal(await page.locator('[aria-label="Vertical 9 by 16 video preview"]').count(), 1);
  assert.equal(await page.locator('[aria-label="Six one-video sandbox readiness gates"] > li').count(), 6);

  await page.evaluate(() => (window as any).__sandboxHarness.renderSecondBatch());
  await assert.doesNotReject(page.getByText(/Faye request \d+/u).waitFor());
  await assert.doesNotReject(page.getByText(/Faye control \d+/u).waitFor());
  assert.equal(await selector.inputValue(), "slot_000000000000000000000065");
  const resetCall = await page.evaluate(() => (window as any).__sandboxHarness.calls.at(-1));
  assert.deepEqual(resetCall, {
    planId: "plan_000000000000000000000002",
    batchId: "batch_000000000000000000000002",
    slotId: "slot_000000000000000000000065",
  });
  assert.ok(capturedApiRequests.length >= 8);
  assert.ok(capturedApiRequests.every((request) => request.method === "GET"));
  assert.ok(capturedApiRequests.every((request) => new URL(request.url).hostname === "127.0.0.1"));
  assert.ok(capturedApiRequests.every((request) => /\/(sandbox-readiness|one-video-execution-control)\//u.test(request.url)));
  assert.equal(capturedApiRequests.some((request) => /heygen\.com|\/execute(?:\/|$)/iu.test(request.url)), false);
  assert.deepEqual(consoleErrors, []);
});
