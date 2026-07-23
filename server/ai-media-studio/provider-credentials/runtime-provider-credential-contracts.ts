import type { TenantScope } from "../core/resource-domain";

export interface RuntimeProviderCredentialIdentity {
  readonly scope: TenantScope;
  readonly providerAccountId: string;
  readonly providerKey: string;
  readonly providerCredentialVersion: number;
}

export interface RuntimeProviderCredentialMaterializer<T> {
  materialize(identity: RuntimeProviderCredentialIdentity): Promise<T | undefined>;
}
