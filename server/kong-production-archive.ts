import { createHash } from "node:crypto";
import type { Asset, Job } from "./kong-autopilot-core";
import type { ProductionJob, ProductionState } from "./kong-production-pipeline";

export interface ProductionArchiveRecord {
  archiveId: string; jobId: string;
  payload: { version: 1; job: ProductionJob; assets: Asset[]; errors: ProductionState["errors"] };
}
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
// Stable object ordering also makes retry IDs insensitive to JSONB key ordering.
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
    .filter(([, v]) => v !== undefined).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  return JSON.stringify(value);
}

/** Nonmutating plan; terminal jobs only. Unresolved scheduler intents protect
 * their assets even if their publication timestamp has already passed. */
export function planProductionArchive(production: ProductionState, schedulerJobs: Job[], now = new Date()) {
  const protectedIds = new Set(schedulerJobs.filter(j => ["planned", "submitting", "uncertain"].includes(j.state)).map(j => j.asset.id));
  const protectedHashes = new Set(schedulerJobs.filter(j => ["planned", "submitting", "uncertain"].includes(j.state)).map(j => j.asset.sha256));
  const cutoff = +now - 30 * 86400_000;
  const eligible = production.jobs.filter(job => ["ready", "blocked"].includes(job.stage)
    && Number.isFinite(Date.parse(job.updatedAt)) && Date.parse(job.updatedAt) < cutoff
    && !protectedIds.has(job.id) && !(job.artifact && protectedHashes.has(job.artifact.sha256))
    && !production.assets.some(a => a.id === job.id && protectedHashes.has(a.sha256)));
  const ids = new Set(eligible.map(job => job.id));
  const records: ProductionArchiveRecord[] = eligible.map(job => {
    const payload = clone({ version: 1 as const, job, assets: production.assets.filter(a => a.id === job.id), errors: production.errors.filter(e => e.jobId === job.id) });
    return { archiveId: createHash("sha256").update(canonical(payload)).digest("hex"), jobId: job.id, payload };
  });
  const remaining = clone(production);
  remaining.jobs = remaining.jobs.filter(job => !ids.has(job.id));
  remaining.assets = remaining.assets.filter(asset => !ids.has(asset.id) || protectedIds.has(asset.id) || protectedHashes.has(asset.sha256));
  // Error history and every source snapshot inside the archive remain intact.
  return { records, remaining };
}

/** archive must durably append all records before saveActive trims anything.
 * If either call fails the caller reloads durable state. Repeated appends use
 * immutable payload hashes, so a crash between these writes is safe. */
export async function archiveProductionHistory(production: ProductionState, schedulerJobs: Job[], deps: {
  archive(records: ProductionArchiveRecord[]): Promise<void>;
  saveActive(state: ProductionState): Promise<void>;
}, now = new Date()): Promise<{ state: ProductionState; archived: number }> {
  const plan = planProductionArchive(production, schedulerJobs, now);
  if (!plan.records.length) return { state: production, archived: 0 };
  await deps.archive(plan.records);
  await deps.saveActive(plan.remaining);
  return { state: plan.remaining, archived: plan.records.length };
}

export interface ArchiveQuery { query(sql: string, values?: unknown[]): Promise<unknown>; }
/** Caller owns the existing PG advisory lease. No UPDATE or DELETE is issued. */
export async function appendProductionArchive(db: ArchiveQuery, records: ProductionArchiveRecord[]) {
  if (!records.length) return;
  await db.query("CREATE TABLE IF NOT EXISTS kong_production_archive (archive_id text PRIMARY KEY, job_id text NOT NULL, payload jsonb NOT NULL, archived_at timestamptz NOT NULL DEFAULT now())");
  for (const record of records) {
    await db.query("INSERT INTO kong_production_archive(archive_id,job_id,payload) VALUES($1,$2,$3::jsonb) ON CONFLICT(archive_id) DO NOTHING",
      [record.archiveId, record.jobId, JSON.stringify(record.payload)]);
  }
}
