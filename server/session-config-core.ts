const DEV_SESSION_SECRET = "blackops-dev-session-secret";

export type SessionStoreKind = "disabled" | "memory" | "postgres";

export interface SessionRuntimeSettings {
  enabled: boolean;
  secret: string | null;
  storeKind: SessionStoreKind;
  production: boolean;
  secureCookie: boolean;
}

export function resolveSessionRuntimeSettings(env: NodeJS.ProcessEnv = process.env): SessionRuntimeSettings {
  const production = env.NODE_ENV === "production";
  const secret = env.SESSION_SECRET || (production ? null : DEV_SESSION_SECRET);

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
    storeKind: env.DATABASE_URL ? "postgres" : "memory",
    production,
    secureCookie: production,
  };
}
