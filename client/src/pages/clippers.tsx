import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  BarChart3,
  Bot,
  CalendarClock,
  CheckCircle2,
  Clapperboard,
  ExternalLink,
  Eye,
  Flame,
  Gauge,
  HardDrive,
  KeyRound,
  Loader2,
  Network,
  Play,
  Radar,
  RefreshCw,
  FolderOpen,
  ShieldCheck,
  Sparkles,
  Target,
  TrendingUp,
  UploadCloud,
  Users,
  Wand2,
} from "lucide-react";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

type ClipperAccountCategory = "sports" | "memes" | "streamers";
type ClipperAccountStatus = "ready" | "needs_connection" | "paused";
type ClipperAgentStatus = "active" | "waiting" | "review_required";
type ClipperPlatform = "tiktok" | "instagram" | "youtube";
type ClipperPlatformConnectionStatus = "not_created" | "created" | "needs_oauth" | "needs_review" | "ready";
type ClipperPermissionStatus = "missing" | "requested" | "approved" | "blocked";
type ClipperReadinessStatus = "ready" | "missing" | "partial";
type ClipperConnectActionStatus = "ready" | "blocked";
type ClipperOAuthConnectionStatus = "pending" | "code_received" | "error";
type ClipperTokenVaultStatus = "missing_key" | "ready" | "tokens_saved" | "locked";
type ClipperTokenExchangeStatus = "blocked" | "ready" | "saved" | "failed";
type ClipperPermissionPackStatus = "missing" | "partial" | "ready";
type ClipperAssetRightsStatus = "owned_or_permissioned" | "review_required";
type ClipperProductionQueueStatus = "draft_ready" | "rights_review" | "needs_source";
type ClipperDraftSpecStatus = "empty" | "blocked" | "ready";
type ClipperDraftSpecItemStatus = "ready_for_edit";
type ClipperSourceAcquisitionStatus = "not_prepared" | "blocked" | "partial" | "ready";
type ClipperSourceHuntStatus = "not_prepared" | "blocked" | "partial" | "ready";
type ClipperSourceHuntItemStatus = "needs_source" | "needs_rights" | "ready_for_draft";
type ClipperRightsOutreachStatus = "not_prepared" | "blocked" | "partial" | "ready";
type ClipperRightsOutreachItemStatus = "needs_target" | "ready_to_contact" | "permission_recorded";
type ClipperPlatformReadinessStatus = "blocked" | "partial" | "ready";
type ClipperScheduledPostStatus = "blocked_source" | "blocked_rights" | "blocked_connection" | "ready_for_manual" | "scheduled";
type ClipperManualPostingPackStatus = "not_prepared" | "blocked" | "partial" | "ready";
type ClipperManualPostingItemStatus = "ready_to_post" | "needs_account" | "needs_source" | "needs_rights";
type ClipperAutomationRunStatus = "blocked" | "partial" | "ready";
type ClipperGrowthAuditStatus = "critical" | "warning" | "ready";
type ClipperDriveWorkspaceStatus = "missing_keys" | "needs_oauth" | "ready" | "error";
type ClipperMetricsStatus = "empty" | "needs_records" | "ready";
type ClipperBudgetScenarioId = "lean" | "growth" | "aggressive";
type ClipperTrendRadarStatus = "empty" | "needs_review" | "ready";
type ClipperTrendRightsOutreachStatus = "not_prepared" | "blocked" | "partial" | "ready";
type ClipperTrendRightsOutreachItemStatus = "ready_to_contact" | "permission_recorded";
type ClipperViralDiscoveryStatus = "not_prepared" | "ready";
type ClipperViralDiscoveryPriority = "must_scan" | "watch" | "experimental";
type ClipperAutomationScheduleStatus = "not_prepared" | "prepared";
type ClipperAccountIdentityKitStatus = "not_prepared" | "ready";
type ClipperAccountLaunchKitStatus = "not_ready" | "partial" | "ready";
type ClipperAccountLaunchTaskStatus = "blocked" | "pending" | "ready";
type ClipperAccountCreationPackStatus = "not_prepared" | "blocked" | "partial" | "ready";
type ClipperPermissionRequestPackStatus = "not_prepared" | "blocked" | "partial" | "ready";
type ClipperPermissionRequestReadiness = "blocked" | "ready_to_submit" | "submitted" | "approved";
type ClipperPermissionTrackerStatus = "not_prepared" | "blocked" | "in_review" | "ready";
type ClipperPermissionTrackerItemStatus = "blocked" | "ready_to_request" | "requested" | "approved";
type ClipperAccountEvidenceStatus = "empty" | "partial" | "ready";
type ClipperAccountEvidenceItemStatus = "submitted" | "verified" | "rejected";
type ClipperDeveloperAppEvidenceStatus = "empty" | "partial" | "ready";
type ClipperDeveloperAppEvidenceItemStatus = "draft" | "submitted" | "approved" | "rejected";
type ClipperLaunchCommandCenterStatus = "ready" | "action_required" | "blocked";
type ClipperLaunchCommandCenterStepStatus = "done" | "needs_action" | "blocked";
type ClipperCredentialSetupStatus = "missing" | "partial" | "ready";
type ClipperCredentialDoctorStatus = "not_prepared" | "blocked" | "partial" | "ready";
type ClipperIntakeKitStatus = "not_prepared" | "prepared";
type ClipperExternalSetupQueueStatus = "not_prepared" | "blocked" | "in_progress" | "ready";
type ClipperExternalSetupQueueItemType = "account" | "developer_app" | "permission" | "credential" | "oauth";
type ClipperExternalSetupQueuePriority = "critical" | "high" | "medium";
type ClipperExternalExecutionHandoffStatus = "not_prepared" | "blocked" | "in_progress" | "ready";
type ClipperExternalLaunchDossierStatus = "not_prepared" | "blocked" | "in_progress" | "ready";
type ClipperAppReviewSubmissionPackStatus = "not_prepared" | "blocked" | "ready";
type ClipperOfficialPermissionMatrixStatus = "not_prepared" | "verified" | "needs_review";
type ClipperOfficialPermissionSourceStatus = "official_verified" | "official_login_required";
type ClipperPublisherConnectorStatus = "not_prepared" | "blocked" | "partial" | "ready";
type ClipperPublisherBlockingCategory = "account" | "developer_app" | "permission" | "credential" | "token" | "content" | "compliance";
type ClipperOAuthGoLiveStatus = "not_prepared" | "blocked" | "partial" | "ready";
type ClipperOAuthConnectionPackStatus = "not_prepared" | "blocked" | "partial" | "ready";
type ClipperBlockerResolutionPackStatus = "not_prepared" | "blocked" | "in_progress" | "ready";
type ClipperBlockerResolutionActionStatus = "blocked" | "next" | "ready";
type ClipperBlockerExecutionMode = "in_app" | "external_portal" | "evidence_upload" | "manual_review";
type ClipperGoLiveAutopilotBriefStatus = "not_prepared" | "blocked" | "in_progress" | "ready";
type ClipperGoLiveAutopilotActionStatus = "run_in_app" | "external_required" | "waiting" | "done";
type ClipperGoLiveAutopilotActionLane = "in_app" | "external" | "evidence" | "publish";
type ClipperGoLiveAutopilotRunStatus = "not_run" | "completed" | "partial" | "blocked";
type ClipperGoLiveAutopilotRunItemStatus = "completed" | "skipped" | "failed";
type ClipperBlockerUnlockPhase = "credentials" | "accounts" | "public_url" | "developer_apps" | "permissions" | "oauth" | "content_supply" | "publishing" | "optimization";
type ClipperGoLiveExecutionPackStatus = "not_prepared" | "blocked" | "in_progress" | "ready";
type ClipperGoLiveExecutionPhaseStatus = "blocked" | "ready_to_execute" | "done";
type ClipperPlatformPortalChecklistStatus = "not_prepared" | "blocked" | "in_progress" | "ready";
type ClipperHttpsTunnelPlanStatus = "not_prepared" | "blocked" | "ready";
type ClipperLegalPolicyPackStatus = "not_prepared" | "blocked" | "ready";
type ClipperAppReviewDemoPackStatus = "not_prepared" | "blocked" | "ready";
type ClipperDeveloperApplicationDraftsStatus = "not_prepared" | "blocked" | "ready";

interface ClipperPlatformAccount {
  platform: ClipperPlatform;
  handle: string;
  displayName: string;
  status: ClipperPlatformConnectionStatus;
  requiredScopes: string[];
  missingSteps: string[];
  notes: string;
}

interface ClipperAccount {
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

interface ClipperSource {
  id: string;
  label: string;
  type: string;
  freshness: string;
  rightsMode: string;
  status: "connected" | "planned" | "needs_setup";
}

interface ClipperSubAgent {
  id: string;
  name: string;
  job: string;
  status: ClipperAgentStatus;
  output: string;
}

interface ClipperPlatformRequirement {
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

interface ClipperPermissionRequest {
  id: string;
  platform: ClipperPlatform;
  scope: string;
  label: string;
  status: ClipperPermissionStatus;
  reason: string;
  evidenceRequired: string;
  docsUrl: string;
}

interface ClipperCredentialCheck {
  platform: ClipperPlatform;
  label: string;
  status: ClipperReadinessStatus;
  requiredEnvVars: string[];
  configuredEnvVars: string[];
  missingEnvVars: string[];
  nextStep: string;
}

interface ClipperSourceFolder {
  category: ClipperAccountCategory | "allowlist" | "drafts" | "scheduled" | "metrics" | "trends" | "sourceHunts" | "accountEvidence" | "developerAppEvidence";
  label: string;
  path: string;
  status: "ready";
  purpose: string;
}

interface ClipperConnectAction {
  platform: ClipperPlatform;
  label: string;
  status: ClipperConnectActionStatus;
  authUrl: string | null;
  callbackPath: string;
  missingEnvVars: string[];
  scopes: string[];
  nextStep: string;
}

interface ClipperOAuthConnection {
  platform: ClipperPlatform;
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

interface ClipperTokenSummary {
  platform: ClipperPlatform;
  status: "saved";
  savedAt: string;
  scopes: string[];
  tokenType: string | null;
  expiresAt: string | null;
  refreshExpiresAt: string | null;
  subjectHash: string | null;
}

interface ClipperTokenVaultSummary {
  status: ClipperTokenVaultStatus;
  envVar: string;
  configured: boolean;
  vaultPath: string;
  records: ClipperTokenSummary[];
  nextStep: string;
}

interface ClipperTokenExchange {
  platform: ClipperPlatform;
  label: string;
  status: ClipperTokenExchangeStatus;
  missingEnvVars: string[];
  callbackPath: string;
  tokenSavedAt: string | null;
  docsUrl: string;
  nextStep: string;
}

interface ClipperPermissionPackFile {
  id: string;
  label: string;
  path: string;
  exists: boolean;
  purpose: string;
}

interface ClipperPermissionPackSummary {
  status: ClipperPermissionPackStatus;
  rootDir: string;
  files: ClipperPermissionPackFile[];
  generatedAt: string | null;
  nextStep: string;
}

interface ClipperPermissionPack {
  generatedAt: string;
  rootDir: string;
  files: ClipperPermissionPackFile[];
}

interface ClipperSourceAsset {
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

interface ClipperProductionQueueItem {
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

interface ClipperProductionQueueSummary {
  status: "empty" | "needs_sources" | "needs_rights" | "ready";
  queuePath: string | null;
  generatedAt: string | null;
  sourceAssets: ClipperSourceAsset[];
  items: ClipperProductionQueueItem[];
  nextStep: string;
}

interface ClipperSourceDropImportItem {
  sourcePath: string;
  targetPath: string;
  category: ClipperAccountCategory;
  fileName: string;
  status: "imported" | "skipped";
  rightsStatus: ClipperAssetRightsStatus;
  reason: string | null;
}

interface ClipperSourceDropImportSummary {
  importedAt: string;
  dropDir: string;
  filesScanned: number;
  imported: number;
  skipped: number;
  items: ClipperSourceDropImportItem[];
  queue: ClipperProductionQueueSummary;
  nextStep: string;
}

interface ClipperSourceAcquisitionCategory {
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

interface ClipperSourceAcquisitionSummary {
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

interface ClipperSourceHuntItem {
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

interface ClipperSourceHuntSummary {
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

interface ClipperRightsOutreachItem {
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

interface ClipperRightsOutreachTemplate {
  category: ClipperAccountCategory;
  label: string;
  channel: "dm_or_email";
  subject: string;
  message: string;
  evidenceToRequest: string[];
}

interface ClipperRightsOutreachSummary {
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

interface ClipperSourceRightsRecord {
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

interface ClipperDraftSpecItem {
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

interface ClipperDraftSpecSummary {
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

interface ClipperRenderedClipItem {
  id: string;
  draftSpecId: string;
  accountId: string;
  accountName: string;
  category: ClipperAccountCategory;
  sourcePath: string;
  outputPath: string;
  hook: string;
  captionSeed: string;
  durationSeconds: number;
  status: "rendered" | "failed";
  error: string | null;
  nextStep: string;
}

interface ClipperRenderedClipSummary {
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

interface ClipperPublishingPackageItem {
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

interface ClipperPublishingPackageSummary {
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

interface ClipperScheduledPost {
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

interface ClipperAutomationRun {
  id: string;
  createdAt: string;
  status: ClipperAutomationRunStatus;
  publishMode: ClipperReport["publishMode"];
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

interface ClipperManualPostingPackItem {
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

interface ClipperManualPostingWeeklyRunway {
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

interface ClipperManualPostingUnblockItem {
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

interface ClipperManualPostingPackSummary {
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

interface ClipperAutomationSummary {
  status: "not_run" | ClipperAutomationRunStatus;
  lastRun: ClipperAutomationRun | null;
  nextRunHint: string;
  nextStep: string;
}

interface ClipperAutomationScheduleSummary {
  status: ClipperAutomationScheduleStatus;
  enabled: boolean;
  timezone: string;
  dailyRunTime: string;
  clipsPerAccount: number;
  publishMode: ClipperReport["publishMode"];
  riskTolerance: ClipperReport["riskTolerance"];
  weeklyTargetClips: number;
  manifestPath: string;
  generatedAt: string | null;
  runbook: string[];
  nextStep: string;
}

interface ClipperAccountIdentityPlatform {
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

interface ClipperAccountIdentityItem {
  accountId: string;
  accountName: string;
  category: ClipperAccountCategory;
  weeklyViewsGoal: number;
  dailyClipTarget: number;
  contentPillars: string[];
  platforms: ClipperAccountIdentityPlatform[];
}

interface ClipperAccountIdentityKitSummary {
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

interface ClipperAccountLaunchTask {
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

interface ClipperAccountLaunchKitSummary {
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

interface ClipperAccountCreationPackItem {
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

type ClipperAccountCreationSessionPriority = "critical" | "high" | "medium";

interface ClipperAccountCreationSessionItem {
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

interface ClipperAccountClaimSheetItem {
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

interface ClipperAccountCreationPackSummary {
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

interface ClipperAccountEvidenceItem {
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

interface ClipperAccountEvidenceSummary {
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

interface ClipperDeveloperAppEvidenceItem {
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

interface ClipperDeveloperAppEvidenceSummary {
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

interface ClipperCredentialSetupItem {
  id: string;
  label: string;
  status: ClipperCredentialSetupStatus;
  acceptedEnvVarGroups: string[][];
  configuredEnvVars: string[];
  missingEnvVarGroups: string[];
  docsUrl: string;
  nextStep: string;
}

interface ClipperCredentialImportPlanItem {
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

interface ClipperCredentialSetupEnvFileItemScan {
  id: string;
  label: string;
  statusFromFile: ClipperCredentialSetupStatus;
  matchedEnvVars: string[];
  missingEnvVarGroups: string[];
}

interface ClipperCredentialSetupEnvFileScan {
  fileName: string;
  exists: boolean;
  relevantKeys: string[];
  itemScans: ClipperCredentialSetupEnvFileItemScan[];
}

interface ClipperCredentialSetupFileScan {
  fileName: string;
  relativePath: string;
  kind: "google_oauth_json" | "env_file" | "unknown";
  suggestedImportTarget: string;
  supportedInputFormat: string;
  nextStep: string;
}

interface ClipperCredentialSetupSummary {
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

interface ClipperCredentialReloadSummary {
  loadedFiles: string[];
  envFilesFound: string[];
  credentialSetup: ClipperCredentialSetupSummary;
}

interface ClipperCredentialSecretWriteSummary {
  envFileName: string;
  envFilePath: string;
  envVar: string;
  updatedAt: string;
  configuredEnvVars: string[];
  credentialSetup: ClipperCredentialSetupSummary;
  credentialDoctor: ClipperCredentialDoctorSummary;
  nextStep: string;
}

interface ClipperCredentialSecretBatchWriteSummary {
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

interface ClipperLaunchEvidenceBatchSummary {
  updatedAt: string;
  accepted: {
    accountEvidence: number;
    developerApps: number;
    permissions: number;
    sourceRights: number;
  };
  rejected: Array<{
    index: number;
    kind: string;
    reason: string;
    identifier: string | null;
  }>;
  sourceFiles?: string[];
  filesScanned?: number;
  filesImported?: number;
  fileErrors?: Array<{ relativePath: string; reason: string }>;
  accountEvidence: ClipperAccountEvidenceSummary;
  developerAppEvidence: ClipperDeveloperAppEvidenceSummary;
  permissionTracker: ClipperPermissionTrackerSummary;
  nextStep: string;
}

interface ClipperCredentialDoctorEnvFile {
  fileName: string;
  exists: boolean;
  relevantKeys: string[];
}

interface ClipperCredentialDoctorItem {
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

interface ClipperCredentialDoctorSummary {
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

interface ClipperPlatformReadinessItem {
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

interface ClipperPlatformReadinessSummary {
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

interface ClipperExternalSetupQueueItem {
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

interface ClipperExternalSetupQueueSummary {
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

interface ClipperExternalExecutionHandoffItem {
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

interface ClipperExternalExecutionHandoffSummary {
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

type ClipperExternalExecutionSessionLane = "do_now" | "blocked" | "waiting";

interface ClipperExternalExecutionSessionItem {
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

interface ClipperExternalExecutionUnlockBoardItem {
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

interface ClipperExternalExecutionSessionSummary {
  status: ClipperExternalExecutionHandoffStatus;
  generatedAt: string | null;
  manifestPath: string;
  markdownPath: string;
  csvPath: string;
  evidenceImportPath: string;
  evidenceImportTemplate: string;
  items: ClipperExternalExecutionSessionItem[];
  unlockBoard: ClipperExternalExecutionUnlockBoardItem[];
  totals: {
    items: number;
    doNow: number;
    blocked: number;
    waiting: number;
    evidenceRows: number;
    envTemplates: number;
    importableEvidenceRows: number;
  };
  nextStep: string;
}

interface ClipperExternalLaunchDossierPlatform {
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

interface ClipperExternalLaunchDossierSummary {
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

interface ClipperPlatformPortalChecklistItem {
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

interface ClipperPlatformPortalChecklistSummary {
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

interface ClipperGoLiveExecutionPhase {
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

interface ClipperGoLiveExecutionPlatform {
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

interface ClipperGoLiveExecutionPackSummary {
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

interface ClipperGoLiveAutopilotAction {
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

interface ClipperGoLiveAutopilotBriefSummary {
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

interface ClipperGoLiveAutopilotRunItem {
  actionId: string;
  label: string;
  localActionUrl: string | null;
  status: ClipperGoLiveAutopilotRunItemStatus;
  startedAt: string;
  finishedAt: string;
  message: string;
}

interface ClipperGoLiveAutopilotRunSummary {
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

interface ClipperOfficialPermissionMatrixItem {
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

interface ClipperOfficialPermissionMatrixSummary {
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

interface ClipperPublisherConnectorItem {
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

interface ClipperPublisherConnectorSummary {
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

interface ClipperIntakeKitFile {
  id: string;
  label: string;
  path: string;
  exists: boolean;
  destinationDir: string;
  purpose: string;
}

interface ClipperIntakeKitSummary {
  status: ClipperIntakeKitStatus;
  rootDir: string;
  templateDir: string;
  readmePath: string;
  generatedAt: string | null;
  files: ClipperIntakeKitFile[];
  nextStep: string;
}

interface ClipperSourceIntakeBatchItem {
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

interface ClipperSourceIntakeBatchSummary {
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

interface ClipperLaunchCommandCenterStep {
  id: string;
  label: string;
  owner: string;
  status: ClipperLaunchCommandCenterStepStatus;
  evidence: string;
  nextStep: string;
  artifactPath: string | null;
  actionUrl: string | null;
}

interface ClipperLaunchCommandCenterSummary {
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

interface ClipperBlockerResolutionAction {
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

interface ClipperBlockerResolutionPackSummary {
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

interface ClipperPermissionTrackerItem {
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

interface ClipperPermissionTrackerSummary {
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

interface ClipperPermissionRequestPackItem {
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

interface ClipperPermissionRequestPackSummary {
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

interface ClipperGrowthAuditItem {
  id: string;
  label: string;
  status: ClipperGrowthAuditStatus;
  impact: "low" | "medium" | "high";
  owner: string;
  evidence: string;
  nextStep: string;
}

interface ClipperGrowthAudit {
  score: number;
  status: ClipperGrowthAuditStatus;
  summary: string;
  items: ClipperGrowthAuditItem[];
  roadmap: string[];
  weeklyGoalGap: number;
}

interface ClipperDriveFolder {
  id: string;
  label: string;
  path: string[];
  folderId: string | null;
  purpose: string;
}

interface ClipperDriveEnvDiagnostics {
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

interface ClipperDriveOAuthSetup {
  authPath: string;
  callbackPath: string;
  configuredRedirectUri: string | null;
  recommendedRedirectUris: string[];
  scopes: string[];
  nextStep: string;
}

interface ClipperDriveWorkspaceSummary {
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

interface ClipperMetricFile {
  fileName: string;
  path: string;
  records: number;
  importedAt: string;
  status: "imported" | "skipped" | "error";
  error: string | null;
}

interface ClipperMetricRecord {
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

interface ClipperAccountMetricPerformance {
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

interface ClipperMetricsSummary {
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

interface ClipperBudgetRole {
  role: string;
  weeklyHours: number;
  rateLow: number;
  rateHigh: number;
  note: string;
}

interface ClipperBudgetScenario {
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

interface ClipperBudgetPlanner {
  targetWeeklyClips: number;
  configuredWeeklyClips: number;
  recommendedScenarioId: ClipperBudgetScenarioId;
  scenarios: ClipperBudgetScenario[];
  assumptions: string[];
  nextStep: string;
}

interface ClipperTrendCandidate {
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

interface ClipperTrendFile {
  fileName: string;
  path: string;
  records: number;
  importedAt: string;
  status: "imported" | "skipped" | "error";
  error: string | null;
}

interface ClipperTrendRadarSummary {
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

interface ClipperTrendCandidatesBatchImportSummary {
  importedAt: string;
  fileName: string;
  filePath: string;
  accepted: number;
  skipped: number;
  trendRadar: ClipperTrendRadarSummary;
  nextStep: string;
}

interface ClipperTrendRightsOutreachItem {
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

interface ClipperTrendRightsOutreachSummary {
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

interface ClipperViralDiscoveryItem {
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

interface ClipperViralDiscoverySessionItem {
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

interface ClipperViralDiscoverySummary {
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

interface ClipperOAuthGoLiveItem {
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

interface ClipperOAuthGoLiveSummary {
  status: ClipperOAuthGoLiveStatus;
  generatedAt: string | null;
  manifestPath: string;
  markdownPath: string;
  publicBaseUrl: string;
  localPort: string;
  localOrigin: string;
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

interface ClipperOAuthConnectionPackItem {
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

interface ClipperOAuthConnectionPackSummary {
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

interface ClipperProductionUrlSetupPlatform {
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

interface ClipperProductionUrlSetupSessionItem {
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

interface ClipperProductionUrlEndpointCheck {
  id: string;
  label: string;
  url: string;
  expected: string;
}

interface ClipperProductionUrlSetupSummary {
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

interface ClipperProductionUrlVerificationItem {
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

interface ClipperProductionDnsRecordCandidate {
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

interface ClipperProductionDnsDiagnostic {
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

interface ClipperProductionUrlVerificationSummary {
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

interface ClipperHttpsTunnelPlanOption {
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

interface ClipperHttpsTunnelExecutionItem {
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

interface ClipperHttpsTunnelPlanSummary {
  status: ClipperHttpsTunnelPlanStatus;
  generatedAt: string | null;
  manifestPath: string;
  markdownPath: string;
  publicBaseUrl: string;
  productionUrlReady: boolean;
  recommendedOptionId: string;
  options: ClipperHttpsTunnelPlanOption[];
  executionSession: ClipperHttpsTunnelExecutionItem[];
  blockers: string[];
  nextStep: string;
}

interface ClipperLegalPolicyPackSummary {
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

interface ClipperAppReviewSubmissionAnswer {
  prompt: string;
  response: string;
}

interface ClipperAppReviewSubmissionItem {
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

interface ClipperAppReviewSubmissionPackSummary {
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

interface ClipperAppReviewDemoStep {
  id: string;
  label: string;
  owner: string;
  status: ClipperLaunchCommandCenterStepStatus;
  publicDemoUrl: string;
  localEvidencePath: string;
  checklist: string[];
  nextStep: string;
}

interface ClipperAppReviewDemoPackSummary {
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

interface ClipperDeveloperApplicationDraftItem {
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

interface ClipperDeveloperApplicationSessionItem {
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

interface ClipperDeveloperApplicationDraftsSummary {
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

interface ClipperPipelineItem {
  stage: string;
  count: number;
  owner: string;
  status: ClipperAgentStatus;
}

interface ClipperPlannedClip {
  accountId: string;
  title: string;
  sourceStrategy: string;
  format: string;
  hook: string;
  publishWindow: string;
  status: "drafted" | "needs_source" | "needs_review";
}

interface ClipperReport {
  id: string;
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

interface ClipperStatus {
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

const categoryLabels: Record<ClipperAccountCategory, string> = {
  sports: "Deportes",
  memes: "Memes",
  streamers: "Streamers",
};

const accountTone: Record<ClipperAccountCategory, string> = {
  sports: "from-emerald-300 to-cyan-300",
  memes: "from-amber-300 to-rose-300",
  streamers: "from-fuchsia-300 to-violet-300",
};

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US", { notation: value >= 1_000_000 ? "compact" : "standard" }).format(value);
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("es-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function statusBadge(status: ClipperAgentStatus | ClipperAccountStatus | ClipperSource["status"]) {
  if (status === "active" || status === "ready" || status === "connected") {
    return "border-emerald-300/30 bg-emerald-300/10 text-emerald-200";
  }
  if (status === "review_required" || status === "needs_connection" || status === "needs_setup") {
    return "border-amber-300/30 bg-amber-300/10 text-amber-200";
  }
  return "border-zinc-500/30 bg-zinc-500/10 text-zinc-300";
}

function connectionBadge(status: ClipperPlatformConnectionStatus | ClipperPermissionStatus) {
  if (status === "ready" || status === "approved") return "border-emerald-300/30 bg-emerald-300/10 text-emerald-200";
  if (status === "requested" || status === "needs_review" || status === "needs_oauth") return "border-amber-300/30 bg-amber-300/10 text-amber-200";
  if (status === "blocked") return "border-red-300/30 bg-red-300/10 text-red-200";
  return "border-zinc-600 bg-zinc-900 text-zinc-300";
}

function readinessBadge(status: ClipperReadinessStatus) {
  if (status === "ready") return "border-emerald-300/30 bg-emerald-300/10 text-emerald-200";
  if (status === "partial") return "border-amber-300/30 bg-amber-300/10 text-amber-200";
  return "border-red-300/30 bg-red-300/10 text-red-200";
}

function oauthBadge(status: ClipperOAuthConnectionStatus) {
  if (status === "code_received") return "border-cyan-300/30 bg-cyan-300/10 text-cyan-200";
  if (status === "error") return "border-red-300/30 bg-red-300/10 text-red-200";
  return "border-amber-300/30 bg-amber-300/10 text-amber-200";
}

function tokenVaultBadge(status: ClipperTokenVaultStatus) {
  if (status === "tokens_saved" || status === "ready") return "border-emerald-300/30 bg-emerald-300/10 text-emerald-200";
  if (status === "locked") return "border-amber-300/30 bg-amber-300/10 text-amber-200";
  return "border-red-300/30 bg-red-300/10 text-red-200";
}

function tokenExchangeBadge(status: ClipperTokenExchangeStatus) {
  if (status === "saved") return "border-emerald-300/30 bg-emerald-300/10 text-emerald-200";
  if (status === "ready") return "border-cyan-300/30 bg-cyan-300/10 text-cyan-200";
  if (status === "failed") return "border-red-300/30 bg-red-300/10 text-red-200";
  return "border-amber-300/30 bg-amber-300/10 text-amber-200";
}

function platformReadinessBadge(status: ClipperPlatformReadinessStatus) {
  if (status === "ready") return "border-emerald-300/30 bg-emerald-300/10 text-emerald-200";
  if (status === "partial") return "border-amber-300/30 bg-amber-300/10 text-amber-200";
  return "border-red-300/30 bg-red-300/10 text-red-200";
}

function externalSetupQueueBadge(status: ClipperExternalSetupQueueStatus | ClipperExternalExecutionHandoffStatus | ClipperLaunchCommandCenterStepStatus | ClipperExternalSetupQueuePriority) {
  if (status === "ready" || status === "done") return "border-emerald-300/30 bg-emerald-300/10 text-emerald-200";
  if (status === "in_progress" || status === "needs_action" || status === "high" || status === "medium") return "border-amber-300/30 bg-amber-300/10 text-amber-200";
  if (status === "not_prepared") return "border-zinc-600 bg-zinc-900 text-zinc-300";
  return "border-red-300/30 bg-red-300/10 text-red-200";
}

function externalLaunchDossierBadge(status: ClipperExternalLaunchDossierStatus) {
  if (status === "ready") return "border-emerald-300/30 bg-emerald-300/10 text-emerald-200";
  if (status === "in_progress") return "border-amber-300/30 bg-amber-300/10 text-amber-200";
  if (status === "not_prepared") return "border-zinc-600 bg-zinc-900 text-zinc-300";
  return "border-red-300/30 bg-red-300/10 text-red-200";
}

function platformPortalChecklistBadge(status: ClipperPlatformPortalChecklistStatus) {
  if (status === "ready") return "border-emerald-300/30 bg-emerald-300/10 text-emerald-200";
  if (status === "in_progress") return "border-amber-300/30 bg-amber-300/10 text-amber-200";
  if (status === "not_prepared") return "border-zinc-600 bg-zinc-900 text-zinc-300";
  return "border-red-300/30 bg-red-300/10 text-red-200";
}

function appReviewSubmissionPackBadge(status: ClipperAppReviewSubmissionPackStatus) {
  if (status === "ready") return "border-emerald-300/30 bg-emerald-300/10 text-emerald-200";
  if (status === "not_prepared") return "border-zinc-600 bg-zinc-900 text-zinc-300";
  return "border-amber-300/30 bg-amber-300/10 text-amber-200";
}

function officialPermissionMatrixBadge(status: ClipperOfficialPermissionMatrixStatus | ClipperOfficialPermissionSourceStatus) {
  if (status === "verified" || status === "official_verified") return "border-emerald-300/30 bg-emerald-300/10 text-emerald-200";
  if (status === "needs_review" || status === "official_login_required") return "border-amber-300/30 bg-amber-300/10 text-amber-200";
  return "border-zinc-600 bg-zinc-900 text-zinc-300";
}

function publisherConnectorBadge(status: ClipperPublisherConnectorStatus) {
  if (status === "ready") return "border-emerald-300/30 bg-emerald-300/10 text-emerald-200";
  if (status === "partial") return "border-amber-300/30 bg-amber-300/10 text-amber-200";
  if (status === "not_prepared") return "border-zinc-600 bg-zinc-900 text-zinc-300";
  return "border-red-300/30 bg-red-300/10 text-red-200";
}

function oauthGoLiveBadge(status: ClipperOAuthGoLiveStatus) {
  if (status === "ready") return "border-emerald-300/30 bg-emerald-300/10 text-emerald-200";
  if (status === "partial") return "border-amber-300/30 bg-amber-300/10 text-amber-200";
  if (status === "not_prepared") return "border-zinc-600 bg-zinc-900 text-zinc-300";
  return "border-red-300/30 bg-red-300/10 text-red-200";
}

function oauthConnectionPackBadge(status: ClipperOAuthConnectionPackStatus) {
  if (status === "ready") return "border-emerald-300/30 bg-emerald-300/10 text-emerald-200";
  if (status === "partial") return "border-amber-300/30 bg-amber-300/10 text-amber-200";
  if (status === "not_prepared") return "border-zinc-600 bg-zinc-900 text-zinc-300";
  return "border-red-300/30 bg-red-300/10 text-red-200";
}

function goLiveExecutionBadge(status: ClipperGoLiveExecutionPackStatus | ClipperGoLiveExecutionPhaseStatus) {
  if (status === "ready" || status === "done") return "border-emerald-300/30 bg-emerald-300/10 text-emerald-200";
  if (status === "in_progress" || status === "ready_to_execute") return "border-amber-300/30 bg-amber-300/10 text-amber-200";
  if (status === "not_prepared") return "border-zinc-600 bg-zinc-900 text-zinc-300";
  return "border-red-300/30 bg-red-300/10 text-red-200";
}

function httpsTunnelPlanBadge(status: ClipperHttpsTunnelPlanStatus | ClipperHttpsTunnelPlanOption["status"]) {
  if (status === "ready" || status === "recommended") return "border-emerald-300/30 bg-emerald-300/10 text-emerald-200";
  if (status === "available") return "border-cyan-300/30 bg-cyan-300/10 text-cyan-200";
  if (status === "fallback" || status === "not_prepared") return "border-zinc-600 bg-zinc-900 text-zinc-300";
  return "border-red-300/30 bg-red-300/10 text-red-200";
}

function legalPolicyPackBadge(status: ClipperLegalPolicyPackStatus) {
  if (status === "ready") return "border-emerald-300/30 bg-emerald-300/10 text-emerald-200";
  if (status === "not_prepared") return "border-zinc-600 bg-zinc-900 text-zinc-300";
  return "border-amber-300/30 bg-amber-300/10 text-amber-200";
}

function appReviewDemoPackBadge(status: ClipperAppReviewDemoPackStatus | ClipperLaunchCommandCenterStepStatus) {
  if (status === "ready" || status === "done") return "border-emerald-300/30 bg-emerald-300/10 text-emerald-200";
  if (status === "not_prepared") return "border-zinc-600 bg-zinc-900 text-zinc-300";
  return "border-amber-300/30 bg-amber-300/10 text-amber-200";
}

function developerApplicationDraftsBadge(status: ClipperDeveloperApplicationDraftsStatus) {
  if (status === "ready") return "border-emerald-300/30 bg-emerald-300/10 text-emerald-200";
  if (status === "not_prepared") return "border-zinc-600 bg-zinc-900 text-zinc-300";
  return "border-amber-300/30 bg-amber-300/10 text-amber-200";
}

function permissionPackBadge(status: ClipperPermissionPackStatus) {
  if (status === "ready") return "border-emerald-300/30 bg-emerald-300/10 text-emerald-200";
  if (status === "partial") return "border-amber-300/30 bg-amber-300/10 text-amber-200";
  return "border-red-300/30 bg-red-300/10 text-red-200";
}

function productionBadge(status: ClipperProductionQueueStatus | ClipperProductionQueueSummary["status"] | ClipperAssetRightsStatus | "missing") {
  if (status === "ready" || status === "draft_ready" || status === "owned_or_permissioned") return "border-emerald-300/30 bg-emerald-300/10 text-emerald-200";
  if (status === "rights_review" || status === "needs_rights" || status === "review_required") return "border-amber-300/30 bg-amber-300/10 text-amber-200";
  return "border-red-300/30 bg-red-300/10 text-red-200";
}

function draftSpecBadge(status: ClipperDraftSpecStatus | ClipperDraftSpecItemStatus) {
  if (status === "ready" || status === "ready_for_edit") return "border-emerald-300/30 bg-emerald-300/10 text-emerald-200";
  if (status === "empty") return "border-zinc-600 bg-zinc-900 text-zinc-300";
  return "border-red-300/30 bg-red-300/10 text-red-200";
}

function sourceAcquisitionBadge(status: ClipperSourceAcquisitionStatus | ClipperSourceAcquisitionCategory["priority"]) {
  if (status === "ready" || status === "watch") return "border-emerald-300/30 bg-emerald-300/10 text-emerald-200";
  if (status === "partial" || status === "high") return "border-amber-300/30 bg-amber-300/10 text-amber-200";
  if (status === "not_prepared") return "border-zinc-600 bg-zinc-900 text-zinc-300";
  return "border-red-300/30 bg-red-300/10 text-red-200";
}

function sourceHuntBadge(status: ClipperSourceHuntStatus | ClipperSourceHuntItemStatus) {
  if (status === "ready" || status === "ready_for_draft") return "border-emerald-300/30 bg-emerald-300/10 text-emerald-200";
  if (status === "partial" || status === "needs_rights") return "border-amber-300/30 bg-amber-300/10 text-amber-200";
  if (status === "not_prepared") return "border-zinc-600 bg-zinc-900 text-zinc-300";
  return "border-red-300/30 bg-red-300/10 text-red-200";
}

function rightsOutreachBadge(status: ClipperRightsOutreachStatus | ClipperRightsOutreachItemStatus) {
  if (status === "ready" || status === "permission_recorded") return "border-emerald-300/30 bg-emerald-300/10 text-emerald-200";
  if (status === "partial" || status === "ready_to_contact") return "border-amber-300/30 bg-amber-300/10 text-amber-200";
  if (status === "not_prepared") return "border-zinc-600 bg-zinc-900 text-zinc-300";
  return "border-red-300/30 bg-red-300/10 text-red-200";
}

function automationBadge(status: ClipperAutomationSummary["status"] | ClipperScheduledPostStatus) {
  if (status === "ready" || status === "scheduled" || status === "ready_for_manual") return "border-emerald-300/30 bg-emerald-300/10 text-emerald-200";
  if (status === "partial") return "border-amber-300/30 bg-amber-300/10 text-amber-200";
  if (status === "not_run") return "border-zinc-600 bg-zinc-900 text-zinc-300";
  return "border-red-300/30 bg-red-300/10 text-red-200";
}

function manualPostingPackBadge(status: ClipperManualPostingPackStatus | ClipperManualPostingItemStatus) {
  if (status === "ready" || status === "ready_to_post") return "border-emerald-300/30 bg-emerald-300/10 text-emerald-200";
  if (status === "partial" || status === "needs_account" || status === "needs_rights") return "border-amber-300/30 bg-amber-300/10 text-amber-200";
  if (status === "not_prepared") return "border-zinc-600 bg-zinc-900 text-zinc-300";
  return "border-red-300/30 bg-red-300/10 text-red-200";
}

function automationScheduleBadge(status: ClipperAutomationScheduleStatus) {
  if (status === "prepared") return "border-emerald-300/30 bg-emerald-300/10 text-emerald-200";
  return "border-amber-300/30 bg-amber-300/10 text-amber-200";
}

function accountIdentityKitBadge(status: ClipperAccountIdentityKitStatus) {
  if (status === "ready") return "border-emerald-300/30 bg-emerald-300/10 text-emerald-200";
  return "border-zinc-600 bg-zinc-900 text-zinc-300";
}

function accountLaunchBadge(status: ClipperAccountLaunchKitStatus | ClipperAccountLaunchTaskStatus) {
  if (status === "ready") return "border-emerald-300/30 bg-emerald-300/10 text-emerald-200";
  if (status === "partial" || status === "pending") return "border-amber-300/30 bg-amber-300/10 text-amber-200";
  return "border-red-300/30 bg-red-300/10 text-red-200";
}

function accountCreationPackBadge(status: ClipperAccountCreationPackStatus) {
  if (status === "ready") return "border-emerald-300/30 bg-emerald-300/10 text-emerald-200";
  if (status === "partial") return "border-amber-300/30 bg-amber-300/10 text-amber-200";
  if (status === "not_prepared") return "border-zinc-600 bg-zinc-900 text-zinc-300";
  return "border-red-300/30 bg-red-300/10 text-red-200";
}

function accountEvidenceBadge(status: ClipperAccountEvidenceStatus | ClipperAccountEvidenceItemStatus | "missing") {
  if (status === "ready" || status === "verified") return "border-emerald-300/30 bg-emerald-300/10 text-emerald-200";
  if (status === "partial" || status === "submitted") return "border-amber-300/30 bg-amber-300/10 text-amber-200";
  return "border-red-300/30 bg-red-300/10 text-red-200";
}

function developerAppEvidenceBadge(status: ClipperDeveloperAppEvidenceStatus | ClipperDeveloperAppEvidenceItemStatus) {
  if (status === "ready" || status === "approved") return "border-emerald-300/30 bg-emerald-300/10 text-emerald-200";
  if (status === "partial" || status === "submitted" || status === "draft") return "border-amber-300/30 bg-amber-300/10 text-amber-200";
  return "border-red-300/30 bg-red-300/10 text-red-200";
}

function commandCenterBadge(status: ClipperLaunchCommandCenterStatus | ClipperLaunchCommandCenterStepStatus) {
  if (status === "ready" || status === "done") return "border-emerald-300/30 bg-emerald-300/10 text-emerald-200";
  if (status === "action_required" || status === "needs_action") return "border-amber-300/30 bg-amber-300/10 text-amber-200";
  return "border-red-300/30 bg-red-300/10 text-red-200";
}

function blockerResolutionBadge(status: ClipperBlockerResolutionPackStatus | ClipperBlockerResolutionActionStatus | ClipperBlockerResolutionAction["severity"]) {
  if (status === "ready") return "border-emerald-300/30 bg-emerald-300/10 text-emerald-200";
  if (status === "in_progress" || status === "next" || status === "high" || status === "medium") return "border-amber-300/30 bg-amber-300/10 text-amber-200";
  if (status === "not_prepared") return "border-zinc-600 bg-zinc-900 text-zinc-300";
  return "border-red-300/30 bg-red-300/10 text-red-200";
}

function credentialSetupBadge(status: ClipperCredentialSetupStatus) {
  if (status === "ready") return "border-emerald-300/30 bg-emerald-300/10 text-emerald-200";
  if (status === "partial") return "border-amber-300/30 bg-amber-300/10 text-amber-200";
  return "border-red-300/30 bg-red-300/10 text-red-200";
}

function credentialDoctorBadge(status: ClipperCredentialDoctorStatus | ClipperCredentialSetupStatus) {
  if (status === "ready") return "border-emerald-300/30 bg-emerald-300/10 text-emerald-200";
  if (status === "partial") return "border-amber-300/30 bg-amber-300/10 text-amber-200";
  if (status === "not_prepared") return "border-zinc-600 bg-zinc-900 text-zinc-300";
  return "border-red-300/30 bg-red-300/10 text-red-200";
}

function intakeKitBadge(status: ClipperIntakeKitStatus) {
  if (status === "prepared") return "border-emerald-300/30 bg-emerald-300/10 text-emerald-200";
  return "border-amber-300/30 bg-amber-300/10 text-amber-200";
}

function permissionTrackerBadge(status: ClipperPermissionTrackerStatus | ClipperPermissionTrackerItemStatus) {
  if (status === "ready" || status === "approved") return "border-emerald-300/30 bg-emerald-300/10 text-emerald-200";
  if (status === "in_review" || status === "requested" || status === "ready_to_request") return "border-amber-300/30 bg-amber-300/10 text-amber-200";
  return "border-red-300/30 bg-red-300/10 text-red-200";
}

function permissionRequestPackBadge(status: ClipperPermissionRequestPackStatus) {
  if (status === "ready") return "border-emerald-300/30 bg-emerald-300/10 text-emerald-200";
  if (status === "partial") return "border-amber-300/30 bg-amber-300/10 text-amber-200";
  if (status === "not_prepared") return "border-zinc-600 bg-zinc-900 text-zinc-300";
  return "border-red-300/30 bg-red-300/10 text-red-200";
}

function goLiveAutopilotBadge(status: ClipperGoLiveAutopilotBriefStatus | ClipperGoLiveAutopilotActionStatus | ClipperGoLiveAutopilotRunStatus | ClipperGoLiveAutopilotRunItemStatus) {
  if (status === "ready" || status === "done" || status === "completed") return "border-emerald-300/30 bg-emerald-300/10 text-emerald-200";
  if (status === "in_progress" || status === "run_in_app" || status === "waiting" || status === "partial" || status === "skipped") return "border-amber-300/30 bg-amber-300/10 text-amber-200";
  if (status === "not_prepared" || status === "not_run") return "border-zinc-600 bg-zinc-900 text-zinc-300";
  return "border-red-300/30 bg-red-300/10 text-red-200";
}

function growthAuditBadge(status: ClipperGrowthAuditStatus) {
  if (status === "ready") return "border-emerald-300/30 bg-emerald-300/10 text-emerald-200";
  if (status === "warning") return "border-amber-300/30 bg-amber-300/10 text-amber-200";
  return "border-red-300/30 bg-red-300/10 text-red-200";
}

function driveWorkspaceBadge(status: ClipperDriveWorkspaceStatus) {
  if (status === "ready") return "border-emerald-300/30 bg-emerald-300/10 text-emerald-200";
  if (status === "needs_oauth") return "border-amber-300/30 bg-amber-300/10 text-amber-200";
  return "border-red-300/30 bg-red-300/10 text-red-200";
}

function metricsBadge(status: ClipperMetricsStatus | ClipperAccountMetricPerformance["status"]) {
  if (status === "ready" || status === "scaling") return "border-emerald-300/30 bg-emerald-300/10 text-emerald-200";
  if (status === "needs_records" || status === "watch") return "border-amber-300/30 bg-amber-300/10 text-amber-200";
  return "border-red-300/30 bg-red-300/10 text-red-200";
}

function trendRadarBadge(status: ClipperTrendRadarStatus | ClipperAssetRightsStatus) {
  if (status === "ready" || status === "owned_or_permissioned") return "border-emerald-300/30 bg-emerald-300/10 text-emerald-200";
  if (status === "needs_review" || status === "review_required") return "border-amber-300/30 bg-amber-300/10 text-amber-200";
  return "border-red-300/30 bg-red-300/10 text-red-200";
}

function trendRightsOutreachBadge(status: ClipperTrendRightsOutreachStatus | ClipperTrendRightsOutreachItemStatus) {
  if (status === "ready" || status === "permission_recorded") return "border-emerald-300/30 bg-emerald-300/10 text-emerald-200";
  if (status === "partial" || status === "ready_to_contact") return "border-amber-300/30 bg-amber-300/10 text-amber-200";
  if (status === "not_prepared") return "border-zinc-600 bg-zinc-900 text-zinc-300";
  return "border-red-300/30 bg-red-300/10 text-red-200";
}

function viralDiscoveryBadge(status: ClipperViralDiscoveryStatus | ClipperViralDiscoveryPriority) {
  if (status === "ready" || status === "must_scan") return "border-emerald-300/30 bg-emerald-300/10 text-emerald-200";
  if (status === "watch") return "border-amber-300/30 bg-amber-300/10 text-amber-200";
  if (status === "not_prepared") return "border-zinc-600 bg-zinc-900 text-zinc-300";
  return "border-cyan-300/30 bg-cyan-300/10 text-cyan-200";
}

const tunnelGridClass = "clipper-tunnel-grid";
const tunnelStackClass = "clipper-tunnel-stack";
const tunnelBoxClass = "clipper-tunnel-box rounded-md border border-white/10 bg-black/35 p-3";
const launchEvidenceBatchHeader = "kind,account_id,platform,status,scope,app_identifier,public_base_url,notes";
const trendCandidatesBatchHeader = "category,platform,title,url,source,posted_at,views,likes,comments,shares,rights,angle";
const sourceIntakeBatchHeader = "category,title,url,source,platform,target_file_name,rights_status,evidence_link,priority,notes";
const googleCredentialEnvTemplate = [
  "# Google / YouTube / Drive OAuth",
  "GOOGLE_CLIENT_ID=",
  "GOOGLE_CLIENT_SECRET=",
  "GOOGLE_DRIVE_REFRESH_TOKEN=",
].join("\n");
const googleOAuthJsonTemplate = [
  "{",
  "  \"web\": {",
  "    \"client_id\": \"PASTE_GOOGLE_CLIENT_ID\",",
  "    \"client_secret\": \"PASTE_GOOGLE_CLIENT_SECRET\"",
  "  }",
  "}",
].join("\n");
const credentialSecretEnvVarOptions = [
  "TIKTOK_CLIENT_KEY",
  "TIKTOK_CLIENT_ID",
  "TIKTOK_CLIENT_SECRET",
  "META_APP_ID",
  "META_APP_SECRET",
  "FACEBOOK_APP_ID",
  "FACEBOOK_APP_SECRET",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_OAUTH_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_OAUTH_CLIENT_SECRET",
  "GOOGLE_DRIVE_CLIENT_ID",
  "GOOGLE_DRIVE_OAUTH_CLIENT_ID",
  "GOOGLE_DRIVE_CLIENT_SECRET",
  "GOOGLE_DRIVE_OAUTH_CLIENT_SECRET",
  "YOUTUBE_CLIENT_ID",
  "YOUTUBE_OAUTH_CLIENT_ID",
  "YOUTUBE_CLIENT_SECRET",
  "YOUTUBE_OAUTH_CLIENT_SECRET",
  "GOOGLE_DRIVE_REFRESH_TOKEN",
  "GOOGLE_REFRESH_TOKEN",
  "GOOGLE_OAUTH_REFRESH_TOKEN",
  "YOUTUBE_REFRESH_TOKEN",
  "CLIPPERS_TOKEN_ENCRYPTION_KEY",
  "PUBLIC_BASE_URL",
];

function StatCard({ icon: Icon, label, value, detail }: { icon: typeof Target; label: string; value: string; detail: string }) {
  return (
    <Card className="border-zinc-800 bg-zinc-950/70">
      <CardContent className="flex items-center gap-3 p-4">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-black">
          <Icon className="h-5 w-5 text-cyan-200" />
        </div>
        <div className="min-w-0">
          <p className="text-xs text-zinc-500">{label}</p>
          <p className="truncate text-xl font-semibold text-white">{value}</p>
          <p className="truncate text-xs text-zinc-500">{detail}</p>
        </div>
      </CardContent>
    </Card>
  );
}

export default function ClippersPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [clipsPerAccount, setClipsPerAccount] = useState(8);
  const [publishMode, setPublishMode] = useState<ClipperReport["publishMode"]>("approval_required");
  const [riskTolerance, setRiskTolerance] = useState<ClipperReport["riskTolerance"]>("growth");
  const [lastRun, setLastRun] = useState<ClipperReport | null>(null);
  const [credentialEnvVar, setCredentialEnvVar] = useState("TIKTOK_CLIENT_KEY");
  const [credentialSecretValue, setCredentialSecretValue] = useState("");
  const [credentialBatchText, setCredentialBatchText] = useState("");
  const [credentialBatchPreview, setCredentialBatchPreview] = useState<ClipperCredentialSecretBatchWriteSummary | null>(null);
  const [launchEvidenceBatchText, setLaunchEvidenceBatchText] = useState("");
  const [launchEvidenceBatchPreview, setLaunchEvidenceBatchPreview] = useState<ClipperLaunchEvidenceBatchSummary | null>(null);
  const [trendCandidatesBatchText, setTrendCandidatesBatchText] = useState("");
  const [sourceIntakeBatchText, setSourceIntakeBatchText] = useState("");
  const [sourceIntakeBatch, setSourceIntakeBatch] = useState<ClipperSourceIntakeBatchSummary | null>(null);
  const [sourceDropImport, setSourceDropImport] = useState<ClipperSourceDropImportSummary | null>(null);
  const [renderedClips, setRenderedClips] = useState<ClipperRenderedClipSummary | null>(null);
  const [publishingPackage, setPublishingPackage] = useState<ClipperPublishingPackageSummary | null>(null);
  const [productionPublicUrl, setProductionPublicUrl] = useState("");
  const [accountEvidenceTaskId, setAccountEvidenceTaskId] = useState("");
  const [accountEvidenceStatus, setAccountEvidenceStatus] = useState<ClipperAccountEvidenceItemStatus>("submitted");
  const [accountEvidenceNotes, setAccountEvidenceNotes] = useState("Cuenta creada o en proceso; revisar antes de marcar verified.");
  const [developerEvidencePlatform, setDeveloperEvidencePlatform] = useState<ClipperPlatform>("tiktok");
  const [developerEvidenceStatus, setDeveloperEvidenceStatus] = useState<ClipperDeveloperAppEvidenceItemStatus>("submitted");
  const [developerEvidenceAppIdentifier, setDeveloperEvidenceAppIdentifier] = useState("");
  const [developerEvidencePublicBaseUrl, setDeveloperEvidencePublicBaseUrl] = useState("");
  const [developerEvidenceNotes, setDeveloperEvidenceNotes] = useState("App creada o enviada a review; pendiente aprobacion.");
  const [permissionRecordId, setPermissionRecordId] = useState("");
  const [permissionRecordStatus, setPermissionRecordStatus] = useState<ClipperPermissionTrackerItemStatus>("requested");
  const [permissionRecordNotes, setPermissionRecordNotes] = useState("Permiso solicitado/app review en progreso.");

  const { data: status, isLoading, refetch } = useQuery<ClipperStatus>({
    queryKey: ["/api/clippers/status"],
  });
  const credentialEnvVarOptions = useMemo(() => {
    const fromDoctor = status?.credentialDoctor?.items.flatMap((item) => item.acceptedEnvVarGroups.flat()) || [];
    return Array.from(new Set([...fromDoctor, ...credentialSecretEnvVarOptions])).sort();
  }, [status?.credentialDoctor]);

  const runMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/clippers/run-daily-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clipsPerAccount, publishMode, riskTolerance }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No pude generar el plan diario");
      return data as { report: ClipperReport; status: ClipperStatus };
    },
    onSuccess: (data) => {
      setLastRun(data.report);
      queryClient.setQueryData(["/api/clippers/status"], data.status);
      toast({
        title: "Plan diario listo",
        description: `${data.report.plannedClips.length} drafts propuestos para revisar.`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "Fallo el plan", description: error.message, variant: "destructive" });
    },
  });

  const bootstrapMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/clippers/bootstrap-accounts", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No pude preparar las cuentas");
      return data as ClipperStatus;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["/api/clippers/status"], data);
      toast({
        title: "Cuentas preparadas",
        description: "Cree el setup interno para deportes, memes y streamers en las plataformas.",
      });
    },
    onError: (error: Error) => {
      toast({ title: "No pude preparar cuentas", description: error.message, variant: "destructive" });
    },
  });

  const workspaceMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/clippers/bootstrap-workspace", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No pude preparar el workspace");
      return data as ClipperStatus;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["/api/clippers/status"], data);
      toast({
        title: "Workspace preparado",
        description: "Carpetas de fuentes, allowlist, drafts y scheduled quedaron listas.",
      });
    },
    onError: (error: Error) => {
      toast({ title: "No pude preparar workspace", description: error.message, variant: "destructive" });
    },
  });

  const accountIdentityKitMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/clippers/prepare-account-identity-kit", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No pude preparar el identity kit");
      return data as { accountIdentityKit: ClipperAccountIdentityKitSummary; status: ClipperStatus };
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["/api/clippers/status"], data.status);
      toast({
        title: "Identity kit preparado",
        description: `${data.accountIdentityKit.totals.platformProfiles} perfiles y ${data.accountIdentityKit.totals.firstPostIdeas} ideas iniciales.`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "No pude preparar identity kit", description: error.message, variant: "destructive" });
    },
  });

  const accountLaunchKitMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/clippers/prepare-account-launch-kit", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No pude preparar el launch kit");
      return data as { accountLaunchKit: ClipperAccountLaunchKitSummary; status: ClipperStatus };
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["/api/clippers/status"], data.status);
      toast({
        title: "Launch kit preparado",
        description: `${data.accountLaunchKit.totals.tasks} tareas para crear/verificar cuentas por plataforma.`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "No pude preparar launch kit", description: error.message, variant: "destructive" });
    },
  });

  const manualPostingPackMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/clippers/prepare-manual-posting-pack", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No pude preparar el manual posting pack");
      return data as { manualPostingPack: ClipperManualPostingPackSummary; status: ClipperStatus };
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["/api/clippers/status"], data.status);
      toast({
        title: "Manual posting pack listo",
        description: `${data.manualPostingPack.totals.readyToPost}/${data.manualPostingPack.totals.posts} posts listos para subir manualmente.`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "No pude preparar manual posting pack", description: error.message, variant: "destructive" });
    },
  });

  const accountCreationPackMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/clippers/prepare-account-creation-pack", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No pude preparar account creation pack");
      return data as { accountCreationPack: ClipperAccountCreationPackSummary; status: ClipperStatus };
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["/api/clippers/status"], data.status);
      toast({
        title: "Account creation pack listo",
        description: `${data.accountCreationPack.totals.profiles} perfiles; ${data.accountCreationPack.totals.evidenceMissing} sin evidencia.`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "No pude preparar cuentas", description: error.message, variant: "destructive" });
    },
  });

  const accountEvidenceMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/clippers/prepare-account-evidence-vault", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No pude preparar evidencia de cuentas");
      return data as { accountEvidence: ClipperAccountEvidenceSummary; status: ClipperStatus };
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["/api/clippers/status"], data.status);
      toast({
        title: "Evidence vault listo",
        description: `${data.accountEvidence.totals.expected} templates, ${data.accountEvidence.totals.verified} verificados.`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "No pude preparar evidencia", description: error.message, variant: "destructive" });
    },
  });

  const developerAppEvidenceMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/clippers/prepare-developer-app-evidence-vault", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No pude preparar evidencia de developer apps");
      return data as { developerAppEvidence: ClipperDeveloperAppEvidenceSummary; status: ClipperStatus };
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["/api/clippers/status"], data.status);
      toast({
        title: "Developer apps listas",
        description: `${data.developerAppEvidence.totals.expected} templates, ${data.developerAppEvidence.totals.approved} aprobadas.`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "No pude preparar developer apps", description: error.message, variant: "destructive" });
    },
  });

  const recordAccountEvidenceMutation = useMutation({
    mutationFn: async (payload: { accountId: string; platform: ClipperPlatform; status: ClipperAccountEvidenceItemStatus; notes: string }) => {
      const response = await fetch("/api/clippers/record-account-evidence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No pude registrar evidencia de cuenta");
      return data as { accountEvidence: ClipperAccountEvidenceSummary; status: ClipperStatus };
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["/api/clippers/status"], data.status);
      toast({
        title: "Evidencia registrada",
        description: `${data.accountEvidence.totals.verified}/${data.accountEvidence.totals.expected} cuentas verificadas.`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "No pude registrar evidencia", description: error.message, variant: "destructive" });
    },
  });

  const recordDeveloperAppEvidenceMutation = useMutation({
    mutationFn: async (payload: { platform: ClipperPlatform; status: ClipperDeveloperAppEvidenceItemStatus; appIdentifier: string; publicBaseUrl: string; notes: string }) => {
      const response = await fetch("/api/clippers/record-developer-app-evidence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No pude registrar developer app");
      return data as { developerAppEvidence: ClipperDeveloperAppEvidenceSummary; status: ClipperStatus };
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["/api/clippers/status"], data.status);
      toast({
        title: "Developer app registrada",
        description: `${data.developerAppEvidence.totals.approved}/${data.developerAppEvidence.totals.expected} apps aprobadas.`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "No pude registrar developer app", description: error.message, variant: "destructive" });
    },
  });

  const launchEvidenceBatchPreviewMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/clippers/preview-launch-evidence-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ batchText: launchEvidenceBatchText }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No pude previsualizar evidencia batch");
      return data as { launchEvidenceBatchPreview: ClipperLaunchEvidenceBatchSummary; status: ClipperStatus };
    },
    onSuccess: (data) => {
      setLaunchEvidenceBatchPreview(data.launchEvidenceBatchPreview);
      queryClient.setQueryData(["/api/clippers/status"], data.status);
      const accepted = data.launchEvidenceBatchPreview.accepted;
      toast({
        title: "Preview listo",
        description: `${accepted.accountEvidence} cuentas, ${accepted.developerApps} apps, ${accepted.permissions} permisos, ${accepted.sourceRights} derechos importables; ${data.launchEvidenceBatchPreview.rejected.length} rechazados.`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "No pude previsualizar evidencia", description: error.message, variant: "destructive" });
    },
  });

  const launchEvidenceBatchMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/clippers/record-launch-evidence-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ batchText: launchEvidenceBatchText }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No pude importar evidencia batch");
      return data as { launchEvidenceBatch: ClipperLaunchEvidenceBatchSummary; status: ClipperStatus };
    },
    onSuccess: (data) => {
      setLaunchEvidenceBatchText("");
      setLaunchEvidenceBatchPreview(data.launchEvidenceBatch);
      queryClient.setQueryData(["/api/clippers/status"], data.status);
      const accepted = data.launchEvidenceBatch.accepted;
      toast({
        title: "Evidencia batch importada",
        description: `${accepted.accountEvidence} cuentas, ${accepted.developerApps} apps, ${accepted.permissions} permisos, ${accepted.sourceRights} derechos; ${data.launchEvidenceBatch.rejected.length} rechazados.`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "No pude importar evidencia", description: error.message, variant: "destructive" });
    },
  });

  const launchEvidenceDropImportMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/clippers/import-launch-evidence-drop-files", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No pude importar evidence-drop");
      return data as { launchEvidenceDropImport: ClipperLaunchEvidenceBatchSummary; status: ClipperStatus };
    },
    onSuccess: (data) => {
      setLaunchEvidenceBatchPreview(data.launchEvidenceDropImport);
      queryClient.setQueryData(["/api/clippers/status"], data.status);
      const accepted = data.launchEvidenceDropImport.accepted;
      toast({
        title: "Evidence drop importado",
        description: `${accepted.accountEvidence} cuentas, ${accepted.developerApps} apps, ${accepted.permissions} permisos; ${data.launchEvidenceDropImport.filesImported || 0}/${data.launchEvidenceDropImport.filesScanned || 0} archivos.`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "No pude importar evidence-drop", description: error.message, variant: "destructive" });
    },
  });

  const commandCenterMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/clippers/prepare-command-center", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clipsPerAccount,
          publishMode,
          riskTolerance,
          weeklyTargetClips: 100,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No pude preparar todo Clippers");
      return data as { commandCenter: ClipperLaunchCommandCenterSummary; status: ClipperStatus };
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["/api/clippers/status"], data.status);
      toast({
        title: "Command Center listo",
        description: `${data.commandCenter.totals.done}/${data.commandCenter.totals.steps} gates listos; ${data.commandCenter.totals.blocked} bloqueados.`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "No pude preparar todo", description: error.message, variant: "destructive" });
    },
  });

  const blockerResolutionPackMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/clippers/prepare-blocker-resolution-pack", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No pude preparar blocker resolution pack");
      return data as { blockerResolutionPack: ClipperBlockerResolutionPackSummary; status: ClipperStatus };
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["/api/clippers/status"], data.status);
      toast({
        title: "Blocker pack listo",
        description: `${data.blockerResolutionPack.totals.actions} acciones; ${data.blockerResolutionPack.totals.critical} criticas.`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "No pude preparar blockers", description: error.message, variant: "destructive" });
    },
  });

  const credentialSetupMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/clippers/prepare-credential-setup", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No pude preparar credenciales");
      return data as { credentialSetup: ClipperCredentialSetupSummary; status: ClipperStatus };
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["/api/clippers/status"], data.status);
      toast({
        title: "Credential setup listo",
        description: `${data.credentialSetup.totals.ready}/${data.credentialSetup.totals.items} grupos listos.`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "No pude preparar credenciales", description: error.message, variant: "destructive" });
    },
  });

  const credentialDoctorMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/clippers/prepare-credential-doctor", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No pude correr credential doctor");
      return data as { credentialDoctor: ClipperCredentialDoctorSummary; status: ClipperStatus };
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["/api/clippers/status"], data.status);
      toast({
        title: "Credential doctor listo",
        description: `${data.credentialDoctor.totals.ready}/${data.credentialDoctor.totals.items} grupos ready; ${data.credentialDoctor.totals.missing} faltantes.`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "No pude diagnosticar credenciales", description: error.message, variant: "destructive" });
    },
  });

  const credentialSecretMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/clippers/record-credential-secret", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ envVar: credentialEnvVar, value: credentialSecretValue }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No pude guardar la credencial");
      return data as { credentialSecret: ClipperCredentialSecretWriteSummary; status: ClipperStatus };
    },
    onSuccess: (data) => {
      setCredentialSecretValue("");
      queryClient.setQueryData(["/api/clippers/status"], data.status);
      toast({
        title: "Credencial guardada",
        description: `${data.credentialSecret.envVar} actualizada en ${data.credentialSecret.envFileName}.`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "No pude guardar la credencial", description: error.message, variant: "destructive" });
    },
  });

  const credentialSecretsBatchPreviewMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/clippers/preview-credential-secrets-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ envText: credentialBatchText }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No pude previsualizar el batch de credenciales");
      return data as { credentialSecretsBatchPreview: ClipperCredentialSecretBatchWriteSummary; status: ClipperStatus };
    },
    onSuccess: (data) => {
      setCredentialBatchPreview(data.credentialSecretsBatchPreview);
      queryClient.setQueryData(["/api/clippers/status"], data.status);
      toast({
        title: "Preview de keys listo",
        description: `${data.credentialSecretsBatchPreview.acceptedEnvVars.length} permitidas; ${data.credentialSecretsBatchPreview.rejectedEnvVars.length} rechazadas; ${data.credentialSecretsBatchPreview.skippedLines} skipped.`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "No pude previsualizar keys", description: error.message, variant: "destructive" });
    },
  });

  const credentialSecretsBatchMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/clippers/record-credential-secrets-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ envText: credentialBatchText }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No pude guardar el batch de credenciales");
      return data as { credentialSecretsBatch: ClipperCredentialSecretBatchWriteSummary; status: ClipperStatus };
    },
    onSuccess: (data) => {
      setCredentialBatchText("");
      setCredentialBatchPreview(data.credentialSecretsBatch);
      queryClient.setQueryData(["/api/clippers/status"], data.status);
      toast({
        title: "Credenciales batch guardadas",
        description: `${data.credentialSecretsBatch.acceptedEnvVars.length} guardadas; ${data.credentialSecretsBatch.rejectedEnvVars.length} rechazadas.`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "No pude guardar el batch", description: error.message, variant: "destructive" });
    },
  });

  const credentialDropImportMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/clippers/import-credential-drop-files", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No pude importar archivos de credenciales");
      return data as { credentialDropImport: ClipperCredentialSecretBatchWriteSummary; status: ClipperStatus };
    },
    onSuccess: (data) => {
      setCredentialBatchPreview(data.credentialDropImport);
      queryClient.setQueryData(["/api/clippers/status"], data.status);
      toast({
        title: "Drop credentials importadas",
        description: `${data.credentialDropImport.acceptedEnvVars.length} keys; ${data.credentialDropImport.filesImported || 0}/${data.credentialDropImport.filesScanned || 0} archivos.`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "No pude importar drop files", description: error.message, variant: "destructive" });
    },
  });

  const reloadCredentialsMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/clippers/reload-credentials", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No pude recargar credenciales");
      return data as { credentialReload: ClipperCredentialReloadSummary; status: ClipperStatus };
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["/api/clippers/status"], data.status);
      const found = data.credentialReload.envFilesFound.length ? data.credentialReload.envFilesFound.join(", ") : "ninguno";
      toast({
        title: "Credenciales recargadas",
        description: `${data.credentialReload.credentialSetup.totals.ready}/${data.credentialReload.credentialSetup.totals.items} grupos listos. Archivos: ${found}.`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "No pude recargar credenciales", description: error.message, variant: "destructive" });
    },
  });

  const platformReadinessMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/clippers/prepare-platform-readiness", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No pude preparar platform readiness");
      return data as { platformReadiness: ClipperPlatformReadinessSummary; status: ClipperStatus };
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["/api/clippers/status"], data.status);
      toast({
        title: "Platform readiness lista",
        description: `${data.platformReadiness.totals.ready}/${data.platformReadiness.totals.platforms} plataformas listas; ${data.platformReadiness.totals.blocked} bloqueadas.`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "No pude preparar readiness", description: error.message, variant: "destructive" });
    },
  });

  const externalSetupQueueMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/clippers/prepare-external-setup-queue", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No pude preparar external setup");
      return data as { externalSetupQueue: ClipperExternalSetupQueueSummary; status: ClipperStatus };
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["/api/clippers/status"], data.status);
      toast({
        title: "External setup listo",
        description: `${data.externalSetupQueue.totals.done}/${data.externalSetupQueue.totals.items} tareas listas; ${data.externalSetupQueue.totals.critical} criticas.`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "No pude preparar external setup", description: error.message, variant: "destructive" });
    },
  });

  const externalExecutionHandoffMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/clippers/prepare-external-execution-handoff", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No pude preparar external handoff");
      return data as { externalExecutionHandoff: ClipperExternalExecutionHandoffSummary; status: ClipperStatus };
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["/api/clippers/status"], data.status);
      toast({
        title: "External handoff listo",
        description: `${data.externalExecutionHandoff.totals.items} items; batch ${data.externalExecutionHandoff.batchTemplatePath}`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "No pude preparar external handoff", description: error.message, variant: "destructive" });
    },
  });

  const externalExecutionSessionMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/clippers/prepare-external-execution-session", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No pude preparar external session");
      return data as { externalExecutionSession: ClipperExternalExecutionSessionSummary; status: ClipperStatus };
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["/api/clippers/status"], data.status);
      toast({
        title: "External session lista",
        description: `${data.externalExecutionSession.totals.doNow} do_now; ${data.externalExecutionSession.totals.blocked} blocked; ${data.externalExecutionSession.totals.envTemplates} env templates.`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "No pude preparar external session", description: error.message, variant: "destructive" });
    },
  });

  const externalLaunchDossierMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/clippers/prepare-external-launch-dossier", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No pude preparar launch dossier");
      return data as { externalLaunchDossier: ClipperExternalLaunchDossierSummary; status: ClipperStatus };
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["/api/clippers/status"], data.status);
      toast({
        title: "Launch dossier listo",
        description: `${data.externalLaunchDossier.totals.ready}/${data.externalLaunchDossier.totals.platforms} plataformas listas; ${data.externalLaunchDossier.totals.criticalActions} acciones criticas.`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "No pude preparar launch dossier", description: error.message, variant: "destructive" });
    },
  });

  const platformPortalChecklistMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/clippers/prepare-platform-portal-checklist", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No pude preparar platform portal checklist");
      return data as { platformPortalChecklist: ClipperPlatformPortalChecklistSummary; status: ClipperStatus };
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["/api/clippers/status"], data.status);
      toast({
        title: "Portal checklist listo",
        description: `${data.platformPortalChecklist.totals.ready}/${data.platformPortalChecklist.totals.platforms} plataformas listas; ${data.platformPortalChecklist.totals.portalActions} acciones; ${data.platformPortalChecklist.totals.evidenceRows} evidence rows.`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "No pude preparar portal checklist", description: error.message, variant: "destructive" });
    },
  });

  const officialPermissionMatrixMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/clippers/prepare-official-permission-matrix", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No pude preparar matriz oficial de permisos");
      return data as { officialPermissionMatrix: ClipperOfficialPermissionMatrixSummary; status: ClipperStatus };
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["/api/clippers/status"], data.status);
      toast({
        title: "Matriz oficial lista",
        description: `${data.officialPermissionMatrix.totals.scopes} scopes; ${data.officialPermissionMatrix.totals.loginRequired} fuente requiere login.`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "No pude preparar matriz oficial", description: error.message, variant: "destructive" });
    },
  });

  const appReviewSubmissionPackMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/clippers/prepare-app-review-submission-pack", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No pude preparar app review pack");
      return data as { appReviewSubmissionPack: ClipperAppReviewSubmissionPackSummary; status: ClipperStatus };
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["/api/clippers/status"], data.status);
      toast({
        title: "App review pack listo",
        description: `${data.appReviewSubmissionPack.totals.answers} respuestas y ${data.appReviewSubmissionPack.totals.evidenceItems} evidencias preparadas.`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "No pude preparar app review", description: error.message, variant: "destructive" });
    },
  });

  const publisherConnectorsMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/clippers/prepare-publisher-connectors", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No pude preparar publisher connectors");
      return data as { publisherConnectors: ClipperPublisherConnectorSummary; status: ClipperStatus };
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["/api/clippers/status"], data.status);
      toast({
        title: "Publisher connectors listos",
        description: `${data.publisherConnectors.totals.ready}/${data.publisherConnectors.totals.platforms} conectores ready; ${data.publisherConnectors.totals.blocked} bloqueados.`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "No pude preparar connectors", description: error.message, variant: "destructive" });
    },
  });

  const productionUrlSetupMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/clippers/prepare-production-url-setup", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No pude preparar production URL setup");
      return data as { productionUrlSetup: ClipperProductionUrlSetupSummary; status: ClipperStatus };
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["/api/clippers/status"], data.status);
      toast({
        title: "Production URL setup listo",
        description: data.productionUrlSetup.productionUrlReady ? "URL publica HTTPS lista para redirect URIs." : "Falta PUBLIC_BASE_URL publica HTTPS para go-live.",
      });
    },
    onError: (error: Error) => {
      toast({ title: "No pude preparar Prod URL", description: error.message, variant: "destructive" });
    },
  });

  const productionUrlVerificationMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/clippers/verify-production-url", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No pude verificar production URL");
      return data as { productionUrlVerification: ClipperProductionUrlVerificationSummary; status: ClipperStatus };
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["/api/clippers/status"], data.status);
      toast({
        title: "Production URL verificada",
        description: `${data.productionUrlVerification.totals.pass}/${data.productionUrlVerification.totals.endpoints} endpoints pass; ${data.productionUrlVerification.totals.fail} fail.`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "No pude verificar Production URL", description: error.message, variant: "destructive" });
    },
  });

  const productionPublicUrlMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/clippers/record-production-public-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ publicBaseUrl: productionPublicUrl }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No pude guardar PUBLIC_BASE_URL");
      return data as { productionPublicUrl: { publicBaseUrl: string; nextStep: string }; status: ClipperStatus };
    },
    onSuccess: (data) => {
      setProductionPublicUrl("");
      queryClient.setQueryData(["/api/clippers/status"], data.status);
      toast({
        title: "Production URL guardada",
        description: `${data.productionPublicUrl.publicBaseUrl} quedo lista para redirect URIs.`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "No pude guardar Production URL", description: error.message, variant: "destructive" });
    },
  });

  const httpsTunnelPlanMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/clippers/prepare-https-tunnel-plan", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No pude preparar HTTPS tunnel plan");
      return data as { httpsTunnelPlan: ClipperHttpsTunnelPlanSummary; status: ClipperStatus };
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["/api/clippers/status"], data.status);
      toast({
        title: "HTTPS tunnel plan listo",
        description: `${data.httpsTunnelPlan.options.length} opciones; recomendada ${data.httpsTunnelPlan.recommendedOptionId}.`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "No pude preparar tunnel plan", description: error.message, variant: "destructive" });
    },
  });

  const legalPolicyPackMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/clippers/prepare-legal-policy-pack", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No pude preparar legal policy pack");
      return data as { legalPolicyPack: ClipperLegalPolicyPackSummary; status: ClipperStatus };
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["/api/clippers/status"], data.status);
      toast({
        title: "Legal policy pack listo",
        description: data.legalPolicyPack.productionUrlReady ? "Privacy y Terms listos para app review." : "Privacy y Terms listos localmente; falta URL publica HTTPS.",
      });
    },
    onError: (error: Error) => {
      toast({ title: "No pude preparar legal pack", description: error.message, variant: "destructive" });
    },
  });

  const appReviewDemoPackMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/clippers/prepare-app-review-demo-pack", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No pude preparar app review demo");
      return data as { appReviewDemoPack: ClipperAppReviewDemoPackSummary; status: ClipperStatus };
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["/api/clippers/status"], data.status);
      toast({
        title: "Review demo lista",
        description: data.appReviewDemoPack.productionUrlReady ? "Demo publica lista para app review." : "Demo local lista; falta URL publica HTTPS.",
      });
    },
    onError: (error: Error) => {
      toast({ title: "No pude preparar review demo", description: error.message, variant: "destructive" });
    },
  });

  const developerApplicationDraftsMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/clippers/prepare-developer-application-drafts", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No pude preparar developer application drafts");
      return data as { developerApplicationDrafts: ClipperDeveloperApplicationDraftsSummary; status: ClipperStatus };
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["/api/clippers/status"], data.status);
      toast({
        title: "Developer app drafts listos",
        description: `${data.developerApplicationDrafts.totals.scopes} scopes y ${data.developerApplicationDrafts.totals.checklistItems} pasos preparados.`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "No pude preparar app drafts", description: error.message, variant: "destructive" });
    },
  });

  const oauthGoLiveMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/clippers/prepare-oauth-go-live", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No pude preparar OAuth go-live");
      return data as { oauthGoLive: ClipperOAuthGoLiveSummary; status: ClipperStatus };
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["/api/clippers/status"], data.status);
      toast({
        title: "OAuth go-live listo",
        description: `${data.oauthGoLive.totals.ready}/${data.oauthGoLive.totals.platforms} plataformas ready; ${data.oauthGoLive.totals.blocked} bloqueadas.`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "No pude preparar OAuth", description: error.message, variant: "destructive" });
    },
  });

  const oauthConnectionPackMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/clippers/prepare-oauth-connection-pack", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No pude preparar OAuth connection pack");
      return data as { oauthConnectionPack: ClipperOAuthConnectionPackSummary; status: ClipperStatus };
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["/api/clippers/status"], data.status);
      toast({
        title: "OAuth connection pack listo",
        description: `${data.oauthConnectionPack.totals.ready}/${data.oauthConnectionPack.totals.connections} conexiones ready; ${data.oauthConnectionPack.totals.tokensSaved} tokens guardados.`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "No pude preparar OAuth pack", description: error.message, variant: "destructive" });
    },
  });

  const goLiveExecutionPackMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/clippers/prepare-go-live-execution-pack", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No pude preparar el go-live execution pack");
      return data as { goLiveExecutionPack: ClipperGoLiveExecutionPackSummary; status: ClipperStatus };
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["/api/clippers/status"], data.status);
      toast({
        title: "Go-live pack listo",
        description: `${data.goLiveExecutionPack.totals.done}/${data.goLiveExecutionPack.totals.phases} fases completas; ${data.goLiveExecutionPack.totals.readyToExecute} listas para ejecutar.`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "No pude preparar go-live pack", description: error.message, variant: "destructive" });
    },
  });

  const goLiveAutopilotBriefMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/clippers/prepare-go-live-autopilot-brief", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No pude preparar el go-live autopilot brief");
      return data as { goLiveAutopilotBrief: ClipperGoLiveAutopilotBriefSummary; status: ClipperStatus };
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["/api/clippers/status"], data.status);
      toast({
        title: "Autopilot brief listo",
        description: `${data.goLiveAutopilotBrief.totals.inAppReady} in-app, ${data.goLiveAutopilotBrief.totals.externalRequired} externos, ${data.goLiveAutopilotBrief.totals.blocked} bloqueados.`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "No pude preparar autopilot brief", description: error.message, variant: "destructive" });
    },
  });

  const goLiveAutopilotRunMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/clippers/run-go-live-autopilot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ maxActions: 3 }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No pude correr el go-live autopilot");
      return data as { goLiveAutopilotRun: ClipperGoLiveAutopilotRunSummary; goLiveAutopilotBrief: ClipperGoLiveAutopilotBriefSummary; status: ClipperStatus };
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["/api/clippers/status"], data.status);
      toast({
        title: "Autopilot ejecutado",
        description: `${data.goLiveAutopilotRun.totals.completed} completadas, ${data.goLiveAutopilotRun.totals.skipped} saltadas, ${data.goLiveAutopilotRun.totals.failed} fallidas.`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "No pude correr Autopilot", description: error.message, variant: "destructive" });
    },
  });

  const permissionPackMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/clippers/prepare-permissions", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No pude preparar los permisos");
      return data as { pack: ClipperPermissionPack; status: ClipperStatus };
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["/api/clippers/status"], data.status);
      toast({
        title: "Permisos preparados",
        description: `${data.pack.files.length} archivos listos para app review y OAuth.`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "No pude preparar permisos", description: error.message, variant: "destructive" });
    },
  });

  const permissionTrackerMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/clippers/prepare-permission-tracker", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No pude preparar el tracker de permisos");
      return data as { permissionTracker: ClipperPermissionTrackerSummary; status: ClipperStatus };
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["/api/clippers/status"], data.status);
      toast({
        title: "Permission tracker listo",
        description: `${data.permissionTracker.totals.permissions} permisos, ${data.permissionTracker.totals.blocked} bloqueados.`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "No pude preparar tracker", description: error.message, variant: "destructive" });
    },
  });

  const permissionRequestPackMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/clippers/prepare-permission-request-pack", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No pude preparar permission request pack");
      return data as { permissionRequestPack: ClipperPermissionRequestPackSummary; status: ClipperStatus };
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["/api/clippers/status"], data.status);
      toast({
        title: "Permission request pack listo",
        description: `${data.permissionRequestPack.totals.permissions} solicitudes; ${data.permissionRequestPack.totals.blocked} bloqueadas.`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "No pude preparar request pack", description: error.message, variant: "destructive" });
    },
  });

  const recordPermissionStatusMutation = useMutation({
    mutationFn: async (payload: { platform: ClipperPlatform; scope: string; status: ClipperPermissionTrackerItemStatus; notes: string }) => {
      const response = await fetch("/api/clippers/record-permission-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No pude registrar el permiso");
      return data as { permissionTracker: ClipperPermissionTrackerSummary; status: ClipperStatus };
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["/api/clippers/status"], data.status);
      toast({
        title: "Permiso actualizado",
        description: `${data.permissionTracker.totals.approved}/${data.permissionTracker.totals.permissions} aprobados; ${data.permissionTracker.totals.requested} solicitados.`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "No pude registrar permiso", description: error.message, variant: "destructive" });
    },
  });

  const driveWorkspaceMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/clippers/prepare-drive-workspace", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No pude preparar Google Drive");
      return data as { driveWorkspace: ClipperDriveWorkspaceSummary; status: ClipperStatus };
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["/api/clippers/status"], data.status);
      toast({
        title: data.driveWorkspace.status === "ready" ? "Drive preparado" : "Drive requiere accion",
        description: data.driveWorkspace.nextStep,
      });
    },
    onError: (error: Error) => {
      toast({ title: "No pude preparar Drive", description: error.message, variant: "destructive" });
    },
  });

  const intakeKitMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/clippers/prepare-intake-kit", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No pude preparar intake kit");
      return data as { intakeKit: ClipperIntakeKitSummary; status: ClipperStatus };
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["/api/clippers/status"], data.status);
      toast({
        title: "Intake kit listo",
        description: `${data.intakeKit.files.length} templates para alimentar Clippers.`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "No pude preparar intake kit", description: error.message, variant: "destructive" });
    },
  });

  const sourceAcquisitionMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/clippers/prepare-source-acquisition", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No pude preparar source plan");
      return data as { sourceAcquisition: ClipperSourceAcquisitionSummary; status: ClipperStatus };
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["/api/clippers/status"], data.status);
      toast({
        title: "Source plan listo",
        description: `${data.sourceAcquisition.totals.readyQueueSlots}/${data.sourceAcquisition.totals.dailySlots} slots listos; ${data.sourceAcquisition.totals.missingSourceSlots} sin fuente.`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "No pude preparar source plan", description: error.message, variant: "destructive" });
    },
  });

  const sourceHuntMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/clippers/prepare-source-hunt", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No pude preparar hunt sheet");
      return data as { sourceHunt: ClipperSourceHuntSummary; status: ClipperStatus };
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["/api/clippers/status"], data.status);
      toast({
        title: "Hunt sheet lista",
        description: `${data.sourceHunt.totals.items} slots; ${data.sourceHunt.totals.needsSource} necesitan fuente.`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "No pude preparar hunt sheet", description: error.message, variant: "destructive" });
    },
  });

  const sourceIntakeBatchMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/clippers/record-source-intake-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ batchText: sourceIntakeBatchText }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No pude importar source intake");
      return data as { sourceIntakeBatch: ClipperSourceIntakeBatchSummary; status: ClipperStatus };
    },
    onSuccess: (data) => {
      setSourceIntakeBatch(data.sourceIntakeBatch);
      queryClient.setQueryData(["/api/clippers/status"], data.status);
      toast({
        title: "Source intake importado",
        description: `${data.sourceIntakeBatch.accepted} sources; ${data.sourceIntakeBatch.totals.ownedOrPermissioned} con fila de derechos lista.`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "No pude importar source intake", description: error.message, variant: "destructive" });
    },
  });

  const rightsOutreachMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/clippers/prepare-rights-outreach", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No pude preparar rights outreach");
      return data as { rightsOutreach: ClipperRightsOutreachSummary; status: ClipperStatus };
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["/api/clippers/status"], data.status);
      toast({
        title: "Rights outreach listo",
        description: `${data.rightsOutreach.totals.readyToContact} listos para contactar; ${data.rightsOutreach.totals.needsTarget} necesitan target.`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "No pude preparar outreach", description: error.message, variant: "destructive" });
    },
  });

  const metricsMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/clippers/ingest-metrics", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No pude ingerir metricas");
      return data as { metrics: ClipperMetricsSummary; status: ClipperStatus };
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["/api/clippers/status"], data.status);
      toast({
        title: data.metrics.status === "ready" ? "Metricas listas" : "Metricas pendientes",
        description: `${data.metrics.records.length} records, ${formatNumber(data.metrics.totals.views)} views importadas.`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "No pude ingerir metricas", description: error.message, variant: "destructive" });
    },
  });

  const trendsMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/clippers/ingest-trends", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No pude ingerir trends");
      return data as { trendRadar: ClipperTrendRadarSummary; status: ClipperStatus };
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["/api/clippers/status"], data.status);
      toast({
        title: data.trendRadar.status === "ready" ? "Trend Radar listo" : "Trends requieren revision",
        description: `${data.trendRadar.candidates.length} oportunidades detectadas.`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "No pude ingerir trends", description: error.message, variant: "destructive" });
    },
  });

  const trendCandidatesBatchMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/clippers/record-trend-candidates-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ batchText: trendCandidatesBatchText }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No pude importar candidatos virales");
      return data as { trendCandidatesBatch: ClipperTrendCandidatesBatchImportSummary; status: ClipperStatus };
    },
    onSuccess: (data) => {
      setTrendCandidatesBatchText("");
      queryClient.setQueryData(["/api/clippers/status"], data.status);
      toast({
        title: "Candidatos importados",
        description: `${data.trendCandidatesBatch.accepted} aceptados; ${data.trendCandidatesBatch.skipped} saltados.`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "No pude importar candidatos", description: error.message, variant: "destructive" });
    },
  });

  const trendRightsOutreachMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/clippers/prepare-trend-rights-outreach", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No pude preparar trend rights outreach");
      return data as { trendRightsOutreach: ClipperTrendRightsOutreachSummary; status: ClipperStatus };
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["/api/clippers/status"], data.status);
      toast({
        title: "Trend rights listo",
        description: `${data.trendRightsOutreach.totals.readyToContact} listos para contactar; ${data.trendRightsOutreach.totals.permissionRecorded} con permiso.`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "No pude preparar trend rights", description: error.message, variant: "destructive" });
    },
  });

  const viralDiscoveryMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/clippers/prepare-viral-discovery", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No pude preparar viral discovery");
      return data as { viralDiscovery: ClipperViralDiscoverySummary; status: ClipperStatus };
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["/api/clippers/status"], data.status);
      toast({
        title: "Viral discovery listo",
        description: `${data.viralDiscovery.totals.queries} busquedas; ${data.viralDiscovery.totals.mustScan} must_scan.`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "No pude preparar viral discovery", description: error.message, variant: "destructive" });
    },
  });

  const productionQueueMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/clippers/prepare-production-queue", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No pude preparar la cola");
      return data as { queue: ClipperProductionQueueSummary; status: ClipperStatus };
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["/api/clippers/status"], data.status);
      toast({
        title: "Cola preparada",
        description: `${data.queue.items.length} items de produccion revisados por Rights Gate.`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "No pude preparar cola", description: error.message, variant: "destructive" });
    },
  });

  const sourceDropImportMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/clippers/import-source-drop-files", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No pude importar source-drop");
      return data as { sourceDropImport: ClipperSourceDropImportSummary; status: ClipperStatus };
    },
    onSuccess: (data) => {
      setSourceDropImport(data.sourceDropImport);
      queryClient.setQueryData(["/api/clippers/status"], data.status);
      toast({
        title: "Source drop importado",
        description: `${data.sourceDropImport.imported}/${data.sourceDropImport.filesScanned} videos importados; ${data.sourceDropImport.queue.sourceAssets.length} assets detectados.`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "No pude importar source-drop", description: error.message, variant: "destructive" });
    },
  });

  const recordSourceRightsMutation = useMutation({
    mutationFn: async (payload: { assetId: string; rightsStatus: ClipperAssetRightsStatus; notes: string }) => {
      const response = await fetch("/api/clippers/record-source-rights", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No pude registrar derechos del asset");
      return data as { sourceRights: ClipperSourceRightsRecord; queue: ClipperProductionQueueSummary; status: ClipperStatus };
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["/api/clippers/status"], data.status);
      const readyAssets = data.queue.sourceAssets.filter((asset) => asset.rightsStatus === "owned_or_permissioned").length;
      toast({
        title: "Derechos registrados",
        description: `${data.sourceRights.fileName} listo. ${readyAssets}/${data.queue.sourceAssets.length} assets con permiso.`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "No pude registrar derechos", description: error.message, variant: "destructive" });
    },
  });

  const draftSpecsMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/clippers/prepare-draft-specs", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No pude preparar draft specs");
      return data as { draftSpecs: ClipperDraftSpecSummary; status: ClipperStatus };
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["/api/clippers/status"], data.status);
      toast({
        title: "Draft specs listos",
        description: `${data.draftSpecs.totals.readyForEdit} specs listos para editar.`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "No pude preparar draft specs", description: error.message, variant: "destructive" });
    },
  });

  const renderDraftVideosMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/clippers/render-draft-videos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ maxClips: 10, durationSeconds: 12 }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No pude renderizar clips");
      return data as { renderedClips: ClipperRenderedClipSummary; status: ClipperStatus };
    },
    onSuccess: (data) => {
      setRenderedClips(data.renderedClips);
      queryClient.setQueryData(["/api/clippers/status"], data.status);
      toast({
        title: data.renderedClips.status === "ready" ? "Clips renderizados" : "Render revisado",
        description: `${data.renderedClips.totals.rendered}/${data.renderedClips.totals.attempted} clips generados.`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "No pude renderizar clips", description: error.message, variant: "destructive" });
    },
  });

  const publishingPackageMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/clippers/prepare-publishing-package", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No pude preparar publishing package");
      return data as { publishingPackage: ClipperPublishingPackageSummary; status: ClipperStatus };
    },
    onSuccess: (data) => {
      setPublishingPackage(data.publishingPackage);
      queryClient.setQueryData(["/api/clippers/status"], data.status);
      toast({
        title: "Publishing package listo",
        description: `${data.publishingPackage.totals.readyForManual}/${data.publishingPackage.totals.items} uploads ready_for_manual.`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "No pude preparar publishing package", description: error.message, variant: "destructive" });
    },
  });

  const automationCycleMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/clippers/run-automation-cycle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clipsPerAccount, publishMode, riskTolerance }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No pude correr el ciclo diario");
      return data as { automation: ClipperAutomationRun; status: ClipperStatus };
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["/api/clippers/status"], data.status);
      toast({
        title: "Ciclo diario listo",
        description: `${data.automation.totals.posts} posts evaluados, ${data.automation.totals.blocked} bloqueados.`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "No pude correr ciclo", description: error.message, variant: "destructive" });
    },
  });

  const automationScheduleMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/clippers/prepare-automation-schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clipsPerAccount,
          publishMode,
          riskTolerance,
          weeklyTargetClips: 100,
          dailyRunTime: "08:30",
          enabled: false,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No pude preparar el schedule");
      return data as { automationSchedule: ClipperAutomationScheduleSummary; status: ClipperStatus };
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["/api/clippers/status"], data.status);
      toast({
        title: "Schedule preparado",
        description: `${data.automationSchedule.dailyRunTime} ${data.automationSchedule.timezone}, ${data.automationSchedule.weeklyTargetClips} clips/semana.`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "No pude preparar schedule", description: error.message, variant: "destructive" });
    },
  });

  const report = lastRun || status?.latestReport || null;
  const reportAny = report as (ClipperReport & { automation?: ClipperAutomationRun }) | null;
  const reportPlannedClips = Array.isArray(reportAny?.plannedClips) ? reportAny.plannedClips : [];
  const reportPublishMode = reportAny?.publishMode || reportAny?.automation?.publishMode || "automation";
  const reportRiskTolerance = reportAny?.riskTolerance || reportAny?.automation?.status || "n/a";
  const reportPath = reportAny?.reportPath || reportAny?.automation?.reportPath || "";
  const accountsById = useMemo(() => {
    return (status?.accounts || []).reduce<Record<string, ClipperAccount>>((lookup, account) => {
      lookup[account.id] = account;
      return lookup;
    }, {});
  }, [status?.accounts]);
  const accountLaunchTasks = status?.accountLaunchKit?.tasks || [];
  const selectedAccountEvidenceTask = accountLaunchTasks.find((task) => task.id === accountEvidenceTaskId) || accountLaunchTasks[0] || null;
  const permissionRecordItems = status?.permissionTracker?.items || [];
  const selectedPermissionRecord = permissionRecordItems.find((item) => item.id === permissionRecordId) || permissionRecordItems[0] || null;

  const recordAccountEvidence = (task: ClipperAccountLaunchTask, evidenceStatus: ClipperAccountEvidenceItemStatus) => {
    const notes = window.prompt("Notas de evidencia", evidenceStatus === "verified"
      ? "Cuenta creada/verificada, bio aplicada y login confirmado."
      : "Cuenta creada o en proceso; revisar antes de marcar verified.");
    if (notes === null) return;
    recordAccountEvidenceMutation.mutate({
      accountId: task.accountId,
      platform: task.platform,
      status: evidenceStatus,
      notes,
    });
  };

  const recordDeveloperAppEvidence = (platform: ClipperPlatform, evidenceStatus: ClipperDeveloperAppEvidenceItemStatus) => {
    const appIdentifier = window.prompt("App ID / Client Key / Project ID no secreto", "");
    if (appIdentifier === null) return;
    const publicBaseUrl = window.prompt("Public HTTPS base URL", "https://clippers.example.com") || "";
    const notes = window.prompt("Notas de app review", evidenceStatus === "approved"
      ? "App review aprobada y redirect URI registrado."
      : "App creada o enviada a review; pendiente aprobacion.");
    if (notes === null) return;
    recordDeveloperAppEvidenceMutation.mutate({
      platform,
      status: evidenceStatus,
      appIdentifier,
      publicBaseUrl,
      notes,
    });
  };

  const submitAccountEvidenceForm = () => {
    if (!selectedAccountEvidenceTask) return;
    recordAccountEvidenceMutation.mutate({
      accountId: selectedAccountEvidenceTask.accountId,
      platform: selectedAccountEvidenceTask.platform,
      status: accountEvidenceStatus,
      notes: accountEvidenceNotes.trim() || "Registrado desde Clippers UI; no incluye secretos.",
    });
  };

  const submitDeveloperEvidenceForm = () => {
    recordDeveloperAppEvidenceMutation.mutate({
      platform: developerEvidencePlatform,
      status: developerEvidenceStatus,
      appIdentifier: developerEvidenceAppIdentifier.trim(),
      publicBaseUrl: developerEvidencePublicBaseUrl.trim() || status?.oauthGoLive?.publicBaseUrl || "http://127.0.0.1:5010",
      notes: developerEvidenceNotes.trim() || "Registrado desde Clippers UI; no incluye client secrets ni tokens.",
    });
  };

  const submitPermissionRecordForm = () => {
    if (!selectedPermissionRecord) return;
    recordPermissionStatusMutation.mutate({
      platform: selectedPermissionRecord.platform,
      scope: selectedPermissionRecord.scope,
      status: permissionRecordStatus,
      notes: permissionRecordNotes.trim() || "Registrado desde Clippers UI; no incluye secretos.",
    });
  };

  const appendLaunchEvidenceBatchRow = (row: string) => {
    const cleanRow = row.trim();
    if (!cleanRow) return;
    setLaunchEvidenceBatchPreview(null);
    setLaunchEvidenceBatchText((current) => {
      const cleanCurrent = current.trim();
      if (!cleanCurrent) return `${launchEvidenceBatchHeader}\n${cleanRow}`;
      return `${cleanCurrent}\n${cleanRow}`;
    });
    toast({
      title: "Fila agregada al batch",
      description: "Completa campos vacios con evidencia real y usa Preview batch antes de importar.",
    });
  };

  const appendLaunchEvidenceBatchRows = (rows: string[]) => {
    const cleanRows = rows.map((row) => row.trim()).filter(Boolean);
    if (!cleanRows.length) return;
    setLaunchEvidenceBatchPreview(null);
    setLaunchEvidenceBatchText((current) => {
      const cleanCurrent = current.trim();
      const rowsText = cleanRows.join("\n");
      if (!cleanCurrent) return `${launchEvidenceBatchHeader}\n${rowsText}`;
      return `${cleanCurrent}\n${rowsText}`;
    });
    toast({
      title: "Rows agregadas al batch",
      description: `${cleanRows.length} filas agregadas. Completa campos vacios con evidencia real y usa Preview batch.`,
    });
  };

  const appendCredentialBatchTemplate = (envVars: string[], label: string) => {
    const uniqueEnvVars = Array.from(new Set(envVars.map((envVar) => envVar.trim()).filter(Boolean)));
    if (!uniqueEnvVars.length) return;
    const template = [`# ${label}`, ...uniqueEnvVars.map((envVar) => `${envVar}=`)].join("\n");
    setCredentialBatchPreview(null);
    setCredentialBatchText((current) => {
      const cleanCurrent = current.trim();
      return cleanCurrent ? `${cleanCurrent}\n${template}` : template;
    });
    toast({
      title: "Template agregado a credenciales",
      description: "Pega los valores reales en el batch y guarda keys; no se enviaran valores vacios.",
    });
  };

  const appendCredentialBatchText = (template: string, title: string) => {
    setCredentialBatchPreview(null);
    setCredentialBatchText((current) => {
      const cleanCurrent = current.trim();
      return cleanCurrent ? `${cleanCurrent}\n\n${template}` : template;
    });
    toast({
      title,
      description: "Reemplaza placeholders con valores reales, usa Preview y luego Guardar batch.",
    });
  };

  const appendCredentialBatchTemplates = (items: ClipperExternalExecutionHandoffItem[]) => {
    const templates = items
      .map((item) => {
        const uniqueEnvVars = Array.from(new Set(item.envVars.map((envVar) => envVar.trim()).filter(Boolean)));
        return uniqueEnvVars.length ? [`# ${item.label}`, ...uniqueEnvVars.map((envVar) => `${envVar}=`)].join("\n") : "";
      })
      .filter(Boolean);
    if (!templates.length) return;
    setCredentialBatchPreview(null);
    setCredentialBatchText((current) => {
      const cleanCurrent = current.trim();
      const templatesText = templates.join("\n");
      return cleanCurrent ? `${cleanCurrent}\n${templatesText}` : templatesText;
    });
    toast({
      title: "Templates de env agregados",
      description: `${templates.length} templates agregados. Pega valores reales antes de guardar keys.`,
    });
  };

  const appendTrendCandidateBatchRow = (row: string) => {
    const cleanRow = row.trim();
    if (!cleanRow) return;
    setTrendCandidatesBatchText((current) => {
      const cleanCurrent = current.trim();
      if (!cleanCurrent) return `${trendCandidatesBatchHeader}\n${cleanRow}`;
      return `${cleanCurrent}\n${cleanRow}`;
    });
    toast({
      title: "Candidate row agregado",
      description: "Reemplaza PASTE_* y metricas reales antes de importar al Trend Radar.",
    });
  };

  return (
    <div className="min-h-screen bg-zinc-950 px-4 py-6 text-white md:px-8" data-testid="clippers-page">
      <div className="mx-auto max-w-7xl space-y-5">
        <header className="flex flex-col gap-4 border-b border-white/10 pb-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3">
            <Link href="/agents-office">
              <Button variant="ghost" size="icon" data-testid="button-back-agents-office">
                <ArrowLeft className="h-5 w-5" />
              </Button>
            </Link>
            <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-white/10 bg-black">
              <Clapperboard className="h-5 w-5 text-amber-200" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold">Clippers Command Center</h1>
              <p className="text-sm text-zinc-500">Cuentas virales, agentes, drafts y reportes de crecimiento</p>
            </div>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              variant="outline"
              onClick={() => refetch()}
              disabled={isLoading}
              className="border-zinc-800"
              data-testid="refresh-clippers-status-button"
            >
              <RefreshCw className={cn("mr-2 h-4 w-4", isLoading && "animate-spin")} />
              Refrescar
            </Button>
            <Button
              onClick={() => commandCenterMutation.mutate()}
              disabled={commandCenterMutation.isPending || isLoading}
              className="bg-white text-zinc-950 hover:bg-zinc-200"
              data-testid="prepare-clippers-command-center-button"
            >
              {commandCenterMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
              Preparar todo
            </Button>
            <Button
              onClick={() => blockerResolutionPackMutation.mutate()}
              disabled={blockerResolutionPackMutation.isPending || isLoading}
              className="bg-red-200 text-zinc-950 hover:bg-red-100"
              data-testid="prepare-clippers-blocker-resolution-pack-button"
            >
              {blockerResolutionPackMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
              Blocker pack
            </Button>
            <Button
              onClick={() => accountIdentityKitMutation.mutate()}
              disabled={accountIdentityKitMutation.isPending || isLoading}
              className="bg-fuchsia-200 text-zinc-950 hover:bg-fuchsia-100"
              data-testid="prepare-clippers-account-identity-kit-button"
            >
              {accountIdentityKitMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Users className="mr-2 h-4 w-4" />}
              Identity kit
            </Button>
            <Button
              onClick={() => credentialSetupMutation.mutate()}
              disabled={credentialSetupMutation.isPending || isLoading}
              className="bg-zinc-200 text-zinc-950 hover:bg-zinc-100"
              data-testid="prepare-clippers-credential-setup-button"
            >
              {credentialSetupMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <KeyRound className="mr-2 h-4 w-4" />}
              Credenciales
            </Button>
            <Button
              onClick={() => credentialDoctorMutation.mutate()}
              disabled={credentialDoctorMutation.isPending || isLoading}
              className="bg-sky-200 text-zinc-950 hover:bg-sky-100"
              data-testid="prepare-clippers-credential-doctor-button"
            >
              {credentialDoctorMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
              Credential doctor
            </Button>
            <Button
              onClick={() => platformReadinessMutation.mutate()}
              disabled={platformReadinessMutation.isPending || isLoading}
              className="bg-lime-200 text-zinc-950 hover:bg-lime-100"
              data-testid="prepare-clippers-platform-readiness-button"
            >
              {platformReadinessMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Gauge className="mr-2 h-4 w-4" />}
              Platforms
            </Button>
            <Button
              onClick={() => appReviewSubmissionPackMutation.mutate()}
              disabled={appReviewSubmissionPackMutation.isPending || isLoading}
              className="bg-violet-200 text-zinc-950 hover:bg-violet-100"
              data-testid="prepare-clippers-app-review-submission-pack-button"
            >
              {appReviewSubmissionPackMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
              App review
            </Button>
            <Button
              onClick={() => productionUrlSetupMutation.mutate()}
              disabled={productionUrlSetupMutation.isPending || isLoading}
              className="bg-teal-200 text-zinc-950 hover:bg-teal-100"
              data-testid="prepare-clippers-production-url-setup-button"
            >
              {productionUrlSetupMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ExternalLink className="mr-2 h-4 w-4" />}
              Prod URL
            </Button>
            <Button
              onClick={() => productionUrlVerificationMutation.mutate()}
              disabled={productionUrlVerificationMutation.isPending || isLoading}
              className="bg-cyan-200 text-zinc-950 hover:bg-cyan-100"
              data-testid="verify-clippers-production-url-button"
            >
              {productionUrlVerificationMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
              Verify URL
            </Button>
            <Button
              onClick={() => httpsTunnelPlanMutation.mutate()}
              disabled={httpsTunnelPlanMutation.isPending || isLoading}
              className="bg-green-200 text-zinc-950 hover:bg-green-100"
              data-testid="prepare-clippers-https-tunnel-plan-button"
            >
              {httpsTunnelPlanMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Network className="mr-2 h-4 w-4" />}
              Tunnel plan
            </Button>
            <Button
              onClick={() => legalPolicyPackMutation.mutate()}
              disabled={legalPolicyPackMutation.isPending || isLoading}
              className="bg-rose-200 text-zinc-950 hover:bg-rose-100"
              data-testid="prepare-clippers-legal-policy-pack-button"
            >
              {legalPolicyPackMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
              Legal URLs
            </Button>
            <Button
              onClick={() => appReviewDemoPackMutation.mutate()}
              disabled={appReviewDemoPackMutation.isPending || isLoading}
              className="bg-fuchsia-200 text-zinc-950 hover:bg-fuchsia-100"
              data-testid="prepare-clippers-app-review-demo-pack-button"
            >
              {appReviewDemoPackMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Eye className="mr-2 h-4 w-4" />}
              Review demo
            </Button>
            <Button
              onClick={() => oauthGoLiveMutation.mutate()}
              disabled={oauthGoLiveMutation.isPending || isLoading}
              className="bg-cyan-200 text-zinc-950 hover:bg-cyan-100"
              data-testid="prepare-clippers-oauth-go-live-button"
            >
              {oauthGoLiveMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <KeyRound className="mr-2 h-4 w-4" />}
              OAuth preflight
            </Button>
            <Button
              onClick={() => oauthConnectionPackMutation.mutate()}
              disabled={oauthConnectionPackMutation.isPending || isLoading}
              className="bg-teal-200 text-zinc-950 hover:bg-teal-100"
              data-testid="prepare-clippers-oauth-connection-pack-button"
            >
              {oauthConnectionPackMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <KeyRound className="mr-2 h-4 w-4" />}
              OAuth pack
            </Button>
            <Button
              onClick={() => goLiveExecutionPackMutation.mutate()}
              disabled={goLiveExecutionPackMutation.isPending || isLoading}
              className="bg-blue-200 text-zinc-950 hover:bg-blue-100"
              data-testid="prepare-clippers-go-live-execution-pack-button"
            >
              {goLiveExecutionPackMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Network className="mr-2 h-4 w-4" />}
              Go-live pack
            </Button>
            <Button
              onClick={() => goLiveAutopilotBriefMutation.mutate()}
              disabled={goLiveAutopilotBriefMutation.isPending || isLoading}
              className="bg-indigo-200 text-zinc-950 hover:bg-indigo-100"
              data-testid="prepare-clippers-go-live-autopilot-brief-button"
            >
              {goLiveAutopilotBriefMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Network className="mr-2 h-4 w-4" />}
              Autopilot brief
            </Button>
            <Button
              onClick={() => goLiveAutopilotRunMutation.mutate()}
              disabled={goLiveAutopilotRunMutation.isPending || isLoading}
              className="bg-emerald-200 text-zinc-950 hover:bg-emerald-100"
              data-testid="run-clippers-go-live-autopilot-button"
            >
              {goLiveAutopilotRunMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
              Run Autopilot
            </Button>
            <Button
              onClick={() => externalSetupQueueMutation.mutate()}
              disabled={externalSetupQueueMutation.isPending || isLoading}
              className="bg-orange-200 text-zinc-950 hover:bg-orange-100"
              data-testid="prepare-clippers-external-setup-button"
            >
              {externalSetupQueueMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Network className="mr-2 h-4 w-4" />}
              External setup
            </Button>
            <Button
              onClick={() => externalExecutionHandoffMutation.mutate()}
              disabled={externalExecutionHandoffMutation.isPending || isLoading}
              className="bg-lime-200 text-zinc-950 hover:bg-lime-100"
              data-testid="prepare-clippers-external-execution-handoff-button"
            >
              {externalExecutionHandoffMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ExternalLink className="mr-2 h-4 w-4" />}
              External handoff
            </Button>
            <Button
              onClick={() => externalExecutionSessionMutation.mutate()}
              disabled={externalExecutionSessionMutation.isPending || isLoading}
              className="bg-green-200 text-zinc-950 hover:bg-green-100"
              data-testid="prepare-clippers-external-execution-session-button"
            >
              {externalExecutionSessionMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ExternalLink className="mr-2 h-4 w-4" />}
              External session
            </Button>
            <Button
              onClick={() => externalLaunchDossierMutation.mutate()}
              disabled={externalLaunchDossierMutation.isPending || isLoading}
              className="bg-amber-200 text-zinc-950 hover:bg-amber-100"
              data-testid="prepare-clippers-external-launch-dossier-button"
            >
              {externalLaunchDossierMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ExternalLink className="mr-2 h-4 w-4" />}
              Launch dossier
            </Button>
            <Button
              onClick={() => platformPortalChecklistMutation.mutate()}
              disabled={platformPortalChecklistMutation.isPending || isLoading}
              className="bg-yellow-200 text-zinc-950 hover:bg-yellow-100"
              data-testid="prepare-clippers-platform-portal-checklist-button"
            >
              {platformPortalChecklistMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Network className="mr-2 h-4 w-4" />}
              Portal checklist
            </Button>
            <Button
              variant="outline"
              onClick={() => reloadCredentialsMutation.mutate()}
              disabled={reloadCredentialsMutation.isPending || isLoading}
              className="border-zinc-800"
              data-testid="reload-clippers-credentials-button"
            >
              <RefreshCw className={cn("mr-2 h-4 w-4", reloadCredentialsMutation.isPending && "animate-spin")} />
              Reload keys
            </Button>
            <Button
              onClick={() => runMutation.mutate()}
              disabled={runMutation.isPending || isLoading}
              className="bg-amber-200 text-zinc-950 hover:bg-amber-100"
              data-testid="run-clippers-daily-plan-button"
            >
              {runMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
              Generar plan diario
            </Button>
            <Button
              onClick={() => bootstrapMutation.mutate()}
              disabled={bootstrapMutation.isPending || isLoading}
              className="bg-cyan-200 text-zinc-950 hover:bg-cyan-100"
              data-testid="bootstrap-clippers-accounts-button"
            >
              {bootstrapMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <KeyRound className="mr-2 h-4 w-4" />}
              Preparar cuentas
            </Button>
            <Button
              onClick={() => accountLaunchKitMutation.mutate()}
              disabled={accountLaunchKitMutation.isPending || isLoading}
              className="bg-fuchsia-200 text-zinc-950 hover:bg-fuchsia-100"
              data-testid="prepare-clippers-account-launch-kit-button"
            >
              {accountLaunchKitMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Users className="mr-2 h-4 w-4" />}
              Launch kit
            </Button>
            <Button
              onClick={() => accountCreationPackMutation.mutate()}
              disabled={accountCreationPackMutation.isPending || isLoading}
              className="bg-green-200 text-zinc-950 hover:bg-green-100"
              data-testid="prepare-clippers-account-creation-pack-button"
            >
              {accountCreationPackMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Users className="mr-2 h-4 w-4" />}
              Create pack
            </Button>
            <Button
              onClick={() => manualPostingPackMutation.mutate()}
              disabled={manualPostingPackMutation.isPending || isLoading}
              className="bg-emerald-200 text-zinc-950 hover:bg-emerald-100"
              data-testid="prepare-clippers-manual-posting-pack-button"
            >
              {manualPostingPackMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <UploadCloud className="mr-2 h-4 w-4" />}
              Manual pack
            </Button>
            <Button
              onClick={() => accountEvidenceMutation.mutate()}
              disabled={accountEvidenceMutation.isPending || isLoading}
              className="bg-purple-200 text-zinc-950 hover:bg-purple-100"
              data-testid="prepare-clippers-account-evidence-button"
            >
              {accountEvidenceMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
              Evidencia cuentas
            </Button>
            <Button
              onClick={() => developerAppEvidenceMutation.mutate()}
              disabled={developerAppEvidenceMutation.isPending || isLoading}
              className="bg-blue-200 text-zinc-950 hover:bg-blue-100"
              data-testid="prepare-clippers-developer-app-evidence-button"
            >
              {developerAppEvidenceMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <KeyRound className="mr-2 h-4 w-4" />}
              Developer apps
            </Button>
            <Button
              onClick={() => workspaceMutation.mutate()}
              disabled={workspaceMutation.isPending || isLoading}
              className="bg-emerald-200 text-zinc-950 hover:bg-emerald-100"
              data-testid="bootstrap-clippers-workspace-button"
            >
              {workspaceMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FolderOpen className="mr-2 h-4 w-4" />}
              Preparar workspace
            </Button>
            <Button
              onClick={() => permissionPackMutation.mutate()}
              disabled={permissionPackMutation.isPending || isLoading}
              className="bg-violet-200 text-zinc-950 hover:bg-violet-100"
              data-testid="prepare-clippers-permissions-button"
            >
              {permissionPackMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
              Preparar permisos
            </Button>
            <Button
              onClick={() => permissionTrackerMutation.mutate()}
              disabled={permissionTrackerMutation.isPending || isLoading}
              className="bg-indigo-200 text-zinc-950 hover:bg-indigo-100"
              data-testid="prepare-clippers-permission-tracker-button"
            >
              {permissionTrackerMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
              Tracker permisos
            </Button>
            <Button
              onClick={() => permissionRequestPackMutation.mutate()}
              disabled={permissionRequestPackMutation.isPending || isLoading}
              className="bg-blue-200 text-zinc-950 hover:bg-blue-100"
              data-testid="prepare-clippers-permission-request-pack-button"
            >
              {permissionRequestPackMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
              Request pack
            </Button>
            <Button
              onClick={() => officialPermissionMatrixMutation.mutate()}
              disabled={officialPermissionMatrixMutation.isPending || isLoading}
              className="bg-stone-200 text-zinc-950 hover:bg-stone-100"
              data-testid="prepare-clippers-official-permission-matrix-button"
            >
              {officialPermissionMatrixMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
              Permisos oficiales
            </Button>
            <Button
              onClick={() => developerApplicationDraftsMutation.mutate()}
              disabled={developerApplicationDraftsMutation.isPending || isLoading}
              className="bg-slate-200 text-zinc-950 hover:bg-slate-100"
              data-testid="prepare-clippers-developer-application-drafts-button"
            >
              {developerApplicationDraftsMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
              App drafts
            </Button>
            <Button
              onClick={() => driveWorkspaceMutation.mutate()}
              disabled={driveWorkspaceMutation.isPending || isLoading}
              className="bg-sky-200 text-zinc-950 hover:bg-sky-100"
              data-testid="prepare-clippers-drive-button"
            >
              {driveWorkspaceMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <HardDrive className="mr-2 h-4 w-4" />}
              Preparar Drive
            </Button>
            <Button
              onClick={() => sourceAcquisitionMutation.mutate()}
              disabled={sourceAcquisitionMutation.isPending || isLoading}
              className="bg-cyan-200 text-zinc-950 hover:bg-cyan-100"
              data-testid="prepare-clippers-source-acquisition-button"
            >
              {sourceAcquisitionMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Radar className="mr-2 h-4 w-4" />}
              Source plan
            </Button>
            <Button
              onClick={() => sourceHuntMutation.mutate()}
              disabled={sourceHuntMutation.isPending || isLoading}
              className="bg-teal-200 text-zinc-950 hover:bg-teal-100"
              data-testid="prepare-clippers-source-hunt-button"
            >
              {sourceHuntMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Target className="mr-2 h-4 w-4" />}
              Hunt sheet
            </Button>
            <Button
              onClick={() => sourceIntakeBatchMutation.mutate()}
              disabled={sourceIntakeBatchMutation.isPending || !sourceIntakeBatchText.trim() || isLoading}
              className="bg-lime-200 text-zinc-950 hover:bg-lime-100"
              data-testid="record-clippers-source-intake-batch-button"
            >
              {sourceIntakeBatchMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <UploadCloud className="mr-2 h-4 w-4" />}
              Source intake
            </Button>
            <Button
              onClick={() => renderDraftVideosMutation.mutate()}
              disabled={renderDraftVideosMutation.isPending || isLoading}
              className="bg-emerald-200 text-zinc-950 hover:bg-emerald-100"
              data-testid="render-clippers-draft-videos-button"
            >
              {renderDraftVideosMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
              Render clips
            </Button>
            <Button
              onClick={() => publishingPackageMutation.mutate()}
              disabled={publishingPackageMutation.isPending || isLoading}
              className="bg-green-200 text-zinc-950 hover:bg-green-100"
              data-testid="prepare-clippers-publishing-package-button"
            >
              {publishingPackageMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <UploadCloud className="mr-2 h-4 w-4" />}
              Publish pack
            </Button>
            <Button
              onClick={() => viralDiscoveryMutation.mutate()}
              disabled={viralDiscoveryMutation.isPending || isLoading}
              className="bg-orange-200 text-zinc-950 hover:bg-orange-100"
              data-testid="prepare-clippers-viral-discovery-button"
            >
              {viralDiscoveryMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Flame className="mr-2 h-4 w-4" />}
              Viral discovery
            </Button>
            <Button
              onClick={() => trendRightsOutreachMutation.mutate()}
              disabled={trendRightsOutreachMutation.isPending || isLoading}
              className="bg-amber-200 text-zinc-950 hover:bg-amber-100"
              data-testid="prepare-clippers-trend-rights-outreach-button"
            >
              {trendRightsOutreachMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
              Trend rights
            </Button>
            <Button
              onClick={() => rightsOutreachMutation.mutate()}
              disabled={rightsOutreachMutation.isPending || isLoading}
              className="bg-emerald-200 text-zinc-950 hover:bg-emerald-100"
              data-testid="prepare-clippers-rights-outreach-button"
            >
              {rightsOutreachMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
              Rights outreach
            </Button>
            <Button
              onClick={() => productionQueueMutation.mutate()}
              disabled={productionQueueMutation.isPending || isLoading}
              className="bg-rose-200 text-zinc-950 hover:bg-rose-100"
              data-testid="prepare-clippers-production-queue-button"
            >
              {productionQueueMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Clapperboard className="mr-2 h-4 w-4" />}
              Preparar cola
            </Button>
            <Button
              onClick={() => draftSpecsMutation.mutate()}
              disabled={draftSpecsMutation.isPending || isLoading}
              className="bg-pink-200 text-zinc-950 hover:bg-pink-100"
              data-testid="prepare-clippers-draft-specs-button"
            >
              {draftSpecsMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Wand2 className="mr-2 h-4 w-4" />}
              Draft specs
            </Button>
            <Button
              onClick={() => publisherConnectorsMutation.mutate()}
              disabled={publisherConnectorsMutation.isPending || isLoading}
              className="bg-lime-200 text-zinc-950 hover:bg-lime-100"
              data-testid="prepare-clippers-publisher-connectors-button"
            >
              {publisherConnectorsMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Network className="mr-2 h-4 w-4" />}
              Publisher connectors
            </Button>
            <Button
              onClick={() => intakeKitMutation.mutate()}
              disabled={intakeKitMutation.isPending || isLoading}
              className="bg-yellow-200 text-zinc-950 hover:bg-yellow-100"
              data-testid="prepare-clippers-intake-kit-button"
            >
              {intakeKitMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <UploadCloud className="mr-2 h-4 w-4" />}
              Intake kit
            </Button>
            <Button
              onClick={() => trendsMutation.mutate()}
              disabled={trendsMutation.isPending || isLoading}
              className="bg-orange-200 text-zinc-950 hover:bg-orange-100"
              data-testid="ingest-clippers-trends-button"
            >
              {trendsMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Flame className="mr-2 h-4 w-4" />}
              Ingerir trends
            </Button>
            <Button
              onClick={() => metricsMutation.mutate()}
              disabled={metricsMutation.isPending || isLoading}
              className="bg-emerald-200 text-zinc-950 hover:bg-emerald-100"
              data-testid="ingest-clippers-metrics-button"
            >
              {metricsMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <BarChart3 className="mr-2 h-4 w-4" />}
              Ingerir metricas
            </Button>
            <Button
              onClick={() => automationCycleMutation.mutate()}
              disabled={automationCycleMutation.isPending || isLoading}
              className="bg-lime-200 text-zinc-950 hover:bg-lime-100"
              data-testid="run-clippers-automation-cycle-button"
            >
              {automationCycleMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CalendarClock className="mr-2 h-4 w-4" />}
              Ciclo diario
            </Button>
            <Button
              onClick={() => automationScheduleMutation.mutate()}
              disabled={automationScheduleMutation.isPending || isLoading}
              className="bg-teal-200 text-zinc-950 hover:bg-teal-100"
              data-testid="prepare-clippers-automation-schedule-button"
            >
              {automationScheduleMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CalendarClock className="mr-2 h-4 w-4" />}
              Preparar schedule
            </Button>
          </div>
        </header>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <StatCard icon={Target} label="Meta semanal" value={`${formatNumber(status?.goals.totalWeeklyGoal || 0)} views`} detail={`${formatNumber(status?.goals.weeklyViewsPerAccount || 0)} por cuenta`} />
          <StatCard icon={Clapperboard} label="Clips diarios" value={String(status?.goals.dailyClipsTarget || 0)} detail="objetivo configurado" />
          <StatCard icon={Users} label="Cuentas" value={String(status?.accounts.length || 0)} detail={`${status?.goals.connectedAccounts || 0} conectadas`} />
          <StatCard icon={Gauge} label="Modo" value={publishMode === "approval_required" ? "Aprobacion" : publishMode === "draft_only" ? "Drafts" : "Auto"} detail="control de publicacion" />
        </div>

        <Card className="border-zinc-800 bg-zinc-950/70">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base text-white">
              <CheckCircle2 className="h-4 w-4 text-white" />
              Launch Command Center
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {status?.commandCenter ? (
              <>
                <div className="rounded-md border border-white/10 bg-black/35 p-3">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-white">{status.commandCenter.manifestPath}</p>
                      <p className="mt-1 text-xs leading-5 text-zinc-500">{status.commandCenter.nextStep}</p>
                    </div>
                    <Badge className={cn("w-fit border", commandCenterBadge(status.commandCenter.status))}>{status.commandCenter.status}</Badge>
                  </div>
                  <div className="mt-3 grid gap-2 text-xs text-zinc-500 md:grid-cols-4">
                    <p>Steps: {status.commandCenter.totals?.steps || 0}</p>
                    <p>Done: {status.commandCenter.totals?.done || 0}</p>
                    <p>Action: {status.commandCenter.totals?.needsAction || 0}</p>
                    <p>Blocked: {status.commandCenter.totals?.blocked || 0}</p>
                  </div>
                  <p className="mt-2 break-all text-xs text-zinc-600">Runbook: {status.commandCenter.markdownPath}</p>
                  {status.commandCenter.generatedAt && (
                    <p className="mt-2 text-xs text-zinc-600">actualizado: {formatDate(status.commandCenter.generatedAt)}</p>
                  )}
                </div>

                <div className={cn(tunnelGridClass, "grid gap-3 md:grid-cols-2 xl:grid-cols-5")}>
                  {(status.commandCenter.steps || []).map((step) => (
                    <div key={step.id} className={tunnelBoxClass}>
                      <div className="flex items-center justify-between gap-3">
                        <p className="truncate font-medium text-white">{step.label}</p>
                        <Badge className={cn("shrink-0 border", commandCenterBadge(step.status))}>{step.status}</Badge>
                      </div>
                      <p className="mt-1 text-xs text-zinc-600">{step.owner}</p>
                      <p className="mt-3 text-xs leading-5 text-zinc-500">{step.evidence}</p>
                      <p className="mt-2 text-xs leading-5 text-amber-200">{step.nextStep}</p>
                      {step.artifactPath && (
                        <p className="mt-3 break-all text-[11px] leading-4 text-zinc-600">{step.artifactPath}</p>
                      )}
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <p className="text-sm text-zinc-500">Cargando Command Center...</p>
            )}
          </CardContent>
        </Card>

        {status?.blockerResolutionPack && (
          <Card className="border-zinc-800 bg-zinc-950/70">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base text-white">
                <CheckCircle2 className="h-4 w-4 text-red-200" />
                Blocker Resolution Pack
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-md border border-red-300/20 bg-red-950/10 p-3">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-white">{status.blockerResolutionPack.markdownPath}</p>
                    <p className="mt-1 text-xs leading-5 text-zinc-500">{status.blockerResolutionPack.nextStep}</p>
                  </div>
                  <Badge className={cn("w-fit border", blockerResolutionBadge(status.blockerResolutionPack.status))}>{status.blockerResolutionPack.status}</Badge>
                </div>
                <div className="mt-3 grid gap-2 text-xs text-zinc-500 md:grid-cols-6">
                  <p>Actions: {status.blockerResolutionPack.totals.actions}</p>
                  <p>Critical: {status.blockerResolutionPack.totals.critical}</p>
                  <p>Blocked: {status.blockerResolutionPack.totals.blocked}</p>
                  <p>Next: {status.blockerResolutionPack.totals.next}</p>
                  <p>In-app: {status.blockerResolutionPack.totals.inApp}</p>
                  <p>External: {status.blockerResolutionPack.totals.external}</p>
                </div>
                <p className="mt-2 break-all text-xs text-zinc-600">CSV: {status.blockerResolutionPack.csvPath}</p>
                {status.blockerResolutionPack.evidenceBatchTemplate && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-3 h-7 border-green-300/20 bg-transparent px-2 text-xs text-green-100 hover:bg-green-300/10"
                    onClick={() => appendLaunchEvidenceBatchRow(status.blockerResolutionPack.evidenceBatchTemplate)}
                  >
                    <UploadCloud className="mr-1 h-3 w-3" />
                    Usar batch completo
                  </Button>
                )}
              </div>

              <div className={cn(tunnelGridClass, "grid gap-3 md:grid-cols-2 xl:grid-cols-3")}>
                {status.blockerResolutionPack.actions.map((action) => (
                  <div key={action.id} className={tunnelBoxClass}>
                    <div className="flex items-center justify-between gap-3">
                      <p className="truncate font-medium text-white">{action.rank}. {action.label}</p>
                      <Badge className={cn("shrink-0 border", blockerResolutionBadge(action.status))}>{action.status}</Badge>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Badge className={cn("border text-[10px]", blockerResolutionBadge(action.severity))}>{action.severity}</Badge>
                      <Badge className="border border-white/10 bg-black/30 text-[10px] text-zinc-300">{action.actionType}</Badge>
                      <Badge className="border border-white/10 bg-black/30 text-[10px] text-zinc-300">{action.unlockPhase}</Badge>
                      <Badge className="border border-white/10 bg-black/30 text-[10px] text-zinc-300">{action.executionMode}</Badge>
                      <Badge className="border border-white/10 bg-black/30 text-[10px] text-zinc-300">{action.estimatedMinutes}m</Badge>
                      <Badge className="border border-white/10 bg-black/30 text-[10px] text-zinc-300">{action.canRunInApp ? "in-app" : "external"}</Badge>
                    </div>
                    <p className="mt-2 text-xs leading-5 text-zinc-600">Depends: {action.dependsOn.length ? action.dependsOn.join(" -> ") : "none"}</p>
                    <p className="mt-3 text-xs leading-5 text-zinc-500">{action.evidence}</p>
                    <p className="mt-2 text-xs leading-5 text-amber-200">{action.nextStep}</p>
                    {action.doneCriteria.length > 0 && (
                      <div className="mt-2 rounded-md border border-emerald-300/15 bg-emerald-950/10 p-2">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-200">Done criteria</p>
                        <ul className="mt-1 space-y-1 text-xs leading-4 text-emerald-100/80">
                          {action.doneCriteria.slice(0, 3).map((criterion) => (
                            <li key={criterion}>{criterion}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    <p className="mt-2 rounded border border-white/10 bg-black/30 p-2 font-mono text-[11px] leading-4 text-zinc-400">{action.proofCommand}</p>
                    {action.evidenceImportRow && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="mt-3 h-7 border-green-300/20 bg-transparent px-2 text-xs text-green-100 hover:bg-green-300/10"
                        onClick={() => appendLaunchEvidenceBatchRow(action.evidenceImportRow)}
                        data-testid={`use-clippers-blocker-evidence-row-${action.id}`}
                      >
                        <UploadCloud className="mr-1 h-3 w-3" />
                        Usar evidence row
                      </Button>
                    )}
                    {action.evidenceImportRow && (
                      <p className="mt-2 break-all font-mono text-[11px] leading-4 text-green-200">{action.evidenceImportRow}</p>
                    )}
                    {action.artifactPath && (
                      <p className="mt-3 break-all text-[11px] leading-4 text-zinc-600">{action.artifactPath}</p>
                    )}
                    {action.actionUrl && (
                      <p className="mt-2 break-all text-[11px] leading-4 text-cyan-200">{action.actionUrl}</p>
                    )}
                    {action.portalUrl && (
                      <a href={action.portalUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 break-all text-[11px] leading-4 text-cyan-200 hover:text-cyan-100">
                        Portal
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {status?.goLiveAutopilotBrief && (
          <Card className="border-zinc-800 bg-zinc-950/70">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base text-white">
                <Network className="h-4 w-4 text-indigo-200" />
                Go-Live Autopilot Brief
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-md border border-indigo-300/20 bg-indigo-950/10 p-3">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-white">{status.goLiveAutopilotBrief.markdownPath}</p>
                    <p className="mt-1 text-xs leading-5 text-zinc-500">{status.goLiveAutopilotBrief.nextStep}</p>
                  </div>
                  <Badge className={cn("w-fit border", goLiveAutopilotBadge(status.goLiveAutopilotBrief.status))}>{status.goLiveAutopilotBrief.status}</Badge>
                </div>
                <div className="mt-3 grid gap-2 text-xs text-zinc-500 md:grid-cols-6">
                  <p>Actions: {status.goLiveAutopilotBrief.totals.actions}</p>
                  <p>In-app: {status.goLiveAutopilotBrief.totals.inAppReady}</p>
                  <p>External: {status.goLiveAutopilotBrief.totals.externalRequired}</p>
                  <p>Waiting: {status.goLiveAutopilotBrief.totals.waiting}</p>
                  <p>Blocked: {status.goLiveAutopilotBrief.totals.blocked}</p>
                  <p>Platforms: {status.goLiveAutopilotBrief.totals.platformsCovered}</p>
                </div>
                <div className="mt-3 grid gap-2 text-xs text-zinc-600 md:grid-cols-4">
                  <p>Lane in-app: {status.goLiveAutopilotBrief.lanes.in_app}</p>
                  <p>Lane external: {status.goLiveAutopilotBrief.lanes.external}</p>
                  <p>Lane evidence: {status.goLiveAutopilotBrief.lanes.evidence}</p>
                  <p>Lane publish: {status.goLiveAutopilotBrief.lanes.publish}</p>
                </div>
                <p className="mt-2 break-all text-xs text-zinc-600">CSV: {status.goLiveAutopilotBrief.csvPath}</p>
              </div>

              {status.goLiveAutopilotRun && (
                <div className="rounded-md border border-white/10 bg-black/35 p-3">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-white">Last run: {status.goLiveAutopilotRun.markdownPath}</p>
                      <p className="mt-1 text-xs leading-5 text-zinc-500">{status.goLiveAutopilotRun.nextStep}</p>
                    </div>
                    <Badge className={cn("w-fit border", goLiveAutopilotBadge(status.goLiveAutopilotRun.status))}>{status.goLiveAutopilotRun.status}</Badge>
                  </div>
                  <div className="mt-3 grid gap-2 text-xs text-zinc-500 md:grid-cols-5">
                    <p>Attempted: {status.goLiveAutopilotRun.totals.attempted}</p>
                    <p>Completed: {status.goLiveAutopilotRun.totals.completed}</p>
                    <p>Skipped: {status.goLiveAutopilotRun.totals.skipped}</p>
                    <p>Failed: {status.goLiveAutopilotRun.totals.failed}</p>
                    <p>Memory: {status.goLiveAutopilotRun.completedActionIds.length}</p>
                  </div>
                  {status.goLiveAutopilotRun.items.slice(0, 3).map((item) => (
                    <div key={`${item.actionId}-${item.startedAt}`} className="mt-3 rounded-md border border-white/10 bg-black/30 p-2">
                      <div className="flex items-center justify-between gap-3">
                        <p className="truncate text-xs font-medium text-white">{item.label}</p>
                        <Badge className={cn("shrink-0 border text-[10px]", goLiveAutopilotBadge(item.status))}>{item.status}</Badge>
                      </div>
                      <p className="mt-1 text-xs leading-5 text-zinc-500">{item.message}</p>
                    </div>
                  ))}
                </div>
              )}

              <div className={cn(tunnelGridClass, "grid gap-3 md:grid-cols-2 xl:grid-cols-3")}>
                {status.goLiveAutopilotBrief.actions.map((action) => (
                  <div key={action.id} className={tunnelBoxClass}>
                    <div className="flex items-center justify-between gap-3">
                      <p className="truncate font-medium text-white">{action.rank}. {action.label}</p>
                      <Badge className={cn("shrink-0 border", goLiveAutopilotBadge(action.status))}>{action.status}</Badge>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Badge className="border border-white/10 bg-black/30 text-[10px] text-zinc-300">{action.lane}</Badge>
                      <Badge className="border border-white/10 bg-black/30 text-[10px] text-zinc-300">{action.platform}</Badge>
                      <Badge className="border border-indigo-300/20 bg-indigo-300/10 text-[10px] text-indigo-100">{action.subAgentName}</Badge>
                      <Badge className="border border-white/10 bg-black/30 text-[10px] text-zinc-300">{action.owner}</Badge>
                    </div>
                    <p className="mt-3 text-xs leading-5 text-indigo-100/80">{action.mission}</p>
                    <p className="mt-3 text-xs leading-5 text-zinc-500">{action.reason}</p>
                    <p className="mt-2 text-xs leading-5 text-amber-200">{action.nextStep}</p>
                    {action.operatorSteps.length > 0 && (
                      <div className="mt-3 rounded-md border border-indigo-300/15 bg-indigo-950/10 p-2">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-indigo-200">Operator steps</p>
                        <ul className="mt-1 space-y-1 text-xs leading-4 text-indigo-100/80">
                          {action.operatorSteps.slice(0, 3).map((step) => (
                            <li key={step}>{step}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {action.evidenceRows.length > 0 && (
                      <div className="mt-2 rounded-md border border-green-300/15 bg-green-950/10 p-2">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-green-200">Evidence row</p>
                        <p className="mt-1 break-all text-xs leading-4 text-green-100/80">{action.evidenceRows[0]}</p>
                      </div>
                    )}
                    {action.successSignals.length > 0 && (
                      <p className="mt-2 text-xs leading-5 text-emerald-100/80">Success: {action.successSignals[0]}</p>
                    )}
                    {action.riskControls.length > 0 && (
                      <p className="mt-2 text-xs leading-5 text-red-100/80">Control: {action.riskControls[0]}</p>
                    )}
                    <p className="mt-2 text-xs leading-5 text-zinc-600">{action.evidenceTemplate}</p>
                    {action.localActionUrl && (
                      <p className="mt-3 break-all text-[11px] leading-4 text-cyan-200">{action.localActionUrl}</p>
                    )}
                    {action.portalUrl && (
                      <p className="mt-2 break-all text-[11px] leading-4 text-sky-200">{action.portalUrl}</p>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {status?.externalExecutionSession && (
          <Card className="border-zinc-800 bg-zinc-950/70">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base text-white">
                <ExternalLink className="h-4 w-4 text-green-200" />
                External Execution Session
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-md border border-green-300/20 bg-green-950/10 p-3">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-white">{status.externalExecutionSession.markdownPath}</p>
                    <p className="mt-1 text-xs leading-5 text-zinc-500">{status.externalExecutionSession.nextStep}</p>
                  </div>
                  <Badge className={cn("w-fit border", externalSetupQueueBadge(status.externalExecutionSession.status))}>{status.externalExecutionSession.status}</Badge>
                </div>
                <div className="mt-3 grid gap-2 text-xs text-zinc-500 md:grid-cols-6">
                  <p>Items: {status.externalExecutionSession.totals.items}</p>
                  <p>Do now: {status.externalExecutionSession.totals.doNow}</p>
                  <p>Blocked: {status.externalExecutionSession.totals.blocked}</p>
                  <p>Waiting: {status.externalExecutionSession.totals.waiting}</p>
                  <p>Rows: {status.externalExecutionSession.totals.evidenceRows}</p>
                  <p>Env: {status.externalExecutionSession.totals.envTemplates}</p>
                </div>
                <p className="mt-2 break-all text-xs text-zinc-600">CSV: {status.externalExecutionSession.csvPath}</p>
                <div className="mt-3 rounded-md border border-green-300/15 bg-black/30 p-2">
                  <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                    <div className="min-w-0">
                      <p className="break-all text-xs font-medium text-white">{status.externalExecutionSession.evidenceImportPath}</p>
                      <p className="mt-1 text-xs text-zinc-500">{status.externalExecutionSession.totals.importableEvidenceRows} filas importables de evidencia.</p>
                    </div>
                    <Button size="sm" variant="outline" className="h-8 border-green-300/20 bg-transparent px-2 text-xs text-green-100 hover:bg-green-300/10" onClick={() => {
                      setLaunchEvidenceBatchText(status.externalExecutionSession.evidenceImportTemplate);
                      setLaunchEvidenceBatchPreview(null);
                    }}>
                      <UploadCloud className="mr-1 h-3 w-3" />
                      Cargar batch
                    </Button>
                  </div>
                </div>
              </div>

              {status.externalExecutionSession.unlockBoard.length > 0 && (
                <div className="grid gap-3 md:grid-cols-3">
                  {status.externalExecutionSession.unlockBoard.map((item) => (
                    <div key={item.platform} className="rounded-md border border-emerald-300/15 bg-black/35 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-medium capitalize text-white">{item.platform}</p>
                        <Badge className={cn("border text-[10px]", item.blocked > 0 ? "border-red-300/30 bg-red-300/10 text-red-200" : item.doNow > 0 ? "border-emerald-300/30 bg-emerald-300/10 text-emerald-200" : "border-amber-300/30 bg-amber-300/10 text-amber-200")}>
                          {item.blocked > 0 ? "blocked" : item.doNow > 0 ? "do_now" : "waiting"}
                        </Badge>
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-zinc-500">
                        <p>Items: {item.total}</p>
                        <p>Do now: {item.doNow}</p>
                        <p>Blocked: {item.blocked}</p>
                        <p>Waiting: {item.waiting}</p>
                        <p>Rows: {item.evidenceRows}</p>
                        <p>Env: {item.credentialTemplates}</p>
                      </div>
                      <p className="mt-3 text-xs leading-5 text-zinc-400">{item.nextStep}</p>
                      {item.portalUrls.length > 0 && (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {item.portalUrls.slice(0, 2).map((portalUrl) => (
                            <a key={portalUrl} href={portalUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md border border-sky-300/20 px-2 py-1 text-xs text-sky-100 hover:bg-sky-300/10">
                              Portal
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          ))}
                        </div>
                      )}
                      {item.nextEvidenceRows.length > 0 && (
                        <Button size="sm" variant="outline" className="mt-3 h-7 border-green-300/20 bg-transparent px-2 text-xs text-green-100 hover:bg-green-300/10" onClick={() => appendLaunchEvidenceBatchRows(item.nextEvidenceRows)}>
                          <UploadCloud className="mr-1 h-3 w-3" />
                          Cargar rows
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              )}

              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                {status.externalExecutionSession.items.map((item) => (
                  <div key={item.id} className="rounded-md border border-white/10 bg-black/35 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="truncate font-medium text-white">{item.rank}. {item.label}</p>
                      <Badge className={cn("shrink-0 border", item.lane === "do_now" ? "border-emerald-300/30 bg-emerald-300/10 text-emerald-200" : item.lane === "blocked" ? "border-red-300/30 bg-red-300/10 text-red-200" : "border-amber-300/30 bg-amber-300/10 text-amber-200")}>{item.lane}</Badge>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Badge className="border border-white/10 bg-black/30 text-[10px] text-zinc-300">{item.type}</Badge>
                      <Badge className="border border-white/10 bg-black/30 text-[10px] text-zinc-300">{item.actionMode}</Badge>
                    </div>
                    <p className="mt-2 text-xs leading-5 text-cyan-100/80">{item.laneReason}</p>
                    <p className="mt-3 text-xs leading-5 text-zinc-500">{item.nextStep}</p>
                    <p className="mt-2 text-xs leading-5 text-emerald-100/80">{item.completionHint}</p>
                    {item.requiredInputs.length > 0 && (
                      <div className="mt-3 rounded-md border border-emerald-300/15 bg-emerald-950/10 p-2">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-200">Required inputs</p>
                        <ul className="mt-1 space-y-1 text-xs leading-4 text-emerald-100/80">
                          {item.requiredInputs.slice(0, 4).map((requiredInput) => (
                            <li key={requiredInput}>{requiredInput}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {item.blockers.length > 0 && (
                      <div className="mt-3 rounded-md border border-red-300/15 bg-red-950/10 p-2">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-red-200">Blockers</p>
                        <ul className="mt-1 space-y-1 text-xs leading-4 text-red-100/80">
                          {item.blockers.slice(0, 2).map((blocker) => (
                            <li key={blocker}>{blocker}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    <div className="mt-3 flex flex-wrap gap-2">
                      {item.portalUrl && (
                        <a href={item.portalUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md border border-sky-300/20 px-2 py-1 text-xs text-sky-100 hover:bg-sky-300/10">
                          Portal
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                      {item.executionUrl && item.executionUrl !== item.portalUrl && (
                        <a href={item.executionUrl} className="inline-flex items-center gap-1 rounded-md border border-cyan-300/20 px-2 py-1 text-xs text-cyan-100 hover:bg-cyan-300/10">
                          Local
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                      {item.evidenceBatchRow && (
                        <Button size="sm" variant="outline" className="h-7 border-green-300/20 bg-transparent px-2 text-xs text-green-100 hover:bg-green-300/10" onClick={() => appendLaunchEvidenceBatchRow(item.evidenceBatchRow)}>
                          <UploadCloud className="mr-1 h-3 w-3" />
                          {item.evidenceImportReady ? "Import row" : "Draft row"}
                        </Button>
                      )}
                      {item.evidenceRecipeRow && (
                        <Button size="sm" variant="outline" className="h-7 border-amber-300/20 bg-transparent px-2 text-xs text-amber-100 hover:bg-amber-300/10" onClick={() => appendLaunchEvidenceBatchRow(item.evidenceRecipeRow)}>
                          <Eye className="mr-1 h-3 w-3" />
                          Recipe row
                        </Button>
                      )}
                      {item.credentialTemplate && (
                        <Button size="sm" variant="outline" className="h-7 border-cyan-300/20 bg-transparent px-2 text-xs text-cyan-100 hover:bg-cyan-300/10" onClick={() => {
                          setCredentialBatchText((current) => `${current.trim() ? `${current.trim()}\n\n` : ""}${item.credentialTemplate}`);
                          setCredentialBatchPreview(null);
                        }}>
                          <KeyRound className="mr-1 h-3 w-3" />
                          Env
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {status?.externalExecutionHandoff && (
          <Card className="border-zinc-800 bg-zinc-950/70">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base text-white">
                <ExternalLink className="h-4 w-4 text-lime-200" />
                External Execution Handoff
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-md border border-lime-300/20 bg-lime-950/10 p-3">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-white">{status.externalExecutionHandoff.markdownPath}</p>
                    <p className="mt-1 text-xs leading-5 text-zinc-500">{status.externalExecutionHandoff.nextStep}</p>
                  </div>
                  <Badge className={cn("w-fit border", externalSetupQueueBadge(status.externalExecutionHandoff.status))}>{status.externalExecutionHandoff.status}</Badge>
                </div>
                <div className="mt-3 grid gap-2 text-xs text-zinc-500 md:grid-cols-6">
                  <p>Items: {status.externalExecutionHandoff.totals.items}</p>
                  <p>Accounts: {status.externalExecutionHandoff.totals.accounts}</p>
                  <p>Apps: {status.externalExecutionHandoff.totals.developerApps}</p>
                  <p>Credentials: {status.externalExecutionHandoff.totals.credentials}</p>
                  <p>Permissions: {status.externalExecutionHandoff.totals.permissions}</p>
                  <p>OAuth: {status.externalExecutionHandoff.totals.oauth}</p>
                </div>
                <p className="mt-2 break-all text-xs text-zinc-600">Batch: {status.externalExecutionHandoff.batchTemplatePath}</p>
                <p className="mt-1 break-all text-xs text-zinc-600">CSV: {status.externalExecutionHandoff.csvPath}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 border-lime-300/20 bg-transparent px-2 text-xs text-lime-100 hover:bg-lime-300/10"
                    onClick={() => appendLaunchEvidenceBatchRows(status.externalExecutionHandoff.items.map((item) => item.evidenceBatchRow))}
                    data-testid="use-all-clippers-external-evidence-rows-button"
                  >
                    <UploadCloud className="mr-1 h-3 w-3" />
                    Usar todas las rows
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 border-cyan-300/20 bg-transparent px-2 text-xs text-cyan-100 hover:bg-cyan-300/10"
                    onClick={() => appendCredentialBatchTemplates(status.externalExecutionHandoff.items)}
                    data-testid="use-all-clippers-external-env-templates-button"
                  >
                    <KeyRound className="mr-1 h-3 w-3" />
                    Usar todos los env
                  </Button>
                </div>
              </div>

              <div className={cn(tunnelGridClass, "grid gap-3 md:grid-cols-2 xl:grid-cols-3")}>
                {status.externalExecutionHandoff.items.map((item) => (
                  <div key={item.id} className={tunnelBoxClass}>
                    <div className="flex items-center justify-between gap-3">
                      <p className="truncate font-medium text-white">{item.rank}. {item.label}</p>
                      <Badge className={cn("shrink-0 border", externalSetupQueueBadge(item.priority))}>{item.priority}</Badge>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Badge className="border border-white/10 bg-black/30 text-[10px] text-zinc-300">{item.type}</Badge>
                      <Badge className="border border-white/10 bg-black/30 text-[10px] text-zinc-300">{item.platform}</Badge>
                      <Badge className={cn("border text-[10px]", commandCenterBadge(item.status))}>{item.status}</Badge>
                    </div>
                    <p className="mt-3 text-xs leading-5 text-zinc-500">{item.nextStep}</p>
                    <p className="mt-2 text-xs leading-5 text-zinc-600">{item.evidenceTemplate}</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {item.portalUrl && (
                        <a href={item.portalUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md border border-sky-300/20 px-2 py-1 text-xs text-sky-100 hover:bg-sky-300/10">
                          Portal
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                      {item.evidenceBatchRow && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 border-lime-300/20 bg-transparent px-2 text-xs text-lime-100 hover:bg-lime-300/10"
                          onClick={() => appendLaunchEvidenceBatchRow(item.evidenceBatchRow)}
                          data-testid={`use-clippers-external-evidence-row-${item.id}`}
                        >
                          <UploadCloud className="mr-1 h-3 w-3" />
                          Usar row
                        </Button>
                      )}
                      {item.envVars.length > 0 && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 border-cyan-300/20 bg-transparent px-2 text-xs text-cyan-100 hover:bg-cyan-300/10"
                          onClick={() => appendCredentialBatchTemplate(item.envVars, item.label)}
                          data-testid={`use-clippers-external-env-template-${item.id}`}
                        >
                          <KeyRound className="mr-1 h-3 w-3" />
                          Usar env
                        </Button>
                      )}
                    </div>
                    {item.evidenceBatchRow && (
                      <p className="mt-3 break-all font-mono text-[11px] leading-4 text-zinc-600">{item.evidenceBatchRow}</p>
                    )}
                    {item.envVars.length > 0 && (
                      <p className="mt-2 break-all font-mono text-[11px] leading-4 text-cyan-200">{item.envVars.join(", ")}</p>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        <Card id="credential-setup" className="scroll-mt-6 border-zinc-800 bg-zinc-950/70">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base text-white">
              <UploadCloud className="h-4 w-4 text-emerald-200" />
              Manual Posting Pack
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {status?.manualPostingPack ? (
              <>
                <div className="rounded-md border border-white/10 bg-black/35 p-3">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-white">{status.manualPostingPack.csvPath}</p>
                      <p className="mt-1 text-xs leading-5 text-zinc-500">{status.manualPostingPack.nextStep}</p>
                    </div>
                    <Badge className={cn("w-fit border", manualPostingPackBadge(status.manualPostingPack.status))}>{status.manualPostingPack.status}</Badge>
                  </div>
                  <div className="mt-3 grid gap-2 text-xs text-zinc-500 md:grid-cols-5">
                    <p>Posts: {status.manualPostingPack.totals.posts}</p>
                    <p>Ready: {status.manualPostingPack.totals.readyToPost}</p>
                    <p>Accounts: {status.manualPostingPack.totals.needsAccount}</p>
                    <p>Sources: {status.manualPostingPack.totals.needsSource}</p>
                    <p>Rights: {status.manualPostingPack.totals.needsRights}</p>
                  </div>
                  {status.manualPostingPack.generatedAt && (
                    <p className="mt-2 text-xs text-zinc-600">actualizado: {formatDate(status.manualPostingPack.generatedAt)}</p>
                  )}
                  <div className="mt-3 rounded-md border border-emerald-300/15 bg-emerald-950/10 p-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-emerald-200">Weekly runway</p>
                    <div className="mt-2 grid gap-2 text-xs text-emerald-100/80 md:grid-cols-4">
                      <p>Target: {status.manualPostingPack.weeklyRunway.targetWeeklyPosts}</p>
                      <p>Ready: {status.manualPostingPack.weeklyRunway.readyToPost}</p>
                      <p>Gap: {status.manualPostingPack.weeklyRunway.gapToTarget}</p>
                      <p>Daily need: {status.manualPostingPack.weeklyRunway.recommendedDailyReadyPosts}</p>
                    </div>
                    <p className="mt-2 text-xs leading-5 text-zinc-400">{status.manualPostingPack.weeklyRunway.nextStep}</p>
                  </div>
                </div>

                <div className="rounded-md border border-green-300/20 bg-green-950/10 p-3">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <p className="font-medium text-white">Publishing Package</p>
                      <p className="mt-1 text-xs leading-5 text-zinc-500">{(publishingPackage || status.publishingPackage)?.nextStep || "Prepara payloads de subida desde clips renderizados y cuentas verificadas."}</p>
                    </div>
                    <Button
                      size="sm"
                      className="h-8 bg-green-200 px-3 text-xs text-zinc-950 hover:bg-green-100"
                      disabled={publishingPackageMutation.isPending}
                      onClick={() => publishingPackageMutation.mutate()}
                      data-testid="prepare-clippers-publishing-package-inline-button"
                    >
                      {publishingPackageMutation.isPending ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <UploadCloud className="mr-2 h-3.5 w-3.5" />}
                      Publish pack
                    </Button>
                  </div>
                  {(publishingPackage || status.publishingPackage) && (
                    <div className="mt-3" data-testid="clippers-publishing-package-result">
                      <div className="grid gap-2 text-xs text-zinc-500 md:grid-cols-4">
                        <p>Items: {(publishingPackage || status.publishingPackage).totals.items}</p>
                        <p>Ready: {(publishingPackage || status.publishingPackage).totals.readyForManual}</p>
                        <p>Accounts: {(publishingPackage || status.publishingPackage).totals.needsAccount}</p>
                        <p>Rendered: {(publishingPackage || status.publishingPackage).totals.needsRenderedClip}</p>
                      </div>
                      <p className="mt-2 break-all text-xs text-zinc-600">CSV: {(publishingPackage || status.publishingPackage).csvPath}</p>
                      <p className="mt-1 break-all text-xs text-zinc-600">Markdown: {(publishingPackage || status.publishingPackage).markdownPath}</p>
                      {(publishingPackage || status.publishingPackage).items.slice(0, 4).map((item) => (
                        <div key={item.id} className="mt-2 rounded-md border border-white/10 bg-black/35 p-2">
                          <div className="flex items-center justify-between gap-2">
                            <p className="truncate text-xs font-medium text-white">{item.accountName} / {item.platform}</p>
                            <Badge className={cn("border text-[10px]", item.status === "ready_for_manual" ? "border-emerald-300/30 bg-emerald-300/10 text-emerald-200" : "border-amber-300/30 bg-amber-300/10 text-amber-200")}>{item.status}</Badge>
                          </div>
                          <p className="mt-1 break-all text-xs text-zinc-500">{item.videoPath}</p>
                          <p className="mt-1 text-xs text-zinc-600">{item.nextStep}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {status.manualPostingPack.unblockSession.length > 0 && (
                  <div className="rounded-md border border-amber-300/15 bg-amber-950/10 p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-amber-200">Unblock session</p>
                    <div className="mt-2 grid gap-2 lg:grid-cols-3">
                      {status.manualPostingPack.unblockSession.slice(0, 6).map((item) => (
                        <div key={item.itemId} className="rounded-md border border-white/10 bg-black/25 p-2">
                          <div className="flex items-center justify-between gap-2">
                            <p className="truncate text-xs font-medium text-white">#{item.rank} {item.accountName}</p>
                            <Badge className={cn("border text-[10px]", manualPostingPackBadge(item.status))}>{item.status}</Badge>
                          </div>
                          <p className="mt-1 text-xs text-zinc-500">{categoryLabels[item.category]} · {item.platform} · {formatDate(item.publishAt)}</p>
                          <p className="mt-2 break-all text-[11px] leading-4 text-zinc-400">{item.sourceFolder}</p>
                          {item.requiredEvidence.length > 0 && (
                            <p className="mt-2 text-xs leading-5 text-amber-100/80">{item.requiredEvidence[0]}</p>
                          )}
                          {item.doneCriteria.length > 0 && (
                            <p className="mt-2 text-[11px] leading-4 text-emerald-100/80">Done: {item.doneCriteria[0]}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {status.manualPostingPack.items.slice(0, 9).map((item) => (
                    <div key={item.id} className="rounded-md border border-white/10 bg-black/35 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate font-medium text-white">{item.accountName}</p>
                          <p className="mt-1 text-xs text-zinc-500">{item.handle} · {item.platform} · {formatDate(item.publishAt)}</p>
                        </div>
                        <Badge className={cn("shrink-0 border", manualPostingPackBadge(item.status))}>{item.status}</Badge>
                      </div>
                      <p className="mt-3 text-xs leading-5 text-zinc-400">{item.hook}</p>
                      <p className="mt-2 text-xs leading-5 text-emerald-100">{item.caption}</p>
                      <p className="mt-2 truncate text-xs text-zinc-600">{item.sourcePath || "sin source todavia"}</p>
                      {item.blocker && <p className="mt-2 text-xs leading-5 text-amber-200">{item.blocker}</p>}
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <p className="text-sm text-zinc-500">Cargando manual posting pack...</p>
            )}
          </CardContent>
        </Card>

        <Card className="border-zinc-800 bg-zinc-950/70">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base text-white">
              <UploadCloud className="h-4 w-4 text-lime-200" />
              Source Intake Batch
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-md border border-lime-300/20 bg-lime-950/10 p-3">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <p className="font-medium text-white">Importar sources candidatos</p>
                  <p className="mt-1 text-xs leading-5 text-zinc-500">Convierte links/ideas virales en paths de archivo, checklist de descarga, evidencia requerida y filas source_rights para Launch evidence batch.</p>
                </div>
                <Button
                  type="button"
                  onClick={() => sourceIntakeBatchMutation.mutate()}
                  disabled={sourceIntakeBatchMutation.isPending || !sourceIntakeBatchText.trim()}
                  className="bg-lime-200 text-zinc-950 hover:bg-lime-100"
                  data-testid="record-clippers-source-intake-batch-inline-button"
                >
                  {sourceIntakeBatchMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <UploadCloud className="mr-2 h-4 w-4" />}
                  Importar sources
                </Button>
              </div>
              <Textarea
                value={sourceIntakeBatchText}
                onChange={(event) => {
                  setSourceIntakeBatchText(event.target.value);
                  setSourceIntakeBatch(null);
                }}
                placeholder={`${sourceIntakeBatchHeader}\nsports,Last-second comeback,https://example.com/highlight,@league,tiktok,comeback.mp4,owned_or_permissioned,https://drive.google.com/file/proof,high,Payoff claro\nmemes,Formato raro de hoy,https://example.com/meme,@creator,instagram,meme-loop.mp4,review_required,,medium,Pedir permiso`}
                className="mt-3 min-h-32 border-zinc-800 bg-black font-mono text-xs"
                autoComplete="off"
                data-testid="clipper-source-intake-batch-input"
              />
              <p className="mt-2 text-xs text-zinc-600">Columnas: {sourceIntakeBatchHeader}. Solo genera plan; no descarga videos ni marca permisos sin evidencia real.</p>
            </div>

            {sourceIntakeBatch && (
              <div className="rounded-md border border-white/10 bg-black/35 p-3" data-testid="clippers-source-intake-batch-result">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <p className="font-medium text-white">Batch importado</p>
                    <p className="mt-1 text-xs leading-5 text-zinc-500">{sourceIntakeBatch.nextStep}</p>
                  </div>
                  <Badge className="w-fit border border-lime-300/30 bg-lime-300/10 text-lime-200">{sourceIntakeBatch.accepted} accepted</Badge>
                </div>
                <div className="mt-3 grid gap-2 text-xs text-zinc-500 md:grid-cols-6">
                  <p>Sports: {sourceIntakeBatch.totals.sports}</p>
                  <p>Memes: {sourceIntakeBatch.totals.memes}</p>
                  <p>Streamers: {sourceIntakeBatch.totals.streamers}</p>
                  <p>Derechos listos: {sourceIntakeBatch.totals.ownedOrPermissioned}</p>
                  <p>Review: {sourceIntakeBatch.totals.reviewRequired}</p>
                  <p>Skipped: {sourceIntakeBatch.skipped}</p>
                </div>
                <p className="mt-3 break-all text-xs text-zinc-600">CSV: {sourceIntakeBatch.csvPath}</p>
                <p className="mt-1 break-all text-xs text-zinc-600">Markdown: {sourceIntakeBatch.markdownPath}</p>
                <div className="mt-3 grid gap-3 lg:grid-cols-3">
                  {sourceIntakeBatch.items.slice(0, 3).map((item) => (
                    <div key={item.id} className="rounded-md border border-white/10 bg-black/40 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate text-sm font-medium text-white">{item.title}</p>
                        <Badge className={cn("shrink-0 border text-[10px]", item.priority === "high" ? "border-red-300/30 bg-red-300/10 text-red-200" : "border-zinc-600 bg-zinc-900 text-zinc-300")}>{item.priority}</Badge>
                      </div>
                      <p className="mt-2 break-all text-xs text-zinc-500">{item.targetSourcePath}</p>
                      <p className="mt-2 text-xs text-zinc-600">{item.nextStep}</p>
                      {item.sourceRightsBatchRow && (
                        <Button size="sm" variant="outline" className="mt-3 h-7 border-green-300/20 bg-transparent px-2 text-xs text-green-100 hover:bg-green-300/10" onClick={() => appendLaunchEvidenceBatchRow(item.sourceRightsBatchRow || "")}>
                          Row derechos
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-zinc-800 bg-zinc-950/70">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base text-white">
              <KeyRound className="h-4 w-4 text-zinc-200" />
              Credential & Account Setup
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {status?.credentialSetup ? (
              <>
                <div className="rounded-md border border-white/10 bg-black/35 p-3">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-white">{status.credentialSetup.templatePath}</p>
                      <p className="mt-1 text-xs leading-5 text-zinc-500">{status.credentialSetup.nextStep}</p>
                    </div>
                    <Badge className={cn("w-fit border", credentialSetupBadge(status.credentialSetup.status))}>{status.credentialSetup.status}</Badge>
                  </div>
                  <div className="mt-3 grid gap-2 text-xs text-zinc-500 md:grid-cols-4">
                    <p>Ready: {status.credentialSetup.totals?.ready || 0}</p>
                    <p>Partial: {status.credentialSetup.totals?.partial || 0}</p>
                    <p>Missing: {status.credentialSetup.totals?.missing || 0}</p>
                    <p>Env files: {status.credentialSetup.envFilesFound.length || 0}</p>
                  </div>
                  <p className="mt-2 break-all text-xs text-zinc-600">Readme: {status.credentialSetup.readmePath}</p>
                  <p className="mt-1 break-all text-xs text-zinc-600">Missing env: {status.credentialSetup.missingTemplatePath}</p>
                  <p className="mt-1 text-xs text-zinc-600">Busca: {status.credentialSetup.envFilesChecked.join(", ")}</p>
                  <p className="mt-1 break-all text-xs text-zinc-600">Drop dirs: {(status.credentialSetup.credentialDropDirs || []).join(", ")}</p>
                </div>

                <div className="rounded-md border border-sky-300/15 bg-sky-950/10 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-white">Safe env audit</p>
                      <p className="mt-1 text-xs leading-5 text-zinc-500">Solo nombres detectados por archivo; no muestra valores.</p>
                    </div>
                    <Badge className="border border-sky-300/20 bg-sky-300/10 text-sky-100">
                      {(status.credentialSetup.envFileScans || []).filter((file) => file.exists).length} files
                    </Badge>
                  </div>
                  <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {(status.credentialSetup.envFileScans || []).filter((file) => file.exists || file.relevantKeys.length > 0).map((file) => (
                      <div key={file.fileName} className="rounded-md border border-white/10 bg-black/30 p-2">
                        <div className="flex items-center justify-between gap-2">
                          <p className="truncate text-xs font-medium text-white">{file.fileName}</p>
                          <Badge className={cn("border text-[10px]", file.relevantKeys.length ? "border-emerald-300/30 bg-emerald-300/10 text-emerald-200" : "border-zinc-600 bg-zinc-900 text-zinc-300")}>
                            {file.relevantKeys.length ? "keys" : "empty"}
                          </Badge>
                        </div>
                        <p className="mt-2 break-all text-xs text-zinc-500">{file.relevantKeys.length ? file.relevantKeys.join(", ") : "sin keys relevantes"}</p>
                        {file.itemScans.length > 0 && (
                          <div className="mt-2 space-y-2">
                            {file.itemScans.map((scan) => (
                              <div key={`${file.fileName}-${scan.id}`} className="rounded border border-white/10 bg-black/35 p-2">
                                <div className="flex items-center justify-between gap-2">
                                  <p className="truncate text-xs text-zinc-300">{scan.label}</p>
                                  <Badge className={cn("border text-[10px]", credentialSetupBadge(scan.statusFromFile))}>{scan.statusFromFile}</Badge>
                                </div>
                                <p className="mt-1 break-all text-xs text-zinc-600">Match: {scan.matchedEnvVars.join(", ")}</p>
                                {scan.missingEnvVarGroups.length > 0 && (
                                  <p className="mt-1 text-xs leading-4 text-amber-200">Falta aqui: {scan.missingEnvVarGroups.join("; ")}</p>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-md border border-cyan-300/15 bg-cyan-950/10 p-3">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-sm font-medium text-white">Credential file candidates</p>
                      <p className="mt-1 text-xs leading-5 text-zinc-500">Solo nombres/rutas de archivos; no abre ni muestra secretos.</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge className="border border-cyan-300/20 bg-cyan-300/10 text-cyan-100">
                        {(status.credentialSetup.credentialFileScans || []).length} files
                      </Badge>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-8 border-cyan-300/30 bg-transparent px-2 text-xs text-cyan-100 hover:bg-cyan-300/10"
                        onClick={() => credentialDropImportMutation.mutate()}
                        disabled={credentialDropImportMutation.isPending || !(status.credentialSetup.credentialFileScans || []).some((file) => file.relativePath.startsWith("credentials/") || file.relativePath.startsWith("secrets/"))}
                        data-testid="import-clippers-credential-drop-files-button"
                      >
                        {credentialDropImportMutation.isPending ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <UploadCloud className="mr-1 h-3 w-3" />}
                        Import drop files
                      </Button>
                    </div>
                  </div>
                  {(status.credentialSetup.credentialFileScans || []).length > 0 ? (
                    <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                      {status.credentialSetup.credentialFileScans.map((file) => (
                        <div key={file.relativePath} className="rounded-md border border-white/10 bg-black/30 p-2">
                          <div className="flex items-center justify-between gap-2">
                            <p className="truncate text-xs font-medium text-white">{file.fileName}</p>
                            <Badge className="border border-cyan-300/20 bg-cyan-300/10 text-[10px] text-cyan-100">{file.kind}</Badge>
                          </div>
                          <p className="mt-2 break-all text-xs text-zinc-500">{file.relativePath}</p>
                          <p className="mt-2 text-xs leading-5 text-cyan-100/80">{file.nextStep}</p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-3 text-xs leading-5 text-zinc-500">No hay JSON OAuth/env candidatos fuera de las plantillas generadas.</p>
                  )}
                </div>

                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                  {(status.credentialSetup.importPlan || []).map((item) => (
                    <div key={item.id} className="rounded-md border border-white/10 bg-black/35 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <p className="truncate font-medium text-white">{item.label}</p>
                        <Badge className={cn("shrink-0 border", credentialSetupBadge(item.status))}>{item.status}</Badge>
                      </div>
                      <p className="mt-2 text-xs leading-5 text-zinc-500">{item.nextStep}</p>
                      <p className="mt-2 text-xs text-zinc-600">Input: {item.supportedInputFormats.join(" · ")}</p>
                      <p className="mt-2 break-all text-xs text-zinc-600">Aliases: {item.acceptedEnvVarGroups.map((group) => group.join(" or ")).join(" · ")}</p>
                      <p className="mt-2 text-xs text-zinc-500">Detected: {item.configuredEnvVars.length ? item.configuredEnvVars.join(", ") : "none"}</p>
                      {item.pasteTemplate && (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="mt-3 h-7 border-sky-300/20 bg-transparent px-2 text-xs text-sky-100 hover:bg-sky-300/10"
                          onClick={() => appendCredentialBatchText(item.pasteTemplate, `${item.label} template agregado`)}
                          data-testid={`load-credential-import-plan-${item.id}`}
                        >
                          <KeyRound className="mr-1 h-3 w-3" />
                          Usar template
                        </Button>
                      )}
                      <pre className="mt-2 max-h-24 overflow-auto whitespace-pre-wrap break-words rounded border border-white/10 bg-black/40 p-2 font-mono text-[10px] leading-4 text-zinc-400">{item.pasteTemplate || "# ready"}</pre>
                    </div>
                  ))}
                </div>

                <div className="rounded-md border border-white/10 bg-black/35 p-3">
                  <div className="grid gap-3 lg:grid-cols-[1fr_1.2fr_auto] lg:items-end">
                    <div className="space-y-1">
                      <Label htmlFor="clipper-credential-env-var" className="text-xs text-zinc-400">Variable</Label>
                      <Select value={credentialEnvVar} onValueChange={setCredentialEnvVar}>
                        <SelectTrigger id="clipper-credential-env-var" className="border-zinc-800 bg-black">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {credentialEnvVarOptions.map((envVar) => (
                            <SelectItem key={envVar} value={envVar}>{envVar}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="clipper-credential-secret" className="text-xs text-zinc-400">Valor local</Label>
                      <Input
                        id="clipper-credential-secret"
                        type="password"
                        value={credentialSecretValue}
                        onChange={(event) => setCredentialSecretValue(event.target.value)}
                        className="border-zinc-800 bg-black"
                        autoComplete="off"
                        data-testid="clipper-credential-secret-input"
                      />
                    </div>
                    <Button
                      onClick={() => credentialSecretMutation.mutate()}
                      disabled={credentialSecretMutation.isPending || !credentialSecretValue.trim()}
                      className="bg-sky-200 text-zinc-950 hover:bg-sky-100"
                      data-testid="record-clippers-credential-secret-button"
                    >
                      {credentialSecretMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <KeyRound className="mr-2 h-4 w-4" />}
                      Guardar key
                    </Button>
                  </div>
                  <p className="mt-2 text-xs text-zinc-600">Se guarda en CEO_ASSISTANT_ENV y la respuesta solo incluye nombres de variables.</p>

                  <div className="mt-4 space-y-2 border-t border-white/10 pt-4">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <Label htmlFor="clipper-credential-batch" className="text-xs text-zinc-400">Batch .env o Google OAuth JSON</Label>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-8 border-sky-300/30 bg-transparent px-2 text-xs text-sky-100 hover:bg-sky-300/10"
                          onClick={() => appendCredentialBatchText(googleCredentialEnvTemplate, "Template Google agregado")}
                          data-testid="load-google-env-template-button"
                        >
                          <KeyRound className="mr-1 h-3 w-3" />
                          Google env
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-8 border-cyan-300/30 bg-transparent px-2 text-xs text-cyan-100 hover:bg-cyan-300/10"
                          onClick={() => appendCredentialBatchText(googleOAuthJsonTemplate, "Template Google JSON agregado")}
                          data-testid="load-google-oauth-json-template-button"
                        >
                          <UploadCloud className="mr-1 h-3 w-3" />
                          Google JSON
                        </Button>
                      </div>
                    </div>
                    <Textarea
                      id="clipper-credential-batch"
                      value={credentialBatchText}
                      onChange={(event) => {
                        setCredentialBatchText(event.target.value);
                        setCredentialBatchPreview(null);
                      }}
                      placeholder={"TIKTOK_CLIENT_KEY=...\nTIKTOK_CLIENT_SECRET=...\nMETA_APP_ID=...\nGOOGLE_CLIENT_ID=...\n\nO pega el JSON OAuth client de Google Cloud { \"web\": { ... } }"}
                      className="min-h-32 border-zinc-800 bg-black font-mono text-xs"
                      autoComplete="off"
                      data-testid="clipper-credential-batch-input"
                    />
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <p className="text-xs text-zinc-600">Pega varias keys o el JSON OAuth descargado de Google Cloud; la app extrae GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET, guarda en CEO_ASSISTANT_ENV y nunca devuelve valores secretos.</p>
                      <div className="flex flex-col gap-2 sm:flex-row">
                        <Button
                          onClick={() => credentialSecretsBatchPreviewMutation.mutate()}
                          disabled={credentialSecretsBatchPreviewMutation.isPending || !credentialBatchText.trim()}
                          variant="outline"
                          className="border-cyan-300/30 text-cyan-100 hover:bg-cyan-300/10"
                          data-testid="preview-clippers-credential-secrets-batch-button"
                        >
                          {credentialSecretsBatchPreviewMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Eye className="mr-2 h-4 w-4" />}
                          Preview keys
                        </Button>
                        <Button
                          onClick={() => credentialSecretsBatchMutation.mutate()}
                          disabled={credentialSecretsBatchMutation.isPending || !credentialBatchText.trim()}
                          variant="outline"
                          className="border-sky-300/30 text-sky-100 hover:bg-sky-300/10"
                          data-testid="record-clippers-credential-secrets-batch-button"
                        >
                          {credentialSecretsBatchMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <UploadCloud className="mr-2 h-4 w-4" />}
                          Guardar batch
                        </Button>
                      </div>
                    </div>
                    {credentialBatchPreview && (
                      <div className="mt-3 rounded-md border border-white/10 bg-black/30 p-3" data-testid="clippers-credential-batch-preview">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                          <p className="text-xs font-medium text-white">Preview de credenciales</p>
                          <Badge className={cn("w-fit border", credentialBatchPreview.acceptedEnvVars.length ? "border-emerald-300/30 bg-emerald-300/10 text-emerald-200" : "border-amber-300/30 bg-amber-300/10 text-amber-200")}>
                            {credentialBatchPreview.acceptedEnvVars.length ? "ready_to_save" : "needs_values"}
                          </Badge>
                        </div>
                        <div className="mt-3 grid gap-2 text-xs text-zinc-500 md:grid-cols-3">
                          <p>Permitidas: {credentialBatchPreview.acceptedEnvVars.length ? credentialBatchPreview.acceptedEnvVars.join(", ") : "ninguna"}</p>
                          <p>Rechazadas: {credentialBatchPreview.rejectedEnvVars.length ? credentialBatchPreview.rejectedEnvVars.join(", ") : "ninguna"}</p>
                          <p>Skipped: {credentialBatchPreview.skippedLines}</p>
                        </div>
                        {credentialBatchPreview.filesScanned !== undefined && (
                          <div className="mt-2 grid gap-2 text-xs text-zinc-500 md:grid-cols-3">
                            <p>Archivos revisados: {credentialBatchPreview.filesScanned}</p>
                            <p>Archivos importados: {credentialBatchPreview.filesImported || 0}</p>
                            <p>Fuentes: {(credentialBatchPreview.sourceFiles || []).length ? credentialBatchPreview.sourceFiles?.join(", ") : "ninguna"}</p>
                          </div>
                        )}
                        {(credentialBatchPreview.fileErrors || []).length > 0 && (
                          <div className="mt-2 space-y-1">
                            {credentialBatchPreview.fileErrors?.slice(0, 3).map((file) => (
                              <p key={`${file.relativePath}-${file.reason}`} className="break-all text-xs leading-5 text-amber-200">{file.relativePath}: {file.reason}</p>
                            ))}
                          </div>
                        )}
                        <p className="mt-2 text-xs leading-5 text-zinc-500">{credentialBatchPreview.nextStep}</p>
                      </div>
                    )}
                  </div>
                </div>

                {status.credentialDoctor && (
                  <div className="rounded-md border border-sky-300/20 bg-sky-950/10 p-3">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-white">{status.credentialDoctor.markdownPath}</p>
                        <p className="mt-1 text-xs leading-5 text-zinc-500">{status.credentialDoctor.nextStep}</p>
                      </div>
                      <Badge className={cn("w-fit border", credentialDoctorBadge(status.credentialDoctor.status))}>{status.credentialDoctor.status}</Badge>
                    </div>
                    <div className="mt-3 grid gap-2 text-xs text-zinc-500 md:grid-cols-4">
                      <p>Ready: {status.credentialDoctor.totals.ready}</p>
                      <p>Partial: {status.credentialDoctor.totals.partial}</p>
                      <p>Missing: {status.credentialDoctor.totals.missing}</p>
                      <p>Files: {status.credentialDoctor.envFiles.filter((file) => file.exists).length}</p>
                    </div>
                    <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                      {status.credentialDoctor.items.map((item) => (
                        <div key={item.id} className="rounded-md border border-white/10 bg-black/30 p-2">
                          <div className="flex items-center justify-between gap-2">
                            <p className="truncate text-xs font-medium text-white">{item.label}</p>
                            <Badge className={cn("border text-[10px]", credentialDoctorBadge(item.status))}>{item.status}</Badge>
                          </div>
                          <p className="mt-2 text-xs text-zinc-500">Detectadas: {item.configuredEnvVars.length ? item.configuredEnvVars.join(", ") : "ninguna"}</p>
                          <p className="mt-1 text-xs text-zinc-600">Archivos: {item.envFilesWithRelevantKeys.length ? item.envFilesWithRelevantKeys.join(", ") : "ninguno"}</p>
                          <p className="mt-2 text-xs leading-5 text-amber-200">{item.nextStep}</p>
                        </div>
                      ))}
                    </div>
                    <div className="mt-3 grid gap-2 text-xs text-zinc-600 md:grid-cols-3">
                      {status.credentialDoctor.envFiles.map((envFile) => (
                        <p key={envFile.fileName} className="truncate">
                          {envFile.fileName}: {envFile.exists ? envFile.relevantKeys.join(", ") || "sin keys relevantes" : "missing"}
                        </p>
                      ))}
                    </div>
                  </div>
                )}

                {status.platformReadiness && (
                  <div className="rounded-md border border-white/10 bg-black/35 p-3">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-white">{status.platformReadiness.markdownPath}</p>
                        <p className="mt-1 text-xs leading-5 text-zinc-500">{status.platformReadiness.nextStep}</p>
                      </div>
                      <Badge className={cn("w-fit border", platformReadinessBadge(status.platformReadiness.status))}>{status.platformReadiness.status}</Badge>
                    </div>
                    <div className="mt-3 grid gap-2 text-xs text-zinc-500 md:grid-cols-4">
                      <p>Platforms: {status.platformReadiness.totals.platforms}</p>
                      <p>Ready: {status.platformReadiness.totals.ready}</p>
                      <p>Partial: {status.platformReadiness.totals.partial}</p>
                      <p>Blocked: {status.platformReadiness.totals.blocked}</p>
                    </div>
                    <div className="mt-3 grid gap-3 md:grid-cols-3">
                      {status.platformReadiness.items.map((item) => (
                        <div key={item.platform} className="rounded-md border border-white/10 bg-black/30 p-2">
                          <div className="flex items-center justify-between gap-2">
                            <p className="truncate text-xs font-medium text-white">{item.label}</p>
                            <Badge className={cn("border text-[10px]", platformReadinessBadge(item.status))}>{item.status}</Badge>
                          </div>
                          <p className="mt-2 text-xs text-zinc-500">Cuentas: {item.accountsVerified}/{item.accountTasks}</p>
                          <p className="mt-1 text-xs text-zinc-500">Permisos: {item.permissionsApproved}/{item.permissionsTotal}</p>
                          <p className="mt-1 text-xs text-zinc-600">Token: {item.tokenSaved ? "guardado" : "pendiente"}</p>
                          <p className="mt-2 text-xs leading-5 text-amber-200">{item.nextStep}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {status.appReviewSubmissionPack && (
                  <div className="rounded-md border border-violet-300/20 bg-violet-950/10 p-3">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-white">{status.appReviewSubmissionPack.markdownPath}</p>
                        <p className="mt-1 text-xs leading-5 text-zinc-500">{status.appReviewSubmissionPack.nextStep}</p>
                      </div>
                      <Badge className={cn("w-fit border", appReviewSubmissionPackBadge(status.appReviewSubmissionPack.status))}>{status.appReviewSubmissionPack.status}</Badge>
                    </div>
                    <div className="mt-3 grid gap-2 text-xs text-zinc-500 md:grid-cols-5">
                      <p>Platforms: {status.appReviewSubmissionPack.totals.platforms}</p>
                      <p>Ready: {status.appReviewSubmissionPack.totals.ready}</p>
                      <p>Blocked: {status.appReviewSubmissionPack.totals.blocked}</p>
                      <p>Answers: {status.appReviewSubmissionPack.totals.answers}</p>
                      <p>Evidence: {status.appReviewSubmissionPack.totals.evidenceItems}</p>
                    </div>
                    <div className="mt-3 grid gap-3 md:grid-cols-3">
                      {status.appReviewSubmissionPack.items.map((item) => (
                        <div key={item.platform} className="rounded-md border border-white/10 bg-black/30 p-2">
                          <div className="flex items-center justify-between gap-2">
                            <p className="truncate text-xs font-medium text-white">{item.label}</p>
                            <Badge className={cn("border text-[10px]", appReviewSubmissionPackBadge(item.status))}>{item.status}</Badge>
                          </div>
                          <p className="mt-2 break-all text-xs text-zinc-500">{item.redirectUri}</p>
                          <a href={item.demoUrl} target="_blank" rel="noreferrer" className="mt-2 block break-all text-xs text-cyan-200 hover:text-cyan-100">{item.demoUrl}</a>
                          <p className="mt-2 text-xs text-zinc-500">Scopes: {item.requestedScopes.join(", ")}</p>
                          <p className="mt-1 text-xs text-zinc-500">Answers: {item.submissionAnswers.length} · Evidence: {item.evidenceChecklist.length}</p>
                          <p className={cn("mt-1 text-xs", item.productionUrlReady ? "text-emerald-200" : "text-amber-200")}>Prod URL: {item.productionUrlReady ? "ready" : "blocked"}</p>
                          <p className="mt-2 text-xs leading-5 text-amber-200">{item.nextStep}</p>
                          <a href={item.developerPortalUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 rounded-md border border-white/10 px-2 py-1 text-xs text-cyan-200 hover:bg-white/5">
                            Portal
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {status.productionUrlSetup && (
                  <div className="rounded-md border border-teal-300/20 bg-teal-950/10 p-3">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-white">{status.productionUrlSetup.markdownPath}</p>
                        <p className="mt-1 text-xs leading-5 text-zinc-500">{status.productionUrlSetup.nextStep}</p>
                      </div>
                      <Badge className={cn("w-fit border", oauthGoLiveBadge(status.productionUrlSetup.status))}>{status.productionUrlSetup.status}</Badge>
                    </div>
                    <div className="mt-3 grid gap-2 text-xs text-zinc-500 md:grid-cols-4">
                      <p>Env: {status.productionUrlSetup.requiredEnvVar}</p>
                      <p>Protocol: {status.productionUrlSetup.requiredProtocol}</p>
                      <p>Prod URL: {status.productionUrlSetup.productionUrlReady ? "yes" : "no"}</p>
                      <p>Platforms: {status.productionUrlSetup.platforms.length}</p>
                    </div>
                    <p className={cn("mt-2 break-all text-xs", status.productionUrlSetup.productionUrlReady ? "text-emerald-200" : "text-amber-200")}>
                      Base: {status.productionUrlSetup.publicBaseUrl} · {status.productionUrlSetup.productionUrlNote}
                    </p>
                    {status.productionUrlSetup.saveChecklist.length > 0 && (
                      <div className="mt-3 rounded-md border border-teal-300/15 bg-teal-950/10 p-2">
                        <p className="text-xs font-semibold uppercase tracking-wide text-teal-200">Save checklist</p>
                        <ul className="mt-1 grid gap-1 text-xs leading-4 text-teal-100/80 md:grid-cols-2">
                          {status.productionUrlSetup.saveChecklist.map((step) => (
                            <li key={step}>{step}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {status.productionUrlSetup.endpointChecks.length > 0 && (
                      <div className="mt-3 rounded-md border border-cyan-300/15 bg-cyan-950/10 p-2">
                        <p className="text-xs font-semibold uppercase tracking-wide text-cyan-200">Endpoint checks</p>
                        <div className="mt-2 grid gap-2 md:grid-cols-2">
                          {status.productionUrlSetup.endpointChecks.slice(0, 8).map((check) => (
                            <a key={check.id} href={check.url} target="_blank" rel="noreferrer" className="rounded-md border border-white/10 bg-black/25 p-2 text-xs text-cyan-100 hover:bg-white/5">
                              <p className="font-medium text-white">{check.label}</p>
                              <p className="mt-1 break-all">{check.url}</p>
                              <p className="mt-1 text-zinc-500">{check.expected}</p>
                            </a>
                          ))}
                        </div>
                      </div>
                    )}
                    {status.productionUrlVerification && (
                      <div className="mt-3 rounded-md border border-emerald-300/15 bg-emerald-950/10 p-2">
                        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                          <div className="min-w-0">
                            <p className="text-xs font-semibold uppercase tracking-wide text-emerald-200">Live verification</p>
                            <p className="mt-1 break-all text-xs text-zinc-500">{status.productionUrlVerification.markdownPath}</p>
                          </div>
                          <Badge className={cn("w-fit border", status.productionUrlVerification.status === "pass" ? "border-emerald-300/30 bg-emerald-300/10 text-emerald-200" : status.productionUrlVerification.status === "partial" ? "border-amber-300/30 bg-amber-300/10 text-amber-200" : "border-red-300/30 bg-red-300/10 text-red-200")}>
                            {status.productionUrlVerification.status}
                          </Badge>
                        </div>
                        <div className="mt-3 grid gap-2 text-xs text-zinc-500 md:grid-cols-4">
                          <p>Pass: {status.productionUrlVerification.totals.pass}</p>
                          <p>Fail: {status.productionUrlVerification.totals.fail}</p>
                          <p>Skipped: {status.productionUrlVerification.totals.skipped}</p>
                          <p>Total: {status.productionUrlVerification.totals.endpoints}</p>
                        </div>
                        <p className="mt-2 text-xs leading-5 text-zinc-400">{status.productionUrlVerification.nextStep}</p>
                        <div className="mt-3 rounded-md border border-cyan-300/15 bg-cyan-950/10 p-2">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-[10px] font-semibold uppercase tracking-wide text-cyan-200">DNS diagnostic</p>
                            <Badge className={cn("border text-[10px]", status.productionUrlVerification.dnsDiagnostic.status === "resolved" ? "border-emerald-300/30 bg-emerald-300/10 text-emerald-200" : "border-red-300/30 bg-red-300/10 text-red-200")}>
                              {status.productionUrlVerification.dnsDiagnostic.status}
                            </Badge>
                          </div>
                          <p className="mt-2 break-all text-xs text-cyan-100/80">{status.productionUrlVerification.dnsDiagnostic.host || "No host"}</p>
                          <p className="mt-1 text-xs leading-5 text-zinc-400">{status.productionUrlVerification.dnsDiagnostic.nextStep}</p>
                          {status.productionUrlVerification.dnsDiagnostic.error && (
                            <p className="mt-1 break-all text-xs text-red-200">{status.productionUrlVerification.dnsDiagnostic.error}</p>
                          )}
                          {status.productionUrlVerification.dnsDiagnostic.suggestedRecords.length > 0 && (
                            <div className="mt-2 space-y-1 text-xs leading-4 text-cyan-100/75">
                              {status.productionUrlVerification.dnsDiagnostic.suggestedRecords.slice(0, 2).map((record) => (
                                <p key={record} className="break-all">{record}</p>
                              ))}
                            </div>
                          )}
                          <div className="mt-2 grid gap-2 text-[11px] text-zinc-500 md:grid-cols-2">
                            <p>Root: {status.productionUrlVerification.dnsDiagnostic.rootDomain || "n/a"}</p>
                            <p>Apex: {status.productionUrlVerification.dnsDiagnostic.isApexDomain ? "yes" : "no"}</p>
                          </div>
                          {status.productionUrlVerification.dnsDiagnostic.recordCandidates.length > 0 && (
                            <div className="mt-3 grid gap-2 lg:grid-cols-3">
                              {status.productionUrlVerification.dnsDiagnostic.recordCandidates.slice(0, 3).map((record) => (
                                <div key={record.id} className="rounded-md border border-white/10 bg-black/25 p-2">
                                  <div className="flex items-center justify-between gap-2">
                                    <p className="truncate text-xs font-medium text-white">{record.label}</p>
                                    <Badge className={cn("border text-[10px]", record.priority === "recommended" ? "border-emerald-300/30 bg-emerald-300/10 text-emerald-200" : "border-amber-300/30 bg-amber-300/10 text-amber-200")}>
                                      {record.recordType}
                                    </Badge>
                                  </div>
                                  <p className="mt-1 break-all font-mono text-[11px] leading-4 text-cyan-100/80">{record.copyLine}</p>
                                  <p className="mt-1 break-all font-mono text-[11px] leading-4 text-zinc-500">{record.validationCommand}</p>
                                </div>
                              ))}
                            </div>
                          )}
                          {status.productionUrlVerification.dnsDiagnostic.propagationChecks.length > 0 && (
                            <div className="mt-3 rounded-md border border-white/10 bg-black/20 p-2">
                              <p className="text-[10px] font-semibold uppercase tracking-wide text-cyan-200">Propagation checks</p>
                              <div className="mt-2 grid gap-1 md:grid-cols-2">
                                {status.productionUrlVerification.dnsDiagnostic.propagationChecks.slice(0, 4).map((command) => (
                                  <p key={command} className="break-all font-mono text-[11px] leading-4 text-zinc-400">{command}</p>
                                ))}
                              </div>
                            </div>
                          )}
                          {status.productionUrlVerification.dnsDiagnostic.blockedUntilResolved.length > 0 && (
                            <p className="mt-2 text-[11px] leading-4 text-amber-100/80">
                              Hold: {status.productionUrlVerification.dnsDiagnostic.blockedUntilResolved[0]}
                            </p>
                          )}
                        </div>
                        <div className="mt-2 grid gap-2 md:grid-cols-2">
                          {status.productionUrlVerification.items.slice(0, 8).map((item) => (
                            <a key={item.id} href={item.url} target="_blank" rel="noreferrer" className="rounded-md border border-white/10 bg-black/25 p-2 text-xs text-emerald-100 hover:bg-white/5">
                              <div className="flex items-center justify-between gap-2">
                                <p className="truncate font-medium text-white">{item.label}</p>
                                <Badge className={cn("border text-[10px]", item.status === "pass" ? "border-emerald-300/30 bg-emerald-300/10 text-emerald-200" : item.status === "skipped" ? "border-zinc-500/30 bg-zinc-500/10 text-zinc-300" : "border-red-300/30 bg-red-300/10 text-red-200")}>{item.status}</Badge>
                              </div>
                              <p className="mt-1 break-all text-zinc-500">{item.url}</p>
                              <p className="mt-1 text-zinc-500">HTTP {item.statusCode ?? "n/a"} · {item.responseMs ?? "n/a"}ms</p>
                              {item.error && <p className="mt-1 text-red-200">{item.error}</p>}
                            </a>
                          ))}
                        </div>
                      </div>
                    )}
                    {status.productionUrlSetup.setupSession.length > 0 && (
                      <div className="mt-3 rounded-md border border-teal-300/15 bg-teal-950/10 p-2">
                        <p className="text-xs font-semibold uppercase tracking-wide text-teal-200">URL setup session</p>
                        <div className="mt-2 grid gap-2 lg:grid-cols-3">
                          {status.productionUrlSetup.setupSession.slice(0, 5).map((item) => (
                            <div key={item.id} className="rounded-md border border-white/10 bg-black/25 p-2">
                              <div className="flex items-center justify-between gap-2">
                                <p className="truncate text-xs font-medium text-white">#{item.rank} {item.label}</p>
                                <Badge className={cn("border text-[10px]", item.status === "ready" ? "border-emerald-300/30 bg-emerald-300/10 text-emerald-200" : "border-red-300/30 bg-red-300/10 text-red-200")}>{item.status}</Badge>
                              </div>
                              <p className="mt-1 text-xs text-zinc-500">{item.owner}</p>
                              <p className="mt-2 break-all text-xs leading-4 text-teal-100/80">{item.copyValue}</p>
                              {item.clipboardValues.length > 0 && (
                                <p className="mt-2 break-all text-[11px] leading-4 text-zinc-500">
                                  Copy: {item.clipboardValues.slice(0, 2).map((field) => `${field.label}=${field.value}`).join(" · ")}
                                </p>
                              )}
                              {item.verificationUrls.length > 0 && (
                                <p className="mt-2 break-all text-[11px] leading-4 text-cyan-100/70">Check: {item.verificationUrls[0]}</p>
                              )}
                              {item.evidenceRecipeRow && (
                                <Button size="sm" variant="outline" className="mt-2 h-7 border-teal-300/20 bg-transparent px-2 text-xs text-teal-100 hover:bg-teal-300/10" onClick={() => appendLaunchEvidenceBatchRow(item.evidenceRecipeRow)}>
                                  <UploadCloud className="mr-1 h-3 w-3" />
                                  Evidence row
                                </Button>
                              )}
                              <p className="mt-2 text-xs leading-5 text-zinc-400">{item.nextStep}</p>
                              {item.doneCriteria.length > 0 && (
                                <p className="mt-2 text-[11px] leading-4 text-emerald-100/80">Done: {item.doneCriteria[0]}</p>
                              )}
                              {item.portalUrl && item.portalUrl.startsWith("http") && (
                                <a href={item.portalUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 rounded-md border border-white/10 px-2 py-1 text-xs text-cyan-200 hover:bg-white/5">
                                  Portal
                                  <ExternalLink className="h-3 w-3" />
                                </a>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    <div className="mt-3 grid gap-3 lg:grid-cols-[1fr_auto] lg:items-end">
                      <div className="space-y-1">
                        <Label htmlFor="clipper-production-public-url" className="text-xs text-zinc-400">PUBLIC_BASE_URL HTTPS</Label>
                        <Input
                          id="clipper-production-public-url"
                          value={productionPublicUrl}
                          onChange={(event) => setProductionPublicUrl(event.target.value)}
                          placeholder="https://clippers.yourdomain.com"
                          className="border-zinc-800 bg-black"
                          data-testid="clipper-production-public-url-input"
                        />
                      </div>
                      <Button
                        type="button"
                        onClick={() => productionPublicUrlMutation.mutate()}
                        disabled={productionPublicUrlMutation.isPending || !productionPublicUrl.trim()}
                        className="bg-teal-200 text-zinc-950 hover:bg-teal-100"
                        data-testid="record-clippers-production-public-url-button"
                      >
                        {productionPublicUrlMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ExternalLink className="mr-2 h-4 w-4" />}
                        Guardar URL
                      </Button>
                    </div>
                    {status.httpsTunnelPlan && (
                      <div className="mt-3 rounded-md border border-green-300/20 bg-green-950/10 p-3">
                        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                          <div className="min-w-0">
                            <p className="truncate font-medium text-white">{status.httpsTunnelPlan.markdownPath}</p>
                            <p className="mt-1 text-xs leading-5 text-zinc-500">{status.httpsTunnelPlan.nextStep}</p>
                          </div>
                          <Badge className={cn("w-fit border", httpsTunnelPlanBadge(status.httpsTunnelPlan.status))}>{status.httpsTunnelPlan.status}</Badge>
                        </div>
                        <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                          {status.httpsTunnelPlan.options.map((option) => (
                            <div key={option.id} className="rounded-md border border-white/10 bg-black/30 p-2">
                              <div className="flex items-center justify-between gap-2">
                                <p className="truncate text-xs font-medium text-white">{option.label}</p>
                                <Badge className={cn("border text-[10px]", httpsTunnelPlanBadge(option.status))}>{option.status}</Badge>
                              </div>
                              <p className="mt-1 text-xs text-zinc-500">{option.fit}</p>
                              <p className="mt-2 text-xs leading-5 text-zinc-400">{option.publicUrlRequirement}</p>
                              <p className="mt-2 text-xs leading-5 text-amber-200">{option.nextStep}</p>
                              <a href={option.portalUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 rounded-md border border-white/10 px-2 py-1 text-xs text-cyan-200 hover:bg-white/5">
                                Portal
                                <ExternalLink className="h-3 w-3" />
                              </a>
                            </div>
                          ))}
                        </div>
                        {status.httpsTunnelPlan.executionSession.length > 0 && (
                          <div className="mt-3 rounded-md border border-white/10 bg-black/20 p-2">
                            <p className="text-xs font-semibold uppercase tracking-wide text-green-200">Execution session</p>
                            <div className="mt-2 grid gap-2 lg:grid-cols-2">
                              {status.httpsTunnelPlan.executionSession.slice(0, 4).map((item) => (
                                <div key={item.optionId} className="rounded-md border border-white/10 bg-black/25 p-2">
                                  <div className="flex items-center justify-between gap-2">
                                    <p className="truncate text-xs font-medium text-white">#{item.rank} {item.label}</p>
                                    <Badge className="border border-white/10 bg-black/30 text-[10px] text-zinc-300">{item.recommended ? "recommended" : item.fit}</Badge>
                                  </div>
                                  <p className="mt-1 text-xs text-zinc-500">{item.expectedPublicUrlPattern}</p>
                                  <p className="mt-1 break-all text-xs text-green-100/80">{item.publicBaseUrlTemplate}</p>
                                  <p className="mt-2 break-all font-mono text-[11px] leading-4 text-zinc-400">{item.commandSequence[0]}</p>
                                  {item.endpointChecks.length > 0 && (
                                    <p className="mt-2 break-all text-[11px] leading-4 text-cyan-100/70">Check: {item.endpointChecks[0].url}</p>
                                  )}
                                  {item.stabilityChecklist.length > 0 && (
                                    <p className="mt-2 text-[11px] leading-4 text-amber-100/70">Stable: {item.stabilityChecklist[0]}</p>
                                  )}
                                  <p className="mt-2 text-xs leading-5 text-emerald-100/80">{item.doneCriteria[0]}</p>
                                  <a href={item.portalUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 rounded-md border border-white/10 px-2 py-1 text-xs text-cyan-200 hover:bg-white/5">
                                    Portal
                                    <ExternalLink className="h-3 w-3" />
                                  </a>
                                </div>
                              ))}
                          </div>
                            <p className="mt-2 text-xs leading-5 text-zinc-500">
                              Register after save: {status.httpsTunnelPlan.executionSession[0]?.registerAfterSave.slice(0, 3).join(" · ")}
                            </p>
                          </div>
                        )}
                      </div>
                    )}
                    {status.legalPolicyPack && (
                      <div className="mt-3 rounded-md border border-rose-300/20 bg-rose-950/10 p-3">
                        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                          <div className="min-w-0">
                            <p className="truncate font-medium text-white">{status.legalPolicyPack.markdownPath}</p>
                            <p className="mt-1 text-xs leading-5 text-zinc-500">{status.legalPolicyPack.nextStep}</p>
                          </div>
                          <Badge className={cn("w-fit border", legalPolicyPackBadge(status.legalPolicyPack.status))}>{status.legalPolicyPack.status}</Badge>
                        </div>
                        <div className="mt-3 grid gap-3 md:grid-cols-2">
                          <a href={status.legalPolicyPack.privacyUrl} target="_blank" rel="noreferrer" className="rounded-md border border-white/10 bg-black/30 p-2 text-xs text-cyan-200 hover:bg-white/5">
                            <p className="font-medium text-white">Privacy Policy</p>
                            <p className="mt-1 break-all">{status.legalPolicyPack.privacyUrl}</p>
                          </a>
                          <a href={status.legalPolicyPack.termsUrl} target="_blank" rel="noreferrer" className="rounded-md border border-white/10 bg-black/30 p-2 text-xs text-cyan-200 hover:bg-white/5">
                            <p className="font-medium text-white">Terms of Service</p>
                            <p className="mt-1 break-all">{status.legalPolicyPack.termsUrl}</p>
                          </a>
                        </div>
                      </div>
                    )}
                    {status.appReviewDemoPack && (
                      <div className="mt-3 rounded-md border border-fuchsia-300/20 bg-fuchsia-950/10 p-3">
                        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                          <div className="min-w-0">
                            <p className="truncate font-medium text-white">{status.appReviewDemoPack.markdownPath}</p>
                            <p className="mt-1 text-xs leading-5 text-zinc-500">{status.appReviewDemoPack.nextStep}</p>
                          </div>
                          <Badge className={cn("w-fit border", appReviewDemoPackBadge(status.appReviewDemoPack.status))}>{status.appReviewDemoPack.status}</Badge>
                        </div>
                        <div className="mt-3 grid gap-3 md:grid-cols-2">
                          <a href={status.appReviewDemoPack.demoUrl} target="_blank" rel="noreferrer" className="rounded-md border border-white/10 bg-black/30 p-2 text-xs text-cyan-200 hover:bg-white/5">
                            <p className="font-medium text-white">Review Demo URL</p>
                            <p className="mt-1 break-all">{status.appReviewDemoPack.demoUrl}</p>
                          </a>
                          <div className="rounded-md border border-white/10 bg-black/30 p-2 text-xs text-zinc-400">
                            <p className="font-medium text-white">Screencast script</p>
                            <p className="mt-1 break-all">{status.appReviewDemoPack.demoScriptPath}</p>
                          </div>
                        </div>
                        <div className="mt-3 grid gap-3 md:grid-cols-3">
                          {status.appReviewDemoPack.steps.map((step) => (
                            <div key={step.id} className="rounded-md border border-white/10 bg-black/30 p-2">
                              <div className="flex items-center justify-between gap-2">
                                <p className="truncate text-xs font-medium text-white">{step.label}</p>
                                <Badge className={cn("border text-[10px]", appReviewDemoPackBadge(step.status))}>{step.status}</Badge>
                              </div>
                              <p className="mt-1 text-xs text-zinc-500">{step.owner}</p>
                              <p className="mt-2 text-xs leading-5 text-amber-200">{step.nextStep}</p>
                              <p className="mt-2 text-xs text-zinc-500">Checklist: {step.checklist.length}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    <div className="mt-3 grid gap-3 md:grid-cols-3">
                      {status.productionUrlSetup.platforms.map((platform) => (
                        <div key={platform.platform} className="rounded-md border border-white/10 bg-black/30 p-2">
                          <div className="flex items-center justify-between gap-2">
                            <p className="truncate text-xs font-medium text-white">{platform.label}</p>
                            <Badge variant="outline" className="border-white/10 text-[10px] text-zinc-300">
                              {platform.domainVerificationRequired ? "domain check" : "redirect"}
                            </Badge>
                          </div>
                          <p className="mt-2 break-all text-xs text-zinc-500">{platform.redirectUri}</p>
                          <p className="mt-1 break-all text-xs text-emerald-100/80">{platform.publicRedirectUri}</p>
                          <p className="mt-1 break-all text-xs text-zinc-500">{platform.publicDemoUrl}</p>
                          <Button size="sm" variant="outline" className="mt-2 h-7 border-teal-300/20 bg-transparent px-2 text-xs text-teal-100 hover:bg-teal-300/10" onClick={() => appendLaunchEvidenceBatchRow(platform.evidenceRecipeRow)}>
                            <UploadCloud className="mr-1 h-3 w-3" />
                            Evidence
                          </Button>
                          <a href={platform.developerPortalUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 rounded-md border border-white/10 px-2 py-1 text-xs text-cyan-200 hover:bg-white/5">
                            Portal
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {status.oauthGoLive && (
                  <div className="rounded-md border border-cyan-300/20 bg-cyan-950/10 p-3">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-white">{status.oauthGoLive.markdownPath}</p>
                        <p className="mt-1 text-xs leading-5 text-zinc-500">{status.oauthGoLive.nextStep}</p>
                      </div>
                      <Badge className={cn("w-fit border", oauthGoLiveBadge(status.oauthGoLive.status))}>{status.oauthGoLive.status}</Badge>
                    </div>
                    <div className="mt-3 grid gap-2 text-xs text-zinc-500 md:grid-cols-5">
                      <p>Platforms: {status.oauthGoLive.totals.platforms}</p>
                      <p>Ready: {status.oauthGoLive.totals.ready}</p>
                      <p>Partial: {status.oauthGoLive.totals.partial}</p>
                      <p>Blocked: {status.oauthGoLive.totals.blocked}</p>
                      <p>Prod URL: {status.oauthGoLive.productionUrlReady ? "yes" : "no"}</p>
                    </div>
                    <p className={cn("mt-2 break-all text-xs", status.oauthGoLive.productionUrlReady ? "text-emerald-200" : "text-amber-200")}>
                      Base: {status.oauthGoLive.publicBaseUrl} · {status.oauthGoLive.productionUrlNote}
                    </p>
                    <div className="mt-3 grid gap-3 md:grid-cols-3">
                      {status.oauthGoLive.items.map((item) => (
                        <div key={item.platform} className="rounded-md border border-white/10 bg-black/30 p-2">
                          <div className="flex items-center justify-between gap-2">
                            <p className="truncate text-xs font-medium text-white">{item.label}</p>
                            <Badge className={cn("border text-[10px]", oauthGoLiveBadge(item.status))}>{item.status}</Badge>
                          </div>
                          <p className="mt-2 break-all text-xs text-zinc-600">{item.redirectUri}</p>
                          <p className="mt-2 text-xs text-zinc-500">Token: {item.tokenSaved ? "yes" : "no"} · Vault: {item.tokenVaultReady ? "yes" : "no"}</p>
                          <p className="mt-1 text-xs text-zinc-500">Keys: {item.credentialsReady ? "ready" : "missing"} · Permisos: {item.permissionsApproved}/{item.permissionsTotal}</p>
                          <p className={cn("mt-1 text-xs", item.productionUrlReady ? "text-emerald-200" : "text-amber-200")}>Prod URL: {item.productionUrlReady ? "ready" : "local/dev"}</p>
                          <p className="mt-1 text-xs text-zinc-500">Connector: {item.publisherConnectorStatus}</p>
                          <p className="mt-2 text-xs leading-5 text-amber-200">{item.nextStep}</p>
                          {item.authUrl && (
                            <a href={item.authUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 rounded-md border border-white/10 px-2 py-1 text-xs text-cyan-200 hover:bg-white/5">
                              Abrir OAuth
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {status.oauthConnectionPack && (
                  <div className="rounded-md border border-teal-300/20 bg-teal-950/10 p-3">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-white">{status.oauthConnectionPack.markdownPath}</p>
                        <p className="mt-1 text-xs leading-5 text-zinc-500">{status.oauthConnectionPack.nextStep}</p>
                      </div>
                      <Badge className={cn("w-fit border", oauthConnectionPackBadge(status.oauthConnectionPack.status))}>{status.oauthConnectionPack.status}</Badge>
                    </div>
                    <div className="mt-3 grid gap-2 text-xs text-zinc-500 md:grid-cols-6">
                      <p>Connections: {status.oauthConnectionPack.totals.connections}</p>
                      <p>Ready: {status.oauthConnectionPack.totals.ready}</p>
                      <p>Partial: {status.oauthConnectionPack.totals.partial}</p>
                      <p>Blocked: {status.oauthConnectionPack.totals.blocked}</p>
                      <p>Tokens: {status.oauthConnectionPack.totals.tokensSaved}</p>
                      <p>OAuth URLs: {status.oauthConnectionPack.totals.authUrlsReady}</p>
                    </div>
                    <p className="mt-2 break-all text-xs text-zinc-600">CSV: {status.oauthConnectionPack.csvPath}</p>
                    <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                      {status.oauthConnectionPack.items.map((item) => (
                        <div key={item.id} className="rounded-md border border-white/10 bg-black/30 p-2">
                          <div className="flex items-center justify-between gap-2">
                            <p className="truncate text-xs font-medium text-white">{item.accountName} · {item.platform}</p>
                            <Badge className={cn("border text-[10px]", oauthConnectionPackBadge(item.status))}>{item.status}</Badge>
                          </div>
                          <p className="mt-1 truncate text-xs text-zinc-500">{item.handle} · {item.displayName}</p>
                          <p className="mt-2 break-all text-xs text-zinc-600">{item.redirectUri}</p>
                          <p className="mt-2 text-xs text-zinc-500">Token: {item.tokenSaved ? "yes" : "no"} · Evidence: {item.accountEvidenceStatus}</p>
                          <p className="mt-1 text-xs text-zinc-500">Permissions: {item.permissionSummary}</p>
                          <p className="mt-2 text-xs leading-5 text-amber-200">{item.nextStep}</p>
                          <p className="mt-2 text-xs leading-5 text-teal-100/80">{item.completionHint}</p>
                          {item.requiredInputs.length > 0 && (
                            <div className="mt-2 rounded-md border border-teal-300/15 bg-teal-950/10 p-2">
                              <p className="text-[10px] font-semibold uppercase tracking-wide text-teal-200">Required inputs</p>
                              <ul className="mt-1 space-y-1 text-xs leading-4 text-teal-100/80">
                                {item.requiredInputs.slice(0, 4).map((requiredInput) => (
                                  <li key={requiredInput}>{requiredInput}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                          <div className="mt-2 flex flex-wrap gap-2">
                            {item.authUrl && (
                              <a href={item.authUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md border border-white/10 px-2 py-1 text-xs text-cyan-200 hover:bg-white/5">
                                OAuth
                                <ExternalLink className="h-3 w-3" />
                              </a>
                            )}
                            <a href={item.developerPortalUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md border border-white/10 px-2 py-1 text-xs text-teal-200 hover:bg-white/5">
                              Portal
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {status.goLiveExecutionPack && (
                  <div className="rounded-md border border-blue-300/20 bg-blue-950/10 p-3">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-white">{status.goLiveExecutionPack.markdownPath}</p>
                        <p className="mt-1 text-xs leading-5 text-zinc-500">{status.goLiveExecutionPack.nextStep}</p>
                      </div>
                      <Badge className={cn("w-fit border", goLiveExecutionBadge(status.goLiveExecutionPack.status))}>{status.goLiveExecutionPack.status}</Badge>
                    </div>
                    <div className="mt-3 grid gap-2 text-xs text-zinc-500 md:grid-cols-5">
                      <p>Platforms: {status.goLiveExecutionPack.totals.platforms}</p>
                      <p>Ready: {status.goLiveExecutionPack.totals.ready}</p>
                      <p>Progress: {status.goLiveExecutionPack.totals.inProgress}</p>
                      <p>Phases: {status.goLiveExecutionPack.totals.done}/{status.goLiveExecutionPack.totals.phases}</p>
                      <p>Runnable: {status.goLiveExecutionPack.totals.readyToExecute}</p>
                    </div>
                    <div className="mt-3 grid gap-3 md:grid-cols-3">
                      {status.goLiveExecutionPack.platforms.map((platform) => (
                        <div key={platform.platform} className="rounded-md border border-white/10 bg-black/30 p-2">
                          <div className="flex items-center justify-between gap-2">
                            <p className="truncate text-xs font-medium text-white">{platform.label}</p>
                            <Badge className={cn("border text-[10px]", goLiveExecutionBadge(platform.status))}>{platform.status}</Badge>
                          </div>
                          <p className="mt-2 text-xs text-zinc-500">Done: {platform.totals.done}/{platform.totals.phases} · Ready: {platform.totals.readyToExecute}</p>
                          <p className="mt-2 text-xs leading-5 text-amber-200">{platform.nextStep}</p>
                          <div className="mt-3 space-y-1">
                            {platform.phases.slice(0, 4).map((phase) => (
                              <div key={phase.id} className="flex items-center justify-between gap-2 rounded border border-white/10 px-2 py-1">
                                <p className="truncate text-xs text-zinc-400">{phase.label}</p>
                                <Badge className={cn("shrink-0 border text-[10px]", goLiveExecutionBadge(phase.status))}>{phase.status}</Badge>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {status.externalSetupQueue && (
                  <div className="rounded-md border border-orange-300/20 bg-orange-950/10 p-3">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-white">{status.externalSetupQueue.markdownPath}</p>
                        <p className="mt-1 text-xs leading-5 text-zinc-500">{status.externalSetupQueue.nextStep}</p>
                      </div>
                      <Badge className={cn("w-fit border", externalSetupQueueBadge(status.externalSetupQueue.status))}>{status.externalSetupQueue.status}</Badge>
                    </div>
                    <div className="mt-3 grid gap-2 text-xs text-zinc-500 md:grid-cols-5">
                      <p>Tasks: {status.externalSetupQueue.totals.items}</p>
                      <p>Done: {status.externalSetupQueue.totals.done}</p>
                      <p>Action: {status.externalSetupQueue.totals.needsAction}</p>
                      <p>Blocked: {status.externalSetupQueue.totals.blocked}</p>
                      <p>Critical: {status.externalSetupQueue.totals.critical}</p>
                    </div>
                    <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                      {status.externalSetupQueue.items.slice(0, 9).map((item) => (
                        <div key={item.id} className="rounded-md border border-white/10 bg-black/30 p-2">
                          <div className="flex items-center justify-between gap-2">
                            <p className="truncate text-xs font-medium text-white">{item.label}</p>
                            <Badge className={cn("border text-[10px]", externalSetupQueueBadge(item.status))}>{item.status}</Badge>
                          </div>
                          <div className="mt-2 flex flex-wrap gap-1">
                            <Badge className={cn("border text-[10px]", externalSetupQueueBadge(item.priority))}>{item.priority}</Badge>
                            <Badge className="border border-white/10 bg-zinc-900 text-[10px] text-zinc-300">{item.type}</Badge>
                            <Badge className="border border-white/10 bg-zinc-900 text-[10px] text-zinc-300">{item.platform}</Badge>
                          </div>
                          <p className="mt-2 text-xs leading-5 text-amber-200">{item.nextStep}</p>
                          {item.envVars.length > 0 && (
                            <p className="mt-2 text-xs leading-5 text-red-200">Keys: {item.envVars.join(", ")}</p>
                          )}
                          {item.requiredInputs.length > 0 && (
                            <div className="mt-2 rounded-md border border-orange-300/15 bg-orange-950/10 p-2">
                              <p className="text-[10px] font-semibold uppercase tracking-wide text-orange-200">Inputs</p>
                              <ul className="mt-1 space-y-1 text-xs leading-4 text-orange-100/80">
                                {item.requiredInputs.slice(0, 4).map((requiredInput) => (
                                  <li key={requiredInput}>{requiredInput}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                          {item.doneCriteria.length > 0 && (
                            <p className="mt-2 text-xs leading-5 text-zinc-400">
                              Done: {item.doneCriteria[0]}
                            </p>
                          )}
                          {item.portalUrl.startsWith("http") && (
                            <a href={item.portalUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 rounded-md border border-white/10 px-2 py-1 text-xs text-cyan-200 hover:bg-white/5">
                              Abrir portal
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {status.externalLaunchDossier && (
                  <div className="rounded-md border border-amber-300/20 bg-amber-950/10 p-3">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-white">{status.externalLaunchDossier.markdownPath}</p>
                        <p className="mt-1 text-xs leading-5 text-zinc-500">{status.externalLaunchDossier.nextStep}</p>
                      </div>
                      <Badge className={cn("w-fit border", externalLaunchDossierBadge(status.externalLaunchDossier.status))}>{status.externalLaunchDossier.status}</Badge>
                    </div>
                    <div className="mt-3 grid gap-2 text-xs text-zinc-500 md:grid-cols-8">
                      <p>Platforms: {status.externalLaunchDossier.totals.platforms}</p>
                      <p>Ready: {status.externalLaunchDossier.totals.ready}</p>
                      <p>Progress: {status.externalLaunchDossier.totals.inProgress}</p>
                      <p>Blocked: {status.externalLaunchDossier.totals.blocked}</p>
                      <p>Actions: {status.externalLaunchDossier.totals.criticalActions}</p>
                      <p>External: {status.externalLaunchDossier.totals.blockedExternalItems}</p>
                      <p>Inputs: {status.externalLaunchDossier.totals.unlockInputs}</p>
                      <p>Scopes: {status.externalLaunchDossier.totals.permissionUnlocks}</p>
                    </div>
                    <div className="mt-3 grid gap-3 md:grid-cols-3">
                      {status.externalLaunchDossier.platforms.map((item) => (
                        <div key={item.platform} className="rounded-md border border-white/10 bg-black/30 p-2">
                          <div className="flex items-center justify-between gap-2">
                            <p className="truncate text-xs font-medium text-white">{item.label}</p>
                            <Badge className={cn("border text-[10px]", externalLaunchDossierBadge(item.status))}>{item.status}</Badge>
                          </div>
                          <p className="mt-2 text-xs text-zinc-500">Cuentas: {item.accountTasksDone}/{item.accountTasks}</p>
                          <p className="mt-1 text-xs text-zinc-500">App: {item.developerAppStatus} · Keys: {item.credentialStatus}</p>
                          <p className="mt-1 text-xs text-zinc-500">Permisos: {item.permissionsApproved}/{item.permissionsTotal} · OAuth: {item.oauthStatus}</p>
                          <p className="mt-1 text-xs text-zinc-500">External blockers: {item.blockedExternalItems}</p>
                          <p className="mt-2 text-xs leading-5 text-amber-200">{item.nextStep}</p>
                          {item.unlockInputs.length > 0 && (
                            <div className="mt-2 rounded-md border border-amber-300/15 bg-amber-950/10 p-2">
                              <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-200">Unlock inputs</p>
                              <ul className="mt-1 space-y-1 text-xs leading-4 text-amber-100/80">
                                {item.unlockInputs.slice(0, 4).map((input) => (
                                  <li key={input}>{input}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                          {item.permissionUnlocks.length > 0 && (
                            <div className="mt-2 space-y-2 rounded-md border border-cyan-300/15 bg-cyan-950/10 p-2">
                              <p className="text-[10px] font-semibold uppercase tracking-wide text-cyan-200">Permission unlocks</p>
                              {item.permissionUnlocks.slice(0, 3).map((permission) => (
                                <div key={permission.scope} className="border-t border-white/10 pt-2 first:border-t-0 first:pt-0">
                                  <p className="break-all text-xs font-medium text-cyan-100">{permission.scope}</p>
                                  <p className="mt-1 text-xs leading-4 text-cyan-100/70">{permission.requestAction}</p>
                                  <div className="mt-2 flex flex-wrap gap-1">
                                    <a href={permission.requestPortalUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md border border-cyan-300/20 px-2 py-1 text-xs text-cyan-100 hover:bg-cyan-300/10">
                                      Portal
                                      <ExternalLink className="h-3 w-3" />
                                    </a>
                                    <Button size="sm" variant="outline" className="h-7 border-green-300/20 bg-transparent px-2 text-xs text-green-100 hover:bg-green-300/10" onClick={() => appendLaunchEvidenceBatchRow(permission.evidenceBatchRow)}>
                                      <UploadCloud className="mr-1 h-3 w-3" />
                                      Row
                                    </Button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                          <div className="mt-2 flex flex-wrap gap-1">
                            <a href={item.accountCreationUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md border border-white/10 px-2 py-1 text-xs text-cyan-200 hover:bg-white/5">
                              Cuenta
                              <ExternalLink className="h-3 w-3" />
                            </a>
                            <a href={item.developerPortalUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md border border-white/10 px-2 py-1 text-xs text-cyan-200 hover:bg-white/5">
                              Dev
                              <ExternalLink className="h-3 w-3" />
                            </a>
                            {item.oauthUrl && (
                              <a href={item.oauthUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md border border-white/10 px-2 py-1 text-xs text-cyan-200 hover:bg-white/5">
                                OAuth
                                <ExternalLink className="h-3 w-3" />
                              </a>
                            )}
                          </div>
                          {item.criticalActions.length > 0 && (
                            <p className="mt-2 text-xs leading-5 text-zinc-500">{item.criticalActions[0]}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {status.platformPortalChecklist && (
                  <div className="rounded-md border border-yellow-300/20 bg-yellow-950/10 p-3">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-white">{status.platformPortalChecklist.markdownPath}</p>
                        <p className="mt-1 text-xs leading-5 text-zinc-500">{status.platformPortalChecklist.nextStep}</p>
                      </div>
                      <Badge className={cn("w-fit border", platformPortalChecklistBadge(status.platformPortalChecklist.status))}>{status.platformPortalChecklist.status}</Badge>
                    </div>
                    <div className="mt-3 grid gap-2 text-xs text-zinc-500 md:grid-cols-6">
                      <p>Platforms: {status.platformPortalChecklist.totals.platforms}</p>
                      <p>Ready: {status.platformPortalChecklist.totals.ready}</p>
                      <p>Progress: {status.platformPortalChecklist.totals.inProgress}</p>
                      <p>Blocked: {status.platformPortalChecklist.totals.blocked}</p>
                      <p>Actions: {status.platformPortalChecklist.totals.portalActions}</p>
                      <p>Rows: {status.platformPortalChecklist.totals.evidenceRows}</p>
                    </div>
                    <div className="mt-3 grid gap-3 md:grid-cols-3">
                      {status.platformPortalChecklist.items.map((item) => (
                        <div key={item.platform} className="rounded-md border border-white/10 bg-black/30 p-2">
                          <div className="flex items-center justify-between gap-2">
                            <p className="truncate text-xs font-medium text-white">{item.label}</p>
                            <Badge className={cn("border text-[10px]", platformPortalChecklistBadge(item.status))}>{item.status}</Badge>
                          </div>
                          <p className="mt-2 text-xs leading-5 text-yellow-100">{item.nextStep}</p>
                          <div className="mt-2 flex flex-wrap gap-1">
                            {item.portalUrls.slice(0, 4).map((url, index) => (
                              <a key={`${item.platform}-portal-${index}`} href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md border border-white/10 px-2 py-1 text-xs text-cyan-200 hover:bg-white/5">
                                Portal {index + 1}
                                <ExternalLink className="h-3 w-3" />
                              </a>
                            ))}
                          </div>
                          {item.doNow.length > 0 && (
                            <div className="mt-2 rounded-md border border-yellow-300/15 bg-yellow-950/10 p-2">
                              <p className="text-[10px] font-semibold uppercase tracking-wide text-yellow-200">Do now</p>
                              <ul className="mt-1 space-y-1 text-xs leading-4 text-yellow-100/80">
                                {item.doNow.slice(0, 3).map((step) => (
                                  <li key={step}>{step}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                          {item.blockers.length > 0 && (
                            <p className="mt-2 text-xs leading-5 text-red-200">Bloqueo: {item.blockers[0]}</p>
                          )}
                          {item.evidenceBatchRows.length > 0 && (
                            <div className="mt-2 space-y-2 rounded-md border border-green-300/15 bg-green-950/10 p-2">
                              <p className="text-[10px] font-semibold uppercase tracking-wide text-green-200">Evidence rows</p>
                              {item.evidenceBatchRows.slice(0, 2).map((row, index) => (
                                <div key={`${item.platform}-evidence-${index}`} className="flex items-center justify-between gap-2">
                                  <p className="truncate text-xs text-green-100/80">{row}</p>
                                  <Button size="sm" variant="outline" className="h-7 shrink-0 border-green-300/20 bg-transparent px-2 text-xs text-green-100 hover:bg-green-300/10" onClick={() => appendLaunchEvidenceBatchRow(row)}>
                                    <UploadCloud className="mr-1 h-3 w-3" />
                                    Row
                                  </Button>
                                </div>
                              ))}
                            </div>
                          )}
                          {item.completionCriteria.length > 0 && (
                            <p className="mt-2 text-xs leading-5 text-zinc-500">Done: {item.completionCriteria[0]}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                  {(status.credentialSetup.items || []).map((item) => (
                    <div key={item.id} className="rounded-md border border-white/10 bg-black/35 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <p className="truncate font-medium text-white">{item.label}</p>
                        <Badge className={cn("shrink-0 border", credentialSetupBadge(item.status))}>{item.status}</Badge>
                      </div>
                      <p className="mt-3 text-xs leading-5 text-zinc-500">{item.nextStep}</p>
                      <p className="mt-3 text-xs text-zinc-600">Configuradas: {item.configuredEnvVars.length ? item.configuredEnvVars.join(", ") : "ninguna"}</p>
                      <p className="mt-2 text-xs leading-5 text-amber-200">Faltan: {item.missingEnvVarGroups.length ? item.missingEnvVarGroups.join("; ") : "ninguna"}</p>
                      {item.docsUrl.startsWith("http") && (
                        <a href={item.docsUrl} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1 rounded-md border border-white/10 px-2 py-1 text-xs text-cyan-200 hover:bg-white/5">
                          Docs
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <p className="text-sm text-zinc-500">Cargando setup de credenciales...</p>
            )}
          </CardContent>
        </Card>

        <Card className="border-zinc-800 bg-zinc-950/70">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base text-white">
              <UploadCloud className="h-4 w-4 text-yellow-200" />
              Intake Kit
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {status?.intakeKit ? (
              <>
                <div className="rounded-md border border-white/10 bg-black/35 p-3">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-white">{status.intakeKit.templateDir}</p>
                      <p className="mt-1 text-xs leading-5 text-zinc-500">{status.intakeKit.nextStep}</p>
                    </div>
                    <Badge className={cn("w-fit border", intakeKitBadge(status.intakeKit.status))}>{status.intakeKit.status}</Badge>
                  </div>
                  <p className="mt-3 break-all text-xs text-zinc-600">Readme: {status.intakeKit.readmePath}</p>
                  {status.intakeKit.generatedAt && (
                    <p className="mt-2 text-xs text-zinc-600">actualizado: {formatDate(status.intakeKit.generatedAt)}</p>
                  )}
                </div>

                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                  {(status.intakeKit.files || []).map((file) => (
                    <div key={file.id} className="rounded-md border border-white/10 bg-black/35 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <p className="truncate font-medium text-white">{file.label}</p>
                        <Badge className={cn("shrink-0 border", intakeKitBadge(file.exists ? "prepared" : "not_prepared"))}>{file.exists ? "ready" : "missing"}</Badge>
                      </div>
                      <p className="mt-3 text-xs leading-5 text-zinc-500">{file.purpose}</p>
                      <p className="mt-3 break-all text-xs text-zinc-600">Template: {file.path}</p>
                      <p className="mt-2 break-all text-xs text-amber-200">Destino: {file.destinationDir}</p>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <p className="text-sm text-zinc-500">Cargando intake kit...</p>
            )}
          </CardContent>
        </Card>

        <Card className="border-zinc-800 bg-zinc-950/70">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base text-white">
              <KeyRound className="h-4 w-4 text-blue-200" />
              Developer App Evidence
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {status?.developerAppEvidence ? (
              <>
                <div className="rounded-md border border-white/10 bg-black/35 p-3">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-white">{status.developerAppEvidence.evidenceDir}</p>
                      <p className="mt-1 text-xs leading-5 text-zinc-500">{status.developerAppEvidence.nextStep}</p>
                    </div>
                    <Badge className={cn("w-fit border", developerAppEvidenceBadge(status.developerAppEvidence.status))}>{status.developerAppEvidence.status}</Badge>
                  </div>
                  <div className="mt-3 grid gap-2 text-xs text-zinc-500 md:grid-cols-6">
                    <p>Expected: {status.developerAppEvidence.totals?.expected || 0}</p>
                    <p>Approved: {status.developerAppEvidence.totals?.approved || 0}</p>
                    <p>Submitted: {status.developerAppEvidence.totals?.submitted || 0}</p>
                    <p>Draft: {status.developerAppEvidence.totals?.draft || 0}</p>
                    <p>Rejected: {status.developerAppEvidence.totals?.rejected || 0}</p>
                    <p>Missing: {status.developerAppEvidence.totals?.missing || 0}</p>
                  </div>
                  <p className="mt-2 break-all text-xs text-zinc-600">Templates: {status.developerAppEvidence.templateDir}</p>
                  {status.developerAppEvidence.generatedAt && (
                    <p className="mt-2 text-xs text-zinc-600">actualizado: {formatDate(status.developerAppEvidence.generatedAt)}</p>
                  )}
                  <div className="mt-3 grid gap-3 lg:grid-cols-[0.8fr_0.8fr_1fr_1fr]">
                    <div className="space-y-1">
                      <Label htmlFor="developer-evidence-platform" className="text-xs text-zinc-400">Plataforma</Label>
                      <Select value={developerEvidencePlatform} onValueChange={(value) => setDeveloperEvidencePlatform(value as ClipperPlatform)}>
                        <SelectTrigger id="developer-evidence-platform" className="border-zinc-800 bg-black">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="tiktok">TikTok</SelectItem>
                          <SelectItem value="instagram">Instagram</SelectItem>
                          <SelectItem value="youtube">YouTube</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="developer-evidence-status" className="text-xs text-zinc-400">Status</Label>
                      <Select value={developerEvidenceStatus} onValueChange={(value) => setDeveloperEvidenceStatus(value as ClipperDeveloperAppEvidenceItemStatus)}>
                        <SelectTrigger id="developer-evidence-status" className="border-zinc-800 bg-black">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="draft">draft</SelectItem>
                          <SelectItem value="submitted">submitted</SelectItem>
                          <SelectItem value="approved">approved</SelectItem>
                          <SelectItem value="rejected">rejected</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="developer-evidence-app-id" className="text-xs text-zinc-400">App ID no secreto</Label>
                      <Input
                        id="developer-evidence-app-id"
                        value={developerEvidenceAppIdentifier}
                        onChange={(event) => setDeveloperEvidenceAppIdentifier(event.target.value)}
                        className="border-zinc-800 bg-black"
                        data-testid="developer-evidence-app-id-input"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="developer-evidence-base-url" className="text-xs text-zinc-400">Base URL</Label>
                      <Input
                        id="developer-evidence-base-url"
                        value={developerEvidencePublicBaseUrl}
                        onChange={(event) => setDeveloperEvidencePublicBaseUrl(event.target.value)}
                        placeholder={status.oauthGoLive?.publicBaseUrl || "http://127.0.0.1:5010"}
                        className="border-zinc-800 bg-black"
                      />
                    </div>
                  </div>
                  <div className="mt-3 grid gap-3 lg:grid-cols-[1fr_auto] lg:items-end">
                    <div className="space-y-1">
                      <Label htmlFor="developer-evidence-notes" className="text-xs text-zinc-400">Notas</Label>
                      <Input
                        id="developer-evidence-notes"
                        value={developerEvidenceNotes}
                        onChange={(event) => setDeveloperEvidenceNotes(event.target.value)}
                        className="border-zinc-800 bg-black"
                      />
                    </div>
                    <Button
                      type="button"
                      onClick={submitDeveloperEvidenceForm}
                      disabled={recordDeveloperAppEvidenceMutation.isPending}
                      className="bg-blue-200 text-zinc-950 hover:bg-blue-100"
                      data-testid="record-developer-evidence-form-button"
                    >
                      {recordDeveloperAppEvidenceMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
                      Guardar app
                    </Button>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {(["tiktok", "instagram", "youtube"] as ClipperPlatform[]).map((platform) => (
                      <div key={platform} className="flex gap-1">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={recordDeveloperAppEvidenceMutation.isPending}
                          onClick={() => recordDeveloperAppEvidence(platform, "submitted")}
                          className="h-7 border-white/10 px-2 text-xs text-zinc-200 hover:bg-white/5"
                        >
                          {platform} submitted
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={recordDeveloperAppEvidenceMutation.isPending}
                          onClick={() => recordDeveloperAppEvidence(platform, "approved")}
                          className="h-7 border-emerald-300/30 px-2 text-xs text-emerald-200 hover:bg-emerald-300/10"
                        >
                          approved
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {(status.developerAppEvidence.items || []).length ? status.developerAppEvidence.items.map((item) => (
                    <div key={item.platform} className="rounded-md border border-white/10 bg-black/35 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate font-medium text-white">{item.label}</p>
                          <p className="mt-1 text-xs text-zinc-500">{item.platform}</p>
                        </div>
                        <Badge className={cn("shrink-0 border", developerAppEvidenceBadge(item.status))}>{item.status}</Badge>
                      </div>
                      <div className="mt-3 space-y-2 text-xs leading-5 text-zinc-500">
                        <p className="break-all">App: {item.appIdentifier || "pendiente"}</p>
                        <p className="break-all">Base URL: {item.publicBaseUrl || "pendiente"}</p>
                        <p className="break-all">Redirect: {item.redirectUri}</p>
                        <p>Env listas: {item.configuredEnvVars.length}</p>
                        <p>Env faltantes: {item.missingEnvVars.length ? item.missingEnvVars.join(", ") : "ninguna"}</p>
                      </div>
                      <p className="mt-3 text-xs leading-5 text-zinc-400">{item.notes}</p>
                      <p className="mt-2 text-xs leading-5 text-amber-200">{item.nextStep}</p>
                    </div>
                  )) : (
                    <div className="rounded-md border border-dashed border-white/10 bg-black/25 p-3 text-sm text-zinc-500 md:col-span-2 xl:col-span-3">
                      Todavia no hay evidencia real de developer apps en la raiz.
                    </div>
                  )}
                </div>
              </>
            ) : (
              <p className="text-sm text-zinc-500">Cargando evidencia de developer apps...</p>
            )}
          </CardContent>
        </Card>

        <Card className="border-zinc-800 bg-zinc-950/70">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base text-white">
              <ShieldCheck className="h-4 w-4 text-indigo-200" />
              Permission Tracker
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {status?.permissionTracker ? (
              <>
                <div className="rounded-md border border-white/10 bg-black/35 p-3">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-white">{status.permissionTracker.markdownPath}</p>
                      <p className="mt-1 text-xs leading-5 text-zinc-500">{status.permissionTracker.nextStep}</p>
                    </div>
                    <Badge className={cn("w-fit border", permissionTrackerBadge(status.permissionTracker.status))}>{status.permissionTracker.status}</Badge>
                  </div>
                  <div className="mt-3 grid gap-2 text-xs text-zinc-500 md:grid-cols-5">
                    <p>Total: {status.permissionTracker.totals?.permissions || 0}</p>
                    <p>Approved: {status.permissionTracker.totals?.approved || 0}</p>
                    <p>Requested: {status.permissionTracker.totals?.requested || 0}</p>
                    <p>Ready: {status.permissionTracker.totals?.readyToRequest || 0}</p>
                    <p>Blocked: {status.permissionTracker.totals?.blocked || 0}</p>
                  </div>
                  {status.permissionTracker.generatedAt && (
                    <p className="mt-2 text-xs text-zinc-600">actualizado: {formatDate(status.permissionTracker.generatedAt)}</p>
                  )}
                </div>

                {status.permissionRequestPack && (
                  <div className="rounded-md border border-blue-300/20 bg-blue-950/10 p-3">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-white">{status.permissionRequestPack.markdownPath}</p>
                        <p className="mt-1 text-xs leading-5 text-zinc-500">{status.permissionRequestPack.nextStep}</p>
                      </div>
                      <Badge className={cn("w-fit border", permissionRequestPackBadge(status.permissionRequestPack.status))}>{status.permissionRequestPack.status}</Badge>
                    </div>
                    <div className="mt-3 grid gap-2 text-xs text-zinc-500 md:grid-cols-6">
                      <p>Total: {status.permissionRequestPack.totals.permissions}</p>
                      <p>Ready: {status.permissionRequestPack.totals.ready}</p>
                      <p>Partial: {status.permissionRequestPack.totals.partial}</p>
                      <p>Blocked: {status.permissionRequestPack.totals.blocked}</p>
                      <p>Approved: {status.permissionRequestPack.totals.approved}</p>
                      <p>Requested: {status.permissionRequestPack.totals.requested}</p>
                    </div>
                    <p className="mt-2 break-all text-xs text-zinc-600">CSV: {status.permissionRequestPack.csvPath}</p>
                    <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                      {status.permissionRequestPack.items.map((item) => (
                        <div key={item.id} className="rounded-md border border-white/10 bg-black/30 p-2">
                          <div className="flex items-center justify-between gap-2">
                            <p className="truncate text-xs font-medium text-white">{item.scope}</p>
                            <Badge className={cn("border text-[10px]", permissionRequestPackBadge(item.packStatus))}>{item.packStatus}</Badge>
                          </div>
                          <div className="mt-1 flex flex-wrap gap-2">
                            <Badge className="border border-white/10 bg-black/30 text-[10px] text-zinc-300">{item.platform}</Badge>
                            <Badge className="border border-white/10 bg-black/30 text-[10px] text-zinc-300">{item.status}</Badge>
                            <Badge className={cn("border text-[10px]", permissionRequestPackBadge(item.packStatus))}>{item.requestReadiness}</Badge>
                          </div>
                          <p className="mt-2 break-all text-[11px] leading-4 text-zinc-500">{item.scopeRequestLine}</p>
                          <p className="mt-2 text-xs leading-5 text-zinc-400">{item.requestedUseCase}</p>
                          <div className="mt-2 rounded-md border border-indigo-300/15 bg-indigo-950/10 p-2">
                            <p className="text-[10px] font-medium uppercase text-indigo-200">Reviewer copy</p>
                            <p className="mt-1 text-xs leading-5 text-indigo-100/80">{item.reviewerInstructions}</p>
                          </div>
                          {item.platformConstraints.length > 0 && (
                            <div className="mt-2 rounded-md border border-cyan-300/15 bg-cyan-950/10 p-2">
                              <p className="text-[10px] font-medium uppercase text-cyan-200">Condiciones</p>
                              <ul className="mt-1 space-y-1 text-xs leading-5 text-zinc-400">
                                {item.platformConstraints.slice(0, 2).map((constraint) => (
                                  <li key={constraint}>{constraint}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                          {item.officialApprovalChecklist.length > 0 && (
                            <div className="mt-2 rounded-md border border-emerald-300/15 bg-emerald-950/10 p-2">
                              <p className="text-[10px] font-medium uppercase text-emerald-200">Official checklist</p>
                              <ul className="mt-1 space-y-1 text-xs leading-5 text-emerald-100/80">
                                {item.officialApprovalChecklist.slice(0, 2).map((step) => (
                                  <li key={step}>{step}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                          {item.auditWarnings.length > 0 && (
                            <div className="mt-2 rounded-md border border-amber-300/20 bg-amber-950/10 p-2">
                              <p className="text-[10px] font-medium uppercase text-amber-200">Go-live</p>
                              <ul className="mt-1 space-y-1 text-xs leading-5 text-amber-100/80">
                                {item.auditWarnings.slice(0, 2).map((warning) => (
                                  <li key={warning}>{warning}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                          {item.missingEvidence.length > 0 && (
                            <div className="mt-2 rounded-md border border-red-300/20 bg-red-950/10 p-2">
                              <p className="text-[10px] font-medium uppercase text-red-200">Missing evidence</p>
                              <ul className="mt-1 space-y-1 text-xs leading-5 text-red-100/80">
                                {item.missingEvidence.slice(0, 2).map((evidence) => (
                                  <li key={evidence}>{evidence}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                          <p className="mt-2 text-xs leading-5 text-amber-200">{item.nextStep}</p>
                          <div className="mt-2 flex flex-wrap gap-2">
                            <a href={item.developerPortalUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md border border-white/10 px-2 py-1 text-xs text-cyan-200 hover:bg-white/5">
                              Portal
                              <ExternalLink className="h-3 w-3" />
                            </a>
                            <a href={item.docsUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md border border-white/10 px-2 py-1 text-xs text-cyan-200 hover:bg-white/5">
                              Docs
                              <ExternalLink className="h-3 w-3" />
                            </a>
                            <a href={item.officialReferenceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md border border-white/10 px-2 py-1 text-xs text-cyan-200 hover:bg-white/5">
                              Official
                              <ExternalLink className="h-3 w-3" />
                            </a>
                            <Button size="sm" variant="outline" className="h-7 border-green-300/20 bg-transparent px-2 text-xs text-green-100 hover:bg-green-300/10" onClick={() => appendLaunchEvidenceBatchRow(item.evidenceBatchRow)}>
                              <UploadCloud className="mr-1 h-3 w-3" />
                              Row
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="rounded-md border border-indigo-300/20 bg-indigo-950/10 p-3">
                  <div className="grid gap-3 lg:grid-cols-[1.15fr_0.65fr_1fr_auto] lg:items-end">
                    <div className="space-y-1">
                      <Label htmlFor="permission-record-scope" className="text-xs text-zinc-400">Permiso</Label>
                      <Select value={selectedPermissionRecord?.id || ""} onValueChange={setPermissionRecordId}>
                        <SelectTrigger id="permission-record-scope" className="border-white/10 bg-black/40">
                          <SelectValue placeholder="Selecciona un permiso" />
                        </SelectTrigger>
                        <SelectContent>
                          {permissionRecordItems.map((item) => (
                            <SelectItem key={item.id} value={item.id}>
                              {item.platform} · {item.scope}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="permission-record-status" className="text-xs text-zinc-400">Status</Label>
                      <Select value={permissionRecordStatus} onValueChange={(value) => setPermissionRecordStatus(value as ClipperPermissionTrackerItemStatus)}>
                        <SelectTrigger id="permission-record-status" className="border-white/10 bg-black/40">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="ready_to_request">ready_to_request</SelectItem>
                          <SelectItem value="requested">requested</SelectItem>
                          <SelectItem value="approved">approved</SelectItem>
                          <SelectItem value="blocked">blocked</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="permission-record-notes" className="text-xs text-zinc-400">Notas / evidencia</Label>
                      <Input
                        id="permission-record-notes"
                        value={permissionRecordNotes}
                        onChange={(event) => setPermissionRecordNotes(event.target.value)}
                        className="border-white/10 bg-black/40"
                      />
                    </div>
                    <Button
                      onClick={submitPermissionRecordForm}
                      disabled={!selectedPermissionRecord || recordPermissionStatusMutation.isPending}
                      className="bg-indigo-200 text-indigo-950 hover:bg-indigo-100"
                      data-testid="record-permission-status-form-button"
                    >
                      {recordPermissionStatusMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
                      Guardar permiso
                    </Button>
                  </div>
                  {selectedPermissionRecord && (
                    <div className="mt-3 grid gap-2 text-xs text-zinc-500 md:grid-cols-3">
                      <p className="break-all">Portal: {selectedPermissionRecord.developerPortalUrl}</p>
                      <p className="break-all">Docs: {selectedPermissionRecord.docsUrl}</p>
                      <p>Actual: {selectedPermissionRecord.status}</p>
                    </div>
                  )}
                </div>

                {status.officialPermissionMatrix && (
                  <div className="rounded-md border border-white/10 bg-black/35 p-3">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-white">{status.officialPermissionMatrix.markdownPath}</p>
                        <p className="mt-1 text-xs leading-5 text-zinc-500">{status.officialPermissionMatrix.nextStep}</p>
                      </div>
                      <Badge className={cn("w-fit border", officialPermissionMatrixBadge(status.officialPermissionMatrix.status))}>{status.officialPermissionMatrix.status}</Badge>
                    </div>
                    <div className="mt-3 grid gap-2 text-xs text-zinc-500 md:grid-cols-5">
                      <p>Platforms: {status.officialPermissionMatrix.totals.platforms}</p>
                      <p>Scopes: {status.officialPermissionMatrix.totals.scopes}</p>
                      <p>App review: {status.officialPermissionMatrix.totals.appReviewRequired}</p>
                      <p>Verified: {status.officialPermissionMatrix.totals.officialVerified}</p>
                      <p>Login req: {status.officialPermissionMatrix.totals.loginRequired}</p>
                    </div>
                    <div className="mt-3 grid gap-3 md:grid-cols-3">
                      {status.officialPermissionMatrix.items.map((item) => (
                        <div key={item.platform} className="rounded-md border border-white/10 bg-black/30 p-2">
                          <div className="flex items-center justify-between gap-2">
                            <p className="truncate text-xs font-medium text-white">{item.label}</p>
                            <Badge className={cn("border text-[10px]", officialPermissionMatrixBadge(item.sourceStatus))}>{item.sourceStatus}</Badge>
                          </div>
                          <p className="mt-2 text-xs text-zinc-500">Scopes: {item.scopes.map((scope) => scope.scope).join(", ")}</p>
                          <p className="mt-2 text-xs leading-5 text-amber-200">{item.nextStep}</p>
                          <div className="mt-3 space-y-2">
                            {item.scopes.map((scope) => (
                              <div key={`${item.platform}-${scope.scope}`} className="rounded-md border border-white/10 bg-black/30 p-2">
                                <div className="flex items-center justify-between gap-2">
                                  <p className="truncate text-xs font-medium text-white">{scope.scope}</p>
                                  <Badge className={cn("border text-[10px]", scope.appReviewRequired ? "border-amber-300/30 bg-amber-300/10 text-amber-200" : "border-emerald-300/30 bg-emerald-300/10 text-emerald-200")}>
                                    {scope.requiredForAutopost ? "autopost" : "fallback"}
                                  </Badge>
                                </div>
                                <p className="mt-2 text-xs leading-5 text-zinc-500">{scope.requestAction}</p>
                                {scope.portalSubmissionSteps && scope.portalSubmissionSteps.length > 0 && (
                                  <div className="mt-2 rounded-md border border-amber-300/15 bg-amber-950/10 p-2">
                                    <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-200">Portal submission</p>
                                    <ul className="mt-1 space-y-1 text-xs leading-4 text-amber-100/80">
                                      {scope.portalSubmissionSteps.slice(0, 4).map((step) => (
                                        <li key={step}>{step}</li>
                                      ))}
                                    </ul>
                                  </div>
                                )}
                                <div className="mt-2 rounded-md border border-white/10 bg-black/30 p-2">
                                  <div className="flex items-center justify-between gap-2">
                                    <p className="truncate text-[10px] font-medium uppercase text-zinc-400">Official check</p>
                                    <Badge className={cn("border text-[10px]", officialPermissionMatrixBadge(scope.verificationStatus))}>{scope.verificationStatus}</Badge>
                                  </div>
                                  <p className="mt-1 text-xs text-zinc-600">{scope.verifiedAt}</p>
                                  <p className="mt-1 text-xs leading-5 text-zinc-500">{scope.verificationNote}</p>
                                  {scope.verificationChecklist.length > 0 && (
                                    <ul className="mt-2 space-y-1 text-xs leading-4 text-zinc-400">
                                      {scope.verificationChecklist.slice(0, 3).map((step) => (
                                        <li key={step}>{step}</li>
                                      ))}
                                    </ul>
                                  )}
                                  <a href={scope.officialReferenceUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 break-all text-xs text-cyan-200 hover:text-cyan-100">
                                    Official ref
                                    <ExternalLink className="h-3 w-3" />
                                  </a>
                                </div>
                                {scope.sourceAudit && (
                                  <div className="mt-2 rounded-md border border-cyan-300/15 bg-cyan-950/10 p-2">
                                    <div className="flex items-center justify-between gap-2">
                                      <p className="truncate text-[10px] font-medium uppercase text-cyan-200">Source audit</p>
                                      <Badge className={cn("border text-[10px]", scope.sourceAudit.accessMode === "public" ? "border-emerald-300/30 bg-emerald-300/10 text-emerald-200" : "border-amber-300/30 bg-amber-300/10 text-amber-200")}>
                                        {scope.sourceAudit.accessMode}
                                      </Badge>
                                    </div>
                                    <p className="mt-1 text-xs text-zinc-500">{scope.sourceAudit.lastCheckedAt} · {scope.sourceAudit.goLiveDecision}</p>
                                    <p className="mt-1 break-all text-xs text-cyan-100/70">{scope.sourceAudit.canonicalUrl}</p>
                                    {scope.sourceAudit.publicEvidence.length > 0 && (
                                      <p className="mt-2 text-xs leading-5 text-zinc-400">{scope.sourceAudit.publicEvidence[0]}</p>
                                    )}
                                    {scope.sourceProofPack && (
                                      <div className="mt-2 rounded-md border border-white/10 bg-black/25 p-2">
                                        <div className="flex items-center justify-between gap-2">
                                          <p className="truncate text-[10px] font-medium uppercase text-cyan-100">Proof pack</p>
                                          <Badge className={cn("border text-[10px]", scope.sourceProofPack.status === "ready_to_attach" ? "border-emerald-300/30 bg-emerald-300/10 text-emerald-200" : "border-amber-300/30 bg-amber-300/10 text-amber-200")}>
                                            {scope.sourceProofPack.submitDecision}
                                          </Badge>
                                        </div>
                                        <p className="mt-1 text-xs leading-5 text-zinc-400">{scope.sourceProofPack.verifiedClaims[0]}</p>
                                        {scope.sourceProofPack.blocker && (
                                          <p className="mt-1 text-xs leading-5 text-amber-200">{scope.sourceProofPack.blocker}</p>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                )}
                                <p className="mt-2 break-all text-xs text-zinc-600">Batch: {scope.launchEvidenceBatchRow}</p>
                                {scope.approvalEvidenceBatchRow && (
                                  <p className="mt-1 break-all text-xs text-green-200">Approved row: {scope.approvalEvidenceBatchRow}</p>
                                )}
                                {scope.complianceRisk && (
                                  <p className="mt-2 text-xs leading-5 text-red-200">{scope.complianceRisk}</p>
                                )}
                                {scope.fallbackPlan && (
                                  <p className="mt-2 text-xs leading-5 text-zinc-500">Fallback: {scope.fallbackPlan}</p>
                                )}
                                {scope.postApprovalChecklist && scope.postApprovalChecklist.length > 0 && (
                                  <p className="mt-2 text-xs leading-5 text-emerald-100">Post approval: {scope.postApprovalChecklist[0]}</p>
                                )}
                                <a href={scope.requestPortalUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 rounded-md border border-white/10 px-2 py-1 text-xs text-cyan-200 hover:bg-white/5">
                                  Portal
                                  <ExternalLink className="h-3 w-3" />
                                </a>
                              </div>
                            ))}
                          </div>
                          <div className="mt-2 flex flex-wrap gap-2">
                            {item.officialDocs.slice(0, 2).map((doc) => (
                              <a key={doc} href={doc} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md border border-white/10 px-2 py-1 text-xs text-cyan-200 hover:bg-white/5">
                                Docs
                                <ExternalLink className="h-3 w-3" />
                              </a>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {status.developerApplicationDrafts && (
                  <div className="rounded-md border border-slate-300/20 bg-slate-950/20 p-3">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-white">{status.developerApplicationDrafts.markdownPath}</p>
                        <p className="mt-1 text-xs leading-5 text-zinc-500">{status.developerApplicationDrafts.nextStep}</p>
                      </div>
                      <Badge className={cn("w-fit border", developerApplicationDraftsBadge(status.developerApplicationDrafts.status))}>{status.developerApplicationDrafts.status}</Badge>
                    </div>
                    <div className="mt-3 grid gap-2 text-xs text-zinc-500 md:grid-cols-5">
                      <p>Platforms: {status.developerApplicationDrafts.totals.platforms}</p>
                      <p>Ready: {status.developerApplicationDrafts.totals.ready}</p>
                      <p>Blocked: {status.developerApplicationDrafts.totals.blocked}</p>
                      <p>Scopes: {status.developerApplicationDrafts.totals.scopes}</p>
                      <p>Checked: {status.developerApplicationDrafts.sourceCheckedAt}</p>
                    </div>
                    {status.developerApplicationDrafts.creationSession.length > 0 && (
                      <div className="mt-3 rounded-md border border-slate-300/15 bg-slate-950/20 p-2">
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-200">Developer app session</p>
                        <div className="mt-2 grid gap-2 lg:grid-cols-3">
                          {status.developerApplicationDrafts.creationSession.map((item) => (
                            <div key={item.platform} className="rounded-md border border-white/10 bg-black/25 p-2">
                              <div className="flex items-center justify-between gap-2">
                                <p className="truncate text-xs font-medium text-white">#{item.rank} {item.label}</p>
                                <Badge className={cn("border text-[10px]", developerApplicationDraftsBadge(item.status))}>{item.status}</Badge>
                              </div>
                              <p className="mt-1 text-xs text-zinc-500">{item.appName}</p>
                              <p className="mt-2 break-all text-xs leading-4 text-zinc-400">{item.redirectUri}</p>
                              {item.credentialEnvGroups.length > 0 && (
                                <p className="mt-2 text-[11px] leading-4 text-slate-100/80">Env: {item.credentialEnvGroups.join(" · ")}</p>
                              )}
                              {item.portalFields.length > 0 && (
                                <p className="mt-2 text-[11px] leading-4 text-cyan-100/80">Field: {item.portalFields[0].label} = {item.portalFields[0].value}</p>
                              )}
                              {item.credentialCopyMap.length > 0 && (
                                <p className="mt-2 text-[11px] leading-4 text-blue-100/80">Cred: {item.credentialCopyMap[0].portalField} -&gt; {item.credentialCopyMap[0].envVarGroup}</p>
                              )}
                              {item.portalSubmissionSteps.length > 0 && (
                                <p className="mt-2 text-[11px] leading-4 text-amber-100/80">Submit: {item.portalSubmissionSteps[0]}</p>
                              )}
                              {item.doneCriteria.length > 0 && (
                                <p className="mt-2 text-[11px] leading-4 text-emerald-100/80">Done: {item.doneCriteria[0]}</p>
                              )}
                              <div className="mt-2 flex flex-wrap gap-2">
                                <a href={item.developerPortalUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md border border-white/10 px-2 py-1 text-xs text-cyan-200 hover:bg-white/5">
                                  Portal
                                  <ExternalLink className="h-3 w-3" />
                                </a>
                                <Button size="sm" variant="outline" className="h-7 border-zinc-500/20 bg-transparent px-2 text-xs text-zinc-100 hover:bg-zinc-300/10" onClick={() => appendLaunchEvidenceBatchRow(item.draftEvidenceBatchRow)}>
                                  <UploadCloud className="mr-1 h-3 w-3" />
                                  Draft
                                </Button>
                                <Button size="sm" variant="outline" className="h-7 border-yellow-300/20 bg-transparent px-2 text-xs text-yellow-100 hover:bg-yellow-300/10" onClick={() => appendLaunchEvidenceBatchRow(item.submittedEvidenceBatchRow)}>
                                  <UploadCloud className="mr-1 h-3 w-3" />
                                  Submitted
                                </Button>
                                <Button size="sm" variant="outline" className="h-7 border-green-300/20 bg-transparent px-2 text-xs text-green-100 hover:bg-green-300/10" onClick={() => appendLaunchEvidenceBatchRow(item.approvedEvidenceBatchRow)}>
                                  <UploadCloud className="mr-1 h-3 w-3" />
                                  Approved
                                </Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    <div className="mt-3 grid gap-3 md:grid-cols-3">
                      {status.developerApplicationDrafts.items.map((item) => (
                        <div key={item.platform} className="rounded-md border border-white/10 bg-black/30 p-2">
                          <div className="flex items-center justify-between gap-2">
                            <p className="truncate text-xs font-medium text-white">{item.label}</p>
                            <Badge className={cn("border text-[10px]", developerApplicationDraftsBadge(item.status))}>{item.status}</Badge>
                          </div>
                          <p className="mt-2 text-xs text-zinc-400">{item.appName}</p>
                          <p className="mt-1 break-all text-xs text-zinc-500">{item.redirectUri}</p>
                          <p className="mt-2 text-xs text-zinc-500">Scopes: {item.requestedScopes.join(", ")}</p>
                          <p className="mt-2 text-xs leading-5 text-amber-200">{item.nextStep}</p>
                          <p className="mt-2 text-xs leading-5 text-slate-100/80">{item.completionHint}</p>
                          {item.credentialCopyMap.length > 0 && (
                            <div className="mt-2 rounded-md border border-blue-300/15 bg-blue-950/10 p-2">
                              <p className="text-[10px] font-semibold uppercase tracking-wide text-blue-200">Credential map</p>
                              <ul className="mt-1 space-y-1 text-xs leading-4 text-blue-100/80">
                                {item.credentialCopyMap.map((field) => (
                                  <li key={field.envVarGroup}>{field.portalField} -&gt; {field.envVarGroup}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                          {item.portalSubmissionSteps.length > 0 && (
                            <div className="mt-2 rounded-md border border-amber-300/15 bg-amber-950/10 p-2">
                              <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-200">Portal submission</p>
                              <ul className="mt-1 space-y-1 text-xs leading-4 text-amber-100/80">
                                {item.portalSubmissionSteps.slice(0, 4).map((step) => (
                                  <li key={step}>{step}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                          {item.requiredInputs.length > 0 && (
                            <div className="mt-2 rounded-md border border-slate-300/15 bg-slate-950/20 p-2">
                              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-200">Required inputs</p>
                              <ul className="mt-1 space-y-1 text-xs leading-4 text-slate-100/80">
                                {item.requiredInputs.slice(0, 4).map((requiredInput) => (
                                  <li key={requiredInput}>{requiredInput}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                          {item.portalFlow.length > 0 && (
                            <p className="mt-2 text-xs leading-5 text-cyan-100/80">Portal: {item.portalFlow[0]}</p>
                          )}
                          {item.approvalCriteria.length > 0 && (
                            <p className="mt-1 text-xs leading-5 text-zinc-400">Approval: {item.approvalCriteria[0]}</p>
                          )}
                          {item.appVaultChecklist.length > 0 && (
                            <p className="mt-1 text-xs leading-5 text-blue-100">Vault: {item.appVaultChecklist[0]}</p>
                          )}
                          <div className="mt-2 flex flex-wrap gap-2">
                            <a href={item.developerPortalUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md border border-white/10 px-2 py-1 text-xs text-cyan-200 hover:bg-white/5">
                              Portal
                              <ExternalLink className="h-3 w-3" />
                            </a>
                            <a href={item.demoUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md border border-white/10 px-2 py-1 text-xs text-cyan-200 hover:bg-white/5">
                              Demo
                              <ExternalLink className="h-3 w-3" />
                            </a>
                            <Button size="sm" variant="outline" className="h-7 border-zinc-500/20 bg-transparent px-2 text-xs text-zinc-100 hover:bg-zinc-300/10" onClick={() => appendLaunchEvidenceBatchRow(item.draftEvidenceBatchRow)}>
                              <UploadCloud className="mr-1 h-3 w-3" />
                              Draft
                            </Button>
                            <Button size="sm" variant="outline" className="h-7 border-yellow-300/20 bg-transparent px-2 text-xs text-yellow-100 hover:bg-yellow-300/10" onClick={() => appendLaunchEvidenceBatchRow(item.submittedEvidenceBatchRow)}>
                              <UploadCloud className="mr-1 h-3 w-3" />
                              Submitted
                            </Button>
                            <Button size="sm" variant="outline" className="h-7 border-green-300/20 bg-transparent px-2 text-xs text-green-100 hover:bg-green-300/10" onClick={() => appendLaunchEvidenceBatchRow(item.approvedEvidenceBatchRow)}>
                              <UploadCloud className="mr-1 h-3 w-3" />
                              Approved
                            </Button>
                            <Button size="sm" variant="outline" className="h-7 border-amber-300/20 bg-transparent px-2 text-xs text-amber-100 hover:bg-amber-300/10" onClick={() => appendLaunchEvidenceBatchRow(item.evidenceRecipeRow)}>
                              <Eye className="mr-1 h-3 w-3" />
                              Recipe
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="grid gap-3 xl:grid-cols-[1.2fr_0.8fr]">
                  <div className={cn(tunnelGridClass, "grid gap-3 md:grid-cols-2 xl:grid-cols-3")}>
                    {(status.permissionTracker.items || []).map((item) => (
                      <div key={item.id} className={tunnelBoxClass}>
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate font-medium text-white">{item.scope}</p>
                            <p className="mt-1 text-xs text-zinc-500">{item.platform}</p>
                          </div>
                          <Badge className={cn("shrink-0 border", permissionTrackerBadge(item.status))}>{item.status}</Badge>
                        </div>
                        <p className="mt-2 text-xs leading-5 text-zinc-500">{item.nextStep}</p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <a href={item.docsUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md border border-white/10 px-2 py-1 text-xs text-cyan-200 hover:bg-white/5">
                            Docs
                            <ExternalLink className="h-3 w-3" />
                          </a>
                          <a href={item.developerPortalUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md border border-white/10 px-2 py-1 text-xs text-cyan-200 hover:bg-white/5">
                            Portal
                            <ExternalLink className="h-3 w-3" />
                          </a>
                          <Button size="sm" variant="outline" className="h-7 border-green-300/20 bg-transparent px-2 text-xs text-green-100 hover:bg-green-300/10" onClick={() => appendLaunchEvidenceBatchRow(item.evidenceBatchRow)}>
                            <UploadCloud className="mr-1 h-3 w-3" />
                            Row
                          </Button>
                          <Button size="sm" variant="outline" className="h-7 border-amber-300/20 bg-transparent px-2 text-xs text-amber-100 hover:bg-amber-300/10" onClick={() => appendLaunchEvidenceBatchRow(item.evidenceRecipeRow)}>
                            <Eye className="mr-1 h-3 w-3" />
                            Recipe
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 border-white/10 bg-transparent px-2 text-xs text-sky-100 hover:bg-white/5"
                            disabled={recordPermissionStatusMutation.isPending}
                            onClick={() => {
                              const notes = window.prompt(`Notas para ${item.platform} / ${item.scope}`, item.recordNotes || "Solicitado en developer portal.");
                              if (notes === null) return;
                              recordPermissionStatusMutation.mutate({
                                platform: item.platform,
                                scope: item.scope,
                                status: "requested",
                                notes,
                              });
                            }}
                          >
                            <UploadCloud className="mr-1 h-3 w-3" />
                            Requested
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 border-emerald-400/20 bg-transparent px-2 text-xs text-emerald-100 hover:bg-emerald-400/10"
                            disabled={recordPermissionStatusMutation.isPending}
                            onClick={() => {
                              const notes = window.prompt(`Evidencia de approval para ${item.platform} / ${item.scope}`, item.recordNotes || "Scope aprobado/app review completada.");
                              if (notes === null) return;
                              recordPermissionStatusMutation.mutate({
                                platform: item.platform,
                                scope: item.scope,
                                status: "approved",
                                notes,
                              });
                            }}
                          >
                            <CheckCircle2 className="mr-1 h-3 w-3" />
                            Approved
                          </Button>
                        </div>
                        {item.recordedAt && (
                          <p className="mt-2 text-xs leading-5 text-emerald-200">
                            registro: {formatDate(item.recordedAt)} · {item.recordNotes || item.statusSource}
                          </p>
                        )}
                        {(item.blockers || []).length > 0 && (
                          <p className="mt-3 text-xs leading-5 text-amber-200">{item.blockers[0]}</p>
                        )}
                      </div>
                    ))}
                  </div>

                  <div className="rounded-md border border-white/10 bg-black/35 p-3">
                    <p className="text-sm font-medium text-white">Fuentes oficiales</p>
                    <div className="mt-3 space-y-2">
                      {(status.permissionTracker.officialSources || []).slice(0, 8).map((source) => (
                        <a key={source} href={source} target="_blank" rel="noreferrer" className="block break-all text-xs leading-5 text-cyan-200 hover:text-cyan-100">
                          {source}
                        </a>
                      ))}
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <p className="text-sm text-zinc-500">Cargando tracker de permisos...</p>
            )}
          </CardContent>
        </Card>

        <Card className="border-zinc-800 bg-zinc-950/70">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base text-white">
              <Gauge className="h-4 w-4 text-lime-200" />
              Growth readiness
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {status?.growthAudit ? (
              <>
                <div className="grid gap-3 xl:grid-cols-[0.75fr_1.25fr]">
                  <div className="rounded-md border border-white/10 bg-black/35 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-xs text-zinc-500">Score operativo</p>
                        <p className="text-3xl font-semibold text-white">{status.growthAudit.score}/100</p>
                      </div>
                      <Badge className={cn("border", growthAuditBadge(status.growthAudit.status))}>{status.growthAudit.status}</Badge>
                    </div>
                    <p className="mt-3 text-sm leading-6 text-zinc-400">{status.growthAudit.summary}</p>
                    <p className="mt-2 text-xs text-amber-200">Gap semanal: {formatNumber(status.growthAudit.weeklyGoalGap)} views</p>
                    <Progress value={status.growthAudit.score} className="mt-3 bg-white/10 [&>div]:bg-lime-200" />
                  </div>

                  <div className={cn(tunnelGridClass, "grid gap-3 md:grid-cols-2 xl:grid-cols-3")}>
                    {status.growthAudit.items.map((item) => (
                      <div key={item.id} className={tunnelBoxClass}>
                        <div className="flex items-center justify-between gap-3">
                          <p className="truncate font-medium text-white">{item.label}</p>
                          <Badge className={cn("border", growthAuditBadge(item.status))}>{item.status}</Badge>
                        </div>
                        <p className="mt-1 text-xs text-zinc-600">{item.owner} · impacto {item.impact}</p>
                        <p className="mt-2 text-xs leading-5 text-zinc-500">{item.evidence}</p>
                        <p className="mt-2 text-xs leading-5 text-amber-200">{item.nextStep}</p>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-md border border-white/10 bg-black/35 p-3">
                  <p className="text-sm font-medium text-white">Roadmap para llegar a meta</p>
                  <div className="mt-2 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                    {status.growthAudit.roadmap.map((step) => (
                      <p key={step} className="text-xs leading-5 text-zinc-500">{step}</p>
                    ))}
                  </div>
                </div>
              </>
            ) : (
              <p className="text-sm text-zinc-500">Cargando auditoria de crecimiento...</p>
            )}
          </CardContent>
        </Card>

        <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
          <Card className="border-zinc-800 bg-zinc-950/70">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base text-white">
                <Wand2 className="h-4 w-4 text-amber-200" />
                Control diario
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-3">
              <div className="space-y-2">
                <Label>Clips por cuenta</Label>
                <Input
                  type="number"
                  min={1}
                  max={50}
                  value={clipsPerAccount}
                  onChange={(event) => setClipsPerAccount(Number(event.target.value))}
                  className="border-zinc-800 bg-black"
                />
              </div>
              <div className="space-y-2">
                <Label>Publicacion</Label>
                <Select value={publishMode} onValueChange={(value) => setPublishMode(value as ClipperReport["publishMode"])}>
                  <SelectTrigger className="border-zinc-800 bg-black">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="approval_required">Aprobacion requerida</SelectItem>
                    <SelectItem value="draft_only">Solo drafts</SelectItem>
                    <SelectItem value="auto_after_connection">Auto si esta conectado</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Riesgo creativo</Label>
                <Select value={riskTolerance} onValueChange={(value) => setRiskTolerance(value as ClipperReport["riskTolerance"])}>
                  <SelectTrigger className="border-zinc-800 bg-black">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="safe">Seguro</SelectItem>
                    <SelectItem value="growth">Growth</SelectItem>
                    <SelectItem value="aggressive">Agresivo</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          <Card className="border-zinc-800 bg-zinc-950/70">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base text-white">
                <ShieldCheck className="h-4 w-4 text-emerald-200" />
                Guardrails
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {(status?.guardrails || []).map((rule) => (
                <div key={rule} className="flex gap-2 rounded-md border border-white/10 bg-black/35 p-2 text-sm text-zinc-300">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-200" />
                  <span>{rule}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        <Card className="border-zinc-800 bg-zinc-950/70">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base text-white">
              <BarChart3 className="h-4 w-4 text-cyan-200" />
              Budget planner
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {status?.budgetPlanner ? (
              <>
                <div className="rounded-md border border-white/10 bg-black/35 p-3">
                  <div className="grid gap-3 md:grid-cols-3">
                    <div>
                      <p className="text-xs text-zinc-500">Target semanal</p>
                      <p className="text-2xl font-semibold text-white">{status.budgetPlanner.targetWeeklyClips} clips</p>
                    </div>
                    <div>
                      <p className="text-xs text-zinc-500">Configurado actual</p>
                      <p className="text-2xl font-semibold text-white">{status.budgetPlanner.configuredWeeklyClips} clips</p>
                    </div>
                    <div>
                      <p className="text-xs text-zinc-500">Recomendacion</p>
                      <p className="text-sm leading-6 text-emerald-200">{status.budgetPlanner.nextStep}</p>
                    </div>
                  </div>
                </div>

                <div className="grid gap-3 xl:grid-cols-3">
                  {(status.budgetPlanner.scenarios || []).map((scenario) => (
                    <div key={scenario.id} className="rounded-md border border-white/10 bg-black/35 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <p className="font-medium text-white">{scenario.label}</p>
                        {scenario.id === status.budgetPlanner.recommendedScenarioId && (
                          <Badge className="border border-emerald-300/30 bg-emerald-300/10 text-emerald-200">recomendado</Badge>
                        )}
                      </div>
                      <div className="mt-3 grid gap-2 text-xs text-zinc-500">
                        <p>Por clip: <span className="text-white">{formatMoney(scenario.costPerClipLow)} - {formatMoney(scenario.costPerClipHigh)}</span></p>
                        <p>Semana: <span className="text-white">{formatMoney(scenario.weeklyCostLow)} - {formatMoney(scenario.weeklyCostHigh)}</span></p>
                        <p>Mes: <span className="text-white">{formatMoney(scenario.monthlyCostLow)} - {formatMoney(scenario.monthlyCostHigh)}</span></p>
                      </div>
                      <p className="mt-3 text-xs leading-5 text-zinc-400">{scenario.bestFor}</p>
                      <p className="mt-2 text-xs leading-5 text-amber-200">{scenario.risk}</p>
                      <div className="mt-3 space-y-2">
                        {(scenario.roles || []).slice(0, 4).map((role) => (
                          <div key={`${scenario.id}-${role.role}`} className="rounded-md border border-white/10 bg-black/30 p-2">
                            <div className="flex items-center justify-between gap-3">
                              <p className="truncate text-xs font-medium text-white">{role.role}</p>
                              <p className="shrink-0 text-xs text-zinc-500">{role.weeklyHours}h/wk</p>
                            </div>
                            <p className="mt-1 text-xs text-zinc-600">{formatMoney(role.rateLow)}-{formatMoney(role.rateHigh)}/h</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="rounded-md border border-white/10 bg-black/35 p-3">
                  <p className="text-sm font-medium text-white">Assumptions</p>
                  <div className="mt-2 grid gap-2 md:grid-cols-2">
                    {(status.budgetPlanner.assumptions || []).map((assumption) => (
                      <p key={assumption} className="text-xs leading-5 text-zinc-500">{assumption}</p>
                    ))}
                  </div>
                </div>
              </>
            ) : (
              <p className="text-sm text-zinc-500">Cargando presupuesto...</p>
            )}
          </CardContent>
        </Card>

        <Card className="border-zinc-800 bg-zinc-950/70">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base text-white">
              <Users className="h-4 w-4 text-fuchsia-200" />
              Account Launch Kit
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {status?.accountLaunchKit ? (
              <>
                <div className="rounded-md border border-white/10 bg-black/35 p-3">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-white">{status.accountLaunchKit.markdownPath}</p>
                      <p className="mt-1 text-xs leading-5 text-zinc-500">{status.accountLaunchKit.nextStep}</p>
                    </div>
                    <Badge className={cn("w-fit border", accountLaunchBadge(status.accountLaunchKit.status))}>{status.accountLaunchKit.status}</Badge>
                  </div>
                  <div className="mt-3 grid gap-2 text-xs text-zinc-500 md:grid-cols-4">
                    <p>Total: {status.accountLaunchKit.totals?.tasks || 0}</p>
                    <p>Ready: {status.accountLaunchKit.totals?.ready || 0}</p>
                    <p>Pending: {status.accountLaunchKit.totals?.pending || 0}</p>
                    <p>Blocked: {status.accountLaunchKit.totals?.blocked || 0}</p>
                  </div>
                  {status.accountLaunchKit.generatedAt && (
                    <p className="mt-2 text-xs text-zinc-600">actualizado: {formatDate(status.accountLaunchKit.generatedAt)}</p>
                  )}
                </div>

                {status.accountIdentityKit && (
                  <div className="rounded-md border border-fuchsia-300/20 bg-fuchsia-950/10 p-3">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-white">{status.accountIdentityKit.markdownPath}</p>
                        <p className="mt-1 text-xs leading-5 text-zinc-500">{status.accountIdentityKit.nextStep}</p>
                      </div>
                      <Badge className={cn("w-fit border", accountIdentityKitBadge(status.accountIdentityKit.status))}>{status.accountIdentityKit.status}</Badge>
                    </div>
                    <div className="mt-3 grid gap-2 text-xs text-zinc-500 md:grid-cols-3">
                      <p>Accounts: {status.accountIdentityKit.totals.accounts}</p>
                      <p>Profiles: {status.accountIdentityKit.totals.platformProfiles}</p>
                      <p>First posts: {status.accountIdentityKit.totals.firstPostIdeas}</p>
                    </div>
                    <div className="mt-3 grid gap-3 md:grid-cols-3">
                      {status.accountIdentityKit.accounts.map((identity) => (
                        <div key={identity.accountId} className="rounded-md border border-white/10 bg-black/30 p-2">
                          <p className="truncate text-xs font-medium text-white">{identity.accountName}</p>
                          <p className="mt-1 text-xs text-zinc-500">{categoryLabels[identity.category]} · {identity.dailyClipTarget}/day</p>
                          <p className="mt-2 text-xs leading-5 text-zinc-400">{identity.contentPillars.slice(0, 2).join(" · ")}</p>
                          <div className="mt-2 flex flex-wrap gap-1">
                            {identity.platforms.map((platform) => (
                              <Badge key={`${identity.accountId}-${platform.platform}`} variant="outline" className="border-white/10 text-[10px] text-zinc-300">
                                {platform.handle}
                              </Badge>
                            ))}
                          </div>
                          <p className="mt-2 text-xs leading-5 text-fuchsia-100">{identity.platforms[0]?.firstPostIdeas[0]}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {status.accountCreationPack && (
                  <div className="rounded-md border border-green-300/20 bg-green-950/10 p-3">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-white">{status.accountCreationPack.markdownPath}</p>
                        <p className="mt-1 text-xs leading-5 text-zinc-500">{status.accountCreationPack.nextStep}</p>
                      </div>
                      <Badge className={cn("w-fit border", accountCreationPackBadge(status.accountCreationPack.status))}>{status.accountCreationPack.status}</Badge>
                    </div>
                    <div className="mt-3 grid gap-2 text-xs text-zinc-500 md:grid-cols-5">
                      <p>Profiles: {status.accountCreationPack.totals.profiles}</p>
                      <p>Ready: {status.accountCreationPack.totals.ready}</p>
                      <p>Partial: {status.accountCreationPack.totals.partial}</p>
                      <p>Blocked: {status.accountCreationPack.totals.blocked}</p>
                      <p>Missing evidence: {status.accountCreationPack.totals.evidenceMissing}</p>
                    </div>
                    <p className="mt-2 break-all text-xs text-zinc-600">CSV: {status.accountCreationPack.csvPath}</p>
                    <div className="mt-3 rounded-md border border-lime-300/15 bg-lime-950/10 p-2">
                      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                        <div className="min-w-0">
                          <p className="text-xs font-semibold uppercase tracking-wide text-lime-200">Claim sheet</p>
                          <p className="mt-1 break-all text-xs text-zinc-500">{status.accountCreationPack.claimSheetPath}</p>
                          <p className="mt-1 break-all text-xs text-zinc-600">CSV: {status.accountCreationPack.claimSheetCsvPath}</p>
                        </div>
                        <Badge className="w-fit border border-lime-300/20 bg-lime-950/30 text-[10px] text-lime-100">{status.accountCreationPack.claimSheet.length} rows</Badge>
                      </div>
                      <div className="mt-2 grid gap-2 lg:grid-cols-3">
                        {status.accountCreationPack.claimSheet.slice(0, 3).map((item) => (
                          <div key={item.id} className="rounded-md border border-white/10 bg-black/25 p-2">
                            <div className="flex items-center justify-between gap-2">
                              <p className="truncate text-xs font-medium text-white">#{item.rank} {item.accountName}</p>
                              <Badge className="border border-white/10 bg-black/30 text-[10px] text-zinc-300">{item.platform}</Badge>
                            </div>
                            <p className="mt-1 text-xs text-zinc-500">{item.handle} · {item.priority}</p>
                            <p className="mt-2 break-all text-[11px] leading-4 text-lime-100/80">Vault: {item.vaultItemName}</p>
                            <p className="mt-1 break-all text-[11px] leading-4 text-zinc-500">Login label: {item.loginIdentifierLabel}</p>
                            <p className="mt-1 text-[11px] leading-4 text-cyan-100/75">Claim: {item.claimSteps[0]}</p>
                            <p className="mt-1 text-[11px] leading-4 text-amber-100/75">Blocked: {item.blockedUntil[0]}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                    {status.accountCreationPack.sessionOrder.length > 0 && (
                      <div className="mt-3 rounded-md border border-emerald-300/15 bg-emerald-950/10 p-2">
                        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-200">Session order</p>
                          <Button size="sm" variant="outline" className="h-7 w-fit border-emerald-300/20 bg-transparent px-2 text-xs text-emerald-100 hover:bg-emerald-300/10" onClick={() => appendLaunchEvidenceBatchRow(status.accountCreationPack.evidenceBatchTemplate)}>
                            <UploadCloud className="mr-1 h-3 w-3" />
                            Batch
                          </Button>
                        </div>
                        <div className="mt-2 grid gap-2 lg:grid-cols-2">
                          {status.accountCreationPack.sessionOrder.slice(0, 6).map((item) => (
                            <div key={item.id} className="rounded-md border border-white/10 bg-black/25 p-2">
                              <div className="flex items-center justify-between gap-2">
                                <p className="min-w-0 truncate text-xs font-medium text-white">#{item.rank} {item.accountName}</p>
                                <Badge className="border border-emerald-300/20 bg-emerald-950/30 text-[10px] text-emerald-100">{item.priority}</Badge>
                              </div>
                              <p className="mt-1 text-xs text-zinc-500">{item.handle} · {item.platform} · {item.status}</p>
                              <p className="mt-2 text-xs leading-5 text-zinc-400">{item.nextStep}</p>
                              {item.copyPackage.length > 0 && (
                                <p className="mt-2 text-[11px] leading-4 text-zinc-500">
                                  Copy: {item.copyPackage.slice(1, 4).map((field) => `${field.label}=${field.value}`).join(" · ")}
                                </p>
                              )}
                              {item.portalFormFields.length > 0 && (
                                <p className="mt-2 text-[11px] leading-4 text-green-100/75">
                                  Portal: {item.portalFormFields.slice(0, 2).map((field) => `${field.field}=${field.value}`).join(" · ")}
                                </p>
                              )}
                              {item.handleReservationPlan.length > 0 && (
                                <p className="mt-2 text-[11px] leading-4 text-amber-100/75">
                                  Handle: {item.handleReservationPlan[0]}
                                </p>
                              )}
                              {item.browserSessionChecklist.length > 0 && (
                                <p className="mt-2 text-[11px] leading-4 text-cyan-100/75">
                                  Browser: {item.browserSessionChecklist[0]}
                                </p>
                              )}
                              {item.evidenceCapturePlan.length > 0 && (
                                <p className="mt-2 text-[11px] leading-4 text-fuchsia-100/75">
                                  Evidence: {item.evidenceCapturePlan[0]}
                                </p>
                              )}
                              <div className="mt-2 flex flex-wrap gap-1">
                                <Button size="sm" variant="outline" className="h-7 border-yellow-300/20 bg-transparent px-2 text-xs text-yellow-100 hover:bg-yellow-300/10" onClick={() => appendLaunchEvidenceBatchRow(item.submittedEvidenceBatchRow)}>
                                  <UploadCloud className="mr-1 h-3 w-3" />
                                  Submitted
                                </Button>
                                <Button size="sm" variant="outline" className="h-7 border-green-300/20 bg-transparent px-2 text-xs text-green-100 hover:bg-green-300/10" onClick={() => appendLaunchEvidenceBatchRow(item.verifiedEvidenceBatchRow)}>
                                  <UploadCloud className="mr-1 h-3 w-3" />
                                  Verified
                                </Button>
                              </div>
                              {item.operatorVaultChecklist.length > 0 && (
                                <p className="mt-2 text-[11px] leading-4 text-cyan-100/70">
                                  Vault: {item.operatorVaultChecklist[0]}
                                </p>
                              )}
                              {item.doneCriteria.length > 0 && (
                                <p className="mt-2 text-[11px] leading-4 text-emerald-100/70">
                                  Done: {item.doneCriteria.slice(0, 2).join(" · ")}
                                </p>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                      {status.accountCreationPack.items.slice(0, 9).map((item) => (
                        <div key={item.id} className="rounded-md border border-white/10 bg-black/30 p-2">
                          <div className="flex items-center justify-between gap-2">
                            <p className="truncate text-xs font-medium text-white">{item.displayName}</p>
                            <Badge className={cn("border text-[10px]", accountCreationPackBadge(item.status))}>{item.status}</Badge>
                          </div>
                          <p className="mt-1 text-xs text-zinc-500">{item.handle} · {item.platform}</p>
                          <p className="mt-2 text-xs leading-5 text-zinc-400">{item.nextStep}</p>
                          <p className="mt-2 text-xs leading-5 text-green-100/80">{item.completionHint}</p>
                          {item.copyPackage.length > 0 && (
                            <div className="mt-2 rounded-md border border-white/10 bg-black/25 p-2">
                              <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-300">Copy package</p>
                              <div className="mt-1 space-y-1 text-xs leading-4 text-zinc-400">
                                {item.copyPackage.slice(0, 5).map((field) => (
                                  <p key={field.label} className="break-all">{field.label}: {field.value}</p>
                                ))}
                              </div>
                            </div>
                          )}
                          {item.portalFormFields.length > 0 && (
                            <div className="mt-2 rounded-md border border-emerald-300/15 bg-emerald-950/10 p-2">
                              <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-200">Portal form</p>
                              <div className="mt-1 space-y-1 text-xs leading-4 text-emerald-100/80">
                                {item.portalFormFields.slice(0, 4).map((field) => (
                                  <p key={field.field} className="break-all">{field.field}: {field.value}</p>
                                ))}
                              </div>
                            </div>
                          )}
                          {item.handleReservationPlan.length > 0 && (
                            <div className="mt-2 rounded-md border border-amber-300/15 bg-amber-950/10 p-2">
                              <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-200">Handle reservation</p>
                              <ul className="mt-1 space-y-1 text-xs leading-4 text-amber-100/80">
                                {item.handleReservationPlan.slice(0, 3).map((step) => (
                                  <li key={step}>{step}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                          {item.browserSessionChecklist.length > 0 && (
                            <div className="mt-2 rounded-md border border-cyan-300/15 bg-cyan-950/10 p-2">
                              <p className="text-[10px] font-semibold uppercase tracking-wide text-cyan-200">Browser session</p>
                              <ul className="mt-1 space-y-1 text-xs leading-4 text-cyan-100/80">
                                {item.browserSessionChecklist.slice(0, 3).map((step) => (
                                  <li key={step}>{step}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                          {item.evidenceCapturePlan.length > 0 && (
                            <div className="mt-2 rounded-md border border-fuchsia-300/15 bg-fuchsia-950/10 p-2">
                              <p className="text-[10px] font-semibold uppercase tracking-wide text-fuchsia-200">Evidence capture</p>
                              <ul className="mt-1 space-y-1 text-xs leading-4 text-fuchsia-100/80">
                                {item.evidenceCapturePlan.slice(0, 3).map((step) => (
                                  <li key={step}>{step}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                          {item.requiredInputs.length > 0 && (
                            <div className="mt-2 rounded-md border border-green-300/15 bg-green-950/10 p-2">
                              <p className="text-[10px] font-semibold uppercase tracking-wide text-green-200">Required inputs</p>
                              <ul className="mt-1 space-y-1 text-xs leading-4 text-green-100/80">
                                {item.requiredInputs.slice(0, 4).map((requiredInput) => (
                                  <li key={requiredInput}>{requiredInput}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                          {item.securityChecklist.length > 0 && (
                            <div className="mt-2 rounded-md border border-cyan-300/15 bg-cyan-950/10 p-2">
                              <p className="text-[10px] font-semibold uppercase tracking-wide text-cyan-200">Security</p>
                              <ul className="mt-1 space-y-1 text-xs leading-4 text-cyan-100/80">
                                {item.securityChecklist.slice(0, 3).map((securityStep) => (
                                  <li key={securityStep}>{securityStep}</li>
                                ))}
                              </ul>
                              {item.platformProofRequired.length > 0 && (
                                <p className="mt-2 text-[11px] leading-4 text-cyan-100/70">
                                  Proof required: {item.platformProofRequired.slice(0, 2).join(" · ")}
                                </p>
                              )}
                            </div>
                          )}
                          {item.operatorVaultChecklist.length > 0 && (
                            <div className="mt-2 rounded-md border border-blue-300/15 bg-blue-950/10 p-2">
                              <p className="text-[10px] font-semibold uppercase tracking-wide text-blue-200">Operator vault</p>
                              <ul className="mt-1 space-y-1 text-xs leading-4 text-blue-100/80">
                                {item.operatorVaultChecklist.slice(0, 3).map((step) => (
                                  <li key={step}>{step}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                          {item.postCreationNextActions.length > 0 && (
                            <p className="mt-2 text-xs leading-5 text-amber-100">Next after create: {item.postCreationNextActions[0]}</p>
                          )}
                          <div className="mt-2 flex flex-wrap gap-2">
                            <a href={item.signupUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md border border-white/10 px-2 py-1 text-xs text-cyan-200 hover:bg-white/5">
                              Signup
                              <ExternalLink className="h-3 w-3" />
                            </a>
                            <a href={item.officialHelpUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md border border-white/10 px-2 py-1 text-xs text-cyan-200 hover:bg-white/5">
                              Help
                              <ExternalLink className="h-3 w-3" />
                            </a>
                            <Button size="sm" variant="outline" className="h-7 border-yellow-300/20 bg-transparent px-2 text-xs text-yellow-100 hover:bg-yellow-300/10" onClick={() => appendLaunchEvidenceBatchRow(item.submittedEvidenceBatchRow)}>
                              <UploadCloud className="mr-1 h-3 w-3" />
                              Submitted
                            </Button>
                            <Button size="sm" variant="outline" className="h-7 border-green-300/20 bg-transparent px-2 text-xs text-green-100 hover:bg-green-300/10" onClick={() => appendLaunchEvidenceBatchRow(item.verifiedEvidenceBatchRow)}>
                              <UploadCloud className="mr-1 h-3 w-3" />
                              Verified
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="rounded-md border border-fuchsia-300/20 bg-fuchsia-950/10 p-3">
                  <div className="grid gap-3 lg:grid-cols-[1.2fr_0.7fr_1fr_auto] lg:items-end">
                    <div className="space-y-1">
                      <Label htmlFor="account-evidence-task" className="text-xs text-zinc-400">Cuenta/plataforma</Label>
                      <Select value={selectedAccountEvidenceTask?.id || ""} onValueChange={setAccountEvidenceTaskId}>
                        <SelectTrigger id="account-evidence-task" className="border-zinc-800 bg-black">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {accountLaunchTasks.map((task) => (
                            <SelectItem key={task.id} value={task.id}>{task.displayName} · {task.platform}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="account-evidence-status" className="text-xs text-zinc-400">Status</Label>
                      <Select value={accountEvidenceStatus} onValueChange={(value) => setAccountEvidenceStatus(value as ClipperAccountEvidenceItemStatus)}>
                        <SelectTrigger id="account-evidence-status" className="border-zinc-800 bg-black">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="submitted">submitted</SelectItem>
                          <SelectItem value="verified">verified</SelectItem>
                          <SelectItem value="rejected">rejected</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="account-evidence-notes" className="text-xs text-zinc-400">Notas</Label>
                      <Input
                        id="account-evidence-notes"
                        value={accountEvidenceNotes}
                        onChange={(event) => setAccountEvidenceNotes(event.target.value)}
                        className="border-zinc-800 bg-black"
                      />
                    </div>
                    <Button
                      type="button"
                      onClick={submitAccountEvidenceForm}
                      disabled={recordAccountEvidenceMutation.isPending || !selectedAccountEvidenceTask}
                      className="bg-fuchsia-200 text-zinc-950 hover:bg-fuchsia-100"
                      data-testid="record-account-evidence-form-button"
                    >
                      {recordAccountEvidenceMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
                      Guardar cuenta
                    </Button>
                  </div>
                  {selectedAccountEvidenceTask && (
                    <p className="mt-2 text-xs text-zinc-600">
                      {selectedAccountEvidenceTask.handle} · {selectedAccountEvidenceTask.profileLink}
                    </p>
                  )}
                </div>

                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {(status.accountLaunchKit.tasks || []).map((task) => (
                    <div key={task.id} className="rounded-md border border-white/10 bg-black/35 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate font-medium text-white">{task.displayName}</p>
                          <p className="mt-1 text-xs text-zinc-500">{task.handle} · {task.platform}</p>
                        </div>
                        <Badge className={cn("shrink-0 border", accountLaunchBadge(task.status))}>{task.status}</Badge>
                      </div>
                      <div className="mt-2 flex items-center justify-between gap-3">
                        <p className="truncate text-xs text-zinc-600">{task.evidencePath || "sin evidencia real"}</p>
                        <Badge className={cn("shrink-0 border", accountEvidenceBadge(task.evidenceStatus))}>{task.evidenceStatus}</Badge>
                      </div>
                      <p className="mt-3 text-xs leading-5 text-zinc-400">{task.bio}</p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <a href={task.accountCreationUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md border border-white/10 px-2 py-1 text-xs text-cyan-200 hover:bg-white/5">
                          Crear cuenta
                          <ExternalLink className="h-3 w-3" />
                        </a>
                        <a href={task.developerPortalUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md border border-white/10 px-2 py-1 text-xs text-cyan-200 hover:bg-white/5">
                          Dev portal
                          <ExternalLink className="h-3 w-3" />
                        </a>
                        <a href={task.profileLink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md border border-white/10 px-2 py-1 text-xs text-zinc-300 hover:bg-white/5">
                          Perfil
                          <ExternalLink className="h-3 w-3" />
                        </a>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={recordAccountEvidenceMutation.isPending}
                          onClick={() => recordAccountEvidence(task, "submitted")}
                          className="h-7 border-white/10 px-2 text-xs text-zinc-200 hover:bg-white/5"
                        >
                          Submitted
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={recordAccountEvidenceMutation.isPending}
                          onClick={() => recordAccountEvidence(task, "verified")}
                          className="h-7 border-emerald-300/30 px-2 text-xs text-emerald-200 hover:bg-emerald-300/10"
                        >
                          Verified
                        </Button>
                      </div>
                      <p className="mt-3 text-xs leading-5 text-amber-200">{task.nextStep}</p>
                      <div className="mt-3 space-y-1">
                        {(task.checklist || []).slice(0, 4).map((step) => (
                          <p key={`${task.id}-${step}`} className="flex gap-2 text-xs leading-5 text-zinc-500">
                            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-fuchsia-200" />
                            {step}
                          </p>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <p className="text-sm text-zinc-500">Cargando launch kit...</p>
            )}
          </CardContent>
        </Card>

        <Card className="border-zinc-800 bg-zinc-950/70">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base text-white">
              <ShieldCheck className="h-4 w-4 text-purple-200" />
              Account Evidence Vault
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {status?.accountEvidence ? (
              <>
                <div className="rounded-md border border-white/10 bg-black/35 p-3">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-white">{status.accountEvidence.evidenceDir}</p>
                      <p className="mt-1 text-xs leading-5 text-zinc-500">{status.accountEvidence.nextStep}</p>
                    </div>
                    <Badge className={cn("w-fit border", accountEvidenceBadge(status.accountEvidence.status))}>{status.accountEvidence.status}</Badge>
                  </div>
                  <div className="mt-3 grid gap-2 text-xs text-zinc-500 md:grid-cols-5">
                    <p>Expected: {status.accountEvidence.totals?.expected || 0}</p>
                    <p>Verified: {status.accountEvidence.totals?.verified || 0}</p>
                    <p>Submitted: {status.accountEvidence.totals?.submitted || 0}</p>
                    <p>Rejected: {status.accountEvidence.totals?.rejected || 0}</p>
                    <p>Missing: {status.accountEvidence.totals?.missing || 0}</p>
                  </div>
                  <p className="mt-2 break-all text-xs text-zinc-600">Templates: {status.accountEvidence.templateDir}</p>
                  <p className="mt-1 break-all text-xs text-zinc-600">Evidence-drop template: {status.accountEvidence.launchEvidenceTemplatePath}</p>
                  {status.accountEvidence.launchEvidenceDropChecklist.length > 0 && (
                    <div className="mt-3 rounded-md border border-fuchsia-300/15 bg-fuchsia-950/10 p-2">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-fuchsia-200">Drop checklist</p>
                      <ul className="mt-1 space-y-1 text-xs leading-4 text-fuchsia-100/80">
                        {status.accountEvidence.launchEvidenceDropChecklist.slice(0, 4).map((step) => (
                          <li key={step}>{step}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>

                <div id="launch-evidence-batch" className="scroll-mt-6 rounded-md border border-purple-300/20 bg-purple-950/10 p-3">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <p className="font-medium text-white">Launch evidence batch</p>
                      <p className="mt-1 text-xs leading-5 text-zinc-500">Importa cuentas verificadas, apps developer, permisos y derechos de fuentes desde CSV o JSON sin guardar secretos.</p>
                    </div>
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => launchEvidenceBatchPreviewMutation.mutate()}
                        disabled={launchEvidenceBatchPreviewMutation.isPending || !launchEvidenceBatchText.trim()}
                        className="border-purple-300/30 text-purple-100 hover:bg-purple-300/10"
                        data-testid="preview-clippers-launch-evidence-batch-button"
                      >
                        {launchEvidenceBatchPreviewMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Eye className="mr-2 h-4 w-4" />}
                        Preview batch
                      </Button>
                      <Button
                        type="button"
                        onClick={() => launchEvidenceBatchMutation.mutate()}
                        disabled={launchEvidenceBatchMutation.isPending || !launchEvidenceBatchText.trim()}
                        className="bg-purple-200 text-zinc-950 hover:bg-purple-100"
                        data-testid="record-clippers-launch-evidence-batch-button"
                      >
                        {launchEvidenceBatchMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <UploadCloud className="mr-2 h-4 w-4" />}
                        Importar batch
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => launchEvidenceDropImportMutation.mutate()}
                        disabled={launchEvidenceDropImportMutation.isPending}
                        className="border-cyan-300/30 text-cyan-100 hover:bg-cyan-300/10"
                        data-testid="import-clippers-launch-evidence-drop-files-button"
                      >
                        {launchEvidenceDropImportMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FolderOpen className="mr-2 h-4 w-4" />}
                        Import drop
                      </Button>
                    </div>
                  </div>
                  <Textarea
                    value={launchEvidenceBatchText}
                    onChange={(event) => {
                      setLaunchEvidenceBatchText(event.target.value);
                      setLaunchEvidenceBatchPreview(null);
                    }}
                    placeholder={`${launchEvidenceBatchHeader}\naccount,sports-daily,tiktok,verified,,,,Cuenta creada y verificada\ndeveloper_app,,youtube,submitted,,youtube-app-id,https://tu-dominio.com,App enviada a review\npermission,,tiktok,requested,video.publish,,,Scope solicitado\nsource_rights,clip.mp4,memes,owned_or_permissioned,clip.mp4,,,Permiso confirmado por creator; evidencia en Drive`}
                    className="mt-3 min-h-32 border-zinc-800 bg-black font-mono text-xs"
                    autoComplete="off"
                    data-testid="clipper-launch-evidence-batch-input"
                  />
                  <p className="mt-2 text-xs text-zinc-600">Columnas clave: kind, account_id, platform, status, scope, app_identifier, public_base_url, notes. Para source_rights: account_id puede ser asset_id/file_name, platform es category y scope puede repetir file_name.</p>
                  <p className="mt-1 break-all text-xs text-zinc-600">Drop inbox: {status.accountEvidence.launchEvidenceDropDir || `${status.rootDir}/evidence-drop`}</p>
                  <p className="mt-1 break-all text-xs text-zinc-600">Template CSV: {status.accountEvidence.launchEvidenceTemplatePath} · {status.accountEvidence.launchEvidenceTemplateRows} rows</p>
                  {launchEvidenceBatchPreview && (
                    <div className="mt-3 rounded-md border border-white/10 bg-black/30 p-3" data-testid="clippers-launch-evidence-batch-preview">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <p className="text-xs font-medium text-white">Preview de importacion</p>
                        <Badge className={cn("w-fit border", launchEvidenceBatchPreview.rejected.length ? "border-amber-300/30 bg-amber-300/10 text-amber-200" : "border-emerald-300/30 bg-emerald-300/10 text-emerald-200")}>
                          {launchEvidenceBatchPreview.rejected.length ? "needs_fix" : "importable"}
                        </Badge>
                      </div>
                      <div className="mt-3 grid gap-2 text-xs text-zinc-500 md:grid-cols-5">
                        <p>Cuentas: {launchEvidenceBatchPreview.accepted.accountEvidence}</p>
                        <p>Apps: {launchEvidenceBatchPreview.accepted.developerApps}</p>
                        <p>Permisos: {launchEvidenceBatchPreview.accepted.permissions}</p>
                        <p>Derechos: {launchEvidenceBatchPreview.accepted.sourceRights}</p>
                        <p>Rechazados: {launchEvidenceBatchPreview.rejected.length}</p>
                      </div>
                      {launchEvidenceBatchPreview.filesScanned !== undefined && (
                        <div className="mt-2 grid gap-2 text-xs text-zinc-500 md:grid-cols-3">
                          <p>Archivos revisados: {launchEvidenceBatchPreview.filesScanned}</p>
                          <p>Archivos importados: {launchEvidenceBatchPreview.filesImported || 0}</p>
                          <p>Fuentes: {(launchEvidenceBatchPreview.sourceFiles || []).length ? launchEvidenceBatchPreview.sourceFiles?.join(", ") : "ninguna"}</p>
                        </div>
                      )}
                      <p className="mt-2 text-xs leading-5 text-zinc-500">{launchEvidenceBatchPreview.nextStep}</p>
                      {(launchEvidenceBatchPreview.fileErrors || []).length > 0 && (
                        <div className="mt-3 space-y-2">
                          {launchEvidenceBatchPreview.fileErrors?.slice(0, 5).map((item) => (
                            <div key={`${item.relativePath}-${item.reason}`} className="rounded-md border border-amber-300/20 bg-amber-950/10 p-2">
                              <p className="break-all text-xs font-medium text-amber-100">{item.relativePath}</p>
                              <p className="mt-1 text-xs text-zinc-500">{item.reason}</p>
                            </div>
                          ))}
                        </div>
                      )}
                      {launchEvidenceBatchPreview.rejected.length > 0 && (
                        <div className="mt-3 space-y-2">
                          {launchEvidenceBatchPreview.rejected.slice(0, 5).map((item) => (
                            <div key={`${item.index}-${item.kind}-${item.identifier || "unknown"}`} className="rounded-md border border-amber-300/20 bg-amber-950/10 p-2">
                              <p className="text-xs font-medium text-amber-100">Row {item.index}: {item.kind}</p>
                              <p className="mt-1 text-xs text-zinc-500">{item.reason}</p>
                              {item.identifier && <p className="mt-1 break-all text-[11px] text-zinc-600">{item.identifier}</p>}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {(status.accountEvidence.items || []).length ? status.accountEvidence.items.map((item) => (
                    <div key={item.id} className="rounded-md border border-white/10 bg-black/35 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate font-medium text-white">{item.displayName}</p>
                          <p className="mt-1 text-xs text-zinc-500">{item.handle} · {item.platform}</p>
                        </div>
                        <Badge className={cn("shrink-0 border", accountEvidenceBadge(item.status))}>{item.status}</Badge>
                      </div>
                      <p className="mt-2 text-xs leading-5 text-zinc-500">{item.notes}</p>
                      <p className="mt-2 break-all text-xs text-zinc-600">{item.evidencePath}</p>
                      <p className="mt-2 text-xs leading-5 text-amber-200">{item.nextStep}</p>
                    </div>
                  )) : (
                    <div className="rounded-md border border-white/10 bg-black/35 p-3 text-sm text-zinc-500">
                      Todavia no hay evidencia real en la raiz de account-evidence.
                    </div>
                  )}
                </div>
              </>
            ) : (
              <p className="text-sm text-zinc-500">Cargando evidence vault...</p>
            )}
          </CardContent>
        </Card>

        <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
          <Card className="border-zinc-800 bg-zinc-950/70">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base text-white">
                <KeyRound className="h-4 w-4 text-cyan-200" />
                Cuentas preparadas
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {(status?.accounts || []).flatMap((account) =>
                (account.platformAccounts || []).map((platformAccount) => (
                  <div key={`${account.id}-${platformAccount.platform}`} className="rounded-md border border-white/10 bg-black/35 p-3">
                    <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-white">{platformAccount.displayName} <span className="text-zinc-500">{platformAccount.handle}</span></p>
                        <p className="mt-1 text-xs text-zinc-500">{categoryLabels[account.category]} · {platformAccount.platform}</p>
                      </div>
                      <Badge className={cn("w-fit border", connectionBadge(platformAccount.status))}>{platformAccount.status}</Badge>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {platformAccount.requiredScopes.map((scope) => (
                        <Badge key={scope} variant="outline" className="border-zinc-700 text-zinc-300">{scope}</Badge>
                      ))}
                    </div>
                    <p className="mt-2 text-xs leading-5 text-zinc-500">{platformAccount.notes}</p>
                    <p className="mt-2 text-xs text-amber-200">Pendiente: {platformAccount.missingSteps.join(" · ")}</p>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card className="border-zinc-800 bg-zinc-950/70">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base text-white">
                <ShieldCheck className="h-4 w-4 text-emerald-200" />
                Permisos/API
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {(status?.permissionQueue || []).map((permission) => (
                <div key={permission.id} className="rounded-md border border-white/10 bg-black/35 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{permission.label}</p>
                      <p className="mt-1 text-xs text-zinc-500">{permission.reason}</p>
                    </div>
                    <Badge className={cn("border", connectionBadge(permission.status))}>{permission.status}</Badge>
                  </div>
                  <p className="mt-2 text-xs leading-5 text-zinc-500">{permission.evidenceRequired}</p>
                  <a href={permission.docsUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-xs text-cyan-200 hover:text-cyan-100">
                    Docs oficiales
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        <Card className="border-zinc-800 bg-zinc-950/70">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base text-white">
              <UploadCloud className="h-4 w-4 text-amber-200" />
              Setup por plataforma
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 xl:grid-cols-3">
            {(status?.platformRequirements || []).map((platform) => (
              <div key={platform.platform} className="rounded-md border border-white/10 bg-black/35 p-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-medium">{platform.label}</p>
                  <a href={platform.developerPortalUrl} target="_blank" rel="noreferrer" className="text-cyan-200 hover:text-cyan-100" aria-label={`Abrir ${platform.label}`}>
                    <ExternalLink className="h-4 w-4" />
                  </a>
                </div>
                <p className="mt-2 text-xs leading-5 text-zinc-400">{platform.requiredAccountType}</p>
                <p className="mt-2 text-xs leading-5 text-zinc-500">{platform.appReview}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {platform.scopes.map((scope) => (
                    <Badge key={scope} variant="outline" className="border-zinc-700 text-zinc-300">{scope}</Badge>
                  ))}
                </div>
                <div className="mt-3 space-y-1">
                  {platform.humanRequired.map((step) => (
                    <p key={step} className="flex gap-2 text-xs leading-5 text-zinc-500">
                      <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-200" />
                      {step}
                    </p>
                  ))}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="border-zinc-800 bg-zinc-950/70">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base text-white">
              <ShieldCheck className="h-4 w-4 text-violet-200" />
              Paquete de permisos
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {status?.permissionPack ? (
              <>
                <div className="rounded-md border border-white/10 bg-black/35 p-3">
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-white">{status.permissionPack.rootDir}</p>
                      <p className="mt-1 text-xs text-zinc-500">{status.permissionPack.nextStep}</p>
                    </div>
                    <Badge className={cn("w-fit border", permissionPackBadge(status.permissionPack.status))}>{status.permissionPack.status}</Badge>
                  </div>
                  {status.permissionPack.generatedAt && (
                    <p className="mt-2 text-xs text-zinc-600">actualizado: {formatDate(status.permissionPack.generatedAt)}</p>
                  )}
                </div>
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  {status.permissionPack.files.map((file) => (
                    <div key={file.id} className="rounded-md border border-white/10 bg-black/35 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <p className="truncate font-medium text-white">{file.label}</p>
                        <Badge className={cn("border", file.exists ? "border-emerald-300/30 bg-emerald-300/10 text-emerald-200" : "border-red-300/30 bg-red-300/10 text-red-200")}>
                          {file.exists ? "ready" : "missing"}
                        </Badge>
                      </div>
                      <p className="mt-2 text-xs leading-5 text-zinc-500">{file.purpose}</p>
                      <p className="mt-2 break-all text-xs text-zinc-600">{file.path}</p>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <p className="text-sm text-zinc-500">Cargando paquete de permisos...</p>
            )}
          </CardContent>
        </Card>

        <Card className="border-zinc-800 bg-zinc-950/70">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base text-white">
              <HardDrive className="h-4 w-4 text-sky-200" />
              Google Drive Clippers
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {status?.driveWorkspace ? (
              <>
                <div className="rounded-md border border-white/10 bg-black/35 p-3">
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-white">{status.driveWorkspace.rootPath.join(" / ")}</p>
                      <p className="mt-1 text-xs leading-5 text-zinc-500">{status.driveWorkspace.nextStep}</p>
                    </div>
                    <Badge className={cn("w-fit border", driveWorkspaceBadge(status.driveWorkspace.status))}>{status.driveWorkspace.status}</Badge>
                  </div>
                  <div className="mt-3 grid gap-2 text-xs text-zinc-500 md:grid-cols-3">
                    <p>Keys: {status.driveWorkspace.configured ? "detectadas" : "faltan"}</p>
                    <p>Conexion: {status.driveWorkspace.connected ? "lista" : "pendiente"}</p>
                    <p>{status.driveWorkspace.generatedAt ? `actualizado: ${formatDate(status.driveWorkspace.generatedAt)}` : "sin manifest"}</p>
                  </div>
                  {status.driveWorkspace.envDiagnostics && (
                    <div className="mt-3 rounded-md border border-sky-300/10 bg-sky-950/10 p-3">
                      <div className="grid gap-2 text-xs text-zinc-500 md:grid-cols-2">
                        <p>Archivos revisados: {status.driveWorkspace.envDiagnostics.envFilesChecked.join(", ")}</p>
                        <p>Archivos encontrados: {status.driveWorkspace.envDiagnostics.envFilesFound.length ? status.driveWorkspace.envDiagnostics.envFilesFound.join(", ") : "ninguno"}</p>
                        <p>Client ID detectado: {status.driveWorkspace.envDiagnostics.configuredClientIdAliases.length ? status.driveWorkspace.envDiagnostics.configuredClientIdAliases.join(", ") : "ninguno"}</p>
                        <p>Client secret detectado: {status.driveWorkspace.envDiagnostics.configuredClientSecretAliases.length ? status.driveWorkspace.envDiagnostics.configuredClientSecretAliases.join(", ") : "ninguno"}</p>
                        <p>Refresh token detectado: {status.driveWorkspace.envDiagnostics.configuredRefreshTokenAliases.length ? status.driveWorkspace.envDiagnostics.configuredRefreshTokenAliases.join(", ") : "ninguno"}</p>
                        <p>Faltan grupos: {status.driveWorkspace.envDiagnostics.missingGroups.length ? status.driveWorkspace.envDiagnostics.missingGroups.length : 0}</p>
                        <p>Keys en archivos: {status.driveWorkspace.envDiagnostics.detectedAcceptedAliasesInFiles.length ? status.driveWorkspace.envDiagnostics.detectedAcceptedAliasesInFiles.join(", ") : "ninguna"}</p>
                        <p>{status.driveWorkspace.envDiagnostics.nextCredentialStep}</p>
                      </div>
                      {status.driveWorkspace.envDiagnostics.missingGroups.length > 0 && (
                        <p className="mt-2 text-xs leading-5 text-amber-200">
                          Acepta: {status.driveWorkspace.envDiagnostics.missingGroups.join(" | ")}
                        </p>
                      )}
                      <div className="mt-3 rounded-md border border-white/10 bg-black/30 p-2">
                        <p className="break-all text-xs font-medium text-white">{status.driveWorkspace.envDiagnostics.credentialTemplatePath}</p>
                        <div className="mt-2 grid gap-1 text-xs text-sky-100 md:grid-cols-3">
                          {status.driveWorkspace.envDiagnostics.requiredEnvTemplateRows.map((row) => (
                            <p key={row} className="font-mono">{row}</p>
                          ))}
                        </div>
                      </div>
                      {status.driveWorkspace.envDiagnostics.envFilesWithAcceptedAliases.length > 0 && (
                        <div className="mt-2 grid gap-1 text-xs text-sky-100 md:grid-cols-2">
                          {status.driveWorkspace.envDiagnostics.envFilesWithAcceptedAliases.map((file) => (
                            <p key={file.fileName} className="truncate">
                              {file.fileName}: {file.aliases.join(", ")}
                            </p>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                  {status.driveWorkspace.oauthSetup && (
                    <div className="mt-3 rounded-md border border-white/10 bg-black/30 p-3">
                      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                        <div className="min-w-0">
                          <p className="text-xs font-medium text-white">Google OAuth setup</p>
                          <p className="mt-1 text-xs leading-5 text-zinc-500">{status.driveWorkspace.oauthSetup.nextStep}</p>
                        </div>
                        <Badge className="w-fit border border-sky-300/30 bg-sky-300/10 text-sky-100">
                          {status.driveWorkspace.oauthSetup.configuredRedirectUri ? "redirect_configured" : "copy_redirect"}
                        </Badge>
                      </div>
                      <div className="mt-3 grid gap-2 text-xs text-zinc-500 md:grid-cols-2">
                        <p>Auth path: {status.driveWorkspace.oauthSetup.authPath}</p>
                        <p>Callback: {status.driveWorkspace.oauthSetup.callbackPath}</p>
                      </div>
                      <div className="mt-2 grid gap-1 text-xs text-sky-100">
                        {status.driveWorkspace.oauthSetup.recommendedRedirectUris.map((uri) => (
                          <p key={uri} className="break-all">{uri}</p>
                        ))}
                      </div>
                      <p className="mt-2 text-xs leading-5 text-zinc-600">Scopes: {status.driveWorkspace.oauthSetup.scopes.join(", ")}</p>
                    </div>
                  )}
                  {status.driveWorkspace.error && (
                    <p className="mt-2 text-xs leading-5 text-amber-200">{status.driveWorkspace.error}</p>
                  )}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!status.driveWorkspace.configured}
                      className="border-sky-300/30 bg-sky-300/10 text-sky-100 hover:bg-sky-300/20"
                      onClick={() => { window.location.href = "/api/google-drive/auth"; }}
                    >
                      <ExternalLink className="mr-2 h-4 w-4" />
                      Conectar Drive
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={driveWorkspaceMutation.isPending || isLoading}
                      className="border-white/10 bg-white/5 text-zinc-100 hover:bg-white/10"
                      onClick={() => driveWorkspaceMutation.mutate()}
                    >
                      {driveWorkspaceMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <HardDrive className="mr-2 h-4 w-4" />}
                      Preparar carpetas
                    </Button>
                  </div>
                </div>
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {status.driveWorkspace.folders.map((folder) => (
                    <div key={folder.id} className="rounded-md border border-white/10 bg-black/35 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <p className="truncate font-medium text-white">{folder.label}</p>
                        <Badge className={cn("border", folder.folderId ? "border-emerald-300/30 bg-emerald-300/10 text-emerald-200" : "border-zinc-600 bg-zinc-900 text-zinc-300")}>
                          {folder.folderId ? "ready" : "pending"}
                        </Badge>
                      </div>
                      <p className="mt-2 text-xs leading-5 text-zinc-500">{folder.purpose}</p>
                      <p className="mt-2 break-all text-xs text-zinc-600">{folder.path.join(" / ")}</p>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <p className="text-sm text-zinc-500">Cargando Google Drive...</p>
            )}
          </CardContent>
        </Card>

        <Card className="border-zinc-800 bg-zinc-950/70">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base text-white">
              <BarChart3 className="h-4 w-4 text-emerald-200" />
              Optimizer metrics
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {status?.metrics ? (
              <>
                <div className="grid gap-3 xl:grid-cols-[0.85fr_1.15fr]">
                  <div className="rounded-md border border-white/10 bg-black/35 p-3">
                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-white">{status.metrics.metricsDir}</p>
                        <p className="mt-1 text-xs leading-5 text-zinc-500">{status.metrics.nextStep}</p>
                      </div>
                      <Badge className={cn("w-fit border", metricsBadge(status.metrics.status))}>{status.metrics.status}</Badge>
                    </div>
                    <div className="mt-3 grid gap-2 text-xs text-zinc-500 md:grid-cols-3">
                      <p>Clips: {formatNumber(status.metrics.totals.clips)}</p>
                      <p>Views: {formatNumber(status.metrics.totals.views)}</p>
                      <p>ER: {(status.metrics.totals.engagementRate * 100).toFixed(2)}%</p>
                    </div>
                    {status.metrics.generatedAt && (
                      <p className="mt-2 text-xs text-zinc-600">actualizado: {formatDate(status.metrics.generatedAt)}</p>
                    )}
                  </div>

                  <div className="grid gap-3 md:grid-cols-3">
                    {status.metrics.accountPerformance.map((account) => (
                      <div key={account.accountId} className="rounded-md border border-white/10 bg-black/35 p-3">
                        <div className="flex items-center justify-between gap-3">
                          <p className="truncate font-medium text-white">{account.accountName}</p>
                          <Badge className={cn("border", metricsBadge(account.status))}>{account.status}</Badge>
                        </div>
                        <p className="mt-2 text-xs text-zinc-500">{formatNumber(account.views)} views · {account.clips} clips</p>
                        <p className="mt-1 text-xs text-zinc-500">avg {formatNumber(account.avgViews)} · ER {(account.engagementRate * 100).toFixed(2)}%</p>
                        <p className="mt-2 text-xs leading-5 text-amber-200">{account.recommendation}</p>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="grid gap-3 xl:grid-cols-2">
                  <div className="rounded-md border border-white/10 bg-black/35 p-3">
                    <p className="text-sm font-medium text-white">Top clips</p>
                    <div className="mt-3 space-y-2">
                      {status.metrics.topClips.length ? status.metrics.topClips.map((clip) => (
                        <div key={clip.id} className="rounded-md border border-white/10 bg-black/30 p-2">
                          <div className="flex items-center justify-between gap-3">
                            <p className="truncate text-sm text-white">{clip.hook}</p>
                            <p className="shrink-0 text-xs text-emerald-200">{formatNumber(clip.views)}</p>
                          </div>
                          <p className="mt-1 text-xs text-zinc-600">{clip.accountName} · {clip.platform} · {clip.sourceFile}</p>
                        </div>
                      )) : (
                        <p className="text-xs text-zinc-500">Sin clips importados todavia.</p>
                      )}
                    </div>
                  </div>

                  <div className="rounded-md border border-white/10 bg-black/35 p-3">
                    <p className="text-sm font-medium text-white">Recomendaciones</p>
                    <div className="mt-3 space-y-2">
                      {status.metrics.recommendations.map((recommendation) => (
                        <p key={recommendation} className="flex gap-2 text-xs leading-5 text-zinc-400">
                          <TrendingUp className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-200" />
                          {recommendation}
                        </p>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  {status.metrics.files.map((file) => (
                    <div key={file.path} className="rounded-md border border-white/10 bg-black/35 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <p className="truncate font-medium text-white">{file.fileName}</p>
                        <Badge className={cn("border", file.status === "imported" ? "border-emerald-300/30 bg-emerald-300/10 text-emerald-200" : file.status === "error" ? "border-red-300/30 bg-red-300/10 text-red-200" : "border-amber-300/30 bg-amber-300/10 text-amber-200")}>{file.status}</Badge>
                      </div>
                      <p className="mt-2 text-xs text-zinc-500">{file.records} records · {formatDate(file.importedAt)}</p>
                      {file.error && <p className="mt-2 text-xs leading-5 text-amber-200">{file.error}</p>}
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <p className="text-sm text-zinc-500">Cargando metricas...</p>
            )}
          </CardContent>
        </Card>

        <Card className="border-zinc-800 bg-zinc-950/70">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base text-white">
              <Flame className="h-4 w-4 text-orange-200" />
              Trend Radar
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {status?.trendRadar ? (
              <>
                <div className="rounded-md border border-white/10 bg-black/35 p-3">
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-white">{status.trendRadar.trendsDir}</p>
                      <p className="mt-1 text-xs leading-5 text-zinc-500">{status.trendRadar.nextStep}</p>
                    </div>
                    <Badge className={cn("w-fit border", trendRadarBadge(status.trendRadar.status))}>{status.trendRadar.status}</Badge>
                  </div>
                  <div className="mt-3 grid gap-2 text-xs text-zinc-500 md:grid-cols-3">
                    <p>Oportunidades: {status.trendRadar.candidates.length}</p>
                    <p>Top list: {status.trendRadar.topCandidates.length}</p>
                    <p>{status.trendRadar.generatedAt ? `actualizado: ${formatDate(status.trendRadar.generatedAt)}` : "sin imports"}</p>
                  </div>
                </div>

                <div className="rounded-md border border-orange-300/20 bg-black/35 p-3">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <p className="font-medium text-white">Importar candidatos virales</p>
                      <p className="mt-1 text-xs leading-5 text-zinc-500">Pega CSV/JSON con oportunidades encontradas desde Viral Discovery; el radar rankea y mantiene rights gate.</p>
                    </div>
                    <Button
                      type="button"
                      onClick={() => trendCandidatesBatchMutation.mutate()}
                      disabled={trendCandidatesBatchMutation.isPending || !trendCandidatesBatchText.trim()}
                      className="bg-orange-200 text-zinc-950 hover:bg-orange-100"
                      data-testid="record-clippers-trend-candidates-batch-button"
                    >
                      {trendCandidatesBatchMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <UploadCloud className="mr-2 h-4 w-4" />}
                      Importar candidates
                    </Button>
                  </div>
                  <Textarea
                    value={trendCandidatesBatchText}
                    onChange={(event) => setTrendCandidatesBatchText(event.target.value)}
                    placeholder={"category,platform,title,url,source,posted_at,views,likes,comments,shares,rights,angle\nsports,tiktok,Last second comeback,https://...,@team,2026-06-17T09:00:00Z,1500000,80000,5000,22000,approved,Use scoreboard tension\nmemes,instagram,POV everyone today,https://...,@creator,2026-06-17T08:30:00Z,350000,20000,1200,9000,review,Fast relatable hook"}
                    className="mt-3 min-h-32 border-zinc-800 bg-black font-mono text-xs"
                    autoComplete="off"
                    data-testid="clipper-trend-candidates-batch-input"
                  />
                  <p className="mt-2 text-xs text-zinc-600">Columnas clave: category, platform, title, url, source, posted_at, views, shares, rights, angle.</p>
                </div>

                {status.trendRightsOutreach && (
                  <div className="rounded-md border border-amber-300/20 bg-amber-950/10 p-3">
                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-white">{status.trendRightsOutreach.markdownPath}</p>
                        <p className="mt-1 text-xs leading-5 text-zinc-500">{status.trendRightsOutreach.nextStep}</p>
                      </div>
                      <Badge className={cn("w-fit border", trendRightsOutreachBadge(status.trendRightsOutreach.status))}>{status.trendRightsOutreach.status}</Badge>
                    </div>
                    <div className="mt-3 grid gap-2 text-xs text-zinc-500 md:grid-cols-4">
                      <p>Candidates: {status.trendRightsOutreach.totals.candidates}</p>
                      <p>Review: {status.trendRightsOutreach.totals.reviewRequired}</p>
                      <p>Ready contact: {status.trendRightsOutreach.totals.readyToContact}</p>
                      <p>Permissioned: {status.trendRightsOutreach.totals.permissionRecorded}</p>
                    </div>
                    <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                      {status.trendRightsOutreach.items.map((item) => (
                        <div key={item.id} className="rounded-md border border-white/10 bg-black/30 p-2">
                          <div className="flex items-center justify-between gap-2">
                            <p className="truncate text-xs font-medium text-white">{item.title}</p>
                            <Badge className={cn("border text-[10px]", trendRightsOutreachBadge(item.status))}>{item.status}</Badge>
                          </div>
                          <p className="mt-1 text-xs text-zinc-500">{item.platform} · score {formatNumber(item.viralScore)} · {item.source}</p>
                          <p className="mt-2 line-clamp-2 text-xs leading-5 text-zinc-400">{item.outreachSubject}</p>
                          <div className="mt-2 rounded border border-white/10 bg-black/40 p-2">
                            <p className="text-[10px] uppercase tracking-wide text-zinc-500">Allowlist template</p>
                            <pre className="mt-1 max-h-28 overflow-auto whitespace-pre-wrap break-words font-mono text-[10px] leading-4 text-zinc-300">{item.permissionRecordTemplate}</pre>
                          </div>
                          <p className="mt-2 line-clamp-2 text-xs leading-5 text-amber-200">{item.nextStep}</p>
                          {item.url && (
                            <a href={item.url} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-xs text-cyan-200 hover:text-cyan-100">
                              Fuente
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {status.viralDiscovery && (
                  <div className="rounded-md border border-orange-300/20 bg-orange-950/10 p-3">
                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-white">{status.viralDiscovery.csvPath}</p>
                        <p className="mt-1 text-xs leading-5 text-zinc-500">{status.viralDiscovery.nextStep}</p>
                      </div>
                      <Badge className={cn("w-fit border", viralDiscoveryBadge(status.viralDiscovery.status))}>{status.viralDiscovery.status}</Badge>
                    </div>
                    <div className="mt-3 grid gap-2 text-xs text-zinc-500 md:grid-cols-6">
                      <p>Fecha: {status.viralDiscovery.discoveryDate}</p>
                      <p>Queries: {status.viralDiscovery.totals.queries}</p>
                      <p>Must scan: {status.viralDiscovery.totals.mustScan}</p>
                      <p>Watch: {status.viralDiscovery.totals.watch}</p>
                      <p>Candidates: {status.viralDiscovery.totals.targetCandidates}</p>
                      <p>Scan min: {status.viralDiscovery.totals.scanMinutes}</p>
                    </div>
                    {status.viralDiscovery.sessionOrder.length > 0 && (
                      <div className="mt-3 rounded-md border border-orange-300/15 bg-orange-950/10 p-2">
                        <p className="text-xs font-semibold uppercase tracking-wide text-orange-200">Scan session</p>
                        <div className="mt-2 grid gap-2 lg:grid-cols-3">
                          {status.viralDiscovery.sessionOrder.slice(0, 6).map((item) => (
                            <div key={item.itemId} className="rounded-md border border-white/10 bg-black/25 p-2">
                              <div className="flex items-center justify-between gap-2">
                                <p className="truncate text-xs font-medium text-white">#{item.rank} {item.accountName}</p>
                                <Badge className={cn("border text-[10px]", viralDiscoveryBadge(item.priority))}>{item.priority}</Badge>
                              </div>
                              <p className="mt-1 text-xs text-zinc-500">{categoryLabels[item.category]} · {item.platform} · {item.scanMinutes}m</p>
                              <p className="mt-2 text-xs leading-5 text-orange-100/80">Target: {item.targetCandidates} candidates · min {formatNumber(item.minimumViews)} views</p>
                              <p className="mt-2 line-clamp-2 text-xs leading-5 text-zinc-400">{item.minimumEngagementSignal}</p>
                              <div className="mt-2 flex flex-wrap gap-2">
                                <a href={item.searchUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md border border-cyan-300/20 px-2 py-1 text-xs text-cyan-200 hover:bg-cyan-300/10">
                                  Buscar
                                  <ExternalLink className="h-3 w-3" />
                                </a>
                                <Button type="button" size="sm" variant="outline" className="h-7 border-orange-300/20 bg-transparent px-2 text-xs text-orange-100 hover:bg-orange-300/10" onClick={() => appendTrendCandidateBatchRow(item.trendImportRow)}>
                                  <UploadCloud className="mr-1 h-3 w-3" />
                                  Row
                                </Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    <div className="mt-3 grid gap-3 md:grid-cols-3">
                      {status.viralDiscovery.items.map((item) => (
                        <div key={item.id} className="rounded-md border border-white/10 bg-black/30 p-2">
                          <div className="flex items-center justify-between gap-2">
                            <p className="truncate text-xs font-medium text-white">{item.accountName}</p>
                            <Badge className={cn("border text-[10px]", viralDiscoveryBadge(item.priority))}>{item.priority}</Badge>
                          </div>
                          <p className="mt-1 text-xs text-zinc-500">{categoryLabels[item.category]} · {item.platform} · {item.recencyWindow}</p>
                          <p className="mt-2 line-clamp-2 text-xs leading-5 text-zinc-400">{item.query}</p>
                          <p className="mt-2 line-clamp-2 text-xs leading-5 text-amber-200">{item.rightsGate}</p>
                          <div className="mt-2 flex flex-wrap gap-2">
                            <a href={item.searchUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md border border-cyan-300/20 px-2 py-1 text-xs text-cyan-200 hover:bg-cyan-300/10">
                              Buscar
                              <ExternalLink className="h-3 w-3" />
                            </a>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="h-7 border-orange-300/20 bg-transparent px-2 text-xs text-orange-100 hover:bg-orange-300/10"
                              onClick={() => appendTrendCandidateBatchRow(item.trendImportRow)}
                            >
                              <UploadCloud className="mr-1 h-3 w-3" />
                              Candidate row
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="grid gap-3 xl:grid-cols-[1.2fr_0.8fr]">
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                    {status.trendRadar.topCandidates.length ? status.trendRadar.topCandidates.map((candidate) => (
                      <div key={candidate.id} className="rounded-md border border-white/10 bg-black/35 p-3">
                        <div className="flex items-center justify-between gap-3">
                          <p className="truncate font-medium text-white">{candidate.title}</p>
                          <Badge className={cn("border", trendRadarBadge(candidate.rightsStatus))}>{candidate.rightsStatus}</Badge>
                        </div>
                        <p className="mt-2 text-xs text-zinc-500">{categoryLabels[candidate.category]} · {candidate.platform} · score {formatNumber(candidate.viralScore)}</p>
                        <p className="mt-1 text-xs text-zinc-600">{formatNumber(candidate.views)} views · {formatNumber(candidate.shares)} shares</p>
                        <p className="mt-2 text-xs leading-5 text-zinc-400">{candidate.hookAngle}</p>
                        <p className="mt-2 text-xs leading-5 text-amber-200">{candidate.nextStep}</p>
                        {candidate.url && (
                          <a href={candidate.url} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-xs text-cyan-200 hover:text-cyan-100">
                            Abrir fuente
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                      </div>
                    )) : (
                      <p className="text-xs text-zinc-500">Sin oportunidades importadas todavia.</p>
                    )}
                  </div>

                  <div className="rounded-md border border-white/10 bg-black/35 p-3">
                    <p className="text-sm font-medium text-white">Acciones Trend Scout</p>
                    <div className="mt-3 space-y-2">
                      {status.trendRadar.recommendations.map((recommendation) => (
                        <p key={recommendation} className="flex gap-2 text-xs leading-5 text-zinc-400">
                          <Flame className="mt-0.5 h-3.5 w-3.5 shrink-0 text-orange-200" />
                          {recommendation}
                        </p>
                      ))}
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <p className="text-sm text-zinc-500">Cargando Trend Radar...</p>
            )}
          </CardContent>
        </Card>

        <div className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
          <Card id="oauth-connect" className="scroll-mt-6 border-zinc-800 bg-zinc-950/70">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base text-white">
                <KeyRound className="h-4 w-4 text-amber-200" />
                Credenciales OAuth
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {(status?.credentialChecks || []).map((check) => (
                <div key={check.platform} className="rounded-md border border-white/10 bg-black/35 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-white">{check.label}</p>
                      <p className="mt-1 text-xs text-zinc-500">{check.nextStep}</p>
                    </div>
                    <Badge className={cn("border", readinessBadge(check.status))}>{check.status}</Badge>
                  </div>
                  <div className="mt-3 grid gap-2 text-xs md:grid-cols-2">
                    <div className="rounded-md border border-white/10 bg-black/30 p-2">
                      <p className="text-zinc-500">Configuradas</p>
                      <p className="mt-1 break-all text-zinc-300">{check.configuredEnvVars.length ? check.configuredEnvVars.join(", ") : "ninguna"}</p>
                    </div>
                    <div className="rounded-md border border-white/10 bg-black/30 p-2">
                      <p className="text-zinc-500">Faltan</p>
                      <p className="mt-1 break-all text-amber-200">{check.missingEnvVars.length ? check.missingEnvVars.join(", ") : "listo"}</p>
                    </div>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="border-zinc-800 bg-zinc-950/70">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base text-white">
                <ExternalLink className="h-4 w-4 text-cyan-200" />
                Acciones de conexion
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {(status?.connectActions || []).map((action) => (
                <div key={action.platform} className="rounded-md border border-white/10 bg-black/35 p-3">
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-white">{action.label}</p>
                      <p className="mt-1 text-xs text-zinc-500">{action.nextStep}</p>
                    </div>
                    {action.authUrl ? (
                      <a href={`/api/clippers/oauth/${action.platform}/start`} className="inline-flex h-9 shrink-0 items-center justify-center rounded-md bg-cyan-200 px-3 text-sm font-medium text-zinc-950 hover:bg-cyan-100">
                        Conectar
                      </a>
                    ) : (
                      <Badge className="w-fit border border-red-300/30 bg-red-300/10 text-red-200">bloqueado</Badge>
                    )}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {action.scopes.map((scope) => (
                      <Badge key={scope} variant="outline" className="border-zinc-700 text-zinc-300">{scope}</Badge>
                    ))}
                  </div>
                  {action.missingEnvVars.length > 0 && (
                    <p className="mt-2 text-xs text-amber-200">Faltan: {action.missingEnvVars.join(", ")}</p>
                  )}
                  <p className="mt-2 text-xs text-zinc-600">Callback: {action.callbackPath}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        <Card className="border-zinc-800 bg-zinc-950/70">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base text-white">
              <KeyRound className="h-4 w-4 text-cyan-200" />
              OAuth recibido
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-3">
            {(status?.oauthConnections || []).length === 0 ? (
              <p className="text-sm text-zinc-500">Todavia no hay authorization codes registrados.</p>
            ) : (
              (status?.oauthConnections || []).map((connection) => (
                <div key={`${connection.platform}-${connection.receivedAt}`} className="rounded-md border border-white/10 bg-black/35 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-medium text-white">{connection.platform}</p>
                    <Badge className={cn("border", oauthBadge(connection.status))}>{connection.status}</Badge>
                  </div>
                  <p className="mt-2 text-xs leading-5 text-zinc-500">{connection.note}</p>
                  {connection.tokenNote && <p className="mt-2 text-xs leading-5 text-amber-200">{connection.tokenNote}</p>}
                  <p className="mt-2 text-xs text-zinc-600">{formatDate(connection.receivedAt)}</p>
                  {connection.codeHash && <p className="mt-2 text-xs text-zinc-600">code hash: {connection.codeHash}</p>}
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <div className="grid gap-4 xl:grid-cols-[0.85fr_1.15fr]">
          <Card className="border-zinc-800 bg-zinc-950/70">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base text-white">
                <ShieldCheck className="h-4 w-4 text-emerald-200" />
                Token vault
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {status?.tokenVault ? (
                <>
                  <div className="rounded-md border border-white/10 bg-black/35 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-white">{status.tokenVault.envVar}</p>
                        <p className="mt-1 text-xs text-zinc-500">{status.tokenVault.nextStep}</p>
                      </div>
                      <Badge className={cn("border", tokenVaultBadge(status.tokenVault.status))}>{status.tokenVault.status}</Badge>
                    </div>
                    <p className="mt-3 break-all text-xs text-zinc-600">{status.tokenVault.vaultPath}</p>
                  </div>
                  {(status.tokenVault.records || []).length === 0 ? (
                    <p className="text-sm text-zinc-500">Aun no hay tokens cifrados guardados.</p>
                  ) : (
                    status.tokenVault.records.map((record) => (
                      <div key={`${record.platform}-${record.savedAt}`} className="rounded-md border border-white/10 bg-black/35 p-3">
                        <div className="flex items-center justify-between gap-3">
                          <p className="font-medium text-white">{record.platform}</p>
                          <Badge className="border border-emerald-300/30 bg-emerald-300/10 text-emerald-200">{record.status}</Badge>
                        </div>
                        <p className="mt-2 text-xs text-zinc-600">guardado: {formatDate(record.savedAt)}</p>
                        {record.expiresAt && <p className="mt-1 text-xs text-zinc-600">expira: {formatDate(record.expiresAt)}</p>}
                        {record.subjectHash && <p className="mt-1 text-xs text-zinc-600">subject hash: {record.subjectHash}</p>}
                      </div>
                    ))
                  )}
                </>
              ) : (
                <p className="text-sm text-zinc-500">Cargando vault...</p>
              )}
            </CardContent>
          </Card>

          <Card className="border-zinc-800 bg-zinc-950/70">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base text-white">
                <Network className="h-4 w-4 text-cyan-200" />
                Intercambio de tokens
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-3">
              {(status?.tokenExchanges || []).map((exchange) => (
                <div key={exchange.platform} className="rounded-md border border-white/10 bg-black/35 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-medium text-white">{exchange.label}</p>
                    <Badge className={cn("border", tokenExchangeBadge(exchange.status))}>{exchange.status}</Badge>
                  </div>
                  <p className="mt-2 text-xs leading-5 text-zinc-500">{exchange.nextStep}</p>
                  {exchange.missingEnvVars.length > 0 && (
                    <p className="mt-2 text-xs text-amber-200">Faltan: {exchange.missingEnvVars.join(", ")}</p>
                  )}
                  {exchange.tokenSavedAt && <p className="mt-2 text-xs text-zinc-600">token: {formatDate(exchange.tokenSavedAt)}</p>}
                  <p className="mt-2 text-xs text-zinc-600">Callback: {exchange.callbackPath}</p>
                  <a href={exchange.docsUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-xs text-cyan-200 hover:text-cyan-100">
                    Docs oficiales
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        <Card className="border-zinc-800 bg-zinc-950/70">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base text-white">
              <CalendarClock className="h-4 w-4 text-lime-200" />
              Automatizacion diaria
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {status?.automationSchedule && (
              <div className="rounded-md border border-white/10 bg-black/35 p-3">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-white">{status.automationSchedule.manifestPath}</p>
                    <p className="mt-1 text-xs text-zinc-500">{status.automationSchedule.nextStep}</p>
                  </div>
                  <Badge className={cn("w-fit border", automationScheduleBadge(status.automationSchedule.status))}>{status.automationSchedule.status}</Badge>
                </div>
                <div className="mt-3 grid gap-2 text-xs text-zinc-500 md:grid-cols-4">
                  <p>Hora: {status.automationSchedule.dailyRunTime}</p>
                  <p>Timezone: {status.automationSchedule.timezone}</p>
                  <p>Target: {status.automationSchedule.weeklyTargetClips}/week</p>
                  <p>Modo: {status.automationSchedule.publishMode}</p>
                </div>
                <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-5">
                  {status.automationSchedule.runbook.map((step) => (
                    <p key={step} className="rounded-md border border-white/10 bg-black/30 p-2 text-xs leading-5 text-zinc-500">{step}</p>
                  ))}
                </div>
              </div>
            )}
            {status?.publisherConnectors && (
              <div className="rounded-md border border-white/10 bg-black/35 p-3">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-white">{status.publisherConnectors.markdownPath}</p>
                    <p className="mt-1 text-xs text-zinc-500">{status.publisherConnectors.nextStep}</p>
                  </div>
                  <Badge className={cn("w-fit border", publisherConnectorBadge(status.publisherConnectors.status))}>{status.publisherConnectors.status}</Badge>
                </div>
                <div className="mt-3 grid gap-2 text-xs text-zinc-500 md:grid-cols-4">
                  <p>Platforms: {status.publisherConnectors.totals.platforms}</p>
                  <p>Ready: {status.publisherConnectors.totals.ready}</p>
                  <p>Partial: {status.publisherConnectors.totals.partial}</p>
                  <p>Blocked: {status.publisherConnectors.totals.blocked}</p>
                </div>
                <div className="mt-3 grid gap-3 md:grid-cols-3">
                  {status.publisherConnectors.items.map((item) => (
                    <div key={item.platform} className="rounded-md border border-white/10 bg-black/30 p-2">
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate text-xs font-medium text-white">{item.label}</p>
                        <Badge className={cn("border text-[10px]", publisherConnectorBadge(item.status))}>{item.status}</Badge>
                      </div>
                      <p className="mt-2 truncate text-xs text-zinc-500">{item.endpoint}</p>
                      <p className="mt-1 text-xs text-zinc-500">Scopes: {item.permissionsApproved}/{item.permissionsTotal} · Token: {item.tokenSaved ? "yes" : "no"}</p>
                      <p className="mt-1 text-xs text-zinc-500">Gate: {item.publishGate} · Clips: {item.publishableQueueItems}</p>
                      {item.blockingCategories.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {item.blockingCategories.map((category) => (
                            <Badge key={`${item.platform}-${category}`} className="border border-amber-300/20 bg-amber-300/10 text-[10px] text-amber-100">
                              {category}
                            </Badge>
                          ))}
                        </div>
                      )}
                      {item.goLiveChecks.length > 0 && (
                        <div className="mt-2 space-y-1">
                          {item.goLiveChecks.slice(0, 4).map((check) => (
                            <div key={`${item.platform}-${check.id}`} className="flex items-center justify-between gap-2 rounded border border-white/10 px-2 py-1">
                              <p className="truncate text-xs text-zinc-400">{check.label}</p>
                              <Badge className={cn("shrink-0 border text-[10px]", check.done ? "border-emerald-300/30 bg-emerald-300/10 text-emerald-200" : "border-zinc-600 bg-zinc-900 text-zinc-300")}>
                                {check.done ? "ok" : "missing"}
                              </Badge>
                            </div>
                          ))}
                        </div>
                      )}
                      <p className="mt-2 text-xs leading-5 text-amber-200">{item.nextStep}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {status?.automation ? (
              <>
                <div className="rounded-md border border-white/10 bg-black/35 p-3">
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-white">{status.automation.lastRun?.schedulePath || status.automation.nextRunHint}</p>
                      <p className="mt-1 text-xs text-zinc-500">{status.automation.nextStep}</p>
                    </div>
                    <Badge className={cn("w-fit border", automationBadge(status.automation.status))}>{status.automation.status}</Badge>
                  </div>
                  {status.automation.lastRun && <p className="mt-2 text-xs text-zinc-600">ultimo ciclo: {formatDate(status.automation.lastRun.createdAt)}</p>}
                </div>

                {status.automation.lastRun ? (
                  <div className="grid gap-3 xl:grid-cols-[0.8fr_1.2fr]">
                    <div className="space-y-3">
                      <div className="grid grid-cols-2 gap-2 text-sm">
                        <div className="rounded-md border border-white/10 bg-black/35 p-3">
                          <p className="text-xs text-zinc-500">Posts</p>
                          <p className="font-semibold">{status.automation.lastRun.totals.posts}</p>
                        </div>
                        <div className="rounded-md border border-white/10 bg-black/35 p-3">
                          <p className="text-xs text-zinc-500">Bloqueados</p>
                          <p className="font-semibold">{status.automation.lastRun.totals.blocked}</p>
                        </div>
                        <div className="rounded-md border border-white/10 bg-black/35 p-3">
                          <p className="text-xs text-zinc-500">Manual</p>
                          <p className="font-semibold">{status.automation.lastRun.totals.readyForManual}</p>
                        </div>
                        <div className="rounded-md border border-white/10 bg-black/35 p-3">
                          <p className="text-xs text-zinc-500">Scheduled</p>
                          <p className="font-semibold">{status.automation.lastRun.totals.scheduled}</p>
                        </div>
                      </div>
                      <div className="rounded-md border border-white/10 bg-black/35 p-3">
                        <p className="text-sm font-medium text-white">Recomendaciones</p>
                        <div className="mt-2 space-y-2">
                          {status.automation.lastRun.recommendations.map((recommendation) => (
                            <p key={recommendation} className="text-xs leading-5 text-zinc-500">{recommendation}</p>
                          ))}
                        </div>
                      </div>
                    </div>

                    <div className="grid gap-3 md:grid-cols-2">
                      {status.automation.lastRun.posts.map((post) => (
                        <div key={post.id} className="rounded-md border border-white/10 bg-black/35 p-3">
                          <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <p className="truncate font-medium text-white">{post.accountName}</p>
                              <p className="mt-1 text-xs text-zinc-500">{post.platform} · {formatDate(post.publishAt)}</p>
                            </div>
                            <Badge className={cn("border", automationBadge(post.status))}>{post.status}</Badge>
                          </div>
                          <p className="mt-2 text-sm text-zinc-300">{post.hook}</p>
                          <p className="mt-1 text-xs text-zinc-500">{post.captionSeed}</p>
                          {post.blocker && <p className="mt-2 text-xs leading-5 text-amber-200">{post.blocker}</p>}
                          <p className="mt-2 text-xs leading-5 text-zinc-500">{post.nextStep}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <p className="rounded-md border border-white/10 bg-black/35 p-3 text-sm text-zinc-500">Todavia no hay ciclo diario ejecutado.</p>
                )}
              </>
            ) : (
              <p className="text-sm text-zinc-500">Cargando automatizacion...</p>
            )}
          </CardContent>
        </Card>

        <Card className="border-zinc-800 bg-zinc-950/70">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base text-white">
              <Clapperboard className="h-4 w-4 text-rose-200" />
              Cola de produccion
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {status?.productionQueue ? (
              <>
                <div className="rounded-md border border-white/10 bg-black/35 p-3">
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-white">{status.productionQueue.queuePath || "cola no congelada"}</p>
                      <p className="mt-1 text-xs text-zinc-500">{status.productionQueue.nextStep}</p>
                    </div>
                    <Badge className={cn("w-fit border", productionBadge(status.productionQueue.status))}>{status.productionQueue.status}</Badge>
                  </div>
                  {status.productionQueue.generatedAt && <p className="mt-2 text-xs text-zinc-600">generada: {formatDate(status.productionQueue.generatedAt)}</p>}
                </div>

                <div className="rounded-md border border-white/10 bg-black/35 p-3">
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-white">{status.sourceHunt?.csvPath || "hunt sheet no generada"}</p>
                      <p className="mt-1 text-xs text-zinc-500">{status.sourceHunt?.nextStep || "Genera la hoja diaria para buscar fuentes y permisos."}</p>
                    </div>
                    <Badge className={cn("w-fit border", sourceHuntBadge(status.sourceHunt?.status || "not_prepared"))}>
                      {status.sourceHunt?.status || "not_prepared"}
                    </Badge>
                  </div>
                  <div className="mt-3 grid gap-2 text-xs text-zinc-500 md:grid-cols-4">
                    <p>Fecha: {status.sourceHunt?.huntDate || "today"}</p>
                    <p>Slots: {status.sourceHunt?.totals.items || 0}</p>
                    <p>Necesitan fuente: {status.sourceHunt?.totals.needsSource || 0}</p>
                    <p>Listos draft: {status.sourceHunt?.totals.readyForDraft || 0}</p>
                  </div>
                  {(status.sourceHunt?.items || []).slice(0, 3).map((item) => (
                    <div key={item.id} className="mt-2 rounded-md border border-white/10 bg-black/25 p-2">
                      <p className="truncate text-xs text-cyan-200">{item.accountName} slot {item.slotNumber}: {item.suggestedSearch}</p>
                      <div className="mt-2 space-y-1">
                        {(item.requiredInputs || []).slice(0, 3).map((input) => (
                          <p key={input} className="text-xs leading-5 text-zinc-500">- {input}</p>
                        ))}
                      </div>
                      <p className="mt-2 text-xs leading-5 text-amber-200">{item.completionHint || item.nextStep}</p>
                    </div>
                  ))}
                </div>

                {status.rightsOutreach && (
                  <div className="rounded-md border border-emerald-300/20 bg-emerald-950/10 p-3">
                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-white">{status.rightsOutreach.markdownPath}</p>
                        <p className="mt-1 text-xs text-zinc-500">{status.rightsOutreach.nextStep}</p>
                      </div>
                      <Badge className={cn("w-fit border", rightsOutreachBadge(status.rightsOutreach.status))}>{status.rightsOutreach.status}</Badge>
                    </div>
                    <div className="mt-3 grid gap-2 text-xs text-zinc-500 md:grid-cols-4">
                      <p>Items: {status.rightsOutreach.totals.items}</p>
                      <p>Need target: {status.rightsOutreach.totals.needsTarget}</p>
                      <p>Ready contact: {status.rightsOutreach.totals.readyToContact}</p>
                      <p>Recorded: {status.rightsOutreach.totals.permissionRecorded}</p>
                    </div>
                    <div className="mt-3 grid gap-3 md:grid-cols-3">
                      {status.rightsOutreach.items.slice(0, 6).map((item) => (
                        <div key={item.id} className="rounded-md border border-white/10 bg-black/30 p-2">
                          <div className="flex items-center justify-between gap-2">
                            <p className="truncate text-xs font-medium text-white">{item.accountName}</p>
                            <Badge className={cn("border text-[10px]", rightsOutreachBadge(item.status))}>{item.status}</Badge>
                          </div>
                          <p className="mt-2 text-xs text-zinc-500">{categoryLabels[item.category]}</p>
                          <p className="mt-1 text-xs leading-5 text-zinc-400">{item.targetHook}</p>
                          <p className="mt-2 truncate text-xs text-cyan-200">{item.outreachSubject}</p>
                          <div className="mt-2 space-y-1">
                            {(item.requiredInputs || []).slice(0, 3).map((input) => (
                              <p key={input} className="text-xs leading-5 text-zinc-500">- {input}</p>
                            ))}
                          </div>
                          <p className="mt-2 text-xs leading-5 text-emerald-200">{item.completionHint || item.nextStep}</p>
                          <p className="mt-2 text-xs leading-5 text-amber-200">{item.nextStep}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="rounded-md border border-white/10 bg-black/35 p-3">
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-white">{status.sourceAcquisition?.markdownPath || "source plan no generado"}</p>
                      <p className="mt-1 text-xs text-zinc-500">{status.sourceAcquisition?.nextStep || "Prepara un plan para cubrir sources diarios."}</p>
                    </div>
                    <Badge className={cn("w-fit border", sourceAcquisitionBadge(status.sourceAcquisition?.status || "not_prepared"))}>
                      {status.sourceAcquisition?.status || "not_prepared"}
                    </Badge>
                  </div>
                  <div className="mt-3 grid gap-2 text-xs text-zinc-500 md:grid-cols-4 xl:grid-cols-6">
                    <p>Slots: {status.sourceAcquisition?.totals.dailySlots || 0}</p>
                    <p>Target/wk: {status.sourceAcquisition?.totals.targetWeeklyClips || 0}</p>
                    <p>Ready/wk: {status.sourceAcquisition?.totals.weeklyReadySlots || 0}</p>
                    <p>Missing/wk: {status.sourceAcquisition?.totals.weeklyMissingSourceSlots || 0}</p>
                    <p>Listos: {status.sourceAcquisition?.totals.readyQueueSlots || 0}</p>
                    <p>Sin fuente: {status.sourceAcquisition?.totals.missingSourceSlots || 0}</p>
                  </div>
                  <div className="mt-3 grid gap-2 md:grid-cols-3">
                    {(status.sourceAcquisition?.categories || []).map((category) => (
                      <div key={category.category} className="rounded-md border border-white/10 bg-black/30 p-2">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-xs font-medium text-white">{category.label}</p>
                          <Badge className={cn("border text-[10px]", sourceAcquisitionBadge(category.priority))}>{category.priority}</Badge>
                        </div>
                        <p className="mt-2 text-xs text-zinc-500">{category.readyQueueSlots}/{category.dailySlots} slots listos</p>
                        <p className="mt-1 text-xs text-zinc-500">{category.weeklyReadySlots}/{category.weeklyTargetSlots} clips/semana</p>
                        <p className="mt-1 text-xs text-zinc-600">{category.sourceAssets} assets · {category.rightsReadyAssets} rights OK</p>
                        <p className="mt-1 text-xs text-amber-200">Min weekly assets: {category.minimumWeeklySourceAssets}</p>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-md border border-white/10 bg-black/35 p-3">
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-white">{status.draftSpecs?.manifestPath || "draft specs no generados"}</p>
                      <p className="mt-1 text-xs text-zinc-500">{status.draftSpecs?.nextStep || "Genera specs cuando haya items draft_ready."}</p>
                    </div>
                    <Badge className={cn("w-fit border", draftSpecBadge(status.draftSpecs?.status || "empty"))}>{status.draftSpecs?.status || "empty"}</Badge>
                  </div>
                  <div className="mt-3 grid gap-2 text-xs text-zinc-500 md:grid-cols-3">
                    <p>Specs: {status.draftSpecs?.totals.items || 0}</p>
                    <p>Ready edit: {status.draftSpecs?.totals.readyForEdit || 0}</p>
                    <p>Bloqueados: {status.draftSpecs?.totals.blockedQueueItems || 0}</p>
                  </div>
                  {(status.draftSpecs?.items || []).slice(0, 4).map((spec) => (
                    <p key={spec.id} className="mt-2 truncate text-xs text-emerald-200">
                      {spec.accountName} slot {spec.slotNumber}: {spec.variantAngle} · {spec.markdownPath}
                    </p>
                  ))}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      className="h-8 bg-emerald-200 px-3 text-xs text-zinc-950 hover:bg-emerald-100"
                      disabled={renderDraftVideosMutation.isPending}
                      onClick={() => renderDraftVideosMutation.mutate()}
                      data-testid="render-clippers-draft-videos-inline-button"
                    >
                      {renderDraftVideosMutation.isPending ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Play className="mr-2 h-3.5 w-3.5" />}
                      Render clips
                    </Button>
                  </div>
                  {renderedClips && (
                    <div className="mt-3 rounded-md border border-emerald-300/20 bg-emerald-950/10 p-3" data-testid="clippers-rendered-clips-result">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <p className="text-xs font-medium text-white">Rendered clips</p>
                        <Badge className={cn("w-fit border", renderedClips.status === "ready" ? "border-emerald-300/30 bg-emerald-300/10 text-emerald-200" : renderedClips.status === "partial" ? "border-amber-300/30 bg-amber-300/10 text-amber-200" : "border-red-300/30 bg-red-300/10 text-red-200")}>{renderedClips.status}</Badge>
                      </div>
                      <div className="mt-2 grid gap-2 text-xs text-zinc-500 md:grid-cols-4">
                        <p>Rendered: {renderedClips.totals.rendered}</p>
                        <p>Attempted: {renderedClips.totals.attempted}</p>
                        <p>Failed: {renderedClips.totals.failed}</p>
                        <p>Specs: {renderedClips.totals.availableDraftSpecs}</p>
                      </div>
                      <p className="mt-2 break-all text-xs text-zinc-600">Output: {renderedClips.outputDir}</p>
                      {renderedClips.items.slice(0, 4).map((item) => (
                        <p key={item.id} className={cn("mt-2 break-all text-xs", item.status === "rendered" ? "text-emerald-200" : "text-amber-200")}>
                          {item.status}: {item.outputPath}
                        </p>
                      ))}
                    </div>
                  )}
                </div>

                <div className="grid gap-3 xl:grid-cols-[0.9fr_1.1fr]">
                  <div className={cn(tunnelStackClass, "space-y-3")}>
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="text-sm font-medium text-white">Assets detectados</p>
                        <p className="mt-1 break-all text-xs text-zinc-600">Drop inbox: {status.rootDir}/source-drop</p>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 border-cyan-300/30 bg-transparent px-2 text-xs text-cyan-100 hover:bg-cyan-300/10"
                        disabled={sourceDropImportMutation.isPending}
                        onClick={() => sourceDropImportMutation.mutate()}
                        data-testid="import-clippers-source-drop-files-button"
                      >
                        {sourceDropImportMutation.isPending ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <FolderOpen className="mr-1 h-3 w-3" />}
                        Import source-drop
                      </Button>
                    </div>
                    {sourceDropImport && (
                      <div className="rounded-md border border-cyan-300/20 bg-cyan-950/10 p-3" data-testid="clippers-source-drop-import-result">
                        <div className="grid gap-2 text-xs text-zinc-500 md:grid-cols-4">
                          <p>Scanned: {sourceDropImport.filesScanned}</p>
                          <p>Imported: {sourceDropImport.imported}</p>
                          <p>Skipped: {sourceDropImport.skipped}</p>
                          <p>Assets: {sourceDropImport.queue.sourceAssets.length}</p>
                        </div>
                        <p className="mt-2 text-xs leading-5 text-zinc-500">{sourceDropImport.nextStep}</p>
                        {sourceDropImport.items.slice(0, 4).map((item) => (
                          <p key={`${item.sourcePath}-${item.targetPath}`} className={cn("mt-2 break-all text-xs", item.status === "imported" ? "text-cyan-100" : "text-amber-200")}>
                            {item.status}: {item.fileName} {"->"} {item.targetPath || item.reason}
                          </p>
                        ))}
                      </div>
                    )}
                    {(status.productionQueue.sourceAssets || []).length === 0 ? (
                      <p className="rounded-md border border-white/10 bg-black/35 p-3 text-sm text-zinc-500">No hay videos en las carpetas de fuentes todavia.</p>
                    ) : (
                      status.productionQueue.sourceAssets.map((asset) => (
                        <div key={asset.id} className={tunnelBoxClass}>
                          <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <p className="truncate font-medium text-white">{asset.fileName}</p>
                              <p className="mt-1 text-xs text-zinc-500">{categoryLabels[asset.category]} · {formatDate(asset.updatedAt)}</p>
                            </div>
                            <Badge className={cn("border", productionBadge(asset.rightsStatus))}>{asset.rightsStatus}</Badge>
                          </div>
                          <p className="mt-2 text-xs leading-5 text-zinc-500">{asset.notes}</p>
                          {asset.evidencePath && <p className="mt-2 break-all text-xs text-emerald-200">{asset.evidencePath}</p>}
                          <div className="mt-3 flex flex-wrap gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 border-emerald-400/20 bg-transparent px-2 text-xs text-emerald-100 hover:bg-emerald-400/10"
                              disabled={recordSourceRightsMutation.isPending}
                              onClick={() => {
                                const notes = window.prompt(`Evidencia de permiso para ${asset.fileName}`, asset.evidencePath ? "Permiso confirmado y evidencia revisada." : "Permiso/licencia/ownership confirmado.");
                                if (notes === null) return;
                                recordSourceRightsMutation.mutate({
                                  assetId: asset.id,
                                  rightsStatus: "owned_or_permissioned",
                                  notes,
                                });
                              }}
                            >
                              <ShieldCheck className="mr-1 h-3 w-3" />
                              Rights OK
                            </Button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>

                  <div className={cn(tunnelStackClass, "space-y-3")}>
                    <p className="text-sm font-medium text-white">Items por cuenta</p>
                    {(status.productionQueue.items || []).map((item) => (
                      <div key={item.id} className={tunnelBoxClass}>
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate font-medium text-white">{item.accountName} · slot {item.slotNumber}</p>
                            <p className="mt-1 text-xs text-zinc-500">{categoryLabels[item.category]} · {item.publishWindow} · {item.variantAngle}</p>
                          </div>
                          <Badge className={cn("border", productionBadge(item.status))}>{item.status}</Badge>
                        </div>
                        <p className="mt-2 text-sm text-zinc-300">{item.hook}</p>
                        <p className="mt-1 text-xs text-cyan-200">{item.clipObjective}</p>
                        <p className="mt-1 text-xs text-zinc-500">{item.format}</p>
                        <div className="mt-2 space-y-1">
                          {(item.requiredInputs || []).slice(0, 3).map((input) => (
                            <p key={input} className="text-xs leading-5 text-zinc-500">- {input}</p>
                          ))}
                        </div>
                        <p className="mt-2 text-xs leading-5 text-emerald-200">{item.completionHint || item.nextStep}</p>
                        <p className="mt-2 text-xs leading-5 text-amber-200">{item.nextStep}</p>
                        {item.sourcePath && <p className="mt-2 break-all text-xs text-zinc-600">{item.sourcePath}</p>}
                      </div>
                    ))}
                  </div>
                </div>
              </>
            ) : (
              <p className="text-sm text-zinc-500">Cargando cola de produccion...</p>
            )}
          </CardContent>
        </Card>

        <div className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
          <Card className="border-zinc-800 bg-zinc-950/70">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base text-white">
                <FolderOpen className="h-4 w-4 text-emerald-200" />
                Carpetas de fuentes
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-2">
              {(status?.sourceFolders || []).map((folder) => (
                <div key={folder.path} className="rounded-md border border-white/10 bg-black/35 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-medium text-white">{folder.label}</p>
                    <Badge className="border border-emerald-300/30 bg-emerald-300/10 text-emerald-200">{folder.status}</Badge>
                  </div>
                  <p className="mt-2 text-xs leading-5 text-zinc-500">{folder.purpose}</p>
                  <p className="mt-2 break-all text-xs text-zinc-600">{folder.path}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-4 xl:grid-cols-3">
          {(status?.accounts || []).map((account) => {
            const progress = Math.min(Math.round((account.lastWeekViews / account.weeklyViewsGoal) * 100), 100);
            return (
              <Card key={account.id} className="border-zinc-800 bg-zinc-950/70">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-3 text-base text-white">
                    <span className={cn("flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br text-zinc-950", accountTone[account.category])}>
                      {account.category === "sports" ? <TrendingUp className="h-4 w-4" /> : account.category === "memes" ? <Flame className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{account.name}</span>
                    <Badge className={cn("border", statusBadge(account.status))}>{account.status}</Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="secondary" className="bg-white/10 text-zinc-200">{categoryLabels[account.category]}</Badge>
                    {account.platforms.map((platform) => (
                      <Badge key={platform} variant="outline" className="border-zinc-700 text-zinc-300">{platform}</Badge>
                    ))}
                  </div>
                  <div>
                    <div className="mb-2 flex justify-between text-xs text-zinc-500">
                      <span>{formatNumber(account.lastWeekViews)} views</span>
                      <span>{formatNumber(account.weeklyViewsGoal)} goal</span>
                    </div>
                    <Progress value={progress} className="bg-white/10 [&>div]:bg-amber-200" />
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div className="rounded-md border border-white/10 bg-black/35 p-3">
                      <p className="text-xs text-zinc-500">Diario</p>
                      <p className="font-semibold">{account.dailyClipTarget} clips</p>
                    </div>
                    <div className="rounded-md border border-white/10 bg-black/35 p-3">
                      <p className="text-xs text-zinc-500">Progreso</p>
                      <p className="font-semibold">{progress}%</p>
                    </div>
                  </div>
                  <p className="text-xs leading-5 text-zinc-500">{account.contentPolicy}</p>
                </CardContent>
              </Card>
            );
          })}
        </div>

        <div className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
          <Card className="border-zinc-800 bg-zinc-950/70">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base text-white">
                <Network className="h-4 w-4 text-cyan-200" />
                Agentes y subagentes
              </CardTitle>
            </CardHeader>
            <CardContent className={cn(tunnelStackClass, "space-y-3")}>
              {(status?.agents || []).map((agent) => (
                <div key={agent.id} className={tunnelBoxClass}>
                  <div className="flex items-center gap-2">
                    <Bot className="h-4 w-4 text-cyan-200" />
                    <p className="flex-1 font-medium">{agent.name}</p>
                    <Badge className={cn("border", statusBadge(agent.status))}>{agent.status}</Badge>
                  </div>
                  <p className="mt-2 text-sm text-zinc-400">{agent.job}</p>
                  <p className="mt-1 text-xs text-zinc-600">{agent.output}</p>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="border-zinc-800 bg-zinc-950/70">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base text-white">
                <BarChart3 className="h-4 w-4 text-amber-200" />
                Pipeline
              </CardTitle>
            </CardHeader>
            <CardContent className={cn(tunnelStackClass, "space-y-3")}>
              {(status?.pipeline || []).map((item) => (
                <div key={item.stage} className={cn(tunnelBoxClass, "grid gap-3 md:grid-cols-[1fr_100px_150px] md:items-center")}>
                  <div>
                    <p className="font-medium">{item.stage}</p>
                    <p className="text-xs text-zinc-500">{item.owner}</p>
                  </div>
                  <p className="text-2xl font-semibold text-white">{item.count}</p>
                  <Badge className={cn("w-fit border", statusBadge(item.status))}>{item.status}</Badge>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-4 xl:grid-cols-[0.85fr_1.15fr]">
          <Card className="border-zinc-800 bg-zinc-950/70">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base text-white">
                <UploadCloud className="h-4 w-4 text-emerald-200" />
                Fuentes
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {(status?.sources || []).map((source) => (
                <div key={source.id} className="rounded-md border border-white/10 bg-black/35 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-medium">{source.label}</p>
                    <Badge className={cn("border", statusBadge(source.status))}>{source.status}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-zinc-500">{source.type} · {source.freshness} · {source.rightsMode}</p>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="border-zinc-800 bg-zinc-950/70">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base text-white">
                <CalendarClock className="h-4 w-4 text-cyan-200" />
                Ultimo reporte
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {!report ? (
                <p className="text-sm text-zinc-500">Aun no hay reporte. Genera el primer plan diario.</p>
              ) : (
                <>
                  <div className="rounded-md border border-white/10 bg-black/35 p-3">
                    <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                      <div>
                        <p className="font-medium">{report.summary}</p>
                        <p className="mt-1 text-xs text-zinc-500">{formatDate(report.createdAt)} · {reportPublishMode} · {reportRiskTolerance}</p>
                      </div>
                      <Badge variant="outline" className="w-fit border-zinc-700 text-zinc-300">{reportPlannedClips.length} drafts</Badge>
                    </div>
                    <p className="mt-2 break-all text-xs text-zinc-600">{reportPath}</p>
                  </div>

                  <div className="grid gap-3 md:grid-cols-2">
                    {reportPlannedClips.slice(0, 6).map((clip, index) => {
                      const account = accountsById[clip.accountId];
                      return (
                        <div key={`${clip.accountId}-${index}`} className="rounded-md border border-white/10 bg-black/35 p-3">
                          <div className="flex items-center gap-2">
                            <Eye className="h-4 w-4 text-amber-200" />
                            <p className="min-w-0 flex-1 truncate font-medium">{clip.title}</p>
                          </div>
                          <p className="mt-1 text-xs text-zinc-500">{account?.name || clip.accountId} · {clip.publishWindow}</p>
                          <p className="mt-2 text-sm text-zinc-300">{clip.hook}</p>
                          <p className="mt-1 text-xs text-zinc-600">{clip.format}</p>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
