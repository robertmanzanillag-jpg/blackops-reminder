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
  old.company = advanceCompany(old.company, { now: NOW, statuses: { "kong-city:miami:clubs": { state: "working", label: "legacy" }, radio: { state: "working", label: "radio" } }, roles: {} }).state;
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
