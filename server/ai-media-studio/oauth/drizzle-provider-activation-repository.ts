import { sql, type SQL } from "drizzle-orm";
import {
  aiMediaOAuthConnectionAttempts,
  aiMediaOAuthCredentialArtifacts,
  aiMediaOAuthTargetCandidates,
  aiMediaOAuthTargetSelections,
  aiMediaOAuthVaultOperationsV2,
  aiMediaProviderAccountCredentialBindings,
  aiMediaProviderAccounts,
} from "../../../shared/models/ai-media-studio-db";
import type { TenantScope } from "../core/resource-domain";
import {
  OAuthProviderConnectionError,
  deriveOAuthProviderAuthorizedDigest,
  deriveOAuthProviderActivationIndeterminateDigest,
  deriveOAuthProviderCapabilities,
  deriveOAuthProviderSelectionDigest,
  validateOAuthProviderActivationArtifacts,
  validateOAuthProviderScopes,
  type ClaimOAuthProviderConnectionStage,
  type FinalizeOAuthProviderActivation,
  type FinalizeDurableOAuthProviderActivation,
  type DurableOAuthProviderActivationResult,
  type OAuthProviderActivationAccount,
  type OAuthProviderActivationArtifactEvidence,
  type OAuthProviderActivationResult,
  type OAuthProviderActivationStageResult,
  type OAuthProviderConnectionAttempt,
  type OAuthProviderConnectionFence,
  type OAuthProviderDurableActivationRepository,
  type RecoverExpiredOAuthProviderActivation,
  type StageOAuthProviderActivation,
  type StageOAuthProviderActivationArtifact,
  type StagedOAuthProviderActivation,
} from "./provider-connection-contracts";
import {
  DrizzleOAuthProviderConnectionRepository,
  type OAuthProviderConnectionDatabase,
  type OAuthProviderConnectionTransactionalDatabase,
} from "./drizzle-provider-connection-repository";

type ExecuteResult = { rows?: unknown[] } | unknown[];
type Row = Record<string, unknown>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
class ActivationCasLost extends Error {}

function rows(result: ExecuteResult): Row[] {
  const resultRows = Array.isArray(result) ? result : result.rows;
  return Array.isArray(resultRows) ? resultRows as Row[] : [];
}

function value(row: Row, camel: string, snake: string): unknown { return row[camel] ?? row[snake]; }
function iso(raw: unknown): string {
  const date = raw instanceof Date ? raw : new Date(String(raw));
  if (!Number.isFinite(date.getTime())) throw new OAuthProviderConnectionError();
  return date.toISOString();
}
function stringArray(raw: unknown): string[] {
  const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string")) throw new OAuthProviderConnectionError();
  return parsed;
}
function requiredUuid(...values: string[]): void {
  if (values.some((item) => !UUID.test(item))) throw new OAuthProviderConnectionError();
}
function canonical(values: readonly string[]): readonly string[] {
  if (!Array.isArray(values) || values.length < 1 || new Set(values).size !== values.length) throw new OAuthProviderConnectionError();
  return Object.freeze([...values].sort());
}
function equalList(left: readonly string[], right: readonly string[]): boolean {
  return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
}
function equalStageArtifacts(left: readonly StageOAuthProviderActivationArtifact[], right: readonly StageOAuthProviderActivationArtifact[]): boolean {
  const normalize = (artifact: StageOAuthProviderActivationArtifact) => ({ artifactId: artifact.artifactId,
    cleanupOperationId: artifact.cleanupOperationId, role: artifact.role, artifactBindingId: artifact.artifactBindingId,
    vaultReference: artifact.vaultReference, manifestRevision: artifact.manifestRevision, lifetime: artifact.lifetime });
  return JSON.stringify(left.map(normalize)) === JSON.stringify(right.map(normalize));
}
function dbArtifact(row: Row): OAuthProviderActivationArtifactEvidence {
  const lifetimeKind = String(value(row, "lifetimeKind", "lifetime_kind"));
  return {
    role: String(row.role) as OAuthProviderActivationArtifactEvidence["role"],
    artifactBindingId: String(value(row, "artifactBindingId", "artifact_binding_id")),
    vaultReference: String(value(row, "vaultReference", "vault_reference")),
    manifestRevision: String(value(row, "manifestRevision", "manifest_revision")),
    lifetime: lifetimeKind === "expires_at"
      ? { kind: "expires_at", expiresAt: iso(value(row, "expiresAt", "expires_at")), revalidateAt: iso(value(row, "revalidateAt", "revalidate_at")) }
      : { kind: lifetimeKind as "provider_non_expiring" | "revocation_bound", revalidateAt: iso(value(row, "revalidateAt", "revalidate_at")) },
  };
}

export class DrizzleOAuthProviderActivationRepository
  extends DrizzleOAuthProviderConnectionRepository implements OAuthProviderDurableActivationRepository {
  constructor(db: OAuthProviderConnectionTransactionalDatabase) { super(db); }

  override async claim(input: ClaimOAuthProviderConnectionStage) {
    if (input.stage !== "activation_pending") return super.claim(input);
    requiredUuid(input.attemptId, input.leaseToken);
    return this.db.transaction(async (tx) => {
      if (!await this.lockAccountFirst(tx, input.scope, input.attemptId)) return undefined;
      const attempt = rows(await tx.execute(sql`SELECT * FROM ${aiMediaOAuthConnectionAttempts}
        WHERE id=${input.attemptId} AND owner_user_id=${input.scope.ownerUserId}
          AND workspace_id=${input.scope.workspaceId} FOR UPDATE`))[0];
      if (!attempt) return undefined;
      await tx.execute(sql`SELECT 1 FROM ${aiMediaOAuthTargetSelections} selections JOIN ${aiMediaOAuthTargetCandidates} candidates
        ON candidates.attempt_id=selections.attempt_id AND candidates.candidate_id=selections.candidate_id
        AND candidates.owner_user_id=selections.owner_user_id AND candidates.workspace_id=selections.workspace_id
        AND candidates.actor_user_id=selections.actor_user_id AND candidates.provider_account_id=selections.provider_account_id
        AND candidates.platform=selections.platform AND candidates.oauth_session_id=selections.oauth_session_id
        AND candidates.target_kind=selections.target_kind AND candidates.target_external_id=selections.target_external_id
        WHERE selections.attempt_id=${input.attemptId} FOR UPDATE OF selections,candidates`);
      const bindings = rows(await tx.execute(sql`SELECT id,state FROM ${aiMediaProviderAccountCredentialBindings}
        WHERE attempt_id=${input.attemptId} AND owner_user_id=${input.scope.ownerUserId}
          AND workspace_id=${input.scope.workspaceId} FOR UPDATE`));
      if (bindings.length > 0) return undefined;
      const claimed = rows(await tx.execute(sql`UPDATE ${aiMediaOAuthConnectionAttempts}
        SET stage='activation_in_progress',stage_version=stage_version+1,lease_token=${input.leaseToken},
          lease_owner=${input.leaseOwner},lease_expires_at=${new Date(input.leaseExpiresAt)},
          lease_fencing=lease_fencing+1,updated_at=clock_timestamp()
        WHERE id=${input.attemptId} AND owner_user_id=${input.scope.ownerUserId}
          AND workspace_id=${input.scope.workspaceId} AND expires_at>clock_timestamp()
          AND ${new Date(input.leaseExpiresAt)}>clock_timestamp()
          AND ${new Date(input.leaseExpiresAt)}<=clock_timestamp()+interval '5 minutes'
          AND ${new Date(input.leaseExpiresAt)}<=expires_at AND length(btrim(${input.leaseOwner})) BETWEEN 1 AND 255
          AND (stage='activation_pending' OR (stage='activation_in_progress' AND lease_expires_at<=clock_timestamp()))
        RETURNING *`))[0];
      if (!claimed) return undefined;
      const projected = await this.readAttempt(tx, input.scope, input.attemptId, claimed);
      if (!projected?.leaseToken || !projected.leaseOwner || !projected.leaseExpiresAt) throw new ActivationCasLost();
      return { attempt: projected, leaseToken: projected.leaseToken, leaseOwner: projected.leaseOwner,
        leaseExpiresAt: projected.leaseExpiresAt, leaseFencing: projected.leaseFencing };
    });
  }

  async stageActivation(input: StageOAuthProviderActivation): Promise<OAuthProviderActivationStageResult | undefined> {
    requiredUuid(input.attemptId, input.leaseToken, input.credentialBindingId, input.tokenBindingId, input.artifactBindingId);
    if (input.artifacts.some((artifact) => !UUID.test(artifact.artifactId) || !UUID.test(artifact.cleanupOperationId))) {
      throw new OAuthProviderConnectionError();
    }
    return this.db.transaction(async (tx) => {
      const accountRow = await this.lockAccountFirst(tx, input.scope, input.attemptId);
      if (!accountRow) return undefined;
      const attemptRows = rows(await tx.execute(sql`SELECT *,clock_timestamp() AS database_now
        FROM ${aiMediaOAuthConnectionAttempts} WHERE id=${input.attemptId}
          AND owner_user_id=${input.scope.ownerUserId} AND workspace_id=${input.scope.workspaceId} FOR UPDATE`));
      const attemptRow = attemptRows[0];
      if (!attemptRow) return undefined;
      const databaseNow = iso(value(attemptRow, "databaseNow", "database_now"));
      const attempt = await this.readAttempt(tx, input.scope, input.attemptId, attemptRow);
      if (!attempt) return undefined;

      const evidenceRows = rows(await tx.execute(sql`SELECT selections.*,candidates.eligibility_digest,
          candidates.verified_tasks,candidates.capabilities,candidates.manifest_revision AS candidate_manifest_revision
        FROM ${aiMediaOAuthTargetSelections} selections JOIN ${aiMediaOAuthTargetCandidates} candidates
          ON candidates.owner_user_id=selections.owner_user_id AND candidates.workspace_id=selections.workspace_id
          AND candidates.actor_user_id=selections.actor_user_id AND candidates.provider_account_id=selections.provider_account_id
          AND candidates.platform=selections.platform AND candidates.oauth_session_id=selections.oauth_session_id
          AND candidates.attempt_id=selections.attempt_id AND candidates.candidate_id=selections.candidate_id
          AND candidates.target_kind=selections.target_kind AND candidates.target_external_id=selections.target_external_id
        WHERE selections.attempt_id=${input.attemptId} AND selections.owner_user_id=${input.scope.ownerUserId}
          AND selections.workspace_id=${input.scope.workspaceId} FOR UPDATE OF selections,candidates`));
      if (evidenceRows.length !== 1) return undefined;
      this.validateStageEvidence(attempt, evidenceRows[0]!, input, databaseNow);

      const existing = rows(await tx.execute(sql`SELECT * FROM ${aiMediaProviderAccountCredentialBindings}
        WHERE id=${input.credentialBindingId} FOR UPDATE`));
      if (existing.length > 0) return this.readExactStagedReplay(tx, attempt, existing[0]!, input, databaseNow);
      if (attempt.stage !== "activation_in_progress" || attempt.stageVersion !== input.activationStageVersion
        || attempt.leaseToken !== input.leaseToken || attempt.leaseFencing !== input.leaseFencing
        || !attempt.leaseExpiresAt || Date.parse(attempt.leaseExpiresAt) <= Date.parse(databaseNow)) return undefined;
      if (Number(value(accountRow, "credentialVersion", "credential_version")) !== input.expectedCredentialVersion
        || String(accountRow.status) !== "disconnected") return undefined;

      const insertedBinding = rows(await tx.execute(sql`INSERT INTO ${aiMediaProviderAccountCredentialBindings} (
        id,owner_user_id,workspace_id,actor_user_id,provider_account_id,platform,oauth_session_id,attempt_id,
        candidate_id,target_kind,target_external_id,selection_digest,selected_stage_version,activation_stage_version,
        selected_eligibility_digest,token_binding_id,artifact_binding_id,expected_credential_version,
        target_credential_version,actual_scopes,capabilities,manifest_revision,state,created_at,updated_at
      ) VALUES (${input.credentialBindingId},${attempt.scope.ownerUserId},${attempt.scope.workspaceId},${input.actorUserId},
        ${attempt.providerAccountId},${attempt.platform},${attempt.oauthSessionId},${attempt.id},${input.selectedCandidateId},
        ${input.selectedTargetKind},${input.selectedTargetId},${input.selectionDigest},${input.selectedStageVersion},
        ${input.activationStageVersion},${input.selectedEligibilityDigest},${input.tokenBindingId},${input.artifactBindingId},
        ${input.expectedCredentialVersion},${input.targetCredentialVersion},${JSON.stringify(canonical(input.actualScopes))}::jsonb,
        ${JSON.stringify(canonical(input.capabilities))}::jsonb,${input.manifestRevision},'staged',clock_timestamp(),clock_timestamp())
        RETURNING created_at`));
      if (insertedBinding.length !== 1) throw new ActivationCasLost();
      for (const artifact of input.artifacts) {
        await this.insertArtifactGraph(tx, attempt, input, artifact);
      }
      await tx.execute(sql`SET CONSTRAINTS ALL IMMEDIATE`);
      return { state: "staged", credentialBindingId: input.credentialBindingId, artifactBindingId: input.artifactBindingId,
        artifacts: Object.freeze(input.artifacts.map((artifact) => Object.freeze({ ...artifact }))),
        stagedAt: iso(value(insertedBinding[0]!, "createdAt", "created_at")) };
    });
  }

  async getActivationAccount(scope: TenantScope, providerAccountId: string, platform: OAuthProviderActivationAccount["platform"]): Promise<OAuthProviderActivationAccount | undefined> {
    const accountRows = rows(await this.db.execute(sql`SELECT * FROM ${aiMediaProviderAccounts}
      WHERE owner_user_id=${scope.ownerUserId} AND workspace_id=${scope.workspaceId}
        AND id=${providerAccountId} AND provider_key=${platform}`));
    return accountRows[0] ? this.accountFromRow(this.db, accountRows[0]!) : undefined;
  }

  async finalizeActivation(_input: FinalizeOAuthProviderActivation): Promise<OAuthProviderActivationResult | undefined> {
    // The durable implementation never guesses a binding from an attempt id.
    return undefined;
  }

  async finalizeStagedActivation(input: FinalizeDurableOAuthProviderActivation): Promise<DurableOAuthProviderActivationResult | undefined> {
    try { return await this.finalizeInternal(input); }
    catch (error) { if (error instanceof ActivationCasLost) return undefined; throw error; }
  }

  private async finalizeInternal(input: FinalizeDurableOAuthProviderActivation): Promise<DurableOAuthProviderActivationResult | undefined> {
    requiredUuid(input.attemptId, input.leaseToken, input.tokenBindingId, input.artifactBindingId);
    requiredUuid(input.credentialBindingId);
    return this.db.transaction(async (tx) => {
      const accountRow = await this.lockAccountFirst(tx, input.scope, input.attemptId);
      if (!accountRow) return undefined;
      const attemptRow = rows(await tx.execute(sql`SELECT *,clock_timestamp() AS database_now
        FROM ${aiMediaOAuthConnectionAttempts} WHERE id=${input.attemptId}
          AND owner_user_id=${input.scope.ownerUserId} AND workspace_id=${input.scope.workspaceId} FOR UPDATE`))[0];
      if (!attemptRow) return undefined;
      const evidence = rows(await tx.execute(sql`SELECT selections.*,candidates.eligibility_digest,candidates.verified_tasks,
          candidates.capabilities,candidates.manifest_revision AS candidate_manifest_revision
        FROM ${aiMediaOAuthTargetSelections} selections JOIN ${aiMediaOAuthTargetCandidates} candidates
          ON candidates.attempt_id=selections.attempt_id AND candidates.candidate_id=selections.candidate_id
          AND candidates.owner_user_id=selections.owner_user_id AND candidates.workspace_id=selections.workspace_id
          AND candidates.actor_user_id=selections.actor_user_id AND candidates.provider_account_id=selections.provider_account_id
          AND candidates.platform=selections.platform AND candidates.oauth_session_id=selections.oauth_session_id
          AND candidates.target_kind=selections.target_kind AND candidates.target_external_id=selections.target_external_id
        WHERE selections.attempt_id=${input.attemptId} AND selections.owner_user_id=${input.scope.ownerUserId}
          AND selections.workspace_id=${input.scope.workspaceId} FOR UPDATE OF selections,candidates`));
      if (evidence.length !== 1) return undefined;
      const bindingRows = rows(await tx.execute(sql`SELECT * FROM ${aiMediaProviderAccountCredentialBindings}
        WHERE attempt_id=${input.attemptId} AND owner_user_id=${input.scope.ownerUserId}
          AND workspace_id=${input.scope.workspaceId} FOR UPDATE`));
      if (bindingRows.length !== 1 || bindingRows[0]!.id !== input.credentialBindingId) return undefined;
      const binding = bindingRows[0]!;
      const artifactRows = rows(await tx.execute(sql`SELECT * FROM ${aiMediaOAuthCredentialArtifacts}
        WHERE credential_binding_id=${String(binding.id)} ORDER BY CASE role WHEN 'operational_access' THEN 1 ELSE 2 END FOR UPDATE`));
      const operationRows = rows(await tx.execute(sql`SELECT * FROM ${aiMediaOAuthVaultOperationsV2}
        WHERE credential_binding_id=${String(binding.id)} ORDER BY artifact_id FOR UPDATE`));
      if (artifactRows.length !== operationRows.length) throw new OAuthProviderConnectionError();

      const attempt = await this.readAttempt(tx, input.scope, input.attemptId, attemptRow);
      if (!attempt) return undefined;
      const artifacts = artifactRows.map(dbArtifact);
      const canonicalInput = this.validateFinalEvidence(attempt, evidence[0]!, binding, artifacts, input,
        attempt.stage === "authorized" ? iso(value(binding, "authorizedAt", "authorized_at"))
          : iso(value(attemptRow, "databaseNow", "database_now")));
      const jsDigest = deriveOAuthProviderAuthorizedDigest(canonicalInput);
      const sqlDigestRow = rows(await tx.execute(sql`SELECT ai_media_oauth_pr16_authorized_digest(${String(binding.id)}::uuid) AS digest`))[0];
      if (!sqlDigestRow || String(sqlDigestRow.digest) !== jsDigest) throw new OAuthProviderConnectionError();

      if (attempt.stage === "authorized") {
        if (String(value(binding, "authorizedDigest", "authorized_digest")) !== jsDigest || binding.state !== "authorized"
          || artifactRows.some((row) => row.state !== "active") || operationRows.some((row) => row.state !== "retained")) {
          throw new OAuthProviderConnectionError();
        }
        const account = await this.accountFromRow(tx, accountRow);
        if (!account || account.authorizedDigest !== jsDigest) throw new OAuthProviderConnectionError();
        return { state: "replayed", result: { attempt, account } };
      }
      const databaseNow = iso(value(attemptRow, "databaseNow", "database_now"));
      if (attempt.stage !== "activation_in_progress" || attempt.stageVersion !== input.activationStageVersion
        || attempt.leaseToken !== input.leaseToken || attempt.leaseFencing !== input.leaseFencing
        || !attempt.leaseExpiresAt || Date.parse(attempt.leaseExpiresAt) <= Date.parse(databaseNow)
        || binding.state !== "staged" || Number(value(accountRow, "credentialVersion", "credential_version")) !== input.expectedCredentialVersion
        || artifactRows.some((row) => row.state !== "candidate") || operationRows.some((row) => row.state !== "cleanup_pending")) return undefined;

      const updatedAccount = rows(await tx.execute(sql`UPDATE ${aiMediaProviderAccounts} SET status='active',credential_status='active',
        external_account_id=${input.selectedTargetId},capabilities=${JSON.stringify(canonical(input.capabilities))}::jsonb,
        granted_scopes=${JSON.stringify(canonical(input.actualScopes))}::jsonb,credential_version=${input.targetCredentialVersion},
        credential_source='oauth_role_v2',credential_actor_user_id=${input.actorUserId},
        credential_source_session_id=${attempt.oauthSessionId},token_binding_id=${input.tokenBindingId},
        credential_binding_id=${String(binding.id)},token_kind='role_v2',token_manifest_revision=${input.manifestRevision},
        updated_at=clock_timestamp()
        WHERE id=${attempt.providerAccountId} AND owner_user_id=${input.scope.ownerUserId}
          AND workspace_id=${input.scope.workspaceId} AND provider_key=${attempt.platform}
          AND credential_version=${input.expectedCredentialVersion} AND status='disconnected' RETURNING *`))[0];
      if (!updatedAccount) throw new ActivationCasLost();
      const terminal = rows(await tx.execute(sql`UPDATE ${aiMediaOAuthConnectionAttempts} SET stage='authorized',
        stage_version=stage_version+1,failure_code=NULL,terminal_outcome='authorized',terminal_evidence_digest=${jsDigest},
        terminal_at=clock_timestamp(),lease_token=NULL,lease_owner=NULL,lease_expires_at=NULL,updated_at=clock_timestamp()
        WHERE id=${attempt.id} AND stage='activation_in_progress' AND stage_version=${input.activationStageVersion}
          AND lease_token=${input.leaseToken} AND lease_fencing=${input.leaseFencing}
          AND lease_expires_at>clock_timestamp() RETURNING *`))[0];
      if (!terminal) throw new ActivationCasLost();
      const updatedBinding = rows(await tx.execute(sql`UPDATE ${aiMediaProviderAccountCredentialBindings} SET state='authorized',
        authorized_digest=${jsDigest},authorized_at=clock_timestamp(),updated_at=clock_timestamp()
        WHERE id=${String(binding.id)} AND state='staged' RETURNING id`));
      if (updatedBinding.length !== 1) throw new ActivationCasLost();
      const updatedArtifacts = rows(await tx.execute(sql`UPDATE ${aiMediaOAuthCredentialArtifacts} SET state='active',activated_at=clock_timestamp(),
        updated_at=clock_timestamp() WHERE credential_binding_id=${String(binding.id)} AND state='candidate' RETURNING id`));
      if (updatedArtifacts.length !== artifactRows.length) throw new ActivationCasLost();
      const updatedOperations = rows(await tx.execute(sql`UPDATE ${aiMediaOAuthVaultOperationsV2} SET state='retained',available_at='infinity',
        quiescent_until='infinity',updated_at=clock_timestamp() WHERE credential_binding_id=${String(binding.id)}
        AND state='cleanup_pending' RETURNING id`));
      if (updatedOperations.length !== operationRows.length) throw new ActivationCasLost();
      await tx.execute(sql`SET CONSTRAINTS ALL IMMEDIATE`);
      const finalAttempt = await this.readAttempt(tx, input.scope, input.attemptId, terminal);
      const finalAccount = await this.accountFromRow(tx, updatedAccount);
      if (!finalAttempt || !finalAccount) throw new ActivationCasLost();
      return { state: "activated", result: { attempt: finalAttempt, account: finalAccount } };
    });
  }

  async markActivationIndeterminate(input: OAuthProviderConnectionFence): Promise<OAuthProviderConnectionAttempt | undefined> {
    try { return await this.terminalizeStaged(input.scope, input.attemptId, input.leaseToken, input.leaseFencing, true); }
    catch (error) { if (error instanceof ActivationCasLost) return undefined; throw error; }
  }

  async recoverExpiredStagedActivation(input: RecoverExpiredOAuthProviderActivation): Promise<OAuthProviderConnectionAttempt | undefined> {
    try { return await this.terminalizeStaged(input.scope, input.attemptId, undefined, undefined, false); }
    catch (error) { if (error instanceof ActivationCasLost) return undefined; throw error; }
  }

  private async terminalizeStaged(scope: TenantScope, attemptId: string, leaseToken?: string, leaseFencing?: number, requireLive = false) {
    return this.db.transaction(async (tx) => {
      const account = await this.lockAccountFirst(tx, scope, attemptId);
      if (!account) return undefined;
      const attempt = rows(await tx.execute(sql`SELECT *,clock_timestamp() AS database_now FROM ${aiMediaOAuthConnectionAttempts}
        WHERE id=${attemptId} AND owner_user_id=${scope.ownerUserId} AND workspace_id=${scope.workspaceId} FOR UPDATE`))[0];
      if (!attempt) return undefined;
      await tx.execute(sql`SELECT 1 FROM ${aiMediaOAuthTargetSelections} selections JOIN ${aiMediaOAuthTargetCandidates} candidates
        ON candidates.attempt_id=selections.attempt_id AND candidates.candidate_id=selections.candidate_id
        WHERE selections.attempt_id=${attemptId} FOR UPDATE OF selections,candidates`);
      const binding = rows(await tx.execute(sql`SELECT * FROM ${aiMediaProviderAccountCredentialBindings}
        WHERE attempt_id=${attemptId} AND owner_user_id=${scope.ownerUserId} AND workspace_id=${scope.workspaceId} FOR UPDATE`))[0];
      if (!binding || binding.state !== "staged") return undefined;
      const artifactRows = rows(await tx.execute(sql`SELECT * FROM ${aiMediaOAuthCredentialArtifacts}
        WHERE credential_binding_id=${String(binding.id)} ORDER BY id FOR UPDATE`));
      const operationRows = rows(await tx.execute(sql`SELECT * FROM ${aiMediaOAuthVaultOperationsV2}
        WHERE credential_binding_id=${String(binding.id)} ORDER BY artifact_id FOR UPDATE`));
      const expectedGraphSize = ["facebook", "instagram"].includes(String(attempt.platform)) ? 1 : 2;
      if (artifactRows.length !== expectedGraphSize || operationRows.length !== expectedGraphSize
        || artifactRows.some((row) => row.state !== "candidate")
        || operationRows.some((row) => row.state !== "cleanup_pending")) throw new OAuthProviderConnectionError();
      const nowMs = Date.parse(iso(value(attempt, "databaseNow", "database_now")));
      const leaseExpires = Date.parse(iso(value(attempt, "leaseExpiresAt", "lease_expires_at")));
      if (attempt.stage !== "activation_in_progress" || (requireLive
        ? (attempt.lease_token !== leaseToken || Number(attempt.lease_fencing) !== leaseFencing || leaseExpires <= nowMs)
        : leaseExpires > nowMs)) return undefined;
      const evidenceDigest = deriveOAuthProviderActivationIndeterminateDigest({
        attemptId, scope, credentialBindingId: String(binding.id),
        artifactBindingId: String(value(binding, "artifactBindingId", "artifact_binding_id")),
        leaseFencing: Number(value(attempt, "leaseFencing", "lease_fencing")),
        artifactIds: artifactRows.map((row) => String(row.id)), cleanupOperationIds: operationRows.map((row) => String(row.id)),
      });
      const abandoned = rows(await tx.execute(sql`UPDATE ${aiMediaProviderAccountCredentialBindings} SET state='abandoned',abandoned_at=clock_timestamp(),updated_at=clock_timestamp()
        WHERE id=${String(binding.id)} AND state='staged' RETURNING id`));
      if (abandoned.length !== 1) throw new ActivationCasLost();
      const terminal = rows(await tx.execute(sql`UPDATE ${aiMediaOAuthConnectionAttempts} SET stage='activation_indeterminate',stage_version=stage_version+1,
        failure_code='activation_ambiguous',terminal_outcome='indeterminate',terminal_evidence_digest=${evidenceDigest},terminal_at=clock_timestamp(),
        lease_token=NULL,lease_owner=NULL,lease_expires_at=NULL,updated_at=clock_timestamp() WHERE id=${attemptId}
        AND stage='activation_in_progress' RETURNING *`))[0];
      if (!terminal) throw new ActivationCasLost();
      await tx.execute(sql`SET CONSTRAINTS ALL IMMEDIATE`);
      const projected = await this.readAttempt(tx, scope, attemptId, terminal);
      if (!projected) throw new ActivationCasLost();
      return projected;
    });
  }

  private async lockAccountFirst(tx: OAuthProviderConnectionDatabase, scope: TenantScope, attemptId: string): Promise<Row | undefined> {
    return rows(await tx.execute(sql`SELECT accounts.* FROM ${aiMediaProviderAccounts} accounts
      JOIN ${aiMediaOAuthConnectionAttempts} attempts ON attempts.owner_user_id=accounts.owner_user_id
        AND attempts.workspace_id=accounts.workspace_id AND attempts.provider_account_id=accounts.id
        AND attempts.platform=accounts.provider_key WHERE attempts.id=${attemptId}
        AND attempts.owner_user_id=${scope.ownerUserId} AND attempts.workspace_id=${scope.workspaceId}
      FOR UPDATE OF accounts`))[0];
  }

  private validateStageEvidence(attempt: OAuthProviderConnectionAttempt, selection: Row, input: StageOAuthProviderActivation, now: string): void {
    const artifacts = validateOAuthProviderActivationArtifacts(attempt.grantFamily, input.artifactBindingId, input.artifacts, now, input.manifestRevision);
    validateOAuthProviderScopes(attempt.grantFamily, attempt.requiredScopes, input.actualScopes, attempt.allowedScopes);
    const capabilities = deriveOAuthProviderCapabilities(input.selectedTargetKind, stringArray(value(selection, "verifiedTasks", "verified_tasks")), attempt.actualScopes);
    const digest = deriveOAuthProviderSelectionDigest({ attemptId: attempt.id, scope: attempt.scope, actorUserId: input.actorUserId,
      providerAccountId: attempt.providerAccountId, oauthSessionId: attempt.oauthSessionId, platform: attempt.platform,
      grantFamily: attempt.grantFamily, candidateId: input.selectedCandidateId, targetId: input.selectedTargetId,
      targetKind: input.selectedTargetKind, eligibilityDigest: input.selectedEligibilityDigest,
      selectedStageVersion: input.selectedStageVersion, selectedAt: iso(value(selection, "selectedAt", "selected_at")),
      manifestRevision: input.manifestRevision, tokenBindingId: input.tokenBindingId,
      expectedCredentialVersion: input.expectedCredentialVersion, targetCredentialVersion: input.targetCredentialVersion,
      actualScopes: input.actualScopes, capabilities });
    if (artifacts.length !== input.artifacts.length || digest !== input.selectionDigest
      || String(value(selection, "candidateId", "candidate_id")) !== input.selectedCandidateId
      || String(value(selection, "targetExternalId", "target_external_id")) !== input.selectedTargetId
      || String(value(selection, "targetKind", "target_kind")) !== input.selectedTargetKind
      || String(value(selection, "eligibilityDigest", "eligibility_digest")) !== input.selectedEligibilityDigest
      || Number(value(selection, "selectedStageVersion", "selected_stage_version")) !== input.selectedStageVersion
      || attempt.actorUserId !== input.actorUserId || attempt.tokenBindingId !== input.tokenBindingId
      || attempt.manifestRevision !== input.manifestRevision || attempt.expectedCredentialVersion !== input.expectedCredentialVersion
      || attempt.targetCredentialVersion !== input.targetCredentialVersion || !equalList(attempt.actualScopes, input.actualScopes)
      || !equalList(capabilities, input.capabilities)) throw new OAuthProviderConnectionError();
  }

  private validateFinalEvidence(attempt: OAuthProviderConnectionAttempt, selection: Row, binding: Row,
    artifacts: readonly OAuthProviderActivationArtifactEvidence[], input: FinalizeOAuthProviderActivation, validationNow: string): FinalizeOAuthProviderActivation {
    validateOAuthProviderActivationArtifacts(attempt.grantFamily, input.artifactBindingId, input.artifacts, validationNow, input.manifestRevision);
    const expected = { actor: value(binding, "actorUserId", "actor_user_id"), candidate: value(binding, "candidateId", "candidate_id"),
      target: value(binding, "targetExternalId", "target_external_id"), kind: value(binding, "targetKind", "target_kind"),
      eligibility: value(binding, "selectedEligibilityDigest", "selected_eligibility_digest"), selectedVersion: value(binding, "selectedStageVersion", "selected_stage_version"),
      activationVersion: value(binding, "activationStageVersion", "activation_stage_version"), selectionDigest: value(binding, "selectionDigest", "selection_digest"),
      token: value(binding, "tokenBindingId", "token_binding_id"), artifactBinding: value(binding, "artifactBindingId", "artifact_binding_id"),
      manifest: value(binding, "manifestRevision", "manifest_revision"), expectedVersion: value(binding, "expectedCredentialVersion", "expected_credential_version"),
      targetVersion: value(binding, "targetCredentialVersion", "target_credential_version") };
    if (String(expected.actor) !== input.actorUserId || String(expected.candidate) !== input.selectedCandidateId
      || String(expected.target) !== input.selectedTargetId || String(expected.kind) !== input.selectedTargetKind
      || String(expected.eligibility) !== input.selectedEligibilityDigest || Number(expected.selectedVersion) !== input.selectedStageVersion
      || Number(expected.activationVersion) !== input.activationStageVersion || String(expected.selectionDigest) !== input.selectionDigest
      || String(expected.token) !== input.tokenBindingId || String(expected.artifactBinding) !== input.artifactBindingId
      || String(expected.manifest) !== input.manifestRevision || Number(expected.expectedVersion) !== input.expectedCredentialVersion
      || Number(expected.targetVersion) !== input.targetCredentialVersion || !equalList(stringArray(value(binding, "actualScopes", "actual_scopes")), input.actualScopes)
      || !equalList(stringArray(binding.capabilities), input.capabilities) || JSON.stringify(artifacts) !== JSON.stringify(input.artifacts)
      || String(value(selection, "selectionDigest", "selection_digest")) !== input.selectionDigest) throw new OAuthProviderConnectionError();
    return { ...input, artifacts, actualScopes: canonical(input.actualScopes),
      capabilities: canonical(input.capabilities) as FinalizeOAuthProviderActivation["capabilities"] };
  }

  private async insertArtifactGraph(tx: OAuthProviderConnectionDatabase, attempt: OAuthProviderConnectionAttempt,
    input: StageOAuthProviderActivation, artifact: StageOAuthProviderActivationArtifact): Promise<void> {
    const expiresAt = artifact.lifetime.kind === "expires_at" ? new Date(artifact.lifetime.expiresAt) : null;
    await tx.execute(sql`INSERT INTO ${aiMediaOAuthCredentialArtifacts} (id,owner_user_id,workspace_id,actor_user_id,
      provider_account_id,platform,oauth_session_id,attempt_id,credential_binding_id,candidate_id,target_kind,target_external_id,
      token_binding_id,artifact_binding_id,role,vault_reference,lifetime_kind,expires_at,revalidate_at,manifest_revision,
      expected_credential_version,target_credential_version,selection_digest,selected_stage_version,selected_eligibility_digest,
      state,created_at,updated_at) VALUES (${artifact.artifactId},${attempt.scope.ownerUserId},${attempt.scope.workspaceId},
      ${input.actorUserId},${attempt.providerAccountId},${attempt.platform},${attempt.oauthSessionId},${attempt.id},
      ${input.credentialBindingId},${input.selectedCandidateId},${input.selectedTargetKind},${input.selectedTargetId},
      ${input.tokenBindingId},${input.artifactBindingId},${artifact.role},${artifact.vaultReference},${artifact.lifetime.kind},
      ${expiresAt},${new Date(artifact.lifetime.revalidateAt)},${input.manifestRevision},${input.expectedCredentialVersion},
      ${input.targetCredentialVersion},${input.selectionDigest},${input.selectedStageVersion},${input.selectedEligibilityDigest},
      'candidate',clock_timestamp(),clock_timestamp())`);
    await tx.execute(sql`INSERT INTO ${aiMediaOAuthVaultOperationsV2} (id,owner_user_id,workspace_id,actor_user_id,
      provider_account_id,platform,oauth_session_id,attempt_id,credential_binding_id,artifact_id,artifact_binding_id,role,
      vault_reference,target_credential_version,state,available_at,quiescent_until,created_at,updated_at)
      VALUES (${artifact.cleanupOperationId},${attempt.scope.ownerUserId},${attempt.scope.workspaceId},${input.actorUserId},
      ${attempt.providerAccountId},${attempt.platform},${attempt.oauthSessionId},${attempt.id},${input.credentialBindingId},
      ${artifact.artifactId},${input.artifactBindingId},${artifact.role},${artifact.vaultReference},${input.targetCredentialVersion},
      'cleanup_pending',${new Date(attempt.leaseExpiresAt!)}::timestamptz + interval '60 seconds',
      ${new Date(attempt.leaseExpiresAt!)}::timestamptz + interval '60 seconds',clock_timestamp(),clock_timestamp())`);
  }

  private async readExactStagedReplay(tx: OAuthProviderConnectionDatabase, attempt: OAuthProviderConnectionAttempt,
    binding: Row, input: StageOAuthProviderActivation, databaseNow: string): Promise<OAuthProviderActivationStageResult | undefined> {
    const artifacts = rows(await tx.execute(sql`SELECT artifacts.*,operations.id AS cleanup_operation_id,
        operations.state AS cleanup_state
      FROM ${aiMediaOAuthCredentialArtifacts} artifacts JOIN ${aiMediaOAuthVaultOperationsV2} operations
        ON operations.credential_binding_id=artifacts.credential_binding_id AND operations.artifact_id=artifacts.id
      WHERE artifacts.credential_binding_id=${input.credentialBindingId} ORDER BY CASE artifacts.role WHEN 'operational_access' THEN 1 ELSE 2 END
      FOR UPDATE OF artifacts,operations`));
    const graph = artifacts.map((row) => ({ ...dbArtifact(row), artifactId: String(row.id),
      cleanupOperationId: String(value(row, "cleanupOperationId", "cleanup_operation_id")) }));
    if (!(["staged", "authorized"] as const).includes(binding.state as "staged" | "authorized")
      || String(value(binding, "attemptId", "attempt_id")) !== attempt.id
      || String(value(binding, "ownerUserId", "owner_user_id")) !== input.scope.ownerUserId
      || String(value(binding, "workspaceId", "workspace_id")) !== input.scope.workspaceId
      || String(value(binding, "actorUserId", "actor_user_id")) !== input.actorUserId
      || String(value(binding, "providerAccountId", "provider_account_id")) !== attempt.providerAccountId
      || String(binding.platform) !== attempt.platform || String(value(binding, "oauthSessionId", "oauth_session_id")) !== attempt.oauthSessionId
      || String(value(binding, "candidateId", "candidate_id")) !== input.selectedCandidateId
      || String(value(binding, "targetKind", "target_kind")) !== input.selectedTargetKind
      || String(value(binding, "targetExternalId", "target_external_id")) !== input.selectedTargetId
      || String(value(binding, "selectionDigest", "selection_digest")) !== input.selectionDigest
      || Number(value(binding, "selectedStageVersion", "selected_stage_version")) !== input.selectedStageVersion
      || Number(value(binding, "activationStageVersion", "activation_stage_version")) !== input.activationStageVersion
      || String(value(binding, "selectedEligibilityDigest", "selected_eligibility_digest")) !== input.selectedEligibilityDigest
      || String(value(binding, "tokenBindingId", "token_binding_id")) !== input.tokenBindingId
      || String(value(binding, "artifactBindingId", "artifact_binding_id")) !== input.artifactBindingId
      || Number(value(binding, "expectedCredentialVersion", "expected_credential_version")) !== input.expectedCredentialVersion
      || Number(value(binding, "targetCredentialVersion", "target_credential_version")) !== input.targetCredentialVersion
      || !equalList(stringArray(value(binding, "actualScopes", "actual_scopes")), input.actualScopes)
      || !equalList(stringArray(binding.capabilities), input.capabilities)
      || String(value(binding, "manifestRevision", "manifest_revision")) !== input.manifestRevision
      || !equalStageArtifacts(graph, input.artifacts)) throw new OAuthProviderConnectionError();
    if (binding.state === "authorized") {
      if (attempt.stage !== "authorized" || artifacts.some((row) => row.state !== "active" || row.cleanup_state !== "retained")) {
        throw new OAuthProviderConnectionError();
      }
      const accountRows = rows(await tx.execute(sql`SELECT * FROM ${aiMediaProviderAccounts}
        WHERE owner_user_id=${input.scope.ownerUserId} AND workspace_id=${input.scope.workspaceId}
          AND id=${attempt.providerAccountId} AND provider_key=${attempt.platform}`));
      if (accountRows.length !== 1) throw new OAuthProviderConnectionError();
      return { state: "authorized", result: { attempt, account: await this.accountFromRow(tx, accountRows[0]!) } };
    }
    if (attempt.stage !== "activation_in_progress" || attempt.stageVersion !== input.activationStageVersion
      || attempt.leaseToken !== input.leaseToken || attempt.leaseFencing !== input.leaseFencing
      || !attempt.leaseExpiresAt || Date.parse(attempt.leaseExpiresAt) <= Date.parse(databaseNow)) return undefined;
    if (artifacts.some((row) => row.state !== "candidate" || row.cleanup_state !== "cleanup_pending")) {
      throw new OAuthProviderConnectionError();
    }
    return { state: "staged", credentialBindingId: input.credentialBindingId, artifactBindingId: input.artifactBindingId,
      artifacts: Object.freeze(graph), stagedAt: iso(value(binding, "createdAt", "created_at")) };
  }

  private async accountFromRow(db: OAuthProviderConnectionDatabase, row: Row): Promise<OAuthProviderActivationAccount> {
    const bindingId = value(row, "credentialBindingId", "credential_binding_id");
    const binding = bindingId ? rows(await db.execute(sql`SELECT * FROM ${aiMediaProviderAccountCredentialBindings} WHERE id=${String(bindingId)}`))[0] : undefined;
    const artifactRows = binding ? rows(await db.execute(sql`SELECT * FROM ${aiMediaOAuthCredentialArtifacts}
      WHERE credential_binding_id=${String(binding.id)} ORDER BY CASE role WHEN 'operational_access' THEN 1 ELSE 2 END`)) : [];
    return { scope: { ownerUserId: String(value(row, "ownerUserId", "owner_user_id")), workspaceId: String(value(row, "workspaceId", "workspace_id")) },
      providerAccountId: String(row.id), platform: String(value(row, "providerKey", "provider_key")) as OAuthProviderActivationAccount["platform"],
      credentialVersion: Number(value(row, "credentialVersion", "credential_version")), status: row.status === "active" ? "active" : "disconnected",
      targetId: value(row, "externalAccountId", "external_account_id") == null ? null : String(value(row, "externalAccountId", "external_account_id")),
      targetKind: binding ? String(value(binding, "targetKind", "target_kind")) as OAuthProviderActivationAccount["targetKind"] : null,
      actorUserId: value(row, "credentialActorUserId", "credential_actor_user_id") == null ? null : String(value(row, "credentialActorUserId", "credential_actor_user_id")),
      oauthSessionId: value(row, "credentialSourceSessionId", "credential_source_session_id") == null ? null : String(value(row, "credentialSourceSessionId", "credential_source_session_id")),
      tokenBindingId: value(row, "tokenBindingId", "token_binding_id") == null ? null : String(value(row, "tokenBindingId", "token_binding_id")),
      artifactBindingId: binding ? String(value(binding, "artifactBindingId", "artifact_binding_id")) : null,
      credentialBindingId: binding ? String(binding.id) : null,
      artifacts: artifactRows.map(dbArtifact), grantedScopes: stringArray(value(row, "grantedScopes", "granted_scopes")),
      capabilities: stringArray(row.capabilities) as OAuthProviderActivationAccount["capabilities"],
      manifestRevision: value(row, "tokenManifestRevision", "token_manifest_revision") == null ? null : String(value(row, "tokenManifestRevision", "token_manifest_revision")),
      authorizedDigest: binding?.authorized_digest == null ? null : String(binding.authorized_digest),
      authorizedAt: binding?.authorized_at == null ? null : iso(binding.authorized_at) };
  }
}
