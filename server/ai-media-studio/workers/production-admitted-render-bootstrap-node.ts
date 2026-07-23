import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { db as applicationDatabase } from "../../db";
import { DrizzleAssetIngestRepository } from "../assets/drizzle-ingest-repository";
import {
  createProductionAssetRuntimeFromEnvironment,
  type ProductionAssetEnvironment,
} from "../assets/production-runtime";
import type { AdmittedRenderTransactionalDatabase } from "./drizzle-admitted-render-repository";
import {
  createProductionAdmittedRenderBootstrapDependencies,
  type ProductionAdmittedRenderBootstrapDependencies,
} from "./production-admitted-render-bootstrap";
import { createVerifiedStaticHeyGenProductionRuntimeFactory } from "./verified-static-heygen-production-runtime-factory";

/** Node/PostgreSQL adapter shell; Pool construction remains connection-lazy. */
export function createNodeProductionAdmittedRenderBootstrapDependencies(
  environment: ProductionAssetEnvironment = process.env,
): ProductionAdmittedRenderBootstrapDependencies {
  return createProductionAdmittedRenderBootstrapDependencies(environment, {
    applicationDatabase,
    createDatabaseLane(connectionString) {
      const database = drizzle(new Pool({ connectionString, allowExitOnIdle: true }));
      const lane: AdmittedRenderTransactionalDatabase = {
        execute: (query) => database.execute(query),
        transaction: (callback) => database.transaction(async (transaction) => callback({
          execute: (query) => transaction.execute(query),
        })),
      };
      return lane;
    },
    createAssetRepository: (database) => new DrizzleAssetIngestRepository(database),
    createAssetRuntime(runtimeEnvironment) {
      const runtime = createProductionAssetRuntimeFromEnvironment(runtimeEnvironment);
      return runtime.available ? runtime : undefined;
    },
    createRuntimeFactory: createVerifiedStaticHeyGenProductionRuntimeFactory,
  });
}
