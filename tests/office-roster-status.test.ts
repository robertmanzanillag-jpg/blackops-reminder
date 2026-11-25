import test from "node:test";
import assert from "node:assert/strict";
import { buildOfficeRoster, deriveAgentStatus } from "../server/office-roster-status";
import { emptyCouncilState } from "../shared/agent-council";
import { CLIPPERS_AGENTS } from "../shared/clippers-office-agents";
import { FACTORY_AGENTS } from "../shared/factory-office-agents";

const NOW = Date.parse("2026-11-25T12:00:00Z");
const at = (min: number) => new Date(NOW + min * 60_000).toISOString();
const withJobs = (jobs: unknown[], extra: Record<string, unknown> = {}) => ({ ...emptyCouncilState(), officeExecution: { roleWork: { version: 1, ownerKey: "o", jobs } }, ...extra } as any);

test("sin datos when nothing is recorded (never fakes working)", () => {
  assert.equal(deriveAgentStatus("code", emptyCouncilState(), NOW).state, "sin_datos");
});
test("running job with live lease is trabajando with what it does", () => {
  const s = deriveAgentStatus("code", withJobs([{ role: "code", status: "running", slot: "2026-11-25", startedAt: at(-3), expiresAt: at(10) }]), NOW);
  assert.equal(s.state, "trabajando"); assert.match(s.doing!, /2026-11-25/); assert.equal(s.lastActivityAt, at(-3));
});
test("expired running lease is bloqueado, not working", () => {
  const s = deriveAgentStatus("code", withJobs([{ role: "code", status: "running", startedAt: at(-90), expiresAt: at(-30) }]), NOW);
  assert.equal(s.state, "bloqueado"); assert.match(s.reason!, /expiró/);
});
test("blocked job gives Spanish reason", () => {
  const s = deriveAgentStatus("clippers", withJobs([{ role: "clippers", status: "blocked", reason: "source_unavailable", startedAt: at(-60), completedAt: at(-59) }]), NOW);
  assert.equal(s.state, "bloqueado"); assert.match(s.reason!, /fuente/);
});
test("completed job is en espera with last activity", () => {
  const s = deriveAgentStatus("github", withJobs([{ role: "github", status: "completed", startedAt: at(-120), completedAt: at(-110) }]), NOW);
  assert.equal(s.state, "en_espera"); assert.equal(s.lastActivityAt, at(-110));
});
test("council 'working' observation counts only while recent", () => {
  const fresh = withJobs([], { lastCycleAt: at(-5), lastStatuses: { radio: { state: "working", label: "Analizando eventos" } } });
  assert.equal(deriveAgentStatus("radio", fresh, NOW).state, "trabajando");
  const stale = withJobs([], { lastCycleAt: at(-300), lastStatuses: { radio: { state: "working", label: "x" } } });
  assert.equal(deriveAgentStatus("radio", stale, NOW).state, "en_espera");
});
test("probe error is bloqueado with its label", () => {
  const s = deriveAgentStatus("legal", withJobs([], { lastCycleAt: at(-5), lastStatuses: { legal: { state: "needs-setup", label: "Falta conector" } } }), NOW);
  assert.equal(s.state, "bloqueado"); assert.equal(s.reason, "Falta conector");
});
test("roster lists every registry agent, clippers sub-roles, factory and unknown roles with work", () => {
  const view = buildOfficeRoster(withJobs([{ role: "mystery-role", status: "completed", startedAt: at(-10), completedAt: at(-9) }]), NOW);
  const ids = new Set(view.agents.map(a => a.id));
  for (const id of ["ceo", "code", "news:miami-news", "news:ny-news", "clippers", "dropshipping", "marketing-cmo", "mystery-role"]) assert.ok(ids.has(id), id);
  for (const a of CLIPPERS_AGENTS) assert.ok(ids.has(a.id), a.id);
  for (const a of FACTORY_AGENTS) assert.ok(ids.has(a.id), a.id);
  assert.equal(ids.size, view.agents.length);
  assert.equal(Object.values(view.counts).reduce((a, b) => a + b, 0), view.agents.length);
});
