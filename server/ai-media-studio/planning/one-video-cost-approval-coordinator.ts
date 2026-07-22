import {
  oneVideoCostApprovalResponseSchema,
} from "../../../shared/ai-media-studio-one-video-cost-approval";
import {
  LaunchAuthorityServiceError,
  type LaunchAuthorityReceipt,
} from "./launch-authority-contracts";
import type { LaunchAuthorityService } from "./launch-authority-service";
import {
  OneVideoCostApprovalError,
  type OneVideoCostApprovalAuthorizer,
  type OneVideoCostApprovalCommand,
  type OneVideoCostApprovalContextLoader,
  type OneVideoCostApprovalReceipt,
} from "./one-video-cost-approval-contracts";

type HumanApprovalWriter = Pick<LaunchAuthorityService, "recordHumanLaunchApproval">;

/**
 * Records one human decision against an exact public quote CAS token. The
 * coordinator has no provider, secret, quoting, reservation, render, outbox,
 * spending, or publishing dependency.
 */
export class OneVideoCostApprovalCoordinator {
  constructor(private readonly dependencies: Readonly<{
    authorizer: OneVideoCostApprovalAuthorizer;
    contextLoader: OneVideoCostApprovalContextLoader;
    launchAuthority: HumanApprovalWriter;
  }>) {
    if (!dependencies?.authorizer || !dependencies?.contextLoader || !dependencies?.launchAuthority) {
      throw new OneVideoCostApprovalError("UNAVAILABLE");
    }
  }

  async record(command: OneVideoCostApprovalCommand): Promise<OneVideoCostApprovalReceipt> {
    let authorization: Awaited<ReturnType<OneVideoCostApprovalAuthorizer["authorize"]>>;
    try {
      authorization = await this.dependencies.authorizer.authorize({
        authorizationContext: command.authorizationContext,
        scope: command.scope,
      });
    } catch {
      throw new OneVideoCostApprovalError("UNAVAILABLE");
    }
    if (!authorization) throw new OneVideoCostApprovalError("FORBIDDEN");

    let context;
    try {
      context = await this.dependencies.contextLoader.load(
        command.scope,
        command.publicPlanKey,
        command.publicSlotKey,
      );
    } catch (error) {
      if (error instanceof OneVideoCostApprovalError) throw error;
      throw new OneVideoCostApprovalError("UNAVAILABLE");
    }
    if (!context) throw new OneVideoCostApprovalError("NOT_FOUND");
    if (context.batchId !== command.expectedBatchId
      || context.quoteKey !== command.expectedQuoteKey) {
      throw new OneVideoCostApprovalError("STALE_OR_CONFLICT");
    }

    let receipt: LaunchAuthorityReceipt;
    try {
      receipt = await this.dependencies.launchAuthority.recordHumanLaunchApproval(
        authorization.launchAuthorityContext,
        {
          scope: command.scope,
          dailyPlanSlotId: context.dailyPlanSlotId,
          slotAttempt: context.slotAttempt,
          decision: command.decision,
          expectedQuoteKey: command.expectedQuoteKey,
          idempotencyKey: command.idempotencyKey,
        },
      );
    } catch (error) {
      // Core authority rechecks the quote under its transaction lock. Preserve
      // only its generic refresh signal; every other failure stays fail-closed.
      if (error instanceof LaunchAuthorityServiceError && error.code === "QUOTE_CHANGED") {
        throw new OneVideoCostApprovalError("STALE_OR_CONFLICT");
      }
      throw new OneVideoCostApprovalError("UNAVAILABLE");
    }

    return oneVideoCostApprovalResponseSchema.parse({
      outcome: receipt.replayed ? "replayed" : "recorded",
      approval: {
        planId: context.planId,
        batchId: context.batchId,
        slotId: context.slotId,
        decision: command.decision,
        approvedQuoteKey: context.quoteKey,
        renderSpecKey: context.renderSpecKey,
      },
      effects: {
        providerCalled: false,
        secretResolved: false,
        verificationPerformed: false,
        quoteRequested: false,
        approvalRecorded: !receipt.replayed,
        reservationCreated: false,
        renderCreated: false,
        outboxCreated: false,
        spendCommitted: false,
        publishingCreated: false,
      },
      canGenerate: false,
      spendAuthorized: false,
    });
  }
}
