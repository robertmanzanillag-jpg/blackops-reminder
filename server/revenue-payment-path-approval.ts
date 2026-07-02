import { createHash } from "node:crypto";

export type RevenuePaymentPathApprovalProof = {
  robertApprovedPaymentPath: boolean;
  paymentSmokeVerified: boolean;
  depositConfirmedByRobert: boolean;
  paymentLink: string;
  evidenceUrl: string;
  evidenceNote: string;
};

export type RevenuePaymentPathApprovalSnapshot = {
  paymentMethod: "payment_link";
  paymentLink: string;
  paymentHost: string;
  expectedDepositUsd: number;
  expectedPackage: string;
};

export function buildRevenuePaymentPathApprovalTargetId(paymentLink: string) {
  const normalizedPaymentLink = paymentLink.trim().toLowerCase();
  const digest = createHash("sha256").update(normalizedPaymentLink).digest("hex");
  return `payment-path:${digest}`;
}

export function buildRevenuePaymentPathSnapshotHash(
  snapshot: RevenuePaymentPathApprovalSnapshot,
  proof: RevenuePaymentPathApprovalProof,
) {
  const payload = { snapshot, proof };
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}
