import { createHash } from "node:crypto";

export type RevenuePublicCandidateApprovalSnapshot = {
  id: string;
  businessName: string;
  area: string;
  niche: string;
  contactChannel: string;
  contactValue: string;
  recipientEmail: string;
  sourceUrl: string;
  evidence: string;
  verificationStatus: string;
  publicEvidenceVerified: boolean;
};

export function buildRevenuePublicCandidateApprovalTargetId(candidateIds: string[]) {
  return `public-candidates:${candidateIds.join(",")}`;
}

export function buildRevenuePublicCandidateSnapshotHash(candidates: RevenuePublicCandidateApprovalSnapshot[]) {
  const payload = candidates.map((candidate) => ({
    id: candidate.id,
    businessName: candidate.businessName,
    area: candidate.area,
    niche: candidate.niche,
    contactChannel: candidate.contactChannel,
    contactValue: candidate.contactValue,
    recipientEmail: candidate.recipientEmail,
    sourceUrl: candidate.sourceUrl,
    evidence: candidate.evidence,
    verificationStatus: candidate.verificationStatus,
    publicEvidenceVerified: candidate.publicEvidenceVerified,
  }));

  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}
