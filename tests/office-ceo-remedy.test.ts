import assert from "node:assert/strict";
import test from "node:test";
import { classifyCouncil, classifyKong, classifyRole, createCeoRemedyRunner, markDigestSent, planCeoRemedy, summarizeRoleWork, type RoleSummary } from "../server/office-ceo-remedy";
import { shapeCeoRemedy } from "../script/office-status-shape";

const NOW = Date.parse("2026-11-26T20:00:00Z");
const company = () => ({ version: 1, careers: {}, trainees: [], orders: [], events: [], retiredCareers: [], academyJobs: [] }) as any;
const blocked = (role: string, codes: string[], reason?: string): RoleSummary => ({ role, status: "blocked", codes, reason });
const today: RoleSummary[] = [
  blocked("control", ["NO_SOURCE_RECORDS"]), blocked("revenue", ["NO_SOURCE_RECORDS"]),
  blocked("dropshipping", ["NO_RECORDS", "SOURCE_MISSING"]), blocked("clippers", ["COLLECTED_METRICS_ONLY", "PLANS_NOT_EXECUTION", "SOURCE_LIMIT", "SOURCE_STALE"]),
  { role: "code", status: "completed", codes: ["PR_STALE"] },
];

test("classifies the causes of today's blocked roles", () => {
  assert.equal(classifyRole(today[0])!.cause, "missing_integration");
  assert.equal(classifyRole(today[2])!.cause, "missing_integration");
  assert.equal(classifyRole(today[3])!.cause, "stale_source");
  assert.equal(classifyRole(today[4]), undefined);
  assert.equal(classifyRole(blocked("legal", ["WEIRD_CODE"]))!.cause, "code_bug");
  assert.equal(classifyRole(blocked("news", [], "web_export_unverified"))!.cause, "code_bug");
  assert.equal(classifyRole(blocked("news", ["CAPABILITY_UNAVAILABLE"]))!.cause, "config");
});

test("council off on the web by design is not an outage while the worker runs rounds", () => {
  assert.equal(classifyCouncil({ webEnabled: false, lastCycleAt: new Date(NOW - 10 * 60_000).toISOString() }, NOW), undefined);
  assert.equal(classifyCouncil({ webEnabled: false, lastCycleAt: new Date(NOW - 3 * 3600_000).toISOString() }, NOW)!.cause, "config");
  assert.equal(classifyCouncil({ webEnabled: false, lastCycleAt: null, lastCycleError: "x" }, NOW)!.cause, "code_bug");
});

test("KONG attention never becomes a BlackOps factory order", () => {
  const r = planCeoRemedy({ state: undefined, company: company(), roles: [], kong: [{ id: "genre_classifier", name: "Clasificador", state: "attention", blocker: "La última ejecución registrada falló" }, { id: "x", name: "X", state: "healthy" }], now: NOW });
  assert.equal(r.created.length, 0);
  assert.equal(r.state.items.length, 1);
  assert.match(r.state.items[0].line!, /kong-nightlife/);
  assert.equal(classifyKong({ id: "a", name: "A", state: "attention", blocker: "Hay bugs activos" })!.cause, "code_bug");
});

test("code bugs make bounded, deduped orders for an engineering role", () => {
  const roles = ["legal", "news", "portfolio", "automations"].map(r => blocked(r, ["WEIRD_" + r.toUpperCase()]));
  const first = planCeoRemedy({ state: undefined, company: company(), roles, now: NOW });
  assert.equal(first.created.length, 2); // daily cap
  assert.ok(first.created.every(o => o.id.startsWith("ord-ceo-") && o.assignees[0].agentId === "code" && o.text.length < 500 && !/kong/i.test(o.text)));
  const again = planCeoRemedy({ state: first.state, company: first.company, roles, now: NOW + 60_000 });
  assert.equal(again.created.length, 0);
  assert.equal(again.company.orders.length, 2);
  const nextDay = planCeoRemedy({ state: again.state, company: again.company, roles, now: NOW + 86400_000 });
  assert.equal(nextDay.created.length, 1); // open cap 3
  assert.ok(nextDay.state.items.some(i => i.line && /cupo/.test(i.line)));
});

test("Robert gets one consolidated digest per day and a 'resuelto' when a line clears", () => {
  const a = planCeoRemedy({ state: undefined, company: company(), roles: today, now: NOW });
  assert.ok(a.state.outbox);
  const text = a.state.outbox!.text;
  assert.match(text, /Pendientes de Robert/);
  assert.match(text, /Control/); assert.match(text, /Revenue/); assert.match(text, /Dropshipping/);
  assert.doesNotMatch(text, /• Clippers/); // stale source is re-warmed first, escalated after 24 h
  const sent = markDigestSent(a.state, a.state.outbox!);
  const sameDay = planCeoRemedy({ state: sent, company: a.company, roles: today, now: NOW + 3600_000 });
  assert.equal(sameDay.state.outbox, null);
  const nextDayNoChange = planCeoRemedy({ state: sameDay.state, company: a.company, roles: today.slice(0, 3), now: NOW + 86400_000 - 3600_000 });
  assert.equal(nextDayNoChange.state.outbox, null); // next UTC day, same lines: no repeat message
  const cleared = planCeoRemedy({ state: sent, company: a.company, roles: today.filter(r => r.role !== "control"), now: NOW + 86400_000 });
  assert.match(cleared.state.outbox!.text, /Control: .*resuelto|✓ Control — resuelto/);
  const later = planCeoRemedy({ state: cleared.state, company: a.company, roles: today, now: NOW + 2 * 86400_000 });
  assert.match(later.state.outbox!.text, /Clippers/); // escalated after 24 h stale
});

test("runner commits state and marks the digest only after a confirmed delivery", async () => {
  let execution: any = { roleWork: { jobs: [{ role: "control", slot: "2026-11-26", status: "blocked", audit: { findings: [{ code: "NO_SOURCE_RECORDS" }] } }] } };
  const c = company();
  const council = { async updateOfficeExecution(change: any) { execution = change(structuredClone(execution), c); return execution; } };
  const messages: string[] = [];
  const runner = createCeoRemedyRunner({ council, deliver: async t => { messages.push(t); return true; }, now: () => NOW });
  await runner.tick(); await runner.tick();
  assert.equal(messages.length, 1);
  assert.equal(execution.ceoRemedy.digest.lastSentDay, "2026-11-26");
  const failing = createCeoRemedyRunner({ council: { async updateOfficeExecution(change: any) { return change({ roleWork: execution.roleWork }, c); } }, deliver: async () => false, now: () => NOW });
  assert.equal((await failing.tick()).sent, false);
});

test("summarizeRoleWork keeps the latest audit per role", () => {
  const s = summarizeRoleWork({ jobs: [{ role: "control", slot: "2026-11-25", status: "completed" }, { role: "control", slot: "2026-11-26", status: "blocked", webAudit: { diagnostics: ["NO_RECORDS"] } }] });
  assert.deepEqual(s, [{ role: "control", status: "blocked", reason: null, codes: ["NO_RECORDS"] }]);
});

test("office-status shape prints only enums and ids", () => {
  const r = planCeoRemedy({ state: undefined, company: company(), roles: today, kong: [{ id: "creative_insights", name: "Insights <b>", state: "attention", blocker: "secret text falló" }], now: NOW });
  const out = JSON.stringify(shapeCeoRemedy(r.state));
  assert.doesNotMatch(out, /secret|Insights|assistant_permissions/);
  assert.match(out, /kong:creative_insights/);
});
