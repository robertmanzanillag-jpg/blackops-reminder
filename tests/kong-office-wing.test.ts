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
  assert.equal(current.agents.find(agent=>agent.id === "kong:new_department")?.status.state, "needs-setup");
  const expired = buildKongOfficeWing(evidence, [], {}, now + 300001);
  assert.ok(expired.agents.every(agent=>agent.status.state !== "working"));
  const disconnected = buildKongOfficeWing(undefined, [], {}, now);
  assert.ok(disconnected.agents.every(agent=>agent.status.state !== "working"));
});

test("Native aliases reuse the observed desk and the external video seat", () => {
  const native = { ...evidence, agents: [
    { ...evidence.agents[0], id: "venues", name: "Venues", kind: "department", state: "running" },
    { ...evidence.agents[0], id: "native-video", name: "Videos Kong", kind: "department", state: "running" },
  ] } as OfficeKongAuditResult["evidence"];
  const wing = buildKongOfficeWing(native, [], {"kong-videos": {state:"offline",label:"Publicador externo"}}, now);
  assert.equal(wing.agents.filter(agent=>agent.kongEvidence?.id === "kong:Venues").length, 1);
  assert.equal(wing.agents.find(agent=>agent.id === "kong:venues")?.status.state, "available");
  assert.ok(!wing.agents.some(agent=>agent.id === "kong:Venues"));
  assert.ok(!wing.agents.some(agent=>agent.id === "kong:native-video"));
  assert.equal(wing.agents.find(agent=>agent.id === "kong-videos")?.status.state, "offline");
  assert.equal(wing.departments.flatMap(group=>group.agentIds).filter(id=>id === "kong-videos").length, 1);
});

test("second ring uses event volume, not scheduler concurrency, and remains fixed between polls", async () => {
  const { createKongRingAssignment } = await import("../client/src/lib/kong-office-wing");
  const directory = Array.from({length:12}, (_, i) => ({id:`city-${String(i).padStart(2,"0")}`,name:`City ${i}`,countryCode:"US",timeZone:"America/New_York",currency:"USD"}));
  const rooms = buildOfficeCityRoomsFromSnapshot(directory, undefined, now);
  rooms.forEach((room, index) => { room.upcomingEvents = index; room.agents.forEach(agent => {agent.snapshotAt=new Date(now).toISOString();}); });
  rooms[0].agents.forEach(agent => {agent.hasDurableEvidence=true;agent.status={state:"working",label:"Working"};});
  const captured = createKongRingAssignment(rooms, now);
  assert.equal(captured.basis,"events");
  assert.equal(captured.busyCityIds.length,8);
  assert.equal(captured.busyCityIds[0],"city-11");
  assert.ok(!captured.busyCityIds.includes("city-00"));
  const initial = buildKongOfficeWing(evidence, rooms, {}, now, captured).departments;
  const refreshed = [...rooms].reverse().map(room=>({...room,upcomingEvents:room.city.id==="city-00"?999:0}));
  const unchanged = buildKongOfficeWing(evidence, refreshed, {}, now+1000, captured).departments;
  assert.deepEqual(unchanged.map(group=>[group.id,group.officeRing]),initial.map(group=>[group.id,group.officeRing]));
  assert.equal(createKongRingAssignment(refreshed,now+1000).busyCityIds[0],"city-00");
  assert.ok(initial.filter(group=>!group.id.startsWith("kong-city:")).every(group=>group.officeRing===1));
});

test("zero catalog is measurable; missing evidence never invents busy cities", async () => {
  const { createKongRingAssignment } = await import("../client/src/lib/kong-office-wing");
  const rooms = buildOfficeCityRoomsFromSnapshot([{id:"miami",name:"Miami",countryCode:"US",timeZone:"America/New_York",currency:"USD"}],undefined,now);
  assert.deepEqual(createKongRingAssignment(rooms,now).busyCityIds,[]);
  rooms[0].upcomingEvents=0;
  assert.deepEqual(createKongRingAssignment(rooms,now).busyCityIds,["miami"]);
  rooms[0].upcomingEvents=null;
  const job=rooms[0].agents[0];job.hasDurableEvidence=true;job.snapshotAt=new Date(now).toISOString();job.lastWorkAt=new Date(now-1000).toISOString();
  assert.equal(createKongRingAssignment(rooms,now).basis,"operations");
  assert.deepEqual(createKongRingAssignment(rooms,now+300001).busyCityIds,[]);
});

test("three-ring layout keeps every platform distinct and reserves space between rings", async () => {
  const { officeConcentricRingLayout } = await import("../client/src/components/agents-world-office/office-scene");
  const groups = [
    ...Array.from({length:7},(_,i)=>({id:`central-${i}`,agentCount:i===0?20:5,ring:1 as const})),
    ...Array.from({length:8},(_,i)=>({id:`busy-${i}`,agentCount:7,ring:2 as const})),
    ...Array.from({length:17},(_,i)=>({id:`other-${i}`,agentCount:7,ring:3 as const})),
  ];
  const layout=officeConcentricRingLayout(groups);
  assert.equal(layout.positions.length,groups.length);
  assert.ok(layout.radii[0]<layout.radii[1]&&layout.radii[1]<layout.radii[2]);
  for(const [index,a] of layout.positions.entries())for(const b of layout.positions.slice(index+1))assert.ok(Math.hypot(a.x-b.x,a.z-b.z)>=a.footprint+b.footprint,`${a.id} overlaps ${b.id}`);
  assert.ok(layout.positions.every(position=>Math.hypot(position.x,position.z)+position.footprint<=layout.extent+1e-9));
  const emptyMiddle=officeConcentricRingLayout(groups.filter(group=>group.ring!==2));
  assert.equal(emptyMiddle.radii.length,3);
  assert.ok(emptyMiddle.radii[2]>emptyMiddle.radii[1]);
});
