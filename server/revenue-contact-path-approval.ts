import { createHash } from "node:crypto";

export type RevenueContactPathApprovalProof = {
  robertApprovedContactPath: boolean;
  contactPathVerified: boolean;
  evidenceUrl: string;
  evidenceNote: string;
};

export type RevenueContactPathApprovalSnapshot = {
  contactMode: "manual" | "email_provider";
  fromEmail: string;
  manualContactApproved: boolean;
  emailProviderConfigured: boolean;
};

export function buildRevenueContactPathApprovalTargetId(snapshot: RevenueContactPathApprovalSnapshot) {
  const payload = {
    contactMode: snapshot.contactMode,
    fromEmail: snapshot.fromEmail.trim().toLowerCase(),
    manualContactApproved: snapshot.manualContactApproved,
    emailProviderConfigured: snapshot.emailProviderConfigured,
  };
  const digest = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  return `contact-path:${digest}`;
}

export function buildRevenueContactPathSnapshotHash(
  snapshot: RevenueContactPathApprovalSnapshot,
  proof: RevenueContactPathApprovalProof,
) {
  return createHash("sha256").update(JSON.stringify({ snapshot, proof })).digest("hex");
}
