import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import express, { type Request } from "express";
import { configureHeyGenRosterResponseSchema } from "../shared/ai-media-studio-heygen-roster";
import { InMemoryMediaJobRepository } from "../server/ai-media-studio/in-memory";
import { FakeVideoProvider } from "../server/ai-media-studio/providers/fake-video-provider";
import { InMemoryHeyGenRosterRepository } from "../server/ai-media-studio/providers/heygen-roster-in-memory";
import { createAiMediaStudioRuntime } from "../server/ai-media-studio/routes";

function body() {
  return {
    idempotencyKey: "launch-roster-routes-01",
    members: Array.from({ length: 5 }, (_, index) => ({
      name: `Creator ${index + 1}`,
      avatarId: `private-avatar-${index + 1}`,
      voiceId: `private-voice-${index + 1}`,
      language: "en-US",
      accent: "US",
      gender: "unspecified",
    })),
  };
}

async function harness(accountAvailable = true) {
  const previous = process.env.ALLOW_DEV_USER_FALLBACK;
  process.env.ALLOW_DEV_USER_FALLBACK = "false";
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
      async resolve() {
        return accountAvailable
          ? { providerAccountId: "11111111-1111-4111-8111-111111111111", credentialVersion: 1 }
          : undefined;
      },
    },
  });
  app.use(runtime.router);
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: async () => {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      if (previous === undefined) delete process.env.ALLOW_DEV_USER_FALLBACK;
      else process.env.ALLOW_DEV_USER_FALLBACK = previous;
    },
  };
}

const endpoint = "/api/ai-media-studio/provider-configurations/heygen/roster";

test("roster GET/POST require auth, return the exact public schema and redact native/account identifiers", async (t) => {
  const server = await harness();
  t.after(server.close);
  assert.equal((await fetch(`${server.url}${endpoint}`)).status, 401);
  assert.equal((await fetch(`${server.url}${endpoint}`, { headers: { "x-test-user": "owner-a" } })).status, 404);

  const createdResponse = await fetch(`${server.url}${endpoint}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-test-user": "owner-a" },
    body: JSON.stringify(body()),
  });
  assert.equal(createdResponse.status, 201);
  const createdRaw = await createdResponse.text();
  const created = configureHeyGenRosterResponseSchema.parse(JSON.parse(createdRaw));
  assert.equal(created.roster.avatarCount, 5);
  assert.equal(created.roster.plannedVideoCount, 50);
  assert.doesNotMatch(createdRaw, /private-avatar|private-voice|providerAccountId|credentialVersion|idempotencyKey/iu);

  const currentResponse = await fetch(`${server.url}${endpoint}`, { headers: { "x-test-user": "owner-a" } });
  assert.equal(currentResponse.status, 200);
  assert.deepEqual(configureHeyGenRosterResponseSchema.parse(await currentResponse.json()), created);
  assert.equal((await fetch(`${server.url}${endpoint}`, { headers: { "x-test-user": "owner-b" } })).status, 404);
});

test("roster setup rejects client account/secret fields and fails closed without a server-resolved active account", async (t) => {
  const server = await harness(false);
  t.after(server.close);
  const unavailable = await fetch(`${server.url}${endpoint}`, {
    method: "POST", headers: { "content-type": "application/json", "x-test-user": "owner-a" },
    body: JSON.stringify(body()),
  });
  assert.equal(unavailable.status, 503);
  const unavailableRaw = await unavailable.text();
  assert.doesNotMatch(unavailableRaw, /11111111|private-avatar|private-voice/iu);

  const unsafe = await fetch(`${server.url}${endpoint}`, {
    method: "POST", headers: { "content-type": "application/json", "x-test-user": "owner-a" },
    body: JSON.stringify({ ...body(), providerAccountId: "client-selected", apiKey: "must-not-enter-http" }),
  });
  assert.equal(unsafe.status, 400);
  const raw = await unsafe.text();
  assert.doesNotMatch(raw, /must-not-enter-http|client-selected/iu);

  const status = await fetch(`${server.url}${endpoint}`, { headers: { "x-test-user": "owner-a" } });
  assert.equal(status.status, 503);
});
