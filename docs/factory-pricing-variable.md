# Nonsecret cloud pricing metadata

The complete price catalog belongs in the normal repository variable
`FACTORY_API_PRICING_CONFIG`. The standalone Factory workflow and both Factory/Office
run steps of the Office cloud workflow explicitly expose that variable to their
processes. Repository variables are not automatically process environment values.
No secret fallback is introduced for this metadata.

This bridge does not enable a workflow, select a different model, change a grant,
renew credits, reconcile liability, modify a credential or admit paid work.
Missing or expired metadata remains a pre-dispatch hold. The shared $100 authority,
historical unknown holds, parent fence and normal release checks remain mandatory.

For Factory startup, the shared-credit configuration is first derived read-only
from the configured existing database ledger and the normal
`OFFICE_SHARED_CREDIT_PRICING_*` variables. Only if that derivation fails does the
existing private `OPENAI_SHARED_CREDIT_CONFIG_JSON` remain the fallback. Its content
is unchanged. Factory then selects one whole catalog row for the existing credit
model and passes that same profile to primary and secondary accounting. The
ordinary input/output rates must still agree at the text provider boundary.

Generic SDK/Office adapters migrate an incomplete supplied profile only when model,
ordinary rates and every explicitly supplied cache rate/input tier match the entire
catalog row. An explicit conflicting rate remains a hold. Complete supplied
profiles stay pinned. A Sol-only catalog cannot activate a different Office model.
Integration proxies remain held until their usage protocol has a reviewed adapter.

Pricing approval is separate from reconciliation and deployment. A proposed
catalog is public configuration metadata, not a provider balance or permission to
release an unknown hold. Apply it only after review of the exact model, all cache
rates, priced input-tier boundary, evidence digest and explicit expiry. No credential
or private configuration needs to be read or replaced to supply this variable.
