const DEV_SESSION_SECRET = "blackops-dev-session-secret";

export type SessionStoreKind = "disabled" | "memory" | "postgres";

export interface SessionRuntimeSettings {
  enabled: boolean;
  secret: string | null;
  storeKind: SessionStoreKind;
  production: boolean;
  secureCookie: boolean;
}

function hasRealDatabaseUrl(value: string | undefined): boolean {
  const normalized = value?.trim();

  if (!normalized) {
    return false;
  }

  if (/^(replace-|<|your-|tu-|example|changeme|todo)/i.test(normalized)) {
    return false;
  }

  if (/^postgres(?:ql)?:\/\/user:password@host(?::\d+)?(?:\/|$)/i.test(normalized)) {
    return false;
  }

  return true;
}

export function resolveSessionRuntimeSettings(env: NodeJS.ProcessEnv = process.env): SessionRuntimeSettings {
  const production = env.NODE_ENV === "production";
  const secret = env.SESSION_SECRET || (production ? null : DEV_SESSION_SECRET);
  const requestedStore = (env.SESSION_STORE_KIND || env.SESSION_STORE || "").trim().toLowerCase();

  if (!secret) {
    return {
      enabled: false,
      secret: null,
      storeKind: "disabled",
      production,
      secureCookie: production,
    };
  }

  return {
    enabled: true,
    secret,
    storeKind: requestedStore === "postgres" && hasRealDatabaseUrl(env.DATABASE_URL) ? "postgres" : "memory",
    production,
    secureCookie: production,
  };
}
