import { z } from "zod";
import { INITIAL_CREATOR_CANARY_PROFILE } from "./ai-media-studio-launch-plan-profile";

const launchCreators = INITIAL_CREATOR_CANARY_PROFILE.creators;
const launchSlots = INITIAL_CREATOR_CANARY_PROFILE.slots;

export const heyGenOnboardingStatusSchema = z.enum([
  "awaiting_secure_credential",
  "credential_metadata_attention",
  "account_ambiguous",
  "ready_for_roster_ids",
  "roster_configured_blocked",
  "stale_roster_binding",
  "unavailable",
]);

export const heyGenOnboardingStepIdSchema = z.enum([
  "secure_credential_handoff",
  "unique_account_metadata",
  "roster_mapping",
  "blocked_plan_materialization",
  "external_sandbox_requirements",
]);

export const heyGenOnboardingReasonCodeSchema = z.enum([
  "credential_metadata_missing",
  "credential_metadata_requires_review",
  "multiple_accounts_detected",
  "account_ready_for_roster",
  "roster_not_configured",
  "blocked_plan_materialized",
  "roster_binding_stale",
  "roster_shape_invalid",
  "external_checks_not_started",
  "system_unavailable",
]);

export const heyGenOnboardingActionCodeSchema = z.enum([
  "store_api_key_in_deployment_secret_manager",
  "review_provider_account_metadata",
  "resolve_duplicate_provider_accounts",
  "enter_5_to_10_avatar_voice_pairs",
  "no_roster_action_required",
  "rematerialize_roster_after_rotation",
  "repair_roster_state",
  "complete_live_sandbox_prerequisites",
  "retry_safe_status",
]);

export const heyGenOnboardingStepSchema = z.object({
  id: heyGenOnboardingStepIdSchema,
  state: z.enum(["complete", "action_required", "blocked", "unavailable"]),
  owner: z.enum(["robert", "operator", "system"]),
  reasonCode: heyGenOnboardingReasonCodeSchema,
  actionCode: heyGenOnboardingActionCodeSchema,
}).strict();

const targetSchema = z.object({
  minAvatars: z.literal(launchCreators.minimum),
  maxAvatars: z.literal(launchCreators.maximum),
  videosPerAvatar: z.literal(launchCreators.videosPerCreator),
  minVideos: z.literal(launchSlots.minimum),
  maxVideos: z.literal(launchSlots.maximum),
}).strict();

const secretHandlingSchema = z.object({
  channel: z.literal("deployment_secret_manager"),
  channelState: z.enum(["configured", "unselected"]),
  browserInputAllowed: z.literal(false),
  requestBodyAllowed: z.literal(false),
  valueObserved: z.literal(false),
}).strict();

const rosterSchema = z.object({
  state: z.enum(["not_configured", "configured", "stale", "unavailable"]),
  avatarCount: z.number().int().min(launchCreators.minimum).max(launchCreators.maximum).optional(),
  plannedVideoCount: z.number().int().min(launchSlots.minimum).max(launchSlots.maximum).optional(),
}).strict().superRefine((value, context) => {
  const hasCounts = value.avatarCount !== undefined || value.plannedVideoCount !== undefined;
  if ((value.state === "configured" || value.state === "stale") !== hasCounts
    || (hasCounts && value.plannedVideoCount !== value.avatarCount! * launchCreators.videosPerCreator)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Roster summary is inconsistent" });
  }
});

const effectsSchema = z.object({
  providerNetworkCall: z.literal(false),
  liveVerification: z.literal(false),
  generation: z.literal(false),
  admission: z.literal(false),
  spend: z.literal(false),
  deployment: z.literal(false),
  migrationApply: z.literal(false),
  publishing: z.literal(false),
}).strict();

export const heyGenOnboardingReadinessSchema = z.object({
  version: z.literal(1),
  source: z.literal("postgresql_read_only"),
  observedAt: z.string().datetime({ offset: true }),
  status: heyGenOnboardingStatusSchema,
  target: targetSchema,
  secretHandling: secretHandlingSchema,
  roster: rosterSchema,
  steps: z.tuple([
    heyGenOnboardingStepSchema,
    heyGenOnboardingStepSchema,
    heyGenOnboardingStepSchema,
    heyGenOnboardingStepSchema,
    heyGenOnboardingStepSchema,
  ]).superRefine((steps, context) => {
    const expected = heyGenOnboardingStepIdSchema.options;
    steps.forEach((step, index) => {
      if (step.id !== expected[index]) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: "Onboarding steps are out of order", path: [index, "id"] });
      }
    });
  }),
  effects: effectsSchema,
}).strict();

export const heyGenOnboardingReadinessResponseSchema = z.object({
  readiness: heyGenOnboardingReadinessSchema,
}).strict();

export type HeyGenOnboardingReadiness = z.infer<typeof heyGenOnboardingReadinessSchema>;
export type HeyGenOnboardingReadinessResponse = z.infer<typeof heyGenOnboardingReadinessResponseSchema>;
