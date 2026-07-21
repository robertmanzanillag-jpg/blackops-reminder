import { sql, type SQL } from "drizzle-orm";
import { aiMediaOAuthSessions, aiMediaOAuthVaultOperations, aiMediaProviderAccounts } from "../../../shared/models/ai-media-studio-db";
import type { OAuthDatabase } from "./drizzle-repository";
import type { OAuthVaultCleanupItem, OAuthVaultCleanupRepository } from "./vault-cleanup-contracts";

type Result={rows?:unknown[]}|unknown[];
const rows=(result:Result):Record<string,unknown>[]=>{const value=Array.isArray(result)?result:result.rows;return Array.isArray(value)?value as Record<string,unknown>[]:[];};
const at=(row:Record<string,unknown>,snake:string,camel:string)=>row[snake]??row[camel];
const iso=(value:unknown)=>{const date=value instanceof Date?value:new Date(String(value));if(!Number.isFinite(date.getTime()))throw new Error("Invalid cleanup timestamp");return date.toISOString();};

export class DrizzleOAuthVaultCleanupRepository implements OAuthVaultCleanupRepository {
  constructor(private readonly db:OAuthDatabase){}

  async claimDue(input:Parameters<OAuthVaultCleanupRepository["claimDue"]>[0]):Promise<readonly OAuthVaultCleanupItem[]>{
    if(!Number.isSafeInteger(input.limit)||input.limit<1||input.limit>100)throw new Error("Invalid cleanup claim");
    const result=await this.db.execute(sql`
      WITH expired_candidates AS (
        SELECT sessions.id
        FROM ${aiMediaOAuthSessions} AS sessions
        WHERE sessions.status='processing' AND sessions.exchange_status='in_progress'
          AND sessions.expires_at <= clock_timestamp()
          AND sessions.lease_expires_at <= clock_timestamp()
        ORDER BY sessions.expires_at,sessions.id
        FOR UPDATE SKIP LOCKED LIMIT ${input.limit}
      ), expired_sagas AS (
        UPDATE ${aiMediaOAuthSessions} sessions
        SET exchange_status='indeterminate',failure_code='vault_unavailable',
            lease_token=NULL,lease_owner=NULL,lease_expires_at=NULL,updated_at=clock_timestamp()
        FROM expired_candidates WHERE sessions.id=expired_candidates.id
        RETURNING sessions.id
      ), accelerated_expired_obligations AS (
        UPDATE ${aiMediaOAuthVaultOperations} operations
        SET state='scheduled',available_at=clock_timestamp(),
            quiescent_until=clock_timestamp()+interval '60 seconds',
            lease_token=NULL,lease_owner=NULL,lease_expires_at=NULL,updated_at=clock_timestamp()
        FROM expired_sagas
        WHERE operations.session_id=expired_sagas.id
          AND operations.state NOT IN ('completed','dead_letter')
          AND (operations.state <> 'leased' OR operations.lease_expires_at <= clock_timestamp())
        RETURNING operations.id
      ), due AS (
        SELECT operations.id
        FROM ${aiMediaOAuthVaultOperations} AS operations
        INNER JOIN ${aiMediaOAuthSessions} AS sessions
          ON sessions.owner_user_id=operations.owner_user_id AND sessions.workspace_id=operations.workspace_id
         AND sessions.actor_user_id=operations.actor_user_id AND sessions.provider_account_id=operations.provider_account_id
         AND sessions.platform=operations.platform AND sessions.id=operations.session_id
        WHERE operations.state IN ('scheduled','retry_wait','verify_wait','leased')
          AND operations.available_at <= clock_timestamp() AND operations.quiescent_until <= clock_timestamp()
          AND (operations.state <> 'leased' OR operations.lease_expires_at <= clock_timestamp())
          AND operations.attempt < operations.max_attempts
          AND (SELECT count(*) FROM accelerated_expired_obligations) >= 0
          AND NOT EXISTS (SELECT 1 FROM expired_sagas WHERE expired_sagas.id=sessions.id)
          AND ${input.lease.leaseExpiresAt}::timestamptz > clock_timestamp()
          AND ${input.lease.leaseExpiresAt}::timestamptz <= clock_timestamp() + interval '5 minutes'
          AND length(btrim(${input.lease.leaseOwner})) BETWEEN 1 AND 255
          AND (
            (operations.kind IN ('pkce_verifier','authorization_code')
              AND (sessions.status='consumed' OR sessions.expires_at <= clock_timestamp()
                OR sessions.exchange_status IN ('failed','indeterminate')
                OR EXISTS (SELECT 1 FROM expired_sagas WHERE expired_sagas.id=sessions.id))
              AND (sessions.lease_expires_at IS NULL OR sessions.lease_expires_at <= clock_timestamp())
              AND (
                (operations.kind='pkce_verifier'
                  AND operations.reference=sessions.pkce_verifier_ref
                  AND operations.source_expires_at=sessions.expires_at)
                OR (operations.kind='authorization_code'
                  AND operations.reference='vault://ai-media-studio/oauth-code/v1/'||sessions.id
                  AND operations.token_binding_id=sessions.token_binding_id
                  AND operations.authorization_code_digest=sessions.authorization_code_digest
                  AND operations.source_expires_at=sessions.expires_at)
              ))
            OR (operations.kind='token_credential'
              AND (sessions.exchange_status IN ('failed','indeterminate')
                OR EXISTS (SELECT 1 FROM expired_sagas WHERE expired_sagas.id=sessions.id))
              AND (sessions.lease_token IS NULL OR sessions.lease_expires_at <= clock_timestamp())
              AND operations.reference='vault://ai-media-studio/oauth-token/v1/'||sessions.token_binding_id
              AND operations.token_binding_id=sessions.token_binding_id
              AND operations.target_credential_version=sessions.target_credential_version
              AND NOT EXISTS (SELECT 1 FROM ${aiMediaProviderAccounts} referenced_accounts
                WHERE referenced_accounts.secret_ref=operations.reference
                   OR referenced_accounts.token_binding_id=operations.token_binding_id)
              AND NOT EXISTS (SELECT 1 FROM ${aiMediaProviderAccounts} accounts
                WHERE accounts.owner_user_id=operations.owner_user_id AND accounts.workspace_id=operations.workspace_id
                  AND accounts.id=operations.provider_account_id AND accounts.provider_key=operations.platform
                  AND accounts.credential_source='oauth_authorization'
                  AND accounts.credential_actor_user_id=operations.actor_user_id
                  AND accounts.credential_source_session_id=operations.session_id
                  AND accounts.secret_ref=operations.reference AND accounts.token_binding_id=operations.token_binding_id
                  AND accounts.credential_version=operations.target_credential_version))
          )
        ORDER BY operations.available_at,operations.created_at,operations.id
        FOR UPDATE OF operations SKIP LOCKED LIMIT ${input.limit}
      )
      UPDATE ${aiMediaOAuthVaultOperations} operations
      SET state='leased',attempt=operations.attempt+1,lease_token=${input.lease.leaseToken},lease_owner=${input.lease.leaseOwner},
          lease_expires_at=${input.lease.leaseExpiresAt}::timestamptz,lease_fencing=operations.lease_fencing+1,
          last_error_code=NULL,updated_at=clock_timestamp()
      FROM due WHERE operations.id=due.id RETURNING operations.*
    `);
    return rows(result).map(mapRow);
  }

  async acknowledgeDelete(input:Parameters<OAuthVaultCleanupRepository["acknowledgeDelete"]>[0]):Promise<"verify_wait"|"completed"|undefined>{
    const result=await this.db.execute(sql`
      UPDATE ${aiMediaOAuthVaultOperations}
      SET state=CASE WHEN delete_pass=0 THEN 'verify_wait' ELSE 'completed' END,
          delete_pass=delete_pass+1,
          available_at=CASE WHEN delete_pass=0 THEN clock_timestamp()+interval '60 seconds' ELSE available_at END,
          quiescent_until=CASE WHEN delete_pass=0 THEN clock_timestamp()+interval '60 seconds' ELSE quiescent_until END,
          completed_at=CASE WHEN delete_pass=1 THEN clock_timestamp() ELSE NULL END,
          lease_token=NULL,lease_owner=NULL,lease_expires_at=NULL,last_error_code=NULL,updated_at=clock_timestamp()
      WHERE id=${input.id} AND state='leased' AND lease_token=${input.leaseToken}
        AND lease_fencing=${input.leaseFencing} AND lease_expires_at>clock_timestamp() AND delete_pass IN (0,1)
      RETURNING state
    `);const row=rows(result)[0];const state=row?.state;return state==="verify_wait"||state==="completed"?state:undefined;
  }

  async recordFailure(input:Parameters<OAuthVaultCleanupRepository["recordFailure"]>[0]):Promise<"retry_wait"|"dead_letter"|undefined>{
    const result=await this.db.execute(sql`
      UPDATE ${aiMediaOAuthVaultOperations}
      SET state=CASE WHEN attempt>=max_attempts THEN 'dead_letter' ELSE 'retry_wait' END,
          available_at=clock_timestamp()+interval '60 seconds',quiescent_until=clock_timestamp()+interval '60 seconds',
          dead_lettered_at=CASE WHEN attempt>=max_attempts THEN clock_timestamp() ELSE NULL END,
          last_error_code=${input.errorCode},lease_token=NULL,lease_owner=NULL,lease_expires_at=NULL,updated_at=clock_timestamp()
      WHERE id=${input.id} AND state='leased' AND lease_token=${input.leaseToken}
        AND lease_fencing=${input.leaseFencing} AND lease_expires_at>clock_timestamp()
      RETURNING state
    `);const row=rows(result)[0];return row?.state==="retry_wait"||row?.state==="dead_letter"?row.state:undefined;
  }
}

function mapRow(row:Record<string,unknown>):OAuthVaultCleanupItem{
  const kind=String(row.kind) as OAuthVaultCleanupItem["kind"];
  const scope={ownerUserId:String(at(row,"owner_user_id","ownerUserId")),workspaceId:String(at(row,"workspace_id","workspaceId"))};
  const common={...scope,actorUserId:String(at(row,"actor_user_id","actorUserId")),providerAccountId:String(at(row,"provider_account_id","providerAccountId")),
    platform:String(row.platform) as OAuthVaultCleanupItem["platform"],sessionId:String(at(row,"session_id","sessionId"))};
  const tokenBindingId=at(row,"token_binding_id","tokenBindingId");const digest=at(row,"authorization_code_digest","authorizationCodeDigest");
  const expires=at(row,"source_expires_at","sourceExpiresAt");const version=at(row,"target_credential_version","targetCredentialVersion");
  const context=kind==="pkce_verifier"?{purpose:"ai_media_oauth_pkce" as const,...common,expiresAt:iso(expires)}:
    kind==="authorization_code"?{purpose:"ai_media_oauth_authorization_code" as const,...common,tokenBindingId:String(tokenBindingId),codeDigest:String(digest),expiresAt:iso(expires)}:
      {purpose:"ai_media_oauth_token" as const,...common,targetCredentialVersion:Number(version),tokenBindingId:String(tokenBindingId)};
  return{id:String(row.id),scope,actorUserId:common.actorUserId,providerAccountId:common.providerAccountId,platform:common.platform,sessionId:common.sessionId,
    kind,reference:String(row.reference),context,state:String(row.state) as OAuthVaultCleanupItem["state"],attempt:Number(row.attempt),maxAttempts:Number(at(row,"max_attempts","maxAttempts")),
    deletePass:Number(at(row,"delete_pass","deletePass")) as 0|1,availableAt:iso(at(row,"available_at","availableAt")),quiescentUntil:iso(at(row,"quiescent_until","quiescentUntil")),
    leaseToken:String(at(row,"lease_token","leaseToken")),leaseOwner:String(at(row,"lease_owner","leaseOwner")),leaseExpiresAt:iso(at(row,"lease_expires_at","leaseExpiresAt")),leaseFencing:Number(at(row,"lease_fencing","leaseFencing"))};
}
