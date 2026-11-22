# Fence the legacy Mac Metricool writer

Current main assigns the four Clippers Metricool brands to the cloud writer. An old Mac
runtime from November18 lacks that boundary and can still schedule through its two installed
adapters. Do not synchronize the whole dirty runtime or replace the workspace to repair this.

`script/clippers-install-local-write-fence.mjs` backports only those write refusals to the exact
observed bytes of `clippers-portfolio-metricool.mjs` and `clippers-metricool-autopilot.mjs`, plus
the hash-pinned shared guard from current main. The old runtime has no Mac ledger guard, so this
tool does not introduce a ledger or its unrelated dependencies. All grants, receipts, unknown
outcomes, captions and old adapter behavior outside this boundary remain byte-for-byte intact.

This is a local-only backport: it deliberately passes an empty environment to the shared guard,
so inherited cloud or override flags cannot reactivate the Mac writer. Brands6431685,6431687,
6591612,6595747 are blocked. KONG and BlackRoom are not claimed or assigned to this publisher.

1. Create a plan using `--plan RUNTIME_ROOT NEW_PLAN_FILE`. This reads code, checks exact input
   hashes and writes only the new plan file. It changes no runtime file or scheduler.
2. Review the three before/after hashes, run the offline adapter tests, and stop/drain any active
   Clippers process through the owning operator. A loaded Node module keeps its old code until
   that process exits. This tool neither stops nor starts jobs.
3. Only after independent review and operator coordination, use
   `--apply RUNTIME_ROOT PLAN_FILE NEW_BACKUP_DIRECTORY --quiesced`. The backup directory must
   not exist and must lie outside the runtime tree. Its parent must already be owner-controlled.
   The explicit quiescence acknowledgement is required, not a process-liveness assertion by the tool.

Apply rechecks all before hashes under an exclusive maintenance lock, stores unchanged originals
and the plan in an owner-only backup, installs the dependency first, then replaces each adapter
using a same-directory rename and verifies its digest. It writes `applied.json` only after all
three readbacks pass. Any mismatched bytes, symlink, concurrent change or reused backup fails
closed. A partial filesystem failure is not an applied receipt: inspect the backup before recovery.

Rollback is an operator action while writers are stopped: restore the exact original adapter
bytes from that backup. Remove the new shared guard only if no installed module imports it.
Do not restore or reset the whole checkout. No workspace, credentials, LaunchAgent plist, media,
provider call, database, publishing permission, ledger or cloud setting is changed by this tool.
