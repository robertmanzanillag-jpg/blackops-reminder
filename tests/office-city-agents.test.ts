import assert from "node:assert/strict";
import test from "node:test";
import { buildOfficeCityRooms, officeCityCountries, officeCityEvidenceExpiresAt, parseOfficeCityDirectory, selectLatestOfficeKongAudit, OFFICE_CITY_CATEGORIES } from "../client/src/lib/office-city-agents";
import { officeCityDeskPosition, officeCityMapPosition } from "../client/src/components/agents-world-office/office-scene";

const now = Date.parse("2026-11-05T14:00:00Z");
const stamp = (delta: number) => new Date(now + delta).toISOString();
const miami = { id: "miami", name: "Miami", countryCode: "US", timeZone: "America/New_York", currency: "USD" };
const ba = { id: "buenos-aires", name: "Buenos Aires", countryCode: "AR", timeZone: "America/Argentina/Buenos_Aires", currency: "ARS" };
const job = (category: string, state = "healthy", options: Record<string, unknown> = {}) => ({ category, state, evidence: "persisted", lastRunAt: stamp(-90000), lastSuccessAt: stamp(-90000), lastStartedAt: stamp(-100000), nextRunAt: stamp(50000), leaseUntil: state === "running" ? stamp(360000) : null, issues: [], ...options });
const run = (cities: unknown[], options: Record<string, unknown> = {}) => ({ id: "audit-1", kind: "kong_audit", status: "completed", createdAt: stamp(-3000), completedAt: stamp(-1000), evidence: { generatedAt: stamp(-2000), citySnapshotCheckedAt: stamp(-1000), cityAgentsEnabled: true, cities, ...options } });

test("all 25 registered cities have separate map positions and seven distinct roles", () => {
  const cities = [miami, ...Array.from({ length: 23 }, (_, n) => ({ ...miami, id: `fixture-${n}`, name: `Fixture city ${n}` })), ba];
  const rooms = buildOfficeCityRooms(parseOfficeCityDirectory(cities), [], now);
  assert.equal(rooms.length, 25);
  assert.equal(new Set(rooms.flatMap(room => room.agents.map(agent => agent.id))).size, 175);
  const positions = rooms.map((_, index) => officeCityMapPosition(index, rooms.length));
  assert.equal(new Set(positions.map(({ x, z }) => `${x},${z}`)).size, 25);
  assert.deepEqual(positions.map(({ x, z }) => Math.round(Math.hypot(x, z))), [...Array(8).fill(12), ...Array(17).fill(24)]);
  assert.ok(positions.every(({ x, z }) => x !== 0 || z !== 0));
  for (const room of rooms) assert.deepEqual(room.agents.map(agent => agent.category), OFFICE_CITY_CATEGORIES.map(category => category.id));
  const desks = rooms.flatMap((room, cityIndex) => room.agents.map((_, deskIndex) => {
    const { x, z } = officeCityDeskPosition(deskIndex);
    return `${positions[cityIndex].x + x},${positions[cityIndex].z + z}`;
  }));
  assert.equal(new Set(desks).size, 175);
});

test("fresh evidence animates only running jobs; completed jobs are distinct and missing jobs stay gray", () => {
  const rooms = buildOfficeCityRooms([miami], [run([{ ...miami, categories: [job("clubs", "running"), job("vip"), job("restaurants", "healthy", { evidence: "missing" }), job("events", "attention", { recordedFailure: true, issues: ["Falta la fuente"] }), job("sports", "attention", { recordedFailure: false, intervalMs: 600_000, issues: ["La fuente limitó las consultas (HTTP 429)."] })] }])], now);
  const jobs = rooms[0].agents;
  assert.deepEqual(jobs.filter(agent => agent.status.state === "working").map(agent => agent.category), ["clubs"]);
  assert.equal(jobs[0].lastStartedAt, stamp(-100000));
  assert.equal(jobs[1].status.label, "Completado · no ejecutando");
  assert.equal(jobs[1].status.state, "offline");
  assert.equal(jobs[1].lastWorkAt, stamp(-90000));
  assert.equal(jobs[1].nextWorkAt, stamp(50000));
  assert.equal(jobs[2].color, "#94a3b8");
  assert.equal(jobs[2].hasDurableEvidence, false);
  assert.equal(jobs[3].status.state, "error");
  assert.equal(jobs[3].blocker, "Falta la fuente");
  assert.equal(jobs[4].status.label, "Completado con avisos");
  assert.equal(jobs[4].color, "#fbbf24");
  assert.equal(jobs.filter(agent => agent.hasDurableEvidence).length, 4);
});

test("measured city event load ranks higher demand first and keeps zero distinct from unknown", () => {
  const third = { ...ba, id: "unknown", name: "Unknown" };
  const snapshot = run([
    { ...miami, categories: [], eventLoad: { upcomingEvents: 0, windowDays: 30, checkedAt: stamp(-1000) } },
    { ...ba, categories: [], eventLoad: { upcomingEvents: 8, windowDays: 30, checkedAt: stamp(-300_000) } },
    { ...third, categories: [], eventLoad: { upcomingEvents: 99, windowDays: 30, checkedAt: stamp(-600_001) } },
  ]);
  assert.deepEqual(buildOfficeCityRooms([third, miami, ba], [snapshot], now).map(room => [room.name, room.upcomingEvents]), [[ba.name, 8], [miami.name, 0], [third.name, null]]);
});

test("stale, future, inaccessible and disabled snapshots never show active work", () => {
  const cities = [{ ...miami, categories: [job("clubs", "running")] }];
  for (const runs of [
    undefined,
    [run(cities, { generatedAt: stamp(-300001) })],
    [run(cities, { citySnapshotCheckedAt: stamp(-300001) })],
    [run(cities, { generatedAt: stamp(30001) })],
    [run(cities, { cityAgentsEnabled: false })],
  ]) assert.ok(buildOfficeCityRooms([miami], runs, now)[0].agents.every(agent => agent.status.state !== "working"));
});

test("the earlier evidence timestamp expires the running animation exactly at the freshness boundary", () => {
  const runs = [run([{ ...miami, categories: [job("clubs", "running")] }], { generatedAt: stamp(-5000), citySnapshotCheckedAt: stamp(-1000) })];
  const expiry = officeCityEvidenceExpiresAt(runs, now)!;
  assert.equal(expiry, now + 295000);
  assert.equal(buildOfficeCityRooms([miami], runs, expiry)[0].agents[0].status.state, "working");
  assert.equal(buildOfficeCityRooms([miami], runs, expiry + 1)[0].agents[0].status.state, "offline");
});

test("running expires at its lease, then the next running lease controls the next timer", () => {
  const runs = [run([{ ...miami, categories: [job("clubs", "running", { leaseUntil: stamp(10000) }), job("vip", "running", { leaseUntil: stamp(20000) }), job("restaurants", "running", { leaseUntil: null })] }])];
  assert.equal(officeCityEvidenceExpiresAt(runs, now), now + 10000);
  assert.deepEqual(buildOfficeCityRooms([miami], runs, now)[0].agents.filter(agent => agent.status.state === "working").map(agent => agent.category), ["clubs", "vip"]);
  assert.equal(officeCityEvidenceExpiresAt(runs, now + 10000), now + 20000);
  assert.deepEqual(buildOfficeCityRooms([miami], runs, now + 10000)[0].agents.filter(agent => agent.status.state === "working").map(agent => agent.category), ["vip"]);
  assert.ok(buildOfficeCityRooms([miami], runs, now + 20000)[0].agents.every(agent => agent.status.state !== "working"));
});

test("a late completion of an older request cannot overwrite a newer audit failure", () => {
  const old = { ...run([{ ...miami, categories: [job("clubs", "running")] }]), completedAt: stamp(-1) };
  const latest = { id: "audit-2", kind: "kong_audit", status: "blocked", createdAt: stamp(-2000), completedAt: stamp(-10) };
  assert.equal(selectLatestOfficeKongAudit([old, latest]), latest);
  assert.equal(buildOfficeCityRooms([miami], [old, latest], now)[0].agents[0].status.state, "offline");
});

test("same-time terminal audits use a stable ID tie-break and ignore pending requests", () => {
  const old = run([]);
  const sameTime = { ...old, id: "audit-2", status: "failed" };
  const pending = { ...old, id: "audit-3", status: "running", createdAt: stamp(-1) };
  assert.equal(selectLatestOfficeKongAudit([sameTime, pending, old]), sameTime);
});

test("incomplete or ambiguous identities never borrow another city or job's activity", () => {
  const wrongCity = run([{ ...miami, countryCode: "AR", categories: [job("clubs", "running")] }]);
  const duplicateCategory = run([{ ...miami, categories: [job("clubs", "running"), job("clubs", "running")] }]);
  const futureStart = run([{ ...miami, categories: [job("clubs", "running", { lastStartedAt: stamp(30001) })] }]);
  const noStart = run([{ ...miami, categories: [job("clubs", "running", { lastStartedAt: null })] }]);
  for (const evidence of [wrongCity, duplicateCategory, futureStart, noStart]) assert.equal(buildOfficeCityRooms([miami], [evidence], now)[0].agents[0].status.state, "offline");
});

test("missing or invalid public registry yields no invented cities", () => {
  for (const value of [undefined, null, { cities: [miami] }, [miami, miami], [{ ...miami, currency: "" }]]) {
    assert.deepEqual(buildOfficeCityRooms(parseOfficeCityDirectory(value), [], now), []);
  }
});

test("country filter options come only from the roster and preserve city counts", () => {
  const options = officeCityCountries([miami, ba, { ...miami, id: "another-fixture-city", name: "Fixture city" }]);
  assert.deepEqual(options.map(({ code, cityCount }) => ({ code, cityCount })), [{ code: "AR", cityCount: 1 }, { code: "US", cityCount: 2 }]);
  assert.ok(options.every(country => country.name.trim()));
  assert.deepEqual(officeCityCountries([]), []);
});

test("fresh category records retain optional interval and explicit failure evidence", () => {
  const rooms = buildOfficeCityRooms([miami], [run([{ ...miami, categories: [job("clubs", "attention", { intervalMs: 60_000, recordedFailure: true }), job("vip", "attention")] }])], now);
  assert.equal(rooms[0].agents[0].intervalMs, 60000);
  assert.equal(rooms[0].agents[0].recordedFailure, true);
  assert.equal(rooms[0].agents[1].recordedFailure, undefined);
});
