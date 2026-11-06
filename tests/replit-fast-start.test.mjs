import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { startReplitFastStart } from "../script/replit-fast-start.mjs";

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

test("Replit launcher answers health immediately and proxies after the app is ready", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "replit-fast-start-"));
  const childEntry = path.join(directory, "delayed-app.mjs");
  const upstreamPort = await reservePort();
  await writeFile(childEntry, `
    import http from "node:http";
    setTimeout(() => http.createServer((req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "ok", path: req.url }));
    }).listen(Number(process.env.PORT), process.env.HOST), 450);
  `);

  const runtime = await startReplitFastStart({
    publicHost: "127.0.0.1",
    publicPort: 0,
    upstreamPort,
    childEntry,
    preflightEntry: false,
    readinessIntervalMs: 25,
    childStdio: "ignore",
  });
  t.after(() => runtime.stop("SIGKILL"));

  const starting = await fetch(`http://127.0.0.1:${runtime.port}/api/health`);
  assert.equal(starting.status, 200);
  assert.equal((await starting.json()).status, "starting");

  const unavailable = await fetch(`http://127.0.0.1:${runtime.port}/api/tasks`);
  assert.equal(unavailable.status, 503);

  await waitFor(() => runtime.isUpstreamReady(), "delayed app startup");
  const ready = await fetch(`http://127.0.0.1:${runtime.port}/api/health`);
  assert.equal(ready.status, 200);
  assert.deepEqual(await ready.json(), { status: "ok", path: "/api/health" });
});

test("Replit deployment runs through the fast-start launcher", async () => {
  const [{ readFile }, packageJson] = await Promise.all([
    import("node:fs/promises"),
    import("../package.json", { with: { type: "json" } }),
  ]);
  const replit = await readFile(new URL("../.replit", import.meta.url), "utf8");
  assert.match(replit, /run = \["node", "script\/replit-fast-start\.mjs"\]/);
  assert.equal(packageJson.default.scripts["start:replit"], "NODE_ENV=production node script/replit-fast-start.mjs");
});

async function waitFor(predicate, label, timeout = 3000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.fail(`Timed out waiting for ${label}`);
}

async function controlledRuntime(t, initialMode = "ok") {
  const directory = await mkdtemp(path.join(os.tmpdir(), "replit-proxy-health-"));
  const childEntry = path.join(directory, "app.mjs");
  const upstreamPort = await reservePort();
  await writeFile(childEntry, `
    import http from "node:http";
    let mode = ${JSON.stringify(initialMode)}, delay = 0, active = 0, maxActive = 0, probes = 0;
    http.createServer((req, res) => {
      const url = new URL(req.url, 'http://local');
      if (url.pathname === '/control') {
        mode = url.searchParams.get('mode') || 'ok';
        delay = Number(url.searchParams.get('delay') || 0);
        res.end('ok'); return;
      }
      if (url.pathname === '/stats') {
        res.end(JSON.stringify({active, maxActive, probes})); return;
      }
      if (url.pathname === '/reset') { req.socket.destroy(); return; }
      if (url.pathname === '/hang') return;
      if (url.pathname === '/route-error') { res.writeHead(500); res.end('route failed'); return; }
      if (url.pathname !== '/api/health') { res.end('application'); return; }
      active++; probes++; maxActive = Math.max(active,maxActive);
      res.once('close', () => active--);
      if (mode === 'hang') return;
      if (mode === 'body-hang') { res.writeHead(200); res.write('partial'); return; }
      const status = mode === 'ok' ? 200 : Number(mode);
      setTimeout(() => { if (!res.destroyed) { res.writeHead(status); res.end('health'); } }, delay);
    }).listen(Number(process.env.PORT), process.env.HOST);
  `);
  const runtime = await startReplitFastStart({ publicHost: '127.0.0.1', publicPort: 0,
    upstreamPort, childEntry, preflightEntry: false, childStdio: 'ignore',
    readinessIntervalMs: 30, readinessTimeoutMs: 140, readinessFailureThreshold: 3,
    proxyTimeoutMs: 500 });
  t.after(async () => {
    await runtime.stop('SIGKILL');
    const { rm } = await import('node:fs/promises');
    await rm(directory, { recursive: true, force: true });
  });
  if (initialMode === 'ok') await waitFor(() => runtime.isUpstreamReady(), 'initial readiness');
  const direct = `http://127.0.0.1:${upstreamPort}`;
  const control = async (mode, delay = 0) => {
    const response = await fetch(`${direct}/control?mode=${mode}&delay=${delay}`);
    await response.text();
  };
  const stats = async () => (await fetch(`${direct}/stats`)).json();
  await waitFor(async () => { try { await stats(); return true; } catch { return false; } }, 'child listening');
  return { runtime, control, stats, publicUrl: `http://127.0.0.1:${runtime.port}` };
}

test('route errors, resets and request deadlines do not downgrade global readiness', async t => {
  const {runtime, publicUrl} = await controlledRuntime(t);
  for (const route of ['/reset', '/hang']) {
    const response = await fetch(publicUrl + route);
    assert.equal(response.status, 503);
    assert.equal((await response.json()).status, 'upstream_unavailable');
    assert.equal(runtime.isUpstreamReady(), true);
    assert.equal(await (await fetch(publicUrl + '/application')).text(), 'application');
  }
  const error = await fetch(publicUrl + '/route-error');
  assert.equal(error.status, 500);
  assert.equal(await error.text(), 'route failed');
  assert.equal(runtime.isUpstreamReady(), true);
});

test('health probes are serial and tolerate transient failure but reject sustained unhealthy responses', async t => {
  const {runtime, control, stats} = await controlledRuntime(t);
  await control('ok', 80); // Longer than poll interval: old implementation overlaps.
  const initial = (await stats()).probes;
  await waitFor(async () => (await stats()).probes >= initial + 4, 'delayed successful probes');
  assert.equal((await stats()).maxActive, 1);
  assert.equal(runtime.isUpstreamReady(), true);
  await control('503');
  const beforeFailure = (await stats()).probes;
  await waitFor(async () => (await stats()).probes > beforeFailure, 'one failed probe');
  assert.equal(runtime.isUpstreamReady(), true, 'one failure must not flap readiness');
  await control('ok');
  await new Promise(resolve => setTimeout(resolve, 80));
  assert.equal(runtime.isUpstreamReady(), true);
  for (const mode of ['503', '404', '302']) {
    await control(mode);
    await waitFor(() => !runtime.isUpstreamReady(), `sustained ${mode} unready`);
    await new Promise(resolve => setTimeout(resolve, 60));
    assert.equal(runtime.isUpstreamReady(), false, `${mode} must not promote readiness`);
    await control('ok');
    await waitFor(() => runtime.isUpstreamReady(), 'successful recovery');
  }
});

test('hanging health response and body have bounded deadlines and recover without overlapping probes', async t => {
  const {runtime, control, stats} = await controlledRuntime(t);
  for (const mode of ['hang', 'body-hang']) {
    await control(mode);
    await waitFor(() => !runtime.isUpstreamReady(), `${mode} deadline failures`);
    assert.equal((await stats()).maxActive, 1);
    await control('ok');
    await waitFor(() => runtime.isUpstreamReady(), `${mode} recovery`);
  }
});

test('child exit immediately clears readiness and stops further probes', async t => {
  const {runtime, control, stats} = await controlledRuntime(t);
  await control('ok', 110);
  const count = (await stats()).probes;
  await waitFor(async () => (await stats()).probes > count, 'pending delayed health probe');
  const exited = new Promise(resolve => runtime.child.once('exit', resolve));
  runtime.child.kill('SIGTERM');
  await exited;
  assert.equal(runtime.isUpstreamReady(), false);
  await new Promise(resolve => setTimeout(resolve, 200));
  assert.equal(runtime.isUpstreamReady(), false, 'late probe must not resurrect exited child');
  assert.equal(runtime.server.listening, false);
  // Allow the launcher's asynchronous close handler to set its exit code first.
  assert.equal(process.exitCode, 1);
  process.exitCode = 0;
});

test('startup requires a complete successful health response before accepting application traffic', async t => {
  const {runtime, control, stats, publicUrl} = await controlledRuntime(t, '404');
  await waitFor(async () => (await stats()).probes >= 3, 'initial rejected probes');
  assert.equal(runtime.isUpstreamReady(), false);
  assert.equal((await fetch(publicUrl + '/application')).status, 503);
  await control('body-hang');
  const count = (await stats()).probes;
  await waitFor(async () => (await stats()).probes >= count + 3, 'incomplete 200 responses');
  assert.equal(runtime.isUpstreamReady(), false, '200 headers alone do not establish readiness');
  await control('ok');
  await waitFor(() => runtime.isUpstreamReady(), 'complete 200 response');
  assert.equal(await (await fetch(publicUrl + '/application')).text(), 'application');
});
