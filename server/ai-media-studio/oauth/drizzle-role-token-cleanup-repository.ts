import { sql } from "drizzle-orm";
import {
  aiMediaOAuthConnectionAttempts,
  aiMediaOAuthCredentialArtifacts,
  aiMediaOAuthVaultOperationsV2,
  aiMediaProviderAccountCredentialBindings,
  aiMediaProviderAccounts,
} from "../../../shared/models/ai-media-studio-db";
import type { OAuthDatabase } from "./drizzle-repository";
import type {
  OAuthRoleTokenCleanupItem,
  OAuthRoleTokenCleanupRepository,
} from "./role-token-cleanup-contracts";

type ExecuteResult = { rows?: unknown[] } | unknown[];
const rows = (result: ExecuteResult): Record<string, unknown>[] => {
  const value = Array.isArray(result) ? result : result.rows;
  return Array.isArray(value) ? value as Record<string, unknown>[] : [];
};
const at = (row: Record<string, unknown>, snake: string, camel: string): unknown => row[snake] ?? row[camel];
const iso = (value: unknown): string => {
  const date = value instanceof Date ? value : new Date(String(value));
  if (!Number.isFinite(date.getTime())) throw new Error("Invalid role token cleanup timestamp");
  return date.toISOString();
};

export class DrizzleOAuthRoleTokenCleanupRepository implements OAuthRoleTokenCleanupRepository {
  constructor(private readonly db: OAuthDatabase) {}

  async claimDue(
    input: Parameters<OAuthRoleTokenCleanupRepository["claimDue"]>[0],
  ): Promise<readonly OAuthRoleTokenCleanupItem[]> {
    if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 100
      || typeof input.lease.leaseToken !== "string" || typeof input.lease.leaseOwner !== "string"
      || typeof input.lease.leaseExpiresAt !== "string") throw new Error("Invalid role token cleanup claim");

    const result = await this.db.execute(sql`
      WITH due AS (
        SELECT operation.id
        FROM ${aiMediaOAuthVaultOperationsV2} operation
        INNER JOIN ${aiMediaOAuthCredentialArtifacts} artifact
          ON artifact.id=operation.artifact_id
         AND artifact.owner_user_id=operation.owner_user_id AND artifact.workspace_id=operation.workspace_id
         AND artifact.actor_user_id=operation.actor_user_id AND artifact.provider_account_id=operation.provider_account_id
         AND artifact.platform=operation.platform AND artifact.oauth_session_id=operation.oauth_session_id
         AND artifact.attempt_id=operation.attempt_id AND artifact.credential_binding_id=operation.credential_binding_id
         AND artifact.artifact_binding_id=operation.artifact_binding_id AND artifact.role=operation.role
         AND artifact.vault_reference=operation.vault_reference
        INNER JOIN ${aiMediaProviderAccountCredentialBindings} binding
          ON binding.id=operation.credential_binding_id
         AND binding.owner_user_id=operation.owner_user_id AND binding.workspace_id=operation.workspace_id
         AND binding.actor_user_id=operation.actor_user_id AND binding.provider_account_id=operation.provider_account_id
         AND binding.platform=operation.platform AND binding.oauth_session_id=operation.oauth_session_id
         AND binding.attempt_id=operation.attempt_id AND binding.artifact_binding_id=operation.artifact_binding_id
         AND binding.target_credential_version=operation.target_credential_version
        INNER JOIN ${aiMediaOAuthConnectionAttempts} connection_attempt
          ON connection_attempt.id=binding.attempt_id
         AND connection_attempt.owner_user_id=binding.owner_user_id AND connection_attempt.workspace_id=binding.workspace_id
         AND connection_attempt.actor_user_id=binding.actor_user_id
         AND connection_attempt.provider_account_id=binding.provider_account_id
         AND connection_attempt.platform=binding.platform AND connection_attempt.oauth_session_id=binding.oauth_session_id
         AND connection_attempt.token_binding_id=binding.token_binding_id
         AND connection_attempt.target_credential_version=binding.target_credential_version
         AND connection_attempt.manifest_revision=binding.manifest_revision
        INNER JOIN ${aiMediaProviderAccounts} account_record
          ON account_record.id=binding.provider_account_id
         AND account_record.owner_user_id=binding.owner_user_id AND account_record.workspace_id=binding.workspace_id
         AND account_record.provider_key=binding.platform
        WHERE operation.state IN ('cleanup_pending','retry_wait','verify_wait')
          AND operation.available_at<=clock_timestamp() AND operation.quiescent_until<=clock_timestamp()
          AND operation.attempt<operation.max_attempts
          AND binding.state='abandoned'
          AND connection_attempt.stage IN ('activation_indeterminate','failed')
          AND ((operation.state='cleanup_pending' AND artifact.state='candidate')
            OR (operation.state='retry_wait' AND artifact.state='cleanup_retry')
            OR (operation.state='verify_wait' AND artifact.state='cleanup_verify'))
          AND ${input.lease.leaseExpiresAt}::timestamptz>clock_timestamp()
          AND ${input.lease.leaseExpiresAt}::timestamptz<=clock_timestamp()+interval '5 minutes'
          AND length(btrim(${input.lease.leaseOwner})) BETWEEN 1 AND 255
          AND NOT EXISTS (SELECT 1 FROM ${aiMediaProviderAccounts} account
            WHERE account.credential_source='oauth_role_v2' AND account.status='active'
              AND account.credential_status='active'
              AND (account.credential_binding_id=binding.id OR account.token_binding_id=binding.token_binding_id))
          AND NOT EXISTS (SELECT 1 FROM ${aiMediaProviderAccountCredentialBindings} authorized_binding
            WHERE authorized_binding.id=binding.id AND authorized_binding.state='authorized')
          AND NOT EXISTS (SELECT 1 FROM ${aiMediaOAuthCredentialArtifacts} active_artifact
            WHERE active_artifact.id=artifact.id AND active_artifact.state='active')
          AND NOT EXISTS (SELECT 1 FROM ${aiMediaOAuthVaultOperationsV2} retained_operation
            WHERE retained_operation.id=operation.id AND retained_operation.state='retained')
        ORDER BY operation.available_at,operation.created_at,operation.id
        FOR UPDATE OF operation,artifact,binding,account_record SKIP LOCKED
        LIMIT ${input.limit}
      ), leased_operations AS (
        UPDATE ${aiMediaOAuthVaultOperationsV2} operation
        SET state='leased',attempt=operation.attempt+1,lease_token=${input.lease.leaseToken},
          lease_owner=${input.lease.leaseOwner},lease_expires_at=${input.lease.leaseExpiresAt}::timestamptz,
          lease_fencing=operation.lease_fencing+1,last_error_code=NULL,updated_at=clock_timestamp()
        FROM due WHERE operation.id=due.id
        RETURNING operation.*
      ), leased_artifacts AS (
        UPDATE ${aiMediaOAuthCredentialArtifacts} artifact
        SET state='cleanup_leased',updated_at=clock_timestamp()
        FROM leased_operations operation WHERE artifact.id=operation.artifact_id
        RETURNING artifact.id
      )
      SELECT operation.*,binding.candidate_id,binding.target_kind,binding.target_external_id,
        binding.selection_digest,binding.manifest_revision,binding.token_binding_id,
        artifact.selected_eligibility_digest
      FROM leased_operations operation
      INNER JOIN leased_artifacts changed_artifact ON changed_artifact.id=operation.artifact_id
      INNER JOIN ${aiMediaProviderAccountCredentialBindings} binding ON binding.id=operation.credential_binding_id
      INNER JOIN ${aiMediaOAuthCredentialArtifacts} artifact ON artifact.id=operation.artifact_id
      ORDER BY operation.available_at,operation.created_at,operation.id
    `);
    return rows(result).map(mapRow);
  }

  async acknowledgeDelete(
    input: Parameters<OAuthRoleTokenCleanupRepository["acknowledgeDelete"]>[0],
  ): Promise<"verify_wait" | "completed" | undefined> {
    const result = await this.db.execute(sql`
      WITH locked AS (
        SELECT operation.id,operation.artifact_id
        FROM ${aiMediaOAuthVaultOperationsV2} operation
        INNER JOIN ${aiMediaOAuthCredentialArtifacts} artifact
          ON artifact.id=operation.artifact_id AND artifact.credential_binding_id=operation.credential_binding_id
         AND artifact.artifact_binding_id=operation.artifact_binding_id AND artifact.vault_reference=operation.vault_reference
        INNER JOIN ${aiMediaProviderAccountCredentialBindings} binding
          ON binding.id=operation.credential_binding_id AND binding.state='abandoned'
        INNER JOIN ${aiMediaOAuthConnectionAttempts} connection_attempt
          ON connection_attempt.id=binding.attempt_id AND connection_attempt.stage IN ('activation_indeterminate','failed')
        INNER JOIN ${aiMediaProviderAccounts} account_record
          ON account_record.id=binding.provider_account_id AND account_record.owner_user_id=binding.owner_user_id
         AND account_record.workspace_id=binding.workspace_id AND account_record.provider_key=binding.platform
        WHERE operation.id=${input.id} AND operation.state='leased' AND artifact.state='cleanup_leased'
          AND operation.lease_token=${input.leaseToken} AND operation.lease_fencing=${input.leaseFencing}
          AND operation.lease_expires_at>clock_timestamp() AND operation.delete_pass IN (0,1)
          AND NOT (account_record.credential_source='oauth_role_v2' AND account_record.status='active'
            AND account_record.credential_status='active')
          AND NOT EXISTS (SELECT 1 FROM ${aiMediaProviderAccounts} active_account
            WHERE active_account.credential_source='oauth_role_v2' AND active_account.status='active'
              AND active_account.credential_status='active'
              AND (active_account.credential_binding_id=binding.id OR active_account.token_binding_id=binding.token_binding_id))
        FOR UPDATE OF operation,artifact,binding,account_record
      ), changed_operation AS (
        UPDATE ${aiMediaOAuthVaultOperationsV2} operation SET
          state=CASE WHEN operation.delete_pass=0 THEN 'verify_wait' ELSE 'completed' END,
          delete_pass=operation.delete_pass+1,
          available_at=CASE WHEN operation.delete_pass=0 THEN clock_timestamp()+interval '60 seconds' ELSE operation.available_at END,
          quiescent_until=CASE WHEN operation.delete_pass=0 THEN clock_timestamp()+interval '60 seconds' ELSE operation.quiescent_until END,
          lease_token=NULL,lease_owner=NULL,lease_expires_at=NULL,last_error_code=NULL,
          completed_at=CASE WHEN operation.delete_pass=1 THEN clock_timestamp() ELSE NULL END,
          updated_at=clock_timestamp()
        FROM locked WHERE operation.id=locked.id
        RETURNING operation.id,operation.artifact_id,operation.state,operation.delete_pass
      ), changed_artifact AS (
        UPDATE ${aiMediaOAuthCredentialArtifacts} artifact SET
          state=CASE WHEN changed_operation.delete_pass=1 THEN 'cleanup_verify' ELSE 'deleted' END,
          cleanup_completed_at=CASE WHEN changed_operation.delete_pass=2 THEN clock_timestamp() ELSE NULL END,
          updated_at=clock_timestamp()
        FROM changed_operation WHERE artifact.id=changed_operation.artifact_id AND artifact.state='cleanup_leased'
        RETURNING artifact.id
      )
      SELECT changed_operation.state FROM changed_operation
      INNER JOIN changed_artifact ON changed_artifact.id=changed_operation.artifact_id
    `);
    const state = rows(result)[0]?.state;
    return state === "verify_wait" || state === "completed" ? state : undefined;
  }

  async recordFailure(
    input: Parameters<OAuthRoleTokenCleanupRepository["recordFailure"]>[0],
  ): Promise<"retry_wait" | "dead_letter" | undefined> {
    const result = await this.db.execute(sql`
      WITH locked AS (
        SELECT operation.id,operation.artifact_id
        FROM ${aiMediaOAuthVaultOperationsV2} operation
        INNER JOIN ${aiMediaOAuthCredentialArtifacts} artifact
          ON artifact.id=operation.artifact_id AND artifact.credential_binding_id=operation.credential_binding_id
         AND artifact.artifact_binding_id=operation.artifact_binding_id AND artifact.vault_reference=operation.vault_reference
        INNER JOIN ${aiMediaProviderAccountCredentialBindings} binding
          ON binding.id=operation.credential_binding_id AND binding.state='abandoned'
        INNER JOIN ${aiMediaOAuthConnectionAttempts} connection_attempt
          ON connection_attempt.id=binding.attempt_id AND connection_attempt.stage IN ('activation_indeterminate','failed')
        INNER JOIN ${aiMediaProviderAccounts} account_record
          ON account_record.id=binding.provider_account_id AND account_record.owner_user_id=binding.owner_user_id
         AND account_record.workspace_id=binding.workspace_id AND account_record.provider_key=binding.platform
        WHERE operation.id=${input.id} AND operation.state='leased' AND artifact.state='cleanup_leased'
          AND operation.lease_token=${input.leaseToken} AND operation.lease_fencing=${input.leaseFencing}
          AND operation.lease_expires_at>clock_timestamp()
          AND NOT (account_record.credential_source='oauth_role_v2' AND account_record.status='active'
            AND account_record.credential_status='active')
          AND NOT EXISTS (SELECT 1 FROM ${aiMediaProviderAccounts} active_account
            WHERE active_account.credential_source='oauth_role_v2' AND active_account.status='active'
              AND active_account.credential_status='active'
              AND (active_account.credential_binding_id=binding.id OR active_account.token_binding_id=binding.token_binding_id))
        FOR UPDATE OF operation,artifact,binding,account_record
      ), changed_operation AS (
        UPDATE ${aiMediaOAuthVaultOperationsV2} operation SET
          state=CASE WHEN operation.attempt>=operation.max_attempts THEN 'dead_letter' ELSE 'retry_wait' END,
          available_at=CASE WHEN operation.attempt>=operation.max_attempts THEN operation.available_at
            ELSE clock_timestamp()+least(interval '1 hour',interval '5 seconds'*power(2,greatest(operation.attempt-1,0))) END,
          quiescent_until=CASE WHEN operation.attempt>=operation.max_attempts THEN operation.quiescent_until
            ELSE clock_timestamp()+least(interval '1 hour',interval '5 seconds'*power(2,greatest(operation.attempt-1,0))) END,
          lease_token=NULL,lease_owner=NULL,lease_expires_at=NULL,last_error_code=${input.errorCode},
          dead_lettered_at=CASE WHEN operation.attempt>=operation.max_attempts THEN clock_timestamp() ELSE NULL END,
          updated_at=clock_timestamp()
        FROM locked WHERE operation.id=locked.id
          AND ${input.errorCode} IN ('vault_rejected','vault_timeout','lease_lost','invalid_obligation')
        RETURNING operation.id,operation.artifact_id,operation.state
      ), changed_artifact AS (
        UPDATE ${aiMediaOAuthCredentialArtifacts} artifact SET
          state=CASE WHEN changed_operation.state='dead_letter' THEN 'cleanup_dead_letter' ELSE 'cleanup_retry' END,
          updated_at=clock_timestamp()
        FROM changed_operation WHERE artifact.id=changed_operation.artifact_id AND artifact.state='cleanup_leased'
        RETURNING artifact.id
      )
      SELECT changed_operation.state FROM changed_operation
      INNER JOIN changed_artifact ON changed_artifact.id=changed_operation.artifact_id
    `);
    const state = rows(result)[0]?.state;
    return state === "retry_wait" || state === "dead_letter" ? state : undefined;
  }
}

function mapRow(row: Record<string, unknown>): OAuthRoleTokenCleanupItem {
  const role = String(row.role) as OAuthRoleTokenCleanupItem["role"];
  const context = {
    purpose: "ai_media_oauth_role_token_v2" as const,
    ownerUserId: String(at(row, "owner_user_id", "ownerUserId")),
    workspaceId: String(at(row, "workspace_id", "workspaceId")),
    actorUserId: String(at(row, "actor_user_id", "actorUserId")),
    providerAccountId: String(at(row, "provider_account_id", "providerAccountId")),
    platform: String(row.platform) as OAuthRoleTokenCleanupItem["platform"],
    sessionId: String(at(row, "oauth_session_id", "oauthSessionId")),
    attemptId: String(at(row, "attempt_id", "attemptId")),
    targetCredentialVersion: Number(at(row, "target_credential_version", "targetCredentialVersion")),
    tokenBindingId: String(at(row, "token_binding_id", "tokenBindingId")),
    artifactBindingId: String(at(row, "artifact_binding_id", "artifactBindingId")),
    role,
    candidateId: String(at(row, "candidate_id", "candidateId")),
    targetKind: String(at(row, "target_kind", "targetKind")) as OAuthRoleTokenCleanupItem["context"]["targetKind"],
    targetId: String(at(row, "target_external_id", "targetExternalId")),
    selectionDigest: String(at(row, "selection_digest", "selectionDigest")),
    manifestRevision: String(at(row, "manifest_revision", "manifestRevision")),
  };
  const deletePass = Number(at(row, "delete_pass", "deletePass"));
  if (deletePass !== 0 && deletePass !== 1) throw new Error("Invalid role token cleanup row");
  return Object.freeze({
    id: String(row.id),
    scope: Object.freeze({ ownerUserId: context.ownerUserId, workspaceId: context.workspaceId }),
    actorUserId: context.actorUserId,
    providerAccountId: context.providerAccountId,
    platform: context.platform,
    oauthSessionId: context.sessionId,
    attemptId: context.attemptId,
    credentialBindingId: String(at(row, "credential_binding_id", "credentialBindingId")),
    artifactId: String(at(row, "artifact_id", "artifactId")),
    artifactBindingId: context.artifactBindingId,
    role,
    vaultReference: String(at(row, "vault_reference", "vaultReference")),
    context: Object.freeze(context),
    state: "leased",
    attempt: Number(row.attempt),
    maxAttempts: Number(at(row, "max_attempts", "maxAttempts")),
    deletePass,
    availableAt: iso(at(row, "available_at", "availableAt")),
    quiescentUntil: iso(at(row, "quiescent_until", "quiescentUntil")),
    leaseToken: String(at(row, "lease_token", "leaseToken")),
    leaseOwner: String(at(row, "lease_owner", "leaseOwner")),
    leaseExpiresAt: iso(at(row, "lease_expires_at", "leaseExpiresAt")),
    leaseFencing: Number(at(row, "lease_fencing", "leaseFencing")),
  });
}
