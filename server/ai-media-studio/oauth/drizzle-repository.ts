import { sql, type SQL } from "drizzle-orm";
import { aiMediaOAuthSessions, aiMediaProviderAccounts } from "../../../shared/models/ai-media-studio-db";
import type {
  ConsumeOAuthSession,
  CreateOAuthSession,
  OAuthAccountBindingVerifier,
  OAuthSession,
  OAuthSessionRepository,
} from "./contracts";

type ExecuteResult = { rows?: unknown[] } | unknown[];
export type OAuthDatabase = { execute(query: SQL): Promise<ExecuteResult> };

function rows(result: ExecuteResult): Record<string, unknown>[] {
  const values = Array.isArray(result) ? result : result.rows;
  return Array.isArray(values) ? values as Record<string, unknown>[] : [];
}

function value(row: Record<string, unknown>, camel: string, snake: string): unknown {
  return row[camel] ?? row[snake];
}

function iso(raw: unknown): string {
  const date = raw instanceof Date ? raw : new Date(String(raw));
  if (Number.isNaN(date.getTime())) throw new Error("Invalid OAuth session timestamp");
  return date.toISOString();
}

function nullableString(raw: unknown): string | null {
  return raw == null ? null : String(raw);
}

function mapRow(row: Record<string, unknown>): OAuthSession {
  const requested = value(row, "requestedScopes", "requested_scopes");
  const requestedScopes = typeof requested === "string" ? JSON.parse(requested) : requested;
  if (!Array.isArray(requestedScopes) || requestedScopes.some((scope) => typeof scope !== "string")) {
    throw new Error("Invalid OAuth session scopes");
  }
  const pkceMode = value(row, "pkceMode", "pkce_mode");
  const codeChallengeMethod = nullableString(value(row, "codeChallengeMethod", "code_challenge_method"));
  if (
    (pkceMode !== "required_s256" && pkceMode !== "none")
    || (codeChallengeMethod !== null && codeChallengeMethod !== "S256")
  ) throw new Error("Invalid OAuth PKCE snapshot");
  return {
    id: String(row.id),
    scope: {
      ownerUserId: String(value(row, "ownerUserId", "owner_user_id")),
      workspaceId: String(value(row, "workspaceId", "workspace_id")),
    },
    actorUserId: String(value(row, "actorUserId", "actor_user_id")),
    providerAccountId: String(value(row, "providerAccountId", "provider_account_id")),
    platform: String(row.platform) as OAuthSession["platform"],
    stateDigest: String(value(row, "stateDigest", "state_digest")),
    redirectUri: String(value(row, "redirectUri", "redirect_uri")),
    requestedScopes,
    pkceMode,
    codeChallenge: nullableString(value(row, "codeChallenge", "code_challenge")),
    codeChallengeMethod,
    pkceVerifierRef: nullableString(value(row, "pkceVerifierRef", "pkce_verifier_ref")),
    status: String(row.status) as OAuthSession["status"],
    outcome: (row.outcome ?? null) as OAuthSession["outcome"],
    expiresAt: iso(value(row, "expiresAt", "expires_at")),
    consumedAt: value(row, "consumedAt", "consumed_at") == null ? null : iso(value(row, "consumedAt", "consumed_at")),
    createdAt: iso(value(row, "createdAt", "created_at")),
    updatedAt: iso(value(row, "updatedAt", "updated_at")),
  };
}

export class DrizzleOAuthSessionRepository implements OAuthSessionRepository {
  constructor(private readonly db: OAuthDatabase) {}

  async create(input: CreateOAuthSession): Promise<OAuthSession> {
    const result = await this.db.execute(sql`
      INSERT INTO ${aiMediaOAuthSessions} (
        id, owner_user_id, workspace_id, actor_user_id, provider_account_id, platform,
        state_digest, redirect_uri, requested_scopes, pkce_mode, code_challenge,
        code_challenge_method, pkce_verifier_ref, status, expires_at, created_at, updated_at
      ) VALUES (
        ${input.id}, ${input.scope.ownerUserId}, ${input.scope.workspaceId}, ${input.actorUserId},
        ${input.providerAccountId}, ${input.platform}, ${input.stateDigest}, ${input.redirectUri},
        ${JSON.stringify(input.requestedScopes)}::jsonb, ${input.pkceMode}, ${input.codeChallenge}, ${input.codeChallengeMethod},
        ${input.pkceVerifierRef}, 'pending', ${new Date(input.expiresAt)},
        ${new Date(input.createdAt)}, ${new Date(input.createdAt)}
      ) RETURNING *
    `);
    const row = rows(result)[0];
    if (!row) throw new Error("OAuth session was not created");
    return mapRow(row);
  }

  async consume(input: ConsumeOAuthSession): Promise<OAuthSession | undefined> {
    const result = await this.db.execute(sql`
      UPDATE ${aiMediaOAuthSessions}
      SET status = 'consumed', outcome = ${input.outcome}, consumed_at = ${new Date(input.now)}, updated_at = ${new Date(input.now)}
      WHERE state_digest = ${input.stateDigest}
        AND platform = ${input.platform}
        AND status = 'pending'
        AND consumed_at IS NULL
        AND expires_at > ${new Date(input.now)}
      RETURNING *
    `);
    const row = rows(result)[0];
    return row ? mapRow(row) : undefined;
  }
}

export function createDrizzleOAuthAccountBindingVerifier(db: OAuthDatabase): OAuthAccountBindingVerifier {
  return {
    async assertConnectable(input): Promise<void> {
      const result = await db.execute(sql`
        SELECT ${aiMediaProviderAccounts.id}
        FROM ${aiMediaProviderAccounts}
        WHERE ${aiMediaProviderAccounts.id} = ${input.providerAccountId}
          AND ${aiMediaProviderAccounts.ownerUserId} = ${input.scope.ownerUserId}
          AND ${aiMediaProviderAccounts.workspaceId} = ${input.scope.workspaceId}
          AND ${aiMediaProviderAccounts.providerKey} = ${input.platform}
        LIMIT 1
      `);
      if (rows(result).length !== 1) throw new Error("OAuth provider account is not connectable");
    },
  };
}
