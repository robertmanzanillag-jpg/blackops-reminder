import { createHash } from "node:crypto";
import { sql, type SQL } from "drizzle-orm";
import {
  aiMediaOAuthConnectionAttempts,
  aiMediaOAuthSessions,
  aiMediaOAuthTargetCandidates,
  aiMediaOAuthTargetSelections,
  aiMediaProviderAccountCredentialBindings,
  aiMediaProviderAccounts,
} from "../../../shared/models/ai-media-studio-db";
import type { TenantScope } from "../core/resource-domain";
import {
  OAUTH_PROVIDER_SCOPE_ALLOWLISTS,
  OAUTH_PROVIDER_MANIFEST_REVISIONS,
  OAuthProviderConnectionError,
  deriveOAuthProviderCapabilities,
  deriveOAuthProviderSelectionDigest,
  isCompatibleOAuthProviderTarget,
  validateOAuthProviderScopes,
  validateOAuthProviderTokenArtifacts,
  type ClaimOAuthProviderConnectionStage,
  type CreateOAuthProviderConnectionAttempt,
  type MarkOAuthProviderExchangeComplete,
  type OAuthProviderConnectionAttempt,
  type OAuthProviderConnectionClaim,
  type OAuthProviderConnectionFailureCode,
  type OAuthProviderConnectionFence,
  type OAuthProviderConnectionRepository,
  type OAuthProviderTargetCandidate,
  type RecordOAuthProviderDiscovery,
  type SelectOAuthProviderTarget,
} from "./provider-connection-contracts";

type ExecuteResult = { rows?: unknown[] } | unknown[];
export type OAuthProviderConnectionDatabase = { execute(query: SQL): Promise<ExecuteResult> };
export type OAuthProviderConnectionTransactionalDatabase = OAuthProviderConnectionDatabase & {
  transaction<T>(callback: (tx: OAuthProviderConnectionDatabase) => Promise<T>): Promise<T>;
};

function rows(result: ExecuteResult): Record<string, unknown>[] {
  const resultRows = Array.isArray(result) ? result : result.rows;
  return Array.isArray(resultRows) ? resultRows as Record<string, unknown>[] : [];
}

function value(row: Record<string, unknown>, camel: string, snake: string): unknown {
  return row[camel] ?? row[snake];
}

function iso(raw: unknown): string {
  const date = raw instanceof Date ? raw : new Date(String(raw));
  if (Number.isNaN(date.getTime())) throw new Error("Invalid provider connection timestamp");
  return date.toISOString();
}

function stringArray(raw: unknown, nullable = false): string[] {
  if (raw == null && nullable) return [];
  const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string")) {
    throw new Error("Invalid provider connection list");
  }
  return parsed;
}

function jsonArray<T>(raw: unknown, nullable = false): T[] {
  if (raw == null && nullable) return [];
  const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (!Array.isArray(parsed)) throw new Error("Invalid provider connection metadata");
  return parsed as T[];
}

function candidateFromRow(row: Record<string, unknown>): OAuthProviderTargetCandidate {
  return {
    candidateId: String(value(row, "candidateId", "candidate_id")),
    targetId: String(value(row, "targetExternalId", "target_external_id")),
    kind: String(value(row, "targetKind", "target_kind")) as OAuthProviderTargetCandidate["kind"],
    displayName: String(value(row, "safeLabel", "safe_label")),
    ...(value(row, "parentTargetId", "parent_target_id") == null ? {} : {
      parentTargetId: String(value(row, "parentTargetId", "parent_target_id")),
    }),
    verifiedTasks: stringArray(value(row, "verifiedTasks", "verified_tasks")),
    capabilities: stringArray(row.capabilities) as OAuthProviderTargetCandidate["capabilities"],
    eligibilityDigest: String(value(row, "eligibilityDigest", "eligibility_digest")),
    manifestRevision: String(value(row, "manifestRevision", "manifest_revision")),
    discoveredAt: iso(value(row, "discoveredAt", "discovered_at")),
  };
}

function attemptFromRows(
  row: Record<string, unknown>,
  candidateRows: Record<string, unknown>[],
  selectionRow?: Record<string, unknown>,
): OAuthProviderConnectionAttempt {
  return {
    id: String(row.id),
    scope: {
      ownerUserId: String(value(row, "ownerUserId", "owner_user_id")),
      workspaceId: String(value(row, "workspaceId", "workspace_id")),
    },
    actorUserId: String(value(row, "actorUserId", "actor_user_id")),
    providerAccountId: String(value(row, "providerAccountId", "provider_account_id")),
    oauthSessionId: String(value(row, "oauthSessionId", "oauth_session_id")),
    platform: String(row.platform) as OAuthProviderConnectionAttempt["platform"],
    grantFamily: String(value(row, "grantFamily", "grant_family")) as OAuthProviderConnectionAttempt["grantFamily"],
    stage: String(row.stage) as OAuthProviderConnectionAttempt["stage"],
    stageVersion: Number(value(row, "stageVersion", "stage_version")),
    manifestRevision: String(value(row, "manifestRevision", "manifest_revision")),
    allowedScopes: stringArray(value(row, "allowedScopes", "allowed_scopes")),
    requiredScopes: stringArray(value(row, "requiredScopes", "required_scopes")),
    actualScopes: stringArray(value(row, "actualScopes", "actual_scopes"), true),
    tokenBindingId: String(value(row, "tokenBindingId", "token_binding_id")),
    expectedCredentialVersion: Number(value(row, "expectedCredentialVersion", "expected_credential_version")),
    targetCredentialVersion: Number(value(row, "targetCredentialVersion", "target_credential_version")),
    tokenArtifacts: jsonArray(value(row, "tokenArtifacts", "token_artifacts"), true),
    candidates: candidateRows.map(candidateFromRow),
    selectedCandidateId: selectionRow ? String(value(selectionRow, "candidateId", "candidate_id")) : null,
    selectedTargetId: selectionRow ? String(value(selectionRow, "targetExternalId", "target_external_id")) : null,
    selectedTargetKind: selectionRow
      ? String(value(selectionRow, "targetKind", "target_kind")) as OAuthProviderConnectionAttempt["selectedTargetKind"] : null,
    selectedByActorUserId: selectionRow ? String(value(selectionRow, "selectedActorUserId", "selected_actor_user_id")) : null,
    selectedAt: selectionRow ? iso(value(selectionRow, "selectedAt", "selected_at")) : null,
    selectedEligibilityDigest: selectionRow ? String(value(selectionRow, "eligibilityDigest", "eligibility_digest")) : null,
    selectedStageVersion: selectionRow ? Number(value(selectionRow, "selectedStageVersion", "selected_stage_version")) : null,
    selectionDigest: selectionRow ? String(value(selectionRow, "selectionDigest", "selection_digest")) : null,
    activationArtifactBindingId: null,
    activationArtifacts: [],
    authorizedDigest: null,
    authorizedAt: null,
    leaseToken: value(row, "leaseToken", "lease_token") == null ? null : String(value(row, "leaseToken", "lease_token")),
    leaseOwner: value(row, "leaseOwner", "lease_owner") == null ? null : String(value(row, "leaseOwner", "lease_owner")),
    leaseExpiresAt: value(row, "leaseExpiresAt", "lease_expires_at") == null ? null : iso(value(row, "leaseExpiresAt", "lease_expires_at")),
    leaseFencing: Number(value(row, "leaseFencing", "lease_fencing")),
    failureCode: value(row, "failureCode", "failure_code") == null ? null
      : String(value(row, "failureCode", "failure_code")) as OAuthProviderConnectionFailureCode,
    expiresAt: iso(value(row, "expiresAt", "expires_at")),
    createdAt: iso(value(row, "createdAt", "created_at")),
    updatedAt: iso(value(row, "updatedAt", "updated_at")),
  };
}

function digest(valueToDigest: unknown): string {
  return createHash("sha256").update(JSON.stringify(valueToDigest)).digest("hex");
}

const SAFE_VALUE = /^[A-Za-z0-9._:/-]+$/u;
const SHA256 = /^[0-9a-f]{64}$/u;

function parseIso(valueToParse: string): number {
  const parsed = Date.parse(valueToParse);
  if (!valueToParse || !Number.isFinite(parsed) || new Date(parsed).toISOString() !== valueToParse) {
    throw new OAuthProviderConnectionError();
  }
  return parsed;
}

function requiredSafe(valueToCheck: string, max = 255): void {
  if (typeof valueToCheck !== "string" || valueToCheck.length < 1 || valueToCheck.length > max
    || !SAFE_VALUE.test(valueToCheck)) throw new OAuthProviderConnectionError();
}

function safeDisplay(valueToCheck: string): void {
  if (typeof valueToCheck !== "string" || valueToCheck.trim() !== valueToCheck
    || valueToCheck.length < 1 || valueToCheck.length > 200 || /[\u0000-\u001f\u007f]/u.test(valueToCheck)) {
    throw new OAuthProviderConnectionError();
  }
}

function targetKindFor(platform: OAuthProviderConnectionAttempt["platform"]): OAuthProviderTargetCandidate["kind"] {
  if (platform === "tiktok") return "tiktok_user";
  if (platform === "youtube_shorts") return "youtube_channel";
  if (platform === "facebook") return "facebook_page";
  return "instagram_professional_account";
}

const IN_PROGRESS = {
  exchange_pending: "exchange_in_progress",
  discovery_pending: "discovery_in_progress",
  activation_pending: "activation_in_progress",
} as const;

export class DrizzleOAuthProviderConnectionRepository implements OAuthProviderConnectionRepository {
  constructor(protected readonly db: OAuthProviderConnectionTransactionalDatabase) {}

  async create(input: CreateOAuthProviderConnectionAttempt): Promise<OAuthProviderConnectionAttempt> {
    const createdMs = parseIso(input.createdAt);
    if (parseIso(input.expiresAt) <= createdMs || !isCompatibleOAuthProviderTarget(
      input.platform, input.grantFamily, targetKindFor(input.platform),
    )) throw new OAuthProviderConnectionError();
    for (const identity of [input.id, input.scope.ownerUserId, input.scope.workspaceId, input.actorUserId,
      input.providerAccountId, input.oauthSessionId, input.tokenBindingId]) requiredSafe(identity);
    requiredSafe(input.manifestRevision, 100);
    if (input.manifestRevision !== OAUTH_PROVIDER_MANIFEST_REVISIONS[input.platform]
      || !Number.isSafeInteger(input.expectedCredentialVersion) || input.expectedCredentialVersion < 0
      || input.targetCredentialVersion !== input.expectedCredentialVersion + 1
      || input.allowedScopes.some((scope) => !OAUTH_PROVIDER_SCOPE_ALLOWLISTS[input.grantFamily].includes(scope))) {
      throw new OAuthProviderConnectionError();
    }
    validateOAuthProviderScopes(input.grantFamily, input.requiredScopes, input.requiredScopes, input.allowedScopes);
    const result = await this.db.execute(sql`
      INSERT INTO ${aiMediaOAuthConnectionAttempts} (
        id,owner_user_id,workspace_id,actor_user_id,provider_account_id,platform,oauth_session_id,
        stage,stage_version,grant_family,manifest_revision,required_scopes,allowed_scopes,token_binding_id,
        expected_credential_version,target_credential_version,expires_at,created_at,updated_at
      ) SELECT ${input.id},sessions.owner_user_id,sessions.workspace_id,sessions.actor_user_id,
        sessions.provider_account_id,sessions.platform,sessions.id,'exchange_pending',1,${input.grantFamily},
        ${input.manifestRevision},${JSON.stringify(input.requiredScopes)}::jsonb,${JSON.stringify(input.allowedScopes)}::jsonb,
        sessions.token_binding_id,sessions.expected_credential_version,sessions.target_credential_version,
        ${new Date(input.expiresAt)},${new Date(input.createdAt)},${new Date(input.createdAt)}
      FROM ${aiMediaOAuthSessions} sessions
      INNER JOIN ${aiMediaProviderAccounts} accounts ON accounts.owner_user_id=sessions.owner_user_id
        AND accounts.workspace_id=sessions.workspace_id AND accounts.id=sessions.provider_account_id
        AND accounts.provider_key=sessions.platform
      WHERE sessions.id=${input.oauthSessionId} AND sessions.owner_user_id=${input.scope.ownerUserId}
        AND sessions.workspace_id=${input.scope.workspaceId} AND sessions.actor_user_id=${input.actorUserId}
        AND sessions.provider_account_id=${input.providerAccountId} AND sessions.platform=${input.platform}
        AND sessions.status='processing' AND sessions.token_binding_id=${input.tokenBindingId}
        AND sessions.expected_credential_version=${input.expectedCredentialVersion}
        AND sessions.target_credential_version=${input.targetCredentialVersion}
        AND accounts.credential_version=sessions.expected_credential_version
        AND sessions.expires_at>=${new Date(input.expiresAt)} AND sessions.expires_at>clock_timestamp()
      RETURNING *
    `);
    const created = rows(result)[0];
    if (!created) throw new Error("Provider connection attempt was not created");
    return attemptFromRows(created, []);
  }

  async get(scope: TenantScope, attemptId: string): Promise<OAuthProviderConnectionAttempt | undefined> {
    return this.readAttempt(this.db, scope, attemptId);
  }

  async claim(input: ClaimOAuthProviderConnectionStage): Promise<OAuthProviderConnectionClaim | undefined> {
    const inProgress = IN_PROGRESS[input.stage];
    const result = await this.db.execute(sql`
      UPDATE ${aiMediaOAuthConnectionAttempts}
      SET stage=${inProgress},stage_version=stage_version+1,lease_token=${input.leaseToken},lease_owner=${input.leaseOwner},
        lease_expires_at=${new Date(input.leaseExpiresAt)},lease_fencing=lease_fencing+1,updated_at=clock_timestamp()
      WHERE id=${input.attemptId} AND owner_user_id=${input.scope.ownerUserId} AND workspace_id=${input.scope.workspaceId}
        AND expires_at>clock_timestamp() AND ${new Date(input.leaseExpiresAt)}>clock_timestamp()
        AND ${new Date(input.leaseExpiresAt)}<=clock_timestamp()+interval '5 minutes'
        AND ${new Date(input.leaseExpiresAt)}<=expires_at AND length(btrim(${input.leaseOwner})) BETWEEN 1 AND 255
        AND (stage=${input.stage} OR (stage=${inProgress} AND lease_expires_at<=clock_timestamp()
          AND (${input.stage}<>'activation_pending' OR NOT EXISTS (
            SELECT 1 FROM ${aiMediaProviderAccountCredentialBindings} bindings
            WHERE bindings.attempt_id=${aiMediaOAuthConnectionAttempts.id} AND bindings.state='staged'
          ))))
      RETURNING *
    `);
    const claimed = rows(result)[0];
    if (!claimed) return undefined;
    const attempt = await this.readAttempt(this.db, input.scope, input.attemptId, claimed);
    if (!attempt || !attempt.leaseToken || !attempt.leaseOwner || !attempt.leaseExpiresAt) return undefined;
    return { attempt, leaseToken: attempt.leaseToken, leaseOwner: attempt.leaseOwner,
      leaseExpiresAt: attempt.leaseExpiresAt, leaseFencing: attempt.leaseFencing };
  }

  async markExchangeComplete(input: MarkOAuthProviderExchangeComplete): Promise<OAuthProviderConnectionAttempt | undefined> {
    return this.db.transaction(async (tx) => {
      const clockRow = rows(await tx.execute(sql`SELECT clock_timestamp() AS database_now`))[0];
      if (!clockRow) throw new Error("Database clock unavailable");
      const databaseNow = iso(value(clockRow, "databaseNow", "database_now"));
      const current = await this.readAttempt(tx, input.scope, input.attemptId);
      if (!current) return undefined;
      validateOAuthProviderTokenArtifacts(current.grantFamily, input.tokenArtifacts, databaseNow);
      validateOAuthProviderScopes(current.grantFamily, current.requiredScopes, input.actualScopes, current.allowedScopes);
      const safeArtifacts = input.tokenArtifacts.map((artifact) => ({
        role: artifact.role,
        lifetime: artifact.lifetime.kind === "expires_at"
          ? { kind: "expires_at" as const, expiresAt: artifact.lifetime.expiresAt, revalidateAt: artifact.lifetime.revalidateAt }
          : { kind: artifact.lifetime.kind, revalidateAt: artifact.lifetime.revalidateAt },
      }));
      const updated = rows(await tx.execute(sql`UPDATE ${aiMediaOAuthConnectionAttempts} SET
        stage='discovery_pending',stage_version=stage_version+1,actual_scopes=${JSON.stringify(input.actualScopes)}::jsonb,
        token_artifacts=${JSON.stringify(safeArtifacts)}::jsonb,lease_token=NULL,lease_owner=NULL,lease_expires_at=NULL,
        failure_code=NULL,updated_at=clock_timestamp()
        WHERE id=${input.attemptId} AND owner_user_id=${input.scope.ownerUserId} AND workspace_id=${input.scope.workspaceId}
          AND stage='exchange_in_progress' AND lease_token=${input.leaseToken} AND lease_fencing=${input.leaseFencing}
          AND lease_expires_at>clock_timestamp() RETURNING *`))[0];
      return updated ? this.readAttempt(tx, input.scope, input.attemptId, updated) : undefined;
    });
  }

  async markExchangeIndeterminate(input: OAuthProviderConnectionFence): Promise<OAuthProviderConnectionAttempt | undefined> {
    return this.fencedUpdate(input, sql`
      stage='exchange_indeterminate',stage_version=stage_version+1,lease_token=NULL,lease_owner=NULL,lease_expires_at=NULL,
      failure_code='exchange_ambiguous',updated_at=clock_timestamp()
    `, "exchange_in_progress");
  }

  async recordDiscovery(input: RecordOAuthProviderDiscovery): Promise<OAuthProviderConnectionAttempt | undefined> {
    if (!Array.isArray(input.candidates) || input.candidates.length > 100) throw new OAuthProviderConnectionError();
    return this.db.transaction(async (tx) => {
      const lockedResult = await tx.execute(sql`
        SELECT *,clock_timestamp() AS database_now FROM ${aiMediaOAuthConnectionAttempts}
        WHERE id=${input.attemptId} AND owner_user_id=${input.scope.ownerUserId} AND workspace_id=${input.scope.workspaceId}
          AND stage='discovery_in_progress' AND lease_token=${input.leaseToken} AND lease_fencing=${input.leaseFencing}
          AND lease_expires_at>clock_timestamp() FOR UPDATE
      `);
      const attemptRow = rows(lockedResult)[0];
      if (!attemptRow) return undefined;
      const attempt = attemptFromRows(attemptRow, []);
      const databaseNowMs = parseIso(iso(value(attemptRow, "databaseNow", "database_now")));
      const candidateIds = new Set<string>();
      const targetIdentities = new Set<string>();
      const candidates = input.candidates.map((candidate) => ({
        ...candidate, capabilities: (() => {
          requiredSafe(candidate.candidateId); requiredSafe(candidate.targetId); safeDisplay(candidate.displayName);
          if (candidate.parentTargetId !== undefined) requiredSafe(candidate.parentTargetId);
          const targetIdentity = `${candidate.kind}\u0000${candidate.targetId}`;
          if (!SHA256.test(candidate.eligibilityDigest) || candidate.manifestRevision !== attempt.manifestRevision
            || parseIso(candidate.discoveredAt) > databaseNowMs || candidateIds.has(candidate.candidateId)
            || targetIdentities.has(targetIdentity)
            || !isCompatibleOAuthProviderTarget(attempt.platform, attempt.grantFamily, candidate.kind)) {
            throw new OAuthProviderConnectionError();
          }
          candidateIds.add(candidate.candidateId); targetIdentities.add(targetIdentity);
          return deriveOAuthProviderCapabilities(candidate.kind, candidate.verifiedTasks, attempt.actualScopes);
        })(),
      }));

      if (candidates.length === 0) {
        const terminalDigest = digest({ attemptId: attempt.id, outcome: "not_connectable", reason: "zero_candidates" });
        const terminal = rows(await tx.execute(sql`UPDATE ${aiMediaOAuthConnectionAttempts}
          SET stage='failed',stage_version=stage_version+1,failure_code='no_targets',terminal_outcome='not_connectable',
            terminal_evidence_digest=${terminalDigest},terminal_at=clock_timestamp(),lease_token=NULL,lease_owner=NULL,
            lease_expires_at=NULL,updated_at=clock_timestamp()
          WHERE id=${attempt.id} AND owner_user_id=${attempt.scope.ownerUserId} AND workspace_id=${attempt.scope.workspaceId}
            AND stage='discovery_in_progress' AND lease_token=${input.leaseToken} AND lease_fencing=${input.leaseFencing}
            AND lease_expires_at>clock_timestamp() RETURNING *`))[0];
        return terminal ? this.readAttempt(tx, input.scope, input.attemptId, terminal) : undefined;
      }

      for (const candidate of candidates) {
        await tx.execute(sql`
          INSERT INTO ${aiMediaOAuthTargetCandidates} (
            candidate_id,owner_user_id,workspace_id,actor_user_id,provider_account_id,platform,oauth_session_id,attempt_id,
            target_kind,target_external_id,safe_label,parent_target_id,eligibility_digest,verified_tasks,capabilities,
            manifest_revision,discovered_at,created_at
          ) VALUES (${candidate.candidateId},${attempt.scope.ownerUserId},${attempt.scope.workspaceId},${attempt.actorUserId},
            ${attempt.providerAccountId},${attempt.platform},${attempt.oauthSessionId},${attempt.id},${candidate.kind},${candidate.targetId},
            ${candidate.displayName},${candidate.parentTargetId ?? null},${candidate.eligibilityDigest},
            ${JSON.stringify(candidate.verifiedTasks)}::jsonb,${JSON.stringify(candidate.capabilities)}::jsonb,
            ${candidate.manifestRevision},${new Date(candidate.discoveredAt)},clock_timestamp())
          ON CONFLICT (owner_user_id,workspace_id,actor_user_id,provider_account_id,platform,oauth_session_id,attempt_id,candidate_id,target_kind,target_external_id)
          DO NOTHING
        `);
      }
      const advanced = await tx.execute(sql`UPDATE ${aiMediaOAuthConnectionAttempts}
        SET stage='awaiting_target',stage_version=stage_version+1,lease_token=NULL,lease_owner=NULL,lease_expires_at=NULL,
          failure_code=NULL,updated_at=clock_timestamp()
        WHERE id=${attempt.id} AND owner_user_id=${attempt.scope.ownerUserId} AND workspace_id=${attempt.scope.workspaceId}
          AND stage='discovery_in_progress' AND lease_token=${input.leaseToken} AND lease_fencing=${input.leaseFencing}
          AND lease_expires_at>clock_timestamp() RETURNING id`);
      if (rows(advanced).length !== 1) return undefined;
      return this.readAttempt(tx, input.scope, input.attemptId);
    });
  }

  async selectTarget(input: SelectOAuthProviderTarget): Promise<OAuthProviderConnectionAttempt | undefined> {
    return this.db.transaction(async (tx) => {
      const attemptResult = await tx.execute(sql`SELECT *,clock_timestamp() AS database_now FROM ${aiMediaOAuthConnectionAttempts}
        WHERE id=${input.attemptId} AND owner_user_id=${input.scope.ownerUserId} AND workspace_id=${input.scope.workspaceId}
          AND actor_user_id=${input.actorUserId} FOR UPDATE`);
      const attemptRow = rows(attemptResult)[0];
      if (!attemptRow) return undefined;
      const attempt = attemptFromRows(attemptRow, []);
      const replay = rows(await tx.execute(sql`SELECT * FROM ${aiMediaOAuthTargetSelections}
          WHERE owner_user_id=${attempt.scope.ownerUserId} AND workspace_id=${attempt.scope.workspaceId}
            AND actor_user_id=${attempt.actorUserId} AND provider_account_id=${attempt.providerAccountId}
            AND platform=${attempt.platform} AND oauth_session_id=${attempt.oauthSessionId} AND attempt_id=${attempt.id}`));
      if (replay.length > 0) {
        if (replay.length !== 1 || String(value(replay[0], "candidateId", "candidate_id")) !== input.candidateId
          || String(value(replay[0], "targetKind", "target_kind")) !== input.targetKind
          || String(value(replay[0], "targetExternalId", "target_external_id")) !== input.targetId
          || String(value(replay[0], "selectedActorUserId", "selected_actor_user_id")) !== input.actorUserId
          || Number(value(replay[0], "selectedStageVersion", "selected_stage_version")) !== input.expectedStageVersion) return undefined;
        return this.readAttempt(tx, input.scope, input.attemptId, attemptRow);
      }
      if (attempt.stage !== "awaiting_target" || attempt.stageVersion !== input.expectedStageVersion
        || Date.parse(attempt.expiresAt) <= parseIso(iso(value(attemptRow, "databaseNow", "database_now")))) return undefined;
      const candidateResult = await tx.execute(sql`SELECT * FROM ${aiMediaOAuthTargetCandidates}
        WHERE owner_user_id=${attempt.scope.ownerUserId} AND workspace_id=${attempt.scope.workspaceId}
          AND actor_user_id=${attempt.actorUserId} AND provider_account_id=${attempt.providerAccountId}
          AND platform=${attempt.platform} AND oauth_session_id=${attempt.oauthSessionId} AND attempt_id=${attempt.id}
          AND candidate_id=${input.candidateId} AND target_kind=${input.targetKind} AND target_external_id=${input.targetId}`);
      const candidate = rows(candidateResult)[0];
      if (!candidate) return undefined;
      const eligibilityDigest = String(value(candidate, "eligibilityDigest", "eligibility_digest"));
      const selectedAt = iso(value(attemptRow, "databaseNow", "database_now"));
      const candidateCapabilities = stringArray(candidate.capabilities, true) as OAuthProviderTargetCandidate["capabilities"];
      const selectionDigest = deriveOAuthProviderSelectionDigest({
        attemptId: attempt.id, scope: attempt.scope, actorUserId: input.actorUserId,
        providerAccountId: attempt.providerAccountId, oauthSessionId: attempt.oauthSessionId,
        platform: attempt.platform, grantFamily: attempt.grantFamily, candidateId: input.candidateId,
        targetId: input.targetId, targetKind: input.targetKind, eligibilityDigest,
        selectedStageVersion: input.expectedStageVersion, selectedAt,
        manifestRevision: attempt.manifestRevision, tokenBindingId: attempt.tokenBindingId,
        expectedCredentialVersion: attempt.expectedCredentialVersion,
        targetCredentialVersion: attempt.targetCredentialVersion, actualScopes: attempt.actualScopes,
        capabilities: candidateCapabilities,
      });
      const inserted = await tx.execute(sql`INSERT INTO ${aiMediaOAuthTargetSelections} (
          owner_user_id,workspace_id,actor_user_id,provider_account_id,platform,oauth_session_id,attempt_id,candidate_id,
          target_kind,target_external_id,selected_actor_user_id,selected_at,selection_digest,selection_version,selected_stage_version,created_at
        ) VALUES (${attempt.scope.ownerUserId},${attempt.scope.workspaceId},${attempt.actorUserId},${attempt.providerAccountId},
          ${attempt.platform},${attempt.oauthSessionId},${attempt.id},${input.candidateId},${input.targetKind},${input.targetId},
          ${input.actorUserId},${new Date(selectedAt)},${selectionDigest},1,${input.expectedStageVersion},clock_timestamp())
        ON CONFLICT (owner_user_id,workspace_id,actor_user_id,provider_account_id,platform,oauth_session_id,attempt_id)
        DO NOTHING RETURNING selection_digest`);
      if (rows(inserted).length !== 1) return undefined;
      const advanced = await tx.execute(sql`UPDATE ${aiMediaOAuthConnectionAttempts}
        SET stage='activation_pending',stage_version=stage_version+1,updated_at=clock_timestamp()
        WHERE id=${attempt.id} AND owner_user_id=${attempt.scope.ownerUserId} AND workspace_id=${attempt.scope.workspaceId}
          AND stage='awaiting_target' AND stage_version=${input.expectedStageVersion} RETURNING id`);
      if (rows(advanced).length !== 1) return undefined;
      return this.readAttempt(tx, input.scope, input.attemptId);
    });
  }

  async markFailed(input: OAuthProviderConnectionFence & { failureCode: OAuthProviderConnectionFailureCode }): Promise<OAuthProviderConnectionAttempt | undefined> {
    const terminalDigest = digest({ attemptId: input.attemptId, failureCode: input.failureCode, leaseFencing: input.leaseFencing });
    const result = await this.db.execute(sql`UPDATE ${aiMediaOAuthConnectionAttempts}
      SET stage='failed',stage_version=stage_version+1,failure_code=${input.failureCode},terminal_outcome='failed',
        terminal_evidence_digest=${terminalDigest},terminal_at=clock_timestamp(),lease_token=NULL,lease_owner=NULL,
        lease_expires_at=NULL,updated_at=clock_timestamp()
      WHERE id=${input.attemptId} AND owner_user_id=${input.scope.ownerUserId} AND workspace_id=${input.scope.workspaceId}
        AND stage IN ('exchange_in_progress','discovery_in_progress','activation_in_progress')
        AND lease_token=${input.leaseToken} AND lease_fencing=${input.leaseFencing} AND lease_expires_at>clock_timestamp()
      RETURNING *`);
    const failed = rows(result)[0];
    return failed ? this.readAttempt(this.db, input.scope, input.attemptId, failed) : undefined;
  }

  private async fencedUpdate(
    input: OAuthProviderConnectionFence,
    assignment: SQL,
    expectedStage: string,
  ): Promise<OAuthProviderConnectionAttempt | undefined> {
    const result = await this.db.execute(sql`UPDATE ${aiMediaOAuthConnectionAttempts} SET ${assignment}
      WHERE id=${input.attemptId} AND owner_user_id=${input.scope.ownerUserId} AND workspace_id=${input.scope.workspaceId}
        AND stage=${expectedStage} AND lease_token=${input.leaseToken} AND lease_fencing=${input.leaseFencing}
        AND lease_expires_at>clock_timestamp() RETURNING *`);
    const updated = rows(result)[0];
    return updated ? this.readAttempt(this.db, input.scope, input.attemptId, updated) : undefined;
  }

  protected async readAttempt(
    db: OAuthProviderConnectionDatabase,
    scope: TenantScope,
    attemptId: string,
    knownAttempt?: Record<string, unknown>,
  ): Promise<OAuthProviderConnectionAttempt | undefined> {
    const attempt = knownAttempt ?? rows(await db.execute(sql`SELECT * FROM ${aiMediaOAuthConnectionAttempts}
      WHERE id=${attemptId} AND owner_user_id=${scope.ownerUserId} AND workspace_id=${scope.workspaceId}`))[0];
    if (!attempt) return undefined;
    const source = {
      ownerUserId: String(value(attempt, "ownerUserId", "owner_user_id")),
      workspaceId: String(value(attempt, "workspaceId", "workspace_id")),
      actorUserId: String(value(attempt, "actorUserId", "actor_user_id")),
      providerAccountId: String(value(attempt, "providerAccountId", "provider_account_id")),
      platform: String(attempt.platform),
      oauthSessionId: String(value(attempt, "oauthSessionId", "oauth_session_id")),
    };
    const candidateRows = rows(await db.execute(sql`SELECT * FROM ${aiMediaOAuthTargetCandidates}
      WHERE owner_user_id=${source.ownerUserId} AND workspace_id=${source.workspaceId} AND actor_user_id=${source.actorUserId}
        AND provider_account_id=${source.providerAccountId} AND platform=${source.platform}
        AND oauth_session_id=${source.oauthSessionId} AND attempt_id=${attemptId}
      ORDER BY candidate_id`));
    const selectionRows = rows(await db.execute(sql`SELECT selections.*,candidates.eligibility_digest
      FROM ${aiMediaOAuthTargetSelections} selections INNER JOIN ${aiMediaOAuthTargetCandidates} candidates
        ON candidates.owner_user_id=selections.owner_user_id AND candidates.workspace_id=selections.workspace_id
        AND candidates.actor_user_id=selections.actor_user_id AND candidates.provider_account_id=selections.provider_account_id
        AND candidates.platform=selections.platform AND candidates.oauth_session_id=selections.oauth_session_id
        AND candidates.attempt_id=selections.attempt_id AND candidates.candidate_id=selections.candidate_id
        AND candidates.target_kind=selections.target_kind AND candidates.target_external_id=selections.target_external_id
      WHERE selections.owner_user_id=${source.ownerUserId} AND selections.workspace_id=${source.workspaceId}
        AND selections.actor_user_id=${source.actorUserId} AND selections.provider_account_id=${source.providerAccountId}
        AND selections.platform=${source.platform} AND selections.oauth_session_id=${source.oauthSessionId}
        AND selections.attempt_id=${attemptId}`));
    if (selectionRows.length > 1) throw new Error("Invalid provider target selection cardinality");
    return attemptFromRows(attempt, candidateRows, selectionRows[0]);
  }
}
