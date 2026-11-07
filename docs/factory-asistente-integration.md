# Asistente is the factory's target

The owner clarified on 2026-11-06 that the factory is the software engineering
function of the existing Asistente agent company. The static Pages pilot is a
release/recovery proof, not a replacement product or a request to create another app.
Use existing OpenAI credits only, no payments or top-ups, and exclude Kong.

## Implemented connection, not yet activated

`POST /api/software-factory/company-orders` accepts an existing main-company order
and registered Asistente project. Authentication must establish the actual owner;
same-origin and strict input checks run before any reader or admission callback.
The route returns 503 unless a trusted credit-limited admission function is installed.
It never falls back to the generic $100 monthly enqueue function.

`companyOrderJob` creates a stable private queue reference to the order and its
content revision. It excludes closed, non-engineering, Kong-assigned and explicitly
Kong-related orders. It does not copy order text into GitHub issues or close orders.
`createCompanyOrderDiscovery` re-reads the original order, verifies its identity and
revision, resolves the exact repository head and requires trusted, zero-cost QA to
identify a real acceptance/regression scenario. The pipeline requires a permanent
test for that scenario, including when classification is an improvement.

## Remaining activation requirements

Integration branch `codex/asistente-factory-integration` is based on office commit
`049a0510e88b75ddc5df018c489ec6dda2b327c3`. It transfers only factory files and adds
route registration, the Office panel and worker build output. It preserves current
council/company/Radio/Kong source. The other Office chat is finishing Radio recovery
and publication; coordinate its final revision before applying this integration.
Local validation: 19 focused tests, panel browser test, full TypeScript no-emit check,
and route/worker bundle compilation passed. None of these activates the executor.

- Reconcile the actual Replit source with this branch before integrating. Live
  terminal history showed a newer editor commit `580d1ef227e18dd7e7f5aa2f21b7449edeb72651`
  on `codex/office-radio-reviewed-dfe5bb1` and a publication completed during this
  work. Its upstream `codex/office-integrated-repair-20261106` was fetched at
  `5f25d29`; council/company source differs and factory modules are absent there.
  Do not overwrite the concurrent office changes with this branch.
- Bind the owner-specific council reader and a guarded admission operation to the
  SAME encrypted ledger, verified credit grant/expiry and executor used for work.
  This module does not establish an independent allowance or renew credits.
- Install a real Asistente builder/checker with access to its repository. The
  deployed pilot token/client and text-only builder cannot do this.
- Verify isolated Asistente QA, exact-version publication, recovery and three
  rehearsal cycles. Pilot evidence does not qualify Asistente for automatic release.
- Close company orders only after verified production evidence tied to the order,
  owner, project, commit and complete job chain. Generic automation success is not
  sufficient. This change deliberately does not add a completion adapter.

No new deployment, API charge, account credential, payment method, reload, or Kong
change is part of this integration code. It is not proof of autonomous operation.


## Shared-credit executor integration (2026-11-06)

PR 331 merged into the Office integration branch at `2213f03`; this is not a
Replit publication. The subsequent executor branch adds an explicit Asistente
repository client and a build-to-draft-PR composition. It verifies exact source,
checks immutable workflow identity and test results, and permits candidate writes
only to operator-selected leaf paths. Paths alone cannot establish isolation from
Kong: shared-module effects still require independent content/risk review. It
cannot update base branches, merge, deploy or claim that an order is completed.

Office and factory can now use ONE micro-USD ledger in a separate namespace of
the existing PostgreSQL council table. Provisioning and grant initialization are
explicit operator steps, never startup/recovery behavior. An immutable verified
grant has an expiry; neither the calendar nor a restart refills it. Unknown
provider outcomes retain their entire reservation and stop new admissions.
Every model transport rechecks the credit window and receives a bounded abort
signal. Aborting transport is not proof that provider-side execution stopped.

`OPENAI_SHARED_CREDIT_CONFIG` selects an absolute operator-owned JSON file with
`grant` and `pricing`; it contains no credential. With this setting (or
`OPENAI_SHARED_CREDITS_REQUIRED=true`), Office execution fails closed if the shared
ledger is unavailable. The loader never creates a balance. Office review and
academy calls use stable assignment/phase identities; the existing token ledger
remains a secondary limit. Verified terminal usage is accounted even if the
answer is incomplete; active/unknown provider statuses keep their holds.
The factory adapter receives the same ledger explicitly. The runtime settings
have NOT been written to the active worker.

Independent review and controlled tests cover source-to-draft-PR, prior Office
spend reducing factory credit, duplicate calls, lost commit acknowledgments,
JSONB key ordering, expiry between counting and generation, nonterminal responses
and uncertain usage. These tests use simulated transports, not live releases.

Current host observation: the existing Windows Office task is running with
five-minute recovery triggers. It depends on this PC remaining awake and online.
The worker has its existing OpenAI/database access but no GitHub credential;
Codex's interactive GitHub connector is not unattended worker access. No new
credential was installed. Exact-version Replit deployment/recovery remains an
uninstalled adapter and must be proven separately before automatic release.

Operator rollout: reconcile the other Office chat's branch, pass CI/review, bind
a narrowly scoped repository credential, verify current credit and pending usage,
provision ONE ledger, update the reviewed worker configuration, then demonstrate
real order-to-reviewed-PR execution. Keep publication disabled until Asistente's
own release/recovery rehearsals pass. Stop admissions before rollback; preserve
all ledger rows and unknown reservations. Do not reset financial state when
reverting code. No payment details, recharge, extra hosting or Kong changes are
introduced by this work.
