import { createHash } from "node:crypto";
import {
  sourceEligibilityReviewRequestSchema,
  sourceEligibilityReviewResponseSchema,
  type SourceEligibilityReviewRequest,
  type SourceEligibilityReviewResponse,
} from "../../../shared/ai-media-studio-source-eligibility";
import type { TenantScope } from "../core/resource-domain";
import {
  SourceEligibilityRepositoryError,
  type SourceEligibilityReviewResult,
  type SourceRepository,
} from "./contracts";

export type SourceEligibilityReviewErrorCode =
  | "INVALID_CONFIGURATION"
  | "INVALID_REQUEST"
  | "NOT_FOUND"
  | "SOURCE_REFRESHED"
  | "REVIEW_CONFLICT"
  | "REVIEW_UNAVAILABLE";

export class SourceEligibilityReviewError extends Error {
  readonly statusCode: number;

  constructor(readonly code: SourceEligibilityReviewErrorCode) {
    super("Source eligibility review is unavailable");
    this.name = "SourceEligibilityReviewError";
    this.statusCode = code === "INVALID_REQUEST" ? 400
      : code === "NOT_FOUND" ? 404
        : code === "SOURCE_REFRESHED" || code === "REVIEW_CONFLICT" ? 409
          : code === "REVIEW_UNAVAILABLE" ? 503
            : 500;
  }
}

export class SourceEligibilityReviewService {
  constructor(private readonly repository: SourceRepository) {
    if (!repository || typeof repository.reviewEligibility !== "function") {
      throw new SourceEligibilityReviewError("INVALID_CONFIGURATION");
    }
  }

  async review(
    scope: TenantScope,
    actorUserId: string,
    unsafeSourceItemId: unknown,
    unsafeRequest: unknown,
  ): Promise<SourceEligibilityReviewResponse> {
    const sourceItemId = typeof unsafeSourceItemId === "string"
      && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(unsafeSourceItemId)
      ? unsafeSourceItemId : undefined;
    const request = sourceEligibilityReviewRequestSchema.safeParse(unsafeRequest);
    if (!sourceItemId || !request.success || !scope.ownerUserId.trim() || !scope.workspaceId.trim()
      || !actorUserId.trim() || actorUserId !== scope.ownerUserId) {
      throw new SourceEligibilityReviewError("INVALID_REQUEST");
    }
    const inputDigest = digest({
      ownerUserId: scope.ownerUserId,
      workspaceId: scope.workspaceId,
      sourceItemId,
      request: request.data,
    });
    try {
      const result = await this.repository.reviewEligibility!(scope, {
        sourceItemId,
        expectedContentHash: request.data.expectedContentHash as `sha256:${string}`,
        idempotencyKey: request.data.idempotencyKey,
        actorUserId,
        inputDigest,
        review: request.data.decision === "approve"
          ? { decision: "approve", rightsStatus: request.data.rightsStatus }
          : { decision: "reject", reasonCode: request.data.reasonCode },
      });
      return publicResponse(request.data, result);
    } catch (error) {
      if (error instanceof SourceEligibilityRepositoryError) {
        throw new SourceEligibilityReviewError(error.code);
      }
      throw new SourceEligibilityReviewError("REVIEW_UNAVAILABLE");
    }
  }
}

function publicResponse(
  request: SourceEligibilityReviewRequest,
  result: SourceEligibilityReviewResult,
): SourceEligibilityReviewResponse {
  const eligible = request.decision === "approve";
  return sourceEligibilityReviewResponseSchema.parse({
    source: {
      id: result.item.id,
      category: result.item.category,
      contentHash: result.item.contentHash,
      status: result.item.status,
      rightsStatus: result.item.rightsStatus,
      moderationStatus: result.item.moderationStatus,
      updatedAt: result.item.updatedAt,
    },
    review: { decision: request.decision, replayed: result.replayed, reviewedAt: result.reviewedAt },
    downstreamState: eligible ? "eligible_for_script_batch" : "blocked",
    effects: {
      sourceReviewPersisted: true,
      scriptsGenerated: false,
      renderQueued: false,
      outboxCreated: false,
      videoProviderCalled: false,
      secretResolved: false,
      spendCommitted: false,
      publishingCreated: false,
      migrationApplied: false,
      deploymentPerformed: false,
    },
  });
}

function digest(input: unknown): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(JSON.stringify(input)).digest("hex")}`;
}
