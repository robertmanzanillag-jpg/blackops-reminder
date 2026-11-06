// Temporary, dependency-free deployment capability probe. No app data,
// credentials, database queries, model calls or workload execution.
import http from "node:http";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";

const bootId = randomUUID();
const startedAt = new Date().toISOString();
let docker = "checking";
execFile("docker", ["info", "--format", "{{.ServerVersion}}"], {
  timeout: 5000, maxBuffer: 1024, env: { PATH: process.env.PATH },
}, error => { docker = error ? "unavailable" : "daemon-responded"; });
const payload = () => JSON.stringify({
  purpose: "temporary-factory-host-probe", factoryActive: false,
  bootId, startedAt, uptimeSeconds: Math.floor(process.uptime()), docker,
});
const server = http.createServer((req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405); res.end(); return; }
  if (req.url !== "/" && req.url !== "/health") { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(req.method === "HEAD" ? undefined : payload());
});
server.requestTimeout = 5000;
server.headersTimeout = 5000;
server.maxHeadersCount = 30;
server.listen(5000, "0.0.0.0", () => console.log("Factory host probe listening; factory remains inactive."));
for (const signal of ["SIGTERM", "SIGINT"]) process.once(signal, () => server.close(() => process.exit(0)));
