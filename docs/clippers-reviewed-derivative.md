# Owner-reviewed final-file lane

A reviewed derivative does not license its raw Twitch source. The existing raw whole-source gate and discovery are unchanged. This lane consumes the exact final file already reviewed externally, with truthful origin `owner_authorized_external_review`; it does not manufacture canonical renderer/evaluator ACKs. No production approvals, configuration or social writes are part of this change. The existing publisher enabled/kill/dry-run switches still govern this lane.

## Owner admission

The office Clippers footer links to “Revisar clips autorizados” at `/api/clippers/reviewed-derivatives/review`. Existing authenticated app sessions apply; only the configured owner may access it. Loading the desk has no mutation. A prepared JSON proposal file can be loaded there or proposed through the same-origin owner API. It cannot contain an approval wrapper or raw whole-source grant. Proposal IDs cannot overwrite an existing record.

Review the exact video preview, caption, destination, slot, holder and independent evidence before approving. The operator label records who exercised the owner's authority; it does not claim Robert personally watched QA. Approval requires explicit rights, external QA, source baseline and membership attestations and the exact stored manifest digest. The server stamps the authenticated principal and approval method in the transaction. A revoked proposal cannot be reapproved; a new reviewed proposal is necessary. Maximum 500 stored records, a 5 MiB total state budget and 256 KB per proposal bound state growth; full storage holds admission rather than deleting prior evidence.

The contract supports exact Twitch clip and VOD/context URLs, physical source file hashes and relative intervals, and static or bounded linear-clamped camera crops. Original dynamic expressions are preserved as metadata and never executed. It binds original source ID/URL/hash/interval, crop, final media hash/size/format/duration, exact caption, independent maker/checker and report hash, retained visual/audio rights and required credit, destination, exact slot/window and expiration. QA report references/hashes are owner attestations to existing external evidence, not cryptographic proof that another reviewer signed them. No JSON import establishes its own owner authority.

## Audio profiles

Muted final files must have zero audio streams. The separately licensed instrumental profile supports only the reviewed official **Monkeys Spinning Monkeys** MP3, its exact SHA-256/size and official Incompetech/CC BY 4.0 URLs and attribution. It never licenses Twitch's mixed audio. A bounded official-track fetch plus full independent AAC-pipeline reconstruction must produce exactly the same decoded PCM bytes as the final and independent QA report. This technical check does not claim human audition. Other tracks/pipelines fail closed until a separately reviewed extension.

The actual five externally reviewed Lacy finals pass that exact PCM reconstruction locally. This is not an operational rights grant for them. Their campaign, membership, baseline mappings, destination and exact future slots must separately pass owner admission and dispatch gates.

## Campaign and membership validity

Internal approval expiration is distinct from license end. Conditional campaign records need a recent authenticated Joined observation reference/hash and explicit owner operational lease, at most 24 hours after that observation. The exact slot and internal expiration must fit inside that lease. The server does not infer membership from a public page or renew it automatically.

The fixed public campaign verifier checks the exact primary ContentRewards UUID/query, active backend status, visible acceptance, no-store/no positive cache age and fresh HTTP/query dates. It does **not** independently prove membership, rights scope or real-world marathon ending. The owner's bounded operational-condition attestation remains necessary; missing/stale evidence holds. Conditional dispatch is just in time: the exact approved slot must be 1–5 minutes away at every gate, including the final write fence. More distant proposals remain held without retiming; a suitable dispatcher cadence must separately be configured and verified before autonomous conditional delivery is claimed. This change does not install a continuous cancellation monitor for posts already scheduled in Metricool. Revocation after scheduling requires owner reconciliation/takedown of that known post; it is never resent automatically.

## Manual/native source baseline

Each proposal includes a digest-bound, owner-attributed original-source mapping for every planner row in its baseline window, including held drafts, errors and uncertain rows across all allowlisted brands/networks. The window starts at least a day before the evidenced earliest possible source footage and extends at least a day past the proposed slot (maximum 31 days). The owner must have verified that source-origin evidence; a recent Twitch clip creation date alone does not prove that the footage first existed then.

At dispatch, a complete fresh provider calendar read must exactly match actual ID, UUID, account/network, date, caption hash and native media URL. Each native media file's exact hash/size is read back. Unmapped/changed/ambiguous/missing rows hold; captions never infer source provenance. Existing known cloud receipts can supply their own source reservation only when their current exact provider identity/content/media/slot and recorded hash/size match. No mapping grants rights to the historical post.

GraphQL offset estimates are not verified start anchors. Unverified anchors reserve the entire VOD conservatively across different physical files. Only exact, disjoint intervals of the same independently reviewed physical file hash can establish nonoverlap without an absolute anchor. A second file cannot borrow that exception.

Mapped sources and the new original-source interval/file are reserved in the existing shared media ledger. Other pipelines see the same reservation. Unknown writes remain reserved; the runner never retries them. Derivative claims persist separately from the raw post history so its trim/reconciliation cannot erase them. Registry/ledger capacity is bounded with holds, without trimming uncertain reservations.

## Dispatch and cleanup

The cloud CLI runs this separate lane under the existing publication switches. It downloads the approved native final with redirects disabled and strict bounded bytes, seals private local files, probes format/duration/audio, and verifies licensed audio when applicable. It never downloads/renders the raw source. Only then can it stage a controlled `rdv-` release asset and run fresh per-account quota/duplicate checks.

The Metricool adapter invokes the final fence after its last identity network read and immediately before the actual create request. That fence revalidates current owner approval, prohibited policy/takedowns, destination hold, exact file bytes, campaign/lease and shared original-source claims, then durably records pending write. No network I/O occurs inside that state transaction. Claim-bound staging names and persisted upload intents allow interrupted uploads to be found and removed; an active ten-minute pre-write lease protects in-flight staging from another run. Cleanup failures remain held with their reservation rather than being overwritten. The provider operation and database transaction cannot be globally atomic; an owner action after the last fence is handled by reconciliation, never by pretending the external write did not happen.

Revoked/denied unused controlled staging is removed; uncertain/known scheduled references remain protected until copy/reconciliation. Successful native copies are hash checked before controlled staging deletion. A native upstream CDN copy is distinct from the controlled release asset and cannot be removed by local cleanup. A provider ambiguity keeps the exact pending claim and staging and never resends. A process interruption before the write can leave a conservative pending-stage hold that needs review; it cannot manufacture extra capacity.

Rollback: revert the PR while leaving publishing disabled. Existing owner records and unknown/scheduled claims must remain in state for reconciliation. No activation or migration is required to adopt the code.

The authoritative derivative calendar read follows the [official Metricool scheduler contract](https://app.metricool.com/resources/apidocs/index.html) without the undocumented `integrationSource` read parameter. This does not claim that the parameter was proven to filter; known native/UI rows still need operational read-back comparison before activation. Legacy raw readers are unchanged.
