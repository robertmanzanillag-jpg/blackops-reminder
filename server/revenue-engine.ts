import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { z } from "zod";
import { hasRealValue, hasStrongSecret } from "./ceo-doctor-cli";
import {
  buildRevenueOutreachApprovalTargetId,
  buildRevenueOutreachSnapshotHash,
} from "./revenue-outreach-approval";
import {
  buildRevenueWebsiteCreationApprovalTargetId,
  buildRevenueWebsiteCreationSnapshotHash,
} from "./revenue-website-creation-approval";
import {
  buildRevenueWebsitePublishApprovalTargetId,
  buildRevenueWebsitePublishSnapshotHash,
} from "./revenue-website-publish-approval";
import {
  buildRevenueLedgerApprovalSnapshotHash,
  buildRevenueLedgerApprovalTargetId,
} from "./revenue-ledger-approval";
import {
  buildRevenuePaymentPathApprovalTargetId,
  buildRevenuePaymentPathSnapshotHash,
} from "./revenue-payment-path-approval";
import {
  buildRevenueContactPathApprovalTargetId,
  buildRevenueContactPathSnapshotHash,
} from "./revenue-contact-path-approval";

const REVENUE_MONTHLY_COST_CAP_USD = 100;

const revenueExplicitBooleanSchema = z.preprocess((value) => {
  if (typeof value === "string") return value.trim().toLowerCase() === "true";
  return value;
}, z.boolean());

export const revenueEnginePlanSchema = z.object({
  area: z.string().trim().min(2).max(120),
  niche: z.string().trim().min(2).max(120),
  offerFocus: z.enum(["websites", "automations", "both"]).default("both"),
  monthlyBudgetUsd: z.coerce.number().min(0).max(100).default(100),
  leadCount: z.coerce.number().int().min(5).max(50).default(20),
});

export type RevenueEnginePlanInput = z.infer<typeof revenueEnginePlanSchema>;

export const revenueScoutingMissionSchema = z.object({
  area: z.string().trim().min(2).max(120),
  niche: z.string().trim().min(2).max(120),
  offerFocus: z.enum(["websites", "automations", "both"]).default("both"),
  targetLeadCount: z.coerce.number().int().min(5).max(100).default(25),
  maxPaidDataSpendUsd: z.coerce.number().min(0).max(5000).default(0),
  requireNoWebsiteSignal: z.coerce.boolean().default(true),
  includeWeakWebsiteLeads: z.coerce.boolean().default(true),
});

export type RevenueScoutingMissionInput = z.infer<typeof revenueScoutingMissionSchema>;

export const revenueLeadRadarSchema = z.object({
  area: z.string().trim().min(2).max(120),
  niches: z.string().trim().min(2).max(500).default("med spas, gyms, restaurants"),
  offerFocus: z.enum(["websites", "automations", "both"]).default("both"),
  runHoursPerDay: z.coerce.number().int().min(1).max(24).default(24),
  dailyResearchTarget: z.coerce.number().int().min(10).max(500).default(120),
  dailyQualifiedLeadLimit: z.coerce.number().int().min(5).max(100).default(35),
  dailyMockupLimit: z.coerce.number().int().min(1).max(25).default(8),
  dailyContactLimit: z.coerce.number().int().min(0).max(50).default(10),
  maxPaidDataSpendUsd: z.coerce.number().min(0).max(5000).default(0),
  requireRobertApprovalToContact: z.coerce.boolean().default(true),
});

export type RevenueLeadRadarInput = z.infer<typeof revenueLeadRadarSchema>;

export const automationQuoteSchema = z.object({
  businessName: z.string().trim().min(2).max(160),
  industry: z.string().trim().min(2).max(120),
  request: z.string().trim().min(8).max(1200),
  currentTools: z.string().trim().max(300).optional().default(""),
  monthlyBudgetUsd: z.coerce.number().min(0).max(5000).default(500),
  urgency: z.enum(["this_week", "this_month", "flexible"]).default("this_month"),
});

export type AutomationQuoteInput = z.infer<typeof automationQuoteSchema>;

export const revenueAutomationOpportunitySchema = automationQuoteSchema.extend({
  sourceLeadId: z.string().trim().max(120).optional().default(""),
  status: z.enum(["intake", "quoted", "approved", "sold", "in_delivery", "delivered", "blocked"]).default("intake"),
  clientApprovedScope: z.coerce.boolean().default(false),
  depositPaid: z.coerce.boolean().default(false),
});

export type RevenueAutomationOpportunityInput = z.infer<typeof revenueAutomationOpportunitySchema>;

export const deliveryReviewSchema = z.object({
  projectName: z.string().trim().min(2).max(160),
  projectType: z.enum(["website", "automation", "bundle"]).default("bundle"),
  setupPriceUsd: z.coerce.number().min(0).max(100000).default(2500),
  monthlyRetainerUsd: z.coerce.number().min(0).max(25000).default(300),
  estimatedInternalMonthlyCostUsd: z.coerce.number().min(0).max(5000).default(50),
  clientApprovedScope: z.coerce.boolean().default(false),
  depositPaid: z.coerce.boolean().default(false),
  publicDataVerified: z.coerce.boolean().default(false),
  responsiveChecked: z.coerce.boolean().default(false),
  linksChecked: z.coerce.boolean().default(false),
  automationTested: z.coerce.boolean().default(false),
  rollbackPlanReady: z.coerce.boolean().default(false),
  notes: z.string().trim().max(1200).optional().default(""),
});

export type DeliveryReviewInput = z.infer<typeof deliveryReviewSchema>;

export const proposalEmailSchema = z.object({
  recipientEmail: z.string().trim().email().max(240),
  contactName: z.string().trim().min(1).max(120).default("Robert"),
  businessName: z.string().trim().min(2).max(160),
  sourceUrl: z.string().trim().url().max(300).optional(),
  businessSummary: z.string().trim().min(10).max(2000),
  websitePriceUsd: z.coerce.number().min(0).max(100000).default(3500),
  automationPriceUsd: z.coerce.number().min(0).max(100000).default(2500),
  monthlyRetainerUsd: z.coerce.number().min(0).max(25000).default(750),
  estimatedInternalMonthlyCostUsd: z.coerce.number().min(0).max(5000).default(54),
  notes: z.string().trim().max(1000).optional().default(""),
});

export type ProposalEmailInput = z.infer<typeof proposalEmailSchema>;

export const revenueOutreachDraftSchema = proposalEmailSchema.extend({
  leadId: z.string().trim().max(120).optional().default(""),
  channel: z.enum(["email", "gmail", "mailto", "instagram", "contact_form"]).default("gmail"),
  approvalStatus: z.enum(["draft", "approved"]).default("draft"),
  mockupUrl: z.string().trim().url().max(300).optional(),
});

export type RevenueOutreachDraftInput = z.infer<typeof revenueOutreachDraftSchema>;

export const improvementReviewSchema = z.object({
  campaignName: z.string().trim().min(2).max(160),
  periodLabel: z.string().trim().min(2).max(80).default("esta semana"),
  leadsContacted: z.coerce.number().int().min(0).max(10000).default(0),
  replies: z.coerce.number().int().min(0).max(10000).default(0),
  callsBooked: z.coerce.number().int().min(0).max(10000).default(0),
  dealsClosed: z.coerce.number().int().min(0).max(10000).default(0),
  revenueCollectedUsd: z.coerce.number().min(0).max(1000000).default(0),
  spendUsd: z.coerce.number().min(0).max(50000).default(0),
  estimatedInternalMonthlyCostUsd: z.coerce.number().min(0).max(5000).default(50),
  hoursSaved: z.coerce.number().min(0).max(10000).default(0),
  defectsFound: z.coerce.number().int().min(0).max(10000).default(0),
  clientComplaints: z.coerce.number().int().min(0).max(10000).default(0),
  bestOffer: z.string().trim().max(200).optional().default(""),
  biggestObjection: z.string().trim().max(500).optional().default(""),
  notes: z.string().trim().max(1200).optional().default(""),
});

export type ImprovementReviewInput = z.infer<typeof improvementReviewSchema>;

export const revenueLedgerEntrySchema = z.object({
  kind: z.enum(["website_sale", "automation_sale", "bundle_sale", "retainer", "expense"]),
  clientName: z.string().trim().min(2).max(160),
  amountUsd: z.coerce.number().min(0).max(1000000),
  cashCollectedUsd: z.coerce.number().min(0).max(1000000).default(0),
  estimatedInternalCostUsd: z.coerce.number().min(0).max(100000).default(0),
  notes: z.string().trim().max(1000).optional().default(""),
  approvalDecisionId: z.string().trim().max(200).optional().default(""),
});

export type RevenueLedgerEntryInput = z.infer<typeof revenueLedgerEntrySchema>;

export const revenueExpensePreflightSchema = z.object({
  concept: z.string().trim().min(2).max(160),
  amountUsd: z.coerce.number().min(0).max(1000000),
  estimatedInternalCostUsd: z.coerce.number().min(0).max(100000).default(0),
  notes: z.string().trim().max(1000).optional().default(""),
});

export type RevenueExpensePreflightInput = z.infer<typeof revenueExpensePreflightSchema>;

export const revenueLeadSchema = z.object({
  businessName: z.string().trim().min(2).max(160),
  area: z.string().trim().min(2).max(120),
  niche: z.string().trim().min(2).max(120),
  websiteStatus: z.enum(["no_website", "weak_website", "has_website", "unknown"]).default("unknown"),
  contactChannel: z.enum(["email", "phone", "instagram", "contact_form", "unknown"]).default("unknown"),
  contactValue: z.string().trim().max(240).optional().default(""),
  evidence: z.string().trim().max(1200).optional().default(""),
  painPoint: z.string().trim().max(500).optional().default(""),
  estimatedOfferUsd: z.coerce.number().min(0).max(100000).default(2500),
  status: z.enum(["research", "qualified", "mockup_ready", "outreach_ready", "contacted", "proposal_sent", "closed", "disqualified"]).default("research"),
});

export type RevenueLeadInput = z.infer<typeof revenueLeadSchema>;

export const revenueMockupSchema = z.object({
  businessName: z.string().trim().min(2).max(160),
  area: z.string().trim().min(2).max(120),
  niche: z.string().trim().min(2).max(120),
  websiteStatus: z.enum(["no_website", "weak_website", "has_website", "unknown"]).default("unknown"),
  evidence: z.string().trim().max(1200).optional().default(""),
  painPoint: z.string().trim().max(500).optional().default(""),
  primaryOffer: z.string().trim().max(200).optional().default("Website 3D Premium + Automation Sprint"),
  estimatedOfferUsd: z.coerce.number().min(0).max(100000).default(3500),
  includeAutomation: z.coerce.boolean().default(true),
});

export type RevenueMockupInput = z.infer<typeof revenueMockupSchema>;

export const revenueMockupTemplatePackSchema = z.object({
  niche: z.string().trim().min(2).max(120).default("med spas"),
  area: z.string().trim().min(2).max(120).default("Miami"),
  dailyMockupTarget: z.coerce.number().int().min(1).max(50).default(8),
  maxCustomMinutesPerMockup: z.coerce.number().int().min(5).max(120).default(18),
  estimatedAiCostPerMockupUsd: z.coerce.number().min(0).max(10).default(0),
});

export type RevenueMockupTemplatePackInput = z.infer<typeof revenueMockupTemplatePackSchema>;

export const revenueLaunchReadinessSchema = z.object({
  area: z.string().trim().min(2).max(120).default("Miami"),
  niche: z.string().trim().min(2).max(120).default("med spas / aesthetics"),
  dailyResearchTarget: z.coerce.number().int().min(10).max(500).default(120),
  dailyMockupTarget: z.coerce.number().int().min(1).max(25).default(5),
  dailyContactTarget: z.coerce.number().int().min(1).max(50).default(10),
  emailPending: z.coerce.boolean().default(true),
});

export type RevenueLaunchReadinessInput = z.infer<typeof revenueLaunchReadinessSchema>;

export const revenueProjectPlanSchema = z.object({
  clientName: z.string().trim().min(2).max(160),
  projectType: z.enum(["website", "automation", "bundle"]).default("bundle"),
  packageName: z.string().trim().min(2).max(200).default("Website 3D Premium + Automation Sprint"),
  setupUsd: z.coerce.number().min(0).max(100000).default(3500),
  monthlyRetainerUsd: z.coerce.number().min(0).max(25000).default(750),
  estimatedInternalCostUsd: z.coerce.number().min(0).max(5000).default(54),
  depositPaid: revenueExplicitBooleanSchema.default(false),
  scopeApproved: revenueExplicitBooleanSchema.default(false),
  publicDataVerified: revenueExplicitBooleanSchema.default(false),
  includesAutomation: z.coerce.boolean().default(true),
  launchTargetDays: z.coerce.number().int().min(1).max(60).default(7),
  clientRequest: z.string().trim().max(1200).optional().default(""),
});

export type RevenueProjectPlanInput = z.infer<typeof revenueProjectPlanSchema>;

export const revenueWebsiteScaffoldSchema = revenueProjectPlanSchema.extend({
  area: z.string().trim().min(2).max(120).default("Miami"),
  niche: z.string().trim().min(2).max(120).default("local service"),
  websiteStatus: z.enum(["no_website", "weak_website", "has_website", "unknown"]).default("unknown"),
  sourceUrl: z.union([z.string().trim().url().max(300), z.literal("")]).optional().default(""),
  publicEvidence: z.string().trim().min(10).max(2000),
  painPoint: z.string().trim().min(5).max(800),
  primaryCta: z.string().trim().min(2).max(120).default("Book a consultation"),
  contactEmail: z.union([z.string().trim().email().max(240), z.literal("")]).optional().default(""),
});

export type RevenueWebsiteScaffoldInput = z.infer<typeof revenueWebsiteScaffoldSchema>;

export const revenueDeliveryWorkspaceSchema = revenueProjectPlanSchema.extend({
  workspaceName: z.string().trim().min(2).max(180).optional().default("Delivery workspace"),
  sourceOpportunityId: z.string().trim().max(160).optional().default(""),
  visualQaPassed: z.coerce.boolean().default(false),
  technicalQaPassed: z.coerce.boolean().default(false),
  automationQaPassed: z.coerce.boolean().default(false),
  clientHandoffReady: z.coerce.boolean().default(false),
});

export type RevenueDeliveryWorkspaceInput = z.infer<typeof revenueDeliveryWorkspaceSchema>;

export const revenueDeliveryWorkspaceUpdateSchema = z.object({
  workspaceId: z.string().trim().min(1).max(200),
  publicDataVerified: z.coerce.boolean().optional(),
  visualQaPassed: z.coerce.boolean().optional(),
  technicalQaPassed: z.coerce.boolean().optional(),
  automationQaPassed: z.coerce.boolean().optional(),
  clientHandoffReady: z.coerce.boolean().optional(),
  notes: z.string().trim().max(1200).optional(),
});

export type RevenueDeliveryWorkspaceUpdateInput = z.infer<typeof revenueDeliveryWorkspaceUpdateSchema>;

export const revenueDeliveryWorkspaceDeliverSchema = z.object({
  workspaceId: z.string().trim().min(1).max(200),
  approvedByRobert: z.coerce.boolean().default(false),
  notes: z.string().trim().max(1000).optional().default(""),
});

export type RevenueDeliveryWorkspaceDeliverInput = z.infer<typeof revenueDeliveryWorkspaceDeliverSchema>;

export const revenueDeliveryWorkspaceImprovementReviewSchema = z.object({
  workspaceId: z.string().trim().min(1).max(200),
  periodLabel: z.string().trim().min(2).max(80).default("post-delivery week 1"),
  leadsContacted: z.coerce.number().int().min(0).max(10000).default(0),
  replies: z.coerce.number().int().min(0).max(10000).default(0),
  callsBooked: z.coerce.number().int().min(0).max(10000).default(0),
  dealsClosed: z.coerce.number().int().min(0).max(10000).default(0),
  revenueCollectedUsd: z.coerce.number().min(0).max(1000000).optional(),
  spendUsd: z.coerce.number().min(0).max(50000).optional(),
  hoursSaved: z.coerce.number().min(0).max(10000).default(0),
  defectsFound: z.coerce.number().int().min(0).max(10000).default(0),
  clientComplaints: z.coerce.number().int().min(0).max(10000).default(0),
  notes: z.string().trim().max(1200).optional().default(""),
});

export type RevenueDeliveryWorkspaceImprovementReviewInput = z.infer<typeof revenueDeliveryWorkspaceImprovementReviewSchema>;

export const revenueAgentRunSchema = z.object({
  businessName: z.string().trim().min(2).max(160),
  area: z.string().trim().min(2).max(120),
  niche: z.string().trim().min(2).max(120),
  request: z.string().trim().min(8).max(1600),
  stage: z.enum(["lead_research", "mockup", "outreach", "proposal", "production", "delivery", "improvement"]).default("lead_research"),
  projectType: z.enum(["website", "automation", "bundle"]).default("bundle"),
  estimatedOfferUsd: z.coerce.number().min(0).max(100000).default(3500),
  estimatedInternalCostUsd: z.coerce.number().min(0).max(5000).default(54),
  monthlyBudgetUsd: z.coerce.number().min(0).max(100).default(100),
  cashCollectedUsd: z.coerce.number().min(0).max(1000000).default(0),
  approvalToContact: z.coerce.boolean().default(false),
  approvalToSpend: z.coerce.boolean().default(false),
  approvalToBuild: z.coerce.boolean().default(false),
});

export type RevenueAgentRunInput = z.infer<typeof revenueAgentRunSchema>;

export const revenueSalesAutopilotSchema = z.object({
  businessName: z.string().trim().min(2).max(160),
  area: z.string().trim().min(2).max(120),
  niche: z.string().trim().min(2).max(120),
  websiteStatus: z.enum(["no_website", "weak_website", "has_website", "unknown"]).default("unknown"),
  contactChannel: z.enum(["email", "phone", "instagram", "contact_form", "unknown"]).default("unknown"),
  contactValue: z.string().trim().max(240).optional().default(""),
  evidence: z.string().trim().max(1200).optional().default(""),
  painPoint: z.string().trim().max(500).optional().default(""),
  request: z.string().trim().min(8).max(1600),
  projectType: z.enum(["website", "automation", "bundle"]).default("bundle"),
  estimatedOfferUsd: z.coerce.number().min(0).max(100000).default(3500),
  estimatedInternalCostUsd: z.coerce.number().min(0).max(5000).default(54),
  monthlyBudgetUsd: z.coerce.number().min(0).max(100).default(100),
  cashCollectedUsd: z.coerce.number().min(0).max(1000000).default(0),
  recipientEmail: z.union([z.string().trim().email().max(240), z.literal("")]).optional().default(""),
  contactName: z.string().trim().max(120).optional().default("Owner"),
  sourceUrl: z.union([z.string().trim().url().max(300), z.literal("")]).optional().default(""),
  businessSummary: z.string().trim().max(2000).optional().default(""),
  monthlyRetainerUsd: z.coerce.number().min(0).max(25000).default(750),
  approvalToContact: z.coerce.boolean().default(false),
  approvalToSpend: z.coerce.boolean().default(false),
  approvalToBuild: z.coerce.boolean().default(false),
});

export type RevenueSalesAutopilotInput = z.infer<typeof revenueSalesAutopilotSchema>;

export const revenueMoneySprintSeedLeadSchema = revenueLeadSchema.extend({
  sourceUrl: z.union([z.string().trim().url().max(300), z.literal("")]).optional().default(""),
  recipientEmail: z.union([z.string().trim().email().max(240), z.literal("")]).optional().default(""),
  contactName: z.string().trim().max(120).optional().default("Owner"),
  businessSummary: z.string().trim().max(2000).optional().default(""),
});

export type RevenueMoneySprintSeedLeadInput = z.infer<typeof revenueMoneySprintSeedLeadSchema>;

export const revenueMoneySprintSchema = z.object({
  area: z.string().trim().min(2).max(120).default("Miami"),
  niche: z.string().trim().min(2).max(120).default("med spas"),
  offerFocus: z.enum(["websites", "automations", "both"]).default("both"),
  dailyResearchTarget: z.coerce.number().int().min(10).max(500).default(120),
  dailyQualifiedLeadLimit: z.coerce.number().int().min(5).max(100).default(25),
  dailyMockupLimit: z.coerce.number().int().min(1).max(25).default(5),
  dailyContactLimit: z.coerce.number().int().min(0).max(50).default(10),
  maxPaidDataSpendUsd: z.coerce.number().min(0).max(5000).default(0),
  requireRobertApprovalToContact: z.coerce.boolean().default(true),
  writePreviewFiles: revenueExplicitBooleanSchema.default(true),
  seedLeads: z.array(revenueMoneySprintSeedLeadSchema).max(25).optional().default([]),
  seedLeadBatchText: z.string().trim().max(20000).optional().default(""),
});

export type RevenueMoneySprintInput = z.infer<typeof revenueMoneySprintSchema>;

export const revenueScoutDispatchSchema = revenueMoneySprintSchema;

export type RevenueScoutDispatchInput = z.infer<typeof revenueScoutDispatchSchema>;

export const revenueMoneyReadinessSchema = z.object({
  mode: z.enum(["first-sprint", "production-launch"]).default("first-sprint"),
});

export type RevenueMoneyReadinessInput = z.infer<typeof revenueMoneyReadinessSchema>;

export const revenueOutreachSendSchema = z.object({
  draftId: z.string().trim().min(1).max(160),
  approvalDecisionId: z.string().trim().max(200).optional().default(""),
});

export type RevenueOutreachSendInput = z.infer<typeof revenueOutreachSendSchema>;

export const revenueOutreachApprovalPacketSchema = z.object({
  maxDrafts: z.coerce.number().int().min(1).max(50).default(10),
  includeSent: revenueExplicitBooleanSchema.default(false),
});

export type RevenueOutreachApprovalPacketInput = z.infer<typeof revenueOutreachApprovalPacketSchema>;

export const revenueManualContactApprovalPacketSchema = z.object({
  maxCandidates: z.coerce.number().int().min(1).max(50).default(10),
});

export type RevenueManualContactApprovalPacketInput = z.infer<typeof revenueManualContactApprovalPacketSchema>;

export const revenueWebsiteCreationPacketSchema = z.object({
  outreachDraftId: z.string().trim().min(1).max(180),
  approvalDecisionId: z.string().trim().max(200).optional().default(""),
  robertApprovedBuild: revenueExplicitBooleanSchema.default(false),
  clientApprovedScope: revenueExplicitBooleanSchema.default(false),
  depositPaid: revenueExplicitBooleanSchema.default(false),
  publicDataVerified: revenueExplicitBooleanSchema.default(false),
  writeFiles: revenueExplicitBooleanSchema.default(false),
  deployWebsite: revenueExplicitBooleanSchema.default(false),
  launchTargetDays: z.coerce.number().int().min(1).max(60).default(7),
});

export type RevenueWebsiteCreationPacketInput = z.infer<typeof revenueWebsiteCreationPacketSchema>;

export const revenueWebsitePublishReadinessPacketSchema = z.object({
  outreachDraftId: z.string().trim().min(1).max(180),
  websiteCreationApprovalDecisionId: z.string().trim().min(1).max(200),
  publishApprovalDecisionId: z.string().trim().max(200).optional().default(""),
  robertApprovedPublish: revenueExplicitBooleanSchema.default(false),
  previewDeployVerified: revenueExplicitBooleanSchema.default(false),
  appQaTargetPassed: revenueExplicitBooleanSchema.default(false),
  rollbackVerified: revenueExplicitBooleanSchema.default(false),
  deployProvider: z.string().trim().min(2).max(80),
  previewDeployUrl: z.string().trim().url().max(300),
  appQaEvidenceUrl: z.string().trim().url().max(300),
  rollbackPlanUrl: z.string().trim().url().max(300),
  writeFiles: revenueExplicitBooleanSchema.default(false),
  deployWebsite: revenueExplicitBooleanSchema.default(false),
  launchTargetDays: z.coerce.number().int().min(1).max(60).default(7),
});

export type RevenueWebsitePublishReadinessPacketInput = z.infer<typeof revenueWebsitePublishReadinessPacketSchema>;

export const revenuePaymentPathReadinessPacketSchema = z.object({
  paymentLink: z.string().trim().url().max(300),
  approvalDecisionId: z.string().trim().max(200).optional().default(""),
  robertApprovedPaymentPath: revenueExplicitBooleanSchema.default(false),
  paymentSmokeVerified: revenueExplicitBooleanSchema.default(false),
  depositConfirmedByRobert: revenueExplicitBooleanSchema.default(false),
  expectedDepositUsd: z.coerce.number().min(1).max(1000000),
  expectedPackage: z.string().trim().min(2).max(180),
  evidenceUrl: z.string().trim().url().max(300),
  evidenceNote: z.string().trim().min(8).max(1000),
  chargeClient: revenueExplicitBooleanSchema.default(false),
});

export type RevenuePaymentPathReadinessPacketInput = z.infer<typeof revenuePaymentPathReadinessPacketSchema>;

export const revenueContactPathReadinessPacketSchema = z.object({
  contactMode: z.enum(["manual", "email_provider"]),
  approvalDecisionId: z.string().trim().max(200).optional().default(""),
  robertApprovedContactPath: revenueExplicitBooleanSchema.default(false),
  contactPathVerified: revenueExplicitBooleanSchema.default(false),
  evidenceUrl: z.string().trim().url().max(300),
  evidenceNote: z.string().trim().min(8).max(1000),
  sendOutreach: revenueExplicitBooleanSchema.default(false),
});

export type RevenueContactPathReadinessPacketInput = z.infer<typeof revenueContactPathReadinessPacketSchema>;

export const revenuePublicLeadCandidateSchema = revenueMoneySprintSeedLeadSchema.extend({
  missionId: z.string().trim().max(160).optional().default(""),
  sourceTaskId: z.string().trim().max(160).optional().default(""),
  verificationStatus: z.enum(["needs_review", "verified_public", "blocked"]).default("needs_review"),
  publicEvidenceVerified: revenueExplicitBooleanSchema.default(false),
  approvalToImport: revenueExplicitBooleanSchema.default(false),
  notes: z.string().trim().max(1000).optional().default(""),
});

export type RevenuePublicLeadCandidateInput = z.infer<typeof revenuePublicLeadCandidateSchema>;

const publicCandidateVerificationEmailSchema = z.string().trim().email().max(240);

export const revenuePublicLeadCandidateVerificationUpdateSchema = z.object({
  candidateId: z.string().trim().min(1).max(180),
  contactChannel: z.enum(["email", "phone", "instagram", "contact_form"]),
  contactValue: z.string().trim().min(2).max(300),
  recipientEmail: z.union([publicCandidateVerificationEmailSchema, z.literal("")]).optional().default(""),
  sourceUrl: z.string().trim().url().max(300),
  evidence: z.string().trim().min(12).max(2000),
  painPoint: z.string().trim().min(8).max(1000).optional().default("Needs a conversion-focused website and follow-up path."),
  notes: z.string().trim().max(1000).optional().default(""),
  verifiedBy: z.string().trim().min(2).max(120).default("Robert"),
  confirmPublicEvidence: revenueExplicitBooleanSchema.default(false),
}).strict().superRefine((value, context) => {
  if (value.contactChannel === "email" && !publicCandidateVerificationEmailSchema.safeParse(value.contactValue).success) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["contactValue"],
      message: "contactValue must be a valid email when contactChannel is email.",
    });
  }
  if (value.contactChannel === "email" && value.recipientEmail && value.recipientEmail !== value.contactValue) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["recipientEmail"],
      message: "recipientEmail must match contactValue when contactChannel is email.",
    });
  }
});

export type RevenuePublicLeadCandidateVerificationUpdateInput = z.infer<typeof revenuePublicLeadCandidateVerificationUpdateSchema>;

export const revenuePublicLeadCandidateBlockSchema = z.object({
  candidateId: z.string().trim().min(1).max(180),
  blockReason: z.string().trim().min(8).max(500),
  sourceUrl: z.string().trim().url().max(300),
  evidence: z.string().trim().min(12).max(2000),
  notes: z.string().trim().max(1000).optional().default(""),
  verifiedBy: z.string().trim().min(2).max(120).default("Robert"),
  confirmPublicMismatch: revenueExplicitBooleanSchema.default(false),
}).strict();

export type RevenuePublicLeadCandidateBlockInput = z.infer<typeof revenuePublicLeadCandidateBlockSchema>;

export const revenuePublicScoutRunSchema = revenueMoneySprintSchema.omit({ seedLeads: true, seedLeadBatchText: true }).extend({
  source: z.enum(["browser_subagent", "manual_browser", "csv_import", "public_directory"]).default("browser_subagent"),
  scoutRunId: z.string().trim().max(160).optional().default(""),
  candidates: z.array(revenuePublicLeadCandidateSchema).max(25).default([]),
  autoApproveVerified: revenueExplicitBooleanSchema.default(false),
});

export type RevenuePublicScoutRunInput = z.infer<typeof revenuePublicScoutRunSchema>;

function isIsoCalendarDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export const revenuePublicScoutScheduleSchema = revenueMoneySprintSchema.omit({
  dailyContactLimit: true,
  maxPaidDataSpendUsd: true,
  requireRobertApprovalToContact: true,
  seedLeadBatchText: true,
  seedLeads: true,
  writePreviewFiles: true,
}).extend({
  scheduleName: z.string().trim().min(2).max(160).default("Daily public scout"),
  timezone: z.string().trim().min(2).max(80).default("America/New_York"),
  startDate: z.string().trim().refine(isIsoCalendarDate, "startDate must be a valid YYYY-MM-DD calendar date").default("2026-07-01"),
  runDays: z.coerce.number().int().min(1).max(14).default(5),
  runsPerDay: z.coerce.number().int().min(1).max(4).default(1),
  runHourLocal: z.coerce.number().int().min(0).max(23).default(9),
  browserExecutor: z.enum(["manual_browser", "subagent_browser"]).default("subagent_browser"),
  maxCandidatesPerRun: z.coerce.number().int().min(1).max(25).default(8),
}).strict();

export type RevenuePublicScoutScheduleInput = z.infer<typeof revenuePublicScoutScheduleSchema>;

export const revenuePublicLeadCandidateReviewSchema = revenueMoneySprintSchema.omit({ seedLeads: true, seedLeadBatchText: true }).extend({
  candidateIds: z.array(z.string().trim().min(1).max(180)).min(1).max(25),
  approvedByRobert: revenueExplicitBooleanSchema.default(false),
  reviewerNote: z.string().trim().max(1000).optional().default(""),
});

export type RevenuePublicLeadCandidateReviewInput = z.infer<typeof revenuePublicLeadCandidateReviewSchema>;

export const revenueApprovalDecisionSchema = z.object({
  targetId: z.string().trim().min(1).max(200),
  targetType: z.enum(["profit_guard", "outbox", "agent_run", "automation_opportunity", "delivery_workspace", "public_candidate", "ledger_entry", "website_publish", "payment_path", "contact_path", "manual"]),
  decision: z.enum(["approved", "rejected", "needs_changes"]),
  approvedAction: z.string().trim().min(2).max(500),
  maxSpendUsd: z.coerce.number().min(0).max(100).default(0),
  notes: z.string().trim().max(1000).optional().default(""),
  approvalSource: z.enum(["generic", "public_candidate_approval_cli", "outreach_approval_cli", "website_creation_approval_cli", "website_publish_approval_cli", "payment_path_approval_cli", "contact_path_approval_cli", "ledger_entry_approval_cli"]).default("generic"),
  publicCandidateSnapshotHash: z.string().trim().max(128).optional().default(""),
  outreachDraftSnapshotHash: z.string().trim().max(128).optional().default(""),
  websiteCreationSnapshotHash: z.string().trim().max(128).optional().default(""),
  websitePublishSnapshotHash: z.string().trim().max(128).optional().default(""),
  paymentPathSnapshotHash: z.string().trim().max(128).optional().default(""),
  contactPathSnapshotHash: z.string().trim().max(128).optional().default(""),
  ledgerEntrySnapshotHash: z.string().trim().max(128).optional().default(""),
});

export type RevenueApprovalDecisionInput = z.infer<typeof revenueApprovalDecisionSchema>;

export const revenueAutomationIntakeSchema = automationQuoteSchema.extend({
  contactName: z.string().trim().max(120).optional().default(""),
  contactEmail: z.union([z.string().trim().email().max(240), z.literal("")]).optional().default(""),
  knownAnswers: z.string().trim().max(2000).optional().default(""),
  source: z.enum(["manual", "lead", "website_form", "call", "email"]).default("manual"),
});

export type RevenueAutomationIntakeInput = z.infer<typeof revenueAutomationIntakeSchema>;

export const revenueAutomationIntakeAnswerSchema = z.object({
  intakeId: z.string().trim().min(1).max(200),
  answers: z.string().trim().min(10).max(2000),
});

export type RevenueAutomationIntakeAnswerInput = z.infer<typeof revenueAutomationIntakeAnswerSchema>;

export const revenueAutomationIntakeConvertSchema = z.object({
  intakeId: z.string().trim().min(1).max(200),
  status: z.enum(["intake", "quoted", "approved", "sold", "in_delivery", "delivered", "blocked"]).default("intake"),
  clientApprovedScope: z.coerce.boolean().default(false),
  depositPaid: z.coerce.boolean().default(false),
});

export type RevenueAutomationIntakeConvertInput = z.infer<typeof revenueAutomationIntakeConvertSchema>;

export const revenueAutomationAgentCommandSchema = revenueAutomationIntakeSchema.extend({
  createOpportunityIfClear: z.coerce.boolean().default(true),
  lifecycleTarget: z.enum(["quote", "opportunity", "sale", "delivery"]).default("opportunity"),
  clientApprovedScope: z.coerce.boolean().default(false),
  depositPaid: z.coerce.boolean().default(false),
  cashCollectedUsd: z.coerce.number().min(1).max(1000000).optional(),
  createDeliveryWorkspaceIfSold: z.coerce.boolean().default(false),
  workspaceName: z.string().trim().min(2).max(180).optional().default("Delivery workspace"),
  publicDataVerified: z.coerce.boolean().default(false),
  visualQaPassed: z.coerce.boolean().default(false),
  technicalQaPassed: z.coerce.boolean().default(false),
  automationQaPassed: z.coerce.boolean().default(false),
  clientHandoffReady: z.coerce.boolean().default(false),
  launchTargetDays: z.coerce.number().int().min(1).max(60).default(7),
});

export type RevenueAutomationAgentCommandInput = z.infer<typeof revenueAutomationAgentCommandSchema>;

export const revenueAutomationOpportunityDeliverySchema = z.object({
  opportunityId: z.string().trim().min(1).max(200),
  workspaceName: z.string().trim().min(2).max(180).optional().default("Delivery workspace"),
  publicDataVerified: z.coerce.boolean().default(false),
  visualQaPassed: z.coerce.boolean().default(false),
  technicalQaPassed: z.coerce.boolean().default(false),
  automationQaPassed: z.coerce.boolean().default(false),
  clientHandoffReady: z.coerce.boolean().default(false),
  launchTargetDays: z.coerce.number().int().min(1).max(60).default(7),
});

export type RevenueAutomationOpportunityDeliveryInput = z.infer<typeof revenueAutomationOpportunityDeliverySchema>;

export const revenueAutomationOpportunityCloseSchema = z.object({
  opportunityId: z.string().trim().min(1).max(200),
  cashCollectedUsd: z.coerce.number().min(1).max(1000000).optional(),
  markScopeApproved: z.coerce.boolean().default(true),
  notes: z.string().trim().max(800).optional().default(""),
  approvalDecisionId: z.string().trim().max(200).optional().default(""),
});

export type RevenueAutomationOpportunityCloseInput = z.infer<typeof revenueAutomationOpportunityCloseSchema>;

type RevenueLedgerEntry = RevenueLedgerEntryInput & {
  id: string;
  createdAt: string;
};

type RevenueLead = RevenueLeadInput & {
  id: string;
  createdAt: string;
  updatedAt: string;
};

type RevenueOutreachDraft = RevenueOutreachDraftInput & {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: "draft" | "approved" | "blocked";
  subject: string;
  body: string;
  pricing: ReturnType<typeof buildProposalEmail>["pricing"];
  delivery: ReturnType<typeof buildProposalEmail>["delivery"] & {
    provider?: string;
    externalMessageId?: string;
    sentAt?: string;
    lastAttemptAt?: string;
  };
  links: ReturnType<typeof buildProposalEmail>["links"];
  qaGates: Array<{ gate: string; passed: boolean; fix: string }>;
  nextAction: string;
};

type RevenueEmailProviderStatus = {
  provider: "resend";
  configured: boolean;
  mode: "api" | "manual";
  fromEmail: string;
  missing: string[];
  monthlyCostUsd: number;
  sendPolicy: string;
};

type RevenueOutreachSendPayload = {
  from: string;
  to: string;
  subject: string;
  text: string;
  html: string;
  idempotencyKey: string;
};

type RevenueOutreachSendResponse = {
  id: string;
};

type RevenueAgentRun = RevenueAgentRunInput & {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: "ready" | "approval_required" | "blocked";
  clarificationGate: {
    status: "clear" | "needs_clarification";
    missing: string[];
    questions: string[];
    minimumAnswer: string;
    blocks: string[];
  };
  mainAgent: {
    agent: string;
    decision: string;
    reason: string;
  };
  budgetGate: {
    monthlyCapUsd: number;
    insideCap: boolean;
    cashProtected: boolean;
    allowedSpendUsd: number;
  };
  workOrder: Array<{
    step: string;
    ownerAgent: string;
    output: string;
    approvalRequired: boolean;
  }>;
  subagentReviews: Array<{
    agent: string;
    verdict: "pass" | "fix" | "block";
    correction: string;
  }>;
  requiredApprovals: string[];
  nextActions: string[];
  learningUpdate: string;
};

type RevenueAutomationOpportunity = RevenueAutomationOpportunityInput & {
  id: string;
  createdAt: string;
  updatedAt: string;
  quote: ReturnType<typeof buildAutomationQuote>;
  qaGates: Array<{ gate: string; passed: boolean; fix: string }>;
  nextAction: string;
};

type RevenueImprovementReview = ReturnType<typeof buildImprovementReview> & {
  id: string;
  createdAt: string;
  updatedAt: string;
  playbookVersion: number;
  decisionStatus: ReturnType<typeof buildImprovementReview>["decision"]["status"];
  learningSummary: string;
};

type RevenueScoutingMission = ReturnType<typeof buildRevenueScoutingMission> & {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: "planned" | "in_research" | "ready_for_leads" | "blocked";
  learningNote: string;
};

type RevenuePublicLeadCandidate = RevenuePublicLeadCandidateInput & {
  id: string;
  createdAt: string;
  updatedAt: string;
  qualification: ReturnType<typeof qualifyRevenueLead>;
  importReady: boolean;
  blockedReasons: string[];
  batchRow: string;
  safety: {
    allowedAction: string;
    blockedActions: string[];
    persistsLead: boolean;
    sendsOutreach: boolean;
    writesPreviewFiles: boolean;
  };
};

type RevenueDeliveryWorkspace = {
  id: string;
  createdAt: string;
  updatedAt: string;
  input: RevenueDeliveryWorkspaceInput;
  status: "ready_to_deliver" | "needs_corrections" | "blocked";
  projectPlan: ReturnType<typeof buildRevenueProjectPlan>;
  deliveryReview: ReturnType<typeof buildDeliveryReview>;
  correctionQueue: Array<{
    agent: string;
    priority: "high" | "medium";
    action: string;
    blocksDelivery: boolean;
  }>;
  runbook: Array<{
    phase: string;
    ownerAgent: string;
    checklist: string[];
  }>;
  approvalSummary: {
    canShowClientPreview: boolean;
    canLaunch: boolean;
    requiredBeforeClient: string[];
  };
  learningNote: string;
};

type RevenueApprovalDecision = RevenueApprovalDecisionInput & {
  id: string;
  createdAt: string;
  guardrail: {
    status: "recorded" | "blocked";
    reason: string;
  };
};

type RevenueAutomationIntake = RevenueAutomationIntakeInput & {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: "needs_answers" | "ready_for_quote";
  quote: ReturnType<typeof buildAutomationQuote>;
  missingAnswers: string[];
  nextQuestions: string[];
  answerTemplate: string;
  blockedUntilAnswered: string[];
  nextAction: string;
};

const revenueLedger: RevenueLedgerEntry[] = [];
const revenueLeads: RevenueLead[] = [];
const revenueOutreachDrafts: RevenueOutreachDraft[] = [];
const revenueAgentRuns: RevenueAgentRun[] = [];
const revenueAutomationOpportunities: RevenueAutomationOpportunity[] = [];
const revenueImprovementReviews: RevenueImprovementReview[] = [];
const revenueScoutingMissions: RevenueScoutingMission[] = [];
const revenuePublicLeadCandidates: RevenuePublicLeadCandidate[] = [];
const revenueDeliveryWorkspaces: RevenueDeliveryWorkspace[] = [];
const revenueApprovalDecisions: RevenueApprovalDecision[] = [];
const revenueAutomationIntakes: RevenueAutomationIntake[] = [];
const persistedRevenueLedgerEntrySchema = revenueLedgerEntrySchema.extend({
  id: z.string().trim().min(1),
  createdAt: z.string().trim().min(1),
});
const persistedRevenueLeadSchema = revenueLeadSchema.extend({
  id: z.string().trim().min(1),
  createdAt: z.string().trim().min(1),
  updatedAt: z.string().trim().min(1),
});
const persistedRevenueOutreachDraftSchema = revenueOutreachDraftSchema.extend({
  id: z.string().trim().min(1),
  createdAt: z.string().trim().min(1),
  updatedAt: z.string().trim().min(1),
  status: z.enum(["draft", "approved", "blocked"]),
  subject: z.string().trim().min(1),
  body: z.string().trim().min(1),
  pricing: z.object({
    totalSetupUsd: z.number(),
    depositUsd: z.number(),
    monthlyRetainerUsd: z.number(),
    estimatedInternalMonthlyCostUsd: z.number(),
    grossMarginUsd: z.number(),
    grossMarginPercent: z.number(),
    insideCostCap: z.boolean(),
  }),
  delivery: z.object({
    mode: z.string(),
    sendStatus: z.string(),
    reason: z.string(),
    requiresApproval: z.boolean(),
    provider: z.string().optional(),
    externalMessageId: z.string().optional(),
    sentAt: z.string().optional(),
    lastAttemptAt: z.string().optional(),
  }),
  links: z.object({
    mailto: z.string(),
    gmailCompose: z.string(),
  }),
  qaGates: z.array(z.object({ gate: z.string(), passed: z.boolean(), fix: z.string() })),
  nextAction: z.string(),
});
const persistedRevenueAgentRunSchema = revenueAgentRunSchema.extend({
  id: z.string().trim().min(1),
  createdAt: z.string().trim().min(1),
  updatedAt: z.string().trim().min(1),
  status: z.enum(["ready", "approval_required", "blocked"]),
  mainAgent: z.object({
    agent: z.string(),
    decision: z.string(),
    reason: z.string(),
  }),
  budgetGate: z.object({
    monthlyCapUsd: z.number(),
    insideCap: z.boolean(),
    cashProtected: z.boolean(),
    allowedSpendUsd: z.number(),
  }),
  clarificationGate: z.object({
    status: z.enum(["clear", "needs_clarification"]),
    missing: z.array(z.string()),
    questions: z.array(z.string()),
    minimumAnswer: z.string(),
    blocks: z.array(z.string()),
  }).optional().default({
    status: "clear",
    missing: [],
    questions: [],
    minimumAnswer: "Pedido anterior cargado antes del gate de claridad.",
    blocks: [],
  }),
  workOrder: z.array(z.object({
    step: z.string(),
    ownerAgent: z.string(),
    output: z.string(),
    approvalRequired: z.boolean(),
  })),
  subagentReviews: z.array(z.object({
    agent: z.string(),
    verdict: z.enum(["pass", "fix", "block"]),
    correction: z.string(),
  })),
  requiredApprovals: z.array(z.string()),
  nextActions: z.array(z.string()),
  learningUpdate: z.string(),
});
const persistedRevenueAutomationOpportunitySchema = revenueAutomationOpportunitySchema.extend({
  id: z.string().trim().min(1),
  createdAt: z.string().trim().min(1),
  updatedAt: z.string().trim().min(1),
  quote: z.unknown(),
  qaGates: z.array(z.object({ gate: z.string(), passed: z.boolean(), fix: z.string() })),
  nextAction: z.string(),
});
const persistedRevenueImprovementReviewSchema = z.object({
  id: z.string().trim().min(1),
  createdAt: z.string().trim().min(1),
  updatedAt: z.string().trim().min(1),
  playbookVersion: z.number(),
  decisionStatus: z.enum(["pause_and_fix", "scale_carefully", "iterate_small_batch"]),
  learningSummary: z.string(),
  input: improvementReviewSchema,
  decision: z.object({
    status: z.enum(["pause_and_fix", "scale_carefully", "iterate_small_batch"]),
    reason: z.string(),
    approvalMode: z.string(),
  }),
  metrics: z.object({
    replyRate: z.number(),
    bookingRate: z.number(),
    closeRate: z.number(),
    profitUsd: z.number(),
    roiPercent: z.number(),
    grossMarginPercent: z.number(),
    costPerReplyUsd: z.number(),
    costPerBookedCallUsd: z.number(),
    insideSpendCap: z.boolean(),
    profitable: z.boolean(),
  }),
  experiments: z.array(z.string()),
  playbookUpdates: z.array(z.string()),
  agentScorecard: z.array(z.object({
    agent: z.string(),
    score: z.string(),
    lesson: z.string(),
  })),
  nextBatch: z.object({
    maxLeads: z.number(),
    maxSpendUsd: z.number(),
    requiredBeforeNextSend: z.array(z.string()),
  }),
});
const persistedRevenueScoutingMissionSchema = z.object({
  id: z.string().trim().min(1),
  createdAt: z.string().trim().min(1),
  updatedAt: z.string().trim().min(1),
  status: z.enum(["planned", "in_research", "ready_for_leads", "blocked"]),
  learningNote: z.string(),
  mission: z.object({
    name: z.string(),
    area: z.string(),
    niche: z.string(),
    offerFocus: z.enum(["websites", "automations", "both"]),
    targetLeadCount: z.number(),
    leadBatchSize: z.number(),
    mode: z.enum(["free_public_research", "paid_data_requires_approval"]),
  }),
  budgetGate: z.object({
    monthlyCapUsd: z.number(),
    requestedPaidDataSpendUsd: z.number(),
    approvedPaidDataSpendUsd: z.number(),
    requiresApprovalToSpend: z.boolean(),
    allowedBeforeApproval: z.array(z.string()),
    blockedBeforeApproval: z.array(z.string()),
  }),
  searchQueries: z.array(z.string()),
  leadEvidenceChecklist: z.array(z.string()),
  qualificationScorecard: z.array(z.object({
    item: z.string(),
    maxPoints: z.number(),
    signals: z.array(z.string()),
  })),
  subagentReviews: z.array(z.object({
    agent: z.string(),
    check: z.string(),
  })),
  nextActions: z.array(z.string()),
});
const persistedRevenuePublicLeadCandidateSchema = revenuePublicLeadCandidateSchema.extend({
  id: z.string().trim().min(1),
  createdAt: z.string().trim().min(1),
  updatedAt: z.string().trim().min(1),
  qualification: z.object({
    grade: z.enum(["A", "B", "C", "D"]),
    score: z.number(),
    recommendedStatus: z.enum(["research", "qualified", "mockup_ready", "outreach_ready", "contacted", "proposal_sent", "closed", "disqualified"]),
    nextAgent: z.string(),
    guardrail: z.string(),
    outreachDraft: z.string(),
    missing: z.array(z.string()),
  }),
  importReady: z.boolean(),
  blockedReasons: z.array(z.string()),
  batchRow: z.string(),
  safety: z.object({
    allowedAction: z.string(),
    blockedActions: z.array(z.string()),
    persistsLead: z.boolean(),
    sendsOutreach: z.boolean(),
    writesPreviewFiles: z.boolean(),
  }),
});
const persistedRevenueDeliveryWorkspaceSchema = z.object({
  id: z.string().trim().min(1),
  createdAt: z.string().trim().min(1),
  updatedAt: z.string().trim().min(1),
  input: revenueDeliveryWorkspaceSchema,
  status: z.enum(["ready_to_deliver", "needs_corrections", "blocked"]),
  projectPlan: z.unknown(),
  deliveryReview: z.unknown(),
  correctionQueue: z.array(z.object({
    agent: z.string(),
    priority: z.enum(["high", "medium"]),
    action: z.string(),
    blocksDelivery: z.boolean(),
  })),
  runbook: z.array(z.object({
    phase: z.string(),
    ownerAgent: z.string(),
    checklist: z.array(z.string()),
  })),
  approvalSummary: z.object({
    canShowClientPreview: z.boolean(),
    canLaunch: z.boolean(),
    requiredBeforeClient: z.array(z.string()),
  }),
  learningNote: z.string(),
});
const persistedRevenueApprovalDecisionSchema = revenueApprovalDecisionSchema.extend({
  id: z.string().trim().min(1),
  createdAt: z.string().trim().min(1),
  guardrail: z.object({
    status: z.enum(["recorded", "blocked"]),
    reason: z.string(),
  }),
});
const persistedRevenueAutomationIntakeSchema = revenueAutomationIntakeSchema.extend({
  id: z.string().trim().min(1),
  createdAt: z.string().trim().min(1),
  updatedAt: z.string().trim().min(1),
  status: z.enum(["needs_answers", "ready_for_quote"]),
  quote: z.unknown(),
  missingAnswers: z.array(z.string()),
  nextQuestions: z.array(z.string()),
  answerTemplate: z.string().optional().default(""),
  blockedUntilAnswered: z.array(z.string()).optional().default([]),
  nextAction: z.string(),
});
let revenueLedgerLoaded = false;
let revenueLedgerPersistenceError: string | null = null;
let revenueLedgerPathOverride: string | null = null;
let revenueLeadsLoaded = false;
let revenueLeadsPersistenceError: string | null = null;
let revenueLeadsPathOverride: string | null = null;
let revenueOutreachLoaded = false;
let revenueOutreachPersistenceError: string | null = null;
let revenueOutreachPathOverride: string | null = null;
let revenueOutreachSenderOverride: ((payload: RevenueOutreachSendPayload) => Promise<RevenueOutreachSendResponse>) | null = null;
let revenueAgentRunsLoaded = false;
let revenueAgentRunsPersistenceError: string | null = null;
let revenueAgentRunsPathOverride: string | null = null;
let revenueAutomationOpportunitiesLoaded = false;
let revenueAutomationOpportunitiesPersistenceError: string | null = null;
let revenueAutomationOpportunitiesPathOverride: string | null = null;
let revenueImprovementReviewsLoaded = false;
let revenueImprovementReviewsPersistenceError: string | null = null;
let revenueImprovementReviewsPathOverride: string | null = null;
let revenueScoutingMissionsLoaded = false;
let revenueScoutingMissionsPersistenceError: string | null = null;
let revenueScoutingMissionsPathOverride: string | null = null;
let revenuePublicLeadCandidatesLoaded = false;
let revenuePublicLeadCandidatesPersistenceError: string | null = null;
let revenuePublicLeadCandidatesPathOverride: string | null = null;
let revenueDeliveryWorkspacesLoaded = false;
let revenueDeliveryWorkspacesPersistenceError: string | null = null;
let revenueDeliveryWorkspacesPathOverride: string | null = null;
let revenueApprovalDecisionsLoaded = false;
let revenueApprovalDecisionsPersistenceError: string | null = null;
let revenueApprovalDecisionsPathOverride: string | null = null;
let revenueAutomationIntakesLoaded = false;
let revenueAutomationIntakesPersistenceError: string | null = null;
let revenueAutomationIntakesPathOverride: string | null = null;
let revenueUserDataScope: string | null = null;

const REVENUE_ENGINE_DATA_FILES = {
  ledger: "ledger.json",
  leads: "leads.json",
  outreach: "outreach.json",
  agentRuns: "agent_runs.json",
  automationOpportunities: "automation_opportunities.json",
  improvementReviews: "improvement_reviews.json",
  scoutingMissions: "scouting_missions.json",
  publicLeadCandidates: "public_lead_candidates.json",
  deliveryWorkspaces: "delivery_workspaces.json",
  approvalDecisions: "approval_decisions.json",
  automationIntakes: "automation_intakes.json",
} as const;

function safeRevenueUserId(userId: string) {
  const safe = userId.trim().replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 96);
  return safe || "unknown-user";
}

export function buildRevenueUserDataPaths(userId: string) {
  const baseDir = path.join(process.cwd(), "revenue_engine_data", "users", safeRevenueUserId(userId));
  return {
    baseDir,
    ledgerPath: path.join(baseDir, REVENUE_ENGINE_DATA_FILES.ledger),
    leadsPath: path.join(baseDir, REVENUE_ENGINE_DATA_FILES.leads),
    outreachPath: path.join(baseDir, REVENUE_ENGINE_DATA_FILES.outreach),
    agentRunsPath: path.join(baseDir, REVENUE_ENGINE_DATA_FILES.agentRuns),
    automationOpportunitiesPath: path.join(baseDir, REVENUE_ENGINE_DATA_FILES.automationOpportunities),
    improvementReviewsPath: path.join(baseDir, REVENUE_ENGINE_DATA_FILES.improvementReviews),
    scoutingMissionsPath: path.join(baseDir, REVENUE_ENGINE_DATA_FILES.scoutingMissions),
    publicLeadCandidatesPath: path.join(baseDir, REVENUE_ENGINE_DATA_FILES.publicLeadCandidates),
    deliveryWorkspacesPath: path.join(baseDir, REVENUE_ENGINE_DATA_FILES.deliveryWorkspaces),
    approvalDecisionsPath: path.join(baseDir, REVENUE_ENGINE_DATA_FILES.approvalDecisions),
    automationIntakesPath: path.join(baseDir, REVENUE_ENGINE_DATA_FILES.automationIntakes),
  };
}

function clearRevenueEngineMemory() {
  revenueLedger.splice(0, revenueLedger.length);
  revenueLeads.splice(0, revenueLeads.length);
  revenueOutreachDrafts.splice(0, revenueOutreachDrafts.length);
  revenueAgentRuns.splice(0, revenueAgentRuns.length);
  revenueAutomationOpportunities.splice(0, revenueAutomationOpportunities.length);
  revenueImprovementReviews.splice(0, revenueImprovementReviews.length);
  revenueScoutingMissions.splice(0, revenueScoutingMissions.length);
  revenuePublicLeadCandidates.splice(0, revenuePublicLeadCandidates.length);
  revenueDeliveryWorkspaces.splice(0, revenueDeliveryWorkspaces.length);
  revenueApprovalDecisions.splice(0, revenueApprovalDecisions.length);
  revenueAutomationIntakes.splice(0, revenueAutomationIntakes.length);
}

function markRevenueEngineDataUnloaded() {
  revenueLedgerLoaded = false;
  revenueLeadsLoaded = false;
  revenueOutreachLoaded = false;
  revenueAgentRunsLoaded = false;
  revenueAutomationOpportunitiesLoaded = false;
  revenueImprovementReviewsLoaded = false;
  revenueScoutingMissionsLoaded = false;
  revenuePublicLeadCandidatesLoaded = false;
  revenueDeliveryWorkspacesLoaded = false;
  revenueApprovalDecisionsLoaded = false;
  revenueAutomationIntakesLoaded = false;
}

export function setRevenueUserDataScope(userId: string) {
  const paths = buildRevenueUserDataPaths(userId);
  if (revenueUserDataScope === paths.baseDir) return paths;
  revenueUserDataScope = paths.baseDir;
  revenueLedgerPathOverride = paths.ledgerPath;
  revenueLeadsPathOverride = paths.leadsPath;
  revenueOutreachPathOverride = paths.outreachPath;
  revenueAgentRunsPathOverride = paths.agentRunsPath;
  revenueAutomationOpportunitiesPathOverride = paths.automationOpportunitiesPath;
  revenueImprovementReviewsPathOverride = paths.improvementReviewsPath;
  revenueScoutingMissionsPathOverride = paths.scoutingMissionsPath;
  revenuePublicLeadCandidatesPathOverride = paths.publicLeadCandidatesPath;
  revenueDeliveryWorkspacesPathOverride = paths.deliveryWorkspacesPath;
  revenueApprovalDecisionsPathOverride = paths.approvalDecisionsPath;
  revenueAutomationIntakesPathOverride = paths.automationIntakesPath;
  clearRevenueEngineMemory();
  markRevenueEngineDataUnloaded();
  return paths;
}

function getRevenueLedgerPath() {
  return revenueLedgerPathOverride || getRevenueEnginePathEnv("REVENUE_ENGINE_LEDGER_PATH", "ledger.json");
}

function getRevenueLeadsPath() {
  return revenueLeadsPathOverride || getRevenueEnginePathEnv("REVENUE_ENGINE_LEADS_PATH", "leads.json");
}

function getRevenueOutreachPath() {
  return revenueOutreachPathOverride || getRevenueEnginePathEnv("REVENUE_ENGINE_OUTREACH_PATH", "outreach.json");
}

function getRevenueMockupsDir() {
  const configuredPath = process.env.REVENUE_MOCKUPS_DIR;
  const rootDir = configuredPath !== undefined && hasRealValue(configuredPath)
    ? configuredPath
    : path.join(process.cwd(), "revenue_mockups");
  const scopeName = revenueUserDataScope ? path.basename(revenueUserDataScope) : "default";
  return path.join(rootDir, safeRevenueUserId(scopeName), "previews");
}

function getRevenueEnginePathEnv(envName: string, defaultFileName: string): string {
  const configuredPath = process.env[envName];
  if (configuredPath !== undefined && hasRealValue(configuredPath)) return configuredPath;
  if (defaultFileName.includes(path.sep) || defaultFileName.includes("/")) return path.join(process.cwd(), defaultFileName);
  return path.join(process.cwd(), "revenue_engine_data", defaultFileName);
}

function slugifyRevenueValue(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "preview";
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getRevenueEmailProviderStatus(): RevenueEmailProviderStatus {
  const fromEmail = [process.env.REVENUE_ENGINE_FROM_EMAIL, process.env.RESEND_FROM_EMAIL].find(hasRealValue) || "";
  const missing = [
    !hasRealValue(process.env.RESEND_API_KEY) && "RESEND_API_KEY",
    !hasRealValue(fromEmail) && "REVENUE_ENGINE_FROM_EMAIL",
  ].filter((item): item is string => Boolean(item));

  return {
    provider: "resend",
    configured: missing.length === 0,
    mode: missing.length === 0 ? "api" : "manual",
    fromEmail,
    missing,
    monthlyCostUsd: 0,
    sendPolicy: "Solo envia drafts approved con approvalDecisionId auditable; si falta provider queda en Gmail/mailto manual.",
  };
}

function hasLiveRevenueStripeKey(value: string | undefined) {
  return hasStrongSecret(value) && (value ?? "").trim().startsWith("sk_live_");
}

function hasRevenuePaymentLink(value: string | undefined) {
  if (!hasRealValue(value)) return false;
  try {
    const url = new URL(value);
    const allowedHosts = new Set([
      "buy.stripe.com",
      "checkout.stripe.com",
      "invoice.stripe.com",
      ...String(process.env.REVENUE_ENGINE_PAYMENT_LINK_ALLOWED_HOSTS || "")
        .split(",")
        .map((host) => host.trim().toLowerCase())
        .filter(Boolean),
    ]);
    return url.protocol === "https:" && allowedHosts.has(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

function getRevenuePaymentPathApprovalReadyFromEnv(paymentLink: string | undefined) {
  const parsedPaymentLink = String(paymentLink || "").trim();
  if (!parsedPaymentLink || !hasRevenuePaymentLink(parsedPaymentLink)) return false;
  loadRevenueApprovalDecisions();
  const approvalDecisionId = String(process.env.REVENUE_ENGINE_PAYMENT_PATH_APPROVAL_DECISION_ID || "").trim();
  const expectedDepositUsd = Number(process.env.REVENUE_ENGINE_PAYMENT_EXPECTED_DEPOSIT_USD || 0);
  const expectedPackage = String(process.env.REVENUE_ENGINE_PAYMENT_EXPECTED_PACKAGE || "").trim();
  const evidenceUrl = String(process.env.REVENUE_ENGINE_PAYMENT_EVIDENCE_URL || "").trim();
  const evidenceNote = String(process.env.REVENUE_ENGINE_PAYMENT_EVIDENCE_NOTE || "").trim();
  if (!approvalDecisionId || !Number.isFinite(expectedDepositUsd) || expectedDepositUsd < 1 || expectedPackage.length < 2 || evidenceNote.length < 8) {
    return false;
  }
  let paymentHost = "";
  try {
    paymentHost = new URL(parsedPaymentLink).hostname.toLowerCase();
    if (evidenceUrl) new URL(evidenceUrl);
    else return false;
  } catch {
    return false;
  }
  const paymentSnapshot = {
    paymentMethod: "payment_link" as const,
    paymentLink: parsedPaymentLink,
    paymentHost,
    expectedDepositUsd,
    expectedPackage,
  };
  const paymentProof = {
    robertApprovedPaymentPath: isExplicitRevenueApproval(process.env.REVENUE_ENGINE_PAYMENT_LINK_APPROVED_BY_ROBERT),
    paymentSmokeVerified: isExplicitRevenueApproval(process.env.REVENUE_ENGINE_PAYMENT_SMOKE_VERIFIED),
    depositConfirmedByRobert: isExplicitRevenueApproval(process.env.REVENUE_ENGINE_DEPOSIT_CONFIRMED_BY_ROBERT),
    paymentLink: parsedPaymentLink,
    evidenceUrl,
    evidenceNote,
  };
  const expectedTargetId = buildRevenuePaymentPathApprovalTargetId(parsedPaymentLink);
  const expectedSnapshotHash = buildRevenuePaymentPathSnapshotHash(paymentSnapshot, paymentProof);
  const approvalDecision = revenueApprovalDecisions.find((item) => item.id === approvalDecisionId);
  return Boolean(
    approvalDecision
    && approvalDecision.targetType === "payment_path"
    && approvalDecision.targetId === expectedTargetId
    && approvalDecision.decision === "approved"
    && approvalDecision.guardrail.status === "recorded"
    && approvalDecision.approvalSource === "payment_path_approval_cli"
    && approvalDecision.paymentPathSnapshotHash === expectedSnapshotHash,
  );
}

function normalizeRevenueContactMode(value: string | undefined, emailProvider: RevenueEmailProviderStatus): "manual" | "email_provider" {
  const mode = String(value || "").trim();
  if (mode === "manual" || mode === "email_provider") return mode;
  return emailProvider.configured ? "email_provider" : "manual";
}

function getRevenueContactPathApprovalReadyFromEnv(emailProvider: RevenueEmailProviderStatus) {
  loadRevenueApprovalDecisions();
  const approvalDecisionId = String(process.env.REVENUE_ENGINE_CONTACT_PATH_APPROVAL_DECISION_ID || "").trim();
  const contactMode = normalizeRevenueContactMode(process.env.REVENUE_ENGINE_CONTACT_MODE, emailProvider);
  const evidenceUrl = String(process.env.REVENUE_ENGINE_CONTACT_EVIDENCE_URL || "").trim();
  const evidenceNote = String(process.env.REVENUE_ENGINE_CONTACT_EVIDENCE_NOTE || "").trim();
  if (!approvalDecisionId || evidenceNote.length < 8) return false;
  try {
    new URL(evidenceUrl);
  } catch {
    return false;
  }
  const contactSnapshot = {
    contactMode,
    fromEmail: emailProvider.fromEmail || "",
    manualContactApproved: isExplicitRevenueApproval(process.env.REVENUE_ENGINE_MANUAL_CONTACT_APPROVED),
    emailProviderConfigured: emailProvider.configured,
  };
  const contactProof = {
    robertApprovedContactPath: isExplicitRevenueApproval(process.env.REVENUE_ENGINE_ROBERT_CONTACT_APPROVED),
    contactPathVerified: isExplicitRevenueApproval(process.env.REVENUE_ENGINE_CONTACT_PATH_VERIFIED),
    evidenceUrl,
    evidenceNote,
  };
  const expectedTargetId = buildRevenueContactPathApprovalTargetId(contactSnapshot);
  const expectedSnapshotHash = buildRevenueContactPathSnapshotHash(contactSnapshot, contactProof);
  const approvalDecision = revenueApprovalDecisions.find((item) => item.id === approvalDecisionId);
  return Boolean(
    approvalDecision
    && approvalDecision.targetType === "contact_path"
    && approvalDecision.targetId === expectedTargetId
    && approvalDecision.decision === "approved"
    && approvalDecision.guardrail.status === "recorded"
    && approvalDecision.approvalSource === "contact_path_approval_cli"
    && approvalDecision.contactPathSnapshotHash === expectedSnapshotHash,
  );
}

function hasProductionRevenueDatabaseUrl(value: string | undefined) {
  if (!hasRealValue(value)) return false;
  try {
    const url = new URL(value);
    const protocolOk = url.protocol === "postgres:" || url.protocol === "postgresql:";
    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    const localHost = ["localhost", "127.0.0.1", "::1", "0.0.0.0"].includes(hostname) || hostname.endsWith(".local");
    return protocolOk && !localHost;
  } catch {
    return false;
  }
}

function isExplicitRevenueApproval(value: string | undefined) {
  return value === "true";
}

function textToHtml(text: string) {
  return text
    .split("\n")
    .map((line) => line.trim().length > 0 ? line : "&nbsp;")
    .map((line) => `<p>${line.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>`)
    .join("");
}

async function sendWithResend(payload: RevenueOutreachSendPayload): Promise<RevenueOutreachSendResponse> {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
      "Idempotency-Key": payload.idempotencyKey,
    },
    body: JSON.stringify({
      from: payload.from,
      to: [payload.to],
      subject: payload.subject,
      text: payload.text,
      html: payload.html,
      tags: [
        { name: "system", value: "revenue_engine" },
        { name: "draft_id", value: payload.idempotencyKey.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 256) },
      ],
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof data?.message === "string" ? data.message : `Resend API failed with ${response.status}`;
    throw new Error(message);
  }
  if (typeof data?.id !== "string" || data.id.trim().length === 0) {
    throw new Error("Resend API did not return a message id");
  }
  return { id: data.id };
}

async function sendRevenueOutreachPayload(payload: RevenueOutreachSendPayload) {
  if (revenueOutreachSenderOverride) return revenueOutreachSenderOverride(payload);
  return sendWithResend(payload);
}

function getRevenueAgentRunsPath() {
  return revenueAgentRunsPathOverride || getRevenueEnginePathEnv("REVENUE_ENGINE_AGENT_RUNS_PATH", "agent_runs.json");
}

function getRevenueAutomationOpportunitiesPath() {
  return revenueAutomationOpportunitiesPathOverride || getRevenueEnginePathEnv("REVENUE_ENGINE_AUTOMATION_OPPORTUNITIES_PATH", "automation_opportunities.json");
}

function getRevenueImprovementReviewsPath() {
  return revenueImprovementReviewsPathOverride || getRevenueEnginePathEnv("REVENUE_ENGINE_IMPROVEMENT_REVIEWS_PATH", "improvement_reviews.json");
}

function getRevenueScoutingMissionsPath() {
  return revenueScoutingMissionsPathOverride || getRevenueEnginePathEnv("REVENUE_ENGINE_SCOUTING_MISSIONS_PATH", "scouting_missions.json");
}

function getRevenuePublicLeadCandidatesPath() {
  return revenuePublicLeadCandidatesPathOverride || getRevenueEnginePathEnv("REVENUE_ENGINE_PUBLIC_LEAD_CANDIDATES_PATH", "public_lead_candidates.json");
}

function getRevenueDeliveryWorkspacesPath() {
  return revenueDeliveryWorkspacesPathOverride || getRevenueEnginePathEnv("REVENUE_ENGINE_DELIVERY_WORKSPACES_PATH", "delivery_workspaces.json");
}

function getRevenueApprovalDecisionsPath() {
  return revenueApprovalDecisionsPathOverride || getRevenueEnginePathEnv("REVENUE_ENGINE_APPROVAL_DECISIONS_PATH", "approval_decisions.json");
}

function getRevenueAutomationIntakesPath() {
  return revenueAutomationIntakesPathOverride || getRevenueEnginePathEnv("REVENUE_ENGINE_AUTOMATION_INTAKES_PATH", "automation_intakes.json");
}

function loadRevenueLedger() {
  if (revenueLedgerLoaded) return;
  revenueLedgerLoaded = true;
  const ledgerPath = getRevenueLedgerPath();

  if (!fs.existsSync(ledgerPath)) return;

  try {
    const raw = fs.readFileSync(ledgerPath, "utf8");
    const parsed = z.array(persistedRevenueLedgerEntrySchema).safeParse(JSON.parse(raw));
    if (!parsed.success) {
      revenueLedgerPersistenceError = "Ledger local invalido; no se cargo para evitar metricas incorrectas.";
      return;
    }
    revenueLedger.splice(0, revenueLedger.length, ...parsed.data);
    revenueLedgerPersistenceError = null;
  } catch (error) {
    revenueLedgerPersistenceError = error instanceof Error ? error.message : "No se pudo leer el ledger local.";
  }
}

function loadRevenueLeads() {
  if (revenueLeadsLoaded) return;
  revenueLeadsLoaded = true;
  const leadsPath = getRevenueLeadsPath();

  if (!fs.existsSync(leadsPath)) return;

  try {
    const raw = fs.readFileSync(leadsPath, "utf8");
    const parsed = z.array(persistedRevenueLeadSchema).safeParse(JSON.parse(raw));
    if (!parsed.success) {
      revenueLeadsPersistenceError = "Leads locales invalidos; no se cargaron para evitar pipeline incorrecto.";
      return;
    }
    revenueLeads.splice(0, revenueLeads.length, ...parsed.data);
    revenueLeadsPersistenceError = null;
  } catch (error) {
    revenueLeadsPersistenceError = error instanceof Error ? error.message : "No se pudo leer el archivo local de leads.";
  }
}

function loadRevenueOutreach() {
  if (revenueOutreachLoaded) return;
  revenueOutreachLoaded = true;
  const outreachPath = getRevenueOutreachPath();

  if (!fs.existsSync(outreachPath)) return;

  try {
    const raw = fs.readFileSync(outreachPath, "utf8");
    const parsed = z.array(persistedRevenueOutreachDraftSchema).safeParse(JSON.parse(raw));
    if (!parsed.success) {
      revenueOutreachPersistenceError = "Outreach local invalido; no se cargo para evitar contactos incorrectos.";
      return;
    }
    revenueOutreachDrafts.splice(0, revenueOutreachDrafts.length, ...parsed.data);
    revenueOutreachPersistenceError = null;
  } catch (error) {
    revenueOutreachPersistenceError = error instanceof Error ? error.message : "No se pudo leer el outbox local.";
  }
}

function loadRevenueAgentRuns() {
  if (revenueAgentRunsLoaded) return;
  revenueAgentRunsLoaded = true;
  const agentRunsPath = getRevenueAgentRunsPath();

  if (!fs.existsSync(agentRunsPath)) return;

  try {
    const raw = fs.readFileSync(agentRunsPath, "utf8");
    const parsed = z.array(persistedRevenueAgentRunSchema).safeParse(JSON.parse(raw));
    if (!parsed.success) {
      revenueAgentRunsPersistenceError = "Corridas de agente invalidas; no se cargaron para evitar decisiones incorrectas.";
      return;
    }
    revenueAgentRuns.splice(0, revenueAgentRuns.length, ...parsed.data);
    revenueAgentRunsPersistenceError = null;
  } catch (error) {
    revenueAgentRunsPersistenceError = error instanceof Error ? error.message : "No se pudo leer el archivo local de corridas.";
  }
}

function loadRevenueAutomationOpportunities() {
  if (revenueAutomationOpportunitiesLoaded) return;
  revenueAutomationOpportunitiesLoaded = true;
  const opportunitiesPath = getRevenueAutomationOpportunitiesPath();

  if (!fs.existsSync(opportunitiesPath)) return;

  try {
    const raw = fs.readFileSync(opportunitiesPath, "utf8");
    const parsed = z.array(persistedRevenueAutomationOpportunitySchema).safeParse(JSON.parse(raw));
    if (!parsed.success) {
      revenueAutomationOpportunitiesPersistenceError = "Oportunidades de automatizacion invalidas; no se cargaron.";
      return;
    }
    revenueAutomationOpportunities.splice(0, revenueAutomationOpportunities.length, ...(parsed.data as RevenueAutomationOpportunity[]));
    revenueAutomationOpportunitiesPersistenceError = null;
  } catch (error) {
    revenueAutomationOpportunitiesPersistenceError = error instanceof Error ? error.message : "No se pudo leer oportunidades de automatizacion.";
  }
}

function loadRevenueImprovementReviews() {
  if (revenueImprovementReviewsLoaded) return;
  revenueImprovementReviewsLoaded = true;
  const reviewsPath = getRevenueImprovementReviewsPath();

  if (!fs.existsSync(reviewsPath)) return;

  try {
    const raw = fs.readFileSync(reviewsPath, "utf8");
    const parsed = z.array(persistedRevenueImprovementReviewSchema).safeParse(JSON.parse(raw));
    if (!parsed.success) {
      revenueImprovementReviewsPersistenceError = "Reviews de mejora invalidos; no se cargaron para evitar aprendizajes incorrectos.";
      return;
    }
    revenueImprovementReviews.splice(0, revenueImprovementReviews.length, ...(parsed.data as RevenueImprovementReview[]));
    revenueImprovementReviewsPersistenceError = null;
  } catch (error) {
    revenueImprovementReviewsPersistenceError = error instanceof Error ? error.message : "No se pudo leer reviews de mejora.";
  }
}

function loadRevenueScoutingMissions() {
  if (revenueScoutingMissionsLoaded) return;
  revenueScoutingMissionsLoaded = true;
  const missionsPath = getRevenueScoutingMissionsPath();

  if (!fs.existsSync(missionsPath)) return;

  try {
    const raw = fs.readFileSync(missionsPath, "utf8");
    const parsed = z.array(persistedRevenueScoutingMissionSchema).safeParse(JSON.parse(raw));
    if (!parsed.success) {
      revenueScoutingMissionsPersistenceError = "Misiones de scouting invalidas; no se cargaron.";
      return;
    }
    revenueScoutingMissions.splice(0, revenueScoutingMissions.length, ...(parsed.data as RevenueScoutingMission[]));
    revenueScoutingMissionsPersistenceError = null;
  } catch (error) {
    revenueScoutingMissionsPersistenceError = error instanceof Error ? error.message : "No se pudo leer misiones de scouting.";
  }
}

function loadRevenuePublicLeadCandidates() {
  if (revenuePublicLeadCandidatesLoaded) return;
  revenuePublicLeadCandidatesLoaded = true;
  const candidatesPath = getRevenuePublicLeadCandidatesPath();

  if (!fs.existsSync(candidatesPath)) return;

  try {
    const raw = fs.readFileSync(candidatesPath, "utf8");
    const parsed = z.array(persistedRevenuePublicLeadCandidateSchema).safeParse(JSON.parse(raw));
    if (!parsed.success) {
      revenuePublicLeadCandidatesPersistenceError = "Candidatos publicos invalidos; no se cargaron.";
      return;
    }
    revenuePublicLeadCandidates.splice(0, revenuePublicLeadCandidates.length, ...(parsed.data as RevenuePublicLeadCandidate[]));
    revenuePublicLeadCandidatesPersistenceError = null;
  } catch (error) {
    revenuePublicLeadCandidatesPersistenceError = error instanceof Error ? error.message : "No se pudo leer candidatos publicos.";
  }
}

function loadRevenueDeliveryWorkspaces() {
  if (revenueDeliveryWorkspacesLoaded) return;
  revenueDeliveryWorkspacesLoaded = true;
  const workspacesPath = getRevenueDeliveryWorkspacesPath();

  if (!fs.existsSync(workspacesPath)) return;

  try {
    const raw = fs.readFileSync(workspacesPath, "utf8");
    const parsed = z.array(persistedRevenueDeliveryWorkspaceSchema).safeParse(JSON.parse(raw));
    if (!parsed.success) {
      revenueDeliveryWorkspacesPersistenceError = "Delivery workspaces invalidos; no se cargaron para evitar entregas incorrectas.";
      return;
    }
    revenueDeliveryWorkspaces.splice(0, revenueDeliveryWorkspaces.length, ...(parsed.data as RevenueDeliveryWorkspace[]));
    revenueDeliveryWorkspacesPersistenceError = null;
  } catch (error) {
    revenueDeliveryWorkspacesPersistenceError = error instanceof Error ? error.message : "No se pudo leer delivery workspaces.";
  }
}

function loadRevenueApprovalDecisions() {
  if (revenueApprovalDecisionsLoaded) return;
  revenueApprovalDecisionsLoaded = true;
  const decisionsPath = getRevenueApprovalDecisionsPath();

  if (!fs.existsSync(decisionsPath)) return;

  try {
    const raw = fs.readFileSync(decisionsPath, "utf8");
    const parsed = z.array(persistedRevenueApprovalDecisionSchema).safeParse(JSON.parse(raw));
    if (!parsed.success) {
      revenueApprovalDecisionsPersistenceError = "Approval decisions invalidas; no se cargaron.";
      return;
    }
    revenueApprovalDecisions.splice(0, revenueApprovalDecisions.length, ...parsed.data);
    revenueApprovalDecisionsPersistenceError = null;
  } catch (error) {
    revenueApprovalDecisionsPersistenceError = error instanceof Error ? error.message : "No se pudo leer approval decisions.";
  }
}

function loadRevenueAutomationIntakes() {
  if (revenueAutomationIntakesLoaded) return;
  revenueAutomationIntakesLoaded = true;
  const intakesPath = getRevenueAutomationIntakesPath();

  if (!fs.existsSync(intakesPath)) return;

  try {
    const raw = fs.readFileSync(intakesPath, "utf8");
    const parsed = z.array(persistedRevenueAutomationIntakeSchema).safeParse(JSON.parse(raw));
    if (!parsed.success) {
      revenueAutomationIntakesPersistenceError = "Automation intakes invalidos; no se cargaron.";
      return;
    }
    revenueAutomationIntakes.splice(0, revenueAutomationIntakes.length, ...(parsed.data as RevenueAutomationIntake[]));
    revenueAutomationIntakesPersistenceError = null;
  } catch (error) {
    revenueAutomationIntakesPersistenceError = error instanceof Error ? error.message : "No se pudo leer automation intakes.";
  }
}

function persistRevenueLedger() {
  const ledgerPath = getRevenueLedgerPath();
  try {
    fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
    fs.writeFileSync(ledgerPath, `${JSON.stringify(revenueLedger, null, 2)}\n`, "utf8");
    revenueLedgerPersistenceError = null;
  } catch (error) {
    revenueLedgerPersistenceError = error instanceof Error ? error.message : "No se pudo guardar el ledger local.";
    throw error;
  }
}

function persistRevenueLeads() {
  const leadsPath = getRevenueLeadsPath();
  try {
    fs.mkdirSync(path.dirname(leadsPath), { recursive: true });
    fs.writeFileSync(leadsPath, `${JSON.stringify(revenueLeads, null, 2)}\n`, "utf8");
    revenueLeadsPersistenceError = null;
  } catch (error) {
    revenueLeadsPersistenceError = error instanceof Error ? error.message : "No se pudo guardar el archivo local de leads.";
    throw error;
  }
}

function persistRevenueOutreach() {
  const outreachPath = getRevenueOutreachPath();
  try {
    fs.mkdirSync(path.dirname(outreachPath), { recursive: true });
    fs.writeFileSync(outreachPath, `${JSON.stringify(revenueOutreachDrafts, null, 2)}\n`, "utf8");
    revenueOutreachPersistenceError = null;
  } catch (error) {
    revenueOutreachPersistenceError = error instanceof Error ? error.message : "No se pudo guardar el outbox local.";
    throw error;
  }
}

function persistRevenueAgentRuns() {
  const agentRunsPath = getRevenueAgentRunsPath();
  try {
    fs.mkdirSync(path.dirname(agentRunsPath), { recursive: true });
    fs.writeFileSync(agentRunsPath, `${JSON.stringify(revenueAgentRuns, null, 2)}\n`, "utf8");
    revenueAgentRunsPersistenceError = null;
  } catch (error) {
    revenueAgentRunsPersistenceError = error instanceof Error ? error.message : "No se pudo guardar la corrida de agente.";
    throw error;
  }
}

function persistRevenueAutomationOpportunities() {
  const opportunitiesPath = getRevenueAutomationOpportunitiesPath();
  try {
    fs.mkdirSync(path.dirname(opportunitiesPath), { recursive: true });
    fs.writeFileSync(opportunitiesPath, `${JSON.stringify(revenueAutomationOpportunities, null, 2)}\n`, "utf8");
    revenueAutomationOpportunitiesPersistenceError = null;
  } catch (error) {
    revenueAutomationOpportunitiesPersistenceError = error instanceof Error ? error.message : "No se pudo guardar oportunidad de automatizacion.";
    throw error;
  }
}

function persistRevenueImprovementReviews() {
  const reviewsPath = getRevenueImprovementReviewsPath();
  try {
    fs.mkdirSync(path.dirname(reviewsPath), { recursive: true });
    fs.writeFileSync(reviewsPath, `${JSON.stringify(revenueImprovementReviews, null, 2)}\n`, "utf8");
    revenueImprovementReviewsPersistenceError = null;
  } catch (error) {
    revenueImprovementReviewsPersistenceError = error instanceof Error ? error.message : "No se pudo guardar review de mejora.";
    throw error;
  }
}

function persistRevenueScoutingMissions() {
  const missionsPath = getRevenueScoutingMissionsPath();
  try {
    fs.mkdirSync(path.dirname(missionsPath), { recursive: true });
    fs.writeFileSync(missionsPath, `${JSON.stringify(revenueScoutingMissions, null, 2)}\n`, "utf8");
    revenueScoutingMissionsPersistenceError = null;
  } catch (error) {
    revenueScoutingMissionsPersistenceError = error instanceof Error ? error.message : "No se pudo guardar mision de scouting.";
    throw error;
  }
}

function persistRevenuePublicLeadCandidates() {
  const candidatesPath = getRevenuePublicLeadCandidatesPath();
  try {
    fs.mkdirSync(path.dirname(candidatesPath), { recursive: true });
    fs.writeFileSync(candidatesPath, `${JSON.stringify(revenuePublicLeadCandidates, null, 2)}\n`, "utf8");
    revenuePublicLeadCandidatesPersistenceError = null;
  } catch (error) {
    revenuePublicLeadCandidatesPersistenceError = error instanceof Error ? error.message : "No se pudo guardar candidatos publicos.";
    throw error;
  }
}

function persistRevenueDeliveryWorkspaces() {
  const workspacesPath = getRevenueDeliveryWorkspacesPath();
  try {
    fs.mkdirSync(path.dirname(workspacesPath), { recursive: true });
    fs.writeFileSync(workspacesPath, `${JSON.stringify(revenueDeliveryWorkspaces, null, 2)}\n`, "utf8");
    revenueDeliveryWorkspacesPersistenceError = null;
  } catch (error) {
    revenueDeliveryWorkspacesPersistenceError = error instanceof Error ? error.message : "No se pudo guardar delivery workspace.";
    throw error;
  }
}

function persistRevenueApprovalDecisions() {
  const decisionsPath = getRevenueApprovalDecisionsPath();
  try {
    fs.mkdirSync(path.dirname(decisionsPath), { recursive: true });
    fs.writeFileSync(decisionsPath, `${JSON.stringify(revenueApprovalDecisions, null, 2)}\n`, "utf8");
    revenueApprovalDecisionsPersistenceError = null;
  } catch (error) {
    revenueApprovalDecisionsPersistenceError = error instanceof Error ? error.message : "No se pudo guardar approval decision.";
    throw error;
  }
}

function persistRevenueAutomationIntakes() {
  const intakesPath = getRevenueAutomationIntakesPath();
  try {
    fs.mkdirSync(path.dirname(intakesPath), { recursive: true });
    fs.writeFileSync(intakesPath, `${JSON.stringify(revenueAutomationIntakes, null, 2)}\n`, "utf8");
    revenueAutomationIntakesPersistenceError = null;
  } catch (error) {
    revenueAutomationIntakesPersistenceError = error instanceof Error ? error.message : "No se pudo guardar automation intake.";
    throw error;
  }
}

const agentRoster = [
  {
    id: "growth-director",
    name: "Growth Director",
    role: "Decide nicho, oferta, precios y margen",
    status: "active",
    approvalGate: "Cambia estrategia o precio solo con aprobacion",
  },
  {
    id: "lead-scout",
    name: "Lead Scout",
    role: "Encuentra negocios con senales de no tener website",
    status: "approval_required",
    approvalGate: "No guarda contactos sin evidencia revisable",
  },
  {
    id: "business-researcher",
    name: "Business Researcher",
    role: "Resume negocio, servicios, fotos, reviews y datos publicos",
    status: "ready",
    approvalGate: "Marca datos inciertos antes de usarlos",
  },
  {
    id: "mockup-builder",
    name: "Mockup Builder",
    role: "Arma website dinamico, 3D y comparables por industria",
    status: "ready",
    approvalGate: "No publica ni envia preview sin QA",
  },
  {
    id: "automation-architect",
    name: "Automation Architect",
    role: "Convierte pedidos del cliente en automatizaciones vendibles",
    status: "ready",
    approvalGate: "Estima costo mensual antes de prometer entregas",
  },
  {
    id: "closer",
    name: "Closer",
    role: "Prepara mensajes, seguimiento, propuesta y cierre",
    status: "approval_required",
    approvalGate: "Todo contacto externo queda en draft hasta aprobar",
  },
  {
    id: "qa-council",
    name: "QA Council",
    role: "Revisa copy, links, evidencia, margen, legalidad y entrega",
    status: "active",
    approvalGate: "Bloquea envios con datos flojos o gasto fuera de cap",
  },
];

function isSaleEntry(entry: RevenueLedgerEntry) {
  return entry.kind === "website_sale" || entry.kind === "automation_sale" || entry.kind === "bundle_sale" || entry.kind === "retainer";
}

function buildPipelineStages(entries: RevenueLedgerEntry[], leads: RevenueLead[]) {
  const sales = entries.filter(isSaleEntry);
  const closedValueUsd = sales.reduce((total, entry) => total + entry.amountUsd, 0);
  const valueFor = (statuses: RevenueLead["status"][]) =>
    leads.filter((lead) => statuses.includes(lead.status)).reduce((total, lead) => total + lead.estimatedOfferUsd, 0);
  const countFor = (statuses: RevenueLead["status"][]) => leads.filter((lead) => statuses.includes(lead.status)).length;

  return [
    { id: "lead_research", name: "Research", count: countFor(["research"]), valueUsd: valueFor(["research"]) },
    { id: "qualified", name: "Calificados", count: countFor(["qualified"]), valueUsd: valueFor(["qualified"]) },
    { id: "mockup", name: "Mockup", count: countFor(["mockup_ready"]), valueUsd: valueFor(["mockup_ready"]) },
    { id: "outreach", name: "Outreach", count: countFor(["outreach_ready", "contacted"]), valueUsd: valueFor(["outreach_ready", "contacted"]) },
    { id: "proposal", name: "Propuesta", count: countFor(["proposal_sent"]), valueUsd: valueFor(["proposal_sent"]) },
    { id: "closed", name: "Cerrados", count: sales.length, valueUsd: closedValueUsd },
  ];
}

const packages = [
  {
    id: "website-starter",
    name: "Website Starter",
    priceUsd: 1500,
    recurringUsd: 79,
    marginTarget: "80%+",
    delivery: "3-5 dias",
    includes: ["One-page premium", "Copy local", "Formulario", "Hosting handoff"],
  },
  {
    id: "website-3d",
    name: "Website 3D Premium",
    priceUsd: 3500,
    recurringUsd: 149,
    marginTarget: "75%+",
    delivery: "7-10 dias",
    includes: ["Hero 3D", "Galeria dinamica", "SEO local", "Analytics"],
  },
  {
    id: "automation-sprint",
    name: "Automation Sprint",
    priceUsd: 2500,
    recurringUsd: 300,
    marginTarget: "70%+",
    delivery: "7 dias",
    includes: ["Intake", "CRM/simple ops", "Mensajes", "Dashboard"],
  },
  {
    id: "growth-retainer",
    name: "Growth Retainer",
    priceUsd: 1000,
    recurringUsd: 1000,
    marginTarget: "65%+",
    delivery: "mensual",
    includes: ["Mejoras", "A/B tests", "Reportes", "Automations ligeras"],
  },
];

function buildRevenueProfitGuard({
  cashCollectedUsd,
  estimatedSpendUsd,
  profitUsd,
  approvalQueue,
}: {
  cashCollectedUsd: number;
  estimatedSpendUsd: number;
  profitUsd: number;
  approvalQueue: number;
}) {
  const remainingCapUsd = Math.max(0, 100 - estimatedSpendUsd);
  const cashCoverageUsd = cashCollectedUsd - estimatedSpendUsd;
  const status =
    estimatedSpendUsd >= 100 || estimatedSpendUsd > cashCollectedUsd
      ? "pause_spend"
      : cashCollectedUsd <= 0
        ? "collect_first"
        : approvalQueue > 0
          ? "review_queue"
          : "scale_carefully";

  return {
    status,
    monthlyCapUsd: 100,
    estimatedSpendUsd,
    remainingCapUsd,
    cashCollectedUsd,
    cashCoverageUsd,
    profitUsd,
    canSpendUsd: status === "scale_carefully" ? Math.min(remainingCapUsd, Math.max(0, cashCoverageUsd)) : 0,
    reason:
      status === "pause_spend"
        ? "Pausar gasto: el spend llego al cap o supera el cash cobrado."
        : status === "collect_first"
          ? "Cobrar primero: todavia no hay cash cobrado para financiar gasto externo."
          : status === "review_queue"
            ? "Hay aprobaciones pendientes antes de escalar gasto/contacto."
            : "Puede escalar con batch pequeno, sin pasar el cap y manteniendo aprobacion humana.",
    requiredActions:
      status === "pause_spend"
        ? ["pausar gasto pagado", "cobrar deposito o retainer", "reducir herramientas/costo mensual"]
        : status === "collect_first"
          ? ["vender en draft/manual", "cobrar deposito", "mantener research gratis"]
          : status === "review_queue"
            ? ["resolver aprobaciones pendientes", "revisar outbox/QA", "confirmar evidencia y margen"]
            : ["mantener batch pequeno", "registrar cash/costo en ledger", "revisar aprendizaje semanal"],
  };
}

function buildRevenueNextBatchPlan(input: {
  profitGuard: ReturnType<typeof buildRevenueProfitGuard>;
  latestReview?: RevenueImprovementReview;
  approvalQueue: number;
}) {
  const latestReview = input.latestReview;
  const hasRevenueProof = input.profitGuard.cashCollectedUsd > 0 && input.profitGuard.profitUsd >= 0;
  const qualityBlocked = Boolean(latestReview && (latestReview.input.defectsFound >= 3 || latestReview.input.clientComplaints > 0));
  const reviewPaused = latestReview?.decisionStatus === "pause_and_fix";
  const canSpendUsd = Math.max(0, Math.min(100, input.profitGuard.canSpendUsd));
  const maxSpendUsd =
    qualityBlocked || reviewPaused || input.profitGuard.status === "pause_spend"
      ? 0
      : input.profitGuard.status === "collect_first"
        ? 0
        : latestReview?.decisionStatus === "scale_carefully"
          ? Math.min(canSpendUsd, latestReview.nextBatch.maxSpendUsd)
          : Math.min(canSpendUsd, 10);
  const status =
    qualityBlocked || reviewPaused || input.profitGuard.status === "pause_spend"
      ? "pause" as const
      : input.profitGuard.status === "collect_first"
        ? "collect_first" as const
        : latestReview?.decisionStatus === "scale_carefully" && hasRevenueProof
          ? "scale_carefully" as const
          : "iterate_small_batch" as const;
  const maxLeads =
    status === "scale_carefully"
      ? Math.min(25, latestReview?.nextBatch.maxLeads || 25)
      : status === "iterate_small_batch"
        ? 10
        : 0;

  return {
    status,
    maxLeads,
    maxSpendUsd,
    reason:
      status === "pause"
        ? "Pausar siguiente batch hasta resolver QA, costo, quejas o gasto bloqueado."
        : status === "collect_first"
          ? "Cobrar deposito/cash primero; solo research gratis y drafts internos."
          : status === "scale_carefully"
            ? "Hay prueba de cash/profit; escalar en batch pequeno sin pasar cap ni aprobaciones."
            : "Iterar con batch pequeno porque todavia falta prueba fuerte de ROI.",
    requiredBeforeNextAction: [
      status === "collect_first" && "cobrar deposito antes de gastar",
      status === "pause" && "resolver bloqueos QA/costo antes de contactar",
      input.approvalQueue > 0 && "limpiar approval queue",
      "aprobar mensaje antes de enviar",
      "guardar resultado y objecion despues del batch",
    ].filter(Boolean) as string[],
    allowedActions:
      status === "collect_first"
        ? ["research publico gratis", "mockup/draft interno", "pedir deposito"]
        : status === "pause"
          ? ["corregir QA", "bajar costo", "revisar oferta"]
          : ["contactar batch aprobado", "guardar metricas", "crear review semanal"],
    latestReviewId: latestReview?.id || "",
  };
}

function buildRevenueExecutiveSummary(input: {
  appsSold: number;
  automationsSold: number;
  revenueUsd: number;
  cashCollectedUsd: number;
  estimatedSpendUsd: number;
  profitUsd: number;
  approvalQueue: number;
  profitGuard: ReturnType<typeof buildRevenueProfitGuard>;
  nextBatchPlan: ReturnType<typeof buildRevenueNextBatchPlan>;
}) {
  const totalProductsSold = input.appsSold + input.automationsSold;
  const collectionRatePercent = input.revenueUsd > 0 ? Math.round((input.cashCollectedUsd / input.revenueUsd) * 100) : 0;
  const profitMarginPercent = input.cashCollectedUsd > 0 ? Math.round((input.profitUsd / input.cashCollectedUsd) * 100) : 0;
  const status =
    input.profitGuard.status === "pause_spend" || input.nextBatchPlan.status === "pause"
      ? "blocked" as const
      : input.profitGuard.status === "collect_first"
        ? "collect_first" as const
        : input.approvalQueue > 0
          ? "needs_approval" as const
          : "ready" as const;

  return {
    status,
    headline:
      totalProductsSold === 0
        ? "Todavia no hay ventas registradas; operar en modo draft y cobrar deposito primero."
        : `${input.appsSold} apps/websites y ${input.automationsSold} automatizaciones vendidas; cash cobrado ${input.cashCollectedUsd.toLocaleString("en-US")} USD.`,
    appsSold: input.appsSold,
    automationsSold: input.automationsSold,
    totalProductsSold,
    revenueUsd: input.revenueUsd,
    cashCollectedUsd: input.cashCollectedUsd,
    estimatedSpendUsd: input.estimatedSpendUsd,
    profitUsd: input.profitUsd,
    collectionRatePercent,
    profitMarginPercent,
    approvalQueue: input.approvalQueue,
    nextFocus:
      status === "blocked"
        ? "Resolver bloqueos antes de gastar, contactar o entregar."
        : status === "collect_first"
          ? "Cerrar deposito/cash antes de cualquier gasto externo."
          : status === "needs_approval"
            ? "Limpiar approval queue y aprobar solo acciones rentables."
            : "Ejecutar el siguiente batch pequeno dentro del cap.",
  };
}

function buildRevenueAgentOperatingContract(input: {
  profitGuard: ReturnType<typeof buildRevenueProfitGuard>;
  nextBatchPlan: ReturnType<typeof buildRevenueNextBatchPlan>;
  approvalQueue: number;
}) {
  const mode =
    input.profitGuard.status === "pause_spend" || input.nextBatchPlan.status === "pause"
      ? "correction_only" as const
      : input.profitGuard.status === "collect_first"
        ? "draft_only" as const
        : input.approvalQueue > 0
          ? "approval_queue" as const
          : "controlled_autopilot" as const;

  return {
    mode,
    mainAgent: "growth-director",
    canRunAutonomously:
      mode === "correction_only"
        ? ["corregir QA", "reducir costo", "preparar drafts internos"]
        : mode === "draft_only"
          ? ["research publico gratis", "mockup interno", "cotizacion en draft", "pedir deposito"]
          : mode === "approval_queue"
            ? ["organizar approvals", "preparar correcciones", "actualizar resumen ejecutivo"]
            : ["research publico", "batch aprobado", "drafts", "QA", "review semanal"],
    requiresHumanApproval: [
      "contactar negocio externo",
      "enviar email/DM/formulario",
      "gastar dinero",
      "comprar data",
      "publicar mockup",
      "activar automatizacion",
      "cobrar cliente",
    ],
    blockedActions:
      mode === "controlled_autopilot"
        ? []
        : ["contacto externo", "gasto externo", "launch", "automatizacion en vivo"],
    currentInstruction:
      mode === "correction_only"
        ? "Solo corregir bloqueos; no vender, gastar, contactar ni lanzar."
        : mode === "draft_only"
          ? "Preparar venta en draft y cobrar deposito antes de gastar."
          : mode === "approval_queue"
            ? "Resolver approvals antes de avanzar el siguiente batch."
      : "Ejecutar batch pequeno aprobado y registrar resultados.",
  };
}

function buildRevenueOperatorConsole(input: {
  appsSold: number;
  automationsSold: number;
  revenueUsd: number;
  cashCollectedUsd: number;
  estimatedSpendUsd: number;
  profitUsd: number;
  approvalQueue: number;
  executiveSummary: ReturnType<typeof buildRevenueExecutiveSummary>;
  profitGuard: ReturnType<typeof buildRevenueProfitGuard>;
  nextBatchPlan: ReturnType<typeof buildRevenueNextBatchPlan>;
  agentOperatingContract: ReturnType<typeof buildRevenueAgentOperatingContract>;
}) {
  const canSpendNow = input.profitGuard.canSpendUsd > 0 && input.agentOperatingContract.mode === "controlled_autopilot";
  const nextCommand =
    input.executiveSummary.status === "blocked"
      ? "Resolver bloqueos de QA/costo antes de contactar, gastar o entregar."
      : input.executiveSummary.status === "collect_first"
        ? "Vender en draft y cobrar deposito antes de cualquier gasto externo."
        : input.executiveSummary.status === "needs_approval"
          ? "Revisar approval queue y aprobar solo el siguiente paso rentable."
          : input.nextBatchPlan.status === "scale_carefully"
            ? `Contactar hasta ${input.nextBatchPlan.maxLeads} leads aprobados con gasto maximo ${input.nextBatchPlan.maxSpendUsd} USD.`
            : "Iterar con batch pequeno, guardar metricas y no pasar el cap.";

  return {
    moneyLine: `${input.appsSold} apps/websites, ${input.automationsSold} automatizaciones, ${input.cashCollectedUsd.toLocaleString("en-US")} USD cash, ${input.profitUsd.toLocaleString("en-US")} USD profit.`,
    nextCommand,
    canSpendNow,
    spendPermission: canSpendNow
      ? `Puede gastar hasta ${input.profitGuard.canSpendUsd} USD dentro del cap y con batch aprobado.`
      : "No gastar ahora: requiere cash, aprobacion limpia o resolver bloqueos.",
    allowedNow: input.agentOperatingContract.canRunAutonomously.slice(0, 4),
    waitingOnRobert:
      input.approvalQueue > 0
        ? ["revisar approval queue", ...input.nextBatchPlan.requiredBeforeNextAction].slice(0, 4)
        : input.agentOperatingContract.requiresHumanApproval.slice(0, 3),
    blockedNow: input.agentOperatingContract.blockedActions,
    scoreboard: {
      appsSold: input.appsSold,
      automationsSold: input.automationsSold,
      revenueUsd: input.revenueUsd,
      cashCollectedUsd: input.cashCollectedUsd,
      estimatedSpendUsd: input.estimatedSpendUsd,
      profitUsd: input.profitUsd,
      approvalQueue: input.approvalQueue,
    },
  };
}

function buildRevenueSystemReadiness(input: {
  appsSold: number;
  automationsSold: number;
  cashCollectedUsd: number;
  estimatedSpendUsd: number;
  approvalQueue: number;
  profitGuard: ReturnType<typeof buildRevenueProfitGuard>;
  nextBatchPlan: ReturnType<typeof buildRevenueNextBatchPlan>;
  agentOperatingContract: ReturnType<typeof buildRevenueAgentOperatingContract>;
}) {
  const items = [
    {
      id: "separate_area",
      label: "Area aparte en el app",
      status: "ready" as const,
      evidence: "Ruta /revenue-engine con UI propia, tabs, snapshot y consola Robert.",
      nextStep: "Mantenerla separada de Tools/Agents Office salvo accesos directos.",
    },
    {
      id: "ask_when_unclear",
      label: "Pregunta si no entiende",
      status: "ready" as const,
      evidence: "Automation intakes guardan missingAnswers, nextQuestions, answerTemplate y bloqueos.",
      nextStep: "Usar la plantilla antes de cotizar o construir pedidos vagos.",
    },
    {
      id: "sell_automations",
      label: "Vender automatizaciones",
      status: "ready" as const,
      evidence: "Automation quote, intake, opportunity, close-to-ledger y delivery workspace conectados.",
      nextStep: "Convertir intakes listos en oportunidades y cobrar deposito.",
    },
    {
      id: "main_agent_subagents",
      label: "Agente principal + subagentes",
      status: "ready" as const,
      evidence: "Growth Director coordina work order; QA Council, Cost Controller, Closer y Automation Architect corrigen/bloquean.",
      nextStep: "Revisar subagentReviews antes de cualquier contacto externo.",
    },
    {
      id: "delivery_quality",
      label: "Checks para entregar perfecto",
      status: "ready" as const,
      evidence: "Delivery workspaces bloquean por deposito, scope, QA visual/tecnica/automation, rollback, costo y margen.",
      nextStep: "Entregar solo cuando canLaunch=true y Robert apruebe.",
    },
    {
      id: "continuous_improvement",
      label: "Mejorar cada vez",
      status: input.nextBatchPlan.latestReviewId ? "ready" as const : "needs_data" as const,
      evidence: input.nextBatchPlan.latestReviewId
        ? `Ultima review: ${input.nextBatchPlan.latestReviewId}.`
        : "Improvement reviews existen, pero falta una review real para alimentar el siguiente batch.",
      nextStep: "Crear review semanal o post-delivery con metricas reales.",
    },
    {
      id: "under_100_monthly",
      label: "Menos de $100/mes al empezar",
      status: input.estimatedSpendUsd <= 100 ? "ready" as const : "blocked" as const,
      evidence: `Gasto estimado actual: ${input.estimatedSpendUsd} USD de 100 USD.`,
      nextStep: input.estimatedSpendUsd <= 100 ? "Seguir usando Profit Guard antes de gastar." : "Bajar herramientas/costos antes de avanzar.",
    },
    {
      id: "dont_spend_more_than_cash",
      label: "No gastar mas de lo cobrado",
      status: input.estimatedSpendUsd <= input.cashCollectedUsd ? "ready" as const : "blocked" as const,
      evidence: `Cash cobrado ${input.cashCollectedUsd} USD vs gasto ${input.estimatedSpendUsd} USD.`,
      nextStep: input.estimatedSpendUsd <= input.cashCollectedUsd ? "Registrar cada venta/gasto en ledger." : "Cobrar deposito o pausar gasto externo.",
    },
    {
      id: "robert_money_visibility",
      label: "Robert ve apps y dinero",
      status: "ready" as const,
      evidence: `${input.appsSold} apps/websites, ${input.automationsSold} automatizaciones, cash ${input.cashCollectedUsd} USD.`,
      nextStep: "Usar Consola Robert y Ledger como vista ejecutiva.",
    },
    {
      id: "controlled_autonomy",
      label: "Autonomia controlada",
      status: input.agentOperatingContract.mode === "controlled_autopilot" ? "ready" as const : input.approvalQueue > 0 ? "needs_approval" as const : "needs_data" as const,
      evidence: `Modo actual: ${input.agentOperatingContract.mode}. Profit Guard: ${input.profitGuard.status}.`,
      nextStep: input.agentOperatingContract.currentInstruction,
    },
  ];
  const ready = items.filter((item) => item.status === "ready").length;
  const blocked = items.filter((item) => item.status === "blocked").length;
  const needsApproval = items.filter((item) => item.status === "needs_approval").length;
  const needsData = items.filter((item) => item.status === "needs_data").length;

  return {
    score: Math.round((ready / items.length) * 100),
    ready,
    blocked,
    needsApproval,
    needsData,
    summary:
      blocked > 0
        ? "Hay bloqueos de costo/cash antes de operar."
        : needsApproval > 0
          ? "El sistema esta armado, pero espera aprobaciones para avanzar."
          : needsData > 0
            ? "La arquitectura esta lista; falta data real para mejorar/escala."
            : "Sistema operativo listo para batch controlado.",
    items,
  };
}

export function buildRevenueScoutingMission(input: RevenueScoutingMissionInput) {
  const parsed = revenueScoutingMissionSchema.parse(input);
  const paidSpendUsd = Math.min(parsed.maxPaidDataSpendUsd, 100);
  const isFreeMode = paidSpendUsd === 0;
  const leadBatchSize = Math.min(parsed.targetLeadCount, paidSpendUsd > 0 ? 50 : 25);
  const websiteSignals = [
    parsed.requireNoWebsiteSignal && "no website listed on Google/Instagram/Facebook profile",
    parsed.requireNoWebsiteSignal && "\"website\" field empty or pointing only to social profile",
    parsed.includeWeakWebsiteLeads && "website is broken, outdated, non-mobile or missing clear CTA",
    parsed.includeWeakWebsiteLeads && "menu/services/pricing only shown in posts or images",
  ].filter((item): item is string => Boolean(item));
  const offerSignals =
    parsed.offerFocus === "automations"
      ? ["manual booking/intake", "missed calls or DMs", "repeated follow-up", "spreadsheet/DM workflow"]
      : parsed.offerFocus === "websites"
        ? ["no booking/contact funnel", "poor mobile presence", "no landing page for high-ticket service", "weak local SEO"]
        : ["weak web presence plus repeatable lead/customer workflow", "no follow-up system after inquiry", "no dashboard for owner"];

  return {
    mission: {
      name: `${parsed.area} ${parsed.niche} scouting`,
      area: parsed.area,
      niche: parsed.niche,
      offerFocus: parsed.offerFocus,
      targetLeadCount: parsed.targetLeadCount,
      leadBatchSize,
      mode: isFreeMode ? "free_public_research" : "paid_data_requires_approval",
    },
    budgetGate: {
      monthlyCapUsd: 100,
      requestedPaidDataSpendUsd: parsed.maxPaidDataSpendUsd,
      approvedPaidDataSpendUsd: paidSpendUsd,
      requiresApprovalToSpend: paidSpendUsd > 0,
      allowedBeforeApproval: ["Google search", "Google Maps manual review", "Instagram profile review", "public website/social evidence"],
      blockedBeforeApproval: ["buy data", "send email", "send DM", "submit contact form", "publish mockup"],
    },
    searchQueries: [
      `${parsed.niche} in ${parsed.area} no website`,
      `${parsed.niche} ${parsed.area} instagram`,
      `${parsed.niche} ${parsed.area} facebook`,
      `"${parsed.niche}" "${parsed.area}" "contact"`,
      `"${parsed.niche}" "${parsed.area}" "booking"`,
      `${parsed.niche} near ${parsed.area} site:instagram.com`,
    ],
    leadEvidenceChecklist: [
      "Business name, area and niche captured exactly from public source.",
      "Website status marked no_website, weak_website, has_website or unknown with evidence.",
      "At least one contact path exists, but no contact happens before approval.",
      "Pain point is tied to public evidence, not guessed.",
      "Offer value is at least $1,500 setup or has recurring automation potential.",
    ],
    qualificationScorecard: [
      { item: "No website or weak website signal", maxPoints: 35, signals: websiteSignals },
      { item: "Verifiable contact path", maxPoints: 25, signals: ["email", "contact form", "Instagram", "phone"] },
      { item: "Public evidence quality", maxPoints: 20, signals: ["profile", "reviews", "posts", "listing", "existing site"] },
      { item: "Pain/revenue opportunity", maxPoints: 10, signals: offerSignals },
      { item: "Minimum profitable offer", maxPoints: 10, signals: ["website >= $1,500", "automation >= $1,500", "retainer >= $300/mo"] },
    ],
    subagentReviews: [
      { agent: "lead-scout", check: "Finds candidates and records public evidence only." },
      { agent: "business-researcher", check: "Verifies business info and marks uncertain data." },
      { agent: "mockup-builder", check: "Creates mockup brief only after evidence passes." },
      { agent: "automation-architect", check: "Identifies workflow automation upsell and internal monthly cost." },
      { agent: "qa-council", check: "Blocks outreach if evidence/contact/cost approval is missing." },
    ],
    nextActions: [
      `Research ${leadBatchSize} ${parsed.niche} leads in ${parsed.area}.`,
      "Record only leads with evidence into /api/revenue-engine/leads.",
      "Generate mockup for A/B leads before outreach.",
      "Create outreach draft, keep it draft until Robert approves.",
      "Review batch results in improvement memory before scaling.",
    ],
  };
}

export function buildRevenueLeadRadar(input: RevenueLeadRadarInput) {
  const parsed = revenueLeadRadarSchema.parse(input);
  const niches = parsed.niches
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 8);
  const safeNiches = niches.length ? niches : ["med spas"];
  const paidSpendUsd = Math.min(parsed.maxPaidDataSpendUsd, 100);
  const researchPerHour = Math.max(1, Math.ceil(parsed.dailyResearchTarget / parsed.runHoursPerDay));
  const qualifiedPerHour = Math.max(1, Math.ceil(parsed.dailyQualifiedLeadLimit / parsed.runHoursPerDay));
  const mockupCadenceHours = Math.max(1, Math.ceil(parsed.runHoursPerDay / parsed.dailyMockupLimit));
  const contactCadenceHours = parsed.dailyContactLimit > 0 ? Math.max(1, Math.ceil(parsed.runHoursPerDay / parsed.dailyContactLimit)) : 24;
  const contactMode = parsed.requireRobertApprovalToContact || parsed.dailyContactLimit === 0 ? "draft_only" as const : "approved_queue_only" as const;
  const status = paidSpendUsd > 0 ? "needs_spend_approval" as const : "always_on_ready" as const;
  const channelMix = [
    {
      channel: "Google Maps manual/public search",
      priority: 1,
      reason: "Mejor senal local para negocios sin website, telefono/listing y reviews.",
      costUsd: 0,
    },
    {
      channel: "Instagram bio + recent posts",
      priority: 2,
      reason: "Detecta negocios activos con solo social profile y dolores visuales claros.",
      costUsd: 0,
    },
    {
      channel: "Industry directories/Yelp/Facebook public pages",
      priority: 3,
      reason: "Completa telefono, categoria, fotos, reviews y website status.",
      costUsd: 0,
    },
    {
      channel: "Paid lead/data tools",
      priority: 4,
      reason: "Usar solo cuando el cash cobrado y Robert aprueben; no al inicio.",
      costUsd: paidSpendUsd,
    },
  ];
  const searchRotations = safeNiches.flatMap((niche) => [
    `${niche} ${parsed.area} no website`,
    `${niche} ${parsed.area} instagram booking`,
    `${niche} ${parsed.area} google maps`,
    `"${niche}" "${parsed.area}" "book now"`,
    `${niche} near ${parsed.area} site:instagram.com`,
  ]).slice(0, 30);

  return {
    input: parsed,
    status,
    operatingMode: {
      name: "24/7 lead radar",
      researchRunsAllDay: true,
      contactMode,
      spendMode: paidSpendUsd > 0 ? "approval_required" : "free_public_research",
      mockupOwner: "Codex/mockup-builder",
      nextHumanDecision: contactMode === "draft_only" ? "Robert aprueba contacto y envio." : "Robert revisa cola aprobada antes de envio masivo.",
    },
    dailyLimits: {
      runHoursPerDay: parsed.runHoursPerDay,
      researchTarget: parsed.dailyResearchTarget,
      researchPerHour,
      qualifiedLeadLimit: parsed.dailyQualifiedLeadLimit,
      qualifiedPerHour,
      mockupLimit: parsed.dailyMockupLimit,
      mockupCadenceHours,
      contactLimit: parsed.dailyContactLimit,
      contactCadenceHours,
      monthlySpendCapUsd: 100,
      approvedPaidDataSpendUsd: paidSpendUsd,
    },
    lanes: [
      {
        lane: "discover",
        ownerAgent: "lead-scout",
        runs: "24/7",
        output: "candidatos con nombre, fuente publica, website status y contacto posible",
        blockedActions: ["contactar", "comprar data", "prometer precio"],
      },
      {
        lane: "qualify",
        ownerAgent: "business-researcher",
        runs: "cada hora",
        output: "A/B/C score con evidencia, pain point y oferta minima",
        blockedActions: ["inventar claims", "usar datos no verificados"],
      },
      {
        lane: "mockup",
        ownerAgent: "mockup-builder",
        runs: `cada ${mockupCadenceHours}h o cuando haya lead A`,
        output: "brief de mockup website/automation listo para construir por Codex",
        blockedActions: ["publicar preview", "enviar al cliente sin aprobacion"],
      },
      {
        lane: "outreach",
        ownerAgent: "closer",
        runs: `max ${parsed.dailyContactLimit}/dia`,
        output: "draft personalizado con mockup/comparables",
        blockedActions: ["email/DM sin aprobacion", "contactar mas del limite diario"],
      },
      {
        lane: "learn",
        ownerAgent: "growth-director",
        runs: "diario + semanal",
        output: "objeciones, replies, calls, deals, costo y mejoras del playbook",
        blockedActions: ["escalar gasto si no hay cash cobrado"],
      },
    ],
    channelMix,
    searchRotations,
    qualificationRules: [
      "Prioridad A: no website o website roto + contacto verificable + evidencia publica + oferta >= $1,500.",
      "Prioridad B: website debil + proceso manual visible + automatizacion clara.",
      "Descartar: negocios sin contacto verificable, evidencia pobre o ticket demasiado bajo.",
      "No contacto externo hasta draft aprobado; research y mockup interno si pueden correr 24/7.",
    ],
    mockupPolicy: {
      whoCreatesMockups: "Codex crea mockups/briefs cuando el lead tenga evidencia A/B.",
      requiredBeforeMockup: ["businessName", "area", "niche", "websiteStatus", "public evidence", "painPoint"],
      maxPerDay: parsed.dailyMockupLimit,
      qualityBar: "Cada mockup debe tener oferta, CTA, prueba publica, automatizacion vendible y costo interno <= $100/mes.",
    },
    recommendation:
      "Buscar leads puede correr 24/7. Lo que debe tener limite es contacto externo, mockups finales y gasto: ahi esta la calidad, reputacion y rentabilidad.",
    nextActions: [
      `Correr radar gratis para ${safeNiches.join(", ")} en ${parsed.area}.`,
      `Guardar hasta ${parsed.dailyQualifiedLeadLimit} leads calificados/dia.`,
      `Crear max ${parsed.dailyMockupLimit} mockups/dia con evidencia fuerte.`,
      `Contactar max ${parsed.dailyContactLimit}/dia solo con aprobacion.`,
      "Revisar resultados semanalmente antes de subir limites.",
    ],
  };
}

export function recordRevenueScoutingMission(input: RevenueScoutingMissionInput) {
  loadRevenueScoutingMissions();
  const mission = buildRevenueScoutingMission(input);
  const now = new Date().toISOString();
  const persisted: RevenueScoutingMission = {
    ...mission,
    id: `scouting-${Date.now()}-${revenueScoutingMissions.length + 1}`,
    createdAt: now,
    updatedAt: now,
    status: mission.budgetGate.requiresApprovalToSpend ? "planned" : "ready_for_leads",
    learningNote:
      mission.budgetGate.requiresApprovalToSpend
        ? `Pedir aprobacion antes de gastar ${mission.budgetGate.approvedPaidDataSpendUsd} en data para ${mission.mission.niche} en ${mission.mission.area}.`
        : `Usar research publico gratis para ${mission.mission.leadBatchSize} leads de ${mission.mission.niche} en ${mission.mission.area}.`,
  };

  revenueScoutingMissions.push(persisted);
  persistRevenueScoutingMissions();

  return {
    mission: persisted,
    snapshot: getRevenueEngineSnapshot(),
  };
}

function recordRevenueApprovalDecisionInternal(input: RevenueApprovalDecisionInput, options: { allowTrustedApprovalSource: boolean }) {
  loadRevenueApprovalDecisions();
  const rawParsed = revenueApprovalDecisionSchema.parse(input);
  const parsed = options.allowTrustedApprovalSource
    ? rawParsed
    : {
      ...rawParsed,
      approvalSource: "generic" as const,
      publicCandidateSnapshotHash: "",
      outreachDraftSnapshotHash: "",
      websiteCreationSnapshotHash: "",
      websitePublishSnapshotHash: "",
      paymentPathSnapshotHash: "",
      contactPathSnapshotHash: "",
      ledgerEntrySnapshotHash: "",
    };
  const snapshot = getRevenueEngineSnapshot();
  const spendBlocked = parsed.maxSpendUsd > 100 || (parsed.maxSpendUsd > 0 && snapshot.profitGuard.status !== "scale_carefully");
  const guardrail = {
    status: spendBlocked ? "blocked" as const : "recorded" as const,
    reason: spendBlocked
      ? "No se puede aprobar gasto: supera $100 o Profit Guard no permite spend ahora."
      : "Decision humana registrada; el agente puede usarla como memoria operativa sin saltarse QA.",
  };
  const decision: RevenueApprovalDecision = {
    ...parsed,
    id: `approval-${Date.now()}-${revenueApprovalDecisions.length + 1}`,
    createdAt: new Date().toISOString(),
    guardrail,
  };

  revenueApprovalDecisions.push(decision);
  persistRevenueApprovalDecisions();

  return {
    decision,
    snapshot: getRevenueEngineSnapshot(),
  };
}

export function recordRevenueApprovalDecision(input: RevenueApprovalDecisionInput) {
  return recordRevenueApprovalDecisionInternal(input, { allowTrustedApprovalSource: false });
}

export function recordRevenueTrustedApprovalDecision(input: RevenueApprovalDecisionInput) {
  return recordRevenueApprovalDecisionInternal(input, { allowTrustedApprovalSource: true });
}

export function listRevenueApprovalDecisions() {
  loadRevenueApprovalDecisions();
  return [...revenueApprovalDecisions];
}

function buildAutomationIntakeAnswerTemplate(questions: string[], missingAnswers: string[]) {
  const base = questions.length
    ? questions
    : [
        "Que evento inicia el flujo: nuevo lead, formulario, DM, llamada, pago, reserva u otra cosa?",
        "Donde vive hoy la informacion: Google Sheets, CRM, email, Instagram, WhatsApp, POS u otra herramienta?",
        "Que resultado quieres venderle al cliente: mas reservas, mas leads respondidos, menos trabajo manual, reportes o cobros?",
      ];

  return [
    "Respuesta minima para poder cotizar/construir:",
    ...base.slice(0, 5).map((question, index) => `${index + 1}. ${question} Respuesta: ____`),
    missingAnswers.length ? `Falta aclarar: ${missingAnswers.join(", ")}.` : "Si algo no aplica, escribir 'no aplica' y explicar por que.",
  ].join("\n");
}

export function recordRevenueAutomationIntake(input: RevenueAutomationIntakeInput) {
  loadRevenueAutomationIntakes();
  const parsed = revenueAutomationIntakeSchema.parse(input);
  const quote = buildAutomationQuote(parsed);
  const hasEnoughAnswers = parsed.knownAnswers.trim().length >= 40;
  const status: RevenueAutomationIntake["status"] =
    quote.clarificationGate.status === "clear" || hasEnoughAnswers ? "ready_for_quote" : "needs_answers";
  const missingAnswers = status === "ready_for_quote" ? [] : quote.clarificationGate.missing;
  const nextQuestions = status === "ready_for_quote" ? [] : quote.clarifyingQuestions;
  const now = new Date().toISOString();
  const intake: RevenueAutomationIntake = {
    ...parsed,
    id: `automation-intake-${Date.now()}-${revenueAutomationIntakes.length + 1}`,
    createdAt: now,
    updatedAt: now,
    status,
    quote,
    missingAnswers,
    nextQuestions,
    answerTemplate: buildAutomationIntakeAnswerTemplate(nextQuestions, missingAnswers),
    blockedUntilAnswered: status === "ready_for_quote" ? [] : quote.clarificationGate.blocks,
    nextAction:
      status === "ready_for_quote"
        ? "Crear oportunidad/cotizacion y pedir aprobacion de scope/deposito."
        : "Hacer preguntas de aclaracion antes de prometer precio, build o delivery.",
  };

  revenueAutomationIntakes.push(intake);
  persistRevenueAutomationIntakes();

  return {
    intake,
    snapshot: getRevenueEngineSnapshot(),
  };
}

export function answerRevenueAutomationIntake(input: RevenueAutomationIntakeAnswerInput) {
  loadRevenueAutomationIntakes();
  const parsed = revenueAutomationIntakeAnswerSchema.parse(input);
  const intake = revenueAutomationIntakes.find((item) => item.id === parsed.intakeId);

  if (!intake) {
    return {
      status: "not_found" as const,
      reason: "Intake no encontrado.",
      intake: null,
      snapshot: getRevenueEngineSnapshot(),
    };
  }

  intake.knownAnswers = [intake.knownAnswers, parsed.answers].filter((item) => item.trim().length > 0).join("\n\n");
  const enrichedRequest = `${intake.request}\n\nRespuestas del cliente:\n${intake.knownAnswers}`;
  const quote = buildAutomationQuote({
    businessName: intake.businessName,
    industry: intake.industry,
    request: enrichedRequest,
    currentTools: intake.currentTools,
    monthlyBudgetUsd: intake.monthlyBudgetUsd,
    urgency: intake.urgency,
  });
  const ready = quote.clarificationGate.status === "clear" || intake.knownAnswers.trim().length >= 40;
  const missingAnswers = ready ? [] : quote.clarificationGate.missing;
  const nextQuestions = ready ? [] : quote.clarifyingQuestions;

  intake.request = enrichedRequest.slice(0, 1200);
  intake.quote = quote;
  intake.status = ready ? "ready_for_quote" : "needs_answers";
  intake.missingAnswers = missingAnswers;
  intake.nextQuestions = nextQuestions;
  intake.answerTemplate = buildAutomationIntakeAnswerTemplate(nextQuestions, missingAnswers);
  intake.blockedUntilAnswered = ready ? [] : quote.clarificationGate.blocks;
  intake.nextAction = ready
    ? "Crear oportunidad/cotizacion y pedir aprobacion de scope/deposito."
    : "Aun faltan respuestas; no prometer precio, build o delivery.";
  intake.updatedAt = new Date().toISOString();
  persistRevenueAutomationIntakes();

  return {
    status: "updated" as const,
    intake,
    snapshot: getRevenueEngineSnapshot(),
  };
}

export function convertRevenueAutomationIntakeToOpportunity(input: RevenueAutomationIntakeConvertInput) {
  loadRevenueAutomationIntakes();
  const parsed = revenueAutomationIntakeConvertSchema.parse(input);
  const intake = revenueAutomationIntakes.find((item) => item.id === parsed.intakeId);

  if (!intake) {
    return {
      status: "not_found" as const,
      reason: "Intake no encontrado.",
      intake: null,
      opportunity: null,
      snapshot: getRevenueEngineSnapshot(),
    };
  }

  if (intake.status !== "ready_for_quote") {
    return {
      status: "blocked" as const,
      reason: "Responder preguntas de aclaracion antes de crear oportunidad/cotizacion.",
      intake,
      opportunity: null,
      snapshot: getRevenueEngineSnapshot(),
    };
  }

  const result = recordRevenueAutomationOpportunity({
    businessName: intake.businessName,
    industry: intake.industry,
    request: intake.request,
    currentTools: intake.currentTools,
    monthlyBudgetUsd: intake.monthlyBudgetUsd,
    urgency: intake.urgency,
    sourceLeadId: "",
    status: parsed.status,
    clientApprovedScope: parsed.clientApprovedScope,
    depositPaid: parsed.depositPaid,
  });

  intake.nextAction = `Oportunidad creada: ${result.opportunity.id}. Pedir aprobacion de scope y deposito antes de construir.`;
  intake.updatedAt = new Date().toISOString();
  persistRevenueAutomationIntakes();

  return {
    status: "converted" as const,
    reason: "Intake convertido en oportunidad de automatizacion con QA y aprobaciones pendientes.",
    intake,
    opportunity: result.opportunity,
    snapshot: getRevenueEngineSnapshot(),
  };
}

export function runRevenueAutomationAgentCommand(input: RevenueAutomationAgentCommandInput) {
  const parsed = revenueAutomationAgentCommandSchema.parse(input);
  const intakeResult = recordRevenueAutomationIntake({
    businessName: parsed.businessName,
    industry: parsed.industry,
    request: parsed.request,
    currentTools: parsed.currentTools,
    monthlyBudgetUsd: parsed.monthlyBudgetUsd,
    urgency: parsed.urgency,
    contactName: parsed.contactName,
    contactEmail: parsed.contactEmail,
    knownAnswers: parsed.knownAnswers,
    source: parsed.source,
  });
  const intake = intakeResult.intake;
  const effectiveRequest = parsed.knownAnswers.trim().length > 0
    ? `${intake.request}\n\nRespuestas del cliente:\n${parsed.knownAnswers}`
    : intake.request;
  const effectiveQuote = buildAutomationQuote({
    businessName: intake.businessName,
    industry: intake.industry,
    request: effectiveRequest,
    currentTools: intake.currentTools,
    monthlyBudgetUsd: intake.monthlyBudgetUsd,
    urgency: intake.urgency,
  });
  const quoteIsClear = effectiveQuote.clarificationGate.status === "clear" || intake.status === "ready_for_quote";
  if (effectiveQuote.clarificationGate.status === "clear" && intake.quote.clarificationGate.status !== "clear") {
    intake.request = effectiveRequest.slice(0, 1200);
    intake.quote = effectiveQuote;
    intake.status = "ready_for_quote";
    intake.missingAnswers = [];
    intake.nextQuestions = [];
    intake.blockedUntilAnswered = [];
    intake.nextAction = "Crear oportunidad/cotizacion y pedir aprobacion de scope/deposito.";
    intake.updatedAt = new Date().toISOString();
    persistRevenueAutomationIntakes();
  }

  if (!quoteIsClear) {
    return {
      status: "needs_answers" as const,
      reason: "El agente no entiende suficiente el pedido; pregunta antes de cotizar final o crear oportunidad.",
      intake,
      quote: effectiveQuote,
      opportunity: null,
      blockedUntilAnswered: intake.blockedUntilAnswered,
      nextActions: [
        "Enviar/leer las preguntas de aclaracion.",
        "Guardar respuestas en el intake.",
        "Volver a correr el agente antes de crear oportunidad.",
      ],
      snapshot: getRevenueEngineSnapshot(),
    };
  }

  if (!parsed.createOpportunityIfClear || parsed.lifecycleTarget === "quote") {
    return {
      status: "quoted" as const,
      reason: "Pedido claro; cotizacion lista en modo draft sin crear oportunidad.",
      intake,
      quote: effectiveQuote,
      opportunity: null,
      blockedUntilAnswered: [],
      nextActions: ["Revisar precio y alcance.", "Pedir aprobacion de scope/deposito.", "Crear oportunidad cuando Robert apruebe."],
      snapshot: getRevenueEngineSnapshot(),
    };
  }

  const opportunityResult = recordRevenueAutomationOpportunity({
    businessName: intake.businessName,
    industry: intake.industry,
    request: effectiveRequest,
    currentTools: intake.currentTools,
    monthlyBudgetUsd: intake.monthlyBudgetUsd,
    urgency: intake.urgency,
    sourceLeadId: "",
    status: parsed.lifecycleTarget === "sale" || parsed.lifecycleTarget === "delivery" ? "approved" : "quoted",
    clientApprovedScope: parsed.clientApprovedScope,
    depositPaid: parsed.depositPaid,
  });

  intake.nextAction = `Agente creo oportunidad: ${opportunityResult.opportunity.id}. Pedir aprobacion de scope y deposito antes de construir.`;
  intake.updatedAt = new Date().toISOString();
  persistRevenueAutomationIntakes();

  if (parsed.lifecycleTarget === "opportunity") {
    return {
      status: "opportunity_created" as const,
      reason: "Pedido claro; el agente preparo cotizacion y oportunidad en draft con QA.",
      intake,
      quote: effectiveQuote,
      opportunity: opportunityResult.opportunity,
      closeResult: null,
      workspaceResult: null,
      blockedUntilAnswered: [],
      nextActions: [
        "Pedir aprobacion de scope al cliente.",
        "Cobrar deposito antes de build.",
        "Crear delivery workspace solo despues de venta registrada.",
      ],
      snapshot: getRevenueEngineSnapshot(),
    };
  }

  const saleBlockers = [
    !parsed.clientApprovedScope && "falta aprobacion escrita del scope",
    !parsed.depositPaid && !parsed.cashCollectedUsd && "falta deposito/cash cobrado",
  ].filter(Boolean) as string[];

  if (saleBlockers.length > 0) {
    opportunityResult.opportunity.nextAction = `No cerrar venta todavia: ${saleBlockers.join("; ")}.`;
    opportunityResult.opportunity.updatedAt = new Date().toISOString();
    persistRevenueAutomationOpportunities();

    return {
      status: "sale_blocked" as const,
      reason: opportunityResult.opportunity.nextAction,
      intake,
      quote: effectiveQuote,
      opportunity: opportunityResult.opportunity,
      closeResult: null,
      workspaceResult: null,
      blockedUntilAnswered: [],
      nextActions: [
        "Conseguir aprobacion escrita del scope.",
        "Cobrar deposito antes de registrar venta o construir.",
        "Volver a correr el agente con depositPaid/cashCollectedUsd.",
      ],
      snapshot: getRevenueEngineSnapshot(),
    };
  }

  const closeResult = closeRevenueAutomationOpportunity({
    opportunityId: opportunityResult.opportunity.id,
    cashCollectedUsd: parsed.cashCollectedUsd,
    markScopeApproved: parsed.clientApprovedScope,
    notes: "Cierre ejecutado por automation agent command con guardrails.",
    approvalDecisionId: "",
  });

  if (closeResult.status !== "recorded") {
    return {
      status: "sale_blocked" as const,
      reason: closeResult.reason,
      intake,
      quote: effectiveQuote,
      opportunity: closeResult.opportunity || opportunityResult.opportunity,
      closeResult,
      workspaceResult: null,
      blockedUntilAnswered: [],
      nextActions: [
        "Registrar approval decision de ledger usando el opportunity id exacto.",
        "Cerrar la oportunidad con approvalDecisionId valido despues de aprobar el ledger.",
        "No crear delivery hasta que ledger registre cash.",
      ],
      snapshot: closeResult.snapshot,
    };
  }

  if (parsed.lifecycleTarget !== "delivery" && !parsed.createDeliveryWorkspaceIfSold) {
    return {
      status: "sale_recorded" as const,
      reason: "Venta registrada; cash, margen y Profit Guard actualizados antes de delivery.",
      intake,
      quote: effectiveQuote,
      opportunity: closeResult.opportunity,
      closeResult,
      workspaceResult: null,
      blockedUntilAnswered: [],
      nextActions: ["Crear delivery workspace.", "Resolver QA de subagentes.", "No entregar hasta aprobacion final de Robert."],
      snapshot: closeResult.snapshot,
    };
  }

  const workspaceResult = createDeliveryWorkspaceFromAutomationOpportunity({
    opportunityId: opportunityResult.opportunity.id,
    workspaceName: parsed.workspaceName,
    publicDataVerified: parsed.publicDataVerified,
    visualQaPassed: parsed.visualQaPassed,
    technicalQaPassed: parsed.technicalQaPassed,
    automationQaPassed: parsed.automationQaPassed,
    clientHandoffReady: parsed.clientHandoffReady,
    launchTargetDays: parsed.launchTargetDays,
  });

  return {
    status: workspaceResult.status === "created" ? "delivery_workspace_created" as const : "delivery_blocked" as const,
    reason: workspaceResult.reason,
    intake,
    quote: effectiveQuote,
    opportunity: workspaceResult.opportunity || closeResult.opportunity,
    closeResult,
    workspaceResult,
    blockedUntilAnswered: [],
    nextActions: [
      workspaceResult.status === "created" ? "Resolver correctionQueue de QA." : "Resolver bloqueo antes de crear delivery.",
      "Mantener entrega bloqueada hasta que subagentes pasen QA.",
      "Registrar aprendizaje despues del handoff.",
    ],
    snapshot: workspaceResult.snapshot,
  };
}

export function createDeliveryWorkspaceFromAutomationOpportunity(input: RevenueAutomationOpportunityDeliveryInput) {
  loadRevenueAutomationOpportunities();
  loadRevenueDeliveryWorkspaces();
  loadRevenueLedger();
  const parsed = revenueAutomationOpportunityDeliverySchema.parse(input);
  const opportunity = revenueAutomationOpportunities.find((item) => item.id === parsed.opportunityId);

  if (!opportunity) {
    return {
      status: "not_found" as const,
      reason: "Oportunidad no encontrada.",
      opportunity: null,
      workspace: null,
      snapshot: getRevenueEngineSnapshot(),
    };
  }

  const existingLedgerEntry = revenueLedger.find((entry) => (
    entry.kind === "automation_sale"
    && entry.clientName === opportunity.businessName
    && entry.amountUsd === opportunity.quote.pricing.setupPriceUsd
    && entry.cashCollectedUsd >= opportunity.quote.pricing.requiredDepositUsd
    && entry.estimatedInternalCostUsd === opportunity.quote.pricing.estimatedInternalMonthlyCostUsd
    && entry.notes.includes(`Automation opportunity:${opportunity.id}`)
    && entry.notes.includes(opportunity.quote.scope.packageName)
  ));
  const blockingReasons = [
    opportunity.status === "blocked" && "la oportunidad esta bloqueada",
    !["sold", "in_delivery", "delivered"].includes(opportunity.status) && "la oportunidad no esta vendida en ledger",
    !existingLedgerEntry && "falta venta registrada en ledger para esta oportunidad",
    opportunity.quote.clarificationGate.status !== "clear" && "faltan respuestas antes de producir",
    !opportunity.clientApprovedScope && "falta aprobacion escrita de scope",
    !opportunity.depositPaid && "falta deposito pagado",
    opportunity.quote.pricing.estimatedInternalMonthlyCostUsd > 100 && "costo interno supera $100/mes",
    opportunity.quote.pricing.grossMarginPercent < 65 && "margen mensual menor a 65%",
  ].filter(Boolean) as string[];

  if (blockingReasons.length > 0) {
    opportunity.nextAction = `No crear delivery todavia: ${blockingReasons.join("; ")}.`;
    opportunity.updatedAt = new Date().toISOString();
    persistRevenueAutomationOpportunities();

    return {
      status: "blocked" as const,
      reason: opportunity.nextAction,
      opportunity,
      workspace: null,
      snapshot: getRevenueEngineSnapshot(),
    };
  }

  const workspaceResult = recordRevenueDeliveryWorkspace({
    workspaceName: parsed.workspaceName === "Delivery workspace" ? `${opportunity.businessName} delivery` : parsed.workspaceName,
    sourceOpportunityId: opportunity.id,
    clientName: opportunity.businessName,
    projectType: "automation",
    packageName: opportunity.quote.scope.packageName,
    setupUsd: opportunity.quote.pricing.setupPriceUsd,
    monthlyRetainerUsd: opportunity.quote.pricing.monthlyRetainerUsd,
    estimatedInternalCostUsd: opportunity.quote.pricing.estimatedInternalMonthlyCostUsd,
    depositPaid: opportunity.depositPaid,
    scopeApproved: opportunity.clientApprovedScope,
    publicDataVerified: parsed.publicDataVerified,
    includesAutomation: true,
    launchTargetDays: parsed.launchTargetDays,
    clientRequest: opportunity.request,
    visualQaPassed: parsed.visualQaPassed,
    technicalQaPassed: parsed.technicalQaPassed,
    automationQaPassed: parsed.automationQaPassed,
    clientHandoffReady: parsed.clientHandoffReady,
  });

  opportunity.status = "in_delivery";
  opportunity.nextAction = `Delivery workspace creado: ${workspaceResult.workspace.id}. Resolver QA antes de mostrar o lanzar.`;
  opportunity.updatedAt = new Date().toISOString();
  persistRevenueAutomationOpportunities();

  return {
    status: "created" as const,
    reason: "Workspace de delivery creado con subagentes QA y guardrails de rentabilidad.",
    opportunity,
    workspace: workspaceResult.workspace,
    snapshot: getRevenueEngineSnapshot(),
  };
}

export function closeRevenueAutomationOpportunity(input: RevenueAutomationOpportunityCloseInput) {
  loadRevenueAutomationOpportunities();
  loadRevenueLedger();
  const parsed = revenueAutomationOpportunityCloseSchema.parse(input);
  const opportunity = revenueAutomationOpportunities.find((item) => item.id === parsed.opportunityId);

  if (!opportunity) {
    return {
      status: "not_found" as const,
      reason: "Oportunidad no encontrada.",
      opportunity: null,
      entry: null,
      snapshot: getRevenueEngineSnapshot(),
    };
  }

  const existingEntry = revenueLedger.find((entry) => entry.notes.includes(`opportunity:${opportunity.id}`));
  if (existingEntry) {
    return {
      status: "already_recorded" as const,
      reason: "Esta oportunidad ya tiene una venta registrada en ledger.",
      opportunity,
      entry: existingEntry,
      snapshot: getRevenueEngineSnapshot(),
    };
  }

  const cashCollectedUsd = parsed.cashCollectedUsd ?? opportunity.quote.pricing.requiredDepositUsd;
  const requiredDepositUsd = opportunity.quote.pricing.requiredDepositUsd;
  const blockingReasons = [
    opportunity.status === "blocked" && "la oportunidad esta bloqueada",
    opportunity.quote.clarificationGate.status !== "clear" && "faltan respuestas antes de cerrar",
    cashCollectedUsd <= 0 && "falta cash/deposito cobrado",
    cashCollectedUsd > 0 && cashCollectedUsd < requiredDepositUsd && `deposito incompleto: falta cobrar $${(requiredDepositUsd - cashCollectedUsd).toLocaleString("en-US")}`,
    opportunity.quote.pricing.estimatedInternalMonthlyCostUsd > 100 && "costo interno supera $100/mes",
    opportunity.quote.pricing.grossMarginPercent < 65 && "margen mensual menor a 65%",
  ].filter(Boolean) as string[];

  if (blockingReasons.length > 0) {
    opportunity.nextAction = `No registrar venta todavia: ${blockingReasons.join("; ")}.`;
    opportunity.updatedAt = new Date().toISOString();
    persistRevenueAutomationOpportunities();

    return {
      status: "blocked" as const,
      reason: opportunity.nextAction,
      opportunity,
      entry: null,
      snapshot: getRevenueEngineSnapshot(),
    };
  }

  const ledgerResult = recordRevenueLedgerEntry({
    kind: "automation_sale",
    clientName: opportunity.businessName,
    amountUsd: opportunity.quote.pricing.setupPriceUsd,
    cashCollectedUsd,
    estimatedInternalCostUsd: opportunity.quote.pricing.estimatedInternalMonthlyCostUsd,
    notes: [
      `Automation opportunity:${opportunity.id}`,
      opportunity.quote.scope.packageName,
      parsed.notes,
    ].filter((item) => item.trim().length > 0).join(" | "),
    approvalDecisionId: parsed.approvalDecisionId,
  });

  if (!ledgerResult.entry) {
    opportunity.nextAction = ledgerResult.guardrail.reason;
    opportunity.updatedAt = new Date().toISOString();
    persistRevenueAutomationOpportunities();

    return {
      status: "blocked" as const,
      reason: ledgerResult.guardrail.reason,
      opportunity,
      entry: null,
      snapshot: ledgerResult.snapshot,
    };
  }

  opportunity.status = "sold";
  opportunity.clientApprovedScope = parsed.markScopeApproved || opportunity.clientApprovedScope;
  opportunity.depositPaid = true;
  opportunity.nextAction = "Venta registrada en ledger. Crear delivery workspace y mantener QA antes de entregar.";
  opportunity.updatedAt = new Date().toISOString();
  persistRevenueAutomationOpportunities();

  return {
    status: "recorded" as const,
    reason: "Venta de automatizacion registrada; métricas, cash y Profit Guard actualizados.",
    opportunity,
    entry: ledgerResult.entry,
    snapshot: getRevenueEngineSnapshot(),
  };
}

export function getRevenueEngineSnapshot() {
  loadRevenueLedger();
  loadRevenueLeads();
  loadRevenueOutreach();
  loadRevenueAgentRuns();
  loadRevenueAutomationOpportunities();
  loadRevenueImprovementReviews();
  loadRevenueScoutingMissions();
  loadRevenuePublicLeadCandidates();
  loadRevenueDeliveryWorkspaces();
  loadRevenueApprovalDecisions();
  loadRevenueAutomationIntakes();
  const sales = revenueLedger.filter(isSaleEntry);
  const expenses = revenueLedger.filter((entry) => entry.kind === "expense");
  const appsSold = revenueLedger.filter((entry) => entry.kind === "website_sale" || entry.kind === "bundle_sale").length;
  const automationsSold = revenueLedger.filter((entry) => entry.kind === "automation_sale" || entry.kind === "bundle_sale").length;
  const revenueUsd = sales.reduce((total, entry) => total + entry.amountUsd, 0);
  const cashCollectedUsd = sales.reduce((total, entry) => total + entry.cashCollectedUsd, 0);
  const directSpendUsd = expenses.reduce((total, entry) => total + entry.amountUsd, 0);
  const internalCostUsd = revenueLedger.reduce((total, entry) => total + entry.estimatedInternalCostUsd, 0);
  const estimatedSpendUsd = directSpendUsd + internalCostUsd;
  const profitUsd = cashCollectedUsd - estimatedSpendUsd;
  const pendingOutreachApprovals = revenueOutreachDrafts.filter((draft) => draft.status === "draft" || draft.status === "blocked").length;
  const pendingAgentApprovals = revenueAgentRuns.filter((run) => run.status === "approval_required" || run.status === "blocked").length;
  const pendingAutomationApprovals = revenueAutomationOpportunities.filter((opportunity) =>
    opportunity.status === "blocked" || opportunity.qaGates.some((gate) => !gate.passed),
  ).length;
  const pendingDeliveryApprovals = revenueDeliveryWorkspaces.filter((workspace) => workspace.status === "blocked" || workspace.status === "needs_corrections").length;
  const approvalQueue = (estimatedSpendUsd > 100 || estimatedSpendUsd > cashCollectedUsd ? 1 : 0) + pendingOutreachApprovals + pendingAgentApprovals + pendingAutomationApprovals + pendingDeliveryApprovals;
  const profitGuard = buildRevenueProfitGuard({ cashCollectedUsd, estimatedSpendUsd, profitUsd, approvalQueue });
  const latestImprovementReview = revenueImprovementReviews.at(-1);
  const nextBatchPlan = buildRevenueNextBatchPlan({ profitGuard, latestReview: latestImprovementReview, approvalQueue });
  const executiveSummary = buildRevenueExecutiveSummary({
    appsSold,
    automationsSold,
    revenueUsd,
    cashCollectedUsd,
    estimatedSpendUsd,
    profitUsd,
    approvalQueue,
    profitGuard,
    nextBatchPlan,
  });
  const agentOperatingContract = buildRevenueAgentOperatingContract({ profitGuard, nextBatchPlan, approvalQueue });
  const operatorConsole = buildRevenueOperatorConsole({
    appsSold,
    automationsSold,
    revenueUsd,
    cashCollectedUsd,
    estimatedSpendUsd,
    profitUsd,
    approvalQueue,
    executiveSummary,
    profitGuard,
    nextBatchPlan,
    agentOperatingContract,
  });
  const systemReadiness = buildRevenueSystemReadiness({
    appsSold,
    automationsSold,
    cashCollectedUsd,
    estimatedSpendUsd,
    approvalQueue,
    profitGuard,
    nextBatchPlan,
    agentOperatingContract,
  });
  const launchReadiness = buildRevenueLaunchReadiness({
    area: "Miami",
    niche: "med spas / aesthetics",
    dailyResearchTarget: 120,
    dailyMockupTarget: 5,
    dailyContactTarget: 10,
    emailPending: true,
  });
  const approvalQueueItems = [
    (estimatedSpendUsd > 100 || estimatedSpendUsd > cashCollectedUsd) && {
      id: "profit-guard",
      source: "profit_guard",
      title: "Profit Guard",
      status: profitGuard.status,
      priority: "high",
      action: profitGuard.requiredActions[0] || "revisar rentabilidad",
    },
    ...revenueOutreachDrafts
      .filter((draft) => draft.status === "draft" || draft.status === "blocked")
      .slice(-5)
      .map((draft) => ({
        id: draft.id,
        source: "outbox",
        title: draft.businessName,
        status: draft.status,
        priority: draft.status === "blocked" ? "high" : "medium",
        action: draft.qaGates.find((gate) => !gate.passed)?.fix || "aprobar outreach antes de enviar",
      })),
    ...revenueAgentRuns
      .filter((run) => run.status === "approval_required" || run.status === "blocked")
      .slice(-5)
      .map((run) => ({
        id: run.id,
        source: "agent_run",
        title: run.businessName,
        status: run.status,
        priority: run.status === "blocked" ? "high" : "medium",
        action: run.requiredApprovals[0] || run.nextActions[0] || "resolver aprobacion del agente",
      })),
    ...revenueAutomationOpportunities
      .filter((opportunity) => opportunity.status === "blocked" || opportunity.qaGates.some((gate) => !gate.passed))
      .slice(-5)
      .map((opportunity) => ({
        id: opportunity.id,
        source: "automation_opportunity",
        title: opportunity.businessName,
        status: opportunity.status,
        priority: opportunity.status === "blocked" ? "high" : "medium",
        action: opportunity.qaGates.find((gate) => !gate.passed)?.fix || opportunity.nextAction,
      })),
    ...revenueDeliveryWorkspaces
      .filter((workspace) => workspace.status === "blocked" || workspace.status === "needs_corrections")
      .slice(-5)
      .map((workspace) => ({
        id: workspace.id,
        source: "delivery_workspace",
        title: workspace.input.clientName,
        status: workspace.status,
        priority: workspace.status === "blocked" ? "high" : "medium",
        action: workspace.correctionQueue.find((item) => item.blocksDelivery)?.action || workspace.approvalSummary.requiredBeforeClient[0] || "corregir delivery antes de entregar",
      })),
  ].filter(Boolean);

  return {
    metrics: {
      appsSold,
      automationsSold,
      revenueUsd,
      cashCollectedUsd,
      monthlySpendCapUsd: 100,
      estimatedSpendUsd,
      profitUsd,
      approvalQueue,
    },
    executiveSummary,
    operatorConsole,
    systemReadiness,
    launchReadiness,
    agentOperatingContract,
    profitGuard,
    nextBatchPlan,
    approvalQueueItems,
    costPolicy: {
      monthlyCapUsd: 100,
      stopRule: "Pausar outreach pagado si gasto mensual > ingresos cobrados o si llega a $100.",
      defaultMode: "draft_only",
      allowedWithoutApproval: ["research_plan", "mockup_brief", "qa_checklist", "proposal_draft"],
      requiresApproval: ["contact_business", "buy_data", "send_email", "send_sms", "publish_mockup", "charge_client"],
    },
    emailProvider: getRevenueEmailProviderStatus(),
    agents: agentRoster,
    pipelineStages: buildPipelineStages(revenueLedger, revenueLeads),
    packages,
    recentLedger: revenueLedger.slice(-8).reverse(),
    recentLeads: revenueLeads.slice(-10).reverse(),
    recentOutreach: revenueOutreachDrafts.slice(-10).reverse(),
    recentAgentRuns: revenueAgentRuns.slice(-10).reverse(),
    recentAutomationOpportunities: revenueAutomationOpportunities.slice(-10).reverse(),
    recentImprovementReviews: revenueImprovementReviews.slice(-10).reverse(),
    recentScoutingMissions: revenueScoutingMissions.slice(-10).reverse(),
    recentPublicLeadCandidates: revenuePublicLeadCandidates.slice(-10).reverse(),
    recentDeliveryWorkspaces: revenueDeliveryWorkspaces.slice(-10).reverse(),
    recentApprovalDecisions: revenueApprovalDecisions.slice(-10).reverse(),
    recentAutomationIntakes: revenueAutomationIntakes.slice(-10).reverse(),
    persistence: {
      mode: "local_file",
      path: getRevenueLedgerPath(),
      leadsPath: getRevenueLeadsPath(),
      outreachPath: getRevenueOutreachPath(),
      agentRunsPath: getRevenueAgentRunsPath(),
      automationOpportunitiesPath: getRevenueAutomationOpportunitiesPath(),
      improvementReviewsPath: getRevenueImprovementReviewsPath(),
      scoutingMissionsPath: getRevenueScoutingMissionsPath(),
      publicLeadCandidatesPath: getRevenuePublicLeadCandidatesPath(),
      deliveryWorkspacesPath: getRevenueDeliveryWorkspacesPath(),
      approvalDecisionsPath: getRevenueApprovalDecisionsPath(),
      automationIntakesPath: getRevenueAutomationIntakesPath(),
      status: revenueLedgerPersistenceError ? "warning" : "ok",
      leadsStatus: revenueLeadsPersistenceError ? "warning" : "ok",
      outreachStatus: revenueOutreachPersistenceError ? "warning" : "ok",
      agentRunsStatus: revenueAgentRunsPersistenceError ? "warning" : "ok",
      automationOpportunitiesStatus: revenueAutomationOpportunitiesPersistenceError ? "warning" : "ok",
      improvementReviewsStatus: revenueImprovementReviewsPersistenceError ? "warning" : "ok",
      scoutingMissionsStatus: revenueScoutingMissionsPersistenceError ? "warning" : "ok",
      publicLeadCandidatesStatus: revenuePublicLeadCandidatesPersistenceError ? "warning" : "ok",
      deliveryWorkspacesStatus: revenueDeliveryWorkspacesPersistenceError ? "warning" : "ok",
      approvalDecisionsStatus: revenueApprovalDecisionsPersistenceError ? "warning" : "ok",
      automationIntakesStatus: revenueAutomationIntakesPersistenceError ? "warning" : "ok",
      error:
        revenueLedgerPersistenceError ||
        revenueLeadsPersistenceError ||
        revenueOutreachPersistenceError ||
        revenueAgentRunsPersistenceError ||
        revenueAutomationOpportunitiesPersistenceError ||
        revenueImprovementReviewsPersistenceError ||
        revenueScoutingMissionsPersistenceError ||
        revenuePublicLeadCandidatesPersistenceError ||
        revenueDeliveryWorkspacesPersistenceError ||
        revenueApprovalDecisionsPersistenceError ||
        revenueAutomationIntakesPersistenceError,
    },
    automationQuoteDefaults: {
      minimumSetupUsd: 1500,
      minimumRetainerUsd: 300,
      maxInternalMonthlyCostUsd: 100,
      requiredDepositPercent: 50,
      defaultApprovalMode: "draft_until_signed_and_deposit_paid",
    },
    improvementDefaults: {
      reviewCadence: "weekly",
      minimumGrossMarginPercent: 65,
      maxMonthlySpendBeforeRevenueUsd: 100,
      stopRule: "Pausar campana si el gasto llega a $100 sin ingresos cobrados o si defectos/quejas bloquean entrega.",
      learningMode: "update_playbook_after_each_batch",
    },
  };
}

function qualifyRevenueLead(lead: RevenueLeadInput) {
  const hasEvidence = lead.evidence.trim().length >= 12;
  const hasContact = lead.contactChannel !== "unknown" && lead.contactValue.trim().length >= 3;
  const websiteScore = lead.websiteStatus === "no_website" ? 35 : lead.websiteStatus === "weak_website" ? 25 : lead.websiteStatus === "unknown" ? 10 : 0;
  const contactScore = hasContact ? 25 : 0;
  const evidenceScore = hasEvidence ? 20 : 0;
  const painScore = lead.painPoint.trim().length >= 8 ? 10 : 0;
  const ticketScore = lead.estimatedOfferUsd >= 1500 ? 10 : 0;
  const score = websiteScore + contactScore + evidenceScore + painScore + ticketScore;
  const missing = [
    !hasEvidence && "evidencia publica revisable",
    !hasContact && "contacto verificable",
    lead.websiteStatus === "unknown" && "confirmar si tiene website",
    lead.estimatedOfferUsd < 1500 && "oferta minima rentable",
  ].filter(Boolean) as string[];
  const recommendedStatus: RevenueLead["status"] =
    missing.length > 0
      ? "research"
      : score >= 80
        ? "mockup_ready"
        : score >= 65
          ? "qualified"
          : "research";

  return {
    score,
    grade: score >= 80 ? "A" : score >= 65 ? "B" : score >= 45 ? "C" : "D",
    recommendedStatus,
    missing,
    nextAgent:
      recommendedStatus === "mockup_ready"
        ? "mockup-builder"
        : recommendedStatus === "qualified"
          ? "business-researcher"
          : "lead-scout",
    guardrail:
      missing.length > 0
        ? "No contactar todavia. Completar evidencia/contacto primero."
        : "Puede avanzar a mockup o propuesta en draft, sin envio externo hasta aprobacion.",
    outreachDraft:
      `Vi que ${lead.businessName} en ${lead.area} podria convertir mas clientes con una presencia web y automatizaciones mas fuertes. Puedo preparar un mockup rapido basado en informacion publica y mostrarte una version premium sin compromiso.`,
  };
}

function revenueBatchCell(value: unknown) {
  return String(value ?? "")
    .replace(/\r?\n/g, " ")
    .replace(/\|/g, "/")
    .trim();
}

function revenueCandidateBatchRow(candidate: RevenuePublicLeadCandidateInput) {
  return [
    candidate.businessName,
    candidate.area,
    candidate.niche,
    candidate.websiteStatus,
    candidate.contactChannel,
    candidate.contactValue,
    candidate.sourceUrl,
    candidate.recipientEmail,
    candidate.evidence,
    candidate.painPoint,
    candidate.estimatedOfferUsd,
    candidate.contactName,
    candidate.businessSummary,
  ].map(revenueBatchCell).join("|");
}

export function recordRevenuePublicLeadCandidate(input: RevenuePublicLeadCandidateInput) {
  loadRevenuePublicLeadCandidates();
  const parsed = revenuePublicLeadCandidateSchema.parse(input);
  const qualification = qualifyRevenueLead(parsed);
  const blockedReasons = [
    parsed.verificationStatus === "blocked" && "candidate blocked by scout",
    !parsed.publicEvidenceVerified && "public evidence not verified",
    "requires Robert review approval",
    parsed.sourceUrl.trim().length === 0 && "sourceUrl publico",
    parsed.recipientEmail.trim().length === 0 && "recipientEmail",
    ...qualification.missing,
  ].filter((item): item is string => Boolean(item));
  const importReady = false;
  const now = new Date().toISOString();
  const existingIndex = revenuePublicLeadCandidates.findIndex((candidate) =>
    candidate.businessName.toLowerCase() === parsed.businessName.toLowerCase()
    && candidate.area.toLowerCase() === parsed.area.toLowerCase()
    && candidate.contactValue.toLowerCase() === parsed.contactValue.toLowerCase(),
  );
  const candidate: RevenuePublicLeadCandidate = {
    ...parsed,
    id: existingIndex >= 0 ? revenuePublicLeadCandidates[existingIndex].id : `candidate-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    createdAt: existingIndex >= 0 ? revenuePublicLeadCandidates[existingIndex].createdAt : now,
    updatedAt: now,
    qualification,
    importReady,
    blockedReasons,
    batchRow: revenueCandidateBatchRow(parsed),
    safety: {
      allowedAction: "record_public_candidate_for_preview",
      blockedActions: ["automated scraping", "contact business", "buy data", "send outreach", "publish preview"],
      persistsLead: false,
      sendsOutreach: false,
      writesPreviewFiles: false,
    },
  };

  if (existingIndex >= 0) {
    revenuePublicLeadCandidates.splice(existingIndex, 1, candidate);
  } else {
    revenuePublicLeadCandidates.push(candidate);
  }
  persistRevenuePublicLeadCandidates();

  return {
    status: candidate.importReady ? "ready_for_preview" as const : "needs_review" as const,
    candidate,
    importBatchText: [
      "business|area|niche|website|channel|contact|sourceUrl|recipientEmail|evidence|painPoint|offer|contactName|summary",
      ...(candidate.importReady ? [candidate.batchRow] : []),
    ].join("\n"),
    importableCount: candidate.importReady ? 1 : 0,
    nextAction: candidate.importReady
      ? "Paste this candidate row into Batch leads and run Preview batch before Money sprint."
      : `Fix before import: ${blockedReasons.join("; ") || "review candidate"}.`,
    snapshot: getRevenueEngineSnapshot(),
  };
}

export function recordRevenuePublicScoutRun(input: RevenuePublicScoutRunInput) {
  const parsed = revenuePublicScoutRunSchema.parse(input);
  const mission = buildRevenueScoutingMission({
    area: parsed.area,
    niche: parsed.niche,
    offerFocus: parsed.offerFocus,
    targetLeadCount: parsed.dailyQualifiedLeadLimit,
    maxPaidDataSpendUsd: 0,
    requireNoWebsiteSignal: true,
    includeWeakWebsiteLeads: true,
  });
  const scoutQueue = buildRevenueScoutQueue({ ...parsed, maxPaidDataSpendUsd: 0, seedLeads: [], seedLeadBatchText: "" });
  const recordedCandidates = parsed.candidates.map((candidate, index) => recordRevenuePublicLeadCandidate({
    ...candidate,
    area: candidate.area || parsed.area,
    niche: candidate.niche || parsed.niche,
    missionId: candidate.missionId || parsed.scoutRunId || mission.mission.name,
    sourceTaskId: candidate.sourceTaskId || scoutQueue[index % Math.max(1, scoutQueue.length)]?.id || "",
    approvalToImport: false,
  }));
  const importableCandidates = recordedCandidates.filter((result) => result.candidate.importReady);
  const blockedCandidates = recordedCandidates
    .filter((result) => !result.candidate.importReady)
    .map((result) => ({
      businessName: result.candidate.businessName,
      reasons: result.candidate.blockedReasons,
      nextAction: result.nextAction,
    }));
  const importBatchText = [
    "business|area|niche|website|channel|contact|sourceUrl|recipientEmail|evidence|painPoint|offer|contactName|summary",
    ...importableCandidates.map((result) => result.candidate.batchRow),
  ].join("\n");
  const preview = previewRevenueMoneySprintSeeds({
    area: parsed.area,
    niche: parsed.niche,
    offerFocus: parsed.offerFocus,
    dailyResearchTarget: parsed.dailyResearchTarget,
    dailyQualifiedLeadLimit: parsed.dailyQualifiedLeadLimit,
    dailyMockupLimit: parsed.dailyMockupLimit,
    dailyContactLimit: parsed.dailyContactLimit,
    maxPaidDataSpendUsd: 0,
    requireRobertApprovalToContact: parsed.requireRobertApprovalToContact,
    writePreviewFiles: false,
    seedLeads: [],
    seedLeadBatchText: importBatchText,
  });

  return {
    status: importableCandidates.length > 0 ? "ready_for_money_sprint_preview" as const : recordedCandidates.length > 0 ? "needs_candidate_review" as const : "empty" as const,
    mode: "public_scout_capture_only" as const,
    scoutRunId: parsed.scoutRunId || mission.mission.name,
    source: parsed.source,
    mission: mission.mission,
    scoutQueue,
    recordedCandidates: recordedCandidates.map((result) => ({
      candidate: result.candidate,
      status: result.status,
      importableCount: result.importableCount,
    })),
    importableCount: importableCandidates.length,
    blockedCandidates,
    importBatchText,
    preview,
    nextApiAction: importableCandidates.length > 0 ? "/api/revenue-engine/money-sprint-preview" : "/api/revenue-engine/scout-dispatch",
    nextAction: importableCandidates.length > 0
      ? "Review preview.acceptedSeeds, then run Money sprint with this importBatchText only after Robert approves the batch."
      : recordedCandidates.length > 0
        ? "Robert reviews captured public candidates; approve/import through the explicit review path before any Money sprint preview."
        : "Run a browser scout session, capture public candidates, then submit them for Robert review.",
    safety: {
      allowedAction: "capture_verified_public_scout_results",
      blockedActions: ["automated scraping", "contact business", "buy data", "send outreach", "write preview files", "publish preview", "collect payment"],
      persistsPublicCandidates: recordedCandidates.length > 0,
      persistsLeads: false,
      writesPreviewFiles: false,
      sendsOutreach: false,
      paidDataSpendUsd: 0,
      requiresRobertApprovalBeforeMoneySprint: true,
      ignoresCaptureImportApproval: true,
    },
    snapshot: getRevenueEngineSnapshot(),
  };
}

export function listRevenuePublicLeadCandidates() {
  loadRevenuePublicLeadCandidates();
  return [...revenuePublicLeadCandidates];
}

function isRevenueDemoPublicCandidate(candidate: { businessName: string; sourceUrl: string; recipientEmail: string }) {
  const text = `${candidate.businessName} ${candidate.sourceUrl} ${candidate.recipientEmail}`.toLowerCase();
  return ["example.com", "smoke", "demo", "sample", "fixture", "placeholder", "replace with", "test"].some((marker) => text.includes(marker));
}

export function buildRevenueManualContactApprovalPacket(input: RevenueManualContactApprovalPacketInput = { maxCandidates: 10 }) {
  loadRevenuePublicLeadCandidates();
  const parsed = revenueManualContactApprovalPacketSchema.parse(input);
  const publicCandidates = revenuePublicLeadCandidates.filter((candidate) => !isRevenueDemoPublicCandidate(candidate));
  const allManualCandidates = publicCandidates.filter((candidate) =>
    candidate.verificationStatus === "verified_public"
    && candidate.publicEvidenceVerified
    && candidate.recipientEmail.trim().length === 0
    && ["phone", "instagram", "contact_form"].includes(candidate.contactChannel)
    && candidate.contactValue.trim().length >= 3
    && candidate.sourceUrl.trim().length > 0
    && candidate.evidence.trim().length >= 12
  );
  const manualCandidates = allManualCandidates.slice(0, parsed.maxCandidates);

  return {
    status: allManualCandidates.length > 0 ? "ready_for_robert_manual_contact_review" as const : "empty" as const,
    reviewed: publicCandidates.length,
    manualContactCount: allManualCandidates.length,
    items: manualCandidates.map((candidate) => ({
      candidateId: candidate.id,
      businessName: candidate.businessName,
      area: candidate.area,
      niche: candidate.niche,
      contactChannel: candidate.contactChannel,
      contactValue: candidate.contactValue,
      sourceUrl: candidate.sourceUrl,
      evidence: candidate.evidence,
      painPoint: candidate.painPoint,
      estimatedOfferUsd: candidate.estimatedOfferUsd,
      readyForRobertApproval: true,
      requiredBeforeContact: [
        "Robert must explicitly approve manual contact.",
        "Operator must review the public source immediately before contact.",
        "Do not use an email provider; this is phone/social/contact-form only.",
        "Record any reply/deposit before creating website delivery work.",
      ],
      suggestedManualOpening: [
        `Hi, I saw ${candidate.businessName} while checking local ${candidate.niche} options in ${candidate.area}.`,
        "I noticed your public listing has room for a stronger booking/lead capture website.",
        "I can prepare a quick no-obligation website mockup based only on public info if you want to see it.",
      ].join(" "),
    })),
    nextAction: manualCandidates.length > 0
      ? "Robert reviews these manual-only candidates and explicitly decides whether an operator may contact them outside the email provider."
      : "No verified manual-only candidates are ready; keep verifying public contact evidence.",
    safety: {
      allowedAction: "review_manual_contact_candidates_only",
      blockedActions: ["send outreach", "call business", "dm business", "submit contact form", "import final lead", "write preview files", "collect payment"],
      persistsData: false,
      importsLeads: false,
      sendsOutreach: false,
      writesPreviewFiles: false,
      paidDataSpendUsd: 0,
      requiresRobertApprovalBeforeContact: true,
    },
    snapshot: getRevenueEngineSnapshot(),
  };
}

export function updateRevenuePublicLeadCandidateVerification(input: RevenuePublicLeadCandidateVerificationUpdateInput) {
  loadRevenuePublicLeadCandidates();
  const parsed = revenuePublicLeadCandidateVerificationUpdateSchema.parse(input);
  const existingIndex = revenuePublicLeadCandidates.findIndex((candidate) => candidate.id === parsed.candidateId);
  if (existingIndex < 0) {
    return {
      status: "missing_candidate" as const,
      candidateId: parsed.candidateId,
      updated: false,
      candidate: null,
      remainingBeforeRobertReview: [`missing candidate id: ${parsed.candidateId}`],
      nextAction: "Capture the public candidate first, then rerun verification update with its candidateId.",
      safety: {
        allowedAction: "none",
        persistsPublicCandidate: false,
        persistsLead: false,
        sendsOutreach: false,
        writesPreviewFiles: false,
        paidDataSpendUsd: 0,
        approvalToImportForcedFalse: true,
      },
      snapshot: getRevenueEngineSnapshot(),
    };
  }

  const existing = revenuePublicLeadCandidates[existingIndex];
  const recipientEmail = parsed.contactChannel === "email" && parsed.recipientEmail.trim().length === 0
    ? parsed.contactValue
    : parsed.recipientEmail;
  const updatedInput: RevenuePublicLeadCandidateInput = {
    ...existing,
    contactChannel: parsed.contactChannel,
    contactValue: parsed.contactValue,
    recipientEmail,
    sourceUrl: parsed.sourceUrl,
    evidence: parsed.evidence,
    painPoint: parsed.painPoint,
    notes: [
      existing.notes,
      parsed.notes,
      `Public verification updated by ${parsed.verifiedBy}; Robert import approval still required.`,
    ].filter(Boolean).join("\n").slice(0, 1000),
    verificationStatus: parsed.confirmPublicEvidence ? "verified_public" : "needs_review",
    publicEvidenceVerified: parsed.confirmPublicEvidence,
    approvalToImport: false,
  };
  const qualification = qualifyRevenueLead(updatedInput);
  const blockedReasons = [
    updatedInput.verificationStatus !== "verified_public" && "verificationStatus must be verified_public",
    !updatedInput.publicEvidenceVerified && "public evidence not verified",
    "requires Robert review approval",
    updatedInput.sourceUrl.trim().length === 0 && "sourceUrl publico",
    updatedInput.recipientEmail.trim().length === 0 && "recipientEmail",
    ...qualification.missing,
  ].filter((item): item is string => Boolean(item));
  const updatedCandidate: RevenuePublicLeadCandidate = {
    ...updatedInput,
    id: existing.id,
    createdAt: existing.createdAt,
    updatedAt: new Date().toISOString(),
    qualification,
    importReady: false,
    blockedReasons,
    batchRow: revenueCandidateBatchRow(updatedInput),
    safety: {
      allowedAction: "update_public_candidate_verification_only",
      blockedActions: ["approve import", "contact business", "buy data", "send outreach", "publish preview"],
      persistsLead: false,
      sendsOutreach: false,
      writesPreviewFiles: false,
    },
  };

  revenuePublicLeadCandidates.splice(existingIndex, 1, updatedCandidate);
  persistRevenuePublicLeadCandidates();

  const remainingBeforeRobertReview = blockedReasons.filter((reason) => reason !== "requires Robert review approval");
  return {
    status: remainingBeforeRobertReview.length === 0 ? "ready_for_robert_review" as const : "needs_more_public_verification" as const,
    candidateId: updatedCandidate.id,
    updated: true,
    candidate: updatedCandidate,
    remainingBeforeRobertReview,
    nextReviewCommand: {
      command: "npm",
      args: [
        "run",
        "revenue:public-candidate-review",
        "--",
        `--candidate-ids=${updatedCandidate.id}`,
        `--area=${updatedCandidate.area}`,
        `--niche=${updatedCandidate.niche}`,
        "--offer-focus=websites",
      ],
    },
    nextAction: remainingBeforeRobertReview.length === 0
      ? "Ask Robert to approve this candidate for import before running the review command with --approved-by-robert."
      : `Resolve before Robert review: ${remainingBeforeRobertReview.join("; ")}.`,
    safety: {
      allowedAction: "persist_public_candidate_verification_only",
      persistsPublicCandidate: true,
      persistsLead: false,
      sendsOutreach: false,
      writesPreviewFiles: false,
      paidDataSpendUsd: 0,
      approvalToImportForcedFalse: updatedCandidate.approvalToImport === false,
    },
    snapshot: getRevenueEngineSnapshot(),
  };
}

export function blockRevenuePublicLeadCandidate(input: RevenuePublicLeadCandidateBlockInput) {
  loadRevenuePublicLeadCandidates();
  const parsed = revenuePublicLeadCandidateBlockSchema.parse(input);
  const existingIndex = revenuePublicLeadCandidates.findIndex((candidate) => candidate.id === parsed.candidateId);
  if (existingIndex < 0) {
    return {
      status: "missing_candidate" as const,
      candidateId: parsed.candidateId,
      updated: false,
      candidate: null,
      nextAction: "Capture the public candidate first, then rerun the block command with its candidateId.",
      safety: {
        allowedAction: "none",
        persistsPublicCandidate: false,
        persistsLead: false,
        sendsOutreach: false,
        writesPreviewFiles: false,
        paidDataSpendUsd: 0,
        approvalToImportForcedFalse: true,
      },
      snapshot: getRevenueEngineSnapshot(),
    };
  }

  if (!parsed.confirmPublicMismatch) {
    return {
      status: "confirmation_required" as const,
      candidateId: parsed.candidateId,
      updated: false,
      candidate: revenuePublicLeadCandidates[existingIndex],
      nextAction: "Pass --confirm-public-mismatch only after checking public sources and confirming the candidate should be blocked.",
      safety: {
        allowedAction: "review_public_candidate_block_only",
        persistsPublicCandidate: false,
        persistsLead: false,
        sendsOutreach: false,
        writesPreviewFiles: false,
        paidDataSpendUsd: 0,
        approvalToImportForcedFalse: true,
      },
      snapshot: getRevenueEngineSnapshot(),
    };
  }

  const existing = revenuePublicLeadCandidates[existingIndex];
  const updatedInput: RevenuePublicLeadCandidateInput = {
    ...existing,
    sourceUrl: parsed.sourceUrl,
    evidence: parsed.evidence,
    painPoint: parsed.blockReason,
    notes: [
      existing.notes,
      parsed.notes,
      `Public candidate blocked by ${parsed.verifiedBy}: ${parsed.blockReason}`,
    ].filter(Boolean).join("\n").slice(0, 1000),
    verificationStatus: "blocked",
    publicEvidenceVerified: false,
    approvalToImport: false,
  };
  const qualification = qualifyRevenueLead(updatedInput);
  const blockedReasons = [
    "candidate blocked by scout",
    "public evidence not verified",
    parsed.blockReason,
    updatedInput.recipientEmail.trim().length === 0 && "recipientEmail",
  ].filter((item): item is string => Boolean(item));
  const updatedCandidate: RevenuePublicLeadCandidate = {
    ...updatedInput,
    id: existing.id,
    createdAt: existing.createdAt,
    updatedAt: new Date().toISOString(),
    qualification,
    importReady: false,
    blockedReasons,
    batchRow: revenueCandidateBatchRow(updatedInput),
    safety: {
      allowedAction: "block_public_candidate_only",
      blockedActions: ["approve import", "contact business", "buy data", "send outreach", "publish preview"],
      persistsLead: false,
      sendsOutreach: false,
      writesPreviewFiles: false,
    },
  };

  revenuePublicLeadCandidates.splice(existingIndex, 1, updatedCandidate);
  persistRevenuePublicLeadCandidates();

  return {
    status: "blocked" as const,
    candidateId: updatedCandidate.id,
    updated: true,
    candidate: updatedCandidate,
    nextAction: "Candidate is blocked and excluded from first-money review queues. Capture a different verified public candidate.",
    safety: {
      allowedAction: "persist_public_candidate_block_only",
      persistsPublicCandidate: true,
      persistsLead: false,
      sendsOutreach: false,
      writesPreviewFiles: false,
      paidDataSpendUsd: 0,
      approvalToImportForcedFalse: updatedCandidate.approvalToImport === false,
    },
    snapshot: getRevenueEngineSnapshot(),
  };
}

function buildRevenueMoneySprintRunPacket(
  input: RevenueMoneySprintInput,
  importBatchText: string,
  preview: ReturnType<typeof previewRevenueMoneySprintSeeds>,
) {
  const readyToRun = preview.status === "ready_to_import" && preview.totals.accepted > 0;
  const canCreateDrafts = preview.totals.draftReady > 0;
  const canCreateMockups = preview.totals.mockupReady > 0;
  const requestBody: RevenueMoneySprintInput = {
    ...input,
    maxPaidDataSpendUsd: 0,
    requireRobertApprovalToContact: true,
    writePreviewFiles: false,
    seedLeads: [],
    seedLeadBatchText: importBatchText,
  };

  return {
    status: readyToRun ? "ready_for_money_sprint_run" as const : "blocked" as const,
    endpoint: "/api/revenue-engine/money-sprint",
    method: "POST" as const,
    requestBody,
    expectedOutput: {
      acceptedLeads: preview.totals.accepted,
      mockupsToPrepare: preview.totals.mockupReady,
      outreachDraftsToCreate: preview.totals.draftReady,
      sendsOutreach: false,
      writesPreviewFiles: false,
    },
    operatorChecklist: [
      "Confirm Robert approved the candidate review result.",
      "Confirm preview.acceptedSeeds match the real public evidence.",
      "Run the money sprint request only after final human review.",
      "Review generated mockups and outreach drafts before any contact.",
      "Collect deposit and pass App QA/rollback gates before publishing a client website.",
    ],
    blockedUntil: [
      !readyToRun && "Approved preview has no importable leads.",
      !canCreateMockups && "No approved leads qualify for a mockup.",
      !canCreateDrafts && "No approved leads have sourceUrl + recipientEmail for draft outreach.",
    ].filter((item): item is string => Boolean(item)),
    safety: {
      allowedAction: "prepare_money_sprint_run_packet",
      blockedActions: ["send outreach", "contact business", "buy data", "collect payment", "publish preview", "publish website"],
      persistsLeadsOnlyWhenEndpointIsRun: true,
      sendsOutreach: false,
      writesPreviewFiles: false,
      paidDataSpendUsd: 0,
      requiresRobertApprovalBeforeRun: true,
      requiresRobertApprovalBeforeContact: true,
    },
  };
}

export function reviewRevenuePublicLeadCandidates(input: RevenuePublicLeadCandidateReviewInput) {
  loadRevenuePublicLeadCandidates();
  const parsed = revenuePublicLeadCandidateReviewSchema.parse(input);
  const seenCandidateIds = new Set<string>();
  const duplicateIds = parsed.candidateIds.filter((id) => {
    if (seenCandidateIds.has(id)) return true;
    seenCandidateIds.add(id);
    return false;
  });
  const uniqueCandidateIds = Array.from(seenCandidateIds);
  const selectedCandidates = uniqueCandidateIds
    .map((id) => revenuePublicLeadCandidates.find((candidate) => candidate.id === id))
    .filter((candidate): candidate is RevenuePublicLeadCandidate => Boolean(candidate));
  const missingIds = uniqueCandidateIds.filter((id) => !selectedCandidates.some((candidate) => candidate.id === id));
  const reviewRequestComplete = missingIds.length === 0 && duplicateIds.length === 0;
  const reviewedCandidates = selectedCandidates.map((candidate) => {
    const freshQualification = qualifyRevenueLead(candidate);
    const freshBatchRow = revenueCandidateBatchRow(candidate);
    const blockedReasons = [
      !parsed.approvedByRobert && "approvedByRobert false",
      duplicateIds.length > 0 && `duplicate candidate ids: ${duplicateIds.join(", ")}`,
      missingIds.length > 0 && `missing candidate ids: ${missingIds.join(", ")}`,
      candidate.verificationStatus !== "verified_public" && "verificationStatus must be verified_public",
      !candidate.publicEvidenceVerified && "public evidence not verified",
      candidate.evidence.trim().length < 12 && "evidencia publica revisable",
      candidate.sourceUrl.trim().length === 0 && "sourceUrl publico",
      candidate.recipientEmail.trim().length === 0 && "recipientEmail",
      candidate.recipientEmail.trim().length > 0 && !publicCandidateVerificationEmailSchema.safeParse(candidate.recipientEmail).success && "recipientEmail valid email",
      ...freshQualification.missing,
    ].filter((item): item is string => Boolean(item));
    return {
      candidate,
      freshQualification,
      freshBatchRow,
      approvedForPreview: blockedReasons.length === 0,
      blockedReasons,
    };
  });
  const approvedCandidates = reviewedCandidates.filter((item) => item.approvedForPreview);
  const importBatchText = [
    "business|area|niche|website|channel|contact|sourceUrl|recipientEmail|evidence|painPoint|offer|contactName|summary",
    ...approvedCandidates.map((item) => item.freshBatchRow),
  ].join("\n");
  const preview = previewRevenueMoneySprintSeeds({
    area: parsed.area,
    niche: parsed.niche,
    offerFocus: parsed.offerFocus,
    dailyResearchTarget: parsed.dailyResearchTarget,
    dailyQualifiedLeadLimit: parsed.dailyQualifiedLeadLimit,
    dailyMockupLimit: parsed.dailyMockupLimit,
    dailyContactLimit: parsed.dailyContactLimit,
    maxPaidDataSpendUsd: 0,
    requireRobertApprovalToContact: parsed.requireRobertApprovalToContact,
    writePreviewFiles: false,
    seedLeads: [],
    seedLeadBatchText: importBatchText,
  });
  const moneySprintRunPacket = buildRevenueMoneySprintRunPacket({
    area: parsed.area,
    niche: parsed.niche,
    offerFocus: parsed.offerFocus,
    dailyResearchTarget: parsed.dailyResearchTarget,
    dailyQualifiedLeadLimit: parsed.dailyQualifiedLeadLimit,
    dailyMockupLimit: parsed.dailyMockupLimit,
    dailyContactLimit: parsed.dailyContactLimit,
    maxPaidDataSpendUsd: 0,
    requireRobertApprovalToContact: parsed.requireRobertApprovalToContact,
    writePreviewFiles: false,
    seedLeads: [],
    seedLeadBatchText: importBatchText,
  }, importBatchText, preview);

  return {
    status: reviewRequestComplete && approvedCandidates.length > 0 ? "ready_for_money_sprint_preview" as const : "blocked" as const,
    approvedByRobert: parsed.approvedByRobert,
    reviewerNote: parsed.reviewerNote,
    requestedCount: parsed.candidateIds.length,
    foundCount: selectedCandidates.length,
    approvedCount: approvedCandidates.length,
    missingIds,
    duplicateIds,
    reviewedCandidates: reviewedCandidates.map((item) => ({
      candidateId: item.candidate.id,
      businessName: item.candidate.businessName,
      approvedForPreview: item.approvedForPreview,
      blockedReasons: item.blockedReasons,
      grade: item.freshQualification.grade,
      score: item.freshQualification.score,
    })),
    importBatchText,
    preview,
    moneySprintRunPacket,
    nextApiAction: reviewRequestComplete && approvedCandidates.length > 0 ? "human_review_money_sprint_packet" : "/api/revenue-engine/public-scout-run",
    nextAction: reviewRequestComplete && approvedCandidates.length > 0
      ? "Robert-approved candidates are ready for a controlled Money sprint run; execute moneySprintRunPacket only after final review of preview.acceptedSeeds."
      : duplicateIds.length > 0
        ? "Remove duplicate candidate IDs before generating a Money sprint packet."
        : missingIds.length > 0
          ? "Resolve missing candidate IDs before generating a Money sprint packet."
      : "Approve only verified public candidates with sourceUrl, recipientEmail and complete evidence before preview.",
    safety: {
      allowedAction: "review_public_candidates_for_preview_batch",
      blockedActions: ["automated scraping", "contact business", "buy data", "send outreach", "write preview files", "publish preview", "collect payment"],
      persistsLeads: false,
      persistsPublicCandidates: false,
      writesPreviewFiles: false,
      sendsOutreach: false,
      paidDataSpendUsd: 0,
      requiresRobertApproval: true,
    },
    snapshot: getRevenueEngineSnapshot(),
  };
}

export function buildRevenueMockup(input: RevenueMockupInput) {
  const niche = input.niche.toLowerCase();
  const isFood = includesAny(niche, ["restaurant", "cafe", "coffee", "bar", "bakery", "food"]);
  const isBeauty = includesAny(niche, ["salon", "spa", "beauty", "barber", "nail"]);
  const isFitness = includesAny(niche, ["gym", "fitness", "trainer", "yoga", "pilates"]);
  const isEvents = includesAny(niche, ["event", "club", "music", "venue", "techno"]);
  const accent = isFood ? "emerald" : isBeauty ? "rose" : isFitness ? "sky" : isEvents ? "fuchsia" : "amber";
  const marketPromise = isFood
    ? "convertir visitas en reservas, pedidos y catering"
    : isBeauty
      ? "convertir visitantes en citas y clientes recurrentes"
      : isFitness
        ? "convertir interes en trials, membresias y seguimiento"
        : isEvents
          ? "convertir audiencia en tickets, comunidad y drops"
          : "convertir atencion local en leads, llamadas y ventas";
  const pain = input.painPoint || (input.websiteStatus === "no_website" ? "No hay presencia web clara para convertir clientes." : "La experiencia actual no captura suficiente demanda.");
  const setupUsd = Math.max(1500, input.estimatedOfferUsd);
  const automationUsd = input.includeAutomation ? Math.max(750, Math.round(setupUsd * 0.35)) : 0;
  const totalUsd = setupUsd + automationUsd;
  const estimatedInternalCostUsd = Math.min(100, 18 + (input.includeAutomation ? 36 : 12));

  return {
    input,
    decision: {
      status: input.evidence.trim().length >= 12 ? "mockup_ready" : "needs_evidence",
      guardrail: "Preview interno. No publicar ni enviar al cliente sin QA y aprobacion humana.",
      nextAgent: input.evidence.trim().length >= 12 ? "qa-council" : "business-researcher",
    },
    visualSystem: {
      accent,
      layout: "full-bleed premium operational website",
      motion: "CSS/Three-style depth, floating product/service panels, animated conversion path",
      threeDSceneBrief: [
        `Escena 3D de ${input.businessName} como experiencia premium en ${input.area}.`,
        "Capas: marca al frente, oferta principal al centro, prueba social y CTA con profundidad.",
        "Movimiento lento y elegante; debe sentirse comercial, no decorativo.",
      ],
    },
    copy: {
      eyebrow: `${input.area} ${input.niche}`,
      headline: `${input.businessName} deserves a website that sells while the team works`,
      subheadline: `Una presencia premium para ${marketPromise}, con automatizaciones controladas y costo interno bajo.`,
      primaryCta: isFood ? "Reservar / Ordenar" : isBeauty ? "Agendar cita" : isFitness ? "Book a trial" : isEvents ? "Ver proximos eventos" : "Solicitar quote",
      secondaryCta: "Ver mockup completo",
    },
    sections: [
      {
        id: "hero",
        title: "Hero 3D de conversion",
        goal: "Mostrar marca, oferta y CTA en los primeros segundos.",
        blocks: ["headline", "CTA principal", "panel 3D con oferta", "trust strip"],
      },
      {
        id: "offers",
        title: isFood ? "Menu / ofertas" : isEvents ? "Eventos / drops" : "Servicios principales",
        goal: "Hacer que el cliente entienda que puede comprar, reservar o pedir informacion rapido.",
        blocks: ["cards filtrables", "precio/beneficio", "CTA por item", "tracking de clicks"],
      },
      {
        id: "proof",
        title: "Prueba y autoridad",
        goal: "Usar evidencia publica sin inventar claims.",
        blocks: ["reviews/fotos verificadas", "antes/despues", "ubicacion", "social proof"],
      },
      {
        id: "capture",
        title: "Captura de leads",
        goal: "No perder personas que no compran hoy.",
        blocks: ["form corto", "newsletter/updates", "lead source", "consentimiento opt-in"],
      },
      {
        id: "automation",
        title: "Automatizaciones vendibles",
        goal: "Reducir trabajo manual y mejorar seguimiento.",
        blocks: ["follow-up", "dashboard", "aprobacion humana", "reporte semanal"],
      },
    ],
    automations: input.includeAutomation
      ? [
          "Follow-up automatico a leads nuevos con aprobacion previa.",
          "Reporte semanal: leads, clicks, reservas/interes y costo.",
          "Pipeline simple para contacto, propuesta y cierre.",
          "Alertas cuando un formulario, CTA o checkout falla.",
        ]
      : ["Automation upsell preparado para fase 2."],
    offer: {
      packageName: input.primaryOffer || "Website 3D Premium + Automation Sprint",
      setupUsd,
      automationUsd,
      totalUsd,
      depositUsd: Math.round(totalUsd * 0.5),
      estimatedInternalCostUsd,
      insideCostCap: estimatedInternalCostUsd <= 100,
    },
    qa: [
      { agent: "business-researcher", check: "Evidencia publica marcada y sin claims inventados", result: input.evidence.trim().length >= 12 ? "pass" : "review" },
      { agent: "mockup-builder", check: "Hero, secciones, CTA y oferta estan listos para preview", result: "pass" },
      { agent: "automation-architect", check: "Automatizaciones tienen aprobacion humana y bajo costo", result: input.includeAutomation ? "pass" : "review" },
      { agent: "cost-controller", check: "Costo interno estimado bajo $100/mes", result: estimatedInternalCostUsd <= 100 ? "pass" : "block" },
      { agent: "closer", check: "No enviar hasta que Robert apruebe", result: "approval_required" },
    ],
    salesAngle: {
      problem: pain,
      pitch: `Preparamos una version premium de ${input.businessName} para mostrar como podria ${marketPromise}.`,
      comparison: input.websiteStatus === "no_website" ? "Antes: sin website claro. Despues: presencia premium con captura y seguimiento." : "Antes: website debil o poco accionable. Despues: experiencia con CTA, tracking y automatizacion.",
    },
  };
}

function renderRevenueMockupPreviewHtml(mockup: ReturnType<typeof buildRevenueMockup>) {
  const accentMap: Record<string, string> = {
    emerald: "#10b981",
    rose: "#fb7185",
    sky: "#38bdf8",
    fuchsia: "#d946ef",
    amber: "#f59e0b",
  };
  const accent = accentMap[mockup.visualSystem.accent] || accentMap.amber;
  const sections = mockup.sections.map((section) => `
    <section class="section">
      <p class="section-id">${escapeHtml(section.id)}</p>
      <h2>${escapeHtml(section.title)}</h2>
      <p>${escapeHtml(section.goal)}</p>
      <ul>${section.blocks.map((block) => `<li>${escapeHtml(block)}</li>`).join("")}</ul>
    </section>
  `).join("");
  const qa = mockup.qa.map((check) => `
    <li>
      <strong>${escapeHtml(check.agent)}</strong>
      <span>${escapeHtml(check.result)}</span>
      <small>${escapeHtml(check.check)}</small>
    </li>
  `).join("");
  const automations = mockup.automations.map((item) => `<li>${escapeHtml(item)}</li>`).join("");

  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1" />',
    `<title>${escapeHtml(mockup.input.businessName)} Revenue Mockup</title>`,
    "<style>",
    ":root{color-scheme:dark;--accent:" + accent + ";font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}",
    "*{box-sizing:border-box}body{margin:0;background:#0b0f14;color:#f8fafc}main{min-height:100vh}",
    ".hero{position:relative;overflow:hidden;min-height:82vh;display:grid;grid-template-columns:minmax(0,1.05fr) minmax(280px,.95fr);gap:32px;align-items:center;padding:56px clamp(20px,5vw,72px);background:linear-gradient(135deg,#0b0f14 0%,#111827 52%,#172033 100%)}",
    ".hero:before{content:'';position:absolute;inset:auto -12% -22% 46%;height:72%;background:radial-gradient(circle,var(--accent),transparent 58%);opacity:.18;filter:blur(12px)}",
    ".eyebrow{color:var(--accent);font-size:13px;font-weight:800;text-transform:uppercase;letter-spacing:.12em}.hero h1{font-size:clamp(40px,7vw,84px);line-height:.93;margin:14px 0 18px;letter-spacing:0}.hero p{max-width:760px;color:#cbd5e1;font-size:clamp(17px,2vw,22px);line-height:1.55}",
    ".actions{display:flex;gap:12px;flex-wrap:wrap;margin-top:26px}.btn{border:1px solid #334155;border-radius:8px;padding:13px 18px;color:#f8fafc;text-decoration:none;font-weight:800}.btn.primary{background:var(--accent);border-color:var(--accent);color:#061018}",
    ".device{position:relative;border:1px solid #334155;border-radius:24px;background:#101827;box-shadow:0 32px 80px rgba(0,0,0,.38);padding:18px;transform:perspective(1200px) rotateY(-9deg) rotateX(5deg)}.screen{border-radius:18px;background:#f8fafc;color:#0f172a;min-height:430px;padding:24px;display:grid;align-content:space-between}.screen h2{font-size:34px;line-height:1;margin:0}.screen .pill{display:inline-flex;width:max-content;border-radius:999px;background:#e2e8f0;padding:8px 12px;font-size:12px;font-weight:800}.metric-row{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}.metric{border:1px solid #cbd5e1;border-radius:10px;padding:12px}.metric strong{display:block;font-size:22px}",
    ".band{padding:42px clamp(20px,5vw,72px);border-top:1px solid #1e293b}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}.section{border:1px solid #263445;border-radius:8px;background:#101827;padding:20px}.section-id{margin:0;color:var(--accent);font-size:12px;font-weight:800;text-transform:uppercase}.section h2{margin:8px 0 10px;font-size:22px}.section p,.section li{color:#cbd5e1;line-height:1.55}.qa{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;padding:0;list-style:none}.qa li{border:1px solid #263445;border-radius:8px;padding:14px;background:#101827}.qa strong,.qa span,.qa small{display:block}.qa span{color:var(--accent);font-weight:900}.qa small{color:#cbd5e1;margin-top:6px;line-height:1.45}",
    ".offer{display:grid;grid-template-columns:1fr auto;gap:20px;align-items:center}.price{font-size:38px;font-weight:900;color:var(--accent)}.note{color:#94a3b8;font-size:13px;line-height:1.5}",
    "@media(max-width:860px){.hero{grid-template-columns:1fr;min-height:auto}.device{transform:none}.grid,.qa,.offer{grid-template-columns:1fr}.screen{min-height:340px}.metric-row{grid-template-columns:1fr}}",
    "</style>",
    "</head>",
    "<body>",
    "<main>",
    '<section class="hero">',
    "<div>",
    `<div class="eyebrow">${escapeHtml(mockup.copy.eyebrow)}</div>`,
    `<h1>${escapeHtml(mockup.copy.headline)}</h1>`,
    `<p>${escapeHtml(mockup.copy.subheadline)}</p>`,
    '<div class="actions">',
    `<a class="btn primary" href="#capture">${escapeHtml(mockup.copy.primaryCta)}</a>`,
    `<a class="btn" href="#offer">${escapeHtml(mockup.copy.secondaryCta)}</a>`,
    "</div>",
    "</div>",
    '<div class="device" aria-label="Website preview">',
    '<div class="screen">',
    `<span class="pill">${escapeHtml(mockup.offer.packageName)}</span>`,
    `<h2>${escapeHtml(mockup.input.businessName)}</h2>`,
    `<p>${escapeHtml(mockup.salesAngle.problem)}</p>`,
    '<div class="metric-row">',
    `<div class="metric"><strong>$${mockup.offer.setupUsd.toLocaleString("en-US")}</strong><span>Website</span></div>`,
    `<div class="metric"><strong>$${mockup.offer.automationUsd.toLocaleString("en-US")}</strong><span>Automation</span></div>`,
    `<div class="metric"><strong>$${mockup.offer.depositUsd.toLocaleString("en-US")}</strong><span>Deposit</span></div>`,
    "</div>",
    "</div>",
    "</div>",
    "</section>",
    `<section class="band"><div class="grid">${sections}</div></section>`,
    '<section class="band" id="offer">',
    '<div class="offer">',
    "<div>",
    "<h2>Offer ready for owner review</h2>",
    `<p>${escapeHtml(mockup.salesAngle.pitch)}</p>`,
    `<p class="note">${escapeHtml(mockup.decision.guardrail)}</p>`,
    "</div>",
    `<div class="price">$${mockup.offer.totalUsd.toLocaleString("en-US")}</div>`,
    "</div>",
    "</section>",
    '<section class="band" id="capture">',
    "<h2>Automation upsell</h2>",
    `<ul>${automations}</ul>`,
    "</section>",
    '<section class="band">',
    "<h2>QA gates before contact</h2>",
    `<ul class="qa">${qa}</ul>`,
    "</section>",
    "</main>",
    "</body>",
    "</html>",
  ].join("\n");
}

export function buildRevenueMockupPreview(input: RevenueMockupInput, options: { writeFile?: boolean } = {}) {
  const parsed = revenueMockupSchema.parse(input);
  const mockup = buildRevenueMockup(parsed);
  const slug = `${slugifyRevenueValue(parsed.businessName)}-${slugifyRevenueValue(parsed.area)}-${Date.now()}`;
  const previewDir = path.join(getRevenueMockupsDir(), slug);
  const previewPath = path.join(previewDir, "index.html");
  const html = renderRevenueMockupPreviewHtml(mockup);
  const shouldWrite = options.writeFile !== false;

  if (shouldWrite) {
    fs.mkdirSync(previewDir, { recursive: true });
    fs.writeFileSync(previewPath, html, "utf8");
  }

  return {
    status: mockup.decision.status,
    slug,
    previewUrl: `/api/revenue-engine/mockup-previews/${slug}`,
    fileWritten: shouldWrite,
    htmlBytes: Buffer.byteLength(html, "utf8"),
    mockup,
    guardrails: [
      "Preview local solamente; no publicar ni enviar sin aprobacion humana.",
      "No usa claims privados ni datos inventados.",
      "No requiere hosting pagado antes de deposito.",
    ],
    nextAction:
      mockup.decision.status === "mockup_ready"
        ? "Revisar preview, crear outreach draft y pedir aprobacion antes de contactar."
        : "Completar evidencia publica antes de usar el preview en ventas.",
  };
}

export function getRevenueMockupPreviewPath(slug: string) {
  if (!/^[a-z0-9-]{1,120}$/.test(slug)) {
    throw new Error("Invalid mockup preview slug.");
  }
  const root = path.resolve(getRevenueMockupsDir());
  const previewPath = path.resolve(root, slug, "index.html");
  if (!previewPath.startsWith(`${root}${path.sep}`)) {
    throw new Error("Invalid mockup preview path.");
  }
  return previewPath;
}

export function buildRevenueMockupTemplatePack(input: RevenueMockupTemplatePackInput) {
  const monthlyCostCapUsd = 100;
  const dailyAiCostUsd = roundMoney(input.dailyMockupTarget * input.estimatedAiCostPerMockupUsd);
  const monthlyAiCostUsd = roundMoney(dailyAiCostUsd * 30);
  const productionMinutesPerDay = input.dailyMockupTarget * input.maxCustomMinutesPerMockup;
  const isZeroCostMode = input.estimatedAiCostPerMockupUsd === 0;
  const isInsideMonthlyCap = monthlyAiCostUsd <= monthlyCostCapUsd;
  const nicheLabel = input.niche.toLowerCase();
  const isBeauty = includesAny(nicheLabel, ["spa", "salon", "beauty", "nail", "aesthetic"]);
  const isFitness = includesAny(nicheLabel, ["gym", "fitness", "trainer", "pilates", "yoga"]);
  const isFood = includesAny(nicheLabel, ["restaurant", "cafe", "coffee", "bar", "bakery", "food"]);
  const isEvents = includesAny(nicheLabel, ["event", "club", "venue", "music", "nightlife"]);
  const primaryCta = isBeauty
    ? "Book my consult"
    : isFitness
      ? "Claim a trial"
      : isFood
        ? "Reserve / order"
        : isEvents
          ? "Get tickets"
          : "Request quote";

  const sharedSwapFields = [
    "businessName",
    "area",
    "primaryOffer",
    "public photos or free image placeholders",
    "reviews/social proof",
    "contact CTA",
  ];

  const templates = [
    {
      id: "shock_hero_booking",
      name: "Shock Hero + Booking",
      bestFor: "Leads sin website o con presencia muy vieja que necesitan impacto inmediato.",
      blocks: ["full-bleed cinematic hero", "sticky booking CTA", "floating service cards", "trust strip", "fast quote form"],
      swapFields: sharedSwapFields,
      animationHooks: ["mouse spotlight", "floating 3D device", "scroll reveal", "CTA shine"],
      assetPolicy: "Usar fotos publicas verificables del negocio si existen; si no, placeholders gratuitos sin claims falsos.",
      automationUpsell: "Booking follow-up + owner alert + weekly lead report.",
      qualityGate: "Debe verse premium en mobile primero y tener CTA visible sin scroll.",
    },
    {
      id: "before_after_revenue",
      name: "Before / After Revenue Story",
      bestFor: "Negocios con website debil donde conviene mostrar transformacion clara.",
      blocks: ["before/after split", "lost revenue callouts", "upgrade path", "proof panel", "proposal CTA"],
      swapFields: [...sharedSwapFields, "current website weakness", "new conversion promise"],
      animationHooks: ["before/after slider", "metric counters", "depth cards", "section parallax"],
      assetPolicy: "Capturas del website actual solo como referencia interna; no publicar comparativas agresivas sin aprobacion.",
      automationUpsell: "Lead source tracking + abandoned inquiry follow-up.",
      qualityGate: "Debe explicar el dinero perdido sin sonar ofensivo para el owner.",
    },
    {
      id: "owner_dashboard",
      name: "Owner Dashboard Demo",
      bestFor: "Owners que compran cuando ven control, reportes y automatizacion.",
      blocks: ["premium site preview", "lead pipeline", "weekly report", "approval queue", "ROI panel"],
      swapFields: [...sharedSwapFields, "lead sources", "sales stages", "weekly KPI names"],
      animationHooks: ["live dashboard pulse", "pipeline movement", "approval queue highlight", "chart counters"],
      assetPolicy: "Datos demo claramente marcados como estimados; no inventar volumen real.",
      automationUpsell: "Dashboard mensual + CRM ligero + follow-up aprobado por humano.",
      qualityGate: "Debe vender el retainer mensual, no solo el website.",
    },
    {
      id: "premium_offer_stack",
      name: "Premium Offer Stack",
      bestFor: "Servicios con paquetes, tratamientos, membresias, menus o tickets.",
      blocks: ["offer grid", "best-seller highlight", "bundles", "FAQ objections", "checkout/contact CTA"],
      swapFields: [...sharedSwapFields, "service list", "price anchors", "bundle names"],
      animationHooks: ["card tilt", "offer hover states", "sticky compare bar", "limited slot ticker"],
      assetPolicy: "Precios como placeholders si no estan publicados; marcar como editable.",
      automationUpsell: "Quote intake + package recommendation + reminder sequence.",
      qualityGate: "Debe hacer facil elegir una opcion en menos de 20 segundos.",
    },
    {
      id: "social_proof_local",
      name: "Local Proof + Community",
      bestFor: "Negocios que viven de reviews, Instagram, eventos, referrals o barrio.",
      blocks: ["review wall", "location strip", "Instagram-style gallery", "map CTA", "referral capture"],
      swapFields: [...sharedSwapFields, "review snippets", "neighborhood", "social links"],
      animationHooks: ["review marquee", "gallery drift", "map pulse", "social proof reveal"],
      assetPolicy: "Solo usar reviews o fotos publicas verificables; si falta data, usar estructura sin nombres reales.",
      automationUpsell: "Review request automation + referral capture + local campaign report.",
      qualityGate: "Debe sentirse local y confiable, no como template generico.",
    },
  ];

  return {
    status: isInsideMonthlyCap ? "ready" : "needs_spend_approval",
    pack: {
      name: `${input.area} ${input.niche} Premium Mockup Pack`,
      niche: input.niche,
      area: input.area,
      templateCount: templates.length,
      targetPositioning: "websites que parecen de alto ticket, producidos con templates reutilizables y costo casi cero",
    },
    costModel: {
      hostingCostUsd: 0,
      paidAssetCostUsd: 0,
      estimatedAiCostPerMockupUsd: input.estimatedAiCostPerMockupUsd,
      dailyAiCostUsd,
      monthlyAiCostUsd,
      targetCostPerMockupUsd: input.estimatedAiCostPerMockupUsd,
      monthlyCostCapUsd,
      insideZeroCostMode: isZeroCostMode,
      insideMonthlyCap: isInsideMonthlyCap,
      spendPolicy: isZeroCostMode
        ? "Modo $0: HTML/CSS/JS, assets gratuitos/publicos y aprobacion humana antes de contactar."
        : "Costo AI visible. No subir volumen si el mes supera el cap o si Robert no aprueba.",
    },
    productionTargets: {
      dailyMockupTarget: input.dailyMockupTarget,
      maxCustomMinutesPerMockup: input.maxCustomMinutesPerMockup,
      productionMinutesPerDay,
      estimatedMockupsPerMonth: input.dailyMockupTarget * 30,
      recommendedContactLimitPerDay: Math.max(3, Math.min(15, Math.floor(input.dailyMockupTarget * 1.25))),
    },
    templates,
    productionLine: [
      { step: "lead-evidence", ownerAgent: "business-researcher", output: "fotos, servicios, reviews, contacto y dolor real" },
      { step: "template-match", ownerAgent: "mockup-builder", output: "elegir 1 de 5 templates segun el negocio" },
      { step: "swap-and-polish", ownerAgent: "mockup-builder", output: "copiar data publica, CTA, fotos y oferta" },
      { step: "premium-motion-pass", ownerAgent: "visual-qa", output: "animaciones, mobile, hero shock y contraste" },
      { step: "sales-draft", ownerAgent: "closer", output: `mensaje con ${primaryCta}, comparacion y aprobacion antes de enviar` },
    ],
    pricingRecommendation: {
      entryMockupWebsiteUsd: 500,
      proWebsiteUsd: 1500,
      automationBundleUsd: 2500,
      monthlyRetainerUsd: 300,
      note: "Vender el entry barato para cerrar rapido; subir con automatizacion, reportes y mantenimiento.",
    },
    guardrails: [
      "No pagar hosting para previews: usar archivo local/static o free tier hasta que paguen.",
      "No comprar assets para demos frios.",
      "No enviar outreach externo sin aprobacion de Robert.",
      "No inventar reviews, resultados, precios reales o certificaciones.",
      "Si monthlyAiCostUsd supera el cap, pausar o pedir aprobacion.",
    ],
    nextActions: [
      `Crear ${templates.length} HTML bases por nicho y reusar para ${input.area}.`,
      `Producir ${input.dailyMockupTarget} mockups/dia maximo con QA visual.`,
      "Contactar solo los mejores leads con mockup listo y mensaje personalizado.",
      "Medir replies, calls booked y cierres para que el sistema mejore el template ganador.",
    ],
  };
}

export function buildRevenueLaunchReadiness(input: RevenueLaunchReadinessInput) {
  const parsed = revenueLaunchReadinessSchema.parse(input);
  const emailProvider = getRevenueEmailProviderStatus();
  const manualContactChannels = ["contact_form", "phone_permission", "gmail_or_mailto_manual"] as const;
  const launchItems: Array<{
    id: string;
    label: string;
    status: "ready" | "pending_allowed" | "blocked";
    evidence: string;
    nextStep: string;
  }> = [
    {
      id: "market",
      label: "Primer mercado decidido",
      status: "ready" as const,
      evidence: `${parsed.niche} en ${parsed.area}.`,
      nextStep: "Mantener el primer sprint enfocado; no abrir mas nichos hasta tener replies.",
    },
    {
      id: "lead_radar",
      label: "Radar de leads 24/7",
      status: "ready" as const,
      evidence: `${parsed.dailyResearchTarget} candidatos/dia, research publico gratis, gasto $0.`,
      nextStep: "Buscar en Google Maps/listings/websites publicos y guardar evidencia.",
    },
    {
      id: "qualification",
      label: "Scoring y pipeline",
      status: "ready" as const,
      evidence: "recordRevenueLead califica no_website/weak_website, contacto, evidencia, dolor y ticket.",
      nextStep: "Registrar solo leads con contacto verificable y oportunidad clara.",
    },
    {
      id: "mockup_factory",
      label: "Fabrica de mockups premium",
      status: "ready" as const,
      evidence: "Template factory tiene 5 rutas premium reutilizables con $0 hosting y $0 assets pagos.",
      nextStep: `Crear ${parsed.dailyMockupTarget} mockups/dia para leads A/B.`,
    },
    {
      id: "manual_outreach",
      label: "Contacto manual aprobado",
      status: "ready" as const,
      evidence: `Canales activos sin email API: ${manualContactChannels.join(", ")}.`,
      nextStep: `Contactar max ${parsed.dailyContactTarget}/dia por contact form, llamada corta o Gmail/mailto manual.`,
    },
    {
      id: "email_sender",
      label: "Correo de negocio/API",
      status: emailProvider.configured && !parsed.emailPending ? "ready" as const : "pending_allowed" as const,
      evidence: emailProvider.configured
        ? `${emailProvider.provider} configurado con ${emailProvider.fromEmail}.`
        : `Pendiente permitido: ${emailProvider.missing.join(" + ") || "sender DNS/proveedor"}.`,
      nextStep: "Dejarlo pendiente por ahora; no bloquea contacto manual ni drafts.",
    },
    {
      id: "sales_offer",
      label: "Oferta y precio",
      status: "ready" as const,
      evidence: "Entry $500, website pro $1,500+, bundle automation $2,500+, retainer $300+/mes.",
      nextStep: "Abrir barato para cerrar rapido y subir con automation/reporting.",
    },
    {
      id: "money_guard",
      label: "Profit Guard",
      status: "ready" as const,
      evidence: "Cap $100/mes, gasto externo bloqueado hasta cash/aprobacion.",
      nextStep: "No pagar data/tools/ads antes de deposito o cash cobrado.",
    },
    {
      id: "delivery",
      label: "Entrega y QA",
      status: "ready" as const,
      evidence: "Delivery workspace bloquea entrega hasta scope, deposito, QA visual/tecnica/automation y rollback.",
      nextStep: "Cuando cierre un deal, crear workspace y entregar solo con QA verde.",
    },
  ];
  const pending = launchItems.filter((item) => item.status === "pending_allowed");
  const blocked = launchItems.filter((item) => item.status === "blocked");
  const ready = launchItems.filter((item) => item.status === "ready").length;

  return {
    status: blocked.length > 0 ? "blocked" as const : "ready_to_start" as const,
    summary: blocked.length > 0
      ? "Hay bloqueos antes de empezar."
      : pending.length === 1 && pending[0].id === "email_sender"
        ? "Listo para empezar a vender; solo falta configurar el correo de negocio/API."
        : "Listo para empezar a vender con contacto manual aprobado.",
    market: {
      area: parsed.area,
      niche: parsed.niche,
      firstSprintDays: 7,
      goal: "conseguir replies, llamadas o primer deposito con costo $0",
    },
    launchScore: Math.round((ready / launchItems.length) * 100),
    ready,
    pendingAllowed: pending.length,
    blocked: blocked.length,
    items: launchItems,
    manualStartPlan: [
      `Dia 1: buscar ${parsed.dailyResearchTarget} candidatos publicos y guardar 20-30 con evidencia.`,
      `Dia 1: seleccionar 10 leads A/B; crear ${parsed.dailyMockupTarget} mockups premium.`,
      `Dia 1-2: preparar ${parsed.dailyContactTarget} drafts personalizados, sin envio automatico.`,
      "Dia 2: contactar por contact form/Gmail manual y llamar solo los mejores para pedir permiso de enviar mockup.",
      "Dia 3-7: registrar replies, objeciones, calls booked y cualquier cash en ledger/improvement review.",
    ],
    contactScripts: {
      contactForm:
        "Hola, vi que su negocio tiene buena presencia/reviews, pero hay una oportunidad clara de convertir mas citas con una pagina premium y follow-up. Prepare una idea visual rapida. Si te parece, te la puedo mandar para revisarla.",
      phonePermission:
        "Hola, soy Robert. Vi algo puntual que podria mejorar su website/booking y prepare una idea visual corta. No es una llamada de venta larga; solo queria preguntar a que correo o contacto se la puedo mandar.",
      followUp:
        "Te mande una idea visual basada en informacion publica del negocio. Si quieres, puedo dejar una version inicial lista esta semana desde $500 y luego sumarle booking/follow-up.",
    },
    doNotDoYet: [
      "No enviar volumen masivo.",
      "No comprar data, ads, domains extra o herramientas.",
      "No prometer resultados garantizados.",
      "No usar reviews/fotos privadas ni claims inventados.",
      "No entregar nada sin deposito/scope/QA.",
    ],
    emailPending: {
      isPending: !emailProvider.configured || parsed.emailPending,
      providerConfigured: emailProvider.configured,
      missing: emailProvider.missing,
      allowedWhilePending: ["research", "lead scoring", "mockups", "outreach drafts", "contact forms", "manual Gmail/mailto", "phone permission calls"],
    },
  };
}

export function buildRevenueProjectPlan(input: RevenueProjectPlanInput) {
  const grossMarginUsd = input.monthlyRetainerUsd - input.estimatedInternalCostUsd;
  const grossMarginPercent = input.monthlyRetainerUsd > 0 ? Math.round((grossMarginUsd / input.monthlyRetainerUsd) * 100) : 0;
  const missing = [
    !input.scopeApproved && "scope aprobado",
    !input.depositPaid && "deposito pagado",
    !input.publicDataVerified && "data publica verificada",
    input.estimatedInternalCostUsd > 100 && "costo interno bajo $100/mes",
    grossMarginPercent < 65 && "margen mensual >= 65%",
  ].filter(Boolean) as string[];
  const status = missing.some((item) => ["deposito pagado", "costo interno bajo $100/mes", "margen mensual >= 65%"].includes(item))
    ? "blocked"
    : missing.length > 0
      ? "needs_scope"
      : "ready_to_build";
  const phases = [
    {
      id: "intake",
      name: "Intake y evidencia",
      ownerAgent: "business-researcher",
      days: 1,
      tasks: [
        "Confirmar alcance, precio, timeline y decision maker.",
        "Guardar fuentes publicas usadas para copy, fotos, servicios y claims.",
        "Marcar datos inciertos para aprobacion del cliente.",
      ],
    },
    {
      id: "build",
      name: input.projectType === "automation" ? "Build automation" : "Build website",
      ownerAgent: input.projectType === "automation" ? "automation-architect" : "mockup-builder",
      days: Math.max(2, Math.min(4, input.launchTargetDays - 3)),
      tasks: input.projectType === "automation"
        ? [
            "Mapear trigger, datos, aprobaciones y rollback.",
            "Crear flujo minimo rentable con logs y datos de ejemplo.",
            "Preparar dashboard simple para resultados.",
          ]
        : [
            "Construir hero premium, secciones, CTAs y captura de leads.",
            "Crear estructura responsive mobile/desktop.",
            "Conectar tracking basico y formularios en modo prueba.",
          ],
    },
    {
      id: "automation",
      name: "Automation sprint",
      ownerAgent: "automation-architect",
      days: input.includesAutomation ? 2 : 0,
      tasks: input.includesAutomation
        ? [
            "Configurar follow-up con aprobacion humana antes de mensajes sensibles.",
            "Crear reporte semanal de leads, clicks, reservas/interes y costo.",
            "Definir fallback manual si una integracion falla.",
          ]
        : ["Mantener automation como upsell fase 2."],
    },
    {
      id: "qa",
      name: "QA council",
      ownerAgent: "qa-council",
      days: 1,
      tasks: [
        "Probar mobile, desktop, copy largo, CTAs, links y forms.",
        "Correr pruebas de automatizacion con datos falsos.",
        "Confirmar costo, margen, rollback y aprobacion final de Robert.",
      ],
    },
    {
      id: "handoff",
      name: "Entrega y mejora",
      ownerAgent: "growth-director",
      days: 1,
      tasks: [
        "Entregar demo controlado, checklist y siguientes mejoras.",
        "Registrar venta/gasto en ledger.",
        "Programar review semanal de resultados y objeciones.",
      ],
    },
  ];

  return {
    input,
    decision: {
      status,
      missing,
      mode: "human_approval_required_for_launch",
      reason:
        status === "ready_to_build"
          ? "Listo para construir con subagentes y QA antes de entregar."
          : status === "needs_scope"
            ? "Puede prepararse internamente, pero falta evidencia/aprobacion antes de build completo."
            : "Bloqueado: no construir, lanzar ni enviar hasta resolver gates criticos.",
    },
    budget: {
      setupUsd: input.setupUsd,
      requiredDepositUsd: Math.round(input.setupUsd * 0.5),
      monthlyRetainerUsd: input.monthlyRetainerUsd,
      estimatedInternalCostUsd: input.estimatedInternalCostUsd,
      grossMarginUsd,
      grossMarginPercent,
      insideCostCap: input.estimatedInternalCostUsd <= 100,
    },
    phases,
    subagentCorrections: [
      { agent: "business-researcher", corrects: "claims inventados, datos sin fuente, negocio mal entendido" },
      { agent: "mockup-builder", corrects: "CTA flojo, hero generico, layout no vendible, mobile roto" },
      { agent: "automation-architect", corrects: "flujo sin rollback, mensajes sin aprobacion, costo oculto" },
      { agent: "cost-controller", corrects: "gasto sobre $100/mes, margen bajo, tools innecesarias" },
      { agent: "qa-council", corrects: "links/forms rotos, responsive, entrega sin checklist" },
      { agent: "closer", corrects: "propuesta confusa, precio sin deposito, promesas no aprobadas" },
    ],
    deliveryGates: [
      { gate: "scope", passed: input.scopeApproved, fix: "Conseguir aprobacion escrita del scope." },
      { gate: "deposit", passed: input.depositPaid, fix: "Cobrar deposito antes de construir/lanzar." },
      { gate: "data", passed: input.publicDataVerified, fix: "Verificar fuentes publicas y quitar claims dudosos." },
      { gate: "cost", passed: input.estimatedInternalCostUsd <= 100, fix: "Reducir herramientas o subir retainer." },
      { gate: "margin", passed: grossMarginPercent >= 65, fix: "Subir precio mensual o recortar alcance." },
    ],
    doneDefinition: [
      "Cliente aprueba scope y deposito.",
      "Website/mockup responsive probado.",
      "Automatizaciones probadas con datos de ejemplo y aprobacion humana.",
      "Rollback/manual fallback documentado.",
      "Ledger actualizado con ingreso, cash y costo.",
      "Review semanal creado para mejorar el sistema.",
    ],
  };
}

function scaffoldFileName(value: string) {
  return slugifyRevenueValue(value).replace(/[^a-z0-9-]/g, "") || "client-website";
}

function buildRevenueWebsiteScaffoldFilesHash(files: Array<{ path: string; purpose: string; content: string }>) {
  const payload = files.map((file) => ({
    path: file.path,
    purpose: file.purpose,
    content: file.content,
  }));

  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export function buildRevenueWebsiteScaffold(input: RevenueWebsiteScaffoldInput) {
  return buildRevenueWebsiteScaffoldInternal(input, { allowInternalPreview: false });
}

function buildRevenueWebsiteScaffoldInternal(
  input: RevenueWebsiteScaffoldInput,
  options: { allowInternalPreview: boolean },
) {
  const parsed = revenueWebsiteScaffoldSchema.parse(input);
  const projectPlan = buildRevenueProjectPlan({
    clientName: parsed.clientName,
    projectType: parsed.projectType === "automation" ? "website" : parsed.projectType,
    packageName: parsed.packageName,
    setupUsd: parsed.setupUsd,
    monthlyRetainerUsd: parsed.monthlyRetainerUsd,
    estimatedInternalCostUsd: parsed.estimatedInternalCostUsd,
    depositPaid: parsed.depositPaid,
    scopeApproved: parsed.scopeApproved,
    publicDataVerified: parsed.publicDataVerified,
    includesAutomation: parsed.includesAutomation,
    launchTargetDays: parsed.launchTargetDays,
    clientRequest: parsed.clientRequest,
  });
  const canGeneratePreview = projectPlan.decision.status === "ready_to_build" && options.allowInternalPreview;
  const slug = scaffoldFileName(`${parsed.clientName}-${parsed.area}`);
  const headline = `${parsed.clientName} turns local interest into booked demand`;
  const subheadline = `${parsed.niche} in ${parsed.area} with a conversion-focused website, verified public proof and clear next steps.`;
  const contactHref = parsed.contactEmail ? `mailto:${parsed.contactEmail}` : "#contact";
  const files = canGeneratePreview ? [
    {
      path: `${slug}/index.html`,
      purpose: "Client website static preview entry point.",
      content: [
        "<!doctype html>",
        '<html lang="en">',
        "<head>",
        '  <meta charset="utf-8" />',
        '  <meta name="viewport" content="width=device-width, initial-scale=1" />',
        `  <title>${escapeHtml(parsed.clientName)} | ${escapeHtml(parsed.packageName)}</title>`,
        '  <link rel="stylesheet" href="./styles.css" />',
        "</head>",
        "<body>",
        '  <main class="page-shell">',
        '    <section class="hero">',
        `      <p class="eyebrow">${escapeHtml(parsed.area)} ${escapeHtml(parsed.niche)}</p>`,
        `      <h1>${escapeHtml(headline)}</h1>`,
        `      <p>${escapeHtml(subheadline)}</p>`,
        `      <a class="primary-cta" href="${escapeHtml(contactHref)}">${escapeHtml(parsed.primaryCta)}</a>`,
        "    </section>",
        '    <section class="proof-grid" aria-label="Public proof and offer">',
        `      <article><h2>Public signal</h2><p>${escapeHtml(parsed.publicEvidence)}</p></article>`,
        `      <article><h2>Problem to solve</h2><p>${escapeHtml(parsed.painPoint)}</p></article>`,
        `      <article><h2>Website status</h2><p>${escapeHtml(parsed.websiteStatus.replace("_", " "))}</p></article>`,
        "    </section>",
        '    <section class="offer" id="contact">',
        `      <h2>${escapeHtml(parsed.packageName)}</h2>`,
        `      <p>Setup: $${parsed.setupUsd.toLocaleString("en-US")} | Monthly support: $${parsed.monthlyRetainerUsd.toLocaleString("en-US")}</p>`,
        "      <p>Lead capture, mobile-first sections, local proof, conversion CTA and optional approved follow-up automation.</p>",
        "    </section>",
        "  </main>",
        "</body>",
        "</html>",
      ].join("\n"),
    },
    {
      path: `${slug}/styles.css`,
      purpose: "Responsive styling for the generated website preview.",
      content: [
        ":root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif; }",
        "* { box-sizing: border-box; }",
        "body { margin: 0; background: #f7f4ef; color: #172026; }",
        ".page-shell { min-height: 100vh; }",
        ".hero { min-height: 62vh; display: grid; align-content: center; gap: 20px; padding: clamp(32px, 7vw, 96px); background: #102a2c; color: white; }",
        ".eyebrow { margin: 0; text-transform: uppercase; letter-spacing: 0; font-size: 0.82rem; color: #a7e0d1; }",
        "h1 { max-width: 900px; margin: 0; font-size: clamp(2.4rem, 7vw, 5.8rem); line-height: 0.95; letter-spacing: 0; }",
        ".hero p { max-width: 720px; font-size: 1.1rem; line-height: 1.6; }",
        ".primary-cta { width: fit-content; display: inline-flex; padding: 14px 18px; border-radius: 8px; background: #f3c15f; color: #172026; text-decoration: none; font-weight: 700; }",
        ".proof-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 1px; background: #d8d1c6; }",
        "article, .offer { background: #fffaf2; padding: clamp(24px, 4vw, 48px); }",
        "article h2, .offer h2 { margin-top: 0; font-size: 1.4rem; letter-spacing: 0; }",
        "article p, .offer p { line-height: 1.6; color: #384248; }",
        "@media (max-width: 760px) { .proof-grid { grid-template-columns: 1fr; } h1 { font-size: 2.7rem; } }",
      ].join("\n"),
    },
    {
      path: `${slug}/README.md`,
      purpose: "Operator handoff for the website scaffold.",
      content: [
        `# ${parsed.clientName} Website Scaffold`,
        "",
        `Package: ${parsed.packageName}`,
        `Source: ${parsed.sourceUrl || "public source URL not provided"}`,
        "",
        "This scaffold is an internal preview package. Do not deploy, publish, contact the client, or charge the client from this artifact alone.",
        "",
        "Required before client use:",
        ...projectPlan.doneDefinition.map((item) => `- ${item}`),
      ].join("\n"),
    },
    {
      path: `${slug}/qa-checklist.md`,
      purpose: "QA checklist before any preview link or client handoff.",
      content: [
        "# QA Checklist",
        "",
        ...projectPlan.deliveryGates.map((gate) => `- [${gate.passed ? "x" : " "}] ${gate.gate}: ${gate.fix}`),
        "- [ ] Responsive visual QA passed on mobile and desktop.",
        "- [ ] Links, contact CTA and forms tested with sample data.",
        "- [ ] App QA target evidence attached before deploy.",
        "- [ ] Robert approved any preview link, deploy or client handoff.",
      ].join("\n"),
    },
  ] : [];

  return {
    status: canGeneratePreview ? "ready_for_internal_preview" as const : "blocked" as const,
    slug,
    projectPlan,
    files,
    fileCount: files.length,
    canWriteFiles: false,
    canDeploy: false,
    deployBlockedUntil: [
      "App QA target evidence",
      "Robert deploy approval",
      "production host/project selected",
      "rollback plan verified",
    ],
    safety: {
      allowedAction: "generate_internal_website_scaffold",
      blockedActions: [
        "generate scaffold without audited website creation approval",
        "deploy website",
        "publish preview",
        "contact client",
        "collect payment",
        "use unverified public claims",
      ],
      writesFiles: false,
      deploys: false,
      sendsOutreach: false,
    },
  };
}

export function buildRevenueWebsiteCreationPacket(input: RevenueWebsiteCreationPacketInput) {
  const parsed = revenueWebsiteCreationPacketSchema.parse(input);
  loadRevenueOutreach();
  loadRevenueLeads();
  loadRevenueApprovalDecisions();
  const draft = revenueOutreachDrafts.find((item) => item.id === parsed.outreachDraftId);
  const approvalDecision = parsed.approvalDecisionId
    ? revenueApprovalDecisions.find((item) => item.id === parsed.approvalDecisionId)
    : null;
  const websiteCreationProof = {
    robertApprovedBuild: parsed.robertApprovedBuild,
    clientApprovedScope: parsed.clientApprovedScope,
    depositPaid: parsed.depositPaid,
    publicDataVerified: parsed.publicDataVerified,
    launchTargetDays: parsed.launchTargetDays,
  };
  const expectedTargetId = buildRevenueWebsiteCreationApprovalTargetId(parsed.outreachDraftId);
  const expectedSnapshotHash = draft ? buildRevenueWebsiteCreationSnapshotHash(draft, websiteCreationProof) : "";
  const approvalDecisionReady = Boolean(
    draft
    && approvalDecision
    && approvalDecision.targetType === "delivery_workspace"
    && approvalDecision.targetId === expectedTargetId
    && approvalDecision.decision === "approved"
    && approvalDecision.guardrail.status === "recorded"
    && approvalDecision.approvalSource === "website_creation_approval_cli"
    && approvalDecision.websiteCreationSnapshotHash === expectedSnapshotHash,
  );
  const lead = draft?.leadId
    ? revenueLeads.find((item) => item.id === draft.leadId)
    : draft
      ? revenueLeads.find((item) => item.businessName.toLowerCase() === draft.businessName.toLowerCase())
      : undefined;
  const sourceUrl = draft?.sourceUrl || draft?.mockupUrl || "";
  const setupUsd = draft ? draft.pricing.totalSetupUsd : 3500;
  const automationPriceUsd = draft ? draft.automationPriceUsd : 0;
  const monthlyRetainerUsd = draft ? draft.pricing.monthlyRetainerUsd : 750;
  const estimatedInternalCostUsd = draft ? draft.pricing.estimatedInternalMonthlyCostUsd : 54;
  const publicEvidence = [
    draft?.businessSummary,
    lead?.evidence,
  ].filter((item): item is string => Boolean(item && item.trim().length > 0)).join(" ");
  const painPoint = lead?.painPoint || "Needs a conversion-focused website, lead capture and follow-up path.";
  const hasDraft = Boolean(draft);
  const draftReady = Boolean(draft && (draft.status === "approved" || draft.delivery.sendStatus === "sent"));
  const hasCommercialProof = parsed.clientApprovedScope && parsed.depositPaid && parsed.publicDataVerified && parsed.robertApprovedBuild && approvalDecisionReady;
  const unsafeActionRequested = parsed.writeFiles || parsed.deployWebsite;
  const gates = [
    { gate: "outreach_draft", passed: hasDraft, fix: "Seleccionar un draft de outreach existente." },
    { gate: "draft_ready", passed: draftReady, fix: "Usar un draft aprobado o enviado, no un draft bloqueado/sin aprobar." },
    { gate: "approval_decision", passed: approvalDecisionReady, fix: "Registrar y usar approvalDecisionId valido para este website handoff exacto." },
    { gate: "robert_build_approval", passed: parsed.robertApprovedBuild, fix: "Robert debe aprobar crear el website antes de preparar build." },
    { gate: "scope", passed: parsed.clientApprovedScope, fix: "Conseguir aprobacion escrita del scope del cliente." },
    { gate: "deposit", passed: parsed.depositPaid, fix: "Cobrar deposito antes de construir/lanzar." },
    { gate: "public_data", passed: parsed.publicDataVerified, fix: "Verificar datos publicos y quitar claims dudosos." },
    { gate: "safe_mode", passed: !unsafeActionRequested, fix: "Este paquete no escribe archivos ni despliega; usar handoff/PR/QA separado." },
  ];
  const failedGates = gates.filter((gate) => !gate.passed);
  const scaffoldInput: RevenueWebsiteScaffoldInput | null = draft ? {
    clientName: draft.businessName,
    projectType: automationPriceUsd > 0 ? "bundle" : "website",
    packageName: automationPriceUsd > 0 ? "Website 3D Premium + Automation Sprint" : "Website 3D Premium",
    setupUsd,
    monthlyRetainerUsd,
    estimatedInternalCostUsd,
    depositPaid: parsed.depositPaid,
    scopeApproved: parsed.clientApprovedScope,
    publicDataVerified: parsed.publicDataVerified,
    includesAutomation: automationPriceUsd > 0,
    launchTargetDays: parsed.launchTargetDays,
    clientRequest: `Create paid client website handoff from outreach draft ${draft.id}.`,
    area: lead?.area || "Miami",
    niche: lead?.niche || "local service",
    websiteStatus: lead?.websiteStatus || "unknown",
    sourceUrl,
    publicEvidence: publicEvidence.trim().slice(0, 2000) || "Public evidence must be verified before build.",
    painPoint,
    primaryCta: "Book a consultation",
    contactEmail: draft.recipientEmail,
  } : null;
  const scaffold = failedGates.length === 0 && scaffoldInput
    ? buildRevenueWebsiteScaffoldInternal(scaffoldInput, { allowInternalPreview: true })
    : null;
  const readyForWebsiteCreation = Boolean(scaffold && scaffold.status === "ready_for_internal_preview");

  return {
    status: readyForWebsiteCreation ? "ready_for_website_creation_handoff" as const : "blocked" as const,
    outreachDraftId: parsed.outreachDraftId,
    draft: draft ? {
      id: draft.id,
      businessName: draft.businessName,
      status: draft.status,
      sendStatus: draft.delivery.sendStatus,
      channel: draft.channel,
      recipientEmail: draft.recipientEmail,
      sourceUrl,
    } : null,
    lead: lead ? {
      id: lead.id,
      businessName: lead.businessName,
      area: lead.area,
      niche: lead.niche,
      websiteStatus: lead.websiteStatus,
      status: lead.status,
    } : null,
    gates,
    blockedReasons: failedGates.map((gate) => gate.fix),
    scaffoldInput,
    scaffold,
    nextApiAction: readyForWebsiteCreation ? "/api/revenue-engine/website-scaffold" : "/api/revenue-engine/outreach-approval-packet",
    nextAction: readyForWebsiteCreation
      ? "Use scaffold files as an internal handoff only; open PR/App QA before any publish or deploy."
      : "Resolve gates before creating website scaffold handoff.",
    safety: {
      allowedAction: "prepare_paid_website_creation_handoff",
      blockedActions: ["write files", "deploy website", "publish preview", "charge client", "contact business"],
      writesFiles: false,
      deploys: false,
      publishesPreview: false,
      sendsOutreach: false,
      requiresRobertApprovalBeforeBuild: true,
      requiresDepositBeforeBuild: true,
      requiresAppQaBeforeDeploy: true,
      requestedWriteFiles: parsed.writeFiles,
      requestedDeployWebsite: parsed.deployWebsite,
    },
    snapshot: getRevenueEngineSnapshot(),
  };
}

export function buildRevenueWebsitePublishReadinessPacket(input: RevenueWebsitePublishReadinessPacketInput) {
  const parsed = revenueWebsitePublishReadinessPacketSchema.parse(input);
  loadRevenueApprovalDecisions();
  const creationPacket = buildRevenueWebsiteCreationPacket({
    outreachDraftId: parsed.outreachDraftId,
    approvalDecisionId: parsed.websiteCreationApprovalDecisionId,
    robertApprovedBuild: true,
    clientApprovedScope: true,
    depositPaid: true,
    publicDataVerified: true,
    writeFiles: false,
    deployWebsite: false,
    launchTargetDays: parsed.launchTargetDays,
  });
  const publishProof = {
    robertApprovedPublish: parsed.robertApprovedPublish,
    previewDeployVerified: parsed.previewDeployVerified,
    appQaTargetPassed: parsed.appQaTargetPassed,
    rollbackVerified: parsed.rollbackVerified,
    deployProvider: parsed.deployProvider,
    previewDeployUrl: parsed.previewDeployUrl,
    appQaEvidenceUrl: parsed.appQaEvidenceUrl,
    rollbackPlanUrl: parsed.rollbackPlanUrl,
  };
  const publishSnapshot = creationPacket.draft && creationPacket.scaffold && creationPacket.scaffoldInput ? {
    outreachDraftId: parsed.outreachDraftId,
    websiteCreationApprovalDecisionId: parsed.websiteCreationApprovalDecisionId,
    businessName: creationPacket.draft.businessName,
    scaffoldSlug: creationPacket.scaffold.slug,
    scaffoldFileCount: creationPacket.scaffold.fileCount,
    scaffoldInput: creationPacket.scaffoldInput,
    scaffoldFilesHash: buildRevenueWebsiteScaffoldFilesHash(creationPacket.scaffold.files),
    packageName: creationPacket.scaffoldInput.packageName,
    setupUsd: creationPacket.scaffoldInput.setupUsd,
    monthlyRetainerUsd: creationPacket.scaffoldInput.monthlyRetainerUsd,
  } : null;
  const expectedTargetId = buildRevenueWebsitePublishApprovalTargetId(parsed.outreachDraftId);
  const expectedSnapshotHash = publishSnapshot
    ? buildRevenueWebsitePublishSnapshotHash(publishSnapshot, publishProof)
    : "";
  const publishApprovalDecision = parsed.publishApprovalDecisionId
    ? revenueApprovalDecisions.find((item) => item.id === parsed.publishApprovalDecisionId)
    : null;
  const publishApprovalReady = Boolean(
    publishSnapshot
    && publishApprovalDecision
    && publishApprovalDecision.targetType === "website_publish"
    && publishApprovalDecision.targetId === expectedTargetId
    && publishApprovalDecision.decision === "approved"
    && publishApprovalDecision.guardrail.status === "recorded"
    && publishApprovalDecision.approvalSource === "website_publish_approval_cli"
    && publishApprovalDecision.websitePublishSnapshotHash === expectedSnapshotHash,
  );
  const unsafeActionRequested = parsed.writeFiles || parsed.deployWebsite;
  const creationReady = creationPacket.status === "ready_for_website_creation_handoff";
  const gates = [
    { gate: "website_creation_handoff", passed: creationReady, fix: "Preparar un website creation packet aprobado para este draft exacto." },
    { gate: "preview_deploy", passed: parsed.previewDeployVerified, fix: "Verificar preview deploy real antes de aprobar publicacion." },
    { gate: "app_qa", passed: parsed.appQaTargetPassed, fix: "Adjuntar evidencia de App QA target passed." },
    { gate: "rollback", passed: parsed.rollbackVerified, fix: "Verificar rollback/fallback antes de publicar." },
    { gate: "robert_publish_approval", passed: parsed.robertApprovedPublish, fix: "Robert debe aprobar publicar este website exacto." },
    { gate: "publish_approval_decision", passed: publishApprovalReady, fix: "Registrar y usar publishApprovalDecisionId valido para este preview/QA/rollback exacto." },
    { gate: "safe_mode", passed: !unsafeActionRequested, fix: "Este packet no escribe archivos ni despliega; solo prepara el gate de publicacion." },
  ];
  const failedGates = gates.filter((gate) => !gate.passed);
  const readyForPublishApproval = failedGates.length === 0;

  return {
    status: readyForPublishApproval ? "ready_for_publish_handoff" as const : "blocked" as const,
    outreachDraftId: parsed.outreachDraftId,
    websiteCreationApprovalDecisionId: parsed.websiteCreationApprovalDecisionId,
    publishApprovalDecisionId: parsed.publishApprovalDecisionId,
    creationPacket: {
      status: creationPacket.status,
      draft: creationPacket.draft,
      scaffold: creationPacket.scaffold ? {
        status: creationPacket.scaffold.status,
        slug: creationPacket.scaffold.slug,
        fileCount: creationPacket.scaffold.fileCount,
        canWriteFiles: creationPacket.scaffold.canWriteFiles,
        canDeploy: creationPacket.scaffold.canDeploy,
      } : null,
      blockedReasons: creationPacket.blockedReasons,
    },
    publishSnapshot,
    gates,
    blockedReasons: failedGates.map((gate) => gate.fix),
    evidence: publishProof,
    nextApiAction: readyForPublishApproval ? "/api/revenue-engine/delivery-workspaces/deliver" : "/api/revenue-engine/website-creation-packet",
    nextAction: readyForPublishApproval
      ? "Proceed through PR-first delivery/App QA approval; Replit deploy still requires Robert approval."
      : "Resolve publish gates before any website deploy or public client handoff.",
    safety: {
      allowedAction: "prepare_website_publish_readiness_handoff",
      blockedActions: ["write files", "deploy website", "publish website", "contact client", "charge client"],
      writesFiles: false,
      deploys: false,
      publishesWebsite: false,
      sendsOutreach: false,
      chargesClients: false,
      requestedWriteFiles: parsed.writeFiles,
      requestedDeployWebsite: parsed.deployWebsite,
      requiresAppQaBeforeDeploy: true,
      requiresRollbackBeforePublish: true,
      requiresRobertApprovalBeforePublish: true,
    },
    snapshot: getRevenueEngineSnapshot(),
  };
}

export function buildRevenuePaymentPathReadinessPacket(input: RevenuePaymentPathReadinessPacketInput) {
  const parsed = revenuePaymentPathReadinessPacketSchema.parse(input);
  loadRevenueApprovalDecisions();
  const paymentUrl = new URL(parsed.paymentLink);
  const paymentSnapshot = {
    paymentMethod: "payment_link" as const,
    paymentLink: parsed.paymentLink,
    paymentHost: paymentUrl.hostname.toLowerCase(),
    expectedDepositUsd: parsed.expectedDepositUsd,
    expectedPackage: parsed.expectedPackage,
  };
  const paymentProof = {
    robertApprovedPaymentPath: parsed.robertApprovedPaymentPath,
    paymentSmokeVerified: parsed.paymentSmokeVerified,
    depositConfirmedByRobert: parsed.depositConfirmedByRobert,
    paymentLink: parsed.paymentLink,
    evidenceUrl: parsed.evidenceUrl,
    evidenceNote: parsed.evidenceNote,
  };
  const expectedTargetId = buildRevenuePaymentPathApprovalTargetId(parsed.paymentLink);
  const expectedSnapshotHash = buildRevenuePaymentPathSnapshotHash(paymentSnapshot, paymentProof);
  const approvalDecision = parsed.approvalDecisionId
    ? revenueApprovalDecisions.find((item) => item.id === parsed.approvalDecisionId)
    : null;
  const approvalReady = Boolean(
    approvalDecision
    && approvalDecision.targetType === "payment_path"
    && approvalDecision.targetId === expectedTargetId
    && approvalDecision.decision === "approved"
    && approvalDecision.guardrail.status === "recorded"
    && approvalDecision.approvalSource === "payment_path_approval_cli"
    && approvalDecision.paymentPathSnapshotHash === expectedSnapshotHash,
  );
  const paymentLinkAllowed = hasRevenuePaymentLink(parsed.paymentLink);
  const verified = parsed.paymentSmokeVerified || parsed.depositConfirmedByRobert;
  const gates = [
    { gate: "payment_link_allowed", passed: paymentLinkAllowed, fix: "Usar un payment link HTTPS de Stripe o host permitido explicitamente." },
    { gate: "robert_payment_path_approval", passed: parsed.robertApprovedPaymentPath, fix: "Robert debe aprobar este payment link exacto." },
    { gate: "payment_verification", passed: verified, fix: "Registrar smoke test de pago o confirmacion de primer deposito." },
    { gate: "approval_decision", passed: approvalReady, fix: "Registrar y usar approvalDecisionId valido para este payment path exacto." },
    { gate: "safe_mode", passed: !parsed.chargeClient, fix: "Este packet no cobra al cliente; solo prepara/verifica el camino de cobro." },
  ];
  const failedGates = gates.filter((gate) => !gate.passed);
  const readyForPaymentPath = failedGates.length === 0;

  return {
    status: readyForPaymentPath ? "ready_for_payment_path_handoff" as const : "blocked" as const,
    paymentSnapshot,
    approvalDecisionId: parsed.approvalDecisionId,
    gates,
    blockedReasons: failedGates.map((gate) => gate.fix),
    evidence: paymentProof,
    nextAction: readyForPaymentPath
      ? "Configure the approved payment link outside tracked files, then keep ledger approval separate for actual cash received."
      : "Resolve payment path gates before asking clients for deposits.",
    safety: {
      allowedAction: "prepare_payment_path_readiness_handoff",
      blockedActions: ["charge client", "edit secrets", "store Stripe secret", "record ledger cash", "send outreach"],
      chargesClients: false,
      editsEnvironment: false,
      storesSecrets: false,
      recordsLedgerEntry: false,
      sendsOutreach: false,
      requestedChargeClient: parsed.chargeClient,
      requiresRobertApprovalBeforePaymentUse: true,
      requiresLedgerApprovalForReceivedCash: true,
    },
    snapshot: getRevenueEngineSnapshot(),
  };
}

export function buildRevenueContactPathReadinessPacket(input: RevenueContactPathReadinessPacketInput) {
  const parsed = revenueContactPathReadinessPacketSchema.parse(input);
  loadRevenueApprovalDecisions();
  const emailProvider = getRevenueEmailProviderStatus();
  const contactSnapshot = {
    contactMode: parsed.contactMode,
    fromEmail: emailProvider.fromEmail || "",
    manualContactApproved: isExplicitRevenueApproval(process.env.REVENUE_ENGINE_MANUAL_CONTACT_APPROVED),
    emailProviderConfigured: emailProvider.configured,
  };
  const contactProof = {
    robertApprovedContactPath: parsed.robertApprovedContactPath,
    contactPathVerified: parsed.contactPathVerified,
    evidenceUrl: parsed.evidenceUrl,
    evidenceNote: parsed.evidenceNote,
  };
  const expectedTargetId = buildRevenueContactPathApprovalTargetId(contactSnapshot);
  const expectedSnapshotHash = buildRevenueContactPathSnapshotHash(contactSnapshot, contactProof);
  const approvalDecision = parsed.approvalDecisionId
    ? revenueApprovalDecisions.find((item) => item.id === parsed.approvalDecisionId)
    : null;
  const approvalReady = Boolean(
    approvalDecision
    && approvalDecision.targetType === "contact_path"
    && approvalDecision.targetId === expectedTargetId
    && approvalDecision.decision === "approved"
    && approvalDecision.guardrail.status === "recorded"
    && approvalDecision.approvalSource === "contact_path_approval_cli"
    && approvalDecision.contactPathSnapshotHash === expectedSnapshotHash,
  );
  const channelAvailable = parsed.contactMode === "email_provider"
    ? emailProvider.configured
    : contactSnapshot.manualContactApproved;
  const gates = [
    { gate: "channel_available", passed: channelAvailable, fix: "Configurar el provider aprobado o marcar el canal manual aprobado fuera de archivos trackeados." },
    { gate: "robert_contact_approval", passed: parsed.robertApprovedContactPath, fix: "Robert debe aprobar este camino de contacto exacto." },
    { gate: "contact_path_verified", passed: parsed.contactPathVerified, fix: "Verificar el camino de contacto con evidencia antes de contactar negocios." },
    { gate: "approval_decision", passed: approvalReady, fix: "Registrar y usar approvalDecisionId valido para este contact path exacto." },
    { gate: "safe_mode", passed: !parsed.sendOutreach, fix: "Este packet no envia outreach; solo prepara/verifica el camino de contacto." },
  ];
  const failedGates = gates.filter((gate) => !gate.passed);
  const readyForContactPath = failedGates.length === 0;

  return {
    status: readyForContactPath ? "ready_for_contact_path_handoff" as const : "blocked" as const,
    contactSnapshot: {
      contactMode: contactSnapshot.contactMode,
      fromEmailConfigured: Boolean(contactSnapshot.fromEmail),
      manualContactApproved: contactSnapshot.manualContactApproved,
      emailProviderConfigured: contactSnapshot.emailProviderConfigured,
    },
    approvalDecisionId: parsed.approvalDecisionId,
    gates,
    blockedReasons: failedGates.map((gate) => gate.fix),
    evidence: contactProof,
    nextAction: readyForContactPath
      ? "Configure the approved contact path outside tracked files, then keep each outreach send behind draft approval."
      : "Resolve contact path gates before contacting businesses.",
    safety: {
      allowedAction: "prepare_contact_path_readiness_handoff",
      blockedActions: ["send outreach", "edit secrets", "store provider secret", "charge client", "publish website"],
      sendsOutreach: false,
      editsEnvironment: false,
      storesSecrets: false,
      chargesClients: false,
      publishesWebsites: false,
      requestedSendOutreach: parsed.sendOutreach,
      requiresRobertApprovalBeforeContact: true,
      requiresDraftApprovalBeforeEachSend: true,
    },
    snapshot: getRevenueEngineSnapshot(),
  };
}

function buildAgentWorkOrder(input: RevenueAgentRunInput) {
  const request = input.request.toLowerCase();
  const clarificationGate = buildRevenueClarificationGate({
    request: input.request,
    projectType: input.projectType,
  });
  const wantsAutomation = input.projectType !== "website" || includesAny(request, ["automat", "automation", "follow", "crm", "mensaje", "email", "whatsapp", "lead"]);
  const wantsWebsite = input.projectType !== "automation" || includesAny(request, ["web", "site", "landing", "3d", "seo", "pagina"]);
  const needsContactApproval = ["outreach", "proposal"].includes(input.stage) && !input.approvalToContact;
  const needsBuildApproval = ["production", "delivery"].includes(input.stage) && !input.approvalToBuild;
  const needsSpendApproval = input.estimatedInternalCostUsd > 0 && input.cashCollectedUsd <= 0 && !input.approvalToSpend;
  const insideCap = input.estimatedInternalCostUsd <= 100 && input.monthlyBudgetUsd <= 100;
  const cashProtected = input.estimatedInternalCostUsd <= input.cashCollectedUsd || input.cashCollectedUsd === 0;
  const requiredApprovals = [
    clarificationGate.status === "needs_clarification" && "responder preguntas de aclaracion",
    needsContactApproval && "aprobar contacto externo",
    needsBuildApproval && "aprobar build/entrega",
    needsSpendApproval && "aprobar gasto antes de tener cash cobrado",
    !insideCap && "reducir costo mensual a menos de $100",
  ].filter(Boolean) as string[];
  const status: RevenueAgentRun["status"] = !insideCap ? "blocked" : requiredApprovals.length > 0 ? "approval_required" : "ready";
  const workOrder: RevenueAgentRun["workOrder"] = [
    clarificationGate.status === "needs_clarification" && {
      step: "Preguntas de aclaracion",
      ownerAgent: "growth-director",
      output: `${clarificationGate.minimumAnswer} Preguntas: ${clarificationGate.questions.join(" ")}`,
      approvalRequired: true,
    },
    {
      step: "Research y evidencia",
      ownerAgent: "business-researcher",
      output: `Verificar datos publicos de ${input.businessName}, oferta, canales, pruebas y claims inciertos.`,
      approvalRequired: false,
    },
    wantsWebsite && {
      step: "Mockup website dinamico",
      ownerAgent: "mockup-builder",
      output: "Crear propuesta visual vendible con hero 3D, secciones de conversion, CTA y comparables.",
      approvalRequired: input.stage === "mockup" || input.stage === "outreach",
    },
    wantsAutomation && {
      step: "Arquitectura de automatizacion",
      ownerAgent: "automation-architect",
      output: "Convertir el pedido en flujo, triggers, datos, costos, fallback manual y retainer recomendado.",
      approvalRequired: input.stage === "production" || input.stage === "delivery",
    },
    {
      step: "Oferta y cierre",
      ownerAgent: "closer",
      output: `Preparar precio base de $${input.estimatedOfferUsd.toLocaleString("en-US")}, deposito y mensaje en draft.`,
      approvalRequired: true,
    },
    {
      step: "QA council",
      ownerAgent: "qa-council",
      output: "Revisar evidencia, costo, margen, links, mobile, copy y reglas de no gastar/no enviar sin aprobacion.",
      approvalRequired: false,
    },
  ].filter(Boolean) as RevenueAgentRun["workOrder"];
  const subagentReviews: RevenueAgentRun["subagentReviews"] = [
    {
      agent: "business-researcher",
      verdict: clarificationGate.status === "clear" ? "pass" : "fix",
      correction: clarificationGate.status === "clear" ? "Pedido suficientemente claro para armar plan inicial." : `Pedir contexto: ${clarificationGate.missing.join(", ")}.`,
    },
    {
      agent: "mockup-builder",
      verdict: wantsWebsite ? "pass" : "fix",
      correction: wantsWebsite ? "Debe entregar preview visual y responsive antes de vender build completo." : "No crear website si el pedido es solo automatizacion.",
    },
    {
      agent: "automation-architect",
      verdict: wantsAutomation ? "pass" : "fix",
      correction: wantsAutomation ? "Debe estimar costo mensual y fallback manual antes de activar." : "No prometer automatizacion si el cliente solo pidio website.",
    },
    {
      agent: "cost-controller",
      verdict: insideCap ? "pass" : "block",
      correction: insideCap ? "Costo interno dentro del cap inicial." : "Bloquear: costo mensual o presupuesto supera $100.",
    },
    {
      agent: "closer",
      verdict: input.approvalToContact ? "pass" : "fix",
      correction: input.approvalToContact ? "Puede preparar canal manual aprobado." : "Mantener mensaje en draft hasta aprobacion humana.",
    },
    {
      agent: "qa-council",
      verdict: status === "blocked" ? "block" : requiredApprovals.length > 0 ? "fix" : "pass",
      correction: status === "blocked" ? "No avanzar hasta resolver cap/costo." : requiredApprovals.length > 0 ? "Avanzar solo en tareas internas; no contactar/gastar/construir." : "Listo para ejecutar con gates registrados.",
    },
  ];

  return {
    status,
    clarificationGate,
    budgetGate: {
      monthlyCapUsd: 100,
      insideCap,
      cashProtected,
      allowedSpendUsd: input.cashCollectedUsd > 0 ? Math.min(100, input.cashCollectedUsd, input.monthlyBudgetUsd) : 0,
    },
    workOrder,
    subagentReviews,
    requiredApprovals,
    nextActions:
      status === "blocked"
        ? ["Reducir costo interno/presupuesto a menos de $100.", "Recalcular oferta o subir retainer antes de prometer entrega."]
        : clarificationGate.status === "needs_clarification"
          ? ["Hacer las preguntas de aclaracion al cliente/prospecto.", "No cotizar final ni construir hasta responder el gate.", "Luego rerun del agente con el pedido completo."]
        : requiredApprovals.length > 0
          ? ["Trabajar research/mockup interno.", "Pedir aprobacion humana antes de contacto, gasto o build.", "Guardar draft en Outbox si se va a contactar."]
          : ["Crear mockup/propuesta.", "Registrar contacto aprobado en Outbox.", "Actualizar ledger cuando cobre deposito."],
    mainAgent: {
      agent: "growth-director",
      decision: status,
      reason:
        status === "blocked"
          ? "El costo o presupuesto rompe la regla inicial de menos de $100/mes."
          : clarificationGate.status === "needs_clarification"
            ? "No entiendo suficiente el pedido para prometer alcance, precio final o delivery."
          : requiredApprovals.length > 0
            ? "Puede avanzar internamente, pero requiere aprobaciones antes de acciones externas."
            : "Puede ejecutar la siguiente accion rentable dentro del cap.",
    },
    learningUpdate:
      status === "ready"
        ? `Playbook: ${input.niche} en ${input.area} puede avanzar con ${input.projectType} si mantiene costo <= $100 y cobra deposito.`
        : clarificationGate.status === "needs_clarification"
          ? `Playbook: preguntar primero cuando ${input.niche} en ${input.area} no tenga trigger, accion, datos o resultado claro.`
        : `Playbook: bloquear o pedir aprobacion cuando ${input.niche} en ${input.area} no tenga cash/aprobaciones/costo bajo control.`,
  };
}

export function recordRevenueAgentRun(input: RevenueAgentRunInput) {
  loadRevenueAgentRuns();
  const built = buildAgentWorkOrder(input);
  const now = new Date().toISOString();
  const run: RevenueAgentRun = {
    ...input,
    id: `agent-run-${Date.now()}-${revenueAgentRuns.length + 1}`,
    createdAt: now,
    updatedAt: now,
    ...built,
  };

  revenueAgentRuns.push(run);
  persistRevenueAgentRuns();

  return {
    run,
    snapshot: getRevenueEngineSnapshot(),
  };
}

function normalizeRevenueLeadKey(input: Pick<RevenueLeadInput, "businessName" | "area" | "contactValue">) {
  return [input.businessName, input.area, input.contactValue || ""]
    .map((item) => item.trim().toLowerCase().replace(/\s+/g, " "))
    .join("|");
}

const revenueLeadStatusRank: Record<RevenueLead["status"], number> = {
  research: 1,
  qualified: 2,
  mockup_ready: 3,
  outreach_ready: 4,
  contacted: 5,
  proposal_sent: 6,
  closed: 7,
  disqualified: 0,
};

function strongerRevenueLeadStatus(current: RevenueLead["status"], next: RevenueLead["status"]) {
  if (next === "disqualified") {
    return revenueLeadStatusRank[current] <= revenueLeadStatusRank.mockup_ready ? next : current;
  }
  return revenueLeadStatusRank[next] > revenueLeadStatusRank[current] ? next : current;
}

export function recordRevenueLead(input: RevenueLeadInput) {
  loadRevenueLeads();
  const qualification = qualifyRevenueLead(input);
  const incomingKey = normalizeRevenueLeadKey(input);
  const existing = revenueLeads.find((lead) => normalizeRevenueLeadKey(lead) === incomingKey);

  if (existing) {
    const nextStatus = input.status === "research" ? qualification.recommendedStatus : input.status;
    existing.websiteStatus = input.websiteStatus;
    existing.contactChannel = input.contactChannel;
    existing.contactValue = input.contactValue;
    existing.evidence = input.evidence || existing.evidence;
    existing.painPoint = input.painPoint || existing.painPoint;
    existing.estimatedOfferUsd = Math.max(existing.estimatedOfferUsd, input.estimatedOfferUsd);
    existing.status = strongerRevenueLeadStatus(existing.status, nextStatus);
    existing.updatedAt = new Date().toISOString();
    persistRevenueLeads();

    return {
      lead: existing,
      qualification,
      deduped: true,
      snapshot: getRevenueEngineSnapshot(),
    };
  }

  const now = new Date().toISOString();
  const lead: RevenueLead = {
    ...input,
    status: input.status === "research" ? qualification.recommendedStatus : input.status,
    id: `lead-${Date.now()}-${revenueLeads.length + 1}`,
    createdAt: now,
    updatedAt: now,
  };

  revenueLeads.push(lead);
  persistRevenueLeads();

  return {
    lead,
    qualification,
    deduped: false,
    snapshot: getRevenueEngineSnapshot(),
  };
}

function syncLeadAfterOutreachDraft(draft: RevenueOutreachDraft) {
  loadRevenueLeads();
  const lead = draft.leadId
    ? revenueLeads.find((item) => item.id === draft.leadId)
    : revenueLeads.find((item) => item.businessName.toLowerCase() === draft.businessName.toLowerCase());

  if (!lead || lead.status === "closed" || lead.status === "proposal_sent") return null;

  lead.status = "outreach_ready";
  lead.updatedAt = new Date().toISOString();
  persistRevenueLeads();
  return lead;
}

export function recordRevenueOutreachDraft(input: RevenueOutreachDraftInput) {
  loadRevenueOutreach();
  const proposal = buildProposalEmail(input);
  const hasRecipient = input.recipientEmail.trim().length > 0;
  const hasSummary = input.businessSummary.trim().length >= 40;
  const hasSource = Boolean(input.sourceUrl || input.mockupUrl);
  const approved = input.approvalStatus === "approved";
  const qaGates = [
    { gate: "recipient", passed: hasRecipient, fix: "Agregar email/contacto verificable antes de contactar." },
    { gate: "evidence", passed: hasSummary && hasSource, fix: "Agregar fuente publica o mockup URL y resumen especifico del negocio." },
    { gate: "cost", passed: proposal.pricing.insideCostCap, fix: "Bajar herramientas/costo mensual o subir retainer." },
    { gate: "approval", passed: approved, fix: "Robert debe aprobar el mensaje antes de enviarlo por email, DM o formulario." },
  ];
  const status: RevenueOutreachDraft["status"] = qaGates.some((gate) => !gate.passed && gate.gate !== "approval")
    ? "blocked"
    : approved
      ? "approved"
      : "draft";
  const now = new Date().toISOString();
  const draft: RevenueOutreachDraft = {
    ...input,
    id: `outreach-${Date.now()}-${revenueOutreachDrafts.length + 1}`,
    createdAt: now,
    updatedAt: now,
    status,
    subject: proposal.subject,
    body: proposal.body,
    pricing: proposal.pricing,
    delivery: {
      ...proposal.delivery,
      sendStatus: "not_sent",
      reason:
        status === "approved"
          ? "Aprobado para envio manual. No hay proveedor conectado, usa Gmail/mailto o copia el texto."
          : status === "blocked"
            ? "Bloqueado por QA. Corrige los gates antes de contactar."
            : "Draft guardado. Falta aprobacion humana antes de contactar.",
    },
    links: proposal.links,
    qaGates,
    nextAction:
      status === "approved"
        ? "Abrir Gmail/mailto, revisar una ultima vez y enviar manualmente."
        : status === "blocked"
          ? "Corregir los gates fallidos y volver a guardar el draft."
          : "Revisar copy, confirmar evidencia y aprobar antes de enviar.",
  };

  revenueOutreachDrafts.push(draft);
  persistRevenueOutreach();
  const syncedLead = syncLeadAfterOutreachDraft(draft);

  return {
    draft,
    syncedLead,
    snapshot: getRevenueEngineSnapshot(),
  };
}

export function listRevenueOutreachDrafts() {
  loadRevenueOutreach();
  return [...revenueOutreachDrafts];
}

export function buildRevenueOutreachApprovalPacket(input: RevenueOutreachApprovalPacketInput = { maxDrafts: 10, includeSent: false }) {
  loadRevenueOutreach();
  const parsed = revenueOutreachApprovalPacketSchema.parse(input);
  const provider = getRevenueEmailProviderStatus();
  const drafts = revenueOutreachDrafts
    .filter((draft) => parsed.includeSent || draft.delivery.sendStatus !== "sent")
    .slice()
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, parsed.maxDrafts);
  const items = drafts.map((draft) => {
    const failedGates = draft.qaGates.filter((gate) => !gate.passed);
    const providerEmailChannel = ["email", "gmail", "mailto"].includes(draft.channel);
    const readyForManualApproval = draft.status === "draft" && failedGates.length === 1 && failedGates[0]?.gate === "approval";
    const readyForProviderSend = draft.status === "approved"
      && draft.delivery.sendStatus !== "sent"
      && draft.qaGates.every((gate) => gate.passed)
      && providerEmailChannel
      && provider.configured;
    const blockedReasons = [
      draft.delivery.sendStatus === "sent" && "already sent",
      draft.status === "blocked" && "draft blocked by QA",
      draft.status !== "approved" && !readyForManualApproval && "not approved",
      ...failedGates.map((gate) => gate.fix),
      draft.status === "approved" && !providerEmailChannel && `manual-only channel: ${draft.channel}`,
      draft.status === "approved" && !provider.configured && `email provider missing: ${provider.missing.join(", ") || "provider"}`,
    ].filter((item): item is string => Boolean(item));

    return {
      draftId: draft.id,
      businessName: draft.businessName,
      channel: draft.channel,
      status: draft.status,
      sendStatus: draft.delivery.sendStatus,
      recipientEmail: draft.recipientEmail,
      subject: draft.subject,
      estimatedSetupUsd: draft.pricing.totalSetupUsd,
      requiredDepositUsd: Math.round(draft.pricing.totalSetupUsd * 0.5),
      monthlyRetainerUsd: draft.pricing.monthlyRetainerUsd,
      readyForManualApproval,
      readyForProviderSend,
      failedGates: failedGates.map((gate) => ({
        gate: gate.gate,
        fix: gate.fix,
      })),
      blockedReasons,
      nextAction: readyForProviderSend
        ? "Record an audited outreach approval decision before provider send."
        : readyForManualApproval
          ? "Robert can approve this draft after final copy/source review."
          : blockedReasons.length
            ? `Fix before contact: ${blockedReasons.join("; ")}.`
            : "Review draft before contact.",
    };
  });
  const readyForApprovalCount = items.filter((item) => item.readyForManualApproval).length;
  const readyForSendCount = items.filter((item) => item.readyForProviderSend).length;

  return {
    status: readyForSendCount > 0 ? "ready_for_approved_send_review" as const : readyForApprovalCount > 0 ? "ready_for_robert_approval" as const : items.length > 0 ? "needs_fixes" as const : "empty" as const,
    provider,
    totals: {
      reviewed: items.length,
      readyForManualApproval: readyForApprovalCount,
      readyForProviderSend: readyForSendCount,
      blocked: items.filter((item) => !item.readyForManualApproval && !item.readyForProviderSend).length,
      projectedSetupUsd: items.reduce((sum, item) => sum + item.estimatedSetupUsd, 0),
      projectedRequiredDepositUsd: items.reduce((sum, item) => sum + item.requiredDepositUsd, 0),
    },
    items,
    nextApiAction: readyForSendCount > 0 ? "/api/revenue-engine/outreach-send" : "/api/revenue-engine/outreach-drafts",
    nextAction: readyForSendCount > 0
      ? "Robert reviews approved drafts, records an outreach approval decision, then sends one at a time with approvalDecisionId; record replies/deposits after contact."
      : readyForApprovalCount > 0
        ? "Robert reviews ready drafts and explicitly approves selected drafts before any send."
        : items.length > 0
          ? "Fix blocked outreach drafts before contact."
          : "Run Money Sprint to create draft-only outreach first.",
    safety: {
      allowedAction: "review_outreach_drafts_for_human_approval",
      blockedActions: ["send outreach", "contact business", "collect payment", "publish preview", "publish website"],
      sendsOutreach: false,
      persistsData: false,
      chargesClients: false,
      requiresRobertApprovalBeforeSend: true,
      requiresDepositBeforeDelivery: true,
    },
    snapshot: getRevenueEngineSnapshot(),
  };
}

export function recordRevenueSalesAutopilot(input: RevenueSalesAutopilotInput) {
  const parsed = revenueSalesAutopilotSchema.parse(input);
  const clarificationGate = buildRevenueClarificationGate({
    request: parsed.request,
    projectType: parsed.projectType,
  });
  const leadResult = recordRevenueLead({
    businessName: parsed.businessName,
    area: parsed.area,
    niche: parsed.niche,
    websiteStatus: parsed.websiteStatus,
    contactChannel: parsed.contactChannel,
    contactValue: parsed.contactValue,
    evidence: parsed.evidence,
    painPoint: parsed.painPoint,
    estimatedOfferUsd: parsed.estimatedOfferUsd,
    status: "research",
  });
  const includeAutomation = parsed.projectType !== "website";
  const mockup = buildRevenueMockup({
    businessName: parsed.businessName,
    area: parsed.area,
    niche: parsed.niche,
    websiteStatus: parsed.websiteStatus,
    evidence: parsed.evidence,
    painPoint: parsed.painPoint,
    primaryOffer: includeAutomation ? "Website 3D Premium + Automation Sprint" : "Website 3D Premium",
    estimatedOfferUsd: parsed.estimatedOfferUsd,
    includeAutomation,
  });
  const agentRunResult = recordRevenueAgentRun({
    businessName: parsed.businessName,
    area: parsed.area,
    niche: parsed.niche,
    request: parsed.request,
    stage: "proposal",
    projectType: parsed.projectType,
    estimatedOfferUsd: parsed.estimatedOfferUsd,
    estimatedInternalCostUsd: parsed.estimatedInternalCostUsd,
    monthlyBudgetUsd: parsed.monthlyBudgetUsd,
    cashCollectedUsd: parsed.cashCollectedUsd,
    approvalToContact: parsed.approvalToContact,
    approvalToSpend: parsed.approvalToSpend,
    approvalToBuild: parsed.approvalToBuild,
  });
  const deliveryReview = buildDeliveryReview({
    projectName: `${parsed.businessName} autopilot sale`,
    projectType: parsed.projectType,
    setupPriceUsd: parsed.estimatedOfferUsd,
    monthlyRetainerUsd: parsed.monthlyRetainerUsd,
    estimatedInternalMonthlyCostUsd: parsed.estimatedInternalCostUsd,
    clientApprovedScope: false,
    depositPaid: parsed.cashCollectedUsd > 0,
    publicDataVerified: parsed.evidence.trim().length >= 12,
    responsiveChecked: false,
    linksChecked: false,
    automationTested: !includeAutomation,
    rollbackPlanReady: false,
    notes: "Autopilot prepara venta; QA bloquea entrega hasta scope, deposito, pruebas y aprobacion.",
  });
  const hasRecipient = parsed.recipientEmail.trim().length > 0;
  const canDraftOutreach = hasRecipient && leadResult.qualification.missing.length === 0 && parsed.estimatedInternalCostUsd <= 100;
  const outreachResult = canDraftOutreach
    ? recordRevenueOutreachDraft({
        leadId: leadResult.lead.id,
        channel: parsed.contactChannel === "email" ? "email" : parsed.contactChannel === "contact_form" ? "contact_form" : "gmail",
        approvalStatus: parsed.approvalToContact ? "approved" : "draft",
        recipientEmail: parsed.recipientEmail,
        contactName: parsed.contactName || "Owner",
        businessName: parsed.businessName,
        sourceUrl: parsed.sourceUrl || undefined,
        businessSummary: parsed.businessSummary || `${parsed.businessName} en ${parsed.area}: ${parsed.evidence || parsed.painPoint}`,
        websitePriceUsd: includeAutomation ? Math.round(parsed.estimatedOfferUsd * 0.65) : parsed.estimatedOfferUsd,
        automationPriceUsd: includeAutomation ? Math.round(parsed.estimatedOfferUsd * 0.35) : 0,
        monthlyRetainerUsd: parsed.monthlyRetainerUsd,
        estimatedInternalMonthlyCostUsd: parsed.estimatedInternalCostUsd,
        notes: "Autopilot draft. No enviar hasta aprobacion humana final.",
      })
    : null;
  const requiredBeforeExternalAction = [
    !hasRecipient && "contacto/email verificable",
    leadResult.qualification.missing.length > 0 && `resolver lead: ${leadResult.qualification.missing.join(", ")}`,
    clarificationGate.status === "needs_clarification" && "responder preguntas de aclaracion",
    !parsed.approvalToContact && "aprobar contacto externo",
    parsed.estimatedInternalCostUsd > 100 && "reducir costo interno bajo $100/mes",
    parsed.estimatedInternalCostUsd > parsed.cashCollectedUsd && parsed.cashCollectedUsd === 0 && !parsed.approvalToSpend && "aprobar gasto antes de cash cobrado",
  ].filter(Boolean) as string[];
  const status =
    parsed.estimatedInternalCostUsd > 100
      ? "blocked"
      : requiredBeforeExternalAction.length > 0
        ? "approval_required"
        : "ready";

  return {
    status,
    guardrail:
      status === "ready"
        ? "Autopilot preparo el paquete; aun asi el envio real usa outbox y aprobacion humana."
        : status === "blocked"
          ? "Bloqueado por costo o gates criticos; no gastar, construir ni contactar."
          : "Autopilot preparo trabajo interno; falta aprobacion/evidencia antes de accion externa.",
    lead: leadResult.lead,
    leadQualification: leadResult.qualification,
    clarificationGate,
    mockup,
    agentRun: agentRunResult.run,
    deliveryReview,
    outreachDraft: outreachResult?.draft || null,
    requiredBeforeExternalAction,
    nextActions:
      status === "blocked"
        ? ["Reducir costo interno a menos de $100.", "Recalcular oferta/retainer antes de prometer entrega."]
        : requiredBeforeExternalAction.length > 0
          ? ["Completar evidencia/contacto/aprobacion.", "Mantener outreach en draft.", "Usar QA antes de enviar preview."]
          : ["Revisar draft en Outbox.", "Aprobar envio manual/API.", "Registrar deposito en ledger si cierra."],
    snapshot: getRevenueEngineSnapshot(),
  };
}

export async function sendRevenueOutreachDraft(input: RevenueOutreachSendInput) {
  const parsed = revenueOutreachSendSchema.parse(input);
  loadRevenueOutreach();
  loadRevenueApprovalDecisions();
  const draft = revenueOutreachDrafts.find((item) => item.id === parsed.draftId);
  const approvalDecision = parsed.approvalDecisionId
    ? revenueApprovalDecisions.find((item) => item.id === parsed.approvalDecisionId)
    : null;
  const expectedTargetId = draft ? buildRevenueOutreachApprovalTargetId(draft.id) : "";
  const expectedSnapshotHash = draft ? buildRevenueOutreachSnapshotHash(draft) : "";
  const approvalDecisionReady = Boolean(
    draft
    && approvalDecision
    && approvalDecision.targetType === "outbox"
    && approvalDecision.targetId === expectedTargetId
    && approvalDecision.decision === "approved"
    && approvalDecision.guardrail.status === "recorded"
    && approvalDecision.approvalSource === "outreach_approval_cli"
    && approvalDecision.outreachDraftSnapshotHash === expectedSnapshotHash,
  );
  const provider = getRevenueEmailProviderStatus();
  const providerEmailChannel = draft ? ["email", "gmail", "mailto"].includes(draft.channel) : true;
  const now = new Date().toISOString();
  const gates = [
    { gate: "draft_found", passed: Boolean(draft), fix: "Seleccionar un draft existente del outbox." },
    { gate: "draft_approved", passed: draft?.status === "approved", fix: "Aprobar el draft antes de enviar." },
    { gate: "human_approval", passed: approvalDecisionReady, fix: "Registrar y usar approvalDecisionId valido para este draft exacto antes de contacto externo." },
    { gate: "email_channel", passed: providerEmailChannel, fix: `Canal manual-only: ${draft?.channel || "unknown"}. Usar revision manual fuera del proveedor de email.` },
    { gate: "provider_configured", passed: provider.configured, fix: `Configurar ${provider.missing.join(" y ") || "proveedor de email"}.` },
    { gate: "not_duplicate", passed: draft?.delivery.sendStatus !== "sent", fix: "Este draft ya fue enviado; crear uno nuevo para reenviar." },
    { gate: "qa_clear", passed: Boolean(draft && draft.qaGates.every((gate) => gate.passed)), fix: "Resolver gates de QA antes de contactar." },
  ];
  const failedGate = gates.find((gate) => !gate.passed);

  if (!draft) {
    return {
      status: "blocked" as const,
      provider,
      gates,
      reason: failedGate?.fix || "Draft no encontrado.",
      draft: null,
      snapshot: getRevenueEngineSnapshot(),
    };
  }

  draft.delivery.lastAttemptAt = now;

  if (failedGate) {
    draft.delivery.sendStatus = provider.configured ? "blocked" : "provider_missing";
    draft.delivery.reason = failedGate.fix;
    draft.updatedAt = now;
    persistRevenueOutreach();
    return {
      status: "blocked" as const,
      provider,
      gates,
      reason: failedGate.fix,
      draft,
      snapshot: getRevenueEngineSnapshot(),
    };
  }

  try {
    const sendResult = await sendRevenueOutreachPayload({
      from: provider.fromEmail,
      to: draft.recipientEmail,
      subject: draft.subject,
      text: draft.body,
      html: textToHtml(draft.body),
      idempotencyKey: draft.id,
    });
    draft.delivery.mode = "provider_api";
    draft.delivery.sendStatus = "sent";
    draft.delivery.reason = "Enviado por Resend API despues de aprobacion humana y QA.";
    draft.delivery.provider = provider.provider;
    draft.delivery.externalMessageId = sendResult.id;
    draft.delivery.sentAt = now;
    draft.updatedAt = now;

    if (draft.leadId) {
      loadRevenueLeads();
      const lead = revenueLeads.find((item) => item.id === draft.leadId);
      if (lead && lead.status !== "closed") {
        lead.status = "proposal_sent";
        lead.updatedAt = now;
        persistRevenueLeads();
      }
    }

    persistRevenueOutreach();
    return {
      status: "sent" as const,
      provider,
      gates,
      sendResult,
      draft,
      snapshot: getRevenueEngineSnapshot(),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Email provider failed";
    draft.delivery.mode = "provider_api";
    draft.delivery.sendStatus = "failed";
    draft.delivery.reason = message;
    draft.delivery.provider = provider.provider;
    draft.updatedAt = now;
    persistRevenueOutreach();
    return {
      status: "failed" as const,
      provider,
      gates,
      reason: message,
      draft,
      snapshot: getRevenueEngineSnapshot(),
    };
  }
}

export function recordRevenueLedgerEntry(input: RevenueLedgerEntryInput) {
  loadRevenueLedger();
  loadRevenueApprovalDecisions();
  const parsed = revenueLedgerEntrySchema.parse(input);
  if (parsed.kind !== "expense") {
    const ledgerSnapshot = {
      kind: parsed.kind,
      clientName: parsed.clientName,
      amountUsd: parsed.amountUsd,
      cashCollectedUsd: parsed.cashCollectedUsd,
      estimatedInternalCostUsd: parsed.estimatedInternalCostUsd,
      notes: parsed.notes,
    };
    const approvalDecision = parsed.approvalDecisionId
      ? revenueApprovalDecisions.find((item) => item.id === parsed.approvalDecisionId)
      : null;
    const existingApprovedEntry = revenueLedger.find((entry) => entry.approvalDecisionId === parsed.approvalDecisionId);
    const expectedTargetId = buildRevenueLedgerApprovalTargetId(ledgerSnapshot);
    const expectedSnapshotHash = buildRevenueLedgerApprovalSnapshotHash(ledgerSnapshot);
    const approvalDecisionReady = Boolean(
      approvalDecision
      && !existingApprovedEntry
      && approvalDecision.targetType === "ledger_entry"
      && approvalDecision.targetId === expectedTargetId
      && approvalDecision.decision === "approved"
      && approvalDecision.guardrail.status === "recorded"
      && approvalDecision.approvalSource === "ledger_entry_approval_cli"
      && approvalDecision.ledgerEntrySnapshotHash === expectedSnapshotHash,
    );

    if (!approvalDecisionReady) {
      const snapshotBefore = getRevenueEngineSnapshot();
      return {
        entry: null,
        snapshot: snapshotBefore,
        guardrail: {
          status: "blocked" as const,
          reason: "Venta/cash no registrado: requiere approvalDecisionId auditado para esta entrada exacta del ledger.",
        },
      };
    }
  }

  if (parsed.kind === "expense") {
    const snapshotBefore = getRevenueEngineSnapshot();
    const projectedSpendUsd = snapshotBefore.metrics.estimatedSpendUsd + parsed.amountUsd + parsed.estimatedInternalCostUsd;
    const blockers = [
      projectedSpendUsd > 100 && "Gasto mensual estimado supera el cap inicial de $100.",
      projectedSpendUsd > snapshotBefore.metrics.cashCollectedUsd && "El gasto supera el cash cobrado; cobrar deposito antes de gastar.",
      snapshotBefore.approvalQueueItems.length > 0 && "Hay aprobaciones pendientes; limpiar approval queue antes de gastar.",
    ].filter(Boolean) as string[];

    if (blockers.length > 0) {
      return {
        entry: null,
        snapshot: snapshotBefore,
        guardrail: {
          status: "blocked" as const,
          reason: blockers.join(" "),
        },
      };
    }
  }

  const entry: RevenueLedgerEntry = {
    ...parsed,
    id: `rev-${Date.now()}-${revenueLedger.length + 1}`,
    createdAt: new Date().toISOString(),
  };

  revenueLedger.push(entry);
  persistRevenueLedger();
  const snapshot = getRevenueEngineSnapshot();

  return {
    entry,
    snapshot,
    guardrail: {
      status:
        entry.kind === "expense" && snapshot.metrics.estimatedSpendUsd > 100
          ? "blocked"
          : snapshot.metrics.estimatedSpendUsd > snapshot.metrics.cashCollectedUsd
            ? "approval_required"
            : "ok",
      reason:
        entry.kind === "expense" && snapshot.metrics.estimatedSpendUsd > 100
          ? "Gasto mensual estimado supera el cap inicial de $100."
          : snapshot.metrics.estimatedSpendUsd > snapshot.metrics.cashCollectedUsd
            ? "El gasto supera el cash cobrado; requiere aprobacion antes de gastar o enviar mas."
            : "Ledger actualizado dentro de las reglas de rentabilidad.",
    },
  };
}

export function preflightRevenueExpense(input: RevenueExpensePreflightInput) {
  const parsed = revenueExpensePreflightSchema.parse(input);
  const snapshot = getRevenueEngineSnapshot();
  const projectedSpendUsd = snapshot.metrics.estimatedSpendUsd + parsed.amountUsd + parsed.estimatedInternalCostUsd;
  const projectedProfitUsd = snapshot.metrics.cashCollectedUsd - projectedSpendUsd;
  const blockers = [
    parsed.amountUsd + parsed.estimatedInternalCostUsd <= 0 && "monto/costo debe ser mayor a 0",
    projectedSpendUsd > 100 && `pasaria el cap inicial de $100/mes: ${projectedSpendUsd} USD`,
    projectedSpendUsd > snapshot.metrics.cashCollectedUsd && `gastaria mas que el cash cobrado: cash ${snapshot.metrics.cashCollectedUsd} USD vs spend ${projectedSpendUsd} USD`,
    snapshot.approvalQueueItems.length > 0 && "hay approval queue pendiente",
  ].filter(Boolean) as string[];
  const status = blockers.length > 0 ? "blocked" as const : "approved" as const;

  return {
    status,
    concept: parsed.concept,
    amountUsd: parsed.amountUsd,
    estimatedInternalCostUsd: parsed.estimatedInternalCostUsd,
    projected: {
      spendUsd: projectedSpendUsd,
      profitUsd: projectedProfitUsd,
      remainingCapUsd: Math.max(0, 100 - projectedSpendUsd),
      cashCoverageUsd: snapshot.metrics.cashCollectedUsd - projectedSpendUsd,
    },
    blockers,
    nextAction:
      status === "approved"
        ? "Gasto pre-aprobado por Profit Guard; registrar en ledger solo si Robert confirma."
        : "No gastar ni registrar como ejecutado; cobrar deposito, bajar costo o limpiar approvals primero.",
    snapshot,
  };
}

export function setRevenueLedgerPathForTests(filePath: string) {
  revenueUserDataScope = null;
  revenueLedgerPathOverride = filePath;
  revenueLedgerLoaded = false;
  revenueLedgerPersistenceError = null;
  revenueLedger.splice(0, revenueLedger.length);
}

export function setRevenueLeadsPathForTests(filePath: string) {
  revenueUserDataScope = null;
  revenueLeadsPathOverride = filePath;
  revenueLeadsLoaded = false;
  revenueLeadsPersistenceError = null;
  revenueLeads.splice(0, revenueLeads.length);
}

export function setRevenueOutreachPathForTests(filePath: string) {
  revenueUserDataScope = null;
  revenueOutreachPathOverride = filePath;
  revenueOutreachLoaded = false;
  revenueOutreachPersistenceError = null;
  revenueOutreachDrafts.splice(0, revenueOutreachDrafts.length);
}

export function setRevenueOutreachSenderForTests(sender: ((payload: RevenueOutreachSendPayload) => Promise<RevenueOutreachSendResponse>) | null) {
  revenueOutreachSenderOverride = sender;
}

export function setRevenueAgentRunsPathForTests(filePath: string) {
  revenueUserDataScope = null;
  revenueAgentRunsPathOverride = filePath;
  revenueAgentRunsLoaded = false;
  revenueAgentRunsPersistenceError = null;
  revenueAgentRuns.splice(0, revenueAgentRuns.length);
}

export function setRevenueAutomationOpportunitiesPathForTests(filePath: string) {
  revenueUserDataScope = null;
  revenueAutomationOpportunitiesPathOverride = filePath;
  revenueAutomationOpportunitiesLoaded = false;
  revenueAutomationOpportunitiesPersistenceError = null;
  revenueAutomationOpportunities.splice(0, revenueAutomationOpportunities.length);
}

export function setRevenueImprovementReviewsPathForTests(filePath: string) {
  revenueUserDataScope = null;
  revenueImprovementReviewsPathOverride = filePath;
  revenueImprovementReviewsLoaded = false;
  revenueImprovementReviewsPersistenceError = null;
  revenueImprovementReviews.splice(0, revenueImprovementReviews.length);
}

export function setRevenueScoutingMissionsPathForTests(filePath: string) {
  revenueUserDataScope = null;
  revenueScoutingMissionsPathOverride = filePath;
  revenueScoutingMissionsLoaded = false;
  revenueScoutingMissionsPersistenceError = null;
  revenueScoutingMissions.splice(0, revenueScoutingMissions.length);
}

export function setRevenuePublicLeadCandidatesPathForTests(filePath: string) {
  revenueUserDataScope = null;
  revenuePublicLeadCandidatesPathOverride = filePath;
  revenuePublicLeadCandidatesLoaded = false;
  revenuePublicLeadCandidatesPersistenceError = null;
  revenuePublicLeadCandidates.splice(0, revenuePublicLeadCandidates.length);
}

export function setRevenueDeliveryWorkspacesPathForTests(filePath: string) {
  revenueUserDataScope = null;
  revenueDeliveryWorkspacesPathOverride = filePath;
  revenueDeliveryWorkspacesLoaded = false;
  revenueDeliveryWorkspacesPersistenceError = null;
  revenueDeliveryWorkspaces.splice(0, revenueDeliveryWorkspaces.length);
}

export function setRevenueApprovalDecisionsPathForTests(filePath: string) {
  revenueUserDataScope = null;
  revenueApprovalDecisionsPathOverride = filePath;
  revenueApprovalDecisionsLoaded = false;
  revenueApprovalDecisionsPersistenceError = null;
  revenueApprovalDecisions.splice(0, revenueApprovalDecisions.length);
}

export function setRevenueAutomationIntakesPathForTests(filePath: string) {
  revenueUserDataScope = null;
  revenueAutomationIntakesPathOverride = filePath;
  revenueAutomationIntakesLoaded = false;
  revenueAutomationIntakesPersistenceError = null;
  revenueAutomationIntakes.splice(0, revenueAutomationIntakes.length);
}

export function resetRevenueLedgerForTests() {
  revenueLedger.splice(0, revenueLedger.length);
  revenueLedgerLoaded = true;
  revenueLedgerPersistenceError = null;
  const ledgerPath = getRevenueLedgerPath();
  if (fs.existsSync(ledgerPath)) {
    fs.unlinkSync(ledgerPath);
  }
}

export function resetRevenueLeadsForTests() {
  revenueLeads.splice(0, revenueLeads.length);
  revenueLeadsLoaded = true;
  revenueLeadsPersistenceError = null;
  const leadsPath = getRevenueLeadsPath();
  if (fs.existsSync(leadsPath)) {
    fs.unlinkSync(leadsPath);
  }
}

export function resetRevenueOutreachForTests() {
  revenueOutreachDrafts.splice(0, revenueOutreachDrafts.length);
  revenueOutreachLoaded = true;
  revenueOutreachPersistenceError = null;
  revenueOutreachSenderOverride = null;
  const outreachPath = getRevenueOutreachPath();
  if (fs.existsSync(outreachPath)) {
    fs.unlinkSync(outreachPath);
  }
}

export function resetRevenueAgentRunsForTests() {
  revenueAgentRuns.splice(0, revenueAgentRuns.length);
  revenueAgentRunsLoaded = true;
  revenueAgentRunsPersistenceError = null;
  const agentRunsPath = getRevenueAgentRunsPath();
  if (fs.existsSync(agentRunsPath)) {
    fs.unlinkSync(agentRunsPath);
  }
}

export function resetRevenueAutomationOpportunitiesForTests() {
  revenueAutomationOpportunities.splice(0, revenueAutomationOpportunities.length);
  revenueAutomationOpportunitiesLoaded = true;
  revenueAutomationOpportunitiesPersistenceError = null;
  const opportunitiesPath = getRevenueAutomationOpportunitiesPath();
  if (fs.existsSync(opportunitiesPath)) {
    fs.unlinkSync(opportunitiesPath);
  }
}

export function resetRevenueImprovementReviewsForTests() {
  revenueImprovementReviews.splice(0, revenueImprovementReviews.length);
  revenueImprovementReviewsLoaded = true;
  revenueImprovementReviewsPersistenceError = null;
  const reviewsPath = getRevenueImprovementReviewsPath();
  if (fs.existsSync(reviewsPath)) {
    fs.unlinkSync(reviewsPath);
  }
}

export function resetRevenueScoutingMissionsForTests() {
  revenueScoutingMissions.splice(0, revenueScoutingMissions.length);
  revenueScoutingMissionsLoaded = true;
  revenueScoutingMissionsPersistenceError = null;
  const missionsPath = getRevenueScoutingMissionsPath();
  if (fs.existsSync(missionsPath)) {
    fs.unlinkSync(missionsPath);
  }
}

export function resetRevenuePublicLeadCandidatesForTests() {
  revenuePublicLeadCandidates.splice(0, revenuePublicLeadCandidates.length);
  revenuePublicLeadCandidatesLoaded = true;
  revenuePublicLeadCandidatesPersistenceError = null;
  const candidatesPath = getRevenuePublicLeadCandidatesPath();
  if (fs.existsSync(candidatesPath)) {
    fs.unlinkSync(candidatesPath);
  }
}

export function resetRevenueDeliveryWorkspacesForTests() {
  revenueDeliveryWorkspaces.splice(0, revenueDeliveryWorkspaces.length);
  revenueDeliveryWorkspacesLoaded = true;
  revenueDeliveryWorkspacesPersistenceError = null;
  const workspacesPath = getRevenueDeliveryWorkspacesPath();
  if (fs.existsSync(workspacesPath)) {
    fs.unlinkSync(workspacesPath);
  }
}

export function resetRevenueApprovalDecisionsForTests() {
  revenueApprovalDecisions.splice(0, revenueApprovalDecisions.length);
  revenueApprovalDecisionsLoaded = true;
  revenueApprovalDecisionsPersistenceError = null;
  const decisionsPath = getRevenueApprovalDecisionsPath();
  if (fs.existsSync(decisionsPath)) {
    fs.unlinkSync(decisionsPath);
  }
}

export function resetRevenueAutomationIntakesForTests() {
  revenueAutomationIntakes.splice(0, revenueAutomationIntakes.length);
  revenueAutomationIntakesLoaded = true;
  revenueAutomationIntakesPersistenceError = null;
  const intakesPath = getRevenueAutomationIntakesPath();
  if (fs.existsSync(intakesPath)) {
    fs.unlinkSync(intakesPath);
  }
}

function includesAny(text: string, keywords: string[]) {
  return keywords.some((keyword) => text.includes(keyword));
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function buildRevenueClarificationGate(input: {
  request: string;
  projectType?: "website" | "automation" | "bundle";
  currentTools?: string;
}) {
  const request = input.request.trim();
  const lowerRequest = request.toLowerCase();
  const lowerTools = (input.currentTools || "").toLowerCase();
  const wantsAutomation = input.projectType === "automation" || input.projectType === "bundle" || includesAny(lowerRequest, ["automat", "follow", "crm", "mensaje", "email", "whatsapp", "lead"]);
  const wantsWebsite = input.projectType === "website" || input.projectType === "bundle" || includesAny(lowerRequest, ["web", "site", "landing", "3d", "seo", "pagina"]);
  const wordCount = request.split(/\s+/).filter(Boolean).length;
  const hasTrigger = includesAny(lowerRequest, ["cuando", "when", "nuevo", "entra", "recibe", "form", "lead", "pedido", "booking", "reserva", "cita", "trigger"]);
  const hasAction = includesAny(lowerRequest, ["automat", "enviar", "send", "crear", "actualizar", "avisar", "notificar", "notify", "notification", "guardar", "follow", "seguimiento", "responder", "report"]);
  const hasOutcome = includesAny(lowerRequest, ["para", "so that", "cerrar", "ahorrar", "agendar", "convertir", "vender", "capture", "capturar", "follow-up", "reporting", "report", "dashboard", "booked", "trial", "appointment", "owner", "buyer", "cliente", "nadie se pierda", "menos errores"]);
  const hasDataSource = includesAny(`${lowerRequest} ${lowerTools}`, ["lead", "cliente", "sponsor", "buyer", "sheet", "crm", "email", "gmail", "instagram", "whatsapp", "form", "calendar", "stripe", "pos", "database", "base", "excel"]);
  const hasWebsiteGoal = !wantsWebsite || includesAny(lowerRequest, ["cta", "booking", "reserva", "menu", "servicio", "galeria", "portfolio", "seo", "contacto", "lead", "signup", "trial"]);
  const missing = [
    wordCount < 14 && "pedido demasiado corto",
    wantsAutomation && !hasTrigger && "trigger inicial de la automatizacion",
    wantsAutomation && !hasAction && "accion exacta que debe ejecutar el sistema",
    wantsAutomation && !hasDataSource && "herramienta o fuente de datos actual",
    !hasOutcome && "resultado de negocio esperado",
    wantsWebsite && !hasWebsiteGoal && "objetivo principal del website/mockup",
  ].filter(Boolean) as string[];
  const questions = [
    missing.includes("trigger inicial de la automatizacion") && "Que evento inicia el flujo: nuevo lead, formulario, DM, llamada, pago, reserva u otra cosa?",
    missing.includes("accion exacta que debe ejecutar el sistema") && "Que debe hacer el sistema automaticamente despues de ese evento?",
    missing.includes("herramienta o fuente de datos actual") && "Donde vive hoy la informacion: Google Sheets, CRM, email, Instagram, WhatsApp, POS u otra herramienta?",
    missing.includes("resultado de negocio esperado") && "Que resultado quieres venderle al cliente: mas reservas, mas leads respondidos, menos trabajo manual, reportes o cobros?",
    missing.includes("objetivo principal del website/mockup") && "Cual es el objetivo numero uno del website: llamadas, reservas, ventas, lista de emails o confianza visual?",
    missing.includes("pedido demasiado corto") && "Dame 2-3 frases sobre el proceso actual, quien lo usa y que duele ahora.",
  ].filter(Boolean) as string[];

  return {
    status: missing.length > 0 ? "needs_clarification" as const : "clear" as const,
    missing,
    questions: questions.slice(0, 5),
    minimumAnswer: "Responder estas preguntas antes de cotizar final, contactar al prospecto, construir o activar automatizaciones.",
    blocks: missing.length > 0 ? ["precio final", "contacto externo", "build completo", "launch/activacion"] : [],
  };
}

export function buildAutomationQuote(input: AutomationQuoteInput) {
  const request = input.request.toLowerCase();
  const toolText = input.currentTools.toLowerCase();
  const clarificationGate = buildRevenueClarificationGate({
    request: input.request,
    projectType: "automation",
    currentTools: input.currentTools,
  });
  const detectedNeeds = [
    includesAny(request, ["lead", "cliente", "customer", "prospect", "crm", "seguimiento", "signup", "trial"]) && "lead follow-up",
    includesAny(request, ["cita", "booking", "appointment", "calendar", "reserva"]) && "booking",
    includesAny(request, ["email", "sms", "whatsapp", "mensaje", "dm", "notify", "notification"]) && "messaging",
    includesAny(request, ["invoice", "factura", "pago", "payment", "stripe"]) && "payments",
    includesAny(request, ["reporte", "report", "dashboard", "metric", "analytics", "weekly"]) && "reporting",
    includesAny(request, ["inventory", "inventario", "stock", "orden", "order"]) && "operations",
    includesAny(request, ["ai", "ia", "chatbot", "assistant", "asistente"]) && "ai assistant",
  ].filter(Boolean) as string[];

  const integrations = [
    includesAny(toolText + request, ["google", "calendar", "gmail", "sheets"]) && "Google Workspace",
    includesAny(toolText + request, ["stripe", "payment", "pago"]) && "Stripe",
    includesAny(toolText + request, ["zapier", "make", "n8n"]) && "automation platform",
    includesAny(toolText + request, ["square", "toast", "clover", "pos"]) && "POS",
    includesAny(toolText + request, ["shopify", "woocommerce"]) && "ecommerce",
    includesAny(toolText + request, ["instagram", "facebook", "meta", "dm"]) && "social inbox",
    includesAny(toolText + request, ["whatsapp", "sms", "twilio"]) && "messaging provider",
  ].filter(Boolean) as string[];

  const needCount = Math.max(1, detectedNeeds.length);
  const integrationCount = integrations.length;
  const complexityScore = Math.min(10, 2 + needCount + integrationCount + (input.urgency === "this_week" ? 2 : 0));
  const setupPriceUsd = Math.max(1500, 1000 + complexityScore * 550);
  const retainerUsd = Math.max(300, 150 + complexityScore * 75);
  const estimatedInternalMonthlyCostUsd = Math.min(100, Number((8 + needCount * 7 + integrationCount * 9 + (detectedNeeds.includes("ai assistant") ? 25 : 0)).toFixed(0)));
  const grossMarginUsd = retainerUsd - estimatedInternalMonthlyCostUsd;
  const grossMarginPercent = Math.round((grossMarginUsd / retainerUsd) * 100);
  const needsClarification = clarificationGate.status === "needs_clarification" || detectedNeeds.length === 0;

  const clarifyingQuestions = [
    ...clarificationGate.questions,
    "Que paso exacto quieres automatizar primero?",
    "Donde viven hoy los leads/clientes: telefono, email, Instagram, Google Sheet, CRM u otro?",
    "Que debe pasar cuando entra un nuevo lead o pedido?",
    "Quien aprueba errores, pagos o mensajes sensibles antes de enviarlos?",
  ].filter((question, index, all) => all.indexOf(question) === index).slice(0, needsClarification ? 5 : 2);

  return {
    input,
    clarificationGate,
    decision: {
      status: needsClarification ? "needs_clarification" : "ready_to_pitch",
      approvalMode: "draft_only",
      reason: needsClarification
        ? "El pedido todavia necesita respuestas antes de prometer entrega o precio final."
        : "Hay suficiente informacion para preparar una propuesta de venta con QA y deposito.",
    },
    pricing: {
      setupPriceUsd,
      requiredDepositUsd: Math.round(setupPriceUsd * 0.5),
      monthlyRetainerUsd: retainerUsd,
      estimatedInternalMonthlyCostUsd,
      grossMarginUsd,
      grossMarginPercent,
      insideCostCap: estimatedInternalMonthlyCostUsd <= 100,
      clientBudgetFit: input.monthlyBudgetUsd >= retainerUsd ? "fits" : "upsell_or_reduce_scope",
    },
    scope: {
      packageName: complexityScore >= 7 ? "Automation Sprint Plus" : "Automation Sprint",
      detectedNeeds: detectedNeeds.length ? detectedNeeds : ["manual workflow discovery"],
      integrations: integrations.length ? integrations : ["no external integration confirmed"],
      deliverables: [
        "Mapa del proceso actual y nuevo flujo automatizado",
        "Intake/formulario o trigger inicial",
        "Base simple de clientes/leads o conexion con herramienta actual",
        "Notificaciones y seguimiento",
        "Dashboard basico de estado y resultados",
        "Manual corto de uso y handoff",
      ],
      outOfScopeUntilApproved: [
        "Mensajes masivos sin opt-in verificable",
        "Comprar data de leads",
        "Cobrar clientes finales",
        "Integraciones con credenciales del cliente sin acceso seguro",
      ],
    },
    agents: [
      {
        id: "automation-architect",
        check: "Define flujo, herramientas y entregables",
        result: complexityScore <= 7 ? "pass" : "review",
      },
      {
        id: "cost-controller",
        check: "Mantiene costo interno por debajo de $100/mes al inicio",
        result: estimatedInternalMonthlyCostUsd <= 100 ? "pass" : "block",
      },
      {
        id: "qa-council",
        check: "Exige pruebas, logs, rollback y aprobacion de acciones sensibles",
        result: "pass",
      },
      {
        id: "closer",
        check: "No envia propuesta final hasta que Robert apruebe precio y alcance",
        result: "approval_required",
      },
    ],
    clientProposalDraft: {
      headline: `${input.businessName}: automatizacion para ahorrar tiempo y cerrar mas clientes`,
      summary:
        `Podemos automatizar el flujo principal de ${input.industry} empezando por ${detectedNeeds[0] || "el proceso manual mas repetitivo"}. La entrega incluye setup, QA, dashboard y soporte mensual para que el sistema siga mejorando sin subir costos innecesarios.`,
      close:
        `Para empezar: deposito de $${Math.round(setupPriceUsd * 0.5).toLocaleString("en-US")} y kickoff de 30 minutos. No enviamos ni activamos nada sensible sin aprobacion.`,
    },
    deliveryPlan: [
      "Dia 1: discovery, accesos y mapa del flujo",
      "Dia 2-3: build del flujo minimo rentable",
      "Dia 4: QA de subagentes y pruebas con datos de ejemplo",
      "Dia 5: demo, ajustes y aprobacion",
      "Dia 6-7: launch controlado y primer reporte",
    ],
    improvementLoop: [
      "Medir tiempo ahorrado y errores evitados",
      "Guardar objeciones y pedidos nuevos",
      "Reducir pasos manuales cada semana",
      "Subir retainer solo cuando el ROI este probado",
    ],
    clarifyingQuestions,
  };
}

export function recordRevenueAutomationOpportunity(input: RevenueAutomationOpportunityInput) {
  loadRevenueAutomationOpportunities();
  const quote = buildAutomationQuote(input);
  const qaGates = [
    {
      gate: "clarity",
      passed: quote.decision.status === "ready_to_pitch",
      fix: "Responder preguntas clave antes de prometer alcance final.",
    },
    {
      gate: "scope",
      passed: input.clientApprovedScope || input.status === "intake" || input.status === "quoted",
      fix: "Conseguir aprobacion escrita del alcance antes de delivery.",
    },
    {
      gate: "deposit",
      passed: input.depositPaid || input.status === "intake" || input.status === "quoted",
      fix: `Cobrar deposito de $${quote.pricing.requiredDepositUsd.toLocaleString("en-US")} antes de construir.`,
    },
    {
      gate: "cost",
      passed: quote.pricing.insideCostCap,
      fix: "Reducir herramientas o subir retainer para mantener costo interno bajo $100/mes.",
    },
    {
      gate: "margin",
      passed: quote.pricing.grossMarginPercent >= 65,
      fix: "Subir retainer o recortar alcance hasta margen bruto minimo de 65%.",
    },
  ];
  const hasBlockingGate = qaGates.some((gate) => !gate.passed && ["clarity", "cost", "margin"].includes(gate.gate));
  const status: RevenueAutomationOpportunity["status"] =
    hasBlockingGate ? "blocked" : input.status === "intake" && quote.decision.status === "ready_to_pitch" ? "quoted" : input.status;
  const now = new Date().toISOString();
  const opportunity: RevenueAutomationOpportunity = {
    ...input,
    status,
    id: `automation-opportunity-${Date.now()}-${revenueAutomationOpportunities.length + 1}`,
    createdAt: now,
    updatedAt: now,
    quote,
    qaGates,
    nextAction:
      status === "blocked"
        ? "Corregir gates bloqueantes antes de vender o construir."
        : status === "quoted"
          ? "Enviar propuesta en draft, pedir aprobacion de scope y cobrar deposito."
          : status === "approved"
            ? "Crear plan de produccion y no activar acciones sensibles sin QA."
            : status === "sold"
              ? "Registrar venta en ledger y pasar a produccion."
              : "Actualizar estado y correr QA antes de avanzar.",
  };

  revenueAutomationOpportunities.push(opportunity);
  persistRevenueAutomationOpportunities();

  return {
    opportunity,
    snapshot: getRevenueEngineSnapshot(),
  };
}

export function buildDeliveryReview(input: DeliveryReviewInput) {
  const grossMarginUsd = input.monthlyRetainerUsd - input.estimatedInternalMonthlyCostUsd;
  const grossMarginPercent = input.monthlyRetainerUsd > 0 ? Math.round((grossMarginUsd / input.monthlyRetainerUsd) * 100) : 0;
  const isAutomation = input.projectType === "automation" || input.projectType === "bundle";
  const isWebsite = input.projectType === "website" || input.projectType === "bundle";

  const gates = [
    {
      id: "commercial-approval",
      agent: "closer",
      label: "Scope aprobado por cliente",
      passed: input.clientApprovedScope,
      fix: "Conseguir aprobacion escrita del alcance, precio, timeline y limites.",
    },
    {
      id: "deposit",
      agent: "finance-controller",
      label: "Deposito recibido",
      passed: input.depositPaid,
      fix: "No construir ni lanzar trabajo sensible sin deposito.",
    },
    {
      id: "data-verification",
      agent: "business-researcher",
      label: "Data publica verificada",
      passed: input.publicDataVerified,
      fix: "Marcar fuentes, quitar claims dudosos y confirmar datos del negocio.",
    },
    {
      id: "responsive",
      agent: "visual-qa",
      label: "Mobile/desktop revisado",
      passed: !isWebsite || input.responsiveChecked,
      fix: "Revisar mobile, desktop, textos largos, formularios y hero visual.",
    },
    {
      id: "links",
      agent: "technical-qa",
      label: "Links y formularios probados",
      passed: input.linksChecked,
      fix: "Probar CTA, formulario, email, telefono, tracking y paginas clave.",
    },
    {
      id: "automation-test",
      agent: "automation-qa",
      label: "Automatizacion probada con datos de ejemplo",
      passed: !isAutomation || input.automationTested,
      fix: "Correr pruebas con datos falsos, errores comunes y aprobaciones sensibles.",
    },
    {
      id: "rollback",
      agent: "ops-qa",
      label: "Rollback/manual fallback listo",
      passed: !isAutomation || input.rollbackPlanReady,
      fix: "Definir como pausar el flujo y operar manualmente si algo falla.",
    },
    {
      id: "cost-cap",
      agent: "cost-controller",
      label: "Costo interno bajo $100/mes",
      passed: input.estimatedInternalMonthlyCostUsd <= 100,
      fix: "Reducir herramientas pagadas, limitar volumen o subir retainer antes de lanzar.",
    },
    {
      id: "margin",
      agent: "growth-director",
      label: "Margen mensual rentable",
      passed: grossMarginPercent >= 65 && grossMarginUsd > 0,
      fix: "Subir precio mensual, bajar costo o recortar alcance.",
    },
  ];

  const failedGates = gates.filter((gate) => !gate.passed);
  const blockingGates = failedGates.filter((gate) => ["deposit", "cost-cap", "margin", "automation-test", "rollback"].includes(gate.id));
  const status = blockingGates.length > 0 ? "blocked" : failedGates.length > 0 ? "needs_fix" : "ready_to_deliver";

  return {
    input,
    status,
    summary: {
      passed: gates.length - failedGates.length,
      total: gates.length,
      failed: failedGates.length,
      blocking: blockingGates.length,
      setupPriceUsd: input.setupPriceUsd,
      monthlyRetainerUsd: input.monthlyRetainerUsd,
      estimatedInternalMonthlyCostUsd: input.estimatedInternalMonthlyCostUsd,
      grossMarginUsd,
      grossMarginPercent,
      insideCostCap: input.estimatedInternalMonthlyCostUsd <= 100,
    },
    gates,
    requiredFixes: failedGates.map((gate) => ({
      gateId: gate.id,
      ownerAgent: gate.agent,
      action: gate.fix,
    })),
    deliveryDecision:
      status === "ready_to_deliver"
        ? "Puede entregarse despues de aprobacion final de Robert."
        : status === "needs_fix"
          ? "No entregar todavia. Corregir detalles no bloqueantes y volver a revisar."
          : "Bloqueado. No entregar, lanzar ni contactar hasta resolver los gates criticos.",
    nextReview: {
      cadence: status === "ready_to_deliver" ? "post-launch weekly improvement" : "rerun after fixes",
      improvementMetrics: [
        "tiempo ahorrado",
        "leads/reservas generadas",
        "errores detectados",
        "costo mensual real",
        "margen mensual real",
      ],
    },
  };
}

export function buildRevenueDeliveryWorkspace(input: RevenueDeliveryWorkspaceInput) {
  const projectPlan = buildRevenueProjectPlan(input);
  const deliveryReview = buildDeliveryReview({
    projectName: input.workspaceName || input.clientName,
    projectType: input.projectType,
    setupPriceUsd: input.setupUsd,
    monthlyRetainerUsd: input.monthlyRetainerUsd,
    estimatedInternalMonthlyCostUsd: input.estimatedInternalCostUsd,
    clientApprovedScope: input.scopeApproved,
    depositPaid: input.depositPaid,
    publicDataVerified: input.publicDataVerified,
    responsiveChecked: input.projectType === "automation" || input.visualQaPassed,
    linksChecked: input.technicalQaPassed,
    automationTested: !input.includesAutomation || input.automationQaPassed,
    rollbackPlanReady: !input.includesAutomation || input.automationQaPassed,
    notes: input.clientRequest || "Delivery workspace generado por Revenue Engine.",
  });
  const correctionQueue = deliveryReview.requiredFixes.map((fix) => ({
    agent: fix.ownerAgent,
    priority: ["deposit", "automation-test", "rollback", "cost-cap", "margin"].includes(fix.gateId) ? "high" as const : "medium" as const,
    action: fix.action,
    blocksDelivery: ["deposit", "automation-test", "rollback", "cost-cap", "margin"].includes(fix.gateId),
  }));
  const handoffCorrection = !input.clientHandoffReady
    ? [{
        agent: "growth-director",
        priority: "medium" as const,
        action: "Preparar handoff del cliente: demo, instrucciones, limites, soporte y siguiente review semanal.",
        blocksDelivery: false,
      }]
    : [];
  const allCorrections = [...correctionQueue, ...handoffCorrection];
  const status: RevenueDeliveryWorkspace["status"] =
    deliveryReview.status === "blocked" || projectPlan.decision.status === "blocked"
      ? "blocked"
      : allCorrections.length > 0 || projectPlan.decision.status !== "ready_to_build"
        ? "needs_corrections"
        : "ready_to_deliver";
  const requiredBeforeClient = [
    ...projectPlan.decision.missing,
    ...allCorrections.filter((item) => item.blocksDelivery).map((item) => item.action),
    !input.clientHandoffReady && "handoff del cliente listo",
  ].filter(Boolean) as string[];

  return {
    input,
    status,
    projectPlan,
    deliveryReview,
    correctionQueue: allCorrections,
    runbook: projectPlan.phases.map((phase) => ({
      phase: phase.name,
      ownerAgent: phase.ownerAgent,
      checklist: phase.tasks,
    })),
    approvalSummary: {
      canShowClientPreview: projectPlan.decision.status !== "blocked" && deliveryReview.summary.blocking === 0,
      canLaunch: status === "ready_to_deliver" && input.clientHandoffReady,
      requiredBeforeClient,
    },
    learningNote:
      status === "ready_to_deliver"
        ? `${input.clientName}: entrega lista con QA, costo <= $100/mes y handoff preparado.`
        : `${input.clientName}: no entregar todavia; subagentes tienen ${allCorrections.length} correcciones antes de cliente.`,
  };
}

export function recordRevenueDeliveryWorkspace(input: RevenueDeliveryWorkspaceInput) {
  loadRevenueDeliveryWorkspaces();
  const workspace = buildRevenueDeliveryWorkspace(input);
  const now = new Date().toISOString();
  const persisted: RevenueDeliveryWorkspace = {
    ...workspace,
    id: `delivery-workspace-${Date.now()}-${revenueDeliveryWorkspaces.length + 1}`,
    createdAt: now,
    updatedAt: now,
  };

  revenueDeliveryWorkspaces.push(persisted);
  persistRevenueDeliveryWorkspaces();

  return {
    workspace: persisted,
    snapshot: getRevenueEngineSnapshot(),
  };
}

export function updateRevenueDeliveryWorkspaceQa(input: RevenueDeliveryWorkspaceUpdateInput) {
  loadRevenueDeliveryWorkspaces();
  const parsed = revenueDeliveryWorkspaceUpdateSchema.parse(input);
  const workspaceIndex = revenueDeliveryWorkspaces.findIndex((item) => item.id === parsed.workspaceId);

  if (workspaceIndex === -1) {
    return {
      status: "not_found" as const,
      reason: "Workspace no encontrado.",
      workspace: null,
      snapshot: getRevenueEngineSnapshot(),
    };
  }

  const existing = revenueDeliveryWorkspaces[workspaceIndex];
  const nextInput: RevenueDeliveryWorkspaceInput = {
    ...existing.input,
    publicDataVerified: parsed.publicDataVerified ?? existing.input.publicDataVerified,
    visualQaPassed: parsed.visualQaPassed ?? existing.input.visualQaPassed,
    technicalQaPassed: parsed.technicalQaPassed ?? existing.input.technicalQaPassed,
    automationQaPassed: parsed.automationQaPassed ?? existing.input.automationQaPassed,
    clientHandoffReady: parsed.clientHandoffReady ?? existing.input.clientHandoffReady,
    clientRequest: parsed.notes
      ? `${existing.input.clientRequest}\n\nQA update: ${parsed.notes}`.slice(0, 1200)
      : existing.input.clientRequest,
  };
  const rebuilt = buildRevenueDeliveryWorkspace(nextInput);
  const updated: RevenueDeliveryWorkspace = {
    ...rebuilt,
    id: existing.id,
    createdAt: existing.createdAt,
    updatedAt: new Date().toISOString(),
  };

  revenueDeliveryWorkspaces[workspaceIndex] = updated;
  persistRevenueDeliveryWorkspaces();

  return {
    status: updated.status === "ready_to_deliver" ? "ready" as const : "needs_corrections" as const,
    reason:
      updated.status === "ready_to_deliver"
        ? "Workspace listo para entrega: QA, handoff, deposito, scope, costo y margen verificados."
        : "Workspace revalidado; aun quedan correcciones antes de mostrar, lanzar o entregar.",
    workspace: updated,
    snapshot: getRevenueEngineSnapshot(),
  };
}

export function deliverRevenueDeliveryWorkspace(input: RevenueDeliveryWorkspaceDeliverInput) {
  loadRevenueDeliveryWorkspaces();
  loadRevenueAutomationOpportunities();
  const parsed = revenueDeliveryWorkspaceDeliverSchema.parse(input);
  const workspaceIndex = revenueDeliveryWorkspaces.findIndex((item) => item.id === parsed.workspaceId);

  if (workspaceIndex === -1) {
    return {
      status: "not_found" as const,
      reason: "Workspace no encontrado.",
      workspace: null,
      opportunity: null,
      handoff: null,
      snapshot: getRevenueEngineSnapshot(),
    };
  }

  const workspace = revenueDeliveryWorkspaces[workspaceIndex];
  const missing = [
    !parsed.approvedByRobert && "aprobacion final de Robert",
    workspace.status !== "ready_to_deliver" && `workspace no esta listo: ${workspace.status}`,
    !workspace.approvalSummary.canLaunch && "launch/handoff bloqueado",
    ...workspace.approvalSummary.requiredBeforeClient,
  ].filter(Boolean) as string[];

  if (missing.length > 0) {
    return {
      status: "blocked" as const,
      reason: `No entregar todavia: ${Array.from(new Set(missing)).join("; ")}.`,
      workspace,
      opportunity: null,
      handoff: null,
      snapshot: getRevenueEngineSnapshot(),
    };
  }

  const opportunity = workspace.input.sourceOpportunityId
    ? revenueAutomationOpportunities.find((item) => item.id === workspace.input.sourceOpportunityId) || null
    : null;
  if (opportunity) {
    opportunity.status = "delivered";
    opportunity.nextAction = "Entrega marcada como completada. Medir resultados y correr review semanal.";
    opportunity.updatedAt = new Date().toISOString();
    persistRevenueAutomationOpportunities();
  }

  const updatedWorkspace: RevenueDeliveryWorkspace = {
    ...workspace,
    updatedAt: new Date().toISOString(),
    learningNote: `${workspace.input.clientName}: entregado con QA aprobado; medir resultados en review semanal.`,
  };
  revenueDeliveryWorkspaces[workspaceIndex] = updatedWorkspace;
  persistRevenueDeliveryWorkspaces();

  return {
    status: "delivered" as const,
    reason: "Entrega aprobada: QA, handoff, costo, margen, deposito y rollback verificados.",
    workspace: updatedWorkspace,
    opportunity,
    handoff: {
      clientName: updatedWorkspace.input.clientName,
      packageName: updatedWorkspace.input.packageName,
      deliveredAt: updatedWorkspace.updatedAt,
      supportPlan: "Revisar resultados semanalmente y guardar aprendizajes en Improvement Review.",
      requiredFollowUpMetrics: updatedWorkspace.deliveryReview.nextReview.improvementMetrics,
      notes: parsed.notes,
    },
    snapshot: getRevenueEngineSnapshot(),
  };
}

export function recordRevenueDeliveryWorkspaceImprovementReview(input: RevenueDeliveryWorkspaceImprovementReviewInput) {
  loadRevenueDeliveryWorkspaces();
  const parsed = revenueDeliveryWorkspaceImprovementReviewSchema.parse(input);
  const workspaceIndex = revenueDeliveryWorkspaces.findIndex((item) => item.id === parsed.workspaceId);

  if (workspaceIndex === -1) {
    return {
      status: "not_found" as const,
      reason: "Workspace no encontrado.",
      workspace: null,
      review: null,
      snapshot: getRevenueEngineSnapshot(),
    };
  }

  const workspace = revenueDeliveryWorkspaces[workspaceIndex];
  const missing = [
    workspace.status !== "ready_to_deliver" && `workspace no esta listo: ${workspace.status}`,
    !workspace.approvalSummary.canLaunch && "launch/handoff bloqueado",
    ...workspace.approvalSummary.requiredBeforeClient,
  ].filter(Boolean) as string[];

  if (missing.length > 0) {
    return {
      status: "blocked" as const,
      reason: `No guardar review de mejora todavia: ${Array.from(new Set(missing)).join("; ")}.`,
      workspace,
      review: null,
      snapshot: getRevenueEngineSnapshot(),
    };
  }

  const notes = [
    parsed.notes,
    workspace.learningNote,
    `Delivery gates: ${workspace.deliveryReview.summary.passed}/${workspace.deliveryReview.summary.total}; correcciones abiertas ${workspace.correctionQueue.length}.`,
  ].filter(Boolean).join("\n\n").slice(0, 1200);
  const recorded = recordRevenueImprovementReview({
    campaignName: workspace.input.clientName,
    periodLabel: parsed.periodLabel,
    leadsContacted: parsed.leadsContacted,
    replies: parsed.replies,
    callsBooked: parsed.callsBooked,
    dealsClosed: parsed.dealsClosed,
    revenueCollectedUsd: parsed.revenueCollectedUsd ?? workspace.input.setupUsd,
    spendUsd: parsed.spendUsd ?? 0,
    estimatedInternalMonthlyCostUsd: workspace.input.estimatedInternalCostUsd,
    hoursSaved: parsed.hoursSaved,
    defectsFound: parsed.defectsFound,
    clientComplaints: parsed.clientComplaints,
    bestOffer: workspace.input.packageName,
    biggestObjection: workspace.correctionQueue[0]?.action || "Medir resultados post-entrega antes de escalar.",
    notes,
  });

  const updatedWorkspace: RevenueDeliveryWorkspace = {
    ...workspace,
    updatedAt: new Date().toISOString(),
    learningNote: `${workspace.input.clientName}: improvement review ${recorded.review.id} guardado; usar aprendizaje para el proximo batch.`,
  };
  revenueDeliveryWorkspaces[workspaceIndex] = updatedWorkspace;
  persistRevenueDeliveryWorkspaces();

  return {
    status: "recorded" as const,
    reason: "Improvement Review creada desde delivery workspace; playbook y next batch actualizados.",
    workspace: updatedWorkspace,
    review: recorded.review,
    snapshot: getRevenueEngineSnapshot(),
  };
}

export function buildProposalEmail(input: ProposalEmailInput) {
  const totalSetupUsd = input.websitePriceUsd + input.automationPriceUsd;
  const depositUsd = Math.round(totalSetupUsd * 0.5);
  const grossMarginUsd = input.monthlyRetainerUsd - input.estimatedInternalMonthlyCostUsd;
  const grossMarginPercent = input.monthlyRetainerUsd > 0 ? Math.round((grossMarginUsd / input.monthlyRetainerUsd) * 100) : 0;
  const sourceLine = input.sourceUrl ? `Fuente revisada: ${input.sourceUrl}` : "Fuente revisada: informacion publica provista o detectada.";
  const subject = `Cotizacion de prueba - ${input.businessName} website + automatizaciones`;
  const body = [
    `${input.contactName},`,
    "",
    `Te mando una cotizacion de prueba basada en la informacion publica revisada para ${input.businessName}.`,
    sourceLine,
    "",
    "Resumen del negocio actual:",
    input.businessSummary
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => `- ${line.replace(/^[-•]\s*/, "")}`)
      .join("\n"),
    "",
    `Propuesta de mejora: ${input.businessName} 3D Revenue Website`,
    "",
    "Objetivo:",
    "Convertir el website en una experiencia premium que venda mas, capture leads, empuje productos/eventos/contenido y permita automatizar seguimiento sin subir el costo operativo.",
    "",
    "Lo que haria:",
    "1. Homepage inmersiva con hero 3D/video, propuesta clara y CTA principal.",
    "2. Motor de ofertas/eventos/productos con cards premium, filtros, tracking y conversion.",
    "3. Media hub para videos, radio, galerias o casos con previews dinamicos.",
    "4. Captura de leads con newsletter, formularios y opt-in para follow-up.",
    "5. Dashboard interno simple con leads, clicks, ventas/interes y rendimiento semanal.",
    "6. Automatizaciones con aprobacion antes de enviar mensajes o activar acciones sensibles.",
    "7. QA antes de publicar: data, mobile, links, formularios, costo, margen y rollback.",
    "",
    "Automatizaciones recomendadas:",
    "- Follow-up automatico para leads/newsletter.",
    "- Recordatorios o campañas con aprobacion antes de enviar.",
    "- Recuperacion de carrito o interesados.",
    "- Reporte semanal de ventas/interes/leads.",
    "- Pipeline para partners, clientes o colaboradores.",
    "- QA operativo antes de publicar cambios importantes.",
    "",
    "Paquete recomendado:",
    "Website 3D Premium + Automation Sprint",
    "",
    "Precio de prueba:",
    `- Setup website premium: $${input.websitePriceUsd.toLocaleString("en-US")}`,
    `- Automation Sprint: $${input.automationPriceUsd.toLocaleString("en-US")}`,
    `- Total setup: $${totalSetupUsd.toLocaleString("en-US")}`,
    `- Deposito para comenzar: $${depositUsd.toLocaleString("en-US")}`,
    `- Retainer mensual recomendado: $${input.monthlyRetainerUsd.toLocaleString("en-US")}/mes`,
    "",
    "Costo interno estimado:",
    `- Herramientas/API/hosting al inicio: ~$${input.estimatedInternalMonthlyCostUsd.toLocaleString("en-US")}/mes`,
    "- Cap interno inicial: menos de $100/mes",
    `- Margen mensual estimado: ~${grossMarginPercent}% si el retainer queda en $${input.monthlyRetainerUsd.toLocaleString("en-US")}/mes`,
    "",
    "Timeline:",
    "- Dia 1: discovery, assets, access, sitemap y tracking plan",
    "- Dia 2-3: mockup premium y estructura 3D/dinamica",
    "- Dia 4-5: build de paginas clave + oferta/media/productos",
    "- Dia 6: automatizaciones y dashboard",
    "- Dia 7: QA completo, mobile, links, rollback y entrega",
    "",
    "QA antes de entregar:",
    "- Scope aprobado por cliente",
    "- Deposito pagado",
    "- Data publica verificada",
    "- Mobile/desktop probado",
    "- Links, forms, checkout y CTAs probados",
    "- Automatizaciones probadas con datos de ejemplo",
    "- Rollback/manual fallback listo",
    "- Costo interno bajo $100/mes",
    "- Margen rentable confirmado",
    input.notes ? "" : null,
    input.notes || null,
    "",
    "Decision:",
    "Esta seria una oferta rentable para vender como demo: alta percepcion visual, automatizaciones claras y costo inicial controlado.",
    "",
    "- Revenue Engine",
  ].filter((line): line is string => line !== null).join("\n");

  const encodedTo = encodeURIComponent(input.recipientEmail);
  const encodedSubject = encodeURIComponent(subject);
  const encodedBody = encodeURIComponent(body);

  return {
    input,
    subject,
    body,
    pricing: {
      totalSetupUsd,
      depositUsd,
      monthlyRetainerUsd: input.monthlyRetainerUsd,
      estimatedInternalMonthlyCostUsd: input.estimatedInternalMonthlyCostUsd,
      grossMarginUsd,
      grossMarginPercent,
      insideCostCap: input.estimatedInternalMonthlyCostUsd <= 100,
    },
    delivery: {
      mode: "draft_only",
      sendStatus: "not_sent",
      reason: "No email provider is connected. Open Gmail/mailto or copy the draft after review.",
      requiresApproval: true,
    },
    links: {
      mailto: `mailto:${encodedTo}?subject=${encodedSubject}&body=${encodedBody}`,
      gmailCompose: `https://mail.google.com/mail/?view=cm&fs=1&to=${encodedTo}&su=${encodedSubject}&body=${encodedBody}`,
    },
  };
}

function buildRevenueScoutQueue(input: RevenueMoneySprintInput) {
  const parsed = revenueMoneySprintSchema.parse(input);
  const niches = parsed.niche
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 5);
  const safeNiches = niches.length ? niches : [parsed.niche];
  const tasks = safeNiches.flatMap((niche) => [
    {
      source: "google_search",
      query: `${niche} ${parsed.area} no website`,
      url: `https://www.google.com/search?q=${encodeURIComponent(`${niche} ${parsed.area} no website`)}`,
      evidenceToCapture: ["business name", "listing/profile URL", "website status", "contact path"],
    },
    {
      source: "google_maps_manual",
      query: `${niche} ${parsed.area} Google Maps`,
      url: `https://www.google.com/maps/search/${encodeURIComponent(`${niche} ${parsed.area}`)}`,
      evidenceToCapture: ["website field", "phone", "reviews recency", "photos/services"],
    },
    {
      source: "instagram_public",
      query: `${niche} ${parsed.area} Instagram`,
      url: `https://www.google.com/search?q=${encodeURIComponent(`${niche} ${parsed.area} site:instagram.com`)}`,
      evidenceToCapture: ["bio link", "recent posts", "booking/contact signal", "no website signal"],
    },
  ]);

  return tasks.slice(0, Math.max(3, Math.min(parsed.dailyResearchTarget, 30))).map((task, index) => ({
    id: `scout-task-${String(index + 1).padStart(2, "0")}`,
    ...task,
    ownerAgent: index % 3 === 0 ? "lead-scout" : index % 3 === 1 ? "business-researcher" : "qa-council",
    allowedAction: "research_public_evidence_only",
    blockedActions: ["automated scraping", "contact business", "buy data", "publish preview"],
  }));
}

function buildRevenueScoutWorkPack(input: RevenueMoneySprintInput, scoutQueue: ReturnType<typeof buildRevenueScoutQueue>) {
  const parsed = revenueMoneySprintSchema.parse(input);
  const columns = [
    "business",
    "area",
    "niche",
    "website",
    "channel",
    "contact",
    "sourceUrl",
    "recipientEmail",
    "evidence",
    "painPoint",
    "offer",
    "contactName",
    "summary",
  ];
  const targetRows = Math.min(parsed.dailyQualifiedLeadLimit, 10);
  const safeNiche = parsed.niche.split(",").map((item) => item.trim()).filter(Boolean)[0] || parsed.niche;
  const placeholderRow = [
    "REPLACE_BUSINESS_NAME",
    parsed.area,
    safeNiche,
    "no_website",
    "email",
    "REPLACE_PUBLIC_CONTACT",
    "https://REPLACE_PUBLIC_SOURCE_URL",
    "owner@example.com",
    "Public listing/profile shows no dedicated website, recent service/product activity and a verifiable contact path.",
    "Needs a conversion-focused website, inquiry capture and follow-up.",
    "3500",
    "Owner",
    `REPLACE_BUSINESS_NAME in ${parsed.area} has public evidence of a missing or weak website and a clear ${parsed.offerFocus} opportunity.`,
  ].join("|");

  return {
    targetRows,
    batchHeader: columns.join("|"),
    copyableBatchTemplate: [
      columns.join("|"),
      ...Array.from({ length: Math.min(targetRows, 5) }, () => placeholderRow),
    ].join("\n"),
    subagentBrief: [
      `Find ${targetRows} real ${safeNiche} businesses in ${parsed.area} using only public sources.`,
      "Prioritize no-website or weak-website businesses with a visible contact path and recent activity.",
      "Do not contact businesses, buy data, scrape at scale, publish previews, or invent evidence.",
      "Return rows using the exact pipe-delimited batch header so Revenue Engine can preview, qualify and create draft-only outreach.",
    ].join(" "),
    importInstructions: [
      "Open the scout links.",
      "Capture real public evidence for each business.",
      "Paste completed rows into Batch leads.",
      "Run Preview batch before Money sprint.",
    ],
    qualityGate: [
      "Business name is real and area/niche match the mission.",
      "sourceUrl is a public listing, profile or business page used as evidence.",
      "website status is no_website or weak_website unless the opportunity is unusually strong.",
      "contact value and recipientEmail are public or business-provided.",
      "evidence is specific enough to justify a mockup and draft.",
    ],
    safety: {
      allowedAction: "public_research_only",
      blockedActions: scoutQueue.flatMap((task) => task.blockedActions).filter((action, index, actions) => actions.indexOf(action) === index),
      paidDataSpendUsd: 0,
      sendsOutreach: false,
      writesPreviewFiles: false,
    },
  };
}

export function buildRevenueScoutDispatch(input: RevenueScoutDispatchInput) {
  const parsed = revenueScoutDispatchSchema.parse(input);
  const mission = buildRevenueScoutingMission({
    area: parsed.area,
    niche: parsed.niche,
    offerFocus: parsed.offerFocus,
    targetLeadCount: parsed.dailyQualifiedLeadLimit,
    maxPaidDataSpendUsd: 0,
    requireNoWebsiteSignal: true,
    includeWeakWebsiteLeads: true,
  });
  const scoutQueue = buildRevenueScoutQueue({ ...parsed, maxPaidDataSpendUsd: 0 });
  const scoutWorkPack = buildRevenueScoutWorkPack({ ...parsed, maxPaidDataSpendUsd: 0 }, scoutQueue);
  const candidatePayloadTemplate = {
    businessName: "REPLACE_BUSINESS_NAME",
    area: parsed.area,
    niche: parsed.niche.split(",").map((item) => item.trim()).filter(Boolean)[0] || parsed.niche,
    websiteStatus: "no_website",
    contactChannel: "email",
    contactValue: "REPLACE_PUBLIC_CONTACT",
    evidence: "REPLACE_PUBLIC_EVIDENCE_WITH_SOURCE_CONTEXT",
    painPoint: "REPLACE_PUBLIC_PAIN_POINT",
    estimatedOfferUsd: 3500,
    status: "research",
    sourceUrl: "https://REPLACE_PUBLIC_SOURCE_URL",
    recipientEmail: "owner@example.com",
    contactName: "Owner",
    businessSummary: "REPLACE_SHORT_PUBLIC_SUMMARY",
    verificationStatus: "needs_review",
    publicEvidenceVerified: false,
    approvalToImport: false,
    missionId: mission.mission.name,
    sourceTaskId: "REPLACE_SCOUT_TASK_ID",
    notes: "Captured from public source. No outreach sent.",
  };

  const workOrders = scoutQueue.map((task, index) => ({
    id: `public-scout-work-${String(index + 1).padStart(2, "0")}`,
    sourceTaskId: task.id,
    ownerAgent: task.ownerAgent,
    source: task.source,
    query: task.query,
    url: task.url,
    targetRows: Math.max(1, Math.ceil(scoutWorkPack.targetRows / Math.max(1, scoutQueue.length))),
    browserInstructions: [
      `Open ${task.url}.`,
      "Find real businesses that match the area/niche and have no website or a weak website signal.",
      "Capture only public evidence: business name, source URL, website status, public contact path, recent activity and pain point.",
      "Do not contact the business, submit forms, buy data, scrape at scale or publish previews.",
      "Submit each verified candidate to /api/revenue-engine/public-lead-candidates with approvalToImport=false for Robert review.",
    ],
    candidatePayloadTemplate: {
      ...candidatePayloadTemplate,
      sourceTaskId: task.id,
    },
  }));

  return {
    status: "ready_for_public_scout_handoff" as const,
    mission: mission.mission,
    budgetGate: mission.budgetGate,
    scoutQueue,
    workOrders,
    publicScoutRunEndpoint: "/api/revenue-engine/public-scout-run",
    publicCandidateEndpoint: "/api/revenue-engine/public-lead-candidates",
    previewEndpoint: "/api/revenue-engine/money-sprint-preview",
    copyableApiRequest: {
      method: "POST",
      endpoint: "/api/revenue-engine/public-lead-candidates",
      body: candidatePayloadTemplate,
    },
    importInstructions: [
      ...scoutWorkPack.importInstructions,
      "Submit candidates with approvalToImport=false first.",
      "Use /api/revenue-engine/public-scout-run for batch capture after a browser/subagent finishes public research.",
      "Robert reviews/approves import before Money sprint creates leads, previews or draft outreach.",
    ],
    safety: {
      allowedAction: "dispatch_public_research_work_orders",
      blockedActions: ["automated scraping", "contact business", "buy data", "send outreach", "publish preview", "collect payment"],
      persistsLead: false,
      sendsOutreach: false,
      writesPreviewFiles: false,
      paidDataSpendUsd: 0,
      requiresRobertApprovalToImport: true,
    },
  };
}

function addDaysToIsoDate(startDate: string, daysToAdd: number) {
  const [year, month, day] = startDate.split("-").map((value) => Number(value));
  const date = new Date(Date.UTC(year, month - 1, day + daysToAdd));
  return date.toISOString().slice(0, 10);
}

function npmRunCommand(script: string, args: string[]) {
  return {
    command: "npm",
    args: ["run", script, "--", ...args],
  };
}

export function buildRevenuePublicScoutSchedule(input: RevenuePublicScoutScheduleInput) {
  const parsed = revenuePublicScoutScheduleSchema.parse(input);
  const dispatch = buildRevenueScoutDispatch({
    area: parsed.area,
    niche: parsed.niche,
    offerFocus: parsed.offerFocus,
    dailyResearchTarget: parsed.dailyResearchTarget,
    dailyQualifiedLeadLimit: parsed.dailyQualifiedLeadLimit,
    dailyMockupLimit: parsed.dailyMockupLimit,
    dailyContactLimit: 0,
    maxPaidDataSpendUsd: 0,
    requireRobertApprovalToContact: true,
    writePreviewFiles: false,
    seedLeads: [],
    seedLeadBatchText: "",
  });
  const guardedDispatch = {
    ...dispatch,
    importInstructions: [
      "Open only the scheduled public research URLs.",
      "Capture public notes with source URL, public contact path and specific evidence.",
      "Run revenue:public-scout-extract, then revenue:public-scout-run to persist candidates for Robert review only.",
      "Do not import leads or open a money sprint preview until Robert approves candidates through /api/revenue-engine/public-lead-candidates/review.",
    ],
  };
  const scheduleSlug = parsed.scheduleName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "public-scout";
  const hourSpacing = Math.max(1, Math.floor(8 / parsed.runsPerDay));
  const runCount = parsed.runDays * parsed.runsPerDay;
  const runs = Array.from({ length: runCount }, (_, index) => {
    const dayIndex = Math.floor(index / parsed.runsPerDay);
    const runIndexForDay = index % parsed.runsPerDay;
    const localHour = (parsed.runHourLocal + runIndexForDay * hourSpacing) % 24;
    const runDate = addDaysToIsoDate(parsed.startDate, dayIndex);
    const runId = `${scheduleSlug}-${runDate}-${String(runIndexForDay + 1).padStart(2, "0")}`;
    const workOrder = guardedDispatch.workOrders[index % Math.max(1, guardedDispatch.workOrders.length)];
    const runSource = parsed.browserExecutor === "subagent_browser" ? "browser_subagent" : "manual_browser";
    return {
      id: runId,
      date: runDate,
      localTime: `${String(localHour).padStart(2, "0")}:00`,
      timezone: parsed.timezone,
      executor: parsed.browserExecutor,
      sourceTaskId: workOrder?.sourceTaskId || "",
      source: workOrder?.source || "public_directory",
      query: workOrder?.query || "",
      url: workOrder?.url || "",
      targetCandidates: parsed.maxCandidatesPerRun,
      captureNotesPath: `revenue_workspace/public-scout/${runId}.notes.txt`,
      extractedJsonPath: `revenue_workspace/public-scout/${runId}.candidates.json`,
      commands: {
        prepareBrowserSession: npmRunCommand("revenue:browser-scout-session", [
          `--area=${parsed.area}`,
          `--niche=${parsed.niche}`,
          `--offer-focus=${parsed.offerFocus}`,
          `--daily-research-target=${parsed.dailyResearchTarget}`,
          `--daily-qualified-lead-limit=${parsed.maxCandidatesPerRun}`,
          `--daily-mockup-limit=${parsed.dailyMockupLimit}`,
        ]),
        extractCandidates: npmRunCommand("revenue:public-scout-extract", [
          `--input=revenue_workspace/public-scout/${runId}.notes.txt`,
          `--output=revenue_workspace/public-scout/${runId}.candidates.json`,
          `--area=${parsed.area}`,
          `--niche=${parsed.niche}`,
          `--offer-focus=${parsed.offerFocus}`,
          `--source=${runSource}`,
          `--scout-run-id=${runId}`,
        ]),
        captureForReview: npmRunCommand("revenue:public-scout-run", [
          `--input=revenue_workspace/public-scout/${runId}.candidates.json`,
          `--area=${parsed.area}`,
          `--niche=${parsed.niche}`,
          `--offer-focus=${parsed.offerFocus}`,
          `--source=${runSource}`,
          `--scout-run-id=${runId}`,
        ]),
      },
      reviewGate: "Captured candidates remain needs_review until Robert approves them through /api/revenue-engine/public-lead-candidates/review.",
    };
  });

  return {
    status: "ready_for_guarded_schedule" as const,
    scheduleName: parsed.scheduleName,
    timezone: parsed.timezone,
    runCount: runs.length,
    runs,
    dispatch: guardedDispatch,
    endpoints: {
      scoutDispatch: "/api/revenue-engine/scout-dispatch",
      publicScoutRun: "/api/revenue-engine/public-scout-run",
      publicCandidateReview: "/api/revenue-engine/public-lead-candidates/review",
    },
    safety: {
      allowedAction: "prepare_guarded_public_scout_schedule",
      blockedActions: ["automated scraping without review", "contact business", "buy data", "send outreach", "write preview files", "publish preview", "collect payment"],
      runsBrowserAutomatically: false,
      persistsLeads: false,
      sendsOutreach: false,
      writesPreviewFiles: false,
      paidDataSpendUsd: 0,
      requiresRobertReview: true,
    },
    nextAction: "Capture public notes for a run slot, then run revenue:public-scout-execute to persist review-only candidates for Robert.",
  };
}

function summarizeSeedLead(seed: RevenueMoneySprintSeedLeadInput) {
  if (seed.businessSummary.trim().length >= 40) return seed.businessSummary;
  return [
    `${seed.businessName} in ${seed.area} is a ${seed.niche} lead.`,
    seed.evidence || "Public evidence still needs review.",
    seed.painPoint || "Revenue opportunity needs confirmation.",
  ].join(" ");
}

function detectRevenueSeedBatchDelimiter(line: string): string {
  let quoted = false;
  const counts = { "|": 0, "\t": 0, ",": 0 };

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"' && quoted && next === '"') {
      index += 1;
      continue;
    }
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (!quoted && (char === "|" || char === "\t" || char === ",")) {
      counts[char] += 1;
    }
  }

  if (counts["|"] > 0) return "|";
  if (counts["\t"] > 0) return "\t";
  return ",";
}

function splitRevenueSeedBatchLine(line: string): string[] {
  const delimiter = detectRevenueSeedBatchDelimiter(line);
  const cells: string[] = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"' && quoted && next === '"') {
      current += '"';
      index += 1;
      continue;
    }
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (char === delimiter && !quoted) {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }

  cells.push(current.trim());
  return cells;
}

function normalizeSeedBatchKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isRevenueSeedBatchHeader(fields: string[]): boolean {
  const keys = fields.map(normalizeSeedBatchKey);
  return keys.some((key) => ["business", "businessname", "negocio", "name"].includes(key))
    && keys.some((key) => ["evidence", "evidencia"].includes(key));
}

function revenueSeedBatchValue(fields: string[], header: string[] | null, aliases: string[], fallbackIndex: number): string {
  if (header) {
    const index = header.findIndex((key) => aliases.includes(key));
    if (index >= 0) return fields[index] || "";
  }
  return fields[fallbackIndex] || "";
}

function normalizeRevenueSeedWebsiteStatus(value: string): RevenueLeadInput["websiteStatus"] {
  const normalized = normalizeSeedBatchKey(value);
  if (["nowebsite", "none", "missing", "sinwebsite", "no"].includes(normalized)) return "no_website";
  if (["weakwebsite", "weak", "old", "broken", "debil"].includes(normalized)) return "weak_website";
  if (["haswebsite", "has", "yes", "tienewebsite"].includes(normalized)) return "has_website";
  return "unknown";
}

function normalizeRevenueSeedContactChannel(value: string): RevenueLeadInput["contactChannel"] {
  const normalized = normalizeSeedBatchKey(value);
  if (normalized.includes("email") || normalized.includes("mail")) return "email";
  if (normalized.includes("phone") || normalized.includes("telefono") || normalized.includes("whatsapp")) return "phone";
  if (normalized.includes("instagram") || normalized.includes("ig")) return "instagram";
  if (normalized.includes("form")) return "contact_form";
  return "unknown";
}

function parseRevenueSeedOfferUsd(value: string): number {
  const parsed = Number(value.replace(/[^0-9.]/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 2500;
}

export function parseRevenueMoneySprintSeedLeadBatch(
  batchText: string,
  defaults: Pick<RevenueMoneySprintInput, "area" | "niche">,
): { seedLeads: RevenueMoneySprintSeedLeadInput[]; blockedSeeds: Array<{ businessName: string; reason: string }> } {
  const lines = batchText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .slice(0, 50);
  if (!lines.length) return { seedLeads: [], blockedSeeds: [] };

  let rows = lines.map(splitRevenueSeedBatchLine);
  let header: string[] | null = null;
  if (rows.length > 0 && isRevenueSeedBatchHeader(rows[0])) {
    header = rows[0].map(normalizeSeedBatchKey);
    rows = rows.slice(1);
  }

  const seedLeads: RevenueMoneySprintSeedLeadInput[] = [];
  const blockedSeeds: Array<{ businessName: string; reason: string }> = [];

  for (const fields of rows) {
    if (seedLeads.length >= 25) {
      blockedSeeds.push({ businessName: fields[0] || "batch row", reason: "batch limit 25" });
      continue;
    }

    const candidate = {
      businessName: revenueSeedBatchValue(fields, header, ["business", "businessname", "negocio", "name"], 0),
      area: revenueSeedBatchValue(fields, header, ["area", "city", "ciudad"], 1) || defaults.area,
      niche: revenueSeedBatchValue(fields, header, ["niche", "nicho", "industry", "categoria"], 2) || defaults.niche,
      websiteStatus: normalizeRevenueSeedWebsiteStatus(revenueSeedBatchValue(fields, header, ["website", "websitestatus", "site"], 3)),
      contactChannel: normalizeRevenueSeedContactChannel(revenueSeedBatchValue(fields, header, ["contactchannel", "channel", "canal"], 4)),
      contactValue: revenueSeedBatchValue(fields, header, ["contactvalue", "contact", "contacto"], 5),
      sourceUrl: revenueSeedBatchValue(fields, header, ["sourceurl", "source", "url", "fuente"], 6),
      recipientEmail: revenueSeedBatchValue(fields, header, ["recipientemail", "email", "to"], 7),
      evidence: revenueSeedBatchValue(fields, header, ["evidence", "evidencia"], 8),
      painPoint: revenueSeedBatchValue(fields, header, ["painpoint", "pain", "dolor", "opportunity"], 9),
      estimatedOfferUsd: parseRevenueSeedOfferUsd(revenueSeedBatchValue(fields, header, ["estimatedofferusd", "offer", "price", "oferta"], 10)),
      contactName: revenueSeedBatchValue(fields, header, ["contactname", "nombre"], 11) || "Owner",
      businessSummary: revenueSeedBatchValue(fields, header, ["businesssummary", "summary", "resumen"], 12),
      status: "research",
    };
    const parsed = revenueMoneySprintSeedLeadSchema.safeParse(candidate);
    if (parsed.success) {
      seedLeads.push(parsed.data);
      continue;
    }
    blockedSeeds.push({
      businessName: candidate.businessName || "batch row",
      reason: parsed.error.issues.map((issue) => issue.message).join("; "),
    });
  }

  return { seedLeads, blockedSeeds };
}

export function previewRevenueMoneySprintSeeds(input: RevenueMoneySprintInput) {
  const parsed = revenueMoneySprintSchema.parse(input);
  const parsedBatch = parseRevenueMoneySprintSeedLeadBatch(parsed.seedLeadBatchText, { area: parsed.area, niche: parsed.niche });
  const availableBatchSlots = Math.max(0, 25 - parsed.seedLeads.length);
  const sprintSeedLeads = [
    ...parsed.seedLeads,
    ...parsedBatch.seedLeads.slice(0, availableBatchSlots),
  ];
  const blockedSeeds = [
    ...parsedBatch.blockedSeeds,
    ...parsedBatch.seedLeads.slice(availableBatchSlots).map((seed) => ({
      businessName: seed.businessName,
      reason: "batch limit 25",
    })),
  ];
  let previewMockupCount = 0;
  const acceptedSeeds = sprintSeedLeads.map((seed, index) => {
    const qualification = qualifyRevenueLead(seed);
    const hasSource = seed.sourceUrl.trim().length > 0;
    const hasRecipient = seed.recipientEmail.trim().length > 0;
    const mockupEligible = ["A", "B"].includes(qualification.grade);
    const mockupReady = mockupEligible && previewMockupCount < parsed.dailyMockupLimit;
    if (mockupReady) previewMockupCount += 1;
    const draftReady = hasSource && hasRecipient && qualification.missing.length === 0;
    return {
      rowNumber: index + 1,
      businessName: seed.businessName,
      area: seed.area,
      niche: seed.niche,
      websiteStatus: seed.websiteStatus,
      contactChannel: seed.contactChannel,
      contactValue: seed.contactValue,
      sourceUrl: seed.sourceUrl,
      recipientEmail: seed.recipientEmail,
      estimatedOfferUsd: seed.estimatedOfferUsd,
      qualification,
      mockupReady,
      draftReady,
      missingForDraft: [
        !hasSource && "sourceUrl publico",
        !hasRecipient && "recipientEmail",
        ...qualification.missing,
      ].filter((item): item is string => Boolean(item)),
    };
  });
  const paidSpendBlocked = parsed.maxPaidDataSpendUsd > 0;

  return {
    status: paidSpendBlocked ? "needs_spend_approval" as const : acceptedSeeds.some((seed) => seed.mockupReady) ? "ready_to_import" as const : acceptedSeeds.length > 0 ? "needs_lead_evidence" as const : "empty" as const,
    acceptedSeeds,
    blockedSeeds,
    totals: {
      accepted: acceptedSeeds.length,
      blocked: blockedSeeds.length,
      mockupReady: acceptedSeeds.filter((seed) => seed.mockupReady).length,
      draftReady: acceptedSeeds.filter((seed) => seed.draftReady).length,
      maxImportable: 25,
    },
    safety: {
      persistsData: false,
      writesPreviewFiles: false,
      sendsOutreach: false,
      nextAction: paidSpendBlocked ? "Get Robert approval before running any paid data step; preview did not spend or persist." : acceptedSeeds.length > 0 ? "Review rows, then run Money sprint to persist selected batch and create draft-only outreach." : "Paste researched public leads before running preview.",
    },
  };
}

function revenueOutreachChannelFromLead(channel: RevenueLeadInput["contactChannel"]): RevenueOutreachDraftInput["channel"] {
  if (channel === "email") return "email";
  if (channel === "instagram") return "instagram";
  if (channel === "contact_form") return "contact_form";
  return "gmail";
}

export function runRevenueMoneySprint(input: RevenueMoneySprintInput) {
  const parsed = revenueMoneySprintSchema.parse(input);
  const mission = recordRevenueScoutingMission({
    area: parsed.area,
    niche: parsed.niche,
    offerFocus: parsed.offerFocus,
    targetLeadCount: parsed.dailyQualifiedLeadLimit,
    maxPaidDataSpendUsd: parsed.maxPaidDataSpendUsd,
    requireNoWebsiteSignal: true,
    includeWeakWebsiteLeads: true,
  });
  const radar = buildRevenueLeadRadar({
    area: parsed.area,
    niches: parsed.niche,
    offerFocus: parsed.offerFocus,
    runHoursPerDay: 24,
    dailyResearchTarget: parsed.dailyResearchTarget,
    dailyQualifiedLeadLimit: parsed.dailyQualifiedLeadLimit,
    dailyMockupLimit: parsed.dailyMockupLimit,
    dailyContactLimit: parsed.dailyContactLimit,
    maxPaidDataSpendUsd: parsed.maxPaidDataSpendUsd,
    requireRobertApprovalToContact: parsed.requireRobertApprovalToContact,
  });
  const templatePack = buildRevenueMockupTemplatePack({
    niche: parsed.niche,
    area: parsed.area,
    dailyMockupTarget: parsed.dailyMockupLimit,
    maxCustomMinutesPerMockup: 18,
    estimatedAiCostPerMockupUsd: 0,
  });
  const scoutQueue = buildRevenueScoutQueue(parsed);
  const scoutWorkPack = buildRevenueScoutWorkPack(parsed, scoutQueue);
  const recordedLeads: Array<ReturnType<typeof recordRevenueLead>> = [];
  const previews: Array<ReturnType<typeof buildRevenueMockupPreview>> = [];
  const outreachDrafts: Array<ReturnType<typeof recordRevenueOutreachDraft>> = [];
  const parsedBatch = parseRevenueMoneySprintSeedLeadBatch(parsed.seedLeadBatchText, { area: parsed.area, niche: parsed.niche });
  const availableBatchSlots = Math.max(0, 25 - parsed.seedLeads.length);
  const sprintSeedLeads = [
    ...parsed.seedLeads,
    ...parsedBatch.seedLeads.slice(0, availableBatchSlots),
  ];
  const blockedSeeds: Array<{ businessName: string; reason: string }> = [
    ...parsedBatch.blockedSeeds,
    ...parsedBatch.seedLeads.slice(availableBatchSlots).map((seed) => ({
      businessName: seed.businessName,
      reason: "batch limit 25",
    })),
  ];

  for (const seed of sprintSeedLeads) {
    const leadResult = recordRevenueLead({
      businessName: seed.businessName,
      area: seed.area,
      niche: seed.niche,
      websiteStatus: seed.websiteStatus,
      contactChannel: seed.contactChannel,
      contactValue: seed.contactValue,
      evidence: seed.evidence,
      painPoint: seed.painPoint,
      estimatedOfferUsd: seed.estimatedOfferUsd,
      status: seed.status,
    });
    recordedLeads.push(leadResult);

    const hasSource = seed.sourceUrl.trim().length > 0;
    const isMockupCandidate = ["A", "B"].includes(leadResult.qualification.grade) && previews.length < parsed.dailyMockupLimit;
    if (isMockupCandidate) {
      previews.push(buildRevenueMockupPreview({
        businessName: seed.businessName,
        area: seed.area,
        niche: seed.niche,
        websiteStatus: seed.websiteStatus,
        evidence: seed.evidence,
        painPoint: seed.painPoint,
        primaryOffer: parsed.offerFocus === "automations" ? "Automation Sprint + Revenue Dashboard" : "Website 3D Premium + Automation Sprint",
        estimatedOfferUsd: seed.estimatedOfferUsd,
        includeAutomation: parsed.offerFocus !== "websites",
      }, { writeFile: parsed.writePreviewFiles }));
    }

    const hasRecipient = seed.recipientEmail.trim().length > 0;
    if (hasRecipient && hasSource && leadResult.qualification.missing.length === 0) {
      outreachDrafts.push(recordRevenueOutreachDraft({
        leadId: leadResult.lead.id,
        channel: revenueOutreachChannelFromLead(seed.contactChannel),
        approvalStatus: "draft",
        recipientEmail: seed.recipientEmail,
        contactName: seed.contactName || "Owner",
        businessName: seed.businessName,
        sourceUrl: seed.sourceUrl,
        businessSummary: summarizeSeedLead(seed),
        websitePriceUsd: parsed.offerFocus === "automations" ? 0 : Math.max(1500, Math.round(seed.estimatedOfferUsd * 0.65)),
        automationPriceUsd: parsed.offerFocus === "websites" ? 0 : Math.max(750, Math.round(seed.estimatedOfferUsd * 0.35)),
        monthlyRetainerUsd: 750,
        estimatedInternalMonthlyCostUsd: 54,
        notes: "Money sprint draft. No enviar sin aprobacion humana final.",
      }));
    } else if (hasRecipient || hasSource || leadResult.qualification.missing.length > 0) {
      blockedSeeds.push({
        businessName: seed.businessName,
        reason: [
          !hasRecipient && "falta recipientEmail",
          !hasSource && "falta sourceUrl publico",
          leadResult.qualification.missing.length > 0 && `resolver lead: ${leadResult.qualification.missing.join(", ")}`,
        ].filter(Boolean).join("; "),
      });
    }
  }

  const paidSpendBlocked = parsed.maxPaidDataSpendUsd > 0;
  const canStartSelling = !paidSpendBlocked && (sprintSeedLeads.length === 0 || recordedLeads.some((result) => ["A", "B"].includes(result.qualification.grade)));

  return {
    status: paidSpendBlocked ? "needs_spend_approval" as const : canStartSelling ? "ready_to_start" as const : "needs_lead_evidence" as const,
    mode: "free_public_research_first" as const,
    mission: mission.mission,
    radar,
    templatePack,
    scoutQueue,
    scoutWorkPack,
    recordedLeads: recordedLeads.map((result) => ({
      lead: result.lead,
      qualification: result.qualification,
      deduped: result.deduped,
    })),
    previews,
    outreachDrafts: outreachDrafts.map((result) => result.draft),
    blockedSeeds,
    operatingLimits: {
      maxQualifiedLeadsToday: parsed.dailyQualifiedLeadLimit,
      maxMockupsToday: parsed.dailyMockupLimit,
      maxContactsToday: parsed.dailyContactLimit,
      maxPaidDataSpendUsd: Math.min(parsed.maxPaidDataSpendUsd, REVENUE_MONTHLY_COST_CAP_USD),
      externalContactMode: parsed.requireRobertApprovalToContact ? "draft_until_robert_approves" : "approved_queue_only",
    },
    approvalGates: [
      "No automated scraping or paid data in the starting sprint.",
      "No outbound email, DM or contact form submission without Robert approval.",
      "No client delivery before scope, deposit, QA and rollback are clear.",
      "No paid hosting/tools before cash collected or explicit approval.",
    ],
    nextActions:
      recordedLeads.length === 0
        ? ["Open scoutQueue tasks, capture public evidence, then rerun with seedLeads.", "Start with 10 leads, create 3-5 previews, contact only approved drafts."]
        : ["Review generated previews.", "Approve only the best outreach drafts.", "Record replies/calls/deposits in ledger and improvement review."],
    snapshot: getRevenueEngineSnapshot(),
  };
}

export function buildRevenueMoneyReadinessReport(input: RevenueMoneyReadinessInput = { mode: "first-sprint" }) {
  const parsed = revenueMoneyReadinessSchema.parse(input);
  const emailProvider = getRevenueEmailProviderStatus();
  const databaseReady = hasProductionRevenueDatabaseUrl(process.env.DATABASE_URL);
  const sessionSecretReady = hasStrongSecret(process.env.SESSION_SECRET);
  const moneyModeReady = process.env.REVENUE_ENGINE_MONEY_MODE === "live";
  const robertContactApproval = isExplicitRevenueApproval(process.env.REVENUE_ENGINE_ROBERT_CONTACT_APPROVED);
  const manualContactApproved = isExplicitRevenueApproval(process.env.REVENUE_ENGINE_MANUAL_CONTACT_APPROVED);
  const stripeCheckoutReady = hasLiveRevenueStripeKey(process.env.STRIPE_SECRET_KEY) && isExplicitRevenueApproval(process.env.REVENUE_ENGINE_STRIPE_CHECKOUT_ENABLED);
  const paymentLinkReady = hasRevenuePaymentLink(process.env.REVENUE_ENGINE_PAYMENT_LINK) && isExplicitRevenueApproval(process.env.REVENUE_ENGINE_PAYMENT_LINK_APPROVED_BY_ROBERT);
  const paymentPathApprovalReady = getRevenuePaymentPathApprovalReadyFromEnv(process.env.REVENUE_ENGINE_PAYMENT_LINK);
  const contactPathApprovalReady = getRevenueContactPathApprovalReadyFromEnv(emailProvider);
  const paymentVerified = isExplicitRevenueApproval(process.env.REVENUE_ENGINE_PAYMENT_SMOKE_VERIFIED) || isExplicitRevenueApproval(process.env.REVENUE_ENGINE_DEPOSIT_CONFIRMED_BY_ROBERT);
  const paymentReady = (stripeCheckoutReady || (paymentLinkReady && paymentPathApprovalReady)) && paymentVerified;
  const websiteDeployEnabled = isExplicitRevenueApproval(process.env.REVENUE_ENGINE_WEBSITE_DEPLOY_ENABLED);
  const websiteAppQaTargetPassed = isExplicitRevenueApproval(process.env.REVENUE_ENGINE_WEBSITE_APP_QA_TARGET_PASSED);
  const websitePreviewDeployVerified = isExplicitRevenueApproval(process.env.REVENUE_ENGINE_WEBSITE_PREVIEW_DEPLOY_VERIFIED);
  const websiteRollbackVerified = isExplicitRevenueApproval(process.env.REVENUE_ENGINE_WEBSITE_ROLLBACK_VERIFIED);
  const websitePublishApproved = isExplicitRevenueApproval(process.env.REVENUE_ENGINE_WEBSITE_PUBLISH_APPROVED_BY_ROBERT);
  const deployApproved = isExplicitRevenueApproval(process.env.REVENUE_ENGINE_DEPLOY_APPROVED_BY_ROBERT);
  const productionLaunchReady = databaseReady && sessionSecretReady && moneyModeReady && deployApproved;
  const guardedAutonomousSearchReady = true;
  const canContactBusinesses = moneyModeReady && robertContactApproval && contactPathApprovalReady && (emailProvider.configured || manualContactApproved);
  const canCollectMoney = moneyModeReady && paymentReady;
  const websiteDeliveryEvidenceReady = websiteDeployEnabled
    && websiteAppQaTargetPassed
    && websitePreviewDeployVerified
    && websiteRollbackVerified
    && websitePublishApproved;
  const canBuildWebsites = productionLaunchReady && websiteDeliveryEvidenceReady;
  const checks = [
    {
      id: "safe_public_research",
      label: "Public business research",
      status: "ok" as const,
      detail: "Scout dispatch can prepare public Google/Maps/Instagram work orders without spend or outreach.",
      nextStep: "Run scout dispatch and save only candidates with sourceUrl, contact path and specific evidence.",
    },
    {
      id: "evidence_gate",
      label: "Lead evidence gate",
      status: "ok" as const,
      detail: "Money sprint batch preview marks weak rows as not draft-ready and keeps outreach draft-only.",
      nextStep: "Keep importing only no_website/weak_website leads with public evidence.",
    },
    {
      id: "autonomous_business_search",
      label: "Guarded business discovery execution",
      status: guardedAutonomousSearchReady ? "ok" as const : "fail" as const,
      detail: "Guarded public subagent/browser capture can prepare public candidates for Robert review only; it does not run unrestricted scraping, import leads, send outreach, buy data, or publish previews.",
      nextStep: "Run revenue:public-scout-schedule with subagent_browser, capture public notes only, then run revenue:public-scout-execute before Robert review.",
    },
    {
      id: "production_persistence",
      label: "Production persistence",
      status: databaseReady ? "ok" as const : "fail" as const,
      detail: databaseReady ? "Production Postgres DATABASE_URL is configured." : "Production Postgres DATABASE_URL is missing, local or still a placeholder.",
      nextStep: databaseReady ? "Run db:push and production smoke checks before launch." : "Configure a real production Postgres DATABASE_URL outside tracked files.",
    },
    {
      id: "session_secret",
      label: "Session security",
      status: sessionSecretReady ? "ok" as const : "fail" as const,
      detail: sessionSecretReady ? "SESSION_SECRET has production length." : "SESSION_SECRET is missing, weak or a placeholder.",
      nextStep: sessionSecretReady ? "Keep the secret in the deployment secret manager." : "Set a random SESSION_SECRET with at least 32 characters.",
    },
    {
      id: "money_mode",
      label: "Real money mode",
      status: moneyModeReady ? "ok" as const : "fail" as const,
      detail: moneyModeReady ? "REVENUE_ENGINE_MONEY_MODE=live." : "Revenue Engine is still in dry-run/research mode.",
      nextStep: "Switch to live only after PR review, App QA, persistence and Robert approval.",
    },
    {
      id: "contact_businesses",
      label: "Contact businesses",
      status: canContactBusinesses ? "ok" as const : "fail" as const,
      detail: canContactBusinesses ? "Contact is approved with an audited path and a send/manual channel is configured." : "External outreach is blocked until Robert approval, a real send/manual contact path, and audited contact path decision are configured.",
      nextStep: "Run revenue:contact-path-approval-decision and revenue:contact-path-readiness-packet, then configure the approved manual/provider contact path outside tracked files before contacting businesses.",
    },
    {
      id: "collect_money",
      label: "Collect deposits",
      status: canCollectMoney ? "ok" as const : "fail" as const,
      detail: canCollectMoney ? "A live payment path is configured and smoke/deposit evidence is verified." : "No verified live Stripe/payment-link deposit path is configured.",
      nextStep: "Run revenue:payment-path-approval-decision and revenue:payment-path-readiness-packet, then configure the approved payment link outside tracked files before charging clients.",
    },
    {
      id: "website_build_pipeline",
      label: "Build and publish client websites",
      status: canBuildWebsites ? "ok" as const : "fail" as const,
      detail: canBuildWebsites ? "Website deploy flag, App QA evidence, preview deploy, rollback proof and Robert publish approval are present." : "The app can create internal mockups/workspaces/scaffolds, but not publish client websites end-to-end yet.",
      nextStep: "Run revenue:website-publish-approval-decision and revenue:website-publish-readiness-packet after preview deploy verification, App QA, rollback evidence and Robert publish approval.",
    },
    {
      id: "production_launch",
      label: "Production launch gate",
      status: productionLaunchReady ? "ok" as const : "fail" as const,
      detail: productionLaunchReady ? "Production env and Robert deploy approval are present." : "Production launch remains blocked until env, PR/App QA and Robert approval are complete.",
      nextStep: "Keep PR-first; do not deploy Replit without Robert approval.",
    },
  ];
  const blockingCheckIds = parsed.mode === "production-launch"
    ? new Set(["production_persistence", "session_secret", "money_mode", "contact_businesses", "collect_money", "website_build_pipeline", "production_launch"])
    : new Set(["production_persistence", "session_secret", "money_mode", "contact_businesses", "collect_money"]);
  const failedChecks = checks.filter((check) => check.status === "fail");
  const blockingFailedChecks = failedChecks.filter((check) => blockingCheckIds.has(check.id));
  const ready = blockingFailedChecks.length === 0;
  const status = ready
    ? parsed.mode === "production-launch" ? "production_money_ready" as const : "first_sprint_money_ready" as const
    : moneyModeReady ? "live_mode_blocked" as const : "dry_run_research_only" as const;
  const headline = ready
    ? parsed.mode === "production-launch"
      ? "Revenue Engine is ready for production money launch."
      : "Revenue Engine is ready for a guarded first money sprint."
    : moneyModeReady
      ? "Money mode is live, but required gates still block real selling."
      : "Puede buscar negocios en modo research/dry-run; falta activar money mode real.";

  return {
    ready,
    mode: parsed.mode,
    status,
    headline,
    canStartToday: true,
    canSearchBusinesses: true,
    canAutonomousSearchBusinesses: false,
    canRunGuardedPublicScoutCapture: guardedAutonomousSearchReady,
    canDraftOutreach: true,
    canCreateInternalMockups: true,
    canContactBusinesses,
    canCollectMoney,
    canBuildWebsites,
    nextApiAction: "/api/revenue-engine/scout-dispatch",
    nextAction: blockingFailedChecks[0]?.nextStep || "Run a guarded public research sprint.",
    allowedToday: [
      "Public research from Google/Maps/Instagram/directories.",
      "Run guarded public subagent/browser scout capture into Robert-review candidates only: no contact, no paid data, no scraping at scale, no lead import, no preview publishing.",
      "Generate internal mockups/previews and draft-only outreach.",
      "Prepare audited contact path readiness packets after Robert approves the exact manual/provider contact path; the packet still cannot send outreach.",
      "Prepare audited payment path readiness packets after Robert approves the exact Stripe payment link and smoke/deposit evidence.",
      "Prepare audited website publish readiness packets after preview/App QA/rollback evidence; the packet still cannot deploy.",
      "Prepare proposals and ask Robert for approval before any contact or spend.",
    ],
    blockedUntil: blockingFailedChecks.map((check) => check.nextStep),
    remainingGaps: failedChecks
      .filter((check) => !blockingCheckIds.has(check.id))
      .map((check) => check.nextStep),
    checks,
  };
}

export function buildImprovementReview(input: ImprovementReviewInput) {
  const replyRate = input.leadsContacted > 0 ? Math.round((input.replies / input.leadsContacted) * 100) : 0;
  const bookingRate = input.replies > 0 ? Math.round((input.callsBooked / input.replies) * 100) : 0;
  const closeRate = input.callsBooked > 0 ? Math.round((input.dealsClosed / input.callsBooked) * 100) : 0;
  const profitUsd = input.revenueCollectedUsd - input.spendUsd - input.estimatedInternalMonthlyCostUsd;
  const roiPercent =
    input.spendUsd + input.estimatedInternalMonthlyCostUsd > 0
      ? Math.round((profitUsd / (input.spendUsd + input.estimatedInternalMonthlyCostUsd)) * 100)
      : input.revenueCollectedUsd > 0
        ? 100
        : 0;
  const grossMarginPercent =
    input.revenueCollectedUsd > 0
      ? Math.round(((input.revenueCollectedUsd - input.spendUsd - input.estimatedInternalMonthlyCostUsd) / input.revenueCollectedUsd) * 100)
      : 0;
  const costPerReplyUsd = input.replies > 0 ? Number((input.spendUsd / input.replies).toFixed(2)) : 0;
  const costPerBookedCallUsd = input.callsBooked > 0 ? Number((input.spendUsd / input.callsBooked).toFixed(2)) : 0;
  const insideSpendCap = input.spendUsd <= 100 && input.estimatedInternalMonthlyCostUsd <= 100;
  const profitable = profitUsd > 0 && grossMarginPercent >= 65;
  const qualityBlocked = input.clientComplaints > 0 || input.defectsFound >= 3;
  const cashBlocked = input.spendUsd >= 100 && input.revenueCollectedUsd === 0;
  const decision = qualityBlocked || cashBlocked || !insideSpendCap ? "pause_and_fix" : profitable ? "scale_carefully" : "iterate_small_batch";

  const experiments = [
    replyRate < 5 && "Cambiar el primer mensaje: abrir con evidencia especifica del negocio y una captura/mockup.",
    bookingRate < 25 && "Agregar CTA mas simple: llamada de 15 minutos o video de 90 segundos, no propuesta larga.",
    closeRate < 30 && "Probar oferta con deposito mas claro, garantia de QA y entrega por fases.",
    input.dealsClosed > 0 && "Duplicar el nicho/oferta que cerro, manteniendo el gasto semanal limitado.",
    input.hoursSaved > 0 && "Convertir horas ahorradas en prueba comercial para vender retainer.",
    input.defectsFound > 0 && "Agregar defectos encontrados al checklist antes del proximo envio.",
    input.clientComplaints > 0 && "Bloquear envio externo hasta revisar copy, promesas y aprobaciones.",
  ].filter(Boolean) as string[];

  const agentScorecard = [
    {
      agent: "lead-scout",
      score: replyRate >= 8 ? "pass" : "review",
      lesson: replyRate >= 8 ? "El targeting genero respuestas." : "Refinar nicho, evidencia y contacto antes de escalar.",
    },
    {
      agent: "closer",
      score: bookingRate >= 25 && closeRate >= 30 ? "pass" : "review",
      lesson: bookingRate >= 25 && closeRate >= 30 ? "El pitch convierte." : "Mejorar CTA, precio, prueba visual u objeciones.",
    },
    {
      agent: "automation-architect",
      score: input.hoursSaved > 0 || input.dealsClosed > 0 ? "pass" : "review",
      lesson: input.hoursSaved > 0 ? "Hay ROI operativo para vender retainer." : "Necesita prueba de ahorro, lead lift o venta.",
    },
    {
      agent: "qa-council",
      score: qualityBlocked ? "block" : "pass",
      lesson: qualityBlocked ? "Subir controles antes de contacto/entrega." : "Calidad lista para repetir con supervision.",
    },
    {
      agent: "cost-controller",
      score: !insideSpendCap || cashBlocked ? "block" : profitUsd >= 0 ? "pass" : "review",
      lesson:
        !insideSpendCap || cashBlocked
          ? "Reducir herramientas/outreach pagado o cerrar cash antes de gastar."
          : profitUsd >= 0
            ? "Gasto dentro del cap inicial y con retorno positivo."
            : "Gasto dentro del cap, pero falta cobrar antes de escalar.",
    },
  ];

  return {
    input,
    decision: {
      status: decision,
      reason:
        decision === "pause_and_fix"
          ? "No escalar: hay riesgo de calidad, costo o gasto sin ingresos cobrados."
          : decision === "scale_carefully"
            ? "La campana es rentable; repetir en batches pequenos y mantener aprobacion humana."
            : "Todavia no hay suficiente prueba de ROI; iterar con bajo gasto antes de escalar.",
      approvalMode: "human_approval_before_spend_or_send",
    },
    metrics: {
      replyRate,
      bookingRate,
      closeRate,
      profitUsd,
      roiPercent,
      grossMarginPercent,
      costPerReplyUsd,
      costPerBookedCallUsd,
      insideSpendCap,
      profitable,
    },
    experiments: experiments.length
      ? experiments
      : ["Mantener oferta actual, registrar objeciones nuevas y repetir solo con batch pequeno."],
    playbookUpdates: [
      input.bestOffer ? `Oferta que mejor performo: ${input.bestOffer}` : "Registrar oferta ganadora antes de escalar.",
      input.biggestObjection ? `Objecion principal: ${input.biggestObjection}` : "Recolectar objecion principal en cada llamada.",
      input.notes ? `Nota operativa: ${input.notes}` : "Guardar evidencia, capturas y metricas despues de cada batch.",
    ],
    agentScorecard,
    nextBatch: {
      maxLeads: decision === "scale_carefully" ? 25 : 10,
      maxSpendUsd: decision === "scale_carefully" ? Math.min(100, Math.max(20, input.revenueCollectedUsd * 0.05)) : 10,
      requiredBeforeNextSend:
        decision === "pause_and_fix"
          ? ["resolver bloqueos QA/costo", "aprobar nuevo mensaje", "confirmar cap menor a $100"]
          : ["aprobar mensaje", "usar evidencia publica", "guardar resultado y objecion"],
    },
  };
}

export function recordRevenueImprovementReview(input: ImprovementReviewInput) {
  loadRevenueImprovementReviews();
  const review = buildImprovementReview(input);
  const now = new Date().toISOString();
  const previousVersion = revenueImprovementReviews.reduce((max, item) => Math.max(max, item.playbookVersion), 0);
  const persisted: RevenueImprovementReview = {
    ...review,
    id: `improvement-${Date.now()}-${revenueImprovementReviews.length + 1}`,
    createdAt: now,
    updatedAt: now,
    playbookVersion: previousVersion + 1,
    decisionStatus: review.decision.status,
    learningSummary:
      review.decision.status === "scale_carefully"
        ? `Playbook v${previousVersion + 1}: escalar ${input.bestOffer || input.campaignName} con batch pequeno, cap ${review.nextBatch.maxSpendUsd} y aprobacion humana.`
        : review.decision.status === "pause_and_fix"
          ? `Playbook v${previousVersion + 1}: pausar ${input.campaignName}; resolver QA/costo antes de gastar o contactar.`
          : `Playbook v${previousVersion + 1}: iterar ${input.campaignName} con bajo gasto y guardar objeciones antes de escalar.`,
  };

  revenueImprovementReviews.push(persisted);
  persistRevenueImprovementReviews();

  return {
    review: persisted,
    snapshot: getRevenueEngineSnapshot(),
  };
}

export function buildRevenueEnginePlan(input: RevenueEnginePlanInput) {
  const budgetUsd = Math.min(input.monthlyBudgetUsd, 100);
  const researchCostUsd = Number((input.leadCount * 0.03).toFixed(2));
  const mockupSlots = Math.min(5, Math.max(1, Math.floor(input.leadCount / 5)));
  const mockupCostUsd = Number((mockupSlots * 0.4).toFixed(2));
  const totalCostUsd = Number((researchCostUsd + mockupCostUsd).toFixed(2));
  const remainingBudgetUsd = Number((budgetUsd - totalCostUsd).toFixed(2));
  const offerLabel =
    input.offerFocus === "both"
      ? "websites premium y automatizaciones"
      : input.offerFocus === "websites"
        ? "websites premium"
        : "automatizaciones";

  return {
    input: { ...input, monthlyBudgetUsd: budgetUsd },
    budget: {
      monthlyCapUsd: budgetUsd,
      estimatedFirstBatchUsd: totalCostUsd,
      remainingBudgetUsd,
      isInsideCap: totalCostUsd <= budgetUsd,
      mode: "low_cost_first",
    },
    target: {
      area: input.area,
      niche: input.niche,
      offer: offerLabel,
      batchSize: input.leadCount,
      qualification: [
        "No website visible en Google/Maps/social bio",
        "Negocio activo con fotos o posts recientes",
        "Tiene telefono, email, DM publico o formulario verificable",
        "Servicio con ticket suficiente para pagar $1.5k+",
        "Dolor claro: reservas, leads, menu, portfolio, pagos o seguimiento",
      ],
    },
    searchQueries: [
      `"${input.niche}" "${input.area}" "Facebook"`,
      `"${input.niche}" "${input.area}" "Instagram" "call"`,
      `"${input.niche}" "${input.area}" "Google Maps"`,
      `"${input.niche}" "${input.area}" "near me"`,
      `"${input.niche}" "${input.area}" "menu" OR "booking" OR "appointments"`,
    ],
    leadSlots: Array.from({ length: Math.min(input.leadCount, 10) }, (_, index) => ({
      id: `lead-slot-${String(index + 1).padStart(2, "0")}`,
      name: `${input.niche} prospect ${index + 1}`,
      area: input.area,
      status: index < 3 ? "research_ready" : "queued",
      evidenceNeeded: ["website check", "contact source", "recent activity", "offer fit"],
      nextAgent: index < 3 ? "business-researcher" : "lead-scout",
    })),
    mockupBrief: {
      style: "premium local brand, fast, mobile-first, optional 3D hero",
      sections: ["hero", "services", "proof", "gallery", "booking/contact", "automation upsell"],
      demoAngles: [
        "Antes/despues: sin website vs presencia premium",
        "Comparacion con 2-3 demos internas",
        "Automatizacion sugerida segun dolor del negocio",
      ],
      qaChecks: ["datos marcados como publicos", "no claims inventados", "links funcionando", "mobile", "margen positivo"],
    },
    outreachDraft: {
      channelPriority: ["email", "contact form", "Instagram DM", "phone follow-up manual"],
      firstMessage:
        `Vi que ${input.niche} en ${input.area} puede ganar mas leads con una presencia web mas fuerte. Prepare un mockup rapido para mostrar como se veria una version premium con ${offerLabel}. Si quieres, te lo mando para revisarlo sin compromiso.`,
      followUps: [
        "Enviar preview comparando website actual/no website contra mockup",
        "Preguntar si quieren leads, reservas, pagos o automatizar seguimiento",
        "Cerrar llamada de 15 minutos con una oferta simple y deposito",
      ],
      approvalStatus: "draft_only",
    },
    deliverySystem: {
      checkpoints: [
        "Discovery y data publica",
        "Mockup website",
        "Subagente QA visual",
        "Subagente QA negocio/margen",
        "Propuesta",
        "Deposito",
        "Build",
        "QA final",
        "Entrega y upsell automatizacion",
      ],
      improvementLoop: [
        "Guardar objeciones",
        "Medir tasa de respuesta",
        "Medir cierres por nicho",
        "Duplicar el nicho con mejor margen",
        "Pausar lo que gasta sin cobrar",
      ],
    },
  };
}
