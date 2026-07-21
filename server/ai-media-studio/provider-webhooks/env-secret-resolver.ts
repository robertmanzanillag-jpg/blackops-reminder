import type { WebhookSecretReferenceResolver } from "./drizzle-resolver";

const ENV_REFERENCE = /^env:\/\/([A-Z][A-Z0-9_]{2,127})$/;

export interface EnvironmentSecretReferenceResolverOptions {
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  allowedPrefix?: string;
}

/**
 * Resolves an opaque database reference to deployment-managed secret material.
 * Only names in the AI Media Studio namespace are accepted, so a compromised
 * row cannot be used to read arbitrary process environment values.
 */
export function createEnvironmentSecretReferenceResolver(
  options: EnvironmentSecretReferenceResolverOptions = {},
): WebhookSecretReferenceResolver {
  const env = options.env ?? process.env;
  const allowedPrefix = options.allowedPrefix ?? "AI_MEDIA_STUDIO_SECRET_";
  if (!/^[A-Z][A-Z0-9_]{2,63}$/.test(allowedPrefix)) {
    throw new Error("Secret environment prefix is invalid");
  }

  return async (reference) => {
    const match = ENV_REFERENCE.exec(reference);
    const name = match?.[1];
    if (!name || !name.startsWith(allowedPrefix)) return undefined;
    const value = env[name]?.trim();
    return value && value.length <= 4_096 ? value : undefined;
  };
}
