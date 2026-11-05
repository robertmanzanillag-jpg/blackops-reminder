import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { OfficeTaskInput } from "./office-runtime";

const PR = /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/[1-9][0-9]*$/;
const taskSchema = z.object({ kind: z.enum(["claude_chat", "claude_review", "kong_audit"]), message: z.string().trim().max(16000).optional(), prUrl: z.string().regex(PR).optional(), key: z.string().uuid() }).strict().superRefine((input, ctx) => {
  if (input.kind === "claude_chat" && !input.message) ctx.addIssue({ code: "custom", path: ["message"], message: "Message required" });
  if (input.kind === "claude_review" && !input.prUrl) ctx.addIssue({ code: "custom", path: ["prUrl"], message: "PR required" });
});
const completionSchema = z.object({
  status: z.enum(["completed", "blocked", "failed"]),
  text: z.string().max(200000).optional(), sessionId: z.string().trim().min(1).max(500).optional(),
  error: z.object({ code: z.string().min(1).max(100), reason: z.string().min(1).max(1000) }).strict().optional(),
  review: z.object({ prUrl: z.string().regex(PR), headSha: z.string().regex(/^[a-f0-9]{40,64}$/i), diffSha256: z.string().regex(/^[a-f0-9]{64}$/i), verdict: z.enum(["pass", "block"]), summary: z.string().min(1).max(8000), findings: z.array(z.string().max(4000)).max(100) }).strict().optional(),
  evidence: z.unknown().optional(),
}).strict();
export type OfficeCloudCompletion = z.infer<typeof completionSchema>;
export interface OfficeCloudRun {
  id: string; key: string; kind: OfficeTaskInput["kind"]; message?: string; prUrl?: string;
  status: "pending" | "running" | "completed" | "blocked" | "failed" | "unknown";
  createdAt: string; startedAt?: string; completedAt?: string;
  workerId?: string; fence?: string; leaseExpiresAt?: string;
  result?: OfficeCloudCompletion | { status: "unknown"; error: { code: string; reason: string } };
}
export interface OfficeCloudQueryResult { rows: Record<string, unknown>[]; rowCount?: number | null }
export interface OfficeCloudClient {
  query(sql: string, parameters?: unknown[]): Promise<OfficeCloudQueryResult>;
  release(): void;
}
export interface OfficeCloudPool {
  connect(): Promise<OfficeCloudClient>;
  query(sql: string, parameters?: unknown[]): Promise<OfficeCloudQueryResult>;
}
const providerProbeSchema = z.object({
  status: z.enum(["ready", "blocked"]),
  reason: z.string().trim().min(1).max(1000),
  checkedAt: z.string().datetime({ offset: true }),
}).strict();
const capabilitiesSchema = z.object({ claude: providerProbeSchema, kong: providerProbeSchema }).strict();
export type OfficeWorkerCapabilities = z.infer<typeof capabilitiesSchema>;
export interface OfficeWorkerHeartbeat {
  workerId: string;
  lastSeenAt: string;
  capabilities?: OfficeWorkerCapabilities;
}
export class OfficeCloudStoreError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = "OfficeCloudStoreError"; }
}

// PREPARED MIGRATION ONLY. Callers must apply this in an explicitly approved
// migration step. The store never creates tables or falls back to local files.
export function createOfficeCloudSchemaSql(): string {
  return `CREATE TABLE IF NOT EXISTS agent_office_cloud_jobs (
  id uuid PRIMARY KEY,
  owner_key text NOT NULL CHECK (owner_key ~ '^[a-f0-9]{64}$'),
  idempotency_key uuid NOT NULL,
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  input jsonb NOT NULL CHECK (jsonb_typeof(input) = 'object' AND octet_length(input::text) <= 131072),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','completed','blocked','failed','unknown')),
  worker_id text,
  fence uuid,
  lease_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  result jsonb CHECK (result IS NULL OR (jsonb_typeof(result) = 'object' AND octet_length(result::text) <= 262144)),
  UNIQUE (owner_key, idempotency_key),
  CHECK (status <> 'running' OR (worker_id IS NOT NULL AND fence IS NOT NULL AND lease_expires_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS agent_office_cloud_jobs_pending_idx ON agent_office_cloud_jobs (created_at, id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS agent_office_cloud_jobs_owner_idx ON agent_office_cloud_jobs (owner_key, created_at DESC);
CREATE INDEX IF NOT EXISTS agent_office_cloud_jobs_lease_idx ON agent_office_cloud_jobs (lease_expires_at) WHERE status = 'running';
CREATE TABLE IF NOT EXISTS office_agent_workers (
  id text PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 200),
  last_seen_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  capabilities jsonb CHECK (capabilities IS NULL OR (jsonb_typeof(capabilities) = 'object' AND octet_length(capabilities::text) <= 8192))
);
ALTER TABLE office_agent_workers ADD COLUMN IF NOT EXISTS capabilities jsonb;`;
}
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const fail = (code: string, message: string): never => { throw new OfficeCloudStoreError(code, message); };
const timestamp = (value: unknown) => {
  if (!(value instanceof Date) && typeof value !== "string") return fail("INVALID_STORED_RESULT", "El registro de la nube no es verificable.");
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return fail("INVALID_STORED_RESULT", "El registro de la nube tiene una fecha invalida.");
  return date.toISOString();
};
function decode(row: Record<string, unknown>): OfficeCloudRun {
  const input = taskSchema.safeParse(row.input);
  if (!input.success || !z.string().uuid().safeParse(row.id).success || !["pending", "running", "completed", "blocked", "failed", "unknown"].includes(String(row.status))) return fail("INVALID_STORED_RESULT", "El registro de la nube no es verificable.");
  const run: OfficeCloudRun = { ...input.data, id: row.id as string, status: row.status as OfficeCloudRun["status"], createdAt: timestamp(row.created_at) };
  if (row.started_at) run.startedAt = timestamp(row.started_at);
  if (row.completed_at) run.completedAt = timestamp(row.completed_at);
  if (row.worker_id) run.workerId = String(row.worker_id);
  if (row.fence) run.fence = String(row.fence);
  if (row.lease_expires_at) run.leaseExpiresAt = timestamp(row.lease_expires_at);
  if (row.result) run.result = JSON.parse(JSON.stringify(row.result)) as OfficeCloudRun["result"];
  return run;
}
function ownerKey(userId: string): string {
  if (typeof userId !== "string" || !userId.trim() || userId.length > 1000) return fail("INVALID_OWNER", "No se pudo identificar al propietario de la tarea.");
  return hash(userId);
}
function worker(value: string): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_.:-]{1,200}$/.test(value)) return fail("INVALID_WORKER", "El identificador de ejecucion no es valido.");
  return value;
}
function capabilities(value: unknown): OfficeWorkerCapabilities {
  const parsed = capabilitiesSchema.safeParse(value);
  if (!parsed.success) return fail("INVALID_CAPABILITIES", "No se pudo verificar la capacidad del ejecutor de nube.");
  const encoded = JSON.stringify(parsed.data);
  if (Buffer.byteLength(encoded) > 8192 || /\bBearer\s+[^\s]+|-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,})/.test(encoded)) {
    return fail("INVALID_CAPABILITIES", "La evidencia de capacidad contiene datos no permitidos.");
  }
  return parsed.data;
}
function jsonResult(value: unknown): OfficeCloudCompletion {
  const parsed = completionSchema.safeParse(value);
  if (!parsed.success) return fail("INVALID_RESULT", "El resultado de ejecucion no es valido.");
  let encoded: string;
  try { encoded = JSON.stringify(parsed.data); } catch { return fail("INVALID_RESULT", "El resultado no puede guardarse como JSON."); }
  if (Buffer.byteLength(encoded) > 256 * 1024) return fail("RESULT_TOO_LARGE", "El resultado supera el limite persistente de la nube.");
  const inspect = (item: unknown, depth: number): void => {
    if (depth > 20) return fail("INVALID_RESULT", "El resultado tiene demasiados niveles.");
    if (typeof item === "string" && /\bBearer\s+[A-Za-z0-9_.~+\/-]{8,}|-----BEGIN (?:[A-Z ]*PRIVATE KEY|OPENSSH PRIVATE KEY)-----|\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|sk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,})/.test(item)) return fail("SENSITIVE_RESULT", "El resultado contiene material sensible y no se guardara.");
    if (Array.isArray(item)) { for (const child of item) inspect(child, depth + 1); }
    else if (item && typeof item === "object") for (const [key, child] of Object.entries(item)) {
      if (/^(?:authorization|password|secret|api[_-]?key|access[_-]?token|refresh[_-]?token|private[_-]?key)$/i.test(key)) return fail("SENSITIVE_RESULT", "El resultado contiene campos sensibles y no se guardara.");
      inspect(child, depth + 1);
    }
  };
  const safe = JSON.parse(encoded) as OfficeCloudCompletion;
  inspect(safe, 0);
  if (safe.status === "completed" && safe.error) return fail("INVALID_RESULT", "Una ejecucion con error no puede marcarse completada.");
  if (safe.status === "completed" && !safe.text?.trim()) return fail("INVALID_RESULT", "Una ejecucion completada necesita un resultado verificable.");
  if (safe.status !== "completed" && !safe.error) return fail("INVALID_RESULT", "Una ejecucion bloqueada o fallida necesita un motivo.");
  if (safe.review && (!safe.sessionId || (safe.review.verdict === "pass" && safe.review.findings.length))) return fail("INVALID_RESULT", "La revision no tiene evidencia de aprobacion verificable.");
  return safe;
}

export function createOfficeCloudStore(options: { pool?: OfficeCloudPool; leaseMs?: number } = {}) {
  const leaseMs = options.leaseMs ?? 5 * 60_000;
  if (!Number.isSafeInteger(leaseMs) || leaseMs < 30_000 || leaseMs > 60 * 60_000) throw new OfficeCloudStoreError("INVALID_LEASE", "El plazo de ejecucion de la nube no es valido.");
  const pool = async (): Promise<OfficeCloudPool> => {
    if (options.pool) return options.pool;
    // No connection or schema mutation happens at module import time.
    try {
      const database = await import("./db");
      const client = (database.db as unknown as { $client?: OfficeCloudPool }).$client;
      if (!client?.connect || !client.query) return fail("CLOUD_STORE_NOT_READY", "La base de datos de la oficina no esta conectada.");
      return client;
    } catch { return fail("CLOUD_STORE_NOT_READY", "La base de datos persistente de la oficina no esta disponible."); }
  };
  const guarded = async <T>(action: () => Promise<T>): Promise<T> => {
    try { return await action(); }
    catch (error) {
      if (error instanceof OfficeCloudStoreError) throw error;
      return fail("CLOUD_STORE_NOT_READY", "No se pudo verificar el registro PostgreSQL de la oficina. No se usaran archivos locales ni se repetira la ejecucion.");
    }
  };
  const transaction = async <T>(action: (client: OfficeCloudClient) => Promise<T>): Promise<T> => guarded(async () => {
    const client = await (await pool()).connect();
    try {
      await client.query("BEGIN");
      const result = await action(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally { client.release(); }
  });
  return {
    async heartbeat(workerId: string, providerCapabilities?: OfficeWorkerCapabilities): Promise<OfficeWorkerHeartbeat> {
      const workerIdSafe = worker(workerId);
      const verified = providerCapabilities === undefined ? undefined : capabilities(providerCapabilities);
      return guarded(async () => {
        const result = await (await pool()).query("/*office:heartbeat*/ INSERT INTO office_agent_workers (id,last_seen_at,capabilities) VALUES ($1,CURRENT_TIMESTAMP,$2::jsonb) ON CONFLICT (id) DO UPDATE SET last_seen_at=CURRENT_TIMESTAMP, capabilities=COALESCE(EXCLUDED.capabilities,office_agent_workers.capabilities) RETURNING id,last_seen_at,capabilities", [workerIdSafe, verified ? JSON.stringify(verified) : null]);
        if (!result.rows[0]) return fail("CLOUD_STORE_NOT_READY", "No se pudo confirmar la senal del ejecutor de nube.");
        return { workerId: String(result.rows[0].id), lastSeenAt: timestamp(result.rows[0].last_seen_at), ...(result.rows[0].capabilities ? { capabilities: capabilities(result.rows[0].capabilities) } : {}) };
      });
    },
    async getHeartbeat(): Promise<OfficeWorkerHeartbeat | undefined> {
      return guarded(async () => {
        const result = await (await pool()).query("/*office:get-heartbeat*/ SELECT id,last_seen_at,capabilities FROM office_agent_workers ORDER BY last_seen_at DESC LIMIT 1");
        return result.rows[0] ? { workerId: String(result.rows[0].id), lastSeenAt: timestamp(result.rows[0].last_seen_at), ...(result.rows[0].capabilities ? { capabilities: capabilities(result.rows[0].capabilities) } : {}) } : undefined;
      });
    },
    async submit(userId: string, input: OfficeTaskInput): Promise<OfficeCloudRun> {
      const owner = ownerKey(userId);
      const parsed = taskSchema.safeParse(input);
      if (!parsed.success) return fail("INVALID_TASK", "La tarea de la oficina no es valida.");
      const task = parsed.data;
      const canonical = JSON.stringify({ kind: task.kind, ...(task.message !== undefined ? { message: task.message } : {}), ...(task.prUrl !== undefined ? { prUrl: task.prUrl } : {}) });
      const requestHash = hash(canonical);
      return transaction(async client => {
        await client.query("/*office:owner-lock*/ SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [owner]);
        const find = () => client.query("/*office:find-key*/ SELECT * FROM agent_office_cloud_jobs WHERE owner_key = $1 AND idempotency_key = $2", [owner, task.key]);
        let existing = (await find()).rows[0];
        if (!existing) {
          const inserted = await client.query("/*office:submit*/ INSERT INTO agent_office_cloud_jobs (id, owner_key, idempotency_key, request_hash, input) VALUES ($1,$2,$3,$4,$5::jsonb) ON CONFLICT (owner_key,idempotency_key) DO NOTHING RETURNING *", [randomUUID(), owner, task.key, requestHash, JSON.stringify(task)]);
          existing = inserted.rows[0] || (await find()).rows[0];
        }
        if (!existing || existing.request_hash !== requestHash) return fail("IDEMPOTENCY_CONFLICT", "Esta clave ya pertenece a una solicitud diferente.");
        return decode(existing);
      });
    },
    async claim(workerId: string): Promise<OfficeCloudRun | undefined> {
      const workerIdSafe = worker(workerId);
      return transaction(async client => {
        // The durable running state is committed before the caller may invoke
        // Claude. A crash after claim is uncertain and never auto-retried.
        const claimed = await client.query(`/*office:claim*/ WITH candidate AS (
 SELECT id FROM agent_office_cloud_jobs WHERE status = 'pending' ORDER BY created_at, id FOR UPDATE SKIP LOCKED LIMIT 1
) UPDATE agent_office_cloud_jobs job SET status='running', worker_id=$1, fence=$2, lease_expires_at=CURRENT_TIMESTAMP + ($3 * interval '1 millisecond'), started_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP
FROM candidate WHERE job.id=candidate.id AND job.status='pending' RETURNING job.*`, [workerIdSafe, randomUUID(), leaseMs]);
        return claimed.rows[0] ? decode(claimed.rows[0]) : undefined;
      });
    },
    async complete(runId: string, workerId: string, fence: string, result: OfficeCloudCompletion): Promise<OfficeCloudRun | undefined> {
      if (!z.string().uuid().safeParse(runId).success || !z.string().uuid().safeParse(fence).success) return fail("INVALID_FENCE", "La referencia de ejecucion no es valida.");
      const workerIdSafe = worker(workerId);
      const safe = jsonResult(result);
      return guarded(async () => {
        const completed = await (await pool()).query(`/*office:complete*/ UPDATE agent_office_cloud_jobs SET status=$4, result=$5::jsonb, completed_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP
WHERE id=$1 AND worker_id=$2 AND fence=$3 AND status='running' AND lease_expires_at > CURRENT_TIMESTAMP RETURNING *`, [runId, workerIdSafe, fence, safe.status, JSON.stringify(safe)]);
        return completed.rows[0] ? decode(completed.rows[0]) : undefined;
      });
    },
    async list(userId: string): Promise<OfficeCloudRun[]> {
      const owner = ownerKey(userId);
      return guarded(async () => (await (await pool()).query("/*office:list*/ SELECT * FROM agent_office_cloud_jobs WHERE owner_key=$1 ORDER BY created_at DESC, id DESC LIMIT 200", [owner])).rows.map(decode));
    },
    async markExpiredUnknown(): Promise<number> {
      return guarded(async () => {
        const result = await (await pool()).query(`/*office:expire*/ UPDATE agent_office_cloud_jobs SET status='unknown', completed_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP,
result='{"status":"unknown","error":{"code":"LEASE_EXPIRED","reason":"La ejecucion perdio su confirmacion. Requiere conciliacion; no se reintentara automaticamente."}}'::jsonb
WHERE status='running' AND lease_expires_at <= CURRENT_TIMESTAMP RETURNING id`);
        return result.rowCount ?? result.rows.length;
      });
    },
  };
}

export const officeCloudStore = createOfficeCloudStore();
