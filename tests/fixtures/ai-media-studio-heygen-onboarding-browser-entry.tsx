import React from "react";
import { createRoot } from "react-dom/client";
import { HeyGenRosterSetup } from "../../client/src/features/ai-media-studio/core/heygen-roster-setup";
import type { HeyGenOnboardingReadiness } from "../../shared/ai-media-studio-heygen-onboarding";

const steps: HeyGenOnboardingReadiness["steps"] = [
  { id: "secure_credential_handoff", state: "complete", owner: "robert", reasonCode: "account_ready_for_roster", actionCode: "no_roster_action_required" },
  { id: "unique_account_metadata", state: "complete", owner: "system", reasonCode: "account_ready_for_roster", actionCode: "no_roster_action_required" },
  { id: "roster_mapping", state: "complete", owner: "robert", reasonCode: "account_ready_for_roster", actionCode: "no_roster_action_required" },
  { id: "blocked_plan_materialization", state: "complete", owner: "system", reasonCode: "blocked_plan_materialized", actionCode: "no_roster_action_required" },
  { id: "external_sandbox_requirements", state: "blocked", owner: "operator", reasonCode: "external_checks_not_started", actionCode: "complete_live_sandbox_prerequisites" },
];

function readiness(status: HeyGenOnboardingReadiness["status"]): HeyGenOnboardingReadiness {
  return {
    version: 1,
    source: "postgresql_read_only",
    observedAt: "2030-01-01T00:00:00.000Z",
    status,
    target: { minAvatars: 5, maxAvatars: 10, videosPerAvatar: 10, minVideos: 50, maxVideos: 100 },
    secretHandling: { channel: "deployment_secret_manager", channelState: "configured", browserInputAllowed: false, requestBodyAllowed: false, valueObserved: false },
    roster: { state: "configured", avatarCount: 5, plannedVideoCount: 50 },
    steps,
    effects: { providerNetworkCall: false, liveVerification: false, generation: false, admission: false, spend: false, deployment: false, migrationApply: false, publishing: false },
  };
}

const root = createRoot(document.getElementById("root")!);
function render(status: HeyGenOnboardingReadiness["status"]) {
  root.render(<HeyGenRosterSetup onboardingReadiness={readiness(status)} />);
}

const harness = (window as any).__heyGenOnboardingHarness;
harness.render = render;
render("ready_for_roster_ids");
