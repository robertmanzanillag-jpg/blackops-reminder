import { and, eq, inArray } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { aiMediaProviderAccounts } from "../../../shared/models/ai-media-studio-db";
import type { ProviderWebhookAccountResolver } from "./contracts";

export type ProviderWebhookResolverDatabase = Pick<NodePgDatabase, "select">;
export type WebhookSecretReferenceResolver = (reference: string) => Promise<string | undefined>;

export interface DrizzleProviderWebhookResolverOptions {
  db: ProviderWebhookResolverDatabase;
  workspaceId: string;
  resolveSecretRef: WebhookSecretReferenceResolver;
  allowedAccountStatuses?: readonly string[];
  now?: () => Date;
}

/**
 * Resolve the opaque endpoint through the account table, then materialize only
 * usable secret values through the injected vault. Secret references never
 * leave this adapter.
 */
export function createDrizzleProviderWebhookAccountResolver(
  options: DrizzleProviderWebhookResolverOptions,
): ProviderWebhookAccountResolver {
  const workspaceId = options.workspaceId.trim();
  const statuses = [...(options.allowedAccountStatuses ?? ["connected", "active"])]
    .map((status) => status.trim())
    .filter(Boolean);
  if (!workspaceId || statuses.length === 0) throw new Error("Webhook resolver scope is required");

  return async ({ providerKey, endpointKey }) => {
    const rows = await options.db
      .select({
        id: aiMediaProviderAccounts.id,
        ownerUserId: aiMediaProviderAccounts.ownerUserId,
        workspaceId: aiMediaProviderAccounts.workspaceId,
        providerKey: aiMediaProviderAccounts.providerKey,
        endpointKey: aiMediaProviderAccounts.webhookEndpointKey,
        status: aiMediaProviderAccounts.status,
        secretRef: aiMediaProviderAccounts.webhookSecretRef,
        previousSecretRef: aiMediaProviderAccounts.webhookPreviousSecretRef,
        previousSecretExpiresAt: aiMediaProviderAccounts.webhookPreviousSecretExpiresAt,
      })
      .from(aiMediaProviderAccounts)
      .where(and(
        eq(aiMediaProviderAccounts.workspaceId, workspaceId),
        eq(aiMediaProviderAccounts.providerKey, providerKey),
        eq(aiMediaProviderAccounts.webhookEndpointKey, endpointKey),
        inArray(aiMediaProviderAccounts.status, statuses),
      ))
      .limit(2);

    // Ambiguous endpoint configuration is treated as unavailable.
    if (rows.length !== 1) return undefined;
    const row = rows[0];
    if (!row.secretRef || row.endpointKey !== endpointKey) return undefined;
    const activeSecret = await options.resolveSecretRef(row.secretRef);
    if (!activeSecret) return undefined;

    const secrets: Array<{ value: string; state: "active" | "previous"; expiresAt?: string }> = [
      { value: activeSecret, state: "active" },
    ];
    const nowMs = (options.now?.() ?? new Date()).valueOf();
    const previousExpiry = row.previousSecretExpiresAt?.valueOf();
    if (row.previousSecretRef && previousExpiry !== undefined && previousExpiry > nowMs) {
      const previousSecret = await options.resolveSecretRef(row.previousSecretRef);
      if (previousSecret) {
        secrets.push({
          value: previousSecret,
          state: "previous",
          expiresAt: row.previousSecretExpiresAt!.toISOString(),
        });
      }
    }

    return {
      providerKey: row.providerKey,
      endpointKey: row.endpointKey,
      providerAccountId: row.id,
      tenant: { ownerUserId: row.ownerUserId, workspaceId: row.workspaceId },
      secrets,
    };
  };
}
