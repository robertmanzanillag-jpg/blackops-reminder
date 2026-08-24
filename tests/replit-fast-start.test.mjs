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

  await new Promise((resolve) => setTimeout(resolve, 700));
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
