import test from "node:test";
import assert from "node:assert/strict";
import { kongAgentStatuses, kongCareerId } from "../shared/kong-office-agents";

test("only verified KONG evidence counts as working; disabled and on-demand agents are not scored", () => {
  const { statuses, roles } = kongAgentStatuses([
    { id: "city:miami", name: "Miami", kind: "city", state: "running" },
    { id: "venue_deals", name: "Locales y acuerdos", kind: "department", state: "healthy" },
    { id: "finance_risk", name: "Finanzas y riesgo", kind: "department", state: "attention", blocker: "Revisar el último informe" },
    { id: "growth_analytics", name: "Crecimiento", kind: "department", state: "stale" },
    { id: "chief_of_staff", name: "CEO", kind: "coordinator", state: "unknown" },
    { id: "image_health", name: "Imágenes", kind: "system", state: "disabled" },
    { id: "kong_ai_chat", name: "KONG AI", kind: "system", state: "unknown" },
  ]);
  assert.equal(statuses[kongCareerId("city:miami")].state, "working");
  assert.equal(statuses[kongCareerId("venue_deals")].state, "working");
  assert.equal(statuses[kongCareerId("finance_risk")].state, "error");
  assert.equal(statuses[kongCareerId("finance_risk")].detail, "Revisar el último informe");
  assert.equal(statuses[kongCareerId("growth_analytics")].state, "offline");
  assert.equal(statuses[kongCareerId("chief_of_staff")].state, "offline");
  assert.equal(statuses[kongCareerId("image_health")], undefined, "disabled is never scored");
  assert.equal(statuses[kongCareerId("kong_ai_chat")], undefined, "on-demand is never scored for being idle");
  assert.equal(roles[kongCareerId("city:miami")], "KONG Miami");
  assert.equal(roles[kongCareerId("finance_risk")], "Finanzas y riesgo");
});
