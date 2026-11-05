import assert from "node:assert/strict";
import test from "node:test";
import { buildOfficeCityRooms, officeCityCountries, officeCityEvidenceExpiresAt, officeCityPage, parseOfficeCityDirectory, selectLatestOfficeKongAudit, OFFICE_CITY_CATEGORIES } from "../client/src/lib/office-city-agents";

const now = Date.parse("2026-11-05T14:00:00Z");
const stamp = (delta: number) => new Date(now + delta).toISOString();
const miami = { id: "miami", name: "Miami", countryCode: "US", timeZone: "America/New_York", currency: "USD" };
const ba = { id: "buenos-aires", name: "Buenos Aires", countryCode: "AR", timeZone: "America/Argentina/Buenos_Aires", currency: "ARS" };
const job = (category: string, state = "healthy", options: Record<string, unknown> = {}) => ({ category, state, evidence: "persisted", lastRunAt: stamp(-90000), lastSuccessAt: stamp(-90000), lastStartedAt: stamp(-100000), nextRunAt: stamp(50000), leaseUntil: state === "running" ? stamp(360000) : null, issues: [], ...options });
const run = (cities: unknown[], options: Record<string, unknown> = {}) => ({ id: "audit-1", kind: "kong_audit", status: "completed", createdAt: stamp(-3000), completedAt: stamp(-1000), evidence: { generatedAt: stamp(-2000), citySnapshotCheckedAt: stamp(-1000), cityAgentsEnabled: true, cities, ...options } });

test("every registered city is reachable with seven distinct roles and only 35 figures on a page", () => {
  const cities = [miami, ...Array.from({ length: 23 }, (_, n) => ({ ...miami, id: `fixture-${n}`, name: `Fixture city ${n}` })), ba];
  const rooms = buildOfficeCityRooms(parseOfficeCityDirectory(cities), [], now);
  assert.equal(rooms.length, 25);
  assert.equal(new Set(rooms.flatMap(room => room.agents.map(agent => agent.id))).size, 175);
  for (let page = 0; page < 5; page++) {
    const visible = officeCityPage(rooms, page);
    assert.equal(visible.length, 5);
    assert.equal(visible.flatMap(room => room.agents).length, 35);
    for (const room of visible) assert.deepEqual(room.agents.map(agent => agent.category), OFFICE_CITY_CATEGORIES.map(category => category.id));
  }
  assert.equal(officeCityPage(rooms, 0)[0].name, "Miami");
  assert.equal(officeCityPage(rooms, 4).at(-1)?.name, "Buenos Aires");
});

test("fresh evidence animates only running jobs; completed jobs are distinct and missing jobs stay gray", () => {
  const rooms = buildOfficeCityRooms([miami], [run([{ ...miami, categories: [job("clubs", "running"), job("vip"), job("restaurants", "healthy", { evidence: "missing" }), job("events", "attention", { issues: ["Falta la fuente"] })] }])], now);
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
  assert.equal(jobs.filter(agent => agent.hasDurableEvidence).length, 3);
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
  assert.deepEqual(officeCityPage([], 4), []);
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
