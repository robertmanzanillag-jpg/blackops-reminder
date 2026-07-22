import assert from "node:assert/strict";
import test from "node:test";
import { heyGenOnboardingReadinessSchema } from "../shared/ai-media-studio-heygen-onboarding";
import {
  HeyGenOnboardingReadinessService,
  type HeyGenOnboardingObservation,
  type HeyGenOnboardingReadinessRepository,
} from "../server/ai-media-studio/providers/heygen-onboarding-readiness";

const scope = { ownerUserId: "owner-a", workspaceId: "personal" };
const observedAt = "2026-07-22T12:00:00.000Z";
const account = {
  id: "10000000-0000-4000-8000-000000000001",
  status: "disconnected",
  credentialStatus: "unverified",
  credentialVersion: 3,
  credentialSource: "static_api_key",
} as const;
const plan = {
  providerAccountId: account.id,
  credentialVersion: 3,
  status: "blocked",
  plannedSlotCount: 50,
  slotCount: 50,
  memberCount: 5,
} as const;

function service(observation: HeyGenOnboardingObservation): HeyGenOnboardingReadinessService {
  const repository: HeyGenOnboardingReadinessRepository = { observe: async () => observation };
  return new HeyGenOnboardingReadinessService(repository);
}

test("onboarding readiness distinguishes secure handoff, account review, roster intake, configured, stale, and corrupt states", async () => {
  const cases = [
    { expected: "awaiting_secure_credential", accounts: [], plans: [] },
    { expected: "credential_metadata_attention", accounts: [{ ...account, credentialSource: "not_bound", credentialVersion: 0 }], plans: [] },
    { expected: "credential_metadata_attention", accounts: [{ ...account, credentialStatus: "attention" }], plans: [] },
    { expected: "ready_for_roster_ids", accounts: [{ ...account, status: "active", credentialStatus: "active" }], plans: [] },
    { expected: "account_ambiguous", accounts: [account, { ...account, id: "10000000-0000-4000-8000-000000000002" }], plans: [] },
    { expected: "ready_for_roster_ids", accounts: [account], plans: [] },
    { expected: "roster_configured_blocked", accounts: [account], plans: [plan] },
    { expected: "stale_roster_binding", accounts: [account], plans: [{ ...plan, credentialVersion: 2 }] },
    { expected: "unavailable", accounts: [account], plans: [{ ...plan, slotCount: 49 }] },
  ] as const;
  for (const item of cases) {
    const result = await service({ observedAt, accounts: item.accounts, plans: item.plans }).get(scope);
    assert.equal(result.status, item.expected);
    assert.deepEqual(result.target, { minAvatars: 5, maxAvatars: 10, videosPerAvatar: 10, minVideos: 50, maxVideos: 100 });
    assert.deepEqual(Object.values(result.effects), Array(8).fill(false));
    assert.equal(result.secretHandling.browserInputAllowed, false);
    assert.equal(result.secretHandling.requestBodyAllowed, false);
    assert.equal(result.secretHandling.valueObserved, false);
    assert.deepEqual(result.steps.map((step) => step.id), [
      "secure_credential_handoff", "unique_account_metadata", "roster_mapping",
      "blocked_plan_materialization", "external_sandbox_requirements",
    ]);
  }
});

test("public readiness contract rejects private fields and inconsistent totals", () => {
  const valid = heyGenOnboardingReadinessSchema.parse({
    version: 1, source: "postgresql_read_only", observedAt,
    status: "ready_for_roster_ids",
    target: { minAvatars: 5, maxAvatars: 10, videosPerAvatar: 10, minVideos: 50, maxVideos: 100 },
    secretHandling: { channel: "deployment_secret_manager", channelState: "configured", browserInputAllowed: false, requestBodyAllowed: false, valueObserved: false },
    roster: { state: "not_configured" },
    steps: [
      { id: "secure_credential_handoff", state: "complete", owner: "robert", reasonCode: "credential_metadata_requires_review", actionCode: "review_provider_account_metadata" },
      { id: "unique_account_metadata", state: "complete", owner: "operator", reasonCode: "account_ready_for_roster", actionCode: "no_roster_action_required" },
      { id: "roster_mapping", state: "action_required", owner: "robert", reasonCode: "roster_not_configured", actionCode: "enter_5_to_10_avatar_voice_pairs" },
      { id: "blocked_plan_materialization", state: "blocked", owner: "system", reasonCode: "roster_not_configured", actionCode: "enter_5_to_10_avatar_voice_pairs" },
      { id: "external_sandbox_requirements", state: "blocked", owner: "operator", reasonCode: "external_checks_not_started", actionCode: "complete_live_sandbox_prerequisites" },
    ],
    effects: { providerNetworkCall: false, liveVerification: false, generation: false, admission: false, spend: false, deployment: false, migrationApply: false, publishing: false },
  });
  for (const key of ["apiKey", "secretRef", "token", "providerAccountId", "avatarId", "voiceId"]) {
    assert.equal(heyGenOnboardingReadinessSchema.safeParse({ ...valid, [key]: "private" }).success, false);
  }
  assert.equal(heyGenOnboardingReadinessSchema.safeParse({ ...valid, roster: { state: "configured", avatarCount: 5, plannedVideoCount: 60 } }).success, false);
});
