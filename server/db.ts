import { drizzle } from "drizzle-orm/node-postgres";
import { resolveDatabaseConnectionString } from "./database-url";
import { ObservedDatabasePool, resolveDatabasePoolSettings } from "./db-pool";

export const pool = new ObservedDatabasePool({
  connectionString: resolveDatabaseConnectionString(),
  allowExitOnIdle: true,
  ...resolveDatabasePoolSettings(),
});

export const db = drizzle(pool);
