import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { mediaStudioCoreApi } from "../client/src/features/ai-media-studio/core/api.ts";

const repositoryRoot = process.cwd();

function readiness(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    source: "postgresql_read_only",
    observedAt: "2030-01-01T00:00:00.000Z",
    status: "ready_for_roster_ids",
    target: { minAvatars: 5, maxAvatars: 10, videosPerAvatar: 10, minVideos: 50, maxVideos: 100 },
    secretHandling: {
      channel: "deployment_secret_manager",
      channelState: "configured",
      browserInputAllowed: false,
      requestBodyAllowed: false,
      valueObserved: false,
    },
    roster: { state: "not_configured" },
    steps: [
      { id: "secure_credential_handoff", state: "complete", owner: "robert", reasonCode: "account_ready_for_roster", actionCode: "no_roster_action_required" },
      { id: "unique_account_metadata", state: "complete", owner: "system", reasonCode: "account_ready_for_roster", actionCode: "no_roster_action_required" },
      { id: "roster_mapping", state: "action_required", owner: "robert", reasonCode: "roster_not_configured", actionCode: "enter_5_to_10_avatar_voice_pairs" },
      { id: "blocked_plan_materialization", state: "blocked", owner: "system", reasonCode: "roster_not_configured", actionCode: "no_roster_action_required" },
      { id: "external_sandbox_requirements", state: "blocked", owner: "operator", reasonCode: "external_checks_not_started", actionCode: "complete_live_sandbox_prerequisites" },
    ],
    effects: {
      providerNetworkCall: false,
      liveVerification: false,
      generation: false,
      admission: false,
      spend: false,
      deployment: false,
      migrationApply: false,
      publishing: false,
    },
    ...overrides,
  };
}

test("HeyGen onboarding client fetches the strict no-store read-only DTO", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input, init) => {
    assert.equal(String(input), "/api/ai-media-studio/provider-configurations/heygen/onboarding-readiness");
    assert.equal(init?.credentials, "include");
    assert.equal(init?.cache, "no-store");
    assert.equal(init?.method, undefined);
    assert.equal(init?.body, undefined);
    return new Response(JSON.stringify(readiness()), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  try {
    const result = await mediaStudioCoreApi.heyGenOnboardingReadiness();
    assert.equal(result.status, "ready_for_roster_ids");
    assert.equal(result.target.minAvatars, 5);
    assert.equal(result.target.maxVideos, 100);
    assert.deepEqual(Object.values(result.effects), Array(8).fill(false));
    assert.doesNotMatch(JSON.stringify(result), /apiKey|secretValue|token|avatarId|voiceId/u);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("HeyGen onboarding client fails closed on secret fields, effects, and reordered steps", async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const unsafe of [
      readiness({ apiKey: "must-not-cross-http" }),
      readiness({ effects: { ...(readiness().effects as Record<string, unknown>), providerNetworkCall: true } }),
      readiness({ steps: [...(readiness().steps as unknown[])].reverse() }),
    ]) {
      globalThis.fetch = (async () => new Response(JSON.stringify(unsafe), { status: 200, headers: { "Content-Type": "application/json" } })) as typeof fetch;
      await assert.rejects(mediaStudioCoreApi.heyGenOnboardingReadiness());
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("HeyGen onboarding UI gates provider IDs and protects configured roster replacement", async () => {
  const [panel, roster, workspace, sandbox] = await Promise.all([
    readFile(resolve(repositoryRoot, "client/src/features/ai-media-studio/core/heygen-onboarding-panel.tsx"), "utf8"),
    readFile(resolve(repositoryRoot, "client/src/features/ai-media-studio/core/heygen-roster-setup.tsx"), "utf8"),
    readFile(resolve(repositoryRoot, "client/src/features/ai-media-studio/core/core-studio-workspace.tsx"), "utf8"),
    readFile(resolve(repositoryRoot, "client/src/features/ai-media-studio/core/production-batch-workbench.tsx"), "utf8"),
  ]);

  assert.ok(workspace.indexOf("<HeyGenOnboardingPanel") < workspace.indexOf("<InfluencerWorkspace"));
  assert.match(panel, /API keys, secrets, and tokens are never entered or read in this browser/);
  assert.match(panel, /Secret reference metadata is prepared\. The key value was not observed and has not been live-verified/);
  assert.match(panel, /No provider call · No live verification · No generation · No admission · No spend · No migration · No deployment · No publishing/);
  assert.match(panel, /Refresh readiness/);
  assert.doesNotMatch(panel, /type="password"|name="apiKey"|name="secret"|name="token"/iu);

  assert.match(roster, /onboardingReadiness\.status === "ready_for_roster_ids"/);
  assert.match(roster, /showRosterForm && <form/);
  assert.match(roster, /Replace roster/);
  assert.match(roster, /Keep current roster/);
  assert.match(roster, /setReplaceConfirmed\(true\)/);
  assert.match(roster, /disabled=\{!canCollectProviderIds\}/);
  assert.match(roster, /currentRoster && !staleRoster/);
  assert.match(roster, /Register the pending avatar roster/);
  assert.match(sandbox, /No approved public slot is available/);
});
