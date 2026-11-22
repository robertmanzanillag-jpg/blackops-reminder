# Factory private configuration recovery

The scheduled factory runs in `office-worker-cloud.yml` (`factory-once`). The separate
`software-factory-cloud.yml` is a manual fallback. A green office run outside the factory's
two-hour window does not prove the factory executed; inspect the `factory-once` job.

The 22 November 2026 08:15 UTC run failed during private configuration installation, before
factory execution. The shared credit configuration was successfully derived from the configured
ledger. The subsequent JSON syntax check failed. The operator secret is therefore the likely
invalid input; do not infer a missing API key or initialize another credit grant.

The syntax preflight now emits only `FACTORY_SHARED_CREDIT_CONFIG_INVALID` or
`FACTORY_OPERATOR_CONFIG_INVALID`. It never prints JSON parser exceptions, configuration bytes
or paths. The existing strict runtime schema remains authoritative for permissions, reviewed
workflow hashes, the owner, budgets and order mappings. Passing syntax is not readiness.

## Owner action

1. Open repository **Settings → Secrets and variables → Actions**:
   https://github.com/robertmanzanillag-jpg/blackops-reminder/settings/secrets/actions
2. For `FACTORY_OPERATOR_CONFIG_INVALID`, update only `SOFTWARE_FACTORY_OPERATOR_CONFIG_JSON`
   with the complete, previously reviewed noncredential operator JSON document. Do not paste
   an API key, shell command, filename, Markdown fences or multiple concatenated JSON documents.
   Do not send the value through chat. GitHub cannot reveal the previous secret value.
3. If the reviewed document is unavailable, recover it from the operator's approved private
   installation/backup first. The synthetic example in `factory-asistente-operator.md` is a
   schema illustration, not an approved production configuration. Do not guess the owner,
   workflow/artifact hashes, archive hosts, limits, orders or admission timestamp.
4. Validate the recovered document against `validateAsistenteOperatorConfig`, and compare its
   pinned workflow/harness digests with the reviewed revision before replacing the secret.
5. Only after replacement and readiness review, run **Office worker (cloud)** with target
   `factory`, or wait for its normal window. Inspect `factory-once` through configuration,
   execution and cleanup; reconcile uncertain work against existing receipts before retrying.

No login code is required by this repair unless GitHub itself asks for account verification.
Complete that verification only on GitHub. This fix neither edits credentials nor admits work,
merges/deploys code, changes limits, replays uncertain jobs or enables a publisher.
