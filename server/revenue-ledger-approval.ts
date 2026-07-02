import { createHash } from "node:crypto";

export type RevenueLedgerApprovalSnapshot = {
  kind: "website_sale" | "automation_sale" | "bundle_sale" | "retainer" | "expense";
  clientName: string;
  amountUsd: number;
  cashCollectedUsd: number;
  estimatedInternalCostUsd: number;
  notes: string;
};

export function buildRevenueLedgerApprovalSnapshotHash(input: RevenueLedgerApprovalSnapshot) {
  const payload = {
    kind: input.kind,
    clientName: input.clientName,
    amountUsd: input.amountUsd,
    cashCollectedUsd: input.cashCollectedUsd,
    estimatedInternalCostUsd: input.estimatedInternalCostUsd,
    notes: input.notes,
  };

  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export function buildRevenueLedgerApprovalTargetId(input: RevenueLedgerApprovalSnapshot) {
  return `ledger-entry:${buildRevenueLedgerApprovalSnapshotHash(input).slice(0, 24)}`;
}
