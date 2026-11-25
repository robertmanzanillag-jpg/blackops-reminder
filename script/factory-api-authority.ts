import "../server/env-loader";
import pg from "pg";
import { blackopsApplicationName } from "../server/agent-council-store";
import { createSoftwareFactoryStore } from "../server/software-factory-store";
import { safeErrorCode } from "./software-factory-db-cli";
import { checkpointRefusal, describeCheckpoint, parseCheckpointArgs, parseMonthInitArgs } from "./factory-api-authority-cli";
import { readApiAuthority } from "./factory-api-authority-read";

// Operator tool for the Factory API monetary authority (docs/factory-api-budget-authority.md).
//   month-init  --month=YYYY-MM --fixed-usd=N            [--apply]
//   checkpoint  --month=YYYY-MM --external-spent-usd=N --external-reserved-usd=N --external-unknown-count=N [--apply]
//               evidence text from env FACTORY_API_EVIDENCE (only its SHA-256 and length are printed)
// Dry run by default: reads inside a READ ONLY transaction and prints what would be written.
async function readOnly<T>(pool: pg.Pool, work: (c: pg.PoolClient) => Promise<T>) {
  const c = await pool.connect();
  try { await c.query("BEGIN TRANSACTION READ ONLY"); await c.query("SET LOCAL statement_timeout = 15000"); return await work(c); }
  finally { await c.query("ROLLBACK").catch(() => undefined); c.release(); }
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const owner = (process.env.SOFTWARE_FACTORY_OWNER_ID ?? "").trim();
  if (!owner) throw new Error("FACTORY_OWNER_REQUIRED");
  if (!process.env.DATABASE_URL?.trim()) throw new Error("DATABASE_URL_REQUIRED");
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000, max: 2, application_name: blackopsApplicationName("factory-api-authority") });
  pool.on("error", () => undefined);
  try {
    const before = await readOnly(pool, c => readApiAuthority(c, owner));
    if (command === "month-init") {
      const args = parseMonthInitArgs(rest);
      const plan = { action: "api-month-init", apply: args.apply, month: args.month, fixedCents: args.fixedCents, alreadyInitialized: before.authority.monthInitialized };
      if (!args.apply) { console.log(JSON.stringify({ dryRun: true, wouldWrite: plan, authority: before.authority })); return; }
      await createSoftwareFactoryStore(pool as never).initializeMonth(owner, args.month, args.fixedCents);
    } else if (command === "checkpoint") {
      const args = parseCheckpointArgs(rest, process.env.FACTORY_API_EVIDENCE);
      const existing = before.state.checkpoints.find(c => c.month === args.checkpoint.month);
      const refusal = checkpointRefusal({ checkpoint: args.checkpoint, monthInitialized: before.authority.monthInitialized,
        factoryUnknownJob: before.authority.unknownHolds.factoryJobUnknown, existingCheckpoint: existing, newsHold: before.authority.newsExecutionHold });
      const plan = { action: "api-checkpoint", apply: args.apply, checkpoint: describeCheckpoint(args.checkpoint, args.evidenceChars), refusal };
      if (!args.apply || refusal) {
        console.log(JSON.stringify({ dryRun: !args.apply, wouldWrite: refusal ? null : plan, refusal, authority: before.authority }));
        if (refusal && args.apply) process.exitCode = 1;
        return;
      }
      await createSoftwareFactoryStore(pool as never).checkpointApiMonth(owner, args.checkpoint);
      console.log(JSON.stringify({ applied: true, written: plan.checkpoint }));
    } else throw new Error("COMMAND_INVALID");
    const after = await readOnly(pool, c => readApiAuthority(c, owner));
    console.log(JSON.stringify({ applied: true, authority: after.authority }));
  } finally { await pool.end(); }
}
void main().catch(error => {
  console.error(JSON.stringify({ error: "Factory API authority action failed; no credentials or database details are logged.", code: safeErrorCode(error) }));
  process.exitCode = 1;
});
