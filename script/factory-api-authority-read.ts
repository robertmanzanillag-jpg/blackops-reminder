import { createHash } from "node:crypto";
import { emptyFactoryApiState, parseFactoryApiState } from "../server/software-factory-api-budget";
import { createSoftwareFactoryStore } from "../server/software-factory-store";
import { newsHoldNeedles, shapeApiAuthority, summarizeNewsHold } from "./factory-api-authority-cli";

type Query = { query(sql: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }> };

/** Runs the store's own read path on the caller's (READ ONLY) client: its transaction control and
 * advisory lock become no-ops, so nothing is committed and the money logic is not duplicated. */
function readOnlyStore(c: Query) {
  const client = { query: (sql: string, values?: unknown[]) =>
    /^\s*(BEGIN|COMMIT|ROLLBACK|SELECT pg_advisory_xact_lock)/i.test(sql) ? Promise.resolve({ rows: [] }) : c.query(sql, values),
    release: () => undefined };
  return createSoftwareFactoryStore({ connect: async () => client } as never);
}

/** Reads (never writes) the API authority for the current month. Safe inside a READ ONLY transaction. */
export async function readApiAuthority(c: Query, owner: string) {
  const key = createHash("sha256").update(owner).digest("hex");
  const present = await c.query("SELECT to_regclass('software_factory_api_authority') AS relation");
  const tablePresent = !!present.rows[0]?.relation;
  const rows = tablePresent ? await c.query("SELECT state FROM software_factory_api_authority WHERE owner_key=$1", [key]) : { rows: [] };
  const stored = rows.rows[0] ? parseFactoryApiState(rows.rows[0].state) : undefined;
  const state = stored ?? emptyFactoryApiState();
  const status = await readOnlyStore(c).apiBudgetStatus(owner);
  const unknownJobs = await c.query("SELECT count(*)::int AS n FROM software_factory_jobs WHERE owner_key=$1 AND status='unknown'", [key]);
  const factoryUnknownJob = Number(unknownJobs.rows[0]?.n ?? 0) > 0;
  // Shared-credit ledgers live in agent_council_state; find any row that mentions the quarantined hold.
  const ledgers: Array<{ reservations?: unknown }> = [{ reservations: state.reservations }];
  const council = await c.query("SELECT to_regclass('agent_council_state') AS relation");
  if (council.rows[0]?.relation) {
    const found = await c.query("SELECT state FROM agent_council_state WHERE state::text LIKE ANY($1)", [newsHoldNeedles().map(n => `%${n}%`)]);
    for (const row of found.rows) {
      try { ledgers.push(typeof row.state === "string" ? JSON.parse(row.state) : row.state as never); } catch { /* unreadable row: not counted */ }
    }
  }
  const authority = shapeApiAuthority({ tablePresent, stateRowExists: !!stored, monthInitialized: status.reason !== "FACTORY_MONTH_UNINITIALIZED",
    factoryUnknownJob, status, state, newsHold: summarizeNewsHold(ledgers) });
  return { authority, state };
}
