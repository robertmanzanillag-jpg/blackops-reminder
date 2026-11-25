import { createHash } from "node:crypto";
import { emptyFactoryApiState, factoryApiBudgetStatus, parseFactoryApiState } from "../server/software-factory-api-budget";
import { readFactoryApiExposure, readFactoryApiState } from "../server/software-factory-store";
import { newsHoldNeedles, shapeApiAuthority, summarizeNewsHold } from "./factory-api-authority-cli";

type Query = { query(sql: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }> };

/** Reads (never writes) the API authority for the current month. Safe inside a READ ONLY transaction. */
export async function readApiAuthority(c: Query, owner: string, now = new Date().toISOString()) {
  const key = createHash("sha256").update(owner).digest("hex");
  const present = await c.query("SELECT to_regclass('software_factory_api_authority') AS relation");
  const tablePresent = !!present.rows[0]?.relation;
  const stored = tablePresent ? await readFactoryApiState(c as never, key) : undefined;
  const state = stored ?? emptyFactoryApiState();
  const exposure = await readFactoryApiExposure(c as never, key, now);
  const status = factoryApiBudgetStatus(state, exposure, now);
  // Shared-credit ledgers live in agent_council_state; find any row that mentions the quarantined hold.
  const ledgers: Array<{ reservations?: unknown }> = [{ reservations: state.reservations }];
  const council = await c.query("SELECT to_regclass('agent_council_state') AS relation");
  if (council.rows[0]?.relation) {
    const rows = await c.query("SELECT state FROM agent_council_state WHERE state::text LIKE ANY($1)", [newsHoldNeedles().map(n => `%${n}%`)]);
    for (const row of rows.rows) {
      try { ledgers.push(typeof row.state === "string" ? JSON.parse(row.state) : row.state as never); } catch { /* unreadable row: not counted */ }
    }
  }
  const authority = shapeApiAuthority({ tablePresent, stateRowExists: !!stored, monthInitialized: exposure.configured,
    factoryUnknownJob: exposure.unknown, status, state, newsHold: summarizeNewsHold(ledgers) });
  return { authority, state: stored ? parseFactoryApiState(stored) : state, exposure, key };
}
