import type { WebhookSecretCandidate } from "../webhook-security";

export interface ProviderWebhookTenant {
  ownerUserId: string;
  workspaceId: string;
}

/** Runtime-only material. Implementations must resolve vault references before returning. */
export interface ResolvedProviderWebhookAccount {
  providerKey: string;
  endpointKey: string;
  providerAccountId: string;
  tenant: ProviderWebhookTenant;
  secrets: readonly WebhookSecretCandidate[];
}

export type ProviderWebhookAccountResolver = (input: {
  providerKey: string;
  endpointKey: string;
}) => Promise<ResolvedProviderWebhookAccount | undefined>;

const SAFE_PROVIDER_KEY = /^[A-Za-z0-9_-]{1,64}$/;
const SAFE_ENDPOINT_KEY = /^[A-Za-z0-9_-]{24,128}$/;

export function isSafeProviderKey(value: string): boolean {
  return SAFE_PROVIDER_KEY.test(value);
}

export function isSafeProviderWebhookEndpointKey(value: string): boolean {
  return SAFE_ENDPOINT_KEY.test(value);
}

export function isResolvedWebhookAccountValid(
  account: ResolvedProviderWebhookAccount,
  expected: { providerKey: string; endpointKey: string; workspaceId: string },
): boolean {
  return account.providerKey === expected.providerKey
    && account.endpointKey === expected.endpointKey
    && account.tenant.workspaceId === expected.workspaceId
    && Boolean(account.tenant.ownerUserId.trim())
    && Boolean(account.providerAccountId.trim())
    && account.secrets.length > 0
    && account.secrets.every((secret) => Boolean(secret.value) && secret.value.length <= 4_096);
}
