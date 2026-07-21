import assert from "node:assert/strict";
import test from "node:test";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  createPublishingAccountsRepository,
  type PublishingAccountsDatabase,
} from "../server/ai-media-studio/publishing/accounts";
import { createOperationsRuntime } from "../server/ai-media-studio/operations-runtime";
import { InMemoryPublishingRepository } from "../server/ai-media-studio/publishing/in-memory";
import { InMemoryAnalyticsRepository } from "../server/ai-media-studio/analytics/in-memory-repository";
import { InMemorySourceRepository } from "../server/ai-media-studio/sources/in-memory-source-repository";

const dialect = new PgDialect();
const scope = { ownerUserId: "owner-1", workspaceId: "workspace-1" };

function mockDatabase(rows: unknown[]) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const db: PublishingAccountsDatabase = {
    async execute(query) {
      calls.push(dialect.sqlToQuery(query));
      return { rows };
    },
  };
  return { db, calls };
}

function providerRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "connection-1",
    providerKey: "tiktok",
    displayName: "Studio TikTok",
    status: "active",
    secretRef: "vault://publishing/tiktok",
    capabilities: ["publish_video", "schedule_post", "unknown_permission"],
    credentialStatus: "active",
    credentialVersion: 1,
    credentialExpiresAt: new Date("2099-07-20T12:00:00.000Z"),
    lastVerifiedAt: new Date("2026-07-20T12:00:00.000Z"),
    externalAccountId: "must-not-leak",
    configuration: { token: "must-not-leak" },
    ...overrides,
  };
}

test("listConnections scopes SQL to owner/workspace and social provider keys", async () => {
  const { db, calls } = mockDatabase([]);
  await createPublishingAccountsRepository(db).listConnections(scope);

  assert.equal(calls.length, 1);
  const normalizedSql = calls[0].sql.replace(/\s+/g, " ").trim();
  assert.match(normalizedSql, /owner_user_id.*=.*\$1/i);
  assert.match(normalizedSql, /workspace_id.*=.*\$2/i);
  assert.match(normalizedSql, /provider_key.*in/i);
  assert.deepEqual(calls[0].params, [
    "owner-1",
    "workspace-1",
    "tiktok",
    "instagram",
    "facebook",
    "youtube_shorts",
  ]);
  assert.doesNotMatch(normalizedSql, /external_account_id|configuration|token/i);
});

test("listConnections returns four redacted connections and marks a complete account ready", async () => {
  const { db } = mockDatabase([providerRow()]);
  const connections = await createPublishingAccountsRepository(db).listConnections(scope);

  assert.equal(connections.length, 4);
  assert.deepEqual(connections[0], {
    connectionId: "connection-1",
    platform: "tiktok",
    status: "ready",
    accountLabel: "Studio TikTok",
    capabilities: ["publish_video", "schedule_post"],
    checkedAt: "2026-07-20T12:00:00.000Z",
    message: "Publishing account is ready.",
  });
  assert.equal(connections[1].status, "not_connected");
  assert.equal(JSON.stringify(connections).includes("vault://"), false);
  assert.equal(JSON.stringify(connections).includes("must-not-leak"), false);
  assert.equal(JSON.stringify(connections).includes("externalAccountId"), false);
  assert.equal(JSON.stringify(connections).includes("secretRef"), false);
});

test("listConnections marks an incomplete account for attention", async () => {
  const { db } = mockDatabase([
    providerRow({ secretRef: " ", capabilities: ["read_analytics"] }),
  ]);
  const [connection] = await createPublishingAccountsRepository(db).listConnections(scope);

  assert.equal(connection.status, "attention");
  assert.equal(connection.connectionId, "connection-1");
  assert.deepEqual(connection.capabilities, ["read_analytics"]);
});

test("listConnections keeps legacy unverified and expired credentials unusable", async () => {
  const legacy = mockDatabase([providerRow({ credentialStatus: "unverified", credentialVersion: 0 })]);
  const expired = mockDatabase([providerRow({ credentialExpiresAt: new Date("2020-01-01T00:00:00.000Z") })]);

  assert.equal((await createPublishingAccountsRepository(legacy.db).listConnections(scope))[0].status, "attention");
  assert.equal((await createPublishingAccountsRepository(expired.db).listConnections(scope))[0].status, "attention");
});

test("listConnections fails closed whenever multiple accounts are ambiguous", async () => {
  const { db } = mockDatabase([
    providerRow(),
    providerRow({
      id: "connection-2",
      displayName: "Incomplete TikTok",
      secretRef: null,
      capabilities: [],
    }),
  ]);
  const [connection] = await createPublishingAccountsRepository(db).listConnections(scope);

  assert.equal(connection.status, "attention");
  assert.equal(connection.connectionId, null);
  assert.equal(connection.accountLabel, null);
  assert.deepEqual(connection.capabilities, []);
  assert.match(connection.message, /ambiguous/i);
});

test("assertUsable accepts only a ready scoped platform connection with the capability", async () => {
  const { db } = mockDatabase([providerRow()]);
  const repository = createPublishingAccountsRepository(db);

  const connection = await repository.assertUsable(
    scope,
    "connection-1",
    "tiktok",
    "publish_video",
  );
  assert.equal(connection.status, "ready");

  await assert.rejects(
    repository.assertUsable(scope, "connection-1", "instagram", "publish_video"),
    /not usable/,
  );
  await assert.rejects(
    repository.assertUsable(scope, "connection-1", "tiktok", "webhook_events"),
    /not usable/,
  );
});

test("assertUsable fails closed across tenants and for incomplete secrets", async () => {
  const calls: Array<{ params: unknown[] }> = [];
  const db: PublishingAccountsDatabase = {
    async execute(query) {
      const compiled = dialect.sqlToQuery(query);
      calls.push({ params: compiled.params });
      const owner = compiled.params[0];
      if (owner !== "owner-1") return { rows: [] };
      return { rows: [providerRow({ secretRef: null })] };
    },
  };
  const repository = createPublishingAccountsRepository(db);

  await assert.rejects(
    repository.assertUsable(
      { ownerUserId: "other-owner", workspaceId: "workspace-1" },
      "connection-1",
      "tiktok",
      "publish_video",
    ),
    /not usable/,
  );
  await assert.rejects(
    repository.assertUsable(scope, "connection-1", "tiktok", "publish_video"),
    /not usable/,
  );
  assert.equal(calls[0].params[0], "other-owner");
  assert.equal(calls[1].params[0], "owner-1");
});

test("operations runtime uses durable account readiness and an explicit resolver still wins", async () => {
  let repositoryCalls = 0;
  const readyConnection = {
    connectionId: "connection-1",
    platform: "tiktok" as const,
    status: "ready" as const,
    accountLabel: "Studio TikTok",
    capabilities: ["publish_video" as const],
    checkedAt: "2026-07-20T12:00:00.000Z",
    message: "Publishing account is ready.",
  };
  const repositories = {
    publishing: new InMemoryPublishingRepository(),
    analytics: new InMemoryAnalyticsRepository(),
    sources: new InMemorySourceRepository(),
    publishingAccounts: {
      async listConnections() {
        repositoryCalls += 1;
        return [readyConnection];
      },
      async assertUsable() { return readyConnection; },
    },
  };
  const durable = createOperationsRuntime({ repositories });
  const durableConnections = await durable.connections(scope);
  assert.equal(repositoryCalls, 1);
  assert.deepEqual(durableConnections[0], readyConnection);
  assert.equal(durableConnections.length, 4);

  const explicit = createOperationsRuntime({
    repositories,
    resolveConnections: () => [{
      platform: "instagram",
      status: "attention",
      accountLabel: "Explicit test seam",
      capabilities: ["read_analytics"],
      checkedAt: null,
      message: "Explicit resolver wins",
    }],
  });
  const explicitConnections = await explicit.connections(scope);
  assert.equal(repositoryCalls, 1, "the durable repository is not called when the explicit resolver is present");
  assert.equal(explicitConnections.find((item) => item.platform === "instagram")?.accountLabel, "Explicit test seam");
  assert.equal(explicitConnections.find((item) => item.platform === "instagram")?.connectionId, null);
});
