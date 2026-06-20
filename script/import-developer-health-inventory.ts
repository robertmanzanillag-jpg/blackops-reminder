import "../server/env-loader";
import { resolveDatabaseConnectionString } from "../server/database-url";
import { knownDeveloperHealthApps, upsertKnownDeveloperHealthInventory } from "../server/developer-health-inventory";
import { getSystemUserId } from "../server/user-context";

function readArg(name: string): string | undefined {
  const prefix = `${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(name);
  if (index >= 0) return process.argv[index + 1];
  return undefined;
}

async function main() {
  const execute = process.argv.includes("--execute");
  const userId = readArg("--user-id") || process.env.REAL_USER_ID || process.env.DEFAULT_USER_ID || getSystemUserId();
  const knownApps = knownDeveloperHealthApps();

  if (!execute) {
    console.log(JSON.stringify({
      status: "dry_run",
      userId,
      totalKnownApps: knownApps.length,
      apps: knownApps.map((app) => ({
        name: app.name,
        githubRepo: app.githubRepo,
        publicUrl: app.publicUrl,
        healthUrl: app.healthUrl,
        deploymentProvider: app.deploymentProvider,
        priority: app.priority,
        tags: app.tags,
      })),
      nextCommand: `npm run developer-health:import-known -- --user-id="${userId}" --execute`,
    }, null, 2));
    return;
  }

  if (!resolveDatabaseConnectionString()) {
    throw new Error("DATABASE_URL is required before importing Developer Health inventory.");
  }

  const result = await upsertKnownDeveloperHealthInventory(userId);
  console.log(JSON.stringify({
    status: "imported",
    userId,
    totalKnownApps: result.totalKnownApps,
    created: result.created.map((app) => ({ name: app.name, githubRepo: app.githubRepo })),
    updated: result.updated.map((app) => ({ name: app.name, githubRepo: app.githubRepo })),
    unchanged: result.unchanged.map((app) => ({ name: app.name, githubRepo: app.githubRepo })),
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
