import { z } from "zod";
import { mediaSourceTypeSchema } from "./ai-media-studio-scripts";
import { productionBatchCreativeReviewSchema } from "./ai-media-studio-production-batches";

const publicKey = (prefix: string) => z.string().regex(new RegExp(`^${prefix}_[a-f0-9]{24}$`, "u"));
const cleanText = (maximum: number) => z.string().trim().min(1).max(maximum)
  .refine((value) => !/[\u0000-\u001f\u007f]/u.test(value));

export const sandboxReadinessGateCodes = [
  "batch_approval", "slot_binding", "source_eligibility", "provider_binding_local",
  "governance_coverage", "external_requirements",
] as const;
export const sandboxReadinessReasonCodes = [
  "ready", "slot_binding_invalid", "provider_binding_invalid", "governance_missing", "governance_invalid",
  "external_setup_required",
] as const;
export const sandboxReadinessNextActionCodes = [
  "none", "configure_provider", "record_governance", "complete_external_requirements",
] as const;

export const sandboxReadinessGateSchema = z.object({
  code: z.enum(sandboxReadinessGateCodes),
  state: z.enum(["passed", "blocked", "pending_external"]),
  reasonCode: z.enum(sandboxReadinessReasonCodes),
  nextActionCode: z.enum(sandboxReadinessNextActionCodes),
}).strict();

export const sandboxExternalRequirementCodes = [
  "provider_live_verification", "maximum_quote", "human_sandbox_cost_approval",
  "owned_storage_readiness", "callback_readiness",
] as const;

export const sandboxReadinessSchema = z.object({
  version: z.literal(1),
  source: z.literal("derived_read_only"),
  subject: z.object({
    planId: publicKey("plan"), batchId: publicKey("batch"), slotId: publicKey("slot"),
  }).strict(),
  observedAt: z.string().datetime({ offset: true }),
  status: z.enum(["blocked", "locally_ready_for_external_sandbox"]),
  format: z.object({ aspectRatio: z.literal("9:16"), orientation: z.literal("vertical") }).strict(),
  preview: z.object({
    creatorName: cleanText(120),
    videoNumber: z.number().int().min(1).max(10),
    source: z.object({ title: cleanText(200), category: mediaSourceTypeSchema }).strict(),
    script: z.object({
      key: publicKey("script"), title: cleanText(200),
    }).merge(productionBatchCreativeReviewSchema.omit({ title: true })).strict(),
  }).strict(),
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
    totalGates: z.literal(6), passedGates: z.number().int().min(0).max(5),
    blockedGates: z.number().int().min(0).max(5), pendingExternalGates: z.literal(1),
  }).strict(),
  gates: z.tuple(sandboxReadinessGateCodes.map((code) => sandboxReadinessGateSchema.extend({ code: z.literal(code) })) as unknown as [
    typeof sandboxReadinessGateSchema, typeof sandboxReadinessGateSchema, typeof sandboxReadinessGateSchema,
    typeof sandboxReadinessGateSchema, typeof sandboxReadinessGateSchema, typeof sandboxReadinessGateSchema,
  ]),
  externalRequirements: z.array(z.object({
    code: z.enum(sandboxExternalRequirementCodes), state: z.literal("required_external"),
  }).strict()).length(5),
}).strict().superRefine((packet, context) => {
  const passed = packet.gates.filter((gate) => gate.state === "passed").length;
  const blocked = packet.gates.filter((gate) => gate.state === "blocked").length;
  const pending = packet.gates.filter((gate) => gate.state === "pending_external").length;
  const invalidGate = packet.gates.some((gate, index) => gate.code !== sandboxReadinessGateCodes[index]
    || (gate.state === "passed") !== (gate.reasonCode === "ready" && gate.nextActionCode === "none"))
    || packet.gates[5].state !== "pending_external"
    || packet.gates[5].reasonCode !== "external_setup_required"
    || packet.gates[5].nextActionCode !== "complete_external_requirements";
  const invalidExternalRequirements = packet.externalRequirements.some((requirement, index) =>
    requirement.code !== sandboxExternalRequirementCodes[index]);
  const expectedStatus = blocked === 0 ? "locally_ready_for_external_sandbox" : "blocked";
  if (invalidGate || passed !== packet.summary.passedGates || blocked !== packet.summary.blockedGates
    || pending !== packet.summary.pendingExternalGates || passed + blocked + pending !== 6
    || invalidExternalRequirements || packet.status !== expectedStatus) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Sandbox readiness invariants are inconsistent" });
  }
});

export const sandboxReadinessResponseSchema = z.object({ sandboxReadiness: sandboxReadinessSchema }).strict();
export type SandboxReadiness = z.infer<typeof sandboxReadinessSchema>;
export type SandboxReadinessGate = z.infer<typeof sandboxReadinessGateSchema>;
