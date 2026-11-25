import test from "node:test";
import assert from "node:assert/strict";
import { admissionsToday, apiReadinessLabel, deriveFactoryAgents, safeReasonCode, translateFactoryReason } from "../shared/software-factory-agents";

const now = Date.parse("2026-11-25T12:00:00Z");
const order = { id: "o1", text: "Arreglar el panel de la fábrica para que muestre todo", assignees: [{ agentId: "code", status: "pendiente" }] };
const root = { id: "j1", kind: "discover", status: "completed", createdAt: "2026-11-25T10:00:00Z", completedAt: "2026-11-25T10:05:00Z", payload: { companyOrder: { orderId: "o1", revision: "r" } } };

test("every stage, engineering role and control is listed; no jobs means idle without fake activity", () => {
  const rows = deriveFactoryAgents({ jobs: [], orders: [], now });
  for (const id of ["discover", "build", "simulate", "review", "deploy", "verify", "rollback", "evaluate", "code", "github", "app-qa", "mechanic", "agent-factory", "claude-reviewer", "self-heal", "release-gate"])
    assert.ok(rows.some(r => r.id === id), id);
  assert.ok(rows.every(r => r.state === "en_espera" && !r.current));
});

test("running child job shows Trabajando with order label, stage and elapsed time via previousJobId chain", () => {
  const build = { id: "j2", kind: "build", status: "running", createdAt: "2026-11-25T11:30:00Z", payload: { previousJobId: "j1" } };
  const rows = deriveFactoryAgents({ jobs: [build, root], orders: [order], now });
  const b = rows.find(r => r.id === "build")!;
  assert.equal(b.state, "trabajando");
  assert.equal(b.current?.stage, "Constructor");
  assert.equal(b.current?.elapsedMinutes, 30);
  assert.match(b.current?.orderLabel ?? "", /^Arreglar el panel/);
  assert.equal(rows.find(r => r.id === "code")!.state, "trabajando");
  assert.equal(rows.find(r => r.id === "discover")!.lastCompletedAt, "2026-11-25T10:05:00Z");
});

test("latest stop newer than last completion is Bloqueado with plain Spanish reason; unsafe text hidden", () => {
  const stop = { id: "j3", kind: "build", status: "blocked", createdAt: "2026-11-25T11:00:00Z", completedAt: "2026-11-25T11:01:00Z", payload: { previousJobId: "j1" }, result: { reason: "PROVIDER_BLOCKED" } };
  const b = deriveFactoryAgents({ jobs: [stop, root], orders: [order], now }).find(r => r.id === "build")!;
  assert.equal(b.state, "bloqueado");
  assert.match(b.blocked!.reason, /proveedor/);
  assert.equal(safeReasonCode({ reason: "secret token sk-123" }), null);
  assert.match(translateFactoryReason("FACTORY_EXECUTION_UNCONFIRMED"), /confirmar/);
  assert.match(translateFactoryReason("FACTORY_AUTO_SELECTION_SELF_HEAL_SOURCE_TOO_LARGE"), /grande/);
  assert.match(translateFactoryReason("DAILY_ALLOWANCE_REACHED"), /diario/);
});

test("a completion after a stop clears Bloqueado", () => {
  const stop = { id: "j3", kind: "discover", status: "failed", createdAt: "2026-11-25T09:00:00Z", result: { reason: "PROVIDER_BLOCKED" } };
  assert.equal(deriveFactoryAgents({ jobs: [stop, root], orders: [order], now }).find(r => r.id === "discover")!.state, "en_espera");
});

test("API readiness and admissions today", () => {
  assert.equal(apiReadinessLabel("FACTORY_API_READY", true).ready, true);
  assert.match(apiReadinessLabel("FACTORY_API_UNKNOWN_HOLD", false).text, /reconciliaci/);
  assert.equal(apiReadinessLabel(undefined, undefined).ready, false);
  assert.equal(admissionsToday([root, { ...root, id: "old", createdAt: "2026-11-24T23:00:00Z" }], now), 1);
});
