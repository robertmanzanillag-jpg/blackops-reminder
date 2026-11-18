# KONG CEO software repair bridge

This bridge is separate from the Asistente-only proposal factory. Its allowlist
is company `kong` and repository `robertmanzanillag-jpg/kong-nightlife`. It does
not remove the existing factory's KONG/path denials or admit paid stages.

KONG's deterministic report loop links native Product & Reliability
`manual_followup` backlog priorities to concrete persisted `error_events` report
tasks. It marks each concrete task before network delivery, saves its signed
request in the existing `ceo_handoffs` outbox, and polls the exact BlackOps repair
key. Creative callbacks, source disappearance, admin "done", retention and
ordinary report-task verification cannot close linked software repairs.

BlackOps verifies the existing canonical HMAC envelope, scope, time window and
request digest. Its council namespace `kong-software-repairs-v1` stores durable
request/replay claims, handoff state, maker fences and verification receipts.
Identical delivery and fresh signed delivery of the same payload resolve the same
repair. Ambiguous GitHub issue creation remains `dispatch_unknown`; a delivery
retry never creates another issue.

A handoff is a private GitHub issue with an immutable canonical source marker,
SHA-256 digest, exact approved release branch/SHA, original task/error IDs and
occurrence generation. Issue creation is not model execution. The subscription
worker is a separately reviewed local consumer. Its GitHub-only mode uses an
atomic `codex/repair-claim/<digest>` ref at the approved SHA and a trusted parent
publisher; it needs no local HMAC secret. Existing claims and stale approved
bases are held, never replayed or automatically rebased. The signed worker RPC
is optional, separately flagged and fenced; its expired leases become unknown.

Owner status and signed KONG status polls reconcile the actual GitHub claim,
source-bound PR and current head. A source-owner-supplied PR number or SHA alone
cannot close work. Verification requires passing exact-head checks, independent
review and App QA, a merged commit observed on the actual KONG `/api/ready`
deployment, and an attributable production regression receipt. Unsupported
scenarios remain pending App QA; generic readiness does not prove an arbitrary
bug fixed.

The initial production catalog supports only `api_ready_contract`, and KONG may
select it only for a real `/api/ready` source error with HTTP status >=500. Its
standalone workflow/script must already exist in the approved source baseline;
both are compared byte-for-byte with the deployed version, actions are pinned,
and no candidate code is imported by the verifier. The successful artifact name
binds repair digest, deployed SHA and scenario. Other source routes use
`unsupported`; add a reviewed, issue-specific catalog scenario before granting
production closure. The maker may not edit the workflow or verifier script.

KONG independently rechecks GitHub proof, its own deployed SHA and the unchanged
source under database locks, then atomically records the callback replay claim,
source error closure, CEO task completion and handoff artifact. External reads
finish before locks. It requires its existing GitHub read credential for this
independent verification; absence leaves closure unconfirmed, never fabricated.

## Activation and evidence

Only after PRs, independent review and QA:

- KONG: `KONG_REPAIR_BRIDGE_ENABLED=true`, the existing
  `KONG_ASISTENTE_BRIDGE_URL`, `KONG_ASISTENTE_HMAC_SECRET` and HTTPS host allowlist;
  the existing report-task worker must be running. The repair URL is derived on
  that already allowlisted host. No new key is provisioned by this change.
- BlackOps: `KONG_REPAIR_BRIDGE_ENABLED=true` and
  `KONG_REPAIR_HANDOFF_ENABLED=true`, existing GitHub connector permissions for
  the private KONG repo, and the same existing HMAC secret installed by the
  operator. Missing configuration stays blocked. The website release is a
  reviewed minimal patch on its actual source, not a blind replacement by main.
- Local maker: install/enable the separately reviewed signed-in subscription
  worker only after its QA. No OpenAI API key, API request or new provider budget
  is required. Do not claim pickup until the real durable claim/receipt exists.
- Optional signed maker RPC: `KONG_REPAIR_MAKER_ENABLED=true` and explicit
  `KONG_REPAIR_WORKER_IDS`; GitHub-only local operation does not require these.
- Independent review/App QA actors are explicit nonsecret allowlists
  `KONG_REPAIR_REVIEW_ACTORS` and `KONG_REPAIR_QA_ACTORS`; missing acceptable
  evidence reports `awaiting_independent_review`. Do not fabricate approvals.

The actual shared-credit state is reported separately. `blocked_unknown_credit`
continues to block paid provider work; deterministic ingestion, investigation
and authorized subscription handoffs do not consume or release those credits.
The existing uncertain News execution is neither replayed nor cancelled.

Observe original source task/error IDs, repair key, durable queue acceptance,
actual maker claim, PR/head, independent checker, deployed commit and final
callback receipt. Aggregate counts, an avatar, a running process or an issue URL
alone are not this evidence chain. No merge or Replit deployment is performed by
the bridge; each deployment still requires explicit approval.

Rollback: disable bridge/handoff flags, stop the local consumer, then revert the
reviewed source changes. Preserve council/outbox/claim/receipt history; never
clear unknown work to obtain a green status. No new database table is required.
The bounded journal stops at capacity and has no automatic history pruning.
