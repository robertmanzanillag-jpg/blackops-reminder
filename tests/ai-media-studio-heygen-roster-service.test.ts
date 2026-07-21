import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryHeyGenRosterRepository } from "../server/ai-media-studio/providers/heygen-roster-in-memory";
import { HeyGenRosterError } from "../server/ai-media-studio/providers/heygen-roster-contracts";
import { HeyGenRosterService } from "../server/ai-media-studio/providers/heygen-roster-service";

const scope = { ownerUserId: "owner-a", workspaceId: "workspace-a" } as const;
const accountResolver = { resolve: async () => ({ providerAccountId: "native-account-private", credentialVersion: 4 }) };

function request(idempotencyKey = "launch-roster-001") {
  return {
    members: Array.from({ length: 5 }, (_, index) => ({
      name: `Avatar ${index}`,
      avatarId: `native-avatar-${index}`,
      voiceId: index % 2 === 0 ? "native-voice-shared" : `native-voice-${index}`,
      language: "es-US",
      accent: "Latino",
      gender: "female",
    })),
    idempotencyKey,
  };
}

test("configure uses server-resolved account context and returns only a public-safe 50-video roster", async () => {
  const repository = new InMemoryHeyGenRosterRepository();
  const service = new HeyGenRosterService(repository, accountResolver, () => "2030-01-01T00:00:00.000Z");
  const response = await service.configure(scope, request());

  assert.equal(response.roster.avatarCount, 5);
  assert.equal(response.roster.videosPerAvatar, 10);
  assert.equal(response.roster.plannedVideoCount, 50);
  const serialized = JSON.stringify(response);
  assert.doesNotMatch(serialized, /native-avatar|native-voice|native-account|avatarId|voiceId|providerAccountId/iu);

  const stored = await repository.get(scope, response.roster.rosterId);
  assert.equal(stored?.providerAccountId, "native-account-private");
  assert.equal(stored?.members[0]?.avatarId, "native-avatar-0");
  assert.deepEqual(await service.status(scope, response.roster.rosterId), response.roster);
  assert.deepEqual(await service.currentStatus(scope), response.roster);
});

test("current status is tenant-scoped, absent before configuration, and sanitizes repository failures", async () => {
  const repository = new InMemoryHeyGenRosterRepository();
  const service = new HeyGenRosterService(repository, accountResolver, () => "2030-01-01T00:00:00.000Z");
  assert.equal(await service.currentStatus(scope), undefined);

  const configured = await service.configure(scope, request());
  assert.deepEqual(await service.currentStatus(scope), configured.roster);
  assert.equal(await service.currentStatus({ ownerUserId: "owner-b", workspaceId: "workspace-a" }), undefined);

  const failingService = new HeyGenRosterService({
    configure: async (input) => input,
    get: async () => undefined,
    getCurrent: async () => { throw new Error("native-avatar-private"); },
  }, accountResolver);
  await assert.rejects(() => failingService.currentStatus(scope), (error: unknown) =>
    error instanceof HeyGenRosterError && error.code === "ROSTER_UNAVAILABLE"
      && !error.message.includes("native-avatar-private"));
});

test("exact idempotent replay preserves original status and changed payload conflicts", async () => {
  let clock = "2030-01-01T00:00:00.000Z";
  const service = new HeyGenRosterService(new InMemoryHeyGenRosterRepository(), accountResolver, () => clock);
  const first = await service.configure(scope, request());
  clock = "2030-01-02T00:00:00.000Z";
  const replay = await service.configure(scope, request());
  assert.deepEqual(replay, first);

  const changed = request();
  changed.members[0]!.name = "Changed";
  await assert.rejects(() => service.configure(scope, changed), (error: unknown) =>
    error instanceof HeyGenRosterError && error.code === "IDEMPOTENCY_CONFLICT"
      && !error.message.includes("native-avatar"));
});

test("service rejects prototype and secret-bearing inputs with generic errors", async () => {
  const service = new HeyGenRosterService(new InMemoryHeyGenRosterRepository(), accountResolver);
  const prototypeInput = Object.create({ apiKey: "secret-value" }) as Record<string, unknown>;
  Object.assign(prototypeInput, request());

  for (const unsafe of [
    prototypeInput,
    { ...request(), apiKey: "secret-value" },
    { ...request(), members: [{ ...request().members[0], accessToken: "secret-value" }, ...request().members.slice(1)] },
  ]) {
    await assert.rejects(() => service.configure(scope, unsafe), (error: unknown) =>
      error instanceof HeyGenRosterError && error.code === "INVALID_REQUEST"
        && error.message === "Unable to configure avatar roster"
        && !error.message.includes("secret-value"));
  }
});

test("client account fields are rejected and unresolved accounts fail closed", async () => {
  const service = new HeyGenRosterService(
    new InMemoryHeyGenRosterRepository(),
    { resolve: async () => undefined },
  );
  await assert.rejects(() => service.configure(scope, { ...request(), providerAccountId: "attacker-account" }), (error: unknown) =>
    error instanceof HeyGenRosterError && error.code === "INVALID_REQUEST");
  await assert.rejects(() => service.configure(scope, request()), (error: unknown) =>
    error instanceof HeyGenRosterError && error.code === "ACCOUNT_UNAVAILABLE");

  const throwingService = new HeyGenRosterService(
    new InMemoryHeyGenRosterRepository(),
    { resolve: async () => { throw new Error("native-account-private"); } },
  );
  await assert.rejects(() => throwingService.configure(scope, request()), (error: unknown) =>
    error instanceof HeyGenRosterError && error.code === "ACCOUNT_UNAVAILABLE"
      && !error.message.includes("native-account-private"));
  await assert.rejects(() => throwingService.currentStatus(scope), (error: unknown) =>
    error instanceof HeyGenRosterError && error.code === "ACCOUNT_UNAVAILABLE"
      && !error.message.includes("native-account-private"));
});
