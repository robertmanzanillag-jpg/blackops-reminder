import assert from "node:assert/strict";
import test from "node:test";
import type { StaticHeyGenApiKey } from "../server/ai-media-studio/provider-credentials/static-heygen-secret-resolver";
import { createStaticHeyGenSecretResolver } from "../server/ai-media-studio/provider-credentials/static-heygen-secret-resolver";
import type {
  HeyGenV3StaticVerificationCommand,
  HeyGenV3StaticVerificationOutcome,
} from "../server/ai-media-studio/providers/heygen-v3-static-verification-contracts";
import { HeyGenV3StaticVerificationHttpProvider } from "../server/ai-media-studio/providers/heygen-v3-static-verification-provider";

const SECRET = "heygen-static-secret-that-must-not-leak";
const NOW = new Date("2026-07-22T12:00:00.000Z");

type RecordedCall = Readonly<{
  url: string;
  init?: RequestInit;
}>;

type FakeHandler = (url: string, init?: RequestInit) => Response | Promise<Response>;

async function apiKey(): Promise<StaticHeyGenApiKey> {
  const resolver = createStaticHeyGenSecretResolver({
    env: { AI_MEDIA_STUDIO_SECRET_HEYGEN_API_KEY: SECRET },
  });
  const key = await resolver.resolve("env://AI_MEDIA_STUDIO_SECRET_HEYGEN_API_KEY");
  assert.ok(key);
  return key;
}

async function provider(handler: FakeHandler, calls: RecordedCall[] = []) {
  return new HeyGenV3StaticVerificationHttpProvider({
    apiKey: await apiKey(),
    providerAccountId: "account-1",
    providerCredentialVersion: 3,
    timeoutMs: 1_000,
    overallTimeoutMs: 10_000,
    now: () => NOW,
    async fetchImpl(input, init) {
      calls.push({ url: String(input), init });
      return handler(String(input), init);
    },
  });
}

function command(overrides: Partial<HeyGenV3StaticVerificationCommand> = {}): HeyGenV3StaticVerificationCommand {
  return {
    scope: { ownerUserId: "owner-1", workspaceId: "workspace-1" },
    providerAccountId: "account-1",
    providerKey: "heygen",
    providerCredentialVersion: 3,
    idempotencyKey: "verify-static-heygen-1",
    selections: [
      { avatarLookId: "look-3", voiceId: "voice-c", expectedVoiceLanguage: "English", requiredEngine: "avatar_v" },
      { avatarLookId: "look-1", voiceId: "voice-a", expectedVoiceLanguage: "English" },
      { avatarLookId: "look-5", voiceId: "voice-a", expectedVoiceLanguage: "English" },
      { avatarLookId: "look-2", voiceId: "voice-b", expectedVoiceLanguage: "Spanish", requiredEngine: "avatar_iv" },
      { avatarLookId: "look-4", voiceId: "voice-c", expectedVoiceLanguage: "English", requiredEngine: "avatar_v" },
    ],
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function okPayload(url: string): Response {
  const path = new URL(url).pathname;
  if (path === "/v3/users/me") {
    return jsonResponse({
      data: {
        username: `${SECRET}-username`,
        billing_type: "wallet",
        wallet: { remaining_balance: 100, auto_reload: { enabled: false } },
      },
    });
  }
  const look = path.match(/^\/v3\/avatars\/looks\/(.+)$/u)?.[1];
  if (look) {
    const groupId = look === "look-1" || look === "look-2" ? "group-a" : "group-b";
    return jsonResponse({
      data: {
        id: look,
        name: `${SECRET}-look`,
        group_id: groupId,
        preview_image_url: `https://files.heygen.ai/${SECRET}/preview.jpg`,
        preview_video_url: `https://files.heygen.ai/${SECRET}/preview.mp4`,
        supported_api_engines: look === "look-3" || look === "look-4" ? ["avatar_iv", "avatar_v"] : ["avatar_iv"],
        status: "completed",
      },
    });
  }
  const group = path.match(/^\/v3\/avatars\/(.+)$/u)?.[1];
  if (group) {
    return jsonResponse({
      data: {
        id: group,
        name: `${SECRET}-group`,
        status: "completed",
        consent_status: "approved",
        preview_image_url: `https://files.heygen.ai/${SECRET}/group.jpg`,
      },
    });
  }
  const voice = path.match(/^\/v3\/voices\/(.+)$/u)?.[1];
  if (voice) {
    return jsonResponse({
      data: {
        voice_id: voice,
        name: `${SECRET}-voice`,
        language: voice === "voice-b" ? "Spanish" : "English",
        gender: voice === "voice-b" ? "male" : "female",
        support_pause: true,
        support_locale: voice !== "voice-b",
        support_interactive_avatar: false,
        preview_audio_url: `https://files.heygen.ai/${SECRET}/voice.mp3`,
      },
    });
  }
  return jsonResponse({ error: { message: `${SECRET}-not-found` } }, 404);
}

test("constructor is inert and verify performs only exact GET endpoints with a server-only API key", async () => {
  const calls: RecordedCall[] = [];
  const adapter = await provider(okPayload, calls);
  assert.equal(calls.length, 0);

  const outcome = await adapter.verify(command());

  assert.equal(outcome.kind, "passed");
  assert.deepEqual(calls.map((call) => call.url), [
    "https://api.heygen.com/v3/users/me",
    "https://api.heygen.com/v3/avatars/looks/look-1",
    "https://api.heygen.com/v3/avatars/looks/look-2",
    "https://api.heygen.com/v3/avatars/looks/look-3",
    "https://api.heygen.com/v3/avatars/looks/look-4",
    "https://api.heygen.com/v3/avatars/looks/look-5",
    "https://api.heygen.com/v3/avatars/group-a",
    "https://api.heygen.com/v3/avatars/group-b",
    "https://api.heygen.com/v3/voices/voice-a",
    "https://api.heygen.com/v3/voices/voice-b",
    "https://api.heygen.com/v3/voices/voice-c",
  ]);
  for (const call of calls) {
    assert.equal(call.init?.method, "GET");
    assert.equal((call.init?.headers as Record<string, string>)["x-api-key"], SECRET);
    assert.ok(call.init?.signal instanceof AbortSignal);
    assert.ok(!call.url.includes("/v3/videos"));
  }
});

test("passed outcome is server evidence keyed by resource ids without URLs or raw provider payloads", async () => {
  const adapter = await provider(okPayload);
  const outcome = await adapter.verify(command());
  assert.equal(outcome.kind, "passed");
  if (outcome.kind !== "passed") return;
  assert.equal(outcome.billingModel, "wallet");
  assert.equal(outcome.avatarLookCount, 5);
  assert.equal(outcome.voiceCount, 3);
  assert.deepEqual(outcome.avatars.map((avatar) => avatar.avatarLookId), ["look-1", "look-2", "look-3", "look-4", "look-5"]);
  assert.deepEqual(outcome.voices.map((voice) => voice.voiceId), ["voice-a", "voice-b", "voice-c"]);
  assert.equal(outcome.avatars[0]?.lookStatus, "completed");
  assert.equal(outcome.avatars[0]?.groupStatus, "completed");
  assert.equal(outcome.avatars[0]?.groupConsentStatus, "approved");
  assert.deepEqual(outcome.avatars[2]?.supportedEngines, ["avatar_iv", "avatar_v"]);
  assert.deepEqual(outcome.voices.map((voice) => ({
    id: voice.voiceId,
    language: voice.language,
    gender: voice.gender,
    supportPause: voice.supportPause,
    supportLocale: voice.supportLocale,
    supportInteractiveAvatar: voice.supportInteractiveAvatar,
  })), [
    { id: "voice-a", language: "English", gender: "female", supportPause: true, supportLocale: true, supportInteractiveAvatar: false },
    { id: "voice-b", language: "Spanish", gender: "male", supportPause: true, supportLocale: false, supportInteractiveAvatar: false },
    { id: "voice-c", language: "English", gender: "female", supportPause: true, supportLocale: true, supportInteractiveAvatar: false },
  ]);
  const serialized = JSON.stringify(outcome);
  assert.ok(!serialized.includes(SECRET));
  assert.ok(!serialized.includes("preview"));
  assert.ok(!serialized.includes("files.heygen.ai"));
  assert.match(outcome.evidenceDigest, /^sha256:[0-9a-f]{64}$/u);
  for (const avatar of outcome.avatars) {
    assert.match(avatar.lookIdDigest, /^sha256:[0-9a-f]{64}$/u);
    assert.match(avatar.groupIdDigest, /^sha256:[0-9a-f]{64}$/u);
    assert.match(avatar.evidenceDigest, /^sha256:[0-9a-f]{64}$/u);
  }
  for (const voice of outcome.voices) {
    assert.match(voice.voiceIdDigest, /^sha256:[0-9a-f]{64}$/u);
    assert.match(voice.evidenceDigest, /^sha256:[0-9a-f]{64}$/u);
  }
});

test("invalid request constraints fail before provider I/O", async (t) => {
  for (const [name, override] of [
    ["too few looks", { selections: command().selections.slice(0, 4) }],
    ["too many looks", {
      selections: [
        ...command().selections,
        ...Array.from({ length: 6 }, (_, index) => ({
          ...command().selections[index % command().selections.length],
          avatarLookId: `extra-${index}`,
        })),
      ],
    }],
    ["duplicate look id", { selections: command().selections.map((item, index) => index === 1 ? { ...item, avatarLookId: "look-3" } : item) }],
    ["voice conflict", { selections: command().selections.map((item, index) => index === 2 ? { ...item, expectedVoiceLanguage: "French" } : item) }],
    ["credential mismatch", { providerCredentialVersion: 4 }],
    ["provider mismatch", { providerKey: "other" as "heygen" }],
  ] as const) {
    await t.test(name, async () => {
      const calls: RecordedCall[] = [];
      const adapter = await provider(okPayload, calls);
      const outcome = await adapter.verify(command(override));
      assert.equal(outcome.kind, "failed");
      assert.equal(outcome.failureCode, "invalid_request");
      assert.equal(outcome.providerAccountId, "account-1");
      assert.equal(outcome.providerCredentialVersion, 3);
      assert.equal(calls.length, 0);
      assert.ok(!JSON.stringify(outcome).includes(SECRET));
    });
  }
});

test("provider HTTP failures fail closed without raw errors", async (t) => {
  for (const [status, failureCode] of [
    [401, "provider_unauthorized"],
    [403, "provider_forbidden"],
    [404, "provider_not_found"],
    [429, "provider_rate_limited"],
  ] as const) {
    await t.test(String(status), async () => {
      const adapter = await provider((url) => {
        if (new URL(url).pathname === "/v3/users/me") {
          return jsonResponse({ error: { message: `${SECRET}-denied`, doc_url: `https://example.com/${SECRET}` } }, status);
        }
        return okPayload(url);
      });
      const outcome = await adapter.verify(command());
      assert.equal(outcome.kind, "failed");
      assert.equal(outcome.failureCode, failureCode);
      assert.ok(!JSON.stringify(outcome).includes(SECRET));
      assert.ok(!JSON.stringify(outcome).includes("doc_url"));
    });
  }
});

test("malformed, oversize and timeout responses fail closed", async (t) => {
  await t.test("malformed JSON", async () => {
    const adapter = await provider((url) => new URL(url).pathname === "/v3/users/me"
      ? new Response("{not-json", { status: 200 })
      : okPayload(url));
    const outcome = await adapter.verify(command());
    assert.equal(outcome.kind, "failed");
    assert.equal(outcome.failureCode, "provider_response_untrusted");
  });

  await t.test("declared oversize", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } });
    const adapter = await provider((url) => new URL(url).pathname === "/v3/users/me"
      ? new Response(body, { status: 200, headers: { "content-length": String(300 * 1024) } })
      : okPayload(url));
    const outcome = await adapter.verify(command());
    assert.equal(outcome.kind, "failed");
    assert.equal(outcome.failureCode, "provider_response_untrusted");
    assert.equal(cancelled, true);
  });

  await t.test("chunked oversize", async () => {
    let cancelled = false;
    let pulls = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        controller.enqueue(new Uint8Array(150 * 1024));
      },
      cancel() {
        cancelled = true;
      },
    });
    const adapter = await provider((url) => new URL(url).pathname === "/v3/users/me"
      ? new Response(body, { status: 200 })
      : okPayload(url));
    const outcome = await adapter.verify(command());
    assert.equal(outcome.kind, "failed");
    assert.equal(outcome.failureCode, "provider_response_untrusted");
    assert.equal(cancelled, true);
    assert.ok(pulls <= 3);
  });

  await t.test("timeout", async () => {
    const adapter = await provider((url) => {
      if (new URL(url).pathname === "/v3/users/me") throw new DOMException(`${SECRET}-timeout`, "TimeoutError");
      return okPayload(url);
    });
    const outcome = await adapter.verify(command());
    assert.equal(outcome.kind, "failed");
    assert.equal(outcome.failureCode, "provider_timeout");
    assert.ok(!JSON.stringify(outcome).includes(SECRET));
  });
});

test("resource-specific trust checks fail closed", async (t) => {
  await t.test("account billing model must be supported", async () => {
    const adapter = await provider((url) => new URL(url).pathname === "/v3/users/me"
      ? jsonResponse({ data: { billing_type: "unknown", wallet: {} } })
      : okPayload(url));
    assertFailure(await adapter.verify(command()), "provider_response_untrusted");
  });

  await t.test("look id must match and be completed", async () => {
    const adapter = await provider((url) => new URL(url).pathname.endsWith("/look-1")
      ? jsonResponse({ data: { id: "look-other", group_id: "group-a", supported_api_engines: ["avatar_iv"], status: "completed" } })
      : okPayload(url));
    assertFailure(await adapter.verify(command()), "avatar_look_unavailable");
  });

  await t.test("look must support requested engine", async () => {
    const adapter = await provider((url) => new URL(url).pathname.endsWith("/look-3")
      ? jsonResponse({ data: { id: "look-3", group_id: "group-b", supported_api_engines: ["avatar_iv"], status: "completed" } })
      : okPayload(url));
    assertFailure(await adapter.verify(command()), "avatar_look_unavailable");
  });

  await t.test("parent group consent is separate from look status", async () => {
    const adapter = await provider((url) => new URL(url).pathname === "/v3/avatars/group-a"
      ? jsonResponse({ data: { id: "group-a", status: "completed", consent_status: "pending" } })
      : okPayload(url));
    assertFailure(await adapter.verify(command()), "avatar_group_unavailable");
  });

  await t.test("voice id and language must match", async () => {
    const adapter = await provider((url) => new URL(url).pathname === "/v3/voices/voice-b"
      ? jsonResponse({ data: { voice_id: "voice-b", language: "English", gender: "male" } })
      : okPayload(url));
    assertFailure(await adapter.verify(command()), "voice_unavailable");
  });
});

function assertFailure(outcome: HeyGenV3StaticVerificationOutcome, code: string): void {
  assert.equal(outcome.kind, "failed");
  assert.equal(outcome.failureCode, code);
  assert.ok(!JSON.stringify(outcome).includes(SECRET));
}
