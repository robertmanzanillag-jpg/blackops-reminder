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
