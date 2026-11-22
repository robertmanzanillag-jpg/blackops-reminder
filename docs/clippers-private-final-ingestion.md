# Private reviewed-final ingestion

This adds a private input path for real local MP4 finals to the owner-reviewed lane. It does not download raw sources, create owner permissions, activate a timer, deploy code or publish posts. The existing native Metricool URL class remains supported. No public or temporary BlackRoom media relay is reused.

## Owner flow and trust boundary

1. Prepare the reviewed metadata proposal first, including exact final SHA/size, independent source/crop/audio/caption QA, rights evidence, destination and timing. Select the explicit media class `storageKind: private_council_v1`, with `privateFinalRef: final-<exact final SHA256>`. This content identifier is not an access token. The owner namespace, authenticated session and approved manifest digest supply authority.
2. The existing owner-only, same-origin review desk stores that proposal/digest. The selected local file must match its SHA and size before the browser sends any bytes. It then reserves capacity, uploads bounded ordered chunks and finalizes the whole-file hash. No caller-supplied path, storage namespace or source URL is accepted.
3. Preview uses the actual private owner-authenticated range endpoint. It is never added to the public API bypass and has no token in its URL. The owner reviews that exact file before explicit approval. The configured `PUBLIC_APP_URL` is authoritative; an unrelated preview host is rejected rather than implicitly trusted.
4. Finalization proves byte identity only. Before an owner approval, the server separately seals/probes the private file and verifies either zero audio or the independently reconstructed, specifically licensed instrumental. Technical inspection is not an owner grant or a canonical renderer/evaluator ACK. Only the existing digest-bound rights/independent-QA/source/membership attestations create the approval wrapper. Dispatch repeats byte/probe/audio and current-rights checks before staging/writing.

Owner upload/finalize and preview transfers are bounded. Codec inspection has one in-flight owner admission and keeps its permit until the process settles, including client disconnection. Failed technical checks leave the proposal unapproved and private. Actual deployment must verify ffmpeg/ffprobe and existing DB/provider/staging capability; availability and hosting cost are not inferred from local tests.

## Existing durable KV and active storage cap

Bytes use separate owner-hashed/content-addressed council KV namespaces, through the existing database service identity. No DDL, credentials, storage purchase or global streamer snapshot expansion is required. Metadata/report envelopes stay below 262144 bytes; each byte row contains at most a 2 MiB chunk encoded in base64. A file is at most 32 MiB. The atomic owner index reserves declared decoded bytes upfront, including incomplete and unknown work.

The limit is **64 MiB active across all days** with no midnight reset. It is a storage capacity limit, not an AI spend allowance or daily admission-volume quota. Verified safe reuse after retirement is allowed. Base64 can occupy roughly 85.3 MiB before JSON overhead at the decoded cap; database MVCC/TOAST history and vacuum behavior can affect actual disk consumption. The cap must not be represented as a guaranteed physical disk bill or a full week's capacity.

Same-SHA shared proposals use one canonical owner file and do not double-count bytes. Every proposal digest is a separate reference. Immutable chunk hashes and exact indexes make retries idempotent; conflicting bytes, out-of-order chunks, wrong whole hashes and cross-owner references fail closed. A finalized file cannot be changed. A retired file can be resealed only in a new isolated chunk epoch while preserving prior metadata history; source/publication claims still prevent replay.

## Retirement and unknown outcomes

Bytes are retired only when **every** current reference is irreversibly unused/revoked before a provider request, or has a known exact native-copy proof bound to final SHA/size. A missing marker is not evidence of no external write. Unknown provider requests, public staging outcomes, external-delivery markers and missing owner records retain bytes and capacity.

Cleanup transactionally fences the owner index and file epoch before tombstoning every possible chunk, including a late unacknowledged chunk. A reservation lost before metadata commit uses the same all-reference proof and epoch tombstones; it is never repaired by a blind quota refund. Metadata history, approved/revoked owner records and shared source claims are retained. Incomplete cleanup keeps its reservation and can resume.

Bounded provider reconciliation calls only read operations for an already known exact ID/UUID/content/slot/native byte hash. It can recognize a correct paid schedule or an explicit nonpublishing draft and release verified copies. It never recreates, reschedules, cancels or guesses a provider identity. Missing paid disclosure keeps the commercial lane paused. No cancellation monitor is installed. The owner can also request safe private cleanup while publishing is off; that request cannot remove active/unknown/shared references.

## Validation and remaining activation work

Tests use an ephemeral in-memory KV and localhost owner browser; actual local final files can additionally exercise private chunk/seal/full licensed PCM paths without redistribution into the repository. Provider read-backs/staging/schedules in those tests are mocked and are not production receipts or grants. No actual file is claimed uploaded to production merely because these tests pass.

Suitable cadence and the separately reviewed owner-hour-window opt-in remain a follow-up. Exact mode is unchanged. Actual membership evidence/lease renewal and primary campaign state are required at dispatch; a draft future window is not scheduled coverage. Activation needs the reviewed code, host capability evidence and final owner publish approval.

Rollback: disable the new input/dispatcher paths and preserve private bytes and index entries for unknown requests. Retire only through the same proof/fence process. Do not delete publication/source history or infer a failed send from elapsed time.
