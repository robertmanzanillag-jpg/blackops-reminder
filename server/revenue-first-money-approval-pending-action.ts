import { z } from "zod";

function hasPlaceholderValue(value: string) {
  return /\b(REPLACE_WITH|PLACEHOLDER|TODO|TBD|YOUR_)/i.test(value);
}

function isUrl(value: string) {
  try {
    new URL(value);
    return true;
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
  .refine(isUrl, "Evidence URL must be a valid URL.");

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
