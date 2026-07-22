import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import react from "@vitejs/plugin-react";
import { chromium } from "playwright";
import { createServer as createViteServer } from "vite";
import { HEYGEN_STATIC_CREDENTIAL_REFERENCE_ENDPOINT } from "../client/src/features/ai-media-studio/core/heygen-secure-reference.ts";

const repositoryRoot = process.cwd();
const entryPath = path.resolve(repositoryRoot, "tests/fixtures/ai-media-studio-heygen-guided-setup-browser-entry.tsx");

test("guided setup completes only the safe credential-reference handoff and leaves later gates inert", async (t) => {
  const cacheDir = mkdtempSync(path.join(tmpdir(), "ams-heygen-guided-setup-vite-"));
  t.after(() => rmSync(cacheDir, { recursive: true, force: true }));
  const vite = await createViteServer({
    configFile: false,
    root: repositoryRoot,
    cacheDir,
    appType: "custom",
    logLevel: "silent",
    plugins: [react()],
    optimizeDeps: { force: true, entries: [entryPath] },
    resolve: { alias: { "@": path.resolve(repositoryRoot, "client/src"), "@shared": path.resolve(repositoryRoot, "shared") } },
    server: { middlewareMode: true, hmr: false },
  });
  t.after(() => vite.close());

  const requests: Array<{ method: string; body: string }> = [];
  const httpServer = createHttpServer((request, response) => {
    if (request.url === "/favicon.ico") { response.writeHead(204); response.end(); return; }
    if (request.url === "/" && request.method === "GET") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(`<!doctype html><html><body><main><div id="root"></div></main><script type="module" src="/${path.relative(repositoryRoot, entryPath)}"></script></body></html>`);
      return;
    }
    if (request.url === HEYGEN_STATIC_CREDENTIAL_REFERENCE_ENDPOINT && request.method === "POST") {
      let body = "";
      request.setEncoding("utf8");
      request.on("data", (chunk) => { body += chunk; });
      request.on("end", () => {
        requests.push({ method: request.method!, body });
        response.writeHead(201, { "content-type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({ outcome: "created", credentialReference: { providerKey: "heygen", state: "registered", credentialVersion: 1 } }));
      });
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
  try {
    await page.getByRole("heading", { name: "One safe action at a time" }).waitFor({ timeout: 15_000 });
  } catch (error) {
    const body = (await page.locator("body").innerText().catch(() => "unavailable")).slice(0, 2_000);
    throw new Error(`Guided setup did not render: ${browserErrors.join(" | ") || "no browser errors"}; body=${body}`, { cause: error });
  }

  assert.equal(await page.getByText("AI_MEDIA_STUDIO_SECRET_HEYGEN_API_KEY", { exact: true }).count(), 2);
  assert.equal(await page.getByRole("textbox", { name: /API key|secret|token/iu }).count(), 0);
  assert.equal(await page.getByRole("button", { name: "GET-only verification — authorization required" }).isDisabled(), true);
  assert.equal(await page.getByRole("list", { name: "Eight guided HeyGen setup gates" }).getByRole("listitem").count(), 8);

  await page.getByRole("button", { name: "I added the Replit secret — register reference" }).click();
  await page.getByText("Deployment-secret reference registered. The secret value was not observed or returned.").waitFor();
  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.method, "POST");
  const requestBody = JSON.parse(requests[0]!.body);
  assert.deepEqual(Object.keys(requestBody), ["idempotencyKey"]);
  assert.match(requestBody.idempotencyKey, /^heygen-static-reference-[0-9a-f-]{36}$/u);
  assert.doesNotMatch(requests[0]!.body, /api.?key|secret|token|account|credentialVersion/iu);
  assert.equal(await page.getByRole("link", { name: "Enter 5–10 avatar look ID and voice ID pairs" }).getAttribute("href"), "#heygen-roster");
  assert.equal(await page.getByRole("button", { name: "I added the Replit secret — register reference" }).count(), 0);
  assert.deepEqual(browserErrors, []);
});
