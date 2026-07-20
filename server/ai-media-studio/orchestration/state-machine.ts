import { randomUUID } from "node:crypto";
import type { ApprovalEvidence } from "../../../shared/ai-media-studio-operations";
import type { TenantScope } from "../core/resource-domain";
import {
  OrchestrationConflictError,
  OrchestrationDeniedError,
  type BudgetReservationEvidence,
  type KillSwitchEvidence,
  type ModerationEvidence,
  type OrchestrationEmission,
  type OrchestrationEmissionType,
  type OrchestrationRepository,
  type OrchestrationRun,
  type OrchestrationTransition,
  type RightsEvidence,
} from "./contracts";

const SHA256 = /^sha256:[a-f0-9]{64}$/;

function assertScope(scope: TenantScope): void {
  if (!scope.ownerUserId.trim() || !scope.workspaceId.trim()) throw new Error("Tenant scope is required");
}

function assertCompliance(run: OrchestrationRun): void {
  if (!run.rights.evidenceId.trim() || !Number.isFinite(Date.parse(run.rights.assertedAt))
    || !["owned", "licensed"].includes(run.rights.status)) {
    throw new OrchestrationDeniedError("rights_not_allowed", "Known owned or licensed rights evidence is required");
  }
  if (!run.moderation.evidenceId.trim() || !Number.isFinite(Date.parse(run.moderation.evaluatedAt))
    || run.moderation.status !== "approved") {
    throw new OrchestrationDeniedError("moderation_not_approved", "Approved moderation evidence is required");
  }
}

function assertPolicy(policy: KillSwitchEvidence): void {
  if (!policy.policyVersion.trim() || !Number.isFinite(Date.parse(policy.evaluatedAt))) {
    throw new OrchestrationDeniedError("policy_evidence_invalid", "Current kill-switch policy evidence is required");
  }
  if (policy.globalKillSwitchActive) {
    throw new OrchestrationDeniedError("global_kill_switch_active", "Global kill switch blocks queued side effects");
  }
}

function assertBudget(budget: BudgetReservationEvidence, now: string): void {
  if (!budget.reservationId.trim() || !Number.isFinite(budget.amountUsd) || budget.amountUsd < 0) {
    throw new OrchestrationDeniedError("budget_reservation_invalid", "Valid budget reservation evidence is required");
  }
  if (!Number.isFinite(Date.parse(budget.reservedAt)) || Date.parse(budget.expiresAt) <= Date.parse(now)) {
    throw new OrchestrationDeniedError("budget_reservation_expired", "An unexpired budget reservation is required");
  }
}

function assertApproval(approval: ApprovalEvidence, digest: string | undefined): void {
  if (!digest || approval.decision !== "approved" || approval.previewDigest !== digest
    || !approval.actorId.trim() || !Number.isFinite(Date.parse(approval.decidedAt))) {
    throw new OrchestrationDeniedError("manual_approval_invalid", "Manual approval must match the exact preview digest");
  }
}

function emission(
  run: OrchestrationRun,
  transitionKey: string,
  type: OrchestrationEmissionType,
  kind: "event" | "command",
  now: string,
  payload: Record<string, unknown> = {},
): OrchestrationEmission {
  return {
    id: randomUUID(),
    idempotencyKey: `orchestration:${run.id}:${transitionKey}:${type}`,
    aggregateId: run.id,
    type,
    kind,
    payload: { runId: run.id, sourceItemId: run.sourceItemId, ...payload },
    createdAt: now,
  };
}

function requireState(run: OrchestrationRun, state: OrchestrationRun["state"]): void {
  if (run.state !== state) throw new OrchestrationConflictError(`Expected ${state}; found ${run.state}`);
}

export class SourceOrchestrator {
  constructor(
    private readonly repository: OrchestrationRepository,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async initialize(
    scope: TenantScope,
    input: { sourceItemId: string; idempotencyKey: string; rights: RightsEvidence; moderation: ModerationEvidence },
  ): Promise<OrchestrationRun> {
    assertScope(scope);
    const existing = await this.repository.getBySourceItem(scope, input.sourceItemId);
    if (existing) {
      if (existing.appliedTransitionKeys.includes(input.idempotencyKey)) return existing;
      throw new OrchestrationConflictError("Source already has an orchestration run");
    }
    const now = this.clock().toISOString();
    const run: OrchestrationRun = {
      id: randomUUID(),
      ownerUserId: scope.ownerUserId,
      workspaceId: scope.workspaceId,
      sourceItemId: input.sourceItemId,
      state: "source_seen",
      version: 1,
      rights: { ...input.rights },
      moderation: { ...input.moderation },
      appliedTransitionKeys: [input.idempotencyKey],
      createdAt: now,
      updatedAt: now,
    };
    return this.repository.create(scope, run, emission(run, input.idempotencyKey, "ai_media.source.seen", "event", now));
  }

  async transition(scope: TenantScope, runId: string, input: OrchestrationTransition): Promise<OrchestrationRun> {
    assertScope(scope);
    const current = await this.repository.get(scope, runId);
    if (!current) throw new Error("Orchestration run not found");
    if (current.appliedTransitionKeys.includes(input.idempotencyKey)) return current;
    const now = this.clock().toISOString();
    const next: OrchestrationRun = structuredClone(current);
    const emissions: OrchestrationEmission[] = [];

    switch (input.type) {
      case "draft_idea":
        requireState(current, "source_seen");
        assertCompliance(current);
        next.state = "idea_draft";
        emissions.push(emission(current, input.idempotencyKey, "ai_media.idea.draft.requested", "command", now));
        break;
      case "draft_script":
        requireState(current, "idea_draft");
        assertCompliance(current);
        next.state = "script_draft";
        emissions.push(emission(current, input.idempotencyKey, "ai_media.script.draft.requested", "command", now));
        break;
      case "request_content_approval":
        requireState(current, "script_draft");
        if (!SHA256.test(input.previewDigest)) throw new Error("Content preview digest is invalid");
        next.contentPreviewDigest = input.previewDigest;
        next.state = "approval_required";
        emissions.push(emission(current, input.idempotencyKey, "ai_media.content.approval.requested", "event", now, { previewDigest: input.previewDigest }));
        break;
      case "approve_content":
        requireState(current, "approval_required");
        assertApproval(input.approval, current.contentPreviewDigest);
        next.contentApproval = structuredClone(input.approval);
        next.state = "approved";
        emissions.push(emission(current, input.idempotencyKey, "ai_media.content.approved", "event", now));
        break;
      case "queue_render":
        requireState(current, "approved");
        assertCompliance(current);
        assertApproval(current.contentApproval!, current.contentPreviewDigest);
        assertBudget(input.budget, now);
        assertPolicy(input.policy);
        next.budgetReservation = { ...input.budget };
        next.policyEvidence = { ...input.policy };
        next.state = "render_queued";
        emissions.push(emission(current, input.idempotencyKey, "ai_media.render.requested", "command", now, { budgetReservationId: input.budget.reservationId }));
        break;
      case "record_asset_ready":
        requireState(current, "render_queued");
        if (!input.assetId.trim()) throw new Error("Asset ID is required");
        next.assetId = input.assetId;
        next.state = "asset_ready";
        emissions.push(emission(current, input.idempotencyKey, "ai_media.asset.ready", "event", now, { assetId: input.assetId }));
        break;
      case "request_publishing_approval":
        requireState(current, "asset_ready");
        if (!SHA256.test(input.previewDigest)) throw new Error("Publishing preview digest is invalid");
        next.publishingPreviewDigest = input.previewDigest;
        next.state = "publishing_approval_required";
        emissions.push(emission(current, input.idempotencyKey, "ai_media.publishing.approval.requested", "event", now, { previewDigest: input.previewDigest }));
        break;
      case "queue_publish":
        requireState(current, "publishing_approval_required");
        assertCompliance(current);
        assertApproval(input.approval, current.publishingPreviewDigest);
        if (!current.budgetReservation) throw new OrchestrationDeniedError("budget_reservation_missing", "Render budget reservation evidence must be retained");
        assertPolicy(input.policy);
        next.publishingApproval = structuredClone(input.approval);
        next.policyEvidence = { ...input.policy };
        next.state = "queued";
        emissions.push(emission(current, input.idempotencyKey, "ai_media.publish.requested", "command", now, { assetId: current.assetId }));
        break;
    }

    next.version = current.version + 1;
    next.updatedAt = now;
    next.appliedTransitionKeys.push(input.idempotencyKey);
    return this.repository.save(scope, { state: current.state, version: current.version }, next, emissions);
  }
}
