import type {
  AutomationPolicy,
  PublishingCapability,
  PublishingConnection,
  SocialPlatform,
} from "../../shared/ai-media-studio-operations";
import { and, eq } from "drizzle-orm";
import { aiMediaMediaAssets } from "../../shared/models/ai-media-studio-db";
import { AnalyticsService, type AnalyticsRepository } from "./analytics/domain";
import { InMemoryAnalyticsRepository } from "./analytics/in-memory-repository";
import type { MediaStudioPersistenceStatus } from "./persistence/runtime";
import { MediaStudioPersistenceUnavailableError } from "./persistence/runtime";
import { InMemoryPublishingRepository } from "./publishing/in-memory";
import {
  PUBLISHING_CAPABILITIES,
  type PublishingAccountsRepository,
} from "./publishing/accounts";
import type { PublishingRepository } from "./publishing/ports";
import { PublishingService } from "./publishing/service";
import type { SourceRepository } from "./sources/contracts";
import { InMemorySourceRepository } from "./sources/in-memory-source-repository";
import type { TenantScope } from "./core/resource-domain";

export interface PublishingConnectionReadiness {
  connectionId?: string | null;
  platform: SocialPlatform;
  status: "ready" | "attention" | "not_connected";
  accountLabel: string | null;
  capabilities: string[];
  checkedAt: string | null;
  message: string;
}

export type PublishingConnectionReadinessResolver = (
  scope: TenantScope,
) => Promise<readonly PublishingConnectionReadiness[]> | readonly PublishingConnectionReadiness[];

export interface OperationsRepositories {
  publishing: PublishingRepository;
  analytics: AnalyticsRepository;
  sources: SourceRepository;
  publishingAccounts?: PublishingAccountsRepository;
}

export interface OperationsRuntimeDependencies {
  repositories?: OperationsRepositories;
  runtimeEnvironment?: string;
  databaseUrl?: string;
  createDurableRepositories?: () => OperationsRepositories;
  /** Tenant-scoped readiness metadata only. Implementations must never return credentials or tokens. */
  resolveConnections?: PublishingConnectionReadinessResolver;
  now?: () => Date;
}

export interface OperationsRuntime {
  publishing: PublishingService;
  analytics: AnalyticsService;
  sources: SourceRepository;
  connections(scope: TenantScope): Promise<readonly PublishingConnection[]>;
  status: MediaStudioPersistenceStatus;
  policy(): AutomationPolicy;
}

const platforms: readonly SocialPlatform[] = ["tiktok", "instagram", "facebook", "youtube_shorts"];

function configuredDatabase(databaseUrl: string | undefined): boolean {
  const value = databaseUrl?.trim();
  return Boolean(value && !/^(change[-_ ]?me|replace[-_ ]?me|your[-_ ]|example|placeholder)/iu.test(value));
}

function lazyRepository<T extends object>(load: () => Promise<T>): T {
  let pending: Promise<T> | undefined;
  const repository = () => (pending ??= load());
  return new Proxy({}, {
    get: (_target, property) => async (...args: unknown[]) => {
      const implementation = await repository();
      const method = Reflect.get(implementation, property);
      if (typeof method !== "function") throw new Error(`Repository method ${String(property)} is unavailable`);
      return Reflect.apply(method, implementation, args);
    },
  }) as T;
}

function unavailableRepository<T extends object>(reason: string): T {
  return new Proxy({}, {
    get: () => async () => { throw new MediaStudioPersistenceUnavailableError(reason); },
  }) as T;
}

/** Loads Drizzle lazily so importing the HTTP composition root never opens a database pool. */
export function createDefaultDurableOperationsRepositories(): OperationsRepositories {
  let pending: Promise<OperationsRepositories & { publishingAccounts: PublishingAccountsRepository }> | undefined;
  const load = () => (pending ??= Promise.all([
    import("../db"),
    import("./publishing/drizzle-repository"),
    import("./analytics/drizzle-repository"),
    import("./sources/drizzle-source-repository"),
    import("./publishing/accounts"),
  ]).then(([database, publishing, analytics, sources, accounts]) => ({
    publishing: new publishing.DrizzlePublishingRepository(database.db, async (scope, mediaAssetId) => {
      const [owned] = await database.db.select({ id: aiMediaMediaAssets.id }).from(aiMediaMediaAssets).where(and(
        eq(aiMediaMediaAssets.id, mediaAssetId),
        eq(aiMediaMediaAssets.ownerUserId, scope.ownerUserId),
        eq(aiMediaMediaAssets.workspaceId, scope.workspaceId),
        eq(aiMediaMediaAssets.status, "ready"),
      )).limit(1);
      if (!owned) throw new Error("Publishing requires a ready tenant-owned media asset");
    }),
    analytics: new analytics.DrizzleAnalyticsRepository(database.db, () => {
      throw new Error("Analytics ingestion must resolve a publishing job through its trusted adapter");
    }),
    sources: new sources.DrizzleSourceRepository(database.db),
    publishingAccounts: accounts.createPublishingAccountsRepository(database.db),
  })));
  return {
    publishing: lazyRepository(async () => (await load()).publishing),
    analytics: lazyRepository(async () => (await load()).analytics),
    sources: lazyRepository(async () => (await load()).sources),
    publishingAccounts: lazyRepository(async () => (await load()).publishingAccounts),
  };
}

function selectRepositories(options: OperationsRuntimeDependencies): { repositories: OperationsRepositories; status: MediaStudioPersistenceStatus } {
  if (options.repositories) {
    return {
      repositories: options.repositories,
      status: { mode: "injected", available: true, durable: false, reason: "Operations repositories supplied by the composition caller" },
    };
  }
  if (configuredDatabase(options.databaseUrl)) {
    try {
      const repositories = (options.createDurableRepositories ?? createDefaultDurableOperationsRepositories)();
      return { repositories, status: { mode: "drizzle", available: true, durable: true, reason: "PostgreSQL/Drizzle operations persistence selected" } };
    } catch (error) {
      const reason = `Operations persistence initialization failed: ${error instanceof Error ? error.message : "unknown error"}`;
      return {
        repositories: {
          publishing: unavailableRepository(reason), analytics: unavailableRepository(reason), sources: unavailableRepository(reason),
        },
        status: { mode: "unavailable", available: false, durable: false, reason },
      };
    }
  }
  const environment = options.runtimeEnvironment?.trim().toLowerCase();
  if (environment === "development" || environment === "test") {
    return {
      repositories: {
        publishing: new InMemoryPublishingRepository(), analytics: new InMemoryAnalyticsRepository(), sources: new InMemorySourceRepository(),
      },
      status: { mode: "memory", available: true, durable: false, reason: `Ephemeral operations persistence allowed for ${environment}` },
    };
  }
  const reason = "DATABASE_URL is required outside development/test; in-memory operations persistence is disabled";
  return {
    repositories: { publishing: unavailableRepository(reason), analytics: unavailableRepository(reason), sources: unavailableRepository(reason) },
    status: { mode: "unavailable", available: false, durable: false, reason },
  };
}

function safeConnections(input: readonly PublishingConnectionReadiness[] | undefined): PublishingConnection[] {
  const byPlatform = new Map(input?.map((item) => [item.platform, item]));
  return platforms.map((platform) => {
    const item = byPlatform.get(platform);
    if (!item) return { connectionId: null, platform, status: "not_connected", accountLabel: null, capabilities: [], checkedAt: null, message: "No publishing connection is configured" };
    const connectionId = typeof item.connectionId === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(item.connectionId)
      ? item.connectionId
      : null;
    const capabilities = PUBLISHING_CAPABILITIES.filter((capability) => Array.isArray(item.capabilities) && item.capabilities.includes(capability)) as PublishingCapability[];
    const accountLabel = typeof item.accountLabel === "string" && item.accountLabel.trim()
      ? item.accountLabel.trim().slice(0, 200)
      : null;
    const checkedAtEpoch = typeof item.checkedAt === "string" ? Date.parse(item.checkedAt) : Number.NaN;
    const checkedAt = Number.isFinite(checkedAtEpoch) ? new Date(checkedAtEpoch).toISOString() : null;
    const status = ["ready", "attention", "not_connected"].includes(item.status) ? item.status : "attention";
    const message = typeof item.message === "string" && item.message.trim()
      ? item.message.trim().slice(0, 500)
      : "Publishing connection requires attention";
    return {
      connectionId,
      platform,
      status,
      accountLabel,
      capabilities,
      checkedAt,
      message,
    };
  });
}

export function createOperationsRuntime(options: OperationsRuntimeDependencies = {}): OperationsRuntime {
  const selection = selectRepositories(options);
  const now = options.now ?? (() => new Date());
  return {
    publishing: new PublishingService(selection.repositories.publishing, { now: () => now().getTime() }),
    analytics: new AnalyticsService(selection.repositories.analytics, { now }),
    sources: selection.repositories.sources,
    connections: async (scope) => safeConnections(
      options.resolveConnections
        ? await options.resolveConnections(scope)
        : await selection.repositories.publishingAccounts?.listConnections(scope),
    ),
    status: selection.status,
    policy: () => ({
      automaticPublishingEnabled: false,
      approvalRequired: true,
      policyVersion: "pr3-manual-approval-v1",
      evaluatedAt: now().toISOString(),
      reason: "Automatic publishing is disabled; every manual or scheduled job requires immutable-preview approval",
    }),
  };
}
