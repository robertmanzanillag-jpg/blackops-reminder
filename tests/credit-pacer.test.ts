import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import {
  advanceCreditPacer, computePace, creditPacerView, decidePace, estimateFactoryOrder, fundableUnits, pacedOutputTokens, pacerDays, pacerSettings,
  taskEfficiency, taskTypeOfExecution, taskTypeOfKind, type PacerRow, type PacerSnapshot,
} from "../server/credit-pacer";
import { createCreditPacer, createCreditPacerSync, pacerAlertText } from "../server/credit-pacer-runtime";
import { creditPacerLine } from "../shared/credit-pacer-view";
import { applyFactoryOperatorEnvOverride } from "../server/software-factory-asistente-operator";
import { createSelfHealRunner, SELF_HEAL_REPOSITORY } from "../server/office-self-heal";
import { githubRecordId, sourceDigest as digest } from "../server/office-role-snapshots";
import { emptyCompanyState, type CompanyState } from "../shared/agent-company";
import { alertBody, alertTitle, notifyAlerts, pendingAlerts } from "../script/credit-pacer-notify";
import { CAPABILITY_PROMPT_VERSION, capabilityInputUnchanged, gradeCapabilityTriage, type CapabilityTrainingState } from "../server/office-capability-training";
import { auditSavedRole } from "../server/office-role-audits";
import type { RoleWorkJob } from "../server/office-role-work";

const DAY = 86_400_000, USD = 1_000_000;
const D0 = Date.parse("2026-11-19T00:00:00Z");
const grant = (rows: PacerRow[], extra: Partial<PacerSnapshot> = {}): PacerSnapshot => ({
  ledgerId: "openai-2026-11-19", grantMicroUsd: 200 * USD, observedAt: "2026-11-19T15:00:00.000Z", expiresAt: "2026-12-19T23:59:59.000Z", rows, ...extra });
const spend = (at: number, usd: number, kind = "office", status: PacerRow["status"] = "settled"): PacerRow => ({
  createdAt: new Date(at).toISOString(), consumer: kind.startsWith("factory") ? "factory" : "office", kind, status,
  reservedMicroUsd: Math.max(1, Math.round(usd * USD)), ...(status === "settled" ? { actualMicroUsd: Math.round(usd * USD) } : {}) });

test("allowance = remaining grant / days left (UTC days, min 1)", () => {
  const pace = computePace(grant([]), D0 + 16 * 3600_000);
  assert.equal(pace.daysLeft, 31);
  assert.equal(pace.allowanceMicroUsd, Math.floor(200 * USD / 31)); // $6.45
  assert.equal(pace.mode, "normal");
  // Last day: everything remaining is today's allowance.
  const last = computePace(grant([spend(D0 + 16 * 3600_000, 150)]), Date.parse("2026-12-19T10:00:00Z"));
  assert.equal(last.daysLeft, 1); assert.equal(last.allowanceMicroUsd, 50 * USD);
  // Reserved (unsettled) holds count as spend at their maximum.
  const held = computePace(grant([spend(D0 + 17 * 3600_000, 2, "factory", "reserved")]), D0 + 18 * 3600_000);
  assert.equal(held.spentTodayMicroUsd, 2 * USD);
});

test("overspending one day shrinks the next allowances and switches to soft mode until a day is back within", () => {
  const day1 = [spend(D0 + 16 * 3600_000, 20)];
  const today = computePace(grant(day1), D0 + 20 * 3600_000);
  assert.equal(today.mode, "soft"); // today > allowance
  const next = computePace(grant(day1), D0 + DAY + 3600_000);
  assert.equal(next.allowanceMicroUsd, Math.floor(180 * USD / 30)); // $6.00 < $6.45
  assert.equal(next.yesterdayOver, true); assert.equal(next.mode, "soft");
  const thirdRows = [...day1, spend(D0 + DAY + 3600_000, 1)];
  const third = computePace(grant(thirdRows), D0 + 2 * DAY + 3600_000);
  assert.equal(third.yesterdayOver, false); assert.equal(third.mode, "normal");
  const days = pacerDays(grant(thirdRows), D0 + 2 * DAY + 3600_000);
  assert.deepEqual(days.map(d => d.over), [true, false, false]);
});

test("hard stop only at grant exhaustion or expiry", () => {
  assert.equal(computePace(grant([spend(D0 + 16 * 3600_000, 200)]), D0 + DAY).mode, "hard");
  assert.equal(computePace(grant([]), Date.parse("2026-12-20T00:00:00Z")).mode, "hard");
  const hard = computePace(grant([spend(D0 + 16 * 3600_000, 200)]), D0 + DAY);
  assert.equal(decidePace(hard, { priority: "essential", estimateMicroUsd: 0 }).reason, "GRANT_EXHAUSTED");
  assert.equal(fundableUnits(hard, 1), 0);
});

test("priorities: essential always, standard within allowance, deferrable only in normal mode and inside its share", () => {
  const normal = computePace(grant([spend(D0 + 16 * 3600_000, 3)]), D0 + 17 * 3600_000);
  assert.equal(normal.mode, "normal");
  assert.equal(decidePace(normal, { priority: "standard", estimateMicroUsd: 3 * USD }).allowed, true);
  assert.equal(decidePace(normal, { priority: "standard", estimateMicroUsd: 4 * USD }).reason, "DAILY_ALLOWANCE_REACHED");
  assert.equal(decidePace(normal, { priority: "deferrable", estimateMicroUsd: 1 * USD }).allowed, true); // 4 <= 0.7 * 6.45
  assert.equal(decidePace(normal, { priority: "deferrable", estimateMicroUsd: 2 * USD }).reason, "DAILY_ALLOWANCE_RESERVED_FOR_PRIORITY");
  const soft = computePace(grant([spend(D0 + 16 * 3600_000, 20)]), D0 + DAY + 3600_000);
  assert.equal(decidePace(soft, { priority: "deferrable", estimateMicroUsd: 1 }).reason, "SOFT_MODE_DEFERRED");
  assert.equal(decidePace(soft, { priority: "standard", estimateMicroUsd: USD }).allowed, true);
  assert.equal(decidePace(soft, { priority: "essential", estimateMicroUsd: 100 * USD }).allowed, true);
  assert.equal(fundableUnits(normal, USD), 3);
  assert.equal(pacedOutputTokens(soft, 2048), 1536); assert.equal(pacedOutputTokens(normal, 2048), 2048); assert.equal(pacedOutputTokens(soft, 200), 200);
});

test("overspend streak notifies once per streak; thresholds once each", () => {
  const rows = [0, 1, 2].map(i => spend(D0 + i * DAY + 16 * 3600_000, 15));
  const snapshot = grant(rows), at = D0 + 2 * DAY + 20 * 3600_000;
  const first = advanceCreditPacer({ state: undefined, snapshot, now: at });
  assert.equal(first.pace.streak, 3);
  assert.deepEqual(first.alerts.map(a => a.kind).sort(), ["overspend_streak"]);
  assert.match(pacerAlertText(first.alerts[0]), /^Presupuesto API: 3 días seguidos por encima del límite diario\. .*Hoy: \$15\.00 de \$\d+\.\d\d\./);
  const again = advanceCreditPacer({ state: first.state, snapshot: grant([...rows, spend(D0 + 3 * DAY + 16 * 3600_000, 15)]), now: D0 + 3 * DAY + 20 * 3600_000 });
  assert.equal(again.pace.streak, 4); assert.equal(again.alerts.filter(a => a.kind === "overspend_streak").length, 0);
  // Break the streak, then a new streak of three notifies again.
  const later = [...rows, spend(D0 + 3 * DAY + 16 * 3600_000, 15), spend(D0 + 4 * DAY + 16 * 3600_000, 0.01), ...[5, 6, 7].map(i => spend(D0 + i * DAY + 16 * 3600_000, 12))];
  const second = advanceCreditPacer({ state: again.state, snapshot: grant(later), now: D0 + 7 * DAY + 20 * 3600_000 });
  assert.equal(second.alerts.filter(a => a.kind === "overspend_streak").length, 1);
  assert.equal(second.state.ledgers["openai-2026-11-19"].alerts.notifiedStreakStart, "2026-11-24");
  // 50% threshold (105 of 200 used) once, never repeated.
  const half = advanceCreditPacer({ state: second.state, snapshot: grant([...later, spend(D0 + 7 * DAY + 21 * 3600_000, 12)]), now: D0 + 7 * DAY + 22 * 3600_000 });
  assert.deepEqual(half.alerts.map(a => [a.kind, a.percent]), [["grant_threshold", 50]]);
  const repeat = advanceCreditPacer({ state: half.state, snapshot: grant([...later, spend(D0 + 7 * DAY + 21 * 3600_000, 12)]), now: D0 + 7 * DAY + 23 * 3600_000 });
  assert.equal(repeat.alerts.length, 0);
  assert.equal(pacerSettings({ OFFICE_CREDIT_OVERSPEND_ALERT_DAYS: "5" }).alertDays, 5);
  assert.throws(() => pacerSettings({ OFFICE_CREDIT_OVERSPEND_ALERT_DAYS: "1" }));
  assert.equal(advanceCreditPacer({ state: undefined, snapshot, now: at, settings: pacerSettings({ OFFICE_CREDIT_OVERSPEND_ALERT_DAYS: "4" }) }).alerts.length, 0);
});

test("cost per task type: factory from ledger kinds, office from samples; efficiency trend and order estimate", () => {
  assert.equal(taskTypeOfKind("factory-select"), "factory_select"); assert.equal(taskTypeOfKind("factory"), "factory_build");
  assert.equal(taskTypeOfExecution("review:abc"), "office_review"); assert.equal(taskTypeOfExecution(`${randomUUID()}:trained`), "capability_training");
  assert.equal(taskTypeOfExecution("role-academy:x:candidate"), "academy_pair"); assert.equal(taskTypeOfExecution("blackroom-academy:x:incumbent"), "blackroom_pair");
  const rows: PacerRow[] = [];
  for (let i = 0; i < 3; i++) rows.push(spend(D0 + i * DAY + 16 * 3600_000, 0.1, "factory-select"), spend(D0 + i * DAY + 16 * 3600_000, 0.3, "factory"), spend(D0 + i * DAY + 16 * 3600_000, 0.1, "factory-review"));
  let state: unknown;
  for (let i = 0; i < 3; i++) state = advanceCreditPacer({ state, snapshot: grant(rows), now: D0 + i * DAY + 18 * 3600_000,
    samples: [{ taskType: "capability_training", microUsd: 10_000 - i * 1000, outputTokens: 100, at: D0 + i * DAY + 17 * 3600_000 }] }).state;
  const ledger = (state as any).ledgers["openai-2026-11-19"];
  assert.equal(ledger.costs["2026-11-20"].factory_build.microUsd, 300_000);
  assert.equal(ledger.costs["2026-11-21"].capability_training.count, 1);
  assert.equal(estimateFactoryOrder(ledger, "2026-11-22"), 500_000);
  const efficiency = taskEfficiency(ledger, "2026-11-22");
  assert.equal(efficiency.find(e => e.taskType === "capability_training")?.avgMicroUsd, 9_000);
});

test("runtime pacer: caches reads, fails closed for self-heal, sync persists history and posts the alert once to the feed", async () => {
  let reads = 0, clock = D0 + 2 * DAY + 20 * 3600_000;
  const rows = [0, 1, 2].map(i => spend(D0 + i * DAY + 16 * 3600_000, 15));
  const pacer = createCreditPacer({ readSnapshot: async () => { reads++; return grant(rows); }, now: () => clock });
  await pacer.pace(); await pacer.allow("standard", "office_review"); assert.equal(reads, 1);
  clock += 31_000; await pacer.pace(); assert.equal(reads, 2);
  assert.equal((await pacer.allow("deferrable", "capability_training")).reason, "SOFT_MODE_DEFERRED");
  let execution: any = { roles: {}, tokens: { reservations: [] } };
  const company: CompanyState = emptyCompanyState();
  const council = { async updateOfficeExecution(change: any) { execution = change(structuredClone(execution), company); return execution; } };
  const sync = createCreditPacerSync({ council, pacer, now: () => clock });
  assert.equal((await sync()).alerts.length, 1);
  assert.equal((await sync()).alerts.length, 0);
  assert.equal(company.events.filter(e => e.text.startsWith("Presupuesto API: 3 días")).length, 1);
  const view = creditPacerView(execution.creditPacer, clock);
  assert.ok(view.present); assert.equal(view.mode, "soft"); assert.equal(view.streak, 3);
  assert.match(creditPacerLine(view)!, /^Presupuesto hoy: \$15\.00 de \$\d+\.\d\d · modo suave · 3 días seguidos por encima$/);
  assert.equal(creditPacerLine({ ...view, current: false }), null); assert.equal(creditPacerLine("x"), null);
  // Notification script: fixed text, one issue per alert id, existing ones are not duplicated.
  const alerts = pendingAlerts(JSON.stringify({ officeExecution: execution }), clock);
  assert.equal(alerts.length, 1);
  assert.match(alertTitle(alerts[0]), /^Presupuesto API: 3 días seguidos sobre el límite diario \[overspend:openai-2026-11-19:2026-11-19\]$/);
  assert.doesNotMatch(alertBody(alerts[0]), /http|token|owner/i);
  const posted: any[] = [];
  const fake = (async (url: string, init?: RequestInit) => {
    if (!init?.method) return new Response(JSON.stringify(posted.map(p => ({ title: p.title }))), { status: 200 });
    posted.push(JSON.parse(String(init.body))); return new Response("{}", { status: 201 });
  }) as typeof fetch;
  assert.deepEqual(await notifyAlerts(alerts, { token: "t", repository: "o/r", fetch: fake }), { created: 1, existing: 0 });
  assert.deepEqual(await notifyAlerts(alerts, { token: "t", repository: "o/r", fetch: fake }), { created: 0, existing: 1 });
  assert.deepEqual(posted[0].labels, ["budget"]);
});

test("self-heal runner asks the pacer: orders while funded, none when the pacer read fails", async () => {
  const repoId = githubRecordId("repository", SELF_HEAL_REPOSITORY), T = Date.parse("2026-11-20T09:00:00Z");
  const job = { id: "job-1", role: "github", status: "completed", completedAt: new Date(T).toISOString(), artifactId: "a".repeat(64),
    audit: { completeCoverage: true, findings: [{ code: "FAILING_DEFAULT_BRANCH", recordIds: [repoId] }] }, source: { rows: [{ id: repoId, repo: SELF_HEAL_REPOSITORY }] } };
  for (const [fundable, expected] of [[async () => { throw Error("x"); }, 0], [async () => 0, 0], [async () => 5, 1]] as const) {
    let execution: any = { roles: {}, tokens: { reservations: [] }, roleWork: { jobs: [job] } };
    const council = { async updateOfficeExecution(change: any) { execution = change(structuredClone(execution), emptyCompanyState()); return execution; } };
    const runner = createSelfHealRunner({ council, owner: "owner", maxPerDay: Number.POSITIVE_INFINITY, fundableOrders: fundable, now: () => T + 1000 });
    assert.deepEqual(await runner.tick(), { created: expected });
  }
});

test("FACTORY_AUTO_ADMIT_SYSTEM_ORDERS only sets autoAdmit.systemOrders when autoAdmit exists", () => {
  const base = { owner: "o", maxDraftPullRequestsPerDay: 5, autoAdmit: { enabled: true, since: "2026-11-01T00:00:00Z", maxPerDay: 5 } };
  assert.deepEqual(applyFactoryOperatorEnvOverride(base, { FACTORY_AUTO_ADMIT_SYSTEM_ORDERS: "true" }), { ...base, autoAdmit: { ...base.autoAdmit, systemOrders: true } });
  assert.deepEqual(applyFactoryOperatorEnvOverride({ ...base, autoAdmit: { ...base.autoAdmit, systemOrders: true } }, { FACTORY_AUTO_ADMIT_SYSTEM_ORDERS: "false" }).autoAdmit?.systemOrders, false);
  for (const value of [undefined, "", "yes", "TRUE", "1"]) assert.equal(applyFactoryOperatorEnvOverride(base, { FACTORY_AUTO_ADMIT_SYSTEM_ORDERS: value }), base);
  // Never enables automatic admission, never touches any other field.
  const disabled = { owner: "o", maxDraftPullRequestsPerDay: 5 } as { owner: string; maxDraftPullRequestsPerDay: number; autoAdmit?: { systemOrders?: boolean } };
  assert.equal(applyFactoryOperatorEnvOverride(disabled, { FACTORY_AUTO_ADMIT_SYSTEM_ORDERS: "true" }), disabled);
  const changed = applyFactoryOperatorEnvOverride(base, { FACTORY_AUTO_ADMIT_SYSTEM_ORDERS: "true", maxDraftPullRequestsPerDay: "50" } as any);
  assert.equal(changed.maxDraftPullRequestsPerDay, 5); assert.equal(changed.autoAdmit.enabled, true); assert.equal(changed.autoAdmit.maxPerDay, 5);
});

test("capability training skips a paid run when the audit inputs equal the last verified passing run", () => {
  const owner = "owner", at = Date.parse("2026-11-20T01:00:00Z");
  const job = (t: number, id = randomUUID()): RoleWorkJob => {
    const sourceBody = { version: 1 as const, role: "control" as const, ownerKey: digest(owner), observedAt: new Date(t).toISOString(), total: 1, rows: [{ id: "permission1", scope: "publish", level: "autonomous", risk: "high", enabled: true }] };
    const source = { ...sourceBody, sourceDigest: digest(sourceBody) }, audit = auditSavedRole("control", source, owner, t);
    const j: RoleWorkJob = { id, fence: randomUUID(), role: "control", generation: 1, slot: new Date(t).toISOString().slice(0, 10), startedAt: new Date(t).toISOString(), expiresAt: new Date(t + 60000).toISOString(), completedAt: new Date(t).toISOString(), status: "completed", source, audit } as RoleWorkJob;
    j.artifactId = digest({ id: j.id, role: j.role, generation: 1, fence: j.fence, source, audit }); return j;
  };
  const first = job(at - DAY), today = job(at);
  const issueCodes = [...new Set(first.audit!.findings.map(f => f.code))].sort();
  const task = { id: first.id, role: "control" as const, evidenceIds: [first.id, first.artifactId!], issueCodes, sourceBlocked: false };
  const text = ["review_source", "review_findings", "record_audit"].map(decision => JSON.stringify({ scope: "source-triage-v1", evidenceIds: task.evidenceIds, issueCodes, decision }))
    .find(candidate => gradeCapabilityTriage(task, candidate).passed)!;
  const state = (passed: boolean, status = "active") => ({ version: 1, ownerKey: digest(owner),
    policies: [{ version: "p1", promptVersion: CAPABILITY_PROMPT_VERSION, role: "control", generation: 1, parentVersion: null, lessons: [], trainingRunId: null, status }],
    runs: [{ id: randomUUID(), fence: randomUUID(), promptVersion: CAPABILITY_PROMPT_VERSION, role: "control", generation: 1, kind: "production", policyVersion: "p1", task, artifactId: "c".repeat(64),
      startedAt: new Date(at - DAY + 1000).toISOString(), expiresAt: new Date(at - DAY + 361000).toISOString(), status: "completed",
      trained: { result: { text: passed ? text : "{}", sessionId: "resp_1", provider: "openai", model: "m", completedAt: new Date(at - DAY + 2000).toISOString(), usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } },
        cost: { receiptId: "r", executionId: "x", responseId: "resp_1", model: "m", usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, currency: "USD", usd: 0.001 }, durationMs: 1 } }] }) as unknown as CapabilityTrainingState;
  assert.equal(capabilityInputUnchanged(state(true), today, at + 1000), true);
  assert.equal(capabilityInputUnchanged(state(false), today, at + 1000), false); // last answer failed: run again
  assert.equal(capabilityInputUnchanged(state(true, "superseded"), today, at + 1000), false); // policy changed
  assert.equal(capabilityInputUnchanged(state(true), first, at + 1000), false); // same job is never "unchanged"
});

test("workflow defaults: self-heal on, no fixed order cap, system orders admitted, notification step scoped", async () => {
  const { readFile } = await import("node:fs/promises");
  const workflow = await readFile(new URL("../.github/workflows/office-worker-cloud.yml", import.meta.url), "utf8");
  assert.equal(workflow.match(/OFFICE_SELF_HEAL_ENABLED: \$\{\{ vars\.OFFICE_SELF_HEAL_ENABLED \|\| 'true' \}\}/g)?.length, 2);
  assert.equal(workflow.match(/OFFICE_SELF_HEAL_MAX_ORDERS_PER_DAY: \$\{\{ vars\.OFFICE_SELF_HEAL_MAX_ORDERS_PER_DAY \}\}/g)?.length, 2);
  assert.match(workflow, /^env:\n  FACTORY_AUTO_ADMIT_SYSTEM_ORDERS: \$\{\{ vars\.FACTORY_AUTO_ADMIT_SYSTEM_ORDERS \|\| 'true' \}\}$/m);
  assert.match(workflow, /OFFICE_CREDIT_OVERSPEND_ALERT_DAYS: \$\{\{ vars\.OFFICE_CREDIT_OVERSPEND_ALERT_DAYS \|\| '3' \}\}/);
  assert.equal(workflow.match(/^      issues: write$/gm)?.length, 1);
  const notify = workflow.split(/^      - /m).find(step => step.startsWith("name: Notify the owner of credit pacing alerts"))!;
  assert.match(notify, /continue-on-error: true/); assert.match(notify, /GH_TOKEN: \$\{\{ github\.token \}\}/);
  assert.doesNotMatch(notify, /OPENAI_API_KEY|OFFICE_GITHUB_TOKEN/);
});
