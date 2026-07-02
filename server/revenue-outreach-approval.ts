import { createHash } from "node:crypto";

export type RevenueOutreachApprovalSnapshot = {
  id: string;
  businessName: string;
  channel: string;
  recipientEmail: string;
  contactName: string;
  subject: string;
  body: string;
  sourceUrl?: string;
  mockupUrl?: string;
  businessSummary: string;
  status: string;
  sendStatus?: string;
  delivery?: { sendStatus: string };
  qaGates: Array<{ gate: string; passed: boolean; fix: string }>;
};

export function buildRevenueOutreachApprovalTargetId(draftId: string) {
  return `outreach-draft:${draftId}`;
}

export function buildRevenueOutreachSnapshotHash(draft: RevenueOutreachApprovalSnapshot) {
  const payload = {
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
    qaGates: draft.qaGates,
  };

  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}
