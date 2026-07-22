import type {
  MaximumQuoteProvider,
  MaximumQuoteProviderReadiness,
  MaximumQuoteReadinessResolver,
} from "./maximum-quote-provider-contracts";
import type { QuoteReadiness } from "../../../shared/ai-media-studio-quote-readiness";

const unavailable = Object.freeze({
  state: "unavailable" as const,
  reasonCode: "provider_readiness_unavailable" as const,
});

/** Server-only capability registry. It never requests a quote or performs provider I/O. */
export class MaximumQuoteReadinessRegistry implements MaximumQuoteReadinessResolver {
  private readonly providers: ReadonlyMap<string, MaximumQuoteProvider>;

  constructor(entries: ReadonlyArray<readonly [string, MaximumQuoteProvider]>) {
    this.providers = new Map(entries);
  }

  resolve(providerKey: string): MaximumQuoteProviderReadiness {
    return this.providers.get(providerKey)?.readiness ?? unavailable;
  }
}

export const unavailableMaximumQuoteReadinessResolver: MaximumQuoteReadinessResolver = Object.freeze({
  resolve: () => unavailable,
});

export function projectMaximumQuoteReadiness(input: Readonly<{
  exactEvidencePresent: boolean;
  providerConfigured: boolean;
  providerKey: string;
  resolver: MaximumQuoteReadinessResolver;
}>): QuoteReadiness {
  if (input.exactEvidencePresent) return {
    state: "evidence_present", reasonCode: "exact_quote_evidence_present", actionCode: "review_exact_quote",
  };
  if (!input.providerConfigured) return {
    state: "unavailable", reasonCode: "provider_not_configured", actionCode: "configure_provider",
  };
  const capability = input.resolver.resolve(input.providerKey);
  if (capability.state === "quote_request_available") return {
    ...capability, actionCode: "request_authoritative_quote",
  };
  if (capability.state === "provider_terms_required") return {
    ...capability, actionCode: "provide_authoritative_quote_terms",
  };
  return { ...capability, actionCode: "configure_provider" };
}
