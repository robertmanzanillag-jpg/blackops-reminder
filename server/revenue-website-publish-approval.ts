import { createHash } from "node:crypto";

export type RevenueWebsitePublishApprovalProof = {
  robertApprovedPublish: boolean;
  previewDeployVerified: boolean;
  appQaTargetPassed: boolean;
  rollbackVerified: boolean;
  deployProvider: string;
  previewDeployUrl: string;
  appQaEvidenceUrl: string;
  rollbackPlanUrl: string;
};

export type RevenueWebsitePublishApprovalSnapshot = {
  outreachDraftId: string;
  websiteCreationApprovalDecisionId: string;
  businessName: string;
  scaffoldSlug: string;
  scaffoldFileCount: number;
  scaffoldInput: unknown;
  scaffoldFilesHash: string;
  packageName: string;
  setupUsd: number;
  monthlyRetainerUsd: number;
};

export function buildRevenueWebsitePublishApprovalTargetId(outreachDraftId: string) {
  return `website-publish:${outreachDraftId}`;
}

export function buildRevenueWebsitePublishSnapshotHash(
  snapshot: RevenueWebsitePublishApprovalSnapshot,
  proof: RevenueWebsitePublishApprovalProof,
) {
  const payload = {
    snapshot,
    proof,
  };

  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}
