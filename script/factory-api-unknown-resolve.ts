import "../server/env-loader";
import pg from "pg";
import { blackopsApplicationName, getCouncilStore } from "../server/agent-council-store";
import { createSoftwareFactoryStore } from "../server/software-factory-store";
import { createSharedOpenAiCreditLedger, type SharedCreditState } from "../server/shared-openai-credit-ledger";
import { createSharedCreditTransaction } from "../server/shared-openai-credit-store";
import { safeErrorCode } from "./software-factory-db-cli";
import { readApiAuthority } from "./factory-api-authority-read";
import { createHash } from "node:crypto";
import { parseResolveArgs, planAllApiUnknown, planUnknownResolution, runUnknownResolution, type UnknownFactoryJob } from "./factory-api-unknown-resolve-core";

// factory-ops `api-unknown-resolve` (docs/factory-api-budget-authority.md):
//   [--hold-id=ID|news] [--apply]   default: every unknown API-ledger reservation (+ tied unknown Factory jobs);
//                                   --hold-id=news targets the quarantined News execution (code-owned, never printed)
//   evidence text from env FACTORY_API_EVIDENCE (only its SHA-256 and length are printed)
//   shared-credit scope from env SHARED_CREDIT_SCOPE
// Dry run by default: reads only and prints the plan. Apply settles at the FULL reserved amount.
const ledgerOwner = (scope: string) => JSON.stringify(["shared-openai-credit-ledger-v1", scope]);
const receiptOwner = (scope: string) => JSON.stringify(["factory-api-unknown-resolution-receipts-v1", scope]);

async function readOnly<T>(pool: pg.Pool, work: (c: pg.PoolClient) => Promise<T>) {
  const c = await pool.connect();
  try { await c.query("BEGIN TRANSACTION READ ONLY"); await c.query("SET LOCAL statement_timeout = 15000"); return await work(c); }
  finally { await c.query("ROLLBACK").catch(() => undefined); c.release(); }
}

async function main() {
  const args = parseResolveArgs(process.argv.slice(2), process.env.FACTORY_API_EVIDENCE);
  const owner = (process.env.SOFTWARE_FACTORY_OWNER_ID ?? "").trim(), scope = (process.env.SHARED_CREDIT_SCOPE ?? "").trim();
  if (!owner) throw new Error("FACTORY_OWNER_REQUIRED");
  if (!/^[A-Za-z0-9_.:-]{1,200}$/.test(scope)) throw new Error("SHARED_CREDIT_SCOPE_REQUIRED");
  if (!process.env.DATABASE_URL?.trim()) throw new Error("DATABASE_URL_REQUIRED");
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000, max: 2, application_name: blackopsApplicationName("factory-api-unknown-resolve") });
  pool.on("error", () => undefined);
  try {
    const council = await getCouncilStore();
    const read = async () => {
      const raw = await council.read(ledgerOwner(scope));
      const shared = raw === null ? null : JSON.parse(raw) as SharedCreditState;
      const { authority, state, jobs } = await readOnly(pool, async c => {
        const read = await readApiAuthority(c, owner);
        const rows = await c.query("SELECT id, input FROM software_factory_jobs WHERE owner_key=$1 AND status='unknown'", [createHash("sha256").update(owner).digest("hex")]);
        const jobs: UnknownFactoryJob[] = rows.rows.map(r => ({ id: String(r.id), reservedCents: Number((r.input as { reservedCents?: unknown })?.reservedCents) }))
          .filter(j => Number.isSafeInteger(j.reservedCents) && j.reservedCents >= 0);
        return { ...read, jobs };
      });
      const plan = args.holdId === undefined ? planAllApiUnknown({ api: state, jobs }) : planUnknownResolution({ holdId: args.holdId, shared, api: state, jobs });
      return { shared, authority, plan };
    };
    const before = await read();
    const shared = before.shared;
    const result = await runUnknownResolution(before.plan, { apply: args.apply, evidenceSha256: args.evidenceSha256, at: new Date().toISOString(),
      appendReceipt: async receipt => { await council.transact(receiptOwner(scope), async raw => {
        const events = raw === null ? [] : JSON.parse(raw) as unknown[];
        if (!Array.isArray(events)) throw Error("RECEIPTS_CORRUPT");
        return JSON.stringify([...events, receipt]); // append-only
      }); },
      settleShared: async step => {
        if (!shared?.grant) throw Error("LEDGER_NOT_INITIALIZED");
        const ledger = createSharedOpenAiCreditLedger({ grant: shared.grant, transact: createSharedCreditTransaction(council, scope),
          now: () => new Date(), maximumGrantObservationAgeMs: 60_000 });
        await ledger.settle({ ...step, reconciliation: { executionStopped: true } });
      },
      resolveApi: receipt => createSoftwareFactoryStore(pool as never).resolveApiUnknown(owner, receipt),
      reconcileJob: step => createSoftwareFactoryStore(pool as never).reconcile(owner, step.jobId, { actualCostCents: step.actualCostCents, executionStopped: true, reason: step.reason }) });
    if (!args.apply || !result.applied) {
      console.log(JSON.stringify({ dryRun: !args.apply, evidenceChars: args.evidenceChars, evidenceSha256: args.evidenceSha256, plan: result, authority: before.authority }));
      if (args.apply && before.plan.refusal) process.exitCode = 1;
      return;
    }
    const after = await read();
    console.log(JSON.stringify({ applied: true, plan: result, after: { alreadyResolved: after.plan.alreadyResolved, reason: after.authority.reason, unknown: after.authority.unknown,
      unknownHolds: after.authority.unknownHolds, paidAdmissionReady: after.authority.paidAdmissionReady } }));
  } finally { await pool.end(); }
}
void main().catch(error => {
  console.error(JSON.stringify({ error: "Factory API unknown resolution failed; no credentials or database details are logged.", code: safeErrorCode(error) }));
  process.exitCode = 1;
}).finally(() => setTimeout(() => process.exit(process.exitCode ?? 0), 100).unref());
