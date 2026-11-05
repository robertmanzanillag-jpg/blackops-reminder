import test from "node:test";
import assert from "node:assert/strict";
import {
  advanceAcademy,
  advanceCompany,
  completeOrder,
  createOrder,
  emptyCompanyState,
  enrollTrainee,
  evidenceAlreadyUsed,
  learnLessons,
  specialistNeeds,
  tailoredModules,
  SPECIALIST_PREFIX,
  specialistIdFor,
  specialistTopicLabel,
  orderTopic,
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

test("orders: working agents take them, others are blocked; verified evidence gives points once", () => {
  let company = advanceCompany(emptyCompanyState(), { now: NOW, statuses: { radio: s("working"), legal: s("needs-setup", "GitHub sin conectar") }, roles }).state;
  const { state, order } = createOrder(company, { text: "Prepara la radio del viernes y revisa lo legal", now: NOW + MIN, statuses: { radio: s("working"), legal: s("needs-setup", "GitHub sin conectar") }, available: ["radio", "legal", "assistant"], names: roles });
  assert.deepEqual(order.assignees.map((a) => [a.agentId, a.status]), [["radio", "en_curso"], ["legal", "bloqueada"]]);
  assert.match(order.assignees[1].note, /GitHub sin conectar/);
  const evidence = { ref: "automation_run:r1", source: "automation_run" as const, summary: "Radio publicada", at: new Date(NOW).toISOString() };
  company = completeOrder(state, order.id, NOW + 2 * MIN, evidence);
  assert.equal(company.careers.radio.points, 10 + 25);
  assert.equal(company.orders[0].closedBy, "evidencia");
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

test("orders closed by hand are recorded with no points; one evidence closes only one order", () => {
  let company = advanceCompany(emptyCompanyState(), { now: NOW, statuses: { radio: s("working") }, roles }).state;
  const first = createOrder(company, { text: "Radio del viernes", now: NOW + MIN, statuses: { radio: s("working") }, available: ["radio"], names: roles });
  const byHand = completeOrder(first.state, first.order.id, NOW + 2 * MIN);
  assert.equal(byHand.careers.radio.points, 10);
  assert.equal(byHand.orders[0].closedBy, "robert");
  const evidence = { ref: "automation_run:r9", source: "automation_run" as const, summary: "ok", at: new Date(NOW).toISOString() };
  const second = createOrder(byHand, { text: "Radio del sabado", now: NOW + 3 * MIN, statuses: { radio: s("working") }, available: ["radio"], names: roles });
  company = completeOrder(second.state, second.order.id, NOW + 4 * MIN, evidence);
  assert.equal(company.careers.radio.points, 35);
  assert.ok(evidenceAlreadyUsed(company, "automation_run:r9"));
  const third = createOrder(company, { text: "Radio del domingo", now: NOW + 5 * MIN, statuses: { radio: s("working") }, available: ["radio"], names: roles });
  const reused = completeOrder(third.state, third.order.id, NOW + 6 * MIN, evidence);
  assert.equal(reused.careers.radio.points, 35, "the same run never pays twice");
});

// ---------- Academy from real work, skills, specialists ----------

test("the academy teaches each trainee its own job first: why it failed, its orders, its lessons", () => {
  let company = advanceCompany(emptyCompanyState(), { now: NOW, statuses: { clippers: s("working") }, roles }).state;
  company = createOrder(company, { text: "Sube el clip del viernes", now: NOW + MIN, statuses: { clippers: s("error", "Worker con error") }, available: ["clippers"], names: roles }).state;
  const modules = tailoredModules(company, "clippers", { status: s("error", "Worker con error"), lessons: [{ key: "l1", subject: "clippers", label: "Configura el token antes de publicar" }] });
  assert.deepEqual(modules.map((module) => module.id.split(":")[0]), ["puesto", "orden", "leccion"]);
  assert.match(modules[0].summary, /Worker con error/);
  // A trainee for that job studies those first and graduates with them as skills.
  company = enrollTrainee(company, { id: "new_agent:helper-clippers", forAgentId: "clippers", role: "Ayudante de Clippers", now: NOW + 2 * MIN });
  const general = [{ id: "rules", title: "Reglas", summary: "PR-first" }];
  for (let i = 0; i < 6; i++) company = advanceAcademy(company, () => [...modules, ...general], NOW + (3 + i) * MIN);
  const titles = (company.careers.clippers.skills || []).map((skill) => skill.title);
  assert.ok(titles.includes("Por que este puesto no estaba trabajando"), titles.join(" | "));
  assert.ok(titles.some((title) => title.startsWith("Orden: Sube el clip")));
  assert.ok(titles.some((title) => title.startsWith("Leccion:")));
  assert.ok(!titles.includes("Reglas"), "general docs are not job skills");
});

test("skills are earned by closing orders with evidence and by approved lessons; uses are counted", () => {
  let company = advanceCompany(emptyCompanyState(), { now: NOW, statuses: { radio: s("working") }, roles }).state;
  for (let i = 0; i < 2; i++) {
    const placed = createOrder(company, { text: `Programa la radio ${i}`, now: NOW + i * MIN, statuses: { radio: s("working") }, available: ["radio"], names: roles });
    company = completeOrder(placed.state, placed.order.id, NOW + i * MIN + 1, { ref: `automation_run:r${i}`, source: "automation_run", summary: "ok", at: new Date(NOW).toISOString() });
  }
  const skill = company.careers.radio.skills?.find((item) => item.id === "orden:radio");
  assert.equal(skill?.uses, 2);
  const byHand = createOrder(company, { text: "Programa la radio otra vez", now: NOW + 9 * MIN, statuses: { radio: s("working") }, available: ["radio"], names: roles });
  assert.equal(completeOrder(byHand.state, byHand.order.id, NOW + 10 * MIN).careers.radio.skills?.find((item) => item.id === "orden:radio")?.uses, 2, "no skill without evidence");
  company = learnLessons(company, [{ key: "l2", subject: "radio", label: "Revisa la hora antes de programar" }], NOW + 11 * MIN);
  company = learnLessons(company, [{ key: "l2", subject: "radio", label: "Revisa la hora antes de programar" }], NOW + 12 * MIN);
  assert.equal(company.careers.radio.skills?.filter((item) => item.source === "leccion").length, 1);
});

test("recurring blocked work creates a specialist: proposal need, academy, new agent that takes those orders", () => {
  let company = emptyCompanyState();
  for (let i = 0; i < 3; i++) company = createOrder(company, { text: `Sube el video ${i} a tiktok`, now: NOW + i * MIN, statuses: {}, available: ["clippers"], names: roles }).state;
  const needs = specialistNeeds(company, NOW + 10 * MIN);
  assert.equal(needs.length, 1);
  assert.equal(needs[0].topic, "video");
  assert.equal(specialistNeeds(company, NOW + 20 * 24 * 60 * MIN).length, 0, "old orders do not count");
  company = enrollTrainee(company, { id: "new_agent:specialist-video", forAgentId: `${SPECIALIST_PREFIX}video`, role: "Especialista en video", now: NOW + 11 * MIN });
  const curriculum = () => [...tailoredModules(company, `${SPECIALIST_PREFIX}video`, { topic: "video" }), { id: "rules", title: "Reglas", summary: "PR-first" }];
  for (let i = 0; i < 6; i++) company = advanceAcademy(company, curriculum, NOW + (12 + i) * MIN);
  const specialist = company.careers[`${SPECIALIST_PREFIX}video`];
  assert.ok(specialist, "the specialist exists after graduating");
  assert.ok((specialist.skills || []).filter((skill) => skill.id.startsWith("orden:")).length >= 3);
  const next = createOrder(company, { text: "Sube el video nuevo", now: NOW + 30 * MIN, statuses: {}, available: ["clippers"], names: roles });
  const assignee = next.order.assignees.find((item) => item.agentId === `${SPECIALIST_PREFIX}video`);
  assert.equal(assignee?.status, "en_curso");
});

test("specialists: topics with spaces round-trip (black room) and only exact topics are assigned", () => {
  assert.equal(specialistIdFor("black room"), "specialist:black-room");
  assert.equal(specialistTopicLabel("specialist:black-room"), "black room");
  let company = emptyCompanyState();
  for (let i = 0; i < 3; i++) company = createOrder(company, { text: `Flyer ${i} para black room`, now: NOW + i * MIN, statuses: {}, available: ["radio"], names: roles }).state;
  const [need] = specialistNeeds(company, NOW + 5 * MIN);
  assert.equal(need.topic, "black room");
  company = enrollTrainee(company, { id: "new_agent:specialist-black-room", forAgentId: specialistIdFor(need.topic), role: "Especialista en black room", now: NOW + 6 * MIN });
  const studied = tailoredModules(company, "specialist:black-room", { topic: "black-room" });
  assert.equal(studied.filter((module) => module.id.startsWith("orden:")).length, 3, "it studies the orders it was hired for");
  for (let i = 0; i < 6; i++) company = advanceAcademy(company, (trainee) => tailoredModules(company, trainee.forAgentId, { topic: "black-room" }), NOW + (7 + i) * MIN);
  assert.ok(company.careers["specialist:black-room"]);
  const next = createOrder(company, { text: "Otro flyer para Black Room", now: NOW + 20 * MIN, statuses: {}, available: ["radio"], names: roles });
  assert.ok(next.order.assignees.some((assignee) => assignee.agentId === "specialist:black-room"));
  assert.match(next.order.assignees.find((assignee) => assignee.agentId === "specialist:black-room")!.note, /especialista/);
});

test("specialists never take unrelated orders through a substring (pr / producto, cita / solicita)", () => {
  let company = emptyCompanyState();
  company = { ...company, careers: { "specialist:pr": { agentId: "specialist:pr", generation: 1, nickname: "Pi", points: 0, battery: 80, lastState: null, cyclesWorking: 0, cyclesTotal: 0, ordersDone: 0, firedCount: 0, hiredAt: new Date(NOW).toISOString(), memory: [] } } };
  const order = createOrder(company, { text: "subir producto a la tienda", now: NOW, statuses: {}, available: ["dropshipping"], names: roles }).order;
  assert.ok(!order.assignees.some((assignee) => assignee.agentId === "specialist:pr"));
  assert.notEqual(orderTopic("solicita el contrato"), "cita");
  assert.equal(orderTopic("revisa el PR de la app"), "app", "work words win; whole words only");
});
