import type {
  LockedMaximumQuoteRequest,
  MaximumQuoteOutcome,
  MaximumQuoteProvider,
  MaximumQuoteUnavailableReasonCode,
} from "../planning/maximum-quote-provider-contracts";
import { isLockedMaximumQuoteRequest } from "../planning/maximum-quote-provider-contracts";

export const HEYGEN_MAXIMUM_QUOTE_PROVIDER_KEY = "heygen" as const;

/**
 * Fail-closed until HeyGen exposes authoritative, account-specific,
 * pre-generation quote terms. This adapter intentionally has no fetch, secret
 * resolver, persistence, reservation, renderer, spend, outbox, or publisher
 * dependency. Construction and quote requests therefore cannot cause effects.
 */
export class HeyGenAccountMaximumQuoteUnavailableProvider implements MaximumQuoteProvider {
  readonly readiness = Object.freeze({
    state: "provider_terms_required" as const,
    reasonCode: "authoritative_account_quote_unavailable" as const,
  });

  async requestMaximumQuote(request: Readonly<LockedMaximumQuoteRequest>): Promise<MaximumQuoteOutcome> {
    if (!isLockedMaximumQuoteRequest(request)) return unavailable("invalid_locked_request");
    if (request.account.providerKey !== HEYGEN_MAXIMUM_QUOTE_PROVIDER_KEY) return unavailable("unsupported_provider");
    return unavailable("authoritative_account_quote_unavailable");
  }
}

const unavailable = (reasonCode: MaximumQuoteUnavailableReasonCode): MaximumQuoteOutcome => Object.freeze({
  kind: "unavailable" as const,
  providerKey: HEYGEN_MAXIMUM_QUOTE_PROVIDER_KEY,
  reasonCode,
});
