# OpenAI reviewer execution

Prepared integration, not an activated production service. Responses API completed a synthetic invoice-ownership review with `gpt-6-astra`, correctly returning a blocking finding. The measured call used 237 tokens. This verifies the standalone adapter, not the persistent worker or academy promotion.

An isolated live academy pair then completed using the actual runner and Responses adapter: incumbent and candidate both scored 100 with zero errors, using 544 and 576 measured tokens respectively. The verified assessment was committed to isolated local diagnostic state; no production agent was changed and no promotion occurred. This validates one real paired assessment, not the three-day qualification schedule or a deployed replacement.

Agents API sessions failed with `internal_error` before tool execution using two models, small/default hosted environments, and no environment. All diagnostic sessions were deleted successfully. The working Responses adapter is an explicit alternate implementation, not a claim that hosted Agents API was repaired.

## Admission and accounting

The worker requires explicit `OFFICE_REVIEW_PROVIDER=openai`, `OFFICE_OPENAI_MODEL`, and a positive `OFFICE_OPENAI_MONTHLY_TOKEN_LIMIT`. There is no default spend authorization. `OPENAI_API_KEY` must belong to the intended credit-funded project. Existing API credit balance and auto-recharge remain account settings; the adapter neither purchases credits nor changes them.

Each invocation reserves prompt bytes plus its bounded output and framing allowance in the council's persistent token ledger before calling OpenAI. Uncertain requests retain their reservation across restarts and calendar months. Verified token usage replaces the reservation. Missing or malformed accounting, exhausted allocation, database errors and incomplete responses cannot produce successful execution evidence. Token limits are not USD credit balances or exact cost estimates; model prices and other project usage must be considered when setting the limit.

## Database preparation

The database inspected from the Replit editor contained `revenue_engine_state` but lacked `agent_office_cloud_jobs` and `office_agent_workers`. Two actual connections confirmed transaction advisory-lock exclusion and release on rollback. The existing cloud schema creation also passed a transaction dry run followed by rollback. The editor's app inventory is empty. Replit's separate Production Database was then inspected in read-only mode and contains the four applications shown by the published UI, with the same outdated/missing URLs. Use the production connection for activation; never assume the editor connection targets live records. These checks do not certify end-to-end store restart behavior.

`node --import tsx script/office-cloud-migrate.ts` validates schema creation then rolls it back. After verifying the intended deployment database and release review, `--apply` commits the additive cloud queue/heartbeat tables. The script never replaces council state or automatically starts a worker. Failed validation rolls back. No persistent migration has been applied during this work.

## Bounded repository-review schedule

The prepared GitHub workflow is limited to repository code reviews and reviewer qualification. It is not hosting for general business agents, chat, KONG operations or financial/social actions. It checks out only the canonical repository's default branch, has no pull-request trigger, uses pinned actions with read permissions, and exposes secrets only to the worker step. No response artifacts or private task payloads are uploaded to public workflow logs.

Activation requires reviewed code on the default branch; `OFFICE_REVIEWER_AUTOMATION_ENABLED=true`; explicit model/token-allocation variables; and the protected `OFFICE_OPENAI_API_KEY`, `OFFICE_DATABASE_URL`, and `OFFICE_OWNER_ID` secrets. These secrets and enabling variables have not been installed. Review database privilege scope before granting access to a new execution environment. Do not use broad repository administration tokens.

The schedule runs a single owner-scoped review cycle at minutes 17 and 47, with one concurrent job and a ten-minute ceiling. It does not promise immediate execution or a continuously healthy heartbeat. GitHub schedules can be delayed and public-repository schedules can be disabled after inactivity. Missing fresh evidence must remain visible as waiting/unavailable.

## Remaining release gates

Run the persistent worker on the intended database, inspect a real queued review's exact head/diff binding, then verify the next scheduled run independently. Most business roles still need role-specific integrations and representative tasks. Complete live App QA and deployment approval separately. Existing project instructions require an explicit deployment decision after the reviewed result.

The reviewer qualification profile contains nine held-out cases across three paired groups, including clean cases, multiple findings and different security boundaries. Expected answers are not sent to the model. Promotion requires sustained measured improvement across all three groups and explicit `OFFICE_REVIEW_BENCHMARK_PROMOTION_ENABLED=true`. Older simple fixtures do not qualify. A qualifying policy enters probation and retains `qualificationScope: benchmark`, including after its first successfully recorded PR execution. Execution proves that the policy ran, not that its verdict was correct or that it is superior on all production work. Training versions, comparable measurements and reasons remain recorded. The integration tests use mocked provider responses and local CAS persistence; they are not evidence of a live academy promotion.

Rollback: disable the schedule and new admissions first, reconcile in-flight/unknown requests, preserve queue, role, token and academy records, and revert the code. Never erase reservations to bypass a budget or retry uncertain work.

References: https://developers.openai.com/api/docs/guides/chatgpt-api-credits ; https://developers.openai.com/api/docs/guides/agents-api/errors ; https://docs.github.com/en/actions/concepts/billing-and-usage ; https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule
