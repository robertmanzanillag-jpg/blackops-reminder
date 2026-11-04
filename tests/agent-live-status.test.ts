import test from "node:test";
import assert from "node:assert/strict";
import { agentProbes, runProbe, summarizeProbe } from "../client/src/lib/agent-live-status";

const ok = (body: unknown) => ({ ok: true as const, status: 200, body });

test("every probe uses a GET endpoint that does not run a full scan", () => {
  const scanOnGet = ["/api/app-qa-agent/status", "/api/cybersecurity-agent/status"];
  for (const [agentId, probe] of Object.entries(agentProbes)) {
    assert.ok(probe.url.startsWith("/api/"), `${agentId} probes an API route`);
    assert.ok(!scanOnGet.includes(probe.url), `${agentId} must not poll a scanning endpoint`);
    assert.ok(probe.intervalMs >= 60_000, `${agentId} polls at most once per minute`);
  }
});

test("missing result, network failure, auth and server errors never read as working", () => {
  const probe = agentProbes.automations;
  assert.equal(summarizeProbe(probe, undefined).state, "checking");
  assert.equal(summarizeProbe(probe, { ok: false, status: 0, body: null, networkError: true }).state, "offline");
  assert.equal(summarizeProbe(probe, { ok: false, status: 401, body: { error: "auth" } }).state, "needs-setup");
  assert.equal(summarizeProbe(probe, { ok: false, status: 500, body: { error: "boom" } }).state, "error");
  assert.equal(summarizeProbe(probe, ok({ error: "Failed" })).state, "error");
});

test("readiness checks list what is missing", () => {
  const status = summarizeProbe(agentProbes.revenue, ok({ ready: false, checks: { accountSeparated: true, signedWebhook: false, telegram: false } }));
  assert.equal(status.state, "needs-setup");
  assert.match(status.detail ?? "", /signedWebhook, telegram/);
  assert.equal(summarizeProbe(agentProbes.ceo, ok({ ready: true })).state, "working");
});

test("automations: failures beat activity, zero active needs setup", () => {
  assert.equal(summarizeProbe(agentProbes.automations, ok({ active: 3, failed: 1 })).state, "error");
  assert.equal(summarizeProbe(agentProbes.automations, ok({ active: 0, failed: 0 })).state, "needs-setup");
  const working = summarizeProbe(agentProbes.automations, ok({ active: 2, failed: 0, pendingApproval: 1 }));
  assert.equal(working.state, "working");
  assert.equal(working.label, "2 activas");
  assert.equal(working.detail, "1 aprobacion pendiente");
});

test("calendar, github, dropshipping, marketing, radio and clippers shapes", () => {
  assert.equal(summarizeProbe(agentProbes.assistant, ok({ google: false, zoho: false })).state, "needs-setup");
  assert.equal(summarizeProbe(agentProbes.assistant, ok({ google: true, zoho: false })).detail, "Google");
  assert.equal(summarizeProbe(agentProbes.github, ok({ connected: true, user: { login: "rob" } })).detail, "@rob");
  assert.equal(summarizeProbe(agentProbes.github, ok({ connected: false })).state, "needs-setup");
  assert.equal(summarizeProbe(agentProbes.dropshipping, ok({ launchReadiness: { status: "blocked_safety" } })).state, "error");
  assert.equal(summarizeProbe(agentProbes.dropshipping, ok({ launchReadiness: { status: "blocked_needs_accounts" } })).state, "needs-setup");
  assert.equal(summarizeProbe(agentProbes["marketing-cmo"], ok({ capacity: { activeClients: 5 } })).detail, "5 clientes");
  assert.equal(summarizeProbe(agentProbes.radio, ok([])).state, "needs-setup");
  assert.equal(summarizeProbe(agentProbes.radio, ok([{}, {}])).detail, "2 eventos proximos");
  assert.equal(summarizeProbe(agentProbes.clippers, ok({ status: "blocked", nextAction: "Conectar Metricool" })).state, "needs-setup");
});

test("developer health and legal escalate critical findings", () => {
  const health = (summary: Record<string, number>) => ok({ summary });
  assert.equal(summarizeProbe(agentProbes.cybersecurity, health({ totalApps: 0 })).state, "needs-setup");
  assert.equal(summarizeProbe(agentProbes.cybersecurity, health({ totalApps: 4, criticalIncidents: 1 })).state, "error");
  assert.equal(summarizeProbe(agentProbes["app-qa"], health({ totalApps: 4, down: 1 })).label, "1 app caida");
  const watching = summarizeProbe(agentProbes.control, health({ totalApps: 4, openIncidents: 2 }));
  assert.equal(watching.state, "working");
  assert.equal(watching.label, "Vigilando 2 incidentes");
  assert.equal(summarizeProbe(agentProbes.legal, ok({ totalTargets: 3, summary: { critico: 2, revisar: 1 } })).state, "error");
  assert.equal(summarizeProbe(agentProbes.legal, ok({ totalTargets: 3, summary: { critico: 0, revisar: 0 } })).label, "Revisando 3 apps");
});

test("runProbe maps fetch outcomes without throwing", async () => {
  const fake = (response: Response | Error) => (async () => {
    if (response instanceof Error) throw response;
    return response;
  }) as unknown as typeof fetch;
  assert.deepEqual(await runProbe("/api/x", fake(new Response(JSON.stringify({ a: 1 }), { status: 200 }))), { ok: true, status: 200, body: { a: 1 } });
  assert.deepEqual(await runProbe("/api/x", fake(new Response("not json", { status: 502 }))), { ok: false, status: 502, body: null });
  assert.deepEqual(await runProbe("/api/x", fake(new Error("offline"))), { ok: false, status: 0, body: null, networkError: true });
});
