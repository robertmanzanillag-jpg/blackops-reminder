import { createHash } from "node:crypto";
import type { RevenueOutreachApprovalSnapshot } from "./revenue-outreach-approval";

export type RevenueWebsiteCreationApprovalProof = {
  robertApprovedBuild: boolean;
  clientApprovedScope: boolean;
  depositPaid: boolean;
  publicDataVerified: boolean;
  launchTargetDays: number;
};

export type RevenueWebsiteCreationApprovalSnapshot = RevenueOutreachApprovalSnapshot & {
  pricing?: {
    totalSetupUsd: number;
    monthlyRetainerUsd: number;
    estimatedInternalMonthlyCostUsd: number;
  };
  websitePriceUsd?: number;
  automationPriceUsd?: number;
};

export function buildRevenueWebsiteCreationApprovalTargetId(outreachDraftId: string) {
  return `website-creation:${outreachDraftId}`;
}

export function buildRevenueWebsiteCreationSnapshotHash(
  draft: RevenueWebsiteCreationApprovalSnapshot,
  proof: RevenueWebsiteCreationApprovalProof,
) {
  const payload = {
    draft: {
      id: draft.id,
      businessName: draft.businessName,
      channel: draft.channel,
      recipientEmail: draft.recipientEmail,
      contactName: draft.contactName,
      subject: draft.subject,
      body: draft.body,
      sourceUrl: draft.sourceUrl || "",
      mockupUrl: draft.mockupUrl || "",
      businessSummary: draft.businessSummary,
      status: draft.status,
      sendStatus: draft.delivery?.sendStatus || draft.sendStatus || "",
      pricing: draft.pricing || null,
      websitePriceUsd: draft.websitePriceUsd ?? 0,
      automationPriceUsd: draft.automationPriceUsd ?? 0,
      qaGates: draft.qaGates,
    },
    proof,
  };

  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}
