import test from "node:test";
import assert from "node:assert/strict";
import { buildKongOfficeWing } from "../client/src/lib/kong-office-wing";
import { buildOfficeCityRoomsFromSnapshot } from "../client/src/lib/office-city-agents";
import type { OfficeKongAuditResult } from "../server/office-kong";

const now = Date.parse("2026-11-05T23:00:00Z");
const evidence = { generatedAt: new Date(now).toISOString(), cityAgentsEnabled: true, cities: [], agents: [
  { id: "chief_of_staff", name: "CEO KONG", kind: "coordinator", owner: "KONG", responsibility: "Coordinar", state: "healthy", lastRunAt: new Date(now - 60000).toISOString(), nextRunAt: null, blocker: null, nextAction: "Esperar turno", issues: [] },
  { id: "new_department", name: "Nuevo departamento", kind: "department", owner: "KONG", responsibility: "Revisar", state: "running", lastRunAt: null, nextRunAt: null, blocker: null, nextAction: "Revisando", issues: [] },
] } as OfficeKongAuditResult["evidence"];

test("KONG includes every observed central agent and every configured city seat in one layout", () => {
  const directory = Array.from({length:25}, (_, i) => ({id:`city-${i}`,name:`City ${i}`,countryCode:"US",timeZone:"America/New_York",currency:"USD"}));
  const cities = buildOfficeCityRoomsFromSnapshot(directory, undefined, now);
  const wing = buildKongOfficeWing(evidence, cities, {}, now);
  const ids = wing.departments.flatMap(group => group.agentIds);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(ids.filter(id=>id.startsWith("kong-city:")).length, 175);
  assert.ok(ids.includes("kong:new_department"));
  assert.ok(ids.includes("kong-videos"));
  assert.ok(ids.includes("kong-metrics"));
});

test("completed evidence does not animate as working; expired evidence clears running", () => {
  const current = buildKongOfficeWing(evidence, [], {}, now);
  assert.equal(current.agents.find(agent=>agent.id === "kong:chief_of_staff")?.status.state, "offline");
  assert.equal(current.agents.find(agent=>agent.id === "kong:new_department")?.status.state, "working");
  const expired = buildKongOfficeWing(evidence, [], {}, now + 300001);
  assert.ok(expired.agents.every(agent=>agent.status.state !== "working"));
  const disconnected = buildKongOfficeWing(undefined, [], {}, now);
  assert.ok(disconnected.agents.every(agent=>agent.status.state !== "working"));
});
