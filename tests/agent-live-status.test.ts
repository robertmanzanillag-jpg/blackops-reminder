import test from "node:test";
import assert from "node:assert/strict";
import { agentProbes, runProbe, summarizeProbe } from "../client/src/lib/agent-live-status";

// Fixtures mirror the real server responses:
// - CEO: server/ceo-readiness.ts buildCeoReadinessReport -> { ready, status, checks: [{ id, label, status }] }
// - Revenue: server/revenue-stripe-routes.ts -> { ready, checks: { name: boolean } }
// - Clippers: server/clippers-runtime-status.ts -> { status, nextAction: { code, message }, configurationBlockers }
// - Dropshipping: server/dropshipping-ceo.ts getDropshippingLaunchReadiness -> { launchReadiness, snapshot }
// - Marketing: server/marketing-command-center.ts -> { globalScorecard: { clients, readyClients, approvalsNeeded } }
// - Automations: GET /api/automation-runs -> [{ status, startedAt }]
const ok = (body: unknown) => ({ ok: true as const, status: 200, body });
const NOW = Date.parse("2026-11-04T12:00:00Z");

test("every probe is read-only: no scan-on-GET or seeding endpoints", () => {
  const unsafeOnGet = ["/api/app-qa-agent/status", "/api/cybersecurity-agent/status", "/api/automation-manager/summary", "/api/automations"];
  for (const [agentId, probe] of Object.entries(agentProbes)) {
    assert.ok(probe.url.startsWith("/api/"), `${agentId} probes an API route`);
    assert.ok(!unsafeOnGet.includes(probe.url.split("?")[0]), `${agentId} must not poll ${probe.url}`);
    assert.ok(probe.intervalMs >= 60_000, `${agentId} polls at most once per minute`);
  }
});

test("missing, failed, unauthorized or non-JSON responses never read as working", () => {
  for (const probe of Object.values(agentProbes)) {
    assert.equal(summarizeProbe(probe, undefined).state, "checking");
    assert.equal(summarizeProbe(probe, { ok: false, status: 0, body: null, networkError: true }).state, "offline");
    assert.equal(summarizeProbe(probe, { ok: false, status: 401, body: { error: "auth" } }).label, "Requiere sesion");
    assert.equal(summarizeProbe(probe, { ok: false, status: 403, body: { error: "owner" } }).label, "Sin permiso");
    assert.equal(summarizeProbe(probe, { ok: false, status: 500, body: { error: "boom" } }).state, "error");
    assert.equal(summarizeProbe(probe, ok({ error: "Failed" })).state, "error");
    assert.notEqual(summarizeProbe(probe, ok(null)).state, "working", `${probe.kind}: empty body`);
    assert.notEqual(summarizeProbe(probe, ok({ unexpected: true }), NOW).state, "working", `${probe.kind}: unknown shape`);
  }
});

test("CEO readiness uses the checks array and treats warnings as operating", () => {
  const checks = [
    { id: "auth", label: "Auth", status: "warning" },
    { id: "telegram", label: "Telegram", status: "blocked" },
    { id: "ai", label: "AI", status: "ready" },
  ];
  const blocked = summarizeProbe(agentProbes.ceo, ok({ ready: false, status: "blocked", checks }));
  assert.equal(blocked.state, "needs-setup");
  assert.equal(blocked.detail, "Pendiente: Auth, Telegram");
  const warning = summarizeProbe(agentProbes.ceo, ok({ ready: false, status: "warning", checks: checks.slice(0, 1) }));
  assert.equal(warning.state, "working");
  assert.equal(warning.label, "Operativo con avisos");
  assert.equal(summarizeProbe(agentProbes.ceo, ok({ ready: true, status: "ready", checks: [] })).state, "working");
});

test("revenue readiness lists missing boolean checks", () => {
  const status = summarizeProbe(agentProbes.revenue, ok({ ready: false, checks: { accountSeparated: true, signedWebhook: false, telegram: false } }));
  assert.equal(status.state, "needs-setup");
  assert.equal(status.detail, "Pendiente: signedWebhook, telegram");
});

test("clippers: never_run and blocked are not working; nextAction message is shown", () => {
  const next = { code: "configure", message: "Conectar Metricool" };
  const neverRun = summarizeProbe(agentProbes.clippers, ok({ status: "never_run", nextAction: next, configurationBlockers: [] }));
  assert.equal(neverRun.state, "needs-setup");
  assert.equal(neverRun.detail, "Conectar Metricool");
  assert.equal(summarizeProbe(agentProbes.clippers, ok({ status: "blocked", nextAction: next, configurationBlockers: ["x"] })).state, "needs-setup");
  assert.equal(summarizeProbe(agentProbes.clippers, ok({ status: "completed", nextAction: next, configurationBlockers: ["x"] })).state, "needs-setup");
  assert.equal(summarizeProbe(agentProbes.clippers, ok({ status: "completed", nextAction: next, configurationBlockers: [] })).state, "working");
  assert.equal(summarizeProbe(agentProbes.clippers, ok({ status: "running", nextAction: next, configurationBlockers: [] })).label, "Procesando clips");
});

test("dropshipping: only a Profit Guard spend pause is a red stop", () => {
  const lr = (status: string, profitGuard = "ok") => ok({ launchReadiness: { status, summary: "x" }, snapshot: { profitGuard: { status: profitGuard } } });
  assert.equal(summarizeProbe(agentProbes.dropshipping, lr("blocked_safety", "pause_spend")).state, "error");
  assert.equal(summarizeProbe(agentProbes.dropshipping, lr("blocked_safety")).label, "Falta producto o supplier");
  assert.equal(summarizeProbe(agentProbes.dropshipping, lr("blocked_needs_accounts")).state, "needs-setup");
  assert.equal(summarizeProbe(agentProbes.dropshipping, lr("pre_account_ready")).state, "working");
  assert.equal(summarizeProbe(agentProbes.dropshipping, lr("something_new")).state, "error");
});

test("marketing reports ready clients from the scorecard", () => {
  const status = summarizeProbe(agentProbes["marketing-cmo"], ok({ globalScorecard: { clients: 6, readyClients: 4, approvalsNeeded: 2 } }));
  assert.equal(status.label, "4/6 clientes listos");
  assert.equal(status.detail, "2 aprobaciones pendientes");
  assert.equal(summarizeProbe(agentProbes["marketing-cmo"], ok({ globalScorecard: { clients: 0 } })).state, "needs-setup");
});

test("automations read recent runs, not the seeding summary", () => {
  const run = (status: string, hoursAgo: number) => ({ status, startedAt: new Date(NOW - hoursAgo * 3_600_000).toISOString() });
  assert.equal(summarizeProbe(agentProbes.automations, ok([run("success", 1), run("failed", 2)]), NOW).state, "error");
  assert.equal(summarizeProbe(agentProbes.automations, ok([run("success", 40)]), NOW).state, "offline");
  assert.equal(summarizeProbe(agentProbes.automations, ok([run("skipped", 1), run("skipped", 2)]), NOW).state, "offline");
  const working = summarizeProbe(agentProbes.automations, ok([run("success", 1), run("success", 3), run("pending_approval", 4)]), NOW);
  assert.equal(working.state, "working");
  assert.equal(working.label, "2 corridas en 24 h");
  assert.equal(working.detail, "1 aprobacion pendiente");
});

test("calendar, github, portfolio and radio", () => {
  assert.equal(summarizeProbe(agentProbes.assistant, ok({ google: false, zoho: false })).state, "needs-setup");
  assert.equal(summarizeProbe(agentProbes.assistant, ok({ google: true, zoho: false })).detail, "Google");
  assert.equal(summarizeProbe(agentProbes.github, ok({ connected: true, user: { login: "rob" } })).detail, "@rob");
  assert.equal(summarizeProbe(agentProbes.github, ok({ connected: false })).state, "needs-setup");
  assert.equal(summarizeProbe(agentProbes.portfolio, ok({ totalValue: 0, distribution: [] })).state, "needs-setup");
  assert.equal(summarizeProbe(agentProbes.portfolio, ok({ totalValue: 10, distribution: [{ type: "stock" }] })).state, "working");
  assert.equal(summarizeProbe(agentProbes.radio, ok([])).state, "offline");
  assert.equal(summarizeProbe(agentProbes.radio, ok([{}, {}])).detail, "2 eventos proximos");
});

test("developer health and legal findings ask for attention without marking the agent broken", () => {
  const health = (summary: Record<string, number>) => ok({ summary });
  assert.equal(summarizeProbe(agentProbes.cybersecurity, health({ totalApps: 0 })).state, "needs-setup");
  assert.equal(summarizeProbe(agentProbes.cybersecurity, health({ totalApps: 4, criticalIncidents: 1 })).state, "needs-setup");
  assert.equal(summarizeProbe(agentProbes["app-qa"], health({ totalApps: 4, down: 1 })).label, "1 app caida");
  assert.equal(summarizeProbe(agentProbes.control, health({ totalApps: 4, unknown: 4 })).label, "Apps sin chequeos de salud");
  assert.equal(summarizeProbe(agentProbes.control, health({ totalApps: 4, degraded: 1 })).state, "needs-setup");
  const watching = summarizeProbe(agentProbes.control, health({ totalApps: 4, healthy: 4, openIncidents: 2 }));
  assert.equal(watching.state, "working");
  assert.equal(watching.label, "2 incidentes abiertos");
  assert.match(summarizeProbe(agentProbes["app-qa"], health({ totalApps: 4, healthy: 4 })).detail ?? "", /bajo demanda/);
  const legal = (body: Record<string, unknown>) => ok({ totalTargets: 3, githubConnected: true, summary: { critico: 0, revisar: 0 }, ...body });
  assert.equal(summarizeProbe(agentProbes.legal, legal({ summary: { critico: 2, revisar: 1 } })).state, "needs-setup");
  assert.equal(summarizeProbe(agentProbes.legal, legal({ githubConnected: false })).label, "GitHub sin conectar");
  assert.equal(summarizeProbe(agentProbes.legal, legal({})).label, "Revisando 3 apps");
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
