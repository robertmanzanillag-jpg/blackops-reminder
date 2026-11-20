import test from "node:test";
import assert from "node:assert/strict";
import { advanceCompany, emptyCompanyState, learnLessons, type CompanyState } from "../shared/agent-company";
import { applyVitality, deriveVitalityFlagProposals, vitalityCadenceMs, vitalityLiveStatus, vitalityView, HOUR_MS, VITALITY_MISS, VITALITY_RECOVERY } from "../shared/agent-vitality";
import { clippersAcademyLessons, deriveSelfImprovementProposals, learnClippersLessons, roleWorkHolds, roleWorkVitalityEvidence, streamerVitalityEvidence, MAX_OPEN_SELF_IMPROVEMENT } from "../shared/agent-self-improvement";
import { applyApprovedProposal, emptyCouncilState, parseCouncilState, type CouncilProposal } from "../shared/agent-council";
import { createAgentCouncil, type CouncilDeps } from "../server/agent-council";
import { CLIPPERS_AGENT_IDS } from "../shared/clippers-office-agents";
import { FACTORY_AGENT_IDS } from "../shared/factory-office-agents";

const T0 = Date.parse("2026-11-19T12:00:00Z");
const iso = (ms: number) => new Date(ms).toISOString();
const hire = (ids: string[], now = T0): CompanyState =>
  advanceCompany(emptyCompanyState(), { now, roles: Object.fromEntries(ids.map(id => [id, id])), statuses: Object.fromEntries(ids.map(id => [id, { state: "available" as const, label: "registrado" }])) }).state;

test("cadence: daily role work, factory weekly, clippers 48 h, coordinators and supervisors unmeasured", () => {
  assert.equal(vitalityCadenceMs("code"), 26 * HOUR_MS);
  assert.equal(vitalityCadenceMs("clippers-streamers"), 48 * HOUR_MS);
  assert.equal(vitalityCadenceMs("clippers-learning"), 7 * 24 * HOUR_MS);
  for (const id of FACTORY_AGENT_IDS) assert.equal(vitalityCadenceMs(id), 7 * 24 * HOUR_MS);
  for (const id of ["clippers-supervisor", "clippers-health", "ceo", "agent-factory"]) assert.equal(vitalityCadenceMs(id), null);
});

test("no verified output: first sight is free, then each missed window costs once (idempotent)", () => {
  let company = hire(["code"]);
  company = applyVitality(company, { now: T0 }).state;
  assert.equal(company.careers.code.battery, 80, "first sight never penalizes");
  const later = T0 + 3 * 26 * HOUR_MS + 1000;
  const once = applyVitality(company, { now: later });
  assert.deepEqual(once.decayed, ["code"]);
  assert.equal(once.state.careers.code.battery, 80 - 3 * VITALITY_MISS.battery);
  const twice = applyVitality(once.state, { now: later + 60_000 });
  assert.equal(twice.state.careers.code.battery, once.state.careers.code.battery, "the same windows never cost twice");
  assert.equal(twice.state.careers.code.generation, 1);
  assert.match(twice.state.careers.code.memory[0].text, /Sin entregable verificado/);
});

test("verified output recovers vida once per receipt and restarts the clock", () => {
  let company = applyVitality(hire(["code"]), { now: T0 }).state;
  company = applyVitality(company, { now: T0 + 2 * 26 * HOUR_MS + 1 }).state;
  const low = company.careers.code.battery;
  const at = T0 + 2 * 26 * HOUR_MS + 10_000;
  const evidence = roleWorkVitalityEvidence([{ id: "j1", role: "code", status: "completed", completedAt: iso(at), artifactId: "a".repeat(64) }, { id: "j2", role: "code", status: "blocked", completedAt: iso(at) }]);
  assert.equal(evidence.length, 1, "blocked work is never output");
  const r1 = applyVitality(company, { now: at + 1000, evidence });
  assert.equal(r1.state.careers.code.battery, low + VITALITY_RECOVERY);
  const r2 = applyVitality(r1.state, { now: at + 2000, evidence });
  assert.equal(r2.state.careers.code.battery, low + VITALITY_RECOVERY, "the same receipt never recovers twice");
  assert.equal(r2.state.careers.code.vitality?.missesApplied, 0);
  assert.equal(r2.state.careers.code.vitality?.anchorAt, iso(at));
  // Work already scored by advanceCompany ("working" + distinct evidence) also restarts the clock.
  let factory = applyVitality(hire(["factory-builder"]), { now: T0 }).state;
  factory = advanceCompany(factory, { now: T0 + 6 * 24 * HOUR_MS, roles: {}, statuses: { "factory-builder": { state: "working", label: "etapa", evidenceId: "stage-1" } } }).state;
  const after = applyVitality(factory, { now: T0 + 8 * 24 * HOUR_MS });
  assert.deepEqual(after.decayed, [], "verified stage 2 days ago: still inside the weekly window");
});

test("holds, academy and exempt agents never lose vida", () => {
  let company = applyVitality(hire(["control", "mechanic", "revenue"]), { now: T0 }).state;
  company = { ...company, careers: { ...company.careers, revenue: { ...company.careers.revenue, inTrainingUntilGeneration: 2 } } };
  const later = T0 + 10 * 26 * HOUR_MS;
  const holds = roleWorkHolds([{ id: "x", role: "control", status: "blocked", startedAt: iso(later - HOUR_MS) }], later);
  assert.deepEqual(Object.keys(holds), ["control"]);
  const r = applyVitality(company, { now: later, holds, exempt: ["mechanic"] });
  assert.equal(r.state.careers.control.battery, 80);
  assert.equal(r.state.careers.mechanic.battery, 80);
  assert.equal(r.state.careers.revenue.battery, 80);
  const row = vitalityView(r.state, { now: later, names: { control: "Control", mechanic: "Mecanico", revenue: "Revenue" }, exempt: ["mechanic"] });
  assert.deepEqual(Object.fromEntries(row.map(x => [x.agentId, x.state])), { control: "en_espera", mechanic: "sin_puntuar", revenue: "en_academia" });
});

test("vida 0 is flagged for the CEO/Robert once; never fired, replaced or deleted", () => {
  let company = applyVitality(hire(["clippers-editor"]), { now: T0 }).state;
  const zero = applyVitality(company, { now: T0 + 30 * 48 * HOUR_MS, names: { "clippers-editor": "Clippers · Editor" } });
  const career = zero.state.careers["clippers-editor"];
  assert.equal(career.battery, 0);
  assert.equal(career.generation, 1, "no replacement");
  assert.equal(zero.state.retiredCareers?.length ?? 0, 0);
  assert.deepEqual(zero.flagged, ["clippers-editor"]);
  assert.match(zero.state.events[0].text, /Vida en cero/);
  assert.deepEqual(applyVitality(zero.state, { now: T0 + 31 * 48 * HOUR_MS }).flagged, [], "flag raised once");
  const proposals = deriveVitalityFlagProposals(zero.state, [], T0 + 30 * 48 * HOUR_MS, { "clippers-editor": "Clippers · Editor" });
  assert.equal(proposals.length, 1);
  assert.equal(proposals[0].kind, "repair");
  assert.match(proposals[0].key, /^repair:clippers-editor#vida-cero-/);
  assert.match(proposals[0].description, /No se borra/);
  assert.equal(deriveVitalityFlagProposals(zero.state, proposals.map(p => ({ ...p, status: "submitted" as const })), T0 + 31 * 48 * HOUR_MS).length, 0);
  const view = vitalityView(zero.state, { now: T0 + 30 * 48 * HOUR_MS, names: { "clippers-editor": "Editor" } });
  assert.equal(view[0].state, "vida_cero");
  assert.equal(view[0].flagged, true);
  assert.equal(vitalityLiveStatus(view[0], T0).problems?.[0], "Vida en cero: no entrega trabajo verificado");
});

const streamerState = (at: number) => ({
  lastRun: { at: iso(at), status: "completed", counts: { candidates: 12 } },
  cloudPublish: {
    version: 1, clips: {},
    lastRun: { at: iso(at), status: "completed", dryRun: false, counts: { rendered: 2, scheduled: 3, blocked: 1 } },
    posts: [
      { id: "stc-1", status: "scheduled", metricoolId: "m1", attemptedAt: iso(at - 1000), observation: { views: 900, observedAt: iso(at - 500) } },
      { id: "stc-2", status: "pending_write", metricoolId: null },
    ],
    learning: {
      evaluatedAt: iso(at), samples: 14,
      experiments: [
        { experimentId: "streamer-hook:tiktok:kong", winner: "teaser", lift: 0.35, reason: "winner_supported", variants: [{ variant: "teaser", samples: 7 }, { variant: "title", samples: 7 }] },
        { experimentId: "streamer-hook:youtube:kong", winner: null, lift: null, reason: "insufficient_samples", variants: [{ variant: "title", samples: 2 }] },
      ],
      hookPreference: { "tiktok:kong": "teaser" },
      creatorBoost: { "twitch:alpha": 0.8, "twitch:beta": -0.6, "twitch:gamma": 0.1 },
    },
  },
});

test("cloud streamer lane receipts become Clippers vida evidence; missing secrets are holds", () => {
  const { evidence, holds } = streamerVitalityEvidence(streamerState(T0), T0);
  const by = Object.fromEntries(evidence.map(e => [e.agentId, e.id]));
  assert.deepEqual(Object.keys(by).sort(), ["clippers-analytics", "clippers-checker", "clippers-editor", "clippers-learning", "clippers-publisher", "clippers-streamers"]);
  assert.equal(by["clippers-publisher"], "streamer-post:stc-1", "only Metricool-confirmed schedules count");
  assert.deepEqual(holds, {});
  const held = streamerVitalityEvidence({ lastRun: { at: iso(T0), status: "skipped_missing_secrets" }, cloudPublish: { version: 1, posts: [], lastRun: { at: iso(T0), status: "held_missing_secrets", counts: {} } } }, T0);
  assert.deepEqual(held.evidence, []);
  assert.ok(held.holds["clippers-streamers"] && held.holds["clippers-publisher"]);
  const dry = streamerVitalityEvidence({ cloudPublish: { version: 1, posts: [], lastRun: { at: iso(T0), status: "completed", dryRun: true, counts: { rendered: 5 } } } }, T0);
  assert.deepEqual(dry.evidence, [], "dry runs are not output");
  assert.deepEqual(streamerVitalityEvidence("garbage", T0), { evidence: [], holds: {} });
});

test("Clippers academy: Metricool lessons (hooks, creators) become academia skills once", () => {
  const lessons = clippersAcademyLessons(streamerState(T0));
  const ids = lessons.map(l => l.id);
  assert.ok(ids.includes("clippers-hook:tiktok:kong:teaser"));
  assert.ok(ids.includes("clippers-hook:youtube:kong:pending"));
  assert.ok(ids.includes("clippers-creator:twitch:alpha:up"));
  assert.ok(ids.includes("clippers-creator:twitch:beta:down"));
  assert.ok(!ids.some(id => id.includes("gamma")), "weak creator signal is not a lesson");
  assert.equal(lessons.find(l => l.id.endsWith(":pending"))?.supported, false);
  let company = hire(CLIPPERS_AGENT_IDS);
  company = learnClippersLessons(company, lessons, T0);
  const editor = company.careers["clippers-editor"].skills || [];
  assert.ok(editor.some(s => s.id === "academia:clippers-hook:tiktok:kong:teaser" && s.source === "academia"));
  assert.ok((company.careers["clippers-streamers"].skills || []).some(s => s.id === "academia:clippers-creator:twitch:alpha:up"));
  assert.ok(!(company.careers["clippers-learning"].skills || []).some(s => s.id.endsWith(":pending")), "unsupported tests are not learned");
  assert.equal(learnClippersLessons(company, lessons, T0 + 1), company, "idempotent");
});

test("automejora: proposals need owner approval, are bounded, deduped, and approval records the improvement", () => {
  const lessons = clippersAcademyLessons(streamerState(T0));
  const jobs = ["2026-11-16", "2026-11-17", "2026-11-18"].map((slot, i) => ({ id: `j${i}`, role: "code", slot, status: "completed", startedAt: `${slot}T10:00:00.000Z`, audit: { diagnostics: ["PR_STALE"] } }));
  const created = deriveSelfImprovementProposals({ proposals: [], lessons: [], roleWorkJobs: jobs, clippersLessons: lessons, now: T0, names: { code: "Code" } });
  assert.equal(created.length, MAX_OPEN_SELF_IMPROVEMENT, "at most 3 open");
  assert.ok(created.every(p => p.kind === "lesson" && p.status === "pending_submit" && p.key.startsWith("automejora:")));
  const all = deriveSelfImprovementProposals({ proposals: [], lessons: [], roleWorkJobs: jobs, clippersLessons: [], now: T0, names: { code: "Code" } });
  assert.equal(all.length, 1);
  assert.equal(all[0].key, "automejora:code:PR_STALE");
  assert.match(all[0].handoffBrief, /PR-first/);
  assert.equal(deriveSelfImprovementProposals({ proposals: all, lessons: [], roleWorkJobs: jobs, now: T0, names: {} }).length, 0, "one per key");
  assert.equal(deriveSelfImprovementProposals({ proposals: [], lessons: [], roleWorkJobs: jobs.slice(0, 2), now: T0, names: {} }).length, 0, "needs 3 distinct days");
  // Approval through the existing flow: lesson -> skill "Mejora aprobada".
  let council = { ...emptyCouncilState(), proposals: all as CouncilProposal[] };
  council = applyApprovedProposal(council, "automejora:code:PR_STALE", T0);
  const company = learnLessons(hire(["code"]), council.lessons, T0);
  assert.ok((company.careers.code.skills || []).some(s => s.title.startsWith("Mejora aprobada:")));
});

test("council round: every agent gets a vida row, cloud Clippers work recovers it, academy and automejora are recorded", async () => {
  let stored: string | null = null;
  let clock = T0;
  const submitted: CouncilProposal[] = [];
  const deps: CouncilDeps = {
    now: () => clock, userId: () => "owner",
    readState: async () => stored, writeState: async raw => { stored = raw; },
    collect: async () => ({}),
    submitProposal: async (_u, p) => { submitted.push(p); return `pa-${submitted.length}`; },
    getPendingActionStatus: async () => "pending",
    fetchLatestRelease: async () => null, log: () => undefined,
    collectVitality: async () => ({ streamerState: streamerState(clock - 60_000) }),
  };
  const council = createAgentCouncil(deps);
  await council.runCycle();
  // Receipts older than the hire never count; the lane's next run (after registration) does.
  clock += 20 * 60_000;
  await council.runCycle();
  const view = await council.view() as unknown as { vitality: Array<{ agentId: string; state: string; vida: number | null }>; clippersAcademy: { lessons: unknown[] } };
  const ids = new Set(view.vitality.map(r => r.agentId));
  for (const id of [...CLIPPERS_AGENT_IDS, ...FACTORY_AGENT_IDS, "code", "news", "legal"]) assert.ok(ids.has(id), `${id} listed`);
  assert.ok(![...ids].some(id => id.startsWith("kong:") || id === "kong-videos"), "KONG keeps its own company");
  const streamers = view.vitality.find(r => r.agentId === "clippers-streamers")!;
  assert.equal(streamers.state, "trabajando");
  assert.equal(streamers.vida, 80 + VITALITY_RECOVERY);
  assert.equal(view.vitality.find(r => r.agentId === "clippers-supervisor")!.state, "sin_entregable");
  assert.ok(view.clippersAcademy.lessons.length >= 3);
  const state = parseCouncilState(stored);
  assert.ok((state.company.careers["clippers-editor"].skills || []).some(s => s.source === "academia"));
  assert.ok(submitted.some(p => p.key.startsWith("automejora:clippers-hook:")), "automejora goes to the Trust Center");
});

test("clock-only evidence (already scored elsewhere) restarts the clock without extra vida", () => {
  let company = applyVitality(hire(["br-editor"]), { now: T0 }).state;
  const at = T0 + 70 * HOUR_MS;
  const r = applyVitality(company, { now: at + 1000, evidence: [{ id: "blackroom:q1", agentId: "br-editor", at: iso(at), label: "aprobado", clockOnly: true }] });
  assert.equal(r.state.careers["br-editor"].battery, 80);
  assert.deepEqual(applyVitality(r.state, { now: at + 71 * HOUR_MS }).decayed, [], "clock restarted at the approval");
});
