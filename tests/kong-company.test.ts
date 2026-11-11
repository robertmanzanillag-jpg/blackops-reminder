import test from "node:test";
import assert from "node:assert/strict";
import { emptyCompanyState } from "../shared/agent-company";
import { advanceKongCompany } from "../server/kong-company";
import { createAgentCouncil } from "../server/agent-council";
import { emptyCouncilState, parseCouncilState } from "../shared/agent-council";
import type { OfficeKongAuditResult } from "../server/office-kong";
const NOW = Date.parse("2026-11-05T12:00:00Z");
const at = (minutes: number) => new Date(NOW + minutes * 60000).toISOString();
function evidence(): OfficeKongAuditResult["evidence"] {
  return { generatedAt: at(0), citySnapshotCheckedAt: at(0), cityAgentsEnabled: true, cityCoverageComplete: false,
    agents: [{ id: "venues", name: "Venues", kind: "department", owner: "CEO", responsibility: "Fichas", state: "healthy", lastRunAt: at(-1), nextRunAt: at(10), blocker: null, nextAction: "Esperar", issues: [] }],
    cities: [{ id: "miami", name: "Miami", countryCode: "US", timeZone: "America/New_York", currency: "USD", status: "healthy", categories: [{ category: "clubs", state: "healthy", lastRunAt: at(-1), lastSuccessAt: at(-1), lastStartedAt: at(-2), nextRunAt: at(10), intervalMs: 3600000, issues: [], evidence: "persisted", recordedFailure: false }] }] };
}
const start = () => ({ company: emptyCompanyState(), evidenceAt: {}, evidence: evidence(), now: NOW });
test("KONG credits only new completed results, not repeated snapshots", () => {
  const first = advanceKongCompany(start());
  assert.equal(first.company.careers["kong:venues"].points, 10);
  assert.equal(first.company.careers["kong-city:miami:clubs"].points, 10);
  const repeated = advanceKongCompany({ ...start(), company: first.company, evidenceAt: first.evidenceAt });
  assert.deepEqual(repeated.company, first.company);
  const newer = evidence(); newer.cities[0].categories[0].lastRunAt = at(0); newer.cities[0].categories[0].lastSuccessAt = at(0);
  const next = advanceKongCompany({ ...start(), company: first.company, evidenceAt: first.evidenceAt, evidence: newer });
  assert.equal(next.company.careers["kong-city:miami:clubs"].points, 20);
  assert.equal(next.company.careers["kong:venues"].points, 10);
});
test("stale or unavailable observations cannot earn points or penalize agents", () => {
  const first = advanceKongCompany(start());
  for (const input of [{ evidence: undefined, now: NOW }, { evidence: evidence(), now: NOW + 6 * 60000 }]) {
    const result = advanceKongCompany({ company: first.company, evidenceAt: first.evidenceAt, ...input });
    assert.deepEqual(result.company, first.company);
    assert.deepEqual(result.statuses, {});
    assert.equal(result.collaboration.verified, false);
  }
});
test("running leases have live activity but earn no completion credit", () => {
  const snapshot = evidence();
  snapshot.agents[0].state = "running";
  snapshot.cities[0].categories[0] = { ...snapshot.cities[0].categories[0], state: "running", lastStartedAt: at(0), leaseUntil: at(2) };
  const result = advanceKongCompany({ ...start(), evidence: snapshot });
  assert.equal(result.statuses["kong-city:miami:clubs"].state, "working");
  assert.equal(result.company.careers["kong-city:miami:clubs"].points, 0);
  assert.equal(result.statuses["kong:venues"].state, "offline");
  assert.equal(result.company.careers["kong:venues"], undefined);
});
test("failure discussions are evidence-backed and a repeated failure is scored once", () => {
  const snapshot = evidence();
  snapshot.cities[0].categories[0] = { ...snapshot.cities[0].categories[0], state: "attention", recordedFailure: true, lastSuccessAt: at(-60), attemptsSinceSuccess: 2 };
  const first = advanceKongCompany({ ...start(), evidence: snapshot });
  assert.equal(first.collaboration.totalFindings, 1);
  assert.equal(first.collaboration.exchanges[0].proposal.action, "review_reassignment");
  const again = advanceKongCompany({ ...start(), evidence: snapshot, company: first.company, evidenceAt: first.evidenceAt });
  assert.deepEqual(again.company, first.company);
  assert.deepEqual(again.collaboration, first.collaboration);
});
test("council persists KONG isolation and scoped orders survive restart", async () => {
  let raw: string | null = null;
  let now = NOW;
  const deps = { now: () => now, userId: () => "owner", readState: async () => raw, writeState: async (value: string) => { raw = value; }, collect: async () => ({}), collectKongEvidence: async () => evidence(), submitProposal: async () => "proposal", getPendingActionStatus: async () => null, fetchLatestRelease: async () => null, log: () => {} };
  const council = createAgentCouncil(deps);
  await council.runCycle();
  let view = await council.view();
  assert.equal(view.company.careers["kong:venues"], undefined);
  assert.equal(view.kongCompany.careers["kong:venues"].points, 10);
  await council.placeOrder("Revisar clubs Miami", "kong");
  view = await createAgentCouncil(deps).view();
  assert.equal(view.company.orders.length, 0);
  assert.equal(view.kongCompany.orders.length, 1);
  assert.equal(view.kongCompany.orders[0].assignees[0].status, "bloqueada");
  await assert.rejects(council.finishOrder(view.kongCompany.orders[0].id, "unrelated-run", "owner", "kong"), /genérica/);
  now += 6 * 60000;
  assert.deepEqual((await council.view()).kongLastStatuses, {});
  assert.equal((await council.view()).kongCollaboration.verified, false);
});
test("old state loads empty isolated KONG company", () => {
  const old = emptyCouncilState() as any; delete old.kongCompany; delete old.kongEvidenceAt; delete old.kongCollaboration;
  const parsed = parseCouncilState(JSON.stringify(old));
  assert.deepEqual(parsed.kongCompany, emptyCompanyState());
  assert.deepEqual(parsed.kongEvidenceAt, {});
  assert.equal(parsed.kongCollaboration.verified, false);
});

test("legacy KONG careers and academy are quarantined, never replayed or advanced in BlackOps", async () => {
  const { advanceCompany } = await import("../shared/agent-company");
  const old = emptyCouncilState();
  // Preserve a verified local career while quarantining the unproven KONG history.
  old.company = advanceCompany(old.company, { now: NOW, statuses: { "kong-city:miami:clubs": { state: "working", label: "legacy" }, radio: { state: "working", label: "radio", evidenceId: "fixture:radio:verified-completed-run" } }, roles: {} }).state;
  old.company.careers["kong-city:miami:clubs"].points = 1234;
  old.company.trainees.push({ id: "old-kong-helper", forAgentId: "kong-city:miami:clubs", role: "Clubs", nickname: "Old helper", startedAt: at(-60), modulesDone: ["old-module"], knowledge: ["Old knowledge"] });
  old.proposals.push({ key: "new_agent:helper-kong-city:miami:clubs", kind: "new_agent", owner: "agent-factory", title: "Contratar helper", description: "legacy", evidence: [], handoffBrief: "legacy", createdAt: at(-60), status: "applied" });
  let raw = JSON.stringify(old);
  const parsed = parseCouncilState(raw);
  assert.equal(parsed.company.careers["kong-city:miami:clubs"], undefined);
  assert.equal(parsed.company.trainees.length, 0);
  assert.equal(parsed.company.careers.radio.points, 10);
  assert.equal(parsed.kongLegacyCompany.careers["kong-city:miami:clubs"].points, 1234);
  assert.deepEqual(parsed.kongCompany, emptyCompanyState());
  assert.deepEqual(parseCouncilState(JSON.stringify(parsed)), parsed, "migration is idempotent");
  const council = createAgentCouncil({ now: () => NOW, userId: () => "owner", readState: async () => raw, writeState: async value => { raw = value; }, collect: async () => ({}), collectKongEvidence: async () => evidence(), submitProposal: async () => "proposal", getPendingActionStatus: async () => null, fetchLatestRelease: async () => null, log: () => {} });
  await council.runCycle();
  const state = await council.load();
  assert.equal(state.company.trainees.length, 0, "old applied helper cannot enroll again");
  assert.deepEqual(state.kongLegacyCompany.trainees[0].modulesDone, ["old-module"], "archive never advances");
  assert.equal(state.kongCompany.careers["kong-city:miami:clubs"].points, 10, "only new verified result earns points");
  assert.equal("kongLegacyCompany" in await council.view(), false, "historical private state is not exposed");
});

test("missing and disabled city jobs do not acquire invented life or careers", () => {
  for (const disabled of [false, true]) {
    const snapshot = evidence();
    if (disabled) snapshot.cityAgentsEnabled = false;
    else snapshot.cities[0].categories = [];
    const result = advanceKongCompany({ ...start(), evidence: snapshot });
    assert.deepEqual(Object.keys(result.company.careers).filter(id => id.startsWith("kong-city:")), []);
  }
});

test("declared central roles without a verified result stay unscored", () => {
  for (const state of ["unknown", "disabled", "running"] as const) {
    const snapshot = evidence();
    snapshot.agents[0] = { ...snapshot.agents[0], state, lastRunAt: null };
    const result = advanceKongCompany({ ...start(), evidence: snapshot });
    assert.equal(result.company.careers["kong:venues"], undefined);
  }
});

// Production shape since 2026-11-06: every round closes with a coverage incident, so KONG reports "attention".
function warned(overrides: Record<string, unknown> = {}) {
  const snapshot = evidence();
  snapshot.cities[0].categories[0] = { ...snapshot.cities[0].categories[0], state: "attention", issues: ["Incidencia registrada. Revisa el detalle en KONG."], recordedFailure: false, attemptsSinceSuccess: 0, ...overrides };
  return snapshot;
}
const CLUBS = "kong-city:miami:clubs";

test("a completed round flagged as attention for coverage incidents is credited once", () => {
  const first = advanceKongCompany({ ...start(), evidence: warned() });
  assert.equal(first.company.careers[CLUBS].points, 10);
  assert.equal(first.evidenceAt[CLUBS], at(-1));
  const again = advanceKongCompany({ ...start(), evidence: warned(), company: first.company, evidenceAt: first.evidenceAt });
  assert.deepEqual(again.company, first.company);
  // Even when the success stamp is written a few ms after the completion stamp (same round).
  const next = advanceKongCompany({ ...start(), evidence: warned({ lastRunAt: at(0), lastSuccessAt: new Date(NOW + 5).toISOString(), lastStartedAt: at(-0.5) }), company: first.company, evidenceAt: first.evidenceAt, now: NOW + 10 });
  assert.equal(next.company.careers[CLUBS].points, 20);
});

test("a partial round limited by HTTP 429 is credited when it completed, and a stamped error on the same round does not drain", () => {
  const limited = advanceKongCompany({ ...start(), evidence: warned({ issues: ["Incidencia registrada. Revisa el detalle en KONG.", "La fuente limitó las consultas (HTTP 429)."] }) });
  assert.equal(limited.company.careers[CLUBS].points, 10);
  const stamped = advanceKongCompany({ ...start(), evidence: warned({ recordedFailure: true }) });
  assert.equal(stamped.company.careers[CLUBS].points, 10);
  assert.equal(stamped.company.careers[CLUBS].battery, 86);
});

test("a real failure without a new success drains battery once", () => {
  const base = advanceKongCompany({ ...start(), evidence: warned() });
  for (const failure of [{ recordedFailure: true }, { recordedFailure: false, attemptsSinceSuccess: 1 }]) {
    const failed = warned({ ...failure, lastStartedAt: at(-0.5), lastRunAt: at(0), lastSuccessAt: at(-1 - 60) });
    const first = advanceKongCompany({ ...start(), evidence: failed, company: base.company, evidenceAt: { [CLUBS]: at(-61) } });
    assert.equal(first.company.careers[CLUBS].battery, base.company.careers[CLUBS].battery - 10);
    assert.equal(first.company.careers[CLUBS].points, 5);
    const again = advanceKongCompany({ ...start(), evidence: failed, company: first.company, evidenceAt: first.evidenceAt });
    assert.deepEqual(again.company, first.company);
  }
  // A closed attempt with no success, no error and no pending attempts proves nothing either way.
  const unclear = advanceKongCompany({ ...start(), evidence: warned({ lastRunAt: at(0), lastSuccessAt: at(-61), lastStartedAt: at(-0.5) }), company: base.company, evidenceAt: { [CLUBS]: at(-61) } });
  assert.deepEqual(unclear.company, base.company);
});

test("a missed turn is penalized once per nextRunAt, and a later real run still earns credit", () => {
  const base = advanceKongCompany({ ...start(), evidence: warned() });
  const missed = warned({ lastStartedAt: at(-300), lastRunAt: at(-299), lastSuccessAt: at(-299), nextRunAt: at(-239) });
  const ledger = { [CLUBS]: at(-299) };
  const first = advanceKongCompany({ ...start(), evidence: missed, company: base.company, evidenceAt: ledger });
  assert.equal(first.company.careers[CLUBS].points, 8);
  assert.equal(first.company.careers[CLUBS].battery, base.company.careers[CLUBS].battery - 3);
  assert.equal(first.evidenceAt[CLUBS], at(-239));
  const again = advanceKongCompany({ ...start(), evidence: missed, company: first.company, evidenceAt: first.evidenceAt });
  assert.deepEqual(again.company, first.company);
  // Late by less than three hours is not a missed turn.
  const late = advanceKongCompany({ ...start(), evidence: warned({ lastStartedAt: at(-200), lastRunAt: at(-199), lastSuccessAt: at(-199), nextRunAt: at(-139) }), company: base.company, evidenceAt: { [CLUBS]: at(-199) } });
  assert.deepEqual(late.company, base.company);
  const recovered = advanceKongCompany({ ...start(), evidence: warned({ lastStartedAt: at(-1), lastRunAt: at(-0.5), lastSuccessAt: at(-0.5), nextRunAt: at(59) }), company: first.company, evidenceAt: first.evidenceAt });
  assert.equal(recovered.company.careers[CLUBS].points, 18);
});

test("a stale snapshot credits and penalizes nothing, including warned, failed or missed jobs", () => {
  const base = advanceKongCompany({ ...start(), evidence: warned() });
  for (const snapshot of [warned({ lastRunAt: at(0), lastSuccessAt: at(0) }), warned({ recordedFailure: true, lastRunAt: at(0), lastSuccessAt: at(-61) }), warned({ nextRunAt: at(-239), lastRunAt: at(-299), lastSuccessAt: at(-299), lastStartedAt: at(-300) })]) {
    const result = advanceKongCompany({ company: base.company, evidenceAt: base.evidenceAt, evidence: snapshot, now: NOW + 6 * 60000 });
    assert.deepEqual(result.company, base.company);
    assert.deepEqual(result.evidenceAt, base.evidenceAt);
  }
});

test("central departments reporting healthy with report notes are credited; blockers and attention are not", () => {
  const notes = evidence(); notes.agents[0].issues = ["Cobertura parcial"];
  assert.equal(advanceKongCompany({ ...start(), evidence: notes }).company.careers["kong:venues"].points, 10);
  const blocked = evidence(); blocked.agents[0].blocker = "Falta credencial";
  assert.equal(advanceKongCompany({ ...start(), evidence: blocked }).company.careers["kong:venues"], undefined);
  const attention = evidence(); attention.agents[0].state = "attention";
  assert.equal(advanceKongCompany({ ...start(), evidence: attention }).company.careers["kong:venues"], undefined);
});

test("a transient KONG read failure is retried within the round instead of freezing KONG careers", async () => {
  let raw: string | null = null;
  let reads = 0;
  const warnings: string[] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => { warnings.push(args.map(String).join(" ")); };
  try {
    const council = createAgentCouncil({ now: () => NOW, userId: () => "owner", readState: async () => raw, writeState: async (value: string) => { raw = value; }, collect: async () => ({}),
      collectKongEvidence: async () => { reads++; if (reads === 1) throw new Error("KONG no respondio a tiempo"); return evidence(); },
      submitProposal: async () => "proposal", getPendingActionStatus: async () => null, fetchLatestRelease: async () => null, log: () => {} });
    await council.runCycle();
    const view = await council.view();
    assert.equal(reads, 2, "one retry");
    assert.equal(view.kongCompany.careers["kong:venues"].points, 10, "the retried read still credits the round");
    assert.ok(warnings.some(line => /KONG evidence read failed \(attempt 1\/2\): KONG no respondio a tiempo/.test(line)), "the reason is logged, not swallowed");
  } finally {
    console.warn = originalWarn;
  }
});
