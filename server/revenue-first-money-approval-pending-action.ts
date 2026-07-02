import { z } from "zod";

function hasPlaceholderValue(value: string) {
  const trimmed = value.trim();
  return /(?:^|[\s/=:?&_-])(REPLACE[\s_-]*WITH|PLACEHOLDER|TODO|TBD|YOUR[\s_-]+|OUTREACH_ID|APPROVAL_ID|CREATION_APPROVAL_ID|DEPLOY_PROVIDER|PREVIEW_URL|APP_QA_URL|ROLLBACK_URL)(?:$|[\s/=:?&_-])/i.test(trimmed)
    || /^(CLIENT[\s_-]*NAME|PAYMENT[\s_-]*EVIDENCE|LEDGER[\s_-]*NOTES)$/i.test(trimmed)
    || /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+(?:_(?:ID|URL|URI|LINK|PROVIDER|TOKEN|KEY|SECRET|EVIDENCE|NOTES?|NAME))$/i.test(trimmed);
}

function isHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function isAllowedStripePaymentLink(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && ["buy.stripe.com", "checkout.stripe.com", "invoice.stripe.com"].includes(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

const revenueEvidenceUrlSchema = z.string().trim().min(8).max(500)
  .refine((value) => !hasPlaceholderValue(value), "Evidence URL must be real evidence, not a placeholder.")
  .refine(isHttpUrl, "Evidence URL must be an HTTP(S) URL.");

const revenueEvidenceNoteSchema = z.string().trim().min(8).max(1000)
  .refine((value) => !hasPlaceholderValue(value), "Evidence note must be real proof, not a placeholder.");

export const revenueContactPathApprovalPendingActionSchema = z.object({
  contactMode: z.enum(["manual", "email_provider"]).default("manual"),
  fromEmail: z.string().trim().max(180)
    .refine((value) => !value || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value), "From email must be a valid email when provided.")
    .optional()
    .default(""),
  manualContactApproved: z.boolean().default(false),
  emailProviderConfigured: z.boolean().default(false),
  approvedAction: z.string().trim().min(8).max(500).default("Approve exact manual contact path for first-money outreach."),
  robertApprovedContactPath: z.boolean().default(false),
  contactPathVerified: z.boolean().default(false),
  evidenceUrl: revenueEvidenceUrlSchema,
  evidenceNote: revenueEvidenceNoteSchema,
}).strict().superRefine((input, ctx) => {
  if (input.contactMode === "manual" && !input.manualContactApproved) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["manualContactApproved"], message: "Manual contact approval is required for manual contact paths." });
  }
  if (input.contactMode === "email_provider" && !input.emailProviderConfigured) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["emailProviderConfigured"], message: "Email provider configuration is required for provider contact paths." });
  }
  if (input.contactMode === "email_provider" && !input.fromEmail) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["fromEmail"], message: "From email is required for provider contact paths." });
  }
  if (!input.robertApprovedContactPath) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["robertApprovedContactPath"], message: "Robert contact path approval is required." });
  }
  if (!input.contactPathVerified) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["contactPathVerified"], message: "Contact path verification is required." });
  }
});

export const revenuePaymentPathApprovalPendingActionSchema = z.object({
  paymentLink: z.string().trim().min(8).max(500)
    .refine((value) => !hasPlaceholderValue(value), "Payment link must be real, not a placeholder.")
    .refine(isAllowedStripePaymentLink, "Payment link must be an HTTPS Stripe payment, checkout, or invoice link."),
  approvedAction: z.string().trim().min(8).max(500).default("Approve exact Stripe payment path for first-money deposits."),
  robertApprovedPaymentPath: z.boolean().default(false),
  paymentSmokeVerified: z.boolean().default(false),
  depositConfirmedByRobert: z.boolean().default(false),
  expectedDepositUsd: z.number().finite().min(1).max(1000000),
  expectedPackage: z.string().trim().min(2).max(180),
  evidenceUrl: revenueEvidenceUrlSchema,
  evidenceNote: revenueEvidenceNoteSchema,
}).strict().superRefine((input, ctx) => {
  if (!input.robertApprovedPaymentPath) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["robertApprovedPaymentPath"], message: "Robert payment path approval is required." });
  }
  if (!(input.paymentSmokeVerified || input.depositConfirmedByRobert)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["paymentSmokeVerified"], message: "Payment smoke verification or Robert-confirmed deposit is required." });
  }
});

export const revenueLedgerEntryApprovalPendingActionSchema = z.object({
  kind: z.enum(["website_sale", "automation_sale", "bundle_sale", "retainer"]).default("website_sale"),
  clientName: z.string().trim().min(2).max(180)
    .refine((value) => !hasPlaceholderValue(value), "Client name must be real, not a placeholder."),
  amountUsd: z.number().finite().min(1).max(1000000),
  cashCollectedUsd: z.number().finite().min(1).max(1000000),
  estimatedInternalCostUsd: z.number().finite().min(0).max(100000),
  notes: z.string().trim().max(1000).default("")
    .refine((value) => !value || !hasPlaceholderValue(value), "Notes must be real ledger/payment context, not placeholders."),
  paymentEvidence: z.string().trim().min(8).max(1000)
    .refine((value) => !hasPlaceholderValue(value), "Payment evidence must be real collected cash proof, not a placeholder."),
  approvedAction: z.string().trim().min(8).max(500)
    .default("Approve exact paid ledger entry after Robert verified payment evidence.")
    .refine((value) => !hasPlaceholderValue(value), "Approved action must be real approval context, not a placeholder."),
}).strict();

export const revenueWebsiteCreationApprovalPendingActionSchema = z.object({
  outreachDraftId: z.string().trim().min(2).max(180)
    .refine((value) => !hasPlaceholderValue(value), "Outreach draft id must be real, not a placeholder."),
  approvedAction: z.string().trim().min(8).max(500)
    .default("Approve paid website creation handoff after scope, deposit, and public data review.")
    .refine((value) => !hasPlaceholderValue(value), "Approved action must be real approval context, not a placeholder."),
  notes: z.string().trim().min(8).max(1000)
    .refine((value) => !hasPlaceholderValue(value), "Notes must be real proof/context, not a placeholder."),
  robertApprovedBuild: z.boolean().default(false),
  clientApprovedScope: z.boolean().default(false),
  depositPaid: z.boolean().default(false),
  publicDataVerified: z.boolean().default(false),
  launchTargetDays: z.number().int().min(1).max(60).default(7),
}).strict().superRefine((input, ctx) => {
  if (!input.robertApprovedBuild) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["robertApprovedBuild"], message: "Robert build approval is required." });
  }
  if (!input.clientApprovedScope) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["clientApprovedScope"], message: "Client-approved scope is required." });
  }
  if (!input.depositPaid) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["depositPaid"], message: "Deposit proof is required." });
  }
  if (!input.publicDataVerified) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["publicDataVerified"], message: "Public data verification is required." });
  }
});

export const revenueWebsitePublishApprovalPendingActionSchema = z.object({
  outreachDraftId: z.string().trim().min(2).max(180)
    .refine((value) => !hasPlaceholderValue(value), "Outreach draft id must be real, not a placeholder."),
  websiteCreationApprovalDecisionId: z.string().trim().min(2).max(180)
    .refine((value) => !hasPlaceholderValue(value), "Website creation approval decision id must be real, not a placeholder."),
  approvedAction: z.string().trim().min(8).max(500)
    .default("Approve exact website publish readiness handoff after preview, App QA, rollback, and Robert review.")
    .refine((value) => !hasPlaceholderValue(value), "Approved action must be real approval context, not a placeholder."),
  notes: z.string().trim().min(8).max(1000)
    .refine((value) => !hasPlaceholderValue(value), "Notes must be real proof/context, not a placeholder."),
  robertApprovedPublish: z.boolean().default(false),
  previewDeployVerified: z.boolean().default(false),
  appQaTargetPassed: z.boolean().default(false),
  rollbackVerified: z.boolean().default(false),
  deployProvider: z.string().trim().min(2).max(120)
    .refine((value) => !hasPlaceholderValue(value), "Deploy provider must be real publish context, not a placeholder."),
  previewDeployUrl: revenueEvidenceUrlSchema,
  appQaEvidenceUrl: revenueEvidenceUrlSchema,
  rollbackPlanUrl: revenueEvidenceUrlSchema,
  launchTargetDays: z.number().int().min(1).max(60).default(7),
}).strict().superRefine((input, ctx) => {
  if (!input.robertApprovedPublish) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["robertApprovedPublish"], message: "Robert publish approval is required." });
  }
  if (!input.previewDeployVerified) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["previewDeployVerified"], message: "Preview deploy verification is required." });
  }
  if (!input.appQaTargetPassed) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["appQaTargetPassed"], message: "App QA pass evidence is required." });
  }
  if (!input.rollbackVerified) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["rollbackVerified"], message: "Rollback verification is required." });
  }
});
