import type { ApprovalEvidence, SourceItem as SharedSourceItem } from "../../../shared/ai-media-studio-operations";
import type { TenantScope } from "../core/resource-domain";

type ModerationStatus = SharedSourceItem["moderationStatus"];
type SourceRightsStatus = SharedSourceItem["rightsStatus"];

export const ORCHESTRATION_STATES = [
  "source_seen",
  "idea_draft",
  "script_draft",
  "approval_required",
  "approved",
  "render_queued",
  "asset_ready",
  "publishing_approval_required",
  "queued",
] as const;

export type OrchestrationState = (typeof ORCHESTRATION_STATES)[number];

export interface RightsEvidence {
  evidenceId: string;
  status: SourceRightsStatus;
  assertedAt: string;
}

export interface ModerationEvidence {
  evidenceId: string;
  status: ModerationStatus;
  evaluatedAt: string;
}

export interface BudgetReservationEvidence {
  reservationId: string;
  amountUsd: number;
  reservedAt: string;
  expiresAt: string;
}

export interface KillSwitchEvidence {
  globalKillSwitchActive: boolean;
  policyVersion: string;
  evaluatedAt: string;
}

export interface OrchestrationRun {
  id: string;
  ownerUserId: string;
  workspaceId: string;
  sourceItemId: string;
  state: OrchestrationState;
  version: number;
  rights: RightsEvidence;
  moderation: ModerationEvidence;
  contentPreviewDigest?: `sha256:${string}`;
  contentApproval?: ApprovalEvidence;
  budgetReservation?: BudgetReservationEvidence;
  assetId?: string;
  publishingPreviewDigest?: `sha256:${string}`;
  publishingApproval?: ApprovalEvidence;
  policyEvidence?: KillSwitchEvidence;
  appliedTransitionKeys: string[];
  createdAt: string;
  updatedAt: string;
}

export type OrchestrationTransition =
  | { type: "draft_idea"; idempotencyKey: string }
  | { type: "draft_script"; idempotencyKey: string }
  | { type: "request_content_approval"; idempotencyKey: string; previewDigest: `sha256:${string}` }
  | { type: "approve_content"; idempotencyKey: string; approval: ApprovalEvidence }
  | { type: "queue_render"; idempotencyKey: string; budget: BudgetReservationEvidence; policy: KillSwitchEvidence }
  | { type: "record_asset_ready"; idempotencyKey: string; assetId: string }
  | { type: "request_publishing_approval"; idempotencyKey: string; previewDigest: `sha256:${string}` }
  | { type: "queue_publish"; idempotencyKey: string; approval: ApprovalEvidence; policy: KillSwitchEvidence };

export type OrchestrationEmissionType =
  | "ai_media.source.seen"
  | "ai_media.idea.draft.requested"
  | "ai_media.script.draft.requested"
  | "ai_media.content.approval.requested"
  | "ai_media.content.approved"
  | "ai_media.render.requested"
  | "ai_media.asset.ready"
  | "ai_media.publishing.approval.requested"
  | "ai_media.publish.requested";

export interface OrchestrationEmission {
  id: string;
  idempotencyKey: string;
  aggregateId: string;
  type: OrchestrationEmissionType;
  kind: "event" | "command";
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface OrchestrationRepository {
  create(scope: TenantScope, run: OrchestrationRun, emission: OrchestrationEmission): Promise<OrchestrationRun>;
  get(scope: TenantScope, runId: string): Promise<OrchestrationRun | undefined>;
  getBySourceItem(scope: TenantScope, sourceItemId: string): Promise<OrchestrationRun | undefined>;
  save(
    scope: TenantScope,
    expected: { state: OrchestrationState; version: number },
    run: OrchestrationRun,
    emissions: readonly OrchestrationEmission[],
  ): Promise<OrchestrationRun>;
  listEmissions?(scope: TenantScope, runId: string): Promise<OrchestrationEmission[]>;
}

export class OrchestrationDeniedError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "OrchestrationDeniedError";
  }
}

export class OrchestrationConflictError extends Error {
  constructor(message = "Orchestration state changed concurrently") {
    super(message);
    this.name = "OrchestrationConflictError";
  }
}
