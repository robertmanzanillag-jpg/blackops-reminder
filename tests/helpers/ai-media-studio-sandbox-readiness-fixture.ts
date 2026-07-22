import { sandboxReadinessSchema } from "../../shared/ai-media-studio-sandbox-readiness";

export const planId = `plan_${"a".repeat(24)}`;
export const batchId = `batch_${"b".repeat(24)}`;
export const slotId = `slot_${"c".repeat(24)}`;

export function sandboxPacket() {
  const gates = [
    "batch_approval", "slot_binding", "source_eligibility", "provider_binding_local", "governance_coverage",
  ].map((code) => ({ code, state: "passed", reasonCode: "ready", nextActionCode: "none" }));
  return sandboxReadinessSchema.parse({
    version: 1, source: "derived_read_only", subject: { planId, batchId, slotId },
    observedAt: "2026-07-22T00:00:00.000Z", status: "locally_ready_for_external_sandbox",
    format: { aspectRatio: "9:16", orientation: "vertical" },
    preview: { creatorName: "Creator", videoNumber: 1, source: { title: "Owned source", category: "events" },
      script: { key: `script_${"d".repeat(24)}`, title: "Title", angle: "Angle", hook: "Hook", script: "Safe script",
        cta: "CTA", caption: "Caption", hashtags: ["#safe"], seoKeywords: ["safe"] } },
    canGenerate: false, sandboxExecutionAllowed: false, spendAuthorized: false, noSpend: true,
    authoritativeForAdmission: false,
    effects: { intentCreated: false, evidenceCreated: false, snapshotCreated: false, reservationCreated: false,
      renderCreated: false, outboxCreated: false, providerCalled: false },
    summary: { totalGates: 6, passedGates: 5, blockedGates: 0, pendingExternalGates: 1 },
    gates: [...gates, { code: "external_requirements", state: "pending_external",
      reasonCode: "external_setup_required", nextActionCode: "complete_external_requirements" }],
    externalRequirements: ["provider_live_verification", "maximum_quote", "human_sandbox_cost_approval",
      "owned_storage_readiness", "callback_readiness"].map((code) => ({ code, state: "required_external" })),
  });
}
