import { performance } from "node:perf_hooks";
import { Pool, type PoolClient, type PoolConfig } from "pg";

const DEFAULT_CONNECTION_TIMEOUT_MS = 10_000;
const SLOW_ACQUISITION_MS = 1_000;

export function resolveDatabasePoolSettings(env: NodeJS.ProcessEnv = process.env): PoolConfig {
  const raw = env.DB_CONNECTION_TIMEOUT_MS?.trim();
  const connectionTimeoutMillis = raw ? Number(raw) : DEFAULT_CONNECTION_TIMEOUT_MS;
  if (raw && (!/^\d+$/.test(raw) || !Number.isSafeInteger(connectionTimeoutMillis)
    || connectionTimeoutMillis < 1 || connectionTimeoutMillis > 120_000)) {
    throw new Error("DB_CONNECTION_TIMEOUT_MS must be an integer from 1 to 120000.");
  }

  // Bounds both opening/authenticating a connection and waiting for a free client.
  // A sleeping database may need more than 10s to wake; operators can raise the
  // bound without disabling it. Pool size and idle lifetime retain pg's defaults.
  return { connectionTimeoutMillis };
}

export function summarizeDatabaseError(error: unknown): { reason: string; code?: string } {
  const candidate = error && typeof error === "object" ? error as { code?: unknown; message?: unknown; cause?: unknown } : {};
  const code = typeof candidate.code === "string" && (
    /^(?:[0-9][0-9A-Z]|[A-Z][0-9]|HV|XX)[0-9A-Z]{3}$/.test(candidate.code)
    || ["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "EHOSTUNREACH", "EPIPE"].includes(candidate.code)
  ) ? candidate.code : undefined;
  const message = typeof candidate.message === "string" ? candidate.message : "";
  const reason = /timeout|timed out/i.test(message) || code === "ETIMEDOUT" ? "connection_timeout"
    : code?.startsWith("28") ? "authentication_error"
    : code?.startsWith("08") || code?.startsWith("E") ? "connection_error"
    : code ? "database_error" : "unknown_error";
  // Never return messages, causes, SQL, connection options, or client objects.
  return { reason, ...(code ? { code } : {}) };
}

export interface DatabasePoolCounts {
  total: number;
  idle: number;
  waiting: number;
}

export function databasePoolCounts(pool: Pick<Pool, "totalCount" | "idleCount" | "waitingCount">): DatabasePoolCounts {
  return { total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount };
}

export interface DatabasePoolEvent {
  pool: "application";
  event: "acquisition_failed" | "acquisition_slow" | "idle_error";
  durationMs?: number;
  counts: DatabasePoolCounts;
  countsAtStart?: DatabasePoolCounts;
  reason?: string;
  code?: string;
}

type ConnectCallback = (error: Error | undefined, client: PoolClient | undefined, release: (error?: any) => void) => void;
type PoolReporter = (event: DatabasePoolEvent) => void;

export class ObservedDatabasePool extends Pool {
  constructor(config: PoolConfig, private readonly reporter: PoolReporter = event => console.warn("[database-pool]", event)) {
    super(config);
    this.on("error", error => this.report({ pool: "application", event: "idle_error", counts: databasePoolCounts(this), ...summarizeDatabaseError(error) }));
  }

  private report(event: DatabasePoolEvent): void {
    // Logging must not change checkout, release, or query behavior.
    try { this.reporter(event); } catch { /* best-effort telemetry */ }
  }

  connect(): Promise<PoolClient>;
  connect(callback: ConnectCallback): void;
  connect(callback?: ConnectCallback): Promise<PoolClient> | void {
    const startedAt = performance.now();
    const countsAtStart = databasePoolCounts(this);
    const record = (error?: unknown) => {
      const durationMs = Math.max(0, Math.round(performance.now() - startedAt));
      if (error || durationMs >= SLOW_ACQUISITION_MS) {
        this.report({
          pool: "application",
          event: error ? "acquisition_failed" : "acquisition_slow",
          durationMs,
          countsAtStart,
          counts: databasePoolCounts(this),
          ...(error ? summarizeDatabaseError(error) : {}),
        });
      }
    };

    if (callback) {
      return super.connect((error, client, release) => {
        record(error);
        callback(error, client, release);
      });
    }
    return super.connect().then(client => {
      record();
      return client;
    }, error => {
      record(error);
      throw error;
    });
  }
}
