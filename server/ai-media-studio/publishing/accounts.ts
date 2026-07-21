import { sql, type SQL } from "drizzle-orm";
import { aiMediaProviderAccounts } from "../../../shared/models/ai-media-studio-db";
import { PUBLISHING_PLATFORMS, type PublishingPlatform } from "./domain";

export const PUBLISHING_CAPABILITIES = [
  "publish_video",
  "schedule_post",
  "read_analytics",
  "webhook_events",
] as const;

export type PublishingCapability = (typeof PUBLISHING_CAPABILITIES)[number];
export type PublishingConnectionStatus = "ready" | "attention" | "not_connected";

export type PublishingAccountScope = {
  ownerUserId: string;
  workspaceId: string;
};

export type PublishingAccountConnection = {
  connectionId: string | null;
  platform: PublishingPlatform;
  status: PublishingConnectionStatus;
  accountLabel: string | null;
  capabilities: PublishingCapability[];
  checkedAt: string | null;
  message: string;
};

type ProviderAccountRow = {
  id: unknown;
  providerKey: unknown;
  displayName: unknown;
  status: unknown;
  secretRef: unknown;
  capabilities: unknown;
  lastVerifiedAt: unknown;
};

type ExecuteResult = { rows?: unknown[] } | unknown[];

export type PublishingAccountsDatabase = {
  execute(query: SQL): Promise<ExecuteResult>;
};

const PLATFORM_SET = new Set<string>(PUBLISHING_PLATFORMS);
const CAPABILITY_SET = new Set<string>(PUBLISHING_CAPABILITIES);

function requireScope(scope: PublishingAccountScope): void {
  if (!scope.ownerUserId?.trim() || !scope.workspaceId?.trim()) {
    throw new Error("Publishing account scope is required");
  }
}

function rowsFrom(result: ExecuteResult): ProviderAccountRow[] {
  const rows = Array.isArray(result) ? result : result.rows;
  return Array.isArray(rows) ? (rows as ProviderAccountRow[]) : [];
}

function parseCapabilities(value: unknown): PublishingCapability[] {
  let candidates: unknown = value;
  if (typeof candidates === "string") {
    try {
      candidates = JSON.parse(candidates);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(candidates)) return [];

  return PUBLISHING_CAPABILITIES.filter((capability) =>
    candidates.some((candidate) => candidate === capability && CAPABILITY_SET.has(candidate)),
  );
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asCheckedAt(value: unknown): string | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function isUsable(row: ProviderAccountRow): boolean {
  return (
    row.status === "active" &&
    asNonEmptyString(row.secretRef) !== null &&
    parseCapabilities(row.capabilities).includes("publish_video")
  );
}

function connectionForPlatform(
  platform: PublishingPlatform,
  rows: ProviderAccountRow[],
): PublishingAccountConnection {
  if (rows.length === 0) {
    return {
      connectionId: null,
      platform,
      status: "not_connected",
      accountLabel: null,
      capabilities: [],
      checkedAt: null,
      message: "No publishing account is connected.",
    };
  }

  const usableRows = rows.filter(isUsable);
  if (rows.length > 1) {
    return {
      connectionId: null,
      platform,
      status: "attention",
      accountLabel: null,
      capabilities: [],
      checkedAt: null,
      message: "Multiple publishing accounts were found; the connection is ambiguous.",
    };
  }

  const selected = usableRows[0] ?? rows[0];
  const connectionId = asNonEmptyString(selected.id);
  const accountLabel = asNonEmptyString(selected.displayName);
  const capabilities = parseCapabilities(selected.capabilities);
  const checkedAt = asCheckedAt(selected.lastVerifiedAt);

  if (usableRows.length === 1 && connectionId) {
    return {
      connectionId,
      platform,
      status: "ready",
      accountLabel,
      capabilities,
      checkedAt,
      message: "Publishing account is ready.",
    };
  }

  return {
    connectionId,
    platform,
    status: "attention",
    accountLabel,
    capabilities,
    checkedAt,
    message: "Publishing account connection is incomplete or requires attention.",
  };
}

export function createPublishingAccountsRepository(db: PublishingAccountsDatabase) {
  async function listConnections(scope: PublishingAccountScope): Promise<PublishingAccountConnection[]> {
    requireScope(scope);

    // Deliberately project only fields needed for readiness. External account IDs,
    // provider configuration and token material never cross this repository boundary.
    const result = await db.execute(sql`
      select
        ${aiMediaProviderAccounts.id} as "id",
        ${aiMediaProviderAccounts.providerKey} as "providerKey",
        ${aiMediaProviderAccounts.displayName} as "displayName",
        ${aiMediaProviderAccounts.status} as "status",
        ${aiMediaProviderAccounts.secretRef} as "secretRef",
        ${aiMediaProviderAccounts.capabilities} as "capabilities",
        ${aiMediaProviderAccounts.lastVerifiedAt} as "lastVerifiedAt"
      from ${aiMediaProviderAccounts}
      where ${aiMediaProviderAccounts.ownerUserId} = ${scope.ownerUserId}
        and ${aiMediaProviderAccounts.workspaceId} = ${scope.workspaceId}
        and ${aiMediaProviderAccounts.providerKey} in (${sql.join(
          PUBLISHING_PLATFORMS.map((platform) => sql`${platform}`),
          sql`, `,
        )})
    `);

    const grouped = new Map<PublishingPlatform, ProviderAccountRow[]>();
    for (const platform of PUBLISHING_PLATFORMS) grouped.set(platform, []);

    for (const row of rowsFrom(result)) {
      if (typeof row?.providerKey !== "string" || !PLATFORM_SET.has(row.providerKey)) continue;
      grouped.get(row.providerKey as PublishingPlatform)?.push(row);
    }

    return PUBLISHING_PLATFORMS.map((platform) =>
      connectionForPlatform(platform, grouped.get(platform) ?? []),
    );
  }

  async function assertUsable(
    scope: PublishingAccountScope,
    connectionId: string,
    platform: PublishingPlatform,
    capability: PublishingCapability,
  ): Promise<PublishingAccountConnection> {
    if (
      !asNonEmptyString(connectionId) ||
      !PLATFORM_SET.has(platform) ||
      !CAPABILITY_SET.has(capability)
    ) {
      throw new Error("Publishing account is not usable");
    }

    const connections = await listConnections(scope);
    const connection = connections.find(
      (candidate) => candidate.platform === platform && candidate.connectionId === connectionId,
    );

    if (
      !connection ||
      connection.status !== "ready" ||
      !connection.capabilities.includes(capability)
    ) {
      throw new Error("Publishing account is not usable");
    }

    return connection;
  }

  return { listConnections, assertUsable };
}

export type PublishingAccountsRepository = ReturnType<typeof createPublishingAccountsRepository>;
