import assert from "node:assert/strict";
import { createServer } from "node:http";
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

async function startRosterRuntime(accountAvailable = true) {
  const restoreDevFallback = forceNoDevFallback();
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
    heyGenRosterRepository: new InMemoryHeyGenRosterRepository(),
    resolveHeyGenRosterAccount: {
      resolve: async (scope) => accountAvailable && scope.ownerUserId === "user-a"
        ? { providerAccountId: "private-heygen-account", credentialVersion: 1 }
        : undefined,
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

test("HeyGen roster routes configure avatars and expose a no-spend daily plan", async (t) => {
  const harness = await startRosterRuntime();
  t.after(harness.close);
  const headers = { "content-type": "application/json", "x-test-user": "user-a" };

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
  const headers = { "content-type": "application/json", "x-test-user": "user-a" };

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
