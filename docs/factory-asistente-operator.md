# Asistente proposal operator installation contract

This module connects existing owner-approved orders to discovery, a bounded model
patch, immutable GitHub checks, measured browser simulation and a separate model
review. It stops at a reviewed draft PR. It cannot deploy, merge, close company
orders, initialize credit grants, create schema, unpause or enable learning.

The trusted launcher must supply `DATABASE_URL`, `DEFAULT_USER_ID`,
`SOFTWARE_FACTORY_OWNER_ID` (the same owner), `AGENT_COUNCIL_STORAGE=postgres`,
`OPENAI_SHARED_CREDIT_CONFIG`, `SOFTWARE_FACTORY_OPERATOR_CONFIG`,
`OPENAI_API_KEY` and `SOFTWARE_FACTORY_GITHUB_TOKEN`. Read credentials only from
the existing private files after validating their access permissions. Clear
inherited provider/database variables and prohibit repository `.env` loading.
Never copy these credentials into the operator JSON, source tree, model context,
command arguments or logs. The launcher sets `SOFTWARE_FACTORY_ADAPTER_MODULE`
to the installed reviewed `server/software-factory-asistente-operator.ts` module.

The operator JSON is strict and noncredential. Required fields are the owner,
`projectId: "asistente"`, approved base branch, source paths, checks profile,
archive host allowlist, four stage reservations in cents, model input/output
limits, explicit order mappings and the UI workflow/harness digest profile.
`sourcePaths` allows only `server/office-role-work.ts` and
`tests/office-role-work.test.ts`; both files are mandatory. Output is capped at 4096 tokens for both independent calls. Each order mapping
binds its exact ID, revision digest, exact current base commit, reviewed finding
kind, and the fixed `office-role-work-owner-cas-v1` acceptance scenario. At most five orders may be mapped at once. Completed mappings must be explicitly
removed by the operator before adding later orders; this does not delete their
financial or queue records. Empty
mappings mean no automatically selected orders. Arbitrary orders do not acquire
an acceptance scenario from model output or keyword matching.

The existing registered project must be `asistente` in the exact Asistente
repository, with all release flags false and exactly the two measured browser
journeys `office-session-login` and `office-company-navigation`. Workflow and
harness hashes must come from the final independently reviewed revision, with
real successful workflow evidence and the observed allowed artifact hosts.
Do not guess these values or fabricate a passing report.

Run exported `preflightFactoryOperator({store})` with the same configured store
before installation. This reads configuration, existing credit state and project
registration; it performs no admission or provider call. A paused factory remains
paused. Operator startup requires enough currently available credits for one
configured build and review, valid pricing, and no unresolved credit outcome.

Admission places a stable no-provider hold covering the configured build and
review ceilings while it enqueues the exact order revision. After a confirmed
queue receipt, it settles that admission hold at zero using explicit no-provider
evidence. Actual model stages reserve separately before every paid execution;
this admission hold is not whole-job funding and there is no cross-ledger atomic
transaction. An ambiguous enqueue acknowledgement leaves its hold untouched and
marks the admission unknown, blocking new shared-credit admissions until operator
reconciliation. A settled
admission returns only its existing exact queue job; if the bounded 100-row recent-job
lookup no longer contains it (including after other work consumed that window), it fails closed instead of recreating work.

The independent UI artifact reader is a direct reviewed import, not an optional
placeholder. Integration of its code and real CI proof is required before this
module can be installed. Tests use synthetic transports and make no paid calls.
No installation or activation is performed by adding these files.


Artifact transport policy: `allowGitHubResultsAzureHosts` defaults to false. Exact
operator archive pins remain valid. When explicitly enabled, both readers also
accept `productionresultssa` + decimal shard + `.blob.core.windows.net`, only on
a fresh redirect from the authenticated artifact endpoint after identity checks.
GitHub documents `*.blob.core.windows.net` for artifact transport at
https://docs.github.com/en/actions/reference/runners/self-hosted-runners . The
narrower production-result prefix is an inference from observed shards sa6, sa7,
and sa12, not a GitHub guarantee. Other Azure accounts, explicit ports (including
443), userinfo, HTTP and fragments are rejected. Downloads carry no credentials
or cookies, follow no redirects, and retain archive/digest/evidence validation.
This opt-in does not enable general network access or change the shared budget.


## Idle process presence

The long-lived Windows loop keeps a 15-second database maintenance heartbeat while idle. Its claim/admission poll remains hourly. Presence means the process can reach its existing ledger; it does not mean a job is running, a proposal succeeded, or publication is enabled. Adapter capability flags are unchanged. Unknown work, invalid/expired leases and persistence failures stop renewed presence; shutdown clears the interval and idle wait. Maintenance calls are serialized and a lookup finishing after stop cannot start a new heartbeat. An already-issued database write can finish after stop; its timestamp expires naturally in the dashboard window. No provider requests or model usage are introduced by idle maintenance.
