import { sql, type SQL } from "drizzle-orm";
import { aiMediaOAuthSessions, aiMediaOAuthVaultOperations, aiMediaProviderAccounts } from "../../../shared/models/ai-media-studio-db";
import type {
  ConsumeDeniedOrErrorOAuthSession,
  ClaimOAuthAuthorization,
  CreateOAuthSession,
  OAuthAccountBindingVerifier,
  OAuthAuthorizationClaim,
  OAuthAuthorizationSagaRepository,
  OAuthFinalizeAuthorization,
  OAuthLeaseCommand,
  OAuthSession,
  OAuthSessionRepository,
} from "./contracts";

type ExecuteResult = { rows?: unknown[] } | unknown[];
export type OAuthDatabase = { execute(query: SQL): Promise<ExecuteResult> };
export type OAuthTransactionalDatabase = OAuthDatabase & {
  transaction<T>(callback: (tx: OAuthDatabase) => Promise<T>): Promise<T>;
};

const SESSION_STATUSES = new Set(["pending", "processing", "consumed"]);
const EXCHANGE_STATUSES = new Set(["not_started", "ready", "in_progress", "succeeded", "not_required", "failed", "indeterminate", "legacy_authorized_unbound"]);
const FAILURE_CODES = new Set(["provider_rejected", "vault_unavailable", "candidate_missing", "credential_conflict", "identity_conflict", "invalid_provider_result"]);
const OUTCOMES = new Set(["authorized", "denied", "error"]);

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
  const status = String(row.status);
  const exchangeStatus = String(value(row, "exchangeStatus", "exchange_status"));
  const outcome = row.outcome == null ? null : String(row.outcome);
  const failureCode = nullableString(value(row, "failureCode", "failure_code"));
  const leaseFencing = Number(value(row, "leaseFencing", "lease_fencing"));
  const expectedCredentialVersion = value(row, "expectedCredentialVersion", "expected_credential_version") == null
    ? null : Number(value(row, "expectedCredentialVersion", "expected_credential_version"));
  const targetCredentialVersion = value(row, "targetCredentialVersion", "target_credential_version") == null
    ? null : Number(value(row, "targetCredentialVersion", "target_credential_version"));
  if (!SESSION_STATUSES.has(status) || !EXCHANGE_STATUSES.has(exchangeStatus)
    || (outcome !== null && !OUTCOMES.has(outcome)) || (failureCode !== null && !FAILURE_CODES.has(failureCode))
    || !Number.isSafeInteger(leaseFencing) || leaseFencing < 0
    || (expectedCredentialVersion !== null && (!Number.isSafeInteger(expectedCredentialVersion) || expectedCredentialVersion < 0))
    || (targetCredentialVersion !== null && (!Number.isSafeInteger(targetCredentialVersion) || targetCredentialVersion < 1))) {
    throw new Error("Invalid OAuth session lifecycle");
  }
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
    status: status as OAuthSession["status"],
    exchangeStatus: exchangeStatus as OAuthSession["exchangeStatus"],
    leaseToken: nullableString(value(row, "leaseToken", "lease_token")),
    leaseOwner: nullableString(value(row, "leaseOwner", "lease_owner")),
    leaseExpiresAt: value(row, "leaseExpiresAt", "lease_expires_at") == null ? null : iso(value(row, "leaseExpiresAt", "lease_expires_at")),
    leaseFencing,
    authorizationCodeDigest: nullableString(value(row, "authorizationCodeDigest", "authorization_code_digest")),
    authorizationCodeRef: nullableString(value(row, "authorizationCodeRef", "authorization_code_ref")),
    expectedCredentialVersion,
    targetCredentialVersion,
    tokenBindingId: nullableString(value(row, "tokenBindingId", "token_binding_id")),
    failureCode: failureCode as OAuthSession["failureCode"],
    outcome: outcome as OAuthSession["outcome"],
    expiresAt: iso(value(row, "expiresAt", "expires_at")),
    consumedAt: value(row, "consumedAt", "consumed_at") == null ? null : iso(value(row, "consumedAt", "consumed_at")),
    createdAt: iso(value(row, "createdAt", "created_at")),
    updatedAt: iso(value(row, "updatedAt", "updated_at")),
  };
}

function claimFromRow(row: Record<string, unknown>): OAuthAuthorizationClaim {
  const session = mapRow(row);
  if (!session.leaseToken || !session.leaseOwner || !session.leaseExpiresAt || session.expectedCredentialVersion == null
    || session.targetCredentialVersion == null || !session.tokenBindingId) throw new Error("Invalid OAuth authorization claim");
  return {
    session, leaseToken: session.leaseToken, leaseOwner: session.leaseOwner,
    leaseExpiresAt: session.leaseExpiresAt, leaseFencing: session.leaseFencing,
    expectedCredentialVersion: session.expectedCredentialVersion,
    targetCredentialVersion: session.targetCredentialVersion, tokenBindingId: session.tokenBindingId,
    recovery: session.exchangeStatus === "in_progress" ? "post_exchange" : "pre_exchange",
  };
}

export class DrizzleOAuthSessionRepository implements OAuthSessionRepository {
  constructor(private readonly db: OAuthDatabase) {}

  async create(input: CreateOAuthSession): Promise<OAuthSession> {
    const result = await this.db.execute(sql`
      WITH created AS (INSERT INTO ${aiMediaOAuthSessions} (
        id, owner_user_id, workspace_id, actor_user_id, provider_account_id, platform,
        state_digest, redirect_uri, requested_scopes, pkce_mode, code_challenge,
        code_challenge_method, pkce_verifier_ref, status, expires_at, created_at, updated_at
      ) VALUES (
        ${input.id}, ${input.scope.ownerUserId}, ${input.scope.workspaceId}, ${input.actorUserId},
        ${input.providerAccountId}, ${input.platform}, ${input.stateDigest}, ${input.redirectUri},
        ${JSON.stringify(input.requestedScopes)}::jsonb, ${input.pkceMode}, ${input.codeChallenge}, ${input.codeChallengeMethod},
        ${input.pkceVerifierRef}, 'pending', ${new Date(input.expiresAt)},
        ${new Date(input.createdAt)}, ${new Date(input.createdAt)}
      ) RETURNING *), cleanup AS (
        INSERT INTO ${aiMediaOAuthVaultOperations} (
          owner_user_id,workspace_id,actor_user_id,provider_account_id,platform,session_id,kind,reference,
          source_expires_at,state,available_at,quiescent_until,created_at,updated_at
        ) SELECT owner_user_id,workspace_id,actor_user_id,provider_account_id,platform,id,'pkce_verifier',pkce_verifier_ref,
          expires_at,'scheduled',expires_at,expires_at+interval '60 seconds',created_at,created_at
        FROM created WHERE pkce_verifier_ref IS NOT NULL RETURNING id
      ) SELECT created.*,(SELECT count(*) FROM cleanup) AS cleanup_count FROM created
    `);
    const row = rows(result)[0];
    if (!row) throw new Error("OAuth session was not created");
    return mapRow(row);
  }

  async consumeDeniedOrError(input: ConsumeDeniedOrErrorOAuthSession): Promise<OAuthSession | undefined> {
    const result = await this.db.execute(sql`
      WITH consumed AS (UPDATE ${aiMediaOAuthSessions}
      SET status = 'consumed', outcome = ${input.outcome}, exchange_status = 'not_required',
          consumed_at = ${new Date(input.now)}, updated_at = ${new Date(input.now)}
      WHERE state_digest = ${input.stateDigest}
        AND platform = ${input.platform}
        AND status = 'pending'
        AND consumed_at IS NULL
        AND expires_at > ${new Date(input.now)}
      RETURNING *), accelerated AS (
        UPDATE ${aiMediaOAuthVaultOperations} operations
        SET state='scheduled',available_at=clock_timestamp(),quiescent_until=clock_timestamp()+interval '60 seconds',updated_at=clock_timestamp()
        FROM consumed WHERE operations.session_id=consumed.id AND operations.owner_user_id=consumed.owner_user_id
          AND operations.workspace_id=consumed.workspace_id AND operations.kind='pkce_verifier'
          AND operations.state NOT IN ('completed','dead_letter') RETURNING operations.id
      ) SELECT consumed.*,(SELECT count(*) FROM accelerated) AS cleanup_count FROM consumed
    `);
    const row = rows(result)[0];
    return row ? mapRow(row) : undefined;
  }
}

export class DrizzleOAuthAuthorizationSagaRepository implements OAuthAuthorizationSagaRepository {
  constructor(private readonly db: OAuthTransactionalDatabase) {}

  async claim(input: ClaimOAuthAuthorization): Promise<OAuthAuthorizationClaim | undefined> {
    class ClaimLost extends Error {}
    try{return await this.db.transaction(async(tx)=>{const result = await tx.execute(sql`
      WITH eligible AS (
        SELECT sessions.id, accounts.credential_version
        FROM ${aiMediaOAuthSessions} AS sessions
        INNER JOIN ${aiMediaProviderAccounts} AS accounts
          ON accounts.id = sessions.provider_account_id
         AND accounts.owner_user_id = sessions.owner_user_id
         AND accounts.workspace_id = sessions.workspace_id
         AND accounts.provider_key = sessions.platform
        WHERE sessions.state_digest = ${input.stateDigest}
          AND sessions.owner_user_id = ${input.scope.ownerUserId}
          AND sessions.workspace_id = ${input.scope.workspaceId}
          AND sessions.actor_user_id = ${input.actorUserId}
          AND sessions.provider_account_id = ${input.providerAccountId}
          AND sessions.platform = ${input.platform}
          AND sessions.expires_at > clock_timestamp()
          AND ${new Date(input.leaseExpiresAt)} > clock_timestamp()
          AND ${new Date(input.leaseExpiresAt)} <= clock_timestamp() + interval '5 minutes'
          AND ${new Date(input.leaseExpiresAt)} <= sessions.expires_at
          AND length(btrim(${input.leaseOwner})) BETWEEN 1 AND 255
          AND (
            (sessions.status = 'pending' AND sessions.exchange_status = 'not_started'
             AND sessions.authorization_code_digest IS NULL)
            OR
            (sessions.status = 'processing' AND sessions.lease_expires_at <= clock_timestamp()
             AND sessions.authorization_code_digest = ${input.codeDigest}
             AND sessions.exchange_status IN ('not_started', 'ready', 'in_progress')
             AND accounts.credential_version = sessions.expected_credential_version)
          )
        FOR UPDATE OF sessions
      )
      , claimed AS (UPDATE ${aiMediaOAuthSessions} AS sessions
      SET status = 'processing', lease_token = ${input.leaseToken}, lease_owner = ${input.leaseOwner},
          lease_expires_at = ${new Date(input.leaseExpiresAt)}, lease_fencing = sessions.lease_fencing + 1,
          authorization_code_digest = ${input.codeDigest},
          expected_credential_version = COALESCE(sessions.expected_credential_version, eligible.credential_version),
          target_credential_version = COALESCE(sessions.target_credential_version, eligible.credential_version + 1),
          token_binding_id = COALESCE(sessions.token_binding_id, gen_random_uuid()), updated_at = clock_timestamp()
      FROM eligible WHERE sessions.id = eligible.id
      RETURNING sessions.*), obligations AS (
        INSERT INTO ${aiMediaOAuthVaultOperations} (
          owner_user_id,workspace_id,actor_user_id,provider_account_id,platform,session_id,kind,reference,
          token_binding_id,authorization_code_digest,source_expires_at,target_credential_version,state,
          available_at,quiescent_until,created_at,updated_at
        ) SELECT claimed.owner_user_id,claimed.workspace_id,claimed.actor_user_id,claimed.provider_account_id,claimed.platform,claimed.id,
          obligation_values.kind,obligation_values.reference,claimed.token_binding_id,obligation_values.code_digest,obligation_values.source_expires_at,obligation_values.target_version,
          obligation_values.state,obligation_values.available_at,obligation_values.quiescent_until,clock_timestamp(),clock_timestamp()
        FROM claimed CROSS JOIN LATERAL (VALUES
          ('authorization_code','vault://ai-media-studio/oauth-code/v1/'||claimed.id,claimed.authorization_code_digest,claimed.expires_at,NULL::integer,'scheduled',claimed.expires_at,claimed.expires_at+interval '60 seconds'),
          ('token_credential','vault://ai-media-studio/oauth-token/v1/'||claimed.token_binding_id,NULL::text,NULL::timestamptz,claimed.target_credential_version,'retained','infinity'::timestamptz,'infinity'::timestamptz)
        ) obligation_values(kind,reference,code_digest,source_expires_at,target_version,state,available_at,quiescent_until)
        ON CONFLICT (kind,reference) DO UPDATE SET reference=EXCLUDED.reference
        WHERE ai_media_oauth_vault_operations.owner_user_id=EXCLUDED.owner_user_id
          AND ai_media_oauth_vault_operations.workspace_id=EXCLUDED.workspace_id
          AND ai_media_oauth_vault_operations.actor_user_id=EXCLUDED.actor_user_id
          AND ai_media_oauth_vault_operations.provider_account_id=EXCLUDED.provider_account_id
          AND ai_media_oauth_vault_operations.platform=EXCLUDED.platform
          AND ai_media_oauth_vault_operations.session_id=EXCLUDED.session_id
        RETURNING id
      ) SELECT claimed.*,(SELECT count(*) FROM obligations) AS cleanup_count FROM claimed
        WHERE (SELECT count(*) FROM obligations)=2
    `);
    const row = rows(result)[0];
    if(!row)throw new ClaimLost();return claimFromRow(row);});}catch(error){if(error instanceof ClaimLost)return undefined;throw error;}
  }

  async attachAuthorizationCode(input: OAuthLeaseCommand & { authorizationCodeRef: string }): Promise<OAuthAuthorizationClaim | undefined> {
    return this.claimMutation(input, sql`
      exchange_status = 'ready', authorization_code_ref = ${input.authorizationCodeRef}, updated_at = ${new Date(input.now)}
    `, sql`AND exchange_status = 'not_started' AND authorization_code_ref IS NULL`);
  }

  async markExchangeStarted(input: OAuthLeaseCommand): Promise<OAuthAuthorizationClaim | undefined> {
    return this.claimMutation(input, sql`exchange_status = 'in_progress', updated_at = ${new Date(input.now)}`,
      sql`AND exchange_status = 'ready' AND authorization_code_ref IS NOT NULL`);
  }

  async finalizeAuthorized(input: OAuthFinalizeAuthorization): Promise<OAuthSession | undefined> {
    class CasLost extends Error {}
    try {
      return await this.db.transaction(async (tx) => {
        const sessionResult = await tx.execute(sql`
          SELECT * FROM ${aiMediaOAuthSessions}
          WHERE id = ${input.sessionId} AND owner_user_id = ${input.scope.ownerUserId}
            AND workspace_id = ${input.scope.workspaceId} AND actor_user_id = ${input.actorUserId}
            AND provider_account_id = ${input.providerAccountId} AND platform = ${input.platform}
            AND status = 'processing' AND exchange_status = 'in_progress'
            AND lease_token = ${input.leaseToken} AND lease_fencing = ${input.leaseFencing}
            AND lease_expires_at > clock_timestamp() AND token_binding_id = ${input.descriptor.tokenBindingId}
          FOR UPDATE
        `);
        const raw = rows(sessionResult)[0];
        if (!raw) throw new CasLost();
        const session = mapRow(raw);
        if (session.expectedCredentialVersion == null || session.targetCredentialVersion == null) throw new CasLost();
        const accountResult = await tx.execute(sql`
          UPDATE ${aiMediaProviderAccounts}
          SET status = 'active', secret_ref = ${input.tokenReference}, external_account_id = ${input.descriptor.externalAccountId},
              capabilities = ${JSON.stringify(input.descriptor.capabilities)}::jsonb,
              granted_scopes = ${JSON.stringify(input.descriptor.scopes)}::jsonb,
              credential_status = 'active', credential_version = ${session.targetCredentialVersion},
              credential_expires_at = ${input.descriptor.accessTokenExpiresAt ? new Date(input.descriptor.accessTokenExpiresAt) : null},
              credential_refresh_expires_at = ${input.descriptor.refreshTokenExpiresAt ? new Date(input.descriptor.refreshTokenExpiresAt) : null},
              credential_refreshed_at = ${new Date(input.consumedAt)}, credential_source = 'oauth_authorization',
              credential_actor_user_id = ${input.actorUserId}, credential_source_session_id = ${input.sessionId},
              token_binding_id = ${input.descriptor.tokenBindingId}, token_kind = ${input.descriptor.tokenKind},
              token_manifest_revision = ${input.descriptor.manifestRevision}, updated_at = ${new Date(input.consumedAt)}
          WHERE id = ${input.providerAccountId} AND owner_user_id = ${input.scope.ownerUserId}
            AND workspace_id = ${input.scope.workspaceId} AND provider_key = ${input.platform}
            AND credential_version = ${session.expectedCredentialVersion}
            AND (external_account_id IS NULL OR external_account_id = ${input.descriptor.externalAccountId})
          RETURNING id
        `);
        if (rows(accountResult).length !== 1) throw new CasLost();
        const doneResult = await tx.execute(sql`
          WITH done AS (UPDATE ${aiMediaOAuthSessions}
          SET status = 'consumed', exchange_status = 'succeeded', outcome = 'authorized',
              consumed_at = ${new Date(input.consumedAt)}, lease_token = NULL, lease_owner = NULL,
              lease_expires_at = NULL, failure_code = NULL, updated_at = ${new Date(input.consumedAt)}
          WHERE id = ${input.sessionId} AND owner_user_id = ${input.scope.ownerUserId}
            AND workspace_id = ${input.scope.workspaceId} AND actor_user_id = ${input.actorUserId}
            AND provider_account_id = ${input.providerAccountId} AND platform = ${input.platform}
            AND status = 'processing' AND exchange_status = 'in_progress'
            AND lease_token = ${input.leaseToken} AND lease_fencing = ${input.leaseFencing}
            AND token_binding_id = ${input.descriptor.tokenBindingId}
          RETURNING *), cleanup AS (
            UPDATE ${aiMediaOAuthVaultOperations} operations
            SET state=CASE WHEN operations.kind='token_credential' THEN 'retained' ELSE 'scheduled' END,
                available_at=CASE WHEN operations.kind='token_credential' THEN 'infinity'::timestamptz ELSE clock_timestamp() END,
                quiescent_until=CASE WHEN operations.kind='token_credential' THEN 'infinity'::timestamptz ELSE clock_timestamp()+interval '60 seconds' END,
                lease_token=NULL,lease_owner=NULL,lease_expires_at=NULL,updated_at=clock_timestamp()
            FROM done WHERE operations.owner_user_id=done.owner_user_id AND operations.workspace_id=done.workspace_id
              AND operations.actor_user_id=done.actor_user_id AND operations.provider_account_id=done.provider_account_id
              AND operations.platform=done.platform AND operations.session_id=done.id AND operations.state NOT IN ('completed','dead_letter')
            RETURNING operations.id
          ) SELECT done.*,(SELECT count(*) FROM cleanup) AS cleanup_count FROM done
        `);
        const done = rows(doneResult)[0];
        if (!done) throw new CasLost();
        return mapRow(done);
      });
    } catch (error) {
      if (error instanceof CasLost) return undefined;
      throw error;
    }
  }

  async markIndeterminate(input: OAuthLeaseCommand & { failureCode: OAuthSession["failureCode"] }): Promise<OAuthSession | undefined> {
    if (!input.failureCode) return undefined;
    const result = await this.db.execute(sql`
      WITH failed AS (UPDATE ${aiMediaOAuthSessions}
      SET exchange_status = 'indeterminate', failure_code = ${input.failureCode},
          lease_token = NULL, lease_owner = NULL, lease_expires_at = NULL, updated_at = ${new Date(input.now)}
      WHERE id = ${input.sessionId} AND owner_user_id = ${input.scope.ownerUserId}
        AND workspace_id = ${input.scope.workspaceId} AND actor_user_id = ${input.actorUserId}
        AND provider_account_id = ${input.providerAccountId} AND platform = ${input.platform}
        AND status = 'processing' AND exchange_status = 'in_progress'
        AND lease_token = ${input.leaseToken} AND lease_fencing = ${input.leaseFencing}
        AND lease_expires_at > clock_timestamp()
      RETURNING *), accelerated AS (
        UPDATE ${aiMediaOAuthVaultOperations} operations
        SET state='scheduled',available_at=clock_timestamp(),quiescent_until=clock_timestamp()+interval '60 seconds',
            lease_token=NULL,lease_owner=NULL,lease_expires_at=NULL,updated_at=clock_timestamp()
        FROM failed WHERE operations.session_id=failed.id AND operations.owner_user_id=failed.owner_user_id
          AND operations.workspace_id=failed.workspace_id AND operations.state NOT IN ('completed','dead_letter') RETURNING operations.id
      ) SELECT failed.*,(SELECT count(*) FROM accelerated) AS cleanup_count FROM failed
    `);
    const row = rows(result)[0];
    return row ? mapRow(row) : undefined;
  }

  private async claimMutation(input: OAuthLeaseCommand, assignments: SQL, extra: SQL): Promise<OAuthAuthorizationClaim | undefined> {
    const result = await this.db.execute(sql`
      UPDATE ${aiMediaOAuthSessions} SET ${assignments}
      WHERE id = ${input.sessionId} AND owner_user_id = ${input.scope.ownerUserId}
        AND workspace_id = ${input.scope.workspaceId} AND actor_user_id = ${input.actorUserId}
        AND provider_account_id = ${input.providerAccountId} AND platform = ${input.platform}
        AND status = 'processing' AND lease_token = ${input.leaseToken}
        AND lease_fencing = ${input.leaseFencing} AND lease_expires_at > clock_timestamp() ${extra}
      RETURNING *
    `);
    const row = rows(result)[0];
    return row ? claimFromRow(row) : undefined;
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
