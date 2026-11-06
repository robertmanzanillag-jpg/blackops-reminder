import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { registerSoftwareFactoryRoutes } from "../server/software-factory-routes";
import { createSignedLocalAuthCookieValue } from "../server/user-context";
import { ASISTENTE_REPOSITORY } from "../server/software-factory-company";

test("company orders use owner-only guarded admission, never generic enqueue or completion", async t => {
  const saved = { ...process.env };
  Object.assign(process.env, { NODE_ENV: "test", DEFAULT_USER_ID: "factory-owner", SESSION_SECRET: "factory-fixture-secret", ALLOW_DEV_USER_FALLBACK: "true" });
  t.after(() => { for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key]; Object.assign(process.env, saved); });
  let admissions = 0, denied = false, reads = 0;
  const app = express(); app.use(express.json());
  registerSoftwareFactoryRoutes(app, {
    store: { projects: async owner => { assert.equal(owner, "factory-owner"); reads++; return [{ id: "asistente", repo: ASISTENTE_REPOSITORY }]; } } as any,
    companyAdmission: { reservationCents: 1,
      readMainOrder: async (owner, id) => { assert.equal(owner, "factory-owner"); return id === "order-1" ? { id, text: "Mejora los filtros de Asistente", createdAt: "2026-11-06T12:00:00Z", assignees: [{ agentId: "code", status: "en_curso", note: "" }] } : undefined; },
      admitWithinCredits: async (owner, job) => { admissions++; assert.equal(owner, "factory-owner"); assert.equal(job.kind, "discover"); if (denied) throw Error("PRIVATE_CREDIT_GUARD"); return { ...job, id: "root-1", status: "pending" } as any; },
    },
  });
  const server = app.listen(0, "127.0.0.1"); await new Promise<void>(resolve => server.once("listening", resolve));
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  process.env.PUBLIC_APP_URL = base;
  const post = (owner: string, company = "main") => fetch(`${base}/api/software-factory/company-orders`, { method: "POST", headers: { "content-type": "application/json", origin: base, cookie: `blackops.uid=${createSignedLocalAuthCookieValue(owner)}` }, body: JSON.stringify({ company, orderId: "order-1", projectId: "asistente" }) });
  assert.equal((await post("other")).status, 403); assert.equal(reads, 0);
  assert.equal((await post("factory-owner", "kong")).status, 400); assert.equal(admissions, 0);
  const admitted = await post("factory-owner"); assert.equal(admitted.status, 202);
  assert.deepEqual(await admitted.json(), { jobId: "root-1", status: "pending", orderId: "order-1", delivered: false });
  denied = true;
  const blocked = await post("factory-owner"); assert.equal(blocked.status, 409);
  assert.doesNotMatch(await blocked.text(), /PRIVATE_CREDIT_GUARD/);
});

test("factory HTTP requires real owner and same origin; forbids policy/evidence injection", async t => {
  const saved = { ...process.env };
  Object.assign(process.env, { NODE_ENV: "test", DEFAULT_USER_ID: "factory-owner", SESSION_SECRET: "factory-fixture-secret", ALLOW_DEV_USER_FALLBACK: "true" });
  t.after(() => { for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key]; Object.assign(process.env, saved); });
  let paused = true, reads = 0, writes = 0, unavailable = false;
  let fixedCents = 0;
  let workers: any[] = [];
  let projects: any[] = [];
  let extraJobs: any[] = [];
  const app = express(); app.use(express.json());
  registerSoftwareFactoryRoutes(app, { store: {
    status: async owner => { assert.equal(owner, "factory-owner"); reads++; if (unavailable) throw new Error("private database failure"); return { paused, month: "2026-11", fixedCents, spentCents: 25, reservedCents: 100, limitCents: 10000, configured: true, workers }; },
    list: async () => [{ id: "fixture-run", key: "fixture", projectId: "office", ownerKey: "private-owner", kind: "build", status: "blocked", createdAt: "2026-11-05T00:00:00Z", month: "2026-11", reservedCents: 100, payload: { secret: "DO-NOT-EXPOSE" }, result: { reason: "DO-NOT-EXPOSE" } }, ...extraJobs],
    projects: async () => projects,
    setPaused: async (owner, value) => { assert.equal(owner, "factory-owner"); writes++; paused = value; },
    initializeMonth: async (owner, _month, cost) => { assert.equal(owner, "factory-owner"); writes++; fixedCents = cost; },
    saveProject: async (owner, config) => { assert.equal(owner, "factory-owner"); assert.equal(config.automaticRelease, false); assert.deepEqual(config.rehearsalRunIds, []); assert.equal(config.providerSupportsRelease, false); writes++; return config; },
  } });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  process.env.PUBLIC_APP_URL = base;
  const cookie = (id = "factory-owner") => `blackops.uid=${createSignedLocalAuthCookieValue(id)}`;
  const post = (path: string, body: unknown, headers: Record<string,string> = {}) => fetch(`${base}/api/software-factory/${path}`, { method: "POST", headers: { cookie: cookie(), origin: base, "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
  assert.equal((await fetch(`${base}/api/software-factory`)).status, 401);
  assert.equal((await fetch(`${base}/api/software-factory`, { headers: { "x-user-id": "factory-owner" } })).status, 401);
  assert.equal((await fetch(`${base}/api/software-factory`, { headers: { cookie: cookie("other") } })).status, 403);
  assert.equal(reads, 0);
  assert.equal((await post("pause", { paused: false }, { origin: "https://other.example" })).status, 403);
  assert.equal((await post("pause", { paused: false, limitCents: 999999 })).status, 400);
  assert.equal((await post("budget", { fixedCents: 10001 })).status, 400);
  assert.equal((await post("company-orders", { company: "kong", orderId: "a", projectId: "office" })).status, 400);
  assert.equal((await post("company-orders", { company: "main", orderId: "a", projectId: "office" }, { origin: "https://other.example" })).status, 403);
  assert.equal((await post("company-orders", { company: "main", orderId: "a", projectId: "office" })).status, 503);
  assert.equal(writes, 0);
  assert.equal((await post("pause", { paused: false })).status, 200);
  assert.equal((await post("budget", { fixedCents: 2000 })).status, 200);
  const project = { id: "office", repo: "fixture/office", testCommand: "npm test", buildCommand: "npm run build", rollbackCommand: "rollback", stagingUrl: "https://staging.example", productionUrl: "https://production.example", healthUrl: "https://production.example/health", journeys: ["login"] };
  assert.equal((await post("projects", { ...project, automaticRelease: true, rehearsalRunIds: ["forged"] })).status, 400);
  assert.equal((await post("projects", { ...project, stagingUrl: project.productionUrl })).status, 400);
  assert.equal((await post("projects", project)).status, 201);
  const response = await fetch(`${base}/api/software-factory`, { headers: { cookie: cookie() } });
  assert.equal(response.headers.get("cache-control"), "no-store");
  const view = await response.json();
  assert.equal(view.budget.remainingCents, 7875);
  assert.equal(view.readiness, "blocked");
  assert.equal(view.paused, false);
  assert.doesNotMatch(JSON.stringify(view), /DO-NOT-EXPOSE|private-owner/);
  const headSha = "a".repeat(40), baseSha = "b".repeat(40);
  const evidenceJob = (id: string, kind: string, target: string, healthy: boolean, restoredSha = baseSha) => ({ id, key: id, projectId: "office", ownerKey: "private-owner", kind, status: "completed", headSha, createdAt: new Date().toISOString(), month: "2026-11", reservedCents: 10, payload: {}, result: { costCents: 5, evidence: { pipelineState: { version: 1, projectId: "office", target, candidate: { projectId: "office", headSha, baseSha }, verification: { healthy, headSha }, deployment: { headSha, target }, rollback: { healthy, restoredSha } } } } });
  extraJobs = [evidenceJob("production-good", "verify", "production", true), evidenceJob("production-bad", "verify", "production", false), evidenceJob("staging-good", "verify", "staging", true), evidenceJob("rollback-good", "rollback", "production", true), evidenceJob("rollback-wrong", "rollback", "production", true, headSha)];
  const metrics = (await (await fetch(`${base}/api/software-factory`, { headers: { cookie: cookie() } })).json()).metrics;
  assert.equal(metrics.verifiedDeliveries, 1);
  assert.equal(metrics.stagingVerifications, 1);
  assert.equal(metrics.regressions, 1);
  assert.equal(metrics.rollbacks, 1);
  workers = [{ id: "worker", last_seen_at: new Date().toISOString(), capabilities: Object.fromEntries(["discover", "build", "simulate", "review", "deploy", "verify", "rollback", "evaluate"].map(stage => [stage, true])) }];
  projects = [{ ...project, automaticRelease: true, providerSupportsRelease: true, providerSupportsRollback: true, rehearsalRunIds: ["run-a", "run-b", "run-c"], rollbackVerifiedAt: new Date().toISOString() }];
  const ready = await (await fetch(`${base}/api/software-factory`, { headers: { cookie: cookie() } })).json();
  assert.equal(ready.readiness, "available");
  workers[0].last_seen_at = "2020-01-01T00:00:00Z";
  const stale = await (await fetch(`${base}/api/software-factory`, { headers: { cookie: cookie() } })).json();
  assert.equal(stale.readiness, "blocked");
  unavailable = true;
  const failure = await fetch(`${base}/api/software-factory`, { headers: { cookie: cookie() } });
  assert.equal(failure.status, 503);
  assert.doesNotMatch(await failure.text(), /private database failure/);
});
