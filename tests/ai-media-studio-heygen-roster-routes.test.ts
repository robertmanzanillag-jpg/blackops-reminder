import assert from "node:assert/strict";
import { createServer, request } from "node:http";
import test from "node:test";
import express, { type Request } from "express";
import { InMemoryMediaJobRepository } from "../server/ai-media-studio/in-memory";
import { InMemoryHeyGenRosterRepository } from "../server/ai-media-studio/providers/heygen-roster-in-memory";
import { FakeVideoProvider } from "../server/ai-media-studio/providers/fake-video-provider";
import { createAiMediaStudioRuntime } from "../server/ai-media-studio/routes";
import {
  configureHeyGenRosterResponseSchema,
  heyGenRosterDailyPlanResponseSchema,
} from "../shared/ai-media-studio-heygen-roster";

function forceNoDevFallback(): () => void {
  const previous = process.env.ALLOW_DEV_USER_FALLBACK;
  process.env.ALLOW_DEV_USER_FALLBACK = "false";
  return () => {
    if (previous === undefined) delete process.env.ALLOW_DEV_USER_FALLBACK;
    else process.env.ALLOW_DEV_USER_FALLBACK = previous;
  };
}

async function startRosterRuntime(accountAvailable = true, credentialSource = "static_api_key") {
  const restoreDevFallback = forceNoDevFallback();
  const rosterRepository = new InMemoryHeyGenRosterRepository();
  let configureCalls = 0;
  let readinessCalls = 0;
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const userId = req.get("x-test-user");
    if (userId) (req as Request & { user?: { id: string } }).user = { id: userId };
    next();
  });
  const runtime = createAiMediaStudioRuntime({
    repository: new InMemoryMediaJobRepository(),
    providers: [new FakeVideoProvider()],
    defaultProviderKey: "fake",
    runtimeEnvironment: "test",
    aiMediaStudioCanonicalAppUrl: "https://app.example:8443",
    heyGenRosterRepository: {
      configure: async (input) => {
        configureCalls += 1;
        return rosterRepository.configure(input);
      },
      getCurrent: (scope) => rosterRepository.getCurrent(scope),
      get: (scope, rosterId) => rosterRepository.get(scope, rosterId),
      getCurrentDailyPlan: (scope) => rosterRepository.getCurrentDailyPlan(scope),
    },
    resolveHeyGenRosterAccount: {
      resolve: async (scope) => accountAvailable && scope.ownerUserId === "user-a"
        ? { providerAccountId: "private-heygen-account", credentialVersion: 1 }
        : undefined,
    },
    heyGenOnboardingReadinessRepository: {
      observe: async (scope) => {
        readinessCalls += 1;
        return {
          observedAt: "2030-01-01T00:00:00.000Z",
          accounts: accountAvailable && scope.ownerUserId === "user-a" ? [{
            id: "private-heygen-account", status: "disconnected", credentialStatus: "unverified",
            credentialVersion: 1, credentialSource,
          }] : [],
          plans: [],
        };
      },
    },
    operations: { runtimeEnvironment: "test" },
  });
  app.use(runtime.router);
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    counts: () => ({ configureCalls, readinessCalls }),
    close: async () => {
      try {
        await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      } finally {
        restoreDevFallback();
      }
    },
  };
}

function rosterRequest(count = 5) {
  return {
    members: Array.from({ length: count }, (_, index) => ({
      name: `Creator ${index + 1}`,
      avatarId: `native-avatar-${index + 1}`,
      voiceId: "native-shared-voice",
      language: "es-US",
      accent: "Latino",
      gender: "unspecified",
    })),
    idempotencyKey: `route-roster-${count}`,
  };
}

const mutationHeaders = {
  "content-type": "application/json",
  "x-test-user": "user-a",
  origin: "https://app.example:8443",
  "sec-fetch-site": "same-origin",
};

async function rawRequest(url: string, options: Readonly<{
  method: string; headers: Record<string, string>; body?: string;
}>): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const req = request(url, { method: options.method, headers: options.headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject); if (options.body) req.write(options.body); req.end();
  });
}

test("HeyGen roster routes configure avatars and expose a no-spend daily plan", async (t) => {
  const harness = await startRosterRuntime();
  t.after(harness.close);
  const headers = mutationHeaders;

  assert.equal((await fetch(`${harness.baseUrl}/api/ai-media-studio/provider-configurations/heygen/roster/daily-plan`)).status, 401);
  assert.equal((await fetch(`${harness.baseUrl}/api/ai-media-studio/provider-configurations/heygen/roster/daily-plan`, { headers })).status, 404);

  const configuredResponse = await fetch(`${harness.baseUrl}/api/ai-media-studio/provider-configurations/heygen/roster`, {
    method: "POST",
    headers,
    body: JSON.stringify(rosterRequest(6)),
  });
  assert.equal(configuredResponse.status, 201);
  const configured = configureHeyGenRosterResponseSchema.parse(await configuredResponse.json());
  assert.equal(configured.roster.avatarCount, 6);
  assert.equal(configured.roster.plannedVideoCount, 60);
  assert.doesNotMatch(JSON.stringify(configured), /native-avatar|native-shared-voice|private-heygen-account/iu);

  const currentResponse = await fetch(`${harness.baseUrl}/api/ai-media-studio/provider-configurations/heygen/roster`, { headers });
  assert.equal(currentResponse.status, 200);
  assert.deepEqual(configureHeyGenRosterResponseSchema.parse(await currentResponse.json()), configured);

  const planResponse = await fetch(`${harness.baseUrl}/api/ai-media-studio/provider-configurations/heygen/roster/daily-plan`, { headers });
  assert.equal(planResponse.status, 200);
  const plan = heyGenRosterDailyPlanResponseSchema.parse(await planResponse.json()).plan;
  assert.equal(plan.avatarCount, 6);
  assert.equal(plan.plannedVideoCount, 60);
  assert.equal(plan.canGenerate, false);
  assert.equal(plan.noSpendGuarantee, true);
  assert.equal(plan.slots.length, 60);
  assert.deepEqual([...new Set(plan.slots.map((slot) => slot.status))], ["not_queued"]);
  assert.doesNotMatch(JSON.stringify(plan), /native-avatar|native-shared-voice|private-heygen-account|avatarId|voiceId|providerAccountId/iu);

  const spoofedCalendarResponse = await fetch(`${harness.baseUrl}/api/ai-media-studio/provider-configurations/heygen/roster/daily-plan?planDate=2030-01-01&timeZone=Pacific%2FHonolulu`, { headers });
  assert.equal(spoofedCalendarResponse.status, 200);
  const spoofedCalendarPlan = heyGenRosterDailyPlanResponseSchema.parse(await spoofedCalendarResponse.json()).plan;
  assert.equal(spoofedCalendarPlan.planId, plan.planId);
  assert.equal(spoofedCalendarPlan.planDate, plan.planDate);
  assert.equal(spoofedCalendarPlan.timeZone, plan.timeZone);

  const crossTenant = await fetch(`${harness.baseUrl}/api/ai-media-studio/provider-configurations/heygen/roster/daily-plan`, {
    headers: { "x-test-user": "user-b" },
  });
  assert.equal(crossTenant.status, 503);
  const crossTenantBody = await crossTenant.text();
  assert.match(crossTenantBody, /ACCOUNT_UNAVAILABLE/);
  assert.doesNotMatch(crossTenantBody, /Creator 1|native-avatar|native-shared-voice|private-heygen-account/iu);
});

test("roster setup rejects client account and secret fields and fails closed without a server-resolved account", async (t) => {
  const harness = await startRosterRuntime(false);
  t.after(harness.close);
  const endpoint = `${harness.baseUrl}/api/ai-media-studio/provider-configurations/heygen/roster`;
  const headers = mutationHeaders;

  const unavailable = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify(rosterRequest()) });
  assert.equal(unavailable.status, 503);
  assert.doesNotMatch(await unavailable.text(), /private-heygen-account|native-avatar|native-shared-voice/iu);

  const unsafe = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({ ...rosterRequest(), providerAccountId: "client-selected", apiKey: "must-not-enter-http" }),
  });
  assert.equal(unsafe.status, 400);
  assert.doesNotMatch(await unsafe.text(), /must-not-enter-http|client-selected/iu);
  assert.equal((await fetch(endpoint, { headers })).status, 503);
});

test("direct roster POST cannot bypass static credential onboarding with a legacy active account", async (t) => {
  const harness = await startRosterRuntime(true, "legacy_authorized_unbound");
  t.after(harness.close);
  const response = await fetch(`${harness.baseUrl}/api/ai-media-studio/provider-configurations/heygen/roster`, {
    method: "POST",
    headers: mutationHeaders,
    body: JSON.stringify(rosterRequest()),
  });
  assert.equal(response.status, 503);
  const body = await response.text();
  assert.doesNotMatch(body, /legacy_authorized_unbound|private-heygen-account|native-avatar|native-shared-voice/iu);
});

test("roster POST is auth-first and requires exact server-owned same-origin JSON transport", async (t) => {
  const harness = await startRosterRuntime(); t.after(harness.close);
  process.env.ALLOW_DEV_USER_FALLBACK = "true";
  const endpoint = `${harness.baseUrl}/api/ai-media-studio/provider-configurations/heygen/roster`;
  const body = JSON.stringify(rosterRequest());

  assert.equal((await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json",
    "x-user-id": "user-a", origin: mutationHeaders.origin, "sec-fetch-site": "same-origin" }, body })).status, 401);
  for (const headers of [
    { "content-type": "application/json", "x-test-user": "user-a", "sec-fetch-site": "same-origin" },
    { ...mutationHeaders, "sec-fetch-site": "same-site" },
    { ...mutationHeaders, "sec-fetch-site": "none" },
    { ...mutationHeaders, origin: "https://attacker.example", "sec-fetch-site": "cross-site" },
    { ...mutationHeaders, origin: "https://attacker.example", host: "app.example:8443",
      "x-forwarded-host": "app.example:8443" },
  ]) {
    assert.equal((await fetch(endpoint, { method: "POST", headers, body })).status, 403);
  }
  assert.equal((await fetch(endpoint, { method: "POST", headers: { ...mutationHeaders,
    "content-type": "application/x-www-form-urlencoded" }, body: "members=unsafe" })).status, 415);
  assert.equal((await fetch(`${endpoint}?providerAccountId=client`, { method: "POST", headers: mutationHeaders,
    body })).status, 400);
  assert.equal((await rawRequest(endpoint, { method: "POST", headers: { ...mutationHeaders,
    "transfer-encoding": "chunked" }, body })).status, 400);
  for (const count of [4, 11]) {
    assert.equal((await fetch(endpoint, { method: "POST", headers: mutationHeaders,
      body: JSON.stringify(rosterRequest(count)) })).status, 400);
  }
  assert.deepEqual(harness.counts(), { configureCalls: 0, readinessCalls: 0 },
    "denied requests must not reach readiness or persistence");

  const status = await fetch(endpoint, { headers: { "x-test-user": "user-a" } });
  assert.equal(status.status, 404, "denied mutations must not create a roster");
  assert.doesNotMatch(await status.text(), /native-avatar|native-shared-voice|private-heygen-account/iu);
});

test("roster strict origin configuration rejects production HTTP and permits only explicit dev loopback", async () => {
  const production = createAiMediaStudioRuntime({
    repository: new InMemoryMediaJobRepository(), runtimeEnvironment: "production",
    aiMediaStudioCanonicalAppUrl: "http://127.0.0.1:4567",
    heyGenRosterRepository: new InMemoryHeyGenRosterRepository(),
    resolveHeyGenRosterAccount: { async resolve() { return undefined; } },
    heyGenOnboardingReadinessRepository: { async observe() { return { observedAt: new Date().toISOString(),
      accounts: [], plans: [] }; } }, operations: { runtimeEnvironment: "test" },
  });
  assert.equal(production.oneVideoHeldAdmissionPersistence.available, false);

  const local = createAiMediaStudioRuntime({
    repository: new InMemoryMediaJobRepository(), providers: [new FakeVideoProvider()],
    defaultProviderKey: "fake", runtimeEnvironment: "test",
    aiMediaStudioCanonicalAppUrl: "http://127.0.0.1:4567/",
    heyGenRosterRepository: new InMemoryHeyGenRosterRepository(),
    resolveHeyGenRosterAccount: { async resolve() { return undefined; } },
    heyGenOnboardingReadinessRepository: { async observe() { return { observedAt: new Date().toISOString(),
      accounts: [], plans: [] }; } }, operations: { runtimeEnvironment: "test" },
  });
  assert.equal(local.oneVideoHeldAdmissionPersistence.reason.includes("canonical application origin"), false);
});
