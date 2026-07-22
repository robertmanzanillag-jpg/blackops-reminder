import type { OneVideoCostApprovalResponse } from "../../../shared/ai-media-studio-one-video-cost-approval";
import type { TenantScope } from "../core/resource-domain";
import type { LaunchAuthorityAuthenticationContext } from "./launch-authority-contracts";

export type OneVideoCostApprovalErrorCode =
  | "INVALID_REQUEST"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "STALE_OR_CONFLICT"
  | "UNAVAILABLE";

export class OneVideoCostApprovalError extends Error {
  readonly statusCode: number;

  constructor(readonly code: OneVideoCostApprovalErrorCode) {
    super("One-video cost approval request could not be completed");
    this.name = "OneVideoCostApprovalError";
    this.statusCode = code === "INVALID_REQUEST" ? 400
      : code === "UNAUTHENTICATED" ? 401
        : code === "FORBIDDEN" ? 403
          : code === "NOT_FOUND" ? 404
            : code === "STALE_OR_CONFLICT" ? 409
              : 503;
  }
}

/** The browser request is never used as launch-authority authentication context directly. */
export interface OneVideoCostApprovalAuthorizer {
  authorize(input: Readonly<{
    authorizationContext: unknown;
    scope: TenantScope;
  }>): Promise<Readonly<{ launchAuthorityContext: LaunchAuthorityAuthenticationContext }> | undefined>;
}

export interface OneVideoCostApprovalContext {
  readonly dailyPlanSlotId: string;
  readonly slotAttempt: number;
  readonly planId: string;
  readonly batchId: string;
  readonly slotId: string;
  readonly quoteKey: string;
  readonly renderSpecKey: string;
}

export interface OneVideoCostApprovalContextLoader {
  load(scope: TenantScope, publicPlanKey: string, publicSlotKey: string): Promise<OneVideoCostApprovalContext | undefined>;
}

export interface OneVideoCostApprovalCommand {
  readonly scope: TenantScope;
  readonly publicPlanKey: string;
  readonly publicSlotKey: string;
  readonly expectedBatchId: string;
  readonly expectedQuoteKey: string;
  readonly decision: "approved" | "rejected" | "revoked";
  readonly idempotencyKey: string;
  readonly authorizationContext: unknown;
}

export type OneVideoCostApprovalReceipt = OneVideoCostApprovalResponse;
