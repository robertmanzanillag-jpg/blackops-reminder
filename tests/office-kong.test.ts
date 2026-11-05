import assert from "node:assert/strict";
import test from "node:test";
import { createOfficeKongConnector, OfficeKongError, OFFICE_KONG_CITY_CATEGORIES } from "../server/office-kong";

const NOW = new Date("2026-11-05T03:00:00.000Z");
const TOKEN = "test-only-office-admin-token";
function operations() {
  return {
    generatedAt: NOW.toISOString(),
    agents: [{ id: "city:miami", name: "Miami", kind: "city", owner: "city_operations", responsibility: "Revisar cobertura", state: "unknown", lastRunAt: null, nextRunAt: null, blocker: "No existe un heartbeat durable consultable", nextAction: "Instrumentar el historial", issues: [] }],
    objectives: [{ id: "coverage", objective: "Cobertura", kpi: "eventos", baseline: null, target: "100", unit: "%", owner: "venue_deals", dueAt: null }],
    briefs: { daily: null, weekly: null },
    metrics: { completedLast7Days: null, completedPrevious7Days: null, open: null, blocked: null },
    issues: [],
    bugs: [{ errorId: "bug-1", severity: "high", occurrences: 2, affectedUsers: 1, status: "pending", owner: "product_reliability", summary: "HTTP 500", lastSeenAt: NOW.toISOString() }],
  };
}
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
const CITIES_URL = "https://kongnightlife.com/api/admin/city-agents";
function citiesFixture(ids = ["miami"]) {
  return {
    enabled: true, coordinator: "global", maxConcurrent: 2, referenceCity: "miami",
    countries: [...new Set(ids.map(id => id === "buenos-aires" ? "AR" : "US"))], needsAttention: [...ids],
    cities: ids.map(id => ({
      id, name: id === "buenos-aires" ? "Buenos Aires" : id, countryCode: id === "buenos-aires" ? "AR" : "US",
      timeZone: id === "buenos-aires" ? "America/Argentina/Buenos_Aires" : "America/New_York", currency: id === "buenos-aires" ? "ARS" : "USD", status: "needs_attention",
      jobs: OFFICE_KONG_CITY_CATEGORIES.map(category => ({ city_id: id, category, interval_ms: "86400000", next_run_at: NOW.toISOString(), lease_until: null,
        last_started_at: null, last_completed_at: null, last_success_at: null, attempts: 0, last_error: null, report: {} })),
    })),
  };
}
function connector(fetchImpl: typeof fetch, token = TOKEN) {
  return createOfficeKongConnector({ token: () => token, now: () => NOW,
    fetchImpl: async (url, init) => url === CITIES_URL ? json(citiesFixture()) : fetchImpl(url, init) });
}

test("missing configuration blocks without making a request", async () => {
  const c = connector(async () => { throw new Error("must not request"); }, "");
  assert.equal((await c.probeOfficeKong()).status, "blocked");
  await assert.rejects(c.runOfficeKongReadOnly(), (error: unknown) => error instanceof OfficeKongError && error.code === "NOT_CONFIGURED");
});

test("authenticated audit uses only fixed GET contract and preserves unknown evidence", async () => {
  const c = connector(async (url, init) => {
    assert.equal(url, "https://kongnightlife.com/api/admin/ceo/operations");
    assert.equal(init?.method, "GET");
    assert.equal(init?.redirect, "error");
    assert.equal((init?.headers as Record<string, string>).Authorization, `Bearer ${TOKEN}`);
    assert.ok(init?.signal);
    return json(operations());
  });
  const probe = await c.probeOfficeKong();
  assert.equal(probe.status, "ready");
  assert.equal(probe.agents?.[0].state, "unknown");
  const audit = await c.runOfficeKongReadOnly();
  assert.equal(audit.evidence.generatedAt, NOW.toISOString());
  assert.equal(audit.evidence.agents[0].lastRunAt, null);
  assert.match(audit.text, /1 sin evidencia verificable/);
  assert.match(audit.text, /no inicia agentes, no lee WhatsApp/);
});

for (const status of [401, 403, 302, 500]) {
  test(`HTTP ${status} blocks without exposing response or token`, async () => {
    const result = await connector(async () => new Response(TOKEN, { status })).probeOfficeKong();
    assert.equal(result.status, "blocked");
    assert.equal(result.agents, undefined);
    assert.ok(!JSON.stringify(result).includes(TOKEN));
  });
}

test("HTML login pages and invalid JSON are rejected", async () => {
  for (const response of [new Response("<html>Login</html>", { headers: { "content-type": "text/html" } }), new Response("invalid-json", { headers: { "content-type": "application/json" } })]) {
    const result = await connector(async () => response).probeOfficeKong();
    assert.equal(result.status, "blocked");
  }
});

test("malformed core DTO and unexpected agent fields never become connected", async () => {
  const missing = operations();
  delete (missing as Partial<typeof missing>).metrics;
  const invalidState = operations();
  invalidState.agents[0].state = "connected";
  const unexpectedAgentField = operations();
  (unexpectedAgentField.agents[0] as Record<string, unknown>).privateToken = TOKEN;
  for (const payload of [missing, invalidState, unexpectedAgentField, { ...operations(), agents: [] }]) {
    assert.equal((await connector(async () => json(payload)).probeOfficeKong()).status, "blocked");
  }
});

test("new operations root metadata is discarded rather than exposed or treated as evidence", async () => {
  const payload = { ...operations(), privateMetadata: { secret: TOKEN, privateNote: "never-expose-this-metadata" },
    cityAgentBreakdown: { unrecognized: "not-the-trusted-city-contract" } };
  const c = connector(async () => json(payload));
  const probe = await c.probeOfficeKong();
  assert.equal(probe.status, "ready");
  const audit = await c.runOfficeKongReadOnly();
  for (const output of [probe, audit]) {
    const serialized = JSON.stringify(output);
    assert.ok(!serialized.includes("privateMetadata"));
    assert.ok(!serialized.includes("never-expose-this-metadata"));
    assert.ok(!serialized.includes("cityAgentBreakdown"));
    assert.ok(!serialized.includes(TOKEN));
  }
  assert.equal(audit.evidence.cities[0].id, "miami");
});

test("old and implausibly future snapshots are rejected", async () => {
  for (const offset of [-300_001, 30_001]) {
    const payload = { ...operations(), generatedAt: new Date(NOW.getTime() + offset).toISOString() };
    await assert.rejects(connector(async () => json(payload)).runOfficeKongReadOnly(), (error: unknown) => error instanceof OfficeKongError && error.code === "STALE_SNAPSHOT");
  }
});

test("declared and streamed bodies over one MiB are rejected", async () => {
  let cancelled = false;
  const huge = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new Uint8Array(1024 * 1024 + 1)); },
    cancel() { cancelled = true; },
  });
  for (const response of [new Response("{}", { headers: { "content-type": "application/json", "content-length": String(1024 * 1024 + 1) } }), new Response(huge, { headers: { "content-type": "application/json" } })]) {
    await assert.rejects(connector(async () => response).runOfficeKongReadOnly(), (error: unknown) => error instanceof OfficeKongError && error.code === "RESPONSE_TOO_LARGE");
  }
  assert.equal(cancelled, true);
});

test("network errors never expose token and echoed credentials are redacted in evidence", async () => {
  const blocked = await connector(async () => { throw new Error(`Authorization: Bearer ${TOKEN}`); }).probeOfficeKong();
  assert.ok(!JSON.stringify(blocked).includes(TOKEN));
  const payload = operations();
  payload.agents[0].blocker = `Bearer ${TOKEN}`;
  const output = await connector(async () => json(payload)).runOfficeKongReadOnly();
  assert.ok(!JSON.stringify(output).includes(TOKEN));
  assert.match(output.evidence.agents[0].blocker ?? "", /redacted/);
});

test("probe stays operations-only while a full audit reads every city and all seven category rows", async () => {
  const ids = ["miami", ...Array.from({ length: 23 }, (_, index) => `additional-city-${index}`), "buenos-aires"];
  const cityData = citiesFixture(ids);
  const operationData = operations();
  operationData.agents = ids.map(id => ({ ...operationData.agents[0], id: `city:${id}`, name: id }));
  const calls: string[] = [];
  const c = createOfficeKongConnector({ token: () => TOKEN, now: () => NOW, fetchImpl: async (url, init) => {
    calls.push(String(url));
    assert.equal(init?.method, "GET");
    assert.equal(init?.redirect, "error");
    assert.equal((init?.headers as Record<string, string>).Authorization, `Bearer ${TOKEN}`);
    return json(url === CITIES_URL ? cityData : operationData);
  } });
  assert.equal((await c.probeOfficeKong()).status, "ready");
  assert.deepEqual(calls, ["https://kongnightlife.com/api/admin/ceo/operations"]);
  const audit = await c.runOfficeKongReadOnly();
  assert.equal(audit.evidence.cities.length, ids.length);
  assert.equal(audit.evidence.cities.reduce((sum, city) => sum + city.categories.length, 0), ids.length * OFFICE_KONG_CITY_CATEGORIES.length);
  assert.equal(audit.evidence.cities.find(city => city.id === "buenos-aires")?.currency, "ARS");
  assert.equal(audit.evidence.cityCoverageComplete, true);
  assert.ok(audit.evidence.cities.every(city => city.categories.every(category => category.state === "unknown" && category.evidence === "persisted")));
  assert.equal(calls.filter(url => url === CITIES_URL).length, 1);
});

test("missing category evidence stays unknown and never becomes a fabricated healthy job", async () => {
  const cityData = citiesFixture();
  cityData.cities[0].jobs = cityData.cities[0].jobs.filter(job => job.category !== "vip");
  const c = createOfficeKongConnector({ token: () => TOKEN, now: () => NOW, fetchImpl: async url => json(url === CITIES_URL ? cityData : operations()) });
  const audit = await c.runOfficeKongReadOnly();
  const vip = audit.evidence.cities[0].categories.find(category => category.category === "vip")!;
  assert.equal(vip.state, "unknown");
  assert.equal(vip.evidence, "missing");
  assert.equal(vip.lastRunAt, null);
  assert.equal(audit.evidence.cityCoverageComplete, false);
  assert.match(audit.text, /Faltan trabajos/);
});

test("city endpoint failure and registry mismatch reject the full audit", async () => {
  for (const cityResponse of [() => new Response("forbidden", { status: 403 }), () => json({ ...citiesFixture(), cities: [] }), () => json(citiesFixture(["miami", "buenos-aires"]))]) {
    const c = createOfficeKongConnector({ token: () => TOKEN, now: () => NOW, fetchImpl: async url => url === CITIES_URL ? cityResponse() : json(operations()) });
    await assert.rejects(c.runOfficeKongReadOnly(), error => error instanceof OfficeKongError);
  }
});

test("city jobs with duplicate categories or foreign ownership are rejected", async () => {
  for (const mutate of [(data: ReturnType<typeof citiesFixture>) => { data.cities[0].jobs[1] = data.cities[0].jobs[0]; },
    (data: ReturnType<typeof citiesFixture>) => { data.cities[0].jobs[0].city_id = "another-city"; }]) {
    const cityData = citiesFixture(); mutate(cityData);
    const c = createOfficeKongConnector({ token: () => TOKEN, now: () => NOW, fetchImpl: async url => json(url === CITIES_URL ? cityData : operations()) });
    await assert.rejects(c.runOfficeKongReadOnly(), error => error instanceof OfficeKongError && error.code === "INVALID_RESPONSE");
  }
});

test("category state derives from durable timestamps, leases and actual failures", async () => {
  const base = citiesFixture();
  const cityData = { ...base, cities: base.cities.map(city => ({ ...city, status: "healthy", jobs: city.jobs.map(job => ({ ...job,
    last_started_at: NOW.toISOString(), last_completed_at: NOW.toISOString(), last_success_at: NOW.toISOString(), report: { status: "healthy" },
    ...(job.category === "vip" ? { lease_until: new Date(NOW.getTime() + 60_000).toISOString() } : {}),
    ...(job.category === "restaurants" ? { last_error: TOKEN } : {}),
    ...(job.category === "events" ? { last_success_at: new Date(NOW.getTime() - 2 * Number(job.interval_ms) - 1).toISOString() } : {}),
    ...(job.category === "sports" ? { last_success_at: null, last_completed_at: null, report: {} } : {}),
    ...(job.category === "experiences" ? { report: { status: "needs_attention", issues: ["Paid discovery disabled: $0 provider budget"] } } : {}),
    ...(job.category === "media" ? { last_started_at: new Date(NOW.getTime() + 60_000).toISOString() } : {}),
  })) })) };
  const c = createOfficeKongConnector({ token: () => TOKEN, now: () => NOW, fetchImpl: async url => json(url === CITIES_URL ? cityData : operations()) });
  const audit = await c.runOfficeKongReadOnly();
  const states = Object.fromEntries(audit.evidence.cities[0].categories.map(category => [category.category, category.state]));
  assert.deepEqual(states, { clubs: "healthy", vip: "running", restaurants: "attention", events: "stale", sports: "unknown", experiences: "attention", media: "unknown" });
  assert.equal(audit.evidence.cities[0].status, "needs_attention");
  assert.ok(!JSON.stringify(audit).includes(TOKEN));
  cityData.enabled = false;
  const disabled = await c.runOfficeKongReadOnly();
  assert.ok(disabled.evidence.cities[0].categories.every(category => category.state === "disabled"));
});
