import React from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HeyGenGuidedSetup } from "../../client/src/features/ai-media-studio/core/heygen-guided-setup";
import type { HeyGenOnboardingReadiness } from "../../shared/ai-media-studio-heygen-onboarding";

const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
const root = createRoot(document.getElementById("root")!);

function readiness(configured: boolean): HeyGenOnboardingReadiness {
  return {
    version: 1,
    source: "postgresql_read_only",
    observedAt: "2030-01-01T00:00:00.000Z",
    status: configured ? "ready_for_roster_ids" : "awaiting_secure_credential",
    target: { minAvatars: 5, maxAvatars: 10, videosPerAvatar: 10, minVideos: 50, maxVideos: 100 },
    secretHandling: {
      channel: "deployment_secret_manager",
      channelState: configured ? "configured" : "unselected",
      browserInputAllowed: false,
      requestBodyAllowed: false,
      valueObserved: false,
    },
    roster: { state: "not_configured" },
    steps: configured ? [
      { id: "secure_credential_handoff", state: "complete", owner: "robert", reasonCode: "account_ready_for_roster", actionCode: "no_roster_action_required" },
      { id: "unique_account_metadata", state: "complete", owner: "system", reasonCode: "account_ready_for_roster", actionCode: "no_roster_action_required" },
      { id: "roster_mapping", state: "action_required", owner: "robert", reasonCode: "roster_not_configured", actionCode: "enter_5_to_10_avatar_voice_pairs" },
      { id: "blocked_plan_materialization", state: "blocked", owner: "system", reasonCode: "roster_not_configured", actionCode: "enter_5_to_10_avatar_voice_pairs" },
      { id: "external_sandbox_requirements", state: "blocked", owner: "operator", reasonCode: "external_checks_not_started", actionCode: "complete_live_sandbox_prerequisites" },
    ] : [
      { id: "secure_credential_handoff", state: "action_required", owner: "robert", reasonCode: "credential_metadata_missing", actionCode: "store_api_key_in_deployment_secret_manager" },
      { id: "unique_account_metadata", state: "blocked", owner: "operator", reasonCode: "credential_metadata_requires_review", actionCode: "review_provider_account_metadata" },
      { id: "roster_mapping", state: "blocked", owner: "robert", reasonCode: "credential_metadata_requires_review", actionCode: "review_provider_account_metadata" },
      { id: "blocked_plan_materialization", state: "blocked", owner: "system", reasonCode: "roster_not_configured", actionCode: "enter_5_to_10_avatar_voice_pairs" },
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
  };
}

function render(configured = false) {
  root.render(
    <QueryClientProvider client={queryClient}>
      <HeyGenGuidedSetup
        readiness={readiness(configured)}
        onReadinessRefresh={async () => render(true)}
      />
    </QueryClientProvider>,
  );
}

render();
