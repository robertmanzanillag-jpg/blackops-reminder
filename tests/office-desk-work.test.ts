import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BLACKROOM_DESK_IDS, DESK_WORK_ROLES, KONG_DESK_IDS, createDeskWorkRunner, parseDeskWork, reviewDesk, type DeskSources } from "../server/office-desk-work";
import { buildOfficeRoster, deriveAgentStatus } from "../server/office-roster-status";
import { applyOutcomeLessons, collectOutcomeSamples } from "../shared/agent-self-improvement";
import { buildAgentChatDirectory } from "../shared/agent-chat-directory";
import { emptyCouncilState } from "../shared/agent-council";
import { BLACKROOM_TEAM } from "../shared/blackroom-team";
import { KONG_INVITATION_AGENT_ID } from "../shared/kong-invitation-agent";

const NOW = Date.parse("2026-11-25T12:00:00Z");
const H = 3600_000;
const iso = (t: number) => new Date(t).toISOString();
const rec = (over: Record<string, unknown> = {}) => ({ jobId: "analytics-daily", label: "Reporte de redes", everyMs: 6 * H, enabled: true, lastRunAt: iso(NOW - H), lastOk: true, lastSummary: "3 redes revisadas", ...over });
const sources = (over: Partial<DeskSources> = {}): DeskSources => ({ blackroomSchedule: { "blackroom-analytics": [rec()] }, kongStatuses: { "kong:Venues": { state: "available", label: "12 venues frescos" } }, kongObservedAt: iso(NOW - 10 * 60_000), lastStatuses: {}, lastCycleAt: null, ...over });

function fakeCouncil(initial: Record<string, unknown> = {}) {
  let execution: any = { roles: { roles: {} }, tokens: { reservations: [] }, ...initial };
  return { get execution() { return execution; }, async updateOfficeExecution(change: (e: any, c: any) => any) { execution = change(structuredClone(execution), {}); return execution; } };
}

test("covers internal desks and leaves the external invitation coordinator to its verified receipt workflow", () => {
  assert.deepEqual([...BLACKROOM_DESK_IDS].sort(), BLACKROOM_TEAM.map(a => a.id).sort());
  const kongDesks = buildAgentChatDirectory(emptyCouncilState() as any).filter(e => e.group === "kong-desk").map(e => e.id);
  assert.ok(kongDesks.includes(KONG_INVITATION_AGENT_ID));
  assert.ok(!DESK_WORK_ROLES.includes(KONG_INVITATION_AGENT_ID), "a source-only daily review cannot stand in for real invitation work");
  for (const id of kongDesks.filter(id => id !== KONG_INVITATION_AGENT_ID)) assert.ok((KONG_DESK_IDS as readonly string[]).includes(id), `${id} sin trabajo diario`);
});

test("Black Room review with a fresh scheduler record completes with evidence", () => {
  const r = reviewDesk("blackroom-analytics", sources(), NOW);
  assert.equal(r.status, "completed");
  assert.ok(r.deliverable.evidence.some(e => e.startsWith("scheduler.json:analytics-daily@")));
  assert.ok(r.deliverable.findings.some(f => /3 redes revisadas/.test(f)));
  assert.equal(r.deliverable.reviewOnly, true);
});

test("missing source fails closed with SOURCE_MISSING (never fakes work)", () => {
  const r = reviewDesk("blackroom-analytics", sources({ blackroomSchedule: null }), NOW);
  assert.equal(r.status, "blocked"); assert.equal(r.reason, "source_unavailable"); assert.deepEqual(r.diagnostics, ["SOURCE_MISSING"]);
  const k = reviewDesk("kong:Kong Legal", sources(), NOW);
  assert.equal(k.status, "blocked"); assert.ok(k.diagnostics.includes("SOURCE_MISSING"));
  const never = reviewDesk("blackroom-analytics", sources({ blackroomSchedule: { "blackroom-analytics": [rec({ lastRunAt: null })] } }), NOW);
  assert.equal(never.status, "blocked");
});

test("stale or disabled sources are blocked with honest reasons", () => {
  const stale = reviewDesk("blackroom-analytics", sources({ blackroomSchedule: { "blackroom-analytics": [rec({ lastRunAt: iso(NOW - 30 * H) })] } }), NOW);
  assert.equal(stale.reason, "source_stale"); assert.ok(stale.diagnostics.includes("SOURCE_STALE"));
  const off = reviewDesk("blackroom-scripts", sources({ blackroomSchedule: { "blackroom-scripts": [rec({ jobId: "scripts-edits", enabled: false })] } }), NOW);
  assert.equal(off.status, "blocked"); assert.equal(off.reason, "schedule_disabled");
  const kong = reviewDesk("kong:Venues", sources({ kongObservedAt: iso(NOW - 8 * H) }), NOW);
  assert.equal(kong.reason, "source_stale");
});

test("KONG review is review-only: no orders, no factory dispatch", () => {
  const r = reviewDesk("kong:Venues", sources(), NOW);
  assert.equal(r.status, "completed");
  assert.ok(r.deliverable.findings.some(f => /no se envían órdenes a KONG ni a la fábrica/.test(f)));
  const src = readFileSync(new URL("../server/office-desk-work.ts", import.meta.url), "utf8");
  for (const forbidden of ["kong-office-orders", "software-factory", "createOrder", "placeOrder", "fetch(", "openai", "gemini", "metricool"]) assert.ok(!src.toLowerCase().includes(forbidden.toLowerCase()), `prohibido: ${forbidden}`);
});

test("runner records one fenced job per desk per day with a verifiable artifact", async () => {
  const council = fakeCouncil();
  const runner = createDeskWorkRunner({ council, readSources: async () => sources(), now: () => NOW });
  const first = await runner.tick();
  assert.equal(first.ran.length, DESK_WORK_ROLES.length);
  const journal = parseDeskWork(council.execution.deskWork);
  assert.equal(journal.jobs.length, DESK_WORK_ROLES.length);
  assert.ok(journal.jobs.every(j => j.status !== "running" && /^[a-f0-9]{64}$/.test(j.artifactId!)));
  assert.equal(journal.jobs.find(j => j.role === "blackroom-analytics")!.status, "completed");
  assert.equal(journal.jobs.find(j => j.role === "kong:Kong Legal")!.status, "blocked");
  assert.deepEqual((await runner.tick()).ran, [], "same day: no duplicate work");
  const forged = structuredClone(council.execution.deskWork); forged.jobs[0].deliverable.findings.push("inventado");
  assert.throws(() => parseDeskWork(forged));
});

test("failed source read blocks every job instead of completing", async () => {
  const council = fakeCouncil();
  await createDeskWorkRunner({ council, readSources: async () => { throw new Error("db down"); }, now: () => NOW }).tick();
  assert.ok(parseDeskWork(council.execution.deskWork).jobs.every(j => j.status === "blocked" && j.reason === "source_unavailable"));
});

test("desk jobs feed outcome lessons and the roster", async () => {
  const council = fakeCouncil();
  let t = NOW - 24 * H;
  const runner = createDeskWorkRunner({ council, readSources: async () => sources({ blackroomSchedule: null }), now: () => t, roles: ["blackroom-competition"] });
  await runner.tick(); t = NOW; await runner.tick();
  const jobs = council.execution.deskWork.jobs;
  const samples = collectOutcomeSamples({ deskWorkJobs: jobs });
  assert.equal(samples.length, 2);
  const company: any = { version: 1, careers: { "blackroom-competition": { agentId: "blackroom-competition", generation: 1 } }, trainees: [], orders: [] };
  const learned = applyOutcomeLessons(company, samples, NOW);
  assert.ok(learned.careers["blackroom-competition"].learning!.lessons.some(l => l.id === "bloqueo:source_unavailable"));
  const state: any = { ...emptyCouncilState(), company: learned, officeExecution: { deskWork: { version: 1, jobs } } };
  const status = deriveAgentStatus("blackroom-competition", state, NOW + 60_000);
  assert.equal(status.state, "bloqueado"); assert.match(status.reason!, /fuente/);
  const entry = buildOfficeRoster(state, NOW + 60_000).agents.find(a => a.id === "blackroom-competition")!;
  assert.ok(entry.aprendizajes >= 1);
});

test("a live desk lease shows Trabajando; a completed review shows En espera", () => {
  const running: any = { ...emptyCouncilState(), officeExecution: { deskWork: { version: 1, jobs: [{ role: "kong:Venues", status: "running", slot: "2026-11-25", startedAt: iso(NOW - 10_000), expiresAt: iso(NOW + 50_000) }] } } };
  assert.equal(deriveAgentStatus("kong:Venues", running, NOW).state, "trabajando");
  const done: any = { ...emptyCouncilState(), officeExecution: { deskWork: { version: 1, jobs: [{ role: "kong:Venues", status: "completed", startedAt: iso(NOW - H), completedAt: iso(NOW - H + 1000) }] } } };
  assert.equal(deriveAgentStatus("kong:Venues", done, NOW).state, "en_espera");
});

test("malformed desk journal is tolerated by the runner read (never bricks the cycle)", async () => {
  const { readDeskWork } = await import("../server/office-desk-work");
  assert.deepEqual(readDeskWork(undefined), { version: 1, jobs: [] });
  assert.deepEqual(readDeskWork({ version: 2, jobs: "x" }), { version: 1, jobs: [] });
  assert.deepEqual(readDeskWork({ version: 1, jobs: [{ role: "nope" }] }), { version: 1, jobs: [] });
});
