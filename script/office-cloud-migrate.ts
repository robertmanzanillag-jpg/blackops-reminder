import "../server/env-loader";
import pg from "pg";
import { createOfficeCloudSchemaSql } from "../server/office-cloud-store";

// Dry run by default. Never log connection strings or provider/database errors.
async function main() {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== "--apply")) throw new Error("unsupported argument");
  if (!process.env.DATABASE_URL?.trim()) throw new Error("database configuration required");
  const apply = args.includes("--apply");
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000 });
  try {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL lock_timeout = 2000");
      await client.query("SET LOCAL statement_timeout = 15000");
      await client.query(createOfficeCloudSchemaSql());
      const result = await client.query("SELECT tablename FROM pg_tables WHERE schemaname=$1 AND tablename=ANY($2)", ["public", ["agent_office_cloud_jobs", "office_agent_workers"]]);
      if (result.rows.length !== 2) throw new Error("schema verification failed");
      await client.query(apply ? "COMMIT" : "ROLLBACK");
      console.log(JSON.stringify({ migrationValidated: true, applied: apply, existingCouncilStateUnchanged: true }));
    } catch (error) { await client.query("ROLLBACK").catch(() => {}); throw error; }
    finally { client.release(); }
  } finally { await pool.end(); }
}
void main().catch(() => { console.error("Office migration failed; no credentials or database details are logged. Check target configuration and privileges."); process.exitCode = 1; });
