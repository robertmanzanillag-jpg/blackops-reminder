import { z } from "zod";

export const quoteReadinessStates = [
  "evidence_present",
  "quote_request_available",
  "provider_terms_required",
  "unavailable",
] as const;

export const quoteReadinessReasonCodes = [
  "exact_quote_evidence_present",
  "authoritative_quote_request_available",
  "authoritative_account_quote_unavailable",
  "provider_not_configured",
  "provider_readiness_unavailable",
] as const;

export const quoteReadinessActionCodes = [
  "review_exact_quote",
  "request_authoritative_quote",
  "provide_authoritative_quote_terms",
  "configure_provider",
] as const;

export const quoteReadinessSchema = z.object({
  state: z.enum(quoteReadinessStates),
  reasonCode: z.enum(quoteReadinessReasonCodes),
  actionCode: z.enum(quoteReadinessActionCodes),
}).strict().superRefine((readiness, context) => {
  const expected = {
    evidence_present: ["exact_quote_evidence_present", "review_exact_quote"],
    quote_request_available: ["authoritative_quote_request_available", "request_authoritative_quote"],
    provider_terms_required: ["authoritative_account_quote_unavailable", "provide_authoritative_quote_terms"],
    unavailable: readiness.reasonCode === "provider_not_configured"
      ? ["provider_not_configured", "configure_provider"]
      : ["provider_readiness_unavailable", "configure_provider"],
  } as const;
  const [reasonCode, actionCode] = expected[readiness.state];
  if (readiness.reasonCode !== reasonCode || readiness.actionCode !== actionCode) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Quote-readiness state is inconsistent" });
  }
});

export type QuoteReadiness = z.infer<typeof quoteReadinessSchema>;
