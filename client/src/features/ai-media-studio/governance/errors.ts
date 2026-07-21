const governanceReasonMessages = {
  profile_missing: "Create a governance profile for this influencer.",
  profile_revoked: "Create a new governance profile because the current profile is revoked.",
  profile_not_yet_valid: "The governance profile is not valid yet.",
  profile_expired: "Renew the expired governance profile.",
  avatar_mismatch: "The approved avatar no longer matches the influencer.",
  voice_mismatch: "The approved voice no longer matches the influencer.",
  use_not_allowed: "The governance profile does not allow this use.",
  territory_not_allowed: "The governance profile does not cover the required territory.",
  required_brand_term_missing: "Add the brand terms required by the governance profile.",
  prohibited_brand_term_present: "Remove content prohibited by the governance profile.",
  quality_review_missing: "Complete a quality review for this exact video.",
  quality_review_not_approved: "Submit a new quality review with an approved decision.",
  quality_review_checksum_mismatch: "Review the current immutable version of this video.",
} as const;

type GovernanceReason = keyof typeof governanceReasonMessages;

function isGovernanceReason(value: unknown): value is GovernanceReason {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(governanceReasonMessages, value);
}

export function actionableApiError(body: unknown, fallback: string): string {
  if (!body || typeof body !== "object") return fallback;
  const candidate = body as { error?: unknown; message?: unknown; code?: unknown; reasons?: unknown };
  if (candidate.code === "GOVERNANCE_GATE_DENIED" && Array.isArray(candidate.reasons)) {
    const messages = Array.from(new Set(candidate.reasons.filter(isGovernanceReason).map((reason) => governanceReasonMessages[reason])));
    if (messages.length) return messages.join(" ");
  }
  if (typeof candidate.message === "string" && candidate.message) return candidate.message;
  if (typeof candidate.error === "string" && candidate.error) return candidate.error;
  return fallback;
}
