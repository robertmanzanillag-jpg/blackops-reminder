import { createHash } from "node:crypto";
import { sql, type SQL } from "drizzle-orm";
import {
  aiMediaAssetIngestJobs,
  aiMediaDailyPlanSlots,
  aiMediaOutbox,
  aiMediaProviderSubmissionAttempts,
  aiMediaProviderTerminalChecks,
  aiMediaProviderTerminalEvents,
  aiMediaRenderJobs,
} from "../../../shared/models/ai-media-studio-db";
import type { TenantScope } from "../core/resource-domain";
import type { Sha256Digest } from "../planning/contracts";
import type { ProviderArtifactResolutionRequest } from "./contracts";
import { durableProviderArtifactRef } from "./provider-artifact-identity";

type ExecuteResult = { rows?: unknown[] } | unknown[];
type Row = Record<string, unknown>;

export interface AdmittedProviderArtifactBinding {
  readonly jobId: string;
  readonly tenantId: string;
  readonly renderJobId: string;
  readonly remoteArtifactRef: string;
  readonly providerJobId: string;
  readonly scope: TenantScope;
  readonly providerAccountId: string;
  readonly providerKey: string;
  readonly providerCredentialVersion: number;
  readonly authorizationDigest: Sha256Digest;
}

export interface AdmittedProviderArtifactBindingDatabase {
  execute(query: SQL): Promise<ExecuteResult>;
}

export interface AdmittedProviderArtifactBindingLoader {
  load(request: ProviderArtifactResolutionRequest): Promise<AdmittedProviderArtifactBinding | undefined>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;

/**
 * Resolves one actively leased ingest job through the immutable admitted-render
 * evidence graph. Every identity edge is repeated in the query so a stale URL,
 * another attempt, tenant, account, credential version, or provider job cannot
 * be substituted for the terminal output that created the ingest job.
 */
export class DrizzleAdmittedProviderArtifactBindingLoader
implements AdmittedProviderArtifactBindingLoader {
  constructor(private readonly db: AdmittedProviderArtifactBindingDatabase) {}

  async load(
    request: ProviderArtifactResolutionRequest,
  ): Promise<AdmittedProviderArtifactBinding | undefined> {
    const scope = parseRequest(request);
    if (!scope) return undefined;
    try {
      const loaded = resultRows(await this.db.execute(sql`
        SELECT ingest.id AS job_id,ingest.owner_user_id,ingest.workspace_id,
          ingest.render_job_id,ingest.remote_artifact_ref,
          terminal.submission_attempt_id,terminal.provider_evidence_digest,
          terminal.bound_evidence_digest,terminal.provider_job_id,
          terminal.provider_account_id,terminal.provider_key,
          terminal.provider_credential_version,
          terminal.send_authorization_digest AS authorization_digest
        FROM ${aiMediaAssetIngestJobs} ingest
        INNER JOIN ${aiMediaProviderTerminalEvents} terminal
          ON terminal.owner_user_id=ingest.owner_user_id
          AND terminal.workspace_id=ingest.workspace_id
          AND terminal.render_job_id=ingest.render_job_id
          AND terminal.provider_key=ingest.provider_key
          AND terminal.terminal_state='completed'
          AND terminal.remote_artifact_ref=ingest.remote_artifact_ref
          AND terminal.remote_url=ingest.remote_url
          AND terminal.expected_mime_type=ingest.expected_mime_type
        INNER JOIN ${aiMediaProviderSubmissionAttempts} attempt
          ON attempt.owner_user_id=terminal.owner_user_id
          AND attempt.workspace_id=terminal.workspace_id
          AND attempt.id=terminal.submission_attempt_id
          AND attempt.budget_reservation_id=terminal.budget_reservation_id
          AND attempt.render_job_id=terminal.render_job_id
          AND attempt.dispatch_outbox_id=terminal.dispatch_outbox_id
          AND attempt.daily_plan_slot_id=terminal.daily_plan_slot_id
          AND attempt.provider_account_id=terminal.provider_account_id
          AND attempt.provider_key=terminal.provider_key
          AND attempt.provider_credential_version=terminal.provider_credential_version
          AND attempt.provider_job_id=terminal.provider_job_id
          AND attempt.send_authorization_digest=terminal.send_authorization_digest
          AND attempt.state='confirmed'
        INNER JOIN ${aiMediaProviderTerminalChecks} terminal_check
          ON terminal_check.owner_user_id=terminal.owner_user_id
          AND terminal_check.workspace_id=terminal.workspace_id
          AND terminal_check.id=terminal.terminal_check_id
          AND terminal_check.submission_attempt_id=terminal.submission_attempt_id
          AND terminal_check.budget_reservation_id=terminal.budget_reservation_id
          AND terminal_check.render_job_id=terminal.render_job_id
          AND terminal_check.dispatch_outbox_id=terminal.dispatch_outbox_id
          AND terminal_check.daily_plan_slot_id=terminal.daily_plan_slot_id
          AND terminal_check.provider_account_id=terminal.provider_account_id
          AND terminal_check.provider_key=terminal.provider_key
          AND terminal_check.provider_credential_version=terminal.provider_credential_version
          AND terminal_check.provider_job_id=terminal.provider_job_id
          AND terminal_check.send_authorization_digest=terminal.send_authorization_digest
          AND terminal_check.state='terminal'
        INNER JOIN ${aiMediaRenderJobs} render
          ON render.owner_user_id=terminal.owner_user_id
          AND render.workspace_id=terminal.workspace_id
          AND render.id=terminal.render_job_id
          AND render.budget_reservation_id=terminal.budget_reservation_id
          AND render.daily_plan_slot_id=terminal.daily_plan_slot_id
          AND render.provider_account_id=terminal.provider_account_id
          AND render.provider_key=terminal.provider_key
          AND render.provider_credential_version=terminal.provider_credential_version
          AND render.provider_job_id=terminal.provider_job_id
          AND render.provider_terminal_state='completed'
          AND render.provider_terminal_evidence_digest=terminal.bound_evidence_digest
          AND render.status='rendering'
          AND render.stage IN ('artifact_ingest_queued','artifact_ingest_retrying')
          AND render.output_media_asset_id IS NULL
        INNER JOIN ${aiMediaOutbox} outbox
          ON outbox.owner_user_id=terminal.owner_user_id
          AND outbox.workspace_id=terminal.workspace_id
          AND outbox.id=terminal.dispatch_outbox_id
          AND outbox.render_job_id=terminal.render_job_id
          AND outbox.provider_terminal_state='completed'
          AND outbox.provider_terminal_evidence_digest=terminal.bound_evidence_digest
        INNER JOIN ${aiMediaDailyPlanSlots} slot
          ON slot.owner_user_id=terminal.owner_user_id
          AND slot.workspace_id=terminal.workspace_id
          AND slot.id=terminal.daily_plan_slot_id
          AND slot.provider_account_id=terminal.provider_account_id
          AND slot.provider_key=terminal.provider_key
          AND slot.provider_credential_version=terminal.provider_credential_version
          AND slot.provider_terminal_state='completed'
          AND slot.provider_terminal_evidence_digest=terminal.bound_evidence_digest
        WHERE ingest.id=${request.jobId}
          AND ingest.owner_user_id=${scope.ownerUserId}
          AND ingest.workspace_id=${scope.workspaceId}
          AND ingest.render_job_id=${request.renderJobId}
          AND ingest.remote_artifact_ref=${request.remoteArtifactRef}
          AND ingest.expected_mime_type=${request.expectedMimeType}
          AND ingest.state='leased'
          AND ingest.lease_token IS NOT NULL
          AND ingest.lease_owner IS NOT NULL
          AND ingest.lease_expires_at>transaction_timestamp()
          AND ingest.media_asset_id IS NULL
          AND ingest.owned_object_key IS NULL
          AND ingest.sha256 IS NULL
          AND ingest.size_bytes IS NULL
        LIMIT 2
      `));
      if (loaded.length !== 1) return undefined;
      return decode(loaded[0]!, request, scope);
    } catch {
      throw new Error("Admitted provider artifact binding unavailable");
    }
  }
}

function parseRequest(request: ProviderArtifactResolutionRequest): TenantScope | undefined {
  if (!request || request.expectedMimeType !== "video/mp4"
    || !UUID.test(request.jobId) || !UUID.test(request.renderJobId)
    || !validOpaque(request.remoteArtifactRef, 1_000)) return undefined;
  try {
    const tenant: unknown = JSON.parse(request.tenantId);
    if (!Array.isArray(tenant) || tenant.length !== 2
      || !validOpaque(tenant[0], 255) || !validOpaque(tenant[1], 255)) return undefined;
    return Object.freeze({ workspaceId: tenant[0], ownerUserId: tenant[1] });
  } catch {
    return undefined;
  }
}

function decode(
  row: Row,
  request: ProviderArtifactResolutionRequest,
  scope: TenantScope,
): AdmittedProviderArtifactBinding | undefined {
  const providerCredentialVersion = Number(value(row, "providerCredentialVersion", "provider_credential_version"));
  const submissionAttemptId = text(row, "submissionAttemptId", "submission_attempt_id");
  const providerEvidenceDigest = text(row, "providerEvidenceDigest", "provider_evidence_digest");
  const boundEvidenceDigest = text(row, "boundEvidenceDigest", "bound_evidence_digest");
  const binding = {
    jobId: text(row, "jobId", "job_id"),
    tenantId: request.tenantId,
    renderJobId: text(row, "renderJobId", "render_job_id"),
    remoteArtifactRef: text(row, "remoteArtifactRef", "remote_artifact_ref"),
    providerJobId: text(row, "providerJobId", "provider_job_id"),
    scope: Object.freeze({
      ownerUserId: text(row, "ownerUserId", "owner_user_id"),
      workspaceId: text(row, "workspaceId", "workspace_id"),
    }),
    providerAccountId: text(row, "providerAccountId", "provider_account_id"),
    providerKey: text(row, "providerKey", "provider_key"),
    providerCredentialVersion,
    authorizationDigest: text(row, "authorizationDigest", "authorization_digest"),
  };
  const expectedBoundDigest = terminalBoundDigest({
    scope: binding.scope,
    submissionAttemptId,
    authorizationDigest: binding.authorizationDigest,
    providerAccountId: binding.providerAccountId,
    providerKey: binding.providerKey,
    providerCredentialVersion,
    providerJobId: binding.providerJobId,
    remoteArtifactRef: binding.remoteArtifactRef,
    providerEvidenceDigest,
  });
  const expectedArtifactRef = durableProviderArtifactRef(binding);
  if (binding.jobId !== request.jobId || binding.renderJobId !== request.renderJobId
    || binding.remoteArtifactRef !== request.remoteArtifactRef
    || binding.remoteArtifactRef !== expectedArtifactRef
    || binding.scope.ownerUserId !== scope.ownerUserId
    || binding.scope.workspaceId !== scope.workspaceId
    || !UUID.test(submissionAttemptId)
    || !UUID.test(binding.providerAccountId)
    || !validOpaque(binding.providerKey, 80)
    || !validOpaque(binding.providerJobId, 500)
    || !Number.isSafeInteger(binding.providerCredentialVersion)
    || binding.providerCredentialVersion < 1
    || !SHA256.test(binding.authorizationDigest)
    || !SHA256.test(providerEvidenceDigest)
    || boundEvidenceDigest !== expectedBoundDigest) return undefined;
  return Object.freeze(binding) as AdmittedProviderArtifactBinding;
}

function terminalBoundDigest(input: {
  scope: TenantScope;
  submissionAttemptId: string;
  authorizationDigest: string;
  providerAccountId: string;
  providerKey: string;
  providerCredentialVersion: number;
  providerJobId: string;
  remoteArtifactRef: string;
  providerEvidenceDigest: string;
}): string {
  return `sha256:${createHash("sha256").update([
    "provider-terminal:v1",
    input.scope.ownerUserId,
    input.scope.workspaceId,
    input.submissionAttemptId,
    input.authorizationDigest,
    input.providerAccountId,
    input.providerKey,
    String(input.providerCredentialVersion),
    input.providerJobId,
    "completed",
    input.remoteArtifactRef,
    input.providerEvidenceDigest,
  ].join(":")).digest("hex")}`;
}

function resultRows(result: ExecuteResult): Row[] {
  const candidate = Array.isArray(result) ? result : result?.rows;
  return Array.isArray(candidate)
    && candidate.every((row) => row !== null && typeof row === "object" && !Array.isArray(row))
    ? candidate as Row[]
    : [];
}

function value(row: Row, camel: string, snake: string): unknown {
  return row[camel] ?? row[snake];
}

function text(row: Row, camel: string, snake: string): string {
  return String(value(row, camel, snake) ?? "");
}

function validOpaque(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= maximum
    && value === value.trim() && !/[\u0000-\u001f\u007f-\u009f]/u.test(value);
}
