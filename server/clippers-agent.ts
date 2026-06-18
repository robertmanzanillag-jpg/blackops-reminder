import { chmod, copyFile, mkdir, readdir, readFile, stat, writeFile } from "fs/promises";
import { spawn } from "child_process";
import { createCipheriv, createHash, randomBytes } from "crypto";
import { promises as dns } from "dns";
import path from "path";
import { ensureAppDriveFolderPath } from "./google-drive";
import { getSystemUserId } from "./user-context";
import { LOCAL_ENV_FILES, loadLocalEnvFiles } from "./env-loader";

export type ClipperAccountCategory = "sports" | "memes" | "streamers";
export type ClipperAccountStatus = "ready" | "needs_connection" | "paused";
export type ClipperSourceType = "owned_folder" | "official_api" | "creator_allowlist" | "manual_drop";
export type ClipperAgentStatus = "active" | "waiting" | "review_required";
export type ClipperPlatform = "tiktok" | "instagram" | "youtube";
export type ClipperPlatformConnectionStatus = "not_created" | "created" | "needs_oauth" | "needs_review" | "ready";
export type ClipperPermissionStatus = "missing" | "requested" | "approved" | "blocked";
export type ClipperReadinessStatus = "ready" | "missing" | "partial";
export type ClipperConnectActionStatus = "ready" | "blocked";
export type ClipperOAuthConnectionStatus = "pending" | "code_received" | "error";
export type ClipperTokenVaultStatus = "missing_key" | "ready" | "tokens_saved" | "locked";
export type ClipperTokenExchangeStatus = "blocked" | "ready" | "saved" | "failed";
export type ClipperPermissionPackStatus = "missing" | "partial" | "ready";
export type ClipperAssetRightsStatus = "owned_or_permissioned" | "review_required";
export type ClipperProductionQueueStatus = "draft_ready" | "rights_review" | "needs_source";
export type ClipperDraftSpecStatus = "empty" | "blocked" | "ready";
export type ClipperDraftSpecItemStatus = "ready_for_edit";
export type ClipperSourceAcquisitionStatus = "not_prepared" | "blocked" | "partial" | "ready";
export type ClipperSourceHuntStatus = "not_prepared" | "blocked" | "partial" | "ready";
export type ClipperSourceHuntItemStatus = "needs_source" | "needs_rights" | "ready_for_draft";
export type ClipperRightsOutreachStatus = "not_prepared" | "blocked" | "partial" | "ready";
export type ClipperRightsOutreachItemStatus = "needs_target" | "ready_to_contact" | "permission_recorded";
export type ClipperPlatformReadinessStatus = "blocked" | "partial" | "ready";
export type ClipperScheduledPostStatus = "blocked_source" | "blocked_rights" | "blocked_connection" | "ready_for_manual" | "scheduled";
export type ClipperManualPostingPackStatus = "not_prepared" | "blocked" | "partial" | "ready";
export type ClipperManualPostingItemStatus = "ready_to_post" | "needs_account" | "needs_source" | "needs_rights";
export type ClipperAutomationRunStatus = "blocked" | "partial" | "ready";
export type ClipperGrowthAuditStatus = "critical" | "warning" | "ready";
export type ClipperDriveWorkspaceStatus = "missing_keys" | "needs_oauth" | "ready" | "error";
export type ClipperMetricsStatus = "empty" | "needs_records" | "ready";
export type ClipperBudgetScenarioId = "lean" | "growth" | "aggressive";
export type ClipperTrendRadarStatus = "empty" | "needs_review" | "ready";
export type ClipperTrendRightsOutreachStatus = "not_prepared" | "blocked" | "partial" | "ready";
export type ClipperTrendRightsOutreachItemStatus = "ready_to_contact" | "permission_recorded";
export type ClipperViralDiscoveryStatus = "not_prepared" | "ready";
export type ClipperViralDiscoveryPriority = "must_scan" | "watch" | "experimental";
export type ClipperAutomationScheduleStatus = "not_prepared" | "prepared";
export type ClipperAccountIdentityKitStatus = "not_prepared" | "ready";
export type ClipperAccountLaunchKitStatus = "not_ready" | "partial" | "ready";
export type ClipperAccountLaunchTaskStatus = "blocked" | "pending" | "ready";
export type ClipperPermissionTrackerStatus = "not_prepared" | "blocked" | "in_review" | "ready";
export type ClipperPermissionTrackerItemStatus = "blocked" | "ready_to_request" | "requested" | "approved";
export type ClipperAccountEvidenceStatus = "empty" | "partial" | "ready";
export type ClipperAccountEvidenceItemStatus = "submitted" | "verified" | "rejected";
export type ClipperDeveloperAppEvidenceStatus = "empty" | "partial" | "ready";
export type ClipperDeveloperAppEvidenceItemStatus = "draft" | "submitted" | "approved" | "rejected";
export type ClipperLaunchCommandCenterStatus = "ready" | "action_required" | "blocked";
export type ClipperLaunchCommandCenterStepStatus = "done" | "needs_action" | "blocked";
export type ClipperCredentialSetupStatus = "missing" | "partial" | "ready";
export type ClipperCredentialDoctorStatus = "not_prepared" | "blocked" | "partial" | "ready";
export type ClipperIntakeKitStatus = "not_prepared" | "prepared";
export type ClipperExternalSetupQueueStatus = "not_prepared" | "blocked" | "in_progress" | "ready";
export type ClipperExternalSetupQueueItemType = "account" | "developer_app" | "permission" | "credential" | "oauth";
export type ClipperExternalSetupQueuePriority = "critical" | "high" | "medium";
export type ClipperExternalExecutionHandoffStatus = "not_prepared" | "blocked" | "in_progress" | "ready";
export type ClipperExternalLaunchDossierStatus = "not_prepared" | "blocked" | "in_progress" | "ready";
export type ClipperAppReviewSubmissionPackStatus = "not_prepared" | "blocked" | "ready";
export type ClipperOfficialPermissionMatrixStatus = "not_prepared" | "verified" | "needs_review";
export type ClipperOfficialPermissionSourceStatus = "official_verified" | "official_login_required";
export type ClipperPublisherConnectorStatus = "not_prepared" | "blocked" | "partial" | "ready";
export type ClipperPublisherBlockingCategory = "account" | "developer_app" | "permission" | "credential" | "token" | "content" | "compliance";
export type ClipperOAuthGoLiveStatus = "not_prepared" | "blocked" | "partial" | "ready";
export type ClipperOAuthConnectionPackStatus = "not_prepared" | "blocked" | "partial" | "ready";
export type ClipperBlockerResolutionPackStatus = "not_prepared" | "blocked" | "in_progress" | "ready";
export type ClipperBlockerResolutionActionStatus = "blocked" | "next" | "ready";
export type ClipperBlockerExecutionMode = "in_app" | "external_portal" | "evidence_upload" | "manual_review";
export type ClipperGoLiveAutopilotBriefStatus = "not_prepared" | "blocked" | "in_progress" | "ready";
export type ClipperGoLiveAutopilotActionStatus = "run_in_app" | "external_required" | "waiting" | "done";
export type ClipperGoLiveAutopilotActionLane = "in_app" | "external" | "evidence" | "publish";
export type ClipperGoLiveAutopilotRunStatus = "not_run" | "completed" | "partial" | "blocked";
export type ClipperGoLiveAutopilotRunItemStatus = "completed" | "skipped" | "failed";
export type ClipperBlockerUnlockPhase = "credentials" | "accounts" | "public_url" | "developer_apps" | "permissions" | "oauth" | "content_supply" | "publishing" | "optimization";
export type ClipperGoLiveExecutionPackStatus = "not_prepared" | "blocked" | "in_progress" | "ready";
export type ClipperGoLiveExecutionPhaseStatus = "blocked" | "ready_to_execute" | "done";
export type ClipperPlatformPortalChecklistStatus = "not_prepared" | "blocked" | "in_progress" | "ready";
export type ClipperHttpsTunnelPlanStatus = "not_prepared" | "blocked" | "ready";
export type ClipperLegalPolicyPackStatus = "not_prepared" | "blocked" | "ready";
export type ClipperAppReviewDemoPackStatus = "not_prepared" | "blocked" | "ready";
export type ClipperDeveloperApplicationDraftsStatus = "not_prepared" | "blocked" | "ready";
export type ClipperAccountCreationPackStatus = "not_prepared" | "blocked" | "partial" | "ready";
export type ClipperPermissionRequestPackStatus = "not_prepared" | "blocked" | "partial" | "ready";
export type ClipperPermissionRequestReadiness = "blocked" | "ready_to_submit" | "submitted" | "approved";

export interface ClipperPlatformAccount {
  platform: ClipperPlatform;
  handle: string;
  displayName: string;
  status: ClipperPlatformConnectionStatus;
  requiredScopes: string[];
  missingSteps: string[];
  notes: string;
}

export interface ClipperAccount {
  id: string;
  name: string;
  category: ClipperAccountCategory;
  platforms: string[];
  platformAccounts: ClipperPlatformAccount[];
  dailyClipTarget: number;
  weeklyViewsGoal: number;
  lastWeekViews: number;
  status: ClipperAccountStatus;
  contentPolicy: string;
}

export interface ClipperSource {
  id: string;
  label: string;
  type: ClipperSourceType;
  freshness: string;
  rightsMode: "owned" | "licensed" | "permissioned" | "review_required";
  status: "connected" | "planned" | "needs_setup";
}

export interface ClipperSubAgent {
  id: string;
  name: string;
  job: string;
  status: ClipperAgentStatus;
  output: string;
}

export interface ClipperPipelineItem {
  stage: string;
  count: number;
  owner: string;
  status: ClipperAgentStatus;
}

export interface ClipperStatus {
  rootDir: string;
  reportsDir: string;
  sourceRootDir: string;
  accounts: ClipperAccount[];
  sources: ClipperSource[];
  sourceFolders: ClipperSourceFolder[];
  credentialChecks: ClipperCredentialCheck[];
  connectActions: ClipperConnectAction[];
  oauthConnections: ClipperOAuthConnection[];
  tokenVault: ClipperTokenVaultSummary;
  tokenExchanges: ClipperTokenExchange[];
  credentialSetup: ClipperCredentialSetupSummary;
  credentialDoctor: ClipperCredentialDoctorSummary;
  platformReadiness: ClipperPlatformReadinessSummary;
  permissionPack: ClipperPermissionPackSummary;
  productionQueue: ClipperProductionQueueSummary;
  sourceAcquisition: ClipperSourceAcquisitionSummary;
  sourceHunt: ClipperSourceHuntSummary;
  rightsOutreach: ClipperRightsOutreachSummary;
  draftSpecs: ClipperDraftSpecSummary;
  manualPostingPack: ClipperManualPostingPackSummary;
  publishingPackage: ClipperPublishingPackageSummary;
  automation: ClipperAutomationSummary;
  automationSchedule: ClipperAutomationScheduleSummary;
  driveWorkspace: ClipperDriveWorkspaceSummary;
  metrics: ClipperMetricsSummary;
  trendRadar: ClipperTrendRadarSummary;
  trendRightsOutreach: ClipperTrendRightsOutreachSummary;
  viralDiscovery: ClipperViralDiscoverySummary;
  intakeKit: ClipperIntakeKitSummary;
  budgetPlanner: ClipperBudgetPlanner;
  accountIdentityKit: ClipperAccountIdentityKitSummary;
  accountLaunchKit: ClipperAccountLaunchKitSummary;
  accountCreationPack: ClipperAccountCreationPackSummary;
  accountEvidence: ClipperAccountEvidenceSummary;
  developerAppEvidence: ClipperDeveloperAppEvidenceSummary;
  permissionTracker: ClipperPermissionTrackerSummary;
  permissionRequestPack: ClipperPermissionRequestPackSummary;
  externalSetupQueue: ClipperExternalSetupQueueSummary;
  externalExecutionHandoff: ClipperExternalExecutionHandoffSummary;
  externalExecutionSession: ClipperExternalExecutionSessionSummary;
  externalLaunchDossier: ClipperExternalLaunchDossierSummary;
  platformPortalChecklist: ClipperPlatformPortalChecklistSummary;
  appReviewSubmissionPack: ClipperAppReviewSubmissionPackSummary;
  appReviewDemoPack: ClipperAppReviewDemoPackSummary;
  developerApplicationDrafts: ClipperDeveloperApplicationDraftsSummary;
  officialPermissionMatrix: ClipperOfficialPermissionMatrixSummary;
  publisherConnectors: ClipperPublisherConnectorSummary;
  productionUrlSetup: ClipperProductionUrlSetupSummary;
  productionUrlVerification: ClipperProductionUrlVerificationSummary;
  httpsTunnelPlan: ClipperHttpsTunnelPlanSummary;
  legalPolicyPack: ClipperLegalPolicyPackSummary;
  oauthGoLive: ClipperOAuthGoLiveSummary;
  oauthConnectionPack: ClipperOAuthConnectionPackSummary;
  goLiveExecutionPack: ClipperGoLiveExecutionPackSummary;
  commandCenter: ClipperLaunchCommandCenterSummary;
  blockerResolutionPack: ClipperBlockerResolutionPackSummary;
  goLiveAutopilotBrief: ClipperGoLiveAutopilotBriefSummary;
  goLiveAutopilotRun: ClipperGoLiveAutopilotRunSummary;
  growthAudit: ClipperGrowthAudit;
  platformRequirements: ClipperPlatformRequirement[];
  permissionQueue: ClipperPermissionRequest[];
  agents: ClipperSubAgent[];
  pipeline: ClipperPipelineItem[];
  goals: {
    weeklyViewsPerAccount: number;
    totalWeeklyGoal: number;
    dailyClipsTarget: number;
    connectedAccounts: number;
  };
  latestReport: ClipperReport | null;
  guardrails: string[];
}

export interface ClipperPlatformRequirement {
  platform: ClipperPlatform;
  label: string;
  developerPortalUrl: string;
  accountCreationUrl: string;
  requiredAccountType: string;
  scopes: string[];
  appReview: string;
  postingMode: string;
  humanRequired: string[];
  docs: string[];
}

export interface ClipperPermissionRequest {
  id: string;
  platform: ClipperPlatform;
  scope: string;
  label: string;
  status: ClipperPermissionStatus;
  reason: string;
  evidenceRequired: string;
  docsUrl: string;
}

export interface ClipperCredentialCheck {
  platform: ClipperPlatform;
  label: string;
  status: ClipperReadinessStatus;
  requiredEnvVars: string[];
  acceptedEnvVarGroups: string[][];
  configuredEnvVars: string[];
  missingEnvVars: string[];
  nextStep: string;
}

export interface ClipperSourceFolder {
  category: ClipperAccountCategory | "allowlist" | "drafts" | "scheduled" | "metrics" | "trends" | "sourceHunts" | "accountEvidence" | "developerAppEvidence";
  label: string;
  path: string;
  status: "ready";
  purpose: string;
}

export interface ClipperConnectAction {
  platform: ClipperPlatform;
  label: string;
  status: ClipperConnectActionStatus;
  authUrl: string | null;
  callbackPath: string;
  missingEnvVars: string[];
  scopes: string[];
  nextStep: string;
}

export interface ClipperOAuthConnection {
  platform: ClipperPlatform;
  accountId?: string | null;
  status: ClipperOAuthConnectionStatus;
  receivedAt: string;
  scopes: string[];
  state: string | null;
  codeHash: string | null;
  error: string | null;
  note: string;
  tokenStatus?: ClipperTokenExchangeStatus;
  tokenNote?: string;
}

export interface ClipperTokenVaultSummary {
  status: ClipperTokenVaultStatus;
  envVar: string;
  configured: boolean;
  vaultPath: string;
  records: ClipperTokenSummary[];
  nextStep: string;
}

export interface ClipperTokenSummary {
  platform: ClipperPlatform;
  accountId?: string | null;
  status: "saved";
  savedAt: string;
  scopes: string[];
  tokenType: string | null;
  expiresAt: string | null;
  refreshExpiresAt: string | null;
  subjectHash: string | null;
}

export interface ClipperTokenExchange {
  platform: ClipperPlatform;
  label: string;
  status: ClipperTokenExchangeStatus;
  missingEnvVars: string[];
  callbackPath: string;
  tokenSavedAt: string | null;
  docsUrl: string;
  nextStep: string;
}

export interface ClipperPermissionPackFile {
  id: string;
  label: string;
  path: string;
  exists: boolean;
  purpose: string;
}

export interface ClipperPermissionPackSummary {
  status: ClipperPermissionPackStatus;
  rootDir: string;
  files: ClipperPermissionPackFile[];
  generatedAt: string | null;
  nextStep: string;
}

export interface ClipperPermissionPack {
  generatedAt: string;
  rootDir: string;
  files: ClipperPermissionPackFile[];
}

export interface ClipperSourceAsset {
  id: string;
  category: ClipperAccountCategory;
  fileName: string;
  path: string;
  sizeBytes: number;
  updatedAt: string;
  rightsStatus: ClipperAssetRightsStatus;
  evidencePath: string | null;
  notes: string;
}

export interface ClipperProductionQueueItem {
  id: string;
  accountId: string;
  accountName: string;
  category: ClipperAccountCategory;
  slotNumber: number;
  variantAngle: string;
  clipObjective: string;
  sourceAssetId: string | null;
  sourcePath: string | null;
  rightsStatus: ClipperAssetRightsStatus | "missing";
  status: ClipperProductionQueueStatus;
  hook: string;
  format: string;
  publishWindow: string;
  platforms: string[];
  requiredInputs: string[];
  completionHint: string;
  nextStep: string;
}

export interface ClipperProductionQueueSummary {
  status: "empty" | "needs_sources" | "needs_rights" | "ready";
  queuePath: string | null;
  generatedAt: string | null;
  sourceAssets: ClipperSourceAsset[];
  items: ClipperProductionQueueItem[];
  nextStep: string;
}

export interface ClipperSourceDropImportItem {
  sourcePath: string;
  targetPath: string;
  category: ClipperAccountCategory;
  fileName: string;
  status: "imported" | "skipped";
  rightsStatus: ClipperAssetRightsStatus;
  reason: string | null;
}

export interface ClipperSourceDropImportSummary {
  importedAt: string;
  dropDir: string;
  filesScanned: number;
  imported: number;
  skipped: number;
  items: ClipperSourceDropImportItem[];
  queue: ClipperProductionQueueSummary;
  nextStep: string;
}

export interface ClipperSourceAcquisitionCategory {
  category: ClipperAccountCategory;
  label: string;
  sourceFolder: string;
  dailySlots: number;
  weeklyTargetSlots: number;
  weeklyConfiguredSlots: number;
  weeklyReadySlots: number;
  weeklyMissingSourceSlots: number;
  sourceAssets: number;
  rightsReadyAssets: number;
  readyQueueSlots: number;
  rightsReviewSlots: number;
  missingSourceSlots: number;
  minimumRecommendedAssets: number;
  minimumWeeklySourceAssets: number;
  priority: "critical" | "high" | "watch";
  searchBrief: string[];
  evidenceRequired: string[];
  nextStep: string;
}

export interface ClipperSourceAcquisitionSummary {
  status: ClipperSourceAcquisitionStatus;
  generatedAt: string | null;
  manifestPath: string;
  markdownPath: string;
  categories: ClipperSourceAcquisitionCategory[];
  totals: {
    dailySlots: number;
    targetWeeklyClips: number;
    configuredWeeklySlots: number;
    weeklyReadySlots: number;
    weeklyMissingSourceSlots: number;
    minimumWeeklySourceAssets: number;
    readyQueueSlots: number;
    rightsReviewSlots: number;
    missingSourceSlots: number;
    sourceAssets: number;
    rightsReadyAssets: number;
  };
  nextStep: string;
}

export interface ClipperSourceHuntItem {
  id: string;
  huntDate: string;
  status: ClipperSourceHuntItemStatus;
  accountId: string;
  accountName: string;
  category: ClipperAccountCategory;
  slotNumber: number;
  targetHook: string;
  variantAngle: string;
  clipObjective: string;
  publishWindow: string;
  platforms: string[];
  sourceFolder: string;
  sourcePath: string | null;
  rightsStatus: ClipperAssetRightsStatus | "missing";
  suggestedSearch: string;
  evidenceNeeded: string;
  requiredInputs: string[];
  completionHint: string;
  sourceRightsRecordTemplate: string;
  nextStep: string;
}

export interface ClipperSourceHuntSummary {
  status: ClipperSourceHuntStatus;
  generatedAt: string | null;
  huntDate: string;
  manifestPath: string;
  csvPath: string;
  markdownPath: string;
  items: ClipperSourceHuntItem[];
  totals: {
    items: number;
    needsSource: number;
    needsRights: number;
    readyForDraft: number;
  };
  nextStep: string;
}

export interface ClipperDraftSpecItem {
  id: string;
  queueItemId: string;
  accountId: string;
  accountName: string;
  category: ClipperAccountCategory;
  slotNumber: number;
  variantAngle: string;
  clipObjective: string;
  sourcePath: string;
  evidencePath: string | null;
  draftPath: string;
  markdownPath: string;
  hook: string;
  captionSeed: string;
  format: string;
  publishWindow: string;
  platforms: string[];
  status: ClipperDraftSpecItemStatus;
  qaChecklist: string[];
  createdAt: string;
}

export interface ClipperDraftSpecSummary {
  status: ClipperDraftSpecStatus;
  generatedAt: string | null;
  draftsDir: string;
  manifestPath: string;
  items: ClipperDraftSpecItem[];
  totals: {
    items: number;
    readyForEdit: number;
    blockedQueueItems: number;
  };
  nextStep: string;
}

export interface ClipperRenderedClipItem {
  id: string;
  draftSpecId: string;
  accountId: string;
  accountName: string;
  category: ClipperAccountCategory;
  sourcePath: string;
  outputPath: string;
  hook: string;
  captionSeed: string;
  platforms: string[];
  durationSeconds: number;
  status: "rendered" | "failed";
  error: string | null;
  nextStep: string;
}

export interface ClipperPublishingPackageItem {
  id: string;
  renderedClipId: string;
  accountId: string;
  accountName: string;
  platform: ClipperPlatform;
  handle: string;
  status: "ready_for_manual" | "needs_account" | "needs_rendered_clip";
  videoPath: string;
  caption: string;
  hook: string;
  checklist: string[];
  blocker: string | null;
  nextStep: string;
}

export interface ClipperPublishingPackageSummary {
  status: "blocked" | "partial" | "ready";
  generatedAt: string;
  manifestPath: string;
  markdownPath: string;
  csvPath: string;
  items: ClipperPublishingPackageItem[];
  totals: {
    items: number;
    readyForManual: number;
    needsAccount: number;
    needsRenderedClip: number;
  };
  nextStep: string;
}

export interface ClipperRenderedClipSummary {
  status: "blocked" | "partial" | "ready";
  generatedAt: string;
  outputDir: string;
  manifestPath: string;
  items: ClipperRenderedClipItem[];
  totals: {
    attempted: number;
    rendered: number;
    failed: number;
    availableDraftSpecs: number;
  };
  nextStep: string;
}

export interface ClipperRightsOutreachItem {
  id: string;
  status: ClipperRightsOutreachItemStatus;
  category: ClipperAccountCategory;
  accountId: string;
  accountName: string;
  targetHook: string;
  suggestedSearch: string;
  sourceFolder: string;
  evidenceNeeded: string;
  outreachSubject: string;
  outreachMessage: string;
  permissionRecordTemplate: string;
  requiredInputs: string[];
  completionHint: string;
  nextStep: string;
}

export interface ClipperRightsOutreachTemplate {
  category: ClipperAccountCategory;
  label: string;
  channel: "dm_or_email";
  subject: string;
  message: string;
  evidenceToRequest: string[];
}

export interface ClipperRightsOutreachSummary {
  status: ClipperRightsOutreachStatus;
  generatedAt: string | null;
  manifestPath: string;
  markdownPath: string;
  templatesPath: string;
  items: ClipperRightsOutreachItem[];
  templates: ClipperRightsOutreachTemplate[];
  totals: {
    items: number;
    needsTarget: number;
    readyToContact: number;
    permissionRecorded: number;
  };
  nextStep: string;
}

export interface ClipperSourceRightsRecord {
  assetId: string;
  category: ClipperAccountCategory;
  fileName: string;
  sourcePath: string;
  rightsStatus: ClipperAssetRightsStatus;
  evidencePath: string;
  notes: string;
  recordedAt: string;
  source: "clippers-ui";
}

export interface ClipperScheduledPost {
  id: string;
  queueItemId: string;
  accountId: string;
  accountName: string;
  platform: ClipperPlatform;
  status: ClipperScheduledPostStatus;
  publishAt: string;
  sourcePath: string | null;
  hook: string;
  captionSeed: string;
  blocker: string | null;
  nextStep: string;
}

export interface ClipperAutomationRun {
  id: string;
  createdAt: string;
  status: ClipperAutomationRunStatus;
  publishMode: Required<ClipperRunOptions>["publishMode"];
  schedulePath: string;
  queuePath: string;
  reportPath: string;
  totals: {
    posts: number;
    scheduled: number;
    readyForManual: number;
    blocked: number;
    draftReady: number;
    rightsReview: number;
    needsSource: number;
  };
  posts: ClipperScheduledPost[];
  blockers: string[];
  recommendations: string[];
}

export interface ClipperManualPostingPackItem {
  id: string;
  queueItemId: string;
  accountId: string;
  accountName: string;
  category: ClipperAccountCategory;
  platform: ClipperPlatform;
  handle: string;
  profileLink: string;
  status: ClipperManualPostingItemStatus;
  publishAt: string;
  sourcePath: string | null;
  hook: string;
  caption: string;
  format: string;
  blocker: string | null;
  checklist: string[];
  nextStep: string;
}

export interface ClipperManualPostingWeeklyRunway {
  targetWeeklyPosts: number;
  plannedPosts: number;
  readyToPost: number;
  gapToTarget: number;
  sourceSlotsNeeded: number;
  rightsSlotsNeeded: number;
  accountSlotsNeeded: number;
  recommendedDailyReadyPosts: number;
  nextStep: string;
}

export interface ClipperManualPostingUnblockItem {
  rank: number;
  itemId: string;
  accountName: string;
  category: ClipperAccountCategory;
  platform: ClipperPlatform;
  status: ClipperManualPostingItemStatus;
  publishAt: string;
  sourceFolder: string;
  allowlistFolder: string;
  requiredEvidence: string[];
  doneCriteria: string[];
  nextStep: string;
}

export interface ClipperManualPostingPackSummary {
  status: ClipperManualPostingPackStatus;
  generatedAt: string | null;
  manifestPath: string;
  markdownPath: string;
  csvPath: string;
  items: ClipperManualPostingPackItem[];
  weeklyRunway: ClipperManualPostingWeeklyRunway;
  unblockSession: ClipperManualPostingUnblockItem[];
  totals: {
    posts: number;
    readyToPost: number;
    needsAccount: number;
    needsSource: number;
    needsRights: number;
  };
  nextStep: string;
}

export interface ClipperAutomationSummary {
  status: "not_run" | ClipperAutomationRunStatus;
  lastRun: ClipperAutomationRun | null;
  nextRunHint: string;
  nextStep: string;
}

export interface ClipperAutomationScheduleSummary {
  status: ClipperAutomationScheduleStatus;
  enabled: boolean;
  timezone: string;
  dailyRunTime: string;
  clipsPerAccount: number;
  publishMode: Required<ClipperRunOptions>["publishMode"];
  riskTolerance: Required<ClipperRunOptions>["riskTolerance"];
  weeklyTargetClips: number;
  manifestPath: string;
  generatedAt: string | null;
  runbook: string[];
  nextStep: string;
}

export interface ClipperGrowthAuditItem {
  id: string;
  label: string;
  status: ClipperGrowthAuditStatus;
  impact: "low" | "medium" | "high";
  owner: string;
  evidence: string;
  nextStep: string;
}

export interface ClipperGrowthAudit {
  score: number;
  status: ClipperGrowthAuditStatus;
  summary: string;
  items: ClipperGrowthAuditItem[];
  roadmap: string[];
  weeklyGoalGap: number;
}

export interface ClipperDriveFolder {
  id: string;
  label: string;
  path: string[];
  folderId: string | null;
  purpose: string;
}

export interface ClipperDriveEnvDiagnostics {
  envFilesChecked: string[];
  envFilesFound: string[];
  envFilesWithAcceptedAliases: Array<{ fileName: string; aliases: string[] }>;
  detectedAcceptedAliasesInFiles: string[];
  acceptedClientIdAliases: string[];
  acceptedClientSecretAliases: string[];
  acceptedRefreshTokenAliases: string[];
  configuredClientIdAliases: string[];
  configuredClientSecretAliases: string[];
  configuredRefreshTokenAliases: string[];
  missingGroups: string[];
  runtimeMissingGroups: string[];
  envFilesNeedReload: boolean;
  nextCredentialStep: string;
  credentialTemplatePath: string;
  requiredEnvTemplateRows: string[];
}

export interface ClipperDriveOAuthSetup {
  authPath: string;
  callbackPath: string;
  configuredRedirectUri: string | null;
  recommendedRedirectUris: string[];
  scopes: string[];
  nextStep: string;
}

export interface ClipperDriveWorkspaceSummary {
  status: ClipperDriveWorkspaceStatus;
  configured: boolean;
  connected: boolean;
  rootPath: string[];
  manifestPath: string;
  folders: ClipperDriveFolder[];
  envDiagnostics: ClipperDriveEnvDiagnostics;
  oauthSetup: ClipperDriveOAuthSetup;
  generatedAt: string | null;
  nextStep: string;
  error: string | null;
}

export interface ClipperMetricFile {
  fileName: string;
  path: string;
  records: number;
  importedAt: string;
  status: "imported" | "skipped" | "error";
  error: string | null;
}

export interface ClipperMetricRecord {
  id: string;
  accountId: string;
  accountName: string;
  platform: ClipperPlatform | "unknown";
  clipId: string;
  hook: string;
  publishedAt: string | null;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  retentionRate: number | null;
  watchTimeSeconds: number | null;
  sourceFile: string;
}

export interface ClipperAccountMetricPerformance {
  accountId: string;
  accountName: string;
  clips: number;
  views: number;
  avgViews: number;
  engagementRate: number;
  retentionRate: number | null;
  status: "no_data" | "under_goal" | "watch" | "scaling";
  recommendation: string;
}

export interface ClipperMetricsSummary {
  status: ClipperMetricsStatus;
  metricsDir: string;
  summaryPath: string;
  generatedAt: string | null;
  files: ClipperMetricFile[];
  records: ClipperMetricRecord[];
  totals: {
    clips: number;
    views: number;
    likes: number;
    comments: number;
    shares: number;
    saves: number;
    engagementRate: number;
  };
  accountPerformance: ClipperAccountMetricPerformance[];
  topClips: ClipperMetricRecord[];
  recommendations: string[];
  nextStep: string;
}

export interface ClipperBudgetRole {
  role: string;
  weeklyHours: number;
  rateLow: number;
  rateHigh: number;
  note: string;
}

export interface ClipperBudgetScenario {
  id: ClipperBudgetScenarioId;
  label: string;
  weeklyClips: number;
  costPerClipLow: number;
  costPerClipHigh: number;
  weeklyCostLow: number;
  weeklyCostHigh: number;
  monthlyCostLow: number;
  monthlyCostHigh: number;
  roles: ClipperBudgetRole[];
  fixedWeeklyToolsLow: number;
  fixedWeeklyToolsHigh: number;
  licensingReserveLow: number;
  licensingReserveHigh: number;
  bestFor: string;
  risk: string;
}

export interface ClipperBudgetPlanner {
  targetWeeklyClips: number;
  configuredWeeklyClips: number;
  recommendedScenarioId: ClipperBudgetScenarioId;
  scenarios: ClipperBudgetScenario[];
  assumptions: string[];
  nextStep: string;
}

export interface ClipperTrendCandidate {
  id: string;
  category: ClipperAccountCategory;
  platform: ClipperPlatform | "unknown";
  title: string;
  url: string | null;
  source: string;
  postedAt: string | null;
  ageHours: number | null;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  velocityScore: number;
  viralScore: number;
  rightsStatus: ClipperAssetRightsStatus;
  evidencePath: string | null;
  hookAngle: string;
  nextStep: string;
}

export interface ClipperTrendFile {
  fileName: string;
  path: string;
  records: number;
  importedAt: string;
  status: "imported" | "skipped" | "error";
  error: string | null;
}

export interface ClipperTrendRadarSummary {
  status: ClipperTrendRadarStatus;
  trendsDir: string;
  summaryPath: string;
  generatedAt: string | null;
  files: ClipperTrendFile[];
  candidates: ClipperTrendCandidate[];
  topCandidates: ClipperTrendCandidate[];
  recommendations: string[];
  nextStep: string;
}

export interface ClipperTrendCandidatesBatchImportSummary {
  importedAt: string;
  fileName: string;
  filePath: string;
  accepted: number;
  skipped: number;
  trendRadar: ClipperTrendRadarSummary;
  nextStep: string;
}

export interface ClipperTrendRightsOutreachItem {
  id: string;
  status: ClipperTrendRightsOutreachItemStatus;
  trendCandidateId: string;
  category: ClipperAccountCategory;
  platform: ClipperPlatform | "unknown";
  title: string;
  url: string | null;
  source: string;
  viralScore: number;
  hookAngle: string;
  outreachSubject: string;
  outreachMessage: string;
  permissionRecordTemplate: string;
  evidenceFileName: string;
  nextStep: string;
}

export interface ClipperTrendRightsOutreachSummary {
  status: ClipperTrendRightsOutreachStatus;
  generatedAt: string | null;
  manifestPath: string;
  markdownPath: string;
  csvPath: string;
  sourceTrendRadarPath: string;
  items: ClipperTrendRightsOutreachItem[];
  totals: {
    candidates: number;
    reviewRequired: number;
    readyToContact: number;
    permissionRecorded: number;
  };
  nextStep: string;
}

export interface ClipperViralDiscoveryItem {
  id: string;
  discoveryDate: string;
  category: ClipperAccountCategory;
  platform: ClipperPlatform;
  accountId: string;
  accountName: string;
  priority: ClipperViralDiscoveryPriority;
  query: string;
  searchUrl: string;
  sourceType: "platform_search" | "official_channel" | "creator_watchlist" | "news_or_forum";
  recencyWindow: string;
  viralSignals: string[];
  rightsGate: string;
  importTemplate: string;
  trendImportRow: string;
  nextStep: string;
}

export interface ClipperViralDiscoverySessionItem {
  rank: number;
  itemId: string;
  category: ClipperAccountCategory;
  platform: ClipperPlatform;
  accountName: string;
  priority: ClipperViralDiscoveryPriority;
  searchUrl: string;
  targetCandidates: number;
  minimumViews: number;
  minimumEngagementSignal: string;
  scanMinutes: number;
  captureChecklist: string[];
  scoreFormula: string;
  trendImportRow: string;
  rightsDecision: string;
}

export interface ClipperViralDiscoverySummary {
  status: ClipperViralDiscoveryStatus;
  generatedAt: string | null;
  discoveryDate: string;
  manifestPath: string;
  markdownPath: string;
  csvPath: string;
  items: ClipperViralDiscoveryItem[];
  sessionOrder: ClipperViralDiscoverySessionItem[];
  totals: {
    queries: number;
    mustScan: number;
    watch: number;
    experimental: number;
    targetCandidates: number;
    scanMinutes: number;
  };
  nextStep: string;
}

export interface ClipperAccountIdentityPlatform {
  platform: ClipperPlatform;
  handle: string;
  displayName: string;
  profileLink: string;
  bio: string;
  usernameAlternatives: string[];
  profileImagePrompt: string;
  bannerPrompt: string;
  firstPostIdeas: string[];
  setupChecklist: string[];
}

export interface ClipperAccountIdentityItem {
  accountId: string;
  accountName: string;
  category: ClipperAccountCategory;
  weeklyViewsGoal: number;
  dailyClipTarget: number;
  contentPillars: string[];
  platforms: ClipperAccountIdentityPlatform[];
}

export interface ClipperAccountIdentityKitSummary {
  status: ClipperAccountIdentityKitStatus;
  generatedAt: string | null;
  manifestPath: string;
  markdownPath: string;
  accounts: ClipperAccountIdentityItem[];
  totals: {
    accounts: number;
    platformProfiles: number;
    firstPostIdeas: number;
  };
  nextStep: string;
}

export interface ClipperAccountLaunchTask {
  id: string;
  accountId: string;
  accountName: string;
  category: ClipperAccountCategory;
  platform: ClipperPlatform;
  handle: string;
  displayName: string;
  bio: string;
  profileLink: string;
  accountCreationUrl: string;
  developerPortalUrl: string;
  status: ClipperAccountLaunchTaskStatus;
  evidencePath: string | null;
  evidenceStatus: ClipperAccountEvidenceItemStatus | "missing";
  blockers: string[];
  checklist: string[];
  nextStep: string;
}

export interface ClipperAccountLaunchKitSummary {
  status: ClipperAccountLaunchKitStatus;
  generatedAt: string | null;
  kitPath: string;
  markdownPath: string;
  tasks: ClipperAccountLaunchTask[];
  totals: {
    tasks: number;
    ready: number;
    pending: number;
    blocked: number;
  };
  nextStep: string;
}

export interface ClipperAccountCreationPackItem {
  id: string;
  accountId: string;
  accountName: string;
  category: ClipperAccountCategory;
  platform: ClipperPlatform;
  status: ClipperAccountCreationPackStatus;
  handle: string;
  displayName: string;
  profileLink: string;
  signupUrl: string;
  officialHelpUrl: string;
  bio: string;
  usernameAlternatives: string[];
  profileImagePrompt: string;
  bannerPrompt: string;
  firstPostIdeas: string[];
  verificationRequirements: string[];
  setupChecklist: string[];
  securityChecklist: string[];
  recoveryPlan: string[];
  platformProofRequired: string[];
  evidenceToCapture: string[];
  requiredInputs: string[];
  completionHint: string;
  evidenceBatchRow: string;
  submittedEvidenceBatchRow: string;
  verifiedEvidenceBatchRow: string;
  evidenceRecipeRow: string;
  evidencePath: string | null;
  copyPackage: Array<{ label: string; value: string }>;
  portalFormFields: Array<{ field: string; value: string; note: string }>;
  handleReservationPlan: string[];
  browserSessionChecklist: string[];
  evidenceCapturePlan: string[];
  operatorVaultChecklist: string[];
  postCreationNextActions: string[];
  blockers: string[];
  nextStep: string;
}

export type ClipperAccountCreationSessionPriority = "critical" | "high" | "medium";

export interface ClipperAccountCreationSessionItem {
  rank: number;
  id: string;
  accountId: string;
  accountName: string;
  platform: ClipperPlatform;
  handle: string;
  status: ClipperAccountCreationPackStatus;
  signupUrl: string;
  profileLink: string;
  priority: ClipperAccountCreationSessionPriority;
  copyPackage: Array<{ label: string; value: string }>;
  portalFormFields: Array<{ field: string; value: string; note: string }>;
  handleReservationPlan: string[];
  browserSessionChecklist: string[];
  evidenceCapturePlan: string[];
  submittedEvidenceBatchRow: string;
  verifiedEvidenceBatchRow: string;
  evidenceRecipeRow: string;
  nextStep: string;
  requiredProof: string[];
  operatorVaultChecklist: string[];
  postCreationNextActions: string[];
  doneCriteria: string[];
}

export interface ClipperAccountClaimSheetItem {
  rank: number;
  id: string;
  accountId: string;
  accountName: string;
  platform: ClipperPlatform;
  handle: string;
  priority: ClipperAccountCreationSessionPriority;
  signupUrl: string;
  profileLink: string;
  browserProfileLabel: string;
  vaultItemName: string;
  loginIdentifierLabel: string;
  passwordVaultSlot: string;
  twoFactorSlot: string;
  recoverySlot: string;
  proofFolder: string;
  evidenceFileName: string;
  evidenceRecipeRow: string;
  submittedEvidenceBatchRow: string;
  verifiedEvidenceBatchRow: string;
  preflightChecks: string[];
  claimSteps: string[];
  verificationSteps: string[];
  postClaimSteps: string[];
  blockedUntil: string[];
}

export interface ClipperAccountCreationPackSummary {
  status: ClipperAccountCreationPackStatus;
  generatedAt: string | null;
  manifestPath: string;
  markdownPath: string;
  csvPath: string;
  claimSheetPath: string;
  claimSheetCsvPath: string;
  officialSourcesCheckedAt: string;
  items: ClipperAccountCreationPackItem[];
  sessionOrder: ClipperAccountCreationSessionItem[];
  claimSheet: ClipperAccountClaimSheetItem[];
  evidenceBatchTemplate: string;
  totals: {
    profiles: number;
    ready: number;
    partial: number;
    blocked: number;
    evidenceMissing: number;
  };
  nextStep: string;
}

export interface ClipperAccountEvidenceItem {
  id: string;
  accountId: string;
  accountName: string;
  category: ClipperAccountCategory;
  platform: ClipperPlatform;
  handle: string;
  displayName: string;
  status: ClipperAccountEvidenceItemStatus;
  evidencePath: string;
  updatedAt: string;
  notes: string;
  nextStep: string;
}

export interface ClipperAccountEvidenceSummary {
  status: ClipperAccountEvidenceStatus;
  evidenceDir: string;
  templateDir: string;
  readmePath: string;
  launchEvidenceDropDir: string;
  launchEvidenceTemplatePath: string;
  launchEvidenceTemplateRows: number;
  launchEvidenceDropChecklist: string[];
  generatedAt: string | null;
  items: ClipperAccountEvidenceItem[];
  totals: {
    expected: number;
    submitted: number;
    verified: number;
    rejected: number;
    missing: number;
  };
  nextStep: string;
}

export interface ClipperDeveloperAppEvidenceItem {
  platform: ClipperPlatform;
  label: string;
  status: ClipperDeveloperAppEvidenceItemStatus;
  evidencePath: string;
  updatedAt: string;
  appIdentifier: string | null;
  publicBaseUrl: string | null;
  redirectUri: string;
  configuredEnvVars: string[];
  missingEnvVars: string[];
  notes: string;
  nextStep: string;
}

export interface ClipperDeveloperAppEvidenceSummary {
  status: ClipperDeveloperAppEvidenceStatus;
  evidenceDir: string;
  templateDir: string;
  readmePath: string;
  generatedAt: string | null;
  items: ClipperDeveloperAppEvidenceItem[];
  totals: {
    expected: number;
    approved: number;
    submitted: number;
    draft: number;
    rejected: number;
    missing: number;
  };
  nextStep: string;
}

export interface ClipperCredentialSetupItem {
  id: string;
  label: string;
  status: ClipperCredentialSetupStatus;
  acceptedEnvVarGroups: string[][];
  configuredEnvVars: string[];
  missingEnvVarGroups: string[];
  docsUrl: string;
  nextStep: string;
}

export interface ClipperCredentialImportPlanItem {
  id: string;
  label: string;
  status: ClipperCredentialSetupStatus;
  acceptedEnvVarGroups: string[][];
  suggestedEnvVars: string[];
  configuredEnvVars: string[];
  missingEnvVarGroups: string[];
  supportedInputFormats: string[];
  pasteTemplate: string;
  verificationSteps: string[];
  nextStep: string;
}

export interface ClipperCredentialSetupEnvFileItemScan {
  id: string;
  label: string;
  statusFromFile: ClipperCredentialSetupStatus;
  matchedEnvVars: string[];
  missingEnvVarGroups: string[];
}

export interface ClipperCredentialSetupEnvFileScan {
  fileName: string;
  exists: boolean;
  relevantKeys: string[];
  itemScans: ClipperCredentialSetupEnvFileItemScan[];
}

export interface ClipperCredentialSetupFileScan {
  fileName: string;
  relativePath: string;
  kind: "google_oauth_json" | "env_file" | "unknown";
  suggestedImportTarget: string;
  supportedInputFormat: string;
  nextStep: string;
}

export interface ClipperCredentialSetupSummary {
  status: ClipperCredentialSetupStatus;
  generatedAt: string | null;
  readmePath: string;
  templatePath: string;
  missingTemplatePath: string;
  envFilesChecked: string[];
  envFilesFound: string[];
  credentialDropDirs: string[];
  envFileScans: ClipperCredentialSetupEnvFileScan[];
  credentialFileScans: ClipperCredentialSetupFileScan[];
  items: ClipperCredentialSetupItem[];
  importPlan: ClipperCredentialImportPlanItem[];
  totals: {
    items: number;
    ready: number;
    partial: number;
    missing: number;
  };
  nextStep: string;
}

export interface ClipperPlatformPortalChecklistItem {
  platform: ClipperPlatform;
  label: string;
  status: ClipperPlatformPortalChecklistStatus;
  portalUrls: string[];
  doNow: string[];
  blockers: string[];
  evidenceBatchRows: string[];
  artifactPaths: string[];
  completionCriteria: string[];
  nextStep: string;
}

export interface ClipperPlatformPortalChecklistSummary {
  status: ClipperPlatformPortalChecklistStatus;
  generatedAt: string | null;
  manifestPath: string;
  markdownPath: string;
  csvPath: string;
  items: ClipperPlatformPortalChecklistItem[];
  totals: {
    platforms: number;
    ready: number;
    inProgress: number;
    blocked: number;
    evidenceRows: number;
    portalActions: number;
  };
  nextStep: string;
}

export interface ClipperCredentialReloadSummary {
  loadedFiles: string[];
  envFilesFound: string[];
  credentialSetup: ClipperCredentialSetupSummary;
}

export interface ClipperCredentialSecretWriteSummary {
  envFileName: string;
  envFilePath: string;
  envVar: string;
  updatedAt: string;
  configuredEnvVars: string[];
  credentialSetup: ClipperCredentialSetupSummary;
  credentialDoctor: ClipperCredentialDoctorSummary;
  nextStep: string;
}

export interface ClipperCredentialSecretBatchWriteSummary {
  envFileName: string;
  envFilePath: string;
  updatedAt: string;
  acceptedEnvVars: string[];
  rejectedEnvVars: string[];
  skippedLines: number;
  sourceFiles?: string[];
  filesScanned?: number;
  filesImported?: number;
  fileErrors?: Array<{ relativePath: string; reason: string }>;
  configuredEnvVars: string[];
  credentialSetup: ClipperCredentialSetupSummary;
  credentialDoctor: ClipperCredentialDoctorSummary;
  nextStep: string;
}

export interface ClipperProductionPublicUrlWriteSummary {
  envFileName: string;
  envFilePath: string;
  publicBaseUrl: string;
  updatedAt: string;
  productionUrlSetup: ClipperProductionUrlSetupSummary;
  legalPolicyPack: ClipperLegalPolicyPackSummary;
  appReviewDemoPack: ClipperAppReviewDemoPackSummary;
  developerApplicationDrafts: ClipperDeveloperApplicationDraftsSummary;
  oauthGoLive: ClipperOAuthGoLiveSummary;
  oauthConnectionPack: ClipperOAuthConnectionPackSummary;
  appReviewSubmissionPack: ClipperAppReviewSubmissionPackSummary;
  goLiveExecutionPack: ClipperGoLiveExecutionPackSummary;
  nextStep: string;
}

export interface ClipperCredentialDoctorEnvFile {
  fileName: string;
  exists: boolean;
  relevantKeys: string[];
}

export interface ClipperCredentialDoctorItem {
  id: string;
  label: string;
  platform: ClipperPlatform | "system";
  status: ClipperCredentialSetupStatus;
  acceptedEnvVarGroups: string[][];
  configuredEnvVars: string[];
  missingEnvVarGroups: string[];
  envFilesWithRelevantKeys: string[];
  nextStep: string;
}

export interface ClipperCredentialDoctorSummary {
  status: ClipperCredentialDoctorStatus;
  generatedAt: string | null;
  manifestPath: string;
  markdownPath: string;
  envFiles: ClipperCredentialDoctorEnvFile[];
  items: ClipperCredentialDoctorItem[];
  totals: {
    items: number;
    ready: number;
    partial: number;
    missing: number;
  };
  nextStep: string;
}

export interface ClipperPlatformReadinessItem {
  platform: ClipperPlatform;
  label: string;
  status: ClipperPlatformReadinessStatus;
  accountTasks: number;
  accountsVerified: number;
  developerAppStatus: ClipperDeveloperAppEvidenceItemStatus | "missing";
  permissionsApproved: number;
  permissionsTotal: number;
  credentialStatus: ClipperReadinessStatus;
  tokenSaved: boolean;
  missingEnvVars: string[];
  accountCreationUrl: string;
  developerPortalUrl: string;
  blockers: string[];
  nextStep: string;
}

export interface ClipperPlatformReadinessSummary {
  status: ClipperPlatformReadinessStatus;
  generatedAt: string | null;
  manifestPath: string;
  markdownPath: string;
  items: ClipperPlatformReadinessItem[];
  totals: {
    platforms: number;
    ready: number;
    partial: number;
    blocked: number;
  };
  nextStep: string;
}

export interface ClipperIntakeKitFile {
  id: string;
  label: string;
  path: string;
  exists: boolean;
  destinationDir: string;
  purpose: string;
}

export interface ClipperIntakeKitSummary {
  status: ClipperIntakeKitStatus;
  rootDir: string;
  templateDir: string;
  readmePath: string;
  generatedAt: string | null;
  files: ClipperIntakeKitFile[];
  nextStep: string;
}

export interface ClipperSourceIntakeBatchItem {
  id: string;
  category: ClipperAccountCategory;
  title: string;
  url: string;
  source: string;
  platform: string;
  targetFileName: string;
  targetSourcePath: string;
  rightsStatus: ClipperAssetRightsStatus;
  evidenceLink: string | null;
  priority: "high" | "medium" | "low";
  downloadCommand: string;
  sourceRightsBatchRow: string | null;
  checklist: string[];
  nextStep: string;
}

export interface ClipperSourceIntakeBatchSummary {
  importedAt: string;
  manifestPath: string;
  csvPath: string;
  markdownPath: string;
  accepted: number;
  skipped: number;
  items: ClipperSourceIntakeBatchItem[];
  totals: {
    sports: number;
    memes: number;
    streamers: number;
    ownedOrPermissioned: number;
    reviewRequired: number;
    highPriority: number;
  };
  nextStep: string;
}

export interface ClipperLaunchCommandCenterStep {
  id: string;
  label: string;
  owner: string;
  status: ClipperLaunchCommandCenterStepStatus;
  evidence: string;
  nextStep: string;
  artifactPath: string | null;
  actionUrl: string | null;
}

export interface ClipperLaunchCommandCenterSummary {
  status: ClipperLaunchCommandCenterStatus;
  generatedAt: string | null;
  manifestPath: string;
  markdownPath: string;
  steps: ClipperLaunchCommandCenterStep[];
  totals: {
    steps: number;
    done: number;
    needsAction: number;
    blocked: number;
  };
  nextStep: string;
}

export interface ClipperBlockerResolutionAction {
  id: string;
  rank: number;
  sourceStepId: string;
  unlockPhase: ClipperBlockerUnlockPhase;
  dependsOn: ClipperBlockerUnlockPhase[];
  label: string;
  owner: string;
  status: ClipperBlockerResolutionActionStatus;
  severity: "critical" | "high" | "medium";
  actionType: "credential" | "account" | "developer_app" | "permission" | "oauth" | "source" | "rights" | "metrics" | "automation" | "in_app" | "external";
  canRunInApp: boolean;
  actionUrl: string | null;
  portalUrl: string | null;
  executionMode: ClipperBlockerExecutionMode;
  estimatedMinutes: number;
  artifactPath: string | null;
  evidence: string;
  evidenceImportRow: string;
  proofCommand: string;
  nextStep: string;
  unblockCondition: string;
  doneCriteria: string[];
  checklist: string[];
}

export interface ClipperBlockerResolutionPackSummary {
  status: ClipperBlockerResolutionPackStatus;
  generatedAt: string | null;
  manifestPath: string;
  markdownPath: string;
  csvPath: string;
  actions: ClipperBlockerResolutionAction[];
  evidenceBatchTemplate: string;
  totals: {
    actions: number;
    critical: number;
    blocked: number;
    next: number;
    ready: number;
    inApp: number;
    external: number;
  };
  nextStep: string;
}

export interface ClipperGoLiveAutopilotAction {
  id: string;
  rank: number;
  lane: ClipperGoLiveAutopilotActionLane;
  platform: ClipperPlatform | "system";
  agentId: string;
  subAgentName: string;
  owner: string;
  status: ClipperGoLiveAutopilotActionStatus;
  label: string;
  localActionUrl: string | null;
  portalUrl: string | null;
  artifactPath: string | null;
  evidenceTemplate: string;
  evidenceRows: string[];
  handoffPayload: Array<{ label: string; value: string }>;
  operatorSteps: string[];
  successSignals: string[];
  riskControls: string[];
  mission: string;
  reason: string;
  nextStep: string;
  blockers: string[];
  unblockCondition: string;
}

export interface ClipperGoLiveAutopilotBriefSummary {
  status: ClipperGoLiveAutopilotBriefStatus;
  generatedAt: string | null;
  manifestPath: string;
  markdownPath: string;
  csvPath: string;
  actions: ClipperGoLiveAutopilotAction[];
  totals: {
    actions: number;
    inAppReady: number;
    externalRequired: number;
    waiting: number;
    done: number;
    blocked: number;
    platformsCovered: number;
  };
  lanes: Record<ClipperGoLiveAutopilotActionLane, number>;
  nextStep: string;
}

export interface ClipperGoLiveAutopilotRunItem {
  actionId: string;
  label: string;
  localActionUrl: string | null;
  status: ClipperGoLiveAutopilotRunItemStatus;
  startedAt: string;
  finishedAt: string;
  message: string;
}

export interface ClipperGoLiveAutopilotRunSummary {
  status: ClipperGoLiveAutopilotRunStatus;
  generatedAt: string | null;
  manifestPath: string;
  markdownPath: string;
  requestedActionId: string | null;
  maxActions: number;
  completedActionIds: string[];
  items: ClipperGoLiveAutopilotRunItem[];
  totals: {
    attempted: number;
    completed: number;
    skipped: number;
    failed: number;
  };
  nextStep: string;
}

export interface ClipperPermissionTrackerItem {
  id: string;
  platform: ClipperPlatform;
  scope: string;
  label: string;
  status: ClipperPermissionTrackerItemStatus;
  statusSource: "computed" | "manual_record";
  recordedAt: string | null;
  recordNotes: string | null;
  appReviewRequired: boolean;
  docsUrl: string;
  developerPortalUrl: string;
  evidenceBatchRow: string;
  evidenceRecipeRow: string;
  evidenceRequired: string[];
  humanSteps: string[];
  blockers: string[];
  sourceVerifiedAt: string;
  nextStep: string;
}

export interface ClipperPermissionTrackerSummary {
  status: ClipperPermissionTrackerStatus;
  generatedAt: string | null;
  trackerPath: string;
  markdownPath: string;
  statusRecordsPath: string;
  items: ClipperPermissionTrackerItem[];
  totals: {
    permissions: number;
    approved: number;
    requested: number;
    readyToRequest: number;
    blocked: number;
  };
  officialSources: string[];
  nextStep: string;
}

export interface ClipperPermissionRequestPackItem {
  id: string;
  platform: ClipperPlatform;
  scope: string;
  label: string;
  status: ClipperPermissionTrackerItemStatus;
  packStatus: ClipperPermissionRequestPackStatus;
  developerPortalUrl: string;
  docsUrl: string;
  officialReferenceUrl: string;
  officialVerificationStatus: ClipperOfficialPermissionSourceStatus | "missing";
  requestReadiness: ClipperPermissionRequestReadiness;
  requestedUseCase: string;
  copyReadyJustification: string;
  reviewerInstructions: string;
  scopeRequestLine: string;
  platformConstraints: string[];
  auditWarnings: string[];
  officialApprovalChecklist: string[];
  reviewerEvidence: string[];
  missingEvidence: string[];
  submissionSteps: string[];
  evidenceBatchRow: string;
  evidenceRecipeRow: string;
  legalUrls: {
    privacyPolicyUrl: string;
    termsUrl: string;
    demoUrl: string;
  };
  blockers: string[];
  nextStep: string;
}

export interface ClipperPermissionRequestPackSummary {
  status: ClipperPermissionRequestPackStatus;
  generatedAt: string | null;
  manifestPath: string;
  markdownPath: string;
  csvPath: string;
  sourceTrackerPath: string;
  items: ClipperPermissionRequestPackItem[];
  totals: {
    permissions: number;
    ready: number;
    partial: number;
    blocked: number;
    approved: number;
    requested: number;
  };
  nextStep: string;
}

export interface ClipperPermissionStatusRecord {
  id: string;
  platform: ClipperPlatform;
  scope: string;
  label: string;
  status: ClipperPermissionTrackerItemStatus;
  notes: string;
  recordedAt: string;
  source: "clippers-ui";
}

export interface ClipperLaunchEvidenceBatchRejectedItem {
  index: number;
  kind: string;
  reason: string;
  identifier: string | null;
}

export interface ClipperLaunchEvidenceBatchSummary {
  updatedAt: string;
  accepted: {
    accountEvidence: number;
    developerApps: number;
    permissions: number;
    sourceRights: number;
  };
  rejected: ClipperLaunchEvidenceBatchRejectedItem[];
  sourceFiles?: string[];
  filesScanned?: number;
  filesImported?: number;
  fileErrors?: Array<{ relativePath: string; reason: string }>;
  accountEvidence: ClipperAccountEvidenceSummary;
  developerAppEvidence: ClipperDeveloperAppEvidenceSummary;
  permissionTracker: ClipperPermissionTrackerSummary;
  nextStep: string;
}

export interface ClipperExternalSetupQueueItem {
  id: string;
  type: ClipperExternalSetupQueueItemType;
  platform: ClipperPlatform;
  accountId: string | null;
  accountName: string | null;
  label: string;
  status: ClipperLaunchCommandCenterStepStatus;
  priority: ClipperExternalSetupQueuePriority;
  portalUrl: string;
  artifactPath: string | null;
  evidencePath: string | null;
  envVars: string[];
  scopes: string[];
  checklist: string[];
  requiredInputs: string[];
  doneCriteria: string[];
  evidenceRecipeRow: string;
  blockers: string[];
  nextStep: string;
}

export interface ClipperExternalSetupQueueSummary {
  status: ClipperExternalSetupQueueStatus;
  generatedAt: string | null;
  manifestPath: string;
  markdownPath: string;
  items: ClipperExternalSetupQueueItem[];
  totals: {
    items: number;
    done: number;
    needsAction: number;
    blocked: number;
    critical: number;
  };
  nextStep: string;
}

export interface ClipperExternalExecutionHandoffItem {
  id: string;
  rank: number;
  type: ClipperExternalSetupQueueItemType;
  platform: ClipperPlatform;
  label: string;
  priority: ClipperExternalSetupQueuePriority;
  portalUrl: string;
  status: ClipperLaunchCommandCenterStepStatus;
  evidenceBatchRow: string;
  evidenceTemplate: string;
  envVars: string[];
  scopes: string[];
  checklist: string[];
  blockers: string[];
  nextStep: string;
  unblockCondition: string;
}

export interface ClipperExternalExecutionHandoffSummary {
  status: ClipperExternalExecutionHandoffStatus;
  generatedAt: string | null;
  manifestPath: string;
  markdownPath: string;
  csvPath: string;
  batchTemplatePath: string;
  items: ClipperExternalExecutionHandoffItem[];
  evidenceBatchTemplate: string;
  totals: {
    items: number;
    accounts: number;
    developerApps: number;
    credentials: number;
    permissions: number;
    oauth: number;
    critical: number;
    blocked: number;
  };
  nextStep: string;
}

export type ClipperExternalExecutionSessionLane = "do_now" | "blocked" | "waiting";

export interface ClipperExternalExecutionSessionItem {
  id: string;
  rank: number;
  lane: ClipperExternalExecutionSessionLane;
  laneReason: string;
  type: ClipperExternalSetupQueueItemType;
  platform: ClipperPlatform;
  label: string;
  portalUrl: string;
  executionUrl: string;
  status: ClipperLaunchCommandCenterStepStatus;
  actionMode: "open_portal" | "paste_env" | "paste_evidence" | "connect_oauth";
  evidenceBatchRow: string;
  evidenceRecipeRow: string;
  evidenceImportReady: boolean;
  credentialTemplate: string;
  requiredInputs: string[];
  completionHint: string;
  nextStep: string;
  blockers: string[];
}

export interface ClipperExternalExecutionUnlockBoardItem {
  platform: ClipperPlatform;
  total: number;
  doNow: number;
  blocked: number;
  waiting: number;
  evidenceRows: number;
  credentialTemplates: number;
  nextEvidenceRows: string[];
  portalUrls: string[];
  nextStep: string;
}

export interface ClipperExternalExecutionPortalBatch {
  id: string;
  platform: ClipperPlatform;
  type: ClipperExternalSetupQueueItemType;
  label: string;
  status: ClipperExternalExecutionHandoffStatus;
  total: number;
  doNow: number;
  blocked: number;
  waiting: number;
  portalUrls: string[];
  executionUrls: string[];
  evidenceRows: string[];
  credentialTemplates: string[];
  firstItemRank: number;
  nextStep: string;
  operatorChecklist: string[];
  importTemplate: string;
}

export interface ClipperExternalExecutionSessionSummary {
  status: ClipperExternalExecutionHandoffStatus;
  generatedAt: string | null;
  manifestPath: string;
  markdownPath: string;
  csvPath: string;
  evidenceImportPath: string;
  evidenceImportTemplate: string;
  items: ClipperExternalExecutionSessionItem[];
  unlockBoard: ClipperExternalExecutionUnlockBoardItem[];
  portalBatches: ClipperExternalExecutionPortalBatch[];
  totals: {
    items: number;
    doNow: number;
    blocked: number;
    waiting: number;
    evidenceRows: number;
    envTemplates: number;
    importableEvidenceRows: number;
    portalBatches: number;
  };
  nextStep: string;
}

export interface ClipperExternalLaunchDossierPlatform {
  platform: ClipperPlatform;
  label: string;
  status: ClipperExternalLaunchDossierStatus;
  accountTasks: number;
  accountTasksDone: number;
  developerAppStatus: ClipperDeveloperAppEvidenceItemStatus | "missing";
  credentialStatus: ClipperCredentialSetupStatus;
  permissionsApproved: number;
  permissionsTotal: number;
  oauthStatus: ClipperOAuthGoLiveStatus;
  publisherConnectorStatus: ClipperPublisherConnectorStatus;
  accountCreationUrl: string;
  developerPortalUrl: string;
  oauthUrl: string | null;
  artifactPaths: string[];
  criticalActions: string[];
  blockedExternalItems: number;
  unlockInputs: string[];
  sessionNextSteps: string[];
  permissionUnlocks: Array<{
    scope: string;
    requestPortalUrl: string;
    requestAction: string;
    requiredForAutopost: boolean;
    appReviewRequired: boolean;
    evidenceRequired: string[];
    evidenceBatchRow: string;
  }>;
  nextStep: string;
}

export interface ClipperExternalLaunchDossierSummary {
  status: ClipperExternalLaunchDossierStatus;
  generatedAt: string | null;
  manifestPath: string;
  markdownPath: string;
  platforms: ClipperExternalLaunchDossierPlatform[];
  totals: {
    platforms: number;
    ready: number;
    inProgress: number;
    blocked: number;
    criticalActions: number;
    blockedExternalItems: number;
    unlockInputs: number;
    permissionUnlocks: number;
  };
  nextStep: string;
}

export interface ClipperGoLiveExecutionPhase {
  id: string;
  label: string;
  owner: string;
  status: ClipperGoLiveExecutionPhaseStatus;
  portalUrl: string | null;
  localActionUrl: string | null;
  evidencePath: string | null;
  checklist: string[];
  blocker: string | null;
  nextStep: string;
}

export interface ClipperGoLiveExecutionPlatform {
  platform: ClipperPlatform;
  label: string;
  status: ClipperGoLiveExecutionPackStatus;
  phases: ClipperGoLiveExecutionPhase[];
  totals: {
    phases: number;
    done: number;
    readyToExecute: number;
    blocked: number;
  };
  nextStep: string;
}

export interface ClipperGoLiveExecutionPackSummary {
  status: ClipperGoLiveExecutionPackStatus;
  generatedAt: string | null;
  manifestPath: string;
  markdownPath: string;
  platforms: ClipperGoLiveExecutionPlatform[];
  totals: {
    platforms: number;
    ready: number;
    inProgress: number;
    blocked: number;
    phases: number;
    done: number;
    readyToExecute: number;
  };
  nextStep: string;
}

export interface ClipperAppReviewSubmissionAnswer {
  prompt: string;
  response: string;
}

export interface ClipperAppReviewSubmissionItem {
  platform: ClipperPlatform;
  label: string;
  status: ClipperAppReviewSubmissionPackStatus;
  developerPortalUrl: string;
  redirectUri: string;
  requestedScopes: string[];
  accountHandles: string[];
  privacyPolicyUrl: string;
  termsUrl: string;
  demoUrl: string;
  productionUrlReady: boolean;
  officialSourceStatus: ClipperOfficialPermissionSourceStatus | "missing";
  submissionAnswers: ClipperAppReviewSubmissionAnswer[];
  evidenceChecklist: string[];
  blockers: string[];
  officialDocs: string[];
  nextStep: string;
}

export interface ClipperAppReviewSubmissionPackSummary {
  status: ClipperAppReviewSubmissionPackStatus;
  generatedAt: string | null;
  manifestPath: string;
  markdownPath: string;
  items: ClipperAppReviewSubmissionItem[];
  totals: {
    platforms: number;
    ready: number;
    blocked: number;
    answers: number;
    evidenceItems: number;
  };
  nextStep: string;
}

export interface ClipperAppReviewDemoStep {
  id: string;
  label: string;
  owner: string;
  status: ClipperLaunchCommandCenterStepStatus;
  publicDemoUrl: string;
  localEvidencePath: string;
  checklist: string[];
  nextStep: string;
}

export interface ClipperAppReviewDemoPackSummary {
  status: ClipperAppReviewDemoPackStatus;
  generatedAt: string | null;
  manifestPath: string;
  markdownPath: string;
  demoScriptPath: string;
  demoUrl: string;
  publicBaseUrl: string;
  productionUrlReady: boolean;
  steps: ClipperAppReviewDemoStep[];
  blockers: string[];
  nextStep: string;
}

export interface ClipperDeveloperApplicationDraftItem {
  platform: ClipperPlatform;
  label: string;
  status: ClipperDeveloperApplicationDraftsStatus;
  developerPortalUrl: string;
  appName: string;
  appType: string;
  requestedScopes: string[];
  redirectUri: string;
  privacyPolicyUrl: string;
  termsUrl: string;
  demoUrl: string;
  officialDocs: string[];
  officialVerification: string;
  submissionAnswers: ClipperAppReviewSubmissionAnswer[];
  submissionChecklist: string[];
  portalFlow: string[];
  approvalCriteria: string[];
  postApprovalSteps: string[];
  requiredInputs: string[];
  completionHint: string;
  evidenceBatchRow: string;
  draftEvidenceBatchRow: string;
  submittedEvidenceBatchRow: string;
  approvedEvidenceBatchRow: string;
  evidenceRecipeRow: string;
  credentialCopyMap: Array<{ envVarGroup: string; portalField: string; storageRule: string }>;
  portalSubmissionSteps: string[];
  appVaultChecklist: string[];
  accountPrerequisites: string[];
  developerPrerequisites: string[];
  blockers: string[];
  nextStep: string;
}

export interface ClipperDeveloperApplicationSessionItem {
  rank: number;
  platform: ClipperPlatform;
  label: string;
  status: ClipperDeveloperApplicationDraftsStatus;
  developerPortalUrl: string;
  appName: string;
  appType: string;
  redirectUri: string;
  requestedScopes: string[];
  credentialEnvGroups: string[];
  portalFields: Array<{
    label: string;
    value: string;
  }>;
  evidenceNeeded: string[];
  doneCriteria: string[];
  evidenceBatchRow: string;
  draftEvidenceBatchRow: string;
  submittedEvidenceBatchRow: string;
  approvedEvidenceBatchRow: string;
  evidenceRecipeRow: string;
  credentialCopyMap: Array<{ envVarGroup: string; portalField: string; storageRule: string }>;
  portalSubmissionSteps: string[];
  appVaultChecklist: string[];
  nextStep: string;
}

export interface ClipperDeveloperApplicationDraftsSummary {
  status: ClipperDeveloperApplicationDraftsStatus;
  generatedAt: string | null;
  manifestPath: string;
  markdownPath: string;
  sourceCheckedAt: string;
  items: ClipperDeveloperApplicationDraftItem[];
  creationSession: ClipperDeveloperApplicationSessionItem[];
  totals: {
    platforms: number;
    ready: number;
    blocked: number;
    scopes: number;
    checklistItems: number;
    sessionSteps: number;
  };
  nextStep: string;
}

export interface ClipperOfficialPermissionMatrixItem {
  platform: ClipperPlatform;
  label: string;
  sourceStatus: ClipperOfficialPermissionSourceStatus;
  officialDocs: string[];
    scopes: Array<{
      scope: string;
      purpose: string;
      requiredForAutopost: boolean;
      appReviewRequired: boolean;
      officialReferenceUrl: string;
      verificationStatus: ClipperOfficialPermissionSourceStatus;
      verifiedAt: string;
      verificationNote: string;
      requestPortalUrl: string;
      requestAction: string;
      verificationChecklist: string[];
      evidenceRequired: string[];
      launchEvidenceBatchRow: string;
      portalSubmissionSteps?: string[];
      approvalEvidenceBatchRow?: string;
      postApprovalChecklist?: string[];
      complianceRisk?: string;
      fallbackPlan?: string;
      sourceAudit?: {
        lastCheckedAt: string;
        accessMode: "public" | "login_required";
        canonicalUrl: string;
        publicEvidence: string[];
        needsHumanRecheck: boolean;
        goLiveDecision: "ready_to_request" | "login_required_before_request" | "blocked_until_public_url";
      };
      sourceProofPack?: {
        status: "ready_to_attach" | "login_required";
        checkedAt: string;
        officialUrls: string[];
        verifiedClaims: string[];
        submitDecision: "request_now" | "human_login_recheck";
        blocker: string | null;
        reviewerEvidence: string[];
      };
  }>;
  accountPrerequisites: string[];
  developerPrerequisites: string[];
  reviewRisks: string[];
  evidenceToPrepare: string[];
  apiEndpointHint: string;
  nextStep: string;
}

export interface ClipperOfficialPermissionMatrixSummary {
  status: ClipperOfficialPermissionMatrixStatus;
  generatedAt: string | null;
  manifestPath: string;
  markdownPath: string;
  verifiedAt: string;
  items: ClipperOfficialPermissionMatrixItem[];
  totals: {
    platforms: number;
    officialVerified: number;
    loginRequired: number;
    scopes: number;
    appReviewRequired: number;
  };
  nextStep: string;
}

export interface ClipperPublisherConnectorItem {
  platform: ClipperPlatform;
  label: string;
  status: ClipperPublisherConnectorStatus;
  endpoint: string;
  method: "POST";
  mode: "direct_post" | "draft_upload" | "media_publish" | "video_insert";
  requiredScopes: string[];
  tokenSaved: boolean;
  permissionsApproved: number;
  permissionsTotal: number;
  publishableQueueItems: number;
  publishGate: "blocked" | "dry_run_ready" | "approval_required_ready";
  blockingCategories: ClipperPublisherBlockingCategory[];
  proofNeeded: string[];
  goLiveChecks: Array<{
    id: string;
    label: string;
    done: boolean;
    evidence: string;
  }>;
  payloadFields: string[];
  preflightChecks: string[];
  blockers: string[];
  nextStep: string;
}

export interface ClipperPublisherConnectorSummary {
  status: ClipperPublisherConnectorStatus;
  generatedAt: string | null;
  manifestPath: string;
  markdownPath: string;
  items: ClipperPublisherConnectorItem[];
  totals: {
    platforms: number;
    ready: number;
    partial: number;
    blocked: number;
  };
  nextStep: string;
}

export interface ClipperOAuthGoLiveItem {
  platform: ClipperPlatform;
  label: string;
  status: ClipperOAuthGoLiveStatus;
  redirectUri: string;
  callbackPath: string;
  authUrl: string | null;
  tokenExchangeStatus: ClipperTokenExchangeStatus;
  tokenSaved: boolean;
  tokenVaultReady: boolean;
  credentialsReady: boolean;
  developerAppStatus: ClipperDeveloperAppEvidenceItemStatus | "missing";
  permissionsApproved: number;
  permissionsTotal: number;
  publisherConnectorStatus: ClipperPublisherConnectorStatus;
  productionUrlReady: boolean;
  missingEnvVars: string[];
  blockers: string[];
  nextStep: string;
}

export interface ClipperOAuthGoLiveSummary {
  status: ClipperOAuthGoLiveStatus;
  generatedAt: string | null;
  manifestPath: string;
  markdownPath: string;
  publicBaseUrl: string;
  productionUrlReady: boolean;
  productionUrlNote: string;
  items: ClipperOAuthGoLiveItem[];
  totals: {
    platforms: number;
    ready: number;
    partial: number;
    blocked: number;
  };
  nextStep: string;
}

export interface ClipperOAuthConnectionPackItem {
  id: string;
  accountId: string;
  accountName: string;
  category: ClipperAccountCategory;
  platform: ClipperPlatform;
  handle: string;
  displayName: string;
  status: ClipperOAuthConnectionPackStatus;
  connectionStatus: ClipperPlatformConnectionStatus;
  authUrl: string | null;
  callbackPath: string;
  redirectUri: string;
  requestedScopes: string[];
  tokenSaved: boolean;
  tokenSavedAt: string | null;
  tokenStatus: ClipperTokenVaultStatus | "token_missing";
  developerPortalUrl: string;
  accountEvidenceStatus: ClipperAccountEvidenceItemStatus | "missing";
  accountEvidencePath: string | null;
  permissionStatuses: ClipperPermissionTrackerItemStatus[];
  permissionSummary: string;
  checklist: string[];
  evidenceToCapture: string[];
  requiredInputs: string[];
  completionHint: string;
  blockers: string[];
  nextStep: string;
}

export interface ClipperOAuthConnectionPackSummary {
  status: ClipperOAuthConnectionPackStatus;
  generatedAt: string | null;
  manifestPath: string;
  markdownPath: string;
  csvPath: string;
  publicBaseUrl: string;
  productionUrlReady: boolean;
  items: ClipperOAuthConnectionPackItem[];
  totals: {
    connections: number;
    ready: number;
    partial: number;
    blocked: number;
    tokensSaved: number;
    authUrlsReady: number;
  };
  nextStep: string;
}

export interface ClipperProductionUrlSetupPlatform {
  platform: ClipperPlatform;
  label: string;
  redirectUri: string;
  publicRedirectUri: string;
  developerPortalUrl: string;
  domainVerificationRequired: boolean;
  publicLegalUrls: string[];
  publicDemoUrl: string;
  evidenceRecipeRow: string;
  checklist: string[];
}

export interface ClipperProductionUrlSetupSessionItem {
  rank: number;
  id: string;
  label: string;
  status: "blocked" | "ready";
  owner: string;
  requiredValue: string;
  copyValue: string;
  clipboardValues: Array<{ label: string; value: string }>;
  portalUrl: string | null;
  verificationUrls: string[];
  evidenceRecipeRow: string;
  evidenceNeeded: string[];
  doneCriteria: string[];
  nextStep: string;
}

export interface ClipperProductionUrlEndpointCheck {
  id: string;
  label: string;
  url: string;
  expected: string;
}

export interface ClipperProductionDnsRecordCandidate {
  id: string;
  label: string;
  recordType: "A" | "AAAA" | "CNAME";
  name: string;
  value: string;
  ttl: number;
  priority: "recommended" | "fallback";
  whenToUse: string;
  copyLine: string;
  validationCommand: string;
}

export interface ClipperProductionUrlSetupSummary {
  status: ClipperOAuthGoLiveStatus;
  generatedAt: string | null;
  manifestPath: string;
  markdownPath: string;
  publicBaseUrl: string;
  productionUrlReady: boolean;
  productionUrlNote: string;
  requiredEnvVar: "PUBLIC_BASE_URL";
  requiredProtocol: "https";
  saveChecklist: string[];
  endpointChecks: ClipperProductionUrlEndpointCheck[];
  setupSession: ClipperProductionUrlSetupSessionItem[];
  platforms: ClipperProductionUrlSetupPlatform[];
  blockers: string[];
  nextStep: string;
}

export interface ClipperProductionUrlVerificationItem {
  id: string;
  label: string;
  url: string;
  expected: string;
  status: "pass" | "fail" | "skipped";
  statusCode: number | null;
  responseMs: number | null;
  checkedAt: string;
  error: string | null;
  evidence: string;
}

export interface ClipperProductionDnsDiagnostic {
  host: string | null;
  rootDomain: string | null;
  isApexDomain: boolean;
  status: "not_checked" | "resolved" | "unresolved" | "invalid";
  addresses: string[];
  recordTypesChecked: string[];
  error: string | null;
  suggestedRecords: string[];
  recordCandidates: ClipperProductionDnsRecordCandidate[];
  propagationChecks: string[];
  registrarChecklist: string[];
  blockedUntilResolved: string[];
  nextStep: string;
}

export interface ClipperProductionUrlVerificationSummary {
  status: "not_run" | "pass" | "partial" | "fail" | "blocked";
  generatedAt: string | null;
  manifestPath: string;
  markdownPath: string;
  publicBaseUrl: string;
  productionUrlReady: boolean;
  dnsDiagnostic: ClipperProductionDnsDiagnostic;
  items: ClipperProductionUrlVerificationItem[];
  totals: {
    endpoints: number;
    pass: number;
    fail: number;
    skipped: number;
  };
  nextStep: string;
}

export interface ClipperHttpsTunnelPlanOption {
  id: string;
  label: string;
  status: "recommended" | "available" | "fallback";
  fit: "production" | "staging" | "temporary";
  publicUrlRequirement: string;
  setupSteps: string[];
  localCommands: string[];
  portalUrl: string;
  pros: string[];
  risks: string[];
  nextStep: string;
}

export interface ClipperHttpsTunnelExecutionItem {
  rank: number;
  optionId: string;
  label: string;
  fit: "production" | "staging" | "temporary";
  recommended: boolean;
  portalUrl: string;
  localOrigin: string;
  expectedPublicUrlPattern: string;
  publicBaseUrlTemplate: string;
  commandSequence: string[];
  savePublicBaseUrlSteps: string[];
  endpointChecks: ClipperProductionUrlEndpointCheck[];
  evidenceToCapture: string[];
  registerAfterSave: string[];
  stabilityChecklist: string[];
  doneCriteria: string[];
  rollbackPlan: string[];
  nextStep: string;
}

export interface ClipperHttpsTunnelPlanSummary {
  status: ClipperHttpsTunnelPlanStatus;
  generatedAt: string | null;
  manifestPath: string;
  markdownPath: string;
  publicBaseUrl: string;
  localPort: string;
  localOrigin: string;
  productionUrlReady: boolean;
  recommendedOptionId: string;
  options: ClipperHttpsTunnelPlanOption[];
  executionSession: ClipperHttpsTunnelExecutionItem[];
  blockers: string[];
  nextStep: string;
}

export interface ClipperLegalPolicyPackSummary {
  status: ClipperLegalPolicyPackStatus;
  generatedAt: string | null;
  manifestPath: string;
  markdownPath: string;
  privacyPath: string;
  termsPath: string;
  privacyUrl: string;
  termsUrl: string;
  publicBaseUrl: string;
  productionUrlReady: boolean;
  blockers: string[];
  nextStep: string;
}

interface ClipperEncryptedPayload {
  algorithm: "aes-256-gcm";
  iv: string;
  authTag: string;
  data: string;
}

interface ClipperTokenVaultRecord extends ClipperTokenSummary {
  encryptedPayload: ClipperEncryptedPayload;
}

interface ClipperTokenExchangeRequest {
  url: string;
  method: "GET" | "POST";
  headers: Record<string, string>;
  body?: string;
}

export interface ClipperRunOptions {
  clipsPerAccount?: number;
  publishMode?: "draft_only" | "approval_required" | "auto_after_connection";
  riskTolerance?: "safe" | "growth" | "aggressive";
}

export interface ClipperPlannedClip {
  accountId: string;
  title: string;
  sourceStrategy: string;
  format: string;
  hook: string;
  publishWindow: string;
  status: "drafted" | "needs_source" | "needs_review";
}

export interface ClipperReport {
  id: string;
  userId: string;
  createdAt: string;
  summary: string;
  publishMode: "draft_only" | "approval_required" | "auto_after_connection";
  riskTolerance: "safe" | "growth" | "aggressive";
  plannedClips: ClipperPlannedClip[];
  accountRecommendations: Array<{
    accountId: string;
    recommendation: string;
    reason: string;
  }>;
  nextActions: string[];
  reportPath: string;
}

const ROOT_DIR = path.join(process.cwd(), "clippers_workspace");
const REPORTS_DIR = path.join(ROOT_DIR, "reports");
const SOURCES_DIR = path.join(ROOT_DIR, "sources");
const DRAFTS_DIR = path.join(ROOT_DIR, "drafts");
const RENDERED_DIR = path.join(ROOT_DIR, "rendered");
const SCHEDULED_DIR = path.join(ROOT_DIR, "scheduled");
const METRICS_DIR = path.join(ROOT_DIR, "metrics");
const TRENDS_DIR = path.join(ROOT_DIR, "trends");
const SOURCE_HUNTS_DIR = path.join(ROOT_DIR, "source-hunts");
const SOURCE_DROP_DIR = path.join(ROOT_DIR, "source-drop");
const SOURCE_DROP_README_PATH = path.join(SOURCE_DROP_DIR, "README.md");
const PERMISSION_PACK_DIR = path.join(ROOT_DIR, "permission-applications");
const ACCOUNT_EVIDENCE_DIR = path.join(ROOT_DIR, "account-evidence");
const ACCOUNT_EVIDENCE_TEMPLATE_DIR = path.join(ACCOUNT_EVIDENCE_DIR, "templates");
const ACCOUNT_EVIDENCE_README_PATH = path.join(ACCOUNT_EVIDENCE_DIR, "README.md");
const DEVELOPER_APP_EVIDENCE_DIR = path.join(ROOT_DIR, "developer-app-evidence");
const DEVELOPER_APP_EVIDENCE_TEMPLATE_DIR = path.join(DEVELOPER_APP_EVIDENCE_DIR, "templates");
const DEVELOPER_APP_EVIDENCE_README_PATH = path.join(DEVELOPER_APP_EVIDENCE_DIR, "README.md");
const LAUNCH_EVIDENCE_DROP_DIR = path.join(ROOT_DIR, "evidence-drop");
const LAUNCH_EVIDENCE_DROP_README_PATH = path.join(LAUNCH_EVIDENCE_DROP_DIR, "README.md");
const LAUNCH_EVIDENCE_TEMPLATE_PATH = path.join(LAUNCH_EVIDENCE_DROP_DIR, "launch-evidence-template.csv");
const CONFIG_PATH = path.join(ROOT_DIR, "config.json");
const OAUTH_STATE_PATH = path.join(ROOT_DIR, "oauth-connections.json");
const TOKEN_VAULT_PATH = path.join(ROOT_DIR, "oauth-token-vault.json");
const PLATFORM_READINESS_PATH = path.join(ROOT_DIR, "platform-readiness.json");
const PLATFORM_READINESS_MARKDOWN_PATH = path.join(ROOT_DIR, "platform-readiness.md");
const CREDENTIAL_DOCTOR_PATH = path.join(ROOT_DIR, "credential-doctor.json");
const CREDENTIAL_DOCTOR_MARKDOWN_PATH = path.join(ROOT_DIR, "credential-doctor.md");
const DRIVE_WORKSPACE_MANIFEST_PATH = path.join(ROOT_DIR, "google-drive-workspace.json");
const METRICS_SUMMARY_PATH = path.join(METRICS_DIR, "metrics-summary.json");
const TRENDS_SUMMARY_PATH = path.join(TRENDS_DIR, "trend-radar-summary.json");
const TREND_RIGHTS_OUTREACH_PATH = path.join(ROOT_DIR, "trend-rights-outreach-pack.json");
const TREND_RIGHTS_OUTREACH_MARKDOWN_PATH = path.join(ROOT_DIR, "trend-rights-outreach-pack.md");
const TREND_RIGHTS_OUTREACH_CSV_PATH = path.join(ROOT_DIR, "trend-rights-outreach-pack.csv");
const VIRAL_DISCOVERY_PATH = path.join(ROOT_DIR, "viral-discovery-pack.json");
const VIRAL_DISCOVERY_MARKDOWN_PATH = path.join(ROOT_DIR, "viral-discovery-pack.md");
const VIRAL_DISCOVERY_CSV_PATH = path.join(ROOT_DIR, "viral-discovery-pack.csv");
const SOURCE_ACQUISITION_PLAN_PATH = path.join(ROOT_DIR, "source-acquisition-plan.json");
const SOURCE_ACQUISITION_PLAN_MARKDOWN_PATH = path.join(ROOT_DIR, "source-acquisition-plan.md");
const RIGHTS_OUTREACH_PATH = path.join(ROOT_DIR, "rights-outreach-pack.json");
const RIGHTS_OUTREACH_MARKDOWN_PATH = path.join(ROOT_DIR, "rights-outreach-pack.md");
const RIGHTS_OUTREACH_TEMPLATES_PATH = path.join(ROOT_DIR, "rights-outreach-templates.md");
const DRAFT_SPECS_MANIFEST_PATH = path.join(DRAFTS_DIR, "draft-specs-manifest.json");
const RENDERED_CLIPS_MANIFEST_PATH = path.join(RENDERED_DIR, "rendered-clips-latest.json");
const MANUAL_POSTING_PACK_PATH = path.join(SCHEDULED_DIR, "manual-posting-pack.json");
const MANUAL_POSTING_PACK_MARKDOWN_PATH = path.join(SCHEDULED_DIR, "manual-posting-pack.md");
const MANUAL_POSTING_PACK_CSV_PATH = path.join(SCHEDULED_DIR, "manual-posting-pack.csv");
const PUBLISHING_PACKAGE_PATH = path.join(SCHEDULED_DIR, "publishing-package.json");
const PUBLISHING_PACKAGE_MARKDOWN_PATH = path.join(SCHEDULED_DIR, "publishing-package.md");
const PUBLISHING_PACKAGE_CSV_PATH = path.join(SCHEDULED_DIR, "publishing-package.csv");
const AUTOMATION_SCHEDULE_PATH = path.join(ROOT_DIR, "automation-schedule.json");
const ACCOUNT_IDENTITY_KIT_PATH = path.join(ROOT_DIR, "account-identity-kit.json");
const ACCOUNT_IDENTITY_KIT_MARKDOWN_PATH = path.join(ROOT_DIR, "account-identity-kit.md");
const ACCOUNT_LAUNCH_KIT_PATH = path.join(ROOT_DIR, "account-launch-kit.json");
const ACCOUNT_LAUNCH_KIT_MARKDOWN_PATH = path.join(ROOT_DIR, "account-launch-kit.md");
const ACCOUNT_CREATION_PACK_PATH = path.join(ROOT_DIR, "account-creation-pack.json");
const ACCOUNT_CREATION_PACK_MARKDOWN_PATH = path.join(ROOT_DIR, "account-creation-pack.md");
const ACCOUNT_CREATION_PACK_CSV_PATH = path.join(ROOT_DIR, "account-creation-pack.csv");
const ACCOUNT_CLAIM_SHEET_MARKDOWN_PATH = path.join(ROOT_DIR, "account-claim-sheet.md");
const ACCOUNT_CLAIM_SHEET_CSV_PATH = path.join(ROOT_DIR, "account-claim-sheet.csv");
const PERMISSION_TRACKER_PATH = path.join(ROOT_DIR, "permission-tracker.json");
const PERMISSION_TRACKER_MARKDOWN_PATH = path.join(ROOT_DIR, "permission-tracker.md");
const PERMISSION_STATUS_RECORDS_PATH = path.join(ROOT_DIR, "permission-status-records.json");
const PERMISSION_REQUEST_PACK_PATH = path.join(ROOT_DIR, "permission-request-pack.json");
const PERMISSION_REQUEST_PACK_MARKDOWN_PATH = path.join(ROOT_DIR, "permission-request-pack.md");
const PERMISSION_REQUEST_PACK_CSV_PATH = path.join(ROOT_DIR, "permission-request-pack.csv");
const EXTERNAL_SETUP_QUEUE_PATH = path.join(ROOT_DIR, "external-setup-queue.json");
const EXTERNAL_SETUP_QUEUE_MARKDOWN_PATH = path.join(ROOT_DIR, "external-setup-queue.md");
const EXTERNAL_EXECUTION_HANDOFF_PATH = path.join(ROOT_DIR, "external-execution-handoff.json");
const EXTERNAL_EXECUTION_HANDOFF_MARKDOWN_PATH = path.join(ROOT_DIR, "external-execution-handoff.md");
const EXTERNAL_EXECUTION_HANDOFF_CSV_PATH = path.join(ROOT_DIR, "external-execution-handoff.csv");
const EXTERNAL_EXECUTION_HANDOFF_BATCH_PATH = path.join(ROOT_DIR, "external-execution-evidence-batch.csv");
const EXTERNAL_EXECUTION_SESSION_PATH = path.join(ROOT_DIR, "external-execution-session.json");
const EXTERNAL_EXECUTION_SESSION_MARKDOWN_PATH = path.join(ROOT_DIR, "external-execution-session.md");
const EXTERNAL_EXECUTION_SESSION_CSV_PATH = path.join(ROOT_DIR, "external-execution-session.csv");
const EXTERNAL_EXECUTION_SESSION_EVIDENCE_PATH = path.join(ROOT_DIR, "external-execution-session-evidence-import.csv");
const EXTERNAL_LAUNCH_DOSSIER_PATH = path.join(ROOT_DIR, "external-launch-dossier.json");
const EXTERNAL_LAUNCH_DOSSIER_MARKDOWN_PATH = path.join(ROOT_DIR, "external-launch-dossier.md");
const PLATFORM_PORTAL_CHECKLIST_PATH = path.join(ROOT_DIR, "platform-portal-checklist.json");
const PLATFORM_PORTAL_CHECKLIST_MARKDOWN_PATH = path.join(ROOT_DIR, "platform-portal-checklist.md");
const PLATFORM_PORTAL_CHECKLIST_CSV_PATH = path.join(ROOT_DIR, "platform-portal-checklist.csv");
const GO_LIVE_EXECUTION_PACK_PATH = path.join(ROOT_DIR, "go-live-execution-pack.json");
const GO_LIVE_EXECUTION_PACK_MARKDOWN_PATH = path.join(ROOT_DIR, "go-live-execution-pack.md");
const APP_REVIEW_SUBMISSION_PACK_PATH = path.join(ROOT_DIR, "app-review-submission-pack.json");
const APP_REVIEW_SUBMISSION_PACK_MARKDOWN_PATH = path.join(ROOT_DIR, "app-review-submission-pack.md");
const APP_REVIEW_DEMO_PACK_PATH = path.join(ROOT_DIR, "app-review-demo-pack.json");
const APP_REVIEW_DEMO_PACK_MARKDOWN_PATH = path.join(ROOT_DIR, "app-review-demo-pack.md");
const APP_REVIEW_DEMO_SCRIPT_PATH = path.join(ROOT_DIR, "app-review-demo-script.md");
const DEVELOPER_APPLICATION_DRAFTS_PATH = path.join(ROOT_DIR, "developer-application-drafts.json");
const DEVELOPER_APPLICATION_DRAFTS_MARKDOWN_PATH = path.join(ROOT_DIR, "developer-application-drafts.md");
const OFFICIAL_PERMISSION_MATRIX_PATH = path.join(ROOT_DIR, "official-permission-matrix.json");
const OFFICIAL_PERMISSION_MATRIX_MARKDOWN_PATH = path.join(ROOT_DIR, "official-permission-matrix.md");
const PUBLISHER_CONNECTORS_PATH = path.join(ROOT_DIR, "publisher-connectors.json");
const PUBLISHER_CONNECTORS_MARKDOWN_PATH = path.join(ROOT_DIR, "publisher-connectors.md");
const PRODUCTION_URL_SETUP_PATH = path.join(ROOT_DIR, "production-url-setup.json");
const PRODUCTION_URL_SETUP_MARKDOWN_PATH = path.join(ROOT_DIR, "production-url-setup.md");
const PRODUCTION_URL_VERIFICATION_PATH = path.join(ROOT_DIR, "production-url-verification.json");
const PRODUCTION_URL_VERIFICATION_MARKDOWN_PATH = path.join(ROOT_DIR, "production-url-verification.md");
const HTTPS_TUNNEL_PLAN_PATH = path.join(ROOT_DIR, "https-tunnel-plan.json");
const HTTPS_TUNNEL_PLAN_MARKDOWN_PATH = path.join(ROOT_DIR, "https-tunnel-plan.md");
const LEGAL_POLICY_PACK_PATH = path.join(ROOT_DIR, "legal-policy-pack.json");
const LEGAL_POLICY_PACK_MARKDOWN_PATH = path.join(ROOT_DIR, "legal-policy-pack.md");
const LEGAL_PRIVACY_POLICY_PATH = path.join(ROOT_DIR, "legal-privacy-policy.html");
const LEGAL_TERMS_OF_SERVICE_PATH = path.join(ROOT_DIR, "legal-terms-of-service.html");
const OAUTH_GO_LIVE_PATH = path.join(ROOT_DIR, "oauth-go-live.json");
const OAUTH_GO_LIVE_MARKDOWN_PATH = path.join(ROOT_DIR, "oauth-go-live.md");
const OAUTH_CONNECTION_PACK_PATH = path.join(ROOT_DIR, "oauth-connection-pack.json");
const OAUTH_CONNECTION_PACK_MARKDOWN_PATH = path.join(ROOT_DIR, "oauth-connection-pack.md");
const OAUTH_CONNECTION_PACK_CSV_PATH = path.join(ROOT_DIR, "oauth-connection-pack.csv");
const LAUNCH_COMMAND_CENTER_PATH = path.join(ROOT_DIR, "launch-command-center.json");
const LAUNCH_COMMAND_CENTER_MARKDOWN_PATH = path.join(ROOT_DIR, "launch-command-center.md");
const BLOCKER_RESOLUTION_PACK_PATH = path.join(ROOT_DIR, "blocker-resolution-pack.json");
const BLOCKER_RESOLUTION_PACK_MARKDOWN_PATH = path.join(ROOT_DIR, "blocker-resolution-pack.md");
const BLOCKER_RESOLUTION_PACK_CSV_PATH = path.join(ROOT_DIR, "blocker-resolution-pack.csv");
const GO_LIVE_AUTOPILOT_BRIEF_PATH = path.join(ROOT_DIR, "go-live-autopilot-brief.json");
const GO_LIVE_AUTOPILOT_BRIEF_MARKDOWN_PATH = path.join(ROOT_DIR, "go-live-autopilot-brief.md");
const GO_LIVE_AUTOPILOT_BRIEF_CSV_PATH = path.join(ROOT_DIR, "go-live-autopilot-brief.csv");
const GO_LIVE_AUTOPILOT_RUN_PATH = path.join(ROOT_DIR, "go-live-autopilot-run.json");
const GO_LIVE_AUTOPILOT_RUN_MARKDOWN_PATH = path.join(ROOT_DIR, "go-live-autopilot-run.md");
const CREDENTIAL_SETUP_DIR = path.join(ROOT_DIR, "credential-setup");
const CREDENTIAL_SETUP_README_PATH = path.join(CREDENTIAL_SETUP_DIR, "README.md");
const CREDENTIAL_SETUP_TEMPLATE_PATH = path.join(CREDENTIAL_SETUP_DIR, "clippers-env-template.env");
const CREDENTIAL_SETUP_MISSING_TEMPLATE_PATH = path.join(CREDENTIAL_SETUP_DIR, "missing-env-template.env");
const GOOGLE_DRIVE_CREDENTIAL_TEMPLATE_PATH = path.join(CREDENTIAL_SETUP_DIR, "google-drive-env-template.env");
const CREDENTIAL_DROP_DIR = path.join(process.cwd(), "credentials");
const CREDENTIAL_DROP_README_PATH = path.join(CREDENTIAL_DROP_DIR, "README.md");
const SECRET_DROP_DIR = path.join(process.cwd(), "secrets");
const SECRET_DROP_README_PATH = path.join(SECRET_DROP_DIR, "README.md");
const INTAKE_KIT_DIR = path.join(ROOT_DIR, "intake-kit");
const INTAKE_KIT_TEMPLATE_DIR = path.join(INTAKE_KIT_DIR, "templates");
const INTAKE_KIT_README_PATH = path.join(INTAKE_KIT_DIR, "README.md");
const TOKEN_ENCRYPTION_ENV_VAR = "CLIPPERS_TOKEN_ENCRYPTION_KEY";
const LOCAL_ENV_FILE_CANDIDATES = LOCAL_ENV_FILES;

const CLIPPER_CATEGORY_LABELS: Record<ClipperAccountCategory, string> = {
  sports: "Deportes",
  memes: "Memes",
  streamers: "Streamers",
};

const CLIPPERS_DRIVE_ROOT = ["Clippers"];
const CLIPPERS_DRIVE_FOLDERS: Array<Omit<ClipperDriveFolder, "folderId">> = [
  {
    id: "sources-sports",
    label: "Sources / Deportes",
    path: ["Clippers", "Sources", "Deportes"],
    purpose: "Inbox de videos deportivos propios, licenciados o con permiso para Rights Gate.",
  },
  {
    id: "sources-memes",
    label: "Sources / Memes",
    path: ["Clippers", "Sources", "Memes"],
    purpose: "Inbox de assets y videos para cuentas de memes.",
  },
  {
    id: "sources-streamers",
    label: "Sources / Streamers",
    path: ["Clippers", "Sources", "Streamers"],
    purpose: "Inbox de VODs/clips de streamers con permiso o allowlist.",
  },
  {
    id: "allowlist",
    label: "Allowlist",
    path: ["Clippers", "Allowlist"],
    purpose: "Evidencia de permisos, licencias, creadores aprobados y fuentes oficiales.",
  },
  {
    id: "drafts",
    label: "Drafts",
    path: ["Clippers", "Drafts"],
    purpose: "Clips generados antes de aprobacion/publicacion.",
  },
  {
    id: "scheduled",
    label: "Scheduled",
    path: ["Clippers", "Scheduled"],
    purpose: "Paquetes aprobados listos para calendario y publicacion.",
  },
  {
    id: "reports",
    label: "Reports",
    path: ["Clippers", "Reports"],
    purpose: "Reportes diarios/semanales de views, blockers y recomendaciones.",
  },
  {
    id: "permission-applications",
    label: "Permission Applications",
    path: ["Clippers", "Permission Applications"],
    purpose: "Material para app review, OAuth, redirect URIs y permisos.",
  },
  {
    id: "account-evidence",
    label: "Account Evidence",
    path: ["Clippers", "Account Evidence"],
    purpose: "Screenshots/notes de cuentas reales creadas, verificadas y listas para OAuth.",
  },
  {
    id: "developer-app-evidence",
    label: "Developer App Evidence",
    path: ["Clippers", "Developer App Evidence"],
    purpose: "Evidencia de apps/proyectos TikTok, Meta y Google creados, revisados y listos para permisos.",
  },
  {
    id: "metrics-inbox",
    label: "Metrics Inbox",
    path: ["Clippers", "Metrics Inbox"],
    purpose: "CSV/exports de TikTok, Instagram y YouTube para alimentar el Optimizer.",
  },
];

const PERMISSION_PACK_FILES: Array<Omit<ClipperPermissionPackFile, "path" | "exists"> & { fileName: string }> = [
  {
    id: "readme",
    label: "README permisos",
    fileName: "README.md",
    purpose: "Indice del paquete y orden recomendado para conectar plataformas.",
  },
  {
    id: "account-checklist",
    label: "Checklist de cuentas",
    fileName: "account-creation-checklist.md",
    purpose: "Lista cuenta por cuenta para crear handles, verificar login y conectar OAuth.",
  },
  {
    id: "redirect-uris",
    label: "Redirect URIs",
    fileName: "redirect-uris.json",
    purpose: "URLs exactas que deben registrarse en TikTok, Meta y Google.",
  },
  {
    id: "env-template",
    label: "Template env",
    fileName: "oauth-env-template.env",
    purpose: "Variables necesarias para habilitar OAuth y token vault sin incluir secretos reales.",
  },
  {
    id: "tiktok-review",
    label: "TikTok app review",
    fileName: "tiktok-content-posting-api.md",
    purpose: "Copy y evidencia para solicitar Content Posting API.",
  },
  {
    id: "instagram-review",
    label: "Meta/Instagram app review",
    fileName: "instagram-graph-api.md",
    purpose: "Copy y evidencia para Instagram Graph API y content publishing.",
  },
  {
    id: "youtube-review",
    label: "YouTube OAuth/API review",
    fileName: "youtube-data-api.md",
    purpose: "Copy y evidencia para YouTube upload/OAuth verification.",
  },
];

const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".m4v", ".webm", ".avi", ".mkv"]);

const SOURCE_FOLDERS: ClipperSourceFolder[] = [
  {
    category: "sports",
    label: "Deportes",
    path: path.join(SOURCES_DIR, "sports"),
    status: "ready",
    purpose: "Videos propios, licenciados o oficiales listos para detectar highlights deportivos.",
  },
  {
    category: "memes",
    label: "Memes",
    path: path.join(SOURCES_DIR, "memes"),
    status: "ready",
    purpose: "Assets originales, templates permitidos y clips remix-safe para memes.",
  },
  {
    category: "streamers",
    label: "Streamers",
    path: path.join(SOURCES_DIR, "streamers"),
    status: "ready",
    purpose: "VODs propios, clips con permiso o material de creadores en allowlist.",
  },
  {
    category: "allowlist",
    label: "Allowlist",
    path: path.join(ROOT_DIR, "allowlist"),
    status: "ready",
    purpose: "Evidencia de permiso/licencia por creador, liga, marca o fuente.",
  },
  {
    category: "drafts",
    label: "Drafts",
    path: DRAFTS_DIR,
    status: "ready",
    purpose: "Clips generados antes de aprobacion/publicacion.",
  },
  {
    category: "scheduled",
    label: "Scheduled",
    path: SCHEDULED_DIR,
    status: "ready",
    purpose: "Paquetes listos para publicar cuando haya OAuth y aprobacion.",
  },
  {
    category: "metrics",
    label: "Metrics",
    path: METRICS_DIR,
    status: "ready",
    purpose: "Exports CSV/JSON de views, engagement y retencion para el Optimizer.",
  },
  {
    category: "trends",
    label: "Trends",
    path: TRENDS_DIR,
    status: "ready",
    purpose: "Exports/listas de oportunidades recientes o virales para Trend Radar.",
  },
  {
    category: "sourceHunts",
    label: "Source Hunts",
    path: SOURCE_HUNTS_DIR,
    status: "ready",
    purpose: "Hojas diarias para buscar fuentes, documentar permisos y cubrir slots de produccion.",
  },
  {
    category: "accountEvidence",
    label: "Account Evidence",
    path: ACCOUNT_EVIDENCE_DIR,
    status: "ready",
    purpose: "Evidencia por cuenta/plataforma de que la cuenta externa existe y fue verificada.",
  },
  {
    category: "developerAppEvidence",
    label: "Developer App Evidence",
    path: DEVELOPER_APP_EVIDENCE_DIR,
    status: "ready",
    purpose: "Evidencia por plataforma de apps developer/proyectos cloud y app review.",
  },
];

const GOOGLE_OAUTH_CLIENT_ID_ENV_VARS = [
  "GOOGLE_CLIENT_ID",
  "GOOGLE_OAUTH_CLIENT_ID",
  "GOOGLE_OAUTH2_CLIENT_ID",
  "GOOGLE_WEB_CLIENT_ID",
  "GOOGLE_DRIVE_CLIENT_ID",
  "GOOGLE_DRIVE_OAUTH_CLIENT_ID",
  "GOOGLE_DRIVE_OAUTH2_CLIENT_ID",
  "GOOGLE_DRIVE_WEB_CLIENT_ID",
  "YOUTUBE_CLIENT_ID",
  "YOUTUBE_OAUTH_CLIENT_ID",
  "YOUTUBE_OAUTH2_CLIENT_ID",
  "YOUTUBE_WEB_CLIENT_ID",
];

const GOOGLE_OAUTH_CLIENT_SECRET_ENV_VARS = [
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_OAUTH_CLIENT_SECRET",
  "GOOGLE_OAUTH2_CLIENT_SECRET",
  "GOOGLE_WEB_CLIENT_SECRET",
  "GOOGLE_DRIVE_CLIENT_SECRET",
  "GOOGLE_DRIVE_OAUTH_CLIENT_SECRET",
  "GOOGLE_DRIVE_OAUTH2_CLIENT_SECRET",
  "GOOGLE_DRIVE_WEB_CLIENT_SECRET",
  "YOUTUBE_CLIENT_SECRET",
  "YOUTUBE_OAUTH_CLIENT_SECRET",
  "YOUTUBE_OAUTH2_CLIENT_SECRET",
  "YOUTUBE_WEB_CLIENT_SECRET",
];

const GOOGLE_REFRESH_TOKEN_ENV_VARS = [
  "GOOGLE_DRIVE_REFRESH_TOKEN",
  "GOOGLE_REFRESH_TOKEN",
  "GOOGLE_OAUTH_REFRESH_TOKEN",
  "GOOGLE_OAUTH2_REFRESH_TOKEN",
  "YOUTUBE_REFRESH_TOKEN",
  "YOUTUBE_OAUTH_REFRESH_TOKEN",
  "YOUTUBE_OAUTH2_REFRESH_TOKEN",
];

const CREDENTIAL_ENV_REQUIREMENTS: Array<Pick<ClipperCredentialCheck, "platform" | "label" | "requiredEnvVars" | "acceptedEnvVarGroups" | "nextStep">> = [
  {
    platform: "tiktok",
    label: "TikTok Content Posting API",
    requiredEnvVars: ["TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET"],
    acceptedEnvVarGroups: [["TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_ID"], ["TIKTOK_CLIENT_SECRET"]],
    nextStep: "Crear app en TikTok Developers, pedir Content Posting API y guardar client key/client id + secret.",
  },
  {
    platform: "instagram",
    label: "Meta / Instagram Graph API",
    requiredEnvVars: ["META_APP_ID", "META_APP_SECRET"],
    acceptedEnvVarGroups: [["META_APP_ID", "FACEBOOK_APP_ID"], ["META_APP_SECRET", "FACEBOOK_APP_SECRET"]],
    nextStep: "Crear app en Meta Developers, configurar Instagram Graph API y guardar app id/secret.",
  },
  {
    platform: "youtube",
    label: "YouTube Data API",
    requiredEnvVars: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
    acceptedEnvVarGroups: [GOOGLE_OAUTH_CLIENT_ID_ENV_VARS, GOOGLE_OAUTH_CLIENT_SECRET_ENV_VARS],
    nextStep: "Activar YouTube Data API v3 en Google Cloud y reutilizar/guardar OAuth client id/secret.",
  },
];

const PLATFORM_SCOPES: Record<ClipperPlatform, string[]> = {
  tiktok: ["video.publish", "video.upload"],
  instagram: ["instagram_basic", "instagram_content_publish", "pages_show_list"],
  youtube: ["https://www.googleapis.com/auth/youtube.upload"],
};

const PLATFORM_REQUIREMENTS: ClipperPlatformRequirement[] = [
  {
    platform: "tiktok",
    label: "TikTok",
    developerPortalUrl: "https://developers.tiktok.com/",
    accountCreationUrl: "https://www.tiktok.com/signup",
    requiredAccountType: "Cuenta TikTok por marca + app en TikTok for Developers",
    scopes: ["video.publish", "video.upload"],
    appReview: "Content Posting API con Direct Post habilitado; video.publish requiere aprobacion de scope y autorizacion del usuario.",
    postingMode: "Direct Post para autopost; Upload/InBox si quieres que el usuario termine el post en TikTok.",
    humanRequired: [
      "Crear o iniciar sesion en cada cuenta TikTok.",
      "Verificar email/telefono si TikTok lo pide.",
      "Crear app en TikTok for Developers y pedir Content Posting API.",
      "Completar app review para levantar restricciones de visibilidad.",
    ],
    docs: [
      "https://developers.tiktok.com/doc/content-posting-api-get-started/",
      "https://developers.tiktok.com/doc/content-posting-api-reference-upload-video/",
    ],
  },
  {
    platform: "instagram",
    label: "Instagram Reels",
    developerPortalUrl: "https://developers.facebook.com/",
    accountCreationUrl: "https://www.instagram.com/accounts/emailsignup/",
    requiredAccountType: "Cuenta profesional de Instagram conectada a una Facebook Page",
    scopes: ["instagram_content_publish", "instagram_basic", "pages_show_list"],
    appReview: "Meta app review para publicar contenido y leer cuentas conectadas.",
    postingMode: "Instagram Graph API Content Publishing para Reels en cuentas profesionales elegibles.",
    humanRequired: [
      "Crear o iniciar sesion en cada cuenta Instagram.",
      "Cambiar la cuenta a Professional/Creator/Business si no lo esta.",
      "Conectarla a una Facebook Page.",
      "Crear Meta app y completar App Review para permisos de Instagram.",
    ],
    docs: [
      "https://developers.facebook.com/docs/instagram-platform/",
      "https://developers.facebook.com/docs/permissions/reference/instagram_content_publish/",
    ],
  },
  {
    platform: "youtube",
    label: "YouTube Shorts",
    developerPortalUrl: "https://console.cloud.google.com/apis/library/youtube.googleapis.com",
    accountCreationUrl: "https://www.youtube.com/create_channel",
    requiredAccountType: "Canal de YouTube por marca o cuenta Google autorizada",
    scopes: ["https://www.googleapis.com/auth/youtube.upload"],
    appReview: "Proyectos no verificados pueden quedar limitados; Google puede requerir OAuth verification/API compliance audit.",
    postingMode: "YouTube Data API videos.insert con metadata de Shorts.",
    humanRequired: [
      "Crear o iniciar sesion en cada canal/cuenta Google.",
      "Activar YouTube Data API v3 en Google Cloud.",
      "Configurar OAuth consent screen.",
      "Autorizar cada canal con youtube.upload.",
    ],
    docs: ["https://developers.google.com/youtube/v3/docs/videos/insert"],
  },
];

const PERMISSION_QUEUE: ClipperPermissionRequest[] = PLATFORM_REQUIREMENTS.flatMap((platform) =>
  platform.scopes.map((scope) => ({
    id: `${platform.platform}-${scope.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`,
    platform: platform.platform,
    scope,
    label: `${platform.label}: ${scope}`,
    status: "missing",
    reason: `Necesario para publicar o preparar clips en ${platform.label}.`,
    evidenceRequired: "Token OAuth valido, app review aprobada cuando aplique, y cuenta destino autorizada.",
    docsUrl: platform.docs[0],
  }))
);

const OFFICIAL_PERMISSION_MATRIX_ITEMS: ClipperOfficialPermissionMatrixItem[] = [
  {
    platform: "tiktok",
    label: "TikTok Content Posting API",
    sourceStatus: "official_verified",
    officialDocs: [
      "https://developers.tiktok.com/doc/content-posting-api-get-started/",
      "https://developers.tiktok.com/doc/tiktok-api-scopes/",
    ],
    scopes: [
      {
        scope: "video.publish",
        purpose: "Publicar contenido directamente en el perfil TikTok del usuario autorizado.",
        requiredForAutopost: true,
        appReviewRequired: true,
        officialReferenceUrl: "https://developers.tiktok.com/doc/content-posting-api-get-started/",
        verificationStatus: "official_verified",
        verifiedAt: "2026-06-17",
        verificationNote: "TikTok official docs state Direct Post needs Content Posting API, Direct Post config, video.publish approval, user authorization and audit before public visibility restrictions are lifted.",
        requestPortalUrl: "https://developers.tiktok.com/",
        requestAction: "En TikTok for Developers, agregar Content Posting API, habilitar Direct Post y solicitar aprobacion de video.publish.",
        verificationChecklist: [
          "Confirm Content Posting API appears under the TikTok developer app products.",
          "Confirm Direct Post is configured and video.publish is requested or approved.",
          "Confirm reviewer/audit status and any visibility restriction before public autopost.",
        ],
        evidenceRequired: [
          "Screenshot de Content Posting API agregado al app.",
          "Screenshot o nota de app review/scope approval para video.publish.",
          "Screencast del flujo approval_required antes de publicar.",
        ],
        launchEvidenceBatchRow: "permission,,tiktok,requested,video.publish,,,TikTok Content Posting API requested; attach app review evidence",
      },
      {
        scope: "video.upload",
        purpose: "Compartir/subir contenido como draft para que el creador termine la publicacion en TikTok.",
        requiredForAutopost: false,
        appReviewRequired: true,
        officialReferenceUrl: "https://developers.tiktok.com/doc/content-posting-api-get-started/",
        verificationStatus: "official_verified",
        verifiedAt: "2026-06-17",
        verificationNote: "TikTok Content Posting API has Upload/Draft flow separate from Direct Post; keep as fallback until direct public posting is fully reviewed.",
        requestPortalUrl: "https://developers.tiktok.com/",
        requestAction: "En TikTok for Developers, solicitar video.upload para Upload/Draft posting como fallback seguro.",
        verificationChecklist: [
          "Confirm video.upload is available for the app in TikTok for Developers.",
          "Confirm the Upload/Draft flow is allowed for the authorized account.",
          "Capture the approval/request screen and note whether this is fallback-only.",
        ],
        evidenceRequired: [
          "Screenshot del scope video.upload solicitado o aprobado.",
          "Notas de uso: fallback cuando Direct Post no este aprobado.",
          "Evidencia de que la cuenta destino autorizo el scope.",
        ],
        launchEvidenceBatchRow: "permission,,tiktok,requested,video.upload,,,TikTok video.upload requested as draft/fallback flow",
      },
    ],
    accountPrerequisites: [
      "Cuenta TikTok real por marca/categoria.",
      "Usuario destino debe autorizar la app con los scopes requeridos.",
      "Contenido debe cumplir restricciones de formato y derechos.",
    ],
    developerPrerequisites: [
      "App registrada en TikTok for Developers.",
      "Content Posting API agregado al app.",
      "Direct Post configuration habilitada para autopost.",
      "Client key/secret configurados en env vars.",
    ],
    reviewRisks: [
      "Clientes no auditados pueden quedar restringidos a private viewing mode.",
      "TikTok puede pedir audit/compliance antes de levantar restricciones de visibilidad.",
      "Contenido sin derechos o con señales de reposting puede generar rechazo o strikes.",
    ],
    evidenceToPrepare: [
      "Screenshots de app, redirect URI y Content Posting API habilitado.",
      "Video demo del flujo approval_required.",
      "Politica de derechos/fuentes y moderacion.",
      "Ejemplos de clips propios, licenciados o permissioned.",
    ],
    apiEndpointHint: "POST https://open.tiktokapis.com/v2/post/publish/video/init/",
    nextStep: "Crear app TikTok, pedir Content Posting API y solicitar video.publish/video.upload.",
  },
  {
    platform: "instagram",
    label: "Instagram Graph API Content Publishing",
    sourceStatus: "official_login_required",
    officialDocs: [
      "https://developers.facebook.com/docs/instagram-platform/content-publishing/",
      "https://developers.facebook.com/docs/permissions/reference/instagram_content_publish/",
      "https://developers.facebook.com/docs/instagram-platform/",
    ],
    scopes: [
      {
        scope: "instagram_content_publish",
        purpose: "Publicar media/Reels en cuentas profesionales elegibles via Instagram Graph API.",
        requiredForAutopost: true,
        appReviewRequired: true,
        officialReferenceUrl: "https://developers.facebook.com/docs/instagram-platform/content-publishing/",
        verificationStatus: "official_login_required",
        verifiedAt: "2026-06-17",
        verificationNote: "Meta official docs endpoint currently requires authenticated developer login; confirm in Meta session before submission.",
        requestPortalUrl: "https://developers.facebook.com/",
        requestAction: "En Meta App Review, solicitar instagram_content_publish con screencast de Reels approval_required.",
        verificationChecklist: [
          "Log in to Meta Developers and confirm instagram_content_publish is selectable for the app.",
          "Confirm the Instagram account is Professional/Creator/Business and connected to a Facebook Page.",
          "Confirm App Review asks for screencast/evidence and save the real review URL or screenshot path.",
        ],
        evidenceRequired: [
          "Screenshot de Meta App Review con instagram_content_publish solicitado/aprobado.",
          "Screencast del flujo de publicacion y revision manual.",
          "Prueba de cuenta Instagram profesional conectada a Facebook Page.",
        ],
        launchEvidenceBatchRow: "permission,,instagram,requested,instagram_content_publish,,,Meta App Review requested; attach screencast and professional account evidence",
      },
      {
        scope: "instagram_basic",
        purpose: "Leer datos basicos de la cuenta Instagram conectada para identificar el destino correcto.",
        requiredForAutopost: true,
        appReviewRequired: true,
        officialReferenceUrl: "https://developers.facebook.com/docs/permissions/reference/instagram_basic/",
        verificationStatus: "official_login_required",
        verifiedAt: "2026-06-17",
        verificationNote: "Meta permission reference requires developer login for full details; use only after authenticated review confirms availability.",
        requestPortalUrl: "https://developers.facebook.com/",
        requestAction: "En Meta App Review, solicitar instagram_basic para identificar cuentas IG conectadas.",
        verificationChecklist: [
          "Log in to Meta Developers and confirm instagram_basic is available for the selected app type/product.",
          "Confirm the permission is needed to identify the authorized Instagram account.",
          "Save the real App Review screen or permission reference screenshot as evidence.",
        ],
        evidenceRequired: [
          "Screenshot del permiso instagram_basic solicitado/aprobado.",
          "Explicacion de por que se necesita identificar la cuenta destino.",
          "Screencast mostrando seleccion de cuenta sin exponer datos sensibles.",
        ],
        launchEvidenceBatchRow: "permission,,instagram,requested,instagram_basic,,,Meta App Review requested; needed to identify connected Instagram account",
      },
      {
        scope: "pages_show_list",
        purpose: "Listar Facebook Pages conectadas para resolver la cuenta profesional de Instagram.",
        requiredForAutopost: true,
        appReviewRequired: true,
        officialReferenceUrl: "https://developers.facebook.com/docs/permissions/reference/pages_show_list/",
        verificationStatus: "official_login_required",
        verifiedAt: "2026-06-17",
        verificationNote: "Meta permission reference requires developer login for full details; validate Page/IG connection in Meta App Review.",
        requestPortalUrl: "https://developers.facebook.com/",
        requestAction: "En Meta App Review, solicitar pages_show_list para resolver la Page conectada al IG profesional.",
        verificationChecklist: [
          "Log in to Meta Developers and confirm pages_show_list is available for the app review submission.",
          "Confirm the Facebook Page is connected to the Instagram professional account.",
          "Capture Page admin/access proof and the permission request/review screen.",
        ],
        evidenceRequired: [
          "Screenshot del permiso pages_show_list solicitado/aprobado.",
          "Prueba de Page conectada a Instagram profesional.",
          "Screencast del flujo resolviendo la Page/IG destino.",
        ],
        launchEvidenceBatchRow: "permission,,instagram,requested,pages_show_list,,,Meta App Review requested; needed to resolve connected Facebook Page",
      },
    ],
    accountPrerequisites: [
      "Cuenta Instagram profesional por marca/categoria.",
      "Cuenta conectada a una Facebook Page.",
      "Usuario Meta autorizado con acceso a la Page/cuenta IG.",
    ],
    developerPrerequisites: [
      "Meta app creada en developers.facebook.com.",
      "Instagram product/API configurado.",
      "OAuth redirect URI registrado.",
      "App Review completada para permisos de publishing.",
    ],
    reviewRisks: [
      "Docs oficiales de permisos pueden requerir login de Meta para ver detalles completos.",
      "Cuentas no profesionales o sin Page conectada no sirven para publishing API.",
      "Meta puede rechazar apps sin screencast claro, caso de uso legitimo y politica de contenido.",
    ],
    evidenceToPrepare: [
      "Screenshot de cuenta profesional y Page conectada.",
      "Screencast del flujo de publicacion con approval_required.",
      "Politica de derechos, fuentes y remocion de contenido.",
      "Descripcion del caso de uso por cuenta: deportes, memes, streamers.",
    ],
    apiEndpointHint: "Instagram Graph API media container + media_publish flow.",
    nextStep: "Crear Meta app, conectar Page/IG profesional y solicitar instagram_content_publish.",
  },
  {
    platform: "youtube",
    label: "YouTube Data API videos.insert",
    sourceStatus: "official_verified",
    officialDocs: [
      "https://developers.google.com/youtube/v3/docs/videos/insert",
      "https://developers.google.com/youtube/v3/guides/authentication",
    ],
    scopes: [
      {
        scope: "https://www.googleapis.com/auth/youtube.upload",
        purpose: "Subir videos al canal YouTube autorizado usando videos.insert.",
        requiredForAutopost: true,
        appReviewRequired: true,
        officialReferenceUrl: "https://developers.google.com/youtube/v3/docs/videos/insert",
        verificationStatus: "official_verified",
        verifiedAt: "2026-06-17",
        verificationNote: "YouTube official videos.insert docs require OAuth authorization; Google OAuth scope docs list youtube.upload for uploading YouTube videos.",
        requestPortalUrl: "https://console.cloud.google.com/apis/library/youtube.googleapis.com",
        requestAction: "Activar YouTube Data API v3, configurar OAuth consent y autorizar el scope youtube.upload por canal.",
        verificationChecklist: [
          "Confirm YouTube Data API v3 is enabled in the target Google Cloud project.",
          "Confirm OAuth consent/client includes the redirect URI and youtube.upload scope.",
          "Confirm whether OAuth verification or API compliance audit is required before public uploads.",
        ],
        evidenceRequired: [
          "Screenshot de YouTube Data API v3 activa.",
          "Screenshot de OAuth consent/client configurados con redirect URI correcta.",
          "Evidencia de OAuth autorizado por cada canal.",
        ],
        launchEvidenceBatchRow: "permission,,youtube,requested,https://www.googleapis.com/auth/youtube.upload,,,Google OAuth consent configured; youtube.upload requested/authorized",
      },
    ],
    accountPrerequisites: [
      "Canal de YouTube real por marca/categoria.",
      "Canal autorizado por OAuth.",
      "Videos verticales/Shorts con metadata y derechos claros.",
    ],
    developerPrerequisites: [
      "Proyecto Google Cloud con YouTube Data API v3 activada.",
      "OAuth consent screen configurado.",
      "OAuth client id/secret configurados en env vars.",
      "Scope youtube.upload autorizado por cada canal.",
    ],
    reviewRisks: [
      "Proyectos API no verificados creados despues de 2020 pueden restringir uploads a private viewing mode.",
      "Google puede requerir OAuth verification/API compliance audit.",
      "Quota de uploads puede limitar volumen si el proyecto no esta aprobado.",
    ],
    evidenceToPrepare: [
      "Screenshot de YouTube Data API activa.",
      "OAuth consent screen y client configurados.",
      "Screencast del flujo approval_required.",
      "Politica de derechos/fuentes y ejemplos de contenido autorizado.",
    ],
    apiEndpointHint: "POST https://www.googleapis.com/upload/youtube/v3/videos",
    nextStep: "Activar YouTube Data API, preparar OAuth consent y autorizar youtube.upload.",
  },
];

const PUBLISHER_CONNECTOR_DEFINITIONS: Array<Omit<ClipperPublisherConnectorItem, "status" | "tokenSaved" | "permissionsApproved" | "permissionsTotal" | "publishableQueueItems" | "publishGate" | "blockingCategories" | "proofNeeded" | "goLiveChecks" | "blockers" | "nextStep">> = [
  {
    platform: "tiktok",
    label: "TikTok Direct Post",
    endpoint: "https://open.tiktokapis.com/v2/post/publish/video/init/",
    method: "POST",
    mode: "direct_post",
    requiredScopes: ["video.publish"],
    payloadFields: [
      "Authorization: Bearer <access_token>",
      "post_info.title",
      "post_info.privacy_level",
      "post_info.disable_duet/comment/stitch",
      "source_info.source",
      "source_info.video_url or upload chunk metadata",
    ],
    preflightChecks: [
      "Content Posting API approved.",
      "Direct Post enabled.",
      "Creator info queried before publishing.",
      "Source video exists and rights evidence is saved.",
      "Publish mode is approval_required until first QA pass.",
    ],
  },
  {
    platform: "instagram",
    label: "Instagram Reels Content Publishing",
    endpoint: "https://graph.facebook.com/{version}/{ig-user-id}/media_publish",
    method: "POST",
    mode: "media_publish",
    requiredScopes: ["instagram_content_publish", "instagram_basic", "pages_show_list"],
    payloadFields: [
      "access_token",
      "ig-user-id",
      "creation_id from media container",
      "video_url or uploaded media container",
      "caption",
      "share_to_feed/reel metadata when supported",
    ],
    preflightChecks: [
      "Instagram account is Professional/Creator/Business.",
      "Instagram account is connected to a Facebook Page.",
      "Media container created successfully before publish.",
      "Source video URL is reachable by Meta if URL publishing is used.",
      "Rights evidence is saved for the clip.",
    ],
  },
  {
    platform: "youtube",
    label: "YouTube Shorts videos.insert",
    endpoint: "https://www.googleapis.com/upload/youtube/v3/videos",
    method: "POST",
    mode: "video_insert",
    requiredScopes: ["https://www.googleapis.com/auth/youtube.upload"],
    payloadFields: [
      "Authorization: Bearer <access_token>",
      "part=snippet,status",
      "snippet.title",
      "snippet.description",
      "snippet.tags",
      "status.privacyStatus",
      "video media body",
    ],
    preflightChecks: [
      "YouTube Data API v3 enabled.",
      "OAuth consent screen reviewed if required.",
      "Channel authorized with youtube.upload.",
      "Shorts metadata/description prepared.",
      "Rights evidence is saved for the clip.",
    ],
  },
];

const defaultPlatformAccounts = (slug: string, displayName: string): ClipperPlatformAccount[] => [
  {
    platform: "tiktok",
    handle: `@${slug}`,
    displayName,
    status: "not_created",
    requiredScopes: ["video.publish", "video.upload"],
    missingSteps: ["Crear cuenta", "Conectar OAuth", "Aprobar Content Posting API", "Autorizar video.publish/video.upload"],
    notes: "Preparado en la app; requiere accion humana en TikTok.",
  },
  {
    platform: "instagram",
    handle: `@${slug}`,
    displayName,
    status: "not_created",
    requiredScopes: ["instagram_content_publish", "instagram_basic", "pages_show_list"],
    missingSteps: ["Crear cuenta profesional", "Conectar Facebook Page", "Conectar OAuth Meta", "Aprobar permisos"],
    notes: "Preparado en la app; requiere login y Page conectada.",
  },
  {
    platform: "youtube",
    handle: `@${slug}`,
    displayName,
    status: "not_created",
    requiredScopes: ["https://www.googleapis.com/auth/youtube.upload"],
    missingSteps: ["Crear canal", "Activar YouTube Data API", "Conectar OAuth", "Autorizar youtube.upload"],
    notes: "Preparado en la app; requiere canal Google/YouTube real.",
  },
];

const DEFAULT_ACCOUNTS: ClipperAccount[] = [
  {
    id: "sports-daily",
    name: "Sports Daily Clips",
    category: "sports",
    platforms: ["TikTok", "Instagram Reels", "YouTube Shorts"],
    platformAccounts: defaultPlatformAccounts("sportsdailyclips", "Sports Daily Clips"),
    dailyClipTarget: 10,
    weeklyViewsGoal: 1_000_000,
    lastWeekViews: 286_000,
    status: "needs_connection",
    contentPolicy: "Use official highlights, licensed footage, owned commentary, or creator-approved clips.",
  },
  {
    id: "meme-radar",
    name: "Meme Radar",
    category: "memes",
    platforms: ["TikTok", "Instagram Reels"],
    platformAccounts: defaultPlatformAccounts("memeradarclips", "Meme Radar"),
    dailyClipTarget: 12,
    weeklyViewsGoal: 1_000_000,
    lastWeekViews: 412_000,
    status: "needs_connection",
    contentPolicy: "Use original edits, permissioned templates, public-domain media, or remix-safe assets.",
  },
  {
    id: "streamer-pulse",
    name: "Streamer Pulse",
    category: "streamers",
    platforms: ["TikTok", "YouTube Shorts", "Instagram Reels"],
    platformAccounts: defaultPlatformAccounts("streamerpulseclips", "Streamer Pulse"),
    dailyClipTarget: 8,
    weeklyViewsGoal: 1_000_000,
    lastWeekViews: 198_000,
    status: "needs_connection",
    contentPolicy: "Use creator allowlists, owned VODs, or explicit clip permission before publishing.",
  },
];

const DEFAULT_SOURCES: ClipperSource[] = [
  {
    id: "owned-dropbox",
    label: "Carpeta local de videos propios",
    type: "owned_folder",
    freshness: "cada hora",
    rightsMode: "owned",
    status: "planned",
  },
  {
    id: "platform-trends",
    label: "Tendencias por APIs oficiales",
    type: "official_api",
    freshness: "reciente/viral",
    rightsMode: "review_required",
    status: "needs_setup",
  },
  {
    id: "creator-whitelist",
    label: "Allowlist de creadores/streamers",
    type: "creator_allowlist",
    freshness: "diario",
    rightsMode: "permissioned",
    status: "planned",
  },
  {
    id: "manual-drop",
    label: "Drop manual urgente",
    type: "manual_drop",
    freshness: "on demand",
    rightsMode: "review_required",
    status: "connected",
  },
];

const DEFAULT_AGENTS: ClipperSubAgent[] = [
  {
    id: "trend-scout",
    name: "Trend Scout",
    job: "Detecta temas con momentum por categoria y plataforma.",
    status: "active",
    output: "Prioriza recencia, velocidad de comentarios y angulo repetible.",
  },
  {
    id: "rights-gate",
    name: "Rights Gate",
    job: "Bloquea fuentes sin permiso claro antes de editar o publicar.",
    status: "review_required",
    output: "Todo clip externo queda en revision hasta tener permiso/licencia/fuente oficial.",
  },
  {
    id: "clip-factory",
    name: "Clip Factory",
    job: "Convierte ideas en drafts verticales con hook, caption y CTA.",
    status: "waiting",
    output: "Listo para conectarse al editor local y carpetas de assets.",
  },
  {
    id: "publisher",
    name: "Publisher",
    job: "Programa posts por cuenta cuando la plataforma esta conectada.",
    status: "waiting",
    output: "Publicacion real requiere credenciales y permisos oficiales por plataforma.",
  },
  {
    id: "account-ops",
    name: "Account Ops",
    job: "Crea/verifica cuentas reales y guarda evidencia por handle, plataforma y categoria.",
    status: "review_required",
    output: "No marca una cuenta como lista hasta tener evidencia de login/handle/verificacion.",
  },
  {
    id: "permission-ops",
    name: "Permission Ops",
    job: "Prepara apps developer, permisos oficiales, app review y OAuth por plataforma.",
    status: "review_required",
    output: "Mantiene scopes, redirect URIs, privacy, terms, demo y evidencia de portal alineados.",
  },
  {
    id: "platform-ops",
    name: "Platform Ops",
    job: "Mantiene PUBLIC_BASE_URL HTTPS, tunnel/deploy, callbacks y checks de go-live.",
    status: "review_required",
    output: "No deja registrar redirect URIs hasta que la URL publica HTTPS pase los endpoint checks.",
  },
  {
    id: "optimizer",
    name: "Optimizer",
    job: "Lee views, retencion y shares para ajustar hooks, horarios y formatos.",
    status: "active",
    output: "Sube frecuencia en cuentas con mejor ratio views/clip y pausa formatos flojos.",
  },
];

async function ensureClipperDirs() {
  await Promise.all([
    mkdir(ROOT_DIR, { recursive: true }),
    mkdir(CREDENTIAL_DROP_DIR, { recursive: true }),
    mkdir(SECRET_DROP_DIR, { recursive: true }),
    mkdir(REPORTS_DIR, { recursive: true }),
    mkdir(METRICS_DIR, { recursive: true }),
    mkdir(TRENDS_DIR, { recursive: true }),
    mkdir(RENDERED_DIR, { recursive: true }),
    mkdir(SOURCE_HUNTS_DIR, { recursive: true }),
    mkdir(path.join(SOURCE_DROP_DIR, "sports"), { recursive: true }),
    mkdir(path.join(SOURCE_DROP_DIR, "memes"), { recursive: true }),
    mkdir(path.join(SOURCE_DROP_DIR, "streamers"), { recursive: true }),
    mkdir(PERMISSION_PACK_DIR, { recursive: true }),
    mkdir(CREDENTIAL_SETUP_DIR, { recursive: true }),
    mkdir(INTAKE_KIT_TEMPLATE_DIR, { recursive: true }),
    mkdir(ACCOUNT_EVIDENCE_TEMPLATE_DIR, { recursive: true }),
    mkdir(DEVELOPER_APP_EVIDENCE_TEMPLATE_DIR, { recursive: true }),
    mkdir(LAUNCH_EVIDENCE_DROP_DIR, { recursive: true }),
    ...SOURCE_FOLDERS.map((folder) => mkdir(folder.path, { recursive: true })),
  ]);
  await writeCredentialDropReadme(CREDENTIAL_DROP_README_PATH, "credentials");
  await writeCredentialDropReadme(SECRET_DROP_README_PATH, "secrets");
  await writeLaunchEvidenceDropReadme();
  await writeSourceDropReadme();
}

async function writeSourceDropReadme() {
  await writeFile(SOURCE_DROP_README_PATH, [
    "# Clippers Source Drop",
    "",
    "Coloca aqui videos reales para importarlos a las carpetas de fuentes por categoria.",
    "",
    "Subcarpetas:",
    "",
    "- sports/",
    "- memes/",
    "- streamers/",
    "",
    "El importador copia archivos de video a `sources/{category}` y los deja en `review_required` hasta que exista evidencia en allowlist.",
    "Formatos soportados: mp4, mov, m4v, webm, avi, mkv.",
    "",
    "No coloques material sin permiso si no vas a registrar evidencia antes de producir/publicar.",
    "",
  ].join("\n"));
}

async function writeLaunchEvidenceDropReadme() {
  await writeFile(LAUNCH_EVIDENCE_DROP_README_PATH, [
    "# Clippers Launch Evidence Drop",
    "",
    "Coloca aqui CSV/JSON exportados de ejecucion externa para importar evidencia de cuentas, developer apps, permisos y derechos.",
    "",
    "Archivo recomendado:",
    "",
    "- `launch-evidence-template.csv`: template exacto para las cuentas, apps y permisos configurados. Reemplaza los placeholders con evidencia real antes de importar.",
    "",
    "Formatos soportados:",
    "",
    "- `.csv` con columnas: kind, account_id, platform, status, scope, app_identifier, public_base_url, notes",
    "- `.json` con array de records o `{ \"records\": [...] }`",
    "- `.txt` con CSV equivalente",
    "",
    "No pegues client secrets, access tokens, passwords ni datos sensibles. Usa links/notas de evidencia operativa.",
    "",
  ].join("\n"));
}

function buildLaunchEvidenceDropChecklist(): string[] {
  return [
    "Crear/verificar la cuenta externa antes de usar rows kind=account.",
    "Guardar app id/client key/project id y URL publica HTTPS antes de usar rows kind=developer_app.",
    "Solicitar o aprobar scopes en el developer portal antes de usar rows kind=permission.",
    "Reemplazar todos los placeholders <...> con links/notas reales; el importer los rechaza si siguen como template.",
    "No incluir passwords, client secrets, access tokens ni recovery codes en evidence-drop.",
  ];
}

function buildLaunchEvidenceTemplateRows(accounts: ClipperAccount[]): string[][] {
  const accountRows = accounts.flatMap((account) =>
    account.platformAccounts.map((platformAccount) => [
      "account",
      account.id,
      platformAccount.platform,
      "verified",
      "",
      "",
      "",
      `<profile URL + screenshot/proof note for ${platformAccount.handle}>`,
    ])
  );
  const developerRows = PLATFORM_REQUIREMENTS.map((requirement) => [
    "developer_app",
    "",
    requirement.platform,
    "submitted",
    "",
    `<real ${requirement.platform} app id/client key/project id>`,
    "<public HTTPS base URL>",
    `<developer portal screenshot/review ticket for ${requirement.label}>`,
  ]);
  const permissionRows = PERMISSION_QUEUE.map((permission) => [
    "permission",
    "",
    permission.platform,
    "requested",
    permission.scope,
    "",
    "",
    `<permission request/review evidence for ${permission.label}>`,
  ]);
  return [...accountRows, ...developerRows, ...permissionRows];
}

function renderLaunchEvidenceTemplateCsv(accounts: ClipperAccount[]): string {
  const header = ["kind", "account_id", "platform", "status", "scope", "app_identifier", "public_base_url", "notes"];
  const rows = buildLaunchEvidenceTemplateRows(accounts);
  return [header, ...rows].map((row) => row.map(csvEscape).join(",")).join("\n") + "\n";
}

async function writeCredentialDropReadme(readmePath: string, folderName: "credentials" | "secrets") {
  await writeFile(readmePath, [
    `# ${folderName}`,
    "",
    "Esta carpeta es para drop-in local de credenciales OAuth o archivos .env que Clippers puede detectar por nombre.",
    "",
    "Reglas:",
    "",
    "- No pegues valores secretos en chat.",
    "- No commits de credenciales reales; .gitignore ignora todo aqui excepto este README.",
    "- Puedes poner archivos como `client_secret_google.json`, `google-oauth-client.json` o `.env.clippers.local`.",
    "- Luego abre Clippers > Credential Setup y usa Preview/Save batch para importar de forma controlada.",
    "- El scanner solo muestra nombres/rutas de candidatos; no lee ni imprime valores.",
    "",
  ].join("\n"));
}

function hashOAuthCode(code: string): string {
  return createHash("sha256").update(code).digest("hex").slice(0, 16);
}

function hashId(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

async function readOAuthConnections(): Promise<ClipperOAuthConnection[]> {
  try {
    const raw = await readFile(OAUTH_STATE_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed as ClipperOAuthConnection[] : [];
  } catch {
    return [];
  }
}

async function writeOAuthConnections(connections: ClipperOAuthConnection[]) {
  await ensureClipperDirs();
  await writeFile(OAUTH_STATE_PATH, JSON.stringify(connections, null, 2));
}

function getTokenVaultSecret(): string | null {
  const secret = process.env[TOKEN_ENCRYPTION_ENV_VAR];
  return secret && secret.length >= 32 ? secret : null;
}

function getFirstEnvValue(names: string[]): string {
  return names.map((name) => process.env[name]).find((value): value is string => Boolean(value)) || "";
}

function getTikTokClientKey(): string {
  return getFirstEnvValue(["TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_ID"]);
}

function getTikTokClientSecret(): string {
  return getFirstEnvValue(["TIKTOK_CLIENT_SECRET"]);
}

function getMetaAppId(): string {
  return getFirstEnvValue(["META_APP_ID", "FACEBOOK_APP_ID"]);
}

function getMetaAppSecret(): string {
  return getFirstEnvValue(["META_APP_SECRET", "FACEBOOK_APP_SECRET"]);
}

function getFirstConfiguredEnvName(names: string[]): string | null {
  return names.find((name) => Boolean(process.env[name])) || null;
}

function encryptTokenPayload(payload: unknown): ClipperEncryptedPayload {
  const secret = getTokenVaultSecret();
  if (!secret) {
    throw new Error(`${TOKEN_ENCRYPTION_ENV_VAR} debe tener al menos 32 caracteres para guardar tokens.`);
  }

  const key = createHash("sha256").update(secret).digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(payload), "utf8"),
    cipher.final(),
  ]);

  return {
    algorithm: "aes-256-gcm",
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    data: encrypted.toString("base64"),
  };
}

async function readTokenVaultRecords(): Promise<ClipperTokenVaultRecord[]> {
  try {
    const raw = await readFile(TOKEN_VAULT_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed as ClipperTokenVaultRecord[] : [];
  } catch {
    return [];
  }
}

async function writeTokenVaultRecords(records: ClipperTokenVaultRecord[]) {
  await ensureClipperDirs();
  await writeFile(TOKEN_VAULT_PATH, JSON.stringify(records, null, 2));
}

function toDateAfterSeconds(seconds: unknown): string | null {
  const value = Number(seconds);
  if (!Number.isFinite(value) || value <= 0) return null;
  return new Date(Date.now() + value * 1000).toISOString();
}

function splitScopes(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  if (typeof value !== "string") return [];
  return value.split(/[,\s]+/).map((item) => item.trim()).filter(Boolean);
}

function extractTokenSummary(platform: ClipperPlatform, payload: Record<string, unknown>, accountId?: string | null): Omit<ClipperTokenVaultRecord, "encryptedPayload"> {
  const subject = payload.open_id || payload.user_id || payload.id || payload.sub || null;
  return {
    platform,
    accountId: accountId || null,
    status: "saved",
    savedAt: new Date().toISOString(),
    scopes: splitScopes(payload.scope || payload.scopes || payload.granted_scopes).length
      ? splitScopes(payload.scope || payload.scopes || payload.granted_scopes)
      : PLATFORM_SCOPES[platform],
    tokenType: typeof payload.token_type === "string" ? payload.token_type : null,
    expiresAt: toDateAfterSeconds(payload.expires_in),
    refreshExpiresAt: toDateAfterSeconds(payload.refresh_expires_in),
    subjectHash: typeof subject === "string" && subject ? hashOAuthCode(subject) : null,
  };
}

export async function saveClipperTokenPayload(platform: ClipperPlatform, payload: Record<string, unknown>, accountId?: string | null): Promise<ClipperTokenSummary> {
  const summary = extractTokenSummary(platform, payload, accountId);
  const record: ClipperTokenVaultRecord = {
    ...summary,
    encryptedPayload: encryptTokenPayload(payload),
  };
  const previous = await readTokenVaultRecords();
  const next = [
    record,
    ...previous.filter((item) => !(item.platform === platform && (item.accountId || null) === (summary.accountId || null))),
  ].slice(0, 24);
  await writeTokenVaultRecords(next);
  return summary;
}

async function buildTokenVaultSummary(): Promise<ClipperTokenVaultSummary> {
  const records = await readTokenVaultRecords();
  const configured = Boolean(getTokenVaultSecret());
  const summaries = records.map(({ encryptedPayload: _encryptedPayload, ...summary }) => summary);
  const status: ClipperTokenVaultStatus = records.length > 0
    ? configured ? "tokens_saved" : "locked"
    : configured ? "ready" : "missing_key";
  return {
    status,
    envVar: TOKEN_ENCRYPTION_ENV_VAR,
    configured,
    vaultPath: TOKEN_VAULT_PATH,
    records: summaries,
    nextStep: configured
      ? records.length
        ? "Tokens cifrados guardados; falta validar app review y activar publicacion por cuenta."
        : "Listo para guardar tokens cuando cada plataforma complete OAuth."
      : `Agrega ${TOKEN_ENCRYPTION_ENV_VAR} con al menos 32 caracteres antes de guardar tokens reales.`,
  };
}

function hasGoogleDriveKeys(): boolean {
  return Boolean(
    getFirstEnvValue(GOOGLE_OAUTH_CLIENT_ID_ENV_VARS) &&
    getFirstEnvValue(GOOGLE_OAUTH_CLIENT_SECRET_ENV_VARS)
  );
}

function hasGoogleDriveRefreshToken(): boolean {
  return Boolean(getFirstEnvValue(GOOGLE_REFRESH_TOKEN_ENV_VARS));
}

function getGoogleOAuthClientId(): string {
  return getFirstEnvValue(GOOGLE_OAUTH_CLIENT_ID_ENV_VARS);
}

function getGoogleOAuthClientSecret(): string {
  return getFirstEnvValue(GOOGLE_OAUTH_CLIENT_SECRET_ENV_VARS);
}

async function envFilesWithAcceptedAliases(aliasGroups: string[][]): Promise<Array<{ fileName: string; aliases: string[] }>> {
  const acceptedAliases = new Set(aliasGroups.flat());
  const matches: Array<{ fileName: string; aliases: string[] }> = [];
  for (const fileName of LOCAL_ENV_FILE_CANDIDATES) {
    const filePath = path.join(process.cwd(), fileName);
    const exists = await stat(filePath).then((file) => file.isFile()).catch(() => false);
    if (!exists) continue;
    const raw = await readFile(filePath, "utf8").catch(() => "");
    const aliases = parseEnvKeyNames(raw).filter((envVar) => acceptedAliases.has(envVar));
    if (aliases.length) matches.push({ fileName, aliases: Array.from(new Set(aliases)).sort() });
  }
  return matches;
}

async function buildGoogleDriveEnvDiagnostics(): Promise<ClipperDriveEnvDiagnostics> {
  const envFilesFound = await existingLocalEnvFiles();
  const envFilesWithAliases = await envFilesWithAcceptedAliases([
    GOOGLE_OAUTH_CLIENT_ID_ENV_VARS,
    GOOGLE_OAUTH_CLIENT_SECRET_ENV_VARS,
    GOOGLE_REFRESH_TOKEN_ENV_VARS,
  ]);
  const detectedAcceptedAliasesInFiles = Array.from(new Set(envFilesWithAliases.flatMap((file) => file.aliases))).sort();
  const configuredClientIdAliases = GOOGLE_OAUTH_CLIENT_ID_ENV_VARS.filter((envVar) => Boolean(process.env[envVar]));
  const configuredClientSecretAliases = GOOGLE_OAUTH_CLIENT_SECRET_ENV_VARS.filter((envVar) => Boolean(process.env[envVar]));
  const configuredRefreshTokenAliases = GOOGLE_REFRESH_TOKEN_ENV_VARS.filter((envVar) => Boolean(process.env[envVar]));
  const runtimeMissingGroups = [
    configuredClientIdAliases.length === 0 ? GOOGLE_OAUTH_CLIENT_ID_ENV_VARS.join(" or ") : "",
    configuredClientSecretAliases.length === 0 ? GOOGLE_OAUTH_CLIENT_SECRET_ENV_VARS.join(" or ") : "",
    configuredRefreshTokenAliases.length === 0 ? GOOGLE_REFRESH_TOKEN_ENV_VARS.join(" or ") : "",
  ].filter(Boolean);
  const fileHasClientId = detectedAcceptedAliasesInFiles.some((envVar) => GOOGLE_OAUTH_CLIENT_ID_ENV_VARS.includes(envVar));
  const fileHasClientSecret = detectedAcceptedAliasesInFiles.some((envVar) => GOOGLE_OAUTH_CLIENT_SECRET_ENV_VARS.includes(envVar));
  const fileHasRefreshToken = detectedAcceptedAliasesInFiles.some((envVar) => GOOGLE_REFRESH_TOKEN_ENV_VARS.includes(envVar));
  const envFilesNeedReload = detectedAcceptedAliasesInFiles.length > 0 && (
    (fileHasClientId && configuredClientIdAliases.length === 0) ||
    (fileHasClientSecret && configuredClientSecretAliases.length === 0) ||
    (fileHasRefreshToken && configuredRefreshTokenAliases.length === 0)
  );
  const missingGroups = [
    configuredClientIdAliases.length === 0 && !fileHasClientId ? GOOGLE_OAUTH_CLIENT_ID_ENV_VARS.join(" or ") : "",
    configuredClientSecretAliases.length === 0 && !fileHasClientSecret ? GOOGLE_OAUTH_CLIENT_SECRET_ENV_VARS.join(" or ") : "",
    configuredRefreshTokenAliases.length === 0 && !fileHasRefreshToken ? GOOGLE_REFRESH_TOKEN_ENV_VARS.join(" or ") : "",
  ].filter(Boolean);
  const nextCredentialStep = envFilesNeedReload
    ? "Keys detectadas en archivos locales; ejecuta Reload keys para cargarlas en runtime y vuelve a preparar Drive."
    : missingGroups.length === 0 && runtimeMissingGroups.length > 0
      ? "Aliases detectados en archivo, pero todavia no estan en runtime; reinicia o usa Reload keys."
      : runtimeMissingGroups.length === 0
        ? "Keys cargadas en runtime; conecta OAuth o prepara Drive."
        : "Pega client id/client secret o refresh token aceptado en Credential Setup batch o CEO_ASSISTANT_ENV.";

  return {
    envFilesChecked: LOCAL_ENV_FILE_CANDIDATES,
    envFilesFound,
    envFilesWithAcceptedAliases: envFilesWithAliases,
    detectedAcceptedAliasesInFiles,
    acceptedClientIdAliases: GOOGLE_OAUTH_CLIENT_ID_ENV_VARS,
    acceptedClientSecretAliases: GOOGLE_OAUTH_CLIENT_SECRET_ENV_VARS,
    acceptedRefreshTokenAliases: GOOGLE_REFRESH_TOKEN_ENV_VARS,
    configuredClientIdAliases,
    configuredClientSecretAliases,
    configuredRefreshTokenAliases,
    missingGroups,
    runtimeMissingGroups,
    envFilesNeedReload,
    nextCredentialStep,
    credentialTemplatePath: GOOGLE_DRIVE_CREDENTIAL_TEMPLATE_PATH,
    requiredEnvTemplateRows: [
      "GOOGLE_CLIENT_ID=",
      "GOOGLE_CLIENT_SECRET=",
      "GOOGLE_DRIVE_REFRESH_TOKEN=",
    ],
  };
}

function isGoogleDriveOAuthNeeded(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || "");
  return /not connected|permission is missing|oauth|unauthorized|insufficient|scope/i.test(message);
}

const GOOGLE_DRIVE_AUTH_PATH = "/api/google-drive/auth";
const GOOGLE_DRIVE_CALLBACK_PATH = "/api/google-drive/oauth/callback";

function normalizeOrigin(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withProtocol);
    url.hash = "";
    url.search = "";
    url.pathname = "";
    return url.toString().replace(/\/$/g, "");
  } catch {
    return null;
  }
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}

function buildDriveOAuthSetupSummary(): ClipperDriveOAuthSetup {
  const configuredRedirectUri = process.env.GOOGLE_DRIVE_REDIRECT_URI || null;
  const publicOrigin = normalizeOrigin(process.env.PUBLIC_BASE_URL)
    || normalizeOrigin(process.env.PUBLIC_APP_URL)
    || normalizeOrigin(process.env.EXPO_PUBLIC_DOMAIN);
  const port = process.env.PORT || "5010";
  const recommendedRedirectUris = uniqueStrings([
    configuredRedirectUri,
    publicOrigin ? `${publicOrigin}${GOOGLE_DRIVE_CALLBACK_PATH}` : null,
    `http://127.0.0.1:${port}${GOOGLE_DRIVE_CALLBACK_PATH}`,
    `http://localhost:${port}${GOOGLE_DRIVE_CALLBACK_PATH}`,
  ]);

  return {
    authPath: GOOGLE_DRIVE_AUTH_PATH,
    callbackPath: GOOGLE_DRIVE_CALLBACK_PATH,
    configuredRedirectUri,
    recommendedRedirectUris,
    scopes: [
      "https://www.googleapis.com/auth/drive.file",
      "https://www.googleapis.com/auth/youtube.upload",
    ],
    nextStep: configuredRedirectUri
      ? "Agrega esa redirect URI en Google Cloud OAuth Client y abre Conectar Drive."
      : "Agrega una de estas redirect URIs en Google Cloud OAuth Client; para produccion usa PUBLIC_BASE_URL HTTPS.",
  };
}

function renderGoogleDriveCredentialTemplate(oauthSetup: ClipperDriveOAuthSetup): string {
  const redirectUri = oauthSetup.configuredRedirectUri || oauthSetup.recommendedRedirectUris[0] || "";
  return [
    "# Clippers Google Drive / YouTube OAuth",
    "# Pega valores reales solo en tu env local o secret manager. No guardes secretos en git.",
    "",
    "# OAuth client creado en Google Cloud.",
    "GOOGLE_CLIENT_ID=",
    "GOOGLE_CLIENT_SECRET=",
    "",
    "# Recomendado para desarrollo local; debe existir como Authorized redirect URI en Google Cloud.",
    `GOOGLE_DRIVE_REDIRECT_URI=${redirectUri}`,
    "",
    "# Despues de abrir /api/google-drive/auth y autorizar offline access, pega el refresh token si decides manejarlo por env.",
    "GOOGLE_DRIVE_REFRESH_TOKEN=",
    "",
    "# Scopes usados por Clippers Drive workspace y YouTube upload.",
    `GOOGLE_DRIVE_SCOPES=${oauthSetup.scopes.join(" ")}`,
    "",
    "# Aliases tambien aceptados por la app:",
    `# Client ID: ${GOOGLE_OAUTH_CLIENT_ID_ENV_VARS.join(" | ")}`,
    `# Client Secret: ${GOOGLE_OAUTH_CLIENT_SECRET_ENV_VARS.join(" | ")}`,
    `# Refresh Token: ${GOOGLE_REFRESH_TOKEN_ENV_VARS.join(" | ")}`,
    "",
  ].join("\n");
}

async function writeGoogleDriveCredentialTemplate(oauthSetup = buildDriveOAuthSetupSummary()) {
  await ensureClipperDirs();
  await writeFile(GOOGLE_DRIVE_CREDENTIAL_TEMPLATE_PATH, renderGoogleDriveCredentialTemplate(oauthSetup));
}

async function readDriveWorkspaceManifest(): Promise<ClipperDriveWorkspaceSummary | null> {
  try {
    const raw = await readFile(DRIVE_WORKSPACE_MANIFEST_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed as ClipperDriveWorkspaceSummary : null;
  } catch {
    return null;
  }
}

async function writeDriveWorkspaceManifest(summary: ClipperDriveWorkspaceSummary) {
  await ensureClipperDirs();
  await writeFile(DRIVE_WORKSPACE_MANIFEST_PATH, JSON.stringify(summary, null, 2));
}

async function buildDriveWorkspaceSummary(): Promise<ClipperDriveWorkspaceSummary> {
  const manifest = await readDriveWorkspaceManifest();
  const envDiagnostics = await buildGoogleDriveEnvDiagnostics();
  const oauthSetup = buildDriveOAuthSetupSummary();
  const configured = hasGoogleDriveKeys() || hasGoogleDriveRefreshToken();
  const manifestReady = manifest?.status === "ready" && manifest.folders.every((folder) => Boolean(folder.folderId));

  if (manifestReady) {
    return {
      ...manifest,
      configured: true,
      connected: true,
      envDiagnostics,
      oauthSetup,
      nextStep: "Drive listo: usar Sources/Allowlist/Metrics Inbox para alimentar Clippers.",
      error: null,
    };
  }

  const folders = CLIPPERS_DRIVE_FOLDERS.map((folder) => ({ ...folder, folderId: null }));
  if (!configured) {
    return {
      status: "missing_keys",
      configured: false,
      connected: false,
      rootPath: ["Robert A", ...CLIPPERS_DRIVE_ROOT],
      manifestPath: DRIVE_WORKSPACE_MANIFEST_PATH,
      folders,
      envDiagnostics,
      oauthSetup,
      generatedAt: manifest?.generatedAt || null,
      nextStep: envDiagnostics.envFilesNeedReload
        ? envDiagnostics.nextCredentialStep
        : `Agregar Google OAuth keys en ${LOCAL_ENV_FILE_CANDIDATES.join(", ")}. Acepto aliases: ${GOOGLE_OAUTH_CLIENT_ID_ENV_VARS.join(" / ")} y ${GOOGLE_OAUTH_CLIENT_SECRET_ENV_VARS.join(" / ")}.`,
      error: null,
    };
  }

  return {
    status: "needs_oauth",
    configured: true,
    connected: false,
    rootPath: ["Robert A", ...CLIPPERS_DRIVE_ROOT],
    manifestPath: DRIVE_WORKSPACE_MANIFEST_PATH,
    folders,
    envDiagnostics,
    oauthSetup,
    generatedAt: manifest?.generatedAt || null,
    nextStep: "Las keys estan; conecta Google Drive con /api/google-drive/auth y luego prepara carpetas.",
    error: manifest?.error || null,
  };
}

export async function prepareClipperDriveWorkspace(userId = getSystemUserId()): Promise<{ driveWorkspace: ClipperDriveWorkspaceSummary; status: ClipperStatus }> {
  await ensureClipperDirs();
  const envDiagnostics = await buildGoogleDriveEnvDiagnostics();
  const oauthSetup = buildDriveOAuthSetupSummary();
  const configured = hasGoogleDriveKeys() || hasGoogleDriveRefreshToken();
  await writeGoogleDriveCredentialTemplate(oauthSetup);

  if (!configured) {
    const driveWorkspace = await buildDriveWorkspaceSummary();
    await writeDriveWorkspaceManifest(driveWorkspace);
    return { driveWorkspace, status: await getClipperStatus(userId) };
  }

  try {
    const folders: ClipperDriveFolder[] = [];
    for (const folder of CLIPPERS_DRIVE_FOLDERS) {
      folders.push({
        ...folder,
        folderId: await ensureAppDriveFolderPath(folder.path, userId),
      });
    }

    const driveWorkspace: ClipperDriveWorkspaceSummary = {
      status: "ready",
      configured: true,
      connected: true,
      rootPath: ["Robert A", ...CLIPPERS_DRIVE_ROOT],
      manifestPath: DRIVE_WORKSPACE_MANIFEST_PATH,
      folders,
      envDiagnostics,
      oauthSetup,
      generatedAt: new Date().toISOString(),
      nextStep: "Drive listo: cargar videos fuente, permisos y metricas en las carpetas de Clippers.",
      error: null,
    };
    await writeDriveWorkspaceManifest(driveWorkspace);
    return { driveWorkspace, status: await getClipperStatus(userId) };
  } catch (error) {
    const driveWorkspace: ClipperDriveWorkspaceSummary = {
      status: isGoogleDriveOAuthNeeded(error) ? "needs_oauth" : "error",
      configured: true,
      connected: false,
      rootPath: ["Robert A", ...CLIPPERS_DRIVE_ROOT],
      manifestPath: DRIVE_WORKSPACE_MANIFEST_PATH,
      folders: CLIPPERS_DRIVE_FOLDERS.map((folder) => ({ ...folder, folderId: null })),
      envDiagnostics,
      oauthSetup,
      generatedAt: new Date().toISOString(),
      nextStep: isGoogleDriveOAuthNeeded(error)
        ? "Las keys estan; abre /api/google-drive/auth, autoriza Drive y vuelve a preparar carpetas."
        : "Revisar el error de Drive y volver a intentar preparar carpetas.",
      error: error instanceof Error ? error.message : String(error),
    };
    await writeDriveWorkspaceManifest(driveWorkspace);
    return { driveWorkspace, status: await getClipperStatus(userId) };
  }
}

function buildTokenExchangeRequest(platform: ClipperPlatform, code: string): ClipperTokenExchangeRequest {
  const redirectUri = buildRedirectUri(platform);

  if (platform === "tiktok") {
    const body = new URLSearchParams({
      client_key: getTikTokClientKey(),
      client_secret: getTikTokClientSecret(),
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    });
    return {
      url: "https://open.tiktokapis.com/v2/oauth/token/",
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "Cache-Control": "no-cache" },
      body: body.toString(),
    };
  }

  if (platform === "instagram") {
    const params = new URLSearchParams({
      client_id: getMetaAppId(),
      client_secret: getMetaAppSecret(),
      redirect_uri: redirectUri,
      code,
    });
    return {
      url: `https://graph.facebook.com/v20.0/oauth/access_token?${params.toString()}`,
      method: "GET",
      headers: {},
    };
  }

  const body = new URLSearchParams({
    client_id: getGoogleOAuthClientId(),
    client_secret: getGoogleOAuthClientSecret(),
    code,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
  });
  return {
    url: "https://oauth2.googleapis.com/token",
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  };
}

async function exchangeClipperOAuthCode(platform: ClipperPlatform, code: string): Promise<Record<string, unknown>> {
  const request = buildTokenExchangeRequest(platform, code);
  const response = await fetch(request.url, {
    method: request.method,
    headers: request.headers,
    body: request.method === "POST" ? request.body : undefined,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = body && typeof body === "object" && "error" in body ? String((body as { error?: unknown }).error) : `HTTP ${response.status}`;
    throw new Error(`Token exchange failed: ${error}`);
  }
  return body as Record<string, unknown>;
}

async function tryExchangeAndStoreClipperToken(platform: ClipperPlatform, code: string, accountId?: string | null): Promise<{ status: ClipperTokenExchangeStatus; note: string }> {
  const credentialCheck = getCredentialCheck(platform);
  const missingEnvVars = [...credentialCheck.missingEnvVars];
  if (!getTokenVaultSecret()) missingEnvVars.push(TOKEN_ENCRYPTION_ENV_VAR);
  if (missingEnvVars.length > 0) {
    return {
      status: "blocked",
      note: `Token no intercambiado: faltan ${missingEnvVars.join(", ")}. Repite OAuth cuando esten configuradas.`,
    };
  }

  try {
    const payload = await exchangeClipperOAuthCode(platform, code);
    await saveClipperTokenPayload(platform, payload, accountId);
    return {
      status: "saved",
      note: "Token intercambiado y guardado cifrado en el vault local.",
    };
  } catch (error: any) {
    return {
      status: "failed",
      note: error.message || "La plataforma rechazo el intercambio de token; revisa redirect URI, scopes y app review.",
    };
  }
}

function applyOAuthStateToAccounts(
  accounts: ClipperAccount[],
  connections: ClipperOAuthConnection[],
  tokenRecords: ClipperTokenVaultRecord[]
): ClipperAccount[] {
  const connectedPlatforms = new Set(
    connections
      .filter((connection) => connection.status === "code_received" && !connection.accountId)
      .map((connection) => connection.platform)
  );
  const connectedAccountPlatforms = new Set(
    connections
      .filter((connection) => connection.status === "code_received" && connection.accountId)
      .map((connection) => `${connection.platform}:${connection.accountId}`)
  );
  const tokenPlatforms = new Set(tokenRecords.filter((record) => !record.accountId).map((record) => record.platform));
  const tokenAccountPlatforms = new Set(tokenRecords.filter((record) => record.accountId).map((record) => `${record.platform}:${record.accountId}`));

  return accounts.map((account) => ({
    ...account,
    platformAccounts: account.platformAccounts.map((platformAccount) => {
      const accountPlatformKey = `${platformAccount.platform}:${account.id}`;
      if (tokenPlatforms.has(platformAccount.platform) || tokenAccountPlatforms.has(accountPlatformKey)) {
        return {
          ...platformAccount,
          status: "needs_review",
          missingSteps: platformAccount.missingSteps.filter((step) => !step.toLowerCase().includes("oauth")),
          notes: "Token OAuth guardado cifrado; falta validar app review, cuenta destino y permiso final antes de autopost.",
        };
      }
      if (!connectedPlatforms.has(platformAccount.platform) && !connectedAccountPlatforms.has(accountPlatformKey)) return platformAccount;
      return {
        ...platformAccount,
        status: "needs_review",
        missingSteps: platformAccount.missingSteps.filter((step) => !step.toLowerCase().includes("oauth")),
        notes: "OAuth authorization code recibido; falta intercambio seguro por token y/o app review antes de autopost.",
      };
    }),
  }));
}

function buildCredentialChecks(): ClipperCredentialCheck[] {
  return CREDENTIAL_ENV_REQUIREMENTS.map((requirement) => {
    const configuredEnvVars = requirement.acceptedEnvVarGroups.flatMap((group) => group.filter((name) => Boolean(process.env[name])));
    const missingEnvVars = requirement.acceptedEnvVarGroups
      .filter((group) => !group.some((name) => Boolean(process.env[name])))
      .map((group) => group[0]);
    return {
      ...requirement,
      configuredEnvVars,
      missingEnvVars,
      status:
        missingEnvVars.length === 0
          ? "ready"
          : configuredEnvVars.length > 0
            ? "partial"
            : "missing",
    };
  });
}

function getPublicBaseUrl(): string {
  const appBaseUrl = process.env.APP_BASE_URL;
  if (appBaseUrl) return appBaseUrl;
  const publicBaseUrl = process.env.PUBLIC_BASE_URL;
  if (publicBaseUrl && isProductionPublicBaseUrl(publicBaseUrl)) return publicBaseUrl;
  return `http://127.0.0.1:${process.env.PORT || "5010"}`;
}

function isProductionPublicBaseUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    return url.protocol === "https:"
      && hostname !== "localhost"
      && hostname !== "127.0.0.1"
      && hostname !== "::1"
      && !hostname.endsWith(".local");
  } catch {
    return false;
  }
}

function buildRedirectUri(platform: ClipperPlatform): string {
  return `${getPublicBaseUrl().replace(/\/$/, "")}/api/clippers/oauth/${platform}/callback`;
}

function getPermissionPackFilePath(fileName: string): string {
  return path.join(PERMISSION_PACK_DIR, fileName);
}

async function buildPermissionPackSummary(): Promise<ClipperPermissionPackSummary> {
  const files = await Promise.all(PERMISSION_PACK_FILES.map(async (file) => {
    const filePath = getPermissionPackFilePath(file.fileName);
    let exists = false;
    try {
      exists = (await stat(filePath)).isFile();
    } catch {
      exists = false;
    }
    return {
      id: file.id,
      label: file.label,
      path: filePath,
      exists,
      purpose: file.purpose,
    };
  }));
  const readyCount = files.filter((file) => file.exists).length;
  const status: ClipperPermissionPackStatus = readyCount === files.length ? "ready" : readyCount > 0 ? "partial" : "missing";
  let generatedAt: string | null = null;
  try {
    const readmeStat = await stat(getPermissionPackFilePath("README.md"));
    generatedAt = readmeStat.mtime.toISOString();
  } catch {
    generatedAt = null;
  }
  return {
    status,
    rootDir: PERMISSION_PACK_DIR,
    files,
    generatedAt,
    nextStep: status === "ready"
      ? "Usa estos archivos para crear apps, pegar app review y registrar redirect URIs."
      : "Genera el paquete de permisos para dejar copy, evidencia y redirect URIs listos.",
  };
}

function buildRedirectUriManifest(): Record<ClipperPlatform, { redirectUri: string; scopes: string[]; docs: string[] }> {
  return {
    tiktok: {
      redirectUri: buildRedirectUri("tiktok"),
      scopes: PLATFORM_SCOPES.tiktok,
      docs: PLATFORM_REQUIREMENTS.find((item) => item.platform === "tiktok")?.docs || [],
    },
    instagram: {
      redirectUri: buildRedirectUri("instagram"),
      scopes: PLATFORM_SCOPES.instagram,
      docs: PLATFORM_REQUIREMENTS.find((item) => item.platform === "instagram")?.docs || [],
    },
    youtube: {
      redirectUri: buildRedirectUri("youtube"),
      scopes: PLATFORM_SCOPES.youtube,
      docs: PLATFORM_REQUIREMENTS.find((item) => item.platform === "youtube")?.docs || [],
    },
  };
}

function renderEnvTemplate(): string {
  return [
    "# Clippers OAuth + token vault",
    "# No pegues secrets reales en este archivo generado; copialos a tu .env local/secret manager.",
    "",
    `PUBLIC_BASE_URL=http://127.0.0.1:${process.env.PORT || "5010"}`,
    `${TOKEN_ENCRYPTION_ENV_VAR}=replace-with-32-plus-character-secret`,
    "",
    "TIKTOK_CLIENT_KEY=",
    "TIKTOK_CLIENT_SECRET=",
    "# Alternativo aceptado:",
    "# TIKTOK_CLIENT_ID=",
    "",
    "META_APP_ID=",
    "META_APP_SECRET=",
    "# Alternativos aceptados:",
    "# FACEBOOK_APP_ID=",
    "# FACEBOOK_APP_SECRET=",
    "",
    "GOOGLE_CLIENT_ID=",
    "GOOGLE_CLIENT_SECRET=",
    "# Alternativos aceptados si ya usas Google Drive/YouTube OAuth:",
    "# GOOGLE_OAUTH_CLIENT_ID=",
    "# GOOGLE_OAUTH_CLIENT_SECRET=",
    "# GOOGLE_DRIVE_CLIENT_ID=",
    "# GOOGLE_DRIVE_CLIENT_SECRET=",
    "# GOOGLE_DRIVE_OAUTH_CLIENT_ID=",
    "# GOOGLE_DRIVE_OAUTH_CLIENT_SECRET=",
    "# YOUTUBE_CLIENT_ID=",
    "# YOUTUBE_CLIENT_SECRET=",
    "# YOUTUBE_OAUTH_CLIENT_ID=",
    "# YOUTUBE_OAUTH_CLIENT_SECRET=",
    "# GOOGLE_DRIVE_REFRESH_TOKEN=",
    "# GOOGLE_REFRESH_TOKEN=",
    "# GOOGLE_OAUTH_REFRESH_TOKEN=",
    "# YOUTUBE_REFRESH_TOKEN=",
    "",
  ].join("\n");
}

function renderPermissionReadme(accounts: ClipperAccount[]): string {
  const totalPlatformAccounts = accounts.reduce((sum, account) => sum + account.platformAccounts.length, 0);
  return [
    "# Clippers Permission Pack",
    "",
    `Generado: ${new Date().toISOString()}`,
    `Cuentas internas: ${accounts.length}`,
    `Cuentas plataforma preparadas: ${totalPlatformAccounts}`,
    "",
    "Orden recomendado:",
    "",
    "1. Crear/verificar las cuentas reales usando account-creation-checklist.md.",
    "2. Crear apps de developer en TikTok, Meta y Google.",
    "3. Registrar redirect-uris.json en cada portal.",
    "4. Copiar oauth-env-template.env a tu gestor de secrets/.env real.",
    "5. Pegar el copy de app review de cada archivo por plataforma.",
    "6. Volver a /clippers y conectar OAuth por plataforma.",
    "",
    "Archivos:",
    "",
    ...PERMISSION_PACK_FILES.filter((file) => file.fileName !== "README.md").map((file) => `- ${file.fileName}: ${file.purpose}`),
    "",
  ].join("\n");
}

function renderAccountCreationChecklist(accounts: ClipperAccount[]): string {
  return [
    "# Account Creation Checklist",
    "",
    "Marca cada cuenta cuando el login, verificacion y perfil esten listos. La app prepara los registros internos, pero cada plataforma exige creacion/verificacion humana.",
    "",
    ...accounts.flatMap((account) => [
      `## ${account.name}`,
      "",
      `Categoria: ${getClipperCategoryLabel(account.category)}`,
      `Meta semanal: ${account.weeklyViewsGoal.toLocaleString("en-US")} views`,
      `Clips diarios: ${account.dailyClipTarget}`,
      "",
      ...account.platformAccounts.map((platformAccount) => [
        `### ${platformAccount.platform}: ${platformAccount.handle}`,
        "",
        "- [ ] Crear o iniciar sesion en la cuenta real.",
        "- [ ] Verificar email/telefono/autenticacion que pida la plataforma.",
        "- [ ] Configurar nombre, avatar, bio y link si aplica.",
        "- [ ] Aceptar terminos y reglas de creator/business account.",
        "- [ ] Autorizar OAuth desde /clippers.",
        `- [ ] Confirmar scopes: ${platformAccount.requiredScopes.join(", ")}.`,
        `- Nota: ${platformAccount.notes}`,
        "",
      ].join("\n")),
    ]),
  ].join("\n");
}

function renderPlatformReviewDoc(platform: ClipperPlatform, accounts: ClipperAccount[]): string {
  const requirement = PLATFORM_REQUIREMENTS.find((item) => item.platform === platform)!;
  const platformAccounts = accounts.flatMap((account) =>
    account.platformAccounts
      .filter((platformAccount) => platformAccount.platform === platform)
      .map((platformAccount) => ({ account, platformAccount }))
  );
  return [
    `# ${requirement.label} Permission / App Review`,
    "",
    `Developer portal: ${requirement.developerPortalUrl}`,
    `Account creation: ${requirement.accountCreationUrl}`,
    `Redirect URI: ${buildRedirectUri(platform)}`,
    `Required account type: ${requirement.requiredAccountType}`,
    "",
    "Requested scopes:",
    ...requirement.scopes.map((scope) => `- ${scope}`),
    "",
    "Use case summary:",
    "",
    "We operate a multi-account short-form clipping workflow for sports, memes and streamer content. The system creates reviewable vertical drafts, schedules approved clips, reads performance signals, and optimizes future hooks/timing. Publishing is only enabled for accounts we own/control and content that is owned, licensed, official-source, or explicitly permissioned by the creator/rightsholder.",
    "",
    "Safety and rights controls:",
    "",
    "- Rights Gate blocks external clips unless permission/license evidence is present in the allowlist.",
    "- New accounts remain in approval_required mode until quality, rights and platform risk are validated.",
    "- The optimizer can change hooks, schedule and volume, but cannot bypass rights checks.",
    "- OAuth tokens are stored server-side only and encrypted with CLIPPERS_TOKEN_ENCRYPTION_KEY.",
    "- The app does not expose access tokens in UI, logs, reports or generated permission documents.",
    "",
    "Posting mode:",
    "",
    requirement.postingMode,
    "",
    "App review need:",
    "",
    requirement.appReview,
    "",
    "Accounts that will authorize this platform:",
    "",
    ...platformAccounts.map(({ account, platformAccount }) => `- ${account.name} (${getClipperCategoryLabel(account.category)}): ${platformAccount.handle}`),
    "",
    "Human setup required before production:",
    "",
    ...requirement.humanRequired.map((step) => `- [ ] ${step}`),
    "",
    "Evidence to attach:",
    "",
    "- Screenshot of /clippers showing the account, token vault and rights guardrails.",
    "- Screenshot or export of allowlist permission/licensing evidence.",
    "- Short screen recording of OAuth connection and approval_required publishing workflow.",
    "- Example draft generated from owned/licensed/permissioned source footage.",
    "",
    "Official docs:",
    "",
    ...requirement.docs.map((doc) => `- ${doc}`),
    "",
  ].join("\n");
}

function getCredentialCheck(platform: ClipperPlatform): ClipperCredentialCheck {
  const check = buildCredentialChecks().find((item) => item.platform === platform);
  if (!check) {
    return {
      platform,
      label: platform,
      status: "missing",
      requiredEnvVars: [],
      acceptedEnvVarGroups: [],
      configuredEnvVars: [],
      missingEnvVars: [],
      nextStep: "Configurar credenciales OAuth.",
    };
  }
  return check;
}

function normalizeOAuthAccountId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return /^[a-z0-9][a-z0-9-]{1,63}$/.test(trimmed) ? trimmed : null;
}

function buildOAuthState(platform: ClipperPlatform, accountId?: string | null): string {
  const normalizedAccountId = normalizeOAuthAccountId(accountId);
  return normalizedAccountId ? `clippers-${platform}-${normalizedAccountId}` : `clippers-${platform}`;
}

function accountIdFromOAuthState(platform: ClipperPlatform, state: unknown): string | null {
  if (typeof state !== "string") return null;
  const prefix = `clippers-${platform}-`;
  if (!state.startsWith(prefix)) return null;
  return normalizeOAuthAccountId(state.slice(prefix.length));
}

function buildPlatformAuthUrl(platform: ClipperPlatform, accountId?: string | null): string | null {
  const redirectUri = buildRedirectUri(platform);
  const state = buildOAuthState(platform, accountId);

  if (platform === "tiktok") {
    const clientKey = getTikTokClientKey();
    if (!clientKey) return null;
    const params = new URLSearchParams({
      client_key: clientKey,
      response_type: "code",
      scope: PLATFORM_SCOPES.tiktok.join(","),
      redirect_uri: redirectUri,
      state,
    });
    return `https://www.tiktok.com/v2/auth/authorize/?${params.toString()}`;
  }

  if (platform === "instagram") {
    const appId = getMetaAppId();
    if (!appId) return null;
    const params = new URLSearchParams({
      client_id: appId,
      redirect_uri: redirectUri,
      scope: PLATFORM_SCOPES.instagram.join(","),
      response_type: "code",
      state,
    });
    return `https://www.facebook.com/v20.0/dialog/oauth?${params.toString()}`;
  }

  const clientId = getGoogleOAuthClientId();
  if (!clientId) return null;
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: PLATFORM_SCOPES.youtube.join(" "),
    access_type: "offline",
    prompt: "consent",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export function buildClipperConnectActions(): ClipperConnectAction[] {
  return (["tiktok", "instagram", "youtube"] as ClipperPlatform[]).map((platform) => {
    const credentialCheck = getCredentialCheck(platform);
    const requirement = PLATFORM_REQUIREMENTS.find((item) => item.platform === platform);
    const authUrl = credentialCheck.status === "missing" ? null : buildPlatformAuthUrl(platform);
    return {
      platform,
      label: requirement?.label || platform,
      status: authUrl ? "ready" : "blocked",
      authUrl,
      callbackPath: `/api/clippers/oauth/${platform}/callback`,
      missingEnvVars: credentialCheck.missingEnvVars,
      scopes: PLATFORM_SCOPES[platform],
      nextStep: authUrl
        ? `Abrir OAuth y autorizar ${requirement?.label || platform}.`
        : credentialCheck.nextStep,
    };
  });
}

function buildClipperTokenExchanges(
  connections: ClipperOAuthConnection[],
  tokenRecords: ClipperTokenVaultRecord[]
): ClipperTokenExchange[] {
  return (["tiktok", "instagram", "youtube"] as ClipperPlatform[]).map((platform) => {
    const requirement = PLATFORM_REQUIREMENTS.find((item) => item.platform === platform);
    const credentialCheck = getCredentialCheck(platform);
    const tokenRecord = tokenRecords.find((record) => record.platform === platform);
    const connection = connections.find((item) => item.platform === platform);
    const missingEnvVars = [...credentialCheck.missingEnvVars];
    if (!getTokenVaultSecret()) missingEnvVars.push(TOKEN_ENCRYPTION_ENV_VAR);

    if (tokenRecord) {
      return {
        platform,
        label: requirement?.label || platform,
        status: "saved",
        missingEnvVars: [],
        callbackPath: `/api/clippers/oauth/${platform}/callback`,
        tokenSavedAt: tokenRecord.savedAt,
        docsUrl: requirement?.docs[0] || "",
        nextStep: "Token cifrado guardado. Valida app review y cuenta destino antes de activar autopost.",
      };
    }

    if (missingEnvVars.length > 0) {
      return {
        platform,
        label: requirement?.label || platform,
        status: "blocked",
        missingEnvVars,
        callbackPath: `/api/clippers/oauth/${platform}/callback`,
        tokenSavedAt: null,
        docsUrl: requirement?.docs[0] || "",
        nextStep: `Faltan ${missingEnvVars.join(", ")} para intercambiar y guardar el token.`,
      };
    }

    if (connection?.tokenStatus === "failed") {
      return {
        platform,
        label: requirement?.label || platform,
        status: "failed",
        missingEnvVars: [],
        callbackPath: `/api/clippers/oauth/${platform}/callback`,
        tokenSavedAt: null,
        docsUrl: requirement?.docs[0] || "",
        nextStep: connection.tokenNote || "Repite OAuth despues de revisar redirect URI, scopes y app review.",
      };
    }

    return {
      platform,
      label: requirement?.label || platform,
      status: connection?.status === "code_received" ? "ready" : "blocked",
      missingEnvVars: [],
      callbackPath: `/api/clippers/oauth/${platform}/callback`,
      tokenSavedAt: null,
      docsUrl: requirement?.docs[0] || "",
      nextStep: connection?.status === "code_received"
        ? "OAuth code recibido pero no reusable; abre Conectar otra vez para guardar token cifrado."
        : "Completa OAuth para recibir authorization code e intercambiarlo por token.",
    };
  });
}

export function getClipperConnectAction(platform: unknown, accountId?: unknown): ClipperConnectAction {
  if (platform !== "tiktok" && platform !== "instagram" && platform !== "youtube") {
    throw new Error("Plataforma no soportada.");
  }
  const action = buildClipperConnectActions().find((item) => item.platform === platform)!;
  const normalizedAccountId = normalizeOAuthAccountId(accountId);
  if (!normalizedAccountId || !action.authUrl) return action;
  return {
    ...action,
    authUrl: buildPlatformAuthUrl(platform, normalizedAccountId),
  };
}

async function writeWorkspaceReadme() {
  const readmePath = path.join(ROOT_DIR, "README.md");
  try {
    await stat(readmePath);
  } catch {
    await writeFile(
      readmePath,
      [
        "# Clippers Workspace",
        "",
        "Pon aqui solo videos propios, licenciados, de fuentes oficiales o con permiso explicito.",
        "",
        "- sources/sports: deportes",
        "- sources/memes: memes",
        "- sources/streamers: streamers",
        "- allowlist: evidencia de permisos/licencias",
        "- drafts: clips generados para revision",
        "- scheduled: paquetes aprobados para publicar",
        "",
      ].join("\n")
    );
  }
}

async function readConfig(): Promise<{ accounts?: ClipperAccount[]; sources?: ClipperSource[] }> {
  try {
    const raw = await readFile(CONFIG_PATH, "utf8");
    const parsed = JSON.parse(raw) as { accounts?: ClipperAccount[]; sources?: ClipperSource[] };
    return parsed;
  } catch {
    return {};
  }
}

function ensureAccountShape(account: ClipperAccount): ClipperAccount {
  if (Array.isArray(account.platformAccounts) && account.platformAccounts.length) return account;
  const slug = account.id.replace(/[^a-z0-9]+/gi, "").toLowerCase();
  return {
    ...account,
    platformAccounts: defaultPlatformAccounts(slug, account.name),
  };
}

async function writeDefaultConfigIfMissing() {
  await ensureClipperDirs();
  try {
    await stat(CONFIG_PATH);
  } catch {
    await writeFile(CONFIG_PATH, JSON.stringify({ accounts: DEFAULT_ACCOUNTS, sources: DEFAULT_SOURCES }, null, 2));
  }
}

function normalizeRunOptions(input: unknown): Required<ClipperRunOptions> {
  const value = (input && typeof input === "object" ? input : {}) as ClipperRunOptions;
  const clipsPerAccount = Number(value.clipsPerAccount);
  return {
    clipsPerAccount: Number.isFinite(clipsPerAccount) ? Math.min(Math.max(Math.round(clipsPerAccount), 1), 50) : 8,
    publishMode:
      value.publishMode === "auto_after_connection" || value.publishMode === "draft_only" || value.publishMode === "approval_required"
        ? value.publishMode
        : "approval_required",
    riskTolerance:
      value.riskTolerance === "aggressive" || value.riskTolerance === "growth" || value.riskTolerance === "safe"
        ? value.riskTolerance
        : "growth",
  };
}

export function getClipperCategoryLabel(category: ClipperAccountCategory): string {
  if (category === "sports") return "Deportes";
  if (category === "memes") return "Memes";
  return "Streamers";
}

function buildPipeline(accounts: ClipperAccount[]): ClipperPipelineItem[] {
  const dailyTarget = accounts.reduce((sum, account) => sum + account.dailyClipTarget, 0);
  return [
    { stage: "Trend scan", count: dailyTarget * 4, owner: "Trend Scout", status: "active" },
    { stage: "Rights review", count: Math.ceil(dailyTarget * 1.8), owner: "Rights Gate", status: "review_required" },
    { stage: "Draft edits", count: dailyTarget, owner: "Clip Factory", status: "waiting" },
    { stage: "Scheduled posts", count: 0, owner: "Publisher", status: "waiting" },
    { stage: "Performance loops", count: accounts.length, owner: "Optimizer", status: "active" },
  ];
}

function getSourceFolderForCategory(category: ClipperAccountCategory): string {
  return path.join(SOURCES_DIR, category);
}

async function findRightsEvidence(filePath: string): Promise<string | null> {
  const parsed = path.parse(filePath);
  const candidates = [
    path.join(ROOT_DIR, "allowlist", `${parsed.name}.md`),
    path.join(ROOT_DIR, "allowlist", `${parsed.name}.json`),
    path.join(ROOT_DIR, "allowlist", `${parsed.base}.md`),
    path.join(ROOT_DIR, "allowlist", `${parsed.base}.json`),
  ];
  for (const candidate of candidates) {
    try {
      if ((await stat(candidate)).isFile()) return candidate;
    } catch {
      // Continue checking the remaining evidence file names.
    }
  }
  return null;
}

async function listSourceAssets(): Promise<ClipperSourceAsset[]> {
  await ensureClipperDirs();
  const categories: ClipperAccountCategory[] = ["sports", "memes", "streamers"];
  const assets: ClipperSourceAsset[] = [];

  for (const category of categories) {
    const folder = getSourceFolderForCategory(category);
    const entries = await readdir(folder, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (!VIDEO_EXTENSIONS.has(ext)) continue;
      const filePath = path.join(folder, entry.name);
      const fileStat = await stat(filePath);
      const evidencePath = await findRightsEvidence(filePath);
      assets.push({
        id: hashId(filePath),
        category,
        fileName: entry.name,
        path: filePath,
        sizeBytes: fileStat.size,
        updatedAt: fileStat.mtime.toISOString(),
        rightsStatus: evidencePath ? "owned_or_permissioned" : "review_required",
        evidencePath,
        notes: evidencePath
          ? "Evidencia encontrada en allowlist; listo para draft/revision final."
          : "Falta evidencia de permiso/licencia en allowlist antes de publicar.",
      });
    }
  }

  return assets.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function sourceRightsEvidencePath(asset: ClipperSourceAsset): string {
  const parsed = path.parse(asset.fileName);
  return path.join(ROOT_DIR, "allowlist", `${parsed.name}.md`);
}

function renderSourceRightsEvidence(record: ClipperSourceRightsRecord): string {
  return [
    `# Source Rights Evidence: ${record.fileName}`,
    "",
    `status: ${record.rightsStatus}`,
    `category: ${record.category}`,
    `asset_id: ${record.assetId}`,
    `source_path: ${record.sourcePath}`,
    `recorded_at: ${record.recordedAt}`,
    "source: clippers-ui",
    "",
    "Notes:",
    record.notes,
    "",
    "Checklist:",
    "- [x] Source reviewed by Rights Gate.",
    "- [x] Permission, ownership, license, or creator approval was confirmed outside this file.",
    "- [ ] If this is third-party content, store sensitive proof/screenshots in the secure drive, not in git.",
    "",
  ].join("\n");
}

function buildSourceRightsRecordTemplate(input: {
  category: ClipperAccountCategory;
  accountName: string;
  targetHook: string;
  sourcePath: string | null;
  sourceFolder: string;
}): string {
  return [
    `asset_or_source: ${input.sourcePath || "<source-url-or-file-name>"}`,
    `category: ${input.category}`,
    `account: ${input.accountName}`,
    `source_folder: ${input.sourceFolder}`,
    "rights_status: owned_or_permissioned",
    "permission_type: creator_permission | license | official_source | owned",
    "approved_platforms: tiktok, instagram, youtube",
    "credit_required: <creator/source credit or none>",
    "approved_by: <name/handle/email or owned>",
    "approved_at: <YYYY-MM-DD>",
    "evidence_link: <secure-drive-link-or-screenshot-reference>",
    `notes: ${input.targetHook}`,
  ].join("\n");
}

function requiredInputsForSourceStatus(
  status: ClipperSourceHuntItemStatus,
  category: ClipperAccountCategory,
  sourcePath: string | null
): string[] {
  if (status === "ready_for_draft") {
    return [
      "Confirmar que la evidencia en allowlist sigue vigente.",
      `Revisar el archivo fuente: ${sourcePath || getSourceFolderForCategory(category)}.`,
      "Aprobar que el clip puede pasar a draft sin romper limites de uso.",
    ];
  }
  if (status === "needs_rights") {
    return [
      "Respuesta escrita, licencia, fuente oficial o prueba de ownership.",
      "Link original o referencia del archivo exacto aprobado.",
      "Credito requerido, plataformas aprobadas y fecha/limites de uso.",
      "Archivo de evidencia guardado en allowlist antes de marcar Rights OK.",
    ];
  }
  return [
    `Video fuente real agregado en ${getSourceFolderForCategory(category)}.`,
    "Link original, creador/rightsholder y fecha de captura.",
    "Permiso/licencia/uso oficial documentado antes de editar.",
  ];
}

function completionHintForSourceStatus(status: ClipperSourceHuntItemStatus): string {
  if (status === "ready_for_draft") return "Cuando la revision final este OK, genera draft specs para este slot.";
  if (status === "needs_rights") return "Cuando exista evidencia, usa Rights OK o guarda el .md de allowlist para desbloquear la cola.";
  return "Cuando subas la fuente, regenera la cola y luego completa permisos si el asset queda en rights_review.";
}

function buildProductionQueueItems(accounts: ClipperAccount[], assets: ClipperSourceAsset[]): ClipperProductionQueueItem[] {
  const hooksByCategory: Record<ClipperAccountCategory, string[]> = {
    sports: ["La jugada que nadie esperaba", "Ultimo minuto con contexto", "El momento que cambio el partido"],
    memes: ["POV que se entiende demasiado rapido", "El internet hoy en 7 segundos", "Cuando el dia decide ponerse raro"],
    streamers: ["Chat se quedo congelado", "El clip que explica todo", "Nadie esperaba ese final"],
  };
  const variantAnglesByCategory: Record<ClipperAccountCategory, string[]> = {
    sports: ["contexto rapido", "reaccion fuerte", "antes/despues", "dato inesperado", "debate en comentarios"],
    memes: ["relatable POV", "remate inmediato", "loop absurdo", "texto seco", "dueto/reaccion"],
    streamers: ["setup + payoff", "chat reaction", "rage/fail", "victoria inesperada", "clip con contexto"],
  };
  const clipObjectives = [
    "maximizar retencion en los primeros 3 segundos",
    "provocar comentario sin clickbait falso",
    "crear loop para rewatch",
    "testear caption corto vs contexto",
    "validar horario ganador",
  ];
  const assetsByCategory = assets.reduce<Record<ClipperAccountCategory, ClipperSourceAsset[]>>((lookup, asset) => {
    lookup[asset.category].push(asset);
    return lookup;
  }, { sports: [], memes: [], streamers: [] });

  return accounts.flatMap((account, accountIndex) => {
    const categoryAssets = assetsByCategory[account.category];
    const targetSlots = Math.max(1, Math.min(account.dailyClipTarget, 40));
    return Array.from({ length: targetSlots }, (_, slotIndex) => {
      const asset = categoryAssets[slotIndex % Math.max(categoryAssets.length, 1)] || null;
      const hookIndex = (accountIndex + slotIndex) % hooksByCategory[account.category].length;
      const variantAngle = variantAnglesByCategory[account.category][slotIndex % variantAnglesByCategory[account.category].length];
      const clipObjective = clipObjectives[(accountIndex + slotIndex) % clipObjectives.length];
      const status: ClipperProductionQueueStatus = asset
        ? asset.rightsStatus === "owned_or_permissioned"
          ? "draft_ready"
          : "rights_review"
        : "needs_source";
      const sourceHuntStatus: ClipperSourceHuntItemStatus = status === "draft_ready"
        ? "ready_for_draft"
        : status === "rights_review"
          ? "needs_rights"
          : "needs_source";
      return {
        id: hashId(`${account.id}-${asset?.id || "missing"}-${slotIndex + 1}-${variantAngle}`),
        accountId: account.id,
        accountName: account.name,
        category: account.category,
        slotNumber: slotIndex + 1,
        variantAngle,
        clipObjective,
        sourceAssetId: asset?.id || null,
        sourcePath: asset?.path || null,
        rightsStatus: asset?.rightsStatus || "missing",
        status,
        hook: hooksByCategory[account.category][hookIndex],
        format: slotIndex % 3 === 0
          ? "9:16 fast cut + captions + loop ending"
          : slotIndex % 3 === 1
            ? "9:16 context hook + payoff + CTA"
            : "9:16 reaction stitch + text overlay + replay beat",
        publishWindow: slotIndex % 3 === 0 ? "12:00-15:00" : slotIndex % 3 === 1 ? "18:00-22:00" : "21:00-00:00",
        platforms: account.platforms,
        requiredInputs: requiredInputsForSourceStatus(sourceHuntStatus, account.category, asset?.path || null),
        completionHint: completionHintForSourceStatus(sourceHuntStatus),
        nextStep: status === "draft_ready"
          ? "Generar draft vertical y dejarlo en approval_required."
          : status === "rights_review"
            ? "Agregar evidencia/licencia en allowlist antes de editar o publicar."
            : `Agregar video fuente en ${getSourceFolderForCategory(account.category)} para cubrir ${targetSlots} slots diarios.`,
      };
    });
  });
}

async function readLatestProductionQueue(): Promise<ClipperProductionQueueSummary | null> {
  await ensureClipperDirs();
  const files = await readdir(DRAFTS_DIR).catch(() => []);
  const queueFiles = files.filter((file) => file.startsWith("production-queue-") && file.endsWith(".json")).sort().reverse();
  if (!queueFiles[0]) return null;
  try {
    const raw = await readFile(path.join(DRAFTS_DIR, queueFiles[0]), "utf8");
    return JSON.parse(raw) as ClipperProductionQueueSummary;
  } catch {
    return null;
  }
}

async function buildProductionQueueSummary(accounts: ClipperAccount[]): Promise<ClipperProductionQueueSummary> {
  const assets = await listSourceAssets();
  const latestQueue = await readLatestProductionQueue();
  const items = buildProductionQueueItems(accounts, assets);
  const readyCount = items.filter((item) => item.status === "draft_ready").length;
  const reviewCount = items.filter((item) => item.status === "rights_review").length;
  const status = assets.length === 0 ? "needs_sources" : readyCount > 0 ? "ready" : reviewCount > 0 ? "needs_rights" : "empty";
  const nextStep = assets.length === 0
    ? "Agrega videos propios/licenciados a las carpetas de fuentes para que Clip Factory pueda crear drafts reales."
    : readyCount > 0
      ? "Genera cola de produccion para congelar los drafts y revisar publicacion."
      : "Agrega evidencia en allowlist para desbloquear los assets detectados.";
  return {
    status,
    queuePath: latestQueue?.queuePath || null,
    generatedAt: latestQueue?.generatedAt || null,
    sourceAssets: assets,
    items,
    nextStep,
  };
}

const sourceSearchBriefs: Record<ClipperAccountCategory, string[]> = {
  sports: [
    "Priorizar highlights recientes de fuentes oficiales, material propio, licenciado o con permiso.",
    "Buscar jugadas con payoff claro en menos de 12 segundos y contexto facil de explicar.",
    "Evitar logos/feeds no autorizados si no existe licencia o permiso guardado.",
  ],
  memes: [
    "Priorizar formatos originales o templates con permiso, public-domain o remix-safe.",
    "Buscar momentos con remate visual inmediato y texto corto para loop.",
    "Evitar reposts sin permiso, marcas de agua ajenas y clips donde el creador no haya autorizado.",
  ],
  streamers: [
    "Priorizar VODs propios, creadores en allowlist o clips con aprobacion explicita.",
    "Buscar setup + payoff, reaccion de chat o fail/victoria inesperada.",
    "Guardar evidencia del creador/canal y limites de uso antes de editar.",
  ],
};

function buildSourceAcquisitionCategories(
  accounts: ClipperAccount[],
  queue: ClipperProductionQueueSummary
): ClipperSourceAcquisitionCategory[] {
  const categories: ClipperAccountCategory[] = ["sports", "memes", "streamers"];
  const targetWeeklyClips = 100;
  const totalDailySlots = Math.max(1, accounts.reduce((sum, account) => sum + account.dailyClipTarget, 0));
  return categories.map((category) => {
    const categoryAccounts = accounts.filter((account) => account.category === category);
    const dailySlots = categoryAccounts.reduce((sum, account) => sum + account.dailyClipTarget, 0);
    const weeklyTargetSlots = dailySlots > 0 ? Math.max(1, Math.round(targetWeeklyClips * (dailySlots / totalDailySlots))) : 0;
    const weeklyConfiguredSlots = dailySlots * 7;
    const categoryAssets = queue.sourceAssets.filter((asset) => asset.category === category);
    const rightsReadyAssets = categoryAssets.filter((asset) => asset.rightsStatus === "owned_or_permissioned").length;
    const categoryItems = queue.items.filter((item) => item.category === category);
    const readyQueueSlots = categoryItems.filter((item) => item.status === "draft_ready").length;
    const rightsReviewSlots = categoryItems.filter((item) => item.status === "rights_review").length;
    const missingSourceSlots = categoryItems.filter((item) => item.status === "needs_source").length;
    const weeklyReadySlots = readyQueueSlots * 7;
    const weeklyMissingSourceSlots = Math.max(0, weeklyTargetSlots - weeklyReadySlots);
    const minimumRecommendedAssets = Math.max(1, Math.ceil(dailySlots / 3));
    const minimumWeeklySourceAssets = Math.max(minimumRecommendedAssets, Math.ceil(weeklyTargetSlots / 3));
    const priority: ClipperSourceAcquisitionCategory["priority"] = missingSourceSlots > 0
      ? "critical"
      : rightsReviewSlots > 0 || readyQueueSlots < dailySlots
        ? "high"
        : "watch";

    return {
      category,
      label: getClipperCategoryLabel(category),
      sourceFolder: getSourceFolderForCategory(category),
      dailySlots,
      weeklyTargetSlots,
      weeklyConfiguredSlots,
      weeklyReadySlots,
      weeklyMissingSourceSlots,
      sourceAssets: categoryAssets.length,
      rightsReadyAssets,
      readyQueueSlots,
      rightsReviewSlots,
      missingSourceSlots,
      minimumRecommendedAssets,
      minimumWeeklySourceAssets,
      priority,
      searchBrief: sourceSearchBriefs[category],
      evidenceRequired: [
        "Fuente original o archivo propio/licenciado.",
        "Permiso, licencia, link oficial o aprobacion del creador/rightsholder.",
        "Notas de uso permitido y restricciones antes de marcar Rights OK.",
      ],
      nextStep: readyQueueSlots >= dailySlots
        ? "Hay suficientes slots listos; generar draft specs y medir variantes."
        : weeklyMissingSourceSlots > 0
          ? `Agregar al menos ${Math.max(0, minimumWeeklySourceAssets - rightsReadyAssets)} assets con derechos a ${getSourceFolderForCategory(category)} para cubrir ${weeklyMissingSourceSlots} clips/semana.`
          : missingSourceSlots > 0
            ? `Agregar assets a ${getSourceFolderForCategory(category)} para cubrir ${missingSourceSlots} slots sin fuente.`
          : "Marcar Rights OK solo despues de guardar evidencia en allowlist.",
    };
  });
}

async function buildSourceAcquisitionSummary(
  accounts: ClipperAccount[],
  queue: ClipperProductionQueueSummary
): Promise<ClipperSourceAcquisitionSummary> {
  await ensureClipperDirs();
  const categories = buildSourceAcquisitionCategories(accounts, queue);
  const totals = categories.reduce<ClipperSourceAcquisitionSummary["totals"]>((acc, category) => ({
    dailySlots: acc.dailySlots + category.dailySlots,
    targetWeeklyClips: acc.targetWeeklyClips + category.weeklyTargetSlots,
    configuredWeeklySlots: acc.configuredWeeklySlots + category.weeklyConfiguredSlots,
    weeklyReadySlots: acc.weeklyReadySlots + category.weeklyReadySlots,
    weeklyMissingSourceSlots: acc.weeklyMissingSourceSlots + category.weeklyMissingSourceSlots,
    minimumWeeklySourceAssets: acc.minimumWeeklySourceAssets + category.minimumWeeklySourceAssets,
    readyQueueSlots: acc.readyQueueSlots + category.readyQueueSlots,
    rightsReviewSlots: acc.rightsReviewSlots + category.rightsReviewSlots,
    missingSourceSlots: acc.missingSourceSlots + category.missingSourceSlots,
    sourceAssets: acc.sourceAssets + category.sourceAssets,
    rightsReadyAssets: acc.rightsReadyAssets + category.rightsReadyAssets,
  }), {
    dailySlots: 0,
    targetWeeklyClips: 0,
    configuredWeeklySlots: 0,
    weeklyReadySlots: 0,
    weeklyMissingSourceSlots: 0,
    minimumWeeklySourceAssets: 0,
    readyQueueSlots: 0,
    rightsReviewSlots: 0,
    missingSourceSlots: 0,
    sourceAssets: 0,
    rightsReadyAssets: 0,
  });
  const generatedAt = await stat(SOURCE_ACQUISITION_PLAN_PATH).then((file) => file.mtime.toISOString()).catch(() => null);
  const status: ClipperSourceAcquisitionStatus = totals.readyQueueSlots >= totals.dailySlots && totals.dailySlots > 0
    ? "ready"
    : totals.readyQueueSlots > 0 || totals.rightsReviewSlots > 0 || totals.sourceAssets > 0
      ? "partial"
      : "blocked";

  return {
    status,
    generatedAt,
    manifestPath: SOURCE_ACQUISITION_PLAN_PATH,
    markdownPath: SOURCE_ACQUISITION_PLAN_MARKDOWN_PATH,
    categories,
    totals,
    nextStep: status === "ready"
      ? "Generar draft specs y ejecutar ciclo diario en approval_required."
      : totals.missingSourceSlots > 0
        ? "Buscar/subir fuentes recientes por categoria y guardar evidencia antes de producir."
        : "Completar evidencia allowlist para convertir rights_review en draft_ready.",
  };
}

function renderSourceAcquisitionMarkdown(summary: ClipperSourceAcquisitionSummary): string {
  return [
    "# Clippers Source Acquisition Plan",
    "",
    `Status: ${summary.status}`,
    `Daily slots: ${summary.totals.dailySlots}`,
    `Weekly target clips: ${summary.totals.targetWeeklyClips}`,
    `Configured weekly slots: ${summary.totals.configuredWeeklySlots}`,
    `Weekly ready slots: ${summary.totals.weeklyReadySlots}`,
    `Weekly missing source slots: ${summary.totals.weeklyMissingSourceSlots}`,
    `Minimum weekly source assets: ${summary.totals.minimumWeeklySourceAssets}`,
    `Ready slots: ${summary.totals.readyQueueSlots}`,
    `Rights review slots: ${summary.totals.rightsReviewSlots}`,
    `Missing source slots: ${summary.totals.missingSourceSlots}`,
    `Generated at: ${summary.generatedAt || new Date().toISOString()}`,
    "",
    "## Daily Category Plan",
    "",
    ...summary.categories.flatMap((category) => [
      `### ${category.label}`,
      "",
      `Priority: ${category.priority}`,
      `Daily slots: ${category.dailySlots}`,
      `Weekly target slots: ${category.weeklyTargetSlots}`,
      `Configured weekly slots: ${category.weeklyConfiguredSlots}`,
      `Weekly ready slots: ${category.weeklyReadySlots}`,
      `Weekly missing source slots: ${category.weeklyMissingSourceSlots}`,
      `Source assets: ${category.sourceAssets}`,
      `Rights-ready assets: ${category.rightsReadyAssets}`,
      `Ready queue slots: ${category.readyQueueSlots}`,
      `Rights review slots: ${category.rightsReviewSlots}`,
      `Missing source slots: ${category.missingSourceSlots}`,
      `Minimum recommended assets: ${category.minimumRecommendedAssets}`,
      `Minimum weekly source assets: ${category.minimumWeeklySourceAssets}`,
      `Source folder: ${category.sourceFolder}`,
      "",
      "Search brief:",
      ...category.searchBrief.map((item) => `- ${item}`),
      "",
      "Evidence required:",
      ...category.evidenceRequired.map((item) => `- ${item}`),
      "",
      `Next step: ${category.nextStep}`,
      "",
    ]),
    "## Guardrails",
    "",
    "- Do not publish or edit third-party clips without saved permission/license evidence.",
    "- Use Rights OK only after evidence exists in allowlist or secure Drive.",
    "- Keep approval_required until accounts, OAuth tokens and platform permissions are verified.",
    "",
  ].join("\n");
}

function sourceHuntPaths(huntDate: string) {
  const safeDate = huntDate.replace(/[^0-9-]/g, "").slice(0, 10) || new Date().toISOString().slice(0, 10);
  return {
    manifestPath: path.join(SOURCE_HUNTS_DIR, `source-hunt-${safeDate}.json`),
    csvPath: path.join(SOURCE_HUNTS_DIR, `source-hunt-${safeDate}.csv`),
    markdownPath: path.join(SOURCE_HUNTS_DIR, `source-hunt-${safeDate}.md`),
  };
}

function csvCell(value: unknown): string {
  const text = Array.isArray(value) ? value.join(" | ") : String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, "\"\"")}"` : text;
}

function buildSourceHuntItems(queue: ClipperProductionQueueSummary, huntDate: string): ClipperSourceHuntItem[] {
  return queue.items.map((item, index) => {
    const status: ClipperSourceHuntItemStatus = item.status === "draft_ready"
      ? "ready_for_draft"
      : item.status === "rights_review"
        ? "needs_rights"
        : "needs_source";
    const brief = sourceSearchBriefs[item.category][index % sourceSearchBriefs[item.category].length];
    const sourceFolder = getSourceFolderForCategory(item.category);
    const requiredInputs = requiredInputsForSourceStatus(status, item.category, item.sourcePath);
    return {
      id: hashId(`${huntDate}-${item.id}-${item.slotNumber}`),
      huntDate,
      status,
      accountId: item.accountId,
      accountName: item.accountName,
      category: item.category,
      slotNumber: item.slotNumber,
      targetHook: item.hook,
      variantAngle: item.variantAngle,
      clipObjective: item.clipObjective,
      publishWindow: item.publishWindow,
      platforms: item.platforms,
      sourceFolder,
      sourcePath: item.sourcePath,
      rightsStatus: item.rightsStatus,
      suggestedSearch: brief,
      evidenceNeeded: "Guardar source original, permiso/licencia/aprobacion, link oficial o notas de uso antes de Rights OK.",
      requiredInputs,
      completionHint: completionHintForSourceStatus(status),
      sourceRightsRecordTemplate: buildSourceRightsRecordTemplate({
        category: item.category,
        accountName: item.accountName,
        targetHook: item.hook,
        sourcePath: item.sourcePath,
        sourceFolder,
      }),
      nextStep: status === "ready_for_draft"
        ? "Generar draft spec para este slot."
        : status === "needs_rights"
          ? "Guardar evidencia en allowlist y marcar Rights OK."
          : `Buscar/subir video fuente en ${getSourceFolderForCategory(item.category)}.`,
    };
  });
}

function buildSourceHuntSummary(queue: ClipperProductionQueueSummary, huntDate: string): ClipperSourceHuntSummary {
  const paths = sourceHuntPaths(huntDate);
  const items = buildSourceHuntItems(queue, huntDate);
  const totals = {
    items: items.length,
    needsSource: items.filter((item) => item.status === "needs_source").length,
    needsRights: items.filter((item) => item.status === "needs_rights").length,
    readyForDraft: items.filter((item) => item.status === "ready_for_draft").length,
  };
  const status: ClipperSourceHuntStatus = totals.readyForDraft >= totals.items && totals.items > 0
    ? "ready"
    : totals.readyForDraft > 0 || totals.needsRights > 0
      ? "partial"
      : "blocked";

  return {
    status,
    generatedAt: null,
    huntDate,
    ...paths,
    items,
    totals,
    nextStep: status === "ready"
      ? "Todos los slots tienen fuente y derechos; generar draft specs."
      : totals.needsSource > 0
        ? `Buscar/subir fuentes para ${totals.needsSource} slots y documentar permisos.`
        : `Completar evidencia de derechos para ${totals.needsRights} slots.`,
  };
}

function renderSourceHuntCsv(summary: ClipperSourceHuntSummary): string {
  const headers = [
    "hunt_date",
    "status",
    "category",
    "account_id",
    "account_name",
    "slot_number",
    "target_hook",
    "variant_angle",
    "clip_objective",
    "publish_window",
    "platforms",
    "suggested_search",
    "source_folder",
    "source_path",
    "rights_status",
    "evidence_needed",
    "required_inputs",
    "completion_hint",
    "source_rights_record_template",
    "next_step",
  ];
  const rows = summary.items.map((item) => [
    item.huntDate,
    item.status,
    item.category,
    item.accountId,
    item.accountName,
    item.slotNumber,
    item.targetHook,
    item.variantAngle,
    item.clipObjective,
    item.publishWindow,
    item.platforms,
    item.suggestedSearch,
    item.sourceFolder,
    item.sourcePath || "",
    item.rightsStatus,
    item.evidenceNeeded,
    item.requiredInputs,
    item.completionHint,
    item.sourceRightsRecordTemplate,
    item.nextStep,
  ]);
  return [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\n") + "\n";
}

function renderSourceHuntMarkdown(summary: ClipperSourceHuntSummary): string {
  return [
    `# Clippers Source Hunt Sheet: ${summary.huntDate}`,
    "",
    `Status: ${summary.status}`,
    `Slots: ${summary.totals.items}`,
    `Needs source: ${summary.totals.needsSource}`,
    `Needs rights: ${summary.totals.needsRights}`,
    `Ready for draft: ${summary.totals.readyForDraft}`,
    `Generated at: ${summary.generatedAt || new Date().toISOString()}`,
    "",
    "## Slots",
    "",
    ...summary.items.map((item) => [
      `### ${item.accountName} slot ${item.slotNumber}`,
      "",
      `Status: ${item.status}`,
      `Category: ${item.category}`,
      `Hook: ${item.targetHook}`,
      `Angle: ${item.variantAngle}`,
      `Objective: ${item.clipObjective}`,
      `Window: ${item.publishWindow}`,
      `Platforms: ${item.platforms.join(", ")}`,
      `Search: ${item.suggestedSearch}`,
      `Source folder: ${item.sourceFolder}`,
      `Evidence: ${item.evidenceNeeded}`,
      "Required inputs:",
      ...item.requiredInputs.map((input) => `- ${input}`),
      `Completion hint: ${item.completionHint}`,
      `Next step: ${item.nextStep}`,
      "",
      "Source rights record template:",
      "",
      "```yaml",
      item.sourceRightsRecordTemplate,
      "```",
      "",
    ].join("\n")),
  ].join("\n");
}

async function readLatestSourceHuntSummary(): Promise<ClipperSourceHuntSummary | null> {
  await ensureClipperDirs();
  const files = await readdir(SOURCE_HUNTS_DIR).catch(() => []);
  const huntFiles = files.filter((file) => file.startsWith("source-hunt-") && file.endsWith(".json")).sort().reverse();
  if (!huntFiles[0]) return null;
  try {
    const raw = await readFile(path.join(SOURCE_HUNTS_DIR, huntFiles[0]), "utf8");
    return JSON.parse(raw) as ClipperSourceHuntSummary;
  } catch {
    return null;
  }
}

function rightsTemplateForCategory(category: ClipperAccountCategory): ClipperRightsOutreachTemplate {
  const label = CLIPPER_CATEGORY_LABELS[category];
  const subject = category === "sports"
    ? "Permission request: short highlight clip with credit"
    : category === "memes"
      ? "Permission request: remix-safe short clip"
      : "Permission request: streamer clip/highlight";
  const message = [
    `Hi, we run a rights-first short-form ${label.toLowerCase()} clipping account.`,
    "We want to use a short clip only if you approve it. We can credit the creator/source, follow any caption/link requirements, remove the post on request, and keep the approval record in our allowlist before publishing.",
    "Please reply with approval, any usage limits, required credit, expiration date if any, and the source URL/file you authorize.",
  ].join(" ");
  return {
    category,
    label,
    channel: "dm_or_email",
    subject,
    message,
    evidenceToRequest: [
      "Written approval from creator/rightsholder or official source/licensing proof.",
      "Source URL or file name being approved.",
      "Allowed platforms: TikTok, Instagram Reels, YouTube Shorts.",
      "Required credit/caption/link language.",
      "Expiration, territory or usage limits if any.",
    ],
  };
}

function buildRightsOutreachItem(item: ClipperSourceHuntItem): ClipperRightsOutreachItem {
  const template = rightsTemplateForCategory(item.category);
  const status: ClipperRightsOutreachItemStatus = item.status === "ready_for_draft"
    ? "permission_recorded"
    : item.status === "needs_rights"
      ? "ready_to_contact"
      : "needs_target";
  const requiredInputs = status === "permission_recorded"
    ? [
      "Confirmar vigencia del permiso antes de producir.",
      "Revisar credito/restricciones en la evidencia guardada.",
    ]
    : status === "ready_to_contact"
      ? [
        "Contacto real del creador/rightsholder.",
        "Respuesta aprobando el asset o fuente exacta.",
        "Credito requerido, plataformas, expiracion y limites de uso.",
        "Link de evidencia en Drive o allowlist antes de editar/publicar.",
      ]
      : [
        "Fuente o asset real que se quiere usar.",
        "Handle/email/contacto del creador o rightsholder.",
        "Prueba de que el material puede licenciarse o pedirse legalmente.",
      ];
  return {
    id: `rights-${item.id}`,
    status,
    category: item.category,
    accountId: item.accountId,
    accountName: item.accountName,
    targetHook: item.targetHook,
    suggestedSearch: item.suggestedSearch,
    sourceFolder: item.sourceFolder,
    evidenceNeeded: item.evidenceNeeded,
    outreachSubject: template.subject,
    outreachMessage: `${template.message} Context we want to cover: ${item.targetHook}. Suggested search/source: ${item.suggestedSearch}.`,
    permissionRecordTemplate: item.sourceRightsRecordTemplate,
    requiredInputs,
    completionHint: status === "permission_recorded"
      ? "Cuando la evidencia siga vigente, este item puede pasar a draft spec."
      : status === "ready_to_contact"
        ? "Cuando llegue aprobacion real, copia los datos al record template y guarda la evidencia."
        : "Cuando encuentres target real, vuelve a generar outreach para contactar con contexto preciso.",
    nextStep: status === "permission_recorded"
      ? "Permiso/evidencia ya registrada; generar draft spec."
      : status === "ready_to_contact"
        ? "Contactar creator/rightsholder y guardar respuesta en allowlist antes de publicar."
        : "Encontrar target/source real y luego enviar outreach de permiso.",
  };
}

async function buildRightsOutreachSummary(sourceHunt: ClipperSourceHuntSummary): Promise<ClipperRightsOutreachSummary> {
  const templates = (["sports", "memes", "streamers"] as ClipperAccountCategory[]).map(rightsTemplateForCategory);
  const items = sourceHunt.items
    .filter((item) => item.status !== "ready_for_draft")
    .map(buildRightsOutreachItem);
  const totals = items.reduce<ClipperRightsOutreachSummary["totals"]>((sum, item) => {
    sum.items += 1;
    if (item.status === "needs_target") sum.needsTarget += 1;
    if (item.status === "ready_to_contact") sum.readyToContact += 1;
    if (item.status === "permission_recorded") sum.permissionRecorded += 1;
    return sum;
  }, { items: 0, needsTarget: 0, readyToContact: 0, permissionRecorded: 0 });
  const generatedAt = await stat(RIGHTS_OUTREACH_PATH).then((file) => file.mtime.toISOString()).catch(() => null);
  const status: ClipperRightsOutreachStatus = !generatedAt
    ? "not_prepared"
    : totals.items === 0 || totals.permissionRecorded === totals.items
      ? "ready"
      : totals.readyToContact > 0
        ? "partial"
        : "blocked";
  return {
    status,
    generatedAt,
    manifestPath: RIGHTS_OUTREACH_PATH,
    markdownPath: RIGHTS_OUTREACH_MARKDOWN_PATH,
    templatesPath: RIGHTS_OUTREACH_TEMPLATES_PATH,
    items,
    templates,
    totals,
    nextStep: totals.readyToContact > 0
      ? `Enviar ${totals.readyToContact} mensajes de permiso y guardar evidencia en allowlist.`
      : totals.needsTarget > 0
        ? `Buscar targets reales para ${totals.needsTarget} slots antes de contactar.`
        : "Rights outreach listo; todos los slots pendientes tienen permiso o no requieren contacto.",
  };
}

function renderRightsOutreachMarkdown(summary: ClipperRightsOutreachSummary): string {
  return [
    "# Clippers Creator Rights Outreach Pack",
    "",
    `Status: ${summary.status}`,
    `Generated: ${summary.generatedAt || new Date().toISOString()}`,
    `Totals: ${summary.totals.items} items, ${summary.totals.needsTarget} need target, ${summary.totals.readyToContact} ready_to_contact, ${summary.totals.permissionRecorded} permission_recorded`,
    "",
    "## Next Step",
    "",
    summary.nextStep,
    "",
    "## Outreach Items",
    "",
    ...summary.items.flatMap((item) => [
      `### ${item.accountName} / ${CLIPPER_CATEGORY_LABELS[item.category]}`,
      "",
      `- Status: ${item.status}`,
      `- Hook: ${item.targetHook}`,
      `- Suggested search: ${item.suggestedSearch}`,
      `- Source folder: ${item.sourceFolder}`,
      `- Evidence needed: ${item.evidenceNeeded}`,
      "- Required inputs:",
      ...item.requiredInputs.map((input) => `  - ${input}`),
      `- Completion hint: ${item.completionHint}`,
      `- Next step: ${item.nextStep}`,
      "",
      `Subject: ${item.outreachSubject}`,
      "",
      item.outreachMessage,
      "",
      "Permission record template:",
      "",
      "```yaml",
      item.permissionRecordTemplate,
      "```",
      "",
    ]),
  ].join("\n");
}

function renderRightsOutreachTemplates(summary: ClipperRightsOutreachSummary): string {
  return [
    "# Clippers Rights Outreach Templates",
    "",
    ...summary.templates.flatMap((template) => [
      `## ${template.label}`,
      "",
      `Channel: ${template.channel}`,
      `Subject: ${template.subject}`,
      "",
      template.message,
      "",
      "Evidence to request:",
      ...template.evidenceToRequest.map((item) => `- ${item}`),
      "",
    ]),
  ].join("\n");
}

export async function prepareClipperRightsOutreachPack(userId = getSystemUserId()): Promise<{ rightsOutreach: ClipperRightsOutreachSummary; status: ClipperStatus }> {
  await writeDefaultConfigIfMissing();
  await ensureClipperDirs();
  const config = await readConfig();
  const oauthConnections = await readOAuthConnections();
  const tokenRecords = await readTokenVaultRecords();
  const accounts = applyOAuthStateToAccounts(
    (Array.isArray(config.accounts) && config.accounts.length ? config.accounts : DEFAULT_ACCOUNTS).map(ensureAccountShape),
    oauthConnections,
    tokenRecords
  );
  const queue = await buildProductionQueueSummary(accounts);
  const sourceHunt = await readLatestSourceHuntSummary() || buildSourceHuntSummary(queue, new Date().toISOString().slice(0, 10));
  const draftSummary = await buildRightsOutreachSummary(sourceHunt);
  const rightsOutreach: ClipperRightsOutreachSummary = {
    ...draftSummary,
    generatedAt: new Date().toISOString(),
    status: draftSummary.totals.items === 0 || draftSummary.totals.permissionRecorded === draftSummary.totals.items
      ? "ready"
      : draftSummary.totals.readyToContact > 0
        ? "partial"
        : "blocked",
  };
  await writeFile(RIGHTS_OUTREACH_PATH, JSON.stringify(rightsOutreach, null, 2));
  await writeFile(RIGHTS_OUTREACH_MARKDOWN_PATH, renderRightsOutreachMarkdown(rightsOutreach));
  await writeFile(RIGHTS_OUTREACH_TEMPLATES_PATH, renderRightsOutreachTemplates(rightsOutreach));
  return { rightsOutreach, status: await getClipperStatus(userId) };
}

function draftSpecId(item: ClipperProductionQueueItem): string {
  return hashId(`${item.id}-${item.accountId}-${item.sourcePath || "missing"}`);
}

function renderDraftSpecMarkdown(spec: ClipperDraftSpecItem): string {
  return [
    `# Draft Spec: ${spec.accountName}`,
    "",
    `Status: ${spec.status}`,
    `Account: ${spec.accountName} (${spec.accountId})`,
    `Category: ${spec.category}`,
    `Daily slot: ${spec.slotNumber}`,
    `Source: ${spec.sourcePath}`,
    `Rights evidence: ${spec.evidencePath || "missing"}`,
    `Publish window: ${spec.publishWindow}`,
    `Platforms: ${spec.platforms.join(", ")}`,
    "",
    "## Creative",
    "",
    `Hook: ${spec.hook}`,
    `Variant angle: ${spec.variantAngle}`,
    `Clip objective: ${spec.clipObjective}`,
    `Caption seed: ${spec.captionSeed}`,
    `Format: ${spec.format}`,
    "",
    "## QA Checklist",
    "",
    ...spec.qaChecklist.map((item) => `- [ ] ${item}`),
    "",
  ].join("\n");
}

async function buildDraftSpecsSummary(queue?: ClipperProductionQueueSummary): Promise<ClipperDraftSpecSummary> {
  await ensureClipperDirs();
  try {
    const raw = await readFile(DRAFT_SPECS_MANIFEST_PATH, "utf8");
    const parsed = JSON.parse(raw) as ClipperDraftSpecSummary;
    if (parsed && Array.isArray(parsed.items)) {
      if (parsed.items.length > 0 || !queue) return parsed;
      const blockedQueueItems = queue.items.filter((item) => item.status !== "draft_ready").length;
      return {
        ...parsed,
        status: blockedQueueItems > 0 ? "blocked" : parsed.status,
        totals: { ...parsed.totals, blockedQueueItems },
        nextStep: blockedQueueItems > 0
          ? "Agregar videos fuente y evidencia de derechos antes de generar draft specs."
          : parsed.nextStep,
      };
    }
  } catch {
    // Fall through to an empty summary.
  }
  const blockedQueueItems = queue?.items.filter((item) => item.status !== "draft_ready").length || 0;
  return {
    status: blockedQueueItems > 0 ? "blocked" : "empty",
    generatedAt: null,
    draftsDir: DRAFTS_DIR,
    manifestPath: DRAFT_SPECS_MANIFEST_PATH,
    items: [],
    totals: { items: 0, readyForEdit: 0, blockedQueueItems },
    nextStep: blockedQueueItems > 0
      ? "Agregar videos fuente y evidencia de derechos antes de generar draft specs."
      : "Generar draft specs desde items con derechos OK en la cola de produccion.",
  };
}

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === "\"" && next === "\"") {
      current += "\"";
      index += 1;
    } else if (char === "\"") {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      values.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  values.push(current.trim());
  return values;
}

function normalizeMetricKey(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function parseCsvRecords(raw: string): Record<string, unknown>[] {
  const lines = raw.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]).map(normalizeMetricKey);
  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    return headers.reduce<Record<string, unknown>>((record, header, index) => {
      record[header] = values[index] ?? "";
      return record;
    }, {});
  });
}

function parseJsonMetricRecords(raw: string): Record<string, unknown>[] {
  const parsed = JSON.parse(raw);
  if (Array.isArray(parsed)) return parsed.filter((item): item is Record<string, unknown> => item && typeof item === "object");
  if (parsed && typeof parsed === "object") {
    const object = parsed as Record<string, unknown>;
    const records = object.records || object.metrics || object.data || object.rows;
    if (Array.isArray(records)) return records.filter((item): item is Record<string, unknown> => item && typeof item === "object");
  }
  return [];
}

function firstString(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = record[key] ?? record[normalizeMetricKey(key)];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return "";
}

function hasTemplatePlaceholder(value: string): boolean {
  const normalized = value.toLowerCase();
  return /<[^>]+>/.test(value)
    || normalized.includes("proof link or note")
    || normalized.includes("request/review evidence")
    || normalized.includes("review notes")
    || normalized.includes("attach app review evidence")
    || normalized.includes("requested as draft/fallback flow")
    || normalized.includes("needed to identify connected")
    || normalized.includes("needed to resolve connected")
    || normalized.includes("oauth consent configured; youtube.upload requested/authorized")
    || normalized.includes("handle=<handle>")
    || normalized.includes("created app; review status=<")
    || normalized.includes("importado por batch")
    || normalized.includes("registrado desde clippers ui")
    || normalized.includes("permiso solicitado/app review en progreso")
    || normalized.includes("cuenta creada o en proceso")
    || normalized.includes("app creada o enviada a review")
    || normalized.includes("solicitado en developer portal")
    || normalized.includes("scope aprobado/app review completada");
}

function requireRealEvidence(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed || hasTemplatePlaceholder(trimmed)) {
    throw new Error(`${label} requiere evidencia real; reemplaza placeholders antes de importar.`);
  }
  return trimmed;
}

function firstNumber(record: Record<string, unknown>, keys: string[]): number {
  const raw = firstString(record, keys);
  if (!raw) return 0;
  const value = Number(raw.replace(/[%,$\s]/g, ""));
  return Number.isFinite(value) ? value : 0;
}

function firstNullableNumber(record: Record<string, unknown>, keys: string[]): number | null {
  const raw = firstString(record, keys);
  if (!raw) return null;
  const value = Number(raw.replace(/[%,$\s]/g, ""));
  if (!Number.isFinite(value)) return null;
  return raw.includes("%") && value > 1 ? value / 100 : value;
}

function resolveMetricAccount(record: Record<string, unknown>, accounts: ClipperAccount[]): ClipperAccount {
  const accountValue = firstString(record, ["account_id", "accountid", "account", "account_name", "profile", "handle", "username"]);
  const normalized = accountValue.toLowerCase().replace(/^@/, "");
  return accounts.find((account) => {
    const handles = account.platformAccounts.map((platformAccount) => platformAccount.handle.toLowerCase().replace(/^@/, ""));
    return account.id === normalized ||
      account.name.toLowerCase() === normalized ||
      account.name.toLowerCase().includes(normalized) ||
      handles.includes(normalized) ||
      handles.some((handle) => normalized.includes(handle));
  }) || accounts[0];
}

function normalizeMetricRecord(
  rawRecord: Record<string, unknown>,
  sourceFile: string,
  index: number,
  accounts: ClipperAccount[]
): ClipperMetricRecord | null {
  if (!accounts[0]) return null;
  const account = resolveMetricAccount(rawRecord, accounts);
  const platform = normalizePlatformLabel(firstString(rawRecord, ["platform", "network", "source"])) || "unknown";
  const clipId = firstString(rawRecord, ["clip_id", "clipid", "video_id", "videoid", "post_id", "postid", "id", "url"]) || `${sourceFile}-${index + 1}`;
  const hook = firstString(rawRecord, ["hook", "caption", "title", "description", "creative", "format"]) || "Sin hook/caption";
  const views = firstNumber(rawRecord, ["views", "view_count", "plays", "impressions", "reproductions", "vistas"]);
  const likes = firstNumber(rawRecord, ["likes", "like_count", "me_gusta"]);
  const comments = firstNumber(rawRecord, ["comments", "comment_count", "comentarios"]);
  const shares = firstNumber(rawRecord, ["shares", "share_count", "compartidos"]);
  const saves = firstNumber(rawRecord, ["saves", "save_count", "bookmarks", "guardados"]);
  const retentionRate = firstNullableNumber(rawRecord, ["retention", "retention_rate", "avg_retention", "average_percentage_viewed", "completion_rate"]);
  const watchTimeSeconds = firstNullableNumber(rawRecord, ["watch_time_seconds", "watch_time", "avg_watch_time", "average_view_duration"]);
  const publishedAt = firstString(rawRecord, ["published_at", "created_at", "date", "post_date"]) || null;

  if (views <= 0 && likes <= 0 && comments <= 0 && shares <= 0 && saves <= 0) return null;

  return {
    id: hashId(`${sourceFile}-${clipId}-${index}`),
    accountId: account.id,
    accountName: account.name,
    platform,
    clipId,
    hook,
    publishedAt,
    views,
    likes,
    comments,
    shares,
    saves,
    retentionRate,
    watchTimeSeconds,
    sourceFile,
  };
}

async function readMetricRecordsFromFile(filePath: string, accounts: ClipperAccount[]): Promise<{ records: ClipperMetricRecord[]; error: string | null }> {
  try {
    const raw = await readFile(filePath, "utf8");
    const ext = path.extname(filePath).toLowerCase();
    const rows = ext === ".json" ? parseJsonMetricRecords(raw) : parseCsvRecords(raw);
    const fileName = path.basename(filePath);
    return {
      records: rows
        .map((row, index) => normalizeMetricRecord(row, fileName, index, accounts))
        .filter((record): record is ClipperMetricRecord => Boolean(record)),
      error: null,
    };
  } catch (error) {
    return {
      records: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function buildMetricPerformance(accounts: ClipperAccount[], records: ClipperMetricRecord[]): ClipperAccountMetricPerformance[] {
  return accounts.map((account) => {
    const accountRecords = records.filter((record) => record.accountId === account.id);
    const views = accountRecords.reduce((sum, record) => sum + record.views, 0);
    const engagement = accountRecords.reduce((sum, record) => sum + record.likes + record.comments + record.shares + record.saves, 0);
    const retentionValues = accountRecords.map((record) => record.retentionRate).filter((value): value is number => typeof value === "number");
    const retentionRate = retentionValues.length ? retentionValues.reduce((sum, value) => sum + value, 0) / retentionValues.length : null;
    const avgViews = accountRecords.length ? Math.round(views / accountRecords.length) : 0;
    const engagementRate = views > 0 ? engagement / views : 0;
    const status: ClipperAccountMetricPerformance["status"] = accountRecords.length === 0
      ? "no_data"
      : views >= account.weeklyViewsGoal
        ? "scaling"
        : views >= account.weeklyViewsGoal * 0.35
          ? "watch"
          : "under_goal";
    const recommendation = status === "scaling"
      ? "Escalar volumen en esta cuenta y duplicar hooks/formatos ganadores."
      : status === "watch"
        ? "Mantener frecuencia, probar 3 hooks nuevos y mover posts hacia mejores ventanas."
        : status === "under_goal"
          ? "Reducir repeticion, cambiar angulos y priorizar clips con retencion/share alto."
          : "Importar metrics export para que Optimizer pueda decidir.";

    return {
      accountId: account.id,
      accountName: account.name,
      clips: accountRecords.length,
      views,
      avgViews,
      engagementRate,
      retentionRate,
      status,
      recommendation,
    };
  });
}

function buildMetricRecommendations(records: ClipperMetricRecord[], performance: ClipperAccountMetricPerformance[]): string[] {
  if (records.length === 0) {
    return ["Importar CSV/JSON de analytics en clippers_workspace/metrics para activar el Optimizer."];
  }

  const topClip = [...records].sort((a, b) => b.views - a.views)[0];
  const highShareClip = [...records].sort((a, b) => b.shares - a.shares)[0];
  const scalingAccounts = performance.filter((account) => account.status === "scaling");
  const noDataAccounts = performance.filter((account) => account.status === "no_data");

  return [
    topClip ? `Duplicar formato ganador: ${topClip.accountName} logro ${topClip.views.toLocaleString("en-US")} views con "${topClip.hook}".` : null,
    highShareClip && highShareClip.shares > 0 ? `Crear variaciones del clip con mas shares: ${highShareClip.hook} (${highShareClip.shares.toLocaleString("en-US")} shares).` : null,
    scalingAccounts.length ? `Subir volumen en ${scalingAccounts.map((account) => account.accountName).join(", ")}.` : "Ninguna cuenta supero meta semanal todavia; mantener approval_required y seguir testeando.",
    noDataAccounts.length ? `Faltan metrics para ${noDataAccounts.map((account) => account.accountName).join(", ")}.` : "Todas las cuentas tienen data importada.",
  ].filter((item): item is string => Boolean(item));
}

function normalizeTrendCategory(value: string): ClipperAccountCategory {
  const normalized = value.toLowerCase();
  if (normalized.includes("sport") || normalized.includes("deporte")) return "sports";
  if (normalized.includes("stream") || normalized.includes("creator")) return "streamers";
  if (normalized.includes("meme") || normalized.includes("humor")) return "memes";
  return "memes";
}

function parseDateOrNull(value: string): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

async function findTrendRightsEvidence(title: string, url: string | null): Promise<string | null> {
  const slug = (url || title).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
  const candidates = [
    path.join(ROOT_DIR, "allowlist", `${slug}.md`),
    path.join(ROOT_DIR, "allowlist", `${slug}.json`),
  ];
  for (const candidate of candidates) {
    try {
      if ((await stat(candidate)).isFile()) return candidate;
    } catch {
      // Keep checking the remaining possible evidence names.
    }
  }
  return null;
}

async function normalizeTrendCandidate(rawRecord: Record<string, unknown>, sourceFile: string, index: number): Promise<ClipperTrendCandidate | null> {
  const title = firstString(rawRecord, ["title", "hook", "caption", "description", "topic", "trend"]);
  const url = firstString(rawRecord, ["url", "link", "video_url", "post_url"]) || null;
  if (!title && !url) return null;

  const category = normalizeTrendCategory(firstString(rawRecord, ["category", "vertical", "account_category", "niche"]));
  const platform = normalizePlatformLabel(firstString(rawRecord, ["platform", "network", "source"])) || "unknown";
  const source = firstString(rawRecord, ["source", "creator", "handle", "channel", "profile"]) || sourceFile;
  const postedDate = parseDateOrNull(firstString(rawRecord, ["posted_at", "published_at", "created_at", "date"]));
  const ageHours = postedDate ? Math.max(1, (Date.now() - postedDate.getTime()) / 36e5) : null;
  const views = firstNumber(rawRecord, ["views", "view_count", "plays", "impressions", "vistas"]);
  const likes = firstNumber(rawRecord, ["likes", "like_count"]);
  const comments = firstNumber(rawRecord, ["comments", "comment_count"]);
  const shares = firstNumber(rawRecord, ["shares", "share_count"]);
  const rightsHint = firstString(rawRecord, ["rights", "rights_status", "permission", "license"]).toLowerCase();
  const evidencePath = await findTrendRightsEvidence(title || url || sourceFile, url);
  const rightsStatus: ClipperAssetRightsStatus = evidencePath || /owned|licensed|permission|approved|allowlist/.test(rightsHint)
    ? "owned_or_permissioned"
    : "review_required";
  const velocityScore = Math.round((views / (ageHours || 24)) + shares * 8 + comments * 2 + likes * 0.5);
  const recencyBoost = ageHours === null ? 0.7 : ageHours <= 24 ? 1.3 : ageHours <= 72 ? 1 : 0.65;
  const rightsPenalty = rightsStatus === "owned_or_permissioned" ? 1 : 0.55;
  const viralScore = Math.max(1, Math.round(velocityScore * recencyBoost * rightsPenalty));

  return {
    id: hashId(`${sourceFile}-${title}-${url || index}`),
    category,
    platform,
    title: title || url || "Untitled trend",
    url,
    source,
    postedAt: postedDate ? postedDate.toISOString() : null,
    ageHours,
    views,
    likes,
    comments,
    shares,
    velocityScore,
    viralScore,
    rightsStatus,
    evidencePath,
    hookAngle: firstString(rawRecord, ["angle", "hook_angle", "why_it_works"]) || `Recrear con contexto ${categoryLabelsForBackend(category)} y final en loop.`,
    nextStep: rightsStatus === "owned_or_permissioned"
      ? "Mover a source/draft y crear 2 variantes de hook."
      : "Pedir permiso o agregar evidencia en allowlist antes de producir.",
  };
}

function categoryLabelsForBackend(category: ClipperAccountCategory): string {
  return category === "sports" ? "deportivo" : category === "streamers" ? "streamer" : "meme";
}

async function readTrendCandidatesFromFile(filePath: string): Promise<{ candidates: ClipperTrendCandidate[]; error: string | null }> {
  try {
    const raw = await readFile(filePath, "utf8");
    const ext = path.extname(filePath).toLowerCase();
    const rows = ext === ".json" ? parseJsonMetricRecords(raw) : parseCsvRecords(raw);
    const fileName = path.basename(filePath);
    const candidates = await Promise.all(rows.map((row, index) => normalizeTrendCandidate(row, fileName, index)));
    return {
      candidates: candidates.filter((candidate): candidate is ClipperTrendCandidate => Boolean(candidate)),
      error: null,
    };
  } catch (error) {
    return {
      candidates: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function buildTrendRecommendations(candidates: ClipperTrendCandidate[]): string[] {
  if (!candidates.length) return ["Importar oportunidades CSV/JSON en clippers_workspace/trends para activar Trend Radar."];
  const ready = candidates.filter((candidate) => candidate.rightsStatus === "owned_or_permissioned");
  const review = candidates.filter((candidate) => candidate.rightsStatus === "review_required");
  const top = [...candidates].sort((a, b) => b.viralScore - a.viralScore)[0];
  return [
    top ? `Prioridad: ${top.title} (${top.category}, score ${top.viralScore.toLocaleString("en-US")}).` : null,
    ready.length ? `${ready.length} oportunidades tienen permiso/evidencia y pueden pasar a drafts.` : null,
    review.length ? `${review.length} oportunidades necesitan permiso/allowlist antes de editar.` : null,
    "Crear 2 variantes por oportunidad: hook directo y hook de contexto.",
  ].filter((item): item is string => Boolean(item));
}

const viralDiscoveryAngles: Record<ClipperAccountCategory, Array<{
  sourceType: ClipperViralDiscoveryItem["sourceType"];
  priority: ClipperViralDiscoveryPriority;
  query: string;
  recencyWindow: string;
  viralSignals: string[];
  rightsGate: string;
}>> = {
  sports: [
    {
      sourceType: "official_channel",
      priority: "must_scan",
      query: "today viral sports highlight official clip buzzer beater upset injury comeback",
      recencyWindow: "0-12h",
      viralSignals: ["views velocity", "comments arguing", "reposts by official/team accounts"],
      rightsGate: "Prefer official/team/league source or owned commentary; record URL and permission/evidence before edit.",
    },
    {
      sourceType: "news_or_forum",
      priority: "watch",
      query: "breaking sports moment trending today fan reaction explained",
      recencyWindow: "0-24h",
      viralSignals: ["topic repeated across outlets", "debate angle", "fast follow-up potential"],
      rightsGate: "Use sourced facts plus owned narration; avoid reposting broadcast footage without rights.",
    },
    {
      sourceType: "platform_search",
      priority: "experimental",
      query: "sports reaction meme template today locker room celebration",
      recencyWindow: "0-48h",
      viralSignals: ["template reuse", "duet/stitch density", "caption pattern emerging"],
      rightsGate: "Treat as review_required until creator/asset permission is documented.",
    },
  ],
  memes: [
    {
      sourceType: "platform_search",
      priority: "must_scan",
      query: "viral meme today POV template trending sound relatable",
      recencyWindow: "0-12h",
      viralSignals: ["same joke format repeated", "sound reused fast", "save/share heavy comments"],
      rightsGate: "Recreate format with owned footage/graphics; do not copy creator video without permission.",
    },
    {
      sourceType: "creator_watchlist",
      priority: "watch",
      query: "meme creator trending format original sound today",
      recencyWindow: "0-24h",
      viralSignals: ["creator spawned copies", "comments tagging friends", "cross-platform reposts"],
      rightsGate: "Contact creator or remake from scratch with original assets.",
    },
    {
      sourceType: "news_or_forum",
      priority: "experimental",
      query: "internet culture meme of the day trending reddit twitter tiktok",
      recencyWindow: "0-48h",
      viralSignals: ["phrase spikes", "screenshots circulating", "low-production format"],
      rightsGate: "Use commentary/screenshot only when allowed; store source and fair-use rationale for review.",
    },
  ],
  streamers: [
    {
      sourceType: "creator_watchlist",
      priority: "must_scan",
      query: "streamer clip viral today rage funny clutch reaction",
      recencyWindow: "0-12h",
      viralSignals: ["chat quote becomes caption", "clip reposted by fan pages", "reaction chain"],
      rightsGate: "Need streamer permission, official clip policy, or allowlist evidence before editing.",
    },
    {
      sourceType: "platform_search",
      priority: "watch",
      query: "gaming stream highlight trending today unbelievable moment",
      recencyWindow: "0-24h",
      viralSignals: ["high comments per view", "duets/reactions", "clip title variants"],
      rightsGate: "Record source URL and rights policy; block if unclear.",
    },
    {
      sourceType: "news_or_forum",
      priority: "experimental",
      query: "streamer drama funny clip explained today community reaction",
      recencyWindow: "0-48h",
      viralSignals: ["community debate", "short context needed", "search interest rising"],
      rightsGate: "Prefer owned narration and screenshots allowed by source policy; avoid raw VOD reuse without permission.",
    },
  ],
};

function viralDiscoverySearchUrl(platform: ClipperPlatform, query: string): string {
  const encoded = encodeURIComponent(query);
  if (platform === "youtube") return `https://www.youtube.com/results?search_query=${encoded}&sp=EgIIAg%253D%253D`;
  if (platform === "tiktok") return `https://www.tiktok.com/search?q=${encoded}`;
  return `https://www.instagram.com/explore/search/keyword/?q=${encoded}`;
}

function buildViralTrendImportRow(input: {
  category: ClipperAccountCategory;
  platform: ClipperPlatform;
  discoveryDate: string;
  query: string;
  priority: ClipperViralDiscoveryPriority;
}): string {
  return [
    input.category,
    input.platform,
    "PASTE_TITLE",
    "PASTE_URL",
    "PASTE_SOURCE_HANDLE",
    `${input.discoveryDate}T00:00:00Z`,
    "",
    "",
    "",
    "",
    "review",
    `${input.priority}: ${input.query}`,
  ].map(csvCell).join(",");
}

function buildViralDiscoveryItems(accounts: ClipperAccount[], discoveryDate: string): ClipperViralDiscoveryItem[] {
  return accounts.flatMap((account) =>
    (account.platformAccounts.length ? account.platformAccounts.map((platformAccount) => platformAccount.platform) : account.platforms as ClipperPlatform[])
      .flatMap((platform) =>
        viralDiscoveryAngles[account.category].map((angle, index) => {
          const categoryLabel = categoryLabelsForBackend(account.category);
          const query = `${angle.query} ${categoryLabel} ${platform} ${discoveryDate}`;
          return {
            id: hashId(`${discoveryDate}-${account.id}-${platform}-${index}-${angle.query}`),
            discoveryDate,
            category: account.category,
            platform,
            accountId: account.id,
            accountName: account.name,
            priority: angle.priority,
            query,
            searchUrl: viralDiscoverySearchUrl(platform, query),
            sourceType: angle.sourceType,
            recencyWindow: angle.recencyWindow,
            viralSignals: angle.viralSignals,
            rightsGate: angle.rightsGate,
            importTemplate: "category,platform,title,url,source,posted_at,views,likes,comments,shares,rights,angle",
            trendImportRow: buildViralTrendImportRow({
              category: account.category,
              platform,
              discoveryDate,
              query,
              priority: angle.priority,
            }),
            nextStep: "Abrir busqueda, capturar candidatos en trend-opportunities-template.csv y no mover a drafts sin rights evidence.",
          };
        })
      )
  );
}

function viralDiscoveryTargetCandidates(priority: ClipperViralDiscoveryPriority): number {
  if (priority === "must_scan") return 3;
  if (priority === "watch") return 2;
  return 1;
}

function viralDiscoveryMinimumViews(platform: ClipperPlatform, priority: ClipperViralDiscoveryPriority): number {
  const base = platform === "youtube" ? 25_000 : platform === "instagram" ? 50_000 : 75_000;
  if (priority === "must_scan") return base;
  if (priority === "watch") return Math.round(base * 0.6);
  return Math.round(base * 0.35);
}

function viralDiscoveryPriorityWeight(priority: ClipperViralDiscoveryPriority): number {
  if (priority === "must_scan") return 0;
  if (priority === "watch") return 1;
  return 2;
}

function buildViralDiscoverySessionOrder(items: ClipperViralDiscoveryItem[]): ClipperViralDiscoverySessionItem[] {
  const categoryOrder: Record<ClipperAccountCategory, number> = { sports: 0, memes: 1, streamers: 2 };
  const platformOrder: Record<ClipperPlatform, number> = { tiktok: 0, instagram: 1, youtube: 2 };
  return [...items]
    .sort((left, right) =>
      viralDiscoveryPriorityWeight(left.priority) - viralDiscoveryPriorityWeight(right.priority)
      || categoryOrder[left.category] - categoryOrder[right.category]
      || platformOrder[left.platform] - platformOrder[right.platform]
      || left.query.localeCompare(right.query)
    )
    .map((item, index) => {
      const targetCandidates = viralDiscoveryTargetCandidates(item.priority);
      return {
        rank: index + 1,
        itemId: item.id,
        category: item.category,
        platform: item.platform,
        accountName: item.accountName,
        priority: item.priority,
        searchUrl: item.searchUrl,
        targetCandidates,
        minimumViews: viralDiscoveryMinimumViews(item.platform, item.priority),
        minimumEngagementSignal: "Priorizar alta velocidad: comments+shares visibles, reposts/duets/reactions, o varias cuentas copiando el mismo formato.",
        scanMinutes: item.priority === "must_scan" ? 8 : item.priority === "watch" ? 5 : 3,
        captureChecklist: [
          "Abrir la busqueda y ordenar mentalmente por recencia + velocidad, no solo views totales.",
          "Capturar titulo, URL, source handle, posted_at aproximado y metricas visibles.",
          `Guardar al menos ${targetCandidates} candidatos si pasan el umbral de viralidad.`,
          "Marcar rights=approved solo con evidencia propia/licenciada/permissioned; si no, rights=review.",
          "Pegar la fila en Trend Radar batch antes de mover a Source Hunt o Draft Specs.",
        ],
        scoreFormula: "viral_score = views_velocity + comments/shares signal + recency_boost - rights_risk_penalty",
        trendImportRow: item.trendImportRow,
        rightsDecision: item.rightsGate,
      };
    });
}

async function buildViralDiscoverySummary(discoveryDate = new Date().toISOString().slice(0, 10)): Promise<ClipperViralDiscoverySummary> {
  await ensureClipperDirs();
  const config = await readConfig();
  const accounts = (Array.isArray(config.accounts) && config.accounts.length ? config.accounts : DEFAULT_ACCOUNTS).map(ensureAccountShape);
  const items = buildViralDiscoveryItems(accounts, discoveryDate);
  const sessionOrder = buildViralDiscoverySessionOrder(items);
  const totals = items.reduce<ClipperViralDiscoverySummary["totals"]>((sum, item) => {
    sum.queries += 1;
    if (item.priority === "must_scan") sum.mustScan += 1;
    if (item.priority === "watch") sum.watch += 1;
    if (item.priority === "experimental") sum.experimental += 1;
    return sum;
  }, { queries: 0, mustScan: 0, watch: 0, experimental: 0, targetCandidates: 0, scanMinutes: 0 });
  totals.targetCandidates = sessionOrder.reduce((sum, item) => sum + item.targetCandidates, 0);
  totals.scanMinutes = sessionOrder.reduce((sum, item) => sum + item.scanMinutes, 0);
  const generatedAt = await stat(VIRAL_DISCOVERY_PATH).then((file) => file.mtime.toISOString()).catch(() => null);
  return {
    status: generatedAt ? "ready" : "not_prepared",
    generatedAt,
    discoveryDate,
    manifestPath: VIRAL_DISCOVERY_PATH,
    markdownPath: VIRAL_DISCOVERY_MARKDOWN_PATH,
    csvPath: VIRAL_DISCOVERY_CSV_PATH,
    items,
    sessionOrder,
    totals,
    nextStep: "Escanear must_scan primero, pasar candidatos al Trend Radar CSV y bloquear cualquier asset sin derechos.",
  };
}

function renderViralDiscoveryCsv(summary: ClipperViralDiscoverySummary): string {
  const headers = ["date", "priority", "category", "platform", "account_id", "query", "search_url", "source_type", "recency_window", "target_candidates", "minimum_views", "scan_minutes", "viral_signals", "rights_gate", "import_template", "trend_import_row", "next_step"];
  const rows = summary.items.map((item) => [
    item.discoveryDate,
    item.priority,
    item.category,
    item.platform,
    item.accountId,
    item.query,
    item.searchUrl,
    item.sourceType,
    item.recencyWindow,
    summary.sessionOrder.find((sessionItem) => sessionItem.itemId === item.id)?.targetCandidates || "",
    summary.sessionOrder.find((sessionItem) => sessionItem.itemId === item.id)?.minimumViews || "",
    summary.sessionOrder.find((sessionItem) => sessionItem.itemId === item.id)?.scanMinutes || "",
    item.viralSignals,
    item.rightsGate,
    item.importTemplate,
    item.trendImportRow,
    item.nextStep,
  ]);
  return [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\n") + "\n";
}

function renderViralDiscoveryMarkdown(summary: ClipperViralDiscoverySummary): string {
  return [
    "# Clippers Viral Discovery Pack",
    "",
    `Status: ${summary.status}`,
    `Date: ${summary.discoveryDate}`,
    `Generated: ${summary.generatedAt || new Date().toISOString()}`,
    `Queries: ${summary.totals.queries}`,
    `Must scan: ${summary.totals.mustScan}`,
    `Watch: ${summary.totals.watch}`,
    `Experimental: ${summary.totals.experimental}`,
    `Target candidates: ${summary.totals.targetCandidates}`,
    `Estimated scan minutes: ${summary.totals.scanMinutes}`,
    "",
    "## Next Step",
    "",
    summary.nextStep,
    "",
    "## Scan Session",
    "",
    ...summary.sessionOrder.flatMap((item) => [
      `### ${item.rank}. ${item.accountName} / ${item.platform} / ${item.priority}`,
      "",
      `- Category: ${item.category}`,
      `- Search URL: ${item.searchUrl}`,
      `- Target candidates: ${item.targetCandidates}`,
      `- Minimum views: ${item.minimumViews}`,
      `- Scan minutes: ${item.scanMinutes}`,
      `- Minimum engagement signal: ${item.minimumEngagementSignal}`,
      `- Score formula: ${item.scoreFormula}`,
      `- Trend import row: ${item.trendImportRow}`,
      `- Rights decision: ${item.rightsDecision}`,
      "",
      "Capture checklist:",
      ...item.captureChecklist.map((step) => `- [ ] ${step}`),
      "",
    ]),
    "## Daily Search Queue",
    "",
    ...summary.items.map((item) => [
      `### ${item.accountName} / ${item.platform} / ${item.priority}`,
      "",
      `- Category: ${item.category}`,
      `- Search: ${item.query}`,
      `- URL: ${item.searchUrl}`,
      `- Recency: ${item.recencyWindow}`,
      `- Source type: ${item.sourceType}`,
      `- Viral signals: ${item.viralSignals.join(", ")}`,
      `- Rights gate: ${item.rightsGate}`,
      `- Import template: ${item.importTemplate}`,
      `- Trend import row: ${item.trendImportRow}`,
      `- Next step: ${item.nextStep}`,
      "",
    ].join("\n")),
  ].join("\n");
}

export async function prepareClipperViralDiscoveryPack(input: unknown = {}, userId = getSystemUserId()): Promise<{ viralDiscovery: ClipperViralDiscoverySummary; status: ClipperStatus }> {
  await writeDefaultConfigIfMissing();
  await ensureClipperDirs();
  const incoming = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const discoveryDate = typeof incoming.discoveryDate === "string" && incoming.discoveryDate.trim()
    ? incoming.discoveryDate.trim().replace(/[^0-9-]/g, "").slice(0, 10)
    : new Date().toISOString().slice(0, 10);
  const draftSummary = await buildViralDiscoverySummary(discoveryDate);
  const viralDiscovery: ClipperViralDiscoverySummary = {
    ...draftSummary,
    status: "ready",
    generatedAt: new Date().toISOString(),
  };
  await writeFile(VIRAL_DISCOVERY_PATH, JSON.stringify(viralDiscovery, null, 2));
  await writeFile(VIRAL_DISCOVERY_MARKDOWN_PATH, renderViralDiscoveryMarkdown(viralDiscovery));
  await writeFile(VIRAL_DISCOVERY_CSV_PATH, renderViralDiscoveryCsv(viralDiscovery));
  return { viralDiscovery, status: await getClipperStatus(userId) };
}

async function buildTrendRadarSummary(): Promise<ClipperTrendRadarSummary> {
  await ensureClipperDirs();
  const entries = await readdir(TRENDS_DIR, { withFileTypes: true }).catch(() => []);
  const trendFiles = entries
    .filter((entry) => entry.isFile())
    .filter((entry) => [".csv", ".json"].includes(path.extname(entry.name).toLowerCase()))
    .filter((entry) => entry.name !== path.basename(TRENDS_SUMMARY_PATH))
    .sort((a, b) => a.name.localeCompare(b.name));
  const files: ClipperTrendFile[] = [];
  const candidates: ClipperTrendCandidate[] = [];
  for (const file of trendFiles) {
    const filePath = path.join(TRENDS_DIR, file.name);
    const importedAt = (await stat(filePath)).mtime.toISOString();
    const result = await readTrendCandidatesFromFile(filePath);
    candidates.push(...result.candidates);
    files.push({
      fileName: file.name,
      path: filePath,
      records: result.candidates.length,
      importedAt,
      status: result.error ? "error" : result.candidates.length > 0 ? "imported" : "skipped",
      error: result.error,
    });
  }
  const sorted = candidates.sort((a, b) => b.viralScore - a.viralScore);
  const readyCount = sorted.filter((candidate) => candidate.rightsStatus === "owned_or_permissioned").length;
  return {
    status: files.length === 0 ? "empty" : readyCount > 0 ? "ready" : "needs_review",
    trendsDir: TRENDS_DIR,
    summaryPath: TRENDS_SUMMARY_PATH,
    generatedAt: files.length ? new Date().toISOString() : null,
    files,
    candidates: sorted,
    topCandidates: sorted.slice(0, 8),
    recommendations: buildTrendRecommendations(sorted),
    nextStep: files.length === 0
      ? "Agregar CSV/JSON con oportunidades recientes/virales en clippers_workspace/trends."
      : readyCount > 0
        ? "Mover oportunidades con permiso a sources/drafts y crear variantes."
        : "Resolver permisos/allowlist antes de producir estas oportunidades.",
  };
}

export async function ingestClipperTrends(userId = getSystemUserId()): Promise<{ trendRadar: ClipperTrendRadarSummary; status: ClipperStatus }> {
  const trendRadar = await buildTrendRadarSummary();
  await writeFile(TRENDS_SUMMARY_PATH, JSON.stringify(trendRadar, null, 2));
  return { trendRadar, status: await getClipperStatus(userId) };
}

function parseTrendCandidatesBatchRows(input: unknown): Record<string, unknown>[] {
  if (!input || typeof input !== "object") throw new Error("Payload requerido.");
  const incoming = input as Record<string, unknown>;
  if (Array.isArray(incoming.records)) {
    return incoming.records.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object");
  }
  const raw = typeof incoming.batchText === "string" ? incoming.batchText.trim() : "";
  if (!raw) throw new Error("Pega CSV/JSON con candidatos virales.");
  if (raw.startsWith("[") || raw.startsWith("{")) return parseJsonMetricRecords(raw);
  return parseCsvRecords(raw);
}

function normalizeTrendCandidateImportRow(record: Record<string, unknown>): Record<string, unknown> | null {
  const title = firstString(record, ["title", "hook", "caption", "description", "topic", "trend"]);
  const url = firstString(record, ["url", "link", "video_url", "post_url"]);
  if (!title && !url) return null;
  return {
    category: firstString(record, ["category", "vertical", "account_category", "niche"]) || "memes",
    platform: firstString(record, ["platform", "network", "source"]) || "tiktok",
    title: title || url,
    url,
    source: firstString(record, ["source", "creator", "handle", "channel", "profile"]) || "manual-import",
    posted_at: firstString(record, ["posted_at", "published_at", "created_at", "date"]),
    views: firstString(record, ["views", "view_count", "plays", "impressions", "vistas"]),
    likes: firstString(record, ["likes", "like_count"]),
    comments: firstString(record, ["comments", "comment_count"]),
    shares: firstString(record, ["shares", "share_count"]),
    rights: firstString(record, ["rights", "rights_status", "permission", "license"]) || "review_required",
    angle: firstString(record, ["angle", "hook_angle", "why_it_works"]) || firstString(record, ["notes"]),
  };
}

function renderTrendCandidatesCsv(rows: Record<string, unknown>[]): string {
  const headers = ["category", "platform", "title", "url", "source", "posted_at", "views", "likes", "comments", "shares", "rights", "angle"];
  return [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => csvCell(row[header])).join(",")),
  ].join("\n") + "\n";
}

export async function recordClipperTrendCandidatesBatch(input: unknown, userId = getSystemUserId()): Promise<{ trendCandidatesBatch: ClipperTrendCandidatesBatchImportSummary; status: ClipperStatus }> {
  await writeDefaultConfigIfMissing();
  await ensureClipperDirs();
  const rows = parseTrendCandidatesBatchRows(input);
  const acceptedRows = rows.map(normalizeTrendCandidateImportRow).filter((row): row is Record<string, unknown> => Boolean(row));
  if (!acceptedRows.length) throw new Error("No encontre candidatos con title/url para importar.");
  const importedAt = new Date().toISOString();
  const fileName = `trend-candidates-${importedAt.replace(/[:.]/g, "-")}.csv`;
  const filePath = path.join(TRENDS_DIR, fileName);
  await writeFile(filePath, renderTrendCandidatesCsv(acceptedRows));
  const trendRadar = await buildTrendRadarSummary();
  await writeFile(TRENDS_SUMMARY_PATH, JSON.stringify(trendRadar, null, 2));
  return {
    trendCandidatesBatch: {
      importedAt,
      fileName,
      filePath,
      accepted: acceptedRows.length,
      skipped: rows.length - acceptedRows.length,
      trendRadar,
      nextStep: "Revisar topCandidates, pedir permisos para review_required y mover solo assets con derechos al source hunt.",
    },
    status: await getClipperStatus(userId),
  };
}

function trendRightsEvidenceFileName(candidate: ClipperTrendCandidate): string {
  const slug = (candidate.url || candidate.title || candidate.id)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || candidate.id;
  return `${slug}.md`;
}

function buildTrendRightsOutreachItem(candidate: ClipperTrendCandidate): ClipperTrendRightsOutreachItem {
  const label = CLIPPER_CATEGORY_LABELS[candidate.category];
  const sourceName = candidate.source || "creator/rightsholder";
  const evidenceFileName = trendRightsEvidenceFileName(candidate);
  const outreachSubject = `Permission request: ${candidate.title}`;
  const outreachMessage = [
    `Hi ${sourceName}, we run a rights-first short-form ${label.toLowerCase()} clipping workflow.`,
    `We found this trend/source and would like permission to create a short clip/commentary version: ${candidate.url || candidate.title}.`,
    "We can credit you exactly as requested, follow platform limits, keep proof of approval in our allowlist, and remove the post on request.",
    "Please reply with approval, required credit, approved platforms, usage limits, and whether we may use the linked source or need a different file.",
  ].join(" ");
  const permissionRecordTemplate = [
    `source_url: ${candidate.url || "<paste-source-url>"}`,
    `source_title: ${candidate.title}`,
    `source_creator: ${candidate.source}`,
    `category: ${candidate.category}`,
    `platform_found: ${candidate.platform}`,
    "rights_status: owned_or_permissioned",
    "permission_type: creator_permission | license | official_source | owned",
    "approved_platforms: tiktok, instagram, youtube",
    "credit_required: <creator/source credit>",
    "approved_by: <name/handle/email>",
    "approved_at: <YYYY-MM-DD>",
    "evidence_link: <screenshot-or-drive-link>",
    `notes: viral_score=${candidate.viralScore}; hook=${candidate.hookAngle}`,
  ].join("\n");
  return {
    id: `trend-rights-${candidate.id}`,
    status: "ready_to_contact",
    trendCandidateId: candidate.id,
    category: candidate.category,
    platform: candidate.platform,
    title: candidate.title,
    url: candidate.url,
    source: candidate.source,
    viralScore: candidate.viralScore,
    hookAngle: candidate.hookAngle,
    outreachSubject,
    outreachMessage,
    permissionRecordTemplate,
    evidenceFileName,
    nextStep: `Enviar outreach y guardar respuesta aprobada en clippers_workspace/allowlist/${evidenceFileName}.`,
  };
}

async function buildTrendRightsOutreachSummary(trendRadar: ClipperTrendRadarSummary): Promise<ClipperTrendRightsOutreachSummary> {
  const reviewCandidates = trendRadar.candidates
    .filter((candidate) => candidate.rightsStatus === "review_required")
    .sort((a, b) => b.viralScore - a.viralScore)
    .slice(0, 50);
  const items = reviewCandidates.map(buildTrendRightsOutreachItem);
  const generatedAt = await stat(TREND_RIGHTS_OUTREACH_PATH).then((file) => file.mtime.toISOString()).catch(() => null);
  const permissionRecorded = trendRadar.candidates.filter((candidate) => candidate.rightsStatus === "owned_or_permissioned").length;
  const status: ClipperTrendRightsOutreachStatus = !generatedAt
    ? "not_prepared"
    : trendRadar.candidates.length === 0
      ? "blocked"
      : items.length > 0
        ? "partial"
        : "ready";
  return {
    status,
    generatedAt,
    manifestPath: TREND_RIGHTS_OUTREACH_PATH,
    markdownPath: TREND_RIGHTS_OUTREACH_MARKDOWN_PATH,
    csvPath: TREND_RIGHTS_OUTREACH_CSV_PATH,
    sourceTrendRadarPath: trendRadar.summaryPath,
    items,
    totals: {
      candidates: trendRadar.candidates.length,
      reviewRequired: items.length,
      readyToContact: items.length,
      permissionRecorded,
    },
    nextStep: items.length
      ? `Enviar ${items.length} mensajes de permiso empezando por mayor viralScore.`
      : trendRadar.candidates.length
        ? "Todos los candidatos importados tienen permiso/evidencia; mover a source/draft."
        : "Importar candidatos virales antes de preparar outreach de permisos.",
  };
}

function renderTrendRightsOutreachCsv(summary: ClipperTrendRightsOutreachSummary): string {
  const headers = ["status", "category", "platform", "title", "url", "source", "viral_score", "subject", "message", "permission_record_template", "evidence_file", "next_step"];
  const rows = summary.items.map((item) => [
    item.status,
    item.category,
    item.platform,
    item.title,
    item.url || "",
    item.source,
    item.viralScore,
    item.outreachSubject,
    item.outreachMessage,
    item.permissionRecordTemplate,
    item.evidenceFileName,
    item.nextStep,
  ]);
  return [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\n") + "\n";
}

function renderTrendRightsOutreachMarkdown(summary: ClipperTrendRightsOutreachSummary): string {
  return [
    "# Clippers Trend Rights Outreach Pack",
    "",
    `Status: ${summary.status}`,
    `Generated: ${summary.generatedAt || new Date().toISOString()}`,
    `Source Trend Radar: ${summary.sourceTrendRadarPath}`,
    `Candidates: ${summary.totals.candidates}`,
    `Review required: ${summary.totals.reviewRequired}`,
    `Ready to contact: ${summary.totals.readyToContact}`,
    `Permission recorded: ${summary.totals.permissionRecorded}`,
    "",
    "## Next Step",
    "",
    summary.nextStep,
    "",
    "## Outreach Items",
    "",
    ...summary.items.flatMap((item) => [
      `### ${item.title}`,
      "",
      `- Status: ${item.status}`,
      `- Category: ${item.category}`,
      `- Platform found: ${item.platform}`,
      `- Source: ${item.source}`,
      `- URL: ${item.url || "none"}`,
      `- Viral score: ${item.viralScore}`,
      `- Hook angle: ${item.hookAngle}`,
      `- Evidence file: clippers_workspace/allowlist/${item.evidenceFileName}`,
      `- Next step: ${item.nextStep}`,
      "",
      `Subject: ${item.outreachSubject}`,
      "",
      item.outreachMessage,
      "",
      "Permission record template:",
      "",
      "```yaml",
      item.permissionRecordTemplate,
      "```",
      "",
    ]),
  ].join("\n");
}

export async function prepareClipperTrendRightsOutreachPack(userId = getSystemUserId()): Promise<{ trendRightsOutreach: ClipperTrendRightsOutreachSummary; status: ClipperStatus }> {
  await writeDefaultConfigIfMissing();
  await ensureClipperDirs();
  const trendRadar = await buildTrendRadarSummary();
  const draftSummary = await buildTrendRightsOutreachSummary(trendRadar);
  const trendRightsOutreach: ClipperTrendRightsOutreachSummary = {
    ...draftSummary,
    generatedAt: new Date().toISOString(),
    status: trendRadar.candidates.length === 0
      ? "blocked"
      : draftSummary.items.length > 0
        ? "partial"
        : "ready",
  };
  await writeFile(TREND_RIGHTS_OUTREACH_PATH, JSON.stringify(trendRightsOutreach, null, 2));
  await writeFile(TREND_RIGHTS_OUTREACH_MARKDOWN_PATH, renderTrendRightsOutreachMarkdown(trendRightsOutreach));
  await writeFile(TREND_RIGHTS_OUTREACH_CSV_PATH, renderTrendRightsOutreachCsv(trendRightsOutreach));
  return { trendRightsOutreach, status: await getClipperStatus(userId) };
}

const INTAKE_KIT_FILES: Array<Omit<ClipperIntakeKitFile, "path" | "exists"> & { fileName: string }> = [
  {
    id: "trend-opportunities",
    label: "Trend opportunities CSV",
    fileName: "trend-opportunities-template.csv",
    destinationDir: TRENDS_DIR,
    purpose: "Copiar a trends/ con oportunidades recientes/virales para activar Trend Radar.",
  },
  {
    id: "metrics-export",
    label: "Metrics export CSV",
    fileName: "metrics-export-template.csv",
    destinationDir: METRICS_DIR,
    purpose: "Copiar a metrics/ con exports de analytics para activar Optimizer.",
  },
  {
    id: "allowlist-evidence",
    label: "Allowlist evidence Markdown",
    fileName: "allowlist-evidence-template.md",
    destinationDir: path.join(ROOT_DIR, "allowlist"),
    purpose: "Copiar a allowlist/ por fuente, creador o URL para desbloquear derechos.",
  },
  {
    id: "source-drop-manifest",
    label: "Source drop manifest CSV",
    fileName: "source-drop-manifest-template.csv",
    destinationDir: SOURCES_DIR,
    purpose: "Registrar videos propios/licenciados que se colocan en sources por categoria.",
  },
  {
    id: "daily-intake-checklist",
    label: "Daily intake checklist",
    fileName: "daily-intake-checklist.md",
    destinationDir: INTAKE_KIT_DIR,
    purpose: "Runbook diario para alimentar sources, trends, allowlist y metrics.",
  },
];

function intakeKitFilePath(fileName: string): string {
  return path.join(INTAKE_KIT_TEMPLATE_DIR, fileName);
}

async function buildIntakeKitSummary(): Promise<ClipperIntakeKitSummary> {
  await ensureClipperDirs();
  const files = await Promise.all(INTAKE_KIT_FILES.map(async (file) => {
    const filePath = intakeKitFilePath(file.fileName);
    const exists = await stat(filePath).then((entry) => entry.isFile()).catch(() => false);
    return {
      id: file.id,
      label: file.label,
      path: filePath,
      exists,
      destinationDir: file.destinationDir,
      purpose: file.purpose,
    };
  }));
  const generatedAt = await stat(INTAKE_KIT_README_PATH).then((file) => file.mtime.toISOString()).catch(() => null);
  const ready = files.every((file) => file.exists) && Boolean(generatedAt);
  return {
    status: ready ? "prepared" : "not_prepared",
    rootDir: INTAKE_KIT_DIR,
    templateDir: INTAKE_KIT_TEMPLATE_DIR,
    readmePath: INTAKE_KIT_README_PATH,
    generatedAt,
    files,
    nextStep: ready
      ? "Usar templates para cargar oportunidades virales, metricas, permisos y sources reales."
      : "Generar Intake Kit para tener templates exactos de trends, metrics, allowlist y source drops.",
  };
}

function renderTrendOpportunitiesTemplate(): string {
  return [
    "category,platform,title,url,source,posted_at,views,likes,comments,shares,rights,angle",
    "sports,tiktok,Game winner angle,https://example.com/clip,@league,2026-06-17T12:00:00Z,900000,42000,1800,12000,review,Fast context before the payoff",
    "memes,instagram,New meme format,https://example.com/meme,@creator,2026-06-17T13:00:00Z,300000,10000,500,800,approved,Relatable setup with loop ending",
  ].join("\n");
}

function renderMetricsExportTemplate(): string {
  return [
    "account_id,platform,clip_id,hook,published_at,views,likes,comments,shares,saves,retention,watch_time_seconds",
    "sports-daily,tiktok,clip-1,La jugada que cambio todo,2026-06-17T12:00:00Z,1250000,54000,2100,8400,3200,71%,18",
    "meme-radar,instagram,clip-2,POV internet hoy,2026-06-17T18:00:00Z,220000,12000,900,2600,1100,48%,9",
  ].join("\n");
}

function renderAllowlistEvidenceTemplate(): string {
  return [
    "# Allowlist Evidence",
    "",
    "status: approved",
    "source_name:",
    "source_url:",
    "rightsholder:",
    "permission_type: owned | licensed | creator_permission | official_source",
    "valid_from:",
    "valid_until:",
    "usage_scope: short-form clips on TikTok, Instagram Reels and YouTube Shorts",
    "notes:",
    "",
    "## Evidence",
    "",
    "- Link to license, email approval, contract, DM screenshot path, or official-source proof.",
    "- Save this file in clippers_workspace/allowlist using a slug that matches the trend URL/title when possible.",
  ].join("\n");
}

function renderSourceDropManifestTemplate(): string {
  return [
    "category,title,url,source,platform,target_file_name,rights_status,evidence_link,priority,notes",
    "sports,Last-second comeback,https://example.com/highlight,@league,tiktok,sample-highlight.mp4,owned_or_permissioned,https://drive.google.com/file/proof,high,Payoff in first 7 seconds",
    "streamers,Chat reaction moment,https://example.com/streamer,@creator,youtube,sample-streamer-clip.mp4,review_required,,medium,Needs creator approval",
  ].join("\n");
}

function parseSourceIntakeBatchRows(input: unknown): Record<string, unknown>[] {
  if (!input || typeof input !== "object") throw new Error("Payload requerido.");
  const incoming = input as Record<string, unknown>;
  if (Array.isArray(incoming.records)) {
    return incoming.records.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object");
  }
  const raw = typeof incoming.batchText === "string" ? incoming.batchText.trim() : "";
  if (!raw) throw new Error("Pega CSV/JSON con sources candidatos.");
  if (raw.startsWith("[") || raw.startsWith("{")) return parseJsonMetricRecords(raw);
  return parseCsvRecords(raw);
}

function safeSourceFileName(value: string, fallbackSeed: string): string {
  const parsed = path.parse(value.trim());
  const base = (parsed.name || fallbackSeed || "source")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72) || "source";
  const ext = VIDEO_EXTENSIONS.has(parsed.ext.toLowerCase()) ? parsed.ext.toLowerCase() : ".mp4";
  return `${base}${ext}`;
}

function normalizeSourceIntakePriority(value: string): "high" | "medium" | "low" {
  const normalized = value.toLowerCase();
  if (normalized.includes("high") || normalized.includes("alta") || normalized.includes("urgent")) return "high";
  if (normalized.includes("low") || normalized.includes("baja")) return "low";
  return "medium";
}

function normalizeSourceIntakeRow(record: Record<string, unknown>, index: number): ClipperSourceIntakeBatchItem | null {
  const title = firstString(record, ["title", "hook", "caption", "topic", "notes", "hook_notes"]);
  const url = firstString(record, ["url", "link", "source_url", "video_url", "post_url"]);
  const source = firstString(record, ["source", "creator", "handle", "channel", "rightsholder"]) || "manual-source";
  if (!title && !url) return null;

  const category = normalizeTrendCategory(firstString(record, ["category", "vertical", "account_category", "niche"]));
  const platform = firstString(record, ["platform", "network"]) || "unknown";
  const rightsHint = firstString(record, ["rights", "rights_status", "permission", "license"]).toLowerCase();
  const rightsStatus: ClipperAssetRightsStatus = /owned|licensed|permission|approved|allowlist/.test(rightsHint)
    ? "owned_or_permissioned"
    : "review_required";
  const evidenceLinkRaw = firstString(record, ["evidence_link", "evidence", "proof", "permission_proof", "drive_link"]);
  const evidenceLink = evidenceLinkRaw && !hasTemplatePlaceholder(evidenceLinkRaw) ? evidenceLinkRaw : null;
  const fileName = safeSourceFileName(firstString(record, ["target_file_name", "file_name", "filename", "asset"]) || title || url, `${category}-${index + 1}`);
  const targetSourcePath = path.join(getSourceFolderForCategory(category), fileName);
  const priority = normalizeSourceIntakePriority(firstString(record, ["priority", "urgency"]));
  const titleOrUrl = title || url || fileName;
  const rightsReady = rightsStatus === "owned_or_permissioned" && Boolean(evidenceLink);
  const sourceRightsBatchRow = rightsReady
    ? ["source_rights", fileName, category, "owned_or_permissioned", fileName, "", "", evidenceLink].map(csvCell).join(",")
    : null;
  return {
    id: hashId(`${category}-${fileName}-${url || titleOrUrl}-${index}`),
    category,
    title: titleOrUrl,
    url,
    source,
    platform,
    targetFileName: fileName,
    targetSourcePath,
    rightsStatus,
    evidenceLink,
    priority,
    downloadCommand: url
      ? `Download approved source into ${targetSourcePath}`
      : `Place the approved local file at ${targetSourcePath}`,
    sourceRightsBatchRow,
    checklist: [
      `Add source video file to ${targetSourcePath}.`,
      "Confirm source is owned, licensed, official, or creator-permissioned before editing.",
      evidenceLink ? `Store/review evidence: ${evidenceLink}` : "Add evidence_link before importing source_rights.",
      "Regenerate Production Queue after the file exists locally.",
    ],
    nextStep: rightsReady
      ? "Subir/descargar el video al source path y pegar sourceRightsBatchRow en Launch evidence batch."
      : "Conseguir permiso/evidence_link antes de marcar derechos OK.",
  };
}

function renderSourceIntakeBatchCsv(summary: ClipperSourceIntakeBatchSummary): string {
  const headers = ["category", "priority", "title", "url", "source", "platform", "target_file_name", "target_source_path", "rights_status", "evidence_link", "source_rights_batch_row", "next_step"];
  const rows = summary.items.map((item) => [
    item.category,
    item.priority,
    item.title,
    item.url,
    item.source,
    item.platform,
    item.targetFileName,
    item.targetSourcePath,
    item.rightsStatus,
    item.evidenceLink || "",
    item.sourceRightsBatchRow || "",
    item.nextStep,
  ]);
  return [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\n") + "\n";
}

function renderSourceIntakeBatchMarkdown(summary: ClipperSourceIntakeBatchSummary): string {
  return [
    "# Clippers Source Intake Batch",
    "",
    `Imported: ${summary.importedAt}`,
    `Accepted: ${summary.accepted}`,
    `Skipped: ${summary.skipped}`,
    `High priority: ${summary.totals.highPriority}`,
    `Rights ready rows: ${summary.totals.ownedOrPermissioned}`,
    `Rights review rows: ${summary.totals.reviewRequired}`,
    "",
    "## Next Step",
    "",
    summary.nextStep,
    "",
    "## Items",
    "",
    ...summary.items.map((item, index) => [
      `### ${index + 1}. ${item.title}`,
      "",
      `- Category: ${item.category}`,
      `- Priority: ${item.priority}`,
      `- Source: ${item.source}`,
      `- URL: ${item.url || "local/manual"}`,
      `- Target file: ${item.targetSourcePath}`,
      `- Rights: ${item.rightsStatus}`,
      `- Evidence: ${item.evidenceLink || "missing"}`,
      `- Download command: ${item.downloadCommand}`,
      item.sourceRightsBatchRow ? `- Source rights batch row: ${item.sourceRightsBatchRow}` : "- Source rights batch row: missing until evidence_link exists",
      "",
      "Checklist:",
      ...item.checklist.map((step) => `- [ ] ${step}`),
      "",
    ].join("\n")),
  ].join("\n");
}

function renderDailyIntakeChecklist(): string {
  return [
    "# Clippers Daily Intake Checklist",
    "",
    "1. Add 10-20 recent opportunities to a copied trend CSV in `clippers_workspace/trends/`.",
    "2. Add source videos to `sources/sports`, `sources/memes` or `sources/streamers`.",
    "3. Add allowlist evidence for every non-owned source before production.",
    "4. Run Trend Radar and Production Queue.",
    "5. After posting/manual drafts, export analytics into `clippers_workspace/metrics/`.",
    "6. Run Metrics ingestion and scale only winners.",
    "",
    "Do not edit files directly inside `intake-kit/templates` as production data; copy them into the target folders first.",
  ].join("\n");
}

function renderIntakeKitReadme(summary: ClipperIntakeKitSummary): string {
  return [
    "# Clippers Intake Kit",
    "",
    "Templates for feeding the Clippers system with real source videos, viral opportunities, permission evidence and analytics exports.",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    "Files:",
    "",
    ...summary.files.map((file) => `- ${file.label}: copy ${file.path} to ${file.destinationDir}. ${file.purpose}`),
    "",
    "Important: templates stay in intake-kit/templates so the ingestion jobs do not count examples as real data.",
    "",
  ].join("\n");
}

export async function prepareClipperIntakeKit(userId = getSystemUserId()): Promise<{ intakeKit: ClipperIntakeKitSummary; status: ClipperStatus }> {
  await writeDefaultConfigIfMissing();
  await ensureClipperDirs();
  await Promise.all([
    writeFile(intakeKitFilePath("trend-opportunities-template.csv"), renderTrendOpportunitiesTemplate()),
    writeFile(intakeKitFilePath("metrics-export-template.csv"), renderMetricsExportTemplate()),
    writeFile(intakeKitFilePath("allowlist-evidence-template.md"), renderAllowlistEvidenceTemplate()),
    writeFile(intakeKitFilePath("source-drop-manifest-template.csv"), renderSourceDropManifestTemplate()),
    writeFile(intakeKitFilePath("daily-intake-checklist.md"), renderDailyIntakeChecklist()),
  ]);
  const draftSummary = await buildIntakeKitSummary();
  await writeFile(INTAKE_KIT_README_PATH, renderIntakeKitReadme(draftSummary));
  return { intakeKit: await buildIntakeKitSummary(), status: await getClipperStatus(userId) };
}

export async function recordClipperSourceIntakeBatch(input: unknown, userId = getSystemUserId()): Promise<{ sourceIntakeBatch: ClipperSourceIntakeBatchSummary; status: ClipperStatus }> {
  await writeDefaultConfigIfMissing();
  await ensureClipperDirs();
  const rows = parseSourceIntakeBatchRows(input);
  const items = rows.map(normalizeSourceIntakeRow).filter((item): item is ClipperSourceIntakeBatchItem => Boolean(item));
  if (!items.length) throw new Error("No encontre sources validos con title/url para importar.");
  const importedAt = new Date().toISOString();
  const suffix = importedAt.replace(/[:.]/g, "-");
  const manifestPath = path.join(SOURCE_HUNTS_DIR, `source-intake-${suffix}.json`);
  const csvPath = path.join(SOURCE_HUNTS_DIR, `source-intake-${suffix}.csv`);
  const markdownPath = path.join(SOURCE_HUNTS_DIR, `source-intake-${suffix}.md`);
  const totals: ClipperSourceIntakeBatchSummary["totals"] = {
    sports: items.filter((item) => item.category === "sports").length,
    memes: items.filter((item) => item.category === "memes").length,
    streamers: items.filter((item) => item.category === "streamers").length,
    ownedOrPermissioned: items.filter((item) => item.sourceRightsBatchRow).length,
    reviewRequired: items.filter((item) => !item.sourceRightsBatchRow).length,
    highPriority: items.filter((item) => item.priority === "high").length,
  };
  const sourceIntakeBatch: ClipperSourceIntakeBatchSummary = {
    importedAt,
    manifestPath,
    csvPath,
    markdownPath,
    accepted: items.length,
    skipped: rows.length - items.length,
    items,
    totals,
    nextStep: totals.ownedOrPermissioned > 0
      ? "Descargar/subir los videos a target_source_path y pegar las source_rights_batch_row listas en Launch evidence batch."
      : "Completar evidence_link/permisos antes de desbloquear derechos para produccion.",
  };
  await Promise.all([
    writeFile(manifestPath, JSON.stringify(sourceIntakeBatch, null, 2)),
    writeFile(csvPath, renderSourceIntakeBatchCsv(sourceIntakeBatch)),
    writeFile(markdownPath, renderSourceIntakeBatchMarkdown(sourceIntakeBatch)),
  ]);
  await prepareClipperSourceAcquisitionPlan(userId);
  await prepareClipperSourceHuntSheet({}, userId);
  return { sourceIntakeBatch, status: await getClipperStatus(userId) };
}

function sumRoleCost(roles: ClipperBudgetRole[], side: "low" | "high"): number {
  return roles.reduce((sum, role) => sum + role.weeklyHours * (side === "low" ? role.rateLow : role.rateHigh), 0);
}

function buildBudgetScenario(input: {
  id: ClipperBudgetScenarioId;
  label: string;
  weeklyClips: number;
  roles: ClipperBudgetRole[];
  fixedWeeklyToolsLow: number;
  fixedWeeklyToolsHigh: number;
  licensingReserveLow: number;
  licensingReserveHigh: number;
  bestFor: string;
  risk: string;
}): ClipperBudgetScenario {
  const weeklyCostLow = Math.round(sumRoleCost(input.roles, "low") + input.fixedWeeklyToolsLow + input.licensingReserveLow);
  const weeklyCostHigh = Math.round(sumRoleCost(input.roles, "high") + input.fixedWeeklyToolsHigh + input.licensingReserveHigh);
  return {
    ...input,
    costPerClipLow: Math.round(weeklyCostLow / input.weeklyClips),
    costPerClipHigh: Math.round(weeklyCostHigh / input.weeklyClips),
    weeklyCostLow,
    weeklyCostHigh,
    monthlyCostLow: Math.round(weeklyCostLow * 4.33),
    monthlyCostHigh: Math.round(weeklyCostHigh * 4.33),
  };
}

function buildBudgetPlanner(accounts: ClipperAccount[]): ClipperBudgetPlanner {
  const configuredWeeklyClips = accounts.reduce((sum, account) => sum + account.dailyClipTarget, 0) * 7;
  const targetWeeklyClips = 100;
  const scenarios = [
    buildBudgetScenario({
      id: "lean",
      label: "Lean / prueba controlada",
      weeklyClips: targetWeeklyClips,
      roles: [
        { role: "Editor short-form", weeklyHours: 25, rateLow: 18, rateHigh: 30, note: "Cortes, captions y formatos desde fuentes ya listas." },
        { role: "Trend scout / uploader", weeklyHours: 8, rateLow: 15, rateHigh: 25, note: "Busca angles, prepara captions y deja posts en draft." },
        { role: "QA / rights check", weeklyHours: 4, rateLow: 20, rateHigh: 35, note: "Revisa allowlist y bloquea assets dudosos." },
      ],
      fixedWeeklyToolsLow: 30,
      fixedWeeklyToolsHigh: 120,
      licensingReserveLow: 0,
      licensingReserveHigh: 300,
      bestFor: "Validar pipeline y cuentas sin gastar de mas.",
      risk: "Menos variantes y menos investigacion; puede quedarse corto para 1M/week por cuenta.",
    }),
    buildBudgetScenario({
      id: "growth",
      label: "Growth / recomendado",
      weeklyClips: targetWeeklyClips,
      roles: [
        { role: "Lead editor", weeklyHours: 28, rateLow: 30, rateHigh: 50, note: "Define estilo, templates, hooks y calidad final." },
        { role: "Assistant editor", weeklyHours: 25, rateLow: 18, rateHigh: 35, note: "Versiones, captions, crops, exports y ajustes por plataforma." },
        { role: "Trend scout", weeklyHours: 12, rateLow: 20, rateHigh: 35, note: "Recencia, viralidad, fuentes y angulos por categoria." },
        { role: "Publisher / account ops", weeklyHours: 8, rateLow: 20, rateHigh: 35, note: "Calendario, drafts, OAuth, reportes y comentarios operativos." },
        { role: "Rights / QA", weeklyHours: 6, rateLow: 25, rateHigh: 45, note: "Permisos, allowlist y control de strikes." },
      ],
      fixedWeeklyToolsLow: 75,
      fixedWeeklyToolsHigh: 250,
      licensingReserveLow: 250,
      licensingReserveHigh: 900,
      bestFor: "Llegar a 100 clips/semana con volumen, control y aprendizaje real.",
      risk: "Requiere disciplina de metrics; si no hay sources buenos, el costo por winner sube.",
    }),
    buildBudgetScenario({
      id: "aggressive",
      label: "Aggressive / escalar",
      weeklyClips: targetWeeklyClips,
      roles: [
        { role: "Creative producer", weeklyHours: 15, rateLow: 45, rateHigh: 80, note: "Sistema de hooks, angles, briefs y decisiones de volumen." },
        { role: "Senior editor", weeklyHours: 35, rateLow: 45, rateHigh: 75, note: "Edicion de alto impacto y templates ganadores." },
        { role: "Assistant editor", weeklyHours: 35, rateLow: 22, rateHigh: 40, note: "Variantes A/B, subtitulos, versionado y exports." },
        { role: "Trend scout", weeklyHours: 20, rateLow: 25, rateHigh: 45, note: "Monitoreo diario, clipping opportunities y research." },
        { role: "Publisher / community ops", weeklyHours: 12, rateLow: 25, rateHigh: 45, note: "Posts, calendario, replies iniciales y hygiene de cuentas." },
        { role: "Analyst / optimizer", weeklyHours: 8, rateLow: 40, rateHigh: 75, note: "Lee metrics y mueve presupuesto/volumen hacia winners." },
        { role: "Rights / QA", weeklyHours: 8, rateLow: 35, rateHigh: 65, note: "Revisa permisos y reduce riesgo de strikes." },
      ],
      fixedWeeklyToolsLow: 150,
      fixedWeeklyToolsHigh: 500,
      licensingReserveLow: 1000,
      licensingReserveHigh: 2500,
      bestFor: "Empujar muchas variantes y aprender rapido por cuenta/categoria.",
      risk: "Caro si todavia no hay cuentas conectadas, sources permissioned y metrics loop activo.",
    }),
  ];

  return {
    targetWeeklyClips,
    configuredWeeklyClips,
    recommendedScenarioId: "growth",
    scenarios,
    assumptions: [
      "Estimado para 100 clips/semana; no incluye ads pagados ni compra grande de derechos deportivos premium.",
      "El costo baja cuando hay templates, fuentes listas, allowlist clara y metrics importadas cada semana.",
      "Mantener approval_required hasta que OAuth, derechos y QA esten estables.",
      `La configuracion actual apunta a ${configuredWeeklyClips} clips/semana si se ejecutan todos los dailyClipTarget.`,
    ],
    nextStep: "Empezar en Growth, medir costo por clip ganador y mover presupuesto solo a cuentas/formats con traccion.",
  };
}

function accountEvidenceId(accountId: string, platform: ClipperPlatform): string {
  return `${accountId}-${platform}`;
}

function accountEvidenceMarkdownPath(accountId: string, platform: ClipperPlatform): string {
  return path.join(ACCOUNT_EVIDENCE_DIR, `${accountEvidenceId(accountId, platform)}.md`);
}

function accountEvidenceJsonPath(accountId: string, platform: ClipperPlatform): string {
  return path.join(ACCOUNT_EVIDENCE_DIR, `${accountEvidenceId(accountId, platform)}.json`);
}

function parseAccountEvidenceStatus(raw: string, ext: string): { status: ClipperAccountEvidenceItemStatus; notes: string } {
  if (ext === ".json") {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const status = String(parsed.status || "submitted").toLowerCase();
      return {
        status: status === "verified" ? "verified" : status === "rejected" ? "rejected" : "submitted",
        notes: typeof parsed.notes === "string" ? parsed.notes : "Evidence JSON imported.",
      };
    } catch {
      return { status: "submitted", notes: "Evidence JSON exists but could not be parsed; review manually." };
    }
  }

  const lower = raw.toLowerCase();
  const status = lower.includes("status: verified") || lower.includes("verified: true") || lower.includes("[x] cuenta creada")
    ? "verified"
    : lower.includes("status: rejected")
      ? "rejected"
      : "submitted";
  const notesLine = raw.split("\n").find((line) => line.toLowerCase().startsWith("notes:"));
  return { status, notes: notesLine ? notesLine.replace(/^notes:\s*/i, "").trim() : "Evidence markdown submitted." };
}

async function readAccountEvidenceItem(account: ClipperAccount, platformAccount: ClipperPlatformAccount): Promise<ClipperAccountEvidenceItem | null> {
  const candidates = [
    accountEvidenceJsonPath(account.id, platformAccount.platform),
    accountEvidenceMarkdownPath(account.id, platformAccount.platform),
  ];
  for (const evidencePath of candidates) {
    try {
      const fileStat = await stat(evidencePath);
      const raw = await readFile(evidencePath, "utf8");
      const parsed = parseAccountEvidenceStatus(raw, path.extname(evidencePath).toLowerCase());
      return {
        id: accountEvidenceId(account.id, platformAccount.platform),
        accountId: account.id,
        accountName: account.name,
        category: account.category,
        platform: platformAccount.platform,
        handle: platformAccount.handle,
        displayName: platformAccount.displayName,
        status: parsed.status,
        evidencePath,
        updatedAt: fileStat.mtime.toISOString(),
        notes: parsed.notes,
        nextStep: parsed.status === "verified"
          ? "Cuenta externa verificada; conectar OAuth y completar app review."
          : parsed.status === "rejected"
            ? "Corregir evidencia o recrear/verificar la cuenta antes de OAuth."
            : "Revisar evidencia y marcar status: verified cuando login/verificacion esten confirmados.",
      };
    } catch {
      // Try the next candidate path.
    }
  }
  return null;
}

async function buildAccountEvidenceSummary(accounts: ClipperAccount[]): Promise<ClipperAccountEvidenceSummary> {
  await ensureClipperDirs();
  const items = (await Promise.all(accounts.flatMap((account) =>
    account.platformAccounts.map((platformAccount) => readAccountEvidenceItem(account, platformAccount))
  ))).filter((item): item is ClipperAccountEvidenceItem => Boolean(item));
  const expected = accounts.reduce((sum, account) => sum + account.platformAccounts.length, 0);
  const verified = items.filter((item) => item.status === "verified").length;
  const rejected = items.filter((item) => item.status === "rejected").length;
  const submitted = items.filter((item) => item.status === "submitted").length;
  const missing = Math.max(expected - items.length, 0);
  const generatedAt = await stat(ACCOUNT_EVIDENCE_README_PATH).then((file) => file.mtime.toISOString()).catch(() => null);
  return {
    status: verified === expected && expected > 0 ? "ready" : items.length > 0 ? "partial" : "empty",
    evidenceDir: ACCOUNT_EVIDENCE_DIR,
    templateDir: ACCOUNT_EVIDENCE_TEMPLATE_DIR,
    readmePath: ACCOUNT_EVIDENCE_README_PATH,
    launchEvidenceDropDir: LAUNCH_EVIDENCE_DROP_DIR,
    launchEvidenceTemplatePath: LAUNCH_EVIDENCE_TEMPLATE_PATH,
    launchEvidenceTemplateRows: buildLaunchEvidenceTemplateRows(accounts).length,
    launchEvidenceDropChecklist: buildLaunchEvidenceDropChecklist(),
    generatedAt,
    items,
    totals: { expected, submitted, verified, rejected, missing },
    nextStep: missing > 0
      ? "Subir evidencia real por cuenta/plataforma en account-evidence para desbloquear creacion/verificacion."
      : rejected > 0
        ? "Corregir evidencias rechazadas antes de OAuth/app review."
        : verified === expected
          ? "Todas las cuentas tienen evidencia verificada; avanzar a OAuth/app review."
          : "Revisar submitted y marcar status: verified cuando la cuenta externa este confirmada.",
  };
}

function renderAccountEvidenceReadme(accounts: ClipperAccount[]): string {
  return [
    "# Clippers Account Evidence",
    "",
    "Esta carpeta prueba que las cuentas externas existen y fueron verificadas antes de conectar OAuth.",
    "",
    "Usa archivos reales en la raiz con nombre:",
    "",
    "`{accountId}-{platform}.md` o `{accountId}-{platform}.json`",
    "",
    "Ejemplo markdown:",
    "",
    "```md",
    "status: verified",
    "notes: Cuenta creada, email/telefono verificado, bio aplicada y 2FA guardado.",
    "```",
    "",
    "Templates disponibles:",
    "",
    ...accounts.flatMap((account) => account.platformAccounts.map((platformAccount) => `- templates/${accountEvidenceId(account.id, platformAccount.platform)}.md`)),
    "",
    "Batch import:",
    "",
    "- Tambien puedes llenar `../evidence-drop/launch-evidence-template.csv` y usar Import drop desde la app.",
    "",
  ].join("\n");
}

function renderAccountEvidenceTemplate(account: ClipperAccount, platformAccount: ClipperPlatformAccount): string {
  return [
    `# Evidence: ${account.name} / ${platformAccount.platform}`,
    "",
    "status: submitted",
    "notes: Reemplazar con evidencia real.",
    "",
    `Account ID: ${account.id}`,
    `Platform: ${platformAccount.platform}`,
    `Handle: ${platformAccount.handle}`,
    `Display name: ${platformAccount.displayName}`,
    "",
    "Checklist:",
    "- [ ] Cuenta creada con el handle correcto.",
    "- [ ] Email/telefono verificado si la plataforma lo pide.",
    "- [ ] Bio/foto/banner aplicados.",
    "- [ ] Login y 2FA guardados en password manager.",
    "- [ ] Screenshot o nota interna de verificacion guardada fuera del repo si contiene datos sensibles.",
    "",
    "Cuando este confirmado, cambia `status: submitted` por `status: verified` y copia este archivo a la raiz de account-evidence.",
    "",
  ].join("\n");
}

export async function prepareClipperAccountEvidenceVault(userId = getSystemUserId()): Promise<{ accountEvidence: ClipperAccountEvidenceSummary; status: ClipperStatus }> {
  await writeDefaultConfigIfMissing();
  await ensureClipperDirs();
  const config = await readConfig();
  const accounts = (Array.isArray(config.accounts) && config.accounts.length ? config.accounts : DEFAULT_ACCOUNTS).map(ensureAccountShape);
  await writeFile(ACCOUNT_EVIDENCE_README_PATH, renderAccountEvidenceReadme(accounts));
  await writeFile(LAUNCH_EVIDENCE_TEMPLATE_PATH, renderLaunchEvidenceTemplateCsv(accounts));
  await Promise.all(accounts.flatMap((account) =>
    account.platformAccounts.map((platformAccount) =>
      writeFile(path.join(ACCOUNT_EVIDENCE_TEMPLATE_DIR, `${accountEvidenceId(account.id, platformAccount.platform)}.md`), renderAccountEvidenceTemplate(account, platformAccount))
    )
  ));
  return { accountEvidence: await buildAccountEvidenceSummary(accounts), status: await getClipperStatus(userId) };
}

function parseClipperPlatform(value: unknown): ClipperPlatform {
  if (value === "tiktok" || value === "instagram" || value === "youtube") return value;
  throw new Error("Plataforma no soportada.");
}

function parseAccountEvidenceInputStatus(value: unknown): ClipperAccountEvidenceItemStatus {
  if (value === "verified" || value === "rejected" || value === "submitted") return value;
  return "submitted";
}

function parseDeveloperAppEvidenceInputStatus(value: unknown): ClipperDeveloperAppEvidenceItemStatus {
  if (value === "approved" || value === "submitted" || value === "rejected" || value === "draft") return value;
  return "submitted";
}

function parsePermissionTrackerInputStatus(value: unknown): ClipperPermissionTrackerItemStatus {
  if (value === "approved" || value === "requested" || value === "ready_to_request" || value === "blocked") return value;
  return "requested";
}

function normalizePermissionStatusRecord(value: unknown): ClipperPermissionStatusRecord | null {
  if (!value || typeof value !== "object") return null;
  const parsed = value as Record<string, unknown>;
  const platform = parsed.platform === "tiktok" || parsed.platform === "instagram" || parsed.platform === "youtube" ? parsed.platform : null;
  const scope = typeof parsed.scope === "string" ? parsed.scope.trim() : "";
  if (!platform || !scope) return null;
  const permission = PERMISSION_QUEUE.find((item) => item.platform === platform && item.scope === scope);
  if (!permission) return null;
  return {
    id: permission.id,
    platform,
    scope,
    label: permission.label,
    status: parsePermissionTrackerInputStatus(parsed.status),
    notes: typeof parsed.notes === "string" && parsed.notes.trim()
      ? parsed.notes.trim()
      : "Registrado desde Clippers UI; no incluye secretos.",
    recordedAt: typeof parsed.recordedAt === "string" && parsed.recordedAt.trim()
      ? parsed.recordedAt.trim()
      : new Date(0).toISOString(),
    source: "clippers-ui",
  };
}

async function readPermissionStatusRecords(): Promise<ClipperPermissionStatusRecord[]> {
  try {
    const raw = await readFile(PERMISSION_STATUS_RECORDS_PATH, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    const candidates = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === "object" && Array.isArray((parsed as { records?: unknown }).records)
        ? (parsed as { records: unknown[] }).records
        : [];
    return candidates.map(normalizePermissionStatusRecord).filter((record): record is ClipperPermissionStatusRecord => Boolean(record));
  } catch {
    return [];
  }
}

async function writePermissionStatusRecords(records: ClipperPermissionStatusRecord[]): Promise<void> {
  await ensureClipperDirs();
  await writeFile(PERMISSION_STATUS_RECORDS_PATH, JSON.stringify({
    generatedAt: new Date().toISOString(),
    records,
  }, null, 2));
}

export async function recordClipperAccountEvidence(input: {
  accountId?: unknown;
  platform?: unknown;
  status?: unknown;
  notes?: unknown;
}, userId = getSystemUserId()): Promise<{ accountEvidence: ClipperAccountEvidenceSummary; status: ClipperStatus }> {
  await writeDefaultConfigIfMissing();
  await ensureClipperDirs();
  const accountId = typeof input.accountId === "string" ? input.accountId.trim() : "";
  const platform = parseClipperPlatform(input.platform);
  const evidenceStatus = parseAccountEvidenceInputStatus(input.status);
  const rawNotes = typeof input.notes === "string" && input.notes.trim() ? input.notes.trim() : "";
  const notes = evidenceStatus === "verified"
    ? requireRealEvidence(rawNotes, "Account evidence notes")
    : rawNotes || "Registrado desde Clippers UI; no incluye secretos.";
  const config = await readConfig();
  const accounts = (Array.isArray(config.accounts) && config.accounts.length ? config.accounts : DEFAULT_ACCOUNTS).map(ensureAccountShape);
  const account = accounts.find((item) => item.id === accountId);
  if (!account) throw new Error("Cuenta Clippers no encontrada.");
  const platformAccount = account.platformAccounts.find((item) => item.platform === platform);
  if (!platformAccount) throw new Error("La cuenta no tiene esa plataforma configurada.");
  const evidencePath = accountEvidenceJsonPath(account.id, platform);
  await writeFile(evidencePath, JSON.stringify({
    status: evidenceStatus,
    notes,
    accountId: account.id,
    accountName: account.name,
    platform,
    handle: platformAccount.handle,
    displayName: platformAccount.displayName,
    recordedAt: new Date().toISOString(),
    source: "clippers-ui",
  }, null, 2));
  return { accountEvidence: await buildAccountEvidenceSummary(accounts), status: await getClipperStatus(userId) };
}

function developerAppEvidencePath(platform: ClipperPlatform): string {
  return path.join(DEVELOPER_APP_EVIDENCE_DIR, `${platform}.json`);
}

function developerAppEvidenceTemplatePath(platform: ClipperPlatform): string {
  return path.join(DEVELOPER_APP_EVIDENCE_TEMPLATE_DIR, `${platform}.json`);
}

function parseDeveloperAppEvidenceStatus(value: unknown): ClipperDeveloperAppEvidenceItemStatus {
  const status = String(value || "draft").toLowerCase();
  if (status === "approved") return "approved";
  if (status === "submitted") return "submitted";
  if (status === "rejected") return "rejected";
  return "draft";
}

function developerAppIdentifier(platform: ClipperPlatform, parsed: Record<string, unknown>): string | null {
  const explicit = parsed.appIdentifier || parsed.appId || parsed.clientKey || parsed.projectId;
  if (typeof explicit === "string" && explicit.trim()) return explicit.trim();
  if (platform === "tiktok" && process.env.TIKTOK_CLIENT_KEY) return "env:TIKTOK_CLIENT_KEY";
  if (platform === "instagram" && process.env.META_APP_ID) return "env:META_APP_ID";
  if (platform === "youtube" && getGoogleOAuthClientId()) {
    const envName = getFirstConfiguredEnvName(GOOGLE_OAUTH_CLIENT_ID_ENV_VARS);
    return envName ? `env:${envName}` : null;
  }
  return null;
}

async function readDeveloperAppEvidenceItem(platform: ClipperPlatform, credentialChecks: ClipperCredentialCheck[]): Promise<ClipperDeveloperAppEvidenceItem | null> {
  const evidencePath = developerAppEvidencePath(platform);
  try {
    const fileStat = await stat(evidencePath);
    const raw = await readFile(evidencePath, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const requirement = PLATFORM_REQUIREMENTS.find((item) => item.platform === platform);
    const credentialCheck = credentialChecks.find((item) => item.platform === platform);
    const status = parseDeveloperAppEvidenceStatus(parsed.status);
    return {
      platform,
      label: requirement?.label || platform,
      status,
      evidencePath,
      updatedAt: fileStat.mtime.toISOString(),
      appIdentifier: developerAppIdentifier(platform, parsed),
      publicBaseUrl: typeof parsed.publicBaseUrl === "string" ? parsed.publicBaseUrl : process.env.PUBLIC_BASE_URL || null,
      redirectUri: buildRedirectUri(platform),
      configuredEnvVars: credentialCheck?.configuredEnvVars || [],
      missingEnvVars: credentialCheck?.missingEnvVars || [],
      notes: typeof parsed.notes === "string" ? parsed.notes : "Developer app evidence submitted.",
      nextStep: status === "approved"
        ? "App developer aprobada; conectar OAuth y guardar token cifrado."
        : status === "submitted"
          ? "Esperar app review, responder requests de plataforma y actualizar status approved/rejected."
          : status === "rejected"
            ? "Corregir app review/evidencia y reenviar."
            : "Completar app developer, redirect URIs, scopes y enviar app review.",
    };
  } catch {
    return null;
  }
}

async function buildDeveloperAppEvidenceSummary(): Promise<ClipperDeveloperAppEvidenceSummary> {
  await ensureClipperDirs();
  const credentialChecks = buildCredentialChecks();
  const platforms = ["tiktok", "instagram", "youtube"] as ClipperPlatform[];
  const items = (await Promise.all(platforms.map((platform) => readDeveloperAppEvidenceItem(platform, credentialChecks))))
    .filter((item): item is ClipperDeveloperAppEvidenceItem => Boolean(item));
  const approved = items.filter((item) => item.status === "approved").length;
  const submitted = items.filter((item) => item.status === "submitted").length;
  const draft = items.filter((item) => item.status === "draft").length;
  const rejected = items.filter((item) => item.status === "rejected").length;
  const expected = platforms.length;
  const missing = Math.max(expected - items.length, 0);
  const generatedAt = await stat(DEVELOPER_APP_EVIDENCE_README_PATH).then((file) => file.mtime.toISOString()).catch(() => null);
  return {
    status: approved === expected ? "ready" : items.length > 0 ? "partial" : "empty",
    evidenceDir: DEVELOPER_APP_EVIDENCE_DIR,
    templateDir: DEVELOPER_APP_EVIDENCE_TEMPLATE_DIR,
    readmePath: DEVELOPER_APP_EVIDENCE_README_PATH,
    generatedAt,
    items,
    totals: { expected, approved, submitted, draft, rejected, missing },
    nextStep: missing > 0
      ? "Crear evidencia de developer app por plataforma usando los templates."
      : approved === expected
        ? "Developer apps aprobadas; avanzar con OAuth/token vault."
        : "Mover apps draft/submitted hasta approved para desbloquear permisos reales.",
  };
}

function renderDeveloperAppEvidenceReadme(): string {
  return [
    "# Clippers Developer App Evidence",
    "",
    "Esta carpeta rastrea apps/proyectos developer para TikTok, Meta/Instagram y Google/YouTube.",
    "",
    "No pegues secretos aqui. Guarda solo IDs no secretos, estado de app review y notas operativas.",
    "",
    "Archivos reales esperados en la raiz:",
    "",
    "- tiktok.json",
    "- instagram.json",
    "- youtube.json",
    "",
    "Usa los templates en `templates/` y cambia `status` a `submitted` o `approved` cuando aplique.",
    "",
  ].join("\n");
}

function renderDeveloperAppEvidenceTemplate(platform: ClipperPlatform): string {
  const requirement = PLATFORM_REQUIREMENTS.find((item) => item.platform === platform);
  const credentialCheck = getCredentialCheck(platform);
  return JSON.stringify({
    platform,
    label: requirement?.label || platform,
    status: "draft",
    appIdentifier: "",
    publicBaseUrl: process.env.PUBLIC_BASE_URL || "",
    redirectUri: buildRedirectUri(platform),
    requiredEnvVars: credentialCheck.requiredEnvVars,
    scopes: PLATFORM_SCOPES[platform],
    developerPortalUrl: requirement?.developerPortalUrl || "",
    notes: "Crear app/proyecto, registrar redirect URI, pedir scopes y completar review.",
  }, null, 2);
}

export async function prepareClipperDeveloperAppEvidenceVault(userId = getSystemUserId()): Promise<{ developerAppEvidence: ClipperDeveloperAppEvidenceSummary; status: ClipperStatus }> {
  await writeDefaultConfigIfMissing();
  await ensureClipperDirs();
  await writeFile(DEVELOPER_APP_EVIDENCE_README_PATH, renderDeveloperAppEvidenceReadme());
  await Promise.all((["tiktok", "instagram", "youtube"] as ClipperPlatform[]).map((platform) =>
    writeFile(developerAppEvidenceTemplatePath(platform), renderDeveloperAppEvidenceTemplate(platform))
  ));
  return { developerAppEvidence: await buildDeveloperAppEvidenceSummary(), status: await getClipperStatus(userId) };
}

export async function recordClipperDeveloperAppEvidence(input: {
  platform?: unknown;
  status?: unknown;
  appIdentifier?: unknown;
  publicBaseUrl?: unknown;
  notes?: unknown;
}, userId = getSystemUserId()): Promise<{ developerAppEvidence: ClipperDeveloperAppEvidenceSummary; status: ClipperStatus }> {
  await writeDefaultConfigIfMissing();
  await ensureClipperDirs();
  const platform = parseClipperPlatform(input.platform);
  const evidenceStatus = parseDeveloperAppEvidenceInputStatus(input.status);
  const requirement = PLATFORM_REQUIREMENTS.find((item) => item.platform === platform);
  const appIdentifier = typeof input.appIdentifier === "string" ? input.appIdentifier.trim() : "";
  const publicBaseUrl = typeof input.publicBaseUrl === "string" ? input.publicBaseUrl.trim() : "";
  const rawNotes = typeof input.notes === "string" && input.notes.trim()
    ? input.notes.trim()
    : "Registrado desde Clippers UI; no incluye client secrets ni tokens.";
  const requiresSubmissionEvidence = evidenceStatus === "submitted" || evidenceStatus === "approved";
  const notes = requiresSubmissionEvidence ? requireRealEvidence(rawNotes, "Developer app notes") : rawNotes;
  const safeAppIdentifier = requiresSubmissionEvidence ? requireRealEvidence(appIdentifier, "Developer app identifier") : appIdentifier;
  const safePublicBaseUrl = requiresSubmissionEvidence ? requireRealEvidence(publicBaseUrl, "Developer app public URL") : publicBaseUrl;
  if (requiresSubmissionEvidence && !isProductionPublicBaseUrl(safePublicBaseUrl)) {
    throw new Error("Developer app public URL requiere una URL publica HTTPS, no localhost/127/local.");
  }
  const evidencePath = developerAppEvidencePath(platform);
  await writeFile(evidencePath, JSON.stringify({
    platform,
    label: requirement?.label || platform,
    status: evidenceStatus,
    appIdentifier: safeAppIdentifier,
    publicBaseUrl: safePublicBaseUrl,
    redirectUri: buildRedirectUri(platform),
    scopes: PLATFORM_SCOPES[platform],
    developerPortalUrl: requirement?.developerPortalUrl || "",
    notes,
    recordedAt: new Date().toISOString(),
    source: "clippers-ui",
  }, null, 2));
  return { developerAppEvidence: await buildDeveloperAppEvidenceSummary(), status: await getClipperStatus(userId) };
}

export async function recordClipperPermissionStatus(input: {
  platform?: unknown;
  scope?: unknown;
  status?: unknown;
  notes?: unknown;
}, userId = getSystemUserId()): Promise<{ permissionStatusRecord: ClipperPermissionStatusRecord; permissionTracker: ClipperPermissionTrackerSummary; status: ClipperStatus }> {
  await writeDefaultConfigIfMissing();
  await ensureClipperDirs();
  const platform = parseClipperPlatform(input.platform);
  const scope = typeof input.scope === "string" ? input.scope.trim() : "";
  const permission = PERMISSION_QUEUE.find((item) => item.platform === platform && item.scope === scope);
  if (!permission) throw new Error("Permiso/scope no encontrado en la cola de Clippers.");
  const permissionStatus = parsePermissionTrackerInputStatus(input.status);
  const rawNotes = typeof input.notes === "string" && input.notes.trim()
    ? input.notes.trim()
    : "Registrado desde Clippers UI; no incluye secretos.";
  const notes = permissionStatus === "requested" || permissionStatus === "approved"
    ? requireRealEvidence(rawNotes, "Permission notes")
    : rawNotes;
  const record: ClipperPermissionStatusRecord = {
    id: permission.id,
    platform,
    scope,
    label: permission.label,
    status: permissionStatus,
    notes,
    recordedAt: new Date().toISOString(),
    source: "clippers-ui",
  };
  const existing = await readPermissionStatusRecords();
  const nextRecords = [
    ...existing.filter((item) => !(item.platform === platform && item.scope === scope)),
    record,
  ].sort((a, b) => a.platform.localeCompare(b.platform) || a.scope.localeCompare(b.scope));
  await writePermissionStatusRecords(nextRecords);
  const statusSnapshot = await getClipperStatus(userId);
  return {
    permissionStatusRecord: record,
    permissionTracker: statusSnapshot.permissionTracker,
    status: statusSnapshot,
  };
}

function parseLaunchEvidenceBatchRows(input: unknown): Record<string, unknown>[] {
  if (!input || typeof input !== "object") throw new Error("Payload requerido.");
  const incoming = input as Record<string, unknown>;
  if (Array.isArray(incoming.records)) {
    return incoming.records.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object");
  }
  const raw = typeof incoming.batchText === "string" ? incoming.batchText.trim() : "";
  if (!raw) throw new Error("Pega CSV/JSON con evidencia de cuentas, apps o permisos.");
  if (raw.startsWith("[") || raw.startsWith("{")) return parseJsonMetricRecords(raw);
  return parseCsvRecords(raw);
}

function launchEvidenceKind(record: Record<string, unknown>): string {
  return firstString(record, ["kind", "type", "record_type"]).toLowerCase().replace(/[^a-z_]+/g, "_");
}

function launchEvidenceIdentifier(record: Record<string, unknown>): string | null {
  return firstString(record, ["id", "asset_id", "source_path", "file_name", "account_id", "scope", "app_identifier", "platform"]) || null;
}

function parseClipperSourceCategory(value: string): ClipperAccountCategory | null {
  const normalized = value.toLowerCase().trim();
  if (normalized === "sports" || normalized === "deportes") return "sports";
  if (normalized === "memes" || normalized === "meme") return "memes";
  if (normalized === "streamers" || normalized === "streamer") return "streamers";
  return null;
}

function findLaunchEvidenceSourceAsset(assets: ClipperSourceAsset[], record: Record<string, unknown>): ClipperSourceAsset | null {
  const assetId = firstString(record, ["asset_id", "assetId", "id", "account_id", "accountId"]);
  const sourcePath = firstString(record, ["source_path", "sourcePath", "path", "asset_or_source", "app_identifier", "appIdentifier", "public_base_url", "publicBaseUrl"]);
  const fileName = firstString(record, ["file_name", "fileName", "filename", "asset", "asset_name", "scope", "account_id", "accountId"]);
  const category = parseClipperSourceCategory(firstString(record, ["category", "vertical", "account_category", "niche", "platform"]));
  const candidates = category ? assets.filter((asset) => asset.category === category) : assets;
  if (assetId) {
    const match = candidates.find((asset) => asset.id === assetId);
    if (match) return match;
  }
  if (sourcePath) {
    const match = candidates.find((asset) => asset.path === sourcePath || asset.path.endsWith(sourcePath) || sourcePath.endsWith(asset.fileName));
    if (match) return match;
  }
  if (fileName) {
    const match = candidates.find((asset) => asset.fileName === fileName);
    if (match) return match;
  }
  return null;
}

async function processClipperLaunchEvidenceBatch(input: unknown, options: { dryRun: boolean }, userId = getSystemUserId()): Promise<ClipperLaunchEvidenceBatchSummary> {
  await writeDefaultConfigIfMissing();
  await ensureClipperDirs();
  const rows = parseLaunchEvidenceBatchRows(input);
  if (!rows.length) throw new Error("No encontre records validos para importar.");

  const config = await readConfig();
  const accounts = (Array.isArray(config.accounts) && config.accounts.length ? config.accounts : DEFAULT_ACCOUNTS).map(ensureAccountShape);
  const rejected: ClipperLaunchEvidenceBatchRejectedItem[] = [];
  const accepted = { accountEvidence: 0, developerApps: 0, permissions: 0, sourceRights: 0 };
  const permissionRecords = await readPermissionStatusRecords();
  const permissionRecordMap = new Map(permissionRecords.map((record) => [`${record.platform}:${record.scope}`, record]));
  const sourceAssets = await listSourceAssets();

  for (const [index, record] of rows.entries()) {
    const kind = launchEvidenceKind(record);
    try {
      if (kind === "account" || kind === "account_evidence" || kind === "account_platform") {
        const accountId = firstString(record, ["account_id", "accountId"]);
        const platform = parseClipperPlatform(firstString(record, ["platform"]));
        const account = accounts.find((item) => item.id === accountId);
        if (!account) throw new Error("Cuenta Clippers no encontrada.");
        const platformAccount = account.platformAccounts.find((item) => item.platform === platform);
        if (!platformAccount) throw new Error("La cuenta no tiene esa plataforma configurada.");
        const evidenceStatus = parseAccountEvidenceInputStatus(firstString(record, ["status"]));
        const notes = requireRealEvidence(firstString(record, ["notes", "evidence", "url", "profile_url"]), "Account evidence notes");
        if (!options.dryRun) {
          await writeFile(accountEvidenceJsonPath(account.id, platform), JSON.stringify({
            status: evidenceStatus,
            notes,
            accountId: account.id,
            accountName: account.name,
            platform,
            handle: platformAccount.handle,
            displayName: platformAccount.displayName,
            recordedAt: new Date().toISOString(),
            source: "clippers-ui",
          }, null, 2));
        }
        accepted.accountEvidence += 1;
      } else if (kind === "developer_app" || kind === "developer" || kind === "app") {
        const platform = parseClipperPlatform(firstString(record, ["platform"]));
        const requirement = PLATFORM_REQUIREMENTS.find((item) => item.platform === platform);
        const evidenceStatus = parseDeveloperAppEvidenceInputStatus(firstString(record, ["status"]));
        const appIdentifier = requireRealEvidence(firstString(record, ["app_identifier", "appIdentifier", "app_id", "client_key", "project_id"]), "Developer app identifier");
        const publicBaseUrl = requireRealEvidence(firstString(record, ["public_base_url", "publicBaseUrl", "base_url"]) || process.env.PUBLIC_BASE_URL || "", "Developer app public URL");
        const notes = requireRealEvidence(firstString(record, ["notes", "review_notes", "evidence"]), "Developer app notes");
        if (!options.dryRun) {
          await writeFile(developerAppEvidencePath(platform), JSON.stringify({
            platform,
            label: requirement?.label || platform,
            status: evidenceStatus,
            appIdentifier,
            publicBaseUrl,
            redirectUri: buildRedirectUri(platform),
            scopes: PLATFORM_SCOPES[platform],
            developerPortalUrl: requirement?.developerPortalUrl || "",
            notes,
            recordedAt: new Date().toISOString(),
            source: "clippers-ui",
          }, null, 2));
        }
        accepted.developerApps += 1;
      } else if (kind === "permission" || kind === "scope" || kind === "app_review") {
        const platform = parseClipperPlatform(firstString(record, ["platform"]));
        const scope = firstString(record, ["scope", "permission"]);
        const permission = PERMISSION_QUEUE.find((item) => item.platform === platform && item.scope === scope);
        if (!permission) throw new Error("Permiso/scope no encontrado.");
        const permissionStatus = parsePermissionTrackerInputStatus(firstString(record, ["status"]));
        const notes = requireRealEvidence(firstString(record, ["notes", "review_notes", "evidence"]), "Permission notes");
        if (!options.dryRun) {
          permissionRecordMap.set(`${platform}:${scope}`, {
            id: permission.id,
            platform,
            scope,
            label: permission.label,
            status: permissionStatus,
            notes,
            recordedAt: new Date().toISOString(),
            source: "clippers-ui",
          });
        }
        accepted.permissions += 1;
      } else if (kind === "source_rights" || kind === "source" || kind === "rights" || kind === "source_asset") {
        const asset = findLaunchEvidenceSourceAsset(sourceAssets, record);
        if (!asset) throw new Error("Source asset no encontrado; usa asset_id, source_path o file_name existente.");
        const rightsStatus: ClipperAssetRightsStatus = firstString(record, ["status", "rights_status", "rightsStatus"]) === "review_required"
          ? "review_required"
          : "owned_or_permissioned";
        if (rightsStatus !== "owned_or_permissioned") {
          throw new Error("Source rights debe quedar owned_or_permissioned para desbloquear produccion.");
        }
        const notes = requireRealEvidence(firstString(record, ["notes", "evidence", "evidence_link", "permission_note", "rights_notes", "license"]), "Source rights notes");
        if (!options.dryRun) {
          const sourceRightsRecord: ClipperSourceRightsRecord = {
            assetId: asset.id,
            category: asset.category,
            fileName: asset.fileName,
            sourcePath: asset.path,
            rightsStatus,
            evidencePath: sourceRightsEvidencePath(asset),
            notes,
            recordedAt: new Date().toISOString(),
            source: "clippers-ui",
          };
          await writeFile(sourceRightsRecord.evidencePath, renderSourceRightsEvidence(sourceRightsRecord));
        }
        accepted.sourceRights += 1;
      } else {
        throw new Error("kind debe ser account, developer_app, permission o source_rights.");
      }
    } catch (error) {
      rejected.push({
        index: index + 1,
        kind: kind || "unknown",
        reason: error instanceof Error ? error.message : String(error),
        identifier: launchEvidenceIdentifier(record),
      });
    }
  }

  if (!options.dryRun) {
    await writePermissionStatusRecords(Array.from(permissionRecordMap.values())
      .sort((a, b) => a.platform.localeCompare(b.platform) || a.scope.localeCompare(b.scope)));
  }

  const statusSnapshot = await getClipperStatus(userId);
  return {
    updatedAt: new Date().toISOString(),
    accepted,
    rejected,
    accountEvidence: statusSnapshot.accountEvidence,
    developerAppEvidence: statusSnapshot.developerAppEvidence,
    permissionTracker: statusSnapshot.permissionTracker,
    nextStep: options.dryRun
      ? rejected.length
        ? "Preview listo: corrige rejected antes de importar para no dejar evidencia incompleta."
        : "Preview listo: las filas son importables; puedes importar batch."
      : rejected.length
        ? "Revisar rejected y corregir rows; luego regenerar Command Center."
        : "Evidencia batch registrada; regenerar Platform Readiness y Command Center.",
  };
}

export async function previewClipperLaunchEvidenceBatch(input: unknown, userId = getSystemUserId()): Promise<{ launchEvidenceBatchPreview: ClipperLaunchEvidenceBatchSummary; status: ClipperStatus }> {
  const launchEvidenceBatchPreview = await processClipperLaunchEvidenceBatch(input, { dryRun: true }, userId);
  return {
    launchEvidenceBatchPreview,
    status: await getClipperStatus(userId),
  };
}

export async function recordClipperLaunchEvidenceBatch(input: unknown, userId = getSystemUserId()): Promise<{ launchEvidenceBatch: ClipperLaunchEvidenceBatchSummary; status: ClipperStatus }> {
  const launchEvidenceBatch = await processClipperLaunchEvidenceBatch(input, { dryRun: false }, userId);
  const statusSnapshot = await getClipperStatus(userId);
  return {
    launchEvidenceBatch,
    status: statusSnapshot,
  };
}

function launchEvidenceDropFileAllowed(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return lower.endsWith(".csv") || lower.endsWith(".json") || lower.endsWith(".jsonl") || lower.endsWith(".txt");
}

function parseLaunchEvidenceDropRaw(raw: string): Record<string, unknown>[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return parseJsonMetricRecords(trimmed);
  if (trimmed.includes("\n")) return parseCsvRecords(trimmed);
  return [];
}

async function readLaunchEvidenceDropRows(): Promise<{
  rows: Record<string, unknown>[];
  sourceFiles: string[];
  filesScanned: number;
  filesImported: number;
  fileErrors: Array<{ relativePath: string; reason: string }>;
}> {
  await ensureClipperDirs();
  const entries = await readdir(LAUNCH_EVIDENCE_DROP_DIR, { withFileTypes: true }).catch(() => []);
  const rows: Record<string, unknown>[] = [];
  const sourceFiles: string[] = [];
  const fileErrors: Array<{ relativePath: string; reason: string }> = [];
  let filesScanned = 0;
  for (const entry of entries) {
    if (!entry.isFile() || entry.name === "README.md" || entry.name === path.basename(LAUNCH_EVIDENCE_TEMPLATE_PATH) || !launchEvidenceDropFileAllowed(entry.name)) continue;
    filesScanned += 1;
    const absolutePath = path.join(LAUNCH_EVIDENCE_DROP_DIR, entry.name);
    const relativePath = path.relative(process.cwd(), absolutePath);
    const fileStat = await stat(absolutePath).catch(() => null);
    if (!fileStat?.isFile()) {
      fileErrors.push({ relativePath, reason: "Archivo no encontrado." });
      continue;
    }
    if (fileStat.size > 512_000) {
      fileErrors.push({ relativePath, reason: "Archivo demasiado grande para import de evidencia." });
      continue;
    }
    const raw = await readFile(absolutePath, "utf8").catch(() => "");
    try {
      const parsedRows = parseLaunchEvidenceDropRaw(raw);
      if (!parsedRows.length) {
        fileErrors.push({ relativePath, reason: "No contiene rows CSV/JSON importables." });
        continue;
      }
      rows.push(...parsedRows);
      sourceFiles.push(relativePath);
    } catch (error) {
      fileErrors.push({ relativePath, reason: error instanceof Error ? error.message : String(error) });
    }
  }
  return { rows, sourceFiles, filesScanned, filesImported: sourceFiles.length, fileErrors };
}

export async function importClipperLaunchEvidenceDropFiles(userId = getSystemUserId()): Promise<{ launchEvidenceDropImport: ClipperLaunchEvidenceBatchSummary; status: ClipperStatus }> {
  const drop = await readLaunchEvidenceDropRows();
  if (!drop.rows.length) {
    throw new Error(drop.filesScanned
      ? `Revise ${drop.filesScanned} archivo(s), pero no encontre rows importables en evidence-drop.`
      : `Coloca CSV/JSON de launch evidence en ${path.relative(process.cwd(), LAUNCH_EVIDENCE_DROP_DIR)}.`);
  }
  const launchEvidenceDropImport = await processClipperLaunchEvidenceBatch({ records: drop.rows }, { dryRun: false }, userId);
  const withDropMeta: ClipperLaunchEvidenceBatchSummary = {
    ...launchEvidenceDropImport,
    sourceFiles: drop.sourceFiles,
    filesScanned: drop.filesScanned,
    filesImported: drop.filesImported,
    fileErrors: drop.fileErrors,
    nextStep: launchEvidenceDropImport.rejected.length || drop.fileErrors.length
      ? "Evidence drop importado parcialmente; revisa rejected/file errors y vuelve a importar."
      : "Evidence drop importado; regenerar Platform Readiness y Command Center.",
  };
  return {
    launchEvidenceDropImport: withDropMeta,
    status: await getClipperStatus(userId),
  };
}

function envGroupIsConfigured(group: string[]): boolean {
  return group.some((envVar) => Boolean(process.env[envVar]));
}

async function existingLocalEnvFiles(): Promise<string[]> {
  const found: string[] = [];
  for (const fileName of LOCAL_ENV_FILE_CANDIDATES) {
    const filePath = path.join(process.cwd(), fileName);
    const exists = await stat(filePath).then((file) => file.isFile()).catch(() => false);
    if (exists) found.push(fileName);
  }
  return found;
}

function credentialSetupItem(input: {
  id: string;
  label: string;
  acceptedEnvVarGroups: string[][];
  docsUrl: string;
  readyWhen?: () => boolean;
  nextStepReady: string;
  nextStepMissing: string;
}): ClipperCredentialSetupItem {
  const configuredEnvVars = input.acceptedEnvVarGroups.flatMap((group) => group.filter((envVar) => Boolean(process.env[envVar])));
  const missingEnvVarGroups = input.acceptedEnvVarGroups
    .filter((group) => !envGroupIsConfigured(group))
    .map((group) => group.join(" or "));
  const groupsReady = missingEnvVarGroups.length === 0;
  const ready = input.readyWhen ? input.readyWhen() : groupsReady;
  const status: ClipperCredentialSetupStatus = ready ? "ready" : configuredEnvVars.length > 0 ? "partial" : "missing";
  return {
    id: input.id,
    label: input.label,
    status,
    acceptedEnvVarGroups: input.acceptedEnvVarGroups,
    configuredEnvVars,
    missingEnvVarGroups,
    docsUrl: input.docsUrl,
    nextStep: status === "ready" ? input.nextStepReady : input.nextStepMissing,
  };
}

function credentialImportPlanItem(item: ClipperCredentialSetupItem): ClipperCredentialImportPlanItem {
  const suggestedEnvVars = item.acceptedEnvVarGroups.map((group) => group[0]).filter(Boolean);
  const missingSuggestedEnvVars = item.acceptedEnvVarGroups
    .filter((group) => !envGroupIsConfigured(group))
    .map((group) => group[0])
    .filter(Boolean);
  const supportedInputFormats = ["KEY=value .env lines"];
  if (item.id === "google-youtube-oauth" || item.id === "google-drive-refresh") {
    supportedInputFormats.push("Google OAuth JSON client");
  }
  return {
    id: item.id,
    label: item.label,
    status: item.status,
    acceptedEnvVarGroups: item.acceptedEnvVarGroups,
    suggestedEnvVars,
    configuredEnvVars: item.configuredEnvVars,
    missingEnvVarGroups: item.missingEnvVarGroups,
    supportedInputFormats,
    pasteTemplate: missingSuggestedEnvVars.map((envVar) => `${envVar}=`).join("\n"),
    verificationSteps: [
      "Pegar valores reales en Credential Setup batch o en CEO_ASSISTANT_ENV.",
      "Usar Preview keys para confirmar que las variables son aceptadas.",
      "Guardar batch, ejecutar Reload keys y preparar Credential Doctor.",
      `Verificar que ${item.label} cambie a ready o partial sin exponer valores secretos.`,
    ],
    nextStep: item.nextStep,
  };
}

function credentialStatusFromMatchedGroups(totalGroups: number, missingGroups: number, matchedEnvVars: string[]): ClipperCredentialSetupStatus {
  if (totalGroups > 0 && missingGroups === 0) return "ready";
  if (matchedEnvVars.length > 0) return "partial";
  return "missing";
}

async function buildCredentialSetupEnvFileScans(items: ClipperCredentialSetupItem[]): Promise<ClipperCredentialSetupEnvFileScan[]> {
  const envFiles = await buildCredentialDoctorEnvFiles();
  return envFiles.map((envFile) => {
    const relevantKeySet = new Set(envFile.relevantKeys);
    const itemScans = items.map<ClipperCredentialSetupEnvFileItemScan>((item) => {
      const matchedEnvVars = item.acceptedEnvVarGroups
        .flat()
        .filter((envVar) => relevantKeySet.has(envVar));
      const missingEnvVarGroups = item.acceptedEnvVarGroups
        .filter((group) => !group.some((envVar) => relevantKeySet.has(envVar)))
        .map((group) => group.join(" or "));
      return {
        id: item.id,
        label: item.label,
        statusFromFile: credentialStatusFromMatchedGroups(item.acceptedEnvVarGroups.length, missingEnvVarGroups.length, matchedEnvVars),
        matchedEnvVars,
        missingEnvVarGroups,
      };
    }).filter((scan) => scan.statusFromFile !== "missing" || scan.matchedEnvVars.length > 0);
    return {
      fileName: envFile.fileName,
      exists: envFile.exists,
      relevantKeys: envFile.relevantKeys,
      itemScans,
    };
  });
}

async function buildCredentialSetupFileScans(): Promise<ClipperCredentialSetupFileScan[]> {
  const scanDirs = Array.from(new Set([
    process.cwd(),
    CREDENTIAL_DROP_DIR,
    SECRET_DROP_DIR,
  ]));
  const seen = new Set<string>();
  const candidates: ClipperCredentialSetupFileScan[] = [];
  for (const dir of scanDirs) {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const fileName = entry.name;
      const lower = fileName.toLowerCase();
      if (lower.includes("template") || lower.includes("example") || lower.endsWith(".sample")) continue;
      const absolutePath = path.join(dir, fileName);
      if (seen.has(absolutePath)) continue;
      seen.add(absolutePath);
      const isGoogleJson = lower.endsWith(".json") && /(google|youtube|drive|oauth|client_secret|credential|credentials)/.test(lower);
      const isEnvFile = lower.includes("env") && !LOCAL_ENV_FILE_CANDIDATES.includes(fileName);
      if (!isGoogleJson && !isEnvFile) continue;
      candidates.push({
        fileName,
        relativePath: path.relative(process.cwd(), absolutePath) || fileName,
        kind: isGoogleJson ? "google_oauth_json" : isEnvFile ? "env_file" : "unknown",
        suggestedImportTarget: isGoogleJson ? "google-youtube-oauth" : "credential-secrets-batch",
        supportedInputFormat: isGoogleJson ? "Google OAuth JSON client" : "KEY=value .env lines",
        nextStep: isGoogleJson
          ? "Abrir el archivo localmente, pegar su JSON en Credential Setup batch, usar Preview keys y luego Save batch."
          : "Copiar solo lineas KEY=value permitidas al Credential Setup batch, usar Preview keys y luego Save batch.",
      });
    }
  }
  return candidates.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

async function buildCredentialSetupSummary(): Promise<ClipperCredentialSetupSummary> {
  await ensureClipperDirs();
  const envFilesFound = await existingLocalEnvFiles();
  const items: ClipperCredentialSetupItem[] = [
    credentialSetupItem({
      id: "tiktok-oauth",
      label: "TikTok app credentials",
      acceptedEnvVarGroups: [["TIKTOK_CLIENT_KEY"], ["TIKTOK_CLIENT_SECRET"]],
      docsUrl: "https://developers.tiktok.com/doc/content-posting-api-get-started/",
      nextStepReady: "TikTok client key/secret detectados; conectar OAuth despues de app review.",
      nextStepMissing: "Agregar TIKTOK_CLIENT_KEY y TIKTOK_CLIENT_SECRET desde TikTok for Developers.",
    }),
    credentialSetupItem({
      id: "meta-oauth",
      label: "Meta / Instagram app credentials",
      acceptedEnvVarGroups: [["META_APP_ID"], ["META_APP_SECRET"]],
      docsUrl: "https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/content-publishing/",
      nextStepReady: "Meta app id/secret detectados; conectar cuenta profesional y solicitar permisos.",
      nextStepMissing: "Agregar META_APP_ID y META_APP_SECRET desde Meta Developers.",
    }),
    credentialSetupItem({
      id: "google-youtube-oauth",
      label: "Google / YouTube OAuth credentials",
      acceptedEnvVarGroups: [GOOGLE_OAUTH_CLIENT_ID_ENV_VARS, GOOGLE_OAUTH_CLIENT_SECRET_ENV_VARS],
      docsUrl: "https://developers.google.com/youtube/v3/docs/videos/insert",
      nextStepReady: "Google OAuth client detectado; conectar YouTube y autorizar youtube.upload.",
      nextStepMissing: "Agregar GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET o un alias Google/Drive/YouTube OAuth aceptado.",
    }),
    credentialSetupItem({
      id: "google-drive-refresh",
      label: "Google Drive workspace access",
      acceptedEnvVarGroups: [GOOGLE_REFRESH_TOKEN_ENV_VARS],
      docsUrl: "https://developers.google.com/drive/api/guides/about-sdk",
      readyWhen: hasGoogleDriveRefreshToken,
      nextStepReady: "Refresh token de Drive detectado; preparar carpetas de Clippers en Drive.",
      nextStepMissing: hasGoogleDriveKeys()
        ? "Las keys de Google existen; abrir /api/google-drive/auth, autorizar Drive y volver a preparar workspace."
        : "Agregar keys de Google OAuth o refresh token para que Drive pueda crear carpetas.",
    }),
    credentialSetupItem({
      id: "token-vault",
      label: "Encrypted token vault",
      acceptedEnvVarGroups: [[TOKEN_ENCRYPTION_ENV_VAR]],
      docsUrl: "local:clippers-token-vault",
      nextStepReady: "Token vault encryption key detectada; los tokens se pueden guardar cifrados.",
      nextStepMissing: `Agregar ${TOKEN_ENCRYPTION_ENV_VAR} con al menos 32 caracteres.`,
    }),
  ];
  const importPlan = items.map(credentialImportPlanItem);
  const envFileScans = await buildCredentialSetupEnvFileScans(items);
  const credentialFileScans = await buildCredentialSetupFileScans();
  const totals = items.reduce<ClipperCredentialSetupSummary["totals"]>((sum, item) => {
    sum.items += 1;
    if (item.status === "ready") sum.ready += 1;
    if (item.status === "partial") sum.partial += 1;
    if (item.status === "missing") sum.missing += 1;
    return sum;
  }, { items: 0, ready: 0, partial: 0, missing: 0 });
  const generatedAt = await stat(CREDENTIAL_SETUP_README_PATH).then((file) => file.mtime.toISOString()).catch(() => null);
  return {
    status: totals.ready === totals.items ? "ready" : totals.ready > 0 || totals.partial > 0 ? "partial" : "missing",
    generatedAt,
    readmePath: CREDENTIAL_SETUP_README_PATH,
    templatePath: CREDENTIAL_SETUP_TEMPLATE_PATH,
    missingTemplatePath: CREDENTIAL_SETUP_MISSING_TEMPLATE_PATH,
    envFilesChecked: LOCAL_ENV_FILE_CANDIDATES,
    envFilesFound,
    credentialDropDirs: [CREDENTIAL_DROP_DIR, SECRET_DROP_DIR],
    envFileScans,
    credentialFileScans,
    items,
    importPlan,
    totals,
    nextStep: items.find((item) => item.status === "missing")?.nextStep
      || items.find((item) => item.status === "partial")?.nextStep
      || "Credenciales listas; conectar OAuth y preparar Drive.",
  };
}

function renderCredentialSetupReadme(summary: ClipperCredentialSetupSummary): string {
  return [
    "# Clippers Credential Setup Center",
    "",
    "Este centro no guarda secretos reales. Usa el template para copiar nombres de variables a tu .env local, CEO_ASSISTANT_ENV o secret manager.",
    "",
    `Status: ${summary.status}`,
    `Env files checked: ${summary.envFilesChecked.join(", ")}`,
    `Env files found: ${summary.envFilesFound.length ? summary.envFilesFound.join(", ") : "none"}`,
    `Credential drop dirs: ${summary.credentialDropDirs.join(", ")}`,
    "",
    "## Fast Import",
    "",
    "En la UI de Clippers puedes pegar un batch .env o el JSON OAuth client descargado de Google Cloud.",
    `Tambien puedes colocar archivos candidatos en: ${summary.credentialDropDirs.join(", ")}.`,
    "El importador acepta JSON con web.client_id/web.client_secret o installed.client_id/installed.client_secret y lo convierte a GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET.",
    "Usa Preview keys antes de guardar; las respuestas y artifacts solo muestran nombres de variables, nunca valores secretos.",
    "Despues de Guardar batch, ejecuta Reload keys y Credential Doctor para confirmar que Google/YouTube/Drive quedaron detectados.",
    "",
    "## Safe Env File Audit",
    "",
    "Este audit solo muestra nombres de variables encontradas por archivo. No imprime valores.",
    "",
    ...summary.envFileScans.flatMap((file) => [
      `### ${file.fileName}`,
      "",
      `- Exists: ${file.exists ? "yes" : "no"}`,
      `- Relevant keys: ${file.relevantKeys.length ? file.relevantKeys.join(", ") : "none"}`,
      `- Matched groups: ${file.itemScans.length ? file.itemScans.map((scan) => `${scan.label}=${scan.statusFromFile}`).join("; ") : "none"}`,
      "",
      ...file.itemScans.flatMap((scan) => [
        `- ${scan.label}: ${scan.statusFromFile}`,
        `  - Matched names: ${scan.matchedEnvVars.length ? scan.matchedEnvVars.join(", ") : "none"}`,
        `  - Missing groups from this file: ${scan.missingEnvVarGroups.length ? scan.missingEnvVarGroups.join("; ") : "none"}`,
      ]),
      "",
    ]),
    "Si una key existe en otro lugar pero no aparece aqui, pegala desde Credential Setup batch o mueve el nombre exacto a uno de los archivos revisados.",
    "",
    "## Credential File Candidates",
    "",
    "Este scan solo mira nombres/rutas de archivos candidatos. No lee ni imprime valores secretos.",
    "",
    ...(summary.credentialFileScans.length ? summary.credentialFileScans.flatMap((file) => [
      `### ${file.fileName}`,
      "",
      `- Path: ${file.relativePath}`,
      `- Kind: ${file.kind}`,
      `- Supported input: ${file.supportedInputFormat}`,
      `- Suggested import target: ${file.suggestedImportTarget}`,
      `- Next step: ${file.nextStep}`,
      "",
    ]) : ["No credential JSON/env candidates found outside generated templates.", ""]),
    "## Import Plan",
    "",
    ...summary.importPlan.flatMap((item) => [
      `### ${item.label}`,
      "",
      `- Status: ${item.status}`,
      `- Supported input: ${item.supportedInputFormats.join("; ")}`,
      `- Suggested vars: ${item.suggestedEnvVars.join(", ")}`,
      `- Configured names: ${item.configuredEnvVars.length ? item.configuredEnvVars.join(", ") : "none"}`,
      `- Missing groups: ${item.missingEnvVarGroups.length ? item.missingEnvVarGroups.join("; ") : "none"}`,
      `- Next step: ${item.nextStep}`,
      "",
      "Paste template:",
      "",
      "```env",
      item.pasteTemplate || "# no missing env vars",
      "```",
      "",
      "Verification:",
      ...item.verificationSteps.map((step) => `- [ ] ${step}`),
      "",
    ]),
    "## Items",
    "",
    ...summary.items.flatMap((item) => [
      `### ${item.label}`,
      "",
      `- Status: ${item.status}`,
      `- Accepted env groups: ${item.acceptedEnvVarGroups.map((group) => group.join(" or ")).join("; ")}`,
      `- Configured names: ${item.configuredEnvVars.length ? item.configuredEnvVars.join(", ") : "none"}`,
      `- Missing groups: ${item.missingEnvVarGroups.length ? item.missingEnvVarGroups.join("; ") : "none"}`,
      `- Docs: ${item.docsUrl}`,
      `- Next step: ${item.nextStep}`,
      "",
    ]),
  ].join("\n");
}

function renderMissingCredentialEnvTemplate(summary: ClipperCredentialSetupSummary): string {
  const missingGroups = summary.items.flatMap((item) =>
    item.missingEnvVarGroups.map((missingGroup, index) => {
      const acceptedGroup = item.acceptedEnvVarGroups[index] || missingGroup.split(/\s+or\s+/i);
      return {
        item,
        missingGroup,
        suggestedEnvVar: acceptedGroup[0],
      };
    })
  );

  return [
    "# Clippers Missing Credential Template",
    "# Copia solo las variables que ya tengas a CEO_ASSISTANT_ENV, .env.local o tu secret manager.",
    "# Este archivo no contiene valores reales.",
    "",
    ...missingGroups.flatMap(({ item, missingGroup, suggestedEnvVar }) => [
      `# ${item.label}`,
      `# Accepted: ${missingGroup}`,
      `${suggestedEnvVar}=`,
      "",
    ]),
    missingGroups.length ? "" : "# No missing credential groups.",
  ].join("\n");
}

export async function prepareClipperCredentialSetupCenter(userId = getSystemUserId()): Promise<{ credentialSetup: ClipperCredentialSetupSummary; status: ClipperStatus }> {
  await writeDefaultConfigIfMissing();
  await ensureClipperDirs();
  await writeFile(CREDENTIAL_SETUP_TEMPLATE_PATH, renderEnvTemplate());
  await writeGoogleDriveCredentialTemplate();
  const credentialSetup = await buildCredentialSetupSummary();
  await writeFile(CREDENTIAL_SETUP_README_PATH, renderCredentialSetupReadme(credentialSetup));
  await writeFile(CREDENTIAL_SETUP_MISSING_TEMPLATE_PATH, renderMissingCredentialEnvTemplate(credentialSetup));
  return { credentialSetup: await buildCredentialSetupSummary(), status: await getClipperStatus(userId) };
}

export async function reloadClipperCredentials(userId = getSystemUserId()): Promise<{ credentialReload: ClipperCredentialReloadSummary; status: ClipperStatus }> {
  await writeDefaultConfigIfMissing();
  await ensureClipperDirs();
  const loadedFiles = loadLocalEnvFiles();
  await writeGoogleDriveCredentialTemplate();
  const credentialSetup = await buildCredentialSetupSummary();
  await writeFile(CREDENTIAL_SETUP_README_PATH, renderCredentialSetupReadme(credentialSetup));
  await writeFile(CREDENTIAL_SETUP_MISSING_TEMPLATE_PATH, renderMissingCredentialEnvTemplate(credentialSetup));
  return {
    credentialReload: {
      loadedFiles,
      envFilesFound: credentialSetup.envFilesFound,
      credentialSetup,
    },
    status: await getClipperStatus(userId),
  };
}

function relevantCredentialKey(key: string): boolean {
  return /^(TIKTOK|META|FACEBOOK|GOOGLE|YOUTUBE|CLIPPERS|PUBLIC_BASE_URL)/i.test(key);
}

function allowedCredentialEnvVars(): string[] {
  return Array.from(new Set([
    ...CREDENTIAL_ENV_REQUIREMENTS.flatMap((requirement) => requirement.acceptedEnvVarGroups.flat()),
    ...GOOGLE_REFRESH_TOKEN_ENV_VARS,
    TOKEN_ENCRYPTION_ENV_VAR,
    "PUBLIC_BASE_URL",
  ])).sort();
}

function normalizeCredentialSecretInput(input: unknown): { envVar: string; value: string } {
  if (!input || typeof input !== "object") throw new Error("Payload requerido.");
  const incoming = input as Record<string, unknown>;
  const envVar = typeof incoming.envVar === "string" ? incoming.envVar.trim() : "";
  const value = typeof incoming.value === "string" ? incoming.value.trim() : "";
  const allowed = allowedCredentialEnvVars();
  if (!allowed.includes(envVar)) {
    throw new Error(`Env var no permitida. Usa una de: ${allowed.join(", ")}.`);
  }
  if (!value) throw new Error("El valor no puede estar vacio.");
  if (/[\r\n]/.test(value)) throw new Error("El valor no puede tener multiples lineas.");
  if (envVar === TOKEN_ENCRYPTION_ENV_VAR && value.length < 32) {
    throw new Error(`${TOKEN_ENCRYPTION_ENV_VAR} debe tener al menos 32 caracteres.`);
  }
  if (envVar === "PUBLIC_BASE_URL" && !/^https?:\/\/.+/i.test(value)) {
    throw new Error("PUBLIC_BASE_URL debe empezar con http:// o https://.");
  }
  return { envVar, value };
}

function parseCredentialBatchEnvText(envText: string): {
  accepted: Array<{ envVar: string; value: string }>;
  rejectedEnvVars: string[];
  skippedLines: number;
} {
  const allowed = new Set(allowedCredentialEnvVars());
  const acceptedByKey = new Map<string, string>();
  const rejected = new Set<string>();
  let skippedLines = 0;
  const googleOAuthJsonCredentials = parseGoogleOAuthClientJsonCredentials(envText);
  if (googleOAuthJsonCredentials) {
    for (const item of googleOAuthJsonCredentials) {
      if (allowed.has(item.envVar) && item.value) acceptedByKey.set(item.envVar, item.value);
      else rejected.add(item.envVar);
    }
    return {
      accepted: Array.from(acceptedByKey.entries()).map(([envVar, value]) => ({ envVar, value })),
      rejectedEnvVars: Array.from(rejected).sort(),
      skippedLines,
    };
  }

  for (const rawLine of envText.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      skippedLines += 1;
      continue;
    }

    const clean = trimmed.startsWith("export ") ? trimmed.slice("export ".length).trim() : trimmed;
    const separatorIndex = clean.indexOf("=");
    if (separatorIndex <= 0) {
      skippedLines += 1;
      continue;
    }

    const envVar = clean.slice(0, separatorIndex).trim();
    let value = clean.slice(separatorIndex + 1).trim();
    if (!/^[A-Z_][A-Z0-9_]*$/i.test(envVar)) {
      skippedLines += 1;
      continue;
    }
    if (!allowed.has(envVar)) {
      rejected.add(envVar);
      continue;
    }
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    value = value.trim();
    if (!value || /[\r\n]/.test(value)) {
      skippedLines += 1;
      continue;
    }
    if (envVar === TOKEN_ENCRYPTION_ENV_VAR && value.length < 32) {
      rejected.add(envVar);
      continue;
    }
    if (envVar === "PUBLIC_BASE_URL" && !/^https?:\/\/.+/i.test(value)) {
      rejected.add(envVar);
      continue;
    }

    acceptedByKey.set(envVar, value);
  }

  return {
    accepted: Array.from(acceptedByKey.entries()).map(([envVar, value]) => ({ envVar, value })),
    rejectedEnvVars: Array.from(rejected).sort(),
    skippedLines,
  };
}

function stripJsonCodeFence(raw: string): string {
  const trimmed = raw.trim();
  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenceMatch ? fenceMatch[1].trim() : trimmed;
}

function parseGoogleOAuthClientJsonCredentials(raw: string): Array<{ envVar: string; value: string }> | null {
  const candidate = stripJsonCodeFence(raw);
  if (!candidate.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(candidate) as Record<string, unknown>;
    const container = (parsed.web && typeof parsed.web === "object")
      ? parsed.web as Record<string, unknown>
      : (parsed.installed && typeof parsed.installed === "object")
        ? parsed.installed as Record<string, unknown>
        : parsed;
    const clientId = typeof container.client_id === "string" ? container.client_id.trim() : "";
    const clientSecret = typeof container.client_secret === "string" ? container.client_secret.trim() : "";
    const credentials: Array<{ envVar: string; value: string }> = [];
    if (clientId && !/[\r\n]/.test(clientId)) credentials.push({ envVar: "GOOGLE_CLIENT_ID", value: clientId });
    if (clientSecret && !/[\r\n]/.test(clientSecret)) credentials.push({ envVar: "GOOGLE_CLIENT_SECRET", value: clientSecret });
    return credentials.length ? credentials : null;
  } catch {
    return null;
  }
}

function normalizeCredentialSecretBatchInput(input: unknown): {
  accepted: Array<{ envVar: string; value: string }>;
  rejectedEnvVars: string[];
  skippedLines: number;
} {
  if (!input || typeof input !== "object") throw new Error("Payload requerido.");
  const incoming = input as Record<string, unknown>;
  const envText = typeof incoming.envText === "string" ? incoming.envText : "";
  if (!envText.trim()) throw new Error("Pega al menos una variable tipo KEY=value.");
  const parsed = parseCredentialBatchEnvText(envText);
  if (!parsed.accepted.length) {
    const suffix = parsed.rejectedEnvVars.length ? ` Rechazadas: ${parsed.rejectedEnvVars.join(", ")}.` : "";
    throw new Error(`No encontre variables permitidas para guardar.${suffix}`);
  }
  return parsed;
}

function credentialDropRelativePathAllowed(relativePath: string): boolean {
  const normalized = relativePath.split(path.sep).join("/");
  return normalized.startsWith("credentials/") || normalized.startsWith("secrets/");
}

function safeCredentialDropAbsolutePath(relativePath: string): string | null {
  if (!credentialDropRelativePathAllowed(relativePath)) return null;
  const absolutePath = path.resolve(process.cwd(), relativePath);
  const allowedRoots = [CREDENTIAL_DROP_DIR, SECRET_DROP_DIR].map((dir) => path.resolve(dir));
  return allowedRoots.some((root) => absolutePath === root || absolutePath.startsWith(`${root}${path.sep}`))
    ? absolutePath
    : null;
}

async function parseCredentialDropFiles(): Promise<{
  accepted: Array<{ envVar: string; value: string }>;
  rejectedEnvVars: string[];
  skippedLines: number;
  sourceFiles: string[];
  filesScanned: number;
  filesImported: number;
  fileErrors: Array<{ relativePath: string; reason: string }>;
}> {
  const fileScans = await buildCredentialSetupFileScans();
  const dropScans = fileScans.filter((file) => credentialDropRelativePathAllowed(file.relativePath));
  const acceptedByKey = new Map<string, string>();
  const rejected = new Set<string>();
  const sourceFiles: string[] = [];
  const fileErrors: Array<{ relativePath: string; reason: string }> = [];
  let skippedLines = 0;

  for (const file of dropScans) {
    const absolutePath = safeCredentialDropAbsolutePath(file.relativePath);
    if (!absolutePath) {
      fileErrors.push({ relativePath: file.relativePath, reason: "Ruta fuera de credentials/ o secrets/." });
      continue;
    }
    const fileStat = await stat(absolutePath).catch(() => null);
    if (!fileStat?.isFile()) {
      fileErrors.push({ relativePath: file.relativePath, reason: "Archivo no encontrado." });
      continue;
    }
    if (fileStat.size > 256_000) {
      fileErrors.push({ relativePath: file.relativePath, reason: "Archivo demasiado grande para importar como credencial." });
      continue;
    }
    const raw = await readFile(absolutePath, "utf8").catch(() => "");
    const parsed = parseCredentialBatchEnvText(raw);
    skippedLines += parsed.skippedLines;
    for (const envVar of parsed.rejectedEnvVars) rejected.add(envVar);
    if (!parsed.accepted.length) {
      fileErrors.push({ relativePath: file.relativePath, reason: "No contiene variables permitidas o JSON OAuth reconocido." });
      continue;
    }
    sourceFiles.push(file.relativePath);
    for (const item of parsed.accepted) acceptedByKey.set(item.envVar, item.value);
  }

  return {
    accepted: Array.from(acceptedByKey.entries()).map(([envVar, value]) => ({ envVar, value })),
    rejectedEnvVars: Array.from(rejected).sort(),
    skippedLines,
    sourceFiles,
    filesScanned: dropScans.length,
    filesImported: sourceFiles.length,
    fileErrors,
  };
}

export async function previewClipperCredentialSecretsBatch(input: unknown, userId = getSystemUserId()): Promise<{ credentialSecretsBatchPreview: ClipperCredentialSecretBatchWriteSummary; status: ClipperStatus }> {
  await writeDefaultConfigIfMissing();
  await ensureClipperDirs();
  if (!input || typeof input !== "object") throw new Error("Payload requerido.");
  const incoming = input as Record<string, unknown>;
  const envText = typeof incoming.envText === "string" ? incoming.envText : "";
  if (!envText.trim()) throw new Error("Pega al menos una variable tipo KEY=value.");
  const { accepted, rejectedEnvVars, skippedLines } = parseCredentialBatchEnvText(envText);
  const envFileName = "CEO_ASSISTANT_ENV";
  const envFilePath = path.join(process.cwd(), envFileName);
  const credentialSetup = await buildCredentialSetupSummary();
  const credentialDoctor = await buildCredentialDoctorSummary();
  const configuredEnvVars = credentialDoctor.items.flatMap((item) => item.configuredEnvVars);

  return {
    credentialSecretsBatchPreview: {
      envFileName,
      envFilePath,
      updatedAt: new Date().toISOString(),
      acceptedEnvVars: accepted.map((item) => item.envVar).sort(),
      rejectedEnvVars,
      skippedLines,
      configuredEnvVars,
      credentialSetup,
      credentialDoctor,
      nextStep: accepted.length
        ? "Preview listo: estas variables son permitidas. Guarda batch cuando los valores sean reales."
        : "Preview listo: no hay valores reales para guardar todavia; reemplaza placeholders/vacios.",
    },
    status: await getClipperStatus(userId),
  };
}

function normalizeProductionPublicUrlInput(input: unknown): string {
  if (!input || typeof input !== "object") throw new Error("Payload requerido.");
  const incoming = input as Record<string, unknown>;
  const rawValue = typeof incoming.publicBaseUrl === "string" ? incoming.publicBaseUrl.trim() : "";
  if (!rawValue) throw new Error("PUBLIC_BASE_URL no puede estar vacio.");
  if (/[\r\n]/.test(rawValue)) throw new Error("PUBLIC_BASE_URL no puede tener multiples lineas.");
  let url: URL;
  try {
    url = new URL(rawValue);
  } catch {
    throw new Error("PUBLIC_BASE_URL debe ser una URL valida.");
  }
  url.hash = "";
  url.search = "";
  url.pathname = url.pathname.replace(/\/+$/g, "");
  const normalized = url.toString().replace(/\/$/g, "");
  if (!isProductionPublicBaseUrl(normalized)) {
    throw new Error("PUBLIC_BASE_URL debe ser una URL publica HTTPS, no localhost/127/local.");
  }
  return normalized;
}

function parseEnvKeyNames(raw: string): string[] {
  return Array.from(new Set(raw.split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && line.includes("="))
    .map((line) => (line.startsWith("export ") ? line.slice("export ".length).trim() : line))
    .map((line) => line.slice(0, line.indexOf("=")).trim())
    .filter((key) => /^[A-Z_][A-Z0-9_]*$/i.test(key))
    .filter(relevantCredentialKey)
  )).sort();
}

function upsertEnvLine(raw: string, envVar: string, value: string): string {
  const lines = raw.split(/\r?\n/);
  const nextLine = `${envVar}=${value}`;
  let replaced = false;
  const nextLines = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return line;
    const clean = trimmed.startsWith("export ") ? trimmed.slice("export ".length).trim() : trimmed;
    const separatorIndex = clean.indexOf("=");
    if (separatorIndex <= 0) return line;
    const key = clean.slice(0, separatorIndex).trim();
    if (key !== envVar) return line;
    replaced = true;
    return nextLine;
  });
  if (!replaced) {
    if (nextLines.length && nextLines[nextLines.length - 1].trim()) nextLines.push("");
    nextLines.push("# Clippers credential secrets");
    nextLines.push(nextLine);
  }
  return `${nextLines.join("\n").replace(/\n+$/g, "")}\n`;
}

async function buildCredentialDoctorEnvFiles(): Promise<ClipperCredentialDoctorEnvFile[]> {
  return Promise.all(LOCAL_ENV_FILE_CANDIDATES.map(async (fileName) => {
    const filePath = path.join(process.cwd(), fileName);
    const exists = await stat(filePath).then((file) => file.isFile()).catch(() => false);
    if (!exists) return { fileName, exists: false, relevantKeys: [] };
    const raw = await readFile(filePath, "utf8").catch(() => "");
    return { fileName, exists: true, relevantKeys: parseEnvKeyNames(raw) };
  }));
}

function credentialDoctorItem(input: {
  id: string;
  label: string;
  platform: ClipperPlatform | "system";
  acceptedEnvVarGroups: string[][];
  envFiles: ClipperCredentialDoctorEnvFile[];
  readyWhen?: () => boolean;
  nextStepReady: string;
  nextStepMissing: string;
}): ClipperCredentialDoctorItem {
  const configuredEnvVars = input.acceptedEnvVarGroups.flatMap((group) => group.filter((envVar) => Boolean(process.env[envVar])));
  const missingEnvVarGroups = input.acceptedEnvVarGroups
    .filter((group) => !envGroupIsConfigured(group))
    .map((group) => group.join(" or "));
  const groupsReady = missingEnvVarGroups.length === 0;
  const ready = input.readyWhen ? input.readyWhen() : groupsReady;
  const status: ClipperCredentialSetupStatus = ready ? "ready" : configuredEnvVars.length > 0 ? "partial" : "missing";
  const acceptedNames = new Set(input.acceptedEnvVarGroups.flat());
  const envFilesWithRelevantKeys = input.envFiles
    .filter((envFile) => envFile.relevantKeys.some((key) => acceptedNames.has(key)))
    .map((envFile) => envFile.fileName);
  return {
    id: input.id,
    label: input.label,
    platform: input.platform,
    status,
    acceptedEnvVarGroups: input.acceptedEnvVarGroups,
    configuredEnvVars,
    missingEnvVarGroups,
    envFilesWithRelevantKeys,
    nextStep: status === "ready" ? input.nextStepReady : input.nextStepMissing,
  };
}

async function buildCredentialDoctorSummary(): Promise<ClipperCredentialDoctorSummary> {
  await ensureClipperDirs();
  const envFiles = await buildCredentialDoctorEnvFiles();
  const items: ClipperCredentialDoctorItem[] = [
    ...CREDENTIAL_ENV_REQUIREMENTS.map((requirement) => credentialDoctorItem({
      id: `${requirement.platform}-oauth`,
      label: requirement.label,
      platform: requirement.platform,
      acceptedEnvVarGroups: requirement.acceptedEnvVarGroups,
      envFiles,
      nextStepReady: `${requirement.label} detectado; abrir OAuth/app review cuando la cuenta real este lista.`,
      nextStepMissing: requirement.nextStep,
    })),
    credentialDoctorItem({
      id: "google-drive-refresh",
      label: "Google Drive refresh token",
      platform: "system",
      acceptedEnvVarGroups: [GOOGLE_REFRESH_TOKEN_ENV_VARS],
      envFiles,
      readyWhen: hasGoogleDriveRefreshToken,
      nextStepReady: "Refresh token detectado; preparar carpetas Drive de Clippers.",
      nextStepMissing: hasGoogleDriveKeys()
        ? "Keys OAuth de Google detectadas; abre /api/google-drive/auth para generar refresh token."
        : "Agregar OAuth client id/secret de Google o refresh token de Drive.",
    }),
    credentialDoctorItem({
      id: "token-vault",
      label: "Encrypted token vault",
      platform: "system",
      acceptedEnvVarGroups: [[TOKEN_ENCRYPTION_ENV_VAR]],
      envFiles,
      readyWhen: () => Boolean(getTokenVaultSecret()),
      nextStepReady: "Token vault listo para guardar tokens cifrados.",
      nextStepMissing: `Agregar ${TOKEN_ENCRYPTION_ENV_VAR} con al menos 32 caracteres.`,
    }),
  ];
  const totals = items.reduce<ClipperCredentialDoctorSummary["totals"]>((sum, item) => {
    sum.items += 1;
    if (item.status === "ready") sum.ready += 1;
    if (item.status === "partial") sum.partial += 1;
    if (item.status === "missing") sum.missing += 1;
    return sum;
  }, { items: 0, ready: 0, partial: 0, missing: 0 });
  const generatedAt = await stat(CREDENTIAL_DOCTOR_PATH).then((file) => file.mtime.toISOString()).catch(() => null);
  return {
    status: !generatedAt
      ? "not_prepared"
      : totals.ready === totals.items
        ? "ready"
        : totals.ready > 0 || totals.partial > 0
          ? "partial"
          : "blocked",
    generatedAt,
    manifestPath: CREDENTIAL_DOCTOR_PATH,
    markdownPath: CREDENTIAL_DOCTOR_MARKDOWN_PATH,
    envFiles,
    items,
    totals,
    nextStep: items.find((item) => item.status === "missing")?.nextStep
      || items.find((item) => item.status === "partial")?.nextStep
      || "Credential doctor listo; continuar OAuth/app review.",
  };
}

function renderCredentialDoctorMarkdown(summary: ClipperCredentialDoctorSummary): string {
  return [
    "# Clippers Credential Doctor",
    "",
    "No contiene valores de secretos; solo nombres de variables detectadas.",
    "",
    `Status: ${summary.status}`,
    `Generated: ${summary.generatedAt || new Date().toISOString()}`,
    `Totals: ${summary.totals.ready} ready, ${summary.totals.partial} partial, ${summary.totals.missing} missing`,
    "",
    "## Env files",
    "",
    ...summary.envFiles.map((envFile) => `- ${envFile.fileName}: ${envFile.exists ? "exists" : "missing"}; relevant keys: ${envFile.relevantKeys.length ? envFile.relevantKeys.join(", ") : "none"}`),
    "",
    "## Items",
    "",
    ...summary.items.flatMap((item) => [
      `### ${item.label}`,
      "",
      `- Status: ${item.status}`,
      `- Platform: ${item.platform}`,
      `- Accepted groups: ${item.acceptedEnvVarGroups.map((group) => group.join(" or ")).join("; ")}`,
      `- Configured names: ${item.configuredEnvVars.length ? item.configuredEnvVars.join(", ") : "none"}`,
      `- Missing groups: ${item.missingEnvVarGroups.length ? item.missingEnvVarGroups.join("; ") : "none"}`,
      `- Files with matching keys: ${item.envFilesWithRelevantKeys.length ? item.envFilesWithRelevantKeys.join(", ") : "none"}`,
      `- Next step: ${item.nextStep}`,
      "",
    ]),
  ].join("\n");
}

export async function prepareClipperCredentialDoctor(userId = getSystemUserId()): Promise<{ credentialDoctor: ClipperCredentialDoctorSummary; status: ClipperStatus }> {
  await writeDefaultConfigIfMissing();
  await ensureClipperDirs();
  await writeFile(CREDENTIAL_SETUP_TEMPLATE_PATH, renderEnvTemplate());
  await writeGoogleDriveCredentialTemplate();
  const credentialDoctorDraft = await buildCredentialDoctorSummary();
  const credentialDoctor: ClipperCredentialDoctorSummary = {
    ...credentialDoctorDraft,
    generatedAt: new Date().toISOString(),
    status: credentialDoctorDraft.totals.ready === credentialDoctorDraft.totals.items
      ? "ready"
      : credentialDoctorDraft.totals.ready > 0 || credentialDoctorDraft.totals.partial > 0
        ? "partial"
        : "blocked",
  };
  await writeFile(CREDENTIAL_DOCTOR_PATH, JSON.stringify(credentialDoctor, null, 2));
  await writeFile(CREDENTIAL_DOCTOR_MARKDOWN_PATH, renderCredentialDoctorMarkdown(credentialDoctor));
  return { credentialDoctor, status: await getClipperStatus(userId) };
}

export async function recordClipperCredentialSecret(input: unknown, userId = getSystemUserId()): Promise<{ credentialSecret: ClipperCredentialSecretWriteSummary; status: ClipperStatus }> {
  await writeDefaultConfigIfMissing();
  await ensureClipperDirs();
  const { envVar, value } = normalizeCredentialSecretInput(input);
  const envFileName = "CEO_ASSISTANT_ENV";
  const envFilePath = path.join(process.cwd(), envFileName);
  const previous = await readFile(envFilePath, "utf8").catch(() => "");
  await writeFile(envFilePath, upsertEnvLine(previous, envVar, value), { mode: 0o600 });
  await chmod(envFilePath, 0o600).catch(() => undefined);
  process.env[envVar] = value;

  await writeGoogleDriveCredentialTemplate();
  const credentialSetup = await buildCredentialSetupSummary();
  await writeFile(CREDENTIAL_SETUP_README_PATH, renderCredentialSetupReadme(credentialSetup));
  await writeFile(CREDENTIAL_SETUP_MISSING_TEMPLATE_PATH, renderMissingCredentialEnvTemplate(credentialSetup));
  const credentialDoctorDraft = await buildCredentialDoctorSummary();
  const credentialDoctor: ClipperCredentialDoctorSummary = {
    ...credentialDoctorDraft,
    generatedAt: new Date().toISOString(),
    status: credentialDoctorDraft.totals.ready === credentialDoctorDraft.totals.items
      ? "ready"
      : credentialDoctorDraft.totals.ready > 0 || credentialDoctorDraft.totals.partial > 0
        ? "partial"
        : "blocked",
  };
  await writeFile(CREDENTIAL_DOCTOR_PATH, JSON.stringify(credentialDoctor, null, 2));
  await writeFile(CREDENTIAL_DOCTOR_MARKDOWN_PATH, renderCredentialDoctorMarkdown(credentialDoctor));

  const configuredEnvVars = credentialDoctor.items.flatMap((item) => item.configuredEnvVars);
  return {
    credentialSecret: {
      envFileName,
      envFilePath,
      envVar,
      updatedAt: new Date().toISOString(),
      configuredEnvVars,
      credentialSetup,
      credentialDoctor,
      nextStep: credentialDoctor.nextStep,
    },
    status: await getClipperStatus(userId),
  };
}

export async function recordClipperCredentialSecretsBatch(input: unknown, userId = getSystemUserId()): Promise<{ credentialSecretsBatch: ClipperCredentialSecretBatchWriteSummary; status: ClipperStatus }> {
  await writeDefaultConfigIfMissing();
  await ensureClipperDirs();
  const { accepted, rejectedEnvVars, skippedLines } = normalizeCredentialSecretBatchInput(input);
  const envFileName = "CEO_ASSISTANT_ENV";
  const envFilePath = path.join(process.cwd(), envFileName);
  let nextEnv = await readFile(envFilePath, "utf8").catch(() => "");
  for (const { envVar, value } of accepted) {
    nextEnv = upsertEnvLine(nextEnv, envVar, value);
    process.env[envVar] = value;
  }
  await writeFile(envFilePath, nextEnv, { mode: 0o600 });
  await chmod(envFilePath, 0o600).catch(() => undefined);

  await writeGoogleDriveCredentialTemplate();
  const credentialSetup = await buildCredentialSetupSummary();
  await writeFile(CREDENTIAL_SETUP_README_PATH, renderCredentialSetupReadme(credentialSetup));
  await writeFile(CREDENTIAL_SETUP_MISSING_TEMPLATE_PATH, renderMissingCredentialEnvTemplate(credentialSetup));
  const credentialDoctorDraft = await buildCredentialDoctorSummary();
  const credentialDoctor: ClipperCredentialDoctorSummary = {
    ...credentialDoctorDraft,
    generatedAt: new Date().toISOString(),
    status: credentialDoctorDraft.totals.ready === credentialDoctorDraft.totals.items
      ? "ready"
      : credentialDoctorDraft.totals.ready > 0 || credentialDoctorDraft.totals.partial > 0
        ? "partial"
        : "blocked",
  };
  await writeFile(CREDENTIAL_DOCTOR_PATH, JSON.stringify(credentialDoctor, null, 2));
  await writeFile(CREDENTIAL_DOCTOR_MARKDOWN_PATH, renderCredentialDoctorMarkdown(credentialDoctor));

  const configuredEnvVars = credentialDoctor.items.flatMap((item) => item.configuredEnvVars);
  return {
    credentialSecretsBatch: {
      envFileName,
      envFilePath,
      updatedAt: new Date().toISOString(),
      acceptedEnvVars: accepted.map((item) => item.envVar).sort(),
      rejectedEnvVars,
      skippedLines,
      configuredEnvVars,
      credentialSetup,
      credentialDoctor,
      nextStep: credentialDoctor.nextStep,
    },
    status: await getClipperStatus(userId),
  };
}

export async function importClipperCredentialDropFiles(userId = getSystemUserId()): Promise<{ credentialDropImport: ClipperCredentialSecretBatchWriteSummary; status: ClipperStatus }> {
  await writeDefaultConfigIfMissing();
  await ensureClipperDirs();
  const parsed = await parseCredentialDropFiles();
  if (!parsed.accepted.length) {
    const suffix = parsed.filesScanned
      ? ` Revise ${parsed.filesScanned} archivo(s), pero no encontre credenciales permitidas.`
      : ` Coloca un .env o Google OAuth JSON en ${path.relative(process.cwd(), CREDENTIAL_DROP_DIR)} o ${path.relative(process.cwd(), SECRET_DROP_DIR)}.`;
    throw new Error(`No encontre archivos de credenciales importables.${suffix}`);
  }

  const envFileName = "CEO_ASSISTANT_ENV";
  const envFilePath = path.join(process.cwd(), envFileName);
  let nextEnv = await readFile(envFilePath, "utf8").catch(() => "");
  for (const { envVar, value } of parsed.accepted) {
    nextEnv = upsertEnvLine(nextEnv, envVar, value);
    process.env[envVar] = value;
  }
  await writeFile(envFilePath, nextEnv, { mode: 0o600 });
  await chmod(envFilePath, 0o600).catch(() => undefined);

  await writeGoogleDriveCredentialTemplate();
  const credentialSetup = await buildCredentialSetupSummary();
  await writeFile(CREDENTIAL_SETUP_README_PATH, renderCredentialSetupReadme(credentialSetup));
  await writeFile(CREDENTIAL_SETUP_MISSING_TEMPLATE_PATH, renderMissingCredentialEnvTemplate(credentialSetup));
  const credentialDoctorDraft = await buildCredentialDoctorSummary();
  const credentialDoctor: ClipperCredentialDoctorSummary = {
    ...credentialDoctorDraft,
    generatedAt: new Date().toISOString(),
    status: credentialDoctorDraft.totals.ready === credentialDoctorDraft.totals.items
      ? "ready"
      : credentialDoctorDraft.totals.ready > 0 || credentialDoctorDraft.totals.partial > 0
        ? "partial"
        : "blocked",
  };
  await writeFile(CREDENTIAL_DOCTOR_PATH, JSON.stringify(credentialDoctor, null, 2));
  await writeFile(CREDENTIAL_DOCTOR_MARKDOWN_PATH, renderCredentialDoctorMarkdown(credentialDoctor));

  const configuredEnvVars = credentialDoctor.items.flatMap((item) => item.configuredEnvVars);
  return {
    credentialDropImport: {
      envFileName,
      envFilePath,
      updatedAt: new Date().toISOString(),
      acceptedEnvVars: parsed.accepted.map((item) => item.envVar).sort(),
      rejectedEnvVars: parsed.rejectedEnvVars,
      skippedLines: parsed.skippedLines,
      sourceFiles: parsed.sourceFiles,
      filesScanned: parsed.filesScanned,
      filesImported: parsed.filesImported,
      fileErrors: parsed.fileErrors,
      configuredEnvVars,
      credentialSetup,
      credentialDoctor,
      nextStep: "Drop import listo: credenciales cargadas en runtime y guardadas en CEO_ASSISTANT_ENV sin exponer valores.",
    },
    status: await getClipperStatus(userId),
  };
}

export async function recordClipperProductionPublicUrl(input: unknown, userId = getSystemUserId()): Promise<{ productionPublicUrl: ClipperProductionPublicUrlWriteSummary; status: ClipperStatus }> {
  await writeDefaultConfigIfMissing();
  await ensureClipperDirs();
  const publicBaseUrl = normalizeProductionPublicUrlInput(input);
  const envFileName = "CEO_ASSISTANT_ENV";
  const envFilePath = path.join(process.cwd(), envFileName);
  const previous = await readFile(envFilePath, "utf8").catch(() => "");
  await writeFile(envFilePath, upsertEnvLine(previous, "PUBLIC_BASE_URL", publicBaseUrl), { mode: 0o600 });
  await chmod(envFilePath, 0o600).catch(() => undefined);
  process.env.PUBLIC_BASE_URL = publicBaseUrl;

  const { productionUrlSetup } = await prepareClipperProductionUrlSetup(userId);
  await prepareClipperHttpsTunnelPlan(userId);
  const { legalPolicyPack } = await prepareClipperLegalPolicyPack(userId);
  const { appReviewDemoPack } = await prepareClipperAppReviewDemoPack(userId);
  const { appReviewSubmissionPack } = await prepareClipperAppReviewSubmissionPack(userId);
  const { developerApplicationDrafts } = await prepareClipperDeveloperApplicationDrafts(userId);
  const { oauthGoLive } = await prepareClipperOAuthGoLivePreflight(userId);
  const { oauthConnectionPack } = await prepareClipperOAuthConnectionPack(userId);
  const { goLiveExecutionPack } = await prepareClipperGoLiveExecutionPack(userId);
  return {
    productionPublicUrl: {
      envFileName,
      envFilePath,
      publicBaseUrl,
      updatedAt: new Date().toISOString(),
      productionUrlSetup,
      legalPolicyPack,
      appReviewDemoPack,
      developerApplicationDrafts,
      oauthGoLive,
      oauthConnectionPack,
      appReviewSubmissionPack,
      goLiveExecutionPack,
      nextStep: productionUrlSetup.nextStep,
    },
    status: await getClipperStatus(userId),
  };
}

function accountBioForCategory(category: ClipperAccountCategory): string {
  if (category === "sports") return "Daily sports clips, highlights and context. Rights-first. DM for credits/removal.";
  if (category === "memes") return "Fast meme edits and internet moments. Original or permissioned clips only.";
  return "Streamer moments, VOD highlights and creator-approved clips. DM for credits/removal.";
}

function accountContentPillars(category: ClipperAccountCategory): string[] {
  if (category === "sports") return [
    "high-context last-minute moments",
    "unexpected plays with simple captions",
    "quick explainers that turn highlights into shareable stories",
  ];
  if (category === "memes") return [
    "fast visual jokes with immediate payoff",
    "relatable internet moments",
    "original/remix-safe meme templates with permission evidence",
  ];
  return [
    "streamer setup-and-payoff moments",
    "chat reactions and unexpected endings",
    "creator-approved VOD highlights with clear credit",
  ];
}

function profileImagePrompt(account: ClipperAccount): string {
  if (account.category === "sports") return `${account.name} profile icon, energetic sports highlight feel, bold readable initials, clean social avatar, no team logos, high contrast.`;
  if (account.category === "memes") return `${account.name} profile icon, fast internet meme radar feel, expressive simple symbol, readable at small size, original design, no copyrighted characters.`;
  return `${account.name} profile icon, streamer pulse energy, neon broadcast signal motif, clean social avatar, original design, no creator likeness.`;
}

function bannerPrompt(account: ClipperAccount): string {
  if (account.category === "sports") return `${account.name} social banner, vertical clips and highlight-room energy, scoreboard-inspired accents, no official league/team marks, modern black/cyan/white palette.`;
  if (account.category === "memes") return `${account.name} social banner, playful internet culture desk, quick-loop visual language, original sticker-like motifs, no copyrighted characters.`;
  return `${account.name} social banner, stream setup energy, chat bubbles and waveform accents, creator-friendly tone, no streamer likeness or platform logos.`;
}

function usernameAlternatives(handle: string): string[] {
  const clean = handle.replace(/^@+/, "").replace(/[^a-zA-Z0-9._]/g, "").toLowerCase();
  return Array.from(new Set([
    clean,
    `${clean}hq`,
    `${clean}.clips`,
    `${clean}daily`,
    `${clean}.tv`,
  ])).slice(0, 5).map((value) => `@${value}`);
}

function firstPostIdeas(account: ClipperAccount): string[] {
  if (account.category === "sports") return [
    "The play that changed the game in 9 seconds.",
    "One highlight, one context line, one clean payoff.",
    "Best last-minute sports moment from a permitted source.",
  ];
  if (account.category === "memes") return [
    "The internet today in 7 seconds.",
    "POV loop with original caption and remix-safe footage.",
    "Fast meme setup/payoff from permissioned creator clip.",
  ];
  return [
    "The moment chat stopped moving.",
    "Streamer setup/payoff highlight with creator credit.",
    "One VOD moment that explains the whole stream.",
  ];
}

function profileLinkForPlatform(platform: ClipperPlatform, handle: string): string {
  const cleanHandle = handle.replace(/^@+/, "");
  if (platform === "tiktok") return `https://www.tiktok.com/@${cleanHandle}`;
  if (platform === "instagram") return `https://www.instagram.com/${cleanHandle}/`;
  return `https://www.youtube.com/@${cleanHandle}`;
}

async function buildAccountIdentityKitSummary(accounts: ClipperAccount[]): Promise<ClipperAccountIdentityKitSummary> {
  const identityAccounts: ClipperAccountIdentityItem[] = accounts.map((account) => ({
    accountId: account.id,
    accountName: account.name,
    category: account.category,
    weeklyViewsGoal: account.weeklyViewsGoal,
    dailyClipTarget: account.dailyClipTarget,
    contentPillars: accountContentPillars(account.category),
    platforms: account.platformAccounts.map((platformAccount) => ({
      platform: platformAccount.platform,
      handle: platformAccount.handle,
      displayName: platformAccount.displayName,
      profileLink: profileLinkForPlatform(platformAccount.platform, platformAccount.handle),
      bio: accountBioForCategory(account.category),
      usernameAlternatives: usernameAlternatives(platformAccount.handle),
      profileImagePrompt: profileImagePrompt(account),
      bannerPrompt: bannerPrompt(account),
      firstPostIdeas: firstPostIdeas(account),
      setupChecklist: [
        "Create/login to the account using a secure password manager entry.",
        "Enable 2FA and save recovery codes securely.",
        "Apply display name, handle, bio, profile image and banner.",
        "Add credit/removal policy in bio or link-in-bio where possible.",
        "Post only owned/licensed/permissioned clips after allowlist evidence is saved.",
        "Record evidence in Account Evidence before OAuth/app review.",
      ],
    })),
  }));
  const totals = identityAccounts.reduce<ClipperAccountIdentityKitSummary["totals"]>((sum, account) => {
    sum.accounts += 1;
    sum.platformProfiles += account.platforms.length;
    sum.firstPostIdeas += account.platforms.reduce((count, platform) => count + platform.firstPostIdeas.length, 0);
    return sum;
  }, { accounts: 0, platformProfiles: 0, firstPostIdeas: 0 });
  const generatedAt = await stat(ACCOUNT_IDENTITY_KIT_PATH).then((file) => file.mtime.toISOString()).catch(() => null);
  return {
    status: generatedAt ? "ready" : "not_prepared",
    generatedAt,
    manifestPath: ACCOUNT_IDENTITY_KIT_PATH,
    markdownPath: ACCOUNT_IDENTITY_KIT_MARKDOWN_PATH,
    accounts: identityAccounts,
    totals,
    nextStep: generatedAt
      ? "Usar este kit para crear perfiles externos, generar avatares/banners y guardar evidencia por plataforma."
      : "Generar Account Identity Kit para dejar perfiles, bios, handles y primeros posts listos.",
  };
}

function renderAccountIdentityKitMarkdown(summary: ClipperAccountIdentityKitSummary): string {
  return [
    "# Clippers Account Identity Kit",
    "",
    `Status: ${summary.status}`,
    `Generated: ${summary.generatedAt || new Date().toISOString()}`,
    `Totals: ${summary.totals.accounts} accounts, ${summary.totals.platformProfiles} platform profiles, ${summary.totals.firstPostIdeas} first post ideas`,
    "",
    "## Next Step",
    "",
    summary.nextStep,
    "",
    "## Accounts",
    "",
    ...summary.accounts.flatMap((account) => [
      `### ${account.accountName}`,
      "",
      `- Category: ${account.category}`,
      `- Weekly views goal: ${account.weeklyViewsGoal.toLocaleString("en-US")}`,
      `- Daily clip target: ${account.dailyClipTarget}`,
      "",
      "Content pillars:",
      ...account.contentPillars.map((pillar) => `- ${pillar}`),
      "",
      ...account.platforms.flatMap((platform) => [
        `#### ${platform.platform}: ${platform.handle}`,
        "",
        `- Display name: ${platform.displayName}`,
        `- Profile link: ${platform.profileLink}`,
        `- Bio: ${platform.bio}`,
        `- Username alternatives: ${platform.usernameAlternatives.join(", ")}`,
        "",
        "Profile image prompt:",
        platform.profileImagePrompt,
        "",
        "Banner prompt:",
        platform.bannerPrompt,
        "",
        "First post ideas:",
        ...platform.firstPostIdeas.map((idea) => `- ${idea}`),
        "",
        "Setup checklist:",
        ...platform.setupChecklist.map((step) => `- [ ] ${step}`),
        "",
      ]),
    ]),
  ].join("\n");
}

export async function prepareClipperAccountIdentityKit(userId = getSystemUserId()): Promise<{ accountIdentityKit: ClipperAccountIdentityKitSummary; status: ClipperStatus }> {
  await writeDefaultConfigIfMissing();
  await ensureClipperDirs();
  const config = await readConfig();
  const accounts = (Array.isArray(config.accounts) && config.accounts.length ? config.accounts : DEFAULT_ACCOUNTS).map(ensureAccountShape);
  const draftSummary = await buildAccountIdentityKitSummary(accounts);
  const accountIdentityKit: ClipperAccountIdentityKitSummary = {
    ...draftSummary,
    status: "ready",
    generatedAt: new Date().toISOString(),
  };
  await writeFile(ACCOUNT_IDENTITY_KIT_PATH, JSON.stringify(accountIdentityKit, null, 2));
  await writeFile(ACCOUNT_IDENTITY_KIT_MARKDOWN_PATH, renderAccountIdentityKitMarkdown(accountIdentityKit));
  return { accountIdentityKit, status: await getClipperStatus(userId) };
}

function launchTaskStatus(platformAccount: ClipperPlatformAccount, evidence?: ClipperAccountEvidenceItem): ClipperAccountLaunchTaskStatus {
  if (platformAccount.status === "ready") return "ready";
  if (evidence?.status === "verified" || evidence?.status === "submitted") return "pending";
  if (platformAccount.status === "not_created") return "blocked";
  return "pending";
}

function isAccountCreationStep(step: string): boolean {
  const normalized = step.toLowerCase();
  return normalized.includes("crear cuenta") || normalized.includes("crear canal") || normalized.includes("cuenta profesional");
}

function buildAccountLaunchTasks(accounts: ClipperAccount[], accountEvidence: ClipperAccountEvidenceSummary): ClipperAccountLaunchTask[] {
  return accounts.flatMap((account) =>
    account.platformAccounts.map((platformAccount) => {
      const requirement = PLATFORM_REQUIREMENTS.find((item) => item.platform === platformAccount.platform);
      const evidence = accountEvidence.items.find((item) => item.accountId === account.id && item.platform === platformAccount.platform);
      const status = launchTaskStatus(platformAccount, evidence);
      const blockers = status === "ready"
        ? []
        : evidence?.status === "verified" || evidence?.status === "submitted"
          ? platformAccount.missingSteps.filter((step) => !isAccountCreationStep(step))
          : platformAccount.missingSteps;
      const checklist = Array.from(new Set([
        ...platformAccount.missingSteps,
        "Crear foto de perfil y banner consistente con la categoria.",
        "Pegar bio y link/credit policy.",
        "Guardar login y 2FA en password manager.",
        "Conectar OAuth desde Clippers y validar token vault.",
        "Adjuntar evidencia de app review/permission approval cuando aplique.",
      ]));
      return {
        id: `${account.id}-${platformAccount.platform}`,
        accountId: account.id,
        accountName: account.name,
        category: account.category,
        platform: platformAccount.platform,
        handle: platformAccount.handle,
        displayName: platformAccount.displayName,
        bio: accountBioForCategory(account.category),
        profileLink: profileLinkForPlatform(platformAccount.platform, platformAccount.handle),
        accountCreationUrl: requirement?.accountCreationUrl || "",
        developerPortalUrl: requirement?.developerPortalUrl || "",
        status,
        evidencePath: evidence?.evidencePath || null,
        evidenceStatus: evidence?.status || "missing",
        blockers,
        checklist,
        nextStep: status === "ready"
          ? "Cuenta lista en Clippers; mantener QA y metricas antes de subir volumen."
          : status === "pending"
            ? evidence?.status === "verified"
              ? "Evidencia de cuenta verificada; completar OAuth/app review y token vault."
              : "Revisar evidencia submitted, marcar verified y completar OAuth/app review."
            : "Crear/verificar la cuenta externa, aplicar bio/branding y despues conectar OAuth.",
      };
    })
  );
}

function buildAccountLaunchKitMarkdown(summary: ClipperAccountLaunchKitSummary): string {
  return [
    "# Clippers Account Launch Kit",
    "",
    `Generated: ${summary.generatedAt || "pending"}`,
    `Status: ${summary.status}`,
    `Tasks: ${summary.totals.tasks} total, ${summary.totals.ready} ready, ${summary.totals.pending} pending, ${summary.totals.blocked} blocked`,
    "",
    "## Next step",
    "",
    summary.nextStep,
    "",
    "## Accounts",
    "",
    ...summary.tasks.flatMap((task) => [
      `### ${task.displayName} / ${task.platform}`,
      "",
      `- Account: ${task.accountName} (${getClipperCategoryLabel(task.category)})`,
      `- Handle: ${task.handle}`,
      `- Bio: ${task.bio}`,
      `- Profile: ${task.profileLink}`,
      `- Create account: ${task.accountCreationUrl}`,
      `- Developer portal: ${task.developerPortalUrl}`,
      `- Status: ${task.status}`,
      `- Evidence: ${task.evidenceStatus}${task.evidencePath ? ` (${task.evidencePath})` : ""}`,
      `- Next step: ${task.nextStep}`,
      "",
      "Checklist:",
      ...task.checklist.map((step) => `- [ ] ${step}`),
      "",
      task.blockers.length ? "Blockers:" : "Blockers: none",
      ...task.blockers.map((blocker) => `- ${blocker}`),
      "",
    ]),
  ].join("\n");
}

async function buildAccountLaunchKitSummary(accounts: ClipperAccount[], accountEvidence: ClipperAccountEvidenceSummary): Promise<ClipperAccountLaunchKitSummary> {
  await ensureClipperDirs();
  const tasks = buildAccountLaunchTasks(accounts, accountEvidence);
  const totals = tasks.reduce<ClipperAccountLaunchKitSummary["totals"]>((sum, task) => {
    sum.tasks += 1;
    sum[task.status] += 1;
    return sum;
  }, { tasks: 0, ready: 0, pending: 0, blocked: 0 });
  const status: ClipperAccountLaunchKitStatus = totals.tasks > 0 && totals.ready === totals.tasks
    ? "ready"
    : totals.pending > 0 || totals.ready > 0
      ? "partial"
      : "not_ready";
  const generatedAt = await stat(ACCOUNT_LAUNCH_KIT_PATH).then((file) => file.mtime.toISOString()).catch(() => null);

  return {
    status,
    generatedAt,
    kitPath: ACCOUNT_LAUNCH_KIT_PATH,
    markdownPath: ACCOUNT_LAUNCH_KIT_MARKDOWN_PATH,
    tasks,
    totals,
    nextStep: generatedAt
      ? totals.blocked > 0
        ? "Abrir las cuentas externas bloqueadas y completar verificacion/login por plataforma."
        : totals.pending > 0
          ? "Completar OAuth/app review para las cuentas pendientes."
          : "Kit listo; mantener monitoreo de permisos, metrics y health de cuentas."
      : "Generar el launch kit para dejar handles, bios, links y checklist por cuenta/plataforma.",
  };
}

export async function prepareClipperAccountLaunchKit(userId = getSystemUserId()): Promise<{ accountLaunchKit: ClipperAccountLaunchKitSummary; status: ClipperStatus }> {
  await writeDefaultConfigIfMissing();
  await ensureClipperDirs();
  const config = await readConfig();
  const accounts = (Array.isArray(config.accounts) && config.accounts.length ? config.accounts : DEFAULT_ACCOUNTS).map(ensureAccountShape);
  const accountEvidence = await buildAccountEvidenceSummary(accounts);
  const draftSummary = await buildAccountLaunchKitSummary(accounts, accountEvidence);
  const generatedAt = new Date().toISOString();
  const accountLaunchKit: ClipperAccountLaunchKitSummary = {
    ...draftSummary,
    generatedAt,
    nextStep: draftSummary.totals.blocked > 0
      ? "Usar este kit para crear/verificar cuentas externas y luego conectar OAuth desde Clippers."
      : draftSummary.totals.pending > 0
        ? "Completar OAuth/app review para desbloquear autopost."
        : "Kit listo; mantener monitoreo de permisos, metrics y health de cuentas.",
  };
  await writeFile(ACCOUNT_LAUNCH_KIT_PATH, JSON.stringify(accountLaunchKit, null, 2));
  await writeFile(ACCOUNT_LAUNCH_KIT_MARKDOWN_PATH, buildAccountLaunchKitMarkdown(accountLaunchKit));
  return { accountLaunchKit, status: await getClipperStatus(userId) };
}

function officialAccountHelpUrl(platform: ClipperPlatform): string {
  if (platform === "tiktok") return "https://support.tiktok.com/en/getting-started/creating-an-account";
  if (platform === "instagram") return "https://help.instagram.com/";
  return "https://support.google.com/youtube/answer/1646861";
}

function accountVerificationRequirements(platform: ClipperPlatform): string[] {
  if (platform === "tiktok") return [
    "Email o telefono real para crear/iniciar sesion.",
    "Username/handle disponible.",
    "2FA activado antes de conectar OAuth.",
    "Cuenta sin strikes ni restricciones antes de pedir Content Posting API.",
  ];
  if (platform === "instagram") return [
    "Email o telefono real para crear/iniciar sesion.",
    "Cambiar a cuenta Professional/Creator/Business.",
    "Conectar a una Facebook Page administrada por el mismo operador.",
    "2FA activado antes de Meta App Review.",
  ];
  return [
    "Google Account real con acceso al canal.",
    "Canal creado con nombre/handle publico.",
    "Verificacion de canal cuando YouTube la solicite.",
    "2FA y recovery email/phone configurados antes de OAuth.",
  ];
}

function accountCreationStatus(task: ClipperAccountLaunchTask): ClipperAccountCreationPackStatus {
  if (task.status === "ready") return "ready";
  if (task.evidenceStatus === "verified" || task.evidenceStatus === "submitted" || task.status === "pending") return "partial";
  return "blocked";
}

function csvEscape(value: string | number | null | undefined): string {
  const text = value === null || value === undefined ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function accountCreationRequiredInputs(platform: ClipperPlatform): string[] {
  return [
    "real handle",
    "profile URL",
    "verification proof note",
    "2FA/recovery-codes saved note",
    "screenshot/proof path or URL",
    ...(platform === "instagram" ? ["professional account proof", "connected Facebook Page proof"] : []),
    ...(platform === "youtube" ? ["channel handle proof", "YouTube channel URL"] : []),
  ];
}

function accountCreationSecurityChecklist(platform: ClipperPlatform): string[] {
  return [
    "Use a dedicated login, password manager entry and unique password for this brand/account.",
    "Enable 2FA before any OAuth/app-review connection and save recovery codes outside the app.",
    "Verify email/phone ownership without exposing full personal contact details in screenshots.",
    "Record the primary operator, backup operator and admin owner in the private account vault.",
    ...(platform === "instagram" ? [
      "Confirm Meta Business/Page admin access before connecting Instagram publishing permissions.",
    ] : []),
    ...(platform === "youtube" ? [
      "Confirm Google account recovery email/phone and channel owner/admin access before OAuth.",
    ] : []),
  ];
}

function accountCreationRecoveryPlan(platform: ClipperPlatform): string[] {
  return [
    "Store recovery codes, backup email/phone note and owner/admin contact in the password manager.",
    "Capture a redacted screenshot that proves 2FA/recovery is enabled without leaking secrets.",
    "Keep at least one backup admin or recovery contact before the account is used for automation.",
    ...(platform === "instagram" ? [
      "Keep Facebook Page admin recovery access aligned with the Instagram professional account.",
    ] : []),
    ...(platform === "youtube" ? [
      "Document channel owner/admin access and Google account recovery path before publishing.",
    ] : []),
  ];
}

function accountCreationPlatformProofRequired(platform: ClipperPlatform): string[] {
  if (platform === "tiktok") return [
    "TikTok profile URL with handle visible.",
    "Email/phone verified proof, redacted where needed.",
    "2FA enabled proof or recovery-codes-saved note.",
    "Account status/settings proof showing no posting restrictions before API review.",
  ];
  if (platform === "instagram") return [
    "Instagram profile URL with handle visible.",
    "Professional/Creator/Business account proof.",
    "Connected Facebook Page proof with admin access visible.",
    "2FA enabled proof or recovery-codes-saved note.",
  ];
  return [
    "YouTube channel URL and handle visible.",
    "Google account/channel owner or manager access proof.",
    "Channel verification/advanced features proof when required by YouTube.",
    "2FA enabled proof or recovery-codes-saved note.",
  ];
}

function accountCreationCompletionHint(platform: ClipperPlatform): string {
  if (platform === "instagram") return "Create the account as professional, connect a Facebook Page, enable 2FA, then paste a completed account evidence row.";
  if (platform === "youtube") return "Create or claim the channel, verify the handle/channel URL, enable account security, then paste a completed account evidence row.";
  return "Create the platform account, verify handle/profile access, enable 2FA, then paste a completed account evidence row.";
}

function accountCreationEvidenceBatchRow(accountId: string, platform: ClipperPlatform, status: "submitted" | "verified" = "verified"): string {
  return ["account", accountId, platform, status, "", "", "", ""].map(csvEscape).join(",");
}

function accountCreationEvidenceRecipeRow(accountId: string, platform: ClipperPlatform): string {
  return ["account", accountId, platform, "verified", "", "", "", "<real handle + profile URL + 2FA/security proof + screenshot/proof URL>"].map(csvEscape).join(",");
}

function accountCreationCopyPackage(item: Pick<ClipperAccountCreationPackItem, "handle" | "displayName" | "bio" | "profileLink" | "signupUrl" | "usernameAlternatives">): Array<{ label: string; value: string }> {
  return [
    { label: "signup_url", value: item.signupUrl },
    { label: "handle_primary", value: item.handle },
    { label: "handle_alternatives", value: item.usernameAlternatives.join(", ") },
    { label: "display_name", value: item.displayName },
    { label: "bio", value: item.bio },
    { label: "expected_profile_url", value: item.profileLink },
  ];
}

function accountCreationPortalFormFields(item: {
  platform: ClipperPlatform;
  handle: string;
  displayName: string;
  bio: string;
  profileLink: string;
  usernameAlternatives: string[];
}): Array<{ field: string; value: string; note: string }> {
  return [
    { field: "username / handle", value: item.handle.replace(/^@/, ""), note: "Try primary handle first." },
    { field: "display name", value: item.displayName, note: "Use exact brand/account name from Account Identity Kit." },
    { field: "bio / about", value: item.bio, note: "Paste after account is created and profile editing is available." },
    { field: "profile URL expected", value: item.profileLink, note: "Use this only as expected proof target after signup." },
    { field: "fallback handles", value: item.usernameAlternatives.map((handle) => handle.replace(/^@/, "")).join(", "), note: "Try in order if the primary handle is unavailable." },
    ...(item.platform === "instagram" ? [
      { field: "account type", value: "Professional / Creator or Business", note: "Required before Meta publishing permissions." },
      { field: "Facebook Page", value: "<matching Page for this account>", note: "Create or connect before App Review." },
    ] : []),
    ...(item.platform === "youtube" ? [
      { field: "channel handle", value: item.handle.replace(/^@/, ""), note: "Confirm the public channel URL after creation." },
      { field: "channel description", value: item.bio, note: "Use a rights-safe description aligned with the category." },
    ] : []),
  ];
}

function accountCreationHandleReservationPlan(handle: string, alternatives: string[]): string[] {
  return [
    `Try primary handle ${handle}.`,
    ...alternatives.slice(0, 5).map((candidate, index) => `Fallback ${index + 1}: ${candidate}.`),
    "If all handles are taken, keep the category word and add clips/daily/hq before changing brand direction.",
    "Record the final accepted handle in Launch Evidence Batch notes.",
  ];
}

function accountCreationBrowserSessionChecklist(platform: ClipperPlatform): string[] {
  return [
    "Open the signup/login portal in the browser profile that should own this account.",
    "Confirm no personal account is accidentally active before signup.",
    "Use the password manager entry created for this exact account.",
    "Complete email/phone verification and 2FA before connecting developer apps.",
    ...(platform === "instagram" ? ["Switch to Professional account and connect/create the Facebook Page before evidence import."] : []),
    ...(platform === "youtube" ? ["Create/claim the YouTube channel and confirm channel URL before OAuth."] : []),
    ...(platform === "tiktok" ? ["Confirm the account has no initial posting restrictions before Content Posting API review."] : []),
  ];
}

function accountCreationEvidenceCapturePlan(platform: ClipperPlatform): string[] {
  return [
    "Capture profile URL with final handle visible.",
    "Capture verification/security proof with personal values redacted.",
    "Capture 2FA enabled or recovery-codes-saved proof without exposing codes.",
    platform === "instagram"
      ? "Capture Professional account and connected Facebook Page proof."
      : platform === "youtube"
        ? "Capture YouTube channel URL/handle and channel owner/admin proof."
        : "Capture TikTok profile/settings proof and account status proof.",
    "Paste submitted or verified Launch Evidence Batch row immediately after proof is captured.",
  ];
}

function accountCreationOperatorVaultChecklist(platform: ClipperPlatform): string[] {
  return [
    "Create a password-manager item for this exact account/platform before signup.",
    "Store login email/phone label without exposing the secret in Clippers.",
    "Store 2FA method and recovery-codes-saved note outside this app.",
    "Store owner/admin and backup operator names in the private vault.",
    ...(platform === "instagram" ? ["Store linked Facebook Page admin/recovery path."] : []),
    ...(platform === "youtube" ? ["Store Google account/channel owner recovery path."] : []),
  ];
}

function accountCreationPostCreationNextActions(platform: ClipperPlatform): string[] {
  return [
    "Paste submitted evidence row once profile/security proof exists.",
    "Paste verified evidence row only after profile URL, 2FA and platform-specific proof are confirmed.",
    platform === "instagram"
      ? "Connect or create the matching Facebook Page before Meta App Review."
      : platform === "youtube"
        ? "Confirm YouTube channel handle and advanced/channel verification state before OAuth."
        : "Confirm account has no posting restrictions before TikTok Content Posting API review.",
    "Regenerate Account Creation Pack, External Setup Queue and Platform Portal Checklist.",
  ];
}

function accountCreationSessionPriority(item: ClipperAccountCreationPackItem): ClipperAccountCreationSessionPriority {
  if (item.status === "blocked" || !item.evidencePath) return "critical";
  if (item.status === "partial") return "high";
  return "medium";
}

function accountCreationSessionSortValue(item: ClipperAccountCreationPackItem): number {
  const priorityScore: Record<ClipperAccountCreationSessionPriority, number> = {
    critical: 0,
    high: 1,
    medium: 2,
  };
  const platformScore: Record<ClipperPlatform, number> = {
    instagram: 0,
    tiktok: 1,
    youtube: 2,
  };
  return (priorityScore[accountCreationSessionPriority(item)] * 100) + (platformScore[item.platform] * 10);
}

function accountCreationDoneCriteria(item: ClipperAccountCreationPackItem): string[] {
  return [
    `Profile URL opens publicly and shows ${item.handle}.`,
    "Email/phone verification is complete and redacted proof is captured.",
    "2FA is enabled or recovery codes are stored with redacted proof.",
    "Launch evidence row is pasted/imported and Account Evidence status is submitted or verified.",
    "No publishing is enabled until rights, OAuth and permission gates are approved.",
  ];
}

function buildAccountCreationSessionOrder(items: ClipperAccountCreationPackItem[]): ClipperAccountCreationSessionItem[] {
  return [...items]
    .sort((left, right) => accountCreationSessionSortValue(left) - accountCreationSessionSortValue(right) || left.accountName.localeCompare(right.accountName))
    .map((item, index) => ({
      rank: index + 1,
      id: item.id,
      accountId: item.accountId,
      accountName: item.accountName,
      platform: item.platform,
      handle: item.handle,
      status: item.status,
      signupUrl: item.signupUrl,
      profileLink: item.profileLink,
      priority: accountCreationSessionPriority(item),
      copyPackage: item.copyPackage,
      portalFormFields: item.portalFormFields,
      handleReservationPlan: item.handleReservationPlan,
      browserSessionChecklist: item.browserSessionChecklist,
      evidenceCapturePlan: item.evidenceCapturePlan,
      submittedEvidenceBatchRow: item.submittedEvidenceBatchRow,
      verifiedEvidenceBatchRow: item.verifiedEvidenceBatchRow,
      evidenceRecipeRow: item.evidenceRecipeRow,
      nextStep: item.nextStep,
      requiredProof: item.platformProofRequired,
      operatorVaultChecklist: item.operatorVaultChecklist,
      postCreationNextActions: item.postCreationNextActions,
      doneCriteria: accountCreationDoneCriteria(item),
    }));
}

function buildAccountCreationEvidenceBatchTemplate(items: ClipperAccountCreationPackItem[]): string {
  return [
    ["kind", "account_id", "platform", "status", "scope", "app_identifier", "public_base_url", "notes"].map(csvEscape).join(","),
    ...buildAccountCreationSessionOrder(items).map((item) => accountCreationEvidenceBatchRow(item.accountId, item.platform)),
  ].join("\n");
}

function buildAccountClaimSheet(items: ClipperAccountCreationPackItem[]): ClipperAccountClaimSheetItem[] {
  return buildAccountCreationSessionOrder(items).map((item) => {
    const cleanHandle = item.handle.replace(/^@+/, "");
    const vaultItemName = `Clippers/${item.platform}/${item.accountId}`;
    return {
      rank: item.rank,
      id: item.id,
      accountId: item.accountId,
      accountName: item.accountName,
      platform: item.platform,
      handle: item.handle,
      priority: item.priority,
      signupUrl: item.signupUrl,
      profileLink: item.profileLink,
      browserProfileLabel: `clippers-${item.platform}-${item.accountId}`,
      vaultItemName,
      loginIdentifierLabel: `<${item.accountId}-${item.platform}-login-email-or-phone-label>`,
      passwordVaultSlot: `${vaultItemName}/password`,
      twoFactorSlot: `${vaultItemName}/2fa-method-and-recovery-codes-saved-note`,
      recoverySlot: `${vaultItemName}/recovery-owner-backup-admin-note`,
      proofFolder: ACCOUNT_EVIDENCE_DIR,
      evidenceFileName: `${item.accountId}-${item.platform}.md`,
      evidenceRecipeRow: item.evidenceRecipeRow,
      submittedEvidenceBatchRow: item.submittedEvidenceBatchRow,
      verifiedEvidenceBatchRow: item.verifiedEvidenceBatchRow,
      preflightChecks: [
        "Confirm the browser is using the intended operator profile and no unrelated account session is active.",
        "Create or confirm the password-manager vault item before entering signup data.",
        `Reserve or test handle ${item.handle}; fallback only if the portal rejects it.`,
        "Prepare redaction workflow for screenshots before capturing proof.",
      ],
      claimSteps: [
        `Open ${item.signupUrl}.`,
        `Create or claim handle ${cleanHandle}.`,
        "Apply display name, bio, avatar/banner and profile settings from Account Identity Kit.",
        "Complete email/phone verification in the platform portal.",
        "Enable 2FA and save recovery details in the private vault, not in Clippers.",
      ],
      verificationSteps: [
        `Open expected public profile ${item.profileLink}.`,
        "Confirm the public profile shows the final handle and brand name.",
        ...item.requiredProof.map((proof) => `Capture redacted proof: ${proof}`),
        `Create evidence file ${path.join(ACCOUNT_EVIDENCE_DIR, `${item.accountId}-${item.platform}.md`)} or import the verified evidence row.`,
      ],
      postClaimSteps: [
        "Import submitted evidence immediately after account creation proof exists.",
        "Only import verified evidence after profile, security and platform-specific proof are checked.",
        "Regenerate Account Creation Pack, External Setup Queue and Command Center.",
        "Do not connect OAuth or publish until developer app, permissions, rights and DNS gates are ready.",
      ],
      blockedUntil: [
        "Real external account exists.",
        "Email/phone verification is complete.",
        "2FA/recovery proof is captured and stored privately.",
        "Account evidence is imported as submitted or verified.",
      ],
    };
  });
}

function renderAccountClaimSheetMarkdown(items: ClipperAccountClaimSheetItem[]): string {
  return [
    "# Clippers Account Claim Sheet",
    "",
    `Generated: ${new Date().toISOString()}`,
    `Accounts to claim: ${items.length}`,
    "",
    "Use this sheet while creating real external accounts. Store secrets only in the password manager/private vault; Clippers stores labels and evidence status, not passwords, phone numbers or recovery codes.",
    "",
    ...items.flatMap((item) => [
      `## ${item.rank}. ${item.accountName} / ${item.platform}`,
      "",
      `- Priority: ${item.priority}`,
      `- Handle: ${item.handle}`,
      `- Signup URL: ${item.signupUrl}`,
      `- Expected profile: ${item.profileLink}`,
      `- Browser profile label: ${item.browserProfileLabel}`,
      `- Vault item: ${item.vaultItemName}`,
      `- Login identifier label: ${item.loginIdentifierLabel}`,
      `- Password vault slot: ${item.passwordVaultSlot}`,
      `- 2FA slot: ${item.twoFactorSlot}`,
      `- Recovery slot: ${item.recoverySlot}`,
      `- Evidence file: ${path.join(item.proofFolder, item.evidenceFileName)}`,
      `- Submitted row: ${item.submittedEvidenceBatchRow}`,
      `- Verified row: ${item.verifiedEvidenceBatchRow}`,
      `- Recipe row: ${item.evidenceRecipeRow}`,
      "",
      "Preflight:",
      ...item.preflightChecks.map((step) => `- [ ] ${step}`),
      "",
      "Claim steps:",
      ...item.claimSteps.map((step) => `- [ ] ${step}`),
      "",
      "Verification steps:",
      ...item.verificationSteps.map((step) => `- [ ] ${step}`),
      "",
      "Post-claim:",
      ...item.postClaimSteps.map((step) => `- [ ] ${step}`),
      "",
      "Blocked until:",
      ...item.blockedUntil.map((step) => `- [ ] ${step}`),
      "",
    ]),
  ].join("\n");
}

function renderAccountClaimSheetCsv(items: ClipperAccountClaimSheetItem[]): string {
  const header = ["rank", "id", "account_id", "account_name", "platform", "handle", "priority", "signup_url", "profile_link", "browser_profile_label", "vault_item_name", "login_identifier_label", "password_vault_slot", "two_factor_slot", "recovery_slot", "proof_folder", "evidence_file_name", "preflight_checks", "claim_steps", "verification_steps", "post_claim_steps", "blocked_until", "submitted_evidence_batch_row", "verified_evidence_batch_row", "evidence_recipe_row"];
  return [
    header.map(csvEscape).join(","),
    ...items.map((item) => [
      item.rank,
      item.id,
      item.accountId,
      item.accountName,
      item.platform,
      item.handle,
      item.priority,
      item.signupUrl,
      item.profileLink,
      item.browserProfileLabel,
      item.vaultItemName,
      item.loginIdentifierLabel,
      item.passwordVaultSlot,
      item.twoFactorSlot,
      item.recoverySlot,
      item.proofFolder,
      item.evidenceFileName,
      item.preflightChecks.join(" | "),
      item.claimSteps.join(" | "),
      item.verificationSteps.join(" | "),
      item.postClaimSteps.join(" | "),
      item.blockedUntil.join(" | "),
      item.submittedEvidenceBatchRow,
      item.verifiedEvidenceBatchRow,
      item.evidenceRecipeRow,
    ].map(csvEscape).join(",")),
  ].join("\n");
}

async function buildAccountCreationPackSummary(input: {
  accountIdentityKit: ClipperAccountIdentityKitSummary;
  accountLaunchKit: ClipperAccountLaunchKitSummary;
}): Promise<ClipperAccountCreationPackSummary> {
  const items: ClipperAccountCreationPackItem[] = input.accountLaunchKit.tasks.map((task) => {
    const identity = input.accountIdentityKit.accounts.find((account) => account.accountId === task.accountId);
    const profile = identity?.platforms.find((platform) => platform.platform === task.platform);
    const status = accountCreationStatus(task);
    const evidenceToCapture = [
      "Screenshot del perfil creado con handle visible.",
      "Screenshot de email/telefono verificado sin exponer datos sensibles completos.",
      "Screenshot de 2FA activado o nota de recovery codes guardados.",
      task.platform === "instagram" ? "Screenshot de Professional Account y Page conectada." : null,
      task.platform === "youtube" ? "Screenshot del canal creado y handle visible." : null,
      "Registrar evidencia en Account Evidence con status submitted o verified.",
    ].filter((item): item is string => Boolean(item));
    return {
      id: task.id,
      accountId: task.accountId,
      accountName: task.accountName,
      category: task.category,
      platform: task.platform,
      status,
      handle: task.handle,
      displayName: task.displayName,
      profileLink: task.profileLink,
      signupUrl: task.accountCreationUrl,
      officialHelpUrl: officialAccountHelpUrl(task.platform),
      bio: task.bio,
      usernameAlternatives: profile?.usernameAlternatives || usernameAlternatives(task.handle),
      profileImagePrompt: profile?.profileImagePrompt || "",
      bannerPrompt: profile?.bannerPrompt || "",
      firstPostIdeas: profile?.firstPostIdeas || firstPostIdeas({ id: task.accountId, name: task.accountName, category: task.category, platforms: [], platformAccounts: [], dailyClipTarget: 0, weeklyViewsGoal: 0, lastWeekViews: 0, status: "needs_connection", contentPolicy: "" }),
      verificationRequirements: accountVerificationRequirements(task.platform),
      setupChecklist: [
        `Abrir signup/login: ${task.accountCreationUrl}`,
        `Intentar handle principal: ${task.handle}`,
        `Si no esta disponible, probar: ${(profile?.usernameAlternatives || usernameAlternatives(task.handle)).join(", ")}`,
        `Pegar display name: ${task.displayName}`,
        `Pegar bio: ${task.bio}`,
        "Aplicar avatar/banner generado o aprobado.",
        "Activar 2FA y guardar recovery codes en password manager.",
        "Guardar evidencia en Account Evidence.",
        "No publicar hasta que Rights Gate y Permission Tracker esten aprobados.",
      ],
      securityChecklist: accountCreationSecurityChecklist(task.platform),
      recoveryPlan: accountCreationRecoveryPlan(task.platform),
      platformProofRequired: accountCreationPlatformProofRequired(task.platform),
      evidenceToCapture,
      requiredInputs: accountCreationRequiredInputs(task.platform),
      completionHint: accountCreationCompletionHint(task.platform),
      evidenceBatchRow: accountCreationEvidenceBatchRow(task.accountId, task.platform),
      submittedEvidenceBatchRow: accountCreationEvidenceBatchRow(task.accountId, task.platform, "submitted"),
      verifiedEvidenceBatchRow: accountCreationEvidenceBatchRow(task.accountId, task.platform, "verified"),
      evidenceRecipeRow: accountCreationEvidenceRecipeRow(task.accountId, task.platform),
      evidencePath: task.evidencePath,
      copyPackage: accountCreationCopyPackage({
        handle: task.handle,
        displayName: task.displayName,
        bio: task.bio,
        profileLink: task.profileLink,
        signupUrl: task.accountCreationUrl,
        usernameAlternatives: profile?.usernameAlternatives || usernameAlternatives(task.handle),
      }),
      portalFormFields: accountCreationPortalFormFields({
        platform: task.platform,
        handle: task.handle,
        displayName: task.displayName,
        bio: task.bio,
        profileLink: task.profileLink,
        usernameAlternatives: profile?.usernameAlternatives || usernameAlternatives(task.handle),
      }),
      handleReservationPlan: accountCreationHandleReservationPlan(task.handle, profile?.usernameAlternatives || usernameAlternatives(task.handle)),
      browserSessionChecklist: accountCreationBrowserSessionChecklist(task.platform),
      evidenceCapturePlan: accountCreationEvidenceCapturePlan(task.platform),
      operatorVaultChecklist: accountCreationOperatorVaultChecklist(task.platform),
      postCreationNextActions: accountCreationPostCreationNextActions(task.platform),
      blockers: status === "ready" ? [] : [
        ...(task.evidenceStatus === "missing" ? ["Falta evidencia de cuenta creada/verificada."] : []),
        ...task.blockers,
      ],
      nextStep: status === "ready"
        ? "Cuenta lista; conectar OAuth y mantener approval_required para primeros posts."
        : status === "partial"
          ? "Completar verificacion/2FA y marcar evidencia como verified."
          : `Crear/verificar ${task.handle} en ${task.platform} y registrar evidencia.`,
    };
  });
  const totals = items.reduce<ClipperAccountCreationPackSummary["totals"]>((sum, item) => {
    sum.profiles += 1;
    if (item.status === "ready") sum.ready += 1;
    if (item.status === "partial") sum.partial += 1;
    if (item.status === "blocked") sum.blocked += 1;
    if (!item.evidencePath) sum.evidenceMissing += 1;
    return sum;
  }, { profiles: 0, ready: 0, partial: 0, blocked: 0, evidenceMissing: 0 });
  const generatedAt = await stat(ACCOUNT_CREATION_PACK_PATH).then((file) => file.mtime.toISOString()).catch(() => null);
  const sessionOrder = buildAccountCreationSessionOrder(items);
  const claimSheet = buildAccountClaimSheet(items);
  return {
    status: !generatedAt ? "not_prepared" : totals.blocked > 0 ? "blocked" : totals.partial > 0 ? "partial" : "ready",
    generatedAt,
    manifestPath: ACCOUNT_CREATION_PACK_PATH,
    markdownPath: ACCOUNT_CREATION_PACK_MARKDOWN_PATH,
    csvPath: ACCOUNT_CREATION_PACK_CSV_PATH,
    claimSheetPath: ACCOUNT_CLAIM_SHEET_MARKDOWN_PATH,
    claimSheetCsvPath: ACCOUNT_CLAIM_SHEET_CSV_PATH,
    officialSourcesCheckedAt: "2026-06-17",
    items,
    sessionOrder,
    claimSheet,
    evidenceBatchTemplate: buildAccountCreationEvidenceBatchTemplate(items),
    totals,
    nextStep: items.find((item) => item.status === "blocked")?.nextStep
      || items.find((item) => item.status === "partial")?.nextStep
      || "Todas las cuentas tienen evidencia; seguir con OAuth/app review y primeros posts approval_required.",
  };
}

function renderAccountCreationPackMarkdown(summary: ClipperAccountCreationPackSummary): string {
  return [
    "# Clippers Account Creation Pack",
    "",
    `Status: ${summary.status}`,
    `Generated: ${summary.generatedAt || new Date().toISOString()}`,
    `Official sources checked: ${summary.officialSourcesCheckedAt}`,
    `Totals: ${summary.totals.ready}/${summary.totals.profiles} ready; ${summary.totals.partial} partial; ${summary.totals.blocked} blocked; ${summary.totals.evidenceMissing} evidence missing`,
    "",
    "## Next Step",
    "",
    summary.nextStep,
    "",
    "## Claim Sheet",
    "",
    `- Markdown: ${summary.claimSheetPath}`,
    `- CSV: ${summary.claimSheetCsvPath}`,
    `- Rows: ${summary.claimSheet.length}`,
    "",
    "## Account Creation Session",
    "",
    ...summary.sessionOrder.flatMap((item) => [
      `### ${item.rank}. ${item.accountName} / ${item.platform}`,
      "",
      `- Priority: ${item.priority}`,
      `- Status: ${item.status}`,
      `- Handle: ${item.handle}`,
      `- Signup URL: ${item.signupUrl}`,
      `- Profile link: ${item.profileLink}`,
      `- Submitted evidence row: ${item.submittedEvidenceBatchRow}`,
      `- Verified evidence row: ${item.verifiedEvidenceBatchRow}`,
      `- Evidence recipe row: ${item.evidenceRecipeRow}`,
      `- Next step: ${item.nextStep}`,
      "",
      "Copy package:",
      ...item.copyPackage.map((field) => `- ${field.label}: ${field.value}`),
      "",
      "Portal form fields:",
      ...item.portalFormFields.map((field) => `- ${field.field}: ${field.value} (${field.note})`),
      "",
      "Handle reservation plan:",
      ...item.handleReservationPlan.map((step) => `- [ ] ${step}`),
      "",
      "Browser session checklist:",
      ...item.browserSessionChecklist.map((step) => `- [ ] ${step}`),
      "",
      "Evidence capture plan:",
      ...item.evidenceCapturePlan.map((step) => `- [ ] ${step}`),
      "",
      "Operator vault checklist:",
      ...item.operatorVaultChecklist.map((step) => `- [ ] ${step}`),
      "",
      "Post-creation next actions:",
      ...item.postCreationNextActions.map((step) => `- [ ] ${step}`),
      "",
      "Required proof:",
      ...item.requiredProof.map((proof) => `- [ ] ${proof}`),
      "",
      "Done criteria:",
      ...item.doneCriteria.map((criterion) => `- [ ] ${criterion}`),
      "",
    ]),
    "## Launch Evidence Batch Template",
    "",
    "```csv",
    summary.evidenceBatchTemplate,
    "```",
    "",
    "## Profiles",
    "",
    ...summary.items.flatMap((item) => [
      `### ${item.accountName} / ${item.platform}`,
      "",
      `- Status: ${item.status}`,
      `- Category: ${item.category}`,
      `- Handle: ${item.handle}`,
      `- Display name: ${item.displayName}`,
      `- Profile link: ${item.profileLink}`,
      `- Signup URL: ${item.signupUrl}`,
      `- Official help: ${item.officialHelpUrl}`,
      `- Bio: ${item.bio}`,
      `- Evidence: ${item.evidencePath || "missing"}`,
      `- Completion hint: ${item.completionHint}`,
      `- Evidence batch row: ${item.evidenceBatchRow}`,
      `- Submitted evidence row: ${item.submittedEvidenceBatchRow}`,
      `- Verified evidence row: ${item.verifiedEvidenceBatchRow}`,
      `- Evidence recipe row: ${item.evidenceRecipeRow}`,
      `- Next step: ${item.nextStep}`,
      "",
      "Copy package:",
      ...item.copyPackage.map((field) => `- ${field.label}: ${field.value}`),
      "",
      "Portal form fields:",
      ...item.portalFormFields.map((field) => `- ${field.field}: ${field.value} (${field.note})`),
      "",
      "Handle reservation plan:",
      ...item.handleReservationPlan.map((step) => `- [ ] ${step}`),
      "",
      "Browser session checklist:",
      ...item.browserSessionChecklist.map((step) => `- [ ] ${step}`),
      "",
      "Evidence capture plan:",
      ...item.evidenceCapturePlan.map((step) => `- [ ] ${step}`),
      "",
      "Required inputs:",
      ...item.requiredInputs.map((input) => `- [ ] ${input}`),
      "",
      "Username alternatives:",
      ...item.usernameAlternatives.map((handle) => `- ${handle}`),
      "",
      "Verification requirements:",
      ...item.verificationRequirements.map((step) => `- ${step}`),
      "",
      "Setup checklist:",
      ...item.setupChecklist.map((step) => `- [ ] ${step}`),
      "",
      "Security checklist:",
      ...item.securityChecklist.map((step) => `- [ ] ${step}`),
      "",
      "Recovery plan:",
      ...item.recoveryPlan.map((step) => `- [ ] ${step}`),
      "",
      "Operator vault checklist:",
      ...item.operatorVaultChecklist.map((step) => `- [ ] ${step}`),
      "",
      "Platform proof required:",
      ...item.platformProofRequired.map((step) => `- [ ] ${step}`),
      "",
      "Post-creation next actions:",
      ...item.postCreationNextActions.map((step) => `- [ ] ${step}`),
      "",
      "Evidence to capture:",
      ...item.evidenceToCapture.map((step) => `- [ ] ${step}`),
      "",
      "First post ideas:",
      ...item.firstPostIdeas.map((idea) => `- ${idea}`),
      "",
      item.blockers.length ? "Blockers:" : "Blockers: none",
      ...item.blockers.map((blocker) => `- ${blocker}`),
      "",
    ]),
  ].join("\n");
}

function renderAccountCreationPackCsv(summary: ClipperAccountCreationPackSummary): string {
  const header = ["id", "account", "category", "platform", "status", "handle", "display_name", "signup_url", "profile_link", "copy_package", "portal_form_fields", "handle_reservation_plan", "browser_session_checklist", "evidence_capture_plan", "required_inputs", "security_checklist", "recovery_plan", "operator_vault_checklist", "platform_proof_required", "post_creation_next_actions", "completion_hint", "evidence_batch_row", "submitted_evidence_batch_row", "verified_evidence_batch_row", "evidence_recipe_row", "evidence_path", "next_step"];
  return [
    header.map(csvEscape).join(","),
    ...summary.items.map((item) => [
      item.id,
      item.accountName,
      item.category,
      item.platform,
      item.status,
      item.handle,
      item.displayName,
      item.signupUrl,
      item.profileLink,
      item.copyPackage.map((field) => `${field.label}: ${field.value}`).join(" | "),
      item.portalFormFields.map((field) => `${field.field}: ${field.value} (${field.note})`).join(" | "),
      item.handleReservationPlan.join(" | "),
      item.browserSessionChecklist.join(" | "),
      item.evidenceCapturePlan.join(" | "),
      item.requiredInputs.join(" | "),
      item.securityChecklist.join(" | "),
      item.recoveryPlan.join(" | "),
      item.operatorVaultChecklist.join(" | "),
      item.platformProofRequired.join(" | "),
      item.postCreationNextActions.join(" | "),
      item.completionHint,
      item.evidenceBatchRow,
      item.submittedEvidenceBatchRow,
      item.verifiedEvidenceBatchRow,
      item.evidenceRecipeRow,
      item.evidencePath || "",
      item.nextStep,
    ].map(csvEscape).join(",")),
  ].join("\n");
}

export async function prepareClipperAccountCreationPack(userId = getSystemUserId()): Promise<{ accountCreationPack: ClipperAccountCreationPackSummary; status: ClipperStatus }> {
  await writeDefaultConfigIfMissing();
  await ensureClipperDirs();
  const config = await readConfig();
  const oauthConnections = await readOAuthConnections();
  const tokenRecords = await readTokenVaultRecords();
  const accounts = applyOAuthStateToAccounts(
    (Array.isArray(config.accounts) && config.accounts.length ? config.accounts : DEFAULT_ACCOUNTS).map(ensureAccountShape),
    oauthConnections,
    tokenRecords
  );
  const accountEvidence = await buildAccountEvidenceSummary(accounts);
  const accountIdentityKit = await buildAccountIdentityKitSummary(accounts);
  const accountLaunchKit = await buildAccountLaunchKitSummary(accounts, accountEvidence);
  const draftSummary = await buildAccountCreationPackSummary({ accountIdentityKit, accountLaunchKit });
  const accountCreationPack: ClipperAccountCreationPackSummary = {
    ...draftSummary,
    generatedAt: new Date().toISOString(),
    status: draftSummary.totals.blocked > 0 ? "blocked" : draftSummary.totals.partial > 0 ? "partial" : "ready",
  };
  await writeFile(ACCOUNT_CREATION_PACK_PATH, JSON.stringify(accountCreationPack, null, 2));
  await writeFile(ACCOUNT_CREATION_PACK_MARKDOWN_PATH, renderAccountCreationPackMarkdown(accountCreationPack));
  await writeFile(ACCOUNT_CREATION_PACK_CSV_PATH, renderAccountCreationPackCsv(accountCreationPack));
  await writeFile(ACCOUNT_CLAIM_SHEET_MARKDOWN_PATH, renderAccountClaimSheetMarkdown(accountCreationPack.claimSheet));
  await writeFile(ACCOUNT_CLAIM_SHEET_CSV_PATH, renderAccountClaimSheetCsv(accountCreationPack.claimSheet));
  return { accountCreationPack, status: await getClipperStatus(userId) };
}

function permissionTrackerItemStatus(input: {
  permission: ClipperPermissionRequest;
  credentialCheck: ClipperCredentialCheck | undefined;
  tokenRecord: ClipperTokenVaultRecord | undefined;
  oauthConnection: ClipperOAuthConnection | undefined;
  accountLaunchTasks: ClipperAccountLaunchTask[];
  permissionPack: ClipperPermissionPackSummary;
}): ClipperPermissionTrackerItemStatus {
  if (input.tokenRecord?.scopes.includes(input.permission.scope)) return "approved";
  if (input.oauthConnection?.status === "code_received") return "requested";
  if (input.credentialCheck?.missingEnvVars.length || input.permissionPack.status !== "ready") return "blocked";
  if (input.accountLaunchTasks.some((task) => task.platform === input.permission.platform && task.status === "blocked")) return "blocked";
  return "ready_to_request";
}

function buildPermissionTrackerItems(input: {
  accounts: ClipperAccount[];
  credentialChecks: ClipperCredentialCheck[];
  tokenRecords: ClipperTokenVaultRecord[];
  oauthConnections: ClipperOAuthConnection[];
  permissionPack: ClipperPermissionPackSummary;
  accountLaunchKit: ClipperAccountLaunchKitSummary;
  permissionStatusRecords: ClipperPermissionStatusRecord[];
}): ClipperPermissionTrackerItem[] {
  const verifiedAt = new Date().toISOString();
  return PERMISSION_QUEUE.map((permission) => {
    const requirement = PLATFORM_REQUIREMENTS.find((platform) => platform.platform === permission.platform);
    const credentialCheck = input.credentialChecks.find((check) => check.platform === permission.platform);
    const tokenRecord = input.tokenRecords.find((record) => record.platform === permission.platform);
    const oauthConnection = input.oauthConnections.find((connection) => connection.platform === permission.platform);
    const accountLaunchTasks = input.accountLaunchKit.tasks.filter((task) => task.platform === permission.platform);
    const computedStatus = permissionTrackerItemStatus({
      permission,
      credentialCheck,
      tokenRecord,
      oauthConnection,
      accountLaunchTasks,
      permissionPack: input.permissionPack,
    });
    const statusRecord = input.permissionStatusRecords.find((record) => record.platform === permission.platform && record.scope === permission.scope);
    const status = statusRecord?.status || computedStatus;
    const blockers = [
      ...(credentialCheck?.missingEnvVars.map((envVar) => `Falta env var ${envVar}.`) || []),
      ...(input.permissionPack.status === "ready" ? [] : ["Falta generar paquete de permisos/app review."]),
      ...(accountLaunchTasks.some((task) => task.status === "blocked") ? ["Falta crear/verificar al menos una cuenta real para esta plataforma."] : []),
      ...(!getTokenVaultSecret() ? [`Falta ${TOKEN_ENCRYPTION_ENV_VAR} para guardar tokens cifrados.`] : []),
    ];
    return {
      id: permission.id,
      platform: permission.platform,
      scope: permission.scope,
      label: permission.label,
      status,
      statusSource: statusRecord ? "manual_record" : "computed",
      recordedAt: statusRecord?.recordedAt || null,
      recordNotes: statusRecord?.notes || null,
      appReviewRequired: true,
      docsUrl: permission.docsUrl,
      developerPortalUrl: requirement?.developerPortalUrl || "",
      evidenceBatchRow: ["permission", "", permission.platform, "requested", permission.scope, "", "", ""].map(csvEscape).join(","),
      evidenceRecipeRow: ["permission", "", permission.platform, "requested", permission.scope, "", "", "<permission request/review URL, approval screenshot, ticket, email, or portal note>"].map(csvEscape).join(","),
      evidenceRequired: [
        permission.evidenceRequired,
        "Redirect URI registrado y consistente con PUBLIC_BASE_URL.",
        "Screenshot de OAuth/token vault en Clippers sin exponer secretos.",
        "Evidencia de cuenta destino creada/verificada.",
        "Evidencia de fuentes propias, licenciadas o permissioned para evitar strikes.",
      ],
      humanSteps: requirement?.humanRequired || [],
      blockers: status === "approved" ? [] : blockers,
      sourceVerifiedAt: verifiedAt,
      nextStep: status === "approved"
        ? "Permiso aprobado registrado; conectar OAuth/token vault si todavia falta y mantener auditoria."
        : status === "requested"
          ? "Completar intercambio de token, app review/audit y guardar evidencia."
          : status === "ready_to_request"
            ? "Entrar al developer portal, solicitar scope y adjuntar el paquete de evidencia."
            : blockers[0] || "Resolver blockers antes de solicitar este permiso.",
    };
  });
}

function permissionTrackerStatus(totals: ClipperPermissionTrackerSummary["totals"], generatedAt: string | null): ClipperPermissionTrackerStatus {
  if (!generatedAt) return "not_prepared";
  if (totals.approved === totals.permissions && totals.permissions > 0) return "ready";
  if (totals.requested > 0 || totals.readyToRequest > 0) return "in_review";
  return "blocked";
}

function buildPermissionTrackerMarkdown(summary: ClipperPermissionTrackerSummary): string {
  return [
    "# Clippers Permission Tracker",
    "",
    `Generated: ${summary.generatedAt || "pending"}`,
    `Status: ${summary.status}`,
    `Status records: ${summary.statusRecordsPath}`,
    `Totals: ${summary.totals.permissions} permissions, ${summary.totals.approved} approved, ${summary.totals.requested} requested, ${summary.totals.readyToRequest} ready_to_request, ${summary.totals.blocked} blocked`,
    "",
    "## Official Sources",
    "",
    ...summary.officialSources.map((source) => `- ${source}`),
    "",
    "## Next Step",
    "",
    summary.nextStep,
    "",
    "## Permissions",
    "",
    ...summary.items.flatMap((item) => [
      `### ${item.label}`,
      "",
      `- Platform: ${item.platform}`,
      `- Scope: ${item.scope}`,
      `- Status: ${item.status}`,
      `- Status source: ${item.statusSource}`,
      `- Recorded at: ${item.recordedAt || "n/a"}`,
      `- Notes: ${item.recordNotes || "n/a"}`,
      `- Developer portal: ${item.developerPortalUrl}`,
      `- Docs: ${item.docsUrl}`,
      `- Evidence batch row: ${item.evidenceBatchRow}`,
      `- Evidence recipe row: ${item.evidenceRecipeRow}`,
      `- Next step: ${item.nextStep}`,
      "",
      "Evidence required:",
      ...item.evidenceRequired.map((evidence) => `- [ ] ${evidence}`),
      "",
      item.blockers.length ? "Blockers:" : "Blockers: none",
      ...item.blockers.map((blocker) => `- ${blocker}`),
      "",
    ]),
  ].join("\n");
}

async function buildPermissionTrackerSummary(input: {
  accounts: ClipperAccount[];
  credentialChecks: ClipperCredentialCheck[];
  tokenRecords: ClipperTokenVaultRecord[];
  oauthConnections: ClipperOAuthConnection[];
  permissionPack: ClipperPermissionPackSummary;
  accountLaunchKit: ClipperAccountLaunchKitSummary;
}): Promise<ClipperPermissionTrackerSummary> {
  await ensureClipperDirs();
  const permissionStatusRecords = await readPermissionStatusRecords();
  const items = buildPermissionTrackerItems({ ...input, permissionStatusRecords });
  const totals = items.reduce<ClipperPermissionTrackerSummary["totals"]>((sum, item) => {
    sum.permissions += 1;
    if (item.status === "approved") sum.approved += 1;
    if (item.status === "requested") sum.requested += 1;
    if (item.status === "ready_to_request") sum.readyToRequest += 1;
    if (item.status === "blocked") sum.blocked += 1;
    return sum;
  }, { permissions: 0, approved: 0, requested: 0, readyToRequest: 0, blocked: 0 });
  const generatedAt = await stat(PERMISSION_TRACKER_PATH).then((file) => file.mtime.toISOString()).catch(() => null);
  const status = permissionTrackerStatus(totals, generatedAt);
  return {
    status,
    generatedAt,
    trackerPath: PERMISSION_TRACKER_PATH,
    markdownPath: PERMISSION_TRACKER_MARKDOWN_PATH,
    statusRecordsPath: PERMISSION_STATUS_RECORDS_PATH,
    items,
    totals,
    officialSources: Array.from(new Set([
      ...PLATFORM_REQUIREMENTS.flatMap((requirement) => requirement.docs),
      "https://developers.tiktok.com/doc/tiktok-api-scopes/",
      "https://developers.google.com/youtube/v3/docs/videos/insert",
    ])),
    nextStep: !generatedAt
      ? "Generar Permission Tracker para tener permisos, evidencia y blockers en un solo manifest."
      : totals.blocked > 0
        ? "Resolver env vars, cuentas externas y token vault antes de solicitar scopes bloqueados."
        : totals.approved === totals.permissions
          ? "Permisos listos; mantener QA, rights gate y metricas antes de autopost masivo."
          : "Solicitar scopes ready_to_request y mover requested a approved cuando app review/OAuth termine.",
  };
}

function permissionRequestUseCase(item: ClipperPermissionTrackerItem): string {
  if (item.platform === "tiktok" && item.scope === "video.publish") {
    return "Directly publish approved short-form videos to authorized TikTok accounts after explicit OAuth consent.";
  }
  if (item.platform === "tiktok" && item.scope === "video.upload") {
    return "Upload approved clips or create draft/upload flows for creators when direct publish is not appropriate.";
  }
  if (item.platform === "instagram" && item.scope === "instagram_content_publish") {
    return "Publish approved Reels packages to eligible professional Instagram accounts connected to managed Facebook Pages.";
  }
  if (item.platform === "instagram") {
    return "Resolve and verify the correct professional Instagram account/Page destination before publishing approved Reels.";
  }
  return "Upload approved YouTube Shorts to authorized channels using YouTube Data API videos.insert.";
}

function permissionRequestJustification(item: ClipperPermissionTrackerItem): string {
  return [
    `${item.scope} is required for Clippers to operate a controlled publishing workflow on ${item.platform}.`,
    "The app only publishes to accounts we own or manage after explicit OAuth authorization.",
    "Every clip must pass Rights Gate with ownership, license, official-source, or creator/rightsholder permission evidence.",
    "Publishing remains approval_required until account evidence, developer app review, OAuth tokens, permissions and QA are verified.",
    "OAuth tokens are stored encrypted server-side and are not exposed in UI, logs, reports or generated artifacts.",
  ].join(" ");
}

function permissionRequestPlatformConstraints(item: ClipperPermissionTrackerItem): string[] {
  if (item.platform === "tiktok") {
    return [
      "Official docs checked 2026-06-17: create/register the TikTok developer app, add the Content Posting API product, and configure Direct Post before using direct publishing.",
      "video.publish requires explicit scope approval and user authorization before direct posting.",
      "Until TikTok audit/app review is complete, keep launches in approval_required/private-testing mode and record review evidence before scaling.",
    ];
  }
  if (item.platform === "youtube") {
    return [
      "Official docs checked 2026-06-17: YouTube uploads require OAuth authorization with youtube.upload or another accepted YouTube upload scope.",
      "Projects created after 2020-07-28 may have uploads restricted to private while unverified; plan Google OAuth verification/API compliance audit before public autopost.",
      "YouTube videos.insert consumes the Video Uploads daily quota bucket, so production scaling needs quota monitoring per Google Cloud project.",
    ];
  }
  return [
    "Meta/Instagram publishing requires an eligible professional Instagram account connected to a managed Facebook Page.",
    "instagram_content_publish, instagram_basic and pages_show_list remain gated behind Meta App Review and account/Page evidence.",
    "Keep Instagram posting approval_required until the destination account, app review, OAuth token and media container QA are verified.",
  ];
}

function permissionRequestAuditWarnings(item: ClipperPermissionTrackerItem): string[] {
  if (item.platform === "tiktok") {
    return [
      "Unaudited TikTok clients can be limited to private visibility; public view goals depend on passing review/audit.",
      "Do not count TikTok as public-autopost ready until video.publish approval, user authorization and client audit evidence are recorded.",
    ];
  }
  if (item.platform === "youtube") {
    return [
      "Unverified YouTube API projects can upload as private only; public Shorts scaling depends on verification/compliance status.",
      "Monitor upload quota before scheduling high-volume Shorts batches.",
    ];
  }
  return [
    "Meta App Review and professional account/Page requirements can block public Reels publishing until approved.",
    "Use manual posting or approval_required fallback while app review/OAuth permissions are incomplete.",
  ];
}

function permissionRequestPackStatus(item: ClipperPermissionTrackerItem): ClipperPermissionRequestPackStatus {
  if (item.status === "approved") return "ready";
  if (item.status === "requested" || item.status === "ready_to_request") return "partial";
  return "blocked";
}

function officialPermissionScope(platform: ClipperPlatform, scope: string): ClipperOfficialPermissionMatrixItem["scopes"][number] | null {
  return OFFICIAL_PERMISSION_MATRIX_ITEMS
    .find((item) => item.platform === platform)
    ?.scopes.find((item) => item.scope === scope) || null;
}

function permissionRequestReadiness(item: ClipperPermissionTrackerItem): ClipperPermissionRequestReadiness {
  if (item.status === "approved") return "approved";
  if (item.status === "requested") return "submitted";
  if (item.status === "ready_to_request") return "ready_to_submit";
  return "blocked";
}

function permissionRequestMissingEvidence(item: ClipperPermissionTrackerItem, packStatus: ClipperPermissionRequestPackStatus): string[] {
  if (packStatus === "ready") return [];
  return [
    ...(item.blockers.length ? item.blockers : []),
    ...item.evidenceRequired.filter((evidence) => /falta|missing|evidencia|redirect|cuenta|rights|token/i.test(evidence)),
  ].slice(0, 8);
}

function permissionReviewerInstructions(item: ClipperPermissionTrackerItem): string {
  return [
    `Please review and approve ${item.scope} for the Clippers publishing workflow on ${item.platform}.`,
    "The app publishes only to owned/managed accounts after explicit OAuth consent.",
    "Every post is gated by human approval, account verification, rights evidence and QA before public publishing.",
    "Reviewer can use the public demo, privacy policy, terms, redirect URI and attached screenshots to verify the flow.",
  ].join(" ");
}

async function buildPermissionRequestPackSummary(permissionTracker: ClipperPermissionTrackerSummary): Promise<ClipperPermissionRequestPackSummary> {
  const { privacyUrl, termsUrl } = legalPolicyUrls();
  const demoUrl = appReviewDemoUrl();
  const items: ClipperPermissionRequestPackItem[] = permissionTracker.items.map((item) => {
    const packStatus = permissionRequestPackStatus(item);
    const officialScope = officialPermissionScope(item.platform, item.scope);
    const requestReadiness = permissionRequestReadiness(item);
    const missingEvidence = permissionRequestMissingEvidence(item, packStatus);
    return {
      id: item.id,
      platform: item.platform,
      scope: item.scope,
      label: item.label,
      status: item.status,
      packStatus,
      developerPortalUrl: item.developerPortalUrl,
      docsUrl: item.docsUrl,
      officialReferenceUrl: officialScope?.officialReferenceUrl || item.docsUrl,
      officialVerificationStatus: officialScope?.verificationStatus || "missing",
      requestReadiness,
      requestedUseCase: permissionRequestUseCase(item),
      copyReadyJustification: permissionRequestJustification(item),
      reviewerInstructions: permissionReviewerInstructions(item),
      scopeRequestLine: `${item.platform} permission request: ${item.scope} (${requestReadiness})`,
      platformConstraints: permissionRequestPlatformConstraints(item),
      auditWarnings: permissionRequestAuditWarnings(item),
      officialApprovalChecklist: officialScope?.verificationChecklist || [
        "Confirm the official permission reference before submitting.",
        "Confirm the app review portal asks for this exact scope.",
        "Capture the final submitted/requested/approved screen.",
      ],
      reviewerEvidence: [
        ...item.evidenceRequired,
        `Privacy Policy URL: ${privacyUrl}`,
        `Terms of Service URL: ${termsUrl}`,
        `Public app review demo URL: ${demoUrl}`,
        "Developer Application Drafts with copy-ready responses.",
        "Account Creation Pack and Account Evidence for target profiles/channels.",
      ],
      missingEvidence,
      submissionSteps: [
        `Open developer portal: ${item.developerPortalUrl}`,
        `Open docs/reference: ${item.docsUrl}`,
        `Confirm official reference: ${officialScope?.officialReferenceUrl || item.docsUrl}`,
        `Select or request scope: ${item.scope}`,
        "Paste the copy-ready justification from this pack.",
        "Paste reviewer instructions and attach the proof checklist evidence.",
        "Attach or record screenshots for rights gate, demo, legal URLs, account evidence and redirect URI.",
        "Submit review/request and record the status in Clippers Permission Tracker.",
      ],
      evidenceBatchRow: item.evidenceBatchRow,
      evidenceRecipeRow: item.evidenceRecipeRow,
      legalUrls: {
        privacyPolicyUrl: privacyUrl,
        termsUrl,
        demoUrl,
      },
      blockers: packStatus === "ready" ? [] : item.blockers,
      nextStep: packStatus === "ready"
        ? "Permiso aprobado; mantener evidencia y conectar OAuth/token vault si falta."
        : packStatus === "partial"
          ? "Enviar o completar review en el portal y registrar requested/approved en Permission Tracker."
          : item.nextStep,
    };
  });
  const totals = items.reduce<ClipperPermissionRequestPackSummary["totals"]>((sum, item) => {
    sum.permissions += 1;
    if (item.packStatus === "ready") sum.ready += 1;
    if (item.packStatus === "partial") sum.partial += 1;
    if (item.packStatus === "blocked") sum.blocked += 1;
    if (item.status === "approved") sum.approved += 1;
    if (item.status === "requested") sum.requested += 1;
    return sum;
  }, { permissions: 0, ready: 0, partial: 0, blocked: 0, approved: 0, requested: 0 });
  const generatedAt = await stat(PERMISSION_REQUEST_PACK_PATH).then((file) => file.mtime.toISOString()).catch(() => null);
  return {
    status: !generatedAt ? "not_prepared" : totals.blocked > 0 ? "blocked" : totals.partial > 0 ? "partial" : "ready",
    generatedAt,
    manifestPath: PERMISSION_REQUEST_PACK_PATH,
    markdownPath: PERMISSION_REQUEST_PACK_MARKDOWN_PATH,
    csvPath: PERMISSION_REQUEST_PACK_CSV_PATH,
    sourceTrackerPath: permissionTracker.trackerPath,
    items,
    totals,
    nextStep: items.find((item) => item.packStatus === "blocked")?.nextStep
      || items.find((item) => item.packStatus === "partial")?.nextStep
      || "Permission Request Pack listo; todos los permisos estan aprobados o listos para OAuth/publishing QA.",
  };
}

function renderPermissionRequestPackMarkdown(summary: ClipperPermissionRequestPackSummary): string {
  return [
    "# Clippers Permission Request Pack",
    "",
    `Status: ${summary.status}`,
    `Generated: ${summary.generatedAt || new Date().toISOString()}`,
    `Source tracker: ${summary.sourceTrackerPath}`,
    `Totals: ${summary.totals.ready}/${summary.totals.permissions} ready; ${summary.totals.partial} partial; ${summary.totals.blocked} blocked; ${summary.totals.approved} approved; ${summary.totals.requested} requested`,
    "",
    "## Next Step",
    "",
    summary.nextStep,
    "",
    "## Requests",
    "",
    ...summary.items.flatMap((item) => [
      `### ${item.label}`,
      "",
      `- Platform: ${item.platform}`,
      `- Scope: ${item.scope}`,
      `- Tracker status: ${item.status}`,
      `- Pack status: ${item.packStatus}`,
      `- Request readiness: ${item.requestReadiness}`,
      `- Developer portal: ${item.developerPortalUrl}`,
      `- Docs: ${item.docsUrl}`,
      `- Official reference: ${item.officialReferenceUrl}`,
      `- Official verification: ${item.officialVerificationStatus}`,
      `- Privacy Policy URL: ${item.legalUrls.privacyPolicyUrl}`,
      `- Terms URL: ${item.legalUrls.termsUrl}`,
      `- Demo URL: ${item.legalUrls.demoUrl}`,
      `- Scope request line: ${item.scopeRequestLine}`,
      `- Evidence batch row: ${item.evidenceBatchRow}`,
      `- Evidence recipe row: ${item.evidenceRecipeRow}`,
      `- Next step: ${item.nextStep}`,
      "",
      "Requested use case:",
      item.requestedUseCase,
      "",
      "Copy-ready justification:",
      item.copyReadyJustification,
      "",
      "Reviewer instructions:",
      item.reviewerInstructions,
      "",
      "Platform constraints:",
      ...item.platformConstraints.map((constraint) => `- ${constraint}`),
      "",
      "Official approval checklist:",
      ...item.officialApprovalChecklist.map((step) => `- [ ] ${step}`),
      "",
      "Audit / go-live warnings:",
      ...item.auditWarnings.map((warning) => `- ${warning}`),
      "",
      "Submission steps:",
      ...item.submissionSteps.map((step) => `- [ ] ${step}`),
      "",
      "Reviewer evidence:",
      ...item.reviewerEvidence.map((evidence) => `- [ ] ${evidence}`),
      "",
      item.missingEvidence.length ? "Missing evidence:" : "Missing evidence: none",
      ...item.missingEvidence.map((evidence) => `- ${evidence}`),
      "",
      item.blockers.length ? "Blockers:" : "Blockers: none",
      ...item.blockers.map((blocker) => `- ${blocker}`),
      "",
    ]),
  ].join("\n");
}

function renderPermissionRequestPackCsv(summary: ClipperPermissionRequestPackSummary): string {
  const header = ["id", "platform", "scope", "tracker_status", "pack_status", "request_readiness", "official_verification", "developer_portal", "docs_url", "official_reference_url", "scope_request_line", "use_case", "reviewer_instructions", "platform_constraints", "official_approval_checklist", "missing_evidence", "audit_warnings", "evidence_batch_row", "evidence_recipe_row", "next_step"];
  return [
    header.map(csvEscape).join(","),
    ...summary.items.map((item) => [
      item.id,
      item.platform,
      item.scope,
      item.status,
      item.packStatus,
      item.requestReadiness,
      item.officialVerificationStatus,
      item.developerPortalUrl,
      item.docsUrl,
      item.officialReferenceUrl,
      item.scopeRequestLine,
      item.requestedUseCase,
      item.reviewerInstructions,
      item.platformConstraints.join(" | "),
      item.officialApprovalChecklist.join(" | "),
      item.missingEvidence.join(" | "),
      item.auditWarnings.join(" | "),
      item.evidenceBatchRow,
      item.evidenceRecipeRow,
      item.nextStep,
    ].map(csvEscape).join(",")),
  ].join("\n");
}

export async function prepareClipperPermissionRequestPack(userId = getSystemUserId()): Promise<{ permissionRequestPack: ClipperPermissionRequestPackSummary; status: ClipperStatus }> {
  await writeDefaultConfigIfMissing();
  await ensureClipperDirs();
  const config = await readConfig();
  const oauthConnections = await readOAuthConnections();
  const tokenRecords = await readTokenVaultRecords();
  const accounts = (Array.isArray(config.accounts) && config.accounts.length ? config.accounts : DEFAULT_ACCOUNTS).map(ensureAccountShape);
  const credentialChecks = buildCredentialChecks();
  const permissionPack = await buildPermissionPackSummary();
  const accountEvidence = await buildAccountEvidenceSummary(accounts);
  const accountLaunchKit = await buildAccountLaunchKitSummary(accounts, accountEvidence);
  const permissionTracker = await buildPermissionTrackerSummary({ accounts, credentialChecks, tokenRecords, oauthConnections, permissionPack, accountLaunchKit });
  const draftSummary = await buildPermissionRequestPackSummary(permissionTracker);
  const permissionRequestPack: ClipperPermissionRequestPackSummary = {
    ...draftSummary,
    generatedAt: new Date().toISOString(),
    status: draftSummary.totals.blocked > 0 ? "blocked" : draftSummary.totals.partial > 0 ? "partial" : "ready",
  };
  await writeFile(PERMISSION_REQUEST_PACK_PATH, JSON.stringify(permissionRequestPack, null, 2));
  await writeFile(PERMISSION_REQUEST_PACK_MARKDOWN_PATH, renderPermissionRequestPackMarkdown(permissionRequestPack));
  await writeFile(PERMISSION_REQUEST_PACK_CSV_PATH, renderPermissionRequestPackCsv(permissionRequestPack));
  return { permissionRequestPack, status: await getClipperStatus(userId) };
}

function buildPlatformReadinessItems(input: {
  credentialChecks: ClipperCredentialCheck[];
  tokenRecords: ClipperTokenVaultRecord[];
  accountLaunchKit: ClipperAccountLaunchKitSummary;
  developerAppEvidence: ClipperDeveloperAppEvidenceSummary;
  permissionTracker: ClipperPermissionTrackerSummary;
}): ClipperPlatformReadinessItem[] {
  return PLATFORM_REQUIREMENTS.map((requirement) => {
    const accountTasks = input.accountLaunchKit.tasks.filter((task) => task.platform === requirement.platform);
    const accountsVerified = accountTasks.filter((task) => task.evidenceStatus === "verified").length;
    const developerApp = input.developerAppEvidence.items.find((item) => item.platform === requirement.platform);
    const permissionItems = input.permissionTracker.items.filter((item) => item.platform === requirement.platform);
    const permissionsApproved = permissionItems.filter((item) => item.status === "approved").length;
    const credentialCheck = input.credentialChecks.find((check) => check.platform === requirement.platform);
    const tokenRecord = input.tokenRecords.find((record) => record.platform === requirement.platform);
    const accountBlockers = accountTasks.filter((task) => task.status === "blocked").length;
    const missingEnvVars = credentialCheck?.missingEnvVars || [];
    const blockers = [
      ...(accountBlockers > 0 ? [`${accountBlockers} cuentas externas sin evidencia verificada.`] : []),
      ...(developerApp?.status === "approved" ? [] : [`Developer app ${developerApp?.status || "missing"}.`]),
      ...(permissionsApproved === permissionItems.length && permissionItems.length > 0 ? [] : [`${permissionsApproved}/${permissionItems.length} permisos aprobados.`]),
      ...(credentialCheck?.status === "ready" ? [] : missingEnvVars.map((envVar) => `Falta env var ${envVar}.`)),
      ...(tokenRecord ? [] : ["Token OAuth cifrado no guardado."]),
    ];
    const status: ClipperPlatformReadinessStatus = blockers.length === 0
      ? "ready"
      : accountsVerified > 0 || developerApp?.status === "submitted" || developerApp?.status === "approved" || permissionsApproved > 0 || credentialCheck?.status === "partial" || tokenRecord
        ? "partial"
        : "blocked";

    return {
      platform: requirement.platform,
      label: requirement.label,
      status,
      accountTasks: accountTasks.length,
      accountsVerified,
      developerAppStatus: developerApp?.status || "missing",
      permissionsApproved,
      permissionsTotal: permissionItems.length,
      credentialStatus: credentialCheck?.status || "missing",
      tokenSaved: Boolean(tokenRecord),
      missingEnvVars,
      accountCreationUrl: requirement.accountCreationUrl,
      developerPortalUrl: requirement.developerPortalUrl,
      blockers,
      nextStep: status === "ready"
        ? "Plataforma lista para approval_required y pruebas controladas."
        : blockers[0] || "Resolver bloqueos de plataforma.",
    };
  });
}

async function buildPlatformReadinessSummary(input: {
  credentialChecks: ClipperCredentialCheck[];
  tokenRecords: ClipperTokenVaultRecord[];
  accountLaunchKit: ClipperAccountLaunchKitSummary;
  developerAppEvidence: ClipperDeveloperAppEvidenceSummary;
  permissionTracker: ClipperPermissionTrackerSummary;
}): Promise<ClipperPlatformReadinessSummary> {
  await ensureClipperDirs();
  const items = buildPlatformReadinessItems(input);
  const totals = items.reduce<ClipperPlatformReadinessSummary["totals"]>((sum, item) => {
    sum.platforms += 1;
    if (item.status === "ready") sum.ready += 1;
    if (item.status === "partial") sum.partial += 1;
    if (item.status === "blocked") sum.blocked += 1;
    return sum;
  }, { platforms: 0, ready: 0, partial: 0, blocked: 0 });
  const generatedAt = await stat(PLATFORM_READINESS_PATH).then((file) => file.mtime.toISOString()).catch(() => null);
  const status: ClipperPlatformReadinessStatus = totals.ready === totals.platforms && totals.platforms > 0
    ? "ready"
    : totals.partial > 0 || totals.ready > 0
      ? "partial"
      : "blocked";
  return {
    status,
    generatedAt,
    manifestPath: PLATFORM_READINESS_PATH,
    markdownPath: PLATFORM_READINESS_MARKDOWN_PATH,
    items,
    totals,
    nextStep: status === "ready"
      ? "Todas las plataformas estan listas para pruebas controladas."
      : items.find((item) => item.status !== "ready")?.nextStep || "Resolver bloqueos por plataforma.",
  };
}

function renderPlatformReadinessMarkdown(summary: ClipperPlatformReadinessSummary): string {
  return [
    "# Clippers Platform Readiness Matrix",
    "",
    `Status: ${summary.status}`,
    `Generated: ${summary.generatedAt || new Date().toISOString()}`,
    `Totals: ${summary.totals.ready} ready, ${summary.totals.partial} partial, ${summary.totals.blocked} blocked`,
    "",
    "## Platforms",
    "",
    ...summary.items.flatMap((item) => [
      `### ${item.label}`,
      "",
      `- Status: ${item.status}`,
      `- Accounts verified: ${item.accountsVerified}/${item.accountTasks}`,
      `- Developer app: ${item.developerAppStatus}`,
      `- Permissions approved: ${item.permissionsApproved}/${item.permissionsTotal}`,
      `- Credentials: ${item.credentialStatus}`,
      `- Token saved: ${item.tokenSaved ? "yes" : "no"}`,
      `- Account creation: ${item.accountCreationUrl}`,
      `- Developer portal: ${item.developerPortalUrl}`,
      `- Next step: ${item.nextStep}`,
      "",
      item.blockers.length ? "Blockers:" : "Blockers: none",
      ...item.blockers.map((blocker) => `- ${blocker}`),
      "",
    ]),
  ].join("\n");
}

export async function prepareClipperPlatformReadinessMatrix(userId = getSystemUserId()): Promise<{ platformReadiness: ClipperPlatformReadinessSummary; status: ClipperStatus }> {
  await writeDefaultConfigIfMissing();
  await ensureClipperDirs();
  const config = await readConfig();
  const oauthConnections = await readOAuthConnections();
  const tokenRecords = await readTokenVaultRecords();
  const accounts = applyOAuthStateToAccounts(
    (Array.isArray(config.accounts) && config.accounts.length ? config.accounts : DEFAULT_ACCOUNTS).map(ensureAccountShape),
    oauthConnections,
    tokenRecords
  );
  const credentialChecks = buildCredentialChecks();
  const permissionPack = await buildPermissionPackSummary();
  const accountEvidence = await buildAccountEvidenceSummary(accounts);
  const accountLaunchKit = await buildAccountLaunchKitSummary(accounts, accountEvidence);
  const developerAppEvidence = await buildDeveloperAppEvidenceSummary();
  const permissionTracker = await buildPermissionTrackerSummary({ accounts, credentialChecks, tokenRecords, oauthConnections, permissionPack, accountLaunchKit });
  const draftSummary = await buildPlatformReadinessSummary({ credentialChecks, tokenRecords, accountLaunchKit, developerAppEvidence, permissionTracker });
  const platformReadiness: ClipperPlatformReadinessSummary = {
    ...draftSummary,
    generatedAt: new Date().toISOString(),
  };
  await writeFile(PLATFORM_READINESS_PATH, JSON.stringify(platformReadiness, null, 2));
  await writeFile(PLATFORM_READINESS_MARKDOWN_PATH, renderPlatformReadinessMarkdown(platformReadiness));
  return { platformReadiness, status: await getClipperStatus(userId) };
}

function externalSetupStatusFromDone(done: boolean, hasProgress: boolean, blockers: string[]): ClipperLaunchCommandCenterStepStatus {
  if (done) return "done";
  if (hasProgress && blockers.length === 0) return "needs_action";
  return blockers.length ? "blocked" : "needs_action";
}

function externalSetupPriority(status: ClipperLaunchCommandCenterStepStatus, type: ClipperExternalSetupQueueItemType): ClipperExternalSetupQueuePriority {
  if (status === "blocked" && (type === "credential" || type === "developer_app" || type === "account")) return "critical";
  if (status === "blocked" || type === "permission" || type === "oauth") return "high";
  return "medium";
}

function externalSetupRequiredInputs(item: Pick<ClipperExternalSetupQueueItem, "type" | "platform" | "accountId" | "scopes" | "envVars">): string[] {
  if (item.type === "account") return [
    "real handle",
    "profile URL",
    "redacted screenshot/proof URL",
    "2FA/recovery-codes saved note",
    ...(item.platform === "instagram" ? ["professional account proof", "connected Facebook Page proof"] : []),
    ...(item.platform === "youtube" ? ["YouTube channel URL", "channel owner/admin proof"] : []),
  ];
  if (item.type === "developer_app") return [
    "developer app id/client id",
    "public HTTPS base URL",
    "redirect URI screenshot/proof",
    "review submission or approval proof",
    ...(item.platform === "tiktok" ? ["Content Posting API request/approval proof"] : []),
    ...(item.platform === "instagram" ? ["Instagram Graph API product proof", "app review submission/approval proof"] : []),
    ...(item.platform === "youtube" ? ["Google Cloud project id", "YouTube Data API enabled proof"] : []),
  ];
  if (item.type === "credential") return [
    ...item.envVars.map((envVar) => `${envVar} value`),
    "env file saved note",
    "Credential Doctor ready screenshot/proof",
  ];
  if (item.type === "permission") return [
    "scope name",
    "request/review URL",
    "submitted or approved proof",
    "review notes/evidence path",
  ];
  return [
    "OAuth auth URL opened from Clippers",
    "correct external account selected",
    "OAuth callback success proof",
    "encrypted token vault record proof",
  ];
}

function externalSetupDoneCriteria(item: Pick<ClipperExternalSetupQueueItem, "type" | "platform" | "scopes" | "envVars">): string[] {
  if (item.type === "account") return [
    "Account Evidence status is verified for the account/platform.",
    "2FA/recovery proof is stored without exposing secrets.",
    "Account Launch Kit no longer lists account creation blockers for this profile.",
  ];
  if (item.type === "developer_app") return [
    "Developer App Evidence status is approved or submitted with real app identifier.",
    "Public HTTPS URL and redirect URI match the developer portal.",
    "Credential Setup has the required app/client id and secret configured.",
  ];
  if (item.type === "credential") return [
    "Credential Doctor shows no missing env vars for this platform.",
    "Connect action becomes ready or token exchange is no longer blocked by credentials.",
    "No secret values are printed into reports or evidence files.",
  ];
  if (item.type === "permission") return [
    "Permission Tracker status is requested or approved for the scope.",
    "Evidence notes include the real review/request proof, not a placeholder.",
    "Publisher Connector no longer blocks on this permission after approval.",
  ];
  return [
    "OAuth callback is received for the platform.",
    "Token Vault stores an encrypted token record for the platform.",
    "Publisher Connector no longer blocks on token for ready content.",
  ];
}

function externalEvidenceRecipeRow(item: Pick<ClipperExternalSetupQueueItem, "type" | "platform" | "accountId" | "scopes">): string {
  if (item.type === "account") {
    return ["account", item.accountId, item.platform, "verified", "", "", "", "<real handle + profile URL + 2FA/recovery proof + screenshot/proof URL>"].map(csvEscape).join(",");
  }
  if (item.type === "developer_app") {
    return ["developer_app", "", item.platform, "submitted", "", "<real app/client id>", "<public https base url>", "<real redirect URI/app review proof + submission or approval note>"].map(csvEscape).join(",");
  }
  if (item.type === "permission") {
    const scope = item.scopes[0] || "";
    return ["permission", "", item.platform, "requested", scope, "", "", "<real permission request/review URL + screenshot/proof path>"].map(csvEscape).join(",");
  }
  return "";
}

function buildExternalSetupQueueItems(input: {
  accountLaunchKit: ClipperAccountLaunchKitSummary;
  developerAppEvidence: ClipperDeveloperAppEvidenceSummary;
  permissionTracker: ClipperPermissionTrackerSummary;
  credentialChecks: ClipperCredentialCheck[];
  connectActions: ClipperConnectAction[];
  tokenRecords: ClipperTokenVaultRecord[];
}): ClipperExternalSetupQueueItem[] {
  const items: ClipperExternalSetupQueueItem[] = [];

  for (const task of input.accountLaunchKit.tasks) {
    const status = task.status === "ready" ? "done" : task.status === "pending" ? "needs_action" : "blocked";
    items.push({
      id: `account-${task.id}`,
      type: "account",
      platform: task.platform,
      accountId: task.accountId,
      accountName: task.accountName,
      label: `Crear/verificar ${task.handle} en ${task.platform}`,
      status,
      priority: externalSetupPriority(status, "account"),
      portalUrl: task.accountCreationUrl,
      artifactPath: input.accountLaunchKit.markdownPath,
      evidencePath: task.evidencePath,
      envVars: [],
      scopes: [],
      checklist: task.checklist,
      requiredInputs: externalSetupRequiredInputs({ type: "account", platform: task.platform, accountId: task.accountId, scopes: [], envVars: [] }),
      doneCriteria: externalSetupDoneCriteria({ type: "account", platform: task.platform, scopes: [], envVars: [] }),
      evidenceRecipeRow: externalEvidenceRecipeRow({ type: "account", platform: task.platform, accountId: task.accountId, scopes: [] }),
      blockers: task.blockers,
      nextStep: task.nextStep,
    });
  }

  for (const requirement of PLATFORM_REQUIREMENTS) {
    const evidence = input.developerAppEvidence.items.find((item) => item.platform === requirement.platform);
    const status = externalSetupStatusFromDone(
      evidence?.status === "approved",
      evidence?.status === "submitted" || evidence?.status === "draft",
      evidence?.status === "approved" ? [] : [`Developer app ${evidence?.status || "missing"}.`]
    );
    items.push({
      id: `developer-app-${requirement.platform}`,
      type: "developer_app",
      platform: requirement.platform,
      accountId: null,
      accountName: null,
      label: `Crear/aprobar developer app de ${requirement.label}`,
      status,
      priority: externalSetupPriority(status, "developer_app"),
      portalUrl: requirement.developerPortalUrl,
      artifactPath: evidence?.evidencePath || input.developerAppEvidence.readmePath,
      evidencePath: evidence?.evidencePath || null,
      envVars: evidence?.missingEnvVars || [],
      scopes: requirement.scopes,
      checklist: [
        `Registrar redirect URI: ${evidence?.redirectUri || buildRedirectUri(requirement.platform)}`,
        "Subir screenshots del flujo approval_required.",
        "Adjuntar politica de derechos y moderacion.",
        "Guardar app id/client id y secret en env vars.",
      ],
      requiredInputs: externalSetupRequiredInputs({ type: "developer_app", platform: requirement.platform, accountId: null, scopes: requirement.scopes, envVars: evidence?.missingEnvVars || [] }),
      doneCriteria: externalSetupDoneCriteria({ type: "developer_app", platform: requirement.platform, scopes: requirement.scopes, envVars: evidence?.missingEnvVars || [] }),
      evidenceRecipeRow: externalEvidenceRecipeRow({ type: "developer_app", platform: requirement.platform, accountId: null, scopes: requirement.scopes }),
      blockers: status === "done" ? [] : [
        `Developer app ${evidence?.status || "missing"}.`,
        ...(evidence?.missingEnvVars.map((envVar) => `Falta env var ${envVar}.`) || []),
      ],
      nextStep: status === "done"
        ? "Developer app aprobada; continuar OAuth y permisos."
        : `Abrir ${requirement.developerPortalUrl} y completar app review para ${requirement.label}.`,
    });
  }

  for (const credential of input.credentialChecks) {
    const status = credential.status === "ready" ? "done" : credential.status === "partial" ? "needs_action" : "blocked";
    items.push({
      id: `credential-${credential.platform}`,
      type: "credential",
      platform: credential.platform,
      accountId: null,
      accountName: null,
      label: `Agregar credenciales OAuth de ${credential.label}`,
      status,
      priority: externalSetupPriority(status, "credential"),
      portalUrl: PLATFORM_REQUIREMENTS.find((requirement) => requirement.platform === credential.platform)?.developerPortalUrl || "",
      artifactPath: CREDENTIAL_SETUP_TEMPLATE_PATH,
      evidencePath: null,
      envVars: credential.missingEnvVars,
      scopes: PLATFORM_SCOPES[credential.platform],
      checklist: [
        "Copiar client id/app id al env file local.",
        "Copiar client secret al env file local.",
        "Recargar credenciales desde Clippers.",
        "Confirmar que el grupo quede ready.",
      ],
      requiredInputs: externalSetupRequiredInputs({ type: "credential", platform: credential.platform, accountId: null, scopes: PLATFORM_SCOPES[credential.platform], envVars: credential.missingEnvVars }),
      doneCriteria: externalSetupDoneCriteria({ type: "credential", platform: credential.platform, scopes: PLATFORM_SCOPES[credential.platform], envVars: credential.missingEnvVars }),
      evidenceRecipeRow: "",
      blockers: credential.status === "ready" ? [] : credential.missingEnvVars.map((envVar) => `Falta env var ${envVar}.`),
      nextStep: credential.nextStep,
    });
  }

  for (const permission of input.permissionTracker.items) {
    const status = permission.status === "approved" ? "done" : permission.status === "requested" || permission.status === "ready_to_request" ? "needs_action" : "blocked";
    items.push({
      id: `permission-${permission.platform}-${permission.scope}`,
      type: "permission",
      platform: permission.platform,
      accountId: null,
      accountName: null,
      label: `Solicitar permiso ${permission.scope}`,
      status,
      priority: externalSetupPriority(status, "permission"),
      portalUrl: permission.developerPortalUrl,
      artifactPath: input.permissionTracker.markdownPath,
      evidencePath: null,
      envVars: [],
      scopes: [permission.scope],
      checklist: [
        ...permission.humanSteps,
        ...permission.evidenceRequired,
        "Registrar status requested/approved en Clippers.",
      ],
      requiredInputs: externalSetupRequiredInputs({ type: "permission", platform: permission.platform, accountId: null, scopes: [permission.scope], envVars: [] }),
      doneCriteria: externalSetupDoneCriteria({ type: "permission", platform: permission.platform, scopes: [permission.scope], envVars: [] }),
      evidenceRecipeRow: externalEvidenceRecipeRow({ type: "permission", platform: permission.platform, accountId: null, scopes: [permission.scope] }),
      blockers: permission.blockers,
      nextStep: permission.nextStep,
    });
  }

  for (const requirement of PLATFORM_REQUIREMENTS) {
    const connectAction = input.connectActions.find((action) => action.platform === requirement.platform);
    const tokenRecord = input.tokenRecords.find((record) => record.platform === requirement.platform);
    const status = tokenRecord ? "done" : connectAction?.status === "ready" ? "needs_action" : "blocked";
    items.push({
      id: `oauth-${requirement.platform}`,
      type: "oauth",
      platform: requirement.platform,
      accountId: null,
      accountName: null,
      label: `Conectar OAuth y guardar token de ${requirement.label}`,
      status,
      priority: externalSetupPriority(status, "oauth"),
      portalUrl: connectAction?.authUrl || requirement.developerPortalUrl,
      artifactPath: TOKEN_VAULT_PATH,
      evidencePath: null,
      envVars: connectAction?.missingEnvVars || [],
      scopes: connectAction?.scopes || requirement.scopes,
      checklist: [
        "Abrir el boton Connect/OAuth desde Clippers.",
        "Autorizar la cuenta correcta.",
        "Confirmar que el token quede guardado cifrado.",
        "Correr automation cycle en approval_required.",
      ],
      requiredInputs: externalSetupRequiredInputs({ type: "oauth", platform: requirement.platform, accountId: null, scopes: connectAction?.scopes || requirement.scopes, envVars: connectAction?.missingEnvVars || [] }),
      doneCriteria: externalSetupDoneCriteria({ type: "oauth", platform: requirement.platform, scopes: connectAction?.scopes || requirement.scopes, envVars: connectAction?.missingEnvVars || [] }),
      evidenceRecipeRow: "",
      blockers: tokenRecord ? [] : connectAction?.missingEnvVars.map((envVar) => `Falta env var ${envVar}.`) || ["OAuth no preparado."],
      nextStep: tokenRecord ? "Token guardado; mantener rotacion y auditoria." : connectAction?.nextStep || "Completar OAuth desde Clippers.",
    });
  }

  const rank: Record<ClipperExternalSetupQueuePriority, number> = { critical: 0, high: 1, medium: 2 };
  const statusRank: Record<ClipperLaunchCommandCenterStepStatus, number> = { blocked: 0, needs_action: 1, done: 2 };
  return items.sort((a, b) => statusRank[a.status] - statusRank[b.status] || rank[a.priority] - rank[b.priority] || a.platform.localeCompare(b.platform) || a.type.localeCompare(b.type));
}

async function buildExternalSetupQueueSummary(input: {
  accountLaunchKit: ClipperAccountLaunchKitSummary;
  developerAppEvidence: ClipperDeveloperAppEvidenceSummary;
  permissionTracker: ClipperPermissionTrackerSummary;
  credentialChecks: ClipperCredentialCheck[];
  connectActions: ClipperConnectAction[];
  tokenRecords: ClipperTokenVaultRecord[];
}): Promise<ClipperExternalSetupQueueSummary> {
  await ensureClipperDirs();
  const items = buildExternalSetupQueueItems(input);
  const totals = items.reduce<ClipperExternalSetupQueueSummary["totals"]>((sum, item) => {
    sum.items += 1;
    if (item.status === "done") sum.done += 1;
    if (item.status === "needs_action") sum.needsAction += 1;
    if (item.status === "blocked") sum.blocked += 1;
    if (item.priority === "critical" && item.status !== "done") sum.critical += 1;
    return sum;
  }, { items: 0, done: 0, needsAction: 0, blocked: 0, critical: 0 });
  const generatedAt = await stat(EXTERNAL_SETUP_QUEUE_PATH).then((file) => file.mtime.toISOString()).catch(() => null);
  return {
    status: !generatedAt
      ? "not_prepared"
      : totals.done === totals.items && totals.items > 0
        ? "ready"
        : totals.done > 0 || totals.needsAction > 0
          ? "in_progress"
          : "blocked",
    generatedAt,
    manifestPath: EXTERNAL_SETUP_QUEUE_PATH,
    markdownPath: EXTERNAL_SETUP_QUEUE_MARKDOWN_PATH,
    items,
    totals,
    nextStep: items.find((item) => item.status === "blocked")?.nextStep
      || items.find((item) => item.status === "needs_action")?.nextStep
      || "External setup listo; correr OAuth, ciclo diario y QA.",
  };
}

function renderExternalSetupQueueMarkdown(summary: ClipperExternalSetupQueueSummary): string {
  return [
    "# Clippers External Setup Queue",
    "",
    `Status: ${summary.status}`,
    `Generated: ${summary.generatedAt || new Date().toISOString()}`,
    `Totals: ${summary.totals.done} done, ${summary.totals.needsAction} needs_action, ${summary.totals.blocked} blocked, ${summary.totals.critical} critical`,
    "",
    "## Next Step",
    "",
    summary.nextStep,
    "",
    "## Queue",
    "",
    ...summary.items.flatMap((item) => [
      `### ${item.label}`,
      "",
      `- Type: ${item.type}`,
      `- Platform: ${item.platform}`,
      `- Status: ${item.status}`,
      `- Priority: ${item.priority}`,
      `- Portal: ${item.portalUrl || "n/a"}`,
      `- Artifact: ${item.artifactPath || "n/a"}`,
      `- Evidence: ${item.evidencePath || "n/a"}`,
      `- Env vars: ${item.envVars.length ? item.envVars.join(", ") : "none"}`,
      `- Scopes: ${item.scopes.length ? item.scopes.join(", ") : "none"}`,
      `- Evidence recipe row: ${item.evidenceRecipeRow || "n/a"}`,
      `- Next step: ${item.nextStep}`,
      "",
      "Required inputs:",
      ...(item.requiredInputs.length ? item.requiredInputs.map((input) => `- [ ] ${input}`) : ["- none"]),
      "",
      "Done criteria:",
      ...(item.doneCriteria.length ? item.doneCriteria.map((criterion) => `- [ ] ${criterion}`) : ["- none"]),
      "",
      "Checklist:",
      ...item.checklist.map((step) => `- [ ] ${step}`),
      "",
      item.blockers.length ? "Blockers:" : "Blockers: none",
      ...item.blockers.map((blocker) => `- ${blocker}`),
      "",
    ]),
  ].join("\n");
}

export async function prepareClipperExternalSetupQueue(userId = getSystemUserId()): Promise<{ externalSetupQueue: ClipperExternalSetupQueueSummary; status: ClipperStatus }> {
  await writeDefaultConfigIfMissing();
  await ensureClipperDirs();
  const config = await readConfig();
  const oauthConnections = await readOAuthConnections();
  const tokenRecords = await readTokenVaultRecords();
  const accounts = applyOAuthStateToAccounts(
    (Array.isArray(config.accounts) && config.accounts.length ? config.accounts : DEFAULT_ACCOUNTS).map(ensureAccountShape),
    oauthConnections,
    tokenRecords
  );
  const credentialChecks = buildCredentialChecks();
  const connectActions = buildClipperConnectActions();
  const permissionPack = await buildPermissionPackSummary();
  const accountEvidence = await buildAccountEvidenceSummary(accounts);
  const accountLaunchKit = await buildAccountLaunchKitSummary(accounts, accountEvidence);
  const developerAppEvidence = await buildDeveloperAppEvidenceSummary();
  const permissionTracker = await buildPermissionTrackerSummary({ accounts, credentialChecks, tokenRecords, oauthConnections, permissionPack, accountLaunchKit });
  const draftSummary = await buildExternalSetupQueueSummary({ accountLaunchKit, developerAppEvidence, permissionTracker, credentialChecks, connectActions, tokenRecords });
  const externalSetupQueue: ClipperExternalSetupQueueSummary = {
    ...draftSummary,
    generatedAt: new Date().toISOString(),
    status: draftSummary.totals.done === draftSummary.totals.items && draftSummary.totals.items > 0
      ? "ready"
      : draftSummary.totals.done > 0 || draftSummary.totals.needsAction > 0
        ? "in_progress"
        : "blocked",
  };
  await writeFile(EXTERNAL_SETUP_QUEUE_PATH, JSON.stringify(externalSetupQueue, null, 2));
  await writeFile(EXTERNAL_SETUP_QUEUE_MARKDOWN_PATH, renderExternalSetupQueueMarkdown(externalSetupQueue));
  return { externalSetupQueue, status: await getClipperStatus(userId) };
}

function externalEvidenceBatchRow(item: ClipperExternalSetupQueueItem): string {
  if (item.type === "account") {
    return ["account", item.accountId, item.platform, "verified", "", "", "", ""].map(csvEscape).join(",");
  }
  if (item.type === "developer_app") {
    return ["developer_app", "", item.platform, "submitted", "", "", "", ""].map(csvEscape).join(",");
  }
  if (item.type === "permission") {
    const scope = item.scopes[0] || "";
    return ["permission", "", item.platform, "requested", scope, "", "", ""].map(csvEscape).join(",");
  }
  return "";
}

function isLaunchEvidenceBatchImportable(item: ClipperExternalSetupQueueItem | ClipperExternalExecutionHandoffItem): boolean {
  return item.type === "account" || item.type === "developer_app" || item.type === "permission";
}

function externalEvidenceTemplate(item: ClipperExternalSetupQueueItem): string {
  if (item.type === "account") return "Complete notes with real handle, profile URL, 2FA saved note, and screenshot/proof link.";
  if (item.type === "developer_app") return "Complete app_identifier, public_base_url and notes with real developer-app review evidence.";
  if (item.type === "permission") return "Complete notes with the real permission request/review URL, email, screenshot path, or approval note.";
  if (item.type === "credential") return "Paste missing env vars in Credential Setup batch, then reload keys.";
  return "Complete OAuth from Clippers after credentials and app review are ready; token is stored encrypted.";
}

async function buildExternalExecutionHandoffSummary(input: {
  externalSetupQueue: ClipperExternalSetupQueueSummary;
  goLiveAutopilotBrief: ClipperGoLiveAutopilotBriefSummary;
}): Promise<ClipperExternalExecutionHandoffSummary> {
  const queueItems = input.externalSetupQueue.items.filter((item) => item.status !== "done");
  const items = queueItems.map<ClipperExternalExecutionHandoffItem>((item, index) => ({
    id: `handoff-${item.id}`,
    rank: index + 1,
    type: item.type,
    platform: item.platform,
    label: item.label,
    priority: item.priority,
    portalUrl: item.portalUrl,
    status: item.status,
    evidenceBatchRow: externalEvidenceBatchRow(item),
    evidenceTemplate: externalEvidenceTemplate(item),
    envVars: item.envVars,
    scopes: item.scopes,
    checklist: item.checklist,
    blockers: item.blockers,
    nextStep: item.nextStep,
    unblockCondition: item.type === "credential"
      ? "Credential Doctor shows the platform env group as ready."
      : item.type === "oauth"
        ? "Token Vault has an encrypted token record for the platform."
        : "Paste the evidence row in Launch Evidence Batch and regenerate Command Center.",
  }));
  const totals = items.reduce<ClipperExternalExecutionHandoffSummary["totals"]>((sum, item) => {
    sum.items += 1;
    if (item.type === "account") sum.accounts += 1;
    if (item.type === "developer_app") sum.developerApps += 1;
    if (item.type === "credential") sum.credentials += 1;
    if (item.type === "permission") sum.permissions += 1;
    if (item.type === "oauth") sum.oauth += 1;
    if (item.priority === "critical") sum.critical += 1;
    if (item.status === "blocked") sum.blocked += 1;
    return sum;
  }, { items: 0, accounts: 0, developerApps: 0, credentials: 0, permissions: 0, oauth: 0, critical: 0, blocked: 0 });
  const evidenceBatchRows = items
    .filter(isLaunchEvidenceBatchImportable)
    .map((item) => item.evidenceBatchRow)
    .filter(Boolean);
  const evidenceBatchTemplate = [
    "kind,account_id,platform,status,scope,app_identifier,public_base_url,notes",
    ...evidenceBatchRows,
    "",
  ].join("\n");
  const generatedAt = await stat(EXTERNAL_EXECUTION_HANDOFF_PATH).then((file) => file.mtime.toISOString()).catch(() => null);
  return {
    status: !generatedAt
      ? "not_prepared"
      : totals.items === 0
        ? "ready"
        : totals.blocked > 0 || totals.critical > 0
          ? "blocked"
          : "in_progress",
    generatedAt,
    manifestPath: EXTERNAL_EXECUTION_HANDOFF_PATH,
    markdownPath: EXTERNAL_EXECUTION_HANDOFF_MARKDOWN_PATH,
    csvPath: EXTERNAL_EXECUTION_HANDOFF_CSV_PATH,
    batchTemplatePath: EXTERNAL_EXECUTION_HANDOFF_BATCH_PATH,
    items,
    evidenceBatchTemplate,
    totals,
    nextStep: items[0]?.nextStep || input.goLiveAutopilotBrief.nextStep || "External setup complete; run OAuth, dry-run and reporting.",
  };
}

function renderExternalExecutionHandoffMarkdown(summary: ClipperExternalExecutionHandoffSummary): string {
  return [
    "# Clippers External Execution Handoff",
    "",
    `Status: ${summary.status}`,
    `Generated: ${summary.generatedAt || new Date().toISOString()}`,
    `Totals: ${summary.totals.items} items, ${summary.totals.critical} critical, ${summary.totals.blocked} blocked`,
    `CSV: ${summary.csvPath}`,
    `Evidence batch: ${summary.batchTemplatePath}`,
    "",
    "## Next Step",
    "",
    summary.nextStep,
    "",
    "## Launch Evidence Batch Template",
    "",
    "Paste this CSV in Launch Evidence Batch after completing blank required fields with real evidence. Credential secrets and OAuth tokens are intentionally excluded from this batch; use Credential Setup and OAuth Connect for those.",
    "",
    "```csv",
    summary.evidenceBatchTemplate.trim(),
    "```",
    "",
    "## External Items",
    "",
    ...summary.items.flatMap((item) => [
      `### ${item.rank}. ${item.label}`,
      "",
      `- Type: ${item.type}`,
      `- Platform: ${item.platform}`,
      `- Priority: ${item.priority}`,
      `- Status: ${item.status}`,
      `- Portal: ${item.portalUrl || "n/a"}`,
      `- Env vars: ${item.envVars.length ? item.envVars.join(", ") : "none"}`,
      `- Scopes: ${item.scopes.length ? item.scopes.join(", ") : "none"}`,
      `- Evidence template: ${item.evidenceTemplate}`,
      `- Unblock condition: ${item.unblockCondition}`,
      `- Next step: ${item.nextStep}`,
      "",
      "Checklist:",
      ...item.checklist.map((step) => `- [ ] ${step}`),
      "",
      item.blockers.length ? "Blockers:" : "Blockers: none",
      ...item.blockers.map((blocker) => `- ${blocker}`),
      "",
    ]),
  ].join("\n");
}

function renderExternalExecutionHandoffCsv(summary: ClipperExternalExecutionHandoffSummary): string {
  const header = ["rank", "id", "type", "platform", "priority", "status", "portal_url", "env_vars", "scopes", "next_step", "unblock_condition", "evidence_template"];
  return [
    header.map(csvEscape).join(","),
    ...summary.items.map((item) => [
      item.rank,
      item.id,
      item.type,
      item.platform,
      item.priority,
      item.status,
      item.portalUrl,
      item.envVars.join(" "),
      item.scopes.join(" "),
      item.nextStep,
      item.unblockCondition,
      item.evidenceTemplate,
    ].map(csvEscape).join(",")),
    "",
  ].join("\n");
}

function externalSessionLane(item: ClipperExternalExecutionHandoffItem): ClipperExternalExecutionSessionLane {
  if (item.type === "credential") return "do_now";
  if (isLaunchEvidenceBatchImportable(item) && item.evidenceBatchRow) return "do_now";
  if (item.type === "oauth") return item.status === "blocked" ? "blocked" : "do_now";
  if (item.status === "blocked") return "blocked";
  if (item.status === "needs_action") return "do_now";
  return "waiting";
}

function externalSessionLaneReason(item: ClipperExternalExecutionHandoffItem): string {
  const lane = externalSessionLane(item);
  if (lane === "do_now" && item.type === "credential") return "Missing env vars can be pasted now in Credential Setup.";
  if (lane === "do_now" && isLaunchEvidenceBatchImportable(item)) return "External task can be completed now and imported through Launch Evidence Batch.";
  if (lane === "do_now" && item.type === "oauth") return "OAuth can be connected after credentials and permissions are ready.";
  if (lane === "blocked" && item.type === "oauth") return "OAuth waits for credentials, developer app evidence, permissions and account evidence.";
  if (lane === "blocked") return item.blockers[0] || item.nextStep;
  return "Waiting for upstream launch evidence or platform approval.";
}

function externalSessionActionMode(item: ClipperExternalExecutionHandoffItem): ClipperExternalExecutionSessionItem["actionMode"] {
  if (item.type === "credential") return "paste_env";
  if (item.type === "oauth") return "connect_oauth";
  if (item.evidenceBatchRow) return "paste_evidence";
  return "open_portal";
}

function externalSessionExecutionUrl(item: ClipperExternalExecutionHandoffItem): string {
  if (item.type === "credential") return "/clippers#credential-setup";
  if (item.type === "oauth") return "/clippers#oauth-connect";
  if (item.evidenceBatchRow) return "/clippers#launch-evidence-batch";
  return item.portalUrl;
}

function externalSessionEvidenceRecipeRow(item: ClipperExternalExecutionHandoffItem): string {
  if (item.type === "account") {
    return ["account", item.id.replace(/^handoff-account-/, "").replace(/-(tiktok|instagram|youtube)$/, ""), item.platform, "verified", "", "", "", "<real handle + profile URL + 2FA/security proof + screenshot/proof URL>"].map(csvEscape).join(",");
  }
  if (item.type === "developer_app") {
    return ["developer_app", "", item.platform, "submitted", "", "<developer app id/client key/project id>", "<public HTTPS base URL>", "<developer app review/submission evidence URL or screenshot note>"].map(csvEscape).join(",");
  }
  if (item.type === "permission") {
    const scope = item.scopes[0] || "";
    return ["permission", "", item.platform, "requested", scope, "", "", "<permission request/review URL, ticket, email or approval screenshot>"].map(csvEscape).join(",");
  }
  return "";
}

function externalCredentialTemplate(item: ClipperExternalExecutionHandoffItem): string {
  if (item.type !== "credential" || !item.envVars.length) return "";
  return [
    `# ${item.label}`,
    ...item.envVars.map((envVar) => `${envVar}=`),
  ].join("\n");
}

function externalSessionRequiredInputs(item: ClipperExternalExecutionHandoffItem): string[] {
  if (item.type === "account") {
    return [
      "real handle",
      "profile URL",
      "verification or 2FA proof note",
      "screenshot/proof path or URL",
    ];
  }
  if (item.type === "developer_app") {
    return [
      "developer app identifier",
      "public HTTPS base URL",
      "review/submission status",
      "review evidence note or screenshot path",
    ];
  }
  if (item.type === "permission") {
    return [
      "scope requested or approved",
      "portal request/review URL",
      "review ticket/email/screenshot proof",
    ];
  }
  if (item.type === "credential") {
    return item.envVars.map((envVar) => `${envVar} value`);
  }
  if (item.type === "oauth") {
    return [
      "configured OAuth app credentials",
      "approved scopes",
      "successful OAuth callback",
    ];
  }
  return [];
}

function externalSessionCompletionHint(item: ClipperExternalExecutionHandoffItem): string {
  if (item.type === "account") return "Complete the platform signup, switch to the required professional/channel type, enable 2FA, then paste a completed account evidence row.";
  if (item.type === "developer_app") return "Create or update the developer app, add the production URL/redirect URIs, then paste app evidence with the real app identifier.";
  if (item.type === "permission") return "Request the listed scope in the official developer portal and paste the real review ticket, approval, email, or screenshot note.";
  if (item.type === "credential") return "Paste the missing env values in Credential Setup, preview the batch, import it, then reload keys.";
  if (item.type === "oauth") return "After credentials and scopes are ready, use the OAuth connect action from Clippers so the token vault stores the callback securely.";
  return item.nextStep;
}

function externalQueueUnlockInputs(item: ClipperExternalSetupQueueItem): string[] {
  if (item.type === "account") {
    return [
      `${item.platform}: real handle/profile URL`,
      `${item.platform}: 2FA or verification proof`,
    ];
  }
  if (item.type === "developer_app") {
    return [
      `${item.platform}: developer app id`,
      `${item.platform}: public HTTPS base URL`,
      `${item.platform}: app review/submission evidence`,
    ];
  }
  if (item.type === "permission") {
    return item.scopes.length
      ? item.scopes.map((scope) => `${item.platform}: ${scope} review evidence`)
      : [`${item.platform}: permission review evidence`];
  }
  if (item.type === "credential") {
    return item.envVars.map((envVar) => `${envVar}=`);
  }
  if (item.type === "oauth") {
    return [
      `${item.platform}: successful OAuth callback`,
      `${item.platform}: approved token scopes`,
    ];
  }
  return [];
}

function cleanPermissionEvidenceBatchRow(platform: ClipperPlatform, scope: string): string {
  return ["permission", "", platform, "requested", scope, "", "", ""].map(csvEscape).join(",");
}

function externalPermissionUnlocks(
  platform: ClipperPlatform,
  officialPermissionMatrix: ClipperOfficialPermissionMatrixSummary
): ClipperExternalLaunchDossierPlatform["permissionUnlocks"] {
  const official = officialPermissionMatrix.items.find((item) => item.platform === platform);
  if (!official) return [];
  return official.scopes.map((scope) => ({
    scope: scope.scope,
    requestPortalUrl: scope.requestPortalUrl,
    requestAction: scope.requestAction,
    requiredForAutopost: scope.requiredForAutopost,
    appReviewRequired: scope.appReviewRequired,
    evidenceRequired: scope.evidenceRequired,
    evidenceBatchRow: cleanPermissionEvidenceBatchRow(platform, scope.scope),
  }));
}

function renderLaunchEvidenceImportTemplate(rows: string[]): string {
  return [
    "kind,account_id,platform,status,scope,app_identifier,public_base_url,notes",
    ...rows,
    "",
  ].join("\n");
}

function buildExternalExecutionUnlockBoard(items: ClipperExternalExecutionSessionItem[]): ClipperExternalExecutionUnlockBoardItem[] {
  return (["tiktok", "instagram", "youtube"] as ClipperPlatform[]).map((platform) => {
    const platformItems = items.filter((item) => item.platform === platform);
    const evidenceRows = platformItems.map((item) => item.evidenceBatchRow || item.evidenceRecipeRow).filter(Boolean);
    const portalUrls = Array.from(new Set(platformItems.map((item) => item.portalUrl).filter(Boolean)));
    return {
      platform,
      total: platformItems.length,
      doNow: platformItems.filter((item) => item.lane === "do_now").length,
      blocked: platformItems.filter((item) => item.lane === "blocked").length,
      waiting: platformItems.filter((item) => item.lane === "waiting").length,
      evidenceRows: evidenceRows.length,
      credentialTemplates: platformItems.filter((item) => item.credentialTemplate).length,
      nextEvidenceRows: evidenceRows.slice(0, 5),
      portalUrls: portalUrls.slice(0, 5),
      nextStep: platformItems.find((item) => item.lane === "do_now")?.nextStep
        || platformItems.find((item) => item.lane === "blocked")?.nextStep
        || platformItems[0]?.nextStep
        || "No external execution items pending for this platform.",
    };
  });
}

function externalPortalBatchLabel(platform: ClipperPlatform, type: ClipperExternalSetupQueueItemType): string {
  const typeLabel: Record<ClipperExternalSetupQueueItemType, string> = {
    account: "Accounts",
    credential: "Credentials",
    developer_app: "Developer app",
    permission: "Permissions",
    oauth: "OAuth",
  };
  return `${platform} ${typeLabel[type]}`;
}

function externalPortalBatchChecklist(type: ClipperExternalSetupQueueItemType): string[] {
  if (type === "account") {
    return [
      "Open the signup/login portal in the correct browser profile.",
      "Create or claim the handle and apply Account Identity Kit copy.",
      "Complete email/phone verification, professional/channel settings and 2FA.",
      "Capture redacted evidence and paste the completed account row into Launch Evidence Batch.",
    ];
  }
  if (type === "credential") {
    return [
      "Paste secrets only through Credential Setup or env files.",
      "Reload credentials after import.",
      "Run Credential Doctor and confirm the platform group moved to ready or partial.",
    ];
  }
  if (type === "developer_app") {
    return [
      "Open the developer portal and create or update the production app.",
      "Register production URL, redirect URIs, privacy URL, terms URL and demo URL.",
      "Capture app identifier/submission proof and import the developer_app evidence row.",
    ];
  }
  if (type === "permission") {
    return [
      "Open the official app review or permission screen.",
      "Paste the prepared scope justification and attach required screenshots/screencast.",
      "Record requested or approved status with the real review URL/ticket/screenshot note.",
    ];
  }
  return [
    "Confirm credentials, account evidence, developer app and permissions are ready.",
    "Use the Clippers OAuth connect action for the platform.",
    "Confirm the encrypted token appears in the token vault before enabling publishing.",
  ];
}

function externalPortalBatchStatus(items: ClipperExternalExecutionSessionItem[]): ClipperExternalExecutionHandoffStatus {
  if (items.length === 0) return "ready";
  if (items.some((item) => item.lane === "do_now")) return "in_progress";
  if (items.some((item) => item.lane === "blocked")) return "blocked";
  return "in_progress";
}

function buildExternalExecutionPortalBatches(items: ClipperExternalExecutionSessionItem[]): ClipperExternalExecutionPortalBatch[] {
  const groups = new Map<string, ClipperExternalExecutionSessionItem[]>();
  for (const item of items) {
    const key = `${item.platform}:${item.type}`;
    groups.set(key, [...(groups.get(key) || []), item]);
  }
  return Array.from(groups.entries()).map(([key, group]) => {
    const [platformRaw, typeRaw] = key.split(":");
    const platform = platformRaw as ClipperPlatform;
    const type = typeRaw as ClipperExternalSetupQueueItemType;
    const sorted = [...group].sort((a, b) => a.rank - b.rank);
    const evidenceRows = sorted
      .map((item) => item.evidenceBatchRow || item.evidenceRecipeRow)
      .filter(Boolean);
    const credentialTemplates = sorted
      .map((item) => item.credentialTemplate)
      .filter(Boolean);
    const portalUrls = Array.from(new Set(sorted.map((item) => item.portalUrl).filter(Boolean)));
    const executionUrls = Array.from(new Set(sorted.map((item) => item.executionUrl).filter(Boolean)));
    return {
      id: `portal-batch-${platform}-${type}`,
      platform,
      type,
      label: externalPortalBatchLabel(platform, type),
      status: externalPortalBatchStatus(sorted),
      total: sorted.length,
      doNow: sorted.filter((item) => item.lane === "do_now").length,
      blocked: sorted.filter((item) => item.lane === "blocked").length,
      waiting: sorted.filter((item) => item.lane === "waiting").length,
      portalUrls,
      executionUrls,
      evidenceRows,
      credentialTemplates,
      firstItemRank: sorted[0]?.rank || 0,
      nextStep: sorted.find((item) => item.lane === "do_now")?.nextStep
        || sorted.find((item) => item.lane === "blocked")?.nextStep
        || sorted[0]?.nextStep
        || "No action pending.",
      operatorChecklist: externalPortalBatchChecklist(type),
      importTemplate: evidenceRows.length ? renderLaunchEvidenceImportTemplate(evidenceRows) : "",
    };
  }).sort((a, b) => {
    const platformRank: Record<ClipperPlatform, number> = { instagram: 0, tiktok: 1, youtube: 2 };
    const typeRank: Record<ClipperExternalSetupQueueItemType, number> = {
      credential: 0,
      account: 1,
      developer_app: 2,
      permission: 3,
      oauth: 4,
    };
    return platformRank[a.platform] - platformRank[b.platform]
      || typeRank[a.type] - typeRank[b.type]
      || a.firstItemRank - b.firstItemRank;
  });
}

async function buildExternalExecutionSessionSummary(input: {
  externalExecutionHandoff: ClipperExternalExecutionHandoffSummary;
}): Promise<ClipperExternalExecutionSessionSummary> {
  const sorted = [...input.externalExecutionHandoff.items].sort((a, b) => {
    const laneRank: Record<ClipperExternalExecutionSessionLane, number> = { do_now: 0, blocked: 1, waiting: 2 };
    return laneRank[externalSessionLane(a)] - laneRank[externalSessionLane(b)] || a.rank - b.rank;
  });
  const items = sorted.map<ClipperExternalExecutionSessionItem>((item, index) => ({
    id: `session-${item.id}`,
    rank: index + 1,
    lane: externalSessionLane(item),
    laneReason: externalSessionLaneReason(item),
    type: item.type,
    platform: item.platform,
    label: item.label,
    portalUrl: item.portalUrl,
    executionUrl: externalSessionExecutionUrl(item),
    status: item.status,
    actionMode: externalSessionActionMode(item),
    evidenceBatchRow: item.evidenceBatchRow,
    evidenceRecipeRow: externalSessionEvidenceRecipeRow(item),
    evidenceImportReady: isLaunchEvidenceBatchImportable(item),
    credentialTemplate: externalCredentialTemplate(item),
    requiredInputs: externalSessionRequiredInputs(item),
    completionHint: externalSessionCompletionHint(item),
    nextStep: item.nextStep,
    blockers: item.blockers,
  }));
  const importableEvidenceRows = items
    .filter((item) => item.evidenceImportReady)
    .map((item) => item.evidenceBatchRow)
    .filter(Boolean);
  const evidenceImportTemplate = renderLaunchEvidenceImportTemplate(importableEvidenceRows);
  const unlockBoard = buildExternalExecutionUnlockBoard(items);
  const portalBatches = buildExternalExecutionPortalBatches(items);
  const totals = items.reduce<ClipperExternalExecutionSessionSummary["totals"]>((sum, item) => {
    sum.items += 1;
    if (item.lane === "do_now") sum.doNow += 1;
    if (item.lane === "blocked") sum.blocked += 1;
    if (item.lane === "waiting") sum.waiting += 1;
    if (item.evidenceBatchRow) sum.evidenceRows += 1;
    if (item.credentialTemplate) sum.envTemplates += 1;
    if (item.evidenceImportReady && item.evidenceBatchRow) sum.importableEvidenceRows += 1;
    return sum;
  }, { items: 0, doNow: 0, blocked: 0, waiting: 0, evidenceRows: 0, envTemplates: 0, importableEvidenceRows: 0, portalBatches: 0 });
  totals.portalBatches = portalBatches.length;
  const generatedAt = await stat(EXTERNAL_EXECUTION_SESSION_PATH).then((file) => file.mtime.toISOString()).catch(() => null);
  return {
    status: !generatedAt
      ? "not_prepared"
      : totals.items === 0
        ? "ready"
        : totals.doNow > 0
          ? "in_progress"
          : "blocked",
    generatedAt,
    manifestPath: EXTERNAL_EXECUTION_SESSION_PATH,
    markdownPath: EXTERNAL_EXECUTION_SESSION_MARKDOWN_PATH,
    csvPath: EXTERNAL_EXECUTION_SESSION_CSV_PATH,
    evidenceImportPath: EXTERNAL_EXECUTION_SESSION_EVIDENCE_PATH,
    evidenceImportTemplate,
    items,
    unlockBoard,
    portalBatches,
    totals,
    nextStep: items.find((item) => item.lane === "do_now")?.nextStep
      || items.find((item) => item.lane === "blocked")?.nextStep
      || input.externalExecutionHandoff.nextStep,
  };
}

function renderExternalExecutionSessionMarkdown(summary: ClipperExternalExecutionSessionSummary): string {
  return [
    "# Clippers External Execution Session",
    "",
    `Status: ${summary.status}`,
    `Generated: ${summary.generatedAt || new Date().toISOString()}`,
    `Totals: ${summary.totals.doNow} do_now, ${summary.totals.blocked} blocked, ${summary.totals.waiting} waiting`,
    `CSV: ${summary.csvPath}`,
    `Evidence import CSV: ${summary.evidenceImportPath}`,
    "",
    "## Next Step",
    "",
    summary.nextStep,
    "",
    "## Launch Evidence Import",
    "",
    "Complete the blank fields with real evidence before importing. Credential secrets and OAuth tokens are intentionally excluded.",
    "",
    "```csv",
    summary.evidenceImportTemplate.trim(),
    "```",
    "",
    "## Unlock Board",
    "",
    ...summary.unlockBoard.flatMap((item) => [
      `### ${item.platform}`,
      "",
      `- Items: ${item.total}`,
      `- Do now: ${item.doNow}`,
      `- Blocked: ${item.blocked}`,
      `- Waiting: ${item.waiting}`,
      `- Evidence rows: ${item.evidenceRows}`,
      `- Credential templates: ${item.credentialTemplates}`,
      `- Next step: ${item.nextStep}`,
      item.portalUrls.length ? "- Portals:" : "- Portals: none",
      ...item.portalUrls.map((url) => `  - ${url}`),
      item.nextEvidenceRows.length ? "- Next evidence rows:" : "- Next evidence rows: none",
      ...item.nextEvidenceRows.map((row) => `  - ${row}`),
      "",
    ]),
    "",
    "## Session Items",
    "",
    ...summary.items.flatMap((item) => [
      `### ${item.rank}. ${item.label}`,
      "",
      `- Lane: ${item.lane}`,
      `- Lane reason: ${item.laneReason}`,
      `- Type: ${item.type}`,
      `- Platform: ${item.platform}`,
      `- Action mode: ${item.actionMode}`,
      `- Portal: ${item.portalUrl || "n/a"}`,
      `- Execution URL: ${item.executionUrl || "n/a"}`,
      `- Evidence import ready: ${item.evidenceImportReady ? "yes" : "no"}`,
      `- Status: ${item.status}`,
      `- Next step: ${item.nextStep}`,
      `- Completion hint: ${item.completionHint}`,
      item.evidenceBatchRow ? `- Evidence row: ${item.evidenceBatchRow}` : "- Evidence row: n/a",
      item.evidenceRecipeRow ? `- Evidence recipe row: ${item.evidenceRecipeRow}` : "- Evidence recipe row: n/a",
      item.credentialTemplate ? `- Credential template: ${item.credentialTemplate.replace(/\n/g, " | ")}` : "- Credential template: n/a",
      item.requiredInputs.length ? "- Required inputs:" : "- Required inputs: none",
      ...item.requiredInputs.map((input) => `  - ${input}`),
      item.blockers.length ? "- Blockers:" : "- Blockers: none",
      ...item.blockers.map((blocker) => `  - ${blocker}`),
      "",
    ]),
  ].join("\n");
}

function renderExternalExecutionSessionCsv(summary: ClipperExternalExecutionSessionSummary): string {
  const header = ["rank", "id", "lane", "lane_reason", "type", "platform", "action_mode", "status", "portal_url", "execution_url", "evidence_import_ready", "next_step", "completion_hint", "required_inputs", "evidence_batch_row", "evidence_recipe_row", "credential_template", "blockers"];
  return [
    header.map(csvEscape).join(","),
    ...summary.items.map((item) => [
      item.rank,
      item.id,
      item.lane,
      item.laneReason,
      item.type,
      item.platform,
      item.actionMode,
      item.status,
      item.portalUrl,
      item.executionUrl,
      item.evidenceImportReady ? "yes" : "no",
      item.nextStep,
      item.completionHint,
      item.requiredInputs.join(" | "),
      item.evidenceBatchRow,
      item.evidenceRecipeRow,
      item.credentialTemplate,
      item.blockers.join(" | "),
    ].map(csvEscape).join(",")),
    "",
  ].join("\n");
}

export async function prepareClipperExternalExecutionHandoff(userId = getSystemUserId()): Promise<{ externalExecutionHandoff: ClipperExternalExecutionHandoffSummary; status: ClipperStatus }> {
  await writeDefaultConfigIfMissing();
  await ensureClipperDirs();
  const statusBefore = await getClipperStatus(userId);
  const draftSummary = await buildExternalExecutionHandoffSummary({
    externalSetupQueue: statusBefore.externalSetupQueue,
    goLiveAutopilotBrief: statusBefore.goLiveAutopilotBrief,
  });
  const externalExecutionHandoff: ClipperExternalExecutionHandoffSummary = {
    ...draftSummary,
    generatedAt: new Date().toISOString(),
    status: draftSummary.totals.items === 0
      ? "ready"
      : draftSummary.totals.blocked > 0 || draftSummary.totals.critical > 0
        ? "blocked"
        : "in_progress",
  };
  await writeFile(EXTERNAL_EXECUTION_HANDOFF_PATH, JSON.stringify(externalExecutionHandoff, null, 2));
  await writeFile(EXTERNAL_EXECUTION_HANDOFF_MARKDOWN_PATH, renderExternalExecutionHandoffMarkdown(externalExecutionHandoff));
  await writeFile(EXTERNAL_EXECUTION_HANDOFF_CSV_PATH, renderExternalExecutionHandoffCsv(externalExecutionHandoff));
  await writeFile(EXTERNAL_EXECUTION_HANDOFF_BATCH_PATH, externalExecutionHandoff.evidenceBatchTemplate);
  return { externalExecutionHandoff, status: await getClipperStatus(userId) };
}

export async function prepareClipperExternalExecutionSession(userId = getSystemUserId()): Promise<{ externalExecutionSession: ClipperExternalExecutionSessionSummary; status: ClipperStatus }> {
  await writeDefaultConfigIfMissing();
  await ensureClipperDirs();
  const { externalExecutionHandoff } = await prepareClipperExternalExecutionHandoff(userId);
  const draftSummary = await buildExternalExecutionSessionSummary({ externalExecutionHandoff });
  const externalExecutionSession: ClipperExternalExecutionSessionSummary = {
    ...draftSummary,
    generatedAt: new Date().toISOString(),
    status: draftSummary.totals.items === 0
      ? "ready"
      : draftSummary.totals.doNow > 0
        ? "in_progress"
        : "blocked",
  };
  await writeFile(EXTERNAL_EXECUTION_SESSION_PATH, JSON.stringify(externalExecutionSession, null, 2));
  await writeFile(EXTERNAL_EXECUTION_SESSION_MARKDOWN_PATH, renderExternalExecutionSessionMarkdown(externalExecutionSession));
  await writeFile(EXTERNAL_EXECUTION_SESSION_CSV_PATH, renderExternalExecutionSessionCsv(externalExecutionSession));
  await writeFile(EXTERNAL_EXECUTION_SESSION_EVIDENCE_PATH, externalExecutionSession.evidenceImportTemplate);
  return { externalExecutionSession, status: await getClipperStatus(userId) };
}

async function buildExternalLaunchDossierSummary(input: {
  accountLaunchKit: ClipperAccountLaunchKitSummary;
  developerAppEvidence: ClipperDeveloperAppEvidenceSummary;
  permissionTracker: ClipperPermissionTrackerSummary;
  credentialSetup: ClipperCredentialSetupSummary;
  externalSetupQueue: ClipperExternalSetupQueueSummary;
  oauthGoLive: ClipperOAuthGoLiveSummary;
  publisherConnectors: ClipperPublisherConnectorSummary;
  officialPermissionMatrix: ClipperOfficialPermissionMatrixSummary;
}): Promise<ClipperExternalLaunchDossierSummary> {
  await ensureClipperDirs();
  const platforms = (["tiktok", "instagram", "youtube"] as ClipperPlatform[]).map<ClipperExternalLaunchDossierPlatform>((platform) => {
    const requirement = PLATFORM_REQUIREMENTS.find((item) => item.platform === platform)!;
    const accountTasks = input.accountLaunchKit.tasks.filter((task) => task.platform === platform);
    const developerApp = input.developerAppEvidence.items.find((item) => item.platform === platform);
    const credential = input.credentialSetup.items.find((item) =>
      item.id.includes(platform) ||
      (platform === "instagram" && item.id.includes("meta")) ||
      (platform === "youtube" && item.id.includes("google"))
    );
    const permissions = input.permissionTracker.items.filter((item) => item.platform === platform);
    const oauth = input.oauthGoLive.items.find((item) => item.platform === platform);
    const connector = input.publisherConnectors.items.find((item) => item.platform === platform);
    const queueItems = input.externalSetupQueue.items.filter((item) => item.platform === platform && item.status !== "done");
    const unlockInputs = Array.from(new Set(queueItems.flatMap(externalQueueUnlockInputs))).slice(0, 12);
    const sessionNextSteps = Array.from(new Set(queueItems.map((item) => item.nextStep).filter(Boolean))).slice(0, 6);
    const permissionUnlocks = externalPermissionUnlocks(platform, input.officialPermissionMatrix);
    const criticalActions = [
      ...queueItems.filter((item) => item.priority === "critical").map((item) => item.nextStep),
      ...queueItems.filter((item) => item.priority !== "critical").slice(0, 3).map((item) => item.nextStep),
    ].filter((item, index, list) => item && list.indexOf(item) === index);
    const accountTasksDone = accountTasks.filter((task) => task.status === "ready").length;
    const permissionsApproved = permissions.filter((item) => item.status === "approved").length;
    const blocked = criticalActions.length > 0 || oauth?.status === "blocked" || !developerApp || credential?.status === "missing";
    const inProgress = accountTasksDone > 0 || developerApp || credential?.status === "partial" || credential?.status === "ready" || permissionsApproved > 0 || oauth?.status === "partial";
    const status: ClipperExternalLaunchDossierStatus = blocked
      ? inProgress ? "in_progress" : "blocked"
      : "ready";
    return {
      platform,
      label: requirement.label,
      status,
      accountTasks: accountTasks.length,
      accountTasksDone,
      developerAppStatus: developerApp?.status || "missing",
      credentialStatus: credential?.status || "missing",
      permissionsApproved,
      permissionsTotal: permissions.length,
      oauthStatus: oauth?.status || "blocked",
      publisherConnectorStatus: connector?.status || "blocked",
      accountCreationUrl: requirement.accountCreationUrl,
      developerPortalUrl: requirement.developerPortalUrl,
      oauthUrl: oauth?.authUrl || null,
      artifactPaths: Array.from(new Set([
        input.accountLaunchKit.markdownPath,
        input.developerAppEvidence.readmePath,
        input.permissionTracker.markdownPath,
        input.externalSetupQueue.markdownPath,
        input.oauthGoLive.markdownPath,
        input.publisherConnectors.markdownPath,
      ])),
      criticalActions,
      blockedExternalItems: queueItems.length,
      unlockInputs,
      sessionNextSteps,
      permissionUnlocks,
      nextStep: criticalActions[0] || oauth?.nextStep || "Plataforma lista para OAuth/app review.",
    };
  });
  const totals = platforms.reduce<ClipperExternalLaunchDossierSummary["totals"]>((sum, item) => {
    sum.platforms += 1;
    if (item.status === "ready") sum.ready += 1;
    if (item.status === "in_progress") sum.inProgress += 1;
    if (item.status === "blocked") sum.blocked += 1;
    sum.criticalActions += item.criticalActions.length;
    sum.blockedExternalItems += item.blockedExternalItems;
    sum.unlockInputs += item.unlockInputs.length;
    sum.permissionUnlocks += item.permissionUnlocks.length;
    return sum;
  }, { platforms: 0, ready: 0, inProgress: 0, blocked: 0, criticalActions: 0, blockedExternalItems: 0, unlockInputs: 0, permissionUnlocks: 0 });
  const generatedAt = await stat(EXTERNAL_LAUNCH_DOSSIER_PATH).then((file) => file.mtime.toISOString()).catch(() => null);
  return {
    status: !generatedAt
      ? "not_prepared"
      : totals.ready === totals.platforms && totals.platforms > 0
        ? "ready"
        : totals.ready > 0 || totals.inProgress > 0
          ? "in_progress"
          : "blocked",
    generatedAt,
    manifestPath: EXTERNAL_LAUNCH_DOSSIER_PATH,
    markdownPath: EXTERNAL_LAUNCH_DOSSIER_MARKDOWN_PATH,
    platforms,
    totals,
    nextStep: platforms.find((item) => item.status !== "ready")?.nextStep || "Dossier externo listo; conectar OAuth y correr dry-run.",
  };
}

function renderExternalLaunchDossierMarkdown(summary: ClipperExternalLaunchDossierSummary): string {
  return [
    "# Clippers External Launch Dossier",
    "",
    `Status: ${summary.status}`,
    `Generated: ${summary.generatedAt || new Date().toISOString()}`,
    `Totals: ${summary.totals.ready} ready, ${summary.totals.inProgress} in_progress, ${summary.totals.blocked} blocked, ${summary.totals.criticalActions} critical actions, ${summary.totals.blockedExternalItems} external blockers, ${summary.totals.unlockInputs} unlock inputs, ${summary.totals.permissionUnlocks} permission unlocks`,
    "",
    "## Next Step",
    "",
    summary.nextStep,
    "",
    "## Platforms",
    "",
    ...summary.platforms.flatMap((item) => [
      `### ${item.label}`,
      "",
      `- Platform: ${item.platform}`,
      `- Status: ${item.status}`,
      `- Accounts: ${item.accountTasksDone}/${item.accountTasks}`,
      `- Developer app: ${item.developerAppStatus}`,
      `- Credentials: ${item.credentialStatus}`,
      `- Permissions: ${item.permissionsApproved}/${item.permissionsTotal}`,
      `- OAuth: ${item.oauthStatus}`,
      `- Publisher connector: ${item.publisherConnectorStatus}`,
      `- Account creation: ${item.accountCreationUrl}`,
      `- Developer portal: ${item.developerPortalUrl}`,
      `- OAuth URL: ${item.oauthUrl || "not ready"}`,
      `- External blockers: ${item.blockedExternalItems}`,
      `- Next step: ${item.nextStep}`,
      "",
      "Unlock inputs:",
      ...(item.unlockInputs.length ? item.unlockInputs.map((input) => `- [ ] ${input}`) : ["- none"]),
      "",
      "Session next steps:",
      ...(item.sessionNextSteps.length ? item.sessionNextSteps.map((step) => `- [ ] ${step}`) : ["- none"]),
      "",
      "Permission unlocks:",
      ...(item.permissionUnlocks.length ? item.permissionUnlocks.flatMap((permission) => [
        `- [ ] ${permission.scope}`,
        `  - Portal: ${permission.requestPortalUrl}`,
        `  - Action: ${permission.requestAction}`,
        `  - Required for autopost: ${permission.requiredForAutopost ? "yes" : "no"}`,
        `  - App review required: ${permission.appReviewRequired ? "yes" : "no"}`,
        `  - Evidence row: ${permission.evidenceBatchRow}`,
        "  - Evidence required:",
        ...permission.evidenceRequired.map((evidence) => `    - ${evidence}`),
      ]) : ["- none"]),
      "",
      "Critical actions:",
      ...(item.criticalActions.length ? item.criticalActions.map((action) => `- [ ] ${action}`) : ["- none"]),
      "",
      "Artifacts:",
      ...item.artifactPaths.map((artifactPath) => `- ${artifactPath}`),
      "",
    ]),
  ].join("\n");
}

export async function prepareClipperExternalLaunchDossier(userId = getSystemUserId()): Promise<{ externalLaunchDossier: ClipperExternalLaunchDossierSummary; status: ClipperStatus }> {
  await writeDefaultConfigIfMissing();
  await ensureClipperDirs();
  const config = await readConfig();
  const oauthConnections = await readOAuthConnections();
  const tokenRecords = await readTokenVaultRecords();
  const accounts = applyOAuthStateToAccounts(
    (Array.isArray(config.accounts) && config.accounts.length ? config.accounts : DEFAULT_ACCOUNTS).map(ensureAccountShape),
    oauthConnections,
    tokenRecords
  );
  const credentialChecks = buildCredentialChecks();
  const tokenVault = await buildTokenVaultSummary();
  const connectActions = buildClipperConnectActions();
  const tokenExchanges = buildClipperTokenExchanges(oauthConnections, tokenRecords);
  const credentialSetup = await buildCredentialSetupSummary();
  const permissionPack = await buildPermissionPackSummary();
  const accountEvidence = await buildAccountEvidenceSummary(accounts);
  const accountLaunchKit = await buildAccountLaunchKitSummary(accounts, accountEvidence);
  const developerAppEvidence = await buildDeveloperAppEvidenceSummary();
  const permissionTracker = await buildPermissionTrackerSummary({ accounts, credentialChecks, tokenRecords, oauthConnections, permissionPack, accountLaunchKit });
  const officialPermissionMatrix = await buildOfficialPermissionMatrixSummary();
  const platformReadiness = await buildPlatformReadinessSummary({ credentialChecks, tokenRecords, accountLaunchKit, developerAppEvidence, permissionTracker });
  const externalSetupQueue = await buildExternalSetupQueueSummary({ accountLaunchKit, developerAppEvidence, permissionTracker, credentialChecks, connectActions, tokenRecords });
  const productionQueue = await buildProductionQueueSummary(accounts);
  const publisherConnectors = await buildPublisherConnectorSummary({ tokenRecords, permissionTracker, platformReadiness, productionQueue });
  const oauthGoLive = await buildOAuthGoLiveSummary({ credentialChecks, connectActions, tokenVault, tokenExchanges, tokenRecords, developerAppEvidence, permissionTracker, publisherConnectors });
  const draftSummary = await buildExternalLaunchDossierSummary({ accountLaunchKit, developerAppEvidence, permissionTracker, credentialSetup, externalSetupQueue, oauthGoLive, publisherConnectors, officialPermissionMatrix });
  const externalLaunchDossier: ClipperExternalLaunchDossierSummary = {
    ...draftSummary,
    generatedAt: new Date().toISOString(),
    status: draftSummary.totals.ready === draftSummary.totals.platforms && draftSummary.totals.platforms > 0
      ? "ready"
      : draftSummary.totals.ready > 0 || draftSummary.totals.inProgress > 0
        ? "in_progress"
        : "blocked",
  };
  await writeFile(EXTERNAL_LAUNCH_DOSSIER_PATH, JSON.stringify(externalLaunchDossier, null, 2));
  await writeFile(EXTERNAL_LAUNCH_DOSSIER_MARKDOWN_PATH, renderExternalLaunchDossierMarkdown(externalLaunchDossier));
  return { externalLaunchDossier, status: await getClipperStatus(userId) };
}

async function buildPlatformPortalChecklistSummary(input: {
  externalSetupQueue: ClipperExternalSetupQueueSummary;
  externalLaunchDossier: ClipperExternalLaunchDossierSummary;
  goLiveExecutionPack: ClipperGoLiveExecutionPackSummary;
  officialPermissionMatrix: ClipperOfficialPermissionMatrixSummary;
  publisherConnectors: ClipperPublisherConnectorSummary;
}): Promise<ClipperPlatformPortalChecklistSummary> {
  const items = PLATFORM_REQUIREMENTS.map<ClipperPlatformPortalChecklistItem>((requirement) => {
    const queueItems = input.externalSetupQueue.items.filter((item) => item.platform === requirement.platform && item.status !== "done");
    const dossier = input.externalLaunchDossier.platforms.find((item) => item.platform === requirement.platform);
    const goLive = input.goLiveExecutionPack.platforms.find((item) => item.platform === requirement.platform);
    const official = input.officialPermissionMatrix.items.find((item) => item.platform === requirement.platform);
    const connector = input.publisherConnectors.items.find((item) => item.platform === requirement.platform);
    const evidenceBatchRows = Array.from(new Set([
      ...queueItems.map((item) => externalEvidenceBatchRow(item)).filter(Boolean),
      ...(official?.scopes.map((scope) => scope.launchEvidenceBatchRow).filter(Boolean) || []),
    ]));
    const doNow = Array.from(new Set([
      ...queueItems.filter((item) => item.status === "needs_action").map((item) => item.nextStep),
      ...queueItems.filter((item) => item.status === "blocked" && item.priority === "critical").map((item) => item.nextStep),
      ...(goLive?.phases.filter((phase) => phase.status === "ready_to_execute").map((phase) => phase.nextStep) || []),
      dossier?.nextStep || "",
    ].filter(Boolean))).slice(0, 10);
    const blockers = Array.from(new Set([
      ...queueItems.flatMap((item) => item.blockers),
      ...(goLive?.phases.filter((phase) => phase.status === "blocked").map((phase) => phase.blocker || phase.nextStep) || []),
      ...(connector?.blockingCategories.map((category) => `Publisher connector blocked by ${category}.`) || []),
    ].filter(Boolean))).slice(0, 12);
    const portalUrls = Array.from(new Set([
      requirement.accountCreationUrl,
      requirement.developerPortalUrl,
      ...queueItems.map((item) => item.portalUrl).filter(Boolean),
      ...(goLive?.phases.map((phase) => phase.portalUrl).filter((url): url is string => Boolean(url)) || []),
      ...(official?.scopes.map((scope) => scope.requestPortalUrl).filter(Boolean) || []),
    ])).slice(0, 12);
    const artifactPaths = Array.from(new Set([
      input.externalSetupQueue.markdownPath,
      input.externalLaunchDossier.markdownPath,
      input.goLiveExecutionPack.markdownPath,
      input.officialPermissionMatrix.markdownPath,
      input.publisherConnectors.markdownPath,
    ]));
    const done = goLive?.status === "ready" && connector?.status === "ready" && blockers.length === 0;
    const inProgress = queueItems.some((item) => item.status !== "blocked") || goLive?.status === "in_progress" || dossier?.status === "in_progress";
    const status: ClipperPlatformPortalChecklistStatus = done ? "ready" : inProgress ? "in_progress" : "blocked";
    const completionCriteria = [
      "All account evidence rows imported as verified for this platform.",
      "Developer app evidence imported as submitted or approved with production HTTPS URL.",
      `Required scopes recorded: ${PLATFORM_SCOPES[requirement.platform].join(", ")}.`,
      "OAuth token saved encrypted in token vault.",
      "Publisher connector preflight has no account/developer_app/permission/credential/token blockers.",
      "Manual fallback or publishing package has at least one ready item before autopost.",
    ];
    return {
      platform: requirement.platform,
      label: requirement.label,
      status,
      portalUrls,
      doNow: doNow.length ? doNow : ["Complete the first blocked portal action, then import evidence via evidence-drop."],
      blockers,
      evidenceBatchRows,
      artifactPaths,
      completionCriteria,
      nextStep: doNow[0] || blockers[0] || "Platform checklist ready; execute portal actions and import evidence.",
    };
  });
  const totals = items.reduce<ClipperPlatformPortalChecklistSummary["totals"]>((sum, item) => {
    sum.platforms += 1;
    if (item.status === "ready") sum.ready += 1;
    if (item.status === "in_progress") sum.inProgress += 1;
    if (item.status === "blocked") sum.blocked += 1;
    sum.evidenceRows += item.evidenceBatchRows.length;
    sum.portalActions += item.doNow.length;
    return sum;
  }, { platforms: 0, ready: 0, inProgress: 0, blocked: 0, evidenceRows: 0, portalActions: 0 });
  const generatedAt = await stat(PLATFORM_PORTAL_CHECKLIST_PATH).then((file) => file.mtime.toISOString()).catch(() => null);
  return {
    status: !generatedAt
      ? "not_prepared"
      : totals.ready === totals.platforms && totals.platforms > 0
        ? "ready"
        : totals.ready > 0 || totals.inProgress > 0
          ? "in_progress"
          : "blocked",
    generatedAt,
    manifestPath: PLATFORM_PORTAL_CHECKLIST_PATH,
    markdownPath: PLATFORM_PORTAL_CHECKLIST_MARKDOWN_PATH,
    csvPath: PLATFORM_PORTAL_CHECKLIST_CSV_PATH,
    items,
    totals,
    nextStep: items.find((item) => item.status !== "ready")?.nextStep || "All platform portal checklists are ready.",
  };
}

function renderPlatformPortalChecklistMarkdown(summary: ClipperPlatformPortalChecklistSummary): string {
  return [
    "# Clippers Platform Portal Checklist",
    "",
    `Status: ${summary.status}`,
    `Generated: ${summary.generatedAt || new Date().toISOString()}`,
    `Totals: ${summary.totals.ready}/${summary.totals.platforms} ready; ${summary.totals.portalActions} portal actions; ${summary.totals.evidenceRows} evidence rows`,
    "",
    "## Next Step",
    "",
    summary.nextStep,
    "",
    ...summary.items.flatMap((item) => [
      `## ${item.label}`,
      "",
      `- Platform: ${item.platform}`,
      `- Status: ${item.status}`,
      `- Next step: ${item.nextStep}`,
      "",
      "### Portal URLs",
      ...item.portalUrls.map((url) => `- ${url}`),
      "",
      "### Do Now",
      ...item.doNow.map((step) => `- [ ] ${step}`),
      "",
      "### Evidence Rows",
      ...(item.evidenceBatchRows.length ? item.evidenceBatchRows.map((row) => `- \`${row}\``) : ["- none"]),
      "",
      "### Completion Criteria",
      ...item.completionCriteria.map((step) => `- [ ] ${step}`),
      "",
      "### Blockers",
      ...(item.blockers.length ? item.blockers.map((blocker) => `- ${blocker}`) : ["- none"]),
      "",
      "### Artifacts",
      ...item.artifactPaths.map((artifact) => `- ${artifact}`),
      "",
    ]),
  ].join("\n");
}

function renderPlatformPortalChecklistCsv(summary: ClipperPlatformPortalChecklistSummary): string {
  const header = ["platform", "label", "status", "next_step", "portal_urls", "do_now", "evidence_batch_rows", "blockers", "completion_criteria", "artifacts"];
  return [
    header.map(csvEscape).join(","),
    ...summary.items.map((item) => [
      item.platform,
      item.label,
      item.status,
      item.nextStep,
      item.portalUrls.join(" | "),
      item.doNow.join(" | "),
      item.evidenceBatchRows.join(" | "),
      item.blockers.join(" | "),
      item.completionCriteria.join(" | "),
      item.artifactPaths.join(" | "),
    ].map(csvEscape).join(",")),
    "",
  ].join("\n");
}

export async function prepareClipperPlatformPortalChecklist(userId = getSystemUserId()): Promise<{ platformPortalChecklist: ClipperPlatformPortalChecklistSummary; status: ClipperStatus }> {
  await writeDefaultConfigIfMissing();
  await ensureClipperDirs();
  const statusBefore = await getClipperStatus(userId);
  const draftSummary = await buildPlatformPortalChecklistSummary({
    externalSetupQueue: statusBefore.externalSetupQueue,
    externalLaunchDossier: statusBefore.externalLaunchDossier,
    goLiveExecutionPack: statusBefore.goLiveExecutionPack,
    officialPermissionMatrix: statusBefore.officialPermissionMatrix,
    publisherConnectors: statusBefore.publisherConnectors,
  });
  const platformPortalChecklist: ClipperPlatformPortalChecklistSummary = {
    ...draftSummary,
    generatedAt: new Date().toISOString(),
    status: draftSummary.totals.ready === draftSummary.totals.platforms && draftSummary.totals.platforms > 0
      ? "ready"
      : draftSummary.totals.ready > 0 || draftSummary.totals.inProgress > 0
        ? "in_progress"
        : "blocked",
  };
  await writeFile(PLATFORM_PORTAL_CHECKLIST_PATH, JSON.stringify(platformPortalChecklist, null, 2));
  await writeFile(PLATFORM_PORTAL_CHECKLIST_MARKDOWN_PATH, renderPlatformPortalChecklistMarkdown(platformPortalChecklist));
  await writeFile(PLATFORM_PORTAL_CHECKLIST_CSV_PATH, renderPlatformPortalChecklistCsv(platformPortalChecklist));
  return { platformPortalChecklist, status: await getClipperStatus(userId) };
}

function goLivePhaseStatus(done: boolean, ready: boolean): ClipperGoLiveExecutionPhaseStatus {
  if (done) return "done";
  return ready ? "ready_to_execute" : "blocked";
}

function buildGoLiveExecutionPhase(input: {
  id: string;
  label: string;
  owner: string;
  done: boolean;
  ready: boolean;
  portalUrl: string | null;
  localActionUrl: string | null;
  evidencePath: string | null;
  checklist: string[];
  blocker: string | null;
  nextStep: string;
}): ClipperGoLiveExecutionPhase {
  const status = goLivePhaseStatus(input.done, input.ready);
  return {
    id: input.id,
    label: input.label,
    owner: input.owner,
    status,
    portalUrl: input.portalUrl,
    localActionUrl: input.localActionUrl,
    evidencePath: input.evidencePath,
    checklist: input.checklist,
    blocker: status === "blocked" ? input.blocker : null,
    nextStep: status === "done" ? "Listo; seguir con la siguiente fase." : input.nextStep,
  };
}

async function buildGoLiveExecutionPackSummary(input: {
  accountLaunchKit: ClipperAccountLaunchKitSummary;
  developerAppEvidence: ClipperDeveloperAppEvidenceSummary;
  credentialSetup: ClipperCredentialSetupSummary;
  permissionTracker: ClipperPermissionTrackerSummary;
  productionUrlSetup: ClipperProductionUrlSetupSummary;
  oauthGoLive: ClipperOAuthGoLiveSummary;
  publisherConnectors: ClipperPublisherConnectorSummary;
  appReviewSubmissionPack: ClipperAppReviewSubmissionPackSummary;
  manualPostingPack: ClipperManualPostingPackSummary;
}): Promise<ClipperGoLiveExecutionPackSummary> {
  const platforms = PLATFORM_REQUIREMENTS.map((requirement) => {
    const accountTasks = input.accountLaunchKit.tasks.filter((task) => task.platform === requirement.platform);
    const verifiedAccounts = accountTasks.filter((task) => task.evidenceStatus === "verified").length;
    const developerApp = input.developerAppEvidence.items.find((item) => item.platform === requirement.platform);
    const credential = input.credentialSetup.items.find((item) =>
      item.id.includes(requirement.platform) ||
      (requirement.platform === "instagram" && item.id.includes("meta")) ||
      (requirement.platform === "youtube" && item.id.includes("google"))
    );
    const permissions = input.permissionTracker.items.filter((item) => item.platform === requirement.platform);
    const permissionsApproved = permissions.filter((item) => item.status === "approved").length;
    const oauth = input.oauthGoLive.items.find((item) => item.platform === requirement.platform);
    const connector = input.publisherConnectors.items.find((item) => item.platform === requirement.platform);
    const reviewItem = input.appReviewSubmissionPack.items.find((item) => item.platform === requirement.platform);
    const manualItems = input.manualPostingPack.items.filter((item) => item.platform === requirement.platform);
    const manualReady = manualItems.filter((item) => item.status === "ready_to_post").length;
    const accountEvidencePath = accountTasks.find((task) => task.evidencePath)?.evidencePath || input.accountLaunchKit.markdownPath;
    const developerEvidencePath = developerApp?.evidencePath || input.developerAppEvidence.readmePath;

    const phases: ClipperGoLiveExecutionPhase[] = [
      buildGoLiveExecutionPhase({
        id: `${requirement.platform}-production-url`,
        label: "Production URL y redirect URIs",
        owner: "Platform Ops",
        done: input.productionUrlSetup.productionUrlReady,
        ready: true,
        portalUrl: requirement.developerPortalUrl,
        localActionUrl: "/api/clippers/prepare-production-url-setup",
        evidencePath: input.productionUrlSetup.markdownPath,
        checklist: [
          `PUBLIC_BASE_URL debe responder por HTTPS publico.`,
          `Registrar redirect URI exacto: ${buildRedirectUri(requirement.platform)}`,
          "Guardar screenshot del portal con redirect URI.",
        ],
        blocker: input.productionUrlSetup.productionUrlNote,
        nextStep: input.productionUrlSetup.nextStep,
      }),
      buildGoLiveExecutionPhase({
        id: `${requirement.platform}-accounts`,
        label: "Cuentas reales verificadas",
        owner: "Account Ops",
        done: accountTasks.length > 0 && verifiedAccounts === accountTasks.length,
        ready: accountTasks.length > 0,
        portalUrl: requirement.accountCreationUrl,
        localActionUrl: null,
        evidencePath: accountEvidencePath,
        checklist: [
          "Crear/iniciar sesion en cada cuenta destino.",
          "Verificar email/telefono y requisitos de seguridad.",
          "Registrar evidencia como verified en Account Evidence.",
        ],
        blocker: `${verifiedAccounts}/${accountTasks.length} cuentas verificadas.`,
        nextStep: "Crear o verificar cuentas reales y guardar evidencia en Account Evidence.",
      }),
      buildGoLiveExecutionPhase({
        id: `${requirement.platform}-developer-app`,
        label: "Developer app y app review",
        owner: "Permission Ops",
        done: developerApp?.status === "approved",
        ready: input.productionUrlSetup.productionUrlReady && reviewItem?.status === "ready",
        portalUrl: requirement.developerPortalUrl,
        localActionUrl: "/api/clippers/prepare-app-review-submission-pack",
        evidencePath: developerEvidencePath,
        checklist: [
          "Crear app/proyecto developer.",
          "Pegar respuestas del App Review Submission Pack.",
          "Adjuntar evidencia de rights gate, OAuth y flujo approval_required.",
          "Registrar resultado approved/submitted/rejected en Developer App Evidence.",
        ],
        blocker: developerApp?.status ? `Developer app ${developerApp.status}.` : "Developer app missing.",
        nextStep: reviewItem?.nextStep || "Preparar submission pack y enviar app review.",
      }),
      buildGoLiveExecutionPhase({
        id: `${requirement.platform}-credentials`,
        label: "Credenciales OAuth en env",
        owner: "Platform Ops",
        done: credential?.status === "ready",
        ready: true,
        portalUrl: requirement.developerPortalUrl,
        localActionUrl: "/api/clippers/prepare-credential-doctor",
        evidencePath: input.credentialSetup.readmePath,
        checklist: [
          "Copiar client id/app id/client key y secret al env seguro.",
          "Reload keys en Clippers.",
          "Confirmar Credential Doctor ready.",
        ],
        blocker: `${credential?.label || requirement.label} ${credential?.status || "missing"}.`,
        nextStep: credential?.nextStep || "Agregar credenciales y recargar keys.",
      }),
      buildGoLiveExecutionPhase({
        id: `${requirement.platform}-permissions`,
        label: "Permisos/scopes aprobados",
        owner: "Permission Ops",
        done: permissions.length > 0 && permissionsApproved === permissions.length,
        ready: developerApp?.status === "approved" || reviewItem?.status === "ready",
        portalUrl: requirement.developerPortalUrl,
        localActionUrl: null,
        evidencePath: input.permissionTracker.markdownPath,
        checklist: [
          `Solicitar scopes: ${PLATFORM_SCOPES[requirement.platform].join(", ")}`,
          "Guardar status requested/approved en Permission Tracker.",
          "No activar autopost hasta que todos los scopes requeridos esten approved.",
        ],
        blocker: `${permissionsApproved}/${permissions.length} permisos aprobados.`,
        nextStep: input.permissionTracker.nextStep,
      }),
      buildGoLiveExecutionPhase({
        id: `${requirement.platform}-oauth-token`,
        label: "OAuth conectado y token guardado",
        owner: "Publisher",
        done: Boolean(oauth?.tokenSaved),
        ready: oauth?.status === "partial" || oauth?.authUrl !== null,
        portalUrl: oauth?.authUrl || null,
        localActionUrl: oauth?.authUrl ? null : "/api/clippers/prepare-oauth-go-live",
        evidencePath: input.oauthGoLive.markdownPath,
        checklist: [
          "Abrir OAuth URL desde Clippers.",
          "Autorizar cuenta/canal destino.",
          "Confirmar token cifrado en Token Vault sin exponer plaintext.",
        ],
        blocker: oauth?.nextStep || "OAuth no listo.",
        nextStep: oauth?.nextStep || "Completar OAuth Go-Live.",
      }),
      buildGoLiveExecutionPhase({
        id: `${requirement.platform}-publisher-connector`,
        label: "Publisher connector listo",
        owner: "Publisher",
        done: connector?.status === "ready",
        ready: Boolean(oauth?.tokenSaved) && permissionsApproved === permissions.length,
        portalUrl: null,
        localActionUrl: "/api/clippers/prepare-publisher-connectors",
        evidencePath: input.publisherConnectors.markdownPath,
        checklist: [
          "Validar endpoint, payload fields y preflight checks.",
          "Mantener approval_required para primeros posts.",
          "Correr dry-run antes de autopost.",
        ],
        blocker: connector?.nextStep || "Connector bloqueado.",
        nextStep: connector?.nextStep || "Preparar connector.",
      }),
      buildGoLiveExecutionPhase({
        id: `${requirement.platform}-manual-fallback`,
        label: "Manual fallback listo",
        owner: "Publisher",
        done: manualReady > 0,
        ready: manualItems.length > 0,
        portalUrl: null,
        localActionUrl: "/api/clippers/prepare-manual-posting-pack",
        evidencePath: input.manualPostingPack.markdownPath,
        checklist: [
          "Usar CSV para subir posts manuales si OAuth/app review tarda.",
          "Guardar URLs publicadas y metricas 24h/48h.",
          "Reinyectar metricas en Optimizer.",
        ],
        blocker: `${manualReady}/${manualItems.length} posts manuales ready_to_post.`,
        nextStep: input.manualPostingPack.nextStep,
      }),
    ];
    const totals = phases.reduce<ClipperGoLiveExecutionPlatform["totals"]>((sum, phase) => {
      sum.phases += 1;
      if (phase.status === "done") sum.done += 1;
      if (phase.status === "ready_to_execute") sum.readyToExecute += 1;
      if (phase.status === "blocked") sum.blocked += 1;
      return sum;
    }, { phases: 0, done: 0, readyToExecute: 0, blocked: 0 });
    const status: ClipperGoLiveExecutionPackStatus = totals.done === totals.phases
      ? "ready"
      : totals.done > 0 || totals.readyToExecute > 0
        ? "in_progress"
        : "blocked";
    return {
      platform: requirement.platform,
      label: requirement.label,
      status,
      phases,
      totals,
      nextStep: phases.find((phase) => phase.status === "blocked")?.nextStep
        || phases.find((phase) => phase.status === "ready_to_execute")?.nextStep
        || "Plataforma lista para go-live controlado.",
    };
  });
  const totals = platforms.reduce<ClipperGoLiveExecutionPackSummary["totals"]>((sum, platform) => {
    sum.platforms += 1;
    if (platform.status === "ready") sum.ready += 1;
    if (platform.status === "in_progress") sum.inProgress += 1;
    if (platform.status === "blocked") sum.blocked += 1;
    sum.phases += platform.totals.phases;
    sum.done += platform.totals.done;
    sum.readyToExecute += platform.totals.readyToExecute;
    return sum;
  }, { platforms: 0, ready: 0, inProgress: 0, blocked: 0, phases: 0, done: 0, readyToExecute: 0 });
  const generatedAt = await stat(GO_LIVE_EXECUTION_PACK_PATH).then((file) => file.mtime.toISOString()).catch(() => null);
  return {
    status: !generatedAt
      ? "not_prepared"
      : totals.ready === totals.platforms && totals.platforms > 0
        ? "ready"
        : totals.inProgress > 0 || totals.readyToExecute > 0 || totals.done > 0
          ? "in_progress"
          : "blocked",
    generatedAt,
    manifestPath: GO_LIVE_EXECUTION_PACK_PATH,
    markdownPath: GO_LIVE_EXECUTION_PACK_MARKDOWN_PATH,
    platforms,
    totals,
    nextStep: platforms.find((platform) => platform.status !== "ready")?.nextStep || "Go-live execution listo; correr dry-run y revisar metricas.",
  };
}

function renderGoLiveExecutionPackMarkdown(summary: ClipperGoLiveExecutionPackSummary): string {
  return [
    "# Clippers Go-Live Execution Pack",
    "",
    `Status: ${summary.status}`,
    `Generated: ${summary.generatedAt || new Date().toISOString()}`,
    `Totals: ${summary.totals.done}/${summary.totals.phases} phases done; ${summary.totals.readyToExecute} ready_to_execute`,
    "",
    "## Next Step",
    "",
    summary.nextStep,
    "",
    "## Platforms",
    "",
    ...summary.platforms.flatMap((platform) => [
      `### ${platform.label}`,
      "",
      `- Platform: ${platform.platform}`,
      `- Status: ${platform.status}`,
      `- Phases: ${platform.totals.done}/${platform.totals.phases} done, ${platform.totals.readyToExecute} ready_to_execute, ${platform.totals.blocked} blocked`,
      `- Next step: ${platform.nextStep}`,
      "",
      ...platform.phases.flatMap((phase) => [
        `#### ${phase.label}`,
        "",
        `- Status: ${phase.status}`,
        `- Owner: ${phase.owner}`,
        `- Portal: ${phase.portalUrl || "n/a"}`,
        `- Local action: ${phase.localActionUrl || "n/a"}`,
        `- Evidence: ${phase.evidencePath || "n/a"}`,
        phase.blocker ? `- Blocker: ${phase.blocker}` : null,
        `- Next step: ${phase.nextStep}`,
        "",
        "Checklist:",
        ...phase.checklist.map((step) => `- [ ] ${step}`),
        "",
      ].filter((line): line is string => Boolean(line))),
    ]),
  ].join("\n");
}

export async function prepareClipperGoLiveExecutionPack(userId = getSystemUserId()): Promise<{ goLiveExecutionPack: ClipperGoLiveExecutionPackSummary; status: ClipperStatus }> {
  await writeDefaultConfigIfMissing();
  await ensureClipperDirs();
  const config = await readConfig();
  const oauthConnections = await readOAuthConnections();
  const tokenRecords = await readTokenVaultRecords();
  const accounts = applyOAuthStateToAccounts(
    (Array.isArray(config.accounts) && config.accounts.length ? config.accounts : DEFAULT_ACCOUNTS).map(ensureAccountShape),
    oauthConnections,
    tokenRecords
  );
  const credentialChecks = buildCredentialChecks();
  const tokenVault = await buildTokenVaultSummary();
  const connectActions = buildClipperConnectActions();
  const tokenExchanges = buildClipperTokenExchanges(oauthConnections, tokenRecords);
  const credentialSetup = await buildCredentialSetupSummary();
  const permissionPack = await buildPermissionPackSummary();
  const accountEvidence = await buildAccountEvidenceSummary(accounts);
  const accountLaunchKit = await buildAccountLaunchKitSummary(accounts, accountEvidence);
  const developerAppEvidence = await buildDeveloperAppEvidenceSummary();
  const permissionTracker = await buildPermissionTrackerSummary({ accounts, credentialChecks, tokenRecords, oauthConnections, permissionPack, accountLaunchKit });
  const platformReadiness = await buildPlatformReadinessSummary({ credentialChecks, tokenRecords, accountLaunchKit, developerAppEvidence, permissionTracker });
  const productionUrlSetup = await buildProductionUrlSetupSummary();
  const legalPolicyPack = await buildLegalPolicyPackSummary();
  const appReviewDemoPack = await buildAppReviewDemoPackSummary();
  const officialPermissionMatrix = await buildOfficialPermissionMatrixSummary();
  const appReviewSubmissionPack = await buildAppReviewSubmissionPackSummary({ accounts, officialPermissionMatrix, productionUrlSetup, developerAppEvidence, legalPolicyPack, appReviewDemoPack });
  const productionQueue = await buildProductionQueueSummary(accounts);
  const publisherConnectors = await buildPublisherConnectorSummary({ tokenRecords, permissionTracker, platformReadiness, productionQueue });
  const oauthGoLive = await buildOAuthGoLiveSummary({ credentialChecks, connectActions, tokenVault, tokenExchanges, tokenRecords, developerAppEvidence, permissionTracker, publisherConnectors });
  const manualPostingPack = await buildManualPostingPackSummary(productionQueue, accountLaunchKit);
  const draftSummary = await buildGoLiveExecutionPackSummary({ accountLaunchKit, developerAppEvidence, credentialSetup, permissionTracker, productionUrlSetup, oauthGoLive, publisherConnectors, appReviewSubmissionPack, manualPostingPack });
  const goLiveExecutionPack: ClipperGoLiveExecutionPackSummary = {
    ...draftSummary,
    generatedAt: new Date().toISOString(),
    status: draftSummary.totals.ready === draftSummary.totals.platforms && draftSummary.totals.platforms > 0
      ? "ready"
      : draftSummary.totals.inProgress > 0 || draftSummary.totals.readyToExecute > 0 || draftSummary.totals.done > 0
        ? "in_progress"
        : "blocked",
  };
  await writeFile(GO_LIVE_EXECUTION_PACK_PATH, JSON.stringify(goLiveExecutionPack, null, 2));
  await writeFile(GO_LIVE_EXECUTION_PACK_MARKDOWN_PATH, renderGoLiveExecutionPackMarkdown(goLiveExecutionPack));
  return { goLiveExecutionPack, status: await getClipperStatus(userId) };
}

function appReviewSubmissionAnswers(input: {
  platform: ClipperPlatform;
  label: string;
  requestedScopes: string[];
  redirectUri: string;
  privacyPolicyUrl: string;
  termsUrl: string;
  demoUrl: string;
  accountHandles: string[];
}): ClipperAppReviewSubmissionAnswer[] {
  const useCase = "We operate a controlled short-form clipping workflow for accounts we own or manage. The app prepares vertical drafts, requires rights evidence before publishing, stores OAuth tokens encrypted server-side, and keeps publishing in approval_required mode until accounts, permissions and QA are verified.";
  const rights = "The workflow blocks third-party footage unless an allowlist record proves ownership, license, official-source usage, or creator/rightsholder permission. Rights evidence is saved before draft generation and is referenced in review reports.";
  const posting = input.platform === "tiktok"
    ? "TikTok Content Posting API is used for direct posts only after app review and explicit user OAuth consent. Upload/InBox can be used when a creator must finish posting in TikTok."
    : input.platform === "instagram"
      ? "Instagram Graph API Content Publishing is used for eligible professional accounts connected to a Facebook Page. The app schedules and publishes only approved Reels packages."
      : "YouTube Data API videos.insert is used to upload Shorts with metadata after the channel authorizes youtube.upload.";
  return [
    {
      prompt: "What does your app do?",
      response: useCase,
    },
    {
      prompt: "Why do you need these permissions/scopes?",
      response: `Requested scopes: ${input.requestedScopes.join(", ")}. These scopes are required to publish approved short-form videos to ${input.label} accounts after explicit OAuth authorization and to verify the publishing workflow for owned/managed channels.`,
    },
    {
      prompt: "How is content rights/safety handled?",
      response: rights,
    },
    {
      prompt: "Describe the posting flow.",
      response: posting,
    },
    {
      prompt: "OAuth redirect URI / callback",
      response: input.redirectUri,
    },
    {
      prompt: "Privacy Policy URL",
      response: input.privacyPolicyUrl,
    },
    {
      prompt: "Terms of Service URL",
      response: input.termsUrl,
    },
    {
      prompt: "Public app review demo URL",
      response: input.demoUrl,
    },
    {
      prompt: "Accounts/channels that will authorize",
      response: input.accountHandles.length ? input.accountHandles.join(", ") : "Accounts are prepared in Clippers Account Launch Kit and will authorize only after login/verificacion.",
    },
  ];
}

async function buildAppReviewSubmissionPackSummary(input: {
  accounts: ClipperAccount[];
  officialPermissionMatrix: ClipperOfficialPermissionMatrixSummary;
  productionUrlSetup: ClipperProductionUrlSetupSummary;
  developerAppEvidence: ClipperDeveloperAppEvidenceSummary;
  legalPolicyPack: ClipperLegalPolicyPackSummary;
  appReviewDemoPack: ClipperAppReviewDemoPackSummary;
}): Promise<ClipperAppReviewSubmissionPackSummary> {
  const items: ClipperAppReviewSubmissionItem[] = PLATFORM_REQUIREMENTS.map((requirement) => {
    const official = input.officialPermissionMatrix.items.find((item) => item.platform === requirement.platform);
    const developerApp = input.developerAppEvidence.items.find((item) => item.platform === requirement.platform);
    const accountHandles = input.accounts.flatMap((account) => account.platformAccounts
      .filter((platformAccount) => platformAccount.platform === requirement.platform)
      .map((platformAccount) => `${account.name}: ${platformAccount.handle}`));
    const requestedScopes = official?.scopes.map((scope) => scope.scope) || PLATFORM_SCOPES[requirement.platform];
    const redirectUri = buildRedirectUri(requirement.platform);
    const blockers = [
      ...(input.productionUrlSetup.productionUrlReady ? [] : ["PUBLIC_BASE_URL publica HTTPS pendiente."]),
      ...(input.appReviewDemoPack.productionUrlReady ? [] : ["App Review Demo URL publica HTTPS pendiente."]),
      ...(official?.sourceStatus === "official_verified" || official?.sourceStatus === "official_login_required" ? [] : ["Permisos oficiales no verificados."]),
      ...(developerApp?.status === "approved" ? [] : [`Developer app ${developerApp?.status || "missing"}; usar este pack para completar review.`]),
    ];
    return {
      platform: requirement.platform,
      label: requirement.label,
      status: blockers.filter((blocker) => !blocker.startsWith("Developer app")).length === 0 ? "ready" : "blocked",
      developerPortalUrl: requirement.developerPortalUrl,
      redirectUri,
      requestedScopes,
      accountHandles,
      privacyPolicyUrl: input.legalPolicyPack.privacyUrl,
      termsUrl: input.legalPolicyPack.termsUrl,
      demoUrl: input.appReviewDemoPack.demoUrl,
      productionUrlReady: input.productionUrlSetup.productionUrlReady,
      officialSourceStatus: official?.sourceStatus || "missing",
      submissionAnswers: appReviewSubmissionAnswers({
        platform: requirement.platform,
        label: requirement.label,
        requestedScopes,
        redirectUri,
        privacyPolicyUrl: input.legalPolicyPack.privacyUrl,
        termsUrl: input.legalPolicyPack.termsUrl,
        demoUrl: input.appReviewDemoPack.demoUrl,
        accountHandles,
      }),
      evidenceChecklist: [
        "Privacy Policy URL publica y accesible sin login.",
        "Terms of Service URL publica y accesible sin login.",
        "Demo URL publica de app review accesible sin login.",
        "Guion/screencast de App Review Demo Pack adjunto.",
        "Screenshot de Clippers Command Center con guardrails, Permission Tracker y OAuth Go-Live.",
        "Screenshot o export del Rights Gate / allowlist con fuentes owned, licensed o permissioned.",
        "Screen recording corto del flujo: login OAuth -> draft aprobado -> publicacion approval_required.",
        "Ejemplo de clip generado desde fuente permitida y metadata/caption.",
        "Screenshot del developer portal con redirect URI registrado.",
      ],
      blockers,
      officialDocs: official?.officialDocs || requirement.docs,
      nextStep: blockers[0] || "Pegar respuestas y evidencia en app review; luego registrar approval en Developer App Evidence.",
    };
  });
  const totals = items.reduce<ClipperAppReviewSubmissionPackSummary["totals"]>((sum, item) => {
    sum.platforms += 1;
    if (item.status === "ready") sum.ready += 1;
    if (item.status === "blocked") sum.blocked += 1;
    sum.answers += item.submissionAnswers.length;
    sum.evidenceItems += item.evidenceChecklist.length;
    return sum;
  }, { platforms: 0, ready: 0, blocked: 0, answers: 0, evidenceItems: 0 });
  const generatedAt = await stat(APP_REVIEW_SUBMISSION_PACK_PATH).then((file) => file.mtime.toISOString()).catch(() => null);
  return {
    status: !generatedAt
      ? "not_prepared"
      : totals.blocked > 0
        ? "blocked"
        : "ready",
    generatedAt,
    manifestPath: APP_REVIEW_SUBMISSION_PACK_PATH,
    markdownPath: APP_REVIEW_SUBMISSION_PACK_MARKDOWN_PATH,
    items,
    totals,
    nextStep: items.find((item) => item.status !== "ready")?.nextStep || "Submission pack listo; pegar respuestas en cada portal y adjuntar evidencia.",
  };
}

function renderAppReviewSubmissionPackMarkdown(summary: ClipperAppReviewSubmissionPackSummary): string {
  return [
    "# Clippers App Review Submission Pack",
    "",
    `Status: ${summary.status}`,
    `Generated: ${summary.generatedAt || new Date().toISOString()}`,
    `Totals: ${summary.totals.ready} ready, ${summary.totals.blocked} blocked, ${summary.totals.answers} answers, ${summary.totals.evidenceItems} evidence items`,
    "",
    "## Next Step",
    "",
    summary.nextStep,
    "",
    "## Platforms",
    "",
    ...summary.items.flatMap((item) => [
      `### ${item.label}`,
      "",
      `- Platform: ${item.platform}`,
      `- Status: ${item.status}`,
      `- Developer portal: ${item.developerPortalUrl}`,
      `- Redirect URI: ${item.redirectUri}`,
      `- Privacy Policy URL: ${item.privacyPolicyUrl}`,
      `- Terms URL: ${item.termsUrl}`,
      `- Demo URL: ${item.demoUrl}`,
      `- Production URL ready: ${item.productionUrlReady ? "yes" : "no"}`,
      `- Official source status: ${item.officialSourceStatus}`,
      `- Requested scopes: ${item.requestedScopes.join(", ")}`,
      `- Accounts: ${item.accountHandles.length ? item.accountHandles.join("; ") : "pending"}`,
      `- Next step: ${item.nextStep}`,
      "",
      "Submission answers:",
      ...item.submissionAnswers.flatMap((answer) => [
        `- ${answer.prompt}`,
        `  ${answer.response}`,
      ]),
      "",
      "Evidence checklist:",
      ...item.evidenceChecklist.map((evidence) => `- [ ] ${evidence}`),
      "",
      item.blockers.length ? "Blockers:" : "Blockers: none",
      ...item.blockers.map((blocker) => `- ${blocker}`),
      "",
      "Official docs:",
      ...item.officialDocs.map((doc) => `- ${doc}`),
      "",
    ]),
  ].join("\n");
}

export async function prepareClipperAppReviewSubmissionPack(userId = getSystemUserId()): Promise<{ appReviewSubmissionPack: ClipperAppReviewSubmissionPackSummary; status: ClipperStatus }> {
  await writeDefaultConfigIfMissing();
  await ensureClipperDirs();
  const config = await readConfig();
  const oauthConnections = await readOAuthConnections();
  const tokenRecords = await readTokenVaultRecords();
  const accounts = applyOAuthStateToAccounts(
    (Array.isArray(config.accounts) && config.accounts.length ? config.accounts : DEFAULT_ACCOUNTS).map(ensureAccountShape),
    oauthConnections,
    tokenRecords
  );
  const developerAppEvidence = await buildDeveloperAppEvidenceSummary();
  const officialPermissionMatrix = await buildOfficialPermissionMatrixSummary();
  const productionUrlSetup = await buildProductionUrlSetupSummary();
  const legalPolicyPack = await buildLegalPolicyPackSummary();
  const appReviewDemoPack = await buildAppReviewDemoPackSummary();
  const draftSummary = await buildAppReviewSubmissionPackSummary({ accounts, officialPermissionMatrix, productionUrlSetup, developerAppEvidence, legalPolicyPack, appReviewDemoPack });
  const appReviewSubmissionPack: ClipperAppReviewSubmissionPackSummary = {
    ...draftSummary,
    generatedAt: new Date().toISOString(),
    status: draftSummary.totals.blocked > 0 ? "blocked" : "ready",
  };
  await writeFile(APP_REVIEW_SUBMISSION_PACK_PATH, JSON.stringify(appReviewSubmissionPack, null, 2));
  await writeFile(APP_REVIEW_SUBMISSION_PACK_MARKDOWN_PATH, renderAppReviewSubmissionPackMarkdown(appReviewSubmissionPack));
  return { appReviewSubmissionPack, status: await getClipperStatus(userId) };
}

function developerApplicationAppType(platform: ClipperPlatform): string {
  if (platform === "tiktok") return "TikTok Content Posting API app with Direct Post configuration";
  if (platform === "instagram") return "Meta business/consumer app with Instagram Graph API Content Publishing";
  return "Google Cloud OAuth app with YouTube Data API v3 enabled";
}

function developerApplicationAppName(platform: ClipperPlatform): string {
  if (platform === "tiktok") return "Clippers TikTok Publisher";
  if (platform === "instagram") return "Clippers Reels Publisher";
  return "Clippers Shorts Publisher";
}

function developerApplicationOfficialVerification(platform: ClipperPlatform): string {
  if (platform === "tiktok") {
    return "Official docs checked 2026-06-17: TikTok Content Posting API requires a registered app, Content Posting API product, Direct Post configuration for direct posting, approval for video.publish, user authorization for video.publish, and client audit to lift unaudited visibility restrictions.";
  }
  if (platform === "instagram") {
    return "Official docs checked 2026-06-17: Meta Instagram Content Publishing and permission reference pages are official developer URLs but require Meta login for full access; draft keeps instagram_content_publish, instagram_basic and pages_show_list gated behind App Review and professional IG/Page prerequisites.";
  }
  return "Official docs checked 2026-06-17: YouTube videos.insert requires OAuth authorization such as youtube.upload, uploads through unverified API projects can be restricted to private, and projects may need API compliance audit to lift restrictions.";
}

function developerApplicationRequiredInputs(input: {
  platform: ClipperPlatform;
  requestedScopes: string[];
  redirectUri: string;
  privacyPolicyUrl: string;
  termsUrl: string;
  demoUrl: string;
}): string[] {
  return [
    `${input.platform}: developer app identifier`,
    `${input.platform}: public HTTPS base URL`,
    `${input.platform}: redirect URI configured (${input.redirectUri})`,
    `${input.platform}: Privacy Policy URL configured (${input.privacyPolicyUrl})`,
    `${input.platform}: Terms URL configured (${input.termsUrl})`,
    `${input.platform}: Demo/screencast URL configured (${input.demoUrl})`,
    `${input.platform}: requested scopes ${input.requestedScopes.join(", ")}`,
    `${input.platform}: app review/submission evidence note`,
  ];
}

function developerApplicationCompletionHint(platform: ClipperPlatform): string {
  if (platform === "tiktok") return "Create the TikTok developer app, add Content Posting API/Direct Post, configure redirect URI, request scopes, then paste a completed developer_app evidence row.";
  if (platform === "instagram") return "Create the Meta app, configure Instagram Graph/API and redirect URI, submit App Review for publishing scopes, then paste developer_app evidence.";
  return "Create the Google Cloud OAuth app, enable YouTube Data API v3, configure consent/redirect URI, then paste developer_app evidence.";
}

function developerApplicationPortalFlow(input: {
  platform: ClipperPlatform;
  appName: string;
  redirectUri: string;
  privacyPolicyUrl: string;
  termsUrl: string;
  demoUrl: string;
  scopes: string[];
}): string[] {
  if (input.platform === "tiktok") return [
    "Open TikTok for Developers and create or select the app.",
    `Set app name to ${input.appName} and configure redirect URI ${input.redirectUri}.`,
    "Add the Content Posting API product and enable Direct Post configuration.",
    `Request scopes: ${input.scopes.join(", ")}.`,
    `Attach public Privacy/Terms/Demo URLs: ${input.privacyPolicyUrl}, ${input.termsUrl}, ${input.demoUrl}.`,
    "Submit review/audit and capture the review URL or screenshot path.",
  ];
  if (input.platform === "instagram") return [
    "Open Meta Developers and create or select the app for Instagram publishing.",
    "Add/configure Instagram Graph API or the current Instagram product required by Meta.",
    `Configure Valid OAuth Redirect URI ${input.redirectUri}.`,
    `Request App Review permissions: ${input.scopes.join(", ")}.`,
    "Attach screencast showing professional Instagram account, connected Facebook Page and approval_required publishing.",
    "Capture the App Review submission URL or screenshot path after submission.",
  ];
  return [
    "Open Google Cloud Console and create or select the OAuth project.",
    "Enable YouTube Data API v3 in the API Library.",
    `Configure OAuth consent screen with app name ${input.appName}.`,
    `Create OAuth client and add redirect URI ${input.redirectUri}.`,
    `Add/request scope ${input.scopes.join(", ")} and prepare OAuth verification if Google asks for it.`,
    "Capture project id, OAuth client id and API enabled/consent screenshots.",
  ];
}

function developerApplicationApprovalCriteria(platform: ClipperPlatform): string[] {
  if (platform === "tiktok") return [
    "Developer app has Content Posting API attached.",
    "video.publish and/or video.upload are requested or approved with real review evidence.",
    "Redirect URI, public URLs and demo evidence match Clippers production URL.",
    "Developer App Evidence record is submitted or approved with real app/client id.",
  ];
  if (platform === "instagram") return [
    "Meta app has Instagram publishing product configured for the real professional account/Page setup.",
    "instagram_content_publish, instagram_basic and pages_show_list are submitted or approved with real review evidence.",
    "Redirect URI, public URLs and screencast evidence match Clippers production URL.",
    "Developer App Evidence record is submitted or approved with real app id.",
  ];
  return [
    "Google Cloud project has YouTube Data API v3 enabled.",
    "OAuth consent/client includes youtube.upload and the Clippers redirect URI.",
    "OAuth verification/API compliance requirements are known and evidenced.",
    "Developer App Evidence record is submitted or approved with real project/client id.",
  ];
}

function developerApplicationPostApprovalSteps(platform: ClipperPlatform): string[] {
  const credentialStep = platform === "tiktok"
    ? "Save TIKTOK_CLIENT_KEY and TIKTOK_CLIENT_SECRET through Credential Setup."
    : platform === "instagram"
      ? "Save META_APP_ID and META_APP_SECRET through Credential Setup."
      : "Save GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET through Credential Setup.";
  return [
    credentialStep,
    "Reload keys and confirm Credential Doctor marks the platform ready.",
    "Run OAuth Connection Pack and connect the real target account/channel.",
    "Confirm Token Vault stores an encrypted token record.",
    "Regenerate Publisher Connectors and keep first posts in approval_required.",
  ];
}

function developerApplicationEvidenceBatchRow(platform: ClipperPlatform, publicBaseUrl: string, productionUrlReady: boolean, status: ClipperDeveloperAppEvidenceItemStatus = "submitted"): string {
  return ["developer_app", "", platform, status, "", "", productionUrlReady ? publicBaseUrl : "", ""].map(csvEscape).join(",");
}

function developerApplicationEvidenceRecipeRow(platform: ClipperPlatform, publicBaseUrl: string, productionUrlReady: boolean): string {
  return [
    "developer_app",
    "",
    platform,
    "submitted",
    "",
    "<developer app id/client key/project id>",
    productionUrlReady ? publicBaseUrl : "<public HTTPS base URL>",
    "<developer app review/submission evidence URL or screenshot note>",
  ].map(csvEscape).join(",");
}

function developerApplicationCredentialEnvGroups(platform: ClipperPlatform): string[] {
  return CREDENTIAL_ENV_REQUIREMENTS
    .find((requirement) => requirement.platform === platform)
    ?.acceptedEnvVarGroups.map((group) => group.join(" or ")) || [];
}

function developerApplicationCredentialCopyMap(platform: ClipperPlatform): Array<{ envVarGroup: string; portalField: string; storageRule: string }> {
  const groups = developerApplicationCredentialEnvGroups(platform);
  const portalFields = platform === "tiktok"
    ? ["Client key / Client ID", "Client secret"]
    : platform === "instagram"
      ? ["App ID", "App secret"]
      : ["OAuth client ID", "OAuth client secret"];
  return groups.map((envVarGroup, index) => ({
    envVarGroup,
    portalField: portalFields[index] || "Developer credential",
    storageRule: "Paste the value through Credential Setup or env file only; never paste raw secrets into evidence notes, Markdown or screenshots.",
  }));
}

function developerApplicationPortalSubmissionSteps(item: ClipperDeveloperApplicationDraftItem): string[] {
  return [
    `Open ${item.developerPortalUrl}.`,
    `Create/select app: ${item.appName}.`,
    `Configure product/type: ${item.appType}.`,
    `Set redirect URI exactly: ${item.redirectUri}.`,
    `Set Privacy Policy URL: ${item.privacyPolicyUrl}.`,
    `Set Terms URL: ${item.termsUrl}.`,
    `Attach demo/screencast URL: ${item.demoUrl}.`,
    `Request scopes: ${item.requestedScopes.join(", ")}.`,
    "Capture app ID/client ID/project ID and store secret values only via Credential Setup.",
    `Import submitted evidence row: ${item.submittedEvidenceBatchRow}.`,
    `After approval, import approved evidence row: ${item.approvedEvidenceBatchRow}.`,
  ];
}

function developerApplicationAppVaultChecklist(platform: ClipperPlatform): string[] {
  return [
    "Create a password-manager/private-vault entry for this developer app.",
    "Store app/client/project identifier and portal URL.",
    "Store credential aliases used in CEO_ASSISTANT_ENV without pasting raw values in Clippers notes.",
    "Store review/submission URL or screenshot path with redacted secrets.",
    ...(platform === "instagram" ? ["Store Meta Business/Page relationship and app role/admin owner."] : []),
    ...(platform === "youtube" ? ["Store Google Cloud project ID, OAuth consent status and YouTube Data API enabled proof."] : []),
    ...(platform === "tiktok" ? ["Store TikTok Content Posting API product/audit status and Direct Post configuration proof."] : []),
  ];
}

function buildDeveloperApplicationCreationSession(items: ClipperDeveloperApplicationDraftItem[]): ClipperDeveloperApplicationSessionItem[] {
  const platformOrder: Record<ClipperPlatform, number> = { tiktok: 0, instagram: 1, youtube: 2 };
  return [...items]
    .sort((left, right) => platformOrder[left.platform] - platformOrder[right.platform])
    .map((item, index) => ({
      rank: index + 1,
      platform: item.platform,
      label: item.label,
      status: item.status,
      developerPortalUrl: item.developerPortalUrl,
      appName: item.appName,
      appType: item.appType,
      redirectUri: item.redirectUri,
      requestedScopes: item.requestedScopes,
      credentialEnvGroups: developerApplicationCredentialEnvGroups(item.platform),
      portalFields: [
        { label: "App name", value: item.appName },
        { label: "App type/product", value: item.appType },
        { label: "Redirect URI", value: item.redirectUri },
        { label: "Privacy Policy URL", value: item.privacyPolicyUrl },
        { label: "Terms URL", value: item.termsUrl },
        { label: "Demo URL", value: item.demoUrl },
        { label: "Scopes", value: item.requestedScopes.join(", ") },
      ],
      evidenceNeeded: [
        "Screenshot or portal URL proving the developer app exists.",
        "Screenshot showing redirect URI and public URLs configured.",
        "Screenshot or portal note showing requested/submitted/approved scopes.",
        "Real app identifier/client key/project id recorded in Developer App Evidence.",
        "Credential values saved only through Credential Setup or env file, never in Markdown.",
      ],
      doneCriteria: [
        "Developer App Evidence has status submitted or approved for this platform.",
        "Credential Doctor detects the required client id/key and secret env groups.",
        "Permission Tracker shows requested or approved for at least one requested scope.",
        "OAuth Connection Pack can generate or use the platform OAuth URL after credentials are loaded.",
      ],
      evidenceBatchRow: item.evidenceBatchRow,
      draftEvidenceBatchRow: item.draftEvidenceBatchRow,
      submittedEvidenceBatchRow: item.submittedEvidenceBatchRow,
      approvedEvidenceBatchRow: item.approvedEvidenceBatchRow,
      evidenceRecipeRow: item.evidenceRecipeRow,
      credentialCopyMap: item.credentialCopyMap,
      portalSubmissionSteps: item.portalSubmissionSteps,
      appVaultChecklist: item.appVaultChecklist,
      nextStep: item.nextStep,
    }));
}

async function buildDeveloperApplicationDraftsSummary(input: {
  officialPermissionMatrix: ClipperOfficialPermissionMatrixSummary;
  appReviewSubmissionPack: ClipperAppReviewSubmissionPackSummary;
  legalPolicyPack: ClipperLegalPolicyPackSummary;
  appReviewDemoPack: ClipperAppReviewDemoPackSummary;
  productionUrlSetup: ClipperProductionUrlSetupSummary;
}): Promise<ClipperDeveloperApplicationDraftsSummary> {
  const items: ClipperDeveloperApplicationDraftItem[] = PLATFORM_REQUIREMENTS.map((requirement) => {
    const official = input.officialPermissionMatrix.items.find((item) => item.platform === requirement.platform);
    const submission = input.appReviewSubmissionPack.items.find((item) => item.platform === requirement.platform);
    const productionUrlReady = input.productionUrlSetup.productionUrlReady && input.legalPolicyPack.productionUrlReady && input.appReviewDemoPack.productionUrlReady;
    const blockers = [
      ...(productionUrlReady ? [] : ["PUBLIC_BASE_URL publica HTTPS pendiente para redirect URI, Privacy, Terms y Demo URL."]),
      ...(submission ? [] : ["App Review Submission Pack pendiente."]),
    ];
    const requestedScopes = official?.scopes.map((scope) => scope.scope) || requirement.scopes;
    const submissionChecklist = [
      "Crear/iniciar sesion en el portal developer oficial.",
      `Crear app con nombre sugerido: ${developerApplicationAppName(requirement.platform)}.`,
      `Configurar redirect URI exacto: ${buildRedirectUri(requirement.platform)}`,
      `Agregar Privacy Policy URL: ${input.legalPolicyPack.privacyUrl}`,
      `Agregar Terms URL: ${input.legalPolicyPack.termsUrl}`,
      `Agregar Demo URL o screencast usando: ${input.appReviewDemoPack.demoUrl}`,
      `Solicitar scopes: ${requestedScopes.join(", ")}`,
      "Pegar respuestas del App Review Submission Pack.",
      "Adjuntar evidencia de rights gate, approval_required y cuenta/canal autorizada.",
      "Guardar app id/client id y secret en CEO_ASSISTANT_ENV usando el panel de credenciales.",
      "Registrar status submitted/approved en Developer App Evidence.",
    ];
    const draftEvidenceBatchRow = developerApplicationEvidenceBatchRow(requirement.platform, input.productionUrlSetup.publicBaseUrl, input.productionUrlSetup.productionUrlReady, "draft");
    const submittedEvidenceBatchRow = developerApplicationEvidenceBatchRow(requirement.platform, input.productionUrlSetup.publicBaseUrl, input.productionUrlSetup.productionUrlReady, "submitted");
    const approvedEvidenceBatchRow = developerApplicationEvidenceBatchRow(requirement.platform, input.productionUrlSetup.publicBaseUrl, input.productionUrlSetup.productionUrlReady, "approved");
    const draftItem: ClipperDeveloperApplicationDraftItem = {
      platform: requirement.platform,
      label: requirement.label,
      status: blockers.length ? "blocked" : "ready",
      developerPortalUrl: requirement.developerPortalUrl,
      appName: developerApplicationAppName(requirement.platform),
      appType: developerApplicationAppType(requirement.platform),
      requestedScopes,
      redirectUri: buildRedirectUri(requirement.platform),
      privacyPolicyUrl: input.legalPolicyPack.privacyUrl,
      termsUrl: input.legalPolicyPack.termsUrl,
      demoUrl: input.appReviewDemoPack.demoUrl,
      officialDocs: official?.officialDocs || requirement.docs,
      officialVerification: developerApplicationOfficialVerification(requirement.platform),
      submissionAnswers: submission?.submissionAnswers || appReviewSubmissionAnswers({
        platform: requirement.platform,
        label: requirement.label,
        requestedScopes,
        redirectUri: buildRedirectUri(requirement.platform),
        privacyPolicyUrl: input.legalPolicyPack.privacyUrl,
        termsUrl: input.legalPolicyPack.termsUrl,
        demoUrl: input.appReviewDemoPack.demoUrl,
        accountHandles: [],
      }),
      submissionChecklist,
      portalFlow: developerApplicationPortalFlow({
        platform: requirement.platform,
        appName: developerApplicationAppName(requirement.platform),
        redirectUri: buildRedirectUri(requirement.platform),
        privacyPolicyUrl: input.legalPolicyPack.privacyUrl,
        termsUrl: input.legalPolicyPack.termsUrl,
        demoUrl: input.appReviewDemoPack.demoUrl,
        scopes: requestedScopes,
      }),
      approvalCriteria: developerApplicationApprovalCriteria(requirement.platform),
      postApprovalSteps: developerApplicationPostApprovalSteps(requirement.platform),
      requiredInputs: developerApplicationRequiredInputs({
        platform: requirement.platform,
        requestedScopes,
        redirectUri: buildRedirectUri(requirement.platform),
        privacyPolicyUrl: input.legalPolicyPack.privacyUrl,
        termsUrl: input.legalPolicyPack.termsUrl,
        demoUrl: input.appReviewDemoPack.demoUrl,
      }),
      completionHint: developerApplicationCompletionHint(requirement.platform),
      evidenceBatchRow: submittedEvidenceBatchRow,
      draftEvidenceBatchRow,
      submittedEvidenceBatchRow,
      approvedEvidenceBatchRow,
      evidenceRecipeRow: developerApplicationEvidenceRecipeRow(requirement.platform, input.productionUrlSetup.publicBaseUrl, input.productionUrlSetup.productionUrlReady),
      credentialCopyMap: developerApplicationCredentialCopyMap(requirement.platform),
      portalSubmissionSteps: [],
      appVaultChecklist: developerApplicationAppVaultChecklist(requirement.platform),
      accountPrerequisites: official?.accountPrerequisites || requirement.humanRequired,
      developerPrerequisites: official?.developerPrerequisites || requirement.humanRequired,
      blockers,
      nextStep: blockers[0] || `Abrir ${requirement.developerPortalUrl}, crear la app y enviar App Review con este borrador.`,
    };
    return {
      ...draftItem,
      portalSubmissionSteps: developerApplicationPortalSubmissionSteps(draftItem),
    };
  });
  const creationSession = buildDeveloperApplicationCreationSession(items);
  const totals = items.reduce<ClipperDeveloperApplicationDraftsSummary["totals"]>((sum, item) => {
    sum.platforms += 1;
    if (item.status === "ready") sum.ready += 1;
    if (item.status === "blocked") sum.blocked += 1;
    sum.scopes += item.requestedScopes.length;
    sum.checklistItems += item.submissionChecklist.length;
    return sum;
  }, { platforms: 0, ready: 0, blocked: 0, scopes: 0, checklistItems: 0, sessionSteps: 0 });
  totals.sessionSteps = creationSession.reduce((sum, item) => sum + item.portalFields.length + item.doneCriteria.length, 0);
  const generatedAt = await stat(DEVELOPER_APPLICATION_DRAFTS_PATH).then((file) => file.mtime.toISOString()).catch(() => null);
  return {
    status: !generatedAt ? "not_prepared" : totals.blocked > 0 ? "blocked" : "ready",
    generatedAt,
    manifestPath: DEVELOPER_APPLICATION_DRAFTS_PATH,
    markdownPath: DEVELOPER_APPLICATION_DRAFTS_MARKDOWN_PATH,
    sourceCheckedAt: "2026-06-17",
    items,
    creationSession,
    totals,
    nextStep: items.find((item) => item.status !== "ready")?.nextStep || "Developer application drafts listos; enviar review y registrar evidencia.",
  };
}

function renderDeveloperApplicationDraftsMarkdown(summary: ClipperDeveloperApplicationDraftsSummary): string {
  return [
    "# Clippers Developer Application Drafts",
    "",
    `Status: ${summary.status}`,
    `Generated: ${summary.generatedAt || new Date().toISOString()}`,
    `Official sources checked: ${summary.sourceCheckedAt}`,
    `Totals: ${summary.totals.ready}/${summary.totals.platforms} ready; ${summary.totals.scopes} scopes; ${summary.totals.checklistItems} checklist items; ${summary.totals.sessionSteps} session steps`,
    "",
    "## Next Step",
    "",
    summary.nextStep,
    "",
    "## Developer App Creation Session",
    "",
    ...summary.creationSession.flatMap((item) => [
      `### ${item.rank}. ${item.label}`,
      "",
      `- Platform: ${item.platform}`,
      `- Status: ${item.status}`,
      `- Portal: ${item.developerPortalUrl}`,
      `- App name: ${item.appName}`,
      `- App type: ${item.appType}`,
      `- Redirect URI: ${item.redirectUri}`,
      `- Requested scopes: ${item.requestedScopes.join(", ")}`,
      `- Credential env groups: ${item.credentialEnvGroups.join("; ")}`,
      `- Draft evidence row: ${item.draftEvidenceBatchRow}`,
      `- Evidence batch row: ${item.evidenceBatchRow}`,
      `- Submitted evidence row: ${item.submittedEvidenceBatchRow}`,
      `- Approved evidence row: ${item.approvedEvidenceBatchRow}`,
      `- Evidence recipe row: ${item.evidenceRecipeRow}`,
      `- Next step: ${item.nextStep}`,
      "",
      "Portal fields:",
      ...item.portalFields.map((field) => `- ${field.label}: ${field.value}`),
      "",
      "Credential copy map:",
      ...item.credentialCopyMap.map((field) => `- ${field.envVarGroup}: ${field.portalField}. ${field.storageRule}`),
      "",
      "Portal submission steps:",
      ...item.portalSubmissionSteps.map((step) => `- [ ] ${step}`),
      "",
      "App vault checklist:",
      ...item.appVaultChecklist.map((step) => `- [ ] ${step}`),
      "",
      "Evidence needed:",
      ...item.evidenceNeeded.map((evidence) => `- [ ] ${evidence}`),
      "",
      "Done criteria:",
      ...item.doneCriteria.map((criterion) => `- [ ] ${criterion}`),
      "",
    ]),
    "## Platform Drafts",
    "",
    ...summary.items.flatMap((item) => [
      `### ${item.label}`,
      "",
      `- Platform: ${item.platform}`,
      `- Status: ${item.status}`,
      `- Portal: ${item.developerPortalUrl}`,
      `- Suggested app name: ${item.appName}`,
      `- App type: ${item.appType}`,
      `- Redirect URI: ${item.redirectUri}`,
      `- Privacy Policy URL: ${item.privacyPolicyUrl}`,
      `- Terms URL: ${item.termsUrl}`,
      `- Demo URL: ${item.demoUrl}`,
      `- Requested scopes: ${item.requestedScopes.join(", ")}`,
      `- Official verification: ${item.officialVerification}`,
      `- Completion hint: ${item.completionHint}`,
      `- Draft evidence row: ${item.draftEvidenceBatchRow}`,
      `- Evidence batch row: ${item.evidenceBatchRow}`,
      `- Submitted evidence row: ${item.submittedEvidenceBatchRow}`,
      `- Approved evidence row: ${item.approvedEvidenceBatchRow}`,
      `- Evidence recipe row: ${item.evidenceRecipeRow}`,
      `- Next step: ${item.nextStep}`,
      "",
      "Credential copy map:",
      ...item.credentialCopyMap.map((field) => `- ${field.envVarGroup}: ${field.portalField}. ${field.storageRule}`),
      "",
      "Portal submission steps:",
      ...item.portalSubmissionSteps.map((step) => `- [ ] ${step}`),
      "",
      "App vault checklist:",
      ...item.appVaultChecklist.map((step) => `- [ ] ${step}`),
      "",
      "Required inputs:",
      ...item.requiredInputs.map((input) => `- [ ] ${input}`),
      "",
      "Portal flow:",
      ...item.portalFlow.map((step) => `- [ ] ${step}`),
      "",
      "Approval criteria:",
      ...item.approvalCriteria.map((step) => `- [ ] ${step}`),
      "",
      "Post-approval steps:",
      ...item.postApprovalSteps.map((step) => `- [ ] ${step}`),
      "",
      "Submission checklist:",
      ...item.submissionChecklist.map((step) => `- [ ] ${step}`),
      "",
      "Copy-ready answers:",
      ...item.submissionAnswers.flatMap((answer) => [
        `- ${answer.prompt}`,
        `  ${answer.response}`,
      ]),
      "",
      "Account prerequisites:",
      ...item.accountPrerequisites.map((step) => `- ${step}`),
      "",
      "Developer prerequisites:",
      ...item.developerPrerequisites.map((step) => `- ${step}`),
      "",
      item.blockers.length ? "Blockers:" : "Blockers: none",
      ...item.blockers.map((blocker) => `- ${blocker}`),
      "",
      "Official docs:",
      ...item.officialDocs.map((doc) => `- ${doc}`),
      "",
    ]),
  ].join("\n");
}

export async function prepareClipperDeveloperApplicationDrafts(userId = getSystemUserId()): Promise<{ developerApplicationDrafts: ClipperDeveloperApplicationDraftsSummary; status: ClipperStatus }> {
  await writeDefaultConfigIfMissing();
  await ensureClipperDirs();
  const config = await readConfig();
  const oauthConnections = await readOAuthConnections();
  const tokenRecords = await readTokenVaultRecords();
  const accounts = applyOAuthStateToAccounts(
    (Array.isArray(config.accounts) && config.accounts.length ? config.accounts : DEFAULT_ACCOUNTS).map(ensureAccountShape),
    oauthConnections,
    tokenRecords
  );
  const developerAppEvidence = await buildDeveloperAppEvidenceSummary();
  const officialPermissionMatrix = await buildOfficialPermissionMatrixSummary();
  const productionUrlSetup = await buildProductionUrlSetupSummary();
  const legalPolicyPack = await buildLegalPolicyPackSummary();
  const appReviewDemoPack = await buildAppReviewDemoPackSummary();
  const appReviewSubmissionPack = await buildAppReviewSubmissionPackSummary({ accounts, officialPermissionMatrix, productionUrlSetup, developerAppEvidence, legalPolicyPack, appReviewDemoPack });
  const draftSummary = await buildDeveloperApplicationDraftsSummary({ officialPermissionMatrix, appReviewSubmissionPack, legalPolicyPack, appReviewDemoPack, productionUrlSetup });
  const developerApplicationDrafts: ClipperDeveloperApplicationDraftsSummary = {
    ...draftSummary,
    generatedAt: new Date().toISOString(),
    status: draftSummary.totals.blocked > 0 ? "blocked" : "ready",
  };
  await writeFile(DEVELOPER_APPLICATION_DRAFTS_PATH, JSON.stringify(developerApplicationDrafts, null, 2));
  await writeFile(DEVELOPER_APPLICATION_DRAFTS_MARKDOWN_PATH, renderDeveloperApplicationDraftsMarkdown(developerApplicationDrafts));
  return { developerApplicationDrafts, status: await getClipperStatus(userId) };
}

async function buildOfficialPermissionMatrixSummary(): Promise<ClipperOfficialPermissionMatrixSummary> {
  await ensureClipperDirs();
  const generatedAt = await stat(OFFICIAL_PERMISSION_MATRIX_PATH).then((file) => file.mtime.toISOString()).catch(() => null);
  const items = enrichOfficialPermissionMatrixItems(OFFICIAL_PERMISSION_MATRIX_ITEMS);
  const totals = items.reduce<ClipperOfficialPermissionMatrixSummary["totals"]>((sum, item) => {
    sum.platforms += 1;
    if (item.sourceStatus === "official_verified") sum.officialVerified += 1;
    if (item.sourceStatus === "official_login_required") sum.loginRequired += 1;
    sum.scopes += item.scopes.length;
    sum.appReviewRequired += item.scopes.filter((scope) => scope.appReviewRequired).length;
    return sum;
  }, { platforms: 0, officialVerified: 0, loginRequired: 0, scopes: 0, appReviewRequired: 0 });
  return {
    status: !generatedAt
      ? "not_prepared"
      : totals.loginRequired > 0
        ? "needs_review"
        : "verified",
    generatedAt,
    manifestPath: OFFICIAL_PERMISSION_MATRIX_PATH,
    markdownPath: OFFICIAL_PERMISSION_MATRIX_MARKDOWN_PATH,
    verifiedAt: new Date().toISOString(),
    items,
    totals,
    nextStep: totals.loginRequired > 0
      ? "Revisar Meta con sesion iniciada y confirmar que los permisos siguen iguales antes de enviar App Review."
      : "Matriz oficial lista; usarla para completar developer apps, scopes y OAuth.",
  };
}

function officialPermissionPortalSubmissionSteps(item: ClipperOfficialPermissionMatrixItem, scope: ClipperOfficialPermissionMatrixItem["scopes"][number]): string[] {
  return [
    `Open ${scope.requestPortalUrl} and select the developer app for ${item.label}.`,
    `Confirm account prerequisites before submission: ${item.accountPrerequisites.join(" | ")}.`,
    `Confirm developer prerequisites before submission: ${item.developerPrerequisites.join(" | ")}.`,
    `Request ${scope.scope} with this purpose: ${scope.purpose}.`,
    `Attach evidence: ${scope.evidenceRequired.join(" | ")}.`,
    `Import requested evidence row: ${scope.launchEvidenceBatchRow}.`,
    `After approval, import approved evidence row: permission,,${item.platform},approved,${scope.scope},,,Official permission approved; attach approval screenshot or review URL.`,
    "Regenerate Command Center, Publisher Connectors and Platform Portal Checklist.",
  ];
}

function officialPermissionPostApprovalChecklist(item: ClipperOfficialPermissionMatrixItem, scope: ClipperOfficialPermissionMatrixItem["scopes"][number]): string[] {
  return [
    `Run OAuth for ${item.platform} and confirm the token includes ${scope.scope}.`,
    "Save the token encrypted in Clippers Token Vault.",
    "Run publisher connector preflight for the platform.",
    scope.requiredForAutopost
      ? "Run one approval_required dry run before enabling autopost."
      : "Keep this permission as fallback/manual support unless autopost explicitly needs it.",
  ];
}

function officialPermissionComplianceRisk(item: ClipperOfficialPermissionMatrixItem, scope: ClipperOfficialPermissionMatrixItem["scopes"][number]): string {
  const platformRisk = item.reviewRisks[0] || "Platform review may reject incomplete evidence or unclear publishing purpose.";
  return `${platformRisk} Scope ${scope.scope} should only be requested with matching demo evidence and rights-safe sample content.`;
}

function officialPermissionFallbackPlan(item: ClipperOfficialPermissionMatrixItem, scope: ClipperOfficialPermissionMatrixItem["scopes"][number]): string {
  if (!scope.requiredForAutopost) return `Use ${scope.scope} only as fallback support while the autopost permission remains under review.`;
  if (item.platform === "youtube") return "Use manual YouTube Studio upload package until youtube.upload OAuth and API audit are ready.";
  if (item.platform === "instagram") return "Use Manual Posting Pack for Reels until Meta App Review and connected Professional account are approved.";
  return "Use TikTok manual/draft posting package until Direct Post audit lifts visibility restrictions.";
}

function officialPermissionSourceAudit(item: ClipperOfficialPermissionMatrixItem, scope: ClipperOfficialPermissionMatrixItem["scopes"][number]): NonNullable<ClipperOfficialPermissionMatrixItem["scopes"][number]["sourceAudit"]> {
  const loginRequired = item.sourceStatus === "official_login_required" || scope.verificationStatus === "official_login_required";
  const publicEvidence = item.platform === "tiktok"
    ? [
      "TikTok public docs expose Content Posting API prerequisites, Direct Post setup, video.publish approval, user authorization and unaudited-client visibility restrictions.",
      scope.scope === "video.upload"
        ? "TikTok public scope reference lists video.upload as draft upload/sharing support."
        : "TikTok public Content Posting API guide lists video.publish approval and user authorization for Direct Post.",
    ]
    : item.platform === "youtube"
      ? [
        "YouTube public videos.insert docs identify uploads through videos.insert and warn unverified API projects may be restricted to private visibility.",
        "YouTube public samples use the youtube.upload scope for uploading to the authenticated channel.",
      ]
      : [
        "Meta permission/content publishing docs require authenticated developer login in the current public check.",
        "Confirm instagram_content_publish, instagram_basic and pages_show_list inside Meta App Review before submitting.",
      ];
  return {
    lastCheckedAt: "2026-06-17",
    accessMode: loginRequired ? "login_required" : "public",
    canonicalUrl: scope.officialReferenceUrl,
    publicEvidence,
    needsHumanRecheck: loginRequired,
    goLiveDecision: loginRequired ? "login_required_before_request" : "ready_to_request",
  };
}

function officialPermissionSourceProofPack(item: ClipperOfficialPermissionMatrixItem, scope: ClipperOfficialPermissionMatrixItem["scopes"][number]): NonNullable<ClipperOfficialPermissionMatrixItem["scopes"][number]["sourceProofPack"]> {
  if (item.platform === "tiktok") {
    const verifiedClaims = scope.scope === "video.upload"
      ? [
        "Official TikTok scopes reference lists video.upload as draft/upload sharing support.",
        "Content Posting API docs list Upload separately from Direct Post.",
        "Use this scope as fallback until Direct Post/public visibility audit is complete.",
      ]
      : [
        "Official TikTok Content Posting API docs list registered app, Content Posting API product and Direct Post configuration as prerequisites.",
        "Official docs require app approval for video.publish and target-user authorization for video.publish.",
        "Official docs warn unaudited clients are restricted to private viewing mode until audit passes.",
      ];
    return {
      status: "ready_to_attach",
      checkedAt: "2026-06-17",
      officialUrls: item.officialDocs,
      verifiedClaims,
      submitDecision: "request_now",
      blocker: null,
      reviewerEvidence: [
        "Attach Content Posting API product screenshot.",
        `Attach scope request or approval screenshot for ${scope.scope}.`,
        "Attach approval_required demo and rights-gate evidence before requesting public autopost.",
      ],
    };
  }
  if (item.platform === "youtube") {
    return {
      status: "ready_to_attach",
      checkedAt: "2026-06-17",
      officialUrls: item.officialDocs,
      verifiedClaims: [
        "Official YouTube videos.insert reference supports uploading videos through the YouTube Data API.",
        "Official upload guide requires a Google API project and OAuth 2.0 client credentials file.",
        "Official sample uses the youtube.upload OAuth scope for authenticated upload.",
      ],
      submitDecision: "request_now",
      blocker: null,
      reviewerEvidence: [
        "Attach YouTube Data API enabled screenshot.",
        "Attach OAuth consent screen and redirect URI evidence.",
        "Attach proof that each managed channel authorized youtube.upload before automated uploads.",
      ],
    };
  }
  return {
    status: "login_required",
    checkedAt: "2026-06-17",
    officialUrls: item.officialDocs,
    verifiedClaims: [
      "Meta developer documentation was reachable only as an authenticated/login-required developer surface in the current check.",
      "Confirm instagram_content_publish, instagram_basic and pages_show_list inside Meta App Review before submitting.",
      "Confirm Instagram Professional account and connected Facebook Page prerequisites inside the Meta developer app.",
    ],
    submitDecision: "human_login_recheck",
    blocker: "Meta Developers login required to verify permission availability and exact App Review prompts.",
    reviewerEvidence: [
      "Attach Meta App Review permission selection screenshot after logging in.",
      "Attach Professional Instagram account and connected Facebook Page proof.",
      "Attach app review screencast showing approval_required publishing flow.",
    ],
  };
}

function enrichOfficialPermissionMatrixItems(items: ClipperOfficialPermissionMatrixItem[]): ClipperOfficialPermissionMatrixItem[] {
  return items.map((item) => ({
    ...item,
    scopes: item.scopes.map((scope) => ({
      ...scope,
      portalSubmissionSteps: officialPermissionPortalSubmissionSteps(item, scope),
      approvalEvidenceBatchRow: `permission,,${item.platform},approved,${scope.scope},,,Official permission approved; attach approval screenshot or review URL`,
      postApprovalChecklist: officialPermissionPostApprovalChecklist(item, scope),
      complianceRisk: officialPermissionComplianceRisk(item, scope),
      fallbackPlan: officialPermissionFallbackPlan(item, scope),
      sourceAudit: officialPermissionSourceAudit(item, scope),
      sourceProofPack: officialPermissionSourceProofPack(item, scope),
    })),
  }));
}

function renderOfficialPermissionMatrixMarkdown(summary: ClipperOfficialPermissionMatrixSummary): string {
  return [
    "# Clippers Official Permission Matrix",
    "",
    `Status: ${summary.status}`,
    `Generated: ${summary.generatedAt || summary.verifiedAt}`,
    `Verified at: ${summary.verifiedAt}`,
    `Totals: ${summary.totals.platforms} platforms, ${summary.totals.scopes} scopes, ${summary.totals.appReviewRequired} app-review scopes`,
    "",
    "## Next Step",
    "",
    summary.nextStep,
    "",
    "## Platforms",
    "",
    ...summary.items.flatMap((item) => [
      `### ${item.label}`,
      "",
      `- Platform: ${item.platform}`,
      `- Source status: ${item.sourceStatus}`,
      `- API endpoint hint: ${item.apiEndpointHint}`,
      `- Next step: ${item.nextStep}`,
      "",
      "Official docs:",
      ...item.officialDocs.map((doc) => `- ${doc}`),
      "",
      "Scopes:",
      ...item.scopes.flatMap((scope) => [
        `- ${scope.scope}: ${scope.purpose} Autopost: ${scope.requiredForAutopost ? "yes" : "no"}. App review: ${scope.appReviewRequired ? "yes" : "no"}.`,
        `  - Verification: ${scope.verificationStatus} at ${scope.verifiedAt}`,
        `  - Official reference: ${scope.officialReferenceUrl}`,
        `  - Verification note: ${scope.verificationNote}`,
        `  - Portal: ${scope.requestPortalUrl}`,
        `  - Request action: ${scope.requestAction}`,
        `  - Launch Evidence Batch: ${scope.launchEvidenceBatchRow}`,
        `  - Approval Evidence Batch: ${scope.approvalEvidenceBatchRow || "n/a"}`,
        `  - Compliance risk: ${scope.complianceRisk || "n/a"}`,
        `  - Fallback plan: ${scope.fallbackPlan || "n/a"}`,
        `  - Source audit: ${scope.sourceAudit?.accessMode || "n/a"} checked ${scope.sourceAudit?.lastCheckedAt || "n/a"} at ${scope.sourceAudit?.canonicalUrl || "n/a"}`,
        `  - Go-live decision: ${scope.sourceAudit?.goLiveDecision || "n/a"}`,
        "  - Public/source evidence:",
        ...(scope.sourceAudit?.publicEvidence || []).map((evidence) => `    - ${evidence}`),
        "  - Source proof pack:",
        `    - Status: ${scope.sourceProofPack?.status || "n/a"}`,
        `    - Submit decision: ${scope.sourceProofPack?.submitDecision || "n/a"}`,
        `    - Blocker: ${scope.sourceProofPack?.blocker || "none"}`,
        "    - Official URLs:",
        ...(scope.sourceProofPack?.officialUrls || []).map((url) => `      - ${url}`),
        "    - Verified claims:",
        ...(scope.sourceProofPack?.verifiedClaims || []).map((claim) => `      - ${claim}`),
        "    - Reviewer evidence:",
        ...(scope.sourceProofPack?.reviewerEvidence || []).map((evidence) => `      - ${evidence}`),
        "  - Portal submission steps:",
        ...(scope.portalSubmissionSteps || []).map((step) => `    - [ ] ${step}`),
        "  - Verification checklist:",
        ...scope.verificationChecklist.map((step) => `    - [ ] ${step}`),
        "  - Post-approval checklist:",
        ...(scope.postApprovalChecklist || []).map((step) => `    - [ ] ${step}`),
        "  - Evidence required:",
        ...scope.evidenceRequired.map((evidence) => `    - ${evidence}`),
      ]),
      "",
      "Account prerequisites:",
      ...item.accountPrerequisites.map((step) => `- [ ] ${step}`),
      "",
      "Developer prerequisites:",
      ...item.developerPrerequisites.map((step) => `- [ ] ${step}`),
      "",
      "Review risks:",
      ...item.reviewRisks.map((risk) => `- ${risk}`),
      "",
      "Evidence to prepare:",
      ...item.evidenceToPrepare.map((evidence) => `- [ ] ${evidence}`),
      "",
    ]),
  ].join("\n");
}

export async function prepareClipperOfficialPermissionMatrix(userId = getSystemUserId()): Promise<{ officialPermissionMatrix: ClipperOfficialPermissionMatrixSummary; status: ClipperStatus }> {
  await writeDefaultConfigIfMissing();
  await ensureClipperDirs();
  const draftSummary = await buildOfficialPermissionMatrixSummary();
  const officialPermissionMatrix: ClipperOfficialPermissionMatrixSummary = {
    ...draftSummary,
    generatedAt: new Date().toISOString(),
    status: draftSummary.totals.loginRequired > 0 ? "needs_review" : "verified",
  };
  await writeFile(OFFICIAL_PERMISSION_MATRIX_PATH, JSON.stringify(officialPermissionMatrix, null, 2));
  await writeFile(OFFICIAL_PERMISSION_MATRIX_MARKDOWN_PATH, renderOfficialPermissionMatrixMarkdown(officialPermissionMatrix));
  return { officialPermissionMatrix, status: await getClipperStatus(userId) };
}

async function buildPublisherConnectorSummary(input: {
  tokenRecords: ClipperTokenVaultRecord[];
  permissionTracker: ClipperPermissionTrackerSummary;
  platformReadiness: ClipperPlatformReadinessSummary;
  productionQueue: ClipperProductionQueueSummary;
}): Promise<ClipperPublisherConnectorSummary> {
  await ensureClipperDirs();
  const items = PUBLISHER_CONNECTOR_DEFINITIONS.map((definition) => {
    const tokenRecord = input.tokenRecords.find((record) => record.platform === definition.platform);
    const permissionItems = input.permissionTracker.items.filter((item) => item.platform === definition.platform && definition.requiredScopes.includes(item.scope));
    const permissionsApproved = permissionItems.filter((item) => item.status === "approved").length;
    const readiness = input.platformReadiness.items.find((item) => item.platform === definition.platform);
    const publishableQueueItems = input.productionQueue.items.filter((item) =>
      item.status === "draft_ready" &&
      item.platforms.some((platform) => normalizePlatformLabel(platform) === definition.platform)
    ).length;
    const goLiveChecks = [
      {
        id: "account-evidence",
        label: "Cuenta externa verificada",
        done: (readiness?.accountsVerified || 0) > 0,
        evidence: `${readiness?.accountsVerified || 0} cuentas verificadas para ${definition.platform}.`,
      },
      {
        id: "developer-app",
        label: "Developer app aprobada",
        done: readiness?.developerAppStatus === "approved",
        evidence: `Developer app status: ${readiness?.developerAppStatus || "missing"}.`,
      },
      {
        id: "permissions",
        label: "Scopes de publicacion aprobados",
        done: permissionsApproved === definition.requiredScopes.length,
        evidence: `${permissionsApproved}/${definition.requiredScopes.length} scopes aprobados.`,
      },
      {
        id: "token",
        label: "OAuth token cifrado",
        done: Boolean(tokenRecord),
        evidence: tokenRecord ? `Token guardado ${tokenRecord.savedAt}.` : "Token OAuth cifrado no encontrado.",
      },
      {
        id: "content",
        label: "Clips con rights gate listo",
        done: publishableQueueItems > 0,
        evidence: `${publishableQueueItems} queue items draft_ready para ${definition.platform}.`,
      },
      {
        id: "compliance",
        label: "Approval required antes de autopost",
        done: true,
        evidence: "El primer ciclo debe correr en approval_required antes de habilitar autopost.",
      },
    ];
    const blockingCategories: ClipperPublisherBlockingCategory[] = [
      ...((readiness?.accountsVerified || 0) > 0 ? [] : ["account" as const]),
      ...(readiness?.developerAppStatus === "approved" ? [] : ["developer_app" as const]),
      ...(readiness?.credentialStatus === "ready" ? [] : ["credential" as const]),
      ...(permissionsApproved === definition.requiredScopes.length ? [] : ["permission" as const]),
      ...(tokenRecord ? [] : ["token" as const]),
      ...(publishableQueueItems > 0 ? [] : ["content" as const]),
    ];
    const proofNeeded = goLiveChecks.filter((check) => !check.done).map((check) => `${check.label}: ${check.evidence}`);
    const blockers = [
      ...(tokenRecord ? [] : [`Falta token OAuth cifrado para ${definition.platform}.`]),
      ...(permissionsApproved === definition.requiredScopes.length ? [] : [`${permissionsApproved}/${definition.requiredScopes.length} scopes de publicacion aprobados.`]),
      ...(readiness?.status === "ready" ? [] : [`Platform readiness ${readiness?.status || "blocked"}.`]),
      ...(publishableQueueItems > 0 ? [] : [`0 clips draft_ready con rights gate para ${definition.platform}.`]),
    ];
    const status: ClipperPublisherConnectorStatus = blockers.length === 0
      ? "ready"
      : tokenRecord || permissionsApproved > 0 || readiness?.status === "partial" || publishableQueueItems > 0
        ? "partial"
        : "blocked";
    const publishGate: ClipperPublisherConnectorItem["publishGate"] = status === "ready"
      ? "approval_required_ready"
      : tokenRecord && permissionsApproved > 0 && publishableQueueItems > 0
        ? "dry_run_ready"
        : "blocked";
    return {
      ...definition,
      status,
      tokenSaved: Boolean(tokenRecord),
      permissionsApproved,
      permissionsTotal: definition.requiredScopes.length,
      publishableQueueItems,
      publishGate,
      blockingCategories: Array.from(new Set(blockingCategories)),
      proofNeeded,
      goLiveChecks,
      blockers,
      nextStep: status === "ready"
        ? "Connector listo para dry-run controlado y approval_required."
        : blockers[0] || "Completar preflight de plataforma.",
    };
  });
  const totals = items.reduce<ClipperPublisherConnectorSummary["totals"]>((sum, item) => {
    sum.platforms += 1;
    if (item.status === "ready") sum.ready += 1;
    if (item.status === "partial") sum.partial += 1;
    if (item.status === "blocked") sum.blocked += 1;
    return sum;
  }, { platforms: 0, ready: 0, partial: 0, blocked: 0 });
  const generatedAt = await stat(PUBLISHER_CONNECTORS_PATH).then((file) => file.mtime.toISOString()).catch(() => null);
  return {
    status: !generatedAt
      ? "not_prepared"
      : totals.ready === totals.platforms && totals.platforms > 0
        ? "ready"
        : totals.ready > 0 || totals.partial > 0
          ? "partial"
          : "blocked",
    generatedAt,
    manifestPath: PUBLISHER_CONNECTORS_PATH,
    markdownPath: PUBLISHER_CONNECTORS_MARKDOWN_PATH,
    items,
    totals,
    nextStep: items.find((item) => item.status !== "ready")?.nextStep || "Connectors listos; correr ciclo approval_required antes de autopost.",
  };
}

function renderPublisherConnectorMarkdown(summary: ClipperPublisherConnectorSummary): string {
  return [
    "# Clippers Publisher Connectors",
    "",
    `Status: ${summary.status}`,
    `Generated: ${summary.generatedAt || new Date().toISOString()}`,
    `Totals: ${summary.totals.ready} ready, ${summary.totals.partial} partial, ${summary.totals.blocked} blocked`,
    "",
    "## Next Step",
    "",
    summary.nextStep,
    "",
    "## Platforms",
    "",
    ...summary.items.flatMap((item) => [
      `### ${item.label}`,
      "",
      `- Platform: ${item.platform}`,
      `- Status: ${item.status}`,
      `- Endpoint: ${item.endpoint}`,
      `- Method: ${item.method}`,
      `- Mode: ${item.mode}`,
      `- Token saved: ${item.tokenSaved ? "yes" : "no"}`,
      `- Permissions approved: ${item.permissionsApproved}/${item.permissionsTotal}`,
      `- Publish gate: ${item.publishGate}`,
      `- Publishable queue items: ${item.publishableQueueItems}`,
      `- Blocking categories: ${item.blockingCategories.length ? item.blockingCategories.join(", ") : "none"}`,
      `- Required scopes: ${item.requiredScopes.join(", ")}`,
      `- Next step: ${item.nextStep}`,
      "",
      "Go-live checks:",
      ...item.goLiveChecks.map((check) => `- [${check.done ? "x" : " "}] ${check.label}: ${check.evidence}`),
      "",
      item.proofNeeded.length ? "Proof needed:" : "Proof needed: none",
      ...item.proofNeeded.map((proof) => `- ${proof}`),
      "",
      "Payload fields:",
      ...item.payloadFields.map((field) => `- ${field}`),
      "",
      "Preflight checks:",
      ...item.preflightChecks.map((check) => `- [ ] ${check}`),
      "",
      item.blockers.length ? "Blockers:" : "Blockers: none",
      ...item.blockers.map((blocker) => `- ${blocker}`),
      "",
    ]),
  ].join("\n");
}

export async function prepareClipperPublisherConnectors(userId = getSystemUserId()): Promise<{ publisherConnectors: ClipperPublisherConnectorSummary; status: ClipperStatus }> {
  await writeDefaultConfigIfMissing();
  await ensureClipperDirs();
  const config = await readConfig();
  const oauthConnections = await readOAuthConnections();
  const tokenRecords = await readTokenVaultRecords();
  const accounts = applyOAuthStateToAccounts(
    (Array.isArray(config.accounts) && config.accounts.length ? config.accounts : DEFAULT_ACCOUNTS).map(ensureAccountShape),
    oauthConnections,
    tokenRecords
  );
  const credentialChecks = buildCredentialChecks();
  const permissionPack = await buildPermissionPackSummary();
  const accountEvidence = await buildAccountEvidenceSummary(accounts);
  const accountLaunchKit = await buildAccountLaunchKitSummary(accounts, accountEvidence);
  const developerAppEvidence = await buildDeveloperAppEvidenceSummary();
  const permissionTracker = await buildPermissionTrackerSummary({ accounts, credentialChecks, tokenRecords, oauthConnections, permissionPack, accountLaunchKit });
  const platformReadiness = await buildPlatformReadinessSummary({ credentialChecks, tokenRecords, accountLaunchKit, developerAppEvidence, permissionTracker });
  const productionQueue = await buildProductionQueueSummary(accounts);
  const draftSummary = await buildPublisherConnectorSummary({ tokenRecords, permissionTracker, platformReadiness, productionQueue });
  const publisherConnectors: ClipperPublisherConnectorSummary = {
    ...draftSummary,
    generatedAt: new Date().toISOString(),
    status: draftSummary.totals.ready === draftSummary.totals.platforms && draftSummary.totals.platforms > 0
      ? "ready"
      : draftSummary.totals.ready > 0 || draftSummary.totals.partial > 0
        ? "partial"
        : "blocked",
  };
  await writeFile(PUBLISHER_CONNECTORS_PATH, JSON.stringify(publisherConnectors, null, 2));
  await writeFile(PUBLISHER_CONNECTORS_MARKDOWN_PATH, renderPublisherConnectorMarkdown(publisherConnectors));
  return { publisherConnectors, status: await getClipperStatus(userId) };
}

async function buildProductionUrlSetupSummary(): Promise<ClipperProductionUrlSetupSummary> {
  const publicBaseUrl = getPublicBaseUrl();
  const productionUrlReady = isProductionPublicBaseUrl(publicBaseUrl);
  const normalizedBaseUrl = publicBaseUrl.replace(/\/$/, "");
  const productionUrlNote = productionUrlReady
    ? "PUBLIC_BASE_URL usa HTTPS y no apunta a localhost; apta para registrar redirect URIs y domain verification."
    : "PUBLIC_BASE_URL debe ser una URL publica HTTPS, no localhost/127.0.0.1, antes de pedir app review o publicar en produccion.";
  const blockers = [
    ...(productionUrlReady ? [] : [productionUrlNote]),
  ];
  const platforms: ClipperProductionUrlSetupPlatform[] = PLATFORM_REQUIREMENTS.map((requirement) => ({
    platform: requirement.platform,
    label: requirement.label,
    redirectUri: buildRedirectUri(requirement.platform),
    publicRedirectUri: `${normalizedBaseUrl}/api/clippers/oauth/${requirement.platform}/callback`,
    developerPortalUrl: requirement.developerPortalUrl,
    domainVerificationRequired: requirement.platform === "tiktok",
    publicLegalUrls: [`${normalizedBaseUrl}/clippers/legal/privacy`, `${normalizedBaseUrl}/clippers/legal/terms`],
    publicDemoUrl: `${normalizedBaseUrl}/clippers/review-demo`,
    evidenceRecipeRow: ["developer_app", "", requirement.platform, "submitted", "", "<developer app id/client key/project id>", productionUrlReady ? normalizedBaseUrl : "<public HTTPS base URL>", "<redirect URI + public URL evidence screenshot/proof URL>"].map(csvEscape).join(","),
    checklist: [
      `Registrar redirect URI exacto: ${normalizedBaseUrl}/api/clippers/oauth/${requirement.platform}/callback`,
      `Confirmar que ${normalizedBaseUrl} responde por HTTPS publico.`,
      `Confirmar Privacy URL: ${normalizedBaseUrl}/clippers/legal/privacy`,
      `Confirmar Terms URL: ${normalizedBaseUrl}/clippers/legal/terms`,
      `Confirmar Demo URL: ${normalizedBaseUrl}/clippers/review-demo`,
      requirement.platform === "tiktok"
        ? "Verificar domain/URL prefix para PULL_FROM_URL antes de usar uploads remotos."
        : requirement.platform === "instagram"
          ? "Configurar OAuth redirect URI en Meta App y validar permisos de Instagram Graph API."
          : "Registrar OAuth redirect URI en Google Cloud y completar verificacion/audit si aplica.",
      "Guardar evidencia de configuracion en Developer App Evidence.",
    ],
  }));
  const endpointChecks: ClipperProductionUrlEndpointCheck[] = [
    { id: "app", label: "Clippers app", url: `${normalizedBaseUrl}/clippers`, expected: "HTTP 200 and visible Clippers UI." },
    { id: "privacy", label: "Privacy Policy", url: `${normalizedBaseUrl}/clippers/legal/privacy`, expected: "HTTP 200 and public privacy policy page." },
    { id: "terms", label: "Terms of Service", url: `${normalizedBaseUrl}/clippers/legal/terms`, expected: "HTTP 200 and public terms page." },
    { id: "review-demo", label: "App Review Demo", url: `${normalizedBaseUrl}/clippers/review-demo`, expected: "HTTP 200 and public app review demo page." },
    ...PLATFORM_REQUIREMENTS.map((requirement) => ({
      id: `${requirement.platform}-callback`,
      label: `${requirement.label} OAuth callback`,
      url: `${normalizedBaseUrl}/api/clippers/oauth/${requirement.platform}/callback`,
      expected: "Public route reaches the app; platform will call this exact redirect URI after OAuth.",
    })),
  ];
  const saveChecklist = [
    "Pick a stable HTTPS origin that will not rotate during app review.",
    "Verify /clippers, Privacy, Terms and Review Demo are public before saving.",
    "Save only the origin, for example https://clippers.example.com, without trailing path.",
    "Regenerate Production URL Setup, Legal Policy Pack, Demo Pack and Developer Application Drafts.",
    "Register redirect URIs in TikTok, Meta and Google only after the saved URL is verified.",
  ];
  const setupSession: ClipperProductionUrlSetupSessionItem[] = [
    {
      rank: 1,
      id: "choose-public-url-strategy",
      label: "Choose stable public URL strategy",
      status: productionUrlReady ? "ready" : "blocked",
      owner: "Platform Ops",
      requiredValue: "Cloudflare Tunnel with owned domain, reserved ngrok domain, or stable managed deploy.",
      copyValue: publicBaseUrl,
      clipboardValues: [
        { label: "current_public_base_url", value: publicBaseUrl },
        { label: "recommended_pattern", value: "https://clippers.<owned-domain>" },
      ],
      portalUrl: null,
      verificationUrls: endpointChecks.slice(0, 4).map((check) => check.url),
      evidenceRecipeRow: ["developer_app", "", "tiktok", "draft", "", "<strategy: cloudflare/ngrok/deploy>", productionUrlReady ? normalizedBaseUrl : "<public HTTPS base URL>", "<public URL strategy + owner/operator note>"].map(csvEscape).join(","),
      evidenceNeeded: ["Chosen strategy, public HTTPS URL, and owner/operator note."],
      doneCriteria: ["A stable HTTPS URL is selected and will not rotate during app review/OAuth."],
      nextStep: productionUrlReady ? "URL strategy already set." : "Pick Cloudflare Tunnel, reserved ngrok domain, or managed deploy from HTTPS Tunnel Plan.",
    },
    {
      rank: 2,
      id: "record-public-base-url",
      label: "Record PUBLIC_BASE_URL",
      status: productionUrlReady ? "ready" : "blocked",
      owner: "Credential Ops",
      requiredValue: "A public HTTPS origin without localhost, 127.0.0.1 or .local.",
      copyValue: `PUBLIC_BASE_URL=${publicBaseUrl}`,
      clipboardValues: [
        { label: "env_row", value: `PUBLIC_BASE_URL=${publicBaseUrl}` },
        { label: "example_env_row", value: "PUBLIC_BASE_URL=https://clippers.<owned-domain>" },
      ],
      portalUrl: "/clippers#production-url",
      verificationUrls: endpointChecks.map((check) => check.url),
      evidenceRecipeRow: ["developer_app", "", "youtube", "draft", "", "<PUBLIC_BASE_URL saved>", productionUrlReady ? normalizedBaseUrl : "<public HTTPS base URL>", "<HTTP 200 checks for /clippers privacy terms demo callbacks>"].map(csvEscape).join(","),
      evidenceNeeded: ["Credential Setup/production URL save confirmation.", "HTTP 200 or accessible browser proof for /clippers."],
      doneCriteria: ["PUBLIC_BASE_URL is saved in an env file and Production URL Setup reports ready."],
      nextStep: productionUrlReady ? "PUBLIC_BASE_URL saved and valid." : "Paste the final HTTPS origin into PUBLIC_BASE_URL HTTPS and save.",
    },
    ...platforms.map<ClipperProductionUrlSetupSessionItem>((platform, index) => ({
      rank: index + 3,
      id: `register-${platform.platform}-redirect-uri`,
      label: `Register ${platform.label} redirect URI`,
      status: productionUrlReady ? "ready" : "blocked",
      owner: "Permission Ops",
      requiredValue: platform.redirectUri,
      copyValue: platform.redirectUri,
      clipboardValues: [
        { label: "redirect_uri", value: platform.publicRedirectUri },
        { label: "privacy_policy_url", value: platform.publicLegalUrls[0] },
        { label: "terms_url", value: platform.publicLegalUrls[1] },
        { label: "demo_url", value: platform.publicDemoUrl },
      ],
      portalUrl: platform.developerPortalUrl,
      verificationUrls: [platform.publicRedirectUri, ...platform.publicLegalUrls, platform.publicDemoUrl],
      evidenceRecipeRow: platform.evidenceRecipeRow,
      evidenceNeeded: [
        "Screenshot of exact redirect URI saved in developer portal.",
        platform.domainVerificationRequired ? "Domain or URL prefix verification proof." : "OAuth/app settings proof.",
      ],
      doneCriteria: [
        `Developer portal contains exact redirect URI ${platform.redirectUri}.`,
        "Developer App Evidence references this redirect URI and the public base URL.",
      ],
      nextStep: productionUrlReady ? `Register ${platform.redirectUri} in ${platform.developerPortalUrl}.` : "Wait for PUBLIC_BASE_URL public HTTPS, then register this redirect URI.",
    })),
  ];
  const generatedAt = await stat(PRODUCTION_URL_SETUP_PATH).then((file) => file.mtime.toISOString()).catch(() => null);
  return {
    status: !generatedAt ? "not_prepared" : productionUrlReady ? "ready" : "blocked",
    generatedAt,
    manifestPath: PRODUCTION_URL_SETUP_PATH,
    markdownPath: PRODUCTION_URL_SETUP_MARKDOWN_PATH,
    publicBaseUrl,
    productionUrlReady,
    productionUrlNote,
    requiredEnvVar: "PUBLIC_BASE_URL",
    requiredProtocol: "https",
    saveChecklist,
    endpointChecks,
    setupSession,
    platforms,
    blockers,
    nextStep: productionUrlReady
      ? "Registrar estos redirect URIs en TikTok, Meta y Google; luego correr OAuth Go-Live."
      : "Configurar PUBLIC_BASE_URL con una URL publica HTTPS y volver a generar este setup.",
  };
}

function renderProductionUrlSetupMarkdown(summary: ClipperProductionUrlSetupSummary): string {
  return [
    "# Clippers Production URL Setup",
    "",
    `Status: ${summary.status}`,
    `Generated: ${summary.generatedAt || new Date().toISOString()}`,
    `PUBLIC_BASE_URL: ${summary.publicBaseUrl}`,
    `Production URL ready: ${summary.productionUrlReady ? "yes" : "no"}`,
    `Required protocol: ${summary.requiredProtocol}`,
    "",
    "## Next Step",
    "",
    summary.nextStep,
    "",
    "## Note",
    "",
    summary.productionUrlNote,
    "",
    "## Save Checklist",
    "",
    ...summary.saveChecklist.map((step) => `- [ ] ${step}`),
    "",
    "## Endpoint Checks",
    "",
    ...summary.endpointChecks.map((check) => `- [ ] ${check.label}: ${check.url} (${check.expected})`),
    "",
    "## Setup Session",
    "",
    ...summary.setupSession.flatMap((item) => [
      `### ${item.rank}. ${item.label}`,
      "",
      `- Status: ${item.status}`,
      `- Owner: ${item.owner}`,
      `- Required value: ${item.requiredValue}`,
      `- Copy value: ${item.copyValue}`,
      `- Evidence recipe row: ${item.evidenceRecipeRow}`,
      item.portalUrl ? `- Portal: ${item.portalUrl}` : null,
      `- Next step: ${item.nextStep}`,
      "",
      "Clipboard values:",
      ...item.clipboardValues.map((field) => `- ${field.label}: ${field.value}`),
      "",
      "Verification URLs:",
      ...item.verificationUrls.map((url) => `- ${url}`),
      "",
      "Evidence needed:",
      ...item.evidenceNeeded.map((evidence) => `- [ ] ${evidence}`),
      "",
      "Done criteria:",
      ...item.doneCriteria.map((criterion) => `- [ ] ${criterion}`),
      "",
    ].filter((line): line is string => Boolean(line))),
    "## Platform Redirect URIs",
    "",
    ...summary.platforms.flatMap((platform) => [
      `### ${platform.label}`,
      "",
      `- Platform: ${platform.platform}`,
      `- Developer portal: ${platform.developerPortalUrl}`,
      `- Redirect URI: ${platform.redirectUri}`,
      `- Public redirect URI: ${platform.publicRedirectUri}`,
      `- Public demo URL: ${platform.publicDemoUrl}`,
      `- Public legal URLs: ${platform.publicLegalUrls.join(", ")}`,
      `- Evidence recipe row: ${platform.evidenceRecipeRow}`,
      `- Domain verification required: ${platform.domainVerificationRequired ? "yes" : "no"}`,
      "",
      "Checklist:",
      ...platform.checklist.map((item) => `- ${item}`),
      "",
    ]),
    summary.blockers.length ? "## Blockers" : "## Blockers",
    "",
    ...(summary.blockers.length ? summary.blockers.map((blocker) => `- ${blocker}`) : ["none"]),
    "",
  ].join("\n");
}

function productionUrlEndpointPass(check: ClipperProductionUrlEndpointCheck, statusCode: number): boolean {
  if (check.id.endsWith("-callback")) return statusCode >= 200 && statusCode < 500;
  return statusCode >= 200 && statusCode < 400;
}

function productionUrlFetchErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause = (error as Error & { cause?: unknown }).cause;
  if (cause instanceof Error && cause.message) return `${error.message}: ${cause.message}`;
  if (cause && typeof cause === "object" && "code" in cause) {
    const code = String((cause as { code?: unknown }).code || "");
    const syscall = String((cause as { syscall?: unknown }).syscall || "");
    return [error.message, code, syscall].filter(Boolean).join(": ");
  }
  return error.message;
}

function productionUrlHost(publicBaseUrl: string): string | null {
  try {
    return new URL(publicBaseUrl).hostname || null;
  } catch {
    return null;
  }
}

function productionUrlRootDomain(host: string | null): string | null {
  if (!host) return null;
  const parts = host.split(".").filter(Boolean);
  if (parts.length <= 2) return host;
  return parts.slice(-2).join(".");
}

function productionUrlDnsName(host: string | null): string {
  if (!host) return "<host>";
  const rootDomain = productionUrlRootDomain(host);
  return rootDomain && host === rootDomain ? "@" : host.replace(`.${rootDomain}`, "");
}

function buildProductionDnsRecordCandidates(host: string | null): ClipperProductionDnsRecordCandidate[] {
  if (!host) return [];
  const name = productionUrlDnsName(host);
  return [
    {
      id: "cloudflare-tunnel-cname",
      label: "Cloudflare Tunnel CNAME",
      recordType: "CNAME",
      name,
      value: "<cloudflare-tunnel-id>.cfargotunnel.com",
      ttl: 300,
      priority: "recommended",
      whenToUse: "Use this when the app is exposed through Cloudflare Tunnel. For apex domains, enable CNAME flattening if the DNS provider requires it.",
      copyLine: `${name} 300 IN CNAME <cloudflare-tunnel-id>.cfargotunnel.com`,
      validationCommand: `dig +short ${host} CNAME`,
    },
    {
      id: "deploy-host-cname",
      label: "Deploy hostname CNAME",
      recordType: "CNAME",
      name,
      value: "<deployment-or-custom-hostname>",
      ttl: 300,
      priority: "recommended",
      whenToUse: "Use this when Replit, Render, Vercel, Railway, or another host gives you a stable custom-domain target.",
      copyLine: `${name} 300 IN CNAME <deployment-or-custom-hostname>`,
      validationCommand: `dig +short ${host} CNAME`,
    },
    {
      id: "public-ip-a-record",
      label: "Public deploy IP A record",
      recordType: "A",
      name,
      value: "<public-deploy-ip>",
      ttl: 300,
      priority: "fallback",
      whenToUse: "Use this only when the host gives a stable public IP. Do not point it at 127.0.0.1 or a private LAN IP.",
      copyLine: `${name} 300 IN A <public-deploy-ip>`,
      validationCommand: `dig +short ${host} A`,
    },
  ];
}

function buildProductionDnsPropagationChecks(host: string | null, publicBaseUrl: string): string[] {
  if (!host) return ["Save a valid PUBLIC_BASE_URL first."];
  return [
    `dig +short ${host} A`,
    `dig +short ${host} AAAA`,
    `dig +short ${host} CNAME`,
    `curl -I ${publicBaseUrl}/clippers`,
    `curl -I ${publicBaseUrl}/api/clippers/oauth/tiktok/callback`,
  ];
}

function buildProductionDnsBlockedActions(host: string | null): string[] {
  const target = host || "<your-domain>";
  return [
    `Do not submit TikTok, Meta, or Google app review with ${target} until DNS resolves publicly.`,
    "Do not mark OAuth redirect URLs as approved until callback endpoints answer over HTTPS.",
    "Do not run automated publishing connectors until the public callback and legal/demo URLs pass verification.",
  ];
}

function buildDnsRegistrarChecklist(host: string | null): string[] {
  const target = host || "<your-domain>";
  return [
    `Open the DNS/registrar zone for ${target}.`,
    "Create an A record to your deploy IP or a CNAME to your tunnel/deploy hostname.",
    "If using Cloudflare Tunnel, point a CNAME at the tunnel hostname and keep proxy settings consistent with OAuth callbacks.",
    "Wait for propagation, then rerun Verify URL until DNS status is resolved and endpoint checks pass.",
    "Do not register platform redirect URIs until DNS resolves publicly.",
  ];
}

async function buildProductionDnsDiagnostic(publicBaseUrl: string): Promise<ClipperProductionDnsDiagnostic> {
  const host = productionUrlHost(publicBaseUrl);
  const rootDomain = productionUrlRootDomain(host);
  const recordCandidates = buildProductionDnsRecordCandidates(host);
  const propagationChecks = buildProductionDnsPropagationChecks(host, publicBaseUrl);
  const blockedUntilResolved = buildProductionDnsBlockedActions(host);
  const suggestedRecords = host
    ? recordCandidates.map((record) => `${host} ${record.ttl} IN ${record.recordType} ${record.value}`)
    : ["PUBLIC_BASE_URL must be a valid HTTPS origin before DNS can be checked."];
  if (!host) {
    return {
      host,
      rootDomain,
      isApexDomain: false,
      status: "invalid",
      addresses: [],
      recordTypesChecked: [],
      error: "PUBLIC_BASE_URL is not a valid URL.",
      suggestedRecords,
      recordCandidates,
      propagationChecks,
      registrarChecklist: buildDnsRegistrarChecklist(host),
      blockedUntilResolved,
      nextStep: "Save a valid HTTPS PUBLIC_BASE_URL, then rerun DNS verification.",
    };
  }
  try {
    const records = await dns.lookup(host, { all: true });
    return {
      host,
      rootDomain,
      isApexDomain: rootDomain === host,
      status: records.length ? "resolved" : "unresolved",
      addresses: records.map((record) => record.address),
      recordTypesChecked: ["A", "AAAA"],
      error: null,
      suggestedRecords,
      recordCandidates,
      propagationChecks,
      registrarChecklist: buildDnsRegistrarChecklist(host),
      blockedUntilResolved,
      nextStep: records.length
        ? "DNS resolves; fix any failing HTTP endpoint checks or app route/deploy issues."
        : "Add DNS records at the registrar and rerun verification after propagation.",
    };
  } catch (error) {
    return {
      host,
      rootDomain,
      isApexDomain: rootDomain === host,
      status: "unresolved",
      addresses: [],
      recordTypesChecked: ["A", "AAAA"],
      error: productionUrlFetchErrorMessage(error),
      suggestedRecords,
      recordCandidates,
      propagationChecks,
      registrarChecklist: buildDnsRegistrarChecklist(host),
      blockedUntilResolved,
      nextStep: "Add or fix DNS records for this host, then rerun Production URL verification.",
    };
  }
}

function normalizeProductionDnsDiagnostic(input: unknown, fallback: ClipperProductionDnsDiagnostic): ClipperProductionDnsDiagnostic {
  if (!input || typeof input !== "object") return fallback;
  const parsed = input as Partial<ClipperProductionDnsDiagnostic>;
  return {
    ...fallback,
    ...parsed,
    host: typeof parsed.host === "string" || parsed.host === null ? parsed.host : fallback.host,
    rootDomain: typeof parsed.rootDomain === "string" || parsed.rootDomain === null ? parsed.rootDomain : fallback.rootDomain,
    isApexDomain: typeof parsed.isApexDomain === "boolean" ? parsed.isApexDomain : fallback.isApexDomain,
    addresses: Array.isArray(parsed.addresses) ? parsed.addresses : fallback.addresses,
    recordTypesChecked: Array.isArray(parsed.recordTypesChecked) ? parsed.recordTypesChecked : fallback.recordTypesChecked,
    suggestedRecords: Array.isArray(parsed.suggestedRecords) ? parsed.suggestedRecords : fallback.suggestedRecords,
    recordCandidates: Array.isArray(parsed.recordCandidates) ? parsed.recordCandidates : fallback.recordCandidates,
    propagationChecks: Array.isArray(parsed.propagationChecks) ? parsed.propagationChecks : fallback.propagationChecks,
    registrarChecklist: Array.isArray(parsed.registrarChecklist) ? parsed.registrarChecklist : fallback.registrarChecklist,
    blockedUntilResolved: Array.isArray(parsed.blockedUntilResolved) ? parsed.blockedUntilResolved : fallback.blockedUntilResolved,
    nextStep: typeof parsed.nextStep === "string" ? parsed.nextStep : fallback.nextStep,
  };
}

async function checkProductionUrlEndpoint(check: ClipperProductionUrlEndpointCheck): Promise<ClipperProductionUrlVerificationItem> {
  const startedAt = Date.now();
  const checkedAt = new Date().toISOString();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(check.url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: { "user-agent": "clippers-production-url-verifier/1.0" },
    });
    const responseMs = Date.now() - startedAt;
    const status = productionUrlEndpointPass(check, response.status) ? "pass" : "fail";
    return {
      id: check.id,
      label: check.label,
      url: check.url,
      expected: check.expected,
      status,
      statusCode: response.status,
      responseMs,
      checkedAt,
      error: null,
      evidence: `${response.status} in ${responseMs}ms`,
    };
  } catch (error) {
    const responseMs = Date.now() - startedAt;
    return {
      id: check.id,
      label: check.label,
      url: check.url,
      expected: check.expected,
      status: "fail",
      statusCode: null,
      responseMs,
      checkedAt,
      error: productionUrlFetchErrorMessage(error),
      evidence: `Request failed after ${responseMs}ms`,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function summarizeProductionUrlVerification(input: {
  generatedAt: string | null;
  publicBaseUrl: string;
  productionUrlReady: boolean;
  dnsDiagnostic: ClipperProductionDnsDiagnostic;
  items: ClipperProductionUrlVerificationItem[];
}): ClipperProductionUrlVerificationSummary {
  const totals = input.items.reduce<ClipperProductionUrlVerificationSummary["totals"]>((sum, item) => {
    sum.endpoints += 1;
    if (item.status === "pass") sum.pass += 1;
    if (item.status === "fail") sum.fail += 1;
    if (item.status === "skipped") sum.skipped += 1;
    return sum;
  }, { endpoints: 0, pass: 0, fail: 0, skipped: 0 });
  const status: ClipperProductionUrlVerificationSummary["status"] = !input.generatedAt
    ? "not_run"
    : !input.productionUrlReady
      ? "blocked"
      : totals.fail > 0
        ? totals.pass > 0 ? "partial" : "fail"
        : totals.pass === totals.endpoints && totals.endpoints > 0
          ? "pass"
          : "not_run";
  return {
    status,
    generatedAt: input.generatedAt,
    manifestPath: PRODUCTION_URL_VERIFICATION_PATH,
    markdownPath: PRODUCTION_URL_VERIFICATION_MARKDOWN_PATH,
    publicBaseUrl: input.publicBaseUrl,
    productionUrlReady: input.productionUrlReady,
    dnsDiagnostic: input.dnsDiagnostic,
    items: input.items,
    totals,
    nextStep: status === "pass"
      ? "Public URL endpoints verified; attach this manifest/markdown as app review support evidence."
      : status === "blocked"
        ? "Save a public HTTPS PUBLIC_BASE_URL before running endpoint verification."
        : input.dnsDiagnostic.status === "unresolved"
          ? input.dnsDiagnostic.nextStep
          : totals.fail > 0
          ? "Fix failed public endpoints, rerun verification, then regenerate app review packs."
          : "Run Production URL verification to capture app review support evidence.",
  };
}

async function buildProductionUrlVerificationSummary(productionUrlSetup?: ClipperProductionUrlSetupSummary): Promise<ClipperProductionUrlVerificationSummary> {
  const setup = productionUrlSetup || await buildProductionUrlSetupSummary();
  const fallbackDnsDiagnostic = await buildProductionDnsDiagnostic(setup.publicBaseUrl);
  try {
    const raw = await readFile(PRODUCTION_URL_VERIFICATION_PATH, "utf8");
    const parsed = JSON.parse(raw) as ClipperProductionUrlVerificationSummary;
    return summarizeProductionUrlVerification({
      generatedAt: typeof parsed.generatedAt === "string" ? parsed.generatedAt : null,
      publicBaseUrl: setup.publicBaseUrl,
      productionUrlReady: setup.productionUrlReady,
      dnsDiagnostic: normalizeProductionDnsDiagnostic(parsed.dnsDiagnostic, fallbackDnsDiagnostic),
      items: Array.isArray(parsed.items) ? parsed.items : [],
    });
  } catch {
    const skippedAt = new Date(0).toISOString();
    return summarizeProductionUrlVerification({
      generatedAt: null,
      publicBaseUrl: setup.publicBaseUrl,
      productionUrlReady: setup.productionUrlReady,
      dnsDiagnostic: fallbackDnsDiagnostic,
      items: setup.endpointChecks.map((check) => ({
        id: check.id,
        label: check.label,
        url: check.url,
        expected: check.expected,
        status: "skipped",
        statusCode: null,
        responseMs: null,
        checkedAt: skippedAt,
        error: null,
        evidence: "Not run yet.",
      })),
    });
  }
}

function renderProductionUrlVerificationMarkdown(summary: ClipperProductionUrlVerificationSummary): string {
  return [
    "# Clippers Production URL Verification",
    "",
    `Status: ${summary.status}`,
    `Generated: ${summary.generatedAt || new Date().toISOString()}`,
    `PUBLIC_BASE_URL: ${summary.publicBaseUrl}`,
    `Production URL ready: ${summary.productionUrlReady ? "yes" : "no"}`,
    `DNS status: ${summary.dnsDiagnostic.status}`,
    `DNS host: ${summary.dnsDiagnostic.host || "n/a"}`,
    `Totals: ${summary.totals.pass}/${summary.totals.endpoints} pass; ${summary.totals.fail} fail; ${summary.totals.skipped} skipped`,
    "",
    "## Next Step",
    "",
    summary.nextStep,
    "",
    "## DNS Diagnostic",
    "",
    `- Host: ${summary.dnsDiagnostic.host || "n/a"}`,
    `- Root domain: ${summary.dnsDiagnostic.rootDomain || "n/a"}`,
    `- Apex domain: ${summary.dnsDiagnostic.isApexDomain ? "yes" : "no"}`,
    `- Status: ${summary.dnsDiagnostic.status}`,
    `- Addresses: ${summary.dnsDiagnostic.addresses.length ? summary.dnsDiagnostic.addresses.join(", ") : "none"}`,
    `- Record types checked: ${summary.dnsDiagnostic.recordTypesChecked.length ? summary.dnsDiagnostic.recordTypesChecked.join(", ") : "none"}`,
    `- Error: ${summary.dnsDiagnostic.error || "none"}`,
    `- Next step: ${summary.dnsDiagnostic.nextStep}`,
    "",
    "Suggested records:",
    ...summary.dnsDiagnostic.suggestedRecords.map((record) => `- ${record}`),
    "",
    "Registrar checklist:",
    ...summary.dnsDiagnostic.registrarChecklist.map((step) => `- [ ] ${step}`),
    "",
    "Record candidates:",
    ...summary.dnsDiagnostic.recordCandidates.flatMap((record) => [
      `- ${record.label}`,
      `  - Priority: ${record.priority}`,
      `  - Type: ${record.recordType}`,
      `  - Name: ${record.name}`,
      `  - Value: ${record.value}`,
      `  - TTL: ${record.ttl}`,
      `  - Copy: ${record.copyLine}`,
      `  - Validate: ${record.validationCommand}`,
      `  - When to use: ${record.whenToUse}`,
    ]),
    "",
    "Propagation checks:",
    ...summary.dnsDiagnostic.propagationChecks.map((command) => `- ${command}`),
    "",
    "Blocked until DNS resolves:",
    ...summary.dnsDiagnostic.blockedUntilResolved.map((action) => `- ${action}`),
    "",
    "## Endpoint Evidence",
    "",
    ...summary.items.flatMap((item) => [
      `### ${item.label}`,
      "",
      `- ID: ${item.id}`,
      `- URL: ${item.url}`,
      `- Status: ${item.status}`,
      `- Status code: ${item.statusCode ?? "n/a"}`,
      `- Response ms: ${item.responseMs ?? "n/a"}`,
      `- Checked at: ${item.checkedAt}`,
      `- Expected: ${item.expected}`,
      `- Evidence: ${item.evidence}`,
      item.error ? `- Error: ${item.error}` : "- Error: none",
      "",
    ]),
  ].join("\n");
}

export async function prepareClipperProductionUrlSetup(userId = getSystemUserId()): Promise<{ productionUrlSetup: ClipperProductionUrlSetupSummary; status: ClipperStatus }> {
  await writeDefaultConfigIfMissing();
  await ensureClipperDirs();
  const generatedAt = new Date().toISOString();
  const productionUrlSetup: ClipperProductionUrlSetupSummary = {
    ...await buildProductionUrlSetupSummary(),
    generatedAt,
  };
  await writeFile(PRODUCTION_URL_SETUP_PATH, JSON.stringify(productionUrlSetup, null, 2));
  await writeFile(PRODUCTION_URL_SETUP_MARKDOWN_PATH, renderProductionUrlSetupMarkdown(productionUrlSetup));
  return { productionUrlSetup, status: await getClipperStatus(userId) };
}

export async function verifyClipperProductionUrl(userId = getSystemUserId()): Promise<{ productionUrlVerification: ClipperProductionUrlVerificationSummary; status: ClipperStatus }> {
  await writeDefaultConfigIfMissing();
  await ensureClipperDirs();
  const productionUrlSetup = await buildProductionUrlSetupSummary();
  const dnsDiagnostic = await buildProductionDnsDiagnostic(productionUrlSetup.publicBaseUrl);
  const items = productionUrlSetup.productionUrlReady
    ? await Promise.all(productionUrlSetup.endpointChecks.map((check) => checkProductionUrlEndpoint(check)))
    : productionUrlSetup.endpointChecks.map<ClipperProductionUrlVerificationItem>((check) => ({
      id: check.id,
      label: check.label,
      url: check.url,
      expected: check.expected,
      status: "skipped",
      statusCode: null,
      responseMs: null,
      checkedAt: new Date().toISOString(),
      error: "PUBLIC_BASE_URL is not a public HTTPS origin.",
      evidence: "Skipped until Production URL Setup is ready.",
    }));
  const productionUrlVerification = summarizeProductionUrlVerification({
    generatedAt: new Date().toISOString(),
    publicBaseUrl: productionUrlSetup.publicBaseUrl,
    productionUrlReady: productionUrlSetup.productionUrlReady,
    dnsDiagnostic,
    items,
  });
  await writeFile(PRODUCTION_URL_VERIFICATION_PATH, JSON.stringify(productionUrlVerification, null, 2));
  await writeFile(PRODUCTION_URL_VERIFICATION_MARKDOWN_PATH, renderProductionUrlVerificationMarkdown(productionUrlVerification));
  return { productionUrlVerification, status: await getClipperStatus(userId) };
}

async function buildHttpsTunnelPlanSummary(): Promise<ClipperHttpsTunnelPlanSummary> {
  const publicBaseUrl = getPublicBaseUrl();
  const productionUrlReady = isProductionPublicBaseUrl(publicBaseUrl);
  const localPort = process.env.PORT || "5010";
  const localOrigin = `http://127.0.0.1:${localPort}`;
  const options: ClipperHttpsTunnelPlanOption[] = [
    {
      id: "cloudflare-tunnel",
      label: "Cloudflare Tunnel con dominio propio",
      status: "recommended",
      fit: "production",
      publicUrlRequirement: "Dominio propio en Cloudflare y subdominio HTTPS estable.",
      setupSteps: [
        "Crear subdominio dedicado, por ejemplo clippers.tudominio.com.",
        "Instalar cloudflared en la maquina o servidor que corre la app.",
        `Crear tunnel nombrado y apuntarlo al puerto local ${localPort}.`,
        "Registrar el subdominio en Cloudflare Tunnel.",
        "Guardar la URL HTTPS con el boton PUBLIC_BASE_URL HTTPS en Clippers.",
      ],
      localCommands: [
        "cloudflared tunnel login",
        "cloudflared tunnel create clippers",
        "cloudflared tunnel route dns clippers clippers.tudominio.com",
        `cloudflared tunnel run --url ${localOrigin} clippers`,
      ],
      portalUrl: "https://one.dash.cloudflare.com/",
      pros: ["URL estable", "HTTPS automatico", "mejor para app review y OAuth production"],
      risks: ["Requiere dominio/DNS", "el tunnel debe mantenerse corriendo o desplegarse como servicio"],
      nextStep: "Configurar Cloudflare Tunnel y guardar https://clippers.tudominio.com como PUBLIC_BASE_URL.",
    },
    {
      id: "ngrok-reserved-domain",
      label: "ngrok reserved domain",
      status: "available",
      fit: "staging",
      publicUrlRequirement: "Dominio reservado HTTPS de ngrok para que el redirect URI no cambie.",
      setupSteps: [
        "Crear cuenta ngrok y reservar dominio.",
        "Instalar ngrok y configurar authtoken.",
        `Levantar tunnel al puerto ${localPort} con dominio reservado.`,
        "Guardar la URL HTTPS en Clippers.",
      ],
      localCommands: [
        "ngrok config add-authtoken <token>",
        `ngrok http --domain=<tu-dominio-reservado>.ngrok.app ${localPort}`,
      ],
      portalUrl: "https://dashboard.ngrok.com/",
      pros: ["Rapido para pruebas", "HTTPS inmediato", "dominio reservado sirve para OAuth si no cambia"],
      risks: ["Plan/dominio puede tener costo", "menos ideal que dominio propio para produccion estable"],
      nextStep: "Reservar dominio ngrok estable y guardarlo como PUBLIC_BASE_URL.",
    },
    {
      id: "managed-deploy",
      label: "Deploy estable en hosting",
      status: "available",
      fit: "production",
      publicUrlRequirement: "URL HTTPS permanente en Render/Fly/Railway/Replit Deployments u otro hosting.",
      setupSteps: [
        "Crear deployment de la app con variables de entorno seguras.",
        "Configurar HTTPS/domain custom si aplica.",
        "Confirmar que /clippers y callbacks OAuth responden en internet.",
        "Guardar la URL HTTPS en Clippers.",
      ],
      localCommands: [
        "npm run build",
        "Configurar start command segun proveedor: NODE_ENV=production node dist/index.cjs",
      ],
      portalUrl: "https://render.com/",
      pros: ["Mas estable para produccion", "no depende de laptop local", "mejor uptime"],
      risks: ["Requiere configurar env vars y base de datos/servicios del deployment"],
      nextStep: "Elegir proveedor de hosting y desplegar con env vars seguras.",
    },
    {
      id: "temporary-tunnel",
      label: "Tunnel temporal sin dominio reservado",
      status: "fallback",
      fit: "temporary",
      publicUrlRequirement: "URL HTTPS temporal solo para pruebas locales, no para app review final.",
      setupSteps: [
        `Levantar tunnel temporal al puerto ${localPort}.`,
        "Probar callbacks OAuth localmente.",
        "No usar esta URL para app review si puede cambiar.",
      ],
      localCommands: [
        `cloudflared tunnel --url ${localOrigin}`,
        `ngrok http ${localPort}`,
      ],
      portalUrl: "https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/",
      pros: ["Muy rapido para validar flujo", "no requiere DNS inicial"],
      risks: ["La URL cambia", "rompe redirect URIs si se reinicia", "no recomendable para aprobaciones"],
      nextStep: "Usar solo para pruebas; migrar a Cloudflare Tunnel con dominio o deploy estable.",
    },
  ];
  const generatedAt = await stat(HTTPS_TUNNEL_PLAN_PATH).then((file) => file.mtime.toISOString()).catch(() => null);
  const blockers = productionUrlReady ? [] : ["Falta una URL publica HTTPS estable para PUBLIC_BASE_URL."];
  const endpointChecksForBase = (baseUrl: string): ClipperProductionUrlEndpointCheck[] => {
    const base = baseUrl.replace(/\/$/, "");
    return [
      { id: "app", label: "Clippers app", url: `${base}/clippers`, expected: "HTTP 200 and visible Clippers UI." },
      { id: "privacy", label: "Privacy Policy", url: `${base}/clippers/legal/privacy`, expected: "HTTP 200 public page." },
      { id: "terms", label: "Terms of Service", url: `${base}/clippers/legal/terms`, expected: "HTTP 200 public page." },
      { id: "review-demo", label: "App Review Demo", url: `${base}/clippers/review-demo`, expected: "HTTP 200 public demo." },
    ];
  };
  const executionSession: ClipperHttpsTunnelExecutionItem[] = options.map((option, index) => ({
    rank: index + 1,
    optionId: option.id,
    label: option.label,
    fit: option.fit,
    recommended: option.id === "cloudflare-tunnel",
    portalUrl: option.portalUrl,
    localOrigin,
    expectedPublicUrlPattern: option.id === "cloudflare-tunnel"
      ? "https://clippers.<owned-domain>"
      : option.id === "ngrok-reserved-domain"
        ? "https://<reserved-domain>.ngrok.app"
        : option.id === "managed-deploy"
          ? "https://<deployment-or-custom-domain>"
        : "https://<temporary-generated-host>",
    publicBaseUrlTemplate: option.id === "cloudflare-tunnel"
      ? "PUBLIC_BASE_URL=https://clippers.<owned-domain>"
      : option.id === "ngrok-reserved-domain"
        ? "PUBLIC_BASE_URL=https://<reserved-domain>.ngrok.app"
        : option.id === "managed-deploy"
          ? "PUBLIC_BASE_URL=https://<deployment-or-custom-domain>"
          : "PUBLIC_BASE_URL=https://<temporary-generated-host>",
    commandSequence: option.localCommands,
    savePublicBaseUrlSteps: [
      "Copy only the HTTPS origin, not a full path.",
      "Paste it into PUBLIC_BASE_URL HTTPS in Clippers.",
      "Regenerate Production URL Setup immediately after saving.",
      "Confirm endpoint checks before registering redirect URIs.",
    ],
    endpointChecks: endpointChecksForBase(
      option.id === "cloudflare-tunnel"
        ? "https://clippers.<owned-domain>"
        : option.id === "ngrok-reserved-domain"
          ? "https://<reserved-domain>.ngrok.app"
          : option.id === "managed-deploy"
            ? "https://<deployment-or-custom-domain>"
            : "https://<temporary-generated-host>"
    ),
    evidenceToCapture: [
      "Screenshot or terminal proof that the tunnel/deploy is running.",
      "HTTP 200 proof for /clippers.",
      "HTTP 200 proof for privacy, terms and review demo pages.",
      "PUBLIC_BASE_URL save confirmation in Clippers.",
    ],
    registerAfterSave: PLATFORM_REQUIREMENTS.map((requirement) => `${requirement.label}: <PUBLIC_BASE_URL>/api/clippers/oauth/${requirement.platform}/callback`),
    stabilityChecklist: [
      "URL will not rotate during app review.",
      "Operator knows how to restart tunnel/deploy after reboot.",
      "Rollback URL and previous env value are documented.",
      "No platform redirect URI is updated until endpoint checks pass.",
    ],
    doneCriteria: [
      "Public URL uses HTTPS and is stable enough for app review/OAuth.",
      `Public URL forwards to ${localOrigin}.`,
      "PUBLIC_BASE_URL is saved through Clippers and Production URL Setup reports ready.",
      "Redirect URIs are registered after PUBLIC_BASE_URL is saved.",
    ],
    rollbackPlan: [
      "Do not delete the previous valid PUBLIC_BASE_URL until OAuth callbacks work on the new URL.",
      "If tunnel/deploy fails, revert PUBLIC_BASE_URL to the last working public HTTPS origin.",
      "Regenerate Production URL Setup, Legal Policy Pack, Demo Pack and Developer Application Drafts after any URL change.",
    ],
    nextStep: option.nextStep,
  }));
  return {
    status: !generatedAt ? "not_prepared" : productionUrlReady ? "ready" : "blocked",
    generatedAt,
    manifestPath: HTTPS_TUNNEL_PLAN_PATH,
    markdownPath: HTTPS_TUNNEL_PLAN_MARKDOWN_PATH,
    publicBaseUrl,
    localPort,
    localOrigin,
    productionUrlReady,
    recommendedOptionId: "cloudflare-tunnel",
    options,
    executionSession,
    blockers,
    nextStep: productionUrlReady
      ? "PUBLIC_BASE_URL ya es publica HTTPS; registrar redirect URIs en plataformas."
      : "Configurar Cloudflare Tunnel, ngrok reservado o deploy estable; luego guardar PUBLIC_BASE_URL HTTPS en Clippers.",
  };
}

function renderHttpsTunnelPlanMarkdown(summary: ClipperHttpsTunnelPlanSummary): string {
  return [
    "# Clippers HTTPS Tunnel / Deploy Plan",
    "",
    `Status: ${summary.status}`,
    `Generated: ${summary.generatedAt || new Date().toISOString()}`,
    `Current PUBLIC_BASE_URL: ${summary.publicBaseUrl}`,
    `Local origin: ${summary.localOrigin}`,
    `Local port: ${summary.localPort}`,
    `Production URL ready: ${summary.productionUrlReady ? "yes" : "no"}`,
    `Recommended option: ${summary.recommendedOptionId}`,
    "",
    "## Next Step",
    "",
    summary.nextStep,
    "",
    "## Options",
    "",
    ...summary.options.flatMap((option) => [
      `### ${option.label}`,
      "",
      `- Id: ${option.id}`,
      `- Status: ${option.status}`,
      `- Fit: ${option.fit}`,
      `- Portal: ${option.portalUrl}`,
      `- URL requirement: ${option.publicUrlRequirement}`,
      `- Next step: ${option.nextStep}`,
      "",
      "Setup:",
      ...option.setupSteps.map((step) => `- [ ] ${step}`),
      "",
      "Commands:",
      ...option.localCommands.map((command) => `- \`${command}\``),
      "",
      "Pros:",
      ...option.pros.map((item) => `- ${item}`),
      "",
      "Risks:",
      ...option.risks.map((item) => `- ${item}`),
      "",
    ]),
    "## Execution Session",
    "",
    ...summary.executionSession.flatMap((item) => [
      `### ${item.rank}. ${item.label}`,
      "",
      `- Option: ${item.optionId}`,
      `- Fit: ${item.fit}`,
      `- Recommended: ${item.recommended ? "yes" : "no"}`,
      `- Portal: ${item.portalUrl}`,
      `- Local origin: ${item.localOrigin}`,
      `- Expected public URL: ${item.expectedPublicUrlPattern}`,
      `- PUBLIC_BASE_URL template: ${item.publicBaseUrlTemplate}`,
      `- Next step: ${item.nextStep}`,
      "",
      "Commands:",
      ...item.commandSequence.map((command) => `- \`${command}\``),
      "",
      "Save PUBLIC_BASE_URL steps:",
      ...item.savePublicBaseUrlSteps.map((step) => `- [ ] ${step}`),
      "",
      "Endpoint checks:",
      ...item.endpointChecks.map((check) => `- [ ] ${check.label}: ${check.url} (${check.expected})`),
      "",
      "Evidence to capture:",
      ...item.evidenceToCapture.map((evidence) => `- [ ] ${evidence}`),
      "",
      "Register after save:",
      ...item.registerAfterSave.map((redirect) => `- ${redirect}`),
      "",
      "Stability checklist:",
      ...item.stabilityChecklist.map((step) => `- [ ] ${step}`),
      "",
      "Done criteria:",
      ...item.doneCriteria.map((criterion) => `- [ ] ${criterion}`),
      "",
      "Rollback plan:",
      ...item.rollbackPlan.map((step) => `- ${step}`),
      "",
    ]),
    "## Blockers",
    "",
    ...(summary.blockers.length ? summary.blockers.map((blocker) => `- ${blocker}`) : ["none"]),
    "",
  ].join("\n");
}

export async function prepareClipperHttpsTunnelPlan(userId = getSystemUserId()): Promise<{ httpsTunnelPlan: ClipperHttpsTunnelPlanSummary; status: ClipperStatus }> {
  await writeDefaultConfigIfMissing();
  await ensureClipperDirs();
  const draftSummary = await buildHttpsTunnelPlanSummary();
  const httpsTunnelPlan: ClipperHttpsTunnelPlanSummary = {
    ...draftSummary,
    generatedAt: new Date().toISOString(),
    status: draftSummary.productionUrlReady ? "ready" : "blocked",
  };
  await writeFile(HTTPS_TUNNEL_PLAN_PATH, JSON.stringify(httpsTunnelPlan, null, 2));
  await writeFile(HTTPS_TUNNEL_PLAN_MARKDOWN_PATH, renderHttpsTunnelPlanMarkdown(httpsTunnelPlan));
  return { httpsTunnelPlan, status: await getClipperStatus(userId) };
}

function legalPolicyUrls() {
  const base = getPublicBaseUrl().replace(/\/$/, "");
  return {
    privacyUrl: `${base}/clippers/legal/privacy`,
    termsUrl: `${base}/clippers/legal/terms`,
  };
}

function appReviewDemoUrl() {
  const base = getPublicBaseUrl().replace(/\/$/, "");
  return `${base}/clippers/review-demo`;
}

function renderLegalHtml(title: string, body: string[]): string {
  const escapedTitle = title.replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1" />',
    `<title>${escapedTitle}</title>`,
    '<style>body{font-family:Inter,Arial,sans-serif;max-width:860px;margin:0 auto;padding:40px 20px;line-height:1.6;color:#18181b}h1,h2{line-height:1.2}code{background:#f4f4f5;padding:2px 4px;border-radius:4px}.meta{color:#71717a}</style>',
    "</head>",
    "<body>",
    `<h1>${escapedTitle}</h1>`,
    '<p class="meta">Last updated: June 17, 2026</p>',
    ...body,
    "</body>",
    "</html>",
  ].join("\n");
}

export function renderClipperPrivacyPolicyHtml(): string {
  return renderLegalHtml("Clippers Privacy Policy", [
    "<p>Clippers is an internal short-form content operations system for preparing, reviewing, scheduling, and reporting on social video workflows for accounts we own or manage.</p>",
    "<h2>Information We Process</h2>",
    "<p>The system may process account names, platform handles, OAuth authorization metadata, encrypted platform tokens, upload metadata, draft captions, content source records, permission evidence references, and performance metrics imported by an operator.</p>",
    "<h2>How Information Is Used</h2>",
    "<p>Information is used to verify account readiness, confirm publishing permissions, prevent unauthorized content use, prepare drafts, run approval-required publishing workflows, and measure content performance.</p>",
    "<h2>Tokens And Secrets</h2>",
    "<p>OAuth tokens are stored encrypted server-side when configured. Plaintext tokens and secrets are not displayed in reports or policy artifacts.</p>",
    "<h2>Content Rights</h2>",
    "<p>Third-party footage is blocked unless an allowlist or evidence record confirms ownership, license, official-source use, or creator/rightsholder permission.</p>",
    "<h2>Data Sharing</h2>",
    "<p>Data is shared with TikTok, Meta/Instagram, YouTube/Google, and storage providers only as needed to authenticate accounts, submit approved content, or operate connected workflows authorized by the account owner.</p>",
    "<h2>Contact</h2>",
    "<p>For privacy, rights, credit, or removal requests, contact the account operator managing the relevant Clippers workspace.</p>",
  ]);
}

export function renderClipperTermsOfServiceHtml(): string {
  return renderLegalHtml("Clippers Terms of Service", [
    "<p>These terms describe the operational rules for using Clippers to prepare and publish short-form video content for owned or managed social accounts.</p>",
    "<h2>Authorized Use</h2>",
    "<p>Operators may use Clippers only for accounts they own, manage, or have explicit authorization to operate. Platform terms, creator permissions, and applicable laws must be followed.</p>",
    "<h2>Publishing Controls</h2>",
    "<p>New accounts and workflows must remain in approval-required mode until credentials, permissions, content rights, and quality checks are verified.</p>",
    "<h2>Content Rights</h2>",
    "<p>Operators must not publish copyrighted, private, or third-party content without a valid ownership, license, official source, or creator/rightsholder permission record.</p>",
    "<h2>Platform APIs</h2>",
    "<p>Use of TikTok, Meta/Instagram, YouTube/Google, and other platform APIs must comply with each platform's developer policies, app review requirements, rate limits, and user consent requirements.</p>",
    "<h2>No Circumvention</h2>",
    "<p>Clippers must not be used to evade platform review, bypass authorization, hide automation, scrape restricted content, or misrepresent account ownership.</p>",
    "<h2>Metrics And Optimization</h2>",
    "<p>Performance data may be used to adjust hooks, formats, posting windows, and volume, but optimization must not override rights, safety, or platform compliance gates.</p>",
  ]);
}

export function renderClipperAppReviewDemoHtml(): string {
  const { privacyUrl, termsUrl } = legalPolicyUrls();
  const rows = [
    ["Rights Gate", "Blocks third-party footage until ownership, license, official-source use, or creator permission evidence exists."],
    ["OAuth Consent", "Connects TikTok, Instagram/Meta, and YouTube only through platform OAuth after app review and user authorization."],
    ["Approval Required", "Keeps new publishing workflows in approval_required mode until credentials, permissions, rights, and QA are verified."],
    ["Encrypted Tokens", "Stores OAuth token payloads encrypted server-side and never displays plaintext secrets in reports or review artifacts."],
    ["Metrics Loop", "Imports performance metrics after publication to improve hooks, formats, timing, and account strategy without bypassing safety gates."],
  ];
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1" />',
    "<title>Clippers App Review Demo</title>",
    '<style>body{font-family:Inter,Arial,sans-serif;margin:0;background:#09090b;color:#f4f4f5}main{max-width:1040px;margin:0 auto;padding:40px 20px 56px}.hero{border:1px solid #27272a;background:#18181b;padding:28px;border-radius:8px}h1,h2{line-height:1.15;margin:0 0 12px}p{line-height:1.65;color:#d4d4d8}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:12px;margin-top:18px}.card{border:1px solid #27272a;background:#111113;border-radius:8px;padding:16px}.tag{display:inline-block;border:1px solid #3f3f46;border-radius:999px;padding:4px 10px;color:#a7f3d0;font-size:12px;margin-bottom:14px}.meta{color:#a1a1aa;font-size:13px}.flow{counter-reset:step}.flow li{margin:10px 0;color:#d4d4d8}a{color:#67e8f9}.warning{color:#fde68a}</style>',
    "</head>",
    "<body>",
    "<main>",
    '<section class="hero">',
    '<span class="tag">Public reviewer demo, no login required</span>',
    "<h1>Clippers App Review Demo</h1>",
    "<p>Clippers is a short-form content operations system for accounts we own or manage. It prepares clips, verifies rights evidence, runs OAuth-based account authorization, keeps publishing approval-gated, and reports performance for optimization.</p>",
    '<p class="warning">This demo page is intentionally read-only. It does not expose tokens, secrets, private user data, or live publishing controls.</p>',
    "</section>",
    '<section class="grid">',
    ...rows.map(([title, copy]) => [
      '<article class="card">',
      `<h2>${title}</h2>`,
      `<p>${copy}</p>`,
      "</article>",
    ].join("\n")),
    "</section>",
    '<section class="card" style="margin-top:18px">',
    "<h2>Reviewer Walkthrough</h2>",
    '<ol class="flow">',
    "<li>Open Clippers Command Center and confirm platform setup status, credential readiness, and permission blockers.</li>",
    "<li>Review a source item. If rights evidence is missing, the item stays blocked and cannot move to publishing.</li>",
    "<li>Connect a platform through OAuth only after the developer app, scopes, redirect URI, and public policies are prepared.</li>",
    "<li>Prepare a draft package. The operator reviews caption, source, account, and timing before any post is sent.</li>",
    "<li>After publishing, metrics are imported and used to adjust formats and posting plans.</li>",
    "</ol>",
    "</section>",
    '<section class="card" style="margin-top:18px">',
    "<h2>Public Policy Links</h2>",
    `<p><a href="${privacyUrl}">Privacy Policy</a> · <a href="${termsUrl}">Terms of Service</a></p>`,
    '<p class="meta">Last updated: June 17, 2026</p>',
    "</section>",
    "</main>",
    "</body>",
    "</html>",
  ].join("\n");
}

async function buildAppReviewDemoPackSummary(): Promise<ClipperAppReviewDemoPackSummary> {
  const publicBaseUrl = getPublicBaseUrl();
  const productionUrlReady = isProductionPublicBaseUrl(publicBaseUrl);
  const demoUrl = appReviewDemoUrl();
  const generatedAt = await stat(APP_REVIEW_DEMO_PACK_PATH).then((file) => file.mtime.toISOString()).catch(() => null);
  const blockers = productionUrlReady ? [] : ["PUBLIC_BASE_URL publica HTTPS pendiente; la demo existe localmente pero app review necesita URL publica estable."];
  const steps: ClipperAppReviewDemoStep[] = [
    {
      id: "public-review-demo",
      label: "Demo publica read-only",
      owner: "Platform Ops",
      status: productionUrlReady ? "done" : generatedAt ? "needs_action" : "blocked",
      publicDemoUrl: demoUrl,
      localEvidencePath: APP_REVIEW_DEMO_PACK_MARKDOWN_PATH,
      checklist: [
        "Abrir la demo sin login.",
        "Confirmar que describe el flujo sin exponer controles privados.",
        "Usar esta URL en screencast y app review cuando PUBLIC_BASE_URL sea HTTPS publico.",
      ],
      nextStep: productionUrlReady ? "Usar Demo URL en TikTok, Meta y Google app review." : "Configurar PUBLIC_BASE_URL HTTPS y regenerar el demo pack.",
    },
    {
      id: "rights-gate-walkthrough",
      label: "Rights Gate walkthrough",
      owner: "Rights Gate",
      status: generatedAt ? "needs_action" : "blocked",
      publicDemoUrl: demoUrl,
      localEvidencePath: APP_REVIEW_DEMO_SCRIPT_PATH,
      checklist: [
        "Mostrar que clips sin evidencia quedan blocked.",
        "Mostrar allowlist o evidencia owned/licensed/permissioned.",
        "Explicar que la optimizacion nunca salta el gate de derechos.",
      ],
      nextStep: "Grabar screencast corto usando el guion del demo pack.",
    },
    {
      id: "oauth-publishing-walkthrough",
      label: "OAuth y publicacion approval_required",
      owner: "Publisher",
      status: generatedAt ? "needs_action" : "blocked",
      publicDemoUrl: demoUrl,
      localEvidencePath: APP_REVIEW_DEMO_SCRIPT_PATH,
      checklist: [
        "Mostrar redirect URI y scopes solicitados.",
        "Mostrar que OAuth requiere consentimiento del owner.",
        "Mostrar que publish queda approval_required hasta completar permisos y QA.",
      ],
      nextStep: "Adjuntar screencast al submission pack cuando las cuentas reales esten listas.",
    },
  ];
  return {
    status: !generatedAt ? "not_prepared" : productionUrlReady ? "ready" : "blocked",
    generatedAt,
    manifestPath: APP_REVIEW_DEMO_PACK_PATH,
    markdownPath: APP_REVIEW_DEMO_PACK_MARKDOWN_PATH,
    demoScriptPath: APP_REVIEW_DEMO_SCRIPT_PATH,
    demoUrl,
    publicBaseUrl,
    productionUrlReady,
    steps,
    blockers,
    nextStep: productionUrlReady
      ? "Usar Demo URL y guion en app review; subir screencast por plataforma."
      : "Configurar PUBLIC_BASE_URL HTTPS para que la Demo URL sea publica y estable.",
  };
}

function renderAppReviewDemoScript(summary: ClipperAppReviewDemoPackSummary): string {
  return [
    "# Clippers App Review Demo Script",
    "",
    "Use this narration for a 60-90 second platform review screencast.",
    "",
    "1. Clippers manages short-form publishing for owned or managed accounts only.",
    "2. The Rights Gate blocks third-party footage unless ownership, license, official-source use, or creator/rightsholder permission has been recorded.",
    "3. OAuth is initiated only after the account owner chooses to connect the platform and grants the requested scopes.",
    "4. Tokens are encrypted server-side. Plaintext access tokens, refresh tokens, client secrets, and raw credential values are not shown in the UI or artifacts.",
    "5. Publishing starts in approval_required mode. A human operator reviews the source, rights evidence, caption, account, and scheduled window before the post is sent.",
    "6. Metrics are imported after publication and used to improve hooks, formats, and posting windows while respecting platform policies and content rights.",
    "",
    `Demo URL: ${summary.demoUrl}`,
    `Privacy Policy: ${legalPolicyUrls().privacyUrl}`,
    `Terms of Service: ${legalPolicyUrls().termsUrl}`,
    "",
  ].join("\n");
}

function renderAppReviewDemoPackMarkdown(summary: ClipperAppReviewDemoPackSummary): string {
  return [
    "# Clippers App Review Demo Pack",
    "",
    `Status: ${summary.status}`,
    `Generated: ${summary.generatedAt || new Date().toISOString()}`,
    `Public base URL: ${summary.publicBaseUrl}`,
    `Demo URL: ${summary.demoUrl}`,
    `Production URL ready: ${summary.productionUrlReady ? "yes" : "no"}`,
    "",
    "## Next Step",
    "",
    summary.nextStep,
    "",
    "## Files",
    "",
    `- Manifest: ${summary.manifestPath}`,
    `- Markdown: ${summary.markdownPath}`,
    `- Demo script: ${summary.demoScriptPath}`,
    "",
    "## Reviewer Steps",
    "",
    ...summary.steps.flatMap((step) => [
      `### ${step.label}`,
      "",
      `- Id: ${step.id}`,
      `- Status: ${step.status}`,
      `- Owner: ${step.owner}`,
      `- Demo URL: ${step.publicDemoUrl}`,
      `- Evidence: ${step.localEvidencePath}`,
      `- Next step: ${step.nextStep}`,
      "",
      "Checklist:",
      ...step.checklist.map((item) => `- [ ] ${item}`),
      "",
    ]),
    "## Blockers",
    "",
    ...(summary.blockers.length ? summary.blockers.map((blocker) => `- ${blocker}`) : ["none"]),
    "",
  ].join("\n");
}

export async function prepareClipperAppReviewDemoPack(userId = getSystemUserId()): Promise<{ appReviewDemoPack: ClipperAppReviewDemoPackSummary; status: ClipperStatus }> {
  await writeDefaultConfigIfMissing();
  await ensureClipperDirs();
  const draftSummary = await buildAppReviewDemoPackSummary();
  const appReviewDemoPack: ClipperAppReviewDemoPackSummary = {
    ...draftSummary,
    generatedAt: new Date().toISOString(),
    status: draftSummary.productionUrlReady ? "ready" : "blocked",
    steps: draftSummary.steps.map((step) => ({
      ...step,
      status: draftSummary.productionUrlReady && step.id === "public-review-demo" ? "done" : "needs_action",
    })),
  };
  await writeFile(APP_REVIEW_DEMO_PACK_PATH, JSON.stringify(appReviewDemoPack, null, 2));
  await writeFile(APP_REVIEW_DEMO_PACK_MARKDOWN_PATH, renderAppReviewDemoPackMarkdown(appReviewDemoPack));
  await writeFile(APP_REVIEW_DEMO_SCRIPT_PATH, renderAppReviewDemoScript(appReviewDemoPack));
  return { appReviewDemoPack, status: await getClipperStatus(userId) };
}

async function buildLegalPolicyPackSummary(): Promise<ClipperLegalPolicyPackSummary> {
  const publicBaseUrl = getPublicBaseUrl();
  const productionUrlReady = isProductionPublicBaseUrl(publicBaseUrl);
  const { privacyUrl, termsUrl } = legalPolicyUrls();
  const generatedAt = await stat(LEGAL_POLICY_PACK_PATH).then((file) => file.mtime.toISOString()).catch(() => null);
  const blockers = productionUrlReady ? [] : ["Privacy/Terms routes exist locally, but app review needs PUBLIC_BASE_URL publica HTTPS."];
  return {
    status: !generatedAt ? "not_prepared" : productionUrlReady ? "ready" : "blocked",
    generatedAt,
    manifestPath: LEGAL_POLICY_PACK_PATH,
    markdownPath: LEGAL_POLICY_PACK_MARKDOWN_PATH,
    privacyPath: LEGAL_PRIVACY_POLICY_PATH,
    termsPath: LEGAL_TERMS_OF_SERVICE_PATH,
    privacyUrl,
    termsUrl,
    publicBaseUrl,
    productionUrlReady,
    blockers,
    nextStep: productionUrlReady
      ? "Usar Privacy Policy URL y Terms URL en TikTok, Meta y Google app review."
      : "Configurar PUBLIC_BASE_URL HTTPS para que estas politicas sean publicas en app review.",
  };
}

function renderLegalPolicyPackMarkdown(summary: ClipperLegalPolicyPackSummary): string {
  return [
    "# Clippers Legal Policy Pack",
    "",
    `Status: ${summary.status}`,
    `Generated: ${summary.generatedAt || new Date().toISOString()}`,
    `Public base URL: ${summary.publicBaseUrl}`,
    `Production URL ready: ${summary.productionUrlReady ? "yes" : "no"}`,
    "",
    "## URLs",
    "",
    `- Privacy Policy: ${summary.privacyUrl}`,
    `- Terms of Service: ${summary.termsUrl}`,
    "",
    "## Files",
    "",
    `- Manifest: ${summary.manifestPath}`,
    `- Markdown: ${summary.markdownPath}`,
    `- Privacy HTML: ${summary.privacyPath}`,
    `- Terms HTML: ${summary.termsPath}`,
    "",
    "## Next Step",
    "",
    summary.nextStep,
    "",
    "## Blockers",
    "",
    ...(summary.blockers.length ? summary.blockers.map((blocker) => `- ${blocker}`) : ["none"]),
    "",
  ].join("\n");
}

export async function prepareClipperLegalPolicyPack(userId = getSystemUserId()): Promise<{ legalPolicyPack: ClipperLegalPolicyPackSummary; status: ClipperStatus }> {
  await writeDefaultConfigIfMissing();
  await ensureClipperDirs();
  const draftSummary = await buildLegalPolicyPackSummary();
  const legalPolicyPack: ClipperLegalPolicyPackSummary = {
    ...draftSummary,
    generatedAt: new Date().toISOString(),
    status: draftSummary.productionUrlReady ? "ready" : "blocked",
  };
  await writeFile(LEGAL_PRIVACY_POLICY_PATH, renderClipperPrivacyPolicyHtml());
  await writeFile(LEGAL_TERMS_OF_SERVICE_PATH, renderClipperTermsOfServiceHtml());
  await writeFile(LEGAL_POLICY_PACK_PATH, JSON.stringify(legalPolicyPack, null, 2));
  await writeFile(LEGAL_POLICY_PACK_MARKDOWN_PATH, renderLegalPolicyPackMarkdown(legalPolicyPack));
  return { legalPolicyPack, status: await getClipperStatus(userId) };
}

async function buildOAuthGoLiveSummary(input: {
  credentialChecks: ClipperCredentialCheck[];
  connectActions: ClipperConnectAction[];
  tokenVault: ClipperTokenVaultSummary;
  tokenExchanges: ClipperTokenExchange[];
  tokenRecords: ClipperTokenVaultRecord[];
  developerAppEvidence: ClipperDeveloperAppEvidenceSummary;
  permissionTracker: ClipperPermissionTrackerSummary;
  publisherConnectors: ClipperPublisherConnectorSummary;
}): Promise<ClipperOAuthGoLiveSummary> {
  await ensureClipperDirs();
  const publicBaseUrl = getPublicBaseUrl();
  const productionUrlReady = isProductionPublicBaseUrl(publicBaseUrl);
  const productionUrlNote = productionUrlReady
    ? "PUBLIC_BASE_URL usa HTTPS y no apunta a localhost; apta para registrar redirect URIs y domain verification."
    : "PUBLIC_BASE_URL debe ser una URL publica HTTPS, no localhost/127.0.0.1, antes de pedir app review o publicar en produccion.";
  const items = (["tiktok", "instagram", "youtube"] as ClipperPlatform[]).map<ClipperOAuthGoLiveItem>((platform) => {
    const requirement = PLATFORM_REQUIREMENTS.find((item) => item.platform === platform)!;
    const credentialCheck = input.credentialChecks.find((item) => item.platform === platform);
    const connectAction = input.connectActions.find((item) => item.platform === platform);
    const tokenExchange = input.tokenExchanges.find((item) => item.platform === platform);
    const tokenRecord = input.tokenRecords.find((item) => item.platform === platform);
    const developerApp = input.developerAppEvidence.items.find((item) => item.platform === platform);
    const permissionItems = input.permissionTracker.items.filter((item) => item.platform === platform);
    const permissionsApproved = permissionItems.filter((item) => item.status === "approved").length;
    const publisherConnector = input.publisherConnectors.items.find((item) => item.platform === platform);
    const missingEnvVars = Array.from(new Set([
      ...(credentialCheck?.missingEnvVars || []),
      ...(connectAction?.missingEnvVars || []),
      ...(tokenExchange?.missingEnvVars || []),
    ]));
    const blockers = [
      ...(productionUrlReady ? [] : [productionUrlNote]),
      ...(input.tokenVault.configured ? [] : [`Falta ${TOKEN_ENCRYPTION_ENV_VAR} para guardar tokens cifrados.`]),
      ...(credentialCheck?.status === "ready" ? [] : [`Credenciales ${credentialCheck?.status || "missing"} para ${platform}.`]),
      ...(connectAction?.authUrl ? [] : ["OAuth URL no esta lista."]),
      ...(developerApp?.status === "approved" ? [] : [`Developer app ${developerApp?.status || "missing"}.`]),
      ...(permissionsApproved === permissionItems.length && permissionItems.length > 0 ? [] : [`${permissionsApproved}/${permissionItems.length} permisos aprobados.`]),
      ...(tokenRecord ? [] : [`Token OAuth no guardado para ${platform}.`]),
      ...(publisherConnector?.status === "ready" ? [] : [`Publisher connector ${publisherConnector?.status || "blocked"}.`]),
    ];
    const hasProgress = Boolean(
      tokenRecord ||
      connectAction?.authUrl ||
      credentialCheck?.status === "partial" ||
      credentialCheck?.status === "ready" ||
      developerApp?.status === "draft" ||
      developerApp?.status === "submitted" ||
      developerApp?.status === "approved" ||
      permissionsApproved > 0 ||
      publisherConnector?.status === "partial" ||
      publisherConnector?.status === "ready"
    );
    const status: ClipperOAuthGoLiveStatus = blockers.length === 0
      ? "ready"
      : hasProgress
        ? "partial"
        : "blocked";
    return {
      platform,
      label: requirement.label,
      status,
      redirectUri: buildRedirectUri(platform),
      callbackPath: connectAction?.callbackPath || `/api/clippers/oauth/${platform}/callback`,
      authUrl: connectAction?.authUrl || null,
      tokenExchangeStatus: tokenExchange?.status || "blocked",
      tokenSaved: Boolean(tokenRecord),
      tokenVaultReady: input.tokenVault.configured,
      credentialsReady: credentialCheck?.status === "ready",
      developerAppStatus: developerApp?.status || "missing",
      permissionsApproved,
      permissionsTotal: permissionItems.length,
      publisherConnectorStatus: publisherConnector?.status || "blocked",
      productionUrlReady,
      missingEnvVars,
      blockers,
      nextStep: status === "ready"
        ? "OAuth y publicacion listos para dry-run en approval_required."
        : blockers[0] || connectAction?.nextStep || "Completar preflight OAuth.",
    };
  });
  const totals = items.reduce<ClipperOAuthGoLiveSummary["totals"]>((sum, item) => {
    sum.platforms += 1;
    if (item.status === "ready") sum.ready += 1;
    if (item.status === "partial") sum.partial += 1;
    if (item.status === "blocked") sum.blocked += 1;
    return sum;
  }, { platforms: 0, ready: 0, partial: 0, blocked: 0 });
  const generatedAt = await stat(OAUTH_GO_LIVE_PATH).then((file) => file.mtime.toISOString()).catch(() => null);
  return {
    status: !generatedAt
      ? "not_prepared"
      : totals.ready === totals.platforms && totals.platforms > 0
        ? "ready"
        : totals.ready > 0 || totals.partial > 0
          ? "partial"
          : "blocked",
    generatedAt,
    manifestPath: OAUTH_GO_LIVE_PATH,
    markdownPath: OAUTH_GO_LIVE_MARKDOWN_PATH,
    publicBaseUrl,
    productionUrlReady,
    productionUrlNote,
    items,
    totals,
    nextStep: items.find((item) => item.status !== "ready")?.nextStep || "OAuth go-live listo; conectar cuentas y correr dry-run.",
  };
}

function renderOAuthGoLiveMarkdown(summary: ClipperOAuthGoLiveSummary): string {
  return [
    "# Clippers OAuth Go-Live Preflight",
    "",
    `Status: ${summary.status}`,
    `Generated: ${summary.generatedAt || new Date().toISOString()}`,
    `Public base URL: ${summary.publicBaseUrl}`,
    `Production URL ready: ${summary.productionUrlReady ? "yes" : "no"}`,
    `Production URL note: ${summary.productionUrlNote}`,
    `Totals: ${summary.totals.ready} ready, ${summary.totals.partial} partial, ${summary.totals.blocked} blocked`,
    "",
    "## Next Step",
    "",
    summary.nextStep,
    "",
    "## Platforms",
    "",
    ...summary.items.flatMap((item) => [
      `### ${item.label}`,
      "",
      `- Platform: ${item.platform}`,
      `- Status: ${item.status}`,
      `- Redirect URI: ${item.redirectUri}`,
      `- Callback path: ${item.callbackPath}`,
      `- OAuth URL ready: ${item.authUrl ? "yes" : "no"}`,
      `- Token vault ready: ${item.tokenVaultReady ? "yes" : "no"}`,
      `- Token exchange: ${item.tokenExchangeStatus}`,
      `- Token saved: ${item.tokenSaved ? "yes" : "no"}`,
      `- Credentials ready: ${item.credentialsReady ? "yes" : "no"}`,
      `- Production URL ready: ${item.productionUrlReady ? "yes" : "no"}`,
      `- Developer app: ${item.developerAppStatus}`,
      `- Permissions approved: ${item.permissionsApproved}/${item.permissionsTotal}`,
      `- Publisher connector: ${item.publisherConnectorStatus}`,
      `- Missing env vars: ${item.missingEnvVars.length ? item.missingEnvVars.join(", ") : "none"}`,
      `- Next step: ${item.nextStep}`,
      "",
      item.blockers.length ? "Blockers:" : "Blockers: none",
      ...item.blockers.map((blocker) => `- ${blocker}`),
      "",
    ]),
  ].join("\n");
}

function oauthConnectionRequiredInputs(input: {
  platform: ClipperPlatform;
  handle: string;
  requestedScopes: string[];
  redirectUri: string;
  callbackPath: string;
  missingEnvVars: string[];
}): string[] {
  return [
    `${input.platform}: verified account evidence for ${input.handle}`,
    `${input.platform}: approved developer app`,
    `${input.platform}: approved scopes ${input.requestedScopes.join(", ")}`,
    `${input.platform}: redirect URI registered (${input.redirectUri})`,
    `${input.platform}: callback reachable (${input.callbackPath})`,
    `${input.platform}: encrypted token vault key configured`,
    `${input.platform}: successful OAuth callback/token saved`,
    ...input.missingEnvVars.map((envVar) => `${envVar} configured`),
  ];
}

function oauthConnectionCompletionHint(input: { platform: ClipperPlatform; authUrl: string | null }): string {
  if (input.authUrl) return "Open the OAuth URL from Clippers, authorize the exact account/channel, then confirm the callback saves an encrypted token.";
  return `Complete ${input.platform} OAuth credentials, app review and redirect URI setup, then regenerate this pack to get the OAuth URL.`;
}

export async function prepareClipperOAuthGoLivePreflight(userId = getSystemUserId()): Promise<{ oauthGoLive: ClipperOAuthGoLiveSummary; status: ClipperStatus }> {
  await writeDefaultConfigIfMissing();
  await ensureClipperDirs();
  const config = await readConfig();
  const oauthConnections = await readOAuthConnections();
  const tokenRecords = await readTokenVaultRecords();
  const accounts = applyOAuthStateToAccounts(
    (Array.isArray(config.accounts) && config.accounts.length ? config.accounts : DEFAULT_ACCOUNTS).map(ensureAccountShape),
    oauthConnections,
    tokenRecords
  );
  const credentialChecks = buildCredentialChecks();
  const tokenVault = await buildTokenVaultSummary();
  const connectActions = buildClipperConnectActions();
  const tokenExchanges = buildClipperTokenExchanges(oauthConnections, tokenRecords);
  const permissionPack = await buildPermissionPackSummary();
  const accountEvidence = await buildAccountEvidenceSummary(accounts);
  const accountLaunchKit = await buildAccountLaunchKitSummary(accounts, accountEvidence);
  const developerAppEvidence = await buildDeveloperAppEvidenceSummary();
  const permissionTracker = await buildPermissionTrackerSummary({ accounts, credentialChecks, tokenRecords, oauthConnections, permissionPack, accountLaunchKit });
  const platformReadiness = await buildPlatformReadinessSummary({ credentialChecks, tokenRecords, accountLaunchKit, developerAppEvidence, permissionTracker });
  const productionQueue = await buildProductionQueueSummary(accounts);
  const publisherConnectors = await buildPublisherConnectorSummary({ tokenRecords, permissionTracker, platformReadiness, productionQueue });
  const draftSummary = await buildOAuthGoLiveSummary({ credentialChecks, connectActions, tokenVault, tokenExchanges, tokenRecords, developerAppEvidence, permissionTracker, publisherConnectors });
  const oauthGoLive: ClipperOAuthGoLiveSummary = {
    ...draftSummary,
    generatedAt: new Date().toISOString(),
    status: draftSummary.totals.ready === draftSummary.totals.platforms && draftSummary.totals.platforms > 0
      ? "ready"
      : draftSummary.totals.ready > 0 || draftSummary.totals.partial > 0
        ? "partial"
        : "blocked",
  };
  await writeFile(OAUTH_GO_LIVE_PATH, JSON.stringify(oauthGoLive, null, 2));
  await writeFile(OAUTH_GO_LIVE_MARKDOWN_PATH, renderOAuthGoLiveMarkdown(oauthGoLive));
  return { oauthGoLive, status: await getClipperStatus(userId) };
}

async function buildOAuthConnectionPackSummary(input: {
  accounts: ClipperAccount[];
  connectActions: ClipperConnectAction[];
  tokenVault: ClipperTokenVaultSummary;
  tokenRecords: ClipperTokenVaultRecord[];
  accountEvidence: ClipperAccountEvidenceSummary;
  developerAppEvidence: ClipperDeveloperAppEvidenceSummary;
  permissionTracker: ClipperPermissionTrackerSummary;
}): Promise<ClipperOAuthConnectionPackSummary> {
  await ensureClipperDirs();
  const publicBaseUrl = getPublicBaseUrl();
  const productionUrlReady = isProductionPublicBaseUrl(publicBaseUrl);
  const items = input.accounts.flatMap((account) => account.platformAccounts.map<ClipperOAuthConnectionPackItem>((platformAccount) => {
    const platform = platformAccount.platform;
    const requirement = PLATFORM_REQUIREMENTS.find((item) => item.platform === platform)!;
    const connectAction = input.connectActions.find((item) => item.platform === platform);
    const accountAuthUrl = connectAction?.authUrl ? buildPlatformAuthUrl(platform, account.id) : null;
    const tokenRecord = input.tokenRecords.find((item) => item.platform === platform && (item.accountId || null) === account.id)
      || input.tokenRecords.find((item) => item.platform === platform && !item.accountId);
    const accountEvidence = input.accountEvidence.items.find((item) => item.accountId === account.id && item.platform === platform);
    const developerApp = input.developerAppEvidence.items.find((item) => item.platform === platform);
    const permissionItems = input.permissionTracker.items.filter((item) => item.platform === platform);
    const approvedPermissions = permissionItems.filter((item) => item.status === "approved").length;
    const requestedOrApprovedPermissions = permissionItems.filter((item) => item.status === "requested" || item.status === "approved").length;
    const permissionSummary = `${approvedPermissions}/${permissionItems.length} approved; ${requestedOrApprovedPermissions}/${permissionItems.length} requested_or_approved`;
    const missingEnvVars = connectAction?.missingEnvVars || [];
    const blockers = [
      ...(productionUrlReady ? [] : ["PUBLIC_BASE_URL debe ser HTTPS publico antes de app review/OAuth final."]),
      ...(input.tokenVault.configured ? [] : [`Falta ${TOKEN_ENCRYPTION_ENV_VAR} para guardar tokens cifrados.`]),
      ...(accountAuthUrl ? [] : [`OAuth URL no lista: ${missingEnvVars.length ? missingEnvVars.join(", ") : "credenciales faltantes"}.`]),
      ...(accountEvidence?.status === "verified" ? [] : [`Evidencia de cuenta ${accountEvidence?.status || "missing"}.`]),
      ...(developerApp?.status === "approved" ? [] : [`Developer app ${developerApp?.status || "missing"}.`]),
      ...(permissionItems.length > 0 && approvedPermissions === permissionItems.length ? [] : [`Permisos ${permissionSummary}.`]),
      ...(tokenRecord ? [] : [`Token OAuth no guardado para ${platform}.`]),
    ];
    const hasProgress = Boolean(
      tokenRecord ||
      accountAuthUrl ||
      accountEvidence ||
      developerApp?.status === "draft" ||
      developerApp?.status === "submitted" ||
      developerApp?.status === "approved" ||
      requestedOrApprovedPermissions > 0
    );
    const status: ClipperOAuthConnectionPackStatus = blockers.length === 0
      ? "ready"
      : hasProgress
        ? "partial"
        : "blocked";
    const checklist = [
      `Confirmar que ${platformAccount.handle} existe, tiene login controlado y evidencia verificada.`,
      `Registrar redirect URI exacto: ${buildRedirectUri(platform)}`,
      `Solicitar/aprobar scopes: ${platformAccount.requiredScopes.join(", ")}`,
      accountAuthUrl ? "Abrir OAuth URL desde Clippers y autorizar con la cuenta correcta." : "Completar credenciales OAuth para generar auth URL.",
      "Confirmar que el callback guarda el token cifrado sin imprimir secretos.",
      "Hacer dry-run con approval_required antes de activar autopost.",
    ];
    const evidenceToCapture = [
      "Screenshot del perfil/login de la cuenta real.",
      "Screenshot del developer app mostrando redirect URI y scopes.",
      "Screenshot o export de app review/permisos aprobados.",
      "Registro del callback OAuth con code recibido y token guardado, sin mostrar token.",
      "Screenshot de /clippers mostrando Token saved y account evidence verified.",
    ];

    return {
      id: `${account.id}-${platform}-oauth`,
      accountId: account.id,
      accountName: account.name,
      category: account.category,
      platform,
      handle: platformAccount.handle,
      displayName: platformAccount.displayName,
      status,
      connectionStatus: platformAccount.status,
      authUrl: accountAuthUrl,
      callbackPath: connectAction?.callbackPath || `/api/clippers/oauth/${platform}/callback`,
      redirectUri: buildRedirectUri(platform),
      requestedScopes: platformAccount.requiredScopes,
      tokenSaved: Boolean(tokenRecord),
      tokenSavedAt: tokenRecord?.savedAt || null,
      tokenStatus: tokenRecord ? input.tokenVault.status : "token_missing",
      developerPortalUrl: requirement.developerPortalUrl,
      accountEvidenceStatus: accountEvidence?.status || "missing",
      accountEvidencePath: accountEvidence?.evidencePath || null,
      permissionStatuses: permissionItems.map((item) => item.status),
      permissionSummary,
      checklist,
      evidenceToCapture,
      requiredInputs: oauthConnectionRequiredInputs({
        platform,
        handle: platformAccount.handle,
        requestedScopes: platformAccount.requiredScopes,
        redirectUri: buildRedirectUri(platform),
        callbackPath: connectAction?.callbackPath || `/api/clippers/oauth/${platform}/callback`,
        missingEnvVars,
      }),
      completionHint: oauthConnectionCompletionHint({ platform, authUrl: accountAuthUrl }),
      blockers,
      nextStep: status === "ready"
        ? "Cuenta lista para dry-run OAuth/publicacion en approval_required."
        : blockers[0] || connectAction?.nextStep || "Completar conexion OAuth para esta cuenta.",
    };
  }));
  const totals = items.reduce<ClipperOAuthConnectionPackSummary["totals"]>((sum, item) => {
    sum.connections += 1;
    if (item.status === "ready") sum.ready += 1;
    if (item.status === "partial") sum.partial += 1;
    if (item.status === "blocked") sum.blocked += 1;
    if (item.tokenSaved) sum.tokensSaved += 1;
    if (item.authUrl) sum.authUrlsReady += 1;
    return sum;
  }, { connections: 0, ready: 0, partial: 0, blocked: 0, tokensSaved: 0, authUrlsReady: 0 });
  const generatedAt = await stat(OAUTH_CONNECTION_PACK_PATH).then((file) => file.mtime.toISOString()).catch(() => null);
  return {
    status: !generatedAt
      ? "not_prepared"
      : totals.ready === totals.connections && totals.connections > 0
        ? "ready"
        : totals.ready > 0 || totals.partial > 0
          ? "partial"
          : "blocked",
    generatedAt,
    manifestPath: OAUTH_CONNECTION_PACK_PATH,
    markdownPath: OAUTH_CONNECTION_PACK_MARKDOWN_PATH,
    csvPath: OAUTH_CONNECTION_PACK_CSV_PATH,
    publicBaseUrl,
    productionUrlReady,
    items,
    totals,
    nextStep: items.find((item) => item.status !== "ready")?.nextStep || "OAuth Connection Pack listo; correr dry-run por cuenta.",
  };
}

function renderOAuthConnectionPackMarkdown(summary: ClipperOAuthConnectionPackSummary): string {
  return [
    "# Clippers OAuth Connection Pack",
    "",
    `Status: ${summary.status}`,
    `Generated: ${summary.generatedAt || new Date().toISOString()}`,
    `Public base URL: ${summary.publicBaseUrl}`,
    `Production URL ready: ${summary.productionUrlReady ? "yes" : "no"}`,
    `Totals: ${summary.totals.ready} ready, ${summary.totals.partial} partial, ${summary.totals.blocked} blocked, ${summary.totals.tokensSaved} tokens saved`,
    `CSV: ${summary.csvPath}`,
    "",
    "## Next Step",
    "",
    summary.nextStep,
    "",
    "## Account Connections",
    "",
    ...summary.items.flatMap((item) => [
      `### ${item.accountName} - ${item.platform} - ${item.handle}`,
      "",
      `- Status: ${item.status}`,
      `- Category: ${item.category}`,
      `- Display name: ${item.displayName}`,
      `- Redirect URI: ${item.redirectUri}`,
      `- Callback path: ${item.callbackPath}`,
      `- OAuth URL ready: ${item.authUrl ? "yes" : "no"}`,
      `- Token saved: ${item.tokenSaved ? "yes" : "no"}`,
      `- Token saved at: ${item.tokenSavedAt || "n/a"}`,
      `- Token status: ${item.tokenStatus}`,
      `- Account evidence: ${item.accountEvidenceStatus}${item.accountEvidencePath ? ` (${item.accountEvidencePath})` : ""}`,
      `- Permissions: ${item.permissionSummary}`,
      `- Developer portal: ${item.developerPortalUrl}`,
      `- Completion hint: ${item.completionHint}`,
      `- Next step: ${item.nextStep}`,
      "",
      "Required inputs:",
      ...item.requiredInputs.map((input) => `- [ ] ${input}`),
      "",
      "Checklist:",
      ...item.checklist.map((step) => `- [ ] ${step}`),
      "",
      "Evidence to capture:",
      ...item.evidenceToCapture.map((step) => `- ${step}`),
      "",
      item.blockers.length ? "Blockers:" : "Blockers: none",
      ...item.blockers.map((blocker) => `- ${blocker}`),
      "",
    ]),
  ].join("\n");
}

function renderOAuthConnectionPackCsv(summary: ClipperOAuthConnectionPackSummary): string {
  const header = [
    "id",
    "account",
    "category",
    "platform",
    "handle",
    "status",
    "auth_url_ready",
    "token_saved",
    "account_evidence",
    "permissions",
    "required_inputs",
    "completion_hint",
    "redirect_uri",
    "next_step",
    "blockers",
  ];
  return [
    header.map(csvEscape).join(","),
    ...summary.items.map((item) => [
      item.id,
      item.accountName,
      item.category,
      item.platform,
      item.handle,
      item.status,
      item.authUrl ? "yes" : "no",
      item.tokenSaved ? "yes" : "no",
      item.accountEvidenceStatus,
      item.permissionSummary,
      item.requiredInputs.join(" | "),
      item.completionHint,
      item.redirectUri,
      item.nextStep,
      item.blockers.join(" | "),
    ].map(csvEscape).join(",")),
    "",
  ].join("\n");
}

export async function prepareClipperOAuthConnectionPack(userId = getSystemUserId()): Promise<{ oauthConnectionPack: ClipperOAuthConnectionPackSummary; status: ClipperStatus }> {
  await writeDefaultConfigIfMissing();
  await ensureClipperDirs();
  const config = await readConfig();
  const oauthConnections = await readOAuthConnections();
  const tokenRecords = await readTokenVaultRecords();
  const accounts = applyOAuthStateToAccounts(
    (Array.isArray(config.accounts) && config.accounts.length ? config.accounts : DEFAULT_ACCOUNTS).map(ensureAccountShape),
    oauthConnections,
    tokenRecords
  );
  const connectActions = buildClipperConnectActions();
  const tokenVault = await buildTokenVaultSummary();
  const credentialChecks = buildCredentialChecks();
  const permissionPack = await buildPermissionPackSummary();
  const accountEvidence = await buildAccountEvidenceSummary(accounts);
  const accountLaunchKit = await buildAccountLaunchKitSummary(accounts, accountEvidence);
  const developerAppEvidence = await buildDeveloperAppEvidenceSummary();
  const permissionTracker = await buildPermissionTrackerSummary({ accounts, credentialChecks, tokenRecords, oauthConnections, permissionPack, accountLaunchKit });
  const draftSummary = await buildOAuthConnectionPackSummary({ accounts, connectActions, tokenVault, tokenRecords, accountEvidence, developerAppEvidence, permissionTracker });
  const oauthConnectionPack: ClipperOAuthConnectionPackSummary = {
    ...draftSummary,
    generatedAt: new Date().toISOString(),
    status: draftSummary.totals.ready === draftSummary.totals.connections && draftSummary.totals.connections > 0
      ? "ready"
      : draftSummary.totals.ready > 0 || draftSummary.totals.partial > 0
        ? "partial"
        : "blocked",
  };
  await writeFile(OAUTH_CONNECTION_PACK_PATH, JSON.stringify(oauthConnectionPack, null, 2));
  await writeFile(OAUTH_CONNECTION_PACK_MARKDOWN_PATH, renderOAuthConnectionPackMarkdown(oauthConnectionPack));
  await writeFile(OAUTH_CONNECTION_PACK_CSV_PATH, renderOAuthConnectionPackCsv(oauthConnectionPack));
  return { oauthConnectionPack, status: await getClipperStatus(userId) };
}

export async function prepareClipperPermissionTracker(userId = getSystemUserId()): Promise<{ permissionTracker: ClipperPermissionTrackerSummary; status: ClipperStatus }> {
  await writeDefaultConfigIfMissing();
  await ensureClipperDirs();
  const config = await readConfig();
  const accounts = (Array.isArray(config.accounts) && config.accounts.length ? config.accounts : DEFAULT_ACCOUNTS).map(ensureAccountShape);
  const oauthConnections = await readOAuthConnections();
  const tokenRecords = await readTokenVaultRecords();
  const credentialChecks = buildCredentialChecks();
  const permissionPack = await buildPermissionPackSummary();
  const accountEvidence = await buildAccountEvidenceSummary(accounts);
  const accountLaunchKit = await buildAccountLaunchKitSummary(accounts, accountEvidence);
  const draftSummary = await buildPermissionTrackerSummary({
    accounts,
    credentialChecks,
    tokenRecords,
    oauthConnections,
    permissionPack,
    accountLaunchKit,
  });
  const generatedAt = new Date().toISOString();
  const permissionTracker: ClipperPermissionTrackerSummary = {
    ...draftSummary,
    generatedAt,
    status: permissionTrackerStatus(draftSummary.totals, generatedAt),
    nextStep: draftSummary.totals.blocked > 0
      ? "Resolver blockers y despues solicitar permisos en los developer portals."
      : draftSummary.totals.approved === draftSummary.totals.permissions
        ? "Permisos listos; mantener QA, rights gate y metricas antes de autopost masivo."
        : "Solicitar scopes ready_to_request y actualizar evidencia cuando haya app review/OAuth.",
  };
  await writeFile(PERMISSION_TRACKER_PATH, JSON.stringify(permissionTracker, null, 2));
  await writeFile(PERMISSION_TRACKER_MARKDOWN_PATH, buildPermissionTrackerMarkdown(permissionTracker));
  return { permissionTracker, status: await getClipperStatus(userId) };
}

async function buildMetricsSummary(accounts: ClipperAccount[]): Promise<ClipperMetricsSummary> {
  await ensureClipperDirs();
  const entries = await readdir(METRICS_DIR, { withFileTypes: true }).catch(() => []);
  const metricFiles = entries
    .filter((entry) => entry.isFile())
    .filter((entry) => [".csv", ".json"].includes(path.extname(entry.name).toLowerCase()))
    .filter((entry) => entry.name !== path.basename(METRICS_SUMMARY_PATH))
    .sort((a, b) => a.name.localeCompare(b.name));

  const files: ClipperMetricFile[] = [];
  const records: ClipperMetricRecord[] = [];
  for (const file of metricFiles) {
    const filePath = path.join(METRICS_DIR, file.name);
    const importedAt = (await stat(filePath)).mtime.toISOString();
    const result = await readMetricRecordsFromFile(filePath, accounts);
    records.push(...result.records);
    files.push({
      fileName: file.name,
      path: filePath,
      records: result.records.length,
      importedAt,
      status: result.error ? "error" : result.records.length > 0 ? "imported" : "skipped",
      error: result.error,
    });
  }

  const totals = records.reduce<ClipperMetricsSummary["totals"]>((sum, record) => {
    sum.clips += 1;
    sum.views += record.views;
    sum.likes += record.likes;
    sum.comments += record.comments;
    sum.shares += record.shares;
    sum.saves += record.saves;
    return sum;
  }, { clips: 0, views: 0, likes: 0, comments: 0, shares: 0, saves: 0, engagementRate: 0 });
  totals.engagementRate = totals.views > 0 ? (totals.likes + totals.comments + totals.shares + totals.saves) / totals.views : 0;

  const accountPerformance = buildMetricPerformance(accounts, records);
  const recommendations = buildMetricRecommendations(records, accountPerformance);
  return {
    status: files.length === 0 ? "empty" : records.length === 0 ? "needs_records" : "ready",
    metricsDir: METRICS_DIR,
    summaryPath: METRICS_SUMMARY_PATH,
    generatedAt: records.length || files.length ? new Date().toISOString() : null,
    files,
    records,
    totals,
    accountPerformance,
    topClips: [...records].sort((a, b) => b.views - a.views).slice(0, 5),
    recommendations,
    nextStep: files.length === 0
      ? "Exportar analytics CSV/JSON de TikTok, Instagram o YouTube y ponerlos en clippers_workspace/metrics."
      : records.length === 0
        ? "Revisar headers/columnas: account, platform, views, likes, comments, shares, saves, retention."
        : "Usar recomendaciones del Optimizer para ajustar hooks, volumen y horarios.",
  };
}

export async function ingestClipperMetrics(userId = getSystemUserId()): Promise<{ metrics: ClipperMetricsSummary; status: ClipperStatus }> {
  await ensureClipperDirs();
  const config = await readConfig();
  const accounts = (Array.isArray(config.accounts) && config.accounts.length ? config.accounts : DEFAULT_ACCOUNTS).map(ensureAccountShape);
  const metrics = await buildMetricsSummary(accounts);
  await writeFile(METRICS_SUMMARY_PATH, JSON.stringify(metrics, null, 2));
  return { metrics, status: await getClipperStatus(userId) };
}

function normalizePlatformLabel(value: string): ClipperPlatform | null {
  const normalized = value.toLowerCase();
  if (normalized.includes("tiktok")) return "tiktok";
  if (normalized.includes("instagram")) return "instagram";
  if (normalized.includes("youtube")) return "youtube";
  return null;
}

function buildPublishDate(slot: string, index: number): string {
  const base = new Date();
  base.setDate(base.getDate() + 1);
  const [rangeStart] = slot.split("-");
  const [hour = "12", minute = "00"] = rangeStart.split(":");
  base.setHours(Number(hour) || 12, Number(minute) || 0, 0, 0);
  base.setMinutes(base.getMinutes() + index * 35);
  return base.toISOString();
}

function buildCaptionSeed(item: ClipperProductionQueueItem, platform: ClipperPlatform): string {
  const platformTags: Record<ClipperPlatform, string> = {
    tiktok: "#fyp #clips",
    instagram: "#reels #viralclips",
    youtube: "#Shorts",
  };
  return `${item.hook}. ${platformTags[platform]}`;
}

function buildScheduledPosts(
  queueItems: ClipperProductionQueueItem[],
  tokenRecords: ClipperTokenVaultRecord[],
  publishMode: Required<ClipperRunOptions>["publishMode"]
): ClipperScheduledPost[] {
  const connectedPlatforms = new Set(tokenRecords.map((record) => record.platform));
  return queueItems.flatMap((item, itemIndex) =>
    item.platforms
      .map(normalizePlatformLabel)
      .filter((platform): platform is ClipperPlatform => Boolean(platform))
      .map((platform, platformIndex) => {
        let status: ClipperScheduledPostStatus = "ready_for_manual";
        let blocker: string | null = null;
        let nextStep = "Revisar y aprobar manualmente antes de publicar.";

        if (item.status === "needs_source") {
          status = "blocked_source";
          blocker = "Falta video fuente para esta cuenta/categoria.";
          nextStep = item.nextStep;
        } else if (item.status === "rights_review") {
          status = "blocked_rights";
          blocker = "Falta evidencia de permiso/licencia en allowlist.";
          nextStep = "Agregar evidencia en allowlist y regenerar cola.";
        } else if (!connectedPlatforms.has(platform)) {
          status = "blocked_connection";
          blocker = `Falta token OAuth cifrado para ${platform}.`;
          nextStep = "Conectar OAuth y completar app review antes de publicar.";
        } else if (publishMode === "auto_after_connection") {
          status = "scheduled";
          nextStep = "Listo para publicar automaticamente en la ventana sugerida.";
        }

        return {
          id: hashId(`${item.id}-${platform}`),
          queueItemId: item.id,
          accountId: item.accountId,
          accountName: item.accountName,
          platform,
          status,
          publishAt: buildPublishDate(item.publishWindow, itemIndex + platformIndex),
          sourcePath: item.sourcePath,
          hook: item.hook,
          captionSeed: buildCaptionSeed(item, platform),
          blocker,
          nextStep,
        };
      })
  );
}

function buildAutomationRecommendations(queue: ClipperProductionQueueSummary, posts: ClipperScheduledPost[]): string[] {
  const blockers = posts.filter((post) => post.blocker);
  const sourceBlockers = posts.filter((post) => post.status === "blocked_source").length;
  const rightsBlockers = posts.filter((post) => post.status === "blocked_rights").length;
  const connectionBlockers = posts.filter((post) => post.status === "blocked_connection").length;
  return [
    sourceBlockers > 0
      ? `Agregar fuentes reales para ${sourceBlockers} slots bloqueados por falta de video.`
      : "Fuentes suficientes para los items detectados.",
    rightsBlockers > 0
      ? `Subir evidencia en allowlist para ${rightsBlockers} posts antes de editar/publicar.`
      : "Rights Gate no encontro bloqueos de derechos en los items listos.",
    connectionBlockers > 0
      ? `Conectar OAuth/token vault para desbloquear ${connectionBlockers} posts por plataforma.`
      : "Las plataformas requeridas tienen token disponible para los posts listos.",
    queue.status === "ready"
      ? "Mantener approval_required hasta validar rendimiento y strikes de las cuentas."
      : "La prioridad sigue siendo convertir sources/rights/conexiones en drafts publicables.",
    blockers.length > 0
      ? "No activar autopost hasta que blocked sea 0."
      : "El siguiente ciclo puede probar auto_after_connection con volumen controlado.",
  ];
}

async function readLatestAutomationRun(): Promise<ClipperAutomationRun | null> {
  await ensureClipperDirs();
  const files = await readdir(SCHEDULED_DIR).catch(() => []);
  const runs = files.filter((file) => file.startsWith("automation-cycle-") && file.endsWith(".json")).sort().reverse();
  if (!runs[0]) return null;
  try {
    const raw = await readFile(path.join(SCHEDULED_DIR, runs[0]), "utf8");
    return JSON.parse(raw) as ClipperAutomationRun;
  } catch {
    return null;
  }
}

async function buildAutomationSummary(): Promise<ClipperAutomationSummary> {
  const lastRun = await readLatestAutomationRun();
  return {
    status: lastRun?.status || "not_run",
    lastRun,
    nextRunHint: "Daily 08:30 local despues de revisar fuentes, permisos y tokens.",
    nextStep: lastRun
      ? lastRun.blockers.length > 0
        ? "Resolver blockers antes de autopost."
        : "Revisar ready_for_manual o activar auto_after_connection cuando sea apropiado."
      : "Ejecuta el ciclo diario para generar calendario y reporte operativo.",
  };
}

function defaultAutomationSchedule(accounts: ClipperAccount[]): ClipperAutomationScheduleSummary {
  const clipsPerAccount = Math.max(1, Math.round(100 / Math.max(accounts.length, 1) / 7));
  return {
    status: "not_prepared",
    enabled: false,
    timezone: "America/New_York",
    dailyRunTime: "08:30",
    clipsPerAccount,
    publishMode: "approval_required",
    riskTolerance: "growth",
    weeklyTargetClips: 100,
    manifestPath: AUTOMATION_SCHEDULE_PATH,
    generatedAt: null,
    runbook: [
      "Ingerir Trend Radar y filtrar oportunidades por permisos.",
      "Revisar sources y allowlist antes de generar cola.",
      "Preparar cola de produccion y bloquear items sin derechos/tokens.",
      "Ejecutar ciclo diario en approval_required hasta que blocked sea 0.",
      "Importar metricas y mover volumen hacia cuentas/hooks ganadores.",
    ],
    nextStep: "Preparar schedule diario para dejar definido horario, volumen y modo operativo.",
  };
}

async function buildAutomationScheduleSummary(accounts: ClipperAccount[]): Promise<ClipperAutomationScheduleSummary> {
  await ensureClipperDirs();
  try {
    const raw = await readFile(AUTOMATION_SCHEDULE_PATH, "utf8");
    const parsed = JSON.parse(raw) as ClipperAutomationScheduleSummary;
    return {
      ...defaultAutomationSchedule(accounts),
      ...parsed,
      status: "prepared",
      manifestPath: AUTOMATION_SCHEDULE_PATH,
      nextStep: parsed.enabled
        ? "Schedule preparado; ejecuta ciclo diario o conecta un runner externo al manifest."
        : "Schedule preparado en modo manual; activa enabled cuando el runner externo este conectado.",
    };
  } catch {
    return defaultAutomationSchedule(accounts);
  }
}

export async function prepareClipperAutomationSchedule(input: unknown = {}, userId = getSystemUserId()): Promise<{ automationSchedule: ClipperAutomationScheduleSummary; status: ClipperStatus }> {
  await writeDefaultConfigIfMissing();
  await ensureClipperDirs();
  const config = await readConfig();
  const accounts = (Array.isArray(config.accounts) && config.accounts.length ? config.accounts : DEFAULT_ACCOUNTS).map(ensureAccountShape);
  const options = normalizeRunOptions(input);
  const incoming = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const defaultSchedule = defaultAutomationSchedule(accounts);
  const dailyRunTime = typeof incoming.dailyRunTime === "string" && /^\d{2}:\d{2}$/.test(incoming.dailyRunTime)
    ? incoming.dailyRunTime
    : defaultSchedule.dailyRunTime;
  const timezone = typeof incoming.timezone === "string" && incoming.timezone.trim()
    ? incoming.timezone.trim()
    : defaultSchedule.timezone;
  const weeklyTargetClips = Number.isFinite(Number(incoming.weeklyTargetClips))
    ? Math.max(7, Math.min(1000, Math.round(Number(incoming.weeklyTargetClips))))
    : defaultSchedule.weeklyTargetClips;
  const automationSchedule: ClipperAutomationScheduleSummary = {
    ...defaultSchedule,
    status: "prepared",
    enabled: Boolean(incoming.enabled),
    timezone,
    dailyRunTime,
    clipsPerAccount: options.clipsPerAccount,
    publishMode: options.publishMode,
    riskTolerance: options.riskTolerance,
    weeklyTargetClips,
    generatedAt: new Date().toISOString(),
    nextStep: "Schedule manifest listo; usar este horario para correr /api/clippers/run-automation-cycle.",
  };
  await writeFile(AUTOMATION_SCHEDULE_PATH, JSON.stringify(automationSchedule, null, 2));
  return { automationSchedule, status: await getClipperStatus(userId) };
}

function manualPostingStatusFromTotals(
  totals: ClipperManualPostingPackSummary["totals"],
  generatedAt: string | null
): ClipperManualPostingPackStatus {
  if (!generatedAt) return "not_prepared";
  if (totals.readyToPost === 0) return "blocked";
  if (totals.readyToPost < totals.posts) return "partial";
  return "ready";
}

function buildManualPostingPackItems(
  queue: ClipperProductionQueueSummary,
  accountLaunchKit: ClipperAccountLaunchKitSummary
): ClipperManualPostingPackItem[] {
  const tasksByAccountPlatform = new Map(
    accountLaunchKit.tasks.map((task) => [`${task.accountId}:${task.platform}`, task])
  );

  return queue.items.flatMap((queueItem, itemIndex) =>
    queueItem.platforms
      .map(normalizePlatformLabel)
      .filter((platform): platform is ClipperPlatform => Boolean(platform))
      .map((platform, platformIndex) => {
        const task = tasksByAccountPlatform.get(`${queueItem.accountId}:${platform}`);
        let status: ClipperManualPostingItemStatus = "ready_to_post";
        let blocker: string | null = null;
        let nextStep = "Publicar manualmente, guardar URL del post y exportar metricas despues de 24h.";

        if (queueItem.status === "needs_source") {
          status = "needs_source";
          blocker = "Falta video fuente.";
          nextStep = queueItem.nextStep;
        } else if (queueItem.status === "rights_review") {
          status = "needs_rights";
          blocker = "Falta evidencia de permiso/licencia.";
          nextStep = "Agregar evidencia allowlist antes de renderizar o publicar.";
        } else if (!task || task.evidenceStatus !== "verified") {
          status = "needs_account";
          blocker = "Falta evidencia de cuenta real verificada para publicar manualmente.";
          nextStep = task?.nextStep || "Crear/verificar la cuenta real y guardar evidencia.";
        }

        const handle = task?.handle || `@${queueItem.accountId}-${platform}`;
        return {
          id: hashId(`${queueItem.id}-${platform}-manual`),
          queueItemId: queueItem.id,
          accountId: queueItem.accountId,
          accountName: queueItem.accountName,
          category: queueItem.category,
          platform,
          handle,
          profileLink: task?.profileLink || "",
          status,
          publishAt: buildPublishDate(queueItem.publishWindow, itemIndex + platformIndex),
          sourcePath: queueItem.sourcePath,
          hook: queueItem.hook,
          caption: buildCaptionSeed(queueItem, platform),
          format: queueItem.format,
          blocker,
          checklist: [
            "Confirmar sourcePath y derechos antes de subir.",
            "Render 9:16 con hook en los primeros 2 segundos.",
            "Usar caption seed y ajustar hashtags por plataforma.",
            "Guardar URL del post y metricas en clippers_workspace/metrics.",
          ],
          nextStep,
        };
      })
  );
}

function sourceFolderForCategory(category: ClipperAccountCategory): string {
  return SOURCE_FOLDERS.find((folder) => folder.category === category)?.path || path.join(SOURCES_DIR, category);
}

function allowlistFolderPath(): string {
  return SOURCE_FOLDERS.find((folder) => folder.category === "allowlist")?.path || path.join(SOURCES_DIR, "allowlist");
}

function buildManualPostingWeeklyRunway(totals: ClipperManualPostingPackSummary["totals"]): ClipperManualPostingWeeklyRunway {
  const targetWeeklyPosts = 100;
  const gapToTarget = Math.max(0, targetWeeklyPosts - totals.readyToPost);
  return {
    targetWeeklyPosts,
    plannedPosts: totals.posts,
    readyToPost: totals.readyToPost,
    gapToTarget,
    sourceSlotsNeeded: totals.needsSource,
    rightsSlotsNeeded: totals.needsRights,
    accountSlotsNeeded: totals.needsAccount,
    recommendedDailyReadyPosts: Math.ceil(targetWeeklyPosts / 7),
    nextStep: gapToTarget === 0
      ? "Manual posting runway cubre 100 posts/semana; ejecutar publicaciones y medir."
      : `Faltan ${gapToTarget} posts ready_to_post para cubrir 100/semana; priorizar sources y rights evidence.`,
  };
}

function buildManualPostingUnblockSession(items: ClipperManualPostingPackItem[]): ClipperManualPostingUnblockItem[] {
  return items
    .filter((item) => item.status !== "ready_to_post")
    .slice(0, 30)
    .map((item, index) => ({
      rank: index + 1,
      itemId: item.id,
      accountName: item.accountName,
      category: item.category,
      platform: item.platform,
      status: item.status,
      publishAt: item.publishAt,
      sourceFolder: sourceFolderForCategory(item.category),
      allowlistFolder: allowlistFolderPath(),
      requiredEvidence: item.status === "needs_source"
        ? [
          `Add a source video to ${sourceFolderForCategory(item.category)}.`,
          "Record source title, URL/owner, posted_at and visible metrics if discovered from Viral Discovery.",
          "Add allowlist evidence before moving to draft if the asset is not owned/licensed.",
        ]
        : item.status === "needs_rights"
          ? [
            `Add permission/license evidence to ${allowlistFolderPath()}.`,
            "Reference the exact sourcePath and rightsholder/creator approval.",
            "Regenerate Production Queue and Draft Specs after evidence is saved.",
          ]
          : [
            "Create/verify the account and submit Account Evidence.",
            "Confirm handle/profile URL matches the posting target.",
            "Regenerate Account Launch Kit and Manual Posting Pack.",
          ],
      doneCriteria: [
        "Production Queue item no longer reports needs_source/rights_review for this slot.",
        "Manual Posting Pack item changes to ready_to_post or moves to the next real blocker.",
        "Draft Specs has an editable spec when render assets are available.",
      ],
      nextStep: item.nextStep,
    }));
}

async function buildManualPostingPackSummary(
  queue: ClipperProductionQueueSummary,
  accountLaunchKit: ClipperAccountLaunchKitSummary
): Promise<ClipperManualPostingPackSummary> {
  const generatedAt = await stat(MANUAL_POSTING_PACK_PATH).then((file) => file.mtime.toISOString()).catch(() => null);
  const items = buildManualPostingPackItems(queue, accountLaunchKit);
  const totals = items.reduce<ClipperManualPostingPackSummary["totals"]>((sum, item) => {
    sum.posts += 1;
    if (item.status === "ready_to_post") sum.readyToPost += 1;
    if (item.status === "needs_account") sum.needsAccount += 1;
    if (item.status === "needs_source") sum.needsSource += 1;
    if (item.status === "needs_rights") sum.needsRights += 1;
    return sum;
  }, { posts: 0, readyToPost: 0, needsAccount: 0, needsSource: 0, needsRights: 0 });
  const weeklyRunway = buildManualPostingWeeklyRunway(totals);
  const unblockSession = buildManualPostingUnblockSession(items);
  const status = manualPostingStatusFromTotals(totals, generatedAt);
  return {
    status,
    generatedAt,
    manifestPath: MANUAL_POSTING_PACK_PATH,
    markdownPath: MANUAL_POSTING_PACK_MARKDOWN_PATH,
    csvPath: MANUAL_POSTING_PACK_CSV_PATH,
    items,
    weeklyRunway,
    unblockSession,
    totals,
    nextStep: !generatedAt
      ? "Generar Manual Posting Pack para operar mientras OAuth/app review sigue pendiente."
      : totals.readyToPost > 0
        ? "Publicar los ready_to_post, guardar URLs y medir despues de 24h."
        : "Desbloquear cuentas, sources o derechos antes de publicar manualmente.",
  };
}

function renderManualPostingPackMarkdown(summary: ClipperManualPostingPackSummary): string {
  return [
    "# Clippers Manual Posting Pack",
    "",
    `Status: ${summary.status}`,
    `Generated: ${summary.generatedAt || "pending"}`,
    `Next step: ${summary.nextStep}`,
    "",
    "## Totals",
    "",
    `- Posts: ${summary.totals.posts}`,
    `- Ready to post: ${summary.totals.readyToPost}`,
    `- Needs account: ${summary.totals.needsAccount}`,
    `- Needs source: ${summary.totals.needsSource}`,
    `- Needs rights: ${summary.totals.needsRights}`,
    "",
    "## Weekly Runway",
    "",
    `- Target weekly posts: ${summary.weeklyRunway.targetWeeklyPosts}`,
    `- Planned posts: ${summary.weeklyRunway.plannedPosts}`,
    `- Ready to post: ${summary.weeklyRunway.readyToPost}`,
    `- Gap to target: ${summary.weeklyRunway.gapToTarget}`,
    `- Source slots needed: ${summary.weeklyRunway.sourceSlotsNeeded}`,
    `- Rights slots needed: ${summary.weeklyRunway.rightsSlotsNeeded}`,
    `- Account slots needed: ${summary.weeklyRunway.accountSlotsNeeded}`,
    `- Recommended daily ready posts: ${summary.weeklyRunway.recommendedDailyReadyPosts}`,
    `- Next step: ${summary.weeklyRunway.nextStep}`,
    "",
    "## Unblock Session",
    "",
    ...summary.unblockSession.flatMap((item) => [
      `### ${item.rank}. ${item.accountName} / ${item.platform}`,
      "",
      `- Status: ${item.status}`,
      `- Category: ${item.category}`,
      `- Publish at: ${item.publishAt}`,
      `- Source folder: ${item.sourceFolder}`,
      `- Allowlist folder: ${item.allowlistFolder}`,
      `- Next step: ${item.nextStep}`,
      "",
      "Required evidence:",
      ...item.requiredEvidence.map((evidence) => `- [ ] ${evidence}`),
      "",
      "Done criteria:",
      ...item.doneCriteria.map((criterion) => `- [ ] ${criterion}`),
      "",
    ]),
    "## Queue",
    "",
    ...summary.items.flatMap((item) => [
      `### ${item.accountName} / ${item.platform} / ${item.handle}`,
      "",
      `- Status: ${item.status}`,
      `- Publish at: ${item.publishAt}`,
      `- Source: ${item.sourcePath || "missing"}`,
      `- Hook: ${item.hook}`,
      `- Caption: ${item.caption}`,
      item.blocker ? `- Blocker: ${item.blocker}` : null,
      `- Next step: ${item.nextStep}`,
      "",
    ].filter((line): line is string => Boolean(line))),
  ].join("\n");
}

function renderManualPostingPackCsv(summary: ClipperManualPostingPackSummary): string {
  const headers = ["id", "account_id", "account_name", "platform", "handle", "status", "publish_at", "source_path", "hook", "caption", "blocker", "source_folder", "allowlist_folder", "next_step"];
  const rows = summary.items.map((item) => [
    item.id,
    item.accountId,
    item.accountName,
    item.platform,
    item.handle,
    item.status,
    item.publishAt,
    item.sourcePath,
    item.hook,
    item.caption,
    item.blocker,
    sourceFolderForCategory(item.category),
    allowlistFolderPath(),
    item.nextStep,
  ]);
  return [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
}

export async function prepareClipperManualPostingPack(userId = getSystemUserId()): Promise<{ manualPostingPack: ClipperManualPostingPackSummary; status: ClipperStatus }> {
  await writeDefaultConfigIfMissing();
  await ensureClipperDirs();
  const queueResult = await prepareClipperProductionQueue(userId);
  const accountEvidence = await buildAccountEvidenceSummary(queueResult.status.accounts);
  const accountLaunchKit = await buildAccountLaunchKitSummary(queueResult.status.accounts, accountEvidence);
  const draftSummary = await buildManualPostingPackSummary(queueResult.queue, accountLaunchKit);
  const manualPostingPack: ClipperManualPostingPackSummary = {
    ...draftSummary,
    generatedAt: new Date().toISOString(),
    status: manualPostingStatusFromTotals(draftSummary.totals, new Date().toISOString()),
  };
  await writeFile(MANUAL_POSTING_PACK_PATH, JSON.stringify(manualPostingPack, null, 2));
  await writeFile(MANUAL_POSTING_PACK_MARKDOWN_PATH, renderManualPostingPackMarkdown(manualPostingPack));
  await writeFile(MANUAL_POSTING_PACK_CSV_PATH, renderManualPostingPackCsv(manualPostingPack));
  return { manualPostingPack, status: await getClipperStatus(userId) };
}

function auditStatusFromItems(items: ClipperGrowthAuditItem[]): ClipperGrowthAuditStatus {
  if (items.some((item) => item.status === "critical")) return "critical";
  if (items.some((item) => item.status === "warning")) return "warning";
  return "ready";
}

function scoreGrowthAudit(items: ClipperGrowthAuditItem[]): number {
  return Math.max(0, 100 - items.reduce((penalty, item) => {
    if (item.status === "ready") return penalty;
    const base = item.status === "critical" ? 18 : 8;
    const impact = item.impact === "high" ? 1.25 : item.impact === "medium" ? 1 : 0.65;
    return penalty + Math.round(base * impact);
  }, 0));
}

function buildGrowthAudit(input: {
  accounts: ClipperAccount[];
  credentialChecks: ClipperCredentialCheck[];
  tokenVault: ClipperTokenVaultSummary;
  permissionPack: ClipperPermissionPackSummary;
  productionQueue: ClipperProductionQueueSummary;
  sourceAcquisition: ClipperSourceAcquisitionSummary;
  automation: ClipperAutomationSummary;
  automationSchedule: ClipperAutomationScheduleSummary;
  manualPostingPack: ClipperManualPostingPackSummary;
  publishingPackage: ClipperPublishingPackageSummary;
  goLiveExecutionPack: ClipperGoLiveExecutionPackSummary;
  httpsTunnelPlan: ClipperHttpsTunnelPlanSummary;
  legalPolicyPack: ClipperLegalPolicyPackSummary;
  appReviewDemoPack: ClipperAppReviewDemoPackSummary;
  developerApplicationDrafts: ClipperDeveloperApplicationDraftsSummary;
  accountCreationPack: ClipperAccountCreationPackSummary;
  permissionRequestPack: ClipperPermissionRequestPackSummary;
  oauthConnectionPack: ClipperOAuthConnectionPackSummary;
  driveWorkspace: ClipperDriveWorkspaceSummary;
  metrics: ClipperMetricsSummary;
  trendRadar: ClipperTrendRadarSummary;
  accountEvidence: ClipperAccountEvidenceSummary;
  developerAppEvidence: ClipperDeveloperAppEvidenceSummary;
  accountIdentityKit: ClipperAccountIdentityKitSummary;
  accountLaunchKit: ClipperAccountLaunchKitSummary;
  permissionTracker: ClipperPermissionTrackerSummary;
}): ClipperGrowthAudit {
  const connectedPlatformTokens = input.tokenVault.records.length;
  const totalPlatformAccounts = input.accounts.reduce((sum, account) => sum + account.platformAccounts.length, 0);
  const dailyClipTarget = input.accounts.reduce((sum, account) => sum + account.dailyClipTarget, 0);
  const missingCredentialCount = input.credentialChecks.reduce((sum, check) => sum + check.missingEnvVars.length, 0);
  const weeklyGoalGap = input.accounts.reduce((sum, account) => sum + Math.max(account.weeklyViewsGoal - account.lastWeekViews, 0), 0);
  const readyQueueItems = input.productionQueue.items.filter((item) => item.status === "draft_ready").length;
  const blockedPosts = input.automation.lastRun?.totals.blocked ?? input.productionQueue.items.length;
  const readyPermissionFiles = input.permissionPack.files.filter((file) => file.exists).length;

  const items: ClipperGrowthAuditItem[] = [
    {
      id: "account-identity-kit",
      label: "Account Identity Kit",
      status: input.accountIdentityKit.status === "ready" ? "ready" : "warning",
      impact: "medium",
      owner: "Account Ops",
      evidence: `${input.accountIdentityKit.totals.platformProfiles} perfiles plataforma; ${input.accountIdentityKit.totals.firstPostIdeas} ideas iniciales.`,
      nextStep: input.accountIdentityKit.nextStep,
    },
    {
      id: "account-launch-kit",
      label: "Account Launch Kit",
      status: input.accountLaunchKit.generatedAt ? input.accountLaunchKit.status === "ready" ? "ready" : "warning" : "critical",
      impact: "medium",
      owner: "Account Ops",
      evidence: `${input.accountLaunchKit.totals.tasks} tareas; ${input.accountLaunchKit.totals.blocked} bloqueadas; manifest ${input.accountLaunchKit.generatedAt ? "generado" : "pendiente"}.`,
      nextStep: input.accountLaunchKit.nextStep,
    },
    {
      id: "account-creation-pack",
      label: "Account Creation Pack",
      status: input.accountCreationPack.status === "ready" ? "ready" : input.accountCreationPack.generatedAt ? "warning" : "critical",
      impact: "high",
      owner: "Account Ops",
      evidence: `${input.accountCreationPack.totals.ready}/${input.accountCreationPack.totals.profiles} perfiles ready; ${input.accountCreationPack.totals.evidenceMissing} sin evidencia.`,
      nextStep: input.accountCreationPack.nextStep,
    },
    {
      id: "account-evidence",
      label: "Evidencia de cuentas",
      status: input.accountEvidence.status === "ready" ? "ready" : input.accountEvidence.items.length > 0 ? "warning" : "critical",
      impact: "high",
      owner: "Account Ops",
      evidence: `${input.accountEvidence.totals.verified}/${input.accountEvidence.totals.expected} cuentas plataforma verificadas; ${input.accountEvidence.totals.missing} sin evidencia.`,
      nextStep: input.accountEvidence.nextStep,
    },
    {
      id: "platform-accounts",
      label: "Cuentas reales por plataforma",
      status: input.accounts.every((account) => account.platformAccounts.every((platform) => platform.status === "ready" || platform.status === "needs_review")) ? "warning" : "critical",
      impact: "high",
      owner: "Account Ops",
      evidence: `${totalPlatformAccounts} cuentas plataforma internas preparadas; la creacion/verificacion real sigue pendiente donde status no sea needs_review/ready.`,
      nextStep: "Crear/verificar las cuentas reales y marcar cada plataforma autorizada despues de OAuth/app review.",
    },
    {
      id: "oauth-permissions",
      label: "OAuth, tokens y app review",
      status: connectedPlatformTokens >= 3 ? "ready" : missingCredentialCount === 0 ? "warning" : "critical",
      impact: "high",
      owner: "Publisher",
      evidence: `${connectedPlatformTokens}/3 plataformas con token cifrado; ${missingCredentialCount} env vars faltantes.`,
      nextStep: "Agregar env vars, conectar OAuth y completar app review para TikTok, Meta e YouTube.",
    },
    {
      id: "developer-app-evidence",
      label: "Developer apps",
      status: input.developerAppEvidence.status === "ready" ? "ready" : input.developerAppEvidence.items.length > 0 ? "warning" : "critical",
      impact: "high",
      owner: "Permission Ops",
      evidence: `${input.developerAppEvidence.totals.approved}/${input.developerAppEvidence.totals.expected} apps aprobadas; ${input.developerAppEvidence.totals.missing} sin evidencia.`,
      nextStep: input.developerAppEvidence.nextStep,
    },
    {
      id: "permission-tracker",
      label: "Permission Tracker",
      status: input.permissionTracker.status === "ready" ? "ready" : input.permissionTracker.generatedAt ? "warning" : "critical",
      impact: "high",
      owner: "Permission Ops",
      evidence: `${input.permissionTracker.totals.approved}/${input.permissionTracker.totals.permissions} permisos aprobados; ${input.permissionTracker.totals.blocked} bloqueados.`,
      nextStep: input.permissionTracker.nextStep,
    },
    {
      id: "permission-request-pack",
      label: "Permission Request Pack",
      status: input.permissionRequestPack.status === "ready" ? "ready" : input.permissionRequestPack.generatedAt ? "warning" : "critical",
      impact: "high",
      owner: "Permission Ops",
      evidence: `${input.permissionRequestPack.totals.ready}/${input.permissionRequestPack.totals.permissions} permisos ready; ${input.permissionRequestPack.totals.blocked} bloqueados.`,
      nextStep: input.permissionRequestPack.nextStep,
    },
    {
      id: "oauth-connection-pack",
      label: "OAuth Connection Pack",
      status: input.oauthConnectionPack.status === "ready" ? "ready" : input.oauthConnectionPack.generatedAt ? "warning" : "critical",
      impact: "high",
      owner: "Publisher",
      evidence: `${input.oauthConnectionPack.totals.ready}/${input.oauthConnectionPack.totals.connections} cuentas/plataforma ready; ${input.oauthConnectionPack.totals.tokensSaved} tokens guardados; ${input.oauthConnectionPack.totals.authUrlsReady} OAuth URLs listas.`,
      nextStep: input.oauthConnectionPack.nextStep,
    },
    {
      id: "app-review-pack",
      label: "Paquete de permisos",
      status: input.permissionPack.status === "ready" ? "ready" : input.permissionPack.status === "partial" ? "warning" : "critical",
      impact: "medium",
      owner: "Permission Ops",
      evidence: `${readyPermissionFiles}/${input.permissionPack.files.length} archivos listos para OAuth, redirect URIs y app review.`,
      nextStep: input.permissionPack.status === "ready"
        ? "Usar el paquete para completar app review en TikTok, Meta y Google."
        : "Generar el paquete de permisos desde Clippers antes de solicitar app review.",
    },
    {
      id: "google-drive-workspace",
      label: "Google Drive workspace",
      status: input.driveWorkspace.status === "ready" ? "ready" : input.driveWorkspace.configured ? "warning" : "critical",
      impact: "medium",
      owner: "Source Ops",
      evidence: `${input.driveWorkspace.folders.filter((folder) => folder.folderId).length}/${input.driveWorkspace.folders.length} carpetas Drive preparadas.`,
      nextStep: input.driveWorkspace.nextStep,
    },
    {
      id: "source-supply",
      label: "Suministro diario de videos",
      status: input.sourceAcquisition.status === "ready" ? "ready" : input.sourceAcquisition.status === "partial" ? "warning" : "critical",
      impact: "high",
      owner: "Trend Scout",
      evidence: `${input.sourceAcquisition.totals.readyQueueSlots}/${dailyClipTarget} slots listos; ${input.sourceAcquisition.totals.missingSourceSlots} sin fuente; ${input.sourceAcquisition.totals.rightsReviewSlots} en rights_review.`,
      nextStep: input.sourceAcquisition.nextStep,
    },
    {
      id: "trend-radar",
      label: "Trend Radar",
      status: input.trendRadar.status === "ready" ? "ready" : input.trendRadar.files.length > 0 ? "warning" : "critical",
      impact: "high",
      owner: "Trend Scout",
      evidence: `${input.trendRadar.candidates.length} oportunidades; ${input.trendRadar.topCandidates.filter((candidate) => candidate.rightsStatus === "owned_or_permissioned").length} top candidates con permiso/evidencia.`,
      nextStep: input.trendRadar.nextStep,
    },
    {
      id: "rights-gate",
      label: "Derechos y allowlist",
      status: input.productionQueue.items.some((item) => item.status === "rights_review") ? "critical" : readyQueueItems > 0 ? "ready" : "warning",
      impact: "high",
      owner: "Rights Gate",
      evidence: `${readyQueueItems} items listos; ${input.productionQueue.items.filter((item) => item.status === "rights_review").length} en rights_review.`,
      nextStep: "Subir evidencia por asset en allowlist antes de editar/publicar.",
    },
    {
      id: "daily-automation",
      label: "Ciclo diario y calendario",
      status: input.automation.status === "ready" ? "ready" : input.automationSchedule.status === "prepared" || input.automation.status === "partial" ? "warning" : "critical",
      impact: "medium",
      owner: "Publisher",
      evidence: input.automation.lastRun ? `${input.automation.lastRun.totals.posts} posts evaluados; ${blockedPosts} bloqueados.` : `${input.automationSchedule.status}; ${input.automationSchedule.dailyRunTime} ${input.automationSchedule.timezone}.`,
      nextStep: input.automationSchedule.status === "prepared" ? input.automation.nextStep : input.automationSchedule.nextStep,
    },
    {
      id: "manual-posting-pack",
      label: "Manual Posting Pack",
      status: input.manualPostingPack.status === "ready" ? "ready" : input.manualPostingPack.status === "partial" ? "warning" : "critical",
      impact: "medium",
      owner: "Publisher",
      evidence: `${input.manualPostingPack.totals.readyToPost}/${input.manualPostingPack.totals.posts} posts manuales listos; ${input.manualPostingPack.totals.needsAccount} necesitan cuenta; ${input.manualPostingPack.totals.needsSource} necesitan source.`,
      nextStep: input.manualPostingPack.nextStep,
    },
    {
      id: "publishing-package",
      label: "Publishing Package",
      status: input.publishingPackage.status === "ready" ? "ready" : input.publishingPackage.status === "partial" ? "warning" : "critical",
      impact: "high",
      owner: "Publisher",
      evidence: `${input.publishingPackage.totals.readyForManual}/${input.publishingPackage.totals.items} uploads ready_for_manual; ${input.publishingPackage.totals.needsAccount} necesitan cuenta; ${input.publishingPackage.totals.needsRenderedClip} necesitan render.`,
      nextStep: input.publishingPackage.nextStep,
    },
    {
      id: "go-live-execution-pack",
      label: "Go-Live Execution Pack",
      status: input.goLiveExecutionPack.status === "ready" ? "ready" : input.goLiveExecutionPack.status === "in_progress" ? "warning" : "critical",
      impact: "high",
      owner: "Platform Ops",
      evidence: `${input.goLiveExecutionPack.totals.done}/${input.goLiveExecutionPack.totals.phases} fases done; ${input.goLiveExecutionPack.totals.readyToExecute} listas para ejecutar.`,
      nextStep: input.goLiveExecutionPack.nextStep,
    },
    {
      id: "https-tunnel-plan",
      label: "HTTPS Tunnel / Deploy Plan",
      status: input.httpsTunnelPlan.status === "ready" ? "ready" : input.httpsTunnelPlan.generatedAt ? "warning" : "critical",
      impact: "high",
      owner: "Platform Ops",
      evidence: `${input.httpsTunnelPlan.publicBaseUrl}; production URL ${input.httpsTunnelPlan.productionUrlReady ? "ready" : "blocked"}.`,
      nextStep: input.httpsTunnelPlan.nextStep,
    },
    {
      id: "legal-policy-pack",
      label: "Legal Policy Pack",
      status: input.legalPolicyPack.status === "ready" ? "ready" : input.legalPolicyPack.generatedAt ? "warning" : "critical",
      impact: "medium",
      owner: "Legal Ops",
      evidence: `Privacy: ${input.legalPolicyPack.privacyUrl}; Terms: ${input.legalPolicyPack.termsUrl}.`,
      nextStep: input.legalPolicyPack.nextStep,
    },
    {
      id: "app-review-demo-pack",
      label: "App Review Demo Pack",
      status: input.appReviewDemoPack.status === "ready" ? "ready" : input.appReviewDemoPack.generatedAt ? "warning" : "critical",
      impact: "medium",
      owner: "Permission Ops",
      evidence: `${input.appReviewDemoPack.demoUrl}; demo ${input.appReviewDemoPack.productionUrlReady ? "public HTTPS" : "local/dev"}.`,
      nextStep: input.appReviewDemoPack.nextStep,
    },
    {
      id: "developer-application-drafts",
      label: "Developer Application Drafts",
      status: input.developerApplicationDrafts.status === "ready" ? "ready" : input.developerApplicationDrafts.generatedAt ? "warning" : "critical",
      impact: "high",
      owner: "Permission Ops",
      evidence: `${input.developerApplicationDrafts.totals.ready}/${input.developerApplicationDrafts.totals.platforms} plataformas listas; ${input.developerApplicationDrafts.totals.scopes} scopes preparados.`,
      nextStep: input.developerApplicationDrafts.nextStep,
    },
    {
      id: "metrics-loop",
      label: "Metricas y optimizacion",
      status: input.metrics.status === "ready" ? "ready" : input.metrics.files.length > 0 ? "warning" : "critical",
      impact: "high",
      owner: "Optimizer",
      evidence: `${input.metrics.records.length} metric records; ${input.metrics.totals.views.toLocaleString("en-US")} views importadas.`,
      nextStep: input.metrics.nextStep,
    },
    {
      id: "creative-testing",
      label: "Testing creativo",
      status: readyQueueItems >= dailyClipTarget ? "ready" : readyQueueItems > 0 ? "warning" : "critical",
      impact: "medium",
      owner: "Clip Factory",
      evidence: `${readyQueueItems}/${dailyClipTarget} slots diarios con source y derechos; cada slot incluye hook, angulo, objetivo, formato y ventana.`,
      nextStep: readyQueueItems >= dailyClipTarget
        ? "Generar draft specs y medir resultados por variante."
        : "Desbloquear sources/derechos hasta cubrir el target diario completo.",
    },
  ];

  const score = scoreGrowthAudit(items);
  const status = auditStatusFromItems(items);
  return {
    score,
    status,
    summary: status === "ready"
      ? "Clippers esta operacionalmente listo para escalar con control."
      : status === "warning"
        ? "Clippers esta parcialmente listo; faltan mejoras antes de escalar volumen."
        : "Clippers aun no esta listo para 1M/week por cuenta; hay bloqueos criticos que resolver.",
    items,
    roadmap: [
      "1. Generar Account Launch Kit con handles, bios, links y checklist por plataforma.",
      "2. Conectar credenciales y tokens cifrados para TikTok, Instagram y YouTube.",
      "3. Crear/verificar cuentas reales y completar app review.",
      "4. Preparar Google Drive de Clippers para sources, allowlist, drafts, reports y metricas.",
      "5. Alimentar Trend Radar con oportunidades recientes/virales y filtrar por permisos.",
      "6. Alimentar fuentes diarias con videos propios/licenciados y evidencia allowlist.",
      "7. Ejecutar ciclo diario hasta que blocked sea 0.",
      "8. Agregar ingestion de metricas y experimento A/B por cuenta.",
      "9. Escalar volumen solo en cuentas/formats que superen retencion y shares objetivo.",
    ],
    weeklyGoalGap,
  };
}

async function buildLaunchCommandCenterSummary(input: {
  accounts: ClipperAccount[];
  credentialChecks: ClipperCredentialCheck[];
  tokenVault: ClipperTokenVaultSummary;
  credentialSetup: ClipperCredentialSetupSummary;
  credentialDoctor: ClipperCredentialDoctorSummary;
  platformReadiness: ClipperPlatformReadinessSummary;
  permissionPack: ClipperPermissionPackSummary;
  productionQueue: ClipperProductionQueueSummary;
  sourceAcquisition: ClipperSourceAcquisitionSummary;
  sourceHunt: ClipperSourceHuntSummary;
  rightsOutreach: ClipperRightsOutreachSummary;
  draftSpecs: ClipperDraftSpecSummary;
  manualPostingPack: ClipperManualPostingPackSummary;
  publishingPackage: ClipperPublishingPackageSummary;
  automation: ClipperAutomationSummary;
  automationSchedule: ClipperAutomationScheduleSummary;
  driveWorkspace: ClipperDriveWorkspaceSummary;
  metrics: ClipperMetricsSummary;
  trendRadar: ClipperTrendRadarSummary;
  trendRightsOutreach: ClipperTrendRightsOutreachSummary;
  intakeKit: ClipperIntakeKitSummary;
  accountEvidence: ClipperAccountEvidenceSummary;
  developerAppEvidence: ClipperDeveloperAppEvidenceSummary;
  accountIdentityKit: ClipperAccountIdentityKitSummary;
  accountLaunchKit: ClipperAccountLaunchKitSummary;
  accountCreationPack: ClipperAccountCreationPackSummary;
  permissionTracker: ClipperPermissionTrackerSummary;
  permissionRequestPack: ClipperPermissionRequestPackSummary;
  oauthConnectionPack: ClipperOAuthConnectionPackSummary;
  externalSetupQueue: ClipperExternalSetupQueueSummary;
  externalLaunchDossier: ClipperExternalLaunchDossierSummary;
  platformPortalChecklist: ClipperPlatformPortalChecklistSummary;
  appReviewSubmissionPack: ClipperAppReviewSubmissionPackSummary;
  appReviewDemoPack: ClipperAppReviewDemoPackSummary;
  developerApplicationDrafts: ClipperDeveloperApplicationDraftsSummary;
  officialPermissionMatrix: ClipperOfficialPermissionMatrixSummary;
  publisherConnectors: ClipperPublisherConnectorSummary;
  productionUrlSetup: ClipperProductionUrlSetupSummary;
  productionUrlVerification: ClipperProductionUrlVerificationSummary;
  httpsTunnelPlan: ClipperHttpsTunnelPlanSummary;
  legalPolicyPack: ClipperLegalPolicyPackSummary;
  oauthGoLive: ClipperOAuthGoLiveSummary;
  goLiveExecutionPack: ClipperGoLiveExecutionPackSummary;
}): Promise<ClipperLaunchCommandCenterSummary> {
  const connectedTokens = input.tokenVault.records.length;
  const readyAssets = input.productionQueue.sourceAssets.length;
  const dailyClipTarget = input.accounts.reduce((sum, account) => sum + account.dailyClipTarget, 0);
  const readyQueueItems = input.productionQueue.items.filter((item) => item.status === "draft_ready").length;
  const missingCredentialCount = input.credentialChecks.reduce((sum, check) => sum + check.missingEnvVars.length, 0);
  const commandGeneratedAt = await stat(LAUNCH_COMMAND_CENTER_PATH).then((file) => file.mtime.toISOString()).catch(() => null);
  const productionUrlVerified = input.productionUrlVerification.status === "pass";
  const productionUrlAccessLabel = !input.productionUrlSetup.productionUrlReady
    ? "not configured"
    : productionUrlVerified
      ? "verified public HTTPS"
      : `configured; verification ${input.productionUrlVerification.status}`;
  const productionUrlNextStep = productionUrlVerified
    ? input.productionUrlSetup.nextStep
    : input.productionUrlVerification.nextStep;

  const steps: ClipperLaunchCommandCenterStep[] = [
    {
      id: "internal-setup",
      label: "Setup interno y artefactos",
      owner: "Clippers Core",
      status: input.permissionPack.status === "ready" && input.accountLaunchKit.generatedAt && input.permissionTracker.generatedAt && input.automationSchedule.status === "prepared" ? "done" : "needs_action",
      evidence: `${input.permissionPack.files.filter((file) => file.exists).length}/${input.permissionPack.files.length} archivos de permisos; launch kit ${input.accountLaunchKit.generatedAt ? "generado" : "pendiente"}; schedule ${input.automationSchedule.status}.`,
      nextStep: "Correr Preparar todo para regenerar launch kit, evidence vaults, permisos, tracker, cola y schedule.",
      artifactPath: LAUNCH_COMMAND_CENTER_PATH,
      actionUrl: "/api/clippers/prepare-command-center",
    },
    {
      id: "credential-setup",
      label: "Credenciales y aliases",
      owner: "Platform Ops",
      status: input.credentialSetup.status === "ready" ? "done" : input.credentialSetup.status === "partial" ? "needs_action" : "blocked",
      evidence: `${input.credentialSetup.totals.ready}/${input.credentialSetup.totals.items} grupos listos; env files encontrados: ${input.credentialSetup.envFilesFound.length || 0}.`,
      nextStep: input.credentialSetup.nextStep,
      artifactPath: input.credentialSetup.readmePath,
      actionUrl: "/api/clippers/prepare-credential-setup",
    },
    {
      id: "credential-doctor",
      label: "Credential Doctor",
      owner: "Platform Ops",
      status: input.credentialDoctor.status === "ready" ? "done" : input.credentialDoctor.status === "partial" ? "needs_action" : "blocked",
      evidence: `${input.credentialDoctor.totals.ready}/${input.credentialDoctor.totals.items} grupos detectados; ${input.credentialDoctor.totals.missing} faltantes.`,
      nextStep: input.credentialDoctor.nextStep,
      artifactPath: input.credentialDoctor.markdownPath,
      actionUrl: "/api/clippers/prepare-credential-doctor",
    },
    {
      id: "platform-readiness",
      label: "Platform Readiness",
      owner: "Platform Ops",
      status: input.platformReadiness.status === "ready" ? "done" : input.platformReadiness.status === "partial" ? "needs_action" : "blocked",
      evidence: `${input.platformReadiness.totals.ready}/${input.platformReadiness.totals.platforms} plataformas listas; ${input.platformReadiness.totals.blocked} bloqueadas.`,
      nextStep: input.platformReadiness.nextStep,
      artifactPath: input.platformReadiness.markdownPath,
      actionUrl: "/api/clippers/prepare-platform-readiness",
    },
    {
      id: "external-setup-queue",
      label: "External Setup Queue",
      owner: "Platform Ops",
      status: input.externalSetupQueue.status === "ready" ? "done" : input.externalSetupQueue.status === "in_progress" ? "needs_action" : "blocked",
      evidence: `${input.externalSetupQueue.totals.done}/${input.externalSetupQueue.totals.items} tareas externas listas; ${input.externalSetupQueue.totals.critical} criticas.`,
      nextStep: input.externalSetupQueue.nextStep,
      artifactPath: input.externalSetupQueue.markdownPath,
      actionUrl: "/api/clippers/prepare-external-setup-queue",
    },
    {
      id: "external-launch-dossier",
      label: "External Launch Dossier",
      owner: "Platform Ops",
      status: input.externalLaunchDossier.status === "ready" ? "done" : input.externalLaunchDossier.status === "in_progress" ? "needs_action" : "blocked",
      evidence: `${input.externalLaunchDossier.totals.ready}/${input.externalLaunchDossier.totals.platforms} plataformas listas; ${input.externalLaunchDossier.totals.criticalActions} acciones criticas.`,
      nextStep: input.externalLaunchDossier.nextStep,
      artifactPath: input.externalLaunchDossier.markdownPath,
      actionUrl: "/api/clippers/prepare-external-launch-dossier",
    },
    {
      id: "platform-portal-checklist",
      label: "Platform Portal Checklist",
      owner: "Platform Ops",
      status: input.platformPortalChecklist.status === "ready" ? "done" : input.platformPortalChecklist.status === "in_progress" ? "needs_action" : "blocked",
      evidence: `${input.platformPortalChecklist.totals.ready}/${input.platformPortalChecklist.totals.platforms} plataformas listas; ${input.platformPortalChecklist.totals.portalActions} portal actions; ${input.platformPortalChecklist.totals.evidenceRows} evidence rows.`,
      nextStep: input.platformPortalChecklist.nextStep,
      artifactPath: input.platformPortalChecklist.markdownPath,
      actionUrl: "/api/clippers/prepare-platform-portal-checklist",
    },
    {
      id: "drive-workspace",
      label: "Google Drive Clippers",
      owner: "Workspace Ops",
      status: input.driveWorkspace.status === "ready" ? "done" : input.driveWorkspace.status === "needs_oauth" ? "needs_action" : "blocked",
      evidence: `${input.driveWorkspace.folders.filter((folder) => Boolean(folder.folderId)).length}/${input.driveWorkspace.folders.length} carpetas con folderId; status ${input.driveWorkspace.status}.`,
      nextStep: input.driveWorkspace.nextStep,
      artifactPath: input.driveWorkspace.manifestPath,
      actionUrl: input.driveWorkspace.status === "needs_oauth" ? "/api/google-drive/auth" : "/api/clippers/prepare-drive-workspace",
    },
    {
      id: "account-identity-kit",
      label: "Account Identity Kit",
      owner: "Account Ops",
      status: input.accountIdentityKit.status === "ready" ? "done" : "needs_action",
      evidence: `${input.accountIdentityKit.totals.platformProfiles} perfiles plataforma; ${input.accountIdentityKit.totals.firstPostIdeas} ideas iniciales.`,
      nextStep: input.accountIdentityKit.nextStep,
      artifactPath: input.accountIdentityKit.markdownPath,
      actionUrl: "/api/clippers/prepare-account-identity-kit",
    },
    {
      id: "account-creation-pack",
      label: "Account Creation Pack",
      owner: "Account Ops",
      status: input.accountCreationPack.status === "ready" ? "done" : input.accountCreationPack.generatedAt ? "needs_action" : "blocked",
      evidence: `${input.accountCreationPack.totals.ready}/${input.accountCreationPack.totals.profiles} perfiles con evidencia; ${input.accountCreationPack.totals.blocked} bloqueados.`,
      nextStep: input.accountCreationPack.nextStep,
      artifactPath: input.accountCreationPack.markdownPath,
      actionUrl: "/api/clippers/prepare-account-creation-pack",
    },
    {
      id: "external-accounts",
      label: "Cuentas reales por plataforma",
      owner: "Account Ops",
      status: input.accountEvidence.status === "ready" ? "done" : input.accountEvidence.items.length > 0 ? "needs_action" : "blocked",
      evidence: `${input.accountEvidence.totals.verified}/${input.accountEvidence.totals.expected} cuentas verificadas; ${input.accountEvidence.totals.missing} sin evidencia.`,
      nextStep: input.accountEvidence.nextStep,
      artifactPath: input.accountEvidence.readmePath,
      actionUrl: null,
    },
    {
      id: "intake-kit",
      label: "Templates de intake",
      owner: "Trend Scout",
      status: input.intakeKit.status === "prepared" ? "done" : "needs_action",
      evidence: `${input.intakeKit.files.filter((file) => file.exists).length}/${input.intakeKit.files.length} templates listos.`,
      nextStep: input.intakeKit.nextStep,
      artifactPath: input.intakeKit.readmePath,
      actionUrl: "/api/clippers/prepare-intake-kit",
    },
    {
      id: "developer-apps",
      label: "Apps developer y app review",
      owner: "Permission Ops",
      status: input.developerAppEvidence.status === "ready" ? "done" : input.developerAppEvidence.items.length > 0 ? "needs_action" : "blocked",
      evidence: `${input.developerAppEvidence.totals.approved}/${input.developerAppEvidence.totals.expected} apps aprobadas; ${input.developerAppEvidence.totals.missing} sin evidencia.`,
      nextStep: input.developerAppEvidence.nextStep,
      artifactPath: input.developerAppEvidence.readmePath,
      actionUrl: null,
    },
    {
      id: "oauth-token-vault",
      label: "OAuth y token vault",
      owner: "Publisher",
      status: connectedTokens >= 3 ? "done" : missingCredentialCount === 0 && input.tokenVault.configured ? "needs_action" : "blocked",
      evidence: `${connectedTokens}/3 tokens cifrados; ${missingCredentialCount} env vars faltantes; vault ${input.tokenVault.status}.`,
      nextStep: input.tokenVault.nextStep,
      artifactPath: input.tokenVault.vaultPath,
      actionUrl: null,
    },
    {
      id: "production-url-setup",
      label: "Production URL Setup",
      owner: "Platform Ops",
      status: input.productionUrlSetup.status === "ready" ? "done" : input.productionUrlSetup.generatedAt ? "needs_action" : "blocked",
      evidence: `${input.productionUrlSetup.publicBaseUrl}; prod URL ${productionUrlAccessLabel}.`,
      nextStep: productionUrlNextStep,
      artifactPath: input.productionUrlSetup.markdownPath,
      actionUrl: "/api/clippers/prepare-production-url-setup",
    },
    {
      id: "production-url-verification",
      label: "Production URL Verification",
      owner: "Platform Ops",
      status: input.productionUrlVerification.status === "pass" ? "done" : input.productionUrlVerification.status === "partial" || input.productionUrlVerification.status === "fail" ? "needs_action" : "blocked",
      evidence: `${input.productionUrlVerification.totals.pass}/${input.productionUrlVerification.totals.endpoints} endpoints pass; ${input.productionUrlVerification.totals.fail} fail; ${input.productionUrlVerification.totals.skipped} skipped.`,
      nextStep: input.productionUrlVerification.nextStep,
      artifactPath: input.productionUrlVerification.markdownPath,
      actionUrl: "/api/clippers/verify-production-url",
    },
    {
      id: "https-tunnel-plan",
      label: "HTTPS Tunnel / Deploy Plan",
      owner: "Platform Ops",
      status: input.httpsTunnelPlan.status === "ready" ? "done" : input.httpsTunnelPlan.generatedAt ? "needs_action" : "blocked",
      evidence: `${input.httpsTunnelPlan.options.length} opciones; recomendada ${input.httpsTunnelPlan.recommendedOptionId}; prod URL ${productionUrlAccessLabel}.`,
      nextStep: productionUrlVerified ? input.httpsTunnelPlan.nextStep : productionUrlNextStep,
      artifactPath: input.httpsTunnelPlan.markdownPath,
      actionUrl: "/api/clippers/prepare-https-tunnel-plan",
    },
    {
      id: "legal-policy-pack",
      label: "Legal Policy Pack",
      owner: "Legal Ops",
      status: input.legalPolicyPack.status === "ready" ? "done" : input.legalPolicyPack.generatedAt ? "needs_action" : "blocked",
      evidence: `Privacy/Terms URLs ${productionUrlVerified ? "verified public HTTPS" : productionUrlAccessLabel}.`,
      nextStep: productionUrlVerified ? input.legalPolicyPack.nextStep : productionUrlNextStep,
      artifactPath: input.legalPolicyPack.markdownPath,
      actionUrl: "/api/clippers/prepare-legal-policy-pack",
    },
    {
      id: "app-review-demo-pack",
      label: "App Review Demo Pack",
      owner: "Permission Ops",
      status: input.appReviewDemoPack.status === "ready" ? "done" : input.appReviewDemoPack.generatedAt ? "needs_action" : "blocked",
      evidence: `${input.appReviewDemoPack.demoUrl}; ${input.appReviewDemoPack.steps.length} pasos de review; prod URL ${productionUrlAccessLabel}.`,
      nextStep: productionUrlVerified ? input.appReviewDemoPack.nextStep : productionUrlNextStep,
      artifactPath: input.appReviewDemoPack.markdownPath,
      actionUrl: "/api/clippers/prepare-app-review-demo-pack",
    },
    {
      id: "developer-application-drafts",
      label: "Developer Application Drafts",
      owner: "Permission Ops",
      status: input.developerApplicationDrafts.status === "ready" ? "done" : input.developerApplicationDrafts.generatedAt ? "needs_action" : "blocked",
      evidence: `${input.developerApplicationDrafts.totals.ready}/${input.developerApplicationDrafts.totals.platforms} drafts ready; ${input.developerApplicationDrafts.totals.checklistItems} checklist items.`,
      nextStep: input.developerApplicationDrafts.nextStep,
      artifactPath: input.developerApplicationDrafts.markdownPath,
      actionUrl: "/api/clippers/prepare-developer-application-drafts",
    },
    {
      id: "app-review-submission-pack",
      label: "App Review Submission Pack",
      owner: "Permission Ops",
      status: input.appReviewSubmissionPack.status === "ready" ? "done" : input.appReviewSubmissionPack.generatedAt ? "needs_action" : "blocked",
      evidence: `${input.appReviewSubmissionPack.totals.ready}/${input.appReviewSubmissionPack.totals.platforms} plataformas con copy listo; ${input.appReviewSubmissionPack.totals.answers} respuestas preparadas.`,
      nextStep: input.appReviewSubmissionPack.nextStep,
      artifactPath: input.appReviewSubmissionPack.markdownPath,
      actionUrl: "/api/clippers/prepare-app-review-submission-pack",
    },
    {
      id: "oauth-go-live",
      label: "OAuth Go-Live",
      owner: "Publisher",
      status: input.oauthGoLive.status === "ready" ? "done" : input.oauthGoLive.status === "partial" ? "needs_action" : "blocked",
      evidence: `${input.oauthGoLive.totals.ready}/${input.oauthGoLive.totals.platforms} plataformas go-live; ${input.oauthGoLive.totals.blocked} bloqueadas.`,
      nextStep: input.oauthGoLive.nextStep,
      artifactPath: input.oauthGoLive.markdownPath,
      actionUrl: "/api/clippers/prepare-oauth-go-live",
    },
    {
      id: "oauth-connection-pack",
      label: "OAuth Connection Pack",
      owner: "Publisher",
      status: input.oauthConnectionPack.status === "ready" ? "done" : input.oauthConnectionPack.status === "partial" ? "needs_action" : "blocked",
      evidence: `${input.oauthConnectionPack.totals.ready}/${input.oauthConnectionPack.totals.connections} conexiones cuenta/plataforma listas; ${input.oauthConnectionPack.totals.tokensSaved} tokens; CSV ${input.oauthConnectionPack.csvPath}.`,
      nextStep: input.oauthConnectionPack.nextStep,
      artifactPath: input.oauthConnectionPack.markdownPath,
      actionUrl: "/api/clippers/prepare-oauth-connection-pack",
    },
    {
      id: "go-live-execution-pack",
      label: "Go-Live Execution Pack",
      owner: "Platform Ops",
      status: input.goLiveExecutionPack.status === "ready" ? "done" : input.goLiveExecutionPack.status === "in_progress" ? "needs_action" : "blocked",
      evidence: `${input.goLiveExecutionPack.totals.done}/${input.goLiveExecutionPack.totals.phases} fases listas; ${input.goLiveExecutionPack.totals.readyToExecute} ready_to_execute.`,
      nextStep: input.goLiveExecutionPack.nextStep,
      artifactPath: input.goLiveExecutionPack.markdownPath,
      actionUrl: "/api/clippers/prepare-go-live-execution-pack",
    },
    {
      id: "permission-approvals",
      label: "Permisos de publicacion",
      owner: "Permission Ops",
      status: input.permissionTracker.status === "ready" ? "done" : input.permissionTracker.generatedAt ? "needs_action" : "blocked",
      evidence: `${input.permissionTracker.totals.approved}/${input.permissionTracker.totals.permissions} permisos aprobados; ${input.permissionTracker.totals.blocked} bloqueados.`,
      nextStep: input.permissionTracker.nextStep,
      artifactPath: input.permissionTracker.markdownPath,
      actionUrl: null,
    },
    {
      id: "permission-request-pack",
      label: "Permission Request Pack",
      owner: "Permission Ops",
      status: input.permissionRequestPack.status === "ready" ? "done" : input.permissionRequestPack.generatedAt ? "needs_action" : "blocked",
      evidence: `${input.permissionRequestPack.totals.ready}/${input.permissionRequestPack.totals.permissions} permisos ready; CSV ${input.permissionRequestPack.csvPath}.`,
      nextStep: input.permissionRequestPack.nextStep,
      artifactPath: input.permissionRequestPack.markdownPath,
      actionUrl: "/api/clippers/prepare-permission-request-pack",
    },
    {
      id: "official-permission-matrix",
      label: "Official Permission Matrix",
      owner: "Permission Ops",
      status: input.officialPermissionMatrix.status === "verified" ? "done" : input.officialPermissionMatrix.status === "needs_review" ? "needs_action" : "blocked",
      evidence: `${input.officialPermissionMatrix.totals.scopes} scopes oficiales; ${input.officialPermissionMatrix.totals.loginRequired} fuentes requieren login.`,
      nextStep: input.officialPermissionMatrix.nextStep,
      artifactPath: input.officialPermissionMatrix.markdownPath,
      actionUrl: "/api/clippers/prepare-official-permission-matrix",
    },
    {
      id: "source-supply",
      label: "Videos fuente recientes",
      owner: "Trend Scout",
      status: input.sourceAcquisition.status === "ready" ? "done" : input.sourceAcquisition.status === "partial" ? "needs_action" : "blocked",
      evidence: `${readyAssets} assets detectados; ${readyQueueItems}/${dailyClipTarget} slots diarios listos; ${input.sourceAcquisition.totals.missingSourceSlots} sin fuente.`,
      nextStep: input.sourceAcquisition.nextStep,
      artifactPath: input.sourceAcquisition.markdownPath,
      actionUrl: "/api/clippers/prepare-source-acquisition",
    },
    {
      id: "daily-source-hunt",
      label: "Daily Source Hunt",
      owner: "Trend Scout",
      status: input.sourceHunt.status === "ready" ? "done" : input.sourceHunt.generatedAt ? "needs_action" : "blocked",
      evidence: `${input.sourceHunt.totals.readyForDraft}/${input.sourceHunt.totals.items} hunt slots ready; ${input.sourceHunt.totals.needsSource} need source; ${input.sourceHunt.totals.needsRights} need rights.`,
      nextStep: input.sourceHunt.nextStep,
      artifactPath: input.sourceHunt.csvPath,
      actionUrl: "/api/clippers/prepare-source-hunt",
    },
    {
      id: "rights-outreach",
      label: "Creator Rights Outreach",
      owner: "Rights Gate",
      status: input.rightsOutreach.status === "ready" ? "done" : input.rightsOutreach.status === "partial" ? "needs_action" : "blocked",
      evidence: `${input.rightsOutreach.totals.readyToContact} ready_to_contact; ${input.rightsOutreach.totals.needsTarget} need target; ${input.rightsOutreach.totals.permissionRecorded} permission_recorded.`,
      nextStep: input.rightsOutreach.nextStep,
      artifactPath: input.rightsOutreach.markdownPath,
      actionUrl: "/api/clippers/prepare-rights-outreach",
    },
    {
      id: "draft-factory",
      label: "Draft Factory",
      owner: "Clip Factory",
      status: input.draftSpecs.totals.readyForEdit >= dailyClipTarget ? "done" : readyQueueItems > 0 ? "needs_action" : "blocked",
      evidence: `${input.draftSpecs.totals.readyForEdit}/${dailyClipTarget} specs listos; ${input.draftSpecs.totals.blockedQueueItems} queue items bloqueados.`,
      nextStep: input.draftSpecs.nextStep,
      artifactPath: input.draftSpecs.manifestPath,
      actionUrl: "/api/clippers/prepare-draft-specs",
    },
    {
      id: "trend-radar",
      label: "Trend Radar viral",
      owner: "Trend Scout",
      status: input.trendRadar.status === "ready" ? "done" : input.trendRadar.files.length > 0 ? "needs_action" : "blocked",
      evidence: `${input.trendRadar.candidates.length} oportunidades importadas; ${input.trendRadar.topCandidates.length} top candidates.`,
      nextStep: input.trendRadar.nextStep,
      artifactPath: input.trendRadar.summaryPath,
      actionUrl: null,
    },
    {
      id: "trend-rights-outreach",
      label: "Trend Rights Outreach",
      owner: "Rights Gate",
      status: input.trendRightsOutreach.status === "ready" ? "done" : input.trendRightsOutreach.status === "partial" ? "needs_action" : "blocked",
      evidence: `${input.trendRightsOutreach.totals.readyToContact} trend candidates ready_to_contact; ${input.trendRightsOutreach.totals.permissionRecorded} permissioned.`,
      nextStep: input.trendRightsOutreach.nextStep,
      artifactPath: input.trendRightsOutreach.markdownPath,
      actionUrl: "/api/clippers/prepare-trend-rights-outreach",
    },
    {
      id: "metrics-loop",
      label: "Metricas y optimizacion",
      owner: "Optimizer",
      status: input.metrics.status === "ready" ? "done" : input.metrics.files.length > 0 ? "needs_action" : "blocked",
      evidence: `${input.metrics.records.length} registros; ${input.metrics.totals.views.toLocaleString("en-US")} views importadas.`,
      nextStep: input.metrics.nextStep,
      artifactPath: input.metrics.summaryPath,
      actionUrl: null,
    },
    {
      id: "daily-publishing-cycle",
      label: "Ciclo diario de publicacion",
      owner: "Publisher",
      status: input.automation.status === "ready" ? "done" : input.automationSchedule.status === "prepared" ? "needs_action" : "blocked",
      evidence: input.automation.lastRun ? `${input.automation.lastRun.totals.posts} posts evaluados; ${input.automation.lastRun.totals.blocked} bloqueados.` : `Schedule ${input.automationSchedule.status}; ${input.automationSchedule.dailyRunTime} ${input.automationSchedule.timezone}.`,
      nextStep: input.automation.nextStep,
      artifactPath: input.automationSchedule.manifestPath,
      actionUrl: "/api/clippers/run-automation-cycle",
    },
    {
      id: "manual-posting-pack",
      label: "Manual Posting Pack",
      owner: "Publisher",
      status: input.manualPostingPack.status === "ready" ? "done" : input.manualPostingPack.status === "partial" ? "needs_action" : "blocked",
      evidence: `${input.manualPostingPack.totals.readyToPost}/${input.manualPostingPack.totals.posts} posts manuales listos; CSV ${input.manualPostingPack.csvPath}.`,
      nextStep: input.manualPostingPack.nextStep,
      artifactPath: input.manualPostingPack.markdownPath,
      actionUrl: "/api/clippers/prepare-manual-posting-pack",
    },
    {
      id: "publishing-package",
      label: "Publishing Package",
      owner: "Publisher",
      status: input.publishingPackage.status === "ready" ? "done" : input.publishingPackage.status === "partial" ? "needs_action" : "blocked",
      evidence: `${input.publishingPackage.totals.readyForManual}/${input.publishingPackage.totals.items} uploads listos; CSV ${input.publishingPackage.csvPath}.`,
      nextStep: input.publishingPackage.nextStep,
      artifactPath: input.publishingPackage.markdownPath,
      actionUrl: "/api/clippers/prepare-publishing-package",
    },
    {
      id: "publisher-connectors",
      label: "Publisher Connectors",
      owner: "Publisher",
      status: input.publisherConnectors.status === "ready" ? "done" : input.publisherConnectors.status === "partial" ? "needs_action" : "blocked",
      evidence: `${input.publisherConnectors.totals.ready}/${input.publisherConnectors.totals.platforms} conectores listos; ${input.publisherConnectors.totals.blocked} bloqueados.`,
      nextStep: input.publisherConnectors.nextStep,
      artifactPath: input.publisherConnectors.markdownPath,
      actionUrl: "/api/clippers/prepare-publisher-connectors",
    },
  ];

  const totals = steps.reduce<ClipperLaunchCommandCenterSummary["totals"]>((sum, step) => {
    sum.steps += 1;
    if (step.status === "done") sum.done += 1;
    if (step.status === "needs_action") sum.needsAction += 1;
    if (step.status === "blocked") sum.blocked += 1;
    return sum;
  }, { steps: 0, done: 0, needsAction: 0, blocked: 0 });
  const nextStep = steps.find((step) => step.status === "blocked")?.nextStep
    || steps.find((step) => step.status === "needs_action")?.nextStep
    || "Clippers listo para operar; correr ciclo diario y revisar metricas.";
  return {
    status: totals.blocked > 0 ? "blocked" : totals.needsAction > 0 ? "action_required" : "ready",
    generatedAt: commandGeneratedAt,
    manifestPath: LAUNCH_COMMAND_CENTER_PATH,
    markdownPath: LAUNCH_COMMAND_CENTER_MARKDOWN_PATH,
    steps,
    totals,
    nextStep,
  };
}

function renderLaunchCommandCenterMarkdown(summary: ClipperLaunchCommandCenterSummary): string {
  return [
    "# Clippers Launch Command Center",
    "",
    `Status: ${summary.status}`,
    `Generated: ${summary.generatedAt || "pending"}`,
    "",
    `Next step: ${summary.nextStep}`,
    "",
    "## Steps",
    "",
    ...summary.steps.flatMap((step) => [
      `### ${step.label}`,
      "",
      `- Status: ${step.status}`,
      `- Owner: ${step.owner}`,
      `- Evidence: ${step.evidence}`,
      `- Next step: ${step.nextStep}`,
      step.artifactPath ? `- Artifact: ${step.artifactPath}` : null,
      step.actionUrl ? `- Action: ${step.actionUrl}` : null,
      "",
    ].filter((line): line is string => Boolean(line))),
  ].join("\n");
}

function blockerActionType(step: ClipperLaunchCommandCenterStep): ClipperBlockerResolutionAction["actionType"] {
  if (/credential|key|env/i.test(`${step.id} ${step.label} ${step.nextStep}`)) return "credential";
  if (/account|cuenta/i.test(`${step.id} ${step.label}`)) return "account";
  if (/developer|app review|demo|legal|terms|privacy/i.test(`${step.id} ${step.label}`)) return "developer_app";
  if (/permission|permiso|scope/i.test(`${step.id} ${step.label} ${step.nextStep}`)) return "permission";
  if (/oauth|token/i.test(`${step.id} ${step.label}`)) return "oauth";
  if (/source|trend|video/i.test(`${step.id} ${step.label}`)) return "source";
  if (/rights|allowlist|derecho/i.test(`${step.id} ${step.label}`)) return "rights";
  if (/metric|optimizer/i.test(`${step.id} ${step.label}`)) return "metrics";
  if (/automation|schedule|daily/i.test(`${step.id} ${step.label}`)) return "automation";
  return step.actionUrl ? "in_app" : "external";
}

function blockerSeverity(step: ClipperLaunchCommandCenterStep): ClipperBlockerResolutionAction["severity"] {
  if (step.status === "blocked") return "critical";
  if (/source|permission|oauth|credential|account|developer/i.test(step.id)) return "high";
  return "medium";
}

function blockerUnlockPhase(step: ClipperLaunchCommandCenterStep, actionType: ClipperBlockerResolutionAction["actionType"]): ClipperBlockerUnlockPhase {
  const source = `${step.id} ${step.label} ${step.nextStep}`.toLowerCase();
  if (actionType === "credential" || source.includes("drive-workspace")) return "credentials";
  if (actionType === "account") return "accounts";
  if (/production-url|https|legal-policy|privacy|terms|demo/i.test(source)) return "public_url";
  if (actionType === "developer_app") return "developer_apps";
  if (actionType === "permission") return "permissions";
  if (actionType === "oauth") return "oauth";
  if (actionType === "source" || actionType === "rights") return "content_supply";
  if (actionType === "metrics") return "optimization";
  if (actionType === "automation" || /manual-posting|publisher|publishing/i.test(source)) return "publishing";
  return step.actionUrl ? "publishing" : "developer_apps";
}

function blockerPhaseDependencies(phase: ClipperBlockerUnlockPhase): ClipperBlockerUnlockPhase[] {
  const dependencies: Record<ClipperBlockerUnlockPhase, ClipperBlockerUnlockPhase[]> = {
    credentials: [],
    accounts: [],
    public_url: ["credentials"],
    developer_apps: ["credentials", "accounts", "public_url"],
    permissions: ["developer_apps", "public_url"],
    oauth: ["credentials", "developer_apps", "permissions", "accounts"],
    content_supply: ["accounts"],
    publishing: ["oauth", "content_supply"],
    optimization: ["publishing"],
  };
  return dependencies[phase];
}

function inferClipperPlatformFromText(text: string): ClipperPlatform | "system" {
  const source = text.toLowerCase();
  if (source.includes("tiktok")) return "tiktok";
  if (source.includes("instagram") || source.includes("meta") || source.includes("facebook")) return "instagram";
  if (source.includes("youtube") || source.includes("google")) return "youtube";
  return "system";
}

function blockerPortalUrl(step: ClipperLaunchCommandCenterStep, actionType: ClipperBlockerResolutionAction["actionType"]): string | null {
  const platform = inferClipperPlatformFromText(`${step.id} ${step.label} ${step.nextStep}`);
  if (actionType === "account") {
    if (platform === "instagram") return "https://www.instagram.com/accounts/emailsignup/";
    if (platform === "tiktok") return "https://www.tiktok.com/signup";
    if (platform === "youtube") return "https://www.youtube.com/create_channel";
  }
  if (actionType === "developer_app" || actionType === "permission") {
    if (platform === "tiktok") return "https://developers.tiktok.com/";
    if (platform === "instagram") return "https://developers.facebook.com/apps/";
    if (platform === "youtube") return "https://console.cloud.google.com/apis/credentials";
    return "https://developers.facebook.com/apps/";
  }
  if (actionType === "oauth") {
    if (platform === "tiktok") return "https://developers.tiktok.com/";
    if (platform === "instagram") return "https://developers.facebook.com/apps/";
    if (platform === "youtube") return "https://console.cloud.google.com/apis/credentials";
  }
  if (actionType === "credential") return null;
  if (actionType === "metrics") return null;
  return null;
}

function blockerExecutionMode(actionType: ClipperBlockerResolutionAction["actionType"], canRunInApp: boolean): ClipperBlockerExecutionMode {
  if (canRunInApp) return "in_app";
  if (["account", "developer_app", "permission", "oauth"].includes(actionType)) return "external_portal";
  if (["source", "rights", "metrics"].includes(actionType)) return "evidence_upload";
  return "manual_review";
}

function blockerEstimatedMinutes(actionType: ClipperBlockerResolutionAction["actionType"], canRunInApp: boolean): number {
  if (canRunInApp) return 5;
  if (actionType === "credential") return 10;
  if (actionType === "account") return 20;
  if (actionType === "developer_app") return 45;
  if (actionType === "permission") return 30;
  if (actionType === "oauth") return 15;
  if (actionType === "source") return 25;
  if (actionType === "rights") return 20;
  if (actionType === "metrics") return 10;
  return 15;
}

function blockerDoneCriteria(step: ClipperLaunchCommandCenterStep, actionType: ClipperBlockerResolutionAction["actionType"], evidenceImportRow: string): string[] {
  const criteria = [
    blockerUnblockCondition(step),
    "Regenerate Launch Command Center and confirm this blocker no longer appears as blocked.",
  ];
  if (evidenceImportRow) criteria.unshift("Launch Evidence Batch accepts a completed real evidence row for this action.");
  if (actionType === "credential") criteria.unshift("Credential Doctor reports the required env group as ready without exposing secret values.");
  if (actionType === "account") criteria.unshift("Account Evidence shows submitted or verified for the exact account/platform.");
  if (actionType === "developer_app") criteria.unshift("Developer App Evidence shows submitted or approved with real app identifier and public URL.");
  if (actionType === "permission") criteria.unshift("Permission Tracker shows requested or approved for the exact platform scope.");
  if (actionType === "oauth") criteria.unshift("OAuth connection has callback metadata and Token Vault has a saved encrypted token when exchange is available.");
  if (actionType === "source") criteria.unshift("Production Queue sees enough recent source assets for the affected category.");
  if (actionType === "rights") criteria.unshift("Rights evidence exists in allowlist before any draft or publish step.");
  return Array.from(new Set(criteria));
}

function buildBlockerEvidenceBatchTemplate(actions: ClipperBlockerResolutionAction[]): string {
  const rows = actions.map((action) => action.evidenceImportRow).filter(Boolean);
  return [
    "kind,account_id,platform,status,scope,app_identifier,public_base_url,notes",
    ...rows,
  ].join("\n");
}

const BLOCKER_UNLOCK_PHASE_ORDER: Record<ClipperBlockerUnlockPhase, number> = {
  credentials: 0,
  accounts: 1,
  public_url: 2,
  developer_apps: 3,
  permissions: 4,
  oauth: 5,
  content_supply: 6,
  publishing: 7,
  optimization: 8,
};

function buildBlockerEvidenceImportRow(actionType: ClipperBlockerResolutionAction["actionType"], step: ClipperLaunchCommandCenterStep): string {
  const platform = inferAutopilotPlatform({
    sourceStepId: step.id,
    label: step.label,
    nextStep: step.nextStep,
  } as ClipperBlockerResolutionAction);
  const platformCell = platform === "system" ? "<platform>" : platform;
  if (actionType === "account") return `account,<account_id>,${platformCell},verified,,,,<handle + verification proof>`;
  if (actionType === "developer_app") return `developer_app,,${platformCell},submitted,,<app id>,<https public base url>,<developer app submission/approval proof>`;
  if (actionType === "permission") return `permission,,${platformCell},requested,<scope>,,,<app review or permission request proof>`;
  return "";
}

function blockerProofCommand(step: ClipperLaunchCommandCenterStep, actionType: ClipperBlockerResolutionAction["actionType"], evidenceImportRow: string): string {
  if (actionType === "credential") return "Paste env/JSON in Credential Setup, then run POST /api/clippers/reload-credentials and POST /api/clippers/prepare-credential-doctor.";
  if (evidenceImportRow) return "Paste evidence row in Launch Evidence Batch, import it, then run POST /api/clippers/prepare-command-center.";
  if (step.actionUrl?.startsWith("/api/")) return `Run POST ${step.actionUrl}, then refresh /api/clippers/status.`;
  if (step.actionUrl) return `Open ${step.actionUrl}, finish the required action, then refresh /api/clippers/status.`;
  if (actionType === "oauth") return "Open the OAuth URL for each account/platform, finish callback, then verify token vault in /api/clippers/status.";
  if (actionType === "source" || actionType === "rights") return "Add source/rights evidence, then run POST /api/clippers/prepare-production-queue and POST /api/clippers/prepare-draft-specs.";
  return "Record the required evidence, then run POST /api/clippers/prepare-command-center.";
}

function blockerChecklist(step: ClipperLaunchCommandCenterStep, actionType: ClipperBlockerResolutionAction["actionType"]): string[] {
  const base = [
    step.nextStep,
    step.artifactPath ? `Abrir artefacto: ${step.artifactPath}` : "Revisar el panel de Clippers para este paso.",
  ];
  if (step.actionUrl) base.push(`Ejecutar accion in-app: ${step.actionUrl}`);
  if (actionType === "credential") {
    base.push(`Usar ${CREDENTIAL_SETUP_MISSING_TEMPLATE_PATH} para completar solo las env vars faltantes.`);
    base.push("Correr Reload keys o preparar Credential Doctor para confirmar deteccion.");
  }
  if (actionType === "account") {
    base.push("Crear/verificar la cuenta real en la plataforma correspondiente.");
    base.push("Guardar evidencia con status verified en account-evidence.");
  }
  if (actionType === "developer_app") {
    base.push("Crear app/proyecto developer y pegar redirect URI, privacy, terms y demo URL.");
    base.push("Guardar evidencia de developer app con status submitted o approved.");
  }
  if (actionType === "permission") {
    base.push("Copiar justificacion del Permission Request Pack y registrar estado del permiso.");
  }
  if (actionType === "oauth") {
    base.push("Abrir OAuth con la cuenta correcta y confirmar callback/token vault.");
  }
  if (actionType === "source") {
    base.push("Subir videos fuente recientes/virales en la carpeta de categoria correcta.");
  }
  if (actionType === "rights") {
    base.push("Guardar evidencia de permiso/licencia en allowlist antes de editar/publicar.");
  }
  if (actionType === "metrics") {
    base.push("Exportar analytics CSV/JSON e ingerir metricas para el Optimizer.");
  }
  return Array.from(new Set(base.filter(Boolean)));
}

function blockerUnblockCondition(step: ClipperLaunchCommandCenterStep): string {
  if (step.status === "done") return "Ya esta desbloqueado.";
  if (step.actionUrl) return `El paso ${step.label} cambia a done/needs_action despues de ejecutar ${step.actionUrl} y resolver evidencia.`;
  return `El paso ${step.label} cambia a done/needs_action cuando la evidencia requerida existe y el Command Center se regenera.`;
}

async function buildBlockerResolutionPackSummary(input: {
  commandCenter: ClipperLaunchCommandCenterSummary;
  growthAudit: ClipperGrowthAudit;
}): Promise<ClipperBlockerResolutionPackSummary> {
  const actionableSteps = input.commandCenter.steps
    .filter((step) => step.status !== "done");
  const actions = actionableSteps.map<ClipperBlockerResolutionAction>((step) => {
    const actionType = blockerActionType(step);
    const severity = blockerSeverity(step);
    const unlockPhase = blockerUnlockPhase(step, actionType);
    const evidenceImportRow = buildBlockerEvidenceImportRow(actionType, step);
    const canRunInApp = Boolean(step.actionUrl);
    return {
      id: `resolve-${step.id}`,
      rank: 0,
      sourceStepId: step.id,
      unlockPhase,
      dependsOn: blockerPhaseDependencies(unlockPhase),
      label: step.label,
      owner: step.owner,
      status: step.status === "blocked" ? "blocked" : "next",
      severity,
      actionType,
      canRunInApp,
      actionUrl: step.actionUrl,
      portalUrl: blockerPortalUrl(step, actionType),
      executionMode: blockerExecutionMode(actionType, canRunInApp),
      estimatedMinutes: blockerEstimatedMinutes(actionType, canRunInApp),
      artifactPath: step.artifactPath,
      evidence: step.evidence,
      evidenceImportRow,
      proofCommand: blockerProofCommand(step, actionType, evidenceImportRow),
      nextStep: step.nextStep,
      unblockCondition: blockerUnblockCondition(step),
      doneCriteria: blockerDoneCriteria(step, actionType, evidenceImportRow),
      checklist: blockerChecklist(step, actionType),
    };
  }).sort((a, b) => {
    const statusWeight = (status: ClipperBlockerResolutionActionStatus) => status === "blocked" ? 0 : status === "next" ? 1 : 2;
    const severityWeight = (severity: ClipperBlockerResolutionAction["severity"]) => severity === "critical" ? 0 : severity === "high" ? 1 : 2;
    return statusWeight(a.status) - statusWeight(b.status)
      || BLOCKER_UNLOCK_PHASE_ORDER[a.unlockPhase] - BLOCKER_UNLOCK_PHASE_ORDER[b.unlockPhase]
      || severityWeight(a.severity) - severityWeight(b.severity)
      || a.label.localeCompare(b.label);
  }).slice(0, 30).map((action, index) => ({ ...action, rank: index + 1 }));
  const totals = actions.reduce<ClipperBlockerResolutionPackSummary["totals"]>((sum, action) => {
    sum.actions += 1;
    if (action.severity === "critical") sum.critical += 1;
    if (action.status === "blocked") sum.blocked += 1;
    if (action.status === "next") sum.next += 1;
    if (action.status === "ready") sum.ready += 1;
    if (action.canRunInApp) sum.inApp += 1;
    else sum.external += 1;
    return sum;
  }, { actions: 0, critical: 0, blocked: 0, next: 0, ready: 0, inApp: 0, external: 0 });
  const generatedAt = await stat(BLOCKER_RESOLUTION_PACK_PATH).then((file) => file.mtime.toISOString()).catch(() => null);
  return {
    status: !generatedAt
      ? "not_prepared"
      : totals.blocked > 0
        ? "blocked"
        : totals.next > 0
          ? "in_progress"
          : "ready",
    generatedAt,
    manifestPath: BLOCKER_RESOLUTION_PACK_PATH,
    markdownPath: BLOCKER_RESOLUTION_PACK_MARKDOWN_PATH,
    csvPath: BLOCKER_RESOLUTION_PACK_CSV_PATH,
    actions,
    evidenceBatchTemplate: buildBlockerEvidenceBatchTemplate(actions),
    totals,
    nextStep: actions[0]?.nextStep || input.growthAudit.summary,
  };
}

function renderBlockerResolutionPackMarkdown(summary: ClipperBlockerResolutionPackSummary): string {
  return [
    "# Clippers Blocker Resolution Pack",
    "",
    `Status: ${summary.status}`,
    `Generated: ${summary.generatedAt || new Date().toISOString()}`,
    `Totals: ${summary.totals.actions} actions, ${summary.totals.critical} critical, ${summary.totals.inApp} in-app, ${summary.totals.external} external`,
    `CSV: ${summary.csvPath}`,
    "",
    "## Next Step",
    "",
    summary.nextStep,
    "",
    "## Evidence Batch Template",
    "",
    "```csv",
    summary.evidenceBatchTemplate,
    "```",
    "",
    "## Actions",
    "",
    ...summary.actions.flatMap((action) => [
      `### ${action.rank}. ${action.label}`,
      "",
      `- Status: ${action.status}`,
      `- Severity: ${action.severity}`,
      `- Unlock phase: ${action.unlockPhase}`,
      `- Depends on: ${action.dependsOn.length ? action.dependsOn.join(", ") : "none"}`,
      `- Owner: ${action.owner}`,
      `- Type: ${action.actionType}`,
      `- In app: ${action.canRunInApp ? "yes" : "no"}`,
      `- Execution mode: ${action.executionMode}`,
      `- Estimated minutes: ${action.estimatedMinutes}`,
      action.actionUrl ? `- Action URL: ${action.actionUrl}` : null,
      action.portalUrl ? `- Portal URL: ${action.portalUrl}` : null,
      action.artifactPath ? `- Artifact: ${action.artifactPath}` : null,
      `- Evidence: ${action.evidence}`,
      action.evidenceImportRow ? `- Evidence import row: ${action.evidenceImportRow}` : null,
      `- Proof command: ${action.proofCommand}`,
      `- Next step: ${action.nextStep}`,
      `- Unblock condition: ${action.unblockCondition}`,
      "",
      "Done criteria:",
      ...action.doneCriteria.map((item) => `- [ ] ${item}`),
      "",
      "Checklist:",
      ...action.checklist.map((item) => `- [ ] ${item}`),
      "",
    ].filter((line): line is string => Boolean(line))),
  ].join("\n");
}

function renderBlockerResolutionPackCsv(summary: ClipperBlockerResolutionPackSummary): string {
  const header = ["rank", "id", "unlock_phase", "depends_on", "label", "owner", "status", "severity", "type", "in_app", "execution_mode", "estimated_minutes", "action_url", "portal_url", "artifact", "evidence_import_row", "proof_command", "next_step", "unblock_condition", "done_criteria"];
  return [
    header.map(csvEscape).join(","),
    ...summary.actions.map((action) => [
      action.rank,
      action.id,
      action.unlockPhase,
      action.dependsOn.join("|"),
      action.label,
      action.owner,
      action.status,
      action.severity,
      action.actionType,
      action.canRunInApp ? "yes" : "no",
      action.executionMode,
      action.estimatedMinutes,
      action.actionUrl || "",
      action.portalUrl || "",
      action.artifactPath || "",
      action.evidenceImportRow,
      action.proofCommand,
      action.nextStep,
      action.unblockCondition,
      action.doneCriteria.join(" | "),
    ].map(csvEscape).join(",")),
    "",
  ].join("\n");
}

export async function prepareClipperBlockerResolutionPack(userId = getSystemUserId()): Promise<{ blockerResolutionPack: ClipperBlockerResolutionPackSummary; status: ClipperStatus }> {
  await ensureClipperDirs();
  const statusBeforePack = await getClipperStatus(userId);
  const draftSummary = await buildBlockerResolutionPackSummary({
    commandCenter: statusBeforePack.commandCenter,
    growthAudit: statusBeforePack.growthAudit,
  });
  const blockerResolutionPack: ClipperBlockerResolutionPackSummary = {
    ...draftSummary,
    generatedAt: new Date().toISOString(),
    status: draftSummary.totals.blocked > 0
      ? "blocked"
      : draftSummary.totals.next > 0
        ? "in_progress"
        : "ready",
  };
  await writeFile(BLOCKER_RESOLUTION_PACK_PATH, JSON.stringify(blockerResolutionPack, null, 2));
  await writeFile(BLOCKER_RESOLUTION_PACK_MARKDOWN_PATH, renderBlockerResolutionPackMarkdown(blockerResolutionPack));
  await writeFile(BLOCKER_RESOLUTION_PACK_CSV_PATH, renderBlockerResolutionPackCsv(blockerResolutionPack));
  return { blockerResolutionPack, status: await getClipperStatus(userId) };
}

function autopilotActionStatus(action: ClipperBlockerResolutionAction): ClipperGoLiveAutopilotActionStatus {
  if (action.status === "ready") return "done";
  if (action.canRunInApp && action.actionUrl) return "run_in_app";
  if (["account", "developer_app", "permission", "oauth", "external"].includes(action.actionType)) return "external_required";
  return "waiting";
}

function autopilotLane(action: ClipperBlockerResolutionAction): ClipperGoLiveAutopilotActionLane {
  if (action.canRunInApp && action.actionUrl) return "in_app";
  if (["account", "developer_app", "permission", "oauth", "external"].includes(action.actionType)) return "external";
  if (["source", "rights", "metrics"].includes(action.actionType)) return "evidence";
  return "publish";
}

function inferAutopilotPlatform(action: ClipperBlockerResolutionAction): ClipperPlatform | "system" {
  return inferClipperPlatformFromText(`${action.sourceStepId} ${action.label} ${action.nextStep}`);
}

function buildAutopilotEvidenceTemplate(action: ClipperBlockerResolutionAction): string {
  if (action.actionType === "account") return "kind=account,account_id=<account>,platform=<platform>,status=verified,notes=<handle + verification proof>";
  if (action.actionType === "developer_app") return "kind=developer_app,platform=<platform>,status=submitted|approved,app_identifier=<app id>,public_base_url=<https url>,notes=<review notes>";
  if (action.actionType === "permission") return "kind=permission,platform=<platform>,scope=<scope>,status=requested|approved,notes=<review evidence>";
  if (action.actionType === "rights") return "source_id=<asset or trend>,rights_status=owned_or_permissioned,notes=<permission/license proof>";
  if (action.actionType === "credential") return "Paste allowed env vars in Credential Setup batch; never paste secrets into reports.";
  if (action.actionType === "metrics") return "Import metrics CSV: account_id,platform,views,likes,comments,shares,posted_at,url.";
  return "Regenerate the referenced artifact, then record evidence in the matching vault.";
}

function autopilotAgentForAction(action: Pick<ClipperGoLiveAutopilotAction, "owner" | "label" | "lane" | "platform" | "nextStep">): { agentId: string; subAgentName: string } {
  const source = `${action.owner} ${action.label} ${action.nextStep}`.toLowerCase();
  if (source.includes("trend")) return { agentId: "trend-scout", subAgentName: "Trend Scout" };
  if (source.includes("rights") || source.includes("permissioned") || source.includes("allowlist")) return { agentId: "rights-gate", subAgentName: "Rights Gate" };
  if (source.includes("draft") || source.includes("clip factory") || source.includes("render")) return { agentId: "clip-factory", subAgentName: "Clip Factory" };
  if (source.includes("metric") || source.includes("optimizer") || source.includes("analytics")) return { agentId: "optimizer", subAgentName: "Optimizer" };
  if (source.includes("account") || source.includes("cuenta")) return { agentId: "account-ops", subAgentName: "Account Ops" };
  if (source.includes("developer") || source.includes("permission") || source.includes("oauth") || source.includes("app review")) return { agentId: "permission-ops", subAgentName: "Permission Ops" };
  if (source.includes("public") || source.includes("https") || source.includes("tunnel") || source.includes("url")) return { agentId: "platform-ops", subAgentName: "Platform Ops" };
  if (action.lane === "publish") return { agentId: "publisher", subAgentName: "Publisher" };
  if (action.platform !== "system") return { agentId: "permission-ops", subAgentName: "Permission Ops" };
  return { agentId: "publisher", subAgentName: "Publisher" };
}

function autopilotOperatorSteps(action: Pick<ClipperGoLiveAutopilotAction, "localActionUrl" | "portalUrl" | "artifactPath" | "evidenceTemplate" | "nextStep" | "unblockCondition">): string[] {
  return [
    action.artifactPath ? `Open artifact: ${action.artifactPath}` : "Review the current Clippers panel for this action.",
    action.localActionUrl ? `Run in-app action: POST ${action.localActionUrl}` : null,
    action.portalUrl ? `Open external portal and complete the required setup: ${action.portalUrl}` : null,
    `Record evidence using: ${action.evidenceTemplate}`,
    action.nextStep,
    `Verify: ${action.unblockCondition}`,
  ].filter((step): step is string => Boolean(step));
}

function autopilotHandoffPayload(action: Pick<ClipperGoLiveAutopilotAction, "id" | "platform" | "lane" | "status" | "localActionUrl" | "portalUrl" | "artifactPath" | "evidenceTemplate" | "nextStep">): Array<{ label: string; value: string }> {
  return [
    { label: "action_id", value: action.id },
    { label: "platform", value: action.platform },
    { label: "lane", value: action.lane },
    { label: "status", value: action.status },
    action.localActionUrl ? { label: "local_action", value: action.localActionUrl } : null,
    action.portalUrl ? { label: "portal_url", value: action.portalUrl } : null,
    action.artifactPath ? { label: "artifact", value: action.artifactPath } : null,
    { label: "evidence_template", value: action.evidenceTemplate },
    { label: "next_step", value: action.nextStep },
  ].filter((item): item is { label: string; value: string } => Boolean(item));
}

function autopilotEvidenceRows(action: Pick<ClipperGoLiveAutopilotAction, "evidenceTemplate" | "platform" | "label">): string[] {
  const evidence = action.evidenceTemplate;
  if (evidence.startsWith("kind=")) return [evidence.replaceAll(",", ",")];
  if (/kind=account/i.test(evidence)) return [`account,<account_id>,${action.platform},verified,,,,<handle + verification proof>`];
  if (/kind=developer_app/i.test(evidence)) return [`developer_app,,${action.platform},submitted,,<app id>,<https public base url>,<developer portal proof>`];
  if (/kind=permission/i.test(evidence)) return [`permission,,${action.platform},requested,<scope>,,,<permission request proof>`];
  return [`note,,${action.platform},pending,,,,"${action.label}: ${evidence.replaceAll("\"", "'")}"`];
}

function autopilotSuccessSignals(action: Pick<ClipperGoLiveAutopilotAction, "status" | "localActionUrl" | "portalUrl" | "unblockCondition" | "platform">): string[] {
  return [
    action.status === "run_in_app" && action.localActionUrl ? `POST ${action.localActionUrl} returns 200.` : null,
    action.portalUrl ? "Portal shows the setting, account, app, permission or OAuth step as saved/submitted/approved." : null,
    action.platform !== "system" ? `${action.platform} readiness no longer reports this blocker.` : "System readiness no longer reports this blocker.",
    action.unblockCondition,
  ].filter((signal): signal is string => Boolean(signal));
}

function autopilotRiskControls(action: Pick<ClipperGoLiveAutopilotAction, "lane" | "platform" | "label">): string[] {
  const controls = [
    "Do not paste client secrets, access tokens or refresh tokens into reports, markdown, CSV, or evidence notes.",
    "Keep autopost disabled until Publisher Connectors, Rights Gate and OAuth are ready.",
  ];
  if (action.lane === "external") controls.push("Use official platform portals only; capture proof after every save/submit step.");
  if (action.lane === "evidence") controls.push("Do not mark source rights as owned_or_permissioned without proof from owner, license, official source, or creator approval.");
  if (action.platform !== "system") controls.push(`Do not publish on ${action.platform} until this action is no longer blocking go-live.`);
  if (/public|url|https|tunnel/i.test(action.label)) controls.push("Do not register redirect URIs until the public HTTPS endpoint checks pass.");
  return Array.from(new Set(controls));
}

function enrichGoLiveAutopilotAction(action: Omit<ClipperGoLiveAutopilotAction, "agentId" | "subAgentName" | "handoffPayload" | "operatorSteps" | "evidenceRows" | "successSignals" | "riskControls" | "mission">): ClipperGoLiveAutopilotAction {
  const agent = autopilotAgentForAction(action);
  const withAgent = {
    ...action,
    ...agent,
    mission: `${agent.subAgentName} debe mover "${action.label}" de ${action.status} a desbloqueado sin saltarse evidencia ni permisos.`,
  };
  return {
    ...withAgent,
    handoffPayload: autopilotHandoffPayload(withAgent),
    operatorSteps: autopilotOperatorSteps(withAgent),
    evidenceRows: autopilotEvidenceRows(withAgent),
    successSignals: autopilotSuccessSignals(withAgent),
    riskControls: autopilotRiskControls(withAgent),
  };
}

async function buildGoLiveAutopilotBriefSummary(input: {
  blockerResolutionPack: ClipperBlockerResolutionPackSummary;
  externalLaunchDossier: ClipperExternalLaunchDossierSummary;
  goLiveExecutionPack: ClipperGoLiveExecutionPackSummary;
  driveWorkspace: ClipperDriveWorkspaceSummary;
  viralDiscovery: ClipperViralDiscoverySummary;
  trendRightsOutreach: ClipperTrendRightsOutreachSummary;
}): Promise<ClipperGoLiveAutopilotBriefSummary> {
  const blockerActions = input.blockerResolutionPack.actions.slice(0, 18).map((action, index) => enrichGoLiveAutopilotAction({
    id: `autopilot-${action.id}`,
    rank: index + 1,
    lane: autopilotLane(action),
    platform: inferAutopilotPlatform(action),
    owner: action.owner,
    status: autopilotActionStatus(action),
    label: action.label,
    localActionUrl: action.actionUrl,
    portalUrl: action.portalUrl,
    artifactPath: action.artifactPath,
    evidenceTemplate: buildAutopilotEvidenceTemplate(action),
    reason: action.evidence,
    nextStep: action.nextStep,
    blockers: action.status === "blocked" ? [action.unblockCondition] : [],
    unblockCondition: action.unblockCondition,
  }));

  const platformActions = input.externalLaunchDossier.platforms
    .filter((platform) => platform.status !== "ready")
    .map((platform, index) => enrichGoLiveAutopilotAction({
      id: `autopilot-platform-${platform.platform}`,
      rank: blockerActions.length + index + 1,
      lane: "external",
      platform: platform.platform,
      owner: "Platform Ops",
      status: "external_required",
      label: `${platform.label}: completar setup externo`,
      localActionUrl: null,
      portalUrl: platform.oauthUrl || platform.developerPortalUrl || platform.accountCreationUrl,
      artifactPath: input.externalLaunchDossier.markdownPath,
      evidenceTemplate: "Usa Launch Evidence Batch: kind=account/developer_app/permission segun el paso completado.",
      reason: `${platform.accountTasksDone}/${platform.accountTasks} cuentas; developer app ${platform.developerAppStatus}; OAuth ${platform.oauthStatus}; permisos ${platform.permissionsApproved}/${platform.permissionsTotal}.`,
      nextStep: platform.nextStep,
      blockers: platform.criticalActions,
      unblockCondition: `La plataforma ${platform.label} cambia a ready cuando cuentas, app review, permisos y OAuth esten registrados.`,
    }));

  const systemActions = [
    input.driveWorkspace.status !== "ready" && enrichGoLiveAutopilotAction({
      id: "autopilot-drive-workspace",
      rank: blockerActions.length + platformActions.length + 1,
      lane: input.driveWorkspace.status === "missing_keys" ? "external" : "in_app",
      platform: "system",
      owner: "Content Ops",
      status: input.driveWorkspace.status === "missing_keys" ? "external_required" : "run_in_app",
      label: "Google Drive workspace",
      localActionUrl: "/api/clippers/prepare-drive-workspace",
      portalUrl: null,
      artifactPath: input.driveWorkspace.manifestPath,
      evidenceTemplate: "GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET or accepted aliases in CEO_ASSISTANT_ENV, then reload keys.",
      reason: `Drive status: ${input.driveWorkspace.status}.`,
      nextStep: input.driveWorkspace.nextStep,
      blockers: input.driveWorkspace.status === "missing_keys" ? ["Google Drive OAuth env vars are not loaded in runtime."] : [],
      unblockCondition: "Drive workspace status becomes ready and folders are created or verified.",
    }),
    input.viralDiscovery.status !== "ready" && enrichGoLiveAutopilotAction({
      id: "autopilot-viral-discovery",
      rank: blockerActions.length + platformActions.length + 2,
      lane: "in_app",
      platform: "system",
      owner: "Trend Scout",
      status: "run_in_app",
      label: "Viral Discovery Pack",
      localActionUrl: "/api/clippers/prepare-viral-discovery",
      portalUrl: null,
      artifactPath: input.viralDiscovery.markdownPath,
      evidenceTemplate: "Import discovered candidates with trend candidates batch after review.",
      reason: `Viral discovery status: ${input.viralDiscovery.status}.`,
      nextStep: input.viralDiscovery.nextStep,
      blockers: [],
      unblockCondition: "Viral Discovery Pack is ready with daily search queue.",
    }),
    input.trendRightsOutreach.status !== "ready" && input.trendRightsOutreach.totals.candidates > 0 && enrichGoLiveAutopilotAction({
      id: "autopilot-trend-rights",
      rank: blockerActions.length + platformActions.length + 3,
      lane: "evidence",
      platform: "system",
      owner: "Rights Gate",
      status: input.trendRightsOutreach.totals.readyToContact > 0 ? "external_required" : "waiting",
      label: "Trend rights outreach",
      localActionUrl: "/api/clippers/prepare-trend-rights-outreach",
      portalUrl: null,
      artifactPath: input.trendRightsOutreach.markdownPath,
      evidenceTemplate: "Record creator/rightsholder response before moving trend into production.",
      reason: `${input.trendRightsOutreach.totals.readyToContact} trends ready to contact; ${input.trendRightsOutreach.totals.permissionRecorded} permission recorded.`,
      nextStep: input.trendRightsOutreach.nextStep,
      blockers: input.trendRightsOutreach.totals.readyToContact > 0 ? [] : ["No trend candidates imported yet."],
      unblockCondition: "Trend candidates with review_required rights have outreach or permission records.",
    }),
  ].filter(Boolean) as ClipperGoLiveAutopilotAction[];

  const merged = [...blockerActions, ...platformActions, ...systemActions];
  const seen = new Set<string>();
  const actions = merged
    .filter((action) => {
      const key = `${action.label}-${action.platform}-${action.localActionUrl || action.portalUrl || action.nextStep}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((action, index) => ({ ...action, rank: index + 1 }));

  const lanes = actions.reduce<ClipperGoLiveAutopilotBriefSummary["lanes"]>((sum, action) => {
    sum[action.lane] += 1;
    return sum;
  }, { in_app: 0, external: 0, evidence: 0, publish: 0 });
  const platformSet = new Set(actions.filter((action) => action.platform !== "system").map((action) => action.platform));
  const totals = actions.reduce<ClipperGoLiveAutopilotBriefSummary["totals"]>((sum, action) => {
    sum.actions += 1;
    if (action.status === "run_in_app") sum.inAppReady += 1;
    if (action.status === "external_required") sum.externalRequired += 1;
    if (action.status === "waiting") sum.waiting += 1;
    if (action.status === "done") sum.done += 1;
    if (action.blockers.length > 0) sum.blocked += 1;
    return sum;
  }, { actions: 0, inAppReady: 0, externalRequired: 0, waiting: 0, done: 0, blocked: 0, platformsCovered: platformSet.size });
  totals.platformsCovered = platformSet.size;

  const generatedAt = await stat(GO_LIVE_AUTOPILOT_BRIEF_PATH).then((file) => file.mtime.toISOString()).catch(() => null);
  return {
    status: !generatedAt
      ? "not_prepared"
      : totals.externalRequired > 0 || totals.blocked > 0
        ? "blocked"
        : totals.inAppReady > 0 || totals.waiting > 0
          ? "in_progress"
          : "ready",
    generatedAt,
    manifestPath: GO_LIVE_AUTOPILOT_BRIEF_PATH,
    markdownPath: GO_LIVE_AUTOPILOT_BRIEF_MARKDOWN_PATH,
    csvPath: GO_LIVE_AUTOPILOT_BRIEF_CSV_PATH,
    actions,
    totals,
    lanes,
    nextStep: actions.find((action) => action.status === "run_in_app")?.nextStep
      || actions.find((action) => action.status === "external_required")?.nextStep
      || actions.find((action) => action.status === "waiting")?.nextStep
      || "Autopilot brief listo; pasar a dry-run y reportes.",
  };
}

function renderGoLiveAutopilotBriefMarkdown(summary: ClipperGoLiveAutopilotBriefSummary): string {
  return [
    "# Clippers Go-Live Autopilot Brief",
    "",
    `Status: ${summary.status}`,
    `Generated: ${summary.generatedAt || new Date().toISOString()}`,
    `Totals: ${summary.totals.actions} actions, ${summary.totals.inAppReady} in-app ready, ${summary.totals.externalRequired} external required, ${summary.totals.blocked} blocked`,
    `CSV: ${summary.csvPath}`,
    "",
    "## Next Step",
    "",
    summary.nextStep,
    "",
    "## Lanes",
    "",
    `- In app: ${summary.lanes.in_app}`,
    `- External: ${summary.lanes.external}`,
    `- Evidence: ${summary.lanes.evidence}`,
    `- Publish: ${summary.lanes.publish}`,
    "",
    "## Actions",
    "",
    ...summary.actions.flatMap((action) => [
      `### ${action.rank}. ${action.label}`,
      "",
      `- Status: ${action.status}`,
      `- Lane: ${action.lane}`,
      `- Platform: ${action.platform}`,
      `- Sub-agent: ${action.subAgentName} (${action.agentId})`,
      `- Owner: ${action.owner}`,
      action.localActionUrl ? `- Local action: ${action.localActionUrl}` : null,
      action.portalUrl ? `- Portal: ${action.portalUrl}` : null,
      action.artifactPath ? `- Artifact: ${action.artifactPath}` : null,
      `- Mission: ${action.mission}`,
      `- Reason: ${action.reason}`,
      `- Next step: ${action.nextStep}`,
      `- Evidence template: ${action.evidenceTemplate}`,
      `- Unblock condition: ${action.unblockCondition}`,
      "",
      "Handoff payload:",
      ...action.handoffPayload.map((field) => `- ${field.label}: ${field.value}`),
      "",
      "Operator steps:",
      ...action.operatorSteps.map((step) => `- [ ] ${step}`),
      "",
      "Evidence rows:",
      ...action.evidenceRows.map((row) => `- ${row}`),
      "",
      "Success signals:",
      ...action.successSignals.map((signal) => `- [ ] ${signal}`),
      "",
      "Risk controls:",
      ...action.riskControls.map((control) => `- ${control}`),
      "",
      action.blockers.length ? "Blockers:" : "Blockers: none",
      ...action.blockers.map((blocker) => `- ${blocker}`),
      "",
    ].filter((line): line is string => Boolean(line))),
  ].join("\n");
}

function renderGoLiveAutopilotBriefCsv(summary: ClipperGoLiveAutopilotBriefSummary): string {
  const header = ["rank", "id", "status", "lane", "platform", "agent_id", "sub_agent", "owner", "label", "local_action_url", "portal_url", "artifact", "mission", "next_step", "evidence_template", "evidence_rows", "operator_steps", "success_signals", "risk_controls", "unblock_condition"];
  return [
    header.map(csvEscape).join(","),
    ...summary.actions.map((action) => [
      action.rank,
      action.id,
      action.status,
      action.lane,
      action.platform,
      action.agentId,
      action.subAgentName,
      action.owner,
      action.label,
      action.localActionUrl || "",
      action.portalUrl || "",
      action.artifactPath || "",
      action.mission,
      action.nextStep,
      action.evidenceTemplate,
      action.evidenceRows.join(" | "),
      action.operatorSteps.join(" | "),
      action.successSignals.join(" | "),
      action.riskControls.join(" | "),
      action.unblockCondition,
    ].map(csvEscape).join(",")),
    "",
  ].join("\n");
}

export async function prepareClipperGoLiveAutopilotBrief(userId = getSystemUserId()): Promise<{ goLiveAutopilotBrief: ClipperGoLiveAutopilotBriefSummary; status: ClipperStatus }> {
  await ensureClipperDirs();
  const statusBeforePack = await getClipperStatus(userId);
  const draftSummary = await buildGoLiveAutopilotBriefSummary({
    blockerResolutionPack: statusBeforePack.blockerResolutionPack,
    externalLaunchDossier: statusBeforePack.externalLaunchDossier,
    goLiveExecutionPack: statusBeforePack.goLiveExecutionPack,
    driveWorkspace: statusBeforePack.driveWorkspace,
    viralDiscovery: statusBeforePack.viralDiscovery,
    trendRightsOutreach: statusBeforePack.trendRightsOutreach,
  });
  const goLiveAutopilotBrief: ClipperGoLiveAutopilotBriefSummary = {
    ...draftSummary,
    generatedAt: new Date().toISOString(),
    status: draftSummary.totals.externalRequired > 0 || draftSummary.totals.blocked > 0
      ? "blocked"
      : draftSummary.totals.inAppReady > 0 || draftSummary.totals.waiting > 0
        ? "in_progress"
        : "ready",
  };
  await writeFile(GO_LIVE_AUTOPILOT_BRIEF_PATH, JSON.stringify(goLiveAutopilotBrief, null, 2));
  await writeFile(GO_LIVE_AUTOPILOT_BRIEF_MARKDOWN_PATH, renderGoLiveAutopilotBriefMarkdown(goLiveAutopilotBrief));
  await writeFile(GO_LIVE_AUTOPILOT_BRIEF_CSV_PATH, renderGoLiveAutopilotBriefCsv(goLiveAutopilotBrief));
  return { goLiveAutopilotBrief, status: await getClipperStatus(userId) };
}

async function buildGoLiveAutopilotRunSummary(): Promise<ClipperGoLiveAutopilotRunSummary> {
  const raw = await readFile(GO_LIVE_AUTOPILOT_RUN_PATH, "utf8").catch(() => null);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as ClipperGoLiveAutopilotRunSummary;
      const completedActionIds = Array.isArray(parsed.completedActionIds)
        ? parsed.completedActionIds.filter((id): id is string => typeof id === "string")
        : (Array.isArray(parsed.items) ? parsed.items.filter((item) => item.status === "completed").map((item) => item.actionId) : []);
      return { ...parsed, completedActionIds: Array.from(new Set(completedActionIds)) };
    } catch {
      // Fall through to a clean not_run summary when the file is corrupt.
    }
  }
  return {
    status: "not_run",
    generatedAt: null,
    manifestPath: GO_LIVE_AUTOPILOT_RUN_PATH,
    markdownPath: GO_LIVE_AUTOPILOT_RUN_MARKDOWN_PATH,
    requestedActionId: null,
    maxActions: 0,
    completedActionIds: [],
    items: [],
    totals: { attempted: 0, completed: 0, skipped: 0, failed: 0 },
    nextStep: "Run the next in-app Autopilot action after the brief is prepared.",
  };
}

function renderGoLiveAutopilotRunMarkdown(summary: ClipperGoLiveAutopilotRunSummary): string {
  return [
    "# Clippers Go-Live Autopilot Run",
    "",
    `Status: ${summary.status}`,
    `Generated: ${summary.generatedAt || new Date().toISOString()}`,
    `Requested action: ${summary.requestedActionId || "next"}`,
    `Max actions: ${summary.maxActions}`,
    `Completed memory: ${summary.completedActionIds.length} action ids`,
    `Totals: ${summary.totals.completed} completed, ${summary.totals.skipped} skipped, ${summary.totals.failed} failed`,
    "",
    "## Next Step",
    "",
    summary.nextStep,
    "",
    "## Items",
    "",
    ...summary.items.flatMap((item, index) => [
      `### ${index + 1}. ${item.label}`,
      "",
      `- Action ID: ${item.actionId}`,
      `- Status: ${item.status}`,
      `- Local action: ${item.localActionUrl || "n/a"}`,
      `- Started: ${item.startedAt}`,
      `- Finished: ${item.finishedAt}`,
      `- Message: ${item.message}`,
      "",
    ]),
  ].join("\n");
}

async function executeGoLiveAutopilotLocalAction(actionUrl: string, userId: string): Promise<string> {
  switch (actionUrl) {
    case "/api/clippers/prepare-command-center":
      await prepareClipperLaunchCommandCenter(userId);
      return "Launch Command Center regenerated.";
    case "/api/clippers/prepare-credential-setup":
      await prepareClipperCredentialSetupCenter(userId);
      return "Credential Setup Center regenerated.";
    case "/api/clippers/import-credential-drop-files":
      await importClipperCredentialDropFiles(userId);
      return "Credential drop files imported.";
    case "/api/clippers/prepare-credential-doctor":
      await prepareClipperCredentialDoctor(userId);
      return "Credential Doctor regenerated.";
    case "/api/clippers/prepare-platform-readiness":
      await prepareClipperPlatformReadinessMatrix(userId);
      return "Platform Readiness Matrix regenerated.";
    case "/api/clippers/prepare-external-setup-queue":
      await prepareClipperExternalSetupQueue(userId);
      return "External Setup Queue regenerated.";
    case "/api/clippers/import-launch-evidence-drop-files":
      await importClipperLaunchEvidenceDropFiles(userId);
      return "Launch evidence drop files imported.";
    case "/api/clippers/prepare-external-launch-dossier":
      await prepareClipperExternalLaunchDossier(userId);
      return "External Launch Dossier regenerated.";
    case "/api/clippers/prepare-platform-portal-checklist":
      await prepareClipperPlatformPortalChecklist(userId);
      return "Platform Portal Checklist regenerated.";
    case "/api/clippers/prepare-drive-workspace":
      await prepareClipperDriveWorkspace(userId);
      return "Google Drive workspace preparation attempted.";
    case "/api/clippers/prepare-account-identity-kit":
      await prepareClipperAccountIdentityKit(userId);
      return "Account Identity Kit regenerated.";
    case "/api/clippers/prepare-account-creation-pack":
      await prepareClipperAccountCreationPack(userId);
      return "Account Creation Pack regenerated.";
    case "/api/clippers/prepare-intake-kit":
      await prepareClipperIntakeKit(userId);
      return "Intake Kit regenerated.";
    case "/api/clippers/prepare-production-url-setup":
      await prepareClipperProductionUrlSetup(userId);
      return "Production URL setup regenerated.";
    case "/api/clippers/verify-production-url":
      await verifyClipperProductionUrl(userId);
      return "Production URL endpoints verified.";
    case "/api/clippers/prepare-https-tunnel-plan":
      await prepareClipperHttpsTunnelPlan(userId);
      return "HTTPS Tunnel Plan regenerated.";
    case "/api/clippers/prepare-legal-policy-pack":
      await prepareClipperLegalPolicyPack(userId);
      return "Legal Policy Pack regenerated.";
    case "/api/clippers/prepare-app-review-demo-pack":
      await prepareClipperAppReviewDemoPack(userId);
      return "App Review Demo Pack regenerated.";
    case "/api/clippers/prepare-developer-application-drafts":
      await prepareClipperDeveloperApplicationDrafts(userId);
      return "Developer Application Drafts regenerated.";
    case "/api/clippers/prepare-app-review-submission-pack":
      await prepareClipperAppReviewSubmissionPack(userId);
      return "App Review Submission Pack regenerated.";
    case "/api/clippers/prepare-oauth-go-live":
      await prepareClipperOAuthGoLivePreflight(userId);
      return "OAuth Go-Live Preflight regenerated.";
    case "/api/clippers/prepare-oauth-connection-pack":
      await prepareClipperOAuthConnectionPack(userId);
      return "OAuth Connection Pack regenerated.";
    case "/api/clippers/prepare-go-live-execution-pack":
      await prepareClipperGoLiveExecutionPack(userId);
      return "Go-Live Execution Pack regenerated.";
    case "/api/clippers/prepare-permission-request-pack":
      await prepareClipperPermissionRequestPack(userId);
      return "Permission Request Pack regenerated.";
    case "/api/clippers/prepare-official-permission-matrix":
      await prepareClipperOfficialPermissionMatrix(userId);
      return "Official Permission Matrix regenerated.";
    case "/api/clippers/prepare-source-acquisition":
      await prepareClipperSourceAcquisitionPlan(userId);
      return "Source Acquisition Plan regenerated.";
    case "/api/clippers/import-source-drop-files":
      await importClipperSourceDropFiles(userId);
      return "Source drop files imported.";
    case "/api/clippers/prepare-source-hunt":
      await prepareClipperSourceHuntSheet({}, userId);
      return "Source Hunt Sheet regenerated.";
    case "/api/clippers/prepare-rights-outreach":
      await prepareClipperRightsOutreachPack(userId);
      return "Rights Outreach Pack regenerated.";
    case "/api/clippers/prepare-draft-specs":
      await prepareClipperDraftSpecs(userId);
      return "Draft Specs regenerated.";
    case "/api/clippers/prepare-trend-rights-outreach":
      await prepareClipperTrendRightsOutreachPack(userId);
      return "Trend Rights Outreach Pack regenerated.";
    case "/api/clippers/prepare-viral-discovery":
      await prepareClipperViralDiscoveryPack({}, userId);
      return "Viral Discovery Pack regenerated.";
    case "/api/clippers/run-automation-cycle":
      await runClipperAutomationCycle({ publishMode: "approval_required", riskTolerance: "growth" }, userId);
      return "Automation cycle dry-run completed in approval_required mode.";
    case "/api/clippers/prepare-manual-posting-pack":
      await prepareClipperManualPostingPack(userId);
      return "Manual Posting Pack regenerated.";
    case "/api/clippers/prepare-publishing-package":
      await prepareClipperPublishingPackage(userId);
      return "Publishing Package regenerated.";
    case "/api/clippers/prepare-publisher-connectors":
      await prepareClipperPublisherConnectors(userId);
      return "Publisher Connectors regenerated.";
    default:
      throw new Error(`Action URL is not allowlisted for Autopilot execution: ${actionUrl}`);
  }
}

export async function runClipperGoLiveAutopilot(input: unknown = {}, userId = getSystemUserId()): Promise<{ goLiveAutopilotRun: ClipperGoLiveAutopilotRunSummary; goLiveAutopilotBrief: ClipperGoLiveAutopilotBriefSummary; status: ClipperStatus }> {
  await ensureClipperDirs();
  const requestedActionId = typeof (input as { actionId?: unknown })?.actionId === "string"
    ? ((input as { actionId: string }).actionId.trim() || null)
    : null;
  const rawMaxActions = Number((input as { maxActions?: unknown })?.maxActions ?? 1);
  const maxActions = Math.max(1, Math.min(5, Number.isFinite(rawMaxActions) ? Math.floor(rawMaxActions) : 1));
  const previousRun = await buildGoLiveAutopilotRunSummary();
  const completedMemory = new Set(previousRun.completedActionIds);
  const { goLiveAutopilotBrief: beforeBrief } = await prepareClipperGoLiveAutopilotBrief(userId);
  const requestedAction = requestedActionId ? beforeBrief.actions.find((action) => action.id === requestedActionId) || null : null;
  const selected = requestedAction
    ? [requestedAction]
    : beforeBrief.actions
      .filter((action) => action.status === "run_in_app" && action.localActionUrl && !completedMemory.has(action.id))
      .slice(0, maxActions);

  const items: ClipperGoLiveAutopilotRunItem[] = [];
  if (requestedActionId && !requestedAction) {
    const now = new Date().toISOString();
    items.push({
      actionId: requestedActionId,
      label: "Unknown Autopilot action",
      localActionUrl: null,
      status: "skipped",
      startedAt: now,
      finishedAt: now,
      message: "Action ID was not found in the current Autopilot Brief.",
    });
  }

  if (selected.length === 0 && items.length === 0) {
    const now = new Date().toISOString();
    items.push({
      actionId: "none",
      label: "No in-app Autopilot action available",
      localActionUrl: null,
      status: "skipped",
      startedAt: now,
      finishedAt: now,
      message: "No current Autopilot actions are marked run_in_app.",
    });
  }

  for (const action of selected) {
    const startedAt = new Date().toISOString();
    if (action.status !== "run_in_app" || !action.localActionUrl) {
      items.push({
        actionId: action.id,
        label: action.label,
        localActionUrl: action.localActionUrl,
        status: "skipped",
        startedAt,
        finishedAt: new Date().toISOString(),
        message: `Action is ${action.status}; only run_in_app actions can be executed automatically.`,
      });
      continue;
    }
    try {
      const message = await executeGoLiveAutopilotLocalAction(action.localActionUrl, userId);
      items.push({
        actionId: action.id,
        label: action.label,
        localActionUrl: action.localActionUrl,
        status: "completed",
        startedAt,
        finishedAt: new Date().toISOString(),
        message,
      });
    } catch (error: any) {
      items.push({
        actionId: action.id,
        label: action.label,
        localActionUrl: action.localActionUrl,
        status: "failed",
        startedAt,
        finishedAt: new Date().toISOString(),
        message: error?.message || "Autopilot action failed.",
      });
    }
  }

  const totals = items.reduce<ClipperGoLiveAutopilotRunSummary["totals"]>((sum, item) => {
    sum.attempted += 1;
    if (item.status === "completed") sum.completed += 1;
    if (item.status === "skipped") sum.skipped += 1;
    if (item.status === "failed") sum.failed += 1;
    return sum;
  }, { attempted: 0, completed: 0, skipped: 0, failed: 0 });
  const status: ClipperGoLiveAutopilotRunStatus = totals.failed > 0
    ? totals.completed > 0 ? "partial" : "blocked"
    : totals.completed > 0
      ? "completed"
      : "blocked";
  const nextBrief = (await prepareClipperGoLiveAutopilotBrief(userId)).goLiveAutopilotBrief;
  const completedActionIds = Array.from(new Set([
    ...previousRun.completedActionIds,
    ...items.filter((item) => item.status === "completed" && item.actionId !== "none").map((item) => item.actionId),
  ])).slice(-100);
  const goLiveAutopilotRun: ClipperGoLiveAutopilotRunSummary = {
    status,
    generatedAt: new Date().toISOString(),
    manifestPath: GO_LIVE_AUTOPILOT_RUN_PATH,
    markdownPath: GO_LIVE_AUTOPILOT_RUN_MARKDOWN_PATH,
    requestedActionId,
    maxActions,
    completedActionIds,
    items,
    totals,
    nextStep: nextBrief.nextStep,
  };
  await writeFile(GO_LIVE_AUTOPILOT_RUN_PATH, JSON.stringify(goLiveAutopilotRun, null, 2));
  await writeFile(GO_LIVE_AUTOPILOT_RUN_MARKDOWN_PATH, renderGoLiveAutopilotRunMarkdown(goLiveAutopilotRun));
  return { goLiveAutopilotRun, goLiveAutopilotBrief: nextBrief, status: await getClipperStatus(userId) };
}

async function writeLaunchCommandCenterManifest(summary: ClipperLaunchCommandCenterSummary) {
  const generatedAt = new Date().toISOString();
  const manifest: ClipperLaunchCommandCenterSummary = { ...summary, generatedAt };
  await writeFile(LAUNCH_COMMAND_CENTER_PATH, JSON.stringify(manifest, null, 2));
  await writeFile(LAUNCH_COMMAND_CENTER_MARKDOWN_PATH, renderLaunchCommandCenterMarkdown(manifest));
  return manifest;
}

export async function prepareClipperLaunchCommandCenter(userId = getSystemUserId(), scheduleInput: unknown = {}): Promise<{ commandCenter: ClipperLaunchCommandCenterSummary; status: ClipperStatus }> {
  await bootstrapClipperAccounts(userId);
  await bootstrapClipperWorkspace(userId);
  await prepareClipperCredentialSetupCenter(userId);
  await prepareClipperCredentialDoctor(userId);
  await prepareClipperAccountEvidenceVault(userId);
  await prepareClipperDeveloperAppEvidenceVault(userId);
  await prepareClipperPermissionPack(userId);
  await prepareClipperAccountIdentityKit(userId);
  await prepareClipperAccountLaunchKit(userId);
  await prepareClipperAccountCreationPack(userId);
  await prepareClipperPermissionTracker(userId);
  await prepareClipperPermissionRequestPack(userId);
  await prepareClipperPlatformReadinessMatrix(userId);
  await prepareClipperExternalSetupQueue(userId);
  await prepareClipperExternalLaunchDossier(userId);
  await prepareClipperOfficialPermissionMatrix(userId);
  await prepareClipperProductionUrlSetup(userId);
  await prepareClipperHttpsTunnelPlan(userId);
  await prepareClipperLegalPolicyPack(userId);
  await prepareClipperAppReviewDemoPack(userId);
  await prepareClipperAppReviewSubmissionPack(userId);
  await prepareClipperDeveloperApplicationDrafts(userId);
  await prepareClipperPublisherConnectors(userId);
  await prepareClipperOAuthGoLivePreflight(userId);
  await prepareClipperOAuthConnectionPack(userId);
  await prepareClipperDriveWorkspace(userId);
  await prepareClipperIntakeKit(userId);
  await prepareClipperProductionQueue(userId);
  await prepareClipperSourceAcquisitionPlan(userId);
  await prepareClipperViralDiscoveryPack({}, userId);
  await prepareClipperSourceHuntSheet({}, userId);
  await prepareClipperRightsOutreachPack(userId);
  await prepareClipperManualPostingPack(userId);
  await prepareClipperPublishingPackage(userId);
  await prepareClipperGoLiveExecutionPack(userId);
  await prepareClipperPlatformPortalChecklist(userId);
  await ingestClipperTrends(userId);
  await prepareClipperTrendRightsOutreachPack(userId);
  await ingestClipperMetrics(userId);
  await prepareClipperAutomationSchedule(scheduleInput, userId);

  const statusBeforeManifest = await getClipperStatus(userId);
  const commandCenter = await writeLaunchCommandCenterManifest(statusBeforeManifest.commandCenter);
  await prepareClipperBlockerResolutionPack(userId);
  await prepareClipperGoLiveAutopilotBrief(userId);
  await prepareClipperExternalExecutionHandoff(userId);
  const status = await getClipperStatus(userId);
  return { commandCenter, status: { ...status, commandCenter } };
}

async function getLatestReport(): Promise<ClipperReport | null> {
  await ensureClipperDirs();
  const files = await readdir(REPORTS_DIR).catch(() => []);
  const reports = files.filter((file) => file.endsWith(".json")).sort().reverse();
  if (!reports[0]) return null;
  try {
    const raw = await readFile(path.join(REPORTS_DIR, reports[0]), "utf8");
    return JSON.parse(raw) as ClipperReport;
  } catch {
    return null;
  }
}

export async function getClipperStatus(userId = getSystemUserId()): Promise<ClipperStatus> {
  await writeDefaultConfigIfMissing();
  await writeWorkspaceReadme();
  const config = await readConfig();
  const oauthConnections = await readOAuthConnections();
  const tokenRecords = await readTokenVaultRecords();
  const accounts = applyOAuthStateToAccounts(
    (Array.isArray(config.accounts) && config.accounts.length ? config.accounts : DEFAULT_ACCOUNTS).map(ensureAccountShape),
    oauthConnections,
    tokenRecords
  );
  const sources = Array.isArray(config.sources) && config.sources.length ? config.sources : DEFAULT_SOURCES;
  const dailyClipsTarget = accounts.reduce((sum, account) => sum + account.dailyClipTarget, 0);
  const weeklyViewsPerAccount = 1_000_000;
  const credentialChecks = buildCredentialChecks();
  const tokenVault = await buildTokenVaultSummary();
  const credentialSetup = await buildCredentialSetupSummary();
  const credentialDoctor = await buildCredentialDoctorSummary();
  const permissionPack = await buildPermissionPackSummary();
  const productionQueue = await buildProductionQueueSummary(accounts);
  const sourceAcquisition = await buildSourceAcquisitionSummary(accounts, productionQueue);
  const sourceHunt = await readLatestSourceHuntSummary() || buildSourceHuntSummary(productionQueue, new Date().toISOString().slice(0, 10));
  const rightsOutreach = await buildRightsOutreachSummary(sourceHunt);
  const draftSpecs = await buildDraftSpecsSummary(productionQueue);
  const automation = await buildAutomationSummary();
  const automationSchedule = await buildAutomationScheduleSummary(accounts);
  const driveWorkspace = await buildDriveWorkspaceSummary();
  const metrics = await buildMetricsSummary(accounts);
  const trendRadar = await buildTrendRadarSummary();
  const trendRightsOutreach = await buildTrendRightsOutreachSummary(trendRadar);
  const viralDiscovery = await buildViralDiscoverySummary();
  const intakeKit = await buildIntakeKitSummary();
  const budgetPlanner = buildBudgetPlanner(accounts);
  const accountEvidence = await buildAccountEvidenceSummary(accounts);
  const developerAppEvidence = await buildDeveloperAppEvidenceSummary();
  const accountIdentityKit = await buildAccountIdentityKitSummary(accounts);
  const accountLaunchKit = await buildAccountLaunchKitSummary(accounts, accountEvidence);
  const accountCreationPack = await buildAccountCreationPackSummary({ accountIdentityKit, accountLaunchKit });
  const manualPostingPack = await buildManualPostingPackSummary(productionQueue, accountLaunchKit);
  const permissionTracker = await buildPermissionTrackerSummary({ accounts, credentialChecks, tokenRecords, oauthConnections, permissionPack, accountLaunchKit });
  const permissionRequestPack = await buildPermissionRequestPackSummary(permissionTracker);
  const platformReadiness = await buildPlatformReadinessSummary({ credentialChecks, tokenRecords, accountLaunchKit, developerAppEvidence, permissionTracker });
  const connectActions = buildClipperConnectActions();
  const externalSetupQueue = await buildExternalSetupQueueSummary({ accountLaunchKit, developerAppEvidence, permissionTracker, credentialChecks, connectActions, tokenRecords });
  const officialPermissionMatrix = await buildOfficialPermissionMatrixSummary();
  const publisherConnectors = await buildPublisherConnectorSummary({ tokenRecords, permissionTracker, platformReadiness, productionQueue });
  const productionUrlSetup = await buildProductionUrlSetupSummary();
  const productionUrlVerification = await buildProductionUrlVerificationSummary(productionUrlSetup);
  const httpsTunnelPlan = await buildHttpsTunnelPlanSummary();
  const legalPolicyPack = await buildLegalPolicyPackSummary();
  const appReviewDemoPack = await buildAppReviewDemoPackSummary();
  const appReviewSubmissionPack = await buildAppReviewSubmissionPackSummary({ accounts, officialPermissionMatrix, productionUrlSetup, developerAppEvidence, legalPolicyPack, appReviewDemoPack });
  const developerApplicationDrafts = await buildDeveloperApplicationDraftsSummary({ officialPermissionMatrix, appReviewSubmissionPack, legalPolicyPack, appReviewDemoPack, productionUrlSetup });
  const tokenExchanges = buildClipperTokenExchanges(oauthConnections, tokenRecords);
  const oauthGoLive = await buildOAuthGoLiveSummary({ credentialChecks, connectActions, tokenVault, tokenExchanges, tokenRecords, developerAppEvidence, permissionTracker, publisherConnectors });
  const oauthConnectionPack = await buildOAuthConnectionPackSummary({ accounts, connectActions, tokenVault, tokenRecords, accountEvidence, developerAppEvidence, permissionTracker });
  const externalLaunchDossier = await buildExternalLaunchDossierSummary({ accountLaunchKit, developerAppEvidence, permissionTracker, credentialSetup, externalSetupQueue, oauthGoLive, publisherConnectors, officialPermissionMatrix });
  const goLiveExecutionPack = await buildGoLiveExecutionPackSummary({ accountLaunchKit, developerAppEvidence, credentialSetup, permissionTracker, productionUrlSetup, oauthGoLive, publisherConnectors, appReviewSubmissionPack, manualPostingPack });
  const platformPortalChecklist = await buildPlatformPortalChecklistSummary({ externalSetupQueue, externalLaunchDossier, goLiveExecutionPack, officialPermissionMatrix, publisherConnectors });
  const publishingPackage = await buildPublishingPackageSummary(accounts);
  const growthAudit = buildGrowthAudit({ accounts, credentialChecks, tokenVault, permissionPack, productionQueue, sourceAcquisition, automation, automationSchedule, manualPostingPack, publishingPackage, goLiveExecutionPack, httpsTunnelPlan, legalPolicyPack, appReviewDemoPack, developerApplicationDrafts, accountCreationPack, permissionRequestPack, oauthConnectionPack, driveWorkspace, metrics, trendRadar, accountEvidence, developerAppEvidence, accountIdentityKit, accountLaunchKit, permissionTracker });
  const commandCenter = await buildLaunchCommandCenterSummary({ accounts, credentialChecks, tokenVault, credentialSetup, credentialDoctor, platformReadiness, permissionPack, productionQueue, sourceAcquisition, sourceHunt, rightsOutreach, draftSpecs, manualPostingPack, publishingPackage, automation, automationSchedule, driveWorkspace, metrics, trendRadar, trendRightsOutreach, intakeKit, accountEvidence, developerAppEvidence, accountIdentityKit, accountLaunchKit, accountCreationPack, permissionTracker, permissionRequestPack, oauthConnectionPack, externalSetupQueue, externalLaunchDossier, platformPortalChecklist, appReviewSubmissionPack, appReviewDemoPack, developerApplicationDrafts, officialPermissionMatrix, publisherConnectors, productionUrlSetup, productionUrlVerification, httpsTunnelPlan, legalPolicyPack, oauthGoLive, goLiveExecutionPack });
  const blockerResolutionPack = await buildBlockerResolutionPackSummary({ commandCenter, growthAudit });
  const goLiveAutopilotBrief = await buildGoLiveAutopilotBriefSummary({ blockerResolutionPack, externalLaunchDossier, goLiveExecutionPack, driveWorkspace, viralDiscovery, trendRightsOutreach });
  const goLiveAutopilotRun = await buildGoLiveAutopilotRunSummary();
  const externalExecutionHandoff = await buildExternalExecutionHandoffSummary({ externalSetupQueue, goLiveAutopilotBrief });
  const externalExecutionSession = await buildExternalExecutionSessionSummary({ externalExecutionHandoff });

  return {
    rootDir: ROOT_DIR,
    reportsDir: REPORTS_DIR,
    sourceRootDir: SOURCES_DIR,
    accounts,
    sources,
    sourceFolders: SOURCE_FOLDERS,
    credentialChecks,
    connectActions,
    oauthConnections,
    tokenVault,
    tokenExchanges,
    credentialSetup,
    credentialDoctor,
    platformReadiness,
    permissionPack,
    productionQueue,
    sourceAcquisition,
    sourceHunt,
    rightsOutreach,
    draftSpecs,
    manualPostingPack,
    publishingPackage,
    automation,
    automationSchedule,
    driveWorkspace,
    metrics,
    trendRadar,
    trendRightsOutreach,
    viralDiscovery,
    intakeKit,
    budgetPlanner,
    accountIdentityKit,
    accountLaunchKit,
    accountCreationPack,
    accountEvidence,
    developerAppEvidence,
    permissionTracker,
    permissionRequestPack,
    externalSetupQueue,
    externalExecutionHandoff,
    externalExecutionSession,
    externalLaunchDossier,
    platformPortalChecklist,
    appReviewSubmissionPack,
    appReviewDemoPack,
    developerApplicationDrafts,
    officialPermissionMatrix,
    publisherConnectors,
    productionUrlSetup,
    productionUrlVerification,
    httpsTunnelPlan,
    legalPolicyPack,
    oauthGoLive,
    oauthConnectionPack,
    goLiveExecutionPack,
    commandCenter,
    blockerResolutionPack,
    goLiveAutopilotBrief,
    goLiveAutopilotRun,
    growthAudit,
    platformRequirements: PLATFORM_REQUIREMENTS,
    permissionQueue: PERMISSION_QUEUE,
    agents: DEFAULT_AGENTS,
    pipeline: buildPipeline(accounts),
    goals: {
      weeklyViewsPerAccount,
      totalWeeklyGoal: accounts.length * weeklyViewsPerAccount,
      dailyClipsTarget,
      connectedAccounts: accounts.filter((account) => account.status === "ready").length,
    },
    latestReport: await getLatestReport(),
    guardrails: [
      "Publicar solo contenido propio, licenciado, permitido por el creador o disponible desde una fuente oficial.",
      "Las cuentas nuevas empiezan con aprobacion manual hasta validar calidad, permisos y riesgo de strikes.",
      "El optimizador puede cambiar hooks, horarios y volumen; no debe evadir derechos, marcas de agua o reglas de plataforma.",
      "La app puede preparar cuentas internas y checklists, pero crear cuentas reales requiere login, verificacion y aceptacion de terminos en cada plataforma.",
    ],
  };
}

export async function recordClipperOAuthCallback(input: {
  platform: unknown;
  code?: unknown;
  state?: unknown;
  error?: unknown;
}): Promise<ClipperOAuthConnection> {
  if (input.platform !== "tiktok" && input.platform !== "instagram" && input.platform !== "youtube") {
    throw new Error("Plataforma no soportada.");
  }

  const platform = input.platform;
  const code = typeof input.code === "string" ? input.code : "";
  const error = typeof input.error === "string" ? input.error : null;
  const accountId = accountIdFromOAuthState(platform, input.state);
  const tokenResult = code && !error ? await tryExchangeAndStoreClipperToken(platform, code, accountId) : null;
  const connection: ClipperOAuthConnection = {
    platform,
    accountId,
    status: error ? "error" : code ? "code_received" : "pending",
    receivedAt: new Date().toISOString(),
    scopes: PLATFORM_SCOPES[platform],
    state: typeof input.state === "string" ? input.state : null,
    codeHash: code ? hashOAuthCode(code) : null,
    error,
    note: error
      ? "La plataforma devolvio error durante OAuth."
      : code
        ? `Authorization code recibido${accountId ? ` para ${accountId}` : ""} y resumido con hash; no se guardo el code plaintext.`
        : "Callback recibido sin authorization code.",
    tokenStatus: tokenResult?.status,
    tokenNote: tokenResult?.note,
  };

  const previous = await readOAuthConnections();
  const next = [
    connection,
    ...previous.filter((item) => !(item.platform === platform && (item.accountId || null) === (accountId || null))),
  ].slice(0, 12);
  await writeOAuthConnections(next);
  return connection;
}

export async function bootstrapClipperAccounts(userId = getSystemUserId()): Promise<ClipperStatus> {
  await ensureClipperDirs();
  await writeWorkspaceReadme();
  const config = await readConfig();
  const accounts = (Array.isArray(config.accounts) && config.accounts.length ? config.accounts : DEFAULT_ACCOUNTS).map(ensureAccountShape);
  const sources = Array.isArray(config.sources) && config.sources.length ? config.sources : DEFAULT_SOURCES;
  await writeFile(CONFIG_PATH, JSON.stringify({ ...config, accounts, sources }, null, 2));
  return getClipperStatus(userId);
}

export async function bootstrapClipperWorkspace(userId = getSystemUserId()): Promise<ClipperStatus> {
  await bootstrapClipperAccounts(userId);
  return getClipperStatus(userId);
}

export async function prepareClipperPermissionPack(userId = getSystemUserId()): Promise<{ pack: ClipperPermissionPack; status: ClipperStatus }> {
  await writeDefaultConfigIfMissing();
  await ensureClipperDirs();
  const config = await readConfig();
  const accounts = (Array.isArray(config.accounts) && config.accounts.length ? config.accounts : DEFAULT_ACCOUNTS).map(ensureAccountShape);

  await Promise.all([
    writeFile(getPermissionPackFilePath("README.md"), renderPermissionReadme(accounts)),
    writeFile(getPermissionPackFilePath("account-creation-checklist.md"), renderAccountCreationChecklist(accounts)),
    writeFile(getPermissionPackFilePath("redirect-uris.json"), JSON.stringify(buildRedirectUriManifest(), null, 2)),
    writeFile(getPermissionPackFilePath("oauth-env-template.env"), renderEnvTemplate()),
    writeFile(getPermissionPackFilePath("tiktok-content-posting-api.md"), renderPlatformReviewDoc("tiktok", accounts)),
    writeFile(getPermissionPackFilePath("instagram-graph-api.md"), renderPlatformReviewDoc("instagram", accounts)),
    writeFile(getPermissionPackFilePath("youtube-data-api.md"), renderPlatformReviewDoc("youtube", accounts)),
  ]);

  const permissionPack = await buildPermissionPackSummary();
  return {
    pack: {
      generatedAt: new Date().toISOString(),
      rootDir: PERMISSION_PACK_DIR,
      files: permissionPack.files,
    },
    status: await getClipperStatus(userId),
  };
}

export async function prepareClipperProductionQueue(userId = getSystemUserId()): Promise<{ queue: ClipperProductionQueueSummary; status: ClipperStatus }> {
  await writeDefaultConfigIfMissing();
  await ensureClipperDirs();
  const config = await readConfig();
  const accounts = (Array.isArray(config.accounts) && config.accounts.length ? config.accounts : DEFAULT_ACCOUNTS).map(ensureAccountShape);
  const assets = await listSourceAssets();
  const items = buildProductionQueueItems(accounts, assets);
  const readyCount = items.filter((item) => item.status === "draft_ready").length;
  const reviewCount = items.filter((item) => item.status === "rights_review").length;
  const id = new Date().toISOString().replace(/[:.]/g, "-");
  const queuePath = path.join(DRAFTS_DIR, `production-queue-${id}.json`);
  const queue: ClipperProductionQueueSummary = {
    status: assets.length === 0 ? "needs_sources" : readyCount > 0 ? "ready" : reviewCount > 0 ? "needs_rights" : "empty",
    queuePath,
    generatedAt: new Date().toISOString(),
    sourceAssets: assets,
    items,
    nextStep: readyCount > 0
      ? "Revisar drafts listos, renderizar videos verticales y mantener approval_required hasta conectar cuentas."
      : assets.length > 0
        ? "Agregar evidencia en allowlist para desbloquear derechos antes de producir drafts."
        : "Agregar videos fuente por categoria para producir drafts reales.",
  };
  await writeFile(queuePath, JSON.stringify(queue, null, 2));
  return { queue, status: await getClipperStatus(userId) };
}

function sourceDropCategoryFromPath(filePath: string): ClipperAccountCategory | null {
  const relative = path.relative(SOURCE_DROP_DIR, filePath).split(path.sep);
  const category = relative[0];
  return category === "sports" || category === "memes" || category === "streamers" ? category : null;
}

async function listSourceDropVideoFiles(): Promise<string[]> {
  await ensureClipperDirs();
  const categories: ClipperAccountCategory[] = ["sports", "memes", "streamers"];
  const files: string[] = [];
  for (const category of categories) {
    const dir = path.join(SOURCE_DROP_DIR, category);
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (!VIDEO_EXTENSIONS.has(ext)) continue;
      files.push(path.join(dir, entry.name));
    }
  }
  return files.sort();
}

async function uniqueSourceTargetPath(category: ClipperAccountCategory, fileName: string): Promise<{ targetPath: string; fileName: string }> {
  const sourceFolder = getSourceFolderForCategory(category);
  const parsed = path.parse(safeSourceFileName(fileName, `${category}-source`));
  let candidateName = `${parsed.name}${parsed.ext}`;
  let candidatePath = path.join(sourceFolder, candidateName);
  let counter = 2;
  while (await stat(candidatePath).then((file) => file.isFile()).catch(() => false)) {
    candidateName = `${parsed.name}-${counter}${parsed.ext}`;
    candidatePath = path.join(sourceFolder, candidateName);
    counter += 1;
  }
  return { targetPath: candidatePath, fileName: candidateName };
}

export async function importClipperSourceDropFiles(userId = getSystemUserId()): Promise<{ sourceDropImport: ClipperSourceDropImportSummary; status: ClipperStatus }> {
  await writeDefaultConfigIfMissing();
  await ensureClipperDirs();
  const files = await listSourceDropVideoFiles();
  const items: ClipperSourceDropImportItem[] = [];
  for (const sourcePath of files) {
    const category = sourceDropCategoryFromPath(sourcePath);
    if (!category) {
      items.push({
        sourcePath,
        targetPath: "",
        category: "memes",
        fileName: path.basename(sourcePath),
        status: "skipped",
        rightsStatus: "review_required",
        reason: "Categoria no soportada; usa sports, memes o streamers.",
      });
      continue;
    }
    const { targetPath, fileName } = await uniqueSourceTargetPath(category, path.basename(sourcePath));
    await copyFile(sourcePath, targetPath);
    const evidencePath = await findRightsEvidence(targetPath);
    items.push({
      sourcePath,
      targetPath,
      category,
      fileName,
      status: "imported",
      rightsStatus: evidencePath ? "owned_or_permissioned" : "review_required",
      reason: evidencePath ? null : "Importado; falta evidencia en allowlist para desbloquear derechos.",
    });
  }

  const queueResult = await prepareClipperProductionQueue(userId);
  const imported = items.filter((item) => item.status === "imported").length;
  const skipped = items.filter((item) => item.status === "skipped").length;
  const sourceDropImport: ClipperSourceDropImportSummary = {
    importedAt: new Date().toISOString(),
    dropDir: SOURCE_DROP_DIR,
    filesScanned: files.length,
    imported,
    skipped,
    items,
    queue: queueResult.queue,
    nextStep: imported > 0
      ? "Source drop importado; agrega evidencia en allowlist o Launch evidence batch para pasar assets a draft_ready."
      : `Coloca videos reales en ${SOURCE_DROP_DIR}/sports, memes o streamers y vuelve a importar.`,
  };
  return { sourceDropImport, status: queueResult.status };
}

export async function prepareClipperSourceAcquisitionPlan(userId = getSystemUserId()): Promise<{ sourceAcquisition: ClipperSourceAcquisitionSummary; status: ClipperStatus }> {
  await writeDefaultConfigIfMissing();
  await ensureClipperDirs();
  const config = await readConfig();
  const accounts = (Array.isArray(config.accounts) && config.accounts.length ? config.accounts : DEFAULT_ACCOUNTS).map(ensureAccountShape);
  const queue = await buildProductionQueueSummary(accounts);
  const currentSummary = await buildSourceAcquisitionSummary(accounts, queue);
  const sourceAcquisition: ClipperSourceAcquisitionSummary = {
    ...currentSummary,
    generatedAt: new Date().toISOString(),
  };
  await writeFile(SOURCE_ACQUISITION_PLAN_PATH, JSON.stringify(sourceAcquisition, null, 2));
  await writeFile(SOURCE_ACQUISITION_PLAN_MARKDOWN_PATH, renderSourceAcquisitionMarkdown(sourceAcquisition));
  return { sourceAcquisition, status: await getClipperStatus(userId) };
}

export async function prepareClipperSourceHuntSheet(input: unknown = {}, userId = getSystemUserId()): Promise<{ sourceHunt: ClipperSourceHuntSummary; status: ClipperStatus }> {
  await writeDefaultConfigIfMissing();
  await ensureClipperDirs();
  const requestedDate = typeof (input as { huntDate?: unknown })?.huntDate === "string" ? String((input as { huntDate?: string }).huntDate) : "";
  const huntDate = /^\d{4}-\d{2}-\d{2}$/.test(requestedDate) ? requestedDate : new Date().toISOString().slice(0, 10);
  const config = await readConfig();
  const accounts = (Array.isArray(config.accounts) && config.accounts.length ? config.accounts : DEFAULT_ACCOUNTS).map(ensureAccountShape);
  const queue = await buildProductionQueueSummary(accounts);
  const sourceHunt: ClipperSourceHuntSummary = {
    ...buildSourceHuntSummary(queue, huntDate),
    generatedAt: new Date().toISOString(),
  };
  await writeFile(sourceHunt.manifestPath, JSON.stringify(sourceHunt, null, 2));
  await writeFile(sourceHunt.csvPath, renderSourceHuntCsv(sourceHunt));
  await writeFile(sourceHunt.markdownPath, renderSourceHuntMarkdown(sourceHunt));
  return { sourceHunt, status: await getClipperStatus(userId) };
}

export async function recordClipperSourceRights(input: {
  assetId?: unknown;
  rightsStatus?: unknown;
  notes?: unknown;
}, userId = getSystemUserId()): Promise<{ sourceRights: ClipperSourceRightsRecord; queue: ClipperProductionQueueSummary; status: ClipperStatus }> {
  await writeDefaultConfigIfMissing();
  await ensureClipperDirs();
  const assetId = typeof input.assetId === "string" ? input.assetId.trim() : "";
  const assets = await listSourceAssets();
  const asset = assets.find((item) => item.id === assetId);
  if (!asset) throw new Error("Source asset no encontrado en las carpetas de Clippers.");
  const rightsStatus: ClipperAssetRightsStatus = input.rightsStatus === "review_required" ? "review_required" : "owned_or_permissioned";
  const notes = typeof input.notes === "string" && input.notes.trim()
    ? input.notes.trim()
    : "Registrado desde Clippers UI; permiso/ownership confirmado sin guardar datos sensibles.";
  const record: ClipperSourceRightsRecord = {
    assetId: asset.id,
    category: asset.category,
    fileName: asset.fileName,
    sourcePath: asset.path,
    rightsStatus,
    evidencePath: sourceRightsEvidencePath(asset),
    notes,
    recordedAt: new Date().toISOString(),
    source: "clippers-ui",
  };
  await writeFile(record.evidencePath, renderSourceRightsEvidence(record));
  const queueResult = await prepareClipperProductionQueue(userId);
  return { sourceRights: record, queue: queueResult.queue, status: queueResult.status };
}

export async function prepareClipperDraftSpecs(userId = getSystemUserId()): Promise<{ draftSpecs: ClipperDraftSpecSummary; status: ClipperStatus }> {
  await writeDefaultConfigIfMissing();
  await ensureClipperDirs();
  const queueResult = await prepareClipperProductionQueue(userId);
  const queue = queueResult.queue;
  const assetsByPath = new Map(queue.sourceAssets.map((asset) => [asset.path, asset]));
  const batchId = new Date().toISOString().replace(/[:.]/g, "-");
  const readyItems = queue.items.filter((item) => item.status === "draft_ready" && item.sourcePath);
  const items: ClipperDraftSpecItem[] = [];

  for (const item of readyItems) {
    const asset = item.sourcePath ? assetsByPath.get(item.sourcePath) : null;
    const id = draftSpecId(item);
    const draftPath = path.join(DRAFTS_DIR, `draft-spec-${batchId}-${id}.json`);
    const markdownPath = path.join(DRAFTS_DIR, `draft-spec-${batchId}-${id}.md`);
    const spec: ClipperDraftSpecItem = {
      id,
      queueItemId: item.id,
      accountId: item.accountId,
      accountName: item.accountName,
      category: item.category,
      slotNumber: item.slotNumber,
      variantAngle: item.variantAngle,
      clipObjective: item.clipObjective,
      sourcePath: item.sourcePath || "",
      evidencePath: asset?.evidencePath || null,
      draftPath,
      markdownPath,
      hook: item.hook,
      captionSeed: `${item.hook}. #clips #shorts`,
      format: item.format,
      publishWindow: item.publishWindow,
      platforms: item.platforms,
      status: "ready_for_edit",
      qaChecklist: [
        "Confirmar que source y evidencia siguen vigentes.",
        "Crear corte vertical 9:16 sin marcas de agua no permitidas.",
        "Agregar captions legibles, hook en primeros 2 segundos y cierre en loop.",
        "Revisar audio, copyright, claims y reglas de plataforma antes de publicar.",
        "Mantener approval_required hasta que OAuth/tokens y metricas esten listos.",
      ],
      createdAt: new Date().toISOString(),
    };
    await writeFile(draftPath, JSON.stringify(spec, null, 2));
    await writeFile(markdownPath, renderDraftSpecMarkdown(spec));
    items.push(spec);
  }

  const blockedQueueItems = queue.items.filter((item) => item.status !== "draft_ready").length;
  const draftSpecs: ClipperDraftSpecSummary = {
    status: items.length > 0 ? "ready" : blockedQueueItems > 0 ? "blocked" : "empty",
    generatedAt: new Date().toISOString(),
    draftsDir: DRAFTS_DIR,
    manifestPath: DRAFT_SPECS_MANIFEST_PATH,
    items,
    totals: { items: items.length, readyForEdit: items.length, blockedQueueItems },
    nextStep: items.length > 0
      ? "Abrir los draft specs, renderizar clips verticales y mantener approval_required antes de publicar."
      : queue.nextStep,
  };
  await writeFile(DRAFT_SPECS_MANIFEST_PATH, JSON.stringify(draftSpecs, null, 2));
  return { draftSpecs, status: await getClipperStatus(userId) };
}

function clipperRenderNumber(input: unknown, keys: string[], fallback: number, min: number, max: number): number {
  const raw = input && typeof input === "object" ? firstString(input as Record<string, unknown>, keys) : "";
  const value = Number(raw || fallback);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function runFfmpeg(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk.toString(); });
    child.stderr.on("data", (chunk) => { output += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(output);
      else reject(new Error(output || `ffmpeg exited with code ${code}`));
    });
  });
}

async function renderClipperDraftSpec(spec: ClipperDraftSpecItem, input: {
  batchId: string;
  durationSeconds: number;
}): Promise<ClipperRenderedClipItem> {
  const outputPath = path.join(RENDERED_DIR, `${input.batchId}-${spec.id}.mp4`);
  const filter = [
    "scale=1080:1920:force_original_aspect_ratio=increase",
    "crop=1080:1920",
    "setsar=1",
  ].join(",");

  try {
    await runFfmpeg([
      "-y",
      "-i", spec.sourcePath,
      "-t", String(input.durationSeconds),
      "-vf", filter,
      "-map", "0:v:0",
      "-map", "0:a?",
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-crf", "23",
      "-c:a", "aac",
      "-shortest",
      "-movflags", "+faststart",
      outputPath,
    ]);
    return {
      id: hashId(outputPath),
      draftSpecId: spec.id,
      accountId: spec.accountId,
      accountName: spec.accountName,
      category: spec.category,
      sourcePath: spec.sourcePath,
      outputPath,
      hook: spec.hook,
      captionSeed: spec.captionSeed,
      platforms: spec.platforms,
      durationSeconds: input.durationSeconds,
      status: "rendered",
      error: null,
      nextStep: "Revisar MP4, audio/captions/derechos y moverlo a manual posting o upload approval.",
    };
  } catch (error) {
    return {
      id: hashId(outputPath),
      draftSpecId: spec.id,
      accountId: spec.accountId,
      accountName: spec.accountName,
      category: spec.category,
      sourcePath: spec.sourcePath,
      outputPath,
      hook: spec.hook,
      captionSeed: spec.captionSeed,
      platforms: spec.platforms,
      durationSeconds: input.durationSeconds,
      status: "failed",
      error: error instanceof Error ? error.message.slice(0, 2000) : String(error).slice(0, 2000),
      nextStep: "Revisar source video/ffmpeg y volver a renderizar.",
    };
  }
}

export async function renderClipperDraftVideos(input: unknown = {}, userId = getSystemUserId()): Promise<{ renderedClips: ClipperRenderedClipSummary; status: ClipperStatus }> {
  await writeDefaultConfigIfMissing();
  await ensureClipperDirs();
  const durationSeconds = clipperRenderNumber(input, ["duration_seconds", "durationSeconds", "target_seconds", "targetSeconds"], 12, 3, 60);
  const maxClips = clipperRenderNumber(input, ["max_clips", "maxClips", "limit"], 10, 1, 100);
  const draftResult = await prepareClipperDraftSpecs(userId);
  const availableDraftSpecs = draftResult.draftSpecs.items.length;
  const selectedSpecs = draftResult.draftSpecs.items.slice(0, maxClips);
  const batchId = new Date().toISOString().replace(/[:.]/g, "-");
  const items: ClipperRenderedClipItem[] = [];

  for (const spec of selectedSpecs) {
    items.push(await renderClipperDraftSpec(spec, { batchId, durationSeconds }));
  }

  const rendered = items.filter((item) => item.status === "rendered").length;
  const failed = items.filter((item) => item.status === "failed").length;
  const renderedClips: ClipperRenderedClipSummary = {
    status: rendered === 0 ? "blocked" : failed > 0 ? "partial" : "ready",
    generatedAt: new Date().toISOString(),
    outputDir: RENDERED_DIR,
    manifestPath: RENDERED_CLIPS_MANIFEST_PATH,
    items,
    totals: {
      attempted: items.length,
      rendered,
      failed,
      availableDraftSpecs,
    },
    nextStep: rendered > 0
      ? "Revisar clips renderizados, confirmar QA y usarlos en Manual Posting Pack hasta conectar autopost."
      : availableDraftSpecs > 0
        ? "Revisar errores de ffmpeg/source y volver a renderizar."
        : "Agregar sources con derechos OK para generar draft specs y renderizar clips.",
  };
  await writeFile(RENDERED_CLIPS_MANIFEST_PATH, JSON.stringify(renderedClips, null, 2));
  return { renderedClips, status: await getClipperStatus(userId) };
}

async function readRenderedClipsSummary(): Promise<ClipperRenderedClipSummary | null> {
  try {
    const raw = await readFile(RENDERED_CLIPS_MANIFEST_PATH, "utf8");
    const parsed = JSON.parse(raw) as ClipperRenderedClipSummary;
    return parsed && Array.isArray(parsed.items) ? parsed : null;
  } catch {
    return null;
  }
}

function buildPublishingPackageItems(
  renderedClips: ClipperRenderedClipSummary | null,
  accountLaunchKit: ClipperAccountLaunchKitSummary
): ClipperPublishingPackageItem[] {
  const tasksByAccountPlatform = new Map(
    accountLaunchKit.tasks.map((task) => [`${task.accountId}:${task.platform}`, task])
  );
  return (renderedClips?.items || [])
    .filter((clip) => clip.status === "rendered")
    .flatMap((clip) => {
      const platforms = (clip.platforms.length ? clip.platforms : ["TikTok", "Instagram Reels", "YouTube Shorts"])
        .map(normalizePlatformLabel)
        .filter((platform): platform is ClipperPlatform => Boolean(platform));
      return platforms.map((platform) => {
        const task = tasksByAccountPlatform.get(`${clip.accountId}:${platform}`);
        const accountReady = task?.evidenceStatus === "verified";
        const status: ClipperPublishingPackageItem["status"] = !clip.outputPath
          ? "needs_rendered_clip"
          : accountReady
            ? "ready_for_manual"
            : "needs_account";
        const blocker = status === "needs_account"
          ? "Falta evidencia de cuenta real verificada para esta plataforma."
          : status === "needs_rendered_clip"
            ? "Falta MP4 renderizado."
            : null;
        return {
          id: hashId(`${clip.id}-${platform}-publish`),
          renderedClipId: clip.id,
          accountId: clip.accountId,
          accountName: clip.accountName,
          platform,
          handle: task?.handle || `@${clip.accountId}-${platform}`,
          status,
          videoPath: clip.outputPath,
          caption: clip.captionSeed,
          hook: clip.hook,
          checklist: [
            "Abrir el MP4 y confirmar que reproduce completo en vertical 9:16.",
            "Confirmar que source/allowlist/evidencia siguen vigentes.",
            "Subir en la cuenta y plataforma indicadas, manteniendo approval_required.",
            "Guardar URL del post y exportar metricas a clippers_workspace/metrics despues de 24h.",
          ],
          blocker,
          nextStep: status === "ready_for_manual"
            ? "Subir manualmente este MP4, guardar URL del post y medir."
            : status === "needs_account"
              ? "Crear/verificar cuenta externa y registrar Account Evidence antes de subir."
              : "Renderizar el clip antes de preparar publicacion.",
        };
      });
    });
}

function renderPublishingPackageMarkdown(summary: ClipperPublishingPackageSummary): string {
  return [
    "# Clippers Publishing Package",
    "",
    `Status: ${summary.status}`,
    `Generated: ${summary.generatedAt}`,
    `Next step: ${summary.nextStep}`,
    "",
    "## Totals",
    "",
    `- Items: ${summary.totals.items}`,
    `- Ready for manual: ${summary.totals.readyForManual}`,
    `- Needs account: ${summary.totals.needsAccount}`,
    `- Needs rendered clip: ${summary.totals.needsRenderedClip}`,
    "",
    "## Upload Queue",
    "",
    ...summary.items.flatMap((item) => [
      `### ${item.accountName} / ${item.platform} / ${item.handle}`,
      "",
      `- Status: ${item.status}`,
      `- Video: ${item.videoPath}`,
      `- Hook: ${item.hook}`,
      `- Caption: ${item.caption}`,
      item.blocker ? `- Blocker: ${item.blocker}` : null,
      `- Next step: ${item.nextStep}`,
      "",
      "Checklist:",
      ...item.checklist.map((step) => `- [ ] ${step}`),
      "",
    ].filter((line): line is string => Boolean(line))),
  ].join("\n");
}

function renderPublishingPackageCsv(summary: ClipperPublishingPackageSummary): string {
  const headers = ["id", "account_id", "account_name", "platform", "handle", "status", "video_path", "hook", "caption", "blocker", "next_step"];
  const rows = summary.items.map((item) => [
    item.id,
    item.accountId,
    item.accountName,
    item.platform,
    item.handle,
    item.status,
    item.videoPath,
    item.hook,
    item.caption,
    item.blocker,
    item.nextStep,
  ]);
  return [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\n") + "\n";
}

async function buildPublishingPackageSummary(accounts: ClipperAccount[]): Promise<ClipperPublishingPackageSummary> {
  const accountEvidence = await buildAccountEvidenceSummary(accounts);
  const accountLaunchKit = await buildAccountLaunchKitSummary(accounts, accountEvidence);
  const renderedClips = await readRenderedClipsSummary();
  const items = buildPublishingPackageItems(renderedClips, accountLaunchKit);
  const totals = items.reduce<ClipperPublishingPackageSummary["totals"]>((sum, item) => {
    sum.items += 1;
    if (item.status === "ready_for_manual") sum.readyForManual += 1;
    if (item.status === "needs_account") sum.needsAccount += 1;
    if (item.status === "needs_rendered_clip") sum.needsRenderedClip += 1;
    return sum;
  }, { items: 0, readyForManual: 0, needsAccount: 0, needsRenderedClip: 0 });
  const publishingPackage: ClipperPublishingPackageSummary = {
    status: totals.items === 0 || totals.readyForManual === 0 ? "blocked" : totals.readyForManual < totals.items ? "partial" : "ready",
    generatedAt: await stat(PUBLISHING_PACKAGE_PATH).then((file) => file.mtime.toISOString()).catch(() => renderedClips?.generatedAt || new Date().toISOString()),
    manifestPath: PUBLISHING_PACKAGE_PATH,
    markdownPath: PUBLISHING_PACKAGE_MARKDOWN_PATH,
    csvPath: PUBLISHING_PACKAGE_CSV_PATH,
    items,
    totals,
    nextStep: totals.readyForManual > 0
      ? "Subir ready_for_manual, guardar URLs y alimentar metricas para Optimizer."
      : totals.items > 0
        ? "Verificar cuentas externas para convertir rendered clips en publicaciones manuales."
        : "Renderizar clips desde draft specs antes de preparar publishing package.",
  };
  return publishingPackage;
}

export async function prepareClipperPublishingPackage(userId = getSystemUserId()): Promise<{ publishingPackage: ClipperPublishingPackageSummary; status: ClipperStatus }> {
  await writeDefaultConfigIfMissing();
  await ensureClipperDirs();
  const config = await readConfig();
  const accounts = (Array.isArray(config.accounts) && config.accounts.length ? config.accounts : DEFAULT_ACCOUNTS).map(ensureAccountShape);
  const publishingPackage = {
    ...(await buildPublishingPackageSummary(accounts)),
    generatedAt: new Date().toISOString(),
  };
  await Promise.all([
    writeFile(PUBLISHING_PACKAGE_PATH, JSON.stringify(publishingPackage, null, 2)),
    writeFile(PUBLISHING_PACKAGE_MARKDOWN_PATH, renderPublishingPackageMarkdown(publishingPackage)),
    writeFile(PUBLISHING_PACKAGE_CSV_PATH, renderPublishingPackageCsv(publishingPackage)),
  ]);
  return { publishingPackage, status: await getClipperStatus(userId) };
}

export async function runClipperAutomationCycle(input: unknown = {}, userId = getSystemUserId()): Promise<{ automation: ClipperAutomationRun; status: ClipperStatus }> {
  await writeDefaultConfigIfMissing();
  await ensureClipperDirs();
  const options = normalizeRunOptions(input);
  const config = await readConfig();
  const accounts = (Array.isArray(config.accounts) && config.accounts.length ? config.accounts : DEFAULT_ACCOUNTS).map(ensureAccountShape);
  const tokenRecords = await readTokenVaultRecords();
  const assets = await listSourceAssets();
  const queueItems = buildProductionQueueItems(accounts, assets);
  const posts = buildScheduledPosts(queueItems, tokenRecords, options.publishMode);
  const id = new Date().toISOString().replace(/[:.]/g, "-");
  const queuePath = path.join(DRAFTS_DIR, `production-queue-${id}.json`);
  const schedulePath = path.join(SCHEDULED_DIR, `automation-cycle-${id}.json`);
  const reportPath = path.join(REPORTS_DIR, `automation-cycle-${id}.json`);
  const blocked = posts.filter((post) => post.blocker).length;
  const scheduled = posts.filter((post) => post.status === "scheduled").length;
  const readyForManual = posts.filter((post) => post.status === "ready_for_manual").length;
  const draftReady = queueItems.filter((item) => item.status === "draft_ready").length;
  const rightsReview = queueItems.filter((item) => item.status === "rights_review").length;
  const needsSource = queueItems.filter((item) => item.status === "needs_source").length;
  const automation: ClipperAutomationRun = {
    id,
    createdAt: new Date().toISOString(),
    status: blocked === posts.length ? "blocked" : blocked > 0 ? "partial" : "ready",
    publishMode: options.publishMode,
    schedulePath,
    queuePath,
    reportPath,
    totals: {
      posts: posts.length,
      scheduled,
      readyForManual,
      blocked,
      draftReady,
      rightsReview,
      needsSource,
    },
    posts,
    blockers: Array.from(new Set(posts.map((post) => post.blocker).filter((blocker): blocker is string => Boolean(blocker)))),
    recommendations: buildAutomationRecommendations(
      {
        status: assets.length === 0 ? "needs_sources" : draftReady > 0 ? "ready" : rightsReview > 0 ? "needs_rights" : "empty",
        queuePath,
        generatedAt: new Date().toISOString(),
        sourceAssets: assets,
        items: queueItems,
        nextStep: "",
      },
      posts
    ),
  };
  const queue: ClipperProductionQueueSummary = {
    status: assets.length === 0 ? "needs_sources" : draftReady > 0 ? "ready" : rightsReview > 0 ? "needs_rights" : "empty",
    queuePath,
    generatedAt: automation.createdAt,
    sourceAssets: assets,
    items: queueItems,
    nextStep: automation.blockers.length > 0
      ? "Resolver blockers antes de renderizar o publicar."
      : "Cola lista para revision final y scheduling.",
  };

  await writeFile(queuePath, JSON.stringify(queue, null, 2));
  await writeFile(schedulePath, JSON.stringify(automation, null, 2));
  await writeFile(reportPath, JSON.stringify({
    id,
    userId,
    createdAt: automation.createdAt,
    summary: `Ciclo diario Clippers: ${automation.totals.posts} posts evaluados, ${automation.totals.blocked} bloqueados, ${automation.totals.scheduled} programados.`,
    automation,
  }, null, 2));
  return { automation, status: await getClipperStatus(userId) };
}

function buildPlannedClips(accounts: ClipperAccount[], clipsPerAccount: number): ClipperPlannedClip[] {
  const hooksByCategory: Record<ClipperAccountCategory, string[]> = {
    sports: ["Ultimo minuto", "La jugada que cambio todo", "Nadie esta hablando de esto"],
    memes: ["POV del dia", "Esto se salio de control", "El internet hoy"],
    streamers: ["Clip del momento", "Chat no podia creerlo", "El fail mas rapido del stream"],
  };

  return accounts.flatMap((account) =>
    Array.from({ length: Math.min(clipsPerAccount, account.dailyClipTarget) }, (_, index) => {
      const hooks = hooksByCategory[account.category];
      return {
        accountId: account.id,
        title: `${getClipperCategoryLabel(account.category)} draft ${index + 1}`,
        sourceStrategy: account.status === "ready" ? "fuente conectada + derechos verificados" : "pendiente conectar fuente/cuenta",
        format: index % 3 === 0 ? "9:16 hook + captions + punchline" : "9:16 fast cut + loop ending",
        hook: hooks[index % hooks.length],
        publishWindow: index % 2 === 0 ? "12:00-15:00" : "18:00-22:00",
        status: account.status === "ready" ? "drafted" : "needs_source",
      };
    })
  );
}

function buildRecommendations(accounts: ClipperAccount[]): ClipperReport["accountRecommendations"] {
  return accounts.map((account) => {
    const progress = account.lastWeekViews / account.weeklyViewsGoal;
    if (progress >= 0.75) {
      return {
        accountId: account.id,
        recommendation: "Duplicar el formato ganador y subir 20% mas clips.",
        reason: "La cuenta esta cerca de la meta semanal y conviene explotar momentum.",
      };
    }
    if (progress >= 0.35) {
      return {
        accountId: account.id,
        recommendation: "Probar hooks mas agresivos y dos horarios nuevos.",
        reason: "Hay traccion, pero falta mejorar retencion y share rate.",
      };
    }
    return {
      accountId: account.id,
      recommendation: "Conectar mejores fuentes y bajar volumen hasta validar senales.",
      reason: "La cuenta esta lejos de 1M/week; publicar mas sin buen material puede cansar el algoritmo.",
    };
  });
}

export async function runClipperDailyPlan(input: unknown = {}, userId = getSystemUserId()): Promise<{ report: ClipperReport; status: ClipperStatus }> {
  await writeDefaultConfigIfMissing();
  const options = normalizeRunOptions(input);
  const status = await getClipperStatus(userId);
  const id = new Date().toISOString().replace(/[:.]/g, "-");
  const reportPath = path.join(REPORTS_DIR, `${id}.json`);
  const plannedClips = buildPlannedClips(status.accounts, options.clipsPerAccount);
  const report: ClipperReport = {
    id,
    userId,
    createdAt: new Date().toISOString(),
    summary: `Plan diario generado: ${plannedClips.length} drafts propuestos para ${status.accounts.length} cuentas.`,
    publishMode: options.publishMode,
    riskTolerance: options.riskTolerance,
    plannedClips,
    accountRecommendations: buildRecommendations(status.accounts),
    nextActions: [
      `Agregar ${TOKEN_ENCRYPTION_ENV_VAR} con 32+ caracteres antes de conectar cuentas reales.`,
      "Conectar credenciales oficiales de TikTok, Instagram y YouTube por cuenta.",
      "Completar creacion/verificacion humana de las 9 cuentas plataforma preparadas en Setup.",
      "Crear allowlist de fuentes/creadores con permiso explicito.",
      "Definir carpetas locales por categoria para que Clip Factory pueda generar archivos reales.",
      "Activar reportes diarios por Telegram cuando existan metricas reales de plataforma.",
    ],
    reportPath,
  };

  await writeFile(reportPath, JSON.stringify(report, null, 2));
  return { report, status: await getClipperStatus(userId) };
}

export async function readClipperReport(id: string, userId = getSystemUserId()): Promise<ClipperReport | null> {
  const safeId = path.basename(id).replace(/\.json$/i, "");
  const reportPath = path.join(REPORTS_DIR, `${safeId}.json`);
  try {
    const raw = await readFile(reportPath, "utf8");
    const report = JSON.parse(raw) as ClipperReport;
    if (report.userId !== userId) {
      return null;
    }
    return report;
  } catch {
    return null;
  }
}

export const __clipperInternals = {
  normalizeRunOptions,
  buildPlannedClips,
  defaultPlatformAccounts,
  buildPlatformAuthUrl,
  buildTokenExchangeRequest,
  encryptTokenPayload,
  buildProductionQueueItems,
  listSourceAssets,
  renderEnvTemplate,
  renderPlatformReviewDoc,
  hashOAuthCode,
  permissionStatusRecordsPath: PERMISSION_STATUS_RECORDS_PATH,
};
