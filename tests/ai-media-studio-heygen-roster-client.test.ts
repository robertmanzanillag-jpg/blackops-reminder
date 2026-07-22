import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { mediaStudioCoreApi } from "../client/src/features/ai-media-studio/core/api.ts";
import {
  emptyHeyGenRosterMember,
  newHeyGenRosterAttemptKey,
} from "../client/src/features/ai-media-studio/core/heygen-roster-setup.tsx";

const repositoryRoot = process.cwd();

function publicRoster() {
  return {
    roster: {
      rosterId: "roster_aaaaaaaaaaaaaaaaaaaaaaaa",
      status: "configured" as const,
      avatarCount: 5,
      videosPerAvatar: 10 as const,
      plannedVideoCount: 50,
      configuredAt: "2030-01-01T00:00:00.000Z",
      members: Array.from({ length: 5 }, (_, index) => ({
        memberId: `member_${String(index + 1).padStart(24, "0")}`,
        name: `Creator ${index + 1}`,
        language: "en-US",
        accent: "Neutral",
        gender: "unspecified" as const,
        videosPlanned: 10 as const,
      })),
    },
  };
}

test("HeyGen roster GET maps only 404 to unconfigured and validates configured state", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async () => new Response(null, { status: 404 })) as typeof fetch;
    assert.equal(await mediaStudioCoreApi.heyGenRoster(), null);

    globalThis.fetch = (async () => new Response(JSON.stringify(publicRoster()), { status: 200, headers: { "Content-Type": "application/json" } })) as typeof fetch;
    assert.equal((await mediaStudioCoreApi.heyGenRoster())?.roster.avatarCount, 5);

    globalThis.fetch = (async () => new Response(JSON.stringify({ error: "private provider detail" }), { status: 503, headers: { "Content-Type": "application/json" } })) as typeof fetch;
    await assert.rejects(mediaStudioCoreApi.heyGenRoster(), (error: Error) => error.message === "Request failed (503)");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("HeyGen roster client posts a private mapping and accepts only the strict public response", async () => {
  const originalFetch = globalThis.fetch;
  let capturedBody = "";
  globalThis.fetch = (async (input, init) => {
    assert.equal(String(input), "/api/ai-media-studio/provider-configurations/heygen/roster");
    assert.equal(init?.method, "POST");
    capturedBody = String(init?.body);
    return new Response(JSON.stringify(publicRoster()), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  try {
    const members = Array.from({ length: 5 }, (_, index) => ({
      ...emptyHeyGenRosterMember(),
      name: `Creator ${index + 1}`,
      avatarId: `avatar-${index + 1}`,
      voiceId: `voice-${index + 1}`,
    }));
    const response = await mediaStudioCoreApi.configureHeyGenRoster({ members, idempotencyKey: "heygen-roster-client-001" });
    assert.equal(response.roster.plannedVideoCount, 50);
    assert.match(capturedBody, /"avatarId":"avatar-1"/);
    assert.match(capturedBody, /"voiceId":"voice-1"/);
    assert.doesNotMatch(JSON.stringify(response), /avatar-1|voice-1/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("HeyGen roster client fetches the no-spend daily plan without native ids", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input) => {
    assert.equal(String(input), "/api/ai-media-studio/provider-configurations/heygen/roster/daily-plan");
    const blockers = ["script_batch_required", "governance_approval_required", "budget_reservation_required", "sandbox_generation_required", "human_launch_approval_required"];
    const planId = "plan_bbbbbbbbbbbbbbbbbbbbbbbb";
    return new Response(JSON.stringify({
      plan: {
        planId,
        rosterId: "roster_aaaaaaaaaaaaaaaaaaaaaaaa",
        planDate: "2030-01-01",
        timeZone: "America/New_York",
        status: "blocked_before_generation",
        avatarCount: 5,
        videosPerAvatar: 10,
        plannedVideoCount: 50,
        canGenerate: false,
        noSpendGuarantee: true,
        generatedAt: "2030-01-01T00:00:00.000Z",
        blockers,
        slots: Array.from({ length: 50 }, (_, index) => ({
          slotId: `slot_${String(index + 1).padStart(24, "0")}`,
          planId,
          rosterId: "roster_aaaaaaaaaaaaaaaaaaaaaaaa",
          memberId: `member_${String(Math.floor(index / 10) + 1).padStart(24, "0")}`,
          creatorName: `Creator ${Math.floor(index / 10) + 1}`,
          videoNumber: (index % 10) + 1,
          status: "not_queued",
          blockers,
        })),
      },
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  try {
    const response = await mediaStudioCoreApi.heyGenRosterDailyPlan();
    assert.equal(response?.plan.plannedVideoCount, 50);
    assert.equal(response?.plan.canGenerate, false);
    assert.equal(response?.plan.noSpendGuarantee, true);
    assert.doesNotMatch(JSON.stringify(response), /avatarId|voiceId|providerAccountId|native/iu);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("HeyGen roster client rejects provider-native fields in a successful response", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({
    roster: {
      rosterId: "roster_aaaaaaaaaaaaaaaaaaaaaaaa",
      status: "configured",
      avatarCount: 5,
      videosPerAvatar: 10,
      plannedVideoCount: 50,
      configuredAt: "2030-01-01T00:00:00.000Z",
      members: Array.from({ length: 5 }, (_, index) => ({
        memberId: `member_${String(index + 1).padStart(24, "0")}`,
        name: `Creator ${index + 1}`,
        language: "en-US",
        accent: "Neutral",
        gender: "unspecified",
        videosPlanned: 10,
        avatarId: `native-${index}`,
      })),
    },
  }), { status: 200, headers: { "Content-Type": "application/json" } })) as typeof fetch;
  try {
    const members = Array.from({ length: 5 }, (_, index) => ({ ...emptyHeyGenRosterMember(), name: `Creator ${index}`, avatarId: `avatar-${index}`, voiceId: `voice-${index}` }));
    await assert.rejects(mediaStudioCoreApi.configureHeyGenRoster({ members, idempotencyKey: "heygen-roster-client-002" }));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("HeyGen roster setup starts at five, caps at ten, and exposes accessible safe-only feedback", async () => {
  const [component, hooks] = await Promise.all([
    readFile(resolve(repositoryRoot, "client/src/features/ai-media-studio/core/heygen-roster-setup.tsx"), "utf8"),
    readFile(resolve(repositoryRoot, "client/src/features/ai-media-studio/core/hooks.ts"), "utf8"),
  ]);
  assert.equal(emptyHeyGenRosterMember().language, "en-US");
  assert.match(component, /HEYGEN_ROSTER_MIN_AVATARS/);
  assert.match(component, /HEYGEN_ROSTER_MAX_AVATARS/);
  assert.match(component, /HEYGEN_ROSTER_VIDEOS_PER_AVATAR/);
  assert.match(component, /role="alert"/);
  assert.match(component, /role="status"/);
  assert.match(component, /aria-live="polite"/);
  assert.match(component, /htmlFor=\{id\}/);
  assert.match(component, /motion-reduce:animate-none/);
  assert.match(component, /does not generate or spend credits/);
  assert.match(component, /Daily plan preview/);
  assert.match(component, /All slots are blocked before generation/);
  assert.match(component, /Retry status check/);
  assert.match(component, /Retry daily plan/);
  assert.match(component, /No jobs were queued and no credits were spent/);
  assert.match(component, /disabled=\{mutation\.isPending \|\| setupBlocked\}/);
  assert.match(component, /label="HeyGen avatar look ID"/);
  assert.doesNotMatch(component, /HeyGen avatar ID/);
  assert.match(hooks, /invalidateQueries\(\{ queryKey: coreStudioKeys\.heyGenOnboardingReadiness \}\)/);
  assert.doesNotMatch(component, /localStorage|sessionStorage|URLSearchParams|console\./);
  assert.doesNotMatch(component, /API key.*<input|token.*<input/i);
});

test("HeyGen roster attempt keys use secure browser randomness without timestamp fallback", () => {
  const first = newHeyGenRosterAttemptKey();
  const second = newHeyGenRosterAttemptKey();
  assert.match(first, /^heygen-roster-[a-f0-9-]{32,36}$/u);
  assert.notEqual(first, second);
});
