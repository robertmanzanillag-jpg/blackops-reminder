import test from "node:test";
import assert from "node:assert/strict";
import {
  advanceAcademy,
  advanceCompany,
  completeOrder,
  createOrder,
  emptyCompanyState,
  enrollTrainee,
  leaderboard,
  parseCompanyState,
  personalityFor,
  routeOrder,
} from "../shared/agent-company";

const NOW = Date.parse("2026-11-04T12:00:00Z");
const MIN = 60_000;
const roles = { clippers: "Clippers", radio: "Radio", legal: "Legal", "kong-ai": "KONG AI" };
const s = (state: "working" | "needs-setup" | "error" | "offline" | "checking", label: string = state) => ({ state, label });

test("working agents earn points and battery; failing agents lose them", () => {
  let company = emptyCompanyState();
  for (let i = 0; i < 3; i++) company = advanceCompany(company, { now: NOW + i * 15 * MIN, statuses: { radio: s("working"), clippers: s("error") }, roles }).state;
  assert.equal(company.careers.radio.points, 30);
  assert.equal(company.careers.radio.battery, 98);
  assert.equal(company.careers.clippers.points, 0, "points never go below zero");
  assert.equal(company.careers.clippers.battery, 50);
  assert.equal(company.careers.radio.cyclesWorking, 3);
});

test("'checking' gives no points and no penalty (no evidence yet)", () => {
  const company = advanceCompany(emptyCompanyState(), { now: NOW, statuses: { radio: s("checking") }, roles }).state;
  assert.equal(company.careers.radio.points, 0);
  assert.equal(company.careers.radio.battery, 80);
});

test("empty battery: the CEO fires the agent, a replacement trains in the academy and is protected while studying", () => {
  let company = emptyCompanyState();
  let fired: Array<{ agentId: string }> = [];
  let i = 0;
  for (; i < 200 && fired.length === 0; i++) {
    const result = advanceCompany(company, { now: NOW + i * 15 * MIN, statuses: { clippers: s("error", "Worker con error") }, roles });
    company = result.state;
    fired = result.fired;
  }
  assert.equal(fired.length, 1);
  assert.ok((i - 1) * 15 * MIN >= 24 * 60 * MIN, "a new hire gets at least a day before being fired");
  const career = company.careers.clippers;
  assert.equal(career.generation, 2);
  assert.equal(career.firedCount, 1);
  assert.equal(career.battery, 60);
  assert.equal(career.inTrainingUntilGeneration, 2);
  assert.equal(company.trainees.length, 1);
  assert.match(company.events[0].text, /despidio/);
  const during = advanceCompany(company, { now: NOW + (i + 20) * 15 * MIN, statuses: { clippers: s("error") }, roles }).state;
  assert.equal(during.careers.clippers.battery, 60, "no penalty while training");
});

test("exempt agents (no backend yet) are never scored, fired or ranked", () => {
  let company = emptyCompanyState();
  let firedTotal = 0;
  for (let i = 0; i < 40; i++) {
    const result = advanceCompany(company, { now: NOW + i * 15 * MIN, statuses: { "kong-ai": s("offline") }, roles, exempt: ["kong-ai"] });
    company = result.state;
    firedTotal += result.fired.length;
  }
  assert.equal(firedTotal, 0);
  assert.equal(company.careers["kong-ai"], undefined);
  assert.equal(leaderboard(company).length, 0);
});

test("needs-setup (waiting on Robert) drains slowly but is never fired for it", () => {
  let company = emptyCompanyState();
  let firedTotal = 0;
  for (let i = 0; i < 200; i++) {
    const result = advanceCompany(company, { now: NOW + i * 15 * MIN, statuses: { revenue: s("needs-setup") }, roles });
    company = result.state;
    firedTotal += result.fired.length;
  }
  assert.equal(firedTotal, 0);
  assert.equal(company.careers.revenue.battery, 20);
});

test("state from disk: malformed careers/orders never crash, legacy shapes reset", () => {
  assert.deepEqual(parseCompanyState({ version: 1, careers: null, trainees: [], orders: [] }).careers, {});
  const parsed = parseCompanyState({ version: 1, careers: { a: { agentId: "a", nickname: "Vale", points: 3, battery: 50 }, b: null, c: { agentId: "c" } }, trainees: [null, { id: "t" }], orders: [{ id: "o", text: "x" }, null], events: [null, { at: "x", text: "ok" }] });
  assert.deepEqual(Object.keys(parsed.careers), ["a"]);
  assert.deepEqual(parsed.careers.a.memory, []);
  assert.equal(parsed.trainees.length, 0);
  assert.equal(parsed.orders.length, 0);
  assert.equal(parsed.events.length, 1);
});

test("academy: one real module per cycle, then graduation puts the agent back to work", () => {
  let company = enrollTrainee(emptyCompanyState(), { id: "new_agent:helper-radio", forAgentId: "radio", role: "Asistente de Radio", now: NOW });
  company = { ...company, careers: { radio: { ...advanceCompany(emptyCompanyState(), { now: NOW, statuses: { radio: s("working") }, roles }).state.careers.radio, inTrainingUntilGeneration: 1 } } };
  const curriculum = () => [
    { id: "agents-md", title: "Reglas", summary: "PR-first" },
    { id: "schema", title: "Base de datos", summary: "40 tablas" },
  ];
  company = advanceAcademy(company, curriculum, NOW + MIN);
  assert.deepEqual(company.trainees[0].modulesDone, ["agents-md"]);
  company = advanceAcademy(company, curriculum, NOW + 2 * MIN);
  assert.equal(company.trainees[0].graduatedAt, undefined);
  company = advanceAcademy(company, curriculum, NOW + 3 * MIN);
  assert.ok(company.trainees[0].graduatedAt);
  assert.equal(company.careers.radio.inTrainingUntilGeneration, undefined);
  assert.match(company.events[0].text, /graduo/);
  assert.equal(enrollTrainee(company, { id: "new_agent:helper-radio", forAgentId: "radio", role: "x", now: NOW }).trainees.length, 1, "no duplicate enrollment");
});

test("CEO channel routes Robert's words to the right agents", () => {
  const all = ["assistant", "blackroom-videos", "kong-videos", "clippers", "radio", "news", "legal", "app-qa", "code", "marketing-cmo", "revenue", "mechanic"];
  assert.deepEqual(routeOrder("Sube el video nuevo de Black Room", all), ["blackroom-videos", "radio", "clippers", "kong-videos"]);
  assert.deepEqual(routeOrder("revisa los terminos de Kong", all), ["kong-videos", "legal"]);
  assert.deepEqual(routeOrder("La app tiene un bug en el login", all), ["app-qa", "code"]);
  assert.deepEqual(routeOrder("Necesito una noticia para hoy", all), ["news"]);
  assert.deepEqual(routeOrder("hola", all), ["assistant"], "unknown requests go to the assistant");
  assert.deepEqual(routeOrder("arregla el agente de radio que esta caido", all), ["radio", "mechanic"]);
});

test("orders: working agents take them, others are blocked; Robert's OK gives points once", () => {
  let company = advanceCompany(emptyCompanyState(), { now: NOW, statuses: { radio: s("working"), legal: s("needs-setup", "GitHub sin conectar") }, roles }).state;
  const { state, order } = createOrder(company, { text: "Prepara la radio del viernes y revisa lo legal", now: NOW + MIN, statuses: { radio: s("working"), legal: s("needs-setup", "GitHub sin conectar") }, available: ["radio", "legal", "assistant"], names: roles });
  assert.deepEqual(order.assignees.map((a) => [a.agentId, a.status]), [["radio", "en_curso"], ["legal", "bloqueada"]]);
  assert.match(order.assignees[1].note, /GitHub sin conectar/);
  company = completeOrder(state, order.id, NOW + 2 * MIN);
  assert.equal(company.careers.radio.points, 10 + 25);
  assert.equal(company.careers.legal.points, 0, "no points for an order the agent could not work on");
  assert.equal(company.careers.radio.ordersDone, 1);
  assert.equal(completeOrder(company, order.id, NOW + 3 * MIN).careers.radio.points, 35, "completing twice does not pay twice");
});

test("leaderboard: best agent is the deputy under the CEO; the CEO is not ranked", () => {
  let company = emptyCompanyState();
  for (let i = 0; i < 4; i++) company = advanceCompany(company, { now: NOW + i * MIN, statuses: { radio: s("working"), legal: s("needs-setup"), ceo: s("working") }, roles }).state;
  const rows = leaderboard(company);
  assert.deepEqual(rows.map((row) => row.agentId), ["radio", "legal"]);
  assert.match(rows[0].title, /Subdirector/);
  assert.equal(rows[0].reliability, 100);
});

test("personalities are stable per agent and change with each new generation", () => {
  assert.deepEqual(personalityFor("radio", 1), personalityFor("radio", 1));
  assert.notDeepEqual(personalityFor("radio", 1), personalityFor("radio", 2));
  assert.ok(personalityFor("radio", 1).traits.length >= 1);
  assert.deepEqual(parseCompanyState({ version: 9 }), emptyCompanyState());
});

test("nicknames are never repeated across the team and the academy", () => {
  const ids = Array.from({ length: 30 }, (_, i) => `agent-${i}`);
  const statuses = Object.fromEntries(ids.map((id) => [id, { state: "working" as const, label: "ok" }]));
  let state = advanceCompany(emptyCompanyState(), { now: Date.parse("2026-11-04T10:00:00Z"), statuses, roles: {} }).state;
  state = enrollTrainee(state, { id: "new_agent:x", forAgentId: "agent-1", role: "Ayudante", now: Date.parse("2026-11-04T10:05:00Z") });
  const names = [...Object.values(state.careers).map((c) => c.nickname), ...state.trainees.map((t) => t.nickname)];
  assert.equal(new Set(names).size, names.length);
});
