import {
  STATIC_HEYGEN_SECRET_REF,
  type StaticHeyGenCredentialBinding,
} from "./static-heygen-contracts";

declare const staticHeyGenApiKeyBrand: unique symbol;
export type StaticHeyGenApiKey = string & { readonly [staticHeyGenApiKeyBrand]: true };

export interface StaticHeyGenSecretResolver {
  resolve(secretRef: string): Promise<StaticHeyGenApiKey | undefined>;
}

export interface StaticHeyGenSecretResolverOptions {
  env?: NodeJS.ProcessEnv | Readonly<Record<string, string | undefined>>;
}

/**
 * Reads only the dedicated HeyGen deployment-secret namespace. It has no
 * provider transport and returns no diagnostics containing a reference or key.
 */
export function createStaticHeyGenSecretResolver(
  options: StaticHeyGenSecretResolverOptions = {},
): StaticHeyGenSecretResolver {
  const env = options.env ?? process.env;
  return Object.freeze({
    async resolve(secretRef: string): Promise<StaticHeyGenApiKey | undefined> {
      if (!STATIC_HEYGEN_SECRET_REF.test(secretRef)) return undefined;
      const name = secretRef.slice("env://".length);
      const candidate = env[name];
      if (typeof candidate !== "string") return undefined;
      const value = candidate.trim();
      return value.length >= 1 && value.length <= 4_096
        ? value as StaticHeyGenApiKey
        : undefined;
    },
  });
}

export interface PreparedStaticHeyGenCredentialBinding {
  readonly configured: true;
  readonly providerKey: "heygen";
  readonly autostart: false;
  readonly providerAccountId: string;
  readonly providerCredentialVersion: number;
  readonly verificationState: "unverified";
  resolveForExplicitVerification(): Promise<StaticHeyGenApiKey | undefined>;
}

/**
 * Construction is side-effect free. Secret resolution happens only if the
 * caller invokes the explicitly named verification method; this type carries
 * no fetch implementation, worker loop, spend authority, or activation claim.
 */
export function prepareStaticHeyGenCredentialBinding(
  binding: StaticHeyGenCredentialBinding,
  resolver: StaticHeyGenSecretResolver,
): PreparedStaticHeyGenCredentialBinding {
  if (binding.providerKey !== "heygen"
    || binding.lifecycleState !== "pending"
    || binding.verificationState !== "unverified"
    || !Number.isSafeInteger(binding.credentialVersion)
    || binding.credentialVersion < 1
    || !STATIC_HEYGEN_SECRET_REF.test(binding.secretRef)) {
    throw new Error("Static HeyGen credential preparation is invalid");
  }
  return Object.freeze({
    configured: true as const,
    providerKey: "heygen" as const,
    autostart: false as const,
    providerAccountId: binding.providerAccountId,
    providerCredentialVersion: binding.credentialVersion,
    verificationState: "unverified" as const,
    async resolveForExplicitVerification() {
      return resolver.resolve(binding.secretRef);
    },
  });
}

