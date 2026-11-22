import {observePostgresPool} from "./postgres-pool-safety";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { resolveDatabaseConnectionString } from "./database-url";
import { blackopsApplicationName } from "./agent-council-store";

const pool = observePostgresPool(new Pool({
  connectionString: resolveDatabaseConnectionString(),
  allowExitOnIdle: true,
  connectionTimeoutMillis: 10000,
  application_name: blackopsApplicationName("web-db"),
}),{role:"web-db"});

export const db = drizzle(pool);
