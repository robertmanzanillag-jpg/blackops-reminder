import { z } from "zod";

export const launchPreflightGateCodes = [
  "batch_integrity", "plan_window", "source_eligibility", "provider_binding_local",
  "governance_coverage", "launch_intent", "content_approval", "policy_kill_switch",
  "provider_live_verification", "maximum_quote", "sandbox_proof", "human_launch_approval",
  "authority_snapshot", "budget_admission_capacity",
] as const;

export const launchPreflightGateStates = [
  "passed", "blocked", "pending_external", "pending_human", "unavailable",
] as const;

export const launchPreflightReasonCodes = [
  "ready", "batch_not_approved", "batch_shape_invalid", "batch_ambiguous", "plan_not_planned",
  "plan_outside_window", "source_not_eligible", "source_changed", "provider_not_bound",
  "provider_credential_invalid", "provider_resources_invalid", "governance_missing",
  "governance_invalid", "launch_intent_missing", "launch_intent_not_current",
  "content_approval_missing", "content_approval_denied", "content_approval_expired",
  "policy_missing", "policy_inactive", "policy_expired", "kill_switch_missing",
  "kill_switch_active", "kill_switch_expired", "provider_verification_required",
  "provider_verification_unavailable", "maximum_quote_missing", "maximum_quote_denied",
  "maximum_quote_expired", "sandbox_proof_missing", "sandbox_proof_denied",
  "sandbox_proof_expired", "human_approval_missing", "human_approval_denied",
  "human_approval_expired", "authority_snapshot_missing", "authority_snapshot_expired",
  "budget_bucket_missing", "budget_capacity_insufficient", "concurrency_capacity_insufficient",
  "existing_attempt_conflict", "observation_unavailable",
] as const;

export const launchPreflightNextActionCodes = [
  "none", "approve_scripts", "repair_batch", "wait_for_plan_window", "repair_source",
  "configure_provider", "refresh_provider_credential", "repair_provider_resources",
  "record_governance", "declare_launch_intent", "record_content_approval", "revise_policy",
  "disable_kill_switch", "verify_provider_live", "obtain_maximum_quote", "run_sandbox",
  "request_human_approval", "create_authority_snapshot", "configure_budget",
  "free_capacity", "resolve_existing_attempt", "retry_observation",
] as const;

export const launchPreflightGateSchema = z.object({
  code: z.enum(launchPreflightGateCodes),
  state: z.enum(launchPreflightGateStates),
  readySlots: z.number().int().min(0).max(100),
  requiredSlots: z.number().int().min(50).max(100),
  reasonCode: z.enum(launchPreflightReasonCodes),
  nextActionCode: z.enum(launchPreflightNextActionCodes),
}).strict();

export const launchPreflightSchema = z.object({
  version: z.literal(1),
  source: z.literal("derived_read_only"),
  subject: z.object({
    planId: z.string().regex(/^plan_[0-9a-f]{24}$/u),
    batchId: z.string().regex(/^batch_[0-9a-f]{24}$/u),
    avatarCount: z.number().int().min(5).max(10),
    videosPerAvatar: z.literal(10),
    plannedVideoCount: z.number().int().min(50).max(100),
  }).strict(),
  observedAt: z.string().datetime({ offset: true }),
  status: z.enum(["blocked", "offline_ready_for_external_setup", "ready_at_observation"]),
  canGenerate: z.literal(false),
  sandboxExecutionAllowed: z.literal(false),
  spendAuthorized: z.literal(false),
  noSpend: z.literal(true),
  authoritativeForAdmission: z.literal(false),
  effects: z.object({
    intentCreated: z.literal(false), evidenceCreated: z.literal(false), snapshotCreated: z.literal(false),
    reservationCreated: z.literal(false), renderCreated: z.literal(false), outboxCreated: z.literal(false),
    providerCalled: z.literal(false),
  }).strict(),
  summary: z.object({
    totalGates: z.literal(14), passedGates: z.number().int().min(0).max(14),
    blockedGates: z.number().int().min(0).max(14), pendingExternalGates: z.number().int().min(0).max(14),
    pendingHumanGates: z.number().int().min(0).max(14), unavailableGates: z.number().int().min(0).max(14),
    readySlots: z.number().int().min(0).max(100), requiredSlots: z.number().int().min(50).max(100),
  }).strict(),
  gates: z.tuple(launchPreflightGateCodes.map((code) => launchPreflightGateSchema.extend({ code: z.literal(code) })) as unknown as [
    typeof launchPreflightGateSchema, typeof launchPreflightGateSchema, typeof launchPreflightGateSchema,
    typeof launchPreflightGateSchema, typeof launchPreflightGateSchema, typeof launchPreflightGateSchema,
    typeof launchPreflightGateSchema, typeof launchPreflightGateSchema, typeof launchPreflightGateSchema,
    typeof launchPreflightGateSchema, typeof launchPreflightGateSchema, typeof launchPreflightGateSchema,
    typeof launchPreflightGateSchema, typeof launchPreflightGateSchema,
  ]),
}).strict().superRefine((value, context) => {
  const required = value.subject.plannedVideoCount;
  const counts = {
    passed: value.gates.filter((gate) => gate.state === "passed").length,
    blocked: value.gates.filter((gate) => gate.state === "blocked").length,
    pending_external: value.gates.filter((gate) => gate.state === "pending_external").length,
    pending_human: value.gates.filter((gate) => gate.state === "pending_human").length,
    unavailable: value.gates.filter((gate) => gate.state === "unavailable").length,
  };
  const invalidGate = value.gates.find((gate) => gate.requiredSlots !== required || gate.readySlots > required
    || (gate.state === "passed" && (gate.readySlots !== required || gate.reasonCode !== "ready" || gate.nextActionCode !== "none"))
    || (gate.state !== "passed" && (gate.reasonCode === "ready" || gate.nextActionCode === "none")));
  const minimumReady = Math.min(...value.gates.map((gate) => gate.readySlots));
  const summaryInvalid = value.summary.requiredSlots !== required || value.summary.readySlots !== minimumReady
    || value.summary.passedGates !== counts.passed || value.summary.blockedGates !== counts.blocked
    || value.summary.pendingExternalGates !== counts.pending_external
    || value.summary.pendingHumanGates !== counts.pending_human
    || value.summary.unavailableGates !== counts.unavailable;
  const allPassed = counts.passed === 14;
  const foundation = new Set(["batch_integrity", "plan_window", "source_eligibility",
    "provider_binding_local", "governance_coverage", "policy_kill_switch"]);
  const offlineReady = value.gates.every((gate) => foundation.has(gate.code)
    ? gate.state === "passed"
    : gate.state === "passed" || gate.state === "pending_external" || gate.state === "pending_human");
  const expectedStatus = allPassed ? "ready_at_observation"
    : offlineReady ? "offline_ready_for_external_setup" : "blocked";
  if (invalidGate || summaryInvalid || value.status !== expectedStatus) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "launch preflight invariants are inconsistent" });
  }
});

export const launchPreflightResponseSchema = z.object({ preflight: launchPreflightSchema }).strict();
export type LaunchPreflight = z.infer<typeof launchPreflightSchema>;
export type LaunchPreflightGate = z.infer<typeof launchPreflightGateSchema>;
