import "../server/env-loader";
import { createHash } from "node:crypto";
import pg from "pg";
import { blackopsApplicationName } from "../server/agent-council-store";
import { createSoftwareFactoryStore } from "../server/software-factory-store";
import { safeErrorCode } from "./software-factory-db-cli";
import { readApiAuthority } from "./factory-api-authority-read";
import { runResume } from "./factory-resume-core";

// factory-ops `factory-resume` [--apply]: clears the factory pause via store.setPaused(owner,false)
// (the owner web UI path). Dry run by default. Logs booleans/counts only.
async function main() {
  const argv = process.argv.slice(2);
  if (argv.some(a => a !== "--apply")) throw new Error("ARGUMENT_INVALID");
  const apply = argv.includes("--apply");
  const owner = (process.env.SOFTWARE_FACTORY_OWNER_ID ?? "").trim();
  if (!owner) throw new Error("FACTORY_OWNER_REQUIRED");
  if (!process.env.DATABASE_URL?.trim()) throw new Error("DATABASE_URL_REQUIRED");
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000, max: 2, application_name: blackopsApplicationName("factory-resume") });
  pool.on("error", () => undefined);
  try {
    const key = createHash("sha256").update(owner).digest("hex");
    const c = await pool.connect();
    let read;
    try {
      await c.query("BEGIN TRANSACTION READ ONLY"); await c.query("SET LOCAL statement_timeout = 15000");
      const { authority } = await readApiAuthority(c, owner);
      const control = await c.query("SELECT paused FROM software_factory_controls WHERE owner_key=$1", [key]);
      const jobs = await c.query("SELECT count(*)::int AS n FROM software_factory_jobs WHERE owner_key=$1 AND status='unknown'", [key]);
      if (!control.rows[0]) throw new Error("FACTORY_CONTROL_MISSING");
      read = { paused: control.rows[0].paused === true, unknownJobs: Number(jobs.rows[0]?.n ?? 0), apiUnknown: authority.unknown === true,
        unknownHolds: authority.unknownHolds, reason: authority.reason };
    } finally { await c.query("ROLLBACK").catch(() => undefined); c.release(); }
    const result = await runResume({ ...read, apply, setPaused: paused => createSoftwareFactoryStore(pool as never).setPaused(owner, paused) });
    console.log(JSON.stringify({ dryRun: !apply, ...result, unknownJobs: read.unknownJobs, unknownHolds: read.unknownHolds, apiReason: read.reason }));
    if (apply && result.refusal) process.exitCode = 1;
  } finally { await pool.end(); }
}
void main().catch(error => {
  console.error(JSON.stringify({ error: "Factory resume failed; no credentials or database details are logged.", code: safeErrorCode(error) }));
  process.exitCode = 1;
}).finally(() => setTimeout(() => process.exit(process.exitCode ?? 0), 100).unref());
