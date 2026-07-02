import type { PendingAction } from "@shared/schema";
import { storage } from "./storage";
import { createCalendarEvent, updateCalendarEvent, updateCalendarEventDescription } from "./google-calendar";
import { writeAuditLog } from "./trust-policy";
import { addBlackRoomCountdown, addBlackRoomLink, deactivateBlackRoomLink, updateBlackRoomLink } from "./blackroom-links";
import { createGoogleDriveFolderPath } from "./google-drive-folder-command";
import { executeMetricoolAutomationAction } from "./metricool-chat-actions";
import { processDriveRadioVideoFile, processYoutubeRadioVideoLink, resumeRadioVideoEditWithDjName } from "./radio-video-edit-agent";
import {
  findRevenueMoneySprintArtifactsByBusinessNames,
  reviewRevenuePublicLeadCandidates,
  runRevenueMoneySprint,
  setRevenueUserDataScope,
} from "./revenue-engine";
import { buildRevenueFirstMoneyCommandCenterSummary } from "./revenue-first-money-command-center-cli";
import { buildRevenuePublicCandidateApprovalDecisionFromCli } from "./revenue-public-candidate-approval-decision-cli";
import { buildRevenueContactPathApprovalDecisionFromCli } from "./revenue-contact-path-approval-decision-cli";
import { buildRevenuePaymentPathApprovalDecisionFromCli } from "./revenue-payment-path-approval-decision-cli";
import { buildRevenueLedgerApprovalDecisionFromCli } from "./revenue-ledger-approval-decision-cli";
import { buildRevenueWebsiteCreationApprovalDecisionFromCli } from "./revenue-website-creation-approval-decision-cli";
import { buildRevenueWebsitePublishApprovalDecisionFromCli } from "./revenue-website-publish-approval-decision-cli";
import { matchesRevenueFirstMoneyApprovedCandidateBatch, revenueCandidateIdsMatch } from "./revenue-first-money-route-guards";
import {
  revenueContactPathApprovalPendingActionSchema,
  revenueLedgerEntryApprovalPendingActionSchema,
  revenuePaymentPathApprovalPendingActionSchema,
  revenueWebsiteCreationApprovalPendingActionSchema,
  revenueWebsitePublishApprovalPendingActionSchema,
} from "./revenue-first-money-approval-pending-action";

type JsonRecord = Record<string, any>;

function actionInput(action: PendingAction): JsonRecord {
  return ((action.editedInput || action.input || {}) as JsonRecord) || {};
}

function stringInput(input: JsonRecord, key: string) {
  return typeof input[key] === "string" ? input[key].trim() : "";
}

function candidateIdsInput(input: JsonRecord) {
  return Array.isArray(input.candidateIds)
    ? input.candidateIds.filter((candidateId): candidateId is string => typeof candidateId === "string" && candidateId.trim().length > 0)
    : [];
}

function booleanInput(input: JsonRecord, key: string) {
  return input[key] === true;
}

function numberInput(input: JsonRecord, key: string) {
  const value = Number(input[key]);
  return Number.isFinite(value) ? value : 0;
}

function pendingActionPayloadInput(input: JsonRecord) {
  const { requestedReview: _requestedReview, ...payload } = input;
  return payload;
}

export function executeRevenueFirstMoneyContactPathApprovalFromPendingInput(input: JsonRecord, userId: string) {
  setRevenueUserDataScope(userId);
  if (stringInput(input, "requestedReview") !== "approve_first_money_contact_path") {
    throw new Error("Revenue contact path pending action no longer matches the first-money approval queue.");
  }
  const payload = revenueContactPathApprovalPendingActionSchema.parse(pendingActionPayloadInput(input));

  const result = buildRevenueContactPathApprovalDecisionFromCli({
    contactMode: payload.contactMode,
    fromEmail: payload.fromEmail,
    manualContactApproved: payload.manualContactApproved,
    emailProviderConfigured: payload.emailProviderConfigured,
    decision: "approved",
    approvedAction: payload.approvedAction,
    robertApprovedContactPath: payload.robertApprovedContactPath,
    contactPathVerified: payload.contactPathVerified,
    evidenceUrl: payload.evidenceUrl,
    evidenceNote: payload.evidenceNote,
    confirmedByRobert: true,
    sendOutreach: false,
    json: false,
  });

  if (result.status !== "recorded") {
    throw new Error(`Revenue contact path approval blocked: ${result.blockers.join("; ") || "unknown blocker"}`);
  }

  return {
    ...result,
    commandCenter: buildRevenueFirstMoneyCommandCenterSummary({ mode: "first-sprint", json: false }),
    safety: {
      ...result.safety,
      createsPendingAction: false,
      sendsOutreach: false,
      chargesClients: false,
      editsEnvironment: false,
      storesSecrets: false,
      deploys: false,
    },
  };
}

export function executeRevenueFirstMoneyPaymentPathApprovalFromPendingInput(input: JsonRecord, userId: string) {
  setRevenueUserDataScope(userId);
  if (stringInput(input, "requestedReview") !== "approve_first_money_payment_path") {
    throw new Error("Revenue payment path pending action no longer matches the first-money approval queue.");
  }
  const payload = revenuePaymentPathApprovalPendingActionSchema.parse(pendingActionPayloadInput(input));

  const result = buildRevenuePaymentPathApprovalDecisionFromCli({
    paymentLink: payload.paymentLink,
    decision: "approved",
    approvedAction: payload.approvedAction,
    robertApprovedPaymentPath: payload.robertApprovedPaymentPath,
    paymentSmokeVerified: payload.paymentSmokeVerified,
    depositConfirmedByRobert: payload.depositConfirmedByRobert,
    expectedDepositUsd: payload.expectedDepositUsd,
    expectedPackage: payload.expectedPackage,
    evidenceUrl: payload.evidenceUrl,
    evidenceNote: payload.evidenceNote,
    confirmedByRobert: true,
    chargeClient: false,
    json: false,
  });

  if (result.status !== "recorded") {
    throw new Error(`Revenue payment path approval blocked: ${result.blockers.join("; ") || "unknown blocker"}`);
  }

  return {
    ...result,
    commandCenter: buildRevenueFirstMoneyCommandCenterSummary({ mode: "first-sprint", json: false }),
    safety: {
      ...result.safety,
      createsPendingAction: false,
      sendsOutreach: false,
      chargesClients: false,
      editsEnvironment: false,
      storesSecrets: false,
      recordsLedgerEntry: false,
      deploys: false,
    },
  };
}

export function executeRevenueFirstMoneyLedgerEntryApprovalFromPendingInput(input: JsonRecord, userId: string) {
  setRevenueUserDataScope(userId);
  if (stringInput(input, "requestedReview") !== "approve_first_money_ledger_entry") {
    throw new Error("Revenue ledger entry pending action no longer matches the first-money approval queue.");
  }
  const payload = revenueLedgerEntryApprovalPendingActionSchema.parse(pendingActionPayloadInput(input));

  const result = buildRevenueLedgerApprovalDecisionFromCli({
    kind: payload.kind,
    clientName: payload.clientName,
    amountUsd: payload.amountUsd,
    cashCollectedUsd: payload.cashCollectedUsd,
    estimatedInternalCostUsd: payload.estimatedInternalCostUsd,
    notes: payload.notes,
    paymentEvidence: payload.paymentEvidence,
    decision: "approved",
    approvedAction: payload.approvedAction,
    confirmedByRobert: true,
    json: false,
  });

  if (result.status !== "recorded") {
    throw new Error(`Revenue ledger entry approval blocked: ${result.blockers.join("; ") || "unknown blocker"}`);
  }

  return {
    ...result,
    commandCenter: buildRevenueFirstMoneyCommandCenterSummary({ mode: "first-sprint", json: false }),
    safety: {
      ...result.safety,
      createsPendingAction: false,
      recordsLedgerEntry: false,
      chargesClients: false,
      sendsOutreach: false,
      editsEnvironment: false,
      storesSecrets: false,
      deploys: false,
    },
  };
}

export function executeRevenueFirstMoneyWebsiteCreationApprovalFromPendingInput(input: JsonRecord, userId: string) {
  setRevenueUserDataScope(userId);
  if (stringInput(input, "requestedReview") !== "approve_first_money_website_creation") {
    throw new Error("Revenue website creation pending action no longer matches the first-money approval queue.");
  }
  const payload = revenueWebsiteCreationApprovalPendingActionSchema.parse(pendingActionPayloadInput(input));

  const result = buildRevenueWebsiteCreationApprovalDecisionFromCli({
    outreachDraftId: payload.outreachDraftId,
    decision: "approved",
    approvedAction: payload.approvedAction,
    notes: payload.notes,
    robertApprovedBuild: payload.robertApprovedBuild,
    clientApprovedScope: payload.clientApprovedScope,
    depositPaid: payload.depositPaid,
    publicDataVerified: payload.publicDataVerified,
    launchTargetDays: payload.launchTargetDays,
    confirmedByRobert: true,
    json: false,
  });

  if (result.status !== "recorded") {
    throw new Error(`Revenue website creation approval blocked: ${result.blockers.join("; ") || "unknown blocker"}`);
  }

  return {
    ...result,
    commandCenter: buildRevenueFirstMoneyCommandCenterSummary({ mode: "first-sprint", json: false }),
    safety: {
      ...result.safety,
      createsPendingAction: false,
      writesFiles: false,
      deploys: false,
      publishesPreview: false,
      chargesClients: false,
      sendsOutreach: false,
      editsEnvironment: false,
      storesSecrets: false,
    },
  };
}

export function executeRevenueFirstMoneyWebsitePublishApprovalFromPendingInput(input: JsonRecord, userId: string) {
  setRevenueUserDataScope(userId);
  if (stringInput(input, "requestedReview") !== "approve_first_money_website_publish") {
    throw new Error("Revenue website publish pending action no longer matches the first-money approval queue.");
  }
  const payload = revenueWebsitePublishApprovalPendingActionSchema.parse(pendingActionPayloadInput(input));

  const result = buildRevenueWebsitePublishApprovalDecisionFromCli({
    outreachDraftId: payload.outreachDraftId,
    websiteCreationApprovalDecisionId: payload.websiteCreationApprovalDecisionId,
    decision: "approved",
    approvedAction: payload.approvedAction,
    notes: payload.notes,
    robertApprovedPublish: payload.robertApprovedPublish,
    previewDeployVerified: payload.previewDeployVerified,
    appQaTargetPassed: payload.appQaTargetPassed,
    rollbackVerified: payload.rollbackVerified,
    deployProvider: payload.deployProvider,
    previewDeployUrl: payload.previewDeployUrl,
    appQaEvidenceUrl: payload.appQaEvidenceUrl,
    rollbackPlanUrl: payload.rollbackPlanUrl,
    launchTargetDays: payload.launchTargetDays,
    confirmedByRobert: true,
    json: false,
  });

  if (result.status !== "recorded") {
    throw new Error(`Revenue website publish approval blocked: ${result.blockers.join("; ") || "unknown blocker"}`);
  }

  return {
    ...result,
    commandCenter: buildRevenueFirstMoneyCommandCenterSummary({ mode: "first-sprint", json: false }),
    safety: {
      ...result.safety,
      createsPendingAction: false,
      writesFiles: false,
      deploys: false,
      publishesWebsite: false,
      chargesClients: false,
      sendsOutreach: false,
      editsEnvironment: false,
      storesSecrets: false,
    },
  };
}

export function executeRevenueFirstMoneyCandidateApprovalFromPendingInput(input: JsonRecord, userId: string) {
  setRevenueUserDataScope(userId);
  const candidateIds = candidateIdsInput(input);
  const batchId = stringInput(input, "batchId");
  const area = stringInput(input, "area");
  const niche = stringInput(input, "niche");
  const offerFocus = stringInput(input, "offerFocus");
  const approvedAction = stringInput(input, "approvedAction");
  const confirmationText = stringInput(input, "confirmationText");
  const requestedReview = stringInput(input, "requestedReview");
  const commandCenter = buildRevenueFirstMoneyCommandCenterSummary({ mode: "first-sprint", json: false });
  const expectedApproval = commandCenter.candidateApprovalQueue.find((batch) => batch.id === batchId);
  const matchesActiveBatch = Boolean(
    expectedApproval
    && requestedReview === "approve_or_reject_first_money_candidate_batch"
    && area === expectedApproval.area
    && niche === expectedApproval.niche
    && offerFocus === expectedApproval.offerFocus
    && approvedAction === expectedApproval.approvedAction
    && confirmationText === expectedApproval.confirmationText
    && revenueCandidateIdsMatch(candidateIds, expectedApproval.candidateIds),
  );

  if (!matchesActiveBatch || !expectedApproval) {
    throw new Error("Revenue candidate approval pending action no longer matches the active first-money command-center queue.");
  }

  const result = buildRevenuePublicCandidateApprovalDecisionFromCli({
    candidateIds,
    decision: "approved",
    approvedAction,
    notes: "Approved through Trust Center pending action.",
    area,
    niche,
    offerFocus: expectedApproval.offerFocus,
    confirmedByRobert: true,
    json: false,
  });

  if (result.status !== "recorded") {
    throw new Error(`Revenue candidate approval decision blocked: ${result.blockers.join("; ") || "unknown blocker"}`);
  }

  return {
    ...result,
    commandCenter: buildRevenueFirstMoneyCommandCenterSummary({ mode: "first-sprint", json: false }),
    safety: {
      ...result.safety,
      createsPendingAction: false,
      importsLeads: false,
      sendsOutreach: false,
      chargesClients: false,
      deploys: false,
      exposesContactDetails: false,
    },
  };
}

export function executeRevenueFirstMoneyCandidateReviewFromPendingInput(input: JsonRecord, userId: string) {
  setRevenueUserDataScope(userId);
  const candidateIds = candidateIdsInput(input);
  const approvalDecisionId = stringInput(input, "approvalDecisionId");
  const reviewInput = {
    batchId: stringInput(input, "batchId"),
    candidateIds,
    approvalDecisionId,
    area: stringInput(input, "area"),
    niche: stringInput(input, "niche"),
    offerFocus: stringInput(input, "offerFocus"),
    confirmationText: stringInput(input, "confirmationText"),
  };
  const requestedReview = stringInput(input, "requestedReview");
  const commandCenter = buildRevenueFirstMoneyCommandCenterSummary({ mode: "first-sprint", json: false });
  const expectedReview = commandCenter.candidateReviewQueue.find((batch) => batch.id === reviewInput.batchId);

  if (
    !expectedReview
    || requestedReview !== "generate_first_money_candidate_review_packet"
    || !matchesRevenueFirstMoneyApprovedCandidateBatch(reviewInput, expectedReview)
  ) {
    throw new Error("Revenue candidate review pending action no longer matches the active first-money command-center queue.");
  }

  const result = reviewRevenuePublicLeadCandidates({
    area: reviewInput.area,
    niche: reviewInput.niche,
    offerFocus: expectedReview.offerFocus,
    dailyResearchTarget: 20,
    dailyQualifiedLeadLimit: 5,
    dailyMockupLimit: 2,
    dailyContactLimit: 0,
    maxPaidDataSpendUsd: 0,
    requireRobertApprovalToContact: true,
    writePreviewFiles: false,
    candidateIds,
    approvedByRobert: true,
    approvalDecisionId,
    reviewerNote: "Robert approved this first-money candidate review packet through Trust Center.",
  });

  if (result.status !== "ready_for_money_sprint_preview") {
    throw new Error(`Revenue candidate review packet blocked: ${result.reviewedCandidates.flatMap((candidate) => candidate.blockedReasons).join("; ") || "unknown blocker"}`);
  }

  return {
    status: result.status,
    approvalDecisionId: result.approvalDecisionId,
    requestedCount: result.requestedCount,
    foundCount: result.foundCount,
    approvedCount: result.approvedCount,
    missingIds: result.missingIds,
    duplicateIds: result.duplicateIds,
    reviewedCandidates: result.reviewedCandidates,
    preview: {
      totals: result.preview.totals,
      safety: result.preview.safety,
    },
    moneySprintRunPacket: {
      status: result.moneySprintRunPacket.status,
      endpoint: result.moneySprintRunPacket.endpoint,
      method: result.moneySprintRunPacket.method,
      expectedOutput: result.moneySprintRunPacket.expectedOutput,
      operatorChecklist: result.moneySprintRunPacket.operatorChecklist,
      blockedUntil: result.moneySprintRunPacket.blockedUntil,
      safety: result.moneySprintRunPacket.safety,
    },
    nextApiAction: result.nextApiAction,
    nextAction: result.nextAction,
    safety: {
      ...result.safety,
      persistsLeads: false,
      persistsPublicCandidates: false,
      writesPreviewFiles: false,
      sendsOutreach: false,
      chargesClients: false,
      deploys: false,
      exposesContactDetails: false,
    },
    commandCenter: buildRevenueFirstMoneyCommandCenterSummary({ mode: "first-sprint", json: false }),
  };
}

export function executeRevenueFirstMoneyMoneySprintRunFromPendingInput(input: JsonRecord, userId: string) {
  setRevenueUserDataScope(userId);
  const candidateIds = candidateIdsInput(input);
  const approvalDecisionId = stringInput(input, "approvalDecisionId");
  const runInput = {
    batchId: stringInput(input, "batchId"),
    candidateIds,
    approvalDecisionId,
    area: stringInput(input, "area"),
    niche: stringInput(input, "niche"),
    offerFocus: stringInput(input, "offerFocus"),
    confirmationText: stringInput(input, "confirmationText"),
  };
  const requestedReview = stringInput(input, "requestedReview");
  const commandCenter = buildRevenueFirstMoneyCommandCenterSummary({ mode: "first-sprint", json: false });
  const expectedRun = commandCenter.candidateRunQueue.find((batch) => batch.id === runInput.batchId);

  if (
    !expectedRun
    || requestedReview !== "run_first_money_internal_money_sprint"
    || !matchesRevenueFirstMoneyApprovedCandidateBatch(runInput, expectedRun)
  ) {
    throw new Error("Revenue Money Sprint pending action no longer matches the active first-money command-center queue.");
  }

  const review = reviewRevenuePublicLeadCandidates({
    area: runInput.area,
    niche: runInput.niche,
    offerFocus: expectedRun.offerFocus,
    dailyResearchTarget: 20,
    dailyQualifiedLeadLimit: 5,
    dailyMockupLimit: 2,
    dailyContactLimit: 0,
    maxPaidDataSpendUsd: 0,
    requireRobertApprovalToContact: true,
    writePreviewFiles: false,
    candidateIds,
    approvedByRobert: true,
    approvalDecisionId,
    reviewerNote: "Robert approved this first-money internal Money Sprint run through Trust Center.",
  });

  if (review.status !== "ready_for_money_sprint_preview" || review.moneySprintRunPacket.status !== "ready_for_money_sprint_run") {
    throw new Error("Revenue Money Sprint pending action is not ready for guarded internal execution.");
  }

  const existingArtifacts = findRevenueMoneySprintArtifactsByBusinessNames(expectedRun.candidateNames);
  if (existingArtifacts.businessNames.length > 0) {
    throw new Error(`Money Sprint already has internal artifacts for: ${existingArtifacts.businessNames.join(", ")}`);
  }

  const result = runRevenueMoneySprint({
    ...review.moneySprintRunPacket.requestBody,
    dailyContactLimit: 0,
    maxPaidDataSpendUsd: 0,
    requireRobertApprovalToContact: true,
    writePreviewFiles: false,
  });

  return {
    status: result.status,
    executed: true,
    recordedLeads: result.recordedLeads.map((item) => ({
      id: item.lead.id,
      businessName: item.lead.businessName,
      status: item.lead.status,
      grade: item.qualification.grade,
      score: item.qualification.score,
      deduped: item.deduped,
    })),
    previews: result.previews.map((preview) => ({
      slug: preview.slug,
      businessName: preview.mockup.input.businessName,
      fileWritten: preview.fileWritten,
      decisionStatus: preview.status,
    })),
    outreachDrafts: result.outreachDrafts.map((draft) => ({
      id: draft.id,
      businessName: draft.businessName,
      status: draft.status,
      sendStatus: draft.delivery.sendStatus,
      channel: draft.channel,
    })),
    blockedSeeds: result.blockedSeeds,
    operatingLimits: result.operatingLimits,
    approvalGates: result.approvalGates,
    nextActions: result.nextActions,
    safety: {
      persistsLeads: true,
      writesPreviewFiles: false,
      sendsOutreach: false,
      chargesClients: false,
      deploys: false,
      paidDataSpendUsd: 0,
      requiresRobertApproval: true,
    },
    commandCenter: buildRevenueFirstMoneyCommandCenterSummary({ mode: "first-sprint", json: false }),
  };
}

export async function executeApprovedPendingAction(
  action: PendingAction,
  actorId: string
): Promise<{ success: boolean; result?: unknown; error?: string }> {
  if (action.status !== "approved") {
    return { success: false, error: "Action must be approved before execution" };
  }

  await storage.updatePendingAction(action.id, { status: "executing" });
  await storage.createPendingActionEvent({
    pendingActionId: action.id,
    userId: action.userId,
    actorType: "user",
    actorId,
    eventType: "executing",
    previousStatus: action.status,
    nextStatus: "executing",
    note: null,
    metadata: null,
  });

  try {
    const input = actionInput(action);
    let result: unknown;

    switch (action.actionType) {
      case "calendar.create_event": {
        const eventId = await createCalendarEvent({
          title: input.title,
          date: input.date,
          endDate: input.endDate,
          description: input.description,
        });
        result = { eventId, title: input.title };
        break;
      }

      case "calendar.modify_radio": {
        await updateCalendarEventDescription(input.eventId, input.description);
        const tasks = await storage.getTasks(action.userId);
        const taskToUpdate = tasks.find((task) => task.externalId === input.eventId);
        if (taskToUpdate) {
          await storage.updateTask(taskToUpdate.id, { description: input.description });
        }
        result = { eventId: input.eventId, updatedLocalTask: !!taskToUpdate };
        break;
      }

      case "calendar.update_event": {
        await updateCalendarEvent({
          eventId: input.eventId,
          title: input.title,
          date: input.date,
          endDate: input.endDate,
          description: input.description,
          location: input.location,
          isAllDay: input.isAllDay,
        });
        const tasks = await storage.getTasks(action.userId);
        const taskToUpdate = tasks.find((task) => task.externalId === input.eventId);
        if (taskToUpdate) {
          await storage.updateTask(taskToUpdate.id, {
            ...(input.title !== undefined ? { title: input.title } : {}),
            ...(input.description !== undefined ? { description: input.description } : {}),
            ...(input.date !== undefined ? { date: new Date(input.date) } : {}),
            ...(input.endDate !== undefined ? { endDate: new Date(input.endDate) } : {}),
          });
        }
        result = { eventId: input.eventId, updatedLocalTask: !!taskToUpdate };
        break;
      }

      case "finance.create_investment": {
        const investment = await storage.createInvestment(action.userId, {
          symbol: String(input.symbol).toUpperCase(),
          name: input.name,
          type: input.type,
          quantity: String(input.quantity),
          avgBuyPrice: String(input.avgBuyPrice),
          currency: input.currency || "USD",
          notes: input.notes,
        });
        result = investment;
        break;
      }

      case "finance.update_investment": {
        const investments = await storage.getInvestments(action.userId);
        const existing = investments.find((investment) => investment.symbol.toUpperCase() === String(input.symbol).toUpperCase());
        if (!existing) throw new Error(`No investment found for ${input.symbol}`);

        const updates: { quantity?: string; avgBuyPrice?: string; notes?: string } = {};
        if (input.quantity !== undefined) updates.quantity = String(input.quantity);
        if (input.avgBuyPrice !== undefined) updates.avgBuyPrice = String(input.avgBuyPrice);
        if (input.notes !== undefined) updates.notes = input.notes;

        const investment = await storage.updateInvestment(existing.id, updates);
        result = investment;
        break;
      }

      case "finance.delete_investment": {
        const investments = await storage.getInvestments(action.userId);
        const existing = investments.find((investment) => investment.symbol.toUpperCase() === String(input.symbol).toUpperCase());
        if (!existing) throw new Error(`No investment found for ${input.symbol}`);

        await storage.deleteInvestment(existing.id);
        result = { deleted: true, symbol: String(input.symbol).toUpperCase(), investmentId: existing.id };
        break;
      }

      case "communications.send": {
        result = {
          draftOnly: true,
          sent: false,
          recipient: input.recipient,
          channel: input.channel,
          subject: input.subject || null,
          message: input.message,
          note: "Communication integrations are not connected yet. Draft approved for manual send.",
        };
        break;
      }

      case "marketing.blackroom_link_add": {
        result = await addBlackRoomLink(input as any);
        break;
      }

      case "marketing.blackroom_link_update": {
        result = await updateBlackRoomLink(input as any);
        break;
      }

      case "marketing.blackroom_link_deactivate": {
        result = await deactivateBlackRoomLink(input as any);
        break;
      }

      case "marketing.blackroom_timer_add": {
        result = await addBlackRoomCountdown(input as any);
        break;
      }

      case "marketing.metricool_automation": {
        result = await executeMetricoolAutomationAction(input, action.userId);
        break;
      }

      case "revenue.first_money_candidate_approval": {
        result = executeRevenueFirstMoneyCandidateApprovalFromPendingInput(input, action.userId);
        break;
      }

      case "revenue.first_money_candidate_review": {
        result = executeRevenueFirstMoneyCandidateReviewFromPendingInput(input, action.userId);
        break;
      }

      case "revenue.first_money_sprint_run": {
        result = executeRevenueFirstMoneyMoneySprintRunFromPendingInput(input, action.userId);
        break;
      }

      case "revenue.first_money_contact_path_approval": {
        result = executeRevenueFirstMoneyContactPathApprovalFromPendingInput(input, action.userId);
        break;
      }

      case "revenue.first_money_payment_path_approval": {
        result = executeRevenueFirstMoneyPaymentPathApprovalFromPendingInput(input, action.userId);
        break;
      }

      case "revenue.first_money_ledger_entry_approval": {
        result = executeRevenueFirstMoneyLedgerEntryApprovalFromPendingInput(input, action.userId);
        break;
      }

      case "revenue.first_money_website_creation_approval": {
        result = executeRevenueFirstMoneyWebsiteCreationApprovalFromPendingInput(input, action.userId);
        break;
      }

      case "revenue.first_money_website_publish_approval": {
        result = executeRevenueFirstMoneyWebsitePublishApprovalFromPendingInput(input, action.userId);
        break;
      }

      case "radio_edit.resolve_dj_name": {
        result = await resumeRadioVideoEditWithDjName({ ...input, userId: action.userId } as any);
        break;
      }

      case "radio_edit.youtube_to_drive": {
        const radioYoutubeResult = await processYoutubeRadioVideoLink({
          userId: action.userId,
          youtubeUrl: input.youtubeUrl,
          driveFolderPath: input.driveFolderPath,
          driveParentFolderId: input.driveParentFolderId,
          createFolderIfMissing: Boolean(input.createFolderIfMissing),
          driveFolderPathFromYoutubeTitle: Boolean(input.driveFolderPathFromYoutubeTitle),
          force: Boolean(input.force),
          djName: input.djName,
          musicUrl: input.musicUrl,
          musicPath: input.musicPath,
          instagramClipCount: Number.isFinite(Number(input.instagramClipCount)) ? Number(input.instagramClipCount) : undefined,
          tiktokClipCount: Number.isFinite(Number(input.tiktokClipCount)) ? Number(input.tiktokClipCount) : undefined,
          deleteSourceAfterSuccess: input.deleteSourceAfterSuccess !== false,
        });
        if (radioYoutubeResult.status === "failed") {
          throw new Error(radioYoutubeResult.error || "No pude procesar el link de YouTube para radio");
        }
        result = radioYoutubeResult;
        break;
      }

      case "radio_edit.drive_video_to_drive": {
        const radioDriveVideoResult = await processDriveRadioVideoFile({
          userId: action.userId,
          sourceDriveFileId: input.sourceDriveFileId,
          sourceDriveUrl: input.sourceDriveUrl,
          driveFolderPath: input.driveFolderPath,
          driveParentFolderId: input.driveParentFolderId,
          createFolderIfMissing: Boolean(input.createFolderIfMissing),
          force: Boolean(input.force),
          djName: input.djName,
          musicUrl: input.musicUrl,
          musicPath: input.musicPath,
          instagramClipCount: Number.isFinite(Number(input.instagramClipCount)) ? Number(input.instagramClipCount) : undefined,
          tiktokClipCount: Number.isFinite(Number(input.tiktokClipCount)) ? Number(input.tiktokClipCount) : undefined,
          deleteSourceAfterSuccess: input.deleteSourceAfterSuccess !== false,
        });
        if (radioDriveVideoResult.status === "failed") {
          throw new Error(radioDriveVideoResult.error || "No pude procesar el MP4 de Google Drive para radio");
        }
        result = radioDriveVideoResult;
        break;
      }

      case "google_drive.create_folder": {
        result = await createGoogleDriveFolderPath({
          userId: action.userId,
          driveFolderPath: input.driveFolderPath,
          origin: "web",
        });
        break;
      }

      default:
        throw new Error(`No executor registered for ${action.actionType}`);
    }

    await storage.updatePendingAction(action.id, {
      status: "executed",
      executionResult: result as any,
      executedAt: new Date(),
    });
    await storage.createPendingActionEvent({
      pendingActionId: action.id,
      userId: action.userId,
      actorType: "user",
      actorId,
      eventType: "executed",
      previousStatus: "executing",
      nextStatus: "executed",
      note: null,
      metadata: { result },
    });

    await writeAuditLog({
      userId: action.userId,
      actorType: "user",
      actorId,
      origin: "web",
      actionType: action.actionType,
      resourceType: action.resourceType,
      resourceId: action.resourceId || undefined,
      pendingActionId: action.id,
      metadata: { result },
      status: "succeeded",
      executionMode: "user_requested",
    });

    return { success: true, result };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    await storage.updatePendingAction(action.id, {
      status: "failed",
      executionResult: { error: errorMessage },
    });
    await storage.createPendingActionEvent({
      pendingActionId: action.id,
      userId: action.userId,
      actorType: "user",
      actorId,
      eventType: "failed",
      previousStatus: "executing",
      nextStatus: "failed",
      note: errorMessage,
      metadata: { error: errorMessage },
    });
    await writeAuditLog({
      userId: action.userId,
      actorType: "user",
      actorId,
      origin: "web",
      actionType: action.actionType,
      resourceType: action.resourceType,
      resourceId: action.resourceId || undefined,
      pendingActionId: action.id,
      metadata: { error: errorMessage },
      status: "failed",
      executionMode: "user_requested",
      errorMessage,
    });
    return { success: false, error: errorMessage };
  }
}
