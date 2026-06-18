import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowRight,
  BarChart3,
  Bot,
  CalendarClock,
  CheckCircle2,
  Clapperboard,
  Copy,
  ExternalLink,
  Eye,
  Flame,
  Gauge,
  HardDrive,
  KeyRound,
  Loader2,
  Network,
  Play,
  Plus,
  Radar,
  RefreshCw,
  Rocket,
  FolderOpen,
  Search,
  Send,
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
type ClipperAnalyticsReportingPackStatus = "not_prepared" | "needs_data" | "ready";
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
type ClipperAccountSetupSessionStatus = "not_prepared" | "blocked" | "ready_to_create" | "in_progress" | "ready";
type ClipperAccountSetupSessionItemStatus = "blocked" | "ready_to_create" | "in_progress" | "ready";
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
type ClipperPlatformWarRoomStatus = "blocked" | "in_progress" | "ready";
type ClipperExternalLaunchDossierStatus = "not_prepared" | "blocked" | "in_progress" | "ready";
type ClipperAppReviewSubmissionPackStatus = "not_prepared" | "blocked" | "ready";
type ClipperOfficialPermissionMatrixStatus = "not_prepared" | "verified" | "needs_review";
type ClipperOfficialPermissionSourceStatus = "official_verified" | "official_login_required";
type ClipperPermissionSubmissionDossierStatus = "not_prepared" | "blocked" | "needs_login_recheck" | "ready_to_submit" | "ready";
type ClipperPublisherConnectorStatus = "not_prepared" | "blocked" | "partial" | "ready";
type ClipperPublisherExecutionStatus = "not_prepared" | "blocked" | "approval_required" | "ready";
type ClipperPublisherExecutionItemStatus = "blocked" | "queued_for_approval" | "ready_to_send";
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
type ClipperLocalDropSyncStatus = "not_run" | "completed" | "partial" | "blocked";
type ClipperLocalDropSyncItemStatus = "completed" | "skipped" | "failed";
type ClipperGoLivePrepSweepStatus = "not_run" | "completed" | "partial" | "blocked";
type ClipperGoLivePrepSweepItemStatus = "completed" | "skipped" | "failed";
type ClipperPostConnectActivationSweepStatus = "not_run" | "ready" | "needs_external_action" | "needs_local_input" | "blocked";
type ClipperIntakeRefreshSweepStatus = "not_run" | "ready" | "needs_external_action" | "needs_local_input" | "blocked";
type ClipperOwnerConnectPackStatus = "not_prepared" | "blocked" | "in_progress" | "ready";
type ClipperOwnerConnectPackLane = "account" | "developer_app" | "permission" | "credential" | "oauth" | "source_video" | "launch_evidence" | "official_recheck";
type ClipperOwnerConnectPackItemStatus = "ready_to_execute" | "blocked" | "waiting" | "done";
type ClipperDropzoneReadyPackStatus = "not_prepared" | "blocked" | "partial" | "ready";
type ClipperDropzoneReadyPackLane = "credentials" | "launch_evidence" | "source_videos";
type ClipperDropzoneReadyPackItemStatus = "missing" | "partial" | "ready";
type ClipperRobertNextActionsStatus = "not_prepared" | "blocked" | "needs_action" | "ready";
type ClipperRobertNextActionsLane = "local_drop" | "external_portal" | "evidence" | "source_supply" | "verification";
type ClipperLaunchEvidenceFixPackStatus = "not_prepared" | "needs_fix" | "ready";
type ClipperBlockerUnlockPhase = "credentials" | "accounts" | "public_url" | "developer_apps" | "permissions" | "oauth" | "content_supply" | "publishing" | "optimization";
type ClipperGoLiveExecutionPackStatus = "not_prepared" | "blocked" | "in_progress" | "ready";
type ClipperGoLiveExecutionPhaseStatus = "blocked" | "ready_to_execute" | "done";
type ClipperGoLiveCompletionAuditStatus = "blocked" | "partial" | "ready";
type ClipperGoLiveCompletionRequirementStatus = "blocked" | "needs_evidence" | "verified";
type ClipperGoLiveOperatorBriefStatus = "blocked" | "needs_action" | "ready";
type ClipperPlatformPortalChecklistStatus = "not_prepared" | "blocked" | "in_progress" | "ready";
type ClipperHttpsTunnelPlanStatus = "not_prepared" | "blocked" | "ready";
type ClipperLegalPolicyPackStatus = "not_prepared" | "blocked" | "ready";
type ClipperAppReviewDemoPackStatus = "not_prepared" | "blocked" | "ready";
type ClipperDeveloperApplicationDraftsStatus = "not_prepared" | "blocked" | "ready";
type ClipperSourceSupplyDropKitStatus = "not_prepared" | "blocked" | "partial" | "ready";

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
  rightsEvidencePath: string | null;
  manifestPath: string | null;
  reason: string | null;
}

interface ClipperSourceDropImportSummary {
  importedAt: string;
  dropDir: string;
  filesScanned: number;
  manifestFilesScanned: number;
  manifestRows: number;
  manifestMatched: number;
  rightsEvidenceWritten: number;
  imported: number;
  skipped: number;
  items: ClipperSourceDropImportItem[];
  queue: ClipperProductionQueueSummary;
  nextStep: string;
}

type ClipperSourceDropDiagnosticStatus = "ready_to_import" | "needs_files" | "needs_rights" | "ready";

interface ClipperSourceDropDiagnosticFile {
  relativePath: string;
  fileName: string;
  category: ClipperAccountCategory | null;
  location: "category_dir" | "root" | "unsupported_dir";
  isVideo: boolean;
  importEligible: boolean;
  targetFolder: string | null;
  rightsEvidencePath: string | null;
  manifestPath: string | null;
  manifestEvidenceReady: boolean;
  issue: string | null;
  nextStep: string;
}

interface ClipperSourceDropDiagnosticManifest {
  relativePath: string;
  fileName: string;
  category: ClipperAccountCategory | null;
  rows: number;
  readyRows: number;
  placeholderRows: number;
  expectedFiles: string[];
  missingFiles: string[];
  evidenceReadyRows: number;
  issue: string | null;
  nextStep: string;
}

interface ClipperSourceDropDiagnosticCategory {
  category: ClipperAccountCategory;
  label: string;
  dropPath: string;
  sourceFolder: string;
  dropFiles: number;
  importEligible: number;
  manifestReady: number;
  manifestFiles: number;
  manifestRows: number;
  manifestReadyRows: number;
  manifestPlaceholderRows: number;
  manifestMissingFiles: number;
  sourceAssets: number;
  rightsReadyAssets: number;
  minimumWeeklySourceAssets: number;
  missingSourceAssets: number;
  nextStep: string;
}

interface ClipperSourceDropDiagnosticSummary {
  status: ClipperSourceDropDiagnosticStatus;
  generatedAt: string | null;
  manifestPath: string;
  markdownPath: string;
  repairWorksheetCsvPath: string;
  dropDir: string;
  files: ClipperSourceDropDiagnosticFile[];
  manifests: ClipperSourceDropDiagnosticManifest[];
  categories: ClipperSourceDropDiagnosticCategory[];
  totals: {
    files: number;
    importEligible: number;
    manifestReady: number;
    manifestFiles: number;
    manifestRows: number;
    manifestReadyRows: number;
    manifestPlaceholderRows: number;
    manifestMissingFiles: number;
    unsupported: number;
    categoriesReady: number;
    minimumWeeklySourceAssets: number;
    currentSourceAssets: number;
    rightsReadyAssets: number;
    missingSourceAssets: number;
  };
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

interface ClipperSourceSupplyDropKitItem {
  id: string;
  rank: number;
  category: ClipperAccountCategory;
  label: string;
  priority: "critical" | "high" | "watch";
  targetFileName: string;
  sourceDropPath: string;
  targetSourcePath: string;
  platformHint: string;
  suggestedTitle: string;
  suggestedSource: string;
  sourceUrlPlaceholder: string;
  evidenceLinkPlaceholder: string;
  intakeBatchRow: string;
  trendCandidateBatchRow: string;
  rightsEvidenceBatchRow: string;
  requiredProof: string[];
  searchBrief: string[];
  viralSearchQueries: string[];
  viralScoreChecklist: string[];
  rejectIf: string[];
  doneCriteria: string[];
  nextStep: string;
}

interface ClipperSourceSupplyDropKitCategoryBatch {
  id: string;
  category: ClipperAccountCategory;
  label: string;
  priority: "critical" | "high" | "watch";
  items: number;
  sourceDropDir: string;
  sourceDropManifestPath: string;
  sourceDropReadmePath: string;
  sourceDropPaths: string[];
  targetSourcePaths: string[];
  intakeBatchRows: string[];
  trendCandidateBatchRows: string[];
  rightsEvidenceBatchRows: string[];
  intakeBatchTemplate: string;
  trendCandidateBatchTemplate: string;
  rightsEvidenceBatchTemplate: string;
  requiredProof: string[];
  viralSearchQueries: string[];
  checklist: string[];
  nextStep: string;
}

interface ClipperSourceSupplyDropKitSummary {
  status: ClipperSourceSupplyDropKitStatus;
  generatedAt: string | null;
  manifestPath: string;
  markdownPath: string;
  csvPath: string;
  sourceDropDir: string;
  items: ClipperSourceSupplyDropKitItem[];
  categoryBatches: ClipperSourceSupplyDropKitCategoryBatch[];
  totals: {
    items: number;
    critical: number;
    high: number;
    watch: number;
    categories: number;
    weeklyMissingSourceSlots: number;
    rightsReadyAssets: number;
    minimumWeeklySourceAssets: number;
  };
  intakeBatchTemplate: string;
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
  targetFileName: string;
  sourceDropPath: string;
  sourceDropManifestPath: string;
  sourceDropManifestRow: string;
  sourceFolder: string;
  sourcePath: string | null;
  rightsStatus: ClipperAssetRightsStatus | "missing";
  suggestedSearch: string;
  viralSearchQueries: string[];
  viralSearchUrls: string[];
  recencyWindow: string;
  minimumViralSignal: string;
  viralScoreChecklist: string[];
  rejectIf: string[];
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
    dailyTargetPosts: number;
    weeklyTargetClips: number;
    backlogPosts: number;
    gapToDailyTarget: number;
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
  handleCheckUrls: string[];
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
  handleCheckUrls: string[];
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
  handleCheckUrls: string[];
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
  handleCheckUrls: string[];
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

interface ClipperAccountCreationPlatformBatch {
  id: string;
  platform: ClipperPlatform;
  label: string;
  status: ClipperAccountCreationPackStatus;
  profiles: number;
  ready: number;
  partial: number;
  blocked: number;
  evidenceMissing: number;
  signupUrl: string;
  officialHelpUrl: string;
  handles: string[];
  accountIds: string[];
  copyBlock: string;
  evidenceBatchTemplate: string;
  submittedEvidenceRows: string[];
  verifiedEvidenceRows: string[];
  evidenceRecipeRows: string[];
  browserSessionChecklist: string[];
  operatorVaultChecklist: string[];
  requiredProof: string[];
  blockers: string[];
  doneCriteria: string[];
  nextStep: string;
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
  platformBatches: ClipperAccountCreationPlatformBatch[];
  evidenceBatchTemplate: string;
  totals: {
    profiles: number;
    ready: number;
    partial: number;
    blocked: number;
    evidenceMissing: number;
    platformBatches: number;
  };
  nextStep: string;
}

interface ClipperAccountSetupSessionItem {
  id: string;
  rank: number;
  accountId: string;
  accountName: string;
  platform: ClipperPlatform;
  handle: string;
  status: ClipperAccountSetupSessionItemStatus;
  priority: ClipperAccountCreationSessionPriority;
  signupUrl: string;
  profileLink: string;
  handleCheckUrls: string[];
  vaultItemName: string;
  loginIdentifierLabel: string;
  passwordVaultSlot: string;
  twoFactorSlot: string;
  recoverySlot: string;
  copyPackage: Array<{ label: string; value: string }>;
  portalFormFields: Array<{ field: string; value: string; note: string }>;
  claimSteps: string[];
  verificationSteps: string[];
  evidenceCapturePlan: string[];
  submittedEvidenceBatchRow: string;
  verifiedEvidenceBatchRow: string;
  evidenceRecipeRow: string;
  evidenceRows: string[];
  evidencePath: string | null;
  evidenceStatus: ClipperAccountEvidenceItemStatus | "missing";
  blockers: string[];
  doneCriteria: string[];
  nextStep: string;
}

interface ClipperAccountSetupSessionSummary {
  status: ClipperAccountSetupSessionStatus;
  generatedAt: string | null;
  manifestPath: string;
  markdownPath: string;
  csvPath: string;
  items: ClipperAccountSetupSessionItem[];
  sourceArtifacts: {
    accountCreationPackPath: string;
    accountClaimSheetPath: string;
    accountEvidenceConnectionKitPath: string;
    accountSetupEvidenceTemplatePath: string;
    ownerConnectPackPath: string;
  };
  totals: {
    accounts: number;
    blocked: number;
    readyToCreate: number;
    inProgress: number;
    ready: number;
    portalUrls: number;
    evidenceRows: number;
    vaultSlots: number;
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

interface ClipperAccountEvidenceQuickBatchRow {
  id: string;
  accountId: string;
  accountName: string;
  category: ClipperAccountCategory;
  platform: ClipperPlatform;
  handle: string;
  displayName: string;
  profileLink: string;
  signupUrl: string;
  developerPortalUrl: string;
  status: ClipperAccountEvidenceItemStatus | "missing";
  evidencePath: string | null;
  evidenceJsonPath: string;
  evidenceMarkdownPath: string;
  templatePath: string;
  batchRow: string;
  verifiedBatchRow: string;
  requiredProof: string[];
  operatorSteps: string[];
  doneCriteria: string;
  nextStep: string;
}

interface ClipperAccountEvidencePlatformBatch {
  id: string;
  platform: ClipperPlatform;
  label: string;
  status: ClipperAccountEvidenceStatus;
  accounts: number;
  verified: number;
  submitted: number;
  rejected: number;
  missing: number;
  signupUrl: string;
  developerPortalUrl: string;
  handles: string[];
  submittedEvidenceRows: string[];
  verifiedEvidenceRows: string[];
  submittedDropFilePath: string;
  verifiedDropFilePath: string;
  submittedTemplateFilePath: string;
  verifiedTemplateFilePath: string;
  submittedDropTemplate: string;
  verifiedDropTemplate: string;
  checklist: string[];
  nextStep: string;
}

interface ClipperAccountEvidenceSummary {
  status: ClipperAccountEvidenceStatus;
  evidenceDir: string;
  templateDir: string;
  readmePath: string;
  connectionKitManifestPath: string;
  connectionKitMarkdownPath: string;
  connectionKitCsvPath: string;
  connectionKitGeneratedAt: string | null;
  launchEvidenceDropDir: string;
  launchEvidenceTemplatePath: string;
  launchEvidenceTemplateRows: number;
  launchEvidenceDropChecklist: string[];
  quickBatchRows: ClipperAccountEvidenceQuickBatchRow[];
  connectionKitPlatformBatches: ClipperAccountEvidencePlatformBatch[];
  quickBatchTemplate: string;
  quickBatchChecklist: string[];
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

interface ClipperDeveloperAppConnectionKitItem {
  platform: ClipperPlatform;
  label: string;
  status: ClipperDeveloperAppEvidenceItemStatus | "missing";
  developerPortalUrl: string;
  docsUrl: string;
  appIdentifier: string | null;
  publicBaseUrl: string | null;
  redirectUri: string;
  requiredEnvVars: string[];
  configuredEnvVars: string[];
  missingEnvVars: string[];
  scopes: string[];
  evidencePath: string | null;
  templatePath: string;
  draftEvidenceRow: string;
  submittedEvidenceRow: string;
  approvedEvidenceRow: string;
  copyChecklist: string[];
  reviewerChecklist: string[];
  doneCriteria: string[];
  nextStep: string;
}

interface ClipperDeveloperAppConnectionKitPlatformBatch {
  id: string;
  platform: ClipperPlatform;
  label: string;
  status: ClipperDeveloperAppEvidenceItemStatus | "missing";
  developerPortalUrl: string;
  docsUrl: string;
  appIdentifier: string | null;
  publicBaseUrl: string | null;
  redirectUri: string;
  requiredEnvVars: string[];
  missingEnvVars: string[];
  scopes: string[];
  submittedEvidenceRow: string;
  approvedEvidenceRow: string;
  submittedDropFilePath: string;
  approvedDropFilePath: string;
  submittedTemplateFilePath: string;
  approvedTemplateFilePath: string;
  submittedDropTemplate: string;
  approvedDropTemplate: string;
  checklist: string[];
  nextStep: string;
}

interface ClipperDeveloperAppEvidenceSummary {
  status: ClipperDeveloperAppEvidenceStatus;
  evidenceDir: string;
  templateDir: string;
  readmePath: string;
  connectionKitManifestPath: string;
  connectionKitMarkdownPath: string;
  connectionKitCsvPath: string;
  connectionKitGeneratedAt: string | null;
  connectionKitItems: ClipperDeveloperAppConnectionKitItem[];
  connectionKitPlatformBatches: ClipperDeveloperAppConnectionKitPlatformBatch[];
  connectionKitTemplate: string;
  connectionKitChecklist: string[];
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
  kind: "google_oauth_json" | "credential_json" | "env_file" | "credential_text" | "unknown";
  suggestedImportTarget: string;
  supportedInputFormat: string;
  nextStep: string;
}

type ClipperCredentialDropDiagnosticStatus = "ready_to_import" | "needs_review" | "move_candidates_to_drop_dir" | "no_candidates";

interface ClipperCredentialDropDiagnosticFile {
  fileName: string;
  relativePath: string;
  kind: ClipperCredentialSetupFileScan["kind"];
  location: "drop_dir" | "workspace_root";
  importEligible: boolean;
  suggestedImportTarget: string;
  supportedInputFormat: string;
  detectedEnvVars: string[];
  pendingEnvVars: string[];
  issue: string | null;
  nextStep: string;
}

interface ClipperCredentialDropDiagnosticTemplateFile {
  fileName: string;
  relativePath: string;
  location: "drop_dir" | "workspace_root";
  nextStep: string;
}

interface ClipperCredentialDropDiagnosticSummary {
  status: ClipperCredentialDropDiagnosticStatus;
  generatedAt: string | null;
  manifestPath: string;
  markdownPath: string;
  dropDirs: string[];
  allowedEnvVars: string[];
  files: ClipperCredentialDropDiagnosticFile[];
  acceptedEnvVars: string[];
  rejectedEnvVars: string[];
  skippedLines: number;
  sourceFiles: string[];
  fileErrors: Array<{ relativePath: string; reason: string }>;
  ignoredTemplateFiles: ClipperCredentialDropDiagnosticTemplateFile[];
  totals: {
    files: number;
    dropCandidates: number;
    rootCandidates: number;
    importEligible: number;
    acceptedEnvVars: number;
    rejectedEnvVars: number;
    fileErrors: number;
    templateFiles: number;
    pendingEnvVars: number;
  };
  nextStep: string;
}

interface ClipperCredentialPastePackItem {
  id: string;
  label: string;
  platform: ClipperPlatform | "system";
  status: ClipperCredentialSetupStatus;
  importOrder: number;
  docsUrl: string;
  portalUrl: string | null;
  configuredEnvVars: string[];
  missingSuggestedEnvVars: string[];
  acceptedEnvVarGroups: string[][];
  localDropFileNames?: string[];
  envTemplate: string;
  verificationCommand: string;
  nextStep: string;
}

interface ClipperCredentialTransferKitItem {
  id: string;
  label: string;
  platform: ClipperPlatform | "system";
  status: ClipperCredentialSetupStatus;
  portalUrl: string | null;
  docsUrl: string;
  missingSuggestedEnvVars: string[];
  acceptedEnvVarGroups: string[][];
  driveSearchQueries: string[];
  driveSearchUrls: string[];
  localDropFileNames: string[];
  envTemplate: string;
  importSteps: string[];
  verificationSteps: string[];
  nextStep: string;
}

type ClipperCredentialDropStarterStatus = "not_prepared" | "prepared" | "ready";
type ClipperCredentialDropStarterFileStatus = "missing" | "created" | "exists" | "not_needed";

interface ClipperCredentialDropStarterFile {
  id: string;
  label: string;
  relativePath: string;
  absolutePath: string;
  status: ClipperCredentialDropStarterFileStatus;
  envVars: string[];
  sourceItemIds: string[];
  nextStep: string;
}

interface ClipperCredentialDropStarterSummary {
  status: ClipperCredentialDropStarterStatus;
  generatedAt: string | null;
  manifestPath: string;
  markdownPath: string;
  files: ClipperCredentialDropStarterFile[];
  totals: {
    files: number;
    created: number;
    existing: number;
    missing: number;
    notNeeded: number;
    envVars: number;
  };
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
  credentialDropDiagnosticPath: string;
  credentialDropDiagnosticMarkdownPath: string;
  credentialDropDiagnosticGeneratedAt: string | null;
  credentialDropDiagnostic: ClipperCredentialDropDiagnosticSummary;
  items: ClipperCredentialSetupItem[];
  importPlan: ClipperCredentialImportPlanItem[];
  credentialPastePack: ClipperCredentialPastePackItem[];
  credentialPasteTemplate: string;
  credentialPasteChecklist: string[];
  credentialTransferKitManifestPath: string;
  credentialTransferKitMarkdownPath: string;
  credentialTransferKitEnvPath: string;
  credentialTransferKitGeneratedAt: string | null;
  credentialTransferKitItems: ClipperCredentialTransferKitItem[];
  credentialTransferTemplate: string;
  credentialTransferChecklist: string[];
  credentialDropStarterPath: string;
  credentialDropStarterMarkdownPath: string;
  credentialDropStarterGeneratedAt: string | null;
  credentialDropStarter: ClipperCredentialDropStarterSummary;
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
  strictImport?: boolean;
  strictBlocked?: boolean;
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

type ClipperLaunchEvidenceDropDiagnosticStatus = "empty" | "needs_values" | "needs_review" | "ready_to_import";

interface ClipperLaunchEvidenceDropDiagnosticRow {
  sourceFile: string;
  index: number;
  kind: string;
  identifier: string | null;
  platform: ClipperPlatform | null;
  scope: string | null;
  appIdentifier: string | null;
  status: "ready" | "pending_values" | "rejected";
  pendingFields: string[];
  issue: string | null;
  nextStep: string;
}

interface ClipperLaunchEvidenceDropDiagnosticFile {
  relativePath: string;
  rows: number;
  readyRows: number;
  pendingRows: number;
  rejectedRows: number;
  kinds: Record<string, number>;
  issue: string | null;
  nextStep: string;
}

interface ClipperLaunchEvidenceDropDiagnosticSummary {
  status: ClipperLaunchEvidenceDropDiagnosticStatus;
  generatedAt: string | null;
  manifestPath: string;
  markdownPath: string;
  repairWorksheetCsvPath: string;
  dropDir: string;
  files: ClipperLaunchEvidenceDropDiagnosticFile[];
  rows: ClipperLaunchEvidenceDropDiagnosticRow[];
  fileErrors: Array<{ relativePath: string; reason: string }>;
  totals: {
    files: number;
    rows: number;
    readyRows: number;
    pendingRows: number;
    rejectedRows: number;
    fileErrors: number;
    accountRows: number;
    developerAppRows: number;
    permissionRows: number;
    sourceRightsRows: number;
  };
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
  dropTarget: string;
  portalUrl: string;
  dropFileExists: boolean;
  dropFileEnvVars: string[];
  dropFileReadyEnvVars: string[];
  dropFilePendingEnvVars: string[];
  dropFileStatus: "missing" | "empty" | "pending_values" | "ready";
  dropFileNextStep: string;
  nextStep: string;
}

interface ClipperCredentialDoctorSummary {
  status: ClipperCredentialDoctorStatus;
  generatedAt: string | null;
  manifestPath: string;
  markdownPath: string;
  repairWorksheetCsvPath: string;
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

interface ClipperExternalExecutionPortalBatch {
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

interface ClipperExternalExecutionFocusRunItem {
  id: string;
  rank: number;
  sourceItemId: string;
  platform: ClipperPlatform;
  type: ClipperExternalSetupQueueItemType;
  label: string;
  actionMode: ClipperExternalExecutionSessionItem["actionMode"];
  estimatedMinutes: number;
  portalUrl: string;
  executionUrl: string;
  evidenceRow: string;
  credentialTemplate: string;
  checklist: string[];
  doneCriteria: string[];
  nextStep: string;
}

interface ClipperExternalExecutionFocusRun {
  status: "ready" | "empty";
  label: string;
  estimatedMinutes: number;
  items: ClipperExternalExecutionFocusRunItem[];
  evidenceRows: string[];
  credentialTemplates: string[];
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
  portalBatches: ClipperExternalExecutionPortalBatch[];
  focusRun: ClipperExternalExecutionFocusRun;
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

interface ClipperPlatformWarRoomItem {
  platform: ClipperPlatform;
  label: string;
  status: ClipperPlatformWarRoomStatus;
  accountTasks: number;
  accountsVerified: number;
  developerAppStatus: ClipperDeveloperAppEvidenceItemStatus | "missing";
  permissionsApproved: number;
  permissionsRequested: number;
  permissionsTotal: number;
  credentialStatus: ClipperReadinessStatus;
  oauthStatus: ClipperConnectActionStatus;
  tokenSaved: boolean;
  portalUrls: string[];
  executionUrls: string[];
  evidenceRows: string[];
  credentialTemplates: string[];
  accountEvidenceRows: string[];
  permissionEvidenceRows: string[];
  missingEnvVars: string[];
  blockers: string[];
  operatorSteps: string[];
  connectionChecklist: string[];
  evidenceChecklist: string[];
  safetyRules: string[];
  afterConnectionSteps: string[];
  doneCriteria: string[];
  nextStep: string;
}

interface ClipperPlatformAccountConnectionRow {
  id: string;
  accountId: string;
  accountName: string;
  category: ClipperAccountCategory;
  platform: ClipperPlatform;
  handle: string;
  profileLink: string;
  accountCreationUrl: string;
  developerPortalUrl: string;
  status: ClipperAccountLaunchTaskStatus;
  evidenceStatus: ClipperAccountEvidenceItemStatus | "missing";
  evidencePath: string | null;
  accountEvidenceRow: string;
  proofRequirements: string[];
  checklist: string[];
  postConnectActions: string[];
  blockers: string[];
  nextStep: string;
}

interface ClipperPlatformPermissionApprovalRow {
  id: string;
  platform: ClipperPlatform;
  scope: string;
  label: string;
  status: ClipperPermissionTrackerItemStatus;
  requestReadiness: ClipperPermissionRequestReadiness | "missing";
  developerPortalUrl: string;
  docsUrl: string;
  officialReferenceUrl: string;
  evidenceBatchRow: string;
  evidenceRecipeRow: string;
  requestedEvidenceRow: string;
  approvedEvidenceRow: string;
  proofRequirements: string[];
  portalSteps: string[];
  reviewerEvidence: string[];
  blockers: string[];
  nextStep: string;
}

interface ClipperPlatformWarRoomSummary {
  status: ClipperPlatformWarRoomStatus;
  manifestPath: string;
  markdownPath: string;
  items: ClipperPlatformWarRoomItem[];
  accountConnectionRows: ClipperPlatformAccountConnectionRow[];
  permissionApprovalRows: ClipperPlatformPermissionApprovalRow[];
  totals: {
    platforms: number;
    ready: number;
    inProgress: number;
    blocked: number;
    accountConnections: number;
    accountConnectionsReady: number;
    accountConnectionsPending: number;
    accountConnectionsBlocked: number;
    permissionApprovals: number;
    permissionApprovalsApproved: number;
    permissionApprovalsRequested: number;
    permissionApprovalsBlocked: number;
    accountEvidenceRows: number;
    permissionEvidenceRows: number;
    credentialTemplates: number;
  };
  nextStep: string;
}

interface ClipperGoLiveEvidenceBundleSection {
  id: "account_connections" | "developer_apps" | "permission_requests" | "approval_rows";
  label: string;
  rows: string[];
  count: number;
  checklist: string[];
  nextStep: string;
}

interface ClipperGoLiveEvidenceBundleSummary {
  status: "not_prepared" | "ready";
  generatedAt: string | null;
  manifestPath: string;
  markdownPath: string;
  csvPath: string;
  importTemplate: string;
  starterRows: string[];
  approvalRows: string[];
  sections: ClipperGoLiveEvidenceBundleSection[];
  totals: {
    rows: number;
    starterRows: number;
    approvalRows: number;
    accountRows: number;
    developerAppRows: number;
    permissionRows: number;
  };
  checklist: string[];
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

interface ClipperGoLiveAutopilotAgentSession {
  id: string;
  agentId: string;
  subAgentName: string;
  owner: string;
  status: ClipperGoLiveAutopilotBriefStatus;
  actionIds: string[];
  actionCount: number;
  inAppReady: number;
  externalRequired: number;
  waiting: number;
  blocked: number;
  platforms: Array<ClipperPlatform | "system">;
  portalUrls: string[];
  localActionUrls: string[];
  evidenceRows: string[];
  riskControls: string[];
  firstActionRank: number;
  mission: string;
  nextStep: string;
}

interface ClipperGoLiveAutopilotBriefSummary {
  status: ClipperGoLiveAutopilotBriefStatus;
  generatedAt: string | null;
  manifestPath: string;
  markdownPath: string;
  csvPath: string;
  actions: ClipperGoLiveAutopilotAction[];
  agentSessions: ClipperGoLiveAutopilotAgentSession[];
  totals: {
    actions: number;
    inAppReady: number;
    externalRequired: number;
    waiting: number;
    done: number;
    blocked: number;
    platformsCovered: number;
    agentSessions: number;
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
  resetCompleted: boolean;
  availableInAppActions: number;
  alreadyCompletedInAppActions: number;
  remainingInAppActions: number;
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

interface ClipperLocalDropSyncItem {
  id: "credential_drop" | "permission_template_drop" | "launch_evidence_drop" | "source_drop" | "state_refresh";
  label: string;
  status: ClipperLocalDropSyncItemStatus;
  startedAt: string;
  finishedAt: string;
  message: string;
}

interface ClipperLocalDropSyncMissingInput {
  id: "credentials" | "launch_evidence" | "source_videos";
  label: string;
  status: "ready" | "needed";
  dropDirs: string[];
  acceptedFormats: string[];
  requiredExamples: string[];
  actionLabel: string;
  actionUrl: string;
  nextStep: string;
}

interface ClipperLocalDropSyncLaunchEvidenceDrop {
  accepted: ClipperLaunchEvidenceBatchSummary["accepted"];
  rejected: ClipperLaunchEvidenceBatchSummary["rejected"];
  sourceFiles: string[];
  fileErrors: NonNullable<ClipperLaunchEvidenceBatchSummary["fileErrors"]>;
  nextStep: string;
}

interface ClipperLocalDropSyncSummary {
  status: ClipperLocalDropSyncStatus;
  generatedAt: string | null;
  manifestPath: string;
  markdownPath: string;
  items: ClipperLocalDropSyncItem[];
  missingInputs: ClipperLocalDropSyncMissingInput[];
  launchEvidenceDrop: ClipperLocalDropSyncLaunchEvidenceDrop | null;
  totals: {
    attempted: number;
    completed: number;
    skipped: number;
    failed: number;
  };
  nextStep: string;
}

interface ClipperGoLivePrepSweepItem {
  id: string;
  label: string;
  status: ClipperGoLivePrepSweepItemStatus;
  startedAt: string;
  finishedAt: string;
  message: string;
}

interface ClipperGoLivePrepSweepSummary {
  status: ClipperGoLivePrepSweepStatus;
  generatedAt: string | null;
  manifestPath: string;
  markdownPath: string;
  items: ClipperGoLivePrepSweepItem[];
  localDropSync: ClipperLocalDropSyncSummary | null;
  totals: {
    attempted: number;
    completed: number;
    skipped: number;
    failed: number;
  };
  nextStep: string;
}

interface ClipperPostConnectActivationSweepSummary {
  status: ClipperPostConnectActivationSweepStatus;
  generatedAt: string | null;
  manifestPath: string;
  markdownPath: string;
  prepSweepStatus: ClipperGoLivePrepSweepStatus;
  localDropSyncStatus: ClipperLocalDropSyncStatus | "not_run";
  readyToPublish: boolean;
  totalLanes: number;
  readyLanes: number;
  activationReadyLanes: number;
  waitingLanes: number;
  blockedLanes: number;
  nextLane: NonNullable<ClipperRobertConnectNowHandoff["postConnectActivationBridge"]>[number] | null;
  nextLocalActions: string[];
  blockers: string[];
  artifactPaths: {
    prepSweep: string;
    robertNextActions: string;
    connectNow: string;
    launcher: string;
    completionAudit: string;
    localDropSync: string | null;
  };
  launcherUrl: string;
  nextStep: string;
}

interface ClipperIntakeRefreshSweepSummary {
  status: ClipperIntakeRefreshSweepStatus;
  generatedAt: string | null;
  manifestPath: string;
  markdownPath: string;
  prepSweepStatus: ClipperGoLivePrepSweepStatus;
  localDropSyncStatus: ClipperLocalDropSyncStatus | "not_run";
  postConnectStatus: ClipperPostConnectActivationSweepStatus;
  readyToPublish: boolean;
  intakeConsole: NonNullable<ClipperRobertConnectNowHandoff["intakeConsole"]>;
  refreshSequence: string[];
  completedSteps: string[];
  skippedOrBlockedSteps: string[];
  blockers: string[];
  artifactPaths: {
    localDropSync: string | null;
    prepSweep: string;
    postConnectActivation: string;
    robertNextActions: string;
    connectNow: string;
    launcher: string;
    intakeRefresh: string;
  };
  nextStep: string;
}

interface ClipperOwnerConnectPackItem {
  id: string;
  rank: number;
  lane: ClipperOwnerConnectPackLane;
  platform: ClipperPlatform | "system";
  label: string;
  status: ClipperOwnerConnectPackItemStatus;
  owner: string;
  portalUrl: string | null;
  executionUrl: string | null;
  artifactPath: string | null;
  dropDirs: string[];
  evidenceRows: string[];
  credentialTemplate: string | null;
  checklist: string[];
  blockers: string[];
  doneCriteria: string[];
  progressStatus: ClipperOwnerConnectPackItemStatus | null;
  progressNotes: string | null;
  progressRecordedAt: string | null;
  progressEvidenceRows: string[];
  nextStep: string;
}

interface ClipperOwnerConnectProgressRecord {
  itemId: string;
  status: ClipperOwnerConnectPackItemStatus;
  notes: string;
  evidenceRows: string[];
  recordedAt: string;
  source: "clippers-ui";
}

interface ClipperOwnerConnectPackSummary {
  status: ClipperOwnerConnectPackStatus;
  generatedAt: string | null;
  manifestPath: string;
  markdownPath: string;
  csvPath: string;
  progressRecordsPath: string;
  items: ClipperOwnerConnectPackItem[];
  progressRecords: ClipperOwnerConnectProgressRecord[];
  sourceArtifacts: {
    accountCreationPackPath: string;
    developerApplicationDraftsPath: string;
    permissionRequestPackPath: string;
    externalExecutionSessionPath: string;
    officialPermissionMatrixPath: string;
    localDropSyncPath: string;
    ownerConnectEvidenceDropPath: string;
  };
  totals: {
    items: number;
    readyToExecute: number;
    blocked: number;
    waiting: number;
    done: number;
    portalUrls: number;
    evidenceRows: number;
    credentialTemplates: number;
    dropDirs: number;
    progressRecords: number;
    progressDone: number;
  };
  nextStep: string;
}

interface ClipperGoLiveCompletionRequirement {
  id: string;
  label: string;
  phase: ClipperBlockerUnlockPhase | "go_live";
  status: ClipperGoLiveCompletionRequirementStatus;
  owner: string;
  requiredEvidence: string[];
  currentEvidence: string;
  proofSource: string;
  actionUrl: string | null;
  portalUrl: string | null;
  blockers: string[];
  nextStep: string;
}

interface ClipperGoLiveCompletionExternalSessionItem {
  id: string;
  rank: number;
  requirementId: string;
  label: string;
  phase: ClipperBlockerUnlockPhase | "go_live";
  status: ClipperGoLiveCompletionRequirementStatus;
  owner: string;
  lane: "external_portal" | "evidence_upload" | "verification" | "done";
  portalUrls: string[];
  actionUrl: string | null;
  artifactPath: string;
  evidenceDropFileName: string;
  evidenceDropPath: string;
  evidenceCaptureTemplate: string;
  evidenceRows: string[];
  requiredEvidence: string[];
  blockers: string[];
  operatorSteps: string[];
  doneCriteria: string[];
  verificationCommand: string;
  nextStep: string;
}

interface ClipperGoLiveCompletionAuditSummary {
  status: ClipperGoLiveCompletionAuditStatus;
  generatedAt: string | null;
  manifestPath: string;
  markdownPath: string;
  externalSessionCsvPath: string;
  readyToPublish: boolean;
  score: number;
  requirements: ClipperGoLiveCompletionRequirement[];
  externalSession: ClipperGoLiveCompletionExternalSessionItem[];
  totals: {
    requirements: number;
    verified: number;
    needsEvidence: number;
    blocked: number;
    externalRequired: number;
    externalSessionItems: number;
    externalSessionPortalUrls: number;
    externalSessionEvidenceRows: number;
  };
  nextStep: string;
}

interface ClipperGoLiveOperatorBriefLane {
  id: "accounts" | "credentials" | "public_url" | "content_supply" | "oauth_publish";
  label: string;
  status: ClipperGoLiveOperatorBriefStatus;
  owner: string;
  priority: "critical" | "high" | "medium";
  done: number;
  total: number;
  artifactPath: string;
  actionUrl: string | null;
  portalUrls: string[];
  evidenceRows: string[];
  blockers: string[];
  checklist: string[];
  nextStep: string;
}

interface ClipperGoLiveOperatorBriefSummary {
  status: ClipperGoLiveOperatorBriefStatus;
  generatedAt: string | null;
  manifestPath: string;
  markdownPath: string;
  currentFocus: string;
  lanes: ClipperGoLiveOperatorBriefLane[];
  totals: {
    lanes: number;
    ready: number;
    needsAction: number;
    blocked: number;
    portalUrls: number;
    evidenceRows: number;
    accountConnectionsReady: number;
    accountConnectionsTotal: number;
    credentialFiles: number;
    sourceAssetsMissing: number;
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
    portalProduct: string;
    requestMode: "request_now" | "human_login_recheck";
    ownerAction: string;
    humanBlocker: string | null;
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
  publicLaunchBlockers?: string[];
  minimumApprovalEvidence?: string[];
  apiEndpointHint: string;
  nextStep: string;
}

interface ClipperOfficialPermissionSourceBatch {
  id: string;
  platform: ClipperPlatform;
  label: string;
  sourceStatus: ClipperOfficialPermissionSourceStatus;
  accessMode: "public" | "login_required";
  scopes: string[];
  officialUrls: string[];
  canonicalUrls: string[];
  verifiedClaims: string[];
  blocker: string | null;
  submitDecision: "request_now" | "human_login_recheck";
  launchEvidenceRows: string[];
  approvalEvidenceRows: string[];
  reviewerEvidence: string[];
  recheckSteps: string[];
  nextStep: string;
}

interface ClipperOfficialPermissionWebProof {
  platform: ClipperPlatform;
  sourceStatus: ClipperOfficialPermissionSourceStatus;
  checkedAt: string;
  accessMode: "public" | "login_required";
  officialUrls: string[];
  verifiedClaims: string[];
  reviewerEvidence: string[];
  nextHumanAction: string;
}

interface ClipperOfficialPermissionMatrixSummary {
  status: ClipperOfficialPermissionMatrixStatus;
  generatedAt: string | null;
  manifestPath: string;
  markdownPath: string;
  csvPath: string;
  verifiedAt: string;
  items: ClipperOfficialPermissionMatrixItem[];
  sourceBatches: ClipperOfficialPermissionSourceBatch[];
  webProofTrail: ClipperOfficialPermissionWebProof[];
  totals: {
    platforms: number;
    officialVerified: number;
    loginRequired: number;
    scopes: number;
    appReviewRequired: number;
    sourceBatches: number;
  };
  nextStep: string;
}

interface ClipperPermissionSubmissionDossierItem {
  id: string;
  platform: ClipperPlatform;
  label: string;
  status: ClipperPermissionSubmissionDossierStatus;
  sourceStatus: ClipperOfficialPermissionSourceStatus;
  submitDecision: "request_now" | "human_login_recheck";
  accessMode: "public" | "login_required";
  developerPortalUrl: string;
  scopes: string[];
  officialUrls: string[];
  verifiedClaims: string[];
  copyBlock: string;
  requestedTemplateFilePath: string;
  approvedTemplateFilePath: string;
  requestedDropFilePath: string;
  approvedDropFilePath: string;
  requestedDropTemplate: string;
  approvedDropTemplate: string;
  requestedEvidenceRows: string[];
  approvedEvidenceRows: string[];
  reviewerEvidence: string[];
  blockers: string[];
  submissionSteps: string[];
  doneCriteria: string[];
  nextStep: string;
}

interface ClipperPermissionSubmissionDossierSummary {
  status: ClipperPermissionSubmissionDossierStatus;
  generatedAt: string | null;
  manifestPath: string;
  markdownPath: string;
  csvPath: string;
  items: ClipperPermissionSubmissionDossierItem[];
  sourceArtifacts: {
    permissionRequestPackPath: string;
    officialPermissionMatrixPath: string;
    developerApplicationDraftsPath: string;
    goLiveEvidenceBundlePath: string;
  };
  totals: {
    platforms: number;
    blocked: number;
    needsLoginRecheck: number;
    readyToSubmit: number;
    ready: number;
    scopes: number;
    requestedRows: number;
    approvedRows: number;
    officialUrls: number;
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

interface ClipperPublisherExecutionQueueItem {
  id: string;
  postId: string;
  queueItemId: string;
  accountId: string;
  accountName: string;
  platform: ClipperPlatform;
  status: ClipperPublisherExecutionItemStatus;
  approvalRequired: boolean;
  canSendNow: boolean;
  publishAt: string;
  endpoint: string;
  method: "POST";
  mode: ClipperPublisherConnectorItem["mode"];
  sourcePath: string | null;
  hook: string;
  captionSeed: string;
  requestSpec: {
    headers: string[];
    payloadFields: string[];
    mediaSource: string;
    tokenSource: "encrypted_vault" | "missing";
  };
  gates: Array<{
    id: string;
    label: string;
    done: boolean;
    evidence: string;
  }>;
  blockers: string[];
  nextStep: string;
}

interface ClipperPublisherExecutionQueueSummary {
  status: ClipperPublisherExecutionStatus;
  generatedAt: string | null;
  manifestPath: string;
  markdownPath: string;
  csvPath: string;
  sourceAutomationRunId: string | null;
  publishMode: ClipperReport["publishMode"];
  realPublishEnabled: boolean;
  items: ClipperPublisherExecutionQueueItem[];
  totals: {
    items: number;
    blocked: number;
    queuedForApproval: number;
    readyToSend: number;
    approvalRequired: number;
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

interface ClipperDropzoneReadyPackItem {
  id: string;
  rank: number;
  lane: ClipperDropzoneReadyPackLane;
  label: string;
  status: ClipperDropzoneReadyPackItemStatus;
  priority: "critical" | "high" | "medium";
  dropDirs: string[];
  acceptedFormats: string[];
  expectedFiles: string[];
  copyReadyTemplate: string;
  sourceArtifactPath: string | null;
  localActionUrl: string;
  actionLabel: string;
  blockers: string[];
  unlocks: string[];
  nextStep: string;
}

interface ClipperDropzoneReadyPackSummary {
  status: ClipperDropzoneReadyPackStatus;
  generatedAt: string | null;
  manifestPath: string;
  markdownPath: string;
  csvPath: string;
  items: ClipperDropzoneReadyPackItem[];
  sourceArtifacts: {
    localDropSyncPath: string;
    credentialSetupPath: string;
    credentialTransferKitPath: string;
    goLiveEvidenceBundlePath: string;
    ownerConnectPackPath: string;
    sourceSupplyDropKitPath: string;
  };
  totals: {
    items: number;
    ready: number;
    partial: number;
    missing: number;
    critical: number;
    dropDirs: number;
    expectedFiles: number;
  };
  nextStep: string;
}

interface ClipperRobertNextActionItem {
  id: string;
  rank: number;
  lane: ClipperRobertNextActionsLane;
  label: string;
  status: "blocked" | "ready_to_execute" | "waiting" | "done";
  priority: "critical" | "high" | "medium";
  estimatedMinutes: number;
  platform: ClipperPlatform | "system" | "mixed";
  actionUrl: string | null;
  artifactPath: string | null;
  portalUrl: string | null;
  dropDirs: string[];
  evidenceRows: string[];
  operatorSteps: string[];
  blockers: string[];
  doneCriteria: string[];
  nextStep: string;
}

interface ClipperRobertConnectionTunnelGate {
  id: string;
  rank: number;
  label: string;
  status: "blocked" | "ready_to_execute" | "waiting" | "done";
  done: number;
  total: number;
  blockers: number;
  actionLabel: string;
  actionUrl: string | null;
  artifactPath: string | null;
  nextStep: string;
  unlocks: string[];
}

interface ClipperRobertOfficialPermissionCloseoutQueue {
  status: ClipperOfficialPermissionMatrixStatus;
  matrixPath: string;
  csvPath: string;
  verifiedAt: string;
  totals: {
    platforms: number;
    scopes: number;
    appReviewRequired: number;
    officialVerified: number;
    loginRequired: number;
    sourceBatches: number;
  };
  nextRows: string[];
  approvalRows: string[];
  sourceBatches: Array<{
    id: string;
    platform: ClipperPlatform;
    label: string;
    sourceStatus: ClipperOfficialPermissionSourceStatus;
    accessMode: "public" | "login_required";
    submitDecision: "request_now" | "human_login_recheck";
    scopes: string[];
    officialUrls: string[];
    verifiedClaims: string[];
    reviewerEvidence: string[];
    blocker: string | null;
    nextStep: string;
  }>;
  webProofTrail: Array<{
    platform: ClipperPlatform;
    accessMode: "public" | "login_required";
    officialUrls: string[];
    verifiedClaims: string[];
    nextHumanAction: string;
  }>;
  nextStep: string;
}

interface ClipperRobertConnectNowHandoff {
  markdownPath: string;
  focusRun: ClipperExternalExecutionFocusRun;
  evidenceCloseout?: ClipperRobertEvidenceCloseoutQueue;
  credentialCloseout?: ClipperRobertCredentialCloseoutQueue;
  sourceCloseout?: ClipperRobertSourceCloseoutQueue;
  accountCloseout?: ClipperRobertAccountCloseoutQueue;
  officialPermissionCloseout?: ClipperRobertOfficialPermissionCloseoutQueue;
  connectionTunnel?: {
    status: "blocked" | "ready_to_execute" | "waiting" | "done";
    progress: number;
    blockedGates: number;
    readyGates: number;
    doneGates: number;
    gates: ClipperRobertConnectionTunnelGate[];
    nextGate: ClipperRobertConnectionTunnelGate | null;
    nextStep: string;
  };
  ownershipSplit?: {
    robertReady: Array<{
      label: string;
      count: number;
      nextStep: string;
    }>;
    userRequired: Array<{
      label: string;
      count: number;
      nextStep: string;
    }>;
    automationUnlockedBy: string[];
    nextRobertAction: string;
    nextUserAction: string;
  };
  weeklyRunway?: {
    status: "blocked" | "needs_sources" | "needs_connections" | "ready";
    targetWeeklyClips: number;
    targetDailyClips: number;
    configuredDailyClipTarget: number;
    plannedDailyClips: number;
    accountCount: number;
    platformAccountCount: number;
    weeklyReadySlots: number;
    weeklyMissingSlots: number;
    rightsReadyAssets: number;
    minimumWeeklySourceAssets: number;
    sourceAssetGap: number;
    blockedGates: number;
    readyToPublish: boolean;
    nextStep: string;
    categories: Array<{
      category: ClipperAccountCategory;
      label: string;
      accountCount: number;
      dailyTarget: number;
      weeklyTargetSlots: number;
      rightsReadyAssets: number;
      minimumWeeklySourceAssets: number;
      sourceAssetGap: number;
      nextStep: string;
    }>;
  };
  platformLaunchBridge?: Array<{
    platform: ClipperPlatform;
    label: string;
    status: "blocked" | "ready_to_execute" | "waiting" | "done";
    accountType: string;
    accountCreationUrl: string;
    developerPortalUrl: string;
    docsUrls: string[];
    handles: string[];
    scopes: string[];
    missingEnvVars: string[];
    accountProofCount: number;
    appPermissionCount: number;
    oauthCount: number;
    evidenceRows: string[];
    portalUrls: Array<{
      label: string;
      url: string;
    }>;
    blockers: string[];
    doneCriteria: string[];
    nextStep: string;
  }>;
  externalPortalLauncher?: {
    htmlPath: string;
    url: string;
    totalPortals: number;
    doNow: number;
    blocked: number;
    accountTasks: number;
    developerAppTasks: number;
    permissionTasks: number;
    oauthTasks: number;
    credentialTasks: number;
    nextStep: string;
  };
  intakeConsole?: {
    status: ClipperDropzoneReadyPackStatus;
    nextStep: string;
    refreshSequence: string[];
    totals: {
      lanes: number;
      ready: number;
      partial: number;
      missing: number;
      critical: number;
      blockers: number;
      dropDirs: number;
      expectedFiles: number;
    };
    lanes: Array<{
      id: string;
      rank: number;
      lane: ClipperDropzoneReadyPackLane;
      label: string;
      status: ClipperDropzoneReadyPackItemStatus;
      priority: "critical" | "high" | "medium";
      actionLabel: string;
      actionUrl: string;
      artifactPath: string | null;
      dropDirs: string[];
      acceptedFormats: string[];
      expectedFilesCount: number;
      sampleExpectedFiles: string[];
      blockers: string[];
      unlocks: string[];
      nextStep: string;
    }>;
  };
  postConnectActivationBridge?: Array<{
    id: string;
    accountId: string;
    accountName: string;
    platform: ClipperPlatform;
    label: string;
    handle: string;
    status: "blocked" | "waiting" | "activation_ready" | "ready";
    activationScore: number;
    accountProofStatus: ClipperAccountEvidenceItemStatus | "missing";
    developerAppStatus: ClipperDeveloperAppEvidenceItemStatus | "missing";
    permissionsApproved: number;
    permissionsTotal: number;
    tokenSaved: boolean;
    tokenSavedAt: string | null;
    oauthStatus: ClipperOAuthConnectionStatus | "token_saved" | "missing";
    publisherConnectorStatus: ClipperPublisherConnectorStatus;
    publishGate: "blocked" | "dry_run_ready" | "approval_required_ready";
    readyQueueItems: number;
    blockedQueueItems: number;
    blockers: string[];
    nextLocalActions: string[];
    nextStep: string;
  }>;
  recommendedOrder: string[];
  pendingCredentialEnvVars: string[];
  credentialTemplate: string;
  credentialDropDirs: string[];
  credentialCandidateFiles: string[];
  evidenceTemplatePath: string;
  evidenceImportPath: string;
  launchEvidenceTemplate: string;
  sourceDropDirs: string[];
  sourceIntakeTemplate: string;
  sourceAssetsRequired: number;
  accountHandles: Array<{
    accountId: string;
    accountName: string;
    platform: ClipperPlatform;
    handle: string;
  }>;
  portalUrls: Array<{
    label: string;
    url: string;
  }>;
  publicUrls: Array<{
    label: string;
    url: string;
  }>;
  blockers: Array<{
    label: string;
    count: number;
    nextStep: string;
  }>;
}

interface ClipperRobertNextActionsSummary {
  status: ClipperRobertNextActionsStatus;
  generatedAt: string | null;
  manifestPath: string;
  markdownPath: string;
  csvPath: string;
  connectNow: ClipperRobertConnectNowHandoff;
  items: ClipperRobertNextActionItem[];
  sourceArtifacts: {
    commandCenterPath: string;
    ownerConnectPackPath: string;
    dropzoneReadyPackPath: string;
    goLiveCompletionAuditPath: string;
    externalExecutionSessionPath: string;
    sourceSupplyDropKitPath: string;
  };
  totals: {
    actions: number;
    critical: number;
    high: number;
    localDrop: number;
    externalPortal: number;
    evidence: number;
    sourceSupply: number;
    verification: number;
    estimatedMinutes: number;
  };
  nextStep: string;
}

interface ClipperLaunchEvidenceFixPackItem {
  id: string;
  rank: number;
  rowIndex: number;
  evidenceSource: "drop_rejected" | "current_state_gap";
  kind: string;
  identifier: string | null;
  reason: string;
  fixCategory: "account_proof" | "developer_app" | "permission_proof" | "public_url" | "source_rights" | "format";
  requiredFix: string;
  suggestedNotes: string;
  suggestedReplacementRow: string;
  importTarget: string;
}

interface ClipperLaunchEvidenceFixPackSummary {
  status: ClipperLaunchEvidenceFixPackStatus;
  generatedAt: string | null;
  manifestPath: string;
  markdownPath: string;
  csvPath: string;
  suggestedImportCsvPath: string;
  sourceArtifacts: {
    localDropSyncPath: string;
    evidenceDropDir: string;
    ownerConnectEvidencePath: string;
  };
  items: ClipperLaunchEvidenceFixPackItem[];
  totals: {
    items: number;
    accountProof: number;
    developerApps: number;
    permissionProof: number;
    publicUrl: number;
    sourceRights: number;
    format: number;
    currentStateGaps: number;
    rejectedRows: number;
  };
  nextStep: string;
}

interface ClipperRobertEvidenceCloseoutQueue {
  total: number;
  importTarget: string;
  fixpackPath: string;
  byCategory: {
    accountProof: number;
    developerApps: number;
    permissionProof: number;
    publicUrl: number;
    sourceRights: number;
    format: number;
    currentStateGaps: number;
    rejectedRows: number;
  };
  nextRows: string[];
  importBridge: Array<{
    id: string;
    label: string;
    kind: string;
    platform: ClipperPlatform | "system" | "mixed";
    count: number;
    rows: string[];
    requiredFixes: string[];
    identifiers: string[];
    importTarget: string;
    priority: "critical" | "high" | "medium";
    nextStep: string;
  }>;
  nextItems: Array<{
    id: string;
    rank: number;
    evidenceSource: ClipperLaunchEvidenceFixPackItem["evidenceSource"];
    kind: string;
    identifier: string | null;
    fixCategory: ClipperLaunchEvidenceFixPackItem["fixCategory"];
    requiredFix: string;
    suggestedReplacementRow: string;
    importTarget: string;
  }>;
  nextStep: string;
}

interface ClipperRobertCredentialCloseoutQueue {
  status: ClipperCredentialDropDiagnosticStatus;
  diagnosticPath: string;
  importReady: boolean;
  dropDirs: string[];
  runtimeEnv: {
    checkedEnvVars: string[];
    configuredEnvVars: string[];
    missingEnvVars: string[];
    localEnvFiles: string[];
  };
  acceptedEnvVars: string[];
  pendingEnvVars: string[];
  rejectedEnvVars: string[];
  driveCredentialBridge: Array<{
    id: string;
    label: string;
    platform: ClipperPlatform | "system";
    status: ClipperCredentialSetupStatus;
    missingSuggestedEnvVars: string[];
    driveSearchQueries: string[];
    driveSearchUrls: string[];
    localDropFileNames: string[];
    portalUrl: string | null;
    docsUrl: string;
    nextStep: string;
  }>;
  totals: {
    files: number;
    dropCandidates: number;
    rootCandidates: number;
    importEligible: number;
    templateFiles: number;
    pendingEnvVars: number;
    fileErrors: number;
  };
  files: Array<{
    fileName: string;
    relativePath: string;
    kind: ClipperCredentialSetupFileScan["kind"];
    location: ClipperCredentialDropDiagnosticFile["location"];
    importEligible: boolean;
    detectedEnvVars: string[];
    pendingEnvVars: string[];
    issue: string | null;
    nextStep: string;
  }>;
  nextStep: string;
}

interface ClipperRobertSourceCloseoutQueue {
  status: ClipperSourceSupplyDropKitStatus;
  manifestPath: string;
  markdownPath: string;
  csvPath: string;
  sourceDropDir: string;
  total: number;
  nextRows: string[];
  rightsRows: string[];
  trendRows: string[];
  batches: Array<{
    category: ClipperAccountCategory;
    label: string;
    priority: ClipperSourceSupplyDropKitCategoryBatch["priority"];
    items: number;
    sourceDropDir: string;
    sourceDropManifestPath: string;
    sourceDropReadmePath: string;
    intakeRows: string[];
    rightsRows: string[];
    viralSearchQueries: string[];
    requiredProof: string[];
    nextStep: string;
  }>;
  nextItems: Array<{
    id: string;
    rank: number;
    category: ClipperAccountCategory;
    label: string;
    priority: ClipperSourceSupplyDropKitItem["priority"];
    targetFileName: string;
    sourceDropPath: string;
    intakeBatchRow: string;
    rightsEvidenceBatchRow: string;
    viralSearchQueries: string[];
    requiredProof: string[];
    nextStep: string;
  }>;
  totals: ClipperSourceSupplyDropKitSummary["totals"];
  nextStep: string;
}

interface ClipperRobertAccountCloseoutQueue {
  status: ClipperOwnerConnectPackStatus;
  manifestPath: string;
  markdownPath: string;
  csvPath: string;
  evidenceDropPath: string;
  totals: {
    items: number;
    readyToExecute: number;
    blocked: number;
    waiting: number;
    done: number;
    portalUrls: number;
    evidenceRows: number;
    accounts: number;
    developerApps: number;
    permissions: number;
    oauth: number;
    officialRechecks: number;
  };
  portalUrls: Array<{
    label: string;
    lane: ClipperOwnerConnectPackLane;
    platform: ClipperPlatform | "system";
    url: string;
  }>;
  evidenceRows: string[];
  accountProofBridge: Array<{
    id: string;
    rank: number;
    accountId: string;
    platform: ClipperPlatform | "system";
    handle: string;
    label: string;
    status: ClipperOwnerConnectPackItemStatus;
    portalUrl: string | null;
    evidenceRow: string;
    requiredProof: string[];
    checklist: string[];
    doneCriteria: string[];
    nextStep: string;
  }>;
  appPermissionBridge: Array<{
    id: string;
    rank: number;
    lane: Extract<ClipperOwnerConnectPackLane, "developer_app" | "permission" | "official_recheck">;
    platform: ClipperPlatform | "system";
    label: string;
    status: ClipperOwnerConnectPackItemStatus;
    portalUrl: string | null;
    evidenceRows: string[];
    scopes: string[];
    appIdentifiers: string[];
    publicBaseUrls: string[];
    requiredProof: string[];
    checklist: string[];
    blockers: string[];
    doneCriteria: string[];
    nextStep: string;
  }>;
  nextItems: Array<{
    id: string;
    rank: number;
    lane: ClipperOwnerConnectPackLane;
    platform: ClipperPlatform | "system";
    label: string;
    status: ClipperOwnerConnectPackItemStatus;
    portalUrl: string | null;
    executionUrl: string | null;
    artifactPath: string | null;
    evidenceRows: string[];
    checklist: string[];
    blockers: string[];
    doneCriteria: string[];
    nextStep: string;
  }>;
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

interface ClipperPermissionRequestPlatformBatch {
  id: string;
  platform: ClipperPlatform;
  label: string;
  status: ClipperPermissionRequestPackStatus;
  permissions: number;
  ready: number;
  partial: number;
  blocked: number;
  approved: number;
  requested: number;
  developerPortalUrl: string;
  docsUrls: string[];
  scopes: string[];
  scopeRequestLines: string[];
  copyBlock: string;
  evidenceRecipeRows: string[];
  requestedEvidenceRows: string[];
  approvedEvidenceRows: string[];
  requestedDropFilePath: string;
  approvedDropFilePath: string;
  requestedTemplateFilePath: string;
  approvedTemplateFilePath: string;
  requestedDropTemplate: string;
  approvedDropTemplate: string;
  requiredEvidence: string[];
  blockers: string[];
  submissionSteps: string[];
  doneCriteria: string[];
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
  platformBatches: ClipperPermissionRequestPlatformBatch[];
  totals: {
    permissions: number;
    ready: number;
    partial: number;
    blocked: number;
    approved: number;
    requested: number;
    platformBatches: number;
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

interface ClipperAnalyticsReportingPackItem {
  id: string;
  accountId: string;
  accountName: string;
  category: ClipperAccountCategory;
  platform: ClipperPlatform;
  handle: string;
  exportCadence: "daily";
  exportSource: string;
  targetFileName: string;
  targetPath: string;
  minimumFields: string[];
  kpiTargets: string[];
  evidenceChecklist: string[];
  importRowTemplate: string;
  nextStep: string;
}

interface ClipperAnalyticsReportingPackSummary {
  status: ClipperAnalyticsReportingPackStatus;
  generatedAt: string | null;
  manifestPath: string;
  markdownPath: string;
  csvPath: string;
  metricsDir: string;
  items: ClipperAnalyticsReportingPackItem[];
  totals: {
    exports: number;
    accounts: number;
    platforms: number;
    metricsFiles: number;
    metricRecords: number;
    weeklyViewsGoal: number;
  };
  importTemplate: string;
  runbook: string[];
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
  remixBrief: string;
  ownedAssetPlan: string[];
  scriptBeats: string[];
  publishSafetyChecklist: string[];
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

interface ClipperOAuthConnectionPackPlatformBatch {
  id: string;
  platform: ClipperPlatform;
  label: string;
  status: ClipperOAuthConnectionPackStatus;
  connections: number;
  ready: number;
  partial: number;
  blocked: number;
  tokensSaved: number;
  authUrlsReady: number;
  handles: string[];
  redirectUri: string;
  callbackPath: string;
  developerPortalUrl: string;
  authUrl: string | null;
  requestedScopes: string[];
  blockers: string[];
  checklist: string[];
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
  platformBatches: ClipperOAuthConnectionPackPlatformBatch[];
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

interface ClipperProductionDnsProviderRecipe {
  provider: string;
  bestRecordId: string;
  portalUrl: string;
  steps: string[];
  doneCriteria: string[];
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
  providerRecipes: ClipperProductionDnsProviderRecipe[];
  repairRunbook: string[];
  appReviewHoldChecklist: string[];
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

type ClipperGoLiveTunnelStageStatus = "ready" | "in_progress" | "blocked";

interface ClipperGoLiveTunnelStage {
  id: string;
  label: string;
  status: ClipperGoLiveTunnelStageStatus;
  done: number;
  total: number;
  detail: string;
  nextStep: string;
  artifactPath: string;
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
  sourceDropDiagnostic: ClipperSourceDropDiagnosticSummary;
  sourceAcquisition: ClipperSourceAcquisitionSummary;
  sourceSupplyDropKit: ClipperSourceSupplyDropKitSummary;
  sourceHunt: ClipperSourceHuntSummary;
  rightsOutreach: ClipperRightsOutreachSummary;
  draftSpecs: ClipperDraftSpecSummary;
  manualPostingPack: ClipperManualPostingPackSummary;
  publishingPackage: ClipperPublishingPackageSummary;
  automation: ClipperAutomationSummary;
  automationSchedule: ClipperAutomationScheduleSummary;
  driveWorkspace: ClipperDriveWorkspaceSummary;
  metrics: ClipperMetricsSummary;
  analyticsReportingPack: ClipperAnalyticsReportingPackSummary;
  trendRadar: ClipperTrendRadarSummary;
  trendRightsOutreach: ClipperTrendRightsOutreachSummary;
  viralDiscovery: ClipperViralDiscoverySummary;
  intakeKit: ClipperIntakeKitSummary;
  budgetPlanner: ClipperBudgetPlanner;
  accountIdentityKit: ClipperAccountIdentityKitSummary;
  accountLaunchKit: ClipperAccountLaunchKitSummary;
  accountCreationPack: ClipperAccountCreationPackSummary;
  accountSetupSession: ClipperAccountSetupSessionSummary;
  accountEvidence: ClipperAccountEvidenceSummary;
  developerAppEvidence: ClipperDeveloperAppEvidenceSummary;
  permissionTracker: ClipperPermissionTrackerSummary;
  permissionRequestPack: ClipperPermissionRequestPackSummary;
  externalSetupQueue: ClipperExternalSetupQueueSummary;
  externalExecutionHandoff: ClipperExternalExecutionHandoffSummary;
  externalExecutionSession: ClipperExternalExecutionSessionSummary;
  platformWarRoom: ClipperPlatformWarRoomSummary;
  externalLaunchDossier: ClipperExternalLaunchDossierSummary;
  platformPortalChecklist: ClipperPlatformPortalChecklistSummary;
  appReviewSubmissionPack: ClipperAppReviewSubmissionPackSummary;
  appReviewDemoPack: ClipperAppReviewDemoPackSummary;
  developerApplicationDrafts: ClipperDeveloperApplicationDraftsSummary;
  officialPermissionMatrix: ClipperOfficialPermissionMatrixSummary;
  permissionSubmissionDossier: ClipperPermissionSubmissionDossierSummary;
  publisherConnectors: ClipperPublisherConnectorSummary;
  publisherExecutionQueue: ClipperPublisherExecutionQueueSummary;
  productionUrlSetup: ClipperProductionUrlSetupSummary;
  productionUrlVerification: ClipperProductionUrlVerificationSummary;
  httpsTunnelPlan: ClipperHttpsTunnelPlanSummary;
  legalPolicyPack: ClipperLegalPolicyPackSummary;
  oauthGoLive: ClipperOAuthGoLiveSummary;
  oauthConnectionPack: ClipperOAuthConnectionPackSummary;
  goLiveExecutionPack: ClipperGoLiveExecutionPackSummary;
  goLiveCompletionAudit: ClipperGoLiveCompletionAuditSummary;
  goLiveOperatorBrief: ClipperGoLiveOperatorBriefSummary;
  goLiveEvidenceBundle: ClipperGoLiveEvidenceBundleSummary;
  commandCenter: ClipperLaunchCommandCenterSummary;
  blockerResolutionPack: ClipperBlockerResolutionPackSummary;
  goLiveAutopilotBrief: ClipperGoLiveAutopilotBriefSummary;
  goLiveAutopilotRun: ClipperGoLiveAutopilotRunSummary;
  localDropSync: ClipperLocalDropSyncSummary;
  goLivePrepSweep: ClipperGoLivePrepSweepSummary;
  ownerConnectPack: ClipperOwnerConnectPackSummary;
  dropzoneReadyPack: ClipperDropzoneReadyPackSummary;
  launchEvidenceDropDiagnostic: ClipperLaunchEvidenceDropDiagnosticSummary;
  robertNextActions: ClipperRobertNextActionsSummary;
  launchEvidenceFixPack: ClipperLaunchEvidenceFixPackSummary;
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

function platformLabel(platform: string) {
  if (platform.toLowerCase() === "tiktok") return "TikTok";
  if (platform.toLowerCase() === "youtube") return "YouTube";
  return platform.replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
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

function clipperPlatformLabel(platform: ClipperPlatform) {
  return {
    tiktok: "TikTok",
    instagram: "Instagram",
    youtube: "YouTube",
  }[platform];
}

function publisherConnectorBadge(status: ClipperPublisherConnectorStatus) {
  if (status === "ready") return "border-emerald-300/30 bg-emerald-300/10 text-emerald-200";
  if (status === "partial") return "border-amber-300/30 bg-amber-300/10 text-amber-200";
  if (status === "not_prepared") return "border-zinc-600 bg-zinc-900 text-zinc-300";
  return "border-red-300/30 bg-red-300/10 text-red-200";
}

function publisherExecutionBadge(status: ClipperPublisherExecutionStatus | ClipperPublisherExecutionItemStatus) {
  if (status === "ready" || status === "ready_to_send") return "border-emerald-300/30 bg-emerald-300/10 text-emerald-200";
  if (status === "approval_required" || status === "queued_for_approval") return "border-cyan-300/30 bg-cyan-300/10 text-cyan-100";
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

function goLiveCompletionAuditBadge(status: ClipperGoLiveCompletionAuditStatus | ClipperGoLiveCompletionRequirementStatus) {
  if (status === "ready" || status === "verified") return "border-emerald-300/30 bg-emerald-300/10 text-emerald-200";
  if (status === "partial" || status === "needs_evidence") return "border-amber-300/30 bg-amber-300/10 text-amber-200";
  return "border-red-300/30 bg-red-300/10 text-red-200";
}

function goLiveOperatorBriefBadge(status: ClipperGoLiveOperatorBriefStatus) {
  if (status === "ready") return "border-emerald-300/30 bg-emerald-300/10 text-emerald-200";
  if (status === "needs_action") return "border-amber-300/30 bg-amber-300/10 text-amber-200";
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

function platformWarRoomBadge(status: ClipperPlatformWarRoomStatus) {
  if (status === "ready") return "border-emerald-300/30 bg-emerald-300/10 text-emerald-200";
  if (status === "in_progress") return "border-amber-300/30 bg-amber-300/10 text-amber-200";
  return "border-red-300/30 bg-red-300/10 text-red-200";
}

function goLiveTunnelBadge(status: ClipperGoLiveTunnelStageStatus) {
  if (status === "ready") return "border-emerald-300/30 bg-emerald-300/10 text-emerald-200";
  if (status === "in_progress") return "border-amber-300/30 bg-amber-300/10 text-amber-200";
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

function sourceAcquisitionBadge(status: ClipperSourceAcquisitionStatus | ClipperSourceSupplyDropKitStatus | ClipperSourceAcquisitionCategory["priority"]) {
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

function accountCreationPackBadge(status: ClipperAccountCreationPackStatus | ClipperAccountSetupSessionStatus | ClipperAccountSetupSessionItemStatus) {
  if (status === "ready") return "border-emerald-300/30 bg-emerald-300/10 text-emerald-200";
  if (status === "partial" || status === "ready_to_create" || status === "in_progress") return "border-amber-300/30 bg-amber-300/10 text-amber-200";
  if (status === "not_prepared") return "border-zinc-600 bg-zinc-900 text-zinc-300";
  return "border-red-300/30 bg-red-300/10 text-red-200";
}

function accountEvidenceBadge(status: ClipperAccountEvidenceStatus | ClipperAccountEvidenceItemStatus | "missing") {
  if (status === "ready" || status === "verified") return "border-emerald-300/30 bg-emerald-300/10 text-emerald-200";
  if (status === "partial" || status === "submitted") return "border-amber-300/30 bg-amber-300/10 text-amber-200";
  return "border-red-300/30 bg-red-300/10 text-red-200";
}

function developerAppEvidenceBadge(status: ClipperDeveloperAppEvidenceStatus | ClipperDeveloperAppEvidenceItemStatus | "missing") {
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

function credentialDropFileBadge(status: ClipperCredentialDoctorItem["dropFileStatus"]) {
  if (status === "ready") return "border-emerald-300/30 bg-emerald-300/10 text-emerald-200";
  if (status === "pending_values" || status === "empty") return "border-amber-300/30 bg-amber-300/10 text-amber-200";
  return "border-red-300/30 bg-red-300/10 text-red-200";
}

function googleDriveSearchUrl(query: string) {
  return `https://drive.google.com/drive/search?q=${encodeURIComponent(query)}`;
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

function goLiveAutopilotBadge(status: ClipperGoLiveAutopilotBriefStatus | ClipperGoLiveAutopilotActionStatus | ClipperGoLiveAutopilotRunStatus | ClipperGoLiveAutopilotRunItemStatus | ClipperLocalDropSyncStatus | ClipperLocalDropSyncItemStatus | ClipperGoLivePrepSweepStatus | ClipperGoLivePrepSweepItemStatus | ClipperPostConnectActivationSweepStatus | ClipperIntakeRefreshSweepStatus | ClipperOwnerConnectPackStatus | ClipperOwnerConnectPackItemStatus | ClipperDropzoneReadyPackStatus | ClipperDropzoneReadyPackItemStatus | ClipperRobertNextActionsStatus | ClipperRobertNextActionItem["status"] | ClipperLaunchEvidenceFixPackStatus | ClipperPermissionSubmissionDossierStatus) {
  if (status === "ready" || status === "done" || status === "completed") return "border-emerald-300/30 bg-emerald-300/10 text-emerald-200";
  if (status === "in_progress" || status === "run_in_app" || status === "waiting" || status === "partial" || status === "skipped" || status === "ready_to_execute" || status === "needs_action" || status === "needs_fix" || status === "needs_login_recheck" || status === "ready_to_submit") return "border-amber-300/30 bg-amber-300/10 text-amber-200";
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

function analyticsReportingPackBadge(status: ClipperAnalyticsReportingPackStatus) {
  if (status === "ready") return "border-emerald-300/30 bg-emerald-300/10 text-emerald-200";
  if (status === "needs_data") return "border-amber-300/30 bg-amber-300/10 text-amber-200";
  return "border-zinc-600 bg-zinc-900 text-zinc-300";
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
  const [launchEvidenceStrictImport, setLaunchEvidenceStrictImport] = useState(true);
  const [trendCandidatesBatchText, setTrendCandidatesBatchText] = useState("");
  const [sourceIntakeBatchText, setSourceIntakeBatchText] = useState("");
  const [sourceIntakeBatch, setSourceIntakeBatch] = useState<ClipperSourceIntakeBatchSummary | null>(null);
  const [sourceDropImport, setSourceDropImport] = useState<ClipperSourceDropImportSummary | null>(null);
  const [intakeRefreshSweep, setIntakeRefreshSweep] = useState<ClipperIntakeRefreshSweepSummary | null>(null);
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

  const refreshPostConnectActivationState = async (sourceLabel: string) => {
    try {
      const response = await fetch("/api/clippers/run-post-connect-activation-sweep", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No pude refrescar Activation sweep");
      const result = data as {
        postConnectActivationSweep: ClipperPostConnectActivationSweepSummary;
        status: ClipperStatus;
      };
      queryClient.setQueryData(["/api/clippers/status"], result.status);
      toast({
        title: "Activation sweep actualizado",
        description: `${sourceLabel}: ${result.postConnectActivationSweep.readyLanes + result.postConnectActivationSweep.activationReadyLanes}/${result.postConnectActivationSweep.totalLanes} lanes listas; ${result.postConnectActivationSweep.blockedLanes} bloqueadas.`,
      });
    } catch (error: any) {
      toast({
        title: "Sweep pendiente",
        description: error?.message || "Guarde la evidencia, pero no pude refrescar el estado post-connect.",
        variant: "destructive",
      });
    }
  };

  const refreshSourceRunwayState = async (sourceLabel: string) => {
    try {
      const steps = [
        "/api/clippers/prepare-production-queue",
        "/api/clippers/prepare-source-acquisition",
        "/api/clippers/prepare-source-supply-drop-kit",
      ];
      let latestStatus: ClipperStatus | null = null;
      for (const endpoint of steps) {
        const response = await fetch(endpoint, { method: "POST" });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || `No pude refrescar ${endpoint}`);
        latestStatus = data.status;
      }
      if (!latestStatus) return;
      queryClient.setQueryData(["/api/clippers/status"], latestStatus);
      toast({
        title: "Source runway actualizado",
        description: `${sourceLabel}: ${latestStatus.sourceAcquisition.totals.weeklyReadySlots}/${latestStatus.sourceAcquisition.totals.targetWeeklyClips} clips/semana listos; ${latestStatus.sourceSupplyDropKit.totals.items} filas faltantes.`,
      });
    } catch (error: any) {
      toast({
        title: "Source runway pendiente",
        description: error?.message || "Guarde el input, pero no pude regenerar source plan/production queue.",
        variant: "destructive",
      });
    }
  };

  const refreshCredentialOauthRunwayState = async (sourceLabel: string) => {
    try {
      const steps = [
        "/api/clippers/reload-credentials",
        "/api/clippers/prepare-credential-doctor",
        "/api/clippers/prepare-oauth-go-live",
        "/api/clippers/prepare-oauth-connection-pack",
        "/api/clippers/prepare-platform-readiness",
      ];
      let latestStatus: ClipperStatus | null = null;
      for (const endpoint of steps) {
        const response = await fetch(endpoint, { method: "POST" });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || `No pude refrescar ${endpoint}`);
        latestStatus = data.status;
      }
      const sweepResponse = await fetch("/api/clippers/run-post-connect-activation-sweep", { method: "POST" });
      const sweepData = await sweepResponse.json();
      if (!sweepResponse.ok) throw new Error(sweepData.error || "No pude refrescar Activation sweep");
      latestStatus = sweepData.status || latestStatus;
      if (!latestStatus) return;
      queryClient.setQueryData(["/api/clippers/status"], latestStatus);
      toast({
        title: "Credential/OAuth runway actualizado",
        description: `${sourceLabel}: ${latestStatus.credentialSetup.totals.ready}/${latestStatus.credentialSetup.totals.items} credenciales; ${latestStatus.oauthConnectionPack.totals.tokensSaved}/${latestStatus.oauthConnectionPack.totals.connections} OAuth tokens.`,
      });
    } catch (error: any) {
      toast({
        title: "Credential/OAuth refresh pendiente",
        description: error?.message || "Guarde credenciales, pero no pude refrescar OAuth/Activation.",
        variant: "destructive",
      });
    }
  };

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

  const accountSetupSessionMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/clippers/prepare-account-setup-session", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No pude preparar account setup session");
      return data as { accountSetupSession: ClipperAccountSetupSessionSummary; status: ClipperStatus };
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["/api/clippers/status"], data.status);
      toast({
        title: "Account setup listo",
        description: `${data.accountSetupSession.totals.readyToCreate} cuentas listas para crear; ${data.accountSetupSession.totals.ready} verificadas.`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "No pude preparar account setup", description: error.message, variant: "destructive" });
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
      void refreshPostConnectActivationState("cuenta");
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
      void refreshPostConnectActivationState("developer app");
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
        body: JSON.stringify({ batchText: launchEvidenceBatchText, strict: launchEvidenceStrictImport }),
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
        body: JSON.stringify({ batchText: launchEvidenceBatchText, strict: launchEvidenceStrictImport }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No pude importar evidencia batch");
      return data as { launchEvidenceBatch: ClipperLaunchEvidenceBatchSummary; status: ClipperStatus };
    },
    onSuccess: (data) => {
      setLaunchEvidenceBatchPreview(data.launchEvidenceBatch);
      queryClient.setQueryData(["/api/clippers/status"], data.status);
      const accepted = data.launchEvidenceBatch.accepted;
      if (data.launchEvidenceBatch.strictBlocked) {
        toast({
          title: "Strict import bloqueado",
          description: `${data.launchEvidenceBatch.rejected.length} row(s) rechazados. No escribi evidencia parcial.`,
          variant: "destructive",
        });
        return;
      }
      setLaunchEvidenceBatchText("");
      toast({
        title: "Evidencia batch importada",
        description: `${accepted.accountEvidence} cuentas, ${accepted.developerApps} apps, ${accepted.permissions} permisos, ${accepted.sourceRights} derechos; ${data.launchEvidenceBatch.rejected.length} rechazados.`,
      });
      void refreshPostConnectActivationState("batch evidence");
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
      if (data.launchEvidenceDropImport.strictBlocked) {
        toast({
          title: "Evidence drop bloqueado",
          description: data.launchEvidenceDropImport.nextStep,
          variant: "destructive",
        });
        return;
      }
      toast({
        title: "Evidence drop importado",
        description: `${accepted.accountEvidence} cuentas, ${accepted.developerApps} apps, ${accepted.permissions} permisos; ${data.launchEvidenceDropImport.filesImported || 0}/${data.launchEvidenceDropImport.filesScanned || 0} archivos.`,
      });
      void refreshPostConnectActivationState("evidence-drop");
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

  const credentialDropStarterMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/clippers/prepare-credential-drop-starter", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No pude crear starter files de credenciales");
      return data as { credentialDropStarter: ClipperCredentialDropStarterSummary; status: ClipperStatus };
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["/api/clippers/status"], data.status);
      toast({
        title: "Starter files listos",
        description: `${data.credentialDropStarter.totals.created} creados, ${data.credentialDropStarter.totals.existing} existentes; rellena valores reales antes de importar.`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "No pude crear starter files", description: error.message, variant: "destructive" });
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
      void refreshCredentialOauthRunwayState("credencial guardada");
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
      void refreshCredentialOauthRunwayState("batch de credenciales");
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
      void refreshCredentialOauthRunwayState("credential drop");
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
      void refreshCredentialOauthRunwayState("reload credentials");
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

  const publisherExecutionQueueMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/clippers/prepare-publisher-execution-queue", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No pude preparar publisher execution queue");
      return data as { publisherExecutionQueue: ClipperPublisherExecutionQueueSummary; status: ClipperStatus };
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["/api/clippers/status"], data.status);
      toast({
        title: "Execution queue lista",
        description: `${data.publisherExecutionQueue.totals.items} items; ${data.publisherExecutionQueue.totals.blocked} bloqueados; ${data.publisherExecutionQueue.totals.queuedForApproval} en approval.`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "No pude preparar execution queue", description: error.message, variant: "destructive" });
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

  const goLiveCompletionAuditMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/clippers/prepare-go-live-completion-audit", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No pude preparar el completion audit");
      return data as { goLiveCompletionAudit: ClipperGoLiveCompletionAuditSummary; status: ClipperStatus };
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["/api/clippers/status"], data.status);
      toast({
        title: "Completion audit listo",
        description: `${data.goLiveCompletionAudit.totals.verified}/${data.goLiveCompletionAudit.totals.requirements} requisitos verificados; ${data.goLiveCompletionAudit.totals.blocked} bloqueados.`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "No pude preparar completion audit", description: error.message, variant: "destructive" });
    },
  });

  const goLiveOperatorBriefMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/clippers/prepare-go-live-operator-brief", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No pude preparar el operator brief");
      return data as { goLiveOperatorBrief: ClipperGoLiveOperatorBriefSummary; status: ClipperStatus };
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["/api/clippers/status"], data.status);
      toast({
        title: "Operator brief listo",
        description: `${data.goLiveOperatorBrief.totals.ready}/${data.goLiveOperatorBrief.totals.lanes} carriles ready; foco: ${data.goLiveOperatorBrief.currentFocus}.`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "No pude preparar operator brief", description: error.message, variant: "destructive" });
    },
  });

  const goLiveEvidenceBundleMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/clippers/prepare-go-live-evidence-bundle", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No pude preparar el go-live evidence bundle");
      return data as { goLiveEvidenceBundle: ClipperGoLiveEvidenceBundleSummary; status: ClipperStatus };
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["/api/clippers/status"], data.status);
      toast({
        title: "Evidence bundle listo",
        description: `${data.goLiveEvidenceBundle.totals.starterRows} starter rows y ${data.goLiveEvidenceBundle.totals.approvalRows} approval rows preparados.`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "No pude preparar evidence bundle", description: error.message, variant: "destructive" });
    },
  });

  const goLiveAuditActionMutation = useMutation({
    mutationFn: async (requirement: ClipperGoLiveCompletionRequirement) => {
      if (!requirement.actionUrl?.startsWith("/api/clippers/")) {
        throw new Error("Esta accion requiere portal externo o no esta permitida como accion local.");
      }
      const actionResponse = await fetch(requirement.actionUrl, { method: "POST" });
      const actionData = await actionResponse.json().catch(() => ({}));
      if (!actionResponse.ok) throw new Error(actionData.error || `No pude ejecutar ${requirement.actionUrl}`);
      const auditResponse = await fetch("/api/clippers/prepare-go-live-completion-audit", { method: "POST" });
      const auditData = await auditResponse.json();
      if (!auditResponse.ok) throw new Error(auditData.error || "La accion corrio, pero no pude refrescar el audit");
      return { requirement, actionData, auditData: auditData as { goLiveCompletionAudit: ClipperGoLiveCompletionAuditSummary; status: ClipperStatus } };
    },
    onSuccess: ({ requirement, auditData }) => {
      queryClient.setQueryData(["/api/clippers/status"], auditData.status);
      toast({
        title: "Accion local ejecutada",
        description: `${requirement.label}: audit ${auditData.goLiveCompletionAudit.totals.verified}/${auditData.goLiveCompletionAudit.totals.requirements} verificados.`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "No pude ejecutar accion local", description: error.message, variant: "destructive" });
    },
  });

  const goLiveAuditActionsMutation = useMutation({
    mutationFn: async (requirements: ClipperGoLiveCompletionRequirement[]) => {
      const localActionUrls = Array.from(new Set(
        requirements
          .map((requirement) => requirement.actionUrl)
          .filter((actionUrl): actionUrl is string => Boolean(actionUrl?.startsWith("/api/clippers/"))),
      ));
      if (localActionUrls.length === 0) {
        throw new Error("No hay acciones locales permitidas en este audit.");
      }
      for (const actionUrl of localActionUrls) {
        const actionResponse = await fetch(actionUrl, { method: "POST" });
        const actionData = await actionResponse.json().catch(() => ({}));
        if (!actionResponse.ok) throw new Error(actionData.error || `No pude ejecutar ${actionUrl}`);
      }
      const auditResponse = await fetch("/api/clippers/prepare-go-live-completion-audit", { method: "POST" });
      const auditData = await auditResponse.json();
      if (!auditResponse.ok) throw new Error(auditData.error || "Las acciones corrieron, pero no pude refrescar el audit");
      return {
        actionsRun: localActionUrls.length,
        auditData: auditData as { goLiveCompletionAudit: ClipperGoLiveCompletionAuditSummary; status: ClipperStatus },
      };
    },
    onSuccess: ({ actionsRun, auditData }) => {
      queryClient.setQueryData(["/api/clippers/status"], auditData.status);
      toast({
        title: "Acciones locales ejecutadas",
        description: `${actionsRun} acciones; audit ${auditData.goLiveCompletionAudit.totals.verified}/${auditData.goLiveCompletionAudit.totals.requirements} verificados.`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "No pude ejecutar acciones locales", description: error.message, variant: "destructive" });
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
    mutationFn: async (input?: { resetCompleted?: boolean }) => {
      const response = await fetch("/api/clippers/run-go-live-autopilot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ maxActions: 3, resetCompleted: input?.resetCompleted === true }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No pude correr el go-live autopilot");
      return data as { goLiveAutopilotRun: ClipperGoLiveAutopilotRunSummary; goLiveAutopilotBrief: ClipperGoLiveAutopilotBriefSummary; status: ClipperStatus };
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["/api/clippers/status"], data.status);
      toast({
        title: data.goLiveAutopilotRun.resetCompleted ? "Autopilot reset ejecutado" : "Autopilot ejecutado",
        description: `${data.goLiveAutopilotRun.totals.completed} completadas, ${data.goLiveAutopilotRun.totals.skipped} saltadas, ${data.goLiveAutopilotRun.remainingInAppActions} restantes.`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "No pude correr Autopilot", description: error.message, variant: "destructive" });
    },
  });

  const goLivePrepSweepMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/clippers/run-go-live-prep-sweep", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No pude correr el Prep sweep");
      return data as { goLivePrepSweep: ClipperGoLivePrepSweepSummary; localDropSync: ClipperLocalDropSyncSummary | null; status: ClipperStatus };
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["/api/clippers/status"], data.status);
      toast({
        title: "Prep sweep listo",
        description: `${data.goLivePrepSweep.totals.completed} completados, ${data.goLivePrepSweep.totals.failed} fallidos; estado ${data.goLivePrepSweep.status}.`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "No pude correr Prep sweep", description: error.message, variant: "destructive" });
    },
  });

  const postConnectActivationSweepMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/clippers/run-post-connect-activation-sweep", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No pude correr el Post-connect sweep");
      return data as {
        postConnectActivationSweep: ClipperPostConnectActivationSweepSummary;
        goLivePrepSweep: ClipperGoLivePrepSweepSummary;
        localDropSync: ClipperLocalDropSyncSummary | null;
        robertNextActions: ClipperRobertNextActionsSummary;
        status: ClipperStatus;
      };
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["/api/clippers/status"], data.status);
      toast({
        title: "Post-connect sweep listo",
        description: `${data.postConnectActivationSweep.readyLanes + data.postConnectActivationSweep.activationReadyLanes}/${data.postConnectActivationSweep.totalLanes} lanes listas; ${data.postConnectActivationSweep.blockedLanes} bloqueadas.`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "No pude correr Post-connect sweep", description: error.message, variant: "destructive" });
    },
  });

  const intakeRefreshSweepMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/clippers/run-intake-refresh-sweep", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No pude correr Intake Refresh Sweep");
      return data as {
        intakeRefreshSweep: ClipperIntakeRefreshSweepSummary;
        postConnectActivationSweep: ClipperPostConnectActivationSweepSummary;
        goLivePrepSweep: ClipperGoLivePrepSweepSummary;
        localDropSync: ClipperLocalDropSyncSummary | null;
        robertNextActions: ClipperRobertNextActionsSummary;
        status: ClipperStatus;
      };
    },
    onSuccess: (data) => {
      setIntakeRefreshSweep(data.intakeRefreshSweep);
      queryClient.setQueryData(["/api/clippers/status"], data.status);
      toast({
        title: "Intake refresh listo",
        description: `${data.intakeRefreshSweep.intakeConsole.totals.ready} ready, ${data.intakeRefreshSweep.intakeConsole.totals.partial} partial, ${data.intakeRefreshSweep.intakeConsole.totals.missing} missing; ${data.intakeRefreshSweep.blockers.length} blockers.`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "No pude correr Intake refresh", description: error.message, variant: "destructive" });
    },
  });

  const ownerConnectPackMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/clippers/prepare-owner-connect-pack", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No pude preparar Owner Connect Pack");
      return data as { ownerConnectPack: ClipperOwnerConnectPackSummary; status: ClipperStatus };
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["/api/clippers/status"], data.status);
      toast({
        title: "Owner Connect Pack listo",
        description: `${data.ownerConnectPack.totals.readyToExecute} listos, ${data.ownerConnectPack.totals.blocked} bloqueados, ${data.ownerConnectPack.totals.evidenceRows} evidence rows.`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "No pude preparar Owner Connect Pack", description: error.message, variant: "destructive" });
    },
  });

  const ownerConnectProgressMutation = useMutation({
    mutationFn: async (input: { itemId: string; status: ClipperOwnerConnectPackItemStatus; notes?: string; evidenceRows?: string[] }) => {
      const response = await fetch("/api/clippers/record-owner-connect-progress", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No pude guardar el progreso de Owner Connect");
      return data as { ownerConnectPack: ClipperOwnerConnectPackSummary; status: ClipperStatus };
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["/api/clippers/status"], data.status);
      toast({
        title: "Progreso guardado",
        description: `${data.ownerConnectPack.totals.progressDone} done local, ${data.ownerConnectPack.totals.progressRecords} records guardados.`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "No pude guardar progreso", description: error.message, variant: "destructive" });
    },
  });

  const dropzoneReadyPackMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/clippers/prepare-dropzone-ready-pack", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No pude preparar Dropzone Ready Pack");
      return data as { dropzoneReadyPack: ClipperDropzoneReadyPackSummary; status: ClipperStatus };
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["/api/clippers/status"], data.status);
      toast({
        title: "Dropzone pack listo",
        description: `${data.dropzoneReadyPack.totals.missing} missing, ${data.dropzoneReadyPack.totals.partial} partial, ${data.dropzoneReadyPack.totals.ready} ready.`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "No pude preparar Dropzone pack", description: error.message, variant: "destructive" });
    },
  });

  const robertNextActionsMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/clippers/prepare-robert-next-actions", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No pude preparar Robert Next Actions");
      return data as { robertNextActions: ClipperRobertNextActionsSummary; status: ClipperStatus };
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["/api/clippers/status"], data.status);
      toast({
        title: "Next actions listo",
        description: `${data.robertNextActions.totals.actions} acciones, ${data.robertNextActions.totals.critical} criticas, ${data.robertNextActions.totals.estimatedMinutes} min estimados.`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "No pude preparar Next Actions", description: error.message, variant: "destructive" });
    },
  });

  const launchEvidenceFixPackMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/clippers/prepare-launch-evidence-fix-pack", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No pude preparar Launch Evidence Fix Pack");
      return data as { launchEvidenceFixPack: ClipperLaunchEvidenceFixPackSummary; status: ClipperStatus };
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["/api/clippers/status"], data.status);
      toast({
        title: "Evidence fix pack listo",
        description: `${data.launchEvidenceFixPack.totals.items} filas para corregir; ${data.launchEvidenceFixPack.csvPath}`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "No pude preparar Evidence Fix Pack", description: error.message, variant: "destructive" });
    },
  });

  const localDropSyncMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/clippers/run-local-drop-sync", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No pude correr Local Drop Sync");
      return data as { localDropSync: ClipperLocalDropSyncSummary; status: ClipperStatus };
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["/api/clippers/status"], data.status);
      toast({
        title: "Local Drop Sync listo",
        description: `${data.localDropSync.totals.completed} completados, ${data.localDropSync.totals.skipped} sin archivos, ${data.localDropSync.totals.failed} fallidos.`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "No pude correr Local Drop Sync", description: error.message, variant: "destructive" });
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

  const permissionSubmissionDossierMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/clippers/prepare-permission-submission-dossier", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No pude preparar permission submission dossier");
      return data as { permissionSubmissionDossier: ClipperPermissionSubmissionDossierSummary; status: ClipperStatus };
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["/api/clippers/status"], data.status);
      toast({
        title: "Permission dossier listo",
        description: `${data.permissionSubmissionDossier.totals.platforms} plataformas; ${data.permissionSubmissionDossier.totals.blocked} bloqueadas; ${data.permissionSubmissionDossier.totals.needsLoginRecheck} login recheck.`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "No pude preparar dossier", description: error.message, variant: "destructive" });
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
      void refreshPostConnectActivationState("permiso");
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

  const sourceSupplyDropKitMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/clippers/prepare-source-supply-drop-kit", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No pude preparar source drop kit");
      return data as { sourceSupplyDropKit: ClipperSourceSupplyDropKitSummary; status: ClipperStatus };
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["/api/clippers/status"], data.status);
      toast({
        title: "Source drop kit listo",
        description: `${data.sourceSupplyDropKit.totals.items} filas para cubrir supply semanal.`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "No pude preparar source drop kit", description: error.message, variant: "destructive" });
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
      void refreshSourceRunwayState("source intake");
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

  const analyticsReportingPackMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/clippers/prepare-analytics-reporting-pack", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No pude preparar analytics reporting pack");
      return data as { analyticsReportingPack: ClipperAnalyticsReportingPackSummary; status: ClipperStatus };
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["/api/clippers/status"], data.status);
      toast({
        title: "Analytics reporting listo",
        description: `${data.analyticsReportingPack.totals.exports} exports diarios; ${formatNumber(data.analyticsReportingPack.totals.weeklyViewsGoal)} views/week objetivo.`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "No pude preparar reporting", description: error.message, variant: "destructive" });
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
      void refreshSourceRunwayState("candidatos virales");
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
      void refreshSourceRunwayState("source-drop");
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
      void refreshSourceRunwayState("derechos de source");
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
  const ownerAccountConnectItems = useMemo(() => {
    return (status?.ownerConnectPack?.items || []).filter((item) => item.lane === "account");
  }, [status?.ownerConnectPack?.items]);
  const findOwnerAccountConnectItem = (setupItem: ClipperAccountSetupSessionItem) => {
    const expectedId = `external-session-handoff-account-${setupItem.accountId}-${setupItem.platform}`;
    return ownerAccountConnectItems.find((item) => item.id === expectedId)
      || ownerAccountConnectItems.find((item) => item.platform === setupItem.platform
        && item.evidenceRows.some((row) => row.includes(`"${setupItem.accountId}"`) && row.includes(`"${setupItem.platform}"`)));
  };
  const selectedAccountEvidenceTask = accountLaunchTasks.find((task) => task.id === accountEvidenceTaskId) || accountLaunchTasks[0] || null;
  const permissionRecordItems = status?.permissionTracker?.items || [];
  const selectedPermissionRecord = permissionRecordItems.find((item) => item.id === permissionRecordId) || permissionRecordItems[0] || null;
  const goLiveTunnelStages = useMemo<ClipperGoLiveTunnelStage[]>(() => {
    if (!status) return [];
    const buildStage = (
      id: string,
      label: string,
      done: number,
      total: number,
      detail: string,
      nextStep: string,
      artifactPath: string,
    ): ClipperGoLiveTunnelStage => ({
      id,
      label,
      done,
      total,
      detail,
      nextStep,
      artifactPath,
      status: total > 0 && done >= total ? "ready" : done > 0 ? "in_progress" : "blocked",
    });
    const localSyncDone = (status.localDropSync?.items || []).filter((item) => item.status === "completed").length;
    const localSyncTotal = status.localDropSync?.totals?.attempted || 5;
    const credentialReady = status.credentialChecks.filter((item) => item.status === "ready").length;
    const accountReady = status.accountEvidence?.totals?.verified || 0;
    const accountTotal = status.accountEvidence?.totals?.expected || status.accountLaunchKit?.totals?.tasks || 0;
    const developerReady = status.developerAppEvidence?.totals?.approved || 0;
    const developerTotal = status.developerAppEvidence?.totals?.expected || status.platformRequirements.length;
    const permissionReady = status.permissionTracker?.totals?.approved || 0;
    const permissionTotal = status.permissionTracker?.totals?.permissions || status.permissionQueue.length;
    const oauthReady = status.tokenVault?.records?.length || 0;
    const oauthTotal = status.platformRequirements.length;
    const sourceReady = status.productionQueue?.sourceAssets?.filter((asset) => asset.rightsStatus === "owned_or_permissioned").length || 0;
    const sourceTotal = Math.max(status.sourceDropDiagnostic?.totals?.minimumWeeklySourceAssets || 0, status.sourceSupplyDropKit?.totals?.minimumWeeklySourceAssets || 0, 1);
    const publishReady = status.publisherConnectors?.totals?.ready || 0;
    const publishTotal = status.publisherConnectors?.totals?.platforms || status.platformRequirements.length;
    const metricsReady = status.metrics?.totals?.clips || 0;
    const metricsTotal = Math.max(status.accounts.length, 1);

    return [
      buildStage(
        "local-sync",
        "Local sync",
        localSyncDone,
        localSyncTotal,
        `${status.localDropSync?.totals?.skipped || 0} inputs pendientes, ${status.localDropSync?.totals?.failed || 0} fallos reales.`,
        status.localDropSync?.nextStep || "Agregar credenciales/evidencias/videos y correr Local sync.",
        status.localDropSync?.markdownPath || "",
      ),
      buildStage(
        "credentials",
        "Keys",
        credentialReady,
        status.credentialChecks.length,
        `${credentialReady}/${status.credentialChecks.length} grupos OAuth detectados.`,
        status.credentialSetup?.credentialDropDiagnostic?.nextStep || status.credentialSetup?.nextStep || "Cargar credenciales y recargar.",
        status.credentialSetup?.credentialDropDiagnosticMarkdownPath || status.credentialDoctor?.markdownPath || "",
      ),
      buildStage(
        "accounts",
        "Cuentas",
        accountReady,
        accountTotal,
        `${accountReady}/${accountTotal} cuentas con evidencia verified.`,
        status.accountEvidence?.nextStep || status.accountCreationPack?.nextStep || "Crear cuentas externas e importar evidencia.",
        status.accountCreationPack?.claimSheetPath || status.accountEvidence?.connectionKitMarkdownPath || "",
      ),
      buildStage(
        "developer-apps",
        "Apps",
        developerReady,
        developerTotal,
        `${developerReady}/${developerTotal} apps developer aprobadas.`,
        status.developerAppEvidence?.nextStep || status.developerApplicationDrafts?.nextStep || "Crear apps developer y app review.",
        status.developerApplicationDrafts?.markdownPath || status.developerAppEvidence?.connectionKitMarkdownPath || "",
      ),
      buildStage(
        "permissions",
        "Permisos",
        permissionReady,
        permissionTotal,
        `${permissionReady}/${permissionTotal} scopes aprobados.`,
        status.permissionTracker?.nextStep || status.permissionRequestPack?.nextStep || "Solicitar permisos oficiales e importar evidencia.",
        status.permissionRequestPack?.markdownPath || status.officialPermissionMatrix?.markdownPath || "",
      ),
      buildStage(
        "oauth",
        "OAuth",
        oauthReady,
        oauthTotal,
        `${oauthReady}/${oauthTotal} tokens cifrados guardados.`,
        status.oauthConnectionPack?.nextStep || status.oauthGoLive?.nextStep || "Conectar OAuth cuando cuentas, apps y permisos esten listos.",
        status.oauthConnectionPack?.markdownPath || status.oauthGoLive?.markdownPath || "",
      ),
      buildStage(
        "sources",
        "Fuentes",
        sourceReady,
        sourceTotal,
        `${sourceReady}/${sourceTotal} fuentes listas con derechos.`,
        status.sourceSupplyDropKit?.nextStep || status.sourceAcquisition?.nextStep || "Agregar fuentes con permiso/derechos y correr Source plan.",
        status.sourceSupplyDropKit?.markdownPath || status.sourceAcquisition?.markdownPath || "",
      ),
      buildStage(
        "publish",
        "Publish",
        publishReady,
        publishTotal,
        `${publishReady}/${publishTotal} conectores listos.`,
        status.publisherConnectors?.nextStep || status.publishingPackage?.nextStep || "Preparar publish pack y mantener approval_required.",
        status.publisherConnectors?.markdownPath || status.publishingPackage?.markdownPath || "",
      ),
      buildStage(
        "analytics",
        "Reportes",
        metricsReady,
        metricsTotal,
        `${formatNumber(metricsReady)} clips con metricas importadas.`,
        status.analyticsReportingPack?.nextStep || status.metrics?.nextStep || "Importar CSV de analytics diario para optimizar.",
        status.analyticsReportingPack?.markdownPath || status.metrics?.summaryPath || "",
      ),
    ];
  }, [status]);
  const warRoomFlowStages = useMemo(() => {
    if (!status?.platformWarRoom) return [];
    const accountReady = status.platformWarRoom.totals.accountConnectionsReady;
    const accountTotal = status.platformWarRoom.totals.accountConnections;
    const developerReady = status.developerAppEvidence?.totals?.approved || 0;
    const developerTotal = status.developerAppEvidence?.totals?.expected || status.platformWarRoom.totals.platforms;
    const permissionReady = status.platformWarRoom.totals.permissionApprovalsApproved;
    const permissionTotal = status.platformWarRoom.totals.permissionApprovals;
    const credentialReady = status.credentialChecks.filter((item) => item.status === "ready").length;
    const credentialTotal = status.credentialChecks.length;
    const tokenReady = status.tokenVault?.records?.length || 0;
    const tokenTotal = status.platformWarRoom.totals.platforms;
    const publishReady = status.publisherConnectors?.totals?.ready || 0;
    const publishTotal = status.publisherConnectors?.totals?.platforms || status.platformWarRoom.totals.platforms;
    const buildStage = (id: string, label: string, done: number, total: number, nextStep: string) => ({
      id,
      label,
      done,
      total,
      status: total > 0 && done >= total ? "ready" : done > 0 ? "in_progress" : "blocked",
      nextStep,
    });
    return [
      buildStage("accounts", "Cuentas", accountReady, accountTotal, "Crear/verificar cuentas y cargar evidencia real."),
      buildStage("apps", "Apps", developerReady, developerTotal, "Crear apps developer, public URL y app review."),
      buildStage("permissions", "Permisos", permissionReady, permissionTotal, "Solicitar scopes y registrar aprobaciones."),
      buildStage("credentials", "Keys", credentialReady, credentialTotal, "Guardar env vars y recargar credenciales."),
      buildStage("oauth", "OAuth", tokenReady, tokenTotal, "Conectar cada plataforma y guardar tokens cifrados."),
      buildStage("publish", "Publish", publishReady, publishTotal, "Activar conectores y autopilot cuando todo este listo."),
    ];
  }, [status]);

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
    const fallbackPublicBaseUrl = status?.oauthGoLive?.productionUrlReady ? status.oauthGoLive.publicBaseUrl : "";
    recordDeveloperAppEvidenceMutation.mutate({
      platform: developerEvidencePlatform,
      status: developerEvidenceStatus,
      appIdentifier: developerEvidenceAppIdentifier.trim(),
      publicBaseUrl: developerEvidencePublicBaseUrl.trim() || fallbackPublicBaseUrl,
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

  const appendSourceIntakeBatchRows = (rows: string[]) => {
    const cleanRows = rows.map((row) => row.trim()).filter(Boolean);
    if (!cleanRows.length) return;
    setSourceIntakeBatch(null);
    setSourceIntakeBatchText((current) => {
      const cleanCurrent = current.trim();
      const rowsText = cleanRows.join("\n");
      if (!cleanCurrent) return `${sourceIntakeBatchHeader}\n${rowsText}`;
      return `${cleanCurrent}\n${rowsText}`;
    });
    toast({
      title: "Rows agregadas a Source Intake",
      description: `${cleanRows.length} filas agregadas. Reemplaza placeholders con fuente y proof real antes de importar.`,
    });
  };

  const copySourceDropManifestRows = async (rows: string[]) => {
    const cleanRows = rows.map((row) => row.trim()).filter(Boolean);
    if (!cleanRows.length) return;
    const manifestText = `${sourceIntakeBatchHeader}\n${cleanRows.join("\n")}\n`;
    try {
      await navigator.clipboard.writeText(manifestText);
      toast({
        title: "Manifest CSV copiado",
        description: "Guardalo como source-drop-manifest.csv junto a los videos y reemplaza placeholders con proof real.",
      });
    } catch {
      setSourceIntakeBatch(null);
      setSourceIntakeBatchText(manifestText);
      toast({
        title: "Manifest listo en Source Intake",
        description: "Copia este CSV a source-drop-manifest.csv junto a los videos y reemplaza placeholders.",
      });
    }
  };

  const copyGoLiveEvidenceTemplate = async (template: string, fileName: string) => {
    const cleanTemplate = template.trim();
    if (!cleanTemplate) return;
    try {
      await navigator.clipboard.writeText(`${cleanTemplate}\n`);
      toast({
        title: "Evidence template copiado",
        description: fileName ? `Usalo como ${fileName} y reemplaza placeholders con proof real.` : "Reemplaza placeholders con proof real antes de importar evidencia.",
      });
    } catch {
      setLaunchEvidenceBatchPreview(null);
      setLaunchEvidenceBatchText(cleanTemplate);
      toast({
        title: "Evidence template cargado",
        description: "No pude copiar al clipboard; lo deje en el area de Launch Evidence para copiarlo manualmente.",
      });
    }
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

  const appendTrendCandidateBatchRows = (rows: string[]) => {
    const cleanRows = rows.map((row) => row.trim()).filter(Boolean);
    if (!cleanRows.length) return;
    setTrendCandidatesBatchText((current) => {
      const cleanCurrent = current.trim();
      const rowsText = cleanRows.join("\n");
      if (!cleanCurrent) return `${trendCandidatesBatchHeader}\n${rowsText}`;
      return `${cleanCurrent}\n${rowsText}`;
    });
    toast({
      title: "Candidates agregados",
      description: `${cleanRows.length} filas agregadas. Reemplaza placeholders y metricas reales antes de importar.`,
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
              onClick={() => goLiveCompletionAuditMutation.mutate()}
              disabled={goLiveCompletionAuditMutation.isPending || isLoading}
              className="bg-emerald-200 text-zinc-950 hover:bg-emerald-100"
              data-testid="prepare-clippers-go-live-completion-audit-button"
            >
              {goLiveCompletionAuditMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
              Completion audit
            </Button>
            <Button
              onClick={() => goLiveOperatorBriefMutation.mutate()}
              disabled={goLiveOperatorBriefMutation.isPending || isLoading}
              className="bg-sky-200 text-zinc-950 hover:bg-sky-100"
              data-testid="prepare-clippers-go-live-operator-brief-button"
            >
              {goLiveOperatorBriefMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Target className="mr-2 h-4 w-4" />}
              Operator brief
            </Button>
            <Button
              onClick={() => goLiveEvidenceBundleMutation.mutate()}
              disabled={goLiveEvidenceBundleMutation.isPending || isLoading}
              className="bg-purple-200 text-zinc-950 hover:bg-purple-100"
              data-testid="prepare-clippers-go-live-evidence-bundle-button"
            >
              {goLiveEvidenceBundleMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <UploadCloud className="mr-2 h-4 w-4" />}
              Evidence bundle
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
              onClick={() => goLiveAutopilotRunMutation.mutate({})}
              disabled={goLiveAutopilotRunMutation.isPending || isLoading}
              className="bg-emerald-200 text-zinc-950 hover:bg-emerald-100"
              data-testid="run-clippers-go-live-autopilot-button"
            >
              {goLiveAutopilotRunMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
              Run Autopilot
            </Button>
            <Button
              onClick={() => goLiveAutopilotRunMutation.mutate({ resetCompleted: true })}
              disabled={goLiveAutopilotRunMutation.isPending || isLoading}
              variant="outline"
              className="border-emerald-300/30 bg-transparent text-emerald-100 hover:bg-emerald-300/10"
              data-testid="reset-clippers-go-live-autopilot-button"
            >
              {goLiveAutopilotRunMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
              Reset local
            </Button>
            <Button
              onClick={() => goLivePrepSweepMutation.mutate()}
              disabled={goLivePrepSweepMutation.isPending || isLoading}
              className="bg-teal-200 text-zinc-950 hover:bg-teal-100"
              data-testid="run-clippers-go-live-prep-sweep-button"
            >
              {goLivePrepSweepMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Rocket className="mr-2 h-4 w-4" />}
              Prep sweep
            </Button>
            <Button
              onClick={() => postConnectActivationSweepMutation.mutate()}
              disabled={postConnectActivationSweepMutation.isPending || goLivePrepSweepMutation.isPending || isLoading}
              className="bg-lime-200 text-zinc-950 hover:bg-lime-100"
              data-testid="run-clippers-post-connect-activation-sweep-button"
            >
              {postConnectActivationSweepMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
              Activation sweep
            </Button>
            <Button
              onClick={() => ownerConnectPackMutation.mutate()}
              disabled={ownerConnectPackMutation.isPending || isLoading}
              className="bg-sky-200 text-zinc-950 hover:bg-sky-100"
              data-testid="prepare-clippers-owner-connect-pack-button"
            >
              {ownerConnectPackMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Users className="mr-2 h-4 w-4" />}
              Owner pack
            </Button>
            <Button
              onClick={() => dropzoneReadyPackMutation.mutate()}
              disabled={dropzoneReadyPackMutation.isPending || isLoading}
              className="bg-cyan-200 text-zinc-950 hover:bg-cyan-100"
              data-testid="prepare-clippers-dropzone-ready-pack-button"
            >
              {dropzoneReadyPackMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FolderOpen className="mr-2 h-4 w-4" />}
              Dropzone pack
            </Button>
            <Button
              onClick={() => robertNextActionsMutation.mutate()}
              disabled={robertNextActionsMutation.isPending || isLoading}
              className="bg-amber-200 text-zinc-950 hover:bg-amber-100"
              data-testid="prepare-clippers-robert-next-actions-button"
            >
              {robertNextActionsMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Target className="mr-2 h-4 w-4" />}
              Next actions
            </Button>
            <Button
              onClick={() => launchEvidenceFixPackMutation.mutate()}
              disabled={launchEvidenceFixPackMutation.isPending || isLoading}
              className="bg-yellow-200 text-zinc-950 hover:bg-yellow-100"
              data-testid="prepare-clippers-launch-evidence-fix-pack-button"
            >
              {launchEvidenceFixPackMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
              Evidence fixes
            </Button>
            <Button
              onClick={() => localDropSyncMutation.mutate()}
              disabled={localDropSyncMutation.isPending || isLoading}
              className="bg-cyan-200 text-zinc-950 hover:bg-cyan-100"
              data-testid="run-clippers-local-drop-sync-button"
            >
              {localDropSyncMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
              Local sync
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
              onClick={() => accountSetupSessionMutation.mutate()}
              disabled={accountSetupSessionMutation.isPending || isLoading}
              className="bg-lime-200 text-zinc-950 hover:bg-lime-100"
              data-testid="prepare-clippers-account-setup-session-button"
            >
              {accountSetupSessionMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Network className="mr-2 h-4 w-4" />}
              Account setup
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
              onClick={() => permissionSubmissionDossierMutation.mutate()}
              disabled={permissionSubmissionDossierMutation.isPending || isLoading}
              className="bg-cyan-200 text-zinc-950 hover:bg-cyan-100"
              data-testid="prepare-clippers-permission-submission-dossier-button"
            >
              {permissionSubmissionDossierMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Network className="mr-2 h-4 w-4" />}
              Permission dossier
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
              onClick={() => publisherExecutionQueueMutation.mutate()}
              disabled={publisherExecutionQueueMutation.isPending || isLoading}
              className="bg-cyan-200 text-zinc-950 hover:bg-cyan-100"
              data-testid="prepare-clippers-publisher-execution-queue-button"
            >
              {publisherExecutionQueueMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
              Execution queue
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

        {goLiveTunnelStages.length > 0 && (
          <Card className="border-zinc-800 bg-zinc-950/70" data-testid="clippers-go-live-tunnel">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base text-white">
                <Network className="h-4 w-4 text-cyan-200" />
                Go-Live Tunnel
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-md border border-cyan-300/15 bg-cyan-950/10 p-3">
                <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
                  <div className="min-w-0">
                    <p className="font-medium text-white">Mapa conectado de desbloqueo</p>
                    <p className="mt-1 text-xs leading-5 text-zinc-500">
                      Cada caja depende de la anterior: primero inputs locales, luego cuentas/permisos/OAuth, despues fuentes, publish y reportes.
                    </p>
                  </div>
                  <Badge className={cn("w-fit border", commandCenterBadge(status?.commandCenter?.status || "blocked"))}>
                    {status?.commandCenter?.status || "blocked"}
                  </Badge>
                </div>
              </div>
              <div className="grid gap-x-3 gap-y-7 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-9">
                {goLiveTunnelStages.map((stage, index) => {
                  const progress = stage.total > 0 ? Math.min(100, Math.round((stage.done / stage.total) * 100)) : 0;
                  return (
                    <div key={stage.id} className="relative min-h-[186px] rounded-md border border-white/10 bg-black/30 p-3">
                      {index < goLiveTunnelStages.length - 1 && (
                        <>
                          <div className="pointer-events-none absolute left-1/2 top-[calc(100%-1px)] z-10 flex h-7 w-4 -translate-x-1/2 flex-col items-center md:hidden">
                            <div className="w-[2px] flex-1 rounded-full bg-cyan-300/30" />
                            <ArrowRight className="h-3 w-3 rotate-90 text-cyan-200/80" />
                          </div>
                          <div className="pointer-events-none absolute left-[calc(100%-2px)] top-1/2 z-10 hidden h-3 w-7 -translate-y-1/2 items-center md:flex 2xl:w-6">
                            <div className="h-[2px] flex-1 rounded-full bg-cyan-300/30" />
                            <ArrowRight className="h-3 w-3 text-cyan-200/80" />
                          </div>
                        </>
                      )}
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-xs font-semibold uppercase text-cyan-100">{stage.label}</p>
                          <p className="mt-1 text-lg font-semibold text-white">{stage.done}/{stage.total}</p>
                        </div>
                        <Badge className={cn("shrink-0 border text-[10px]", goLiveTunnelBadge(stage.status))}>{stage.status}</Badge>
                      </div>
                      <Progress value={progress} className="mt-3 h-1.5 bg-white/10 [&>div]:bg-cyan-200" />
                      <p className="mt-3 text-xs leading-5 text-zinc-400">{stage.detail}</p>
                      <p className="mt-2 line-clamp-2 text-xs leading-5 text-amber-200">{stage.nextStep}</p>
                      {stage.artifactPath && (
                        <p className="mt-2 truncate text-[11px] text-zinc-600">{stage.artifactPath}</p>
                      )}
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}

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

        {status?.goLiveOperatorBrief && (
          <Card className="border-zinc-800 bg-zinc-950/70" data-testid="clippers-go-live-operator-brief">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base text-white">
                <Target className="h-4 w-4 text-cyan-200" />
                Go-Live Operator Brief
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-md border border-cyan-300/20 bg-cyan-950/10 p-3">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-white">{status.goLiveOperatorBrief.currentFocus}</p>
                    <p className="mt-1 text-xs leading-5 text-zinc-500">{status.goLiveOperatorBrief.nextStep}</p>
                    <p className="mt-2 break-all text-xs text-zinc-600">Brief: {status.goLiveOperatorBrief.markdownPath}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge className={cn("w-fit border", goLiveOperatorBriefBadge(status.goLiveOperatorBrief.status))}>{status.goLiveOperatorBrief.status}</Badge>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 border-cyan-300/20 bg-transparent px-2 text-xs text-cyan-100 hover:bg-cyan-300/10"
                      onClick={() => goLiveOperatorBriefMutation.mutate()}
                      disabled={goLiveOperatorBriefMutation.isPending || isLoading}
                      data-testid="refresh-clippers-go-live-operator-brief-button"
                    >
                      {goLiveOperatorBriefMutation.isPending ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <RefreshCw className="mr-1 h-3 w-3" />}
                      Refresh
                    </Button>
                  </div>
                </div>
                <div className="mt-3 grid gap-2 text-xs text-zinc-500 md:grid-cols-6">
                  <p>Lanes: {status.goLiveOperatorBrief.totals.lanes}</p>
                  <p>Ready: {status.goLiveOperatorBrief.totals.ready}</p>
                  <p>Action: {status.goLiveOperatorBrief.totals.needsAction}</p>
                  <p>Blocked: {status.goLiveOperatorBrief.totals.blocked}</p>
                  <p>Accounts: {status.goLiveOperatorBrief.totals.accountConnectionsReady}/{status.goLiveOperatorBrief.totals.accountConnectionsTotal}</p>
                  <p>Missing assets: {status.goLiveOperatorBrief.totals.sourceAssetsMissing}</p>
                </div>
                {status.goLiveOperatorBrief.generatedAt && (
                  <p className="mt-2 text-xs text-zinc-600">actualizado: {formatDate(status.goLiveOperatorBrief.generatedAt)}</p>
                )}
              </div>

              <div className={cn(tunnelGridClass, "grid gap-3 md:grid-cols-2 xl:grid-cols-5")}>
                {status.goLiveOperatorBrief.lanes.map((lane) => (
                  <div key={lane.id} className={tunnelBoxClass}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-xs font-medium text-white">{lane.label}</p>
                        <p className="mt-1 text-xs text-zinc-600">{lane.owner} · {lane.priority}</p>
                      </div>
                      <Badge className={cn("shrink-0 border text-[10px]", goLiveOperatorBriefBadge(lane.status))}>{lane.status}</Badge>
                    </div>
                    <p className="mt-3 text-lg font-semibold text-white">{lane.done}/{lane.total}</p>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
                      <div
                        className={cn(
                          "h-full rounded-full",
                          lane.status === "ready" ? "bg-emerald-300" : lane.status === "needs_action" ? "bg-amber-300" : "bg-red-300",
                        )}
                        style={{ width: `${lane.total ? Math.min(100, Math.round((lane.done / lane.total) * 100)) : 0}%` }}
                      />
                    </div>
                    <p className="mt-3 line-clamp-3 text-xs leading-4 text-zinc-500">{lane.nextStep}</p>
                    {lane.blockers[0] && (
                      <p className="mt-3 line-clamp-3 text-xs leading-4 text-red-100/80">{lane.blockers[0]}</p>
                    )}
                    <div className="mt-3 flex flex-wrap gap-1">
                      <Badge className="border border-white/10 bg-black/30 text-[10px] text-zinc-300">{lane.portalUrls.length} portals</Badge>
                      <Badge className="border border-white/10 bg-black/30 text-[10px] text-zinc-300">{lane.evidenceRows.length} rows</Badge>
                    </div>
                    {lane.evidenceRows.length > 0 && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="mt-3 h-7 border-green-300/20 bg-transparent px-2 text-xs text-green-100 hover:bg-green-300/10"
                        onClick={() => appendLaunchEvidenceBatchRows(lane.evidenceRows)}
                      >
                        <UploadCloud className="mr-1 h-3 w-3" />
                        Usar rows
                      </Button>
                    )}
                    {lane.portalUrls[0] && (
                      <a href={lane.portalUrls[0]} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1 break-all text-[11px] leading-4 text-cyan-200 hover:text-cyan-100">
                        Open portal
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                    <p className="mt-3 break-all text-[11px] leading-4 text-zinc-600">{lane.artifactPath}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {status?.goLiveCompletionAudit && (
          <Card className="border-zinc-800 bg-zinc-950/70">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base text-white">
                <CheckCircle2 className="h-4 w-4 text-emerald-200" />
                Go-Live Completion Audit
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-md border border-emerald-300/20 bg-emerald-950/10 p-3">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-white">{status.goLiveCompletionAudit.markdownPath}</p>
                    <p className="mt-1 text-xs leading-5 text-zinc-500">{status.goLiveCompletionAudit.nextStep}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge className={cn("w-fit border", goLiveCompletionAuditBadge(status.goLiveCompletionAudit.status))}>{status.goLiveCompletionAudit.status}</Badge>
                    <Badge className={cn("w-fit border", status.goLiveCompletionAudit.readyToPublish ? "border-emerald-300/30 bg-emerald-300/10 text-emerald-200" : "border-red-300/30 bg-red-300/10 text-red-200")}>
                      {status.goLiveCompletionAudit.readyToPublish ? "ready_to_publish" : "not_ready"}
                    </Badge>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 border-cyan-300/20 bg-transparent px-2 text-xs text-cyan-100 hover:bg-cyan-300/10"
                      onClick={() => goLiveAuditActionsMutation.mutate(status.goLiveCompletionAudit.requirements)}
                      disabled={goLiveAuditActionsMutation.isPending || goLiveAuditActionMutation.isPending || isLoading}
                      data-testid="run-all-clippers-completion-actions-button"
                    >
                      {goLiveAuditActionsMutation.isPending ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Play className="mr-1 h-3 w-3" />}
                      Run all local actions
                    </Button>
                  </div>
                </div>
                <div className="mt-3 grid gap-2 text-xs text-zinc-500 md:grid-cols-6">
                  <p>Score: {status.goLiveCompletionAudit.score}</p>
                  <p>Reqs: {status.goLiveCompletionAudit.totals.requirements}</p>
                  <p>Verified: {status.goLiveCompletionAudit.totals.verified}</p>
                  <p>Needs evidence: {status.goLiveCompletionAudit.totals.needsEvidence}</p>
                  <p>Blocked: {status.goLiveCompletionAudit.totals.blocked}</p>
                  <p>External: {status.goLiveCompletionAudit.totals.externalRequired}</p>
                </div>
                {status.goLiveCompletionAudit.generatedAt && (
                  <p className="mt-2 text-xs text-zinc-600">actualizado: {formatDate(status.goLiveCompletionAudit.generatedAt)}</p>
                )}
              </div>

              {status.goLiveCompletionAudit.externalSession?.length > 0 && (
                <div className="rounded-md border border-cyan-300/20 bg-cyan-950/10 p-3">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div className="min-w-0">
                      <p className="font-medium text-white">External Go-Live Session</p>
                      <p className="mt-1 text-xs leading-5 text-zinc-500">Requisitos bloqueados conectados a portales, evidencia y verificacion.</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge className="w-fit border border-cyan-300/30 bg-cyan-300/10 text-cyan-100">
                        {status.goLiveCompletionAudit.totals.externalSessionItems} steps
                      </Badge>
                      <Badge className="w-fit border border-cyan-300/30 bg-cyan-300/10 text-cyan-100">
                        {status.goLiveCompletionAudit.totals.externalSessionPortalUrls} portals
                      </Badge>
                      <Badge className="w-fit border border-cyan-300/30 bg-cyan-300/10 text-cyan-100">
                        {status.goLiveCompletionAudit.totals.externalSessionEvidenceRows} evidence rows
                      </Badge>
                      {status.goLiveCompletionAudit.externalSession.some((item) => item.evidenceRows.length > 0) && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 border-green-300/20 bg-transparent px-2 text-xs text-green-100 hover:bg-green-300/10"
                          onClick={() => appendLaunchEvidenceBatchRows(status.goLiveCompletionAudit.externalSession.flatMap((item) => item.evidenceRows))}
                        >
                          <UploadCloud className="mr-1 h-3 w-3" />
                          Usar evidence rows
                        </Button>
                      )}
                    </div>
                  </div>
                  <p className="mt-2 break-all text-xs text-zinc-600">CSV: {status.goLiveCompletionAudit.externalSessionCsvPath}</p>
                  <div className={cn(tunnelGridClass, "mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-5")}>
                    {status.goLiveCompletionAudit.externalSession.map((item) => (
                      <div key={item.id} className={tunnelBoxClass}>
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate text-xs font-medium text-white">{item.rank}. {item.label}</p>
                            <p className="mt-1 text-xs text-zinc-600">{item.phase} · {item.owner}</p>
                          </div>
                          <Badge className={cn("shrink-0 border text-[10px]", goLiveCompletionAuditBadge(item.status))}>{item.status}</Badge>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <Badge className="border border-white/10 bg-black/30 text-[10px] text-zinc-300">{item.lane}</Badge>
                          <Badge className="border border-white/10 bg-black/30 text-[10px] text-zinc-300">{item.portalUrls.length} portals</Badge>
                          <Badge className="border border-white/10 bg-black/30 text-[10px] text-zinc-300">{item.evidenceRows.length} rows</Badge>
                        </div>
                        <p className="mt-3 text-xs leading-5 text-amber-200">{item.nextStep}</p>
                        <p className="mt-2 break-all text-[11px] leading-4 text-zinc-600">Proof file: {item.evidenceDropFileName}</p>
                        <p className="mt-1 break-all text-[11px] leading-4 text-zinc-700">Path: {item.evidenceDropPath}</p>
                        {item.operatorSteps.length > 0 && (
                          <ul className="mt-3 space-y-1 text-xs leading-4 text-zinc-500">
                            {item.operatorSteps.slice(0, 3).map((step) => (
                              <li key={step}>{step}</li>
                            ))}
                          </ul>
                        )}
                        {item.portalUrls[0] && (
                          <a href={item.portalUrls[0]} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1 break-all text-[11px] leading-4 text-cyan-200 hover:text-cyan-100">
                            Open portal
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                        {item.evidenceRows.length > 0 && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="mt-3 h-7 border-green-300/20 bg-transparent px-2 text-xs text-green-100 hover:bg-green-300/10"
                            onClick={() => appendLaunchEvidenceBatchRows(item.evidenceRows)}
                          >
                            <UploadCloud className="mr-1 h-3 w-3" />
                            Usar rows
                          </Button>
                        )}
                        {item.evidenceCaptureTemplate && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="mt-2 h-7 border-cyan-300/20 bg-transparent px-2 text-xs text-cyan-100 hover:bg-cyan-300/10"
                            onClick={() => void copyGoLiveEvidenceTemplate(item.evidenceCaptureTemplate, item.evidenceDropFileName)}
                          >
                            <Copy className="mr-1 h-3 w-3" />
                            Copy proof template
                          </Button>
                        )}
                        <p className="mt-3 break-all text-[11px] leading-4 text-zinc-600">{item.artifactPath}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {status.goLiveCompletionAudit.requirements.map((requirement) => (
                  <div key={requirement.id} className="rounded-md border border-white/10 bg-black/30 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-xs font-medium text-white">{requirement.label}</p>
                        <p className="mt-1 text-xs text-zinc-600">{requirement.phase} · {requirement.owner}</p>
                      </div>
                      <Badge className={cn("shrink-0 border text-[10px]", goLiveCompletionAuditBadge(requirement.status))}>{requirement.status}</Badge>
                    </div>
                    <p className="mt-3 text-xs leading-5 text-zinc-500">{requirement.currentEvidence}</p>
                    <p className="mt-2 text-xs leading-5 text-amber-200">{requirement.nextStep}</p>
                    {requirement.blockers.length > 0 && (
                      <div className="mt-3 rounded-md border border-red-300/15 bg-red-950/10 p-2">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-red-200">Main blocker</p>
                        <p className="mt-1 line-clamp-3 text-xs leading-4 text-red-100/80">{requirement.blockers[0]}</p>
                      </div>
                    )}
                    {requirement.requiredEvidence.length > 0 && (
                      <div className="mt-3 rounded-md border border-emerald-300/15 bg-emerald-950/10 p-2">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-200">Evidence needed</p>
                        <p className="mt-1 line-clamp-2 text-xs leading-4 text-emerald-100/80">{requirement.requiredEvidence[0]}</p>
                      </div>
                    )}
                    <p className="mt-3 break-all text-[11px] leading-4 text-zinc-600">{requirement.proofSource}</p>
                    {requirement.actionUrl && (
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        {requirement.actionUrl.startsWith("/api/clippers/") ? (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 border-cyan-300/20 bg-transparent px-2 text-xs text-cyan-100 hover:bg-cyan-300/10"
                            onClick={() => goLiveAuditActionMutation.mutate(requirement)}
                            disabled={goLiveAuditActionMutation.isPending || goLiveAuditActionsMutation.isPending || isLoading}
                            data-testid={`run-clippers-completion-action-${requirement.id}`}
                          >
                            {goLiveAuditActionMutation.isPending ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Play className="mr-1 h-3 w-3" />}
                            Run local action
                          </Button>
                        ) : (
                          <a href={requirement.actionUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md border border-cyan-300/20 px-2 py-1 text-xs text-cyan-100 hover:bg-cyan-300/10">
                            Open action
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                        <p className="break-all text-[11px] leading-4 text-cyan-200">{requirement.actionUrl}</p>
                      </div>
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
                <div className="mt-3 grid gap-2 text-xs text-zinc-500 md:grid-cols-7">
                  <p>Actions: {status.goLiveAutopilotBrief.totals.actions}</p>
                  <p>Sessions: {status.goLiveAutopilotBrief.totals.agentSessions}</p>
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

              {status.goLivePrepSweep && (
                <div className="rounded-md border border-teal-300/20 bg-teal-950/10 p-3" data-testid="clippers-go-live-prep-sweep">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-white">Prep Sweep: {status.goLivePrepSweep.markdownPath}</p>
                      <p className="mt-1 text-xs leading-5 text-zinc-500">{status.goLivePrepSweep.nextStep}</p>
                    </div>
                    <Badge className={cn("w-fit border", goLiveAutopilotBadge(status.goLivePrepSweep.status))}>{status.goLivePrepSweep.status}</Badge>
                  </div>
                  <div className="mt-3 grid gap-2 text-xs text-zinc-500 md:grid-cols-4">
                    <p>Attempted: {status.goLivePrepSweep.totals.attempted}</p>
                    <p>Completed: {status.goLivePrepSweep.totals.completed}</p>
                    <p>Skipped: {status.goLivePrepSweep.totals.skipped}</p>
                    <p>Failed: {status.goLivePrepSweep.totals.failed}</p>
                  </div>
                  {status.goLivePrepSweep.localDropSync && (
                    <div className="mt-3 rounded-md border border-white/10 bg-black/30 p-2 text-xs text-zinc-500">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <p className="font-medium text-teal-100">Local Drop Sync incluido</p>
                        <Badge className={cn("w-fit border text-[10px]", goLiveAutopilotBadge(status.goLivePrepSweep.localDropSync.status))}>{status.goLivePrepSweep.localDropSync.status}</Badge>
                      </div>
                      <div className="mt-2 grid gap-1 sm:grid-cols-4">
                        <p>Attempted: {status.goLivePrepSweep.localDropSync.totals.attempted}</p>
                        <p>Completed: {status.goLivePrepSweep.localDropSync.totals.completed}</p>
                        <p>Skipped: {status.goLivePrepSweep.localDropSync.totals.skipped}</p>
                        <p>Failed: {status.goLivePrepSweep.localDropSync.totals.failed}</p>
                      </div>
                    </div>
                  )}
                  {status.goLivePrepSweep.items.length > 0 && (
                    <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
                      {status.goLivePrepSweep.items.map((item) => (
                        <div key={`${item.id}-${item.startedAt}`} className="rounded-md border border-white/10 bg-black/30 p-2">
                          <div className="flex items-center justify-between gap-2">
                            <p className="truncate text-xs font-medium text-white">{item.label}</p>
                            <Badge className={cn("shrink-0 border text-[10px]", goLiveAutopilotBadge(item.status))}>{item.status}</Badge>
                          </div>
                          <p className="mt-2 line-clamp-3 text-xs leading-5 text-zinc-500">{item.message}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {status.ownerConnectPack && (
                <div className="rounded-md border border-sky-300/20 bg-sky-950/10 p-3" data-testid="clippers-owner-connect-pack">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-white">Owner Connect Pack: {status.ownerConnectPack.markdownPath}</p>
                      <p className="mt-1 text-xs leading-5 text-zinc-500">{status.ownerConnectPack.nextStep}</p>
                    </div>
                    <Badge className={cn("w-fit border", goLiveAutopilotBadge(status.ownerConnectPack.status))}>{status.ownerConnectPack.status}</Badge>
                  </div>
                  <div className="mt-3 grid gap-2 text-xs text-zinc-500 md:grid-cols-4 xl:grid-cols-10">
                    <p>Items: {status.ownerConnectPack.totals.items}</p>
                    <p>Ready: {status.ownerConnectPack.totals.readyToExecute}</p>
                    <p>Blocked: {status.ownerConnectPack.totals.blocked}</p>
                    <p>Waiting: {status.ownerConnectPack.totals.waiting}</p>
                    <p>Done: {status.ownerConnectPack.totals.done}</p>
                    <p>Portals: {status.ownerConnectPack.totals.portalUrls}</p>
                    <p>Rows: {status.ownerConnectPack.totals.evidenceRows}</p>
                    <p>Drops: {status.ownerConnectPack.totals.dropDirs}</p>
                    <p>Tracked: {status.ownerConnectPack.totals.progressRecords}</p>
                    <p>Local done: {status.ownerConnectPack.totals.progressDone}</p>
                  </div>
                  <p className="mt-2 break-all text-xs text-zinc-600">CSV: {status.ownerConnectPack.csvPath}</p>
                  <p className="mt-1 break-all text-xs text-zinc-600">Progress: {status.ownerConnectPack.progressRecordsPath}</p>
                  <div className="mt-3 grid gap-2 text-[11px] leading-4 text-sky-100/70 md:grid-cols-2">
                    <p className="break-all">Account pack: {status.ownerConnectPack.sourceArtifacts.accountCreationPackPath}</p>
                    <p className="break-all">Developer apps: {status.ownerConnectPack.sourceArtifacts.developerApplicationDraftsPath}</p>
                    <p className="break-all">Permissions: {status.ownerConnectPack.sourceArtifacts.permissionRequestPackPath}</p>
                    <p className="break-all">External session: {status.ownerConnectPack.sourceArtifacts.externalExecutionSessionPath}</p>
                    <p className="break-all">Evidence drop: {status.ownerConnectPack.sourceArtifacts.ownerConnectEvidenceDropPath}</p>
                  </div>
                  {status.ownerConnectPack.items.length > 0 && (
                    <div className={cn(tunnelGridClass, "mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3")}>
                      {status.ownerConnectPack.items.slice(0, 9).map((item) => (
                        <div key={item.id} className={cn(tunnelBoxClass, "bg-black/30 p-2")}>
                          <div className="flex items-center justify-between gap-2">
                            <p className="truncate text-xs font-medium text-white">{item.rank}. {item.label}</p>
                            <Badge className={cn("shrink-0 border text-[10px]", goLiveAutopilotBadge(item.status))}>{item.status}</Badge>
                          </div>
                          <div className="mt-2 flex flex-wrap gap-1">
                            <Badge className="border border-sky-300/20 bg-sky-950/40 text-[10px] text-sky-100">{item.lane}</Badge>
                            <Badge className="border border-white/10 bg-white/5 text-[10px] text-zinc-300">{item.platform}</Badge>
                          </div>
                          <p className="mt-2 line-clamp-3 text-xs leading-5 text-zinc-500">{item.nextStep}</p>
                          {item.progressStatus && (
                            <p className="mt-2 line-clamp-2 text-[11px] leading-4 text-emerald-100/80">
                              Progress: {item.progressStatus}{item.progressRecordedAt ? ` - ${item.progressRecordedAt}` : ""}{item.progressNotes ? ` - ${item.progressNotes}` : ""}
                            </p>
                          )}
                          {item.portalUrl && (
                            <a href={item.portalUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-xs text-sky-200 hover:text-white">
                              Open portal
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          )}
                          {item.evidenceRows.length > 0 && (
                            <div className="mt-2 space-y-2">
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="h-7 border-green-300/20 bg-transparent px-2 text-[11px] text-green-100 hover:bg-green-300/10"
                                onClick={() => appendLaunchEvidenceBatchRows(item.evidenceRows)}
                              >
                                <UploadCloud className="mr-1 h-3 w-3" />
                                Use evidence row
                              </Button>
                              <p className="line-clamp-2 break-all font-mono text-[10px] leading-4 text-zinc-600">{item.evidenceRows[0]}</p>
                            </div>
                          )}
                          {item.dropDirs.length > 0 && <p className="mt-2 line-clamp-2 text-[11px] leading-4 text-cyan-100/70">{item.dropDirs.join(" | ")}</p>}
                          <div className="mt-3 flex flex-wrap gap-2">
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="h-7 border-amber-300/30 bg-amber-950/20 px-2 text-[11px] text-amber-100 hover:bg-amber-900/30"
                              disabled={ownerConnectProgressMutation.isPending}
                              onClick={() => ownerConnectProgressMutation.mutate({
                                itemId: item.id,
                                status: "waiting",
                                notes: "Marcado en progreso desde UI; completar portal/evidencia real.",
                                evidenceRows: item.evidenceRows.slice(0, 1),
                              })}
                            >
                              {ownerConnectProgressMutation.isPending ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Play className="mr-1 h-3 w-3" />}
                              Working
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="h-7 border-emerald-300/30 bg-emerald-950/20 px-2 text-[11px] text-emerald-100 hover:bg-emerald-900/30"
                              disabled={ownerConnectProgressMutation.isPending}
                              onClick={() => ownerConnectProgressMutation.mutate({
                                itemId: item.id,
                                status: "done",
                                notes: "Marcado completado localmente; importar evidencia real para desbloquear go-live.",
                                evidenceRows: item.evidenceRows.slice(0, 1),
                              })}
                            >
                              {ownerConnectProgressMutation.isPending ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <CheckCircle2 className="mr-1 h-3 w-3" />}
                              Done local
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {status.dropzoneReadyPack && (
                <div className="rounded-md border border-cyan-300/20 bg-cyan-950/10 p-3" data-testid="clippers-dropzone-ready-pack">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-white">Dropzone Ready Pack: {status.dropzoneReadyPack.markdownPath}</p>
                      <p className="mt-1 text-xs leading-5 text-zinc-500">{status.dropzoneReadyPack.nextStep}</p>
                    </div>
                    <Badge className={cn("w-fit border", goLiveAutopilotBadge(status.dropzoneReadyPack.status))}>{status.dropzoneReadyPack.status}</Badge>
                  </div>
                  <div className="mt-3 grid gap-2 text-xs text-zinc-500 md:grid-cols-4 xl:grid-cols-7">
                    <p>Items: {status.dropzoneReadyPack.totals.items}</p>
                    <p>Ready: {status.dropzoneReadyPack.totals.ready}</p>
                    <p>Partial: {status.dropzoneReadyPack.totals.partial}</p>
                    <p>Missing: {status.dropzoneReadyPack.totals.missing}</p>
                    <p>Critical: {status.dropzoneReadyPack.totals.critical}</p>
                    <p>Dirs: {status.dropzoneReadyPack.totals.dropDirs}</p>
                    <p>Files: {status.dropzoneReadyPack.totals.expectedFiles}</p>
                  </div>
                  <p className="mt-2 break-all text-xs text-zinc-600">CSV: {status.dropzoneReadyPack.csvPath}</p>
                  <div className={cn(tunnelGridClass, "mt-3 grid gap-3 md:grid-cols-3")}>
                    {status.dropzoneReadyPack.items.map((item) => (
                      <div key={item.id} className={cn(tunnelBoxClass, "bg-black/30 p-2")}>
                        <div className="flex items-center justify-between gap-2">
                          <p className="truncate text-xs font-medium text-white">{item.rank}. {item.label}</p>
                          <Badge className={cn("shrink-0 border text-[10px]", goLiveAutopilotBadge(item.status))}>{item.status}</Badge>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-1">
                          <Badge className="border border-cyan-300/20 bg-cyan-950/40 text-[10px] text-cyan-100">{item.lane}</Badge>
                          <Badge className="border border-white/10 bg-white/5 text-[10px] text-zinc-300">{item.priority}</Badge>
                        </div>
                        <p className="mt-2 line-clamp-3 text-xs leading-5 text-zinc-500">{item.nextStep}</p>
                        <p className="mt-2 line-clamp-2 text-[11px] leading-4 text-cyan-100/70">{item.dropDirs.join(" | ")}</p>
                        {item.expectedFiles.length > 0 && <p className="mt-1 line-clamp-2 break-all text-[11px] leading-4 text-zinc-600">{item.expectedFiles.slice(0, 3).join(" | ")}</p>}
                        {item.copyReadyTemplate && (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="mt-3 h-7 border-cyan-300/20 bg-transparent px-2 text-[11px] text-cyan-100 hover:bg-cyan-300/10"
                            onClick={() => {
                              if (item.lane === "credentials") setCredentialBatchText(item.copyReadyTemplate);
                              if (item.lane === "launch_evidence") {
                                setLaunchEvidenceBatchPreview(null);
                                setLaunchEvidenceBatchText(item.copyReadyTemplate);
                              }
                              if (item.lane === "source_videos") appendSourceIntakeBatchRows(item.copyReadyTemplate.split("\n").filter((row) => row.trim() && !row.startsWith("kind,")));
                            }}
                          >
                            <UploadCloud className="mr-1 h-3 w-3" />
                            Use template
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {status.robertNextActions && (
                <div className="rounded-md border border-amber-300/20 bg-amber-950/10 p-3" data-testid="clippers-robert-next-actions">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-white">Robert Next Actions: {status.robertNextActions.markdownPath}</p>
                      <p className="mt-1 text-xs leading-5 text-zinc-500">{status.robertNextActions.nextStep}</p>
                    </div>
                    <Badge className={cn("w-fit border", goLiveAutopilotBadge(status.robertNextActions.status))}>{status.robertNextActions.status}</Badge>
                  </div>
                  <div className="mt-3 grid gap-2 text-xs text-zinc-500 md:grid-cols-4 xl:grid-cols-8">
                    <p>Actions: {status.robertNextActions.totals.actions}</p>
                    <p>Critical: {status.robertNextActions.totals.critical}</p>
                    <p>High: {status.robertNextActions.totals.high}</p>
                    <p>Local: {status.robertNextActions.totals.localDrop}</p>
                    <p>External: {status.robertNextActions.totals.externalPortal}</p>
                    <p>Evidence: {status.robertNextActions.totals.evidence}</p>
                    <p>Sources: {status.robertNextActions.totals.sourceSupply}</p>
                    <p>Minutes: {status.robertNextActions.totals.estimatedMinutes}</p>
                  </div>
                  <p className="mt-2 break-all text-xs text-zinc-600">CSV: {status.robertNextActions.csvPath}</p>
                  {status.robertNextActions.connectNow && (
                    <div className="mt-3 rounded-md border border-amber-300/15 bg-black/30 p-3 text-xs text-zinc-500">
                      <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
                        <div className="min-w-0">
                          <p className="font-medium text-amber-100">Connect Now handoff</p>
                          <p className="mt-1 break-all text-zinc-600">{status.robertNextActions.connectNow.markdownPath}</p>
                        </div>
                        <Badge className="w-fit border border-amber-300/20 bg-amber-950/30 text-amber-100">
                          {status.robertNextActions.connectNow.sourceAssetsRequired} sources
                        </Badge>
                      </div>
                      <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
                        <p className="break-all">Evidence template: {status.robertNextActions.connectNow.evidenceTemplatePath}</p>
                        <p className="break-all">Import target: {status.robertNextActions.connectNow.evidenceImportPath}</p>
                        <p className="break-all">Credentials: {status.robertNextActions.connectNow.pendingCredentialEnvVars.join(", ") || "none"}</p>
                        <p className="break-all">Drop dirs: {status.robertNextActions.connectNow.credentialDropDirs.join(" | ")}</p>
                      </div>
                      {status.robertNextActions.connectNow.connectionTunnel && (
                        <div className="mt-3 rounded-md border border-white/10 bg-zinc-950/40 p-2">
                          <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
                            <div className="min-w-0">
                              <p className="font-medium text-white">Connection tunnel</p>
                              <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-zinc-500">{status.robertNextActions.connectNow.connectionTunnel.nextStep}</p>
                            </div>
                            <div className="flex flex-wrap gap-1">
                              <Badge className={cn("border text-[10px]", goLiveAutopilotBadge(status.robertNextActions.connectNow.connectionTunnel.status))}>
                                {status.robertNextActions.connectNow.connectionTunnel.status}
                              </Badge>
                              <Badge className="border border-white/10 bg-white/5 text-[10px] text-zinc-300">{status.robertNextActions.connectNow.connectionTunnel.progress}%</Badge>
                              <Badge className="border border-rose-300/20 bg-rose-950/30 text-[10px] text-rose-100">{status.robertNextActions.connectNow.connectionTunnel.blockedGates} blocked</Badge>
                            </div>
                          </div>
                          <div className="mt-3 overflow-x-auto pb-1">
                            <div className="flex min-w-max items-stretch gap-2">
                              {status.robertNextActions.connectNow.connectionTunnel.gates.map((gate, gateIndex, gates) => (
                                <div key={`connect-now-tunnel-${gate.id}`} className="flex items-center gap-2">
                                  <div className={cn(
                                    "w-36 rounded-md border p-2",
                                    gate.status === "done"
                                      ? "border-emerald-300/25 bg-emerald-950/20"
                                      : gate.status === "ready_to_execute"
                                        ? "border-sky-300/25 bg-sky-950/20"
                                        : gate.status === "waiting"
                                          ? "border-amber-300/25 bg-amber-950/20"
                                          : "border-rose-300/25 bg-rose-950/20",
                                  )}>
                                    <div className="flex items-start justify-between gap-2">
                                      <p className="truncate text-[11px] font-medium text-white">{gate.rank}. {gate.label}</p>
                                      <Badge className={cn("shrink-0 border px-1 text-[9px]", goLiveAutopilotBadge(gate.status))}>{gate.status}</Badge>
                                    </div>
                                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
                                      <div
                                        className={cn(
                                          "h-full rounded-full",
                                          gate.status === "done" ? "bg-emerald-300" : gate.status === "ready_to_execute" ? "bg-sky-300" : gate.status === "waiting" ? "bg-amber-300" : "bg-rose-300",
                                        )}
                                        style={{ width: `${Math.min(100, Math.round((gate.done / Math.max(1, gate.total)) * 100))}%` }}
                                      />
                                    </div>
                                    <div className="mt-2 flex items-center justify-between gap-2 text-[10px] text-zinc-500">
                                      <span>{gate.done}/{gate.total}</span>
                                      <span>{gate.blockers} blockers</span>
                                    </div>
                                    <p className="mt-1 line-clamp-2 text-[10px] leading-4 text-zinc-500">{gate.actionLabel}</p>
                                    {gate.actionUrl && /^https?:\/\//.test(gate.actionUrl) && (
                                      <a href={gate.actionUrl} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-[10px] text-sky-200 hover:text-white">
                                        Open
                                        <ExternalLink className="h-3 w-3" />
                                      </a>
                                    )}
                                  </div>
                                  {gateIndex < gates.length - 1 && (
                                    <div className="flex h-full items-center text-zinc-600">
                                      <div className="h-px w-6 bg-zinc-700" />
                                      <ArrowRight className="h-3.5 w-3.5" />
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      )}
                      {status.robertNextActions.connectNow.ownershipSplit && (
                        <div className="mt-3 rounded-md border border-cyan-300/15 bg-cyan-950/10 p-2">
                          <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
                            <div className="min-w-0">
                              <p className="font-medium text-cyan-100">Ownership split</p>
                              <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-zinc-500">{status.robertNextActions.connectNow.ownershipSplit.nextRobertAction}</p>
                            </div>
                            <div className="flex flex-wrap gap-1">
                              <Badge className="border border-cyan-300/20 bg-cyan-950/30 text-[10px] text-cyan-100">
                                Robert {status.robertNextActions.connectNow.ownershipSplit.robertReady.length}
                              </Badge>
                              <Badge className="border border-amber-300/20 bg-amber-950/30 text-[10px] text-amber-100">
                                User {status.robertNextActions.connectNow.ownershipSplit.userRequired.length}
                              </Badge>
                            </div>
                          </div>
                          <div className="mt-3 grid gap-2 lg:grid-cols-2">
                            <div className="rounded border border-cyan-300/10 bg-black/20 p-2">
                              <p className="text-[11px] font-medium text-cyan-100">Robert can advance</p>
                              <div className="mt-2 space-y-2">
                                {status.robertNextActions.connectNow.ownershipSplit.robertReady.slice(0, 5).map((item) => (
                                  <div key={`ownership-robert-${item.label}`} className="rounded border border-white/10 bg-zinc-950/40 p-2">
                                    <div className="flex items-start justify-between gap-2">
                                      <p className="text-[11px] font-medium text-white">{item.label}</p>
                                      <Badge className="shrink-0 border border-white/10 bg-white/5 px-1 text-[9px] text-zinc-300">{item.count}</Badge>
                                    </div>
                                    <p className="mt-1 text-[10px] leading-4 text-zinc-500">{item.nextStep}</p>
                                  </div>
                                ))}
                              </div>
                            </div>
                            <div className="rounded border border-amber-300/10 bg-black/20 p-2">
                              <p className="text-[11px] font-medium text-amber-100">User/account required</p>
                              <p className="mt-1 line-clamp-2 text-[10px] leading-4 text-zinc-500">{status.robertNextActions.connectNow.ownershipSplit.nextUserAction}</p>
                              <div className="mt-2 space-y-2">
                                {status.robertNextActions.connectNow.ownershipSplit.userRequired.slice(0, 5).map((item) => (
                                  <div key={`ownership-user-${item.label}`} className="rounded border border-white/10 bg-zinc-950/40 p-2">
                                    <div className="flex items-start justify-between gap-2">
                                      <p className="text-[11px] font-medium text-white">{item.label}</p>
                                      <Badge className="shrink-0 border border-white/10 bg-white/5 px-1 text-[9px] text-zinc-300">{item.count}</Badge>
                                    </div>
                                    <p className="mt-1 text-[10px] leading-4 text-zinc-500">{item.nextStep}</p>
                                  </div>
                                ))}
                              </div>
                            </div>
                          </div>
                          <div className="mt-2 flex flex-wrap gap-1">
                            {status.robertNextActions.connectNow.ownershipSplit.automationUnlockedBy.slice(0, 7).map((item) => (
                              <Badge key={`ownership-unlock-${item}`} className="border border-white/10 bg-white/5 text-[9px] text-zinc-300">
                                {item}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      )}
                      {status.robertNextActions.connectNow.weeklyRunway && (
                        <div className="mt-3 rounded-md border border-lime-300/15 bg-lime-950/10 p-2">
                          <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
                            <div className="min-w-0">
                              <p className="font-medium text-lime-100">100/week runway</p>
                              <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-zinc-500">{status.robertNextActions.connectNow.weeklyRunway.nextStep}</p>
                            </div>
                            <div className="flex flex-wrap gap-1">
                              <Badge className={cn(
                                "border text-[10px]",
                                status.robertNextActions.connectNow.weeklyRunway.status === "ready"
                                  ? "border-emerald-300/30 bg-emerald-300/10 text-emerald-200"
                                  : status.robertNextActions.connectNow.weeklyRunway.status === "needs_connections"
                                    ? "border-cyan-300/20 bg-cyan-950/30 text-cyan-100"
                                    : "border-lime-300/20 bg-lime-950/30 text-lime-100",
                              )}>
                                {status.robertNextActions.connectNow.weeklyRunway.status}
                              </Badge>
                              <Badge className="border border-white/10 bg-white/5 text-[10px] text-zinc-300">
                                {status.robertNextActions.connectNow.weeklyRunway.weeklyReadySlots}/{status.robertNextActions.connectNow.weeklyRunway.targetWeeklyClips}
                              </Badge>
                            </div>
                          </div>
                          <div className="mt-3 grid gap-1 text-[11px] leading-4 text-zinc-500 sm:grid-cols-2 xl:grid-cols-4">
                            <p>Daily baseline: {status.robertNextActions.connectNow.weeklyRunway.plannedDailyClips}</p>
                            <p>Configured/day: {status.robertNextActions.connectNow.weeklyRunway.configuredDailyClipTarget}</p>
                            <p>Missing slots: {status.robertNextActions.connectNow.weeklyRunway.weeklyMissingSlots}</p>
                            <p>Source gap: {status.robertNextActions.connectNow.weeklyRunway.sourceAssetGap}</p>
                            <p>Rights OK: {status.robertNextActions.connectNow.weeklyRunway.rightsReadyAssets}</p>
                            <p>Min assets: {status.robertNextActions.connectNow.weeklyRunway.minimumWeeklySourceAssets}</p>
                            <p>Accounts: {status.robertNextActions.connectNow.weeklyRunway.accountCount}</p>
                            <p>Platforms: {status.robertNextActions.connectNow.weeklyRunway.platformAccountCount}</p>
                          </div>
                          <div className="mt-3 grid gap-2 md:grid-cols-3">
                            {status.robertNextActions.connectNow.weeklyRunway.categories.map((category) => (
                              <div key={`weekly-runway-${category.category}`} className="rounded border border-white/10 bg-black/25 p-2">
                                <div className="flex items-start justify-between gap-2">
                                  <p className="text-[11px] font-medium text-white">{category.label}</p>
                                  <Badge className="shrink-0 border border-lime-300/20 bg-lime-950/30 px-1 text-[9px] text-lime-100">
                                    gap {category.sourceAssetGap}
                                  </Badge>
                                </div>
                                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
                                  <div
                                    className="h-full rounded-full bg-lime-300"
                                    style={{ width: `${Math.min(100, Math.round(((category.minimumWeeklySourceAssets - category.sourceAssetGap) / Math.max(1, category.minimumWeeklySourceAssets)) * 100))}%` }}
                                  />
                                </div>
                                <div className="mt-2 flex items-center justify-between gap-2 text-[10px] text-zinc-500">
                                  <span>{category.weeklyTargetSlots} slots/wk</span>
                                  <span>{category.dailyTarget}/day</span>
                                </div>
                                <p className="mt-1 line-clamp-2 text-[10px] leading-4 text-zinc-500">{category.nextStep}</p>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      {(status.robertNextActions.connectNow.platformLaunchBridge || []).length > 0 && (
                        <div className="mt-3 rounded-md border border-fuchsia-300/15 bg-fuchsia-950/10 p-2">
                          <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
                            <div className="min-w-0">
                              <p className="font-medium text-fuchsia-100">Platform launch bridge</p>
                              <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-zinc-500">Per-platform account, app, permission, OAuth and evidence checklist.</p>
                            </div>
                            <Badge className="w-fit border border-fuchsia-300/20 bg-fuchsia-950/30 text-[10px] text-fuchsia-100">
                              {(status.robertNextActions.connectNow.platformLaunchBridge || []).length} platforms
                            </Badge>
                          </div>
                          <div className="mt-3 grid gap-2 lg:grid-cols-3">
                            {(status.robertNextActions.connectNow.platformLaunchBridge || []).map((platform) => (
                              <div key={`platform-launch-bridge-${platform.platform}`} className="rounded border border-white/10 bg-black/25 p-2">
                                <div className="flex items-start justify-between gap-2">
                                  <div className="min-w-0">
                                    <p className="truncate text-[11px] font-medium text-white">{platform.label}</p>
                                    <p className="mt-1 line-clamp-2 text-[10px] leading-4 text-zinc-500">{platform.nextStep}</p>
                                  </div>
                                  <Badge className={cn("shrink-0 border text-[9px]", goLiveAutopilotBadge(platform.status))}>{platform.status}</Badge>
                                </div>
                                <div className="mt-2 grid gap-1 text-[10px] leading-4 text-zinc-500">
                                  <p className="break-all">Handles: {platform.handles.join(", ") || "none"}</p>
                                  <p className="break-all">Missing env: {platform.missingEnvVars.join(", ") || "none"}</p>
                                  <p className="break-all">Scopes: {platform.scopes.join(", ") || "none"}</p>
                                </div>
                                <div className="mt-2 flex flex-wrap gap-1">
                                  <Badge className="border border-white/10 bg-white/5 text-[9px] text-zinc-300">accounts {platform.accountProofCount}</Badge>
                                  <Badge className="border border-white/10 bg-white/5 text-[9px] text-zinc-300">apps/perms {platform.appPermissionCount}</Badge>
                                  <Badge className="border border-white/10 bg-white/5 text-[9px] text-zinc-300">oauth {platform.oauthCount}</Badge>
                                </div>
                                <div className="mt-2 flex flex-wrap gap-1">
                                  {platform.portalUrls.slice(0, 3).map((portal) => (
                                    <a key={`platform-launch-portal-${platform.platform}-${portal.url}`} href={portal.url} target="_blank" rel="noreferrer" className="inline-flex h-6 max-w-full items-center gap-1 rounded-md border border-fuchsia-300/20 px-1.5 text-[10px] text-fuchsia-100 hover:bg-fuchsia-300/10">
                                      <span className="truncate">{portal.label}</span>
                                      <ExternalLink className="h-3 w-3 shrink-0" />
                                    </a>
                                  ))}
                                  {platform.docsUrls[0] && (
                                    <a href={platform.docsUrls[0]} target="_blank" rel="noreferrer" className="inline-flex h-6 items-center gap-1 rounded-md border border-sky-300/20 px-1.5 text-[10px] text-sky-100 hover:bg-sky-300/10">
                                      Docs
                                      <ExternalLink className="h-3 w-3" />
                                    </a>
                                  )}
                                </div>
                                {platform.evidenceRows.length > 0 && (
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    className="mt-2 h-7 border-fuchsia-300/20 bg-transparent px-2 text-[11px] text-fuchsia-100 hover:bg-fuchsia-300/10"
                                    onClick={() => appendLaunchEvidenceBatchRows(platform.evidenceRows)}
                                  >
                                    <UploadCloud className="mr-1 h-3 w-3" />
                                    Rows
                                  </Button>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      {status.robertNextActions.connectNow.externalPortalLauncher && (
                        <div className="mt-3 rounded-md border border-amber-300/15 bg-amber-950/10 p-2">
                          <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
                            <div className="min-w-0">
                              <p className="font-medium text-amber-100">External portal launcher</p>
                              <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-zinc-500">{status.robertNextActions.connectNow.externalPortalLauncher.nextStep}</p>
                            </div>
                            <div className="flex flex-wrap gap-1">
                              <Badge className="w-fit border border-amber-300/20 bg-amber-950/30 text-[10px] text-amber-100">
                                {status.robertNextActions.connectNow.externalPortalLauncher.doNow} do now
                              </Badge>
                              <Badge className="w-fit border border-rose-300/20 bg-rose-950/30 text-[10px] text-rose-100">
                                {status.robertNextActions.connectNow.externalPortalLauncher.blocked} blocked
                              </Badge>
                            </div>
                          </div>
                          <div className="mt-2 flex flex-wrap gap-2">
                            <a
                              href={status.robertNextActions.connectNow.externalPortalLauncher.url}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex h-7 items-center gap-1 rounded-md border border-amber-300/20 px-2 text-[11px] text-amber-100 hover:bg-amber-300/10"
                            >
                              Open launcher
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          </div>
                          <div className="mt-2 grid gap-2 text-[10px] leading-4 text-zinc-500 sm:grid-cols-2 lg:grid-cols-5">
                            <p>Portals: {status.robertNextActions.connectNow.externalPortalLauncher.totalPortals}</p>
                            <p>Accounts: {status.robertNextActions.connectNow.externalPortalLauncher.accountTasks}</p>
                            <p>Apps: {status.robertNextActions.connectNow.externalPortalLauncher.developerAppTasks}</p>
                            <p>Perms: {status.robertNextActions.connectNow.externalPortalLauncher.permissionTasks}</p>
                            <p>OAuth/env: {status.robertNextActions.connectNow.externalPortalLauncher.oauthTasks + status.robertNextActions.connectNow.externalPortalLauncher.credentialTasks}</p>
                          </div>
                          <p className="mt-2 break-all rounded border border-white/10 bg-black/25 p-2 text-[10px] leading-4 text-amber-100/80">
                            {status.robertNextActions.connectNow.externalPortalLauncher.htmlPath}
                          </p>
                        </div>
                      )}
                      {status.robertNextActions.connectNow.intakeConsole && (
                        <div className="mt-3 rounded-md border border-violet-300/15 bg-violet-950/10 p-2" data-testid="clippers-go-live-intake-console">
                          <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
                            <div className="min-w-0">
                              <p className="font-medium text-violet-100">Go-Live Intake Console</p>
                              <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-zinc-500">{status.robertNextActions.connectNow.intakeConsole.nextStep}</p>
                            </div>
                            <div className="flex flex-wrap items-center gap-1">
                              <Badge className={cn("w-fit border text-[10px]", goLiveAutopilotBadge(status.robertNextActions.connectNow.intakeConsole.status))}>
                                {status.robertNextActions.connectNow.intakeConsole.status}
                              </Badge>
                              <Badge className="w-fit border border-rose-300/20 bg-rose-950/30 text-[10px] text-rose-100">
                                {status.robertNextActions.connectNow.intakeConsole.totals.blockers} blockers
                              </Badge>
                              <Badge className="w-fit border border-white/10 bg-white/5 text-[10px] text-zinc-300">
                                {status.robertNextActions.connectNow.intakeConsole.totals.lanes} lanes
                              </Badge>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="ml-1 h-7 border-violet-300/20 bg-transparent px-2 text-[11px] text-violet-100 hover:bg-violet-300/10"
                                onClick={() => intakeRefreshSweepMutation.mutate()}
                                disabled={intakeRefreshSweepMutation.isPending || postConnectActivationSweepMutation.isPending || goLivePrepSweepMutation.isPending || isLoading}
                                data-testid="run-clippers-intake-refresh-sweep-button"
                              >
                                {intakeRefreshSweepMutation.isPending ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <RefreshCw className="mr-1 h-3 w-3" />}
                                Run intake refresh
                              </Button>
                            </div>
                          </div>
                          <div className="mt-2 grid gap-2 text-[10px] leading-4 text-zinc-500 sm:grid-cols-2 lg:grid-cols-6">
                            <p>Ready: {status.robertNextActions.connectNow.intakeConsole.totals.ready}</p>
                            <p>Partial: {status.robertNextActions.connectNow.intakeConsole.totals.partial}</p>
                            <p>Missing: {status.robertNextActions.connectNow.intakeConsole.totals.missing}</p>
                            <p>Critical: {status.robertNextActions.connectNow.intakeConsole.totals.critical}</p>
                            <p>Dirs: {status.robertNextActions.connectNow.intakeConsole.totals.dropDirs}</p>
                            <p>Files: {status.robertNextActions.connectNow.intakeConsole.totals.expectedFiles}</p>
                          </div>
                          <div className="mt-2 rounded border border-violet-300/10 bg-black/25 p-2">
                            <p className="text-[10px] font-semibold uppercase tracking-wide text-violet-200">Refresh sequence</p>
                            <p className="mt-1 text-[10px] leading-4 text-violet-100/80">{status.robertNextActions.connectNow.intakeConsole.refreshSequence.join(" -> ")}</p>
                          </div>
                          {intakeRefreshSweep && (
                            <div className="mt-2 rounded border border-violet-300/10 bg-black/25 p-2" data-testid="clippers-intake-refresh-sweep-result">
                              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                                <div className="min-w-0">
                                  <p className="text-[10px] font-semibold uppercase tracking-wide text-violet-200">Last intake refresh</p>
                                  <p className="mt-1 line-clamp-2 text-[10px] leading-4 text-zinc-500">{intakeRefreshSweep.nextStep}</p>
                                </div>
                                <Badge className={cn("w-fit border text-[10px]", goLiveAutopilotBadge(intakeRefreshSweep.status))}>{intakeRefreshSweep.status}</Badge>
                              </div>
                              <div className="mt-2 grid gap-1 text-[10px] leading-4 text-zinc-500 sm:grid-cols-2 lg:grid-cols-5">
                                <p>Prep: {intakeRefreshSweep.prepSweepStatus}</p>
                                <p>Local: {intakeRefreshSweep.localDropSyncStatus}</p>
                                <p>Post: {intakeRefreshSweep.postConnectStatus}</p>
                                <p>Completed: {intakeRefreshSweep.completedSteps.length}</p>
                                <p>Blocked/skipped: {intakeRefreshSweep.skippedOrBlockedSteps.length}</p>
                              </div>
                              <p className="mt-2 break-all text-[10px] leading-4 text-violet-100/75">{intakeRefreshSweep.markdownPath}</p>
                            </div>
                          )}
                          <div className="mt-3 grid gap-2 lg:grid-cols-3">
                            {status.robertNextActions.connectNow.intakeConsole.lanes.map((lane) => (
                              <div key={`intake-console-${lane.id}`} className="rounded border border-white/10 bg-black/25 p-2">
                                <div className="flex items-start justify-between gap-2">
                                  <div className="min-w-0">
                                    <p className="truncate text-[11px] font-medium text-white">{lane.rank}. {lane.label}</p>
                                    <p className="mt-1 truncate text-[10px] text-violet-100/80">{lane.lane} / {lane.priority}</p>
                                  </div>
                                  <Badge className={cn("shrink-0 border text-[9px]", goLiveAutopilotBadge(lane.status))}>{lane.status}</Badge>
                                </div>
                                <p className="mt-2 line-clamp-2 text-[10px] leading-4 text-zinc-500">{lane.nextStep}</p>
                                <div className="mt-2 grid gap-1 text-[10px] leading-4 text-zinc-500">
                                  <p>Action: {lane.actionLabel}</p>
                                  <p>Expected: {lane.expectedFilesCount}</p>
                                  <p className="break-all">API: {lane.actionUrl}</p>
                                  {lane.artifactPath && <p className="break-all">Artifact: {lane.artifactPath}</p>}
                                </div>
                                {lane.dropDirs.length > 0 && (
                                  <p className="mt-2 line-clamp-2 break-all text-[10px] leading-4 text-violet-100/75">Dirs: {lane.dropDirs.slice(0, 3).join(" | ")}</p>
                                )}
                                {lane.acceptedFormats.length > 0 && (
                                  <p className="mt-1 line-clamp-2 text-[10px] leading-4 text-zinc-500">Formats: {lane.acceptedFormats.slice(0, 4).join(" | ")}</p>
                                )}
                                {lane.blockers.length > 0 && (
                                  <p className="mt-2 line-clamp-3 text-[10px] leading-4 text-rose-100/80">Blockers: {lane.blockers.slice(0, 3).join(" | ")}</p>
                                )}
                                {lane.unlocks.length > 0 && (
                                  <p className="mt-2 line-clamp-2 text-[10px] leading-4 text-emerald-100/75">Unlocks: {lane.unlocks.slice(0, 3).join(" | ")}</p>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      {(status.robertNextActions.connectNow.postConnectActivationBridge || []).length > 0 && (
                        <div className="mt-3 rounded-md border border-cyan-300/15 bg-cyan-950/10 p-2">
                          <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
                            <div className="min-w-0">
                              <p className="font-medium text-cyan-100">Post-connect activation bridge</p>
                              <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-zinc-500">What becomes local-actionable after accounts, permissions and OAuth are connected.</p>
                            </div>
                            <div className="flex flex-wrap gap-1">
                              <Badge className="w-fit border border-cyan-300/20 bg-cyan-950/30 text-[10px] text-cyan-100">
                                {(status.robertNextActions.connectNow.postConnectActivationBridge || []).length} lanes
                              </Badge>
                              <Badge className="w-fit border border-emerald-300/20 bg-emerald-950/30 text-[10px] text-emerald-100">
                                {(status.robertNextActions.connectNow.postConnectActivationBridge || []).filter((lane) => lane.status === "ready" || lane.status === "activation_ready").length} ready
                              </Badge>
                            </div>
                          </div>
                          <div className="mt-3 grid gap-2 lg:grid-cols-3">
                            {(status.robertNextActions.connectNow.postConnectActivationBridge || []).slice(0, 9).map((lane) => (
                              <div key={`post-connect-activation-${lane.id}`} className="rounded border border-white/10 bg-black/25 p-2">
                                <div className="flex items-start justify-between gap-2">
                                  <div className="min-w-0">
                                    <p className="truncate text-[11px] font-medium text-white">{lane.accountName}</p>
                                    <p className="mt-1 truncate text-[10px] text-cyan-100/80">{lane.handle} / {lane.platform}</p>
                                  </div>
                                  <Badge className={cn(
                                    "shrink-0 border text-[9px]",
                                    lane.status === "ready"
                                      ? "border-emerald-300/30 bg-emerald-300/10 text-emerald-100"
                                      : lane.status === "activation_ready"
                                        ? "border-cyan-300/30 bg-cyan-300/10 text-cyan-100"
                                        : lane.status === "waiting"
                                          ? "border-amber-300/30 bg-amber-300/10 text-amber-100"
                                          : "border-rose-300/30 bg-rose-300/10 text-rose-100",
                                  )}>
                                    {lane.status}
                                  </Badge>
                                </div>
                                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
                                  <div className="h-full rounded-full bg-cyan-300" style={{ width: `${Math.min(100, lane.activationScore)}%` }} />
                                </div>
                                <div className="mt-2 grid gap-1 text-[10px] leading-4 text-zinc-500">
                                  <p>Score: {lane.activationScore}%</p>
                                  <p>Account: {lane.accountProofStatus}</p>
                                  <p>App: {lane.developerAppStatus}</p>
                                  <p>Perms: {lane.permissionsApproved}/{lane.permissionsTotal}</p>
                                  <p>Token: {lane.tokenSaved ? "saved" : lane.oauthStatus}</p>
                                  <p>Publisher: {lane.publisherConnectorStatus}</p>
                                  <p>Queue: {lane.readyQueueItems} ready / {lane.blockedQueueItems} blocked</p>
                                </div>
                                <p className="mt-2 line-clamp-2 text-[10px] leading-4 text-zinc-500">{lane.nextStep}</p>
                                {lane.blockers.length > 0 && (
                                  <p className="mt-1 line-clamp-2 text-[10px] leading-4 text-rose-100/80">{lane.blockers.slice(0, 2).join(" | ")}</p>
                                )}
                                {lane.nextLocalActions.length > 0 && (
                                  <p className="mt-1 line-clamp-2 text-[10px] leading-4 text-cyan-100/75">{lane.nextLocalActions.slice(0, 2).join(" | ")}</p>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      {status.robertNextActions.connectNow.focusRun && (
                        <div className="mt-3 rounded-md border border-emerald-300/15 bg-emerald-950/10 p-2">
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                            <div className="min-w-0">
                              <p className="font-medium text-emerald-100">Focus run: {status.robertNextActions.connectNow.focusRun.label}</p>
                              <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-zinc-500">{status.robertNextActions.connectNow.focusRun.nextStep}</p>
                            </div>
                            <div className="flex flex-wrap gap-1">
                              <Badge className="border border-emerald-300/20 bg-emerald-950/30 text-[10px] text-emerald-100">{status.robertNextActions.connectNow.focusRun.status}</Badge>
                              <Badge className="border border-white/10 bg-white/5 text-[10px] text-zinc-300">{status.robertNextActions.connectNow.focusRun.estimatedMinutes} min</Badge>
                            </div>
                          </div>
                          <div className="mt-2 flex flex-wrap gap-2">
                            {status.robertNextActions.connectNow.focusRun.evidenceRows.length > 0 && (
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="h-7 border-green-300/20 bg-transparent px-2 text-[11px] text-green-100 hover:bg-green-300/10"
                                onClick={() => appendLaunchEvidenceBatchRows(status.robertNextActions.connectNow.focusRun.evidenceRows)}
                              >
                                <UploadCloud className="mr-1 h-3 w-3" />
                                Focus rows
                              </Button>
                            )}
                            {status.robertNextActions.connectNow.focusRun.credentialTemplates.length > 0 && (
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="h-7 border-cyan-300/20 bg-transparent px-2 text-[11px] text-cyan-100 hover:bg-cyan-300/10"
                                onClick={() => {
                                  setCredentialBatchText((current) => `${current.trim() ? `${current.trim()}\n\n` : ""}${status.robertNextActions.connectNow.focusRun.credentialTemplates.join("\n\n")}`);
                                  setCredentialBatchPreview(null);
                                  toast({
                                    title: "Focus env cargado",
                                    description: "Pega valores reales antes de preview/import.",
                                  });
                                }}
                              >
                                <KeyRound className="mr-1 h-3 w-3" />
                                Focus env
                              </Button>
                            )}
                            {status.robertNextActions.connectNow.focusRun.portalUrls.slice(0, 3).map((portalUrl) => (
                              <a key={`connect-now-focus-${portalUrl}`} href={portalUrl} target="_blank" rel="noreferrer" className="inline-flex h-7 items-center gap-1 rounded-md border border-sky-300/20 px-2 text-[11px] text-sky-100 hover:bg-sky-300/10">
                                Portal
                                <ExternalLink className="h-3 w-3" />
                              </a>
                            ))}
                          </div>
                        </div>
                      )}
                      {status.robertNextActions.connectNow.credentialCloseout && (
                        <div className="mt-3 rounded-md border border-cyan-300/15 bg-cyan-950/10 p-2">
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                            <div className="min-w-0">
                              <p className="font-medium text-cyan-100">Credential closeout queue</p>
                              <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-zinc-500">{status.robertNextActions.connectNow.credentialCloseout.nextStep}</p>
                            </div>
                            <div className="flex flex-wrap gap-1">
                              <Badge className={cn("border text-[10px]", status.robertNextActions.connectNow.credentialCloseout.importReady ? "border-emerald-300/30 bg-emerald-300/10 text-emerald-200" : "border-cyan-300/20 bg-cyan-950/30 text-cyan-100")}>
                                {status.robertNextActions.connectNow.credentialCloseout.status}
                              </Badge>
                              <Badge className="border border-white/10 bg-white/5 text-[10px] text-zinc-300">{status.robertNextActions.connectNow.credentialCloseout.pendingEnvVars.length} pending</Badge>
                            </div>
                          </div>
                          <div className="mt-2 grid gap-1 text-[11px] leading-4 text-zinc-500 sm:grid-cols-2 xl:grid-cols-4">
                            <p>Files: {status.robertNextActions.connectNow.credentialCloseout.totals.files}</p>
                            <p>Drop: {status.robertNextActions.connectNow.credentialCloseout.totals.dropCandidates}</p>
                            <p>Eligible: {status.robertNextActions.connectNow.credentialCloseout.totals.importEligible}</p>
                            <p>Templates: {status.robertNextActions.connectNow.credentialCloseout.totals.templateFiles}</p>
                            <p>Accepted: {status.robertNextActions.connectNow.credentialCloseout.acceptedEnvVars.length}</p>
                            <p>Errors: {status.robertNextActions.connectNow.credentialCloseout.totals.fileErrors}</p>
                            <p>Runtime: {status.robertNextActions.connectNow.credentialCloseout.runtimeEnv?.configuredEnvVars.length ?? 0}/{status.robertNextActions.connectNow.credentialCloseout.runtimeEnv?.checkedEnvVars.length ?? 0}</p>
                            <p>Env files: {status.robertNextActions.connectNow.credentialCloseout.runtimeEnv?.localEnvFiles.length ?? 0}</p>
                            <p className="break-all sm:col-span-2">Diagnostic: {status.robertNextActions.connectNow.credentialCloseout.diagnosticPath}</p>
                          </div>
                          <p className="mt-2 break-all text-[11px] leading-4 text-emerald-100/75">
                            Runtime configured: {status.robertNextActions.connectNow.credentialCloseout.runtimeEnv?.configuredEnvVars.join(", ") || "none"}
                          </p>
                          <p className="mt-1 break-all text-[11px] leading-4 text-zinc-500">
                            Runtime missing: {status.robertNextActions.connectNow.credentialCloseout.runtimeEnv?.missingEnvVars.join(", ") || "none"}
                          </p>
                          <p className="mt-2 break-all text-[11px] leading-4 text-cyan-100/75">
                            Pending env: {status.robertNextActions.connectNow.credentialCloseout.pendingEnvVars.join(", ") || "none"}
                          </p>
                          {(status.robertNextActions.connectNow.credentialCloseout.driveCredentialBridge || []).length > 0 && (
                            <div className="mt-2 rounded-md border border-violet-300/15 bg-violet-950/10 p-2">
                              <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                                <p className="text-[11px] font-medium text-violet-100">Drive credential bridge</p>
                                <Badge className="w-fit border border-violet-300/20 bg-violet-950/40 text-[10px] text-violet-100">
                                  {(status.robertNextActions.connectNow.credentialCloseout.driveCredentialBridge || []).length} searches
                                </Badge>
                              </div>
                              <div className="mt-2 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                                {(status.robertNextActions.connectNow.credentialCloseout.driveCredentialBridge || []).slice(0, 6).map((item) => (
                                  <div key={`connect-now-drive-credential-${item.id}`} className="rounded border border-white/10 bg-black/25 p-2">
                                    <div className="flex items-center justify-between gap-2">
                                      <p className="truncate text-[11px] font-medium text-white">{item.label}</p>
                                      <Badge className={cn("border text-[10px]", credentialSetupBadge(item.status))}>{item.status}</Badge>
                                    </div>
                                    <p className="mt-1 break-all text-[11px] leading-4 text-violet-100/75">{item.missingSuggestedEnvVars.join(", ") || "ready"}</p>
                                    <p className="mt-1 line-clamp-2 break-all text-[11px] leading-4 text-zinc-500">{item.localDropFileNames.join(" | ") || item.nextStep}</p>
                                    <div className="mt-2 flex flex-wrap gap-1">
                                      {item.driveSearchQueries.slice(0, 2).map((query, queryIndex) => (
                                        <a
                                          key={`connect-now-drive-credential-${item.id}-${query}`}
                                          href={item.driveSearchUrls[queryIndex] || googleDriveSearchUrl(query)}
                                          target="_blank"
                                          rel="noreferrer"
                                          className="inline-flex h-6 max-w-full items-center gap-1 rounded-md border border-violet-300/20 px-1.5 text-[10px] text-violet-100 hover:bg-violet-300/10"
                                        >
                                          <span className="truncate">Drive {queryIndex + 1}</span>
                                          <ExternalLink className="h-3 w-3 shrink-0" />
                                        </a>
                                      ))}
                                      {item.portalUrl && (
                                        <a href={item.portalUrl} target="_blank" rel="noreferrer" className="inline-flex h-6 items-center gap-1 rounded-md border border-sky-300/20 px-1.5 text-[10px] text-sky-100 hover:bg-sky-300/10">
                                          Portal
                                          <ExternalLink className="h-3 w-3" />
                                        </a>
                                      )}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                          {status.robertNextActions.connectNow.credentialCloseout.files.length > 0 && (
                            <div className="mt-2 grid gap-2 md:grid-cols-2">
                              {status.robertNextActions.connectNow.credentialCloseout.files.slice(0, 4).map((file) => (
                                <div key={`connect-now-credential-${file.relativePath}`} className="rounded border border-white/10 bg-black/25 p-2">
                                  <div className="flex items-center justify-between gap-2">
                                    <p className="truncate text-[11px] font-medium text-white">{file.fileName}</p>
                                    <Badge className={cn("border text-[10px]", file.importEligible ? "border-emerald-300/30 bg-emerald-300/10 text-emerald-200" : "border-zinc-600 bg-zinc-900 text-zinc-300")}>
                                      {file.importEligible ? "eligible" : file.location}
                                    </Badge>
                                  </div>
                                  <p className="mt-1 break-all text-[11px] leading-4 text-zinc-500">{file.relativePath}</p>
                                  {file.pendingEnvVars.length > 0 && <p className="mt-1 break-all text-[11px] leading-4 text-cyan-100/80">Pending: {file.pendingEnvVars.join(", ")}</p>}
                                </div>
                              ))}
                            </div>
                          )}
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="mt-2 h-7 border-cyan-300/20 bg-transparent px-2 text-[11px] text-cyan-100 hover:bg-cyan-300/10"
                            onClick={() => credentialDropImportMutation.mutate()}
                            disabled={credentialDropImportMutation.isPending || !status.robertNextActions.connectNow.credentialCloseout.importReady}
                          >
                            {credentialDropImportMutation.isPending ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <UploadCloud className="mr-1 h-3 w-3" />}
                            Import credential files
                          </Button>
                        </div>
                      )}
                      {status.robertNextActions.connectNow.officialPermissionCloseout && (
                        <div className="mt-3 rounded-md border border-indigo-300/15 bg-indigo-950/10 p-2">
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                            <div className="min-w-0">
                              <p className="font-medium text-indigo-100">Official permission closeout</p>
                              <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-zinc-500">{status.robertNextActions.connectNow.officialPermissionCloseout.nextStep}</p>
                            </div>
                            <div className="flex flex-wrap gap-1">
                              <Badge className={cn("border text-[10px]", status.robertNextActions.connectNow.officialPermissionCloseout.status === "verified" ? "border-emerald-300/30 bg-emerald-300/10 text-emerald-200" : "border-indigo-300/20 bg-indigo-950/30 text-indigo-100")}>
                                {status.robertNextActions.connectNow.officialPermissionCloseout.status}
                              </Badge>
                              <Badge className="border border-white/10 bg-white/5 text-[10px] text-zinc-300">{status.robertNextActions.connectNow.officialPermissionCloseout.totals.scopes} scopes</Badge>
                            </div>
                          </div>
                          <div className="mt-2 grid gap-1 text-[11px] leading-4 text-zinc-500 sm:grid-cols-2 xl:grid-cols-5">
                            <p>Platforms: {status.robertNextActions.connectNow.officialPermissionCloseout.totals.platforms}</p>
                            <p>Public docs: {status.robertNextActions.connectNow.officialPermissionCloseout.totals.officialVerified}</p>
                            <p>Login recheck: {status.robertNextActions.connectNow.officialPermissionCloseout.totals.loginRequired}</p>
                            <p>App review: {status.robertNextActions.connectNow.officialPermissionCloseout.totals.appReviewRequired}</p>
                            <p>Batches: {status.robertNextActions.connectNow.officialPermissionCloseout.totals.sourceBatches}</p>
                            <p className="break-all sm:col-span-2">Matrix: {status.robertNextActions.connectNow.officialPermissionCloseout.matrixPath}</p>
                            <p className="break-all sm:col-span-2">CSV: {status.robertNextActions.connectNow.officialPermissionCloseout.csvPath}</p>
                            <p>Checked: {new Date(status.robertNextActions.connectNow.officialPermissionCloseout.verifiedAt).toLocaleDateString()}</p>
                          </div>
                          {status.robertNextActions.connectNow.officialPermissionCloseout.sourceBatches.length > 0 && (
                            <div className="mt-2 grid gap-2 md:grid-cols-3">
                              {status.robertNextActions.connectNow.officialPermissionCloseout.sourceBatches.slice(0, 3).map((batch) => (
                                <div key={`connect-now-official-permission-${batch.id}`} className="rounded border border-white/10 bg-black/25 p-2">
                                  <div className="flex items-center justify-between gap-2">
                                    <p className="truncate text-[11px] font-medium text-white">{batch.label}</p>
                                    <Badge className={cn("border text-[10px]", batch.accessMode === "public" ? "border-emerald-300/30 bg-emerald-300/10 text-emerald-200" : "border-amber-300/30 bg-amber-300/10 text-amber-200")}>
                                      {batch.accessMode}
                                    </Badge>
                                  </div>
                                  <p className="mt-1 break-all text-[11px] leading-4 text-indigo-100/75">{batch.scopes.join(", ")}</p>
                                  <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-zinc-500">{batch.nextStep}</p>
                                  {batch.officialUrls[0] && (
                                    <a href={batch.officialUrls[0]} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-[11px] text-sky-200 hover:text-white">
                                      Official docs
                                      <ExternalLink className="h-3 w-3" />
                                    </a>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                          <div className="mt-2 flex flex-wrap gap-2">
                            {status.robertNextActions.connectNow.officialPermissionCloseout.nextRows.length > 0 && (
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="h-7 border-indigo-300/20 bg-transparent px-2 text-[11px] text-indigo-100 hover:bg-indigo-300/10"
                                onClick={() => appendLaunchEvidenceBatchRows(status.robertNextActions.connectNow.officialPermissionCloseout?.nextRows || [])}
                              >
                                <UploadCloud className="mr-1 h-3 w-3" />
                                Permission rows
                              </Button>
                            )}
                            {status.robertNextActions.connectNow.officialPermissionCloseout.approvalRows.length > 0 && (
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="h-7 border-emerald-300/20 bg-transparent px-2 text-[11px] text-emerald-100 hover:bg-emerald-300/10"
                                onClick={() => appendLaunchEvidenceBatchRows(status.robertNextActions.connectNow.officialPermissionCloseout?.approvalRows || [])}
                              >
                                <CheckCircle2 className="mr-1 h-3 w-3" />
                                Approval rows
                              </Button>
                            )}
                          </div>
                        </div>
                      )}
                      {status.robertNextActions.connectNow.accountCloseout && (
                        <div className="mt-3 rounded-md border border-violet-300/15 bg-violet-950/10 p-2">
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                            <div className="min-w-0">
                              <p className="font-medium text-violet-100">Account closeout queue</p>
                              <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-zinc-500">{status.robertNextActions.connectNow.accountCloseout.nextStep}</p>
                            </div>
                            <div className="flex flex-wrap gap-1">
                              <Badge className={cn("border text-[10px]", goLiveAutopilotBadge(status.robertNextActions.connectNow.accountCloseout.status))}>{status.robertNextActions.connectNow.accountCloseout.status}</Badge>
                              <Badge className="border border-white/10 bg-white/5 text-[10px] text-zinc-300">{status.robertNextActions.connectNow.accountCloseout.totals.items} external</Badge>
                            </div>
                          </div>
                          <div className="mt-2 grid gap-1 text-[11px] leading-4 text-zinc-500 sm:grid-cols-2 xl:grid-cols-5">
                            <p>Ready: {status.robertNextActions.connectNow.accountCloseout.totals.readyToExecute}</p>
                            <p>Blocked: {status.robertNextActions.connectNow.accountCloseout.totals.blocked}</p>
                            <p>Accounts: {status.robertNextActions.connectNow.accountCloseout.totals.accounts}</p>
                            <p>Apps: {status.robertNextActions.connectNow.accountCloseout.totals.developerApps}</p>
                            <p>Perms: {status.robertNextActions.connectNow.accountCloseout.totals.permissions}</p>
                            <p>OAuth: {status.robertNextActions.connectNow.accountCloseout.totals.oauth}</p>
                            <p>Rows: {status.robertNextActions.connectNow.accountCloseout.totals.evidenceRows}</p>
                            <p className="break-all sm:col-span-3">Evidence drop: {status.robertNextActions.connectNow.accountCloseout.evidenceDropPath}</p>
                          </div>
                          {(status.robertNextActions.connectNow.accountCloseout.accountProofBridge || []).length > 0 && (
                            <div className="mt-2 rounded-md border border-fuchsia-300/15 bg-fuchsia-950/10 p-2">
                              <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                                <p className="text-[11px] font-medium text-fuchsia-100">Account proof bridge</p>
                                <Badge className="w-fit border border-fuchsia-300/20 bg-fuchsia-950/40 text-[10px] text-fuchsia-100">
                                  {(status.robertNextActions.connectNow.accountCloseout.accountProofBridge || []).length} accounts
                                </Badge>
                              </div>
                              <div className="mt-2 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                                {(status.robertNextActions.connectNow.accountCloseout.accountProofBridge || []).slice(0, 6).map((item) => (
                                  <div key={`connect-now-account-proof-${item.id}`} className="rounded border border-white/10 bg-black/25 p-2">
                                    <div className="flex items-center justify-between gap-2">
                                      <p className="truncate text-[11px] font-medium text-white">{item.handle}</p>
                                      <Badge className={cn("border text-[10px]", goLiveAutopilotBadge(item.status))}>{item.platform}</Badge>
                                    </div>
                                    <p className="mt-1 truncate text-[11px] leading-4 text-fuchsia-100/75">{item.accountId}</p>
                                    <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-zinc-500">{item.requiredProof.join(" | ")}</p>
                                    <div className="mt-2 flex flex-wrap gap-1">
                                      {item.portalUrl && (
                                        <a href={item.portalUrl} target="_blank" rel="noreferrer" className="inline-flex h-6 items-center gap-1 rounded-md border border-sky-300/20 px-1.5 text-[10px] text-sky-100 hover:bg-sky-300/10">
                                          Portal
                                          <ExternalLink className="h-3 w-3" />
                                        </a>
                                      )}
                                      <Button
                                        type="button"
                                        size="sm"
                                        variant="outline"
                                        className="h-6 border-fuchsia-300/20 bg-transparent px-1.5 text-[10px] text-fuchsia-100 hover:bg-fuchsia-300/10"
                                        onClick={() => appendLaunchEvidenceBatchRows([item.evidenceRow])}
                                      >
                                        <UploadCloud className="mr-1 h-3 w-3" />
                                        Row
                                      </Button>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                          {(status.robertNextActions.connectNow.accountCloseout.appPermissionBridge || []).length > 0 && (
                            <div className="mt-2 rounded-md border border-indigo-300/15 bg-indigo-950/10 p-2">
                              <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                                <p className="text-[11px] font-medium text-indigo-100">App/permission bridge</p>
                                <Badge className="w-fit border border-indigo-300/20 bg-indigo-950/40 text-[10px] text-indigo-100">
                                  {(status.robertNextActions.connectNow.accountCloseout.appPermissionBridge || []).length} items
                                </Badge>
                              </div>
                              <div className="mt-2 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                                {(status.robertNextActions.connectNow.accountCloseout.appPermissionBridge || []).slice(0, 6).map((item) => (
                                  <div key={`connect-now-app-permission-${item.id}`} className="rounded border border-white/10 bg-black/25 p-2">
                                    <div className="flex items-center justify-between gap-2">
                                      <p className="truncate text-[11px] font-medium text-white">{item.label}</p>
                                      <Badge className={cn("border text-[10px]", goLiveAutopilotBadge(item.status))}>{item.lane}</Badge>
                                    </div>
                                    <div className="mt-1 flex flex-wrap gap-1">
                                      <Badge className="border border-indigo-300/20 bg-indigo-950/40 text-[10px] text-indigo-100">{item.platform}</Badge>
                                      {item.scopes.slice(0, 2).map((scope) => (
                                        <Badge key={`${item.id}-${scope}`} className="max-w-full truncate border border-white/10 bg-white/5 text-[10px] text-zinc-300">{scope}</Badge>
                                      ))}
                                    </div>
                                    <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-zinc-500">{item.requiredProof.join(" | ")}</p>
                                    {item.blockers.length > 0 && (
                                      <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-amber-100/75">{item.blockers.join(" | ")}</p>
                                    )}
                                    <div className="mt-2 flex flex-wrap gap-1">
                                      {item.portalUrl && (
                                        <a href={item.portalUrl} target="_blank" rel="noreferrer" className="inline-flex h-6 items-center gap-1 rounded-md border border-sky-300/20 px-1.5 text-[10px] text-sky-100 hover:bg-sky-300/10">
                                          Portal
                                          <ExternalLink className="h-3 w-3" />
                                        </a>
                                      )}
                                      {item.evidenceRows.length > 0 && (
                                        <Button
                                          type="button"
                                          size="sm"
                                          variant="outline"
                                          className="h-6 border-indigo-300/20 bg-transparent px-1.5 text-[10px] text-indigo-100 hover:bg-indigo-300/10"
                                          onClick={() => appendLaunchEvidenceBatchRows(item.evidenceRows)}
                                        >
                                          <UploadCloud className="mr-1 h-3 w-3" />
                                          Rows
                                        </Button>
                                      )}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                          {status.robertNextActions.connectNow.accountCloseout.nextItems.length > 0 && (
                            <div className="mt-2 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                              {status.robertNextActions.connectNow.accountCloseout.nextItems.slice(0, 6).map((item) => (
                                <div key={`connect-now-account-${item.id}`} className="rounded border border-white/10 bg-black/25 p-2">
                                  <div className="flex items-center justify-between gap-2">
                                    <p className="truncate text-[11px] font-medium text-white">{item.rank}. {item.label}</p>
                                    <Badge className={cn("border text-[10px]", goLiveAutopilotBadge(item.status))}>{item.status}</Badge>
                                  </div>
                                  <div className="mt-1 flex flex-wrap gap-1">
                                    <Badge className="border border-violet-300/20 bg-violet-950/40 text-[10px] text-violet-100">{item.lane}</Badge>
                                    <Badge className="border border-white/10 bg-white/5 text-[10px] text-zinc-300">{item.platform}</Badge>
                                  </div>
                                  <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-zinc-500">{item.nextStep}</p>
                                  {item.portalUrl && (
                                    <a href={item.portalUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-[11px] text-sky-200 hover:text-white">
                                      Portal
                                      <ExternalLink className="h-3 w-3" />
                                    </a>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                          <div className="mt-2 flex flex-wrap gap-2">
                            {status.robertNextActions.connectNow.accountCloseout.evidenceRows.length > 0 && (
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="h-7 border-green-300/20 bg-transparent px-2 text-[11px] text-green-100 hover:bg-green-300/10"
                                onClick={() => appendLaunchEvidenceBatchRows(status.robertNextActions.connectNow.accountCloseout?.evidenceRows || [])}
                              >
                                <UploadCloud className="mr-1 h-3 w-3" />
                                Account rows
                              </Button>
                            )}
                            {status.robertNextActions.connectNow.accountCloseout.portalUrls.slice(0, 3).map((portal, portalIndex) => (
                              <a key={`connect-now-account-portal-${portal.url}-${portal.lane}-${portalIndex}`} href={portal.url} target="_blank" rel="noreferrer" className="inline-flex h-7 items-center gap-1 rounded-md border border-violet-300/20 px-2 text-[11px] text-violet-100 hover:bg-violet-300/10">
                                {portal.platform}
                                <ExternalLink className="h-3 w-3" />
                              </a>
                            ))}
                          </div>
                        </div>
                      )}
                      {status.robertNextActions.connectNow.evidenceCloseout && (
                        <div className="mt-3 rounded-md border border-sky-300/15 bg-sky-950/10 p-2">
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                            <div className="min-w-0">
                              <p className="font-medium text-sky-100">Evidence closeout queue</p>
                              <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-zinc-500">{status.robertNextActions.connectNow.evidenceCloseout.nextStep}</p>
                            </div>
                            <div className="flex flex-wrap gap-1">
                              <Badge className="border border-sky-300/20 bg-sky-950/30 text-[10px] text-sky-100">{status.robertNextActions.connectNow.evidenceCloseout.total} open</Badge>
                              <Badge className="border border-white/10 bg-white/5 text-[10px] text-zinc-300">{status.robertNextActions.connectNow.evidenceCloseout.nextRows.length} rows</Badge>
                            </div>
                          </div>
                          <div className="mt-2 grid gap-1 text-[11px] leading-4 text-zinc-500 sm:grid-cols-2 xl:grid-cols-4">
                            <p>Accounts: {status.robertNextActions.connectNow.evidenceCloseout.byCategory.accountProof}</p>
                            <p>Apps: {status.robertNextActions.connectNow.evidenceCloseout.byCategory.developerApps}</p>
                            <p>Perms: {status.robertNextActions.connectNow.evidenceCloseout.byCategory.permissionProof}</p>
                            <p>URLs: {status.robertNextActions.connectNow.evidenceCloseout.byCategory.publicUrl}</p>
                            <p>State gaps: {status.robertNextActions.connectNow.evidenceCloseout.byCategory.currentStateGaps}</p>
                            <p>Rejected: {status.robertNextActions.connectNow.evidenceCloseout.byCategory.rejectedRows}</p>
                            <p className="break-all sm:col-span-2">Fixpack: {status.robertNextActions.connectNow.evidenceCloseout.fixpackPath}</p>
                            <p className="break-all sm:col-span-2">Import: {status.robertNextActions.connectNow.evidenceCloseout.importTarget}</p>
                          </div>
                          {(status.robertNextActions.connectNow.evidenceCloseout.importBridge || []).length > 0 && (
                            <div className="mt-2 rounded-md border border-sky-300/10 bg-black/20 p-2">
                              <div className="flex items-center justify-between gap-2">
                                <p className="text-[11px] font-medium text-sky-100">Evidence import bridge</p>
                                <Badge className="border border-sky-300/20 bg-sky-950/30 text-[10px] text-sky-100">
                                  {status.robertNextActions.connectNow.evidenceCloseout.importBridge.length} batches
                                </Badge>
                              </div>
                              <div className="mt-2 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                                {status.robertNextActions.connectNow.evidenceCloseout.importBridge.slice(0, 6).map((batch) => (
                                  <div key={`evidence-import-bridge-${batch.id}`} className="rounded border border-white/10 bg-zinc-950/40 p-2">
                                    <div className="flex items-start justify-between gap-2">
                                      <div className="min-w-0">
                                        <p className="truncate text-[11px] font-medium text-white">{batch.label}</p>
                                        <p className="mt-1 line-clamp-2 text-[10px] leading-4 text-zinc-500">{batch.nextStep}</p>
                                      </div>
                                      <Badge className={cn(
                                        "shrink-0 border px-1 text-[9px]",
                                        batch.priority === "critical"
                                          ? "border-rose-300/30 bg-rose-300/10 text-rose-100"
                                          : batch.priority === "high"
                                            ? "border-amber-300/30 bg-amber-300/10 text-amber-100"
                                            : "border-zinc-600 bg-zinc-900 text-zinc-300",
                                      )}>
                                        {batch.count}
                                      </Badge>
                                    </div>
                                    <p className="mt-1 break-all text-[10px] leading-4 text-sky-100/75">{batch.identifiers.slice(0, 3).join(", ") || batch.kind}</p>
                                    <p className="mt-1 line-clamp-2 text-[10px] leading-4 text-zinc-500">{batch.requiredFixes.slice(0, 2).join(" | ")}</p>
                                    {batch.rows.length > 0 && (
                                      <Button
                                        type="button"
                                        size="sm"
                                        variant="outline"
                                        className="mt-2 h-7 border-sky-300/20 bg-transparent px-2 text-[11px] text-sky-100 hover:bg-sky-300/10"
                                        onClick={() => appendLaunchEvidenceBatchRows(batch.rows)}
                                      >
                                        <UploadCloud className="mr-1 h-3 w-3" />
                                        Rows
                                      </Button>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                          {status.robertNextActions.connectNow.evidenceCloseout.nextRows.length > 0 && (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="mt-2 h-7 border-sky-300/20 bg-transparent px-2 text-[11px] text-sky-100 hover:bg-sky-300/10"
                              onClick={() => appendLaunchEvidenceBatchRows(status.robertNextActions.connectNow.evidenceCloseout?.nextRows || [])}
                            >
                              <UploadCloud className="mr-1 h-3 w-3" />
                              Fix rows
                            </Button>
                          )}
                        </div>
                      )}
                      {status.robertNextActions.connectNow.sourceCloseout && (
                        <div className="mt-3 rounded-md border border-lime-300/15 bg-lime-950/10 p-2">
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                            <div className="min-w-0">
                              <p className="font-medium text-lime-100">Source closeout queue</p>
                              <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-zinc-500">{status.robertNextActions.connectNow.sourceCloseout.nextStep}</p>
                            </div>
                            <div className="flex flex-wrap gap-1">
                              <Badge className={cn("border text-[10px]", sourceAcquisitionBadge(status.robertNextActions.connectNow.sourceCloseout.status))}>{status.robertNextActions.connectNow.sourceCloseout.status}</Badge>
                              <Badge className="border border-white/10 bg-white/5 text-[10px] text-zinc-300">{status.robertNextActions.connectNow.sourceCloseout.total} rows</Badge>
                            </div>
                          </div>
                          <div className="mt-2 grid gap-1 text-[11px] leading-4 text-zinc-500 sm:grid-cols-2 xl:grid-cols-4">
                            <p>Missing/wk: {status.robertNextActions.connectNow.sourceCloseout.totals.weeklyMissingSourceSlots}</p>
                            <p>Rights OK: {status.robertNextActions.connectNow.sourceCloseout.totals.rightsReadyAssets}</p>
                            <p>Min assets: {status.robertNextActions.connectNow.sourceCloseout.totals.minimumWeeklySourceAssets}</p>
                            <p>Batches: {status.robertNextActions.connectNow.sourceCloseout.batches.length}</p>
                            <p className="break-all sm:col-span-2">Drop root: {status.robertNextActions.connectNow.sourceCloseout.sourceDropDir}</p>
                            <p className="break-all sm:col-span-2">Kit: {status.robertNextActions.connectNow.sourceCloseout.markdownPath}</p>
                          </div>
                          {status.robertNextActions.connectNow.sourceCloseout.batches.length > 0 && (
                            <div className="mt-2 grid gap-2 md:grid-cols-3">
                              {status.robertNextActions.connectNow.sourceCloseout.batches.slice(0, 3).map((batch) => (
                                <div key={`connect-now-source-${batch.category}`} className="rounded border border-white/10 bg-black/25 p-2">
                                  <div className="flex items-center justify-between gap-2">
                                    <p className="truncate text-[11px] font-medium text-white">{batch.label}</p>
                                    <Badge className={cn("border text-[10px]", sourceAcquisitionBadge(batch.priority))}>{batch.items}</Badge>
                                  </div>
                                  <p className="mt-1 break-all text-[11px] leading-4 text-zinc-500">{batch.sourceDropDir}</p>
                                  <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-lime-100/75">{batch.viralSearchQueries.slice(0, 2).join(" | ") || batch.nextStep}</p>
                                </div>
                              ))}
                            </div>
                          )}
                          <div className="mt-2 flex flex-wrap gap-2">
                            {status.robertNextActions.connectNow.sourceCloseout.nextRows.length > 0 && (
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="h-7 border-lime-300/20 bg-transparent px-2 text-[11px] text-lime-100 hover:bg-lime-300/10"
                                onClick={() => appendSourceIntakeBatchRows(status.robertNextActions.connectNow.sourceCloseout?.nextRows || [])}
                              >
                                <FolderOpen className="mr-1 h-3 w-3" />
                                Source rows
                              </Button>
                            )}
                            {status.robertNextActions.connectNow.sourceCloseout.rightsRows.length > 0 && (
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="h-7 border-green-300/20 bg-transparent px-2 text-[11px] text-green-100 hover:bg-green-300/10"
                                onClick={() => appendLaunchEvidenceBatchRows(status.robertNextActions.connectNow.sourceCloseout?.rightsRows || [])}
                              >
                                <UploadCloud className="mr-1 h-3 w-3" />
                                Rights rows
                              </Button>
                            )}
                            {status.robertNextActions.connectNow.sourceCloseout.trendRows.length > 0 && (
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="h-7 border-orange-300/20 bg-transparent px-2 text-[11px] text-orange-100 hover:bg-orange-300/10"
                                onClick={() => appendTrendCandidateBatchRows(status.robertNextActions.connectNow.sourceCloseout?.trendRows || [])}
                              >
                                <TrendingUp className="mr-1 h-3 w-3" />
                                Trend rows
                              </Button>
                            )}
                          </div>
                        </div>
                      )}
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-7 border-violet-300/20 bg-transparent px-2 text-[11px] text-violet-100 hover:bg-violet-300/10"
                          onClick={() => {
                            const template = (status.robertNextActions.connectNow.credentialTemplate || "").trim()
                              || status.robertNextActions.connectNow.pendingCredentialEnvVars.map((envVar) => `${envVar}=`).join("\n");
                            setCredentialBatchPreview(null);
                            setCredentialBatchText(template);
                            toast({
                              title: "Credential template cargado",
                              description: "Pega valores reales antes de preview/import; valores vacios no desbloquean OAuth.",
                            });
                          }}
                          disabled={!(status.robertNextActions.connectNow.credentialTemplate || "").trim() && status.robertNextActions.connectNow.pendingCredentialEnvVars.length === 0}
                        >
                          <KeyRound className="mr-1 h-3 w-3" />
                          Load keys
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-7 border-green-300/20 bg-transparent px-2 text-[11px] text-green-100 hover:bg-green-300/10"
                          onClick={() => {
                            setLaunchEvidenceBatchPreview(null);
                            setLaunchEvidenceBatchText(status.robertNextActions.connectNow.launchEvidenceTemplate || "");
                            toast({
                              title: "Launch evidence template cargado",
                              description: "Reemplaza blanks/placeholders con proof real antes de Preview batch.",
                            });
                          }}
                          disabled={!(status.robertNextActions.connectNow.launchEvidenceTemplate || "").trim()}
                        >
                          <UploadCloud className="mr-1 h-3 w-3" />
                          Load evidence
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-7 border-lime-300/20 bg-transparent px-2 text-[11px] text-lime-100 hover:bg-lime-300/10"
                          onClick={() => {
                            setSourceIntakeBatch(null);
                            setSourceIntakeBatchText(status.robertNextActions.connectNow.sourceIntakeTemplate || "");
                            toast({
                              title: "Source intake template cargado",
                              description: "Agrega URLs, archivos y proof real antes de importar fuentes.",
                            });
                          }}
                          disabled={!(status.robertNextActions.connectNow.sourceIntakeTemplate || "").trim()}
                        >
                          <FolderOpen className="mr-1 h-3 w-3" />
                          Load sources
                        </Button>
                      </div>
                      {status.robertNextActions.connectNow.accountHandles.length > 0 && (
                        <div className="mt-3 flex flex-wrap gap-1">
                          {status.robertNextActions.connectNow.accountHandles.slice(0, 9).map((item) => (
                            <Badge key={`${item.accountId}-${item.platform}`} className="border border-white/10 bg-white/5 text-[10px] text-zinc-300">
                              {item.platform}: {item.handle}
                            </Badge>
                          ))}
                        </div>
                      )}
                      <p className="mt-3 text-[11px] leading-4 text-amber-100/70">
                        The .fixpack.csv is ignored until completed and copied/renamed to owner-connect-evidence.csv.
                      </p>
                    </div>
                  )}
                  {status.robertNextActions.items.length > 0 && (
                    <div className={cn(tunnelGridClass, "mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4")}>
                      {status.robertNextActions.items.slice(0, 8).map((item) => (
                        <div key={item.id} className={cn(tunnelBoxClass, "bg-black/30 p-2")}>
                          <div className="flex items-center justify-between gap-2">
                            <p className="truncate text-xs font-medium text-white">{item.rank}. {item.label}</p>
                            <Badge className={cn("shrink-0 border text-[10px]", goLiveAutopilotBadge(item.status))}>{item.status}</Badge>
                          </div>
                          <div className="mt-2 flex flex-wrap gap-1">
                            <Badge className="border border-amber-300/20 bg-amber-950/40 text-[10px] text-amber-100">{item.lane}</Badge>
                            <Badge className="border border-white/10 bg-white/5 text-[10px] text-zinc-300">{item.priority}</Badge>
                            <Badge className="border border-white/10 bg-white/5 text-[10px] text-zinc-300">{item.platform}</Badge>
                          </div>
                          <p className="mt-2 line-clamp-3 text-xs leading-5 text-zinc-500">{item.nextStep}</p>
                          {(item.operatorSteps || []).length > 0 && (
                            <div className="mt-2 space-y-1">
                              {(item.operatorSteps || []).slice(0, 3).map((step, stepIndex) => (
                                <p key={`${item.id}-step-${stepIndex}`} className="line-clamp-2 text-[11px] leading-4 text-zinc-400">
                                  {stepIndex + 1}. {step}
                                </p>
                              ))}
                            </div>
                          )}
                          {item.artifactPath && <p className="mt-2 line-clamp-2 break-all text-[11px] leading-4 text-sky-100/70">{item.artifactPath}</p>}
                          {item.dropDirs.length > 0 && <p className="mt-2 line-clamp-2 break-all text-[11px] leading-4 text-amber-100/70">{item.dropDirs.join(" | ")}</p>}
                          {item.blockers.length > 0 && <p className="mt-2 line-clamp-2 text-[11px] leading-4 text-red-100/80">{item.blockers[0]}</p>}
                          <div className="mt-3 flex flex-wrap gap-2">
                            {item.portalUrl && (
                              <a href={item.portalUrl} target="_blank" rel="noreferrer" className="inline-flex h-7 items-center gap-1 rounded-md border border-sky-300/20 px-2 text-[11px] text-sky-100 hover:bg-sky-300/10">
                                Open portal
                                <ExternalLink className="h-3 w-3" />
                              </a>
                            )}
                            {item.evidenceRows.length > 0 && (
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="h-7 border-green-300/20 bg-transparent px-2 text-[11px] text-green-100 hover:bg-green-300/10"
                                onClick={() => {
                                  if (item.lane === "source_supply") appendSourceIntakeBatchRows(item.evidenceRows);
                                  else appendLaunchEvidenceBatchRows(item.evidenceRows);
                                }}
                              >
                                <UploadCloud className="mr-1 h-3 w-3" />
                                Use rows
                              </Button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {status.localDropSync && (
                <div className="rounded-md border border-cyan-300/20 bg-cyan-950/10 p-3" data-testid="clippers-local-drop-sync">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-white">Local Drop Sync: {status.localDropSync.markdownPath}</p>
                      <p className="mt-1 text-xs leading-5 text-zinc-500">{status.localDropSync.nextStep}</p>
                    </div>
                    <Badge className={cn("w-fit border", goLiveAutopilotBadge(status.localDropSync.status))}>{status.localDropSync.status}</Badge>
                  </div>
                  <div className="mt-3 grid gap-2 text-xs text-zinc-500 md:grid-cols-4">
                    <p>Attempted: {status.localDropSync.totals.attempted}</p>
                    <p>Completed: {status.localDropSync.totals.completed}</p>
                    <p>Skipped: {status.localDropSync.totals.skipped}</p>
                    <p>Failed: {status.localDropSync.totals.failed}</p>
                  </div>
                  {(status.localDropSync.missingInputs || []).length > 0 && (
                    <div className="mt-3 grid gap-2 md:grid-cols-3" data-testid="clippers-local-drop-missing-inputs">
                      {status.localDropSync.missingInputs.map((input) => (
                        <div key={input.id} className="rounded-md border border-white/10 bg-black/30 p-2">
                          <div className="flex items-center justify-between gap-2">
                            <p className="truncate text-xs font-medium text-white">{input.label}</p>
                            <Badge className={cn(
                              "shrink-0 border text-[10px]",
                              input.status === "ready"
                                ? "border-emerald-300/30 bg-emerald-300/10 text-emerald-200"
                                : "border-amber-300/30 bg-amber-300/10 text-amber-200",
                            )}>
                              {input.status}
                            </Badge>
                          </div>
                          <p className="mt-2 text-xs leading-5 text-zinc-500">{input.nextStep}</p>
                          <p className="mt-2 break-all text-[11px] leading-4 text-cyan-100/70">{input.dropDirs.join(" | ")}</p>
                          <p className="mt-2 line-clamp-2 text-[11px] leading-4 text-zinc-600">{input.acceptedFormats.join(" | ")}</p>
                        </div>
                      ))}
                    </div>
                  )}
                  {status.launchEvidenceDropDiagnostic && (
                    <div className="mt-3 rounded-md border border-sky-300/20 bg-sky-950/10 p-3" data-testid="clippers-launch-evidence-drop-diagnostic">
                      <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
                        <div className="min-w-0">
                          <p className="truncate text-xs font-medium text-white">Launch evidence drop diagnostic</p>
                          <p className="mt-1 text-xs leading-5 text-zinc-500">{status.launchEvidenceDropDiagnostic.nextStep}</p>
                          <p className="mt-2 break-all text-[11px] leading-4 text-zinc-600">{status.launchEvidenceDropDiagnostic.markdownPath}</p>
                          <p className="mt-1 break-all text-[11px] leading-4 text-sky-100/70">Repair CSV: {status.launchEvidenceDropDiagnostic.repairWorksheetCsvPath}</p>
                        </div>
                        <Badge className={cn(
                          "w-fit border text-[10px]",
                          status.launchEvidenceDropDiagnostic.status === "ready_to_import"
                            ? "border-emerald-300/30 bg-emerald-300/10 text-emerald-200"
                            : status.launchEvidenceDropDiagnostic.status === "needs_values"
                              ? "border-amber-300/30 bg-amber-300/10 text-amber-200"
                              : status.launchEvidenceDropDiagnostic.status === "needs_review"
                                ? "border-red-300/30 bg-red-300/10 text-red-200"
                                : "border-zinc-600 bg-zinc-900 text-zinc-300",
                        )}>
                          {status.launchEvidenceDropDiagnostic.status}
                        </Badge>
                      </div>
                      <div className="mt-3 grid gap-2 text-xs text-zinc-500 md:grid-cols-4 xl:grid-cols-6">
                        <p>Files: {status.launchEvidenceDropDiagnostic.totals.files}</p>
                        <p>Rows: {status.launchEvidenceDropDiagnostic.totals.rows}</p>
                        <p>Ready: {status.launchEvidenceDropDiagnostic.totals.readyRows}</p>
                        <p>Pending: {status.launchEvidenceDropDiagnostic.totals.pendingRows}</p>
                        <p>Rejected: {status.launchEvidenceDropDiagnostic.totals.rejectedRows}</p>
                        <p>Errors: {status.launchEvidenceDropDiagnostic.totals.fileErrors}</p>
                      </div>
                      {status.launchEvidenceDropDiagnostic.files.length > 0 && (
                        <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                          {status.launchEvidenceDropDiagnostic.files.slice(0, 6).map((file) => (
                            <div key={file.relativePath} className="rounded-md border border-white/10 bg-black/30 p-2">
                              <div className="flex items-center justify-between gap-2">
                                <p className="truncate text-xs font-medium text-white">{file.relativePath}</p>
                                <Badge className={cn("border text-[10px]", file.pendingRows || file.rejectedRows ? "border-amber-300/30 bg-amber-300/10 text-amber-200" : "border-emerald-300/30 bg-emerald-300/10 text-emerald-200")}>
                                  {file.readyRows}/{file.rows}
                                </Badge>
                              </div>
                              <div className="mt-2 grid grid-cols-3 gap-1 text-[11px] text-zinc-500">
                                <p>Ready: {file.readyRows}</p>
                                <p>Pending: {file.pendingRows}</p>
                                <p>Rejected: {file.rejectedRows}</p>
                              </div>
                              <p className="mt-2 text-xs leading-5 text-zinc-500">{file.issue || file.nextStep}</p>
                            </div>
                          ))}
                        </div>
                      )}
                      {status.launchEvidenceDropDiagnostic.rows.some((row) => row.status !== "ready") && (
                        <div className="mt-3 grid gap-2 md:grid-cols-2">
                          {status.launchEvidenceDropDiagnostic.rows.filter((row) => row.status !== "ready").slice(0, 6).map((row) => (
                            <div key={`${row.sourceFile}-${row.index}`} className="rounded-md border border-white/10 bg-black/30 p-2">
                              <p className="text-xs font-medium text-white">{row.sourceFile} row {row.index}: {row.kind}</p>
                              <div className="mt-2 grid gap-1 text-[11px] leading-4 text-sky-100/70 sm:grid-cols-2">
                                <p className="truncate">Identifier: {row.identifier || "pending"}</p>
                                <p>Platform: {row.platform || "pending"}</p>
                                <p>Scope: {row.scope || "n/a"}</p>
                                <p className="truncate">App: {row.appIdentifier || "n/a"}</p>
                              </div>
                              <p className="mt-1 text-[11px] leading-4 text-zinc-500">{row.issue || row.nextStep}</p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                  {status.localDropSync.launchEvidenceDrop && (
                    <div className="mt-3 rounded-md border border-amber-300/20 bg-amber-950/10 p-3" data-testid="clippers-local-drop-launch-evidence">
                      <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
                        <div className="min-w-0">
                          <p className="truncate text-xs font-medium text-white">Launch evidence drop</p>
                          <p className="mt-1 text-xs leading-5 text-zinc-500">{status.localDropSync.launchEvidenceDrop.nextStep}</p>
                        </div>
                        <Badge className={cn(
                          "w-fit border text-[10px]",
                          status.localDropSync.launchEvidenceDrop.rejected.length || status.localDropSync.launchEvidenceDrop.fileErrors.length
                            ? "border-amber-300/30 bg-amber-300/10 text-amber-200"
                            : "border-emerald-300/30 bg-emerald-300/10 text-emerald-200",
                        )}>
                          {status.localDropSync.launchEvidenceDrop.rejected.length || status.localDropSync.launchEvidenceDrop.fileErrors.length ? "needs_fix" : "clean"}
                        </Badge>
                      </div>
                      <div className="mt-3 grid gap-2 text-xs text-zinc-500 md:grid-cols-6">
                        <p>Accounts: {status.localDropSync.launchEvidenceDrop.accepted.accountEvidence}</p>
                        <p>Apps: {status.localDropSync.launchEvidenceDrop.accepted.developerApps}</p>
                        <p>Perms: {status.localDropSync.launchEvidenceDrop.accepted.permissions}</p>
                        <p>Rights: {status.localDropSync.launchEvidenceDrop.accepted.sourceRights}</p>
                        <p>Rejected: {status.localDropSync.launchEvidenceDrop.rejected.length}</p>
                        <p>Errors: {status.localDropSync.launchEvidenceDrop.fileErrors.length}</p>
                      </div>
                      {status.localDropSync.launchEvidenceDrop.sourceFiles.length > 0 && (
                        <p className="mt-2 break-all text-[11px] leading-4 text-cyan-100/70">{status.localDropSync.launchEvidenceDrop.sourceFiles.join(" | ")}</p>
                      )}
                      {status.localDropSync.launchEvidenceDrop.rejected.length > 0 && (
                        <div className="mt-3 grid gap-2 md:grid-cols-2">
                          {status.localDropSync.launchEvidenceDrop.rejected.slice(0, 6).map((item) => (
                            <div key={`${item.index}-${item.kind}-${item.identifier || "row"}`} className="rounded-md border border-white/10 bg-black/30 p-2">
                              <p className="text-xs font-medium text-white">Row {item.index}: {item.kind}{item.identifier ? ` / ${item.identifier}` : ""}</p>
                              <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-zinc-500">{item.reason}</p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                  {status.localDropSync.items.length > 0 && (
                    <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
                      {status.localDropSync.items.map((item) => (
                        <div key={`${item.id}-${item.startedAt}`} className="rounded-md border border-white/10 bg-black/30 p-2">
                          <div className="flex items-center justify-between gap-2">
                            <p className="truncate text-xs font-medium text-white">{item.label}</p>
                            <Badge className={cn("shrink-0 border text-[10px]", goLiveAutopilotBadge(item.status))}>{item.status}</Badge>
                          </div>
                          <p className="mt-2 line-clamp-3 text-xs leading-5 text-zinc-500">{item.message}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {status.launchEvidenceFixPack && (
                <div className="rounded-md border border-yellow-300/20 bg-yellow-950/10 p-3" data-testid="clippers-launch-evidence-fix-pack">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-white">Launch Evidence Fix Pack: {status.launchEvidenceFixPack.markdownPath}</p>
                      <p className="mt-1 text-xs leading-5 text-zinc-500">{status.launchEvidenceFixPack.nextStep}</p>
                    </div>
                    <Badge className={cn("w-fit border", goLiveAutopilotBadge(status.launchEvidenceFixPack.status))}>{status.launchEvidenceFixPack.status}</Badge>
                  </div>
                  <div className="mt-3 grid gap-2 text-xs text-zinc-500 md:grid-cols-6 xl:grid-cols-9">
                    <p>Items: {status.launchEvidenceFixPack.totals.items}</p>
                    <p>Rejected: {status.launchEvidenceFixPack.totals.rejectedRows || 0}</p>
                    <p>State gaps: {status.launchEvidenceFixPack.totals.currentStateGaps || 0}</p>
                    <p>Accounts: {status.launchEvidenceFixPack.totals.accountProof}</p>
                    <p>Apps: {status.launchEvidenceFixPack.totals.developerApps || 0}</p>
                    <p>Perms: {status.launchEvidenceFixPack.totals.permissionProof}</p>
                    <p>URLs: {status.launchEvidenceFixPack.totals.publicUrl}</p>
                    <p>Rights: {status.launchEvidenceFixPack.totals.sourceRights}</p>
                    <p>Format: {status.launchEvidenceFixPack.totals.format}</p>
                  </div>
                  <p className="mt-2 break-all text-xs text-zinc-600">CSV: {status.launchEvidenceFixPack.csvPath}</p>
                  <p className="mt-1 break-all text-xs text-cyan-100/70">Editable import CSV (ignored until completed/renamed): {status.launchEvidenceFixPack.suggestedImportCsvPath}</p>
                  {status.launchEvidenceFixPack.items.length > 0 && (
                    <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                      {status.launchEvidenceFixPack.items.slice(0, 6).map((item) => (
                        <div key={item.id} className="rounded-md border border-white/10 bg-black/30 p-2">
                          <div className="flex items-center justify-between gap-2">
                            <p className="truncate text-xs font-medium text-white">{item.evidenceSource === "current_state_gap" ? "Current state" : `Row ${item.rowIndex}`}: {item.kind}</p>
                            <Badge className="shrink-0 border border-yellow-300/30 bg-yellow-300/10 text-[10px] text-yellow-100">{item.fixCategory}</Badge>
                          </div>
                          <p className="mt-1 text-[11px] leading-4 text-zinc-600">{item.evidenceSource || "drop_rejected"}</p>
                          <p className="mt-2 line-clamp-2 text-xs leading-5 text-zinc-500">{item.requiredFix}</p>
                          <p className="mt-2 line-clamp-2 text-[11px] leading-4 text-cyan-100/70">{item.suggestedNotes}</p>
                          <p className="mt-2 break-all rounded border border-white/10 bg-black/30 p-2 text-[10px] leading-4 text-zinc-400">{item.suggestedReplacementRow}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {(status.goLiveAutopilotBrief.agentSessions || []).length > 0 && (
                <div className="rounded-md border border-violet-300/20 bg-violet-950/10 p-3">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-violet-200">Agent session batches</p>
                      <p className="mt-1 text-xs leading-5 text-zinc-500">Cola agrupada por sub-agente para ejecutar cuentas, permisos, OAuth, fuentes y evidencia.</p>
                    </div>
                    <Badge className="w-fit border border-violet-300/20 bg-violet-950/40 text-[10px] text-violet-100">{status.goLiveAutopilotBrief.totals.agentSessions} sessions</Badge>
                  </div>
                  <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {status.goLiveAutopilotBrief.agentSessions.map((session) => (
                      <div key={session.id} className="rounded-md border border-white/10 bg-black/30 p-2">
                        <div className="flex items-center justify-between gap-2">
                          <p className="truncate text-xs font-medium text-white">{session.subAgentName}</p>
                          <Badge className={cn("shrink-0 border text-[10px]", goLiveAutopilotBadge(session.status))}>{session.status}</Badge>
                        </div>
                        <p className="mt-2 text-xs leading-5 text-violet-100/80">{session.mission}</p>
                        <div className="mt-2 grid gap-1 text-xs text-zinc-500 sm:grid-cols-2">
                          <p>Actions: {session.actionCount}</p>
                          <p>Blocked: {session.blocked}</p>
                          <p>In-app: {session.inAppReady}</p>
                          <p>External: {session.externalRequired}</p>
                        </div>
                        <p className="mt-2 text-xs leading-5 text-amber-200">{session.nextStep}</p>
                        <p className="mt-2 truncate text-xs text-zinc-600">Platforms: {session.platforms.join(", ")}</p>
                        {session.evidenceRows.length > 0 && (
                          <div className="mt-2 rounded-md border border-green-300/15 bg-green-950/10 p-2">
                            <p className="text-[10px] font-semibold uppercase tracking-wide text-green-200">Next evidence row</p>
                            <p className="mt-1 break-all text-xs leading-4 text-green-100/80">{session.evidenceRows[0]}</p>
                          </div>
                        )}
                        {session.riskControls.length > 0 && (
                          <p className="mt-2 text-xs leading-5 text-red-100/80">Control: {session.riskControls[0]}</p>
                        )}
                        <div className="mt-2 flex flex-wrap gap-2">
                          {session.portalUrls.slice(0, 2).map((url, index) => (
                            <a key={`${session.id}-portal-${index}`} href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md border border-white/10 px-2 py-1 text-xs text-cyan-200 hover:bg-white/5">
                              Portal {index + 1}
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          ))}
                          {session.localActionUrls.slice(0, 2).map((url, index) => (
                            <Badge key={`${session.id}-local-${index}`} className="border border-white/10 bg-zinc-900 text-[10px] text-zinc-300">{url}</Badge>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {status.goLiveAutopilotRun && (
                <div className="rounded-md border border-white/10 bg-black/35 p-3">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-white">Last run: {status.goLiveAutopilotRun.markdownPath}</p>
                      <p className="mt-1 text-xs leading-5 text-zinc-500">{status.goLiveAutopilotRun.nextStep}</p>
                    </div>
                    <Badge className={cn("w-fit border", goLiveAutopilotBadge(status.goLiveAutopilotRun.status))}>{status.goLiveAutopilotRun.status}</Badge>
                  </div>
                  <div className="mt-3 grid gap-2 text-xs text-zinc-500 md:grid-cols-8">
                    <p>Attempted: {status.goLiveAutopilotRun.totals.attempted}</p>
                    <p>Completed: {status.goLiveAutopilotRun.totals.completed}</p>
                    <p>Skipped: {status.goLiveAutopilotRun.totals.skipped}</p>
                    <p>Failed: {status.goLiveAutopilotRun.totals.failed}</p>
                    <p>Memory: {status.goLiveAutopilotRun.completedActionIds.length}</p>
                    <p>Available: {status.goLiveAutopilotRun.availableInAppActions}</p>
                    <p>Remaining: {status.goLiveAutopilotRun.remainingInAppActions}</p>
                    <p>Reset: {status.goLiveAutopilotRun.resetCompleted ? "yes" : "no"}</p>
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
                  <p>Batches: {status.externalExecutionSession.totals.portalBatches}</p>
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

              {status.externalExecutionSession.focusRun && (
                <div className="rounded-md border border-emerald-300/20 bg-emerald-950/10 p-3" data-testid="clippers-external-focus-run">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold uppercase tracking-wide text-emerald-200">Focus run</p>
                      <p className="mt-1 text-sm font-medium text-white">{status.externalExecutionSession.focusRun.label}</p>
                      <p className="mt-1 text-xs leading-5 text-zinc-500">{status.externalExecutionSession.focusRun.nextStep}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Badge className="w-fit border border-emerald-300/20 bg-emerald-950/40 text-[10px] text-emerald-100">
                        {status.externalExecutionSession.focusRun.estimatedMinutes} min
                      </Badge>
                      <Badge className={cn(
                        "w-fit border text-[10px]",
                        status.externalExecutionSession.focusRun.status === "ready"
                          ? "border-emerald-300/30 bg-emerald-300/10 text-emerald-200"
                          : "border-amber-300/30 bg-amber-300/10 text-amber-200",
                      )}>
                        {status.externalExecutionSession.focusRun.status}
                      </Badge>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {status.externalExecutionSession.focusRun.evidenceRows.length > 0 && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 border-green-300/20 bg-transparent px-2 text-xs text-green-100 hover:bg-green-300/10"
                        onClick={() => appendLaunchEvidenceBatchRows(status.externalExecutionSession.focusRun.evidenceRows)}
                      >
                        <UploadCloud className="mr-1 h-3 w-3" />
                        Focus rows
                      </Button>
                    )}
                    {status.externalExecutionSession.focusRun.credentialTemplates.length > 0 && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 border-cyan-300/20 bg-transparent px-2 text-xs text-cyan-100 hover:bg-cyan-300/10"
                        onClick={() => {
                          setCredentialBatchText((current) => `${current.trim() ? `${current.trim()}\n\n` : ""}${status.externalExecutionSession.focusRun.credentialTemplates.join("\n\n")}`);
                          setCredentialBatchPreview(null);
                        }}
                      >
                        <KeyRound className="mr-1 h-3 w-3" />
                        Focus env
                      </Button>
                    )}
                    {status.externalExecutionSession.focusRun.portalUrls.slice(0, 3).map((portalUrl) => (
                      <a key={portalUrl} href={portalUrl} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1 rounded-md border border-sky-300/20 px-2 text-xs text-sky-100 hover:bg-sky-300/10">
                        Portal
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    ))}
                  </div>
                  <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {status.externalExecutionSession.focusRun.items.map((item) => (
                      <div key={item.id} className="rounded-md border border-white/10 bg-black/30 p-3">
                        <div className="flex items-center justify-between gap-2">
                          <p className="truncate text-sm font-medium text-white">{item.rank}. {item.label}</p>
                          <Badge className="shrink-0 border border-white/10 bg-black/40 text-[10px] text-zinc-300">{item.estimatedMinutes}m</Badge>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <Badge className="border border-white/10 bg-black/30 text-[10px] text-zinc-300">{item.platform}</Badge>
                          <Badge className="border border-white/10 bg-black/30 text-[10px] text-zinc-300">{item.type}</Badge>
                          <Badge className="border border-white/10 bg-black/30 text-[10px] text-zinc-300">{item.actionMode}</Badge>
                        </div>
                        <p className="mt-2 text-xs leading-5 text-zinc-500">{item.nextStep}</p>
                        {item.checklist.length > 0 && (
                          <ul className="mt-3 space-y-1 text-xs leading-4 text-emerald-100/75">
                            {item.checklist.slice(0, 3).map((step) => (
                              <li key={step}>{step}</li>
                            ))}
                          </ul>
                        )}
                        <div className="mt-3 flex flex-wrap gap-2">
                          {item.portalUrl && (
                            <a href={item.portalUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md border border-sky-300/20 px-2 py-1 text-xs text-sky-100 hover:bg-sky-300/10">
                              Portal
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          )}
                          {item.evidenceRow && (
                            <Button size="sm" variant="outline" className="h-7 border-green-300/20 bg-transparent px-2 text-xs text-green-100 hover:bg-green-300/10" onClick={() => appendLaunchEvidenceBatchRow(item.evidenceRow)}>
                              <UploadCloud className="mr-1 h-3 w-3" />
                              Row
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
                </div>
              )}

              {status.platformWarRoom && (
                <div className="rounded-md border border-fuchsia-300/15 bg-fuchsia-950/10 p-3">
                  <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold uppercase tracking-wide text-fuchsia-200">Platform war room</p>
                      <p className="mt-1 text-xs leading-5 text-zinc-500">{status.platformWarRoom.nextStep}</p>
                    </div>
                    <Badge className={cn("w-fit border", platformWarRoomBadge(status.platformWarRoom.status))}>{status.platformWarRoom.status}</Badge>
                  </div>
                  <div className="mt-3 grid gap-2 text-xs text-zinc-500 md:grid-cols-6">
                    <p>Platforms: {status.platformWarRoom.totals.platforms}</p>
                    <p>Ready: {status.platformWarRoom.totals.ready}</p>
                    <p>Progress: {status.platformWarRoom.totals.inProgress}</p>
                    <p>Blocked: {status.platformWarRoom.totals.blocked}</p>
                    <p>Account rows: {status.platformWarRoom.totals.accountEvidenceRows}</p>
                    <p>Permission rows: {status.platformWarRoom.totals.permissionEvidenceRows}</p>
                  </div>
                  <p className="mt-2 break-all text-xs text-zinc-600">War room: {status.platformWarRoom.markdownPath}</p>
                  {warRoomFlowStages.length > 0 && (
                    <div className="mt-3 rounded-md border border-white/10 bg-black/25 p-3">
                      <div className="grid gap-x-2 gap-y-6 lg:grid-cols-6 lg:gap-y-2">
                        {warRoomFlowStages.map((stage, index) => (
                          <div key={stage.id} className="relative min-h-[116px] rounded-md border border-white/10 bg-zinc-950/70 p-3">
                            {index < warRoomFlowStages.length - 1 && (
                              <>
                                <div className="pointer-events-none absolute left-1/2 top-[calc(100%-1px)] z-10 flex h-6 w-4 -translate-x-1/2 flex-col items-center lg:hidden">
                                  <div className="w-[2px] flex-1 rounded-full bg-fuchsia-300/25" />
                                  <ArrowRight className="h-3 w-3 rotate-90 text-fuchsia-200/70" />
                                </div>
                                <div className="pointer-events-none absolute left-[calc(100%-2px)] top-1/2 z-10 hidden h-3 w-8 -translate-y-1/2 items-center lg:flex">
                                  <div className="h-[2px] flex-1 rounded-full bg-fuchsia-300/25" />
                                  <ArrowRight className="h-3 w-3 text-fuchsia-200/70" />
                                </div>
                              </>
                            )}
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <p className="truncate text-xs font-semibold uppercase tracking-wide text-fuchsia-100">{stage.label}</p>
                                <p className="mt-1 text-lg font-semibold text-white">{stage.done}/{stage.total}</p>
                              </div>
                              <Badge className={cn("shrink-0 border text-[10px]", platformWarRoomBadge(stage.status as ClipperPlatformWarRoomStatus))}>{stage.status}</Badge>
                            </div>
                            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10">
                              <div
                                className={cn(
                                  "h-full rounded-full",
                                  stage.status === "ready" ? "bg-emerald-300" : stage.status === "in_progress" ? "bg-amber-300" : "bg-red-300",
                                )}
                                style={{ width: `${stage.total ? Math.min(100, Math.round((stage.done / stage.total) * 100)) : 0}%` }}
                              />
                            </div>
                            <p className="mt-3 line-clamp-2 text-xs leading-4 text-zinc-500">{stage.nextStep}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {(status.platformWarRoom.accountConnectionRows || []).length > 0 && (
                    <div className="mt-3 rounded-md border border-white/10 bg-black/25 p-3">
                      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                        <div className="min-w-0">
                          <p className="text-xs font-semibold uppercase tracking-wide text-fuchsia-100">Account connection matrix</p>
                          <p className="mt-1 text-xs text-zinc-500">{status.platformWarRoom.totals.accountConnectionsBlocked} bloqueadas, {status.platformWarRoom.totals.accountConnectionsPending} pendientes, {status.platformWarRoom.totals.accountConnectionsReady} listas.</p>
                        </div>
                        <Button size="sm" variant="outline" className="h-8 border-green-300/20 bg-transparent px-2 text-xs text-green-100 hover:bg-green-300/10" onClick={() => appendLaunchEvidenceBatchRows((status.platformWarRoom.accountConnectionRows || []).map((row) => row.accountEvidenceRow))}>
                          <UploadCloud className="mr-1 h-3 w-3" />
                          Cargar 9 rows
                        </Button>
                      </div>
                      <div className="mt-3 grid gap-2 lg:grid-cols-3">
                        {(status.platformWarRoom.accountConnectionRows || []).map((row) => (
                          <div key={row.id} className="rounded-md border border-white/10 bg-zinc-950/70 p-2">
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <p className="truncate text-xs font-medium text-white">{row.accountName}</p>
                                <a href={row.profileLink} target="_blank" rel="noreferrer" className="mt-1 block truncate text-xs text-cyan-100 hover:text-cyan-50">{row.handle}</a>
                              </div>
                              <Badge className={cn("shrink-0 border text-[10px]", accountLaunchBadge(row.status))}>{row.status}</Badge>
                            </div>
                            <div className="mt-2 flex flex-wrap gap-1">
                              <Badge className="border border-white/10 bg-black/30 text-[10px] text-zinc-300">{row.platform}</Badge>
                              <Badge className="border border-white/10 bg-black/30 text-[10px] text-zinc-300">{row.evidenceStatus}</Badge>
                            </div>
                            <p className="mt-2 line-clamp-2 text-xs leading-4 text-zinc-500">{row.nextStep}</p>
                            <p className="mt-2 line-clamp-2 text-xs leading-4 text-amber-100/80">{row.proofRequirements[0]}</p>
                            <div className="mt-2 flex flex-wrap gap-2">
                              <a href={row.accountCreationUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md border border-fuchsia-300/20 px-2 py-1 text-xs text-fuchsia-100 hover:bg-fuchsia-300/10">
                                Cuenta
                                <ExternalLink className="h-3 w-3" />
                              </a>
                              <Button size="sm" variant="outline" className="h-7 border-green-300/20 bg-transparent px-2 text-xs text-green-100 hover:bg-green-300/10" onClick={() => appendLaunchEvidenceBatchRows([row.accountEvidenceRow])}>
                                <UploadCloud className="mr-1 h-3 w-3" />
                                Row
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {(status.platformWarRoom.permissionApprovalRows || []).length > 0 && (
                    <div className="mt-3 rounded-md border border-white/10 bg-black/25 p-3">
                      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                        <div className="min-w-0">
                          <p className="text-xs font-semibold uppercase tracking-wide text-sky-100">Permission approval matrix</p>
                          <p className="mt-1 text-xs text-zinc-500">{status.platformWarRoom.totals.permissionApprovalsBlocked} bloqueados, {status.platformWarRoom.totals.permissionApprovalsRequested} solicitados, {status.platformWarRoom.totals.permissionApprovalsApproved} aprobados.</p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Button size="sm" variant="outline" className="h-8 border-sky-300/20 bg-transparent px-2 text-xs text-sky-100 hover:bg-sky-300/10" onClick={() => appendLaunchEvidenceBatchRows((status.platformWarRoom.permissionApprovalRows || []).map((row) => row.requestedEvidenceRow))}>
                            <UploadCloud className="mr-1 h-3 w-3" />
                            Requested rows
                          </Button>
                          <Button size="sm" variant="outline" className="h-8 border-emerald-300/20 bg-transparent px-2 text-xs text-emerald-100 hover:bg-emerald-300/10" onClick={() => appendLaunchEvidenceBatchRows((status.platformWarRoom.permissionApprovalRows || []).map((row) => row.approvedEvidenceRow))}>
                            <ShieldCheck className="mr-1 h-3 w-3" />
                            Approved rows
                          </Button>
                        </div>
                      </div>
                      <div className="mt-3 grid gap-2 lg:grid-cols-3">
                        {(status.platformWarRoom.permissionApprovalRows || []).map((row) => (
                          <div key={row.id} className="rounded-md border border-white/10 bg-zinc-950/70 p-2">
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <p className="truncate text-xs font-medium text-white">{row.label}</p>
                                <p className="mt-1 truncate text-xs text-zinc-500">{row.scope}</p>
                              </div>
                              <Badge className={cn("shrink-0 border text-[10px]", permissionTrackerBadge(row.status))}>{row.status}</Badge>
                            </div>
                            <div className="mt-2 flex flex-wrap gap-1">
                              <Badge className="border border-white/10 bg-black/30 text-[10px] text-zinc-300">{row.platform}</Badge>
                              <Badge className="border border-white/10 bg-black/30 text-[10px] text-zinc-300">{row.requestReadiness}</Badge>
                            </div>
                            <p className="mt-2 line-clamp-2 text-xs leading-4 text-zinc-500">{row.nextStep}</p>
                            <p className="mt-2 line-clamp-2 text-xs leading-4 text-sky-100/80">{row.proofRequirements[0]}</p>
                            {row.blockers.length > 0 && (
                              <p className="mt-2 line-clamp-2 text-xs leading-4 text-red-100/80">{row.blockers[0]}</p>
                            )}
                            <div className="mt-2 flex flex-wrap gap-2">
                              <a href={row.developerPortalUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md border border-sky-300/20 px-2 py-1 text-xs text-sky-100 hover:bg-sky-300/10">
                                Portal
                                <ExternalLink className="h-3 w-3" />
                              </a>
                              <Button size="sm" variant="outline" className="h-7 border-sky-300/20 bg-transparent px-2 text-xs text-sky-100 hover:bg-sky-300/10" onClick={() => appendLaunchEvidenceBatchRows([row.requestedEvidenceRow])}>
                                <UploadCloud className="mr-1 h-3 w-3" />
                                Requested
                              </Button>
                              <Button size="sm" variant="outline" className="h-7 border-emerald-300/20 bg-transparent px-2 text-xs text-emerald-100 hover:bg-emerald-300/10" onClick={() => appendLaunchEvidenceBatchRows([row.approvedEvidenceRow])}>
                                <ShieldCheck className="mr-1 h-3 w-3" />
                                Approved
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="mt-3 grid gap-3 md:grid-cols-3">
                    {status.platformWarRoom.items.map((item) => (
                      <div key={item.platform} className="rounded-md border border-white/10 bg-black/30 p-3">
                        <div className="flex items-center justify-between gap-2">
                          <p className="truncate text-sm font-medium text-white">{item.label}</p>
                          <Badge className={cn("shrink-0 border text-[10px]", platformWarRoomBadge(item.status))}>{item.status}</Badge>
                        </div>
                        <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-zinc-500">
                          <p>Accounts: {item.accountsVerified}/{item.accountTasks}</p>
                          <p>App: {item.developerAppStatus}</p>
                          <p>Perms: {item.permissionsApproved}/{item.permissionsTotal}</p>
                          <p>Creds: {item.credentialStatus}</p>
                          <p>OAuth: {item.oauthStatus}</p>
                          <p>Token: {item.tokenSaved ? "yes" : "no"}</p>
                        </div>
                        <p className="mt-3 text-xs leading-5 text-amber-200">{item.nextStep}</p>
                        {item.blockers.length > 0 && (
                          <ul className="mt-3 space-y-1 text-xs leading-4 text-red-100/80">
                            {item.blockers.slice(0, 3).map((blocker) => (
                              <li key={blocker}>{blocker}</li>
                            ))}
                          </ul>
                        )}
                        <div className="mt-3 grid gap-2 text-xs leading-4 text-zinc-400">
                          <div className="rounded-md border border-white/10 bg-zinc-950/70 p-2">
                            <p className="font-medium text-fuchsia-100">Conectar</p>
                            <ul className="mt-1 space-y-1">
                              {item.connectionChecklist.slice(0, 3).map((step) => (
                                <li key={step}>{step}</li>
                              ))}
                            </ul>
                          </div>
                          <div className="rounded-md border border-white/10 bg-zinc-950/70 p-2">
                            <p className="font-medium text-green-100">Evidencia</p>
                            <ul className="mt-1 space-y-1">
                              {item.evidenceChecklist.slice(0, 2).map((step) => (
                                <li key={step}>{step}</li>
                              ))}
                            </ul>
                          </div>
                          <p className="rounded-md border border-amber-300/15 bg-amber-950/10 p-2 text-amber-100/80">{item.safetyRules[0]}</p>
                          <p className="rounded-md border border-cyan-300/15 bg-cyan-950/10 p-2 text-cyan-100/80">{item.afterConnectionSteps[0]}</p>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {item.portalUrls.slice(0, 2).map((portalUrl) => (
                            <a key={portalUrl} href={portalUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md border border-fuchsia-300/20 px-2 py-1 text-xs text-fuchsia-100 hover:bg-fuchsia-300/10">
                              Portal
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          ))}
                          {item.evidenceRows.length > 0 && (
                            <Button size="sm" variant="outline" className="h-7 border-green-300/20 bg-transparent px-2 text-xs text-green-100 hover:bg-green-300/10" onClick={() => appendLaunchEvidenceBatchRows(item.evidenceRows)}>
                              <UploadCloud className="mr-1 h-3 w-3" />
                              Rows
                            </Button>
                          )}
                          {item.credentialTemplates.length > 0 && (
                            <Button size="sm" variant="outline" className="h-7 border-cyan-300/20 bg-transparent px-2 text-xs text-cyan-100 hover:bg-cyan-300/10" onClick={() => {
                              setCredentialBatchText((current) => `${current.trim() ? `${current.trim()}\n\n` : ""}${item.credentialTemplates.join("\n\n")}`);
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
                </div>
              )}

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

              {status.externalExecutionSession.portalBatches.length > 0 && (
                <div className="rounded-md border border-sky-300/15 bg-sky-950/10 p-3">
                  <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold uppercase tracking-wide text-sky-200">Portal batches</p>
                      <p className="mt-1 text-xs leading-5 text-zinc-500">Ordena cuentas, credenciales, developer apps, permisos y OAuth por plataforma.</p>
                    </div>
                    <Badge className="w-fit border border-sky-300/20 bg-sky-950/40 text-[10px] text-sky-100">{status.externalExecutionSession.portalBatches.length} batches</Badge>
                  </div>
                  <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {status.externalExecutionSession.portalBatches.slice(0, 9).map((batch) => (
                      <div key={batch.id} className="rounded-md border border-white/10 bg-black/30 p-3">
                        <div className="flex items-center justify-between gap-2">
                          <p className="truncate text-sm font-medium text-white">{batch.label}</p>
                          <Badge className={cn("shrink-0 border text-[10px]", externalSetupQueueBadge(batch.status))}>{batch.status}</Badge>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <Badge className="border border-white/10 bg-black/30 text-[10px] text-zinc-300">{batch.type}</Badge>
                          <Badge className="border border-white/10 bg-black/30 text-[10px] text-zinc-300">{batch.doNow} do_now</Badge>
                          <Badge className="border border-white/10 bg-black/30 text-[10px] text-zinc-300">{batch.blocked} blocked</Badge>
                        </div>
                        <p className="mt-3 text-xs leading-5 text-zinc-400">{batch.nextStep}</p>
                        {batch.operatorChecklist.length > 0 && (
                          <ul className="mt-3 space-y-1 text-xs leading-4 text-sky-100/75">
                            {batch.operatorChecklist.slice(0, 3).map((step) => (
                              <li key={step}>{step}</li>
                            ))}
                          </ul>
                        )}
                        <div className="mt-3 flex flex-wrap gap-2">
                          {batch.portalUrls.slice(0, 2).map((portalUrl) => (
                            <a key={portalUrl} href={portalUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md border border-sky-300/20 px-2 py-1 text-xs text-sky-100 hover:bg-sky-300/10">
                              Portal
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          ))}
                          {batch.executionUrls.filter((url) => url.startsWith("/")).slice(0, 1).map((executionUrl) => (
                            <a key={executionUrl} href={executionUrl} className="inline-flex items-center gap-1 rounded-md border border-cyan-300/20 px-2 py-1 text-xs text-cyan-100 hover:bg-cyan-300/10">
                              Local
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          ))}
                          {batch.evidenceRows.length > 0 && (
                            <Button size="sm" variant="outline" className="h-7 border-green-300/20 bg-transparent px-2 text-xs text-green-100 hover:bg-green-300/10" onClick={() => appendLaunchEvidenceBatchRows(batch.evidenceRows)}>
                              <UploadCloud className="mr-1 h-3 w-3" />
                              Rows
                            </Button>
                          )}
                          {batch.credentialTemplates.length > 0 && (
                            <Button size="sm" variant="outline" className="h-7 border-cyan-300/20 bg-transparent px-2 text-xs text-cyan-100 hover:bg-cyan-300/10" onClick={() => {
                              setCredentialBatchText((current) => `${current.trim() ? `${current.trim()}\n\n` : ""}${batch.credentialTemplates.join("\n\n")}`);
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

                {(status.credentialSetup.credentialPastePack || []).some((item) => item.status !== "ready") && (
                  <div className="rounded-md border border-amber-300/20 bg-amber-950/10 p-3" data-testid="clippers-credential-unlock-queue">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-white">Credential Unlock Queue</p>
                        <p className="mt-1 text-xs leading-5 text-zinc-500">Solo lo que falta para desbloquear OAuth/permisos; no muestra valores secretos.</p>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 border-amber-300/20 bg-transparent px-2 text-xs text-amber-100 hover:bg-amber-300/10"
                        onClick={() => appendCredentialBatchText(
                          (status.credentialSetup.credentialPastePack || [])
                            .filter((item) => item.status !== "ready" && item.missingSuggestedEnvVars.length > 0)
                            .map((item) => item.envTemplate)
                            .join("\n\n"),
                          "Missing credential queue cargada",
                        )}
                        data-testid="load-clippers-missing-credential-queue-button"
                      >
                        <KeyRound className="mr-1 h-3 w-3" />
                        Load missing only
                      </Button>
                    </div>
                    <div className={cn(tunnelGridClass, "mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4")}>
                      {(status.credentialSetup.credentialPastePack || []).filter((item) => item.status !== "ready").map((item) => (
                        <div key={`unlock-${item.id}`} className={cn(tunnelBoxClass, "bg-black/30 p-3")}>
                          <div className="flex items-center justify-between gap-2">
                            <p className="truncate text-xs font-medium text-white">{item.label}</p>
                            <Badge className={cn("shrink-0 border text-[10px]", credentialSetupBadge(item.status))}>{item.status}</Badge>
                          </div>
                          <div className="mt-2 flex flex-wrap gap-1">
                            <Badge className="border border-amber-300/20 bg-amber-950/40 text-[10px] text-amber-100">{item.platform}</Badge>
                            <Badge className="border border-white/10 bg-white/5 text-[10px] text-zinc-300">{item.missingSuggestedEnvVars.length} env</Badge>
                          </div>
                          <p className="mt-2 break-all font-mono text-[11px] leading-4 text-amber-100/80">{item.missingSuggestedEnvVars.join(" | ")}</p>
                          <p className="mt-2 line-clamp-3 text-xs leading-5 text-zinc-500">{item.nextStep}</p>
                          {item.localDropFileNames?.[0] && (
                            <p className="mt-2 break-all text-[11px] leading-4 text-zinc-600">Drop: {item.localDropFileNames[0]}</p>
                          )}
                          <div className="mt-3 flex flex-wrap gap-2">
                            {item.portalUrl && (
                              <a href={item.portalUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md border border-amber-300/20 px-2 py-1 text-xs text-amber-100 hover:bg-amber-300/10">
                                Portal
                                <ExternalLink className="h-3 w-3" />
                              </a>
                            )}
                            {item.docsUrl && (
                              <a href={item.docsUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md border border-cyan-300/20 px-2 py-1 text-xs text-cyan-100 hover:bg-cyan-300/10">
                                Docs
                                <ExternalLink className="h-3 w-3" />
                              </a>
                            )}
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 border-cyan-300/20 bg-transparent px-2 text-xs text-cyan-100 hover:bg-cyan-300/10"
                              onClick={() => appendCredentialBatchText(item.envTemplate, `${item.label} env template agregado`)}
                            >
                              Env
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="rounded-md border border-emerald-300/15 bg-emerald-950/10 p-3">
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-white">All missing credentials paste pack</p>
                      <p className="mt-1 text-xs leading-5 text-zinc-500">Un solo template seguro para completar TikTok, Meta, Google/YouTube, Drive y token vault.</p>
                    </div>
                    <Button size="sm" variant="outline" className="h-8 border-emerald-300/20 bg-transparent px-2 text-xs text-emerald-100 hover:bg-emerald-300/10" onClick={() => {
                      setCredentialBatchText(status.credentialSetup.credentialPasteTemplate);
                      setCredentialBatchPreview(null);
                    }}>
                      <KeyRound className="mr-1 h-3 w-3" />
                      Cargar missing pack
                    </Button>
                  </div>
                  <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                    {(status.credentialSetup.credentialPastePack || []).map((item) => (
                      <div key={item.id} className="rounded-md border border-white/10 bg-black/30 p-2">
                        <div className="flex items-center justify-between gap-2">
                          <p className="truncate text-xs font-medium text-white">{item.importOrder}. {item.label}</p>
                          <Badge className={cn("shrink-0 border text-[10px]", credentialSetupBadge(item.status))}>{item.status}</Badge>
                        </div>
                        <p className="mt-1 text-xs capitalize text-zinc-500">{item.platform}</p>
                        <p className="mt-2 break-all font-mono text-[11px] leading-4 text-emerald-100/75">{item.missingSuggestedEnvVars.length ? item.missingSuggestedEnvVars.join(" | ") : "ready"}</p>
                        <p className="mt-2 text-[11px] leading-4 text-zinc-500">{item.nextStep}</p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {item.portalUrl && (
                            <a href={item.portalUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md border border-emerald-300/20 px-2 py-1 text-xs text-emerald-100 hover:bg-emerald-300/10">
                              Portal
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          )}
                          {item.missingSuggestedEnvVars.length > 0 && (
                            <Button size="sm" variant="outline" className="h-7 border-cyan-300/20 bg-transparent px-2 text-xs text-cyan-100 hover:bg-cyan-300/10" onClick={() => {
                              setCredentialBatchText((current) => `${current.trim() ? `${current.trim()}\n\n` : ""}${item.envTemplate}`);
                              setCredentialBatchPreview(null);
                            }}>
                              Env
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                  {status.credentialSetup.credentialPasteChecklist.length > 0 && (
                    <ul className="mt-3 grid gap-1 text-xs leading-5 text-emerald-100/75 md:grid-cols-2">
                      {status.credentialSetup.credentialPasteChecklist.slice(0, 6).map((step) => (
                        <li key={step}>{step}</li>
                      ))}
                    </ul>
                  )}
                </div>

                <div className="rounded-md border border-violet-300/15 bg-violet-950/10 p-3" data-testid="clippers-credential-transfer-kit">
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-white">Credential Transfer Kit</p>
                      <p className="mt-1 text-xs leading-5 text-zinc-500">Puente seguro para traer keys desde Drive o archivos locales hacia Credential Setup sin exponer valores.</p>
                      <p className="mt-2 break-all text-xs text-zinc-600">Runbook: {status.credentialSetup.credentialTransferKitMarkdownPath}</p>
                      <p className="mt-1 break-all text-xs text-zinc-600">Env: {status.credentialSetup.credentialTransferKitEnvPath}</p>
                      {status.credentialSetup.credentialTransferKitGeneratedAt && (
                        <p className="mt-1 text-xs text-zinc-600">actualizado: {formatDate(status.credentialSetup.credentialTransferKitGeneratedAt)}</p>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 border-violet-300/20 bg-transparent px-2 text-xs text-violet-100 hover:bg-violet-300/10"
                        onClick={() => appendCredentialBatchText(status.credentialSetup.credentialTransferTemplate, "Credential Transfer Kit cargado")}
                        data-testid="load-credential-transfer-kit-button"
                      >
                        <KeyRound className="mr-1 h-3 w-3" />
                        Cargar transfer kit
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 border-cyan-300/20 bg-transparent px-2 text-xs text-cyan-100 hover:bg-cyan-300/10"
                        onClick={() => credentialDropStarterMutation.mutate()}
                        disabled={credentialDropStarterMutation.isPending || isLoading}
                        data-testid="prepare-clippers-credential-drop-starter-button"
                      >
                        {credentialDropStarterMutation.isPending ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <FolderOpen className="mr-1 h-3 w-3" />}
                        Starter files
                      </Button>
                    </div>
                  </div>
                  <div className="mt-3 grid gap-2 text-xs text-violet-100/80 md:grid-cols-2">
                    {(status.credentialSetup.credentialTransferChecklist || []).slice(0, 4).map((step) => (
                      <p key={step} className="flex gap-2 leading-5">
                        <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-violet-200" />
                        {step}
                      </p>
                    ))}
                  </div>
                  {status.credentialSetup.credentialDropStarter && (
                    <div className="mt-3 rounded-md border border-cyan-300/15 bg-cyan-950/10 p-2" data-testid="clippers-credential-drop-starter">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <p className="text-xs font-medium text-cyan-100">Credential drop starter</p>
                          <p className="mt-1 text-xs leading-5 text-zinc-500">{status.credentialSetup.credentialDropStarter.nextStep}</p>
                          <p className="mt-1 break-all text-[11px] text-zinc-600">Runbook: {status.credentialSetup.credentialDropStarterMarkdownPath}</p>
                        </div>
                        <Badge className={cn("w-fit border text-[10px]", status.credentialSetup.credentialDropStarter.status === "ready" ? "border-emerald-300/30 bg-emerald-300/10 text-emerald-200" : status.credentialSetup.credentialDropStarter.status === "prepared" ? "border-cyan-300/30 bg-cyan-300/10 text-cyan-100" : "border-amber-300/30 bg-amber-300/10 text-amber-100")}>
                          {status.credentialSetup.credentialDropStarter.status}
                        </Badge>
                      </div>
                      <div className="mt-2 grid gap-2 text-[11px] text-zinc-500 sm:grid-cols-5">
                        <p>Files: {status.credentialSetup.credentialDropStarter.totals.files}</p>
                        <p>Created: {status.credentialSetup.credentialDropStarter.totals.created}</p>
                        <p>Existing: {status.credentialSetup.credentialDropStarter.totals.existing}</p>
                        <p>Missing: {status.credentialSetup.credentialDropStarter.totals.missing}</p>
                        <p>Env: {status.credentialSetup.credentialDropStarter.totals.envVars}</p>
                      </div>
                      <div className="mt-2 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
                        {status.credentialSetup.credentialDropStarter.files.slice(0, 4).map((file) => (
                          <div key={file.relativePath} className="rounded-md border border-white/10 bg-black/30 p-2">
                            <div className="flex items-center justify-between gap-2">
                              <p className="truncate text-xs font-medium text-white">{file.label}</p>
                              <Badge className="shrink-0 border border-white/10 bg-white/5 text-[10px] text-zinc-300">{file.status}</Badge>
                            </div>
                            <p className="mt-1 break-all text-[11px] leading-4 text-zinc-500">{file.relativePath}</p>
                            <p className="mt-1 break-all text-[11px] leading-4 text-cyan-100/75">{file.envVars.length ? file.envVars.join(", ") : "ready"}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                    {(status.credentialSetup.credentialTransferKitItems || []).map((item) => (
                      <div key={item.id} className="rounded-md border border-white/10 bg-black/30 p-2">
                        <div className="flex items-center justify-between gap-2">
                          <p className="truncate text-xs font-medium text-white">{item.label}</p>
                          <Badge className={cn("shrink-0 border text-[10px]", credentialSetupBadge(item.status))}>{item.status}</Badge>
                        </div>
                        <p className="mt-1 text-xs capitalize text-zinc-500">{item.platform}</p>
                        <div className="mt-2 rounded-md border border-violet-300/10 bg-violet-950/10 p-2">
                          <p className="text-[10px] font-medium uppercase text-violet-200">Drive search</p>
                          <div className="mt-1 flex flex-wrap gap-1">
                            {item.driveSearchQueries.slice(0, 3).map((query, index) => (
                              <a
                                key={`${item.id}-${query}`}
                                href={item.driveSearchUrls?.[index] || googleDriveSearchUrl(query)}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex max-w-full items-center gap-1 rounded-md border border-violet-300/20 px-1.5 py-0.5 text-[10px] text-violet-100 hover:bg-violet-300/10"
                              >
                                <span className="truncate">Query {index + 1}</span>
                                <ExternalLink className="h-3 w-3 shrink-0" />
                              </a>
                            ))}
                          </div>
                          <p className="mt-2 break-all text-[11px] leading-4 text-violet-100/75">{item.driveSearchQueries[0] || item.nextStep}</p>
                        </div>
                        <div className="mt-2 rounded-md border border-white/10 bg-black/20 p-2">
                          <p className="text-[10px] font-medium uppercase text-zinc-400">Local drop targets</p>
                          <ul className="mt-1 space-y-1 text-[11px] leading-4 text-zinc-500">
                            {item.localDropFileNames.slice(0, 3).map((fileName) => (
                              <li key={`${item.id}-${fileName}`} className="break-all">{fileName}</li>
                            ))}
                          </ul>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {item.portalUrl && (
                            <a href={item.portalUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md border border-violet-300/20 px-2 py-1 text-xs text-violet-100 hover:bg-violet-300/10">
                              Portal
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          )}
                          {item.missingSuggestedEnvVars.length > 0 && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 border-violet-300/20 bg-transparent px-2 text-xs text-violet-100 hover:bg-violet-300/10"
                              onClick={() => appendCredentialBatchText(item.envTemplate, `${item.label} transfer template agregado`)}
                            >
                              Env
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
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

                {status.credentialSetup.credentialDropDiagnostic && (
                  <div className="rounded-md border border-amber-300/15 bg-amber-950/10 p-3" data-testid="clippers-credential-drop-diagnostic">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-white">Credential drop diagnostic</p>
                        <p className="mt-1 text-xs leading-5 text-zinc-500">{status.credentialSetup.credentialDropDiagnostic.nextStep}</p>
                        <p className="mt-2 break-all text-xs text-zinc-600">Reporte: {status.credentialSetup.credentialDropDiagnosticMarkdownPath}</p>
                      </div>
                      <Badge className={cn("w-fit border", status.credentialSetup.credentialDropDiagnostic.status === "ready_to_import" ? "border-emerald-300/30 bg-emerald-300/10 text-emerald-200" : status.credentialSetup.credentialDropDiagnostic.status === "no_candidates" ? "border-zinc-600 bg-zinc-900 text-zinc-300" : "border-amber-300/30 bg-amber-300/10 text-amber-200")}>
                        {status.credentialSetup.credentialDropDiagnostic.status}
                      </Badge>
                    </div>
                    <div className="mt-3 grid gap-2 text-xs text-zinc-500 md:grid-cols-4 xl:grid-cols-8">
                      <p>Files: {status.credentialSetup.credentialDropDiagnostic.totals.files}</p>
                      <p>Drop: {status.credentialSetup.credentialDropDiagnostic.totals.dropCandidates}</p>
                      <p>Root: {status.credentialSetup.credentialDropDiagnostic.totals.rootCandidates}</p>
                      <p>Eligible: {status.credentialSetup.credentialDropDiagnostic.totals.importEligible}</p>
                      <p>Templates: {status.credentialSetup.credentialDropDiagnostic.totals.templateFiles ?? 0}</p>
                      <p>Pending: {status.credentialSetup.credentialDropDiagnostic.totals.pendingEnvVars ?? 0}</p>
                      <p>Accepted: {status.credentialSetup.credentialDropDiagnostic.acceptedEnvVars.length}</p>
                      <p>Errors: {status.credentialSetup.credentialDropDiagnostic.fileErrors.length}</p>
                    </div>
                    <div className="mt-3 rounded-md border border-white/10 bg-black/30 p-2">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-200">Accepted env names</p>
                      <p className="mt-1 break-all text-xs leading-4 text-amber-100/80">
                        {status.credentialSetup.credentialDropDiagnostic.acceptedEnvVars.length ? status.credentialSetup.credentialDropDiagnostic.acceptedEnvVars.join(", ") : "ninguna detectada todavia"}
                      </p>
                    </div>
                    {status.credentialSetup.credentialDropDiagnostic.fileErrors.length > 0 && (
                      <div className="mt-3 grid gap-2 md:grid-cols-2">
                        {status.credentialSetup.credentialDropDiagnostic.fileErrors.slice(0, 4).map((file) => (
                          <div key={`${file.relativePath}-${file.reason}`} className="rounded-md border border-amber-300/15 bg-black/30 p-2">
                            <p className="break-all text-xs font-medium text-amber-100">{file.relativePath}</p>
                            <p className="mt-1 text-xs leading-4 text-amber-100/70">{file.reason}</p>
                          </div>
                        ))}
                      </div>
                    )}
                    {(status.credentialSetup.credentialDropDiagnostic.ignoredTemplateFiles ?? []).length > 0 && (
                      <div className="mt-3 grid gap-2 md:grid-cols-2">
                        {(status.credentialSetup.credentialDropDiagnostic.ignoredTemplateFiles ?? []).slice(0, 4).map((file) => (
                          <div key={`template-${file.relativePath}`} className="rounded-md border border-sky-300/15 bg-black/30 p-2">
                            <div className="flex items-center justify-between gap-2">
                              <p className="truncate text-xs font-medium text-sky-100">{file.fileName}</p>
                              <Badge className="shrink-0 border border-sky-300/20 bg-sky-950/40 text-[10px] text-sky-100">{file.location}</Badge>
                            </div>
                            <p className="mt-2 break-all text-xs text-zinc-500">{file.relativePath}</p>
                            <p className="mt-2 text-xs leading-4 text-sky-100/75">{file.nextStep}</p>
                          </div>
                        ))}
                      </div>
                    )}
                    {status.credentialSetup.credentialDropDiagnostic.files.length > 0 && (
                      <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                        {status.credentialSetup.credentialDropDiagnostic.files.slice(0, 6).map((file) => (
                          <div key={file.relativePath} className="rounded-md border border-white/10 bg-black/30 p-2">
                            <div className="flex items-center justify-between gap-2">
                              <p className="truncate text-xs font-medium text-white">{file.fileName}</p>
                              <Badge className={cn("border text-[10px]", file.importEligible ? "border-emerald-300/30 bg-emerald-300/10 text-emerald-200" : "border-zinc-600 bg-zinc-900 text-zinc-300")}>
                                {file.importEligible ? "eligible" : file.location}
                              </Badge>
                            </div>
                            <p className="mt-2 break-all text-xs text-zinc-500">{file.relativePath}</p>
                            {(file.pendingEnvVars ?? []).length > 0 && <p className="mt-2 break-all text-xs leading-4 text-cyan-100/80">Pendiente: {file.pendingEnvVars.join(", ")}</p>}
                            {file.issue && <p className="mt-2 text-xs leading-4 text-amber-200">{file.issue}</p>}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

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
                      <Label htmlFor="clipper-credential-batch" className="text-xs text-zinc-400">Batch .env o credential JSON</Label>
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
                        <p className="mt-1 break-all text-[11px] leading-4 text-sky-100/70">Repair CSV: {status.credentialDoctor.repairWorksheetCsvPath}</p>
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
                          <div className="mt-2 rounded border border-white/10 bg-black/20 p-2">
                            <div className="flex items-center justify-between gap-2">
                              <p className="truncate text-[11px] font-medium text-zinc-300">{item.dropTarget || "drop target pending"}</p>
                              <Badge className={cn("border text-[10px]", credentialDropFileBadge(item.dropFileStatus || "missing"))}>{item.dropFileStatus || "missing"}</Badge>
                            </div>
                            <p className="mt-1 text-[11px] leading-4 text-zinc-500">Names: {item.dropFileEnvVars?.length ? item.dropFileEnvVars.join(", ") : "none"}</p>
                            <p className="mt-1 text-[11px] leading-4 text-zinc-500">Ready: {item.dropFileReadyEnvVars?.length ? item.dropFileReadyEnvVars.join(", ") : "none"}</p>
                            {(item.dropFilePendingEnvVars?.length || 0) > 0 && (
                              <p className="mt-1 text-[11px] leading-4 text-amber-200">Pending values: {item.dropFilePendingEnvVars?.join(", ")}</p>
                            )}
                            <p className="mt-1 text-[11px] leading-4 text-zinc-500">{item.dropFileNextStep || "Run Credential Doctor to refresh drop file diagnostics."}</p>
                          </div>
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
                          {status.productionUrlVerification.dnsDiagnostic.repairRunbook.length > 0 && (
                            <div className="mt-3 rounded-md border border-sky-300/15 bg-sky-950/10 p-2">
                              <p className="text-[10px] font-semibold uppercase tracking-wide text-sky-200">DNS repair runbook</p>
                              <ul className="mt-2 space-y-1 text-[11px] leading-4 text-sky-100/80">
                                {status.productionUrlVerification.dnsDiagnostic.repairRunbook.slice(0, 4).map((step) => (
                                  <li key={step}>{step}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                          {status.productionUrlVerification.dnsDiagnostic.providerRecipes.length > 0 && (
                            <div className="mt-3 grid gap-2 lg:grid-cols-3">
                              {status.productionUrlVerification.dnsDiagnostic.providerRecipes.slice(0, 3).map((recipe) => (
                                <div key={recipe.provider} className="rounded-md border border-white/10 bg-black/25 p-2">
                                  <div className="flex items-center justify-between gap-2">
                                    <p className="truncate text-xs font-medium text-white">{recipe.provider}</p>
                                    <a href={recipe.portalUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11px] text-sky-100 hover:text-white">
                                      Portal
                                      <ExternalLink className="h-3 w-3" />
                                    </a>
                                  </div>
                                  <p className="mt-1 text-[11px] text-zinc-500">Record: {recipe.bestRecordId}</p>
                                  <p className="mt-2 text-[11px] leading-4 text-sky-100/75">{recipe.steps[0]}</p>
                                  <p className="mt-1 text-[11px] leading-4 text-emerald-100/70">{recipe.doneCriteria[0]}</p>
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
                    {(status.oauthConnectionPack.platformBatches || []).length > 0 && (
                      <div className="mt-3 grid gap-3 md:grid-cols-3">
                        {status.oauthConnectionPack.platformBatches.map((batch) => (
                          <div key={batch.id} className="rounded-md border border-teal-300/15 bg-black/25 p-3">
                            <div className="flex items-center justify-between gap-2">
                              <p className="truncate text-sm font-medium text-white">{batch.label}</p>
                              <Badge className={cn("shrink-0 border text-[10px]", oauthConnectionPackBadge(batch.status))}>{batch.status}</Badge>
                            </div>
                            <div className="mt-2 grid grid-cols-2 gap-1 text-[11px] text-zinc-500">
                              <p>Connections: {batch.connections}</p>
                              <p>Ready: {batch.ready}</p>
                              <p>Blocked: {batch.blocked}</p>
                              <p>Tokens: {batch.tokensSaved}</p>
                            </div>
                            <p className="mt-2 break-all text-[11px] leading-4 text-teal-100/70">Redirect: {batch.redirectUri}</p>
                            <p className="mt-2 text-xs leading-5 text-amber-200">{batch.nextStep}</p>
                            <div className="mt-3 flex flex-wrap gap-2">
                              {batch.authUrl && (
                                <a href={batch.authUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md border border-cyan-300/20 px-2 py-1 text-xs text-cyan-100 hover:bg-cyan-300/10">
                                  OAuth
                                  <ExternalLink className="h-3 w-3" />
                                </a>
                              )}
                              <a href={batch.developerPortalUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md border border-teal-300/20 px-2 py-1 text-xs text-teal-100 hover:bg-teal-300/10">
                                Portal
                                <ExternalLink className="h-3 w-3" />
                              </a>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
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
                        placeholder={status.oauthGoLive?.productionUrlReady ? status.oauthGoLive.publicBaseUrl : "https://clippers.tu-dominio.com"}
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
                  {(status.developerAppEvidence.connectionKitItems || []).length > 0 && (
                    <div className="mt-3 rounded-md border border-blue-300/20 bg-blue-950/10 p-3" data-testid="clippers-developer-app-connection-kit">
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                        <div className="min-w-0">
                          <p className="font-medium text-white">Developer App Connection Kit</p>
                          <p className="mt-1 text-xs leading-5 text-zinc-500">Crea apps developer, registra redirect URIs y carga evidence rows sin pegar client secrets ni tokens.</p>
                          <p className="mt-2 break-all text-xs text-zinc-600">CSV: {status.developerAppEvidence.connectionKitCsvPath}</p>
                          <p className="mt-1 break-all text-xs text-zinc-600">Runbook: {status.developerAppEvidence.connectionKitMarkdownPath}</p>
                          {status.developerAppEvidence.connectionKitGeneratedAt && (
                            <p className="mt-1 text-xs text-zinc-600">actualizado: {formatDate(status.developerAppEvidence.connectionKitGeneratedAt)}</p>
                          )}
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => appendLaunchEvidenceBatchRows(status.developerAppEvidence.connectionKitItems.map((item) => item.submittedEvidenceRow))}
                          className="border-blue-300/30 text-blue-100 hover:bg-blue-300/10"
                          data-testid="load-developer-app-connection-kit-button"
                        >
                          <UploadCloud className="mr-2 h-4 w-4" />
                          Cargar apps
                        </Button>
                      </div>
                      {(status.developerAppEvidence.connectionKitChecklist || []).length > 0 && (
                        <div className="mt-3 grid gap-2 text-xs text-blue-100/80 md:grid-cols-2">
                          {status.developerAppEvidence.connectionKitChecklist.slice(0, 4).map((step) => (
                            <p key={step} className="flex gap-2 leading-5">
                              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-blue-200" />
                              {step}
                            </p>
                          ))}
                        </div>
                      )}
                      {(status.developerAppEvidence.connectionKitPlatformBatches || []).length > 0 && (
                        <div className="mt-3 grid gap-3 md:grid-cols-3">
                          {status.developerAppEvidence.connectionKitPlatformBatches.map((batch) => (
                            <div key={batch.id} className="rounded-md border border-blue-300/15 bg-black/25 p-3">
                              <div className="flex items-center justify-between gap-2">
                                <p className="truncate text-sm font-medium text-white">{batch.label}</p>
                                <Badge className={cn("shrink-0 border text-[10px]", developerAppEvidenceBadge(batch.status))}>{batch.status}</Badge>
                              </div>
                              <div className="mt-2 grid grid-cols-2 gap-1 text-[11px] text-zinc-500">
                                <p>Scopes: {batch.scopes.length}</p>
                                <p>Missing env: {batch.missingEnvVars.length}</p>
                              </div>
                              <p className="mt-2 break-all text-[11px] leading-4 text-blue-100/70">Submitted template: {batch.submittedTemplateFilePath}</p>
                              <p className="mt-1 break-all text-[11px] leading-4 text-teal-100/70">Approved template: {batch.approvedTemplateFilePath}</p>
                              <p className="mt-1 break-all text-[11px] leading-4 text-blue-100/70">Submitted drop: {batch.submittedDropFilePath}</p>
                              <p className="mt-1 break-all text-[11px] leading-4 text-emerald-100/70">Approved drop: {batch.approvedDropFilePath}</p>
                              <p className="mt-2 text-xs leading-5 text-zinc-500">{batch.nextStep}</p>
                              <div className="mt-3 flex flex-wrap gap-2">
                                <a href={batch.developerPortalUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md border border-blue-300/20 px-2 py-1 text-xs text-blue-100 hover:bg-blue-300/10">
                                  Portal
                                  <ExternalLink className="h-3 w-3" />
                                </a>
                                <Button size="sm" variant="outline" className="h-7 border-blue-300/20 bg-transparent px-2 text-xs text-blue-100 hover:bg-blue-300/10" onClick={() => setLaunchEvidenceBatchText(batch.submittedDropTemplate || launchEvidenceBatchHeader)}>
                                  Submitted CSV
                                </Button>
                                <Button size="sm" variant="outline" className="h-7 border-emerald-300/20 bg-transparent px-2 text-xs text-emerald-100 hover:bg-emerald-300/10" onClick={() => setLaunchEvidenceBatchText(batch.approvedDropTemplate || launchEvidenceBatchHeader)}>
                                  Approved CSV
                                </Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                      <div className="mt-3 grid gap-3 md:grid-cols-3">
                        {status.developerAppEvidence.connectionKitItems.map((item) => (
                          <div key={item.platform} className="rounded-md border border-white/10 bg-black/30 p-3">
                            <div className="flex items-center justify-between gap-3">
                              <p className="truncate text-sm font-medium text-white">{item.label}</p>
                              <Badge className={cn("shrink-0 border", developerAppEvidenceBadge(item.status))}>{item.status}</Badge>
                            </div>
                            <p className="mt-2 break-all text-xs text-zinc-500">Redirect: {item.redirectUri}</p>
                            <p className="mt-2 text-xs text-zinc-500">Scopes: {item.scopes.length}</p>
                            <p className="mt-1 text-xs text-zinc-500">Missing env: {item.missingEnvVars.length}</p>
                            <div className="mt-3 flex flex-wrap gap-2">
                              <a href={item.developerPortalUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md border border-white/10 px-2 py-1 text-xs text-blue-200 hover:bg-white/5">
                                Portal
                                <ExternalLink className="h-3 w-3" />
                              </a>
                              <Button size="sm" variant="outline" className="h-7 border-blue-300/20 bg-transparent px-2 text-xs text-blue-100 hover:bg-blue-300/10" onClick={() => appendLaunchEvidenceBatchRow(item.submittedEvidenceRow)}>
                                Row
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
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

                <div className="rounded-md border border-amber-300/20 bg-amber-950/10 p-3" data-testid="clippers-permission-unlock-queue">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-white">Permission Unlock Queue</p>
                      <p className="mt-1 text-xs leading-5 text-zinc-500">Scopes exactos que bloquean autopost; usa estos rows solo despues de solicitar/aprobar en el portal real.</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 border-blue-300/20 bg-transparent px-2 text-xs text-blue-100 hover:bg-blue-300/10"
                        onClick={() => appendLaunchEvidenceBatchRows(status.permissionTracker.items.map((item) => item.evidenceBatchRow))}
                        data-testid="append-clippers-permission-requested-rows-button"
                      >
                        <UploadCloud className="mr-1 h-3 w-3" />
                        Requested rows
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 border-green-300/20 bg-transparent px-2 text-xs text-green-100 hover:bg-green-300/10"
                        onClick={() => appendLaunchEvidenceBatchRows(status.permissionTracker.items.map((item) => item.evidenceRecipeRow))}
                        data-testid="append-clippers-permission-recipe-rows-button"
                      >
                        <UploadCloud className="mr-1 h-3 w-3" />
                        Recipe rows
                      </Button>
                      {(status.platformWarRoom?.permissionApprovalRows || []).length > 0 && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 border-emerald-300/20 bg-transparent px-2 text-xs text-emerald-100 hover:bg-emerald-300/10"
                          onClick={() => appendLaunchEvidenceBatchRows((status.platformWarRoom.permissionApprovalRows || []).map((row) => row.approvedEvidenceRow))}
                          data-testid="append-clippers-permission-approved-rows-button"
                        >
                          <UploadCloud className="mr-1 h-3 w-3" />
                          Approved rows
                        </Button>
                      )}
                    </div>
                  </div>
                  <div className={cn(tunnelGridClass, "mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3")}>
                    {status.permissionTracker.items.map((item) => (
                      <div key={`permission-unlock-${item.id}`} className={cn(tunnelBoxClass, "bg-black/30 p-3")}>
                        <div className="flex items-center justify-between gap-2">
                          <p className="truncate text-xs font-medium text-white">{item.platform} · {item.scope}</p>
                          <Badge className={cn("shrink-0 border text-[10px]", permissionTrackerBadge(item.status))}>{item.status}</Badge>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-1">
                          <Badge className="border border-amber-300/20 bg-amber-950/40 text-[10px] text-amber-100">{item.appReviewRequired ? "app review" : "scope"}</Badge>
                          <Badge className="border border-white/10 bg-white/5 text-[10px] text-zinc-300">{item.statusSource}</Badge>
                        </div>
                        <p className="mt-2 line-clamp-3 text-xs leading-5 text-zinc-500">{item.nextStep}</p>
                        {item.blockers.length > 0 && (
                          <p className="mt-2 line-clamp-2 text-xs leading-4 text-amber-100/80">{item.blockers[0]}</p>
                        )}
                        <div className="mt-3 flex flex-wrap gap-2">
                          <a href={item.developerPortalUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md border border-amber-300/20 px-2 py-1 text-xs text-amber-100 hover:bg-amber-300/10">
                            Portal
                            <ExternalLink className="h-3 w-3" />
                          </a>
                          <a href={item.docsUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md border border-cyan-300/20 px-2 py-1 text-xs text-cyan-100 hover:bg-cyan-300/10">
                            Docs
                            <ExternalLink className="h-3 w-3" />
                          </a>
                          <Button size="sm" variant="outline" className="h-7 border-blue-300/20 bg-transparent px-2 text-xs text-blue-100 hover:bg-blue-300/10" onClick={() => appendLaunchEvidenceBatchRow(item.evidenceBatchRow)}>
                            Requested
                          </Button>
                          <Button size="sm" variant="outline" className="h-7 border-green-300/20 bg-transparent px-2 text-xs text-green-100 hover:bg-green-300/10" onClick={() => appendLaunchEvidenceBatchRow(item.evidenceRecipeRow)}>
                            Recipe
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
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
                    {(status.permissionRequestPack.platformBatches || []).length > 0 && (
                      <div className="mt-3 rounded-md border border-sky-300/15 bg-sky-950/10 p-3">
                        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                          <div className="min-w-0">
                            <p className="text-xs font-semibold uppercase tracking-wide text-sky-200">Platform submission batches</p>
                            <p className="mt-1 text-xs leading-5 text-zinc-500">Agrupa scopes por portal para pedir permisos, adjuntar evidencia y registrar requested/approved.</p>
                          </div>
                          <Badge className="w-fit border border-sky-300/20 bg-sky-950/40 text-[10px] text-sky-100">{status.permissionRequestPack.totals.platformBatches} batches</Badge>
                        </div>
                        <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                          {status.permissionRequestPack.platformBatches.map((batch) => (
                            <div key={batch.id} className="rounded-md border border-white/10 bg-black/30 p-3">
                              <div className="flex items-center justify-between gap-2">
                                <p className="truncate text-sm font-medium text-white">{batch.label}</p>
                                <Badge className={cn("shrink-0 border text-[10px]", permissionRequestPackBadge(batch.status))}>{batch.status}</Badge>
                              </div>
                              <div className="mt-2 flex flex-wrap gap-2">
                                <Badge className="border border-white/10 bg-black/30 text-[10px] text-zinc-300">{batch.permissions} scopes</Badge>
                                <Badge className="border border-white/10 bg-black/30 text-[10px] text-zinc-300">{batch.requested} requested</Badge>
                                <Badge className="border border-white/10 bg-black/30 text-[10px] text-zinc-300">{batch.approved} approved</Badge>
                              </div>
                              <p className="mt-2 text-xs leading-5 text-zinc-400">{batch.nextStep}</p>
                              <p className="mt-2 break-all text-[11px] leading-4 text-zinc-600">{batch.scopes.join(", ")}</p>
                              <div className="mt-2 rounded-md border border-sky-300/10 bg-sky-950/10 p-2">
                                <p className="break-all text-[11px] leading-4 text-blue-100/75">Requested template: {batch.requestedTemplateFilePath}</p>
                                <p className="mt-1 break-all text-[11px] leading-4 text-teal-100/75">Approved template: {batch.approvedTemplateFilePath}</p>
                                <p className="break-all text-[11px] leading-4 text-sky-100/75">Requested drop: {batch.requestedDropFilePath}</p>
                                <p className="mt-1 break-all text-[11px] leading-4 text-emerald-100/75">Approved drop: {batch.approvedDropFilePath}</p>
                              </div>
                              {batch.submissionSteps.length > 0 && (
                                <ul className="mt-3 space-y-1 text-xs leading-4 text-sky-100/75">
                                  {batch.submissionSteps.slice(0, 3).map((step) => (
                                    <li key={step}>{step}</li>
                                  ))}
                                </ul>
                              )}
                              {batch.blockers.length > 0 && (
                                <div className="mt-3 rounded-md border border-amber-300/20 bg-amber-950/10 p-2">
                                  <p className="text-[10px] font-medium uppercase text-amber-200">Blockers</p>
                                  <ul className="mt-1 space-y-1 text-xs leading-4 text-amber-100/80">
                                    {batch.blockers.slice(0, 3).map((blocker) => (
                                      <li key={blocker}>{blocker}</li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                              <div className="mt-3 flex flex-wrap gap-2">
                                <a href={batch.developerPortalUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md border border-sky-300/20 px-2 py-1 text-xs text-sky-100 hover:bg-sky-300/10">
                                  Portal
                                  <ExternalLink className="h-3 w-3" />
                                </a>
                                {batch.docsUrls.slice(0, 1).map((docsUrl) => (
                                  <a key={docsUrl} href={docsUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md border border-white/10 px-2 py-1 text-xs text-cyan-200 hover:bg-white/5">
                                    Docs
                                    <ExternalLink className="h-3 w-3" />
                                  </a>
                                ))}
                                <Button size="sm" variant="outline" className="h-7 border-green-300/20 bg-transparent px-2 text-xs text-green-100 hover:bg-green-300/10" onClick={() => appendLaunchEvidenceBatchRows(batch.evidenceRecipeRows)}>
                                  <UploadCloud className="mr-1 h-3 w-3" />
                                  Recipe rows
                                </Button>
                                <Button size="sm" variant="outline" className="h-7 border-blue-300/20 bg-transparent px-2 text-xs text-blue-100 hover:bg-blue-300/10" onClick={() => appendLaunchEvidenceBatchRows(batch.requestedEvidenceRows)}>
                                  Requested
                                </Button>
                                <Button size="sm" variant="outline" className="h-7 border-blue-300/20 bg-transparent px-2 text-xs text-blue-100 hover:bg-blue-300/10" onClick={() => setLaunchEvidenceBatchText(batch.requestedDropTemplate || launchEvidenceBatchHeader)}>
                                  Requested CSV
                                </Button>
                                <Button size="sm" variant="outline" className="h-7 border-emerald-300/20 bg-transparent px-2 text-xs text-emerald-100 hover:bg-emerald-300/10" onClick={() => appendLaunchEvidenceBatchRows(batch.approvedEvidenceRows)}>
                                  Approved
                                </Button>
                                <Button size="sm" variant="outline" className="h-7 border-emerald-300/20 bg-transparent px-2 text-xs text-emerald-100 hover:bg-emerald-300/10" onClick={() => setLaunchEvidenceBatchText(batch.approvedDropTemplate || launchEvidenceBatchHeader)}>
                                  Approved CSV
                                </Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
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

                {status.permissionSubmissionDossier && (
                  <div className="rounded-md border border-cyan-300/20 bg-cyan-950/10 p-3" data-testid="clippers-permission-submission-dossier">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-white">Permission Submission Dossier: {status.permissionSubmissionDossier.markdownPath}</p>
                        <p className="mt-1 text-xs leading-5 text-zinc-500">{status.permissionSubmissionDossier.nextStep}</p>
                      </div>
                      <Badge className={cn("w-fit border", goLiveAutopilotBadge(status.permissionSubmissionDossier.status))}>{status.permissionSubmissionDossier.status}</Badge>
                    </div>
                    <div className="mt-3 grid gap-2 text-xs text-zinc-500 md:grid-cols-4 xl:grid-cols-8">
                      <p>Platforms: {status.permissionSubmissionDossier.totals.platforms}</p>
                      <p>Scopes: {status.permissionSubmissionDossier.totals.scopes}</p>
                      <p>Blocked: {status.permissionSubmissionDossier.totals.blocked}</p>
                      <p>Login: {status.permissionSubmissionDossier.totals.needsLoginRecheck}</p>
                      <p>Submit: {status.permissionSubmissionDossier.totals.readyToSubmit}</p>
                      <p>Ready: {status.permissionSubmissionDossier.totals.ready}</p>
                      <p>Requested rows: {status.permissionSubmissionDossier.totals.requestedRows}</p>
                      <p>Approved rows: {status.permissionSubmissionDossier.totals.approvedRows}</p>
                    </div>
                    <p className="mt-2 break-all text-xs text-zinc-600">CSV: {status.permissionSubmissionDossier.csvPath}</p>
                    <div className="mt-3 rounded-md border border-cyan-300/15 bg-black/25 p-2 text-[11px] leading-4 text-zinc-500">
                      <p className="break-all">Request pack: {status.permissionSubmissionDossier.sourceArtifacts.permissionRequestPackPath}</p>
                      <p className="mt-1 break-all">Official matrix: {status.permissionSubmissionDossier.sourceArtifacts.officialPermissionMatrixPath}</p>
                      <p className="mt-1 break-all">App drafts: {status.permissionSubmissionDossier.sourceArtifacts.developerApplicationDraftsPath}</p>
                      <p className="mt-1 break-all">Evidence bundle: {status.permissionSubmissionDossier.sourceArtifacts.goLiveEvidenceBundlePath}</p>
                    </div>
                    {status.permissionSubmissionDossier.items.length > 0 && (
                      <div className={cn(tunnelGridClass, "mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3")}>
                        {status.permissionSubmissionDossier.items.map((item) => (
                          <div key={item.id} className={cn(tunnelBoxClass, "bg-black/30 p-3")}>
                            <div className="flex items-center justify-between gap-2">
                              <p className="truncate text-sm font-medium text-white">{item.label}</p>
                              <Badge className={cn("shrink-0 border text-[10px]", goLiveAutopilotBadge(item.status))}>{item.status}</Badge>
                            </div>
                            <div className="mt-2 flex flex-wrap gap-2">
                              <Badge className="border border-cyan-300/20 bg-cyan-950/40 text-[10px] text-cyan-100">{item.accessMode}</Badge>
                              <Badge className="border border-white/10 bg-white/5 text-[10px] text-zinc-300">{item.submitDecision}</Badge>
                              <Badge className={cn("border text-[10px]", officialPermissionMatrixBadge(item.sourceStatus))}>{item.sourceStatus}</Badge>
                            </div>
                            <p className="mt-2 break-all text-[11px] leading-4 text-zinc-600">{item.scopes.join(", ")}</p>
                            <p className="mt-2 line-clamp-3 text-xs leading-5 text-zinc-400">{item.nextStep}</p>
                            {item.verifiedClaims.length > 0 && (
                              <p className="mt-2 line-clamp-2 text-xs leading-5 text-cyan-100/75">{item.verifiedClaims[0]}</p>
                            )}
                            {item.blockers.length > 0 && (
                              <div className="mt-3 rounded-md border border-amber-300/20 bg-amber-950/10 p-2">
                                <p className="text-[10px] font-medium uppercase text-amber-200">Blockers</p>
                                <ul className="mt-1 space-y-1 text-xs leading-4 text-amber-100/80">
                                  {item.blockers.slice(0, 3).map((blocker) => (
                                    <li key={blocker}>{blocker}</li>
                                  ))}
                                </ul>
                              </div>
                            )}
                            {item.submissionSteps.length > 0 && (
                              <ul className="mt-3 space-y-1 text-xs leading-4 text-zinc-400">
                                {item.submissionSteps.slice(0, 4).map((step) => (
                                  <li key={step}>{step}</li>
                                ))}
                              </ul>
                            )}
                            <div className="mt-3 rounded-md border border-cyan-300/10 bg-cyan-950/10 p-2">
                              <p className="break-all text-[11px] leading-4 text-blue-100/75">Requested: {item.requestedDropFilePath}</p>
                              <p className="mt-1 break-all text-[11px] leading-4 text-emerald-100/75">Approved: {item.approvedDropFilePath}</p>
                            </div>
                            <div className="mt-3 flex flex-wrap gap-2">
                              <a href={item.developerPortalUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md border border-cyan-300/20 px-2 py-1 text-xs text-cyan-100 hover:bg-cyan-300/10">
                                Portal
                                <ExternalLink className="h-3 w-3" />
                              </a>
                              {item.officialUrls.slice(0, 1).map((url) => (
                                <a key={url} href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md border border-white/10 px-2 py-1 text-xs text-cyan-200 hover:bg-white/5">
                                  Official
                                  <ExternalLink className="h-3 w-3" />
                                </a>
                              ))}
                              <Button size="sm" variant="outline" className="h-7 border-blue-300/20 bg-transparent px-2 text-xs text-blue-100 hover:bg-blue-300/10" onClick={() => appendLaunchEvidenceBatchRows(item.requestedEvidenceRows)}>
                                Requested
                              </Button>
                              <Button size="sm" variant="outline" className="h-7 border-blue-300/20 bg-transparent px-2 text-xs text-blue-100 hover:bg-blue-300/10" onClick={() => setLaunchEvidenceBatchText(item.requestedDropTemplate || launchEvidenceBatchHeader)}>
                                Requested CSV
                              </Button>
                              <Button size="sm" variant="outline" className="h-7 border-emerald-300/20 bg-transparent px-2 text-xs text-emerald-100 hover:bg-emerald-300/10" onClick={() => appendLaunchEvidenceBatchRows(item.approvedEvidenceRows)}>
                                Approved
                              </Button>
                              <Button size="sm" variant="outline" className="h-7 border-emerald-300/20 bg-transparent px-2 text-xs text-emerald-100 hover:bg-emerald-300/10" onClick={() => setLaunchEvidenceBatchText(item.approvedDropTemplate || launchEvidenceBatchHeader)}>
                                Approved CSV
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
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
                    <p className="mt-2 break-all text-xs text-zinc-600">CSV: {status.officialPermissionMatrix.csvPath}</p>
                    {(status.officialPermissionMatrix.webProofTrail || []).length > 0 && (
                      <div className="mt-3 rounded-md border border-emerald-300/15 bg-emerald-950/10 p-3" data-testid="clippers-official-permission-web-proof-trail">
                        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                          <div className="min-w-0">
                            <p className="text-xs font-semibold uppercase tracking-wide text-emerald-200">Web proof trail</p>
                            <p className="mt-1 text-xs leading-5 text-zinc-500">Evidencia oficial ya revisada para sostener las solicitudes de permisos.</p>
                          </div>
                          <Badge className="w-fit border border-emerald-300/20 bg-emerald-950/40 text-[10px] text-emerald-100">
                            {status.officialPermissionMatrix.webProofTrail.length} platforms
                          </Badge>
                        </div>
                        <div className="mt-3 grid gap-3 md:grid-cols-3">
                          {status.officialPermissionMatrix.webProofTrail.map((proof) => (
                            <div key={proof.platform} className="rounded-md border border-white/10 bg-black/30 p-3">
                              <div className="flex items-center justify-between gap-2">
                                <p className="truncate text-sm font-medium text-white">{clipperPlatformLabel(proof.platform)}</p>
                                <Badge className={cn("shrink-0 border text-[10px]", officialPermissionMatrixBadge(proof.sourceStatus))}>{proof.accessMode}</Badge>
                              </div>
                              <p className="mt-2 text-xs text-zinc-600">{proof.checkedAt}</p>
                              <p className="mt-2 text-xs leading-5 text-amber-100/85">{proof.nextHumanAction}</p>
                              {proof.verifiedClaims.length > 0 && (
                                <ul className="mt-3 space-y-1 text-xs leading-4 text-emerald-100/80">
                                  {proof.verifiedClaims.slice(0, 2).map((claim) => (
                                    <li key={claim}>{claim}</li>
                                  ))}
                                </ul>
                              )}
                              {proof.reviewerEvidence.length > 0 && (
                                <p className="mt-3 text-xs leading-5 text-zinc-400">{proof.reviewerEvidence[0]}</p>
                              )}
                              <div className="mt-3 flex flex-wrap gap-2">
                                {proof.officialUrls.slice(0, 2).map((url) => (
                                  <a key={url} href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md border border-emerald-300/20 px-2 py-1 text-xs text-emerald-100 hover:bg-emerald-300/10">
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
                    {(status.officialPermissionMatrix.sourceBatches || []).length > 0 && (
                      <div className="mt-3 rounded-md border border-cyan-300/15 bg-cyan-950/10 p-3">
                        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                          <div className="min-w-0">
                            <p className="text-xs font-semibold uppercase tracking-wide text-cyan-200">Source verification batches</p>
                            <p className="mt-1 text-xs leading-5 text-zinc-500">Confirma fuentes oficiales por plataforma antes de pedir scopes o app review.</p>
                          </div>
                          <Badge className="w-fit border border-cyan-300/20 bg-cyan-950/40 text-[10px] text-cyan-100">{status.officialPermissionMatrix.totals.sourceBatches} batches</Badge>
                        </div>
                        <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                          {status.officialPermissionMatrix.sourceBatches.map((batch) => (
                            <div key={batch.id} className="rounded-md border border-white/10 bg-black/30 p-3">
                              <div className="flex items-center justify-between gap-2">
                                <p className="truncate text-sm font-medium text-white">{batch.label}</p>
                                <Badge className={cn("shrink-0 border text-[10px]", officialPermissionMatrixBadge(batch.sourceStatus))}>{batch.accessMode}</Badge>
                              </div>
                              <p className="mt-2 break-all text-xs text-zinc-500">{batch.scopes.join(", ")}</p>
                              <p className="mt-2 text-xs leading-5 text-zinc-400">{batch.nextStep}</p>
                              {batch.verifiedClaims.length > 0 && (
                                <p className="mt-2 text-xs leading-5 text-cyan-100/75">{batch.verifiedClaims[0]}</p>
                              )}
                              {batch.blocker && (
                                <p className="mt-2 text-xs leading-5 text-amber-200">{batch.blocker}</p>
                              )}
                              {batch.recheckSteps.length > 0 && (
                                <ul className="mt-3 space-y-1 text-xs leading-4 text-zinc-400">
                                  {batch.recheckSteps.slice(0, 3).map((step) => (
                                    <li key={step}>{step}</li>
                                  ))}
                                </ul>
                              )}
                              <div className="mt-3 flex flex-wrap gap-2">
                                {batch.officialUrls.slice(0, 2).map((url) => (
                                  <a key={url} href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md border border-cyan-300/20 px-2 py-1 text-xs text-cyan-100 hover:bg-cyan-300/10">
                                    Docs
                                    <ExternalLink className="h-3 w-3" />
                                  </a>
                                ))}
                                <Button size="sm" variant="outline" className="h-7 border-blue-300/20 bg-transparent px-2 text-xs text-blue-100 hover:bg-blue-300/10" onClick={() => appendLaunchEvidenceBatchRows(batch.launchEvidenceRows)}>
                                  Requested
                                </Button>
                                <Button size="sm" variant="outline" className="h-7 border-emerald-300/20 bg-transparent px-2 text-xs text-emerald-100 hover:bg-emerald-300/10" onClick={() => appendLaunchEvidenceBatchRows(batch.approvalEvidenceRows)}>
                                  Approved
                                </Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
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
                                <div className="mt-2 rounded-md border border-white/10 bg-black/25 p-2">
                                  <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">Portal product</p>
                                  <p className="mt-1 text-xs leading-5 text-zinc-300">{scope.portalProduct}</p>
                                  <p className={cn("mt-1 text-xs leading-5", scope.requestMode === "request_now" ? "text-emerald-200" : "text-amber-200")}>
                                    {scope.requestMode}: {scope.ownerAction}
                                  </p>
                                  {scope.humanBlocker && (
                                    <p className="mt-1 text-xs leading-5 text-amber-200">{scope.humanBlocker}</p>
                                  )}
                                </div>
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
                    {(status.accountCreationPack.platformBatches || []).length > 0 && (
                      <div className="mt-3 rounded-md border border-sky-300/15 bg-sky-950/10 p-3">
                        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                          <div className="min-w-0">
                            <p className="text-xs font-semibold uppercase tracking-wide text-sky-200">Platform creation batches</p>
                            <p className="mt-1 text-xs leading-5 text-zinc-500">Crea cuentas por portal, guarda vault privado y manda evidencia de todas las cuentas de esa plataforma.</p>
                          </div>
                          <Badge className="w-fit border border-sky-300/20 bg-sky-950/40 text-[10px] text-sky-100">{status.accountCreationPack.totals.platformBatches} batches</Badge>
                        </div>
                        <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                          {status.accountCreationPack.platformBatches.map((batch) => (
                            <div key={batch.id} className="rounded-md border border-white/10 bg-black/30 p-3">
                              <div className="flex items-center justify-between gap-2">
                                <p className="truncate text-sm font-medium text-white">{batch.label}</p>
                                <Badge className={cn("shrink-0 border text-[10px]", accountCreationPackBadge(batch.status))}>{batch.status}</Badge>
                              </div>
                              <div className="mt-2 flex flex-wrap gap-2">
                                <Badge className="border border-white/10 bg-black/30 text-[10px] text-zinc-300">{batch.profiles} profiles</Badge>
                                <Badge className="border border-white/10 bg-black/30 text-[10px] text-zinc-300">{batch.evidenceMissing} missing evidence</Badge>
                              </div>
                              <p className="mt-2 break-all text-xs text-zinc-500">{batch.handles.join(", ")}</p>
                              <p className="mt-2 text-xs leading-5 text-zinc-400">{batch.nextStep}</p>
                              {batch.browserSessionChecklist.length > 0 && (
                                <ul className="mt-3 space-y-1 text-xs leading-4 text-sky-100/75">
                                  {batch.browserSessionChecklist.slice(0, 3).map((step) => (
                                    <li key={step}>{step}</li>
                                  ))}
                                </ul>
                              )}
                              {batch.blockers.length > 0 && (
                                <div className="mt-3 rounded-md border border-amber-300/20 bg-amber-950/10 p-2">
                                  <p className="text-[10px] font-medium uppercase text-amber-200">Blockers</p>
                                  <ul className="mt-1 space-y-1 text-xs leading-4 text-amber-100/80">
                                    {batch.blockers.slice(0, 3).map((blocker) => (
                                      <li key={blocker}>{blocker}</li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                              <div className="mt-3 flex flex-wrap gap-2">
                                <a href={batch.signupUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md border border-sky-300/20 px-2 py-1 text-xs text-sky-100 hover:bg-sky-300/10">
                                  Signup
                                  <ExternalLink className="h-3 w-3" />
                                </a>
                                <a href={batch.officialHelpUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md border border-white/10 px-2 py-1 text-xs text-cyan-200 hover:bg-white/5">
                                  Help
                                  <ExternalLink className="h-3 w-3" />
                                </a>
                                <Button size="sm" variant="outline" className="h-7 border-yellow-300/20 bg-transparent px-2 text-xs text-yellow-100 hover:bg-yellow-300/10" onClick={() => appendLaunchEvidenceBatchRows(batch.submittedEvidenceRows)}>
                                  Submitted
                                </Button>
                                <Button size="sm" variant="outline" className="h-7 border-green-300/20 bg-transparent px-2 text-xs text-green-100 hover:bg-green-300/10" onClick={() => appendLaunchEvidenceBatchRows(batch.verifiedEvidenceRows)}>
                                  Verified
                                </Button>
                                <Button size="sm" variant="outline" className="h-7 border-fuchsia-300/20 bg-transparent px-2 text-xs text-fuchsia-100 hover:bg-fuchsia-300/10" onClick={() => appendLaunchEvidenceBatchRows(batch.evidenceRecipeRows)}>
                                  Recipe
                                </Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
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
                            {(item.handleCheckUrls || []).length > 0 && (
                              <div className="mt-2 flex flex-wrap gap-1">
                                {item.handleCheckUrls.slice(0, 2).map((url, index) => (
                                  <a key={url} href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md border border-lime-300/20 px-2 py-1 text-[11px] text-lime-100 hover:bg-lime-300/10">
                                    {index === 0 ? "Check handle" : "Search"}
                                    <ExternalLink className="h-3 w-3" />
                                  </a>
                                ))}
                              </div>
                            )}
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
                              {(item.handleCheckUrls || []).length > 0 && (
                                <div className="mt-2 flex flex-wrap gap-1">
                                  {item.handleCheckUrls.slice(0, 2).map((url, index) => (
                                    <a key={url} href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md border border-amber-300/20 px-2 py-1 text-[11px] text-amber-100 hover:bg-amber-300/10">
                                      {index === 0 ? "Check handle" : "Search"}
                                      <ExternalLink className="h-3 w-3" />
                                    </a>
                                  ))}
                                </div>
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
                              {(item.handleCheckUrls || []).length > 0 && (
                                <div className="mt-2 flex flex-wrap gap-1">
                                  {item.handleCheckUrls.slice(0, 2).map((url, index) => (
                                    <a key={url} href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md border border-amber-300/20 px-2 py-1 text-[11px] text-amber-100 hover:bg-amber-300/10">
                                      {index === 0 ? "Check handle" : "Search"}
                                      <ExternalLink className="h-3 w-3" />
                                    </a>
                                  ))}
                                </div>
                              )}
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

                {status.accountSetupSession && (
                  <div className="rounded-md border border-lime-300/20 bg-lime-950/10 p-3" data-testid="clippers-account-setup-session">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-white">Account Setup Session: {status.accountSetupSession.markdownPath}</p>
                        <p className="mt-1 text-xs leading-5 text-zinc-500">{status.accountSetupSession.nextStep}</p>
                      </div>
                      <Badge className={cn("w-fit border", accountCreationPackBadge(status.accountSetupSession.status))}>{status.accountSetupSession.status}</Badge>
                    </div>
                    <div className="mt-3 grid gap-2 text-xs text-zinc-500 md:grid-cols-4 xl:grid-cols-8">
                      <p>Accounts: {status.accountSetupSession.totals.accounts}</p>
                      <p>Create: {status.accountSetupSession.totals.readyToCreate}</p>
                      <p>Progress: {status.accountSetupSession.totals.inProgress}</p>
                      <p>Ready: {status.accountSetupSession.totals.ready}</p>
                      <p>Blocked: {status.accountSetupSession.totals.blocked}</p>
                      <p>Portals: {status.accountSetupSession.totals.portalUrls}</p>
                      <p>Rows: {status.accountSetupSession.totals.evidenceRows}</p>
                      <p>Vault: {status.accountSetupSession.totals.vaultSlots}</p>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-8 border-yellow-300/20 bg-transparent px-2 text-xs text-yellow-100 hover:bg-yellow-300/10"
                        onClick={() => appendLaunchEvidenceBatchRows(status.accountSetupSession.items.map((item) => item.submittedEvidenceBatchRow))}
                        data-testid="append-clippers-account-setup-submitted-rows-button"
                      >
                        <UploadCloud className="mr-1 h-3 w-3" />
                        Submitted all
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-8 border-green-300/20 bg-transparent px-2 text-xs text-green-100 hover:bg-green-300/10"
                        onClick={() => appendLaunchEvidenceBatchRows(status.accountSetupSession.items.map((item) => item.verifiedEvidenceBatchRow))}
                        data-testid="append-clippers-account-setup-verified-rows-button"
                      >
                        <UploadCloud className="mr-1 h-3 w-3" />
                        Verified all
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-8 border-lime-300/20 bg-transparent px-2 text-xs text-lime-100 hover:bg-lime-300/10"
                        onClick={() => appendLaunchEvidenceBatchRows(status.accountSetupSession.items.flatMap((item) => item.evidenceRows))}
                        data-testid="append-clippers-account-setup-all-rows-button"
                      >
                        <UploadCloud className="mr-1 h-3 w-3" />
                        All account rows
                      </Button>
                    </div>
                    <p className="mt-2 break-all text-xs text-zinc-600">CSV: {status.accountSetupSession.csvPath}</p>
                    <div className="mt-3 rounded-md border border-lime-300/15 bg-black/25 p-2 text-[11px] leading-4 text-zinc-500">
                      <p className="break-all">Account pack: {status.accountSetupSession.sourceArtifacts.accountCreationPackPath}</p>
                      <p className="mt-1 break-all">Claim sheet: {status.accountSetupSession.sourceArtifacts.accountClaimSheetPath}</p>
                      <p className="mt-1 break-all">Evidence kit: {status.accountSetupSession.sourceArtifacts.accountEvidenceConnectionKitPath}</p>
                      <p className="mt-1 break-all">Account evidence template: {status.accountSetupSession.sourceArtifacts.accountSetupEvidenceTemplatePath}</p>
                      <p className="mt-1 break-all">Owner pack: {status.accountSetupSession.sourceArtifacts.ownerConnectPackPath}</p>
                    </div>
                    {status.accountSetupSession.items.length > 0 && (
                      <div className={cn(tunnelGridClass, "mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3")}>
                        {status.accountSetupSession.items.map((item) => {
                          const ownerConnectAccountItem = findOwnerAccountConnectItem(item);
                          return (
                          <div key={item.id} className={cn(tunnelBoxClass, "bg-black/30 p-3")}>
                            <div className="flex items-center justify-between gap-2">
                              <p className="truncate text-sm font-medium text-white">#{item.rank} {item.accountName}</p>
                              <Badge className={cn("shrink-0 border text-[10px]", accountCreationPackBadge(item.status))}>{item.status}</Badge>
                            </div>
                            <div className="mt-2 flex flex-wrap gap-2">
                              <Badge className="border border-lime-300/20 bg-lime-950/40 text-[10px] text-lime-100">{item.platform}</Badge>
                              <Badge className="border border-white/10 bg-white/5 text-[10px] text-zinc-300">{item.priority}</Badge>
                              <Badge className={cn("border text-[10px]", accountEvidenceBadge(item.evidenceStatus))}>{item.evidenceStatus}</Badge>
                            </div>
                            <p className="mt-2 break-all text-xs text-zinc-500">{item.handle} · {item.profileLink}</p>
                            <p className="mt-2 line-clamp-3 text-xs leading-5 text-zinc-400">{item.nextStep}</p>
                            {(item.handleCheckUrls || []).length > 0 && (
                              <div className="mt-2 flex flex-wrap gap-2">
                                {item.handleCheckUrls.slice(0, 2).map((url, index) => (
                                  <a key={url} href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md border border-lime-300/20 px-2 py-1 text-xs text-lime-100 hover:bg-lime-300/10">
                                    {index === 0 ? "Check handle" : "Search"}
                                    <ExternalLink className="h-3 w-3" />
                                  </a>
                                ))}
                              </div>
                            )}
                            <div className="mt-3 rounded-md border border-lime-300/10 bg-lime-950/10 p-2">
                              <p className="break-all text-[11px] leading-4 text-lime-100/80">Vault: {item.vaultItemName}</p>
                              <p className="mt-1 break-all text-[11px] leading-4 text-zinc-500">Login: {item.loginIdentifierLabel}</p>
                              <p className="mt-1 break-all text-[11px] leading-4 text-zinc-600">2FA: {item.twoFactorSlot}</p>
                            </div>
                            {item.copyPackage.length > 0 && (
                              <p className="mt-2 line-clamp-2 text-[11px] leading-4 text-zinc-500">
                                Copy: {item.copyPackage.slice(0, 3).map((field) => `${field.label}=${field.value}`).join(" · ")}
                              </p>
                            )}
                            {item.portalFormFields.length > 0 && (
                              <p className="mt-2 line-clamp-2 text-[11px] leading-4 text-emerald-100/75">
                                Portal: {item.portalFormFields.slice(0, 2).map((field) => `${field.field}=${field.value}`).join(" · ")}
                              </p>
                            )}
                            {ownerConnectAccountItem && (
                              <div className="mt-3 rounded-md border border-sky-300/15 bg-sky-950/10 p-2" data-testid={`clippers-account-setup-owner-progress-${item.id}`}>
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <p className="text-[10px] font-medium uppercase text-sky-200">Owner progress</p>
                                  <Badge className={cn("border text-[10px]", goLiveAutopilotBadge(ownerConnectAccountItem.progressStatus || ownerConnectAccountItem.status))}>
                                    {ownerConnectAccountItem.progressStatus || ownerConnectAccountItem.status}
                                  </Badge>
                                </div>
                                <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-sky-100/70">{ownerConnectAccountItem.nextStep}</p>
                                {ownerConnectAccountItem.progressNotes && (
                                  <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-emerald-100/75">{ownerConnectAccountItem.progressNotes}</p>
                                )}
                                <div className="mt-2 flex flex-wrap gap-2">
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    className="h-7 border-amber-300/30 bg-amber-950/20 px-2 text-[11px] text-amber-100 hover:bg-amber-900/30"
                                    disabled={ownerConnectProgressMutation.isPending}
                                    onClick={() => ownerConnectProgressMutation.mutate({
                                      itemId: ownerConnectAccountItem.id,
                                      status: "waiting",
                                      notes: "Cuenta en creacion desde Account Setup Session; evidencia real pendiente.",
                                      evidenceRows: [item.submittedEvidenceBatchRow],
                                    })}
                                    data-testid={`mark-clippers-owner-account-working-${item.id}`}
                                  >
                                    {ownerConnectProgressMutation.isPending ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Play className="mr-1 h-3 w-3" />}
                                    Working
                                  </Button>
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    className="h-7 border-emerald-300/30 bg-emerald-950/20 px-2 text-[11px] text-emerald-100 hover:bg-emerald-900/30"
                                    disabled={ownerConnectProgressMutation.isPending}
                                    onClick={() => ownerConnectProgressMutation.mutate({
                                      itemId: ownerConnectAccountItem.id,
                                      status: "done",
                                      notes: "Cuenta marcada completa localmente desde Account Setup Session; importar evidencia real para desbloquear go-live.",
                                      evidenceRows: [item.verifiedEvidenceBatchRow],
                                    })}
                                    data-testid={`mark-clippers-owner-account-done-${item.id}`}
                                  >
                                    {ownerConnectProgressMutation.isPending ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <CheckCircle2 className="mr-1 h-3 w-3" />}
                                    Done local
                                  </Button>
                                </div>
                              </div>
                            )}
                            {item.claimSteps.length > 0 && (
                              <ul className="mt-3 space-y-1 text-xs leading-4 text-lime-100/75">
                                {item.claimSteps.slice(0, 3).map((step) => (
                                  <li key={step}>{step}</li>
                                ))}
                              </ul>
                            )}
                            {item.blockers.length > 0 && (
                              <div className="mt-3 rounded-md border border-amber-300/20 bg-amber-950/10 p-2">
                                <p className="text-[10px] font-medium uppercase text-amber-200">Blockers</p>
                                <ul className="mt-1 space-y-1 text-xs leading-4 text-amber-100/80">
                                  {item.blockers.slice(0, 3).map((blocker) => (
                                    <li key={blocker}>{blocker}</li>
                                  ))}
                                </ul>
                              </div>
                            )}
                            <div className="mt-3 flex flex-wrap gap-2">
                              <a href={item.signupUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md border border-lime-300/20 px-2 py-1 text-xs text-lime-100 hover:bg-lime-300/10">
                                Signup
                                <ExternalLink className="h-3 w-3" />
                              </a>
                              <a href={item.profileLink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md border border-white/10 px-2 py-1 text-xs text-cyan-200 hover:bg-white/5">
                                Profile
                                <ExternalLink className="h-3 w-3" />
                              </a>
                              <Button size="sm" variant="outline" className="h-7 border-yellow-300/20 bg-transparent px-2 text-xs text-yellow-100 hover:bg-yellow-300/10" onClick={() => appendLaunchEvidenceBatchRow(item.submittedEvidenceBatchRow)}>
                                Submitted
                              </Button>
                              <Button size="sm" variant="outline" className="h-7 border-green-300/20 bg-transparent px-2 text-xs text-green-100 hover:bg-green-300/10" onClick={() => appendLaunchEvidenceBatchRow(item.verifiedEvidenceBatchRow)}>
                                Verified
                              </Button>
                            </div>
                          </div>
                          );
                        })}
                      </div>
                    )}
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

                {(status.accountEvidence.quickBatchRows || []).length > 0 && (
                  <div className="rounded-md border border-cyan-300/20 bg-cyan-950/10 p-3" data-testid="clippers-account-connection-kit">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0">
                        <p className="font-medium text-white">External Account Connection Kit</p>
                        <p className="mt-1 text-xs leading-5 text-zinc-500">Carga las filas de todas las cuentas al batch; reemplaza los placeholders con evidencia real antes de importar.</p>
                        <p className="mt-2 break-all text-xs text-zinc-600">CSV: {status.accountEvidence.connectionKitCsvPath}</p>
                        <p className="mt-1 break-all text-xs text-zinc-600">Runbook: {status.accountEvidence.connectionKitMarkdownPath}</p>
                        {status.accountEvidence.connectionKitGeneratedAt && (
                          <p className="mt-1 text-xs text-zinc-600">actualizado: {formatDate(status.accountEvidence.connectionKitGeneratedAt)}</p>
                        )}
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                          setLaunchEvidenceBatchPreview(null);
                          setLaunchEvidenceBatchText(status.accountEvidence.quickBatchTemplate || launchEvidenceBatchHeader);
                          toast({
                            title: "Quick batch cargado",
                            description: `${status.accountEvidence.quickBatchRows.length} filas listas para completar con evidencia real.`,
                          });
                        }}
                        className="border-cyan-300/30 text-cyan-100 hover:bg-cyan-300/10"
                        data-testid="load-account-evidence-quick-batch-button"
                      >
                        <UploadCloud className="mr-2 h-4 w-4" />
                        Cargar pack
                      </Button>
                    </div>
                    {(status.accountEvidence.quickBatchChecklist || []).length > 0 && (
                      <div className="mt-3 grid gap-2 text-xs text-cyan-100/80 md:grid-cols-2">
                        {status.accountEvidence.quickBatchChecklist.slice(0, 4).map((step) => (
                          <p key={step} className="flex gap-2 leading-5">
                            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-cyan-200" />
                            {step}
                          </p>
                        ))}
                      </div>
                    )}
                    {(status.accountEvidence.connectionKitPlatformBatches || []).length > 0 && (
                      <div className="mt-3 grid gap-3 md:grid-cols-3">
                        {status.accountEvidence.connectionKitPlatformBatches.map((batch) => (
                          <div key={batch.id} className="rounded-md border border-cyan-300/15 bg-black/25 p-3">
                            <div className="flex items-center justify-between gap-2">
                              <p className="truncate text-sm font-medium text-white">{batch.label}</p>
                              <Badge className={cn("shrink-0 border text-[10px]", accountEvidenceBadge(batch.status))}>{batch.status}</Badge>
                            </div>
                            <div className="mt-2 grid grid-cols-2 gap-1 text-[11px] text-zinc-500">
                              <p>Accounts: {batch.accounts}</p>
                              <p>Verified: {batch.verified}</p>
                              <p>Submitted: {batch.submitted}</p>
                              <p>Missing: {batch.missing}</p>
                            </div>
                            <p className="mt-2 break-all text-[11px] leading-4 text-blue-100/70">Submitted template: {batch.submittedTemplateFilePath}</p>
                            <p className="mt-1 break-all text-[11px] leading-4 text-teal-100/70">Verified template: {batch.verifiedTemplateFilePath}</p>
                            <p className="mt-1 break-all text-[11px] leading-4 text-cyan-100/70">Submitted drop: {batch.submittedDropFilePath}</p>
                            <p className="mt-1 break-all text-[11px] leading-4 text-emerald-100/70">Verified drop: {batch.verifiedDropFilePath}</p>
                            <p className="mt-2 text-xs leading-5 text-zinc-500">{batch.nextStep}</p>
                            <div className="mt-3 flex flex-wrap gap-2">
                              <a href={batch.signupUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md border border-cyan-300/20 px-2 py-1 text-xs text-cyan-100 hover:bg-cyan-300/10">
                                Signup
                                <ExternalLink className="h-3 w-3" />
                              </a>
                              <Button size="sm" variant="outline" className="h-7 border-blue-300/20 bg-transparent px-2 text-xs text-blue-100 hover:bg-blue-300/10" onClick={() => setLaunchEvidenceBatchText(batch.submittedDropTemplate || launchEvidenceBatchHeader)}>
                                Submitted CSV
                              </Button>
                              <Button size="sm" variant="outline" className="h-7 border-emerald-300/20 bg-transparent px-2 text-xs text-emerald-100 hover:bg-emerald-300/10" onClick={() => setLaunchEvidenceBatchText(batch.verifiedDropTemplate || launchEvidenceBatchHeader)}>
                                Verified CSV
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                      {status.accountEvidence.quickBatchRows.slice(0, 9).map((row) => (
                        <div key={row.id} className="rounded-md border border-white/10 bg-black/30 p-3">
                          <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium text-white">{row.displayName}</p>
                              <p className="mt-1 text-xs text-zinc-500">{row.handle} · {row.platform}</p>
                            </div>
                            <Badge className={cn("shrink-0 border", accountEvidenceBadge(row.status))}>{row.status}</Badge>
                          </div>
                          <p className="mt-2 break-all text-xs text-zinc-600">{row.profileLink}</p>
                          <p className="mt-2 break-all text-[11px] leading-4 text-cyan-100/70">Drop JSON: {row.evidenceJsonPath}</p>
                          <p className="mt-2 text-xs leading-5 text-zinc-500">{row.nextStep}</p>
                          <div className="mt-3 flex flex-wrap gap-2">
                            <a href={row.signupUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md border border-white/10 px-2 py-1 text-xs text-cyan-200 hover:bg-white/5">
                              Signup
                              <ExternalLink className="h-3 w-3" />
                            </a>
                            <a href={row.profileLink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md border border-white/10 px-2 py-1 text-xs text-zinc-300 hover:bg-white/5">
                              Perfil
                              <ExternalLink className="h-3 w-3" />
                            </a>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => appendLaunchEvidenceBatchRow(row.verifiedBatchRow)}
                              className="h-7 border-cyan-300/30 px-2 text-xs text-cyan-100 hover:bg-cyan-300/10"
                            >
                              Add row
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {status.goLiveEvidenceBundle && (
                  <div className="rounded-md border border-purple-300/20 bg-purple-950/10 p-3" data-testid="clippers-go-live-evidence-bundle">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0">
                        <p className="font-medium text-white">Go-Live Evidence Bundle</p>
                        <p className="mt-1 text-xs leading-5 text-zinc-500">{status.goLiveEvidenceBundle.nextStep}</p>
                        <p className="mt-2 break-all text-xs text-zinc-600">CSV: {status.goLiveEvidenceBundle.csvPath}</p>
                        <p className="mt-1 break-all text-xs text-zinc-600">Runbook: {status.goLiveEvidenceBundle.markdownPath}</p>
                        {status.goLiveEvidenceBundle.generatedAt && (
                          <p className="mt-1 text-xs text-zinc-600">actualizado: {formatDate(status.goLiveEvidenceBundle.generatedAt)}</p>
                        )}
                      </div>
                      <div className="flex flex-col gap-2 sm:flex-row">
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => {
                            setLaunchEvidenceBatchPreview(null);
                            setLaunchEvidenceBatchText(status.goLiveEvidenceBundle.importTemplate || launchEvidenceBatchHeader);
                            toast({
                              title: "Starter bundle cargado",
                              description: `${status.goLiveEvidenceBundle.totals.starterRows} filas listas para completar con prueba real.`,
                            });
                          }}
                          className="border-purple-300/30 text-purple-100 hover:bg-purple-300/10"
                          data-testid="load-go-live-evidence-starter-bundle-button"
                        >
                          <UploadCloud className="mr-2 h-4 w-4" />
                          Starter rows
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => appendLaunchEvidenceBatchRows(status.goLiveEvidenceBundle.approvalRows)}
                          className="border-emerald-300/30 text-emerald-100 hover:bg-emerald-300/10"
                          data-testid="append-go-live-evidence-approval-rows-button"
                        >
                          <ShieldCheck className="mr-2 h-4 w-4" />
                          Approval rows
                        </Button>
                      </div>
                    </div>
                    <div className="mt-3 grid gap-2 text-xs text-zinc-500 md:grid-cols-5">
                      <p>Starter: {status.goLiveEvidenceBundle.totals.starterRows}</p>
                      <p>Approval: {status.goLiveEvidenceBundle.totals.approvalRows}</p>
                      <p>Accounts: {status.goLiveEvidenceBundle.totals.accountRows}</p>
                      <p>Apps: {status.goLiveEvidenceBundle.totals.developerAppRows}</p>
                      <p>Permisos: {status.goLiveEvidenceBundle.totals.permissionRows}</p>
                    </div>
                    <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
                      {(status.goLiveEvidenceBundle.sections || []).map((section) => (
                        <div key={section.id} className="rounded-md border border-white/10 bg-black/30 p-2">
                          <div className="flex items-center justify-between gap-2">
                            <p className="truncate text-xs font-medium text-white">{section.label}</p>
                            <Badge className="shrink-0 border border-purple-300/20 bg-purple-300/10 text-[10px] text-purple-100">{section.count}</Badge>
                          </div>
                          <p className="mt-2 line-clamp-2 text-xs leading-4 text-zinc-500">{section.nextStep}</p>
                        </div>
                      ))}
                    </div>
                    <div className="mt-3 grid gap-2 text-xs text-purple-100/80 md:grid-cols-2">
                      {status.goLiveEvidenceBundle.checklist.slice(0, 4).map((step) => (
                        <p key={step} className="flex gap-2 leading-5">
                          <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-purple-200" />
                          {step}
                        </p>
                      ))}
                    </div>
                  </div>
                )}

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
                        onClick={() => setLaunchEvidenceStrictImport((current) => !current)}
                        className={cn(
                          "border-white/10 text-zinc-200 hover:bg-white/5",
                          launchEvidenceStrictImport && "border-emerald-300/30 bg-emerald-300/10 text-emerald-100 hover:bg-emerald-300/15",
                        )}
                        data-testid="toggle-clippers-launch-evidence-strict-import-button"
                      >
                        <ShieldCheck className="mr-2 h-4 w-4" />
                        {launchEvidenceStrictImport ? "Strict on" : "Strict off"}
                      </Button>
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
                  <div className={cn(
                    "mt-3 rounded-md border p-2 text-xs leading-5",
                    launchEvidenceStrictImport
                      ? "border-emerald-300/20 bg-emerald-950/10 text-emerald-100"
                      : "border-amber-300/20 bg-amber-950/10 text-amber-100",
                  )}>
                    {launchEvidenceStrictImport
                      ? "Strict import activo: si una fila falla, no se escribe ninguna evidencia parcial."
                      : "Strict import apagado: las filas validas pueden escribirse aunque otras queden rejected."}
                  </div>
                  <Textarea
                    value={launchEvidenceBatchText}
                    onChange={(event) => {
                      setLaunchEvidenceBatchText(event.target.value);
                      setLaunchEvidenceBatchPreview(null);
                    }}
                    placeholder={`${launchEvidenceBatchHeader}\naccount,sports-daily,tiktok,verified,,,,Cuenta creada y verificada con profile URL y screenshot en Drive\ndeveloper_app,,youtube,submitted,,youtube-app-id,https://tu-dominio.com,App enviada a review con screenshot/ticket del portal\npermission,,tiktok,requested,video.publish,,,Scope solicitado con ticket o screenshot del portal\nsource_rights,clip.mp4,memes,owned_or_permissioned,clip.mp4,,,Creator permission signed; proof URL https://drive.google.com/file/proof`}
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
                          {launchEvidenceBatchPreview.strictBlocked ? "strict_blocked" : launchEvidenceBatchPreview.rejected.length ? "needs_fix" : "importable"}
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
                      {launchEvidenceBatchPreview.strictImport && (
                        <p className={cn(
                          "mt-2 rounded-md border p-2 text-xs leading-5",
                          launchEvidenceBatchPreview.strictBlocked
                            ? "border-red-300/20 bg-red-950/10 text-red-100"
                            : "border-emerald-300/20 bg-emerald-950/10 text-emerald-100",
                        )}>
                          {launchEvidenceBatchPreview.strictBlocked
                            ? "Strict import bloqueo la escritura: corrige rejected y vuelve a importar."
                            : "Strict import limpio: no hay rejected bloqueando la escritura."}
                        </p>
                      )}
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

                {status.analyticsReportingPack && (
                  <div className="rounded-md border border-emerald-400/20 bg-emerald-400/5 p-3" data-testid="clippers-analytics-reporting-pack">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-medium text-white">Analytics Reporting Pack</p>
                          <Badge className={cn("border", analyticsReportingPackBadge(status.analyticsReportingPack.status))}>{status.analyticsReportingPack.status}</Badge>
                        </div>
                        <p className="mt-1 text-xs leading-5 text-zinc-500">{status.analyticsReportingPack.nextStep}</p>
                        <p className="mt-2 break-all text-xs text-zinc-600">{status.analyticsReportingPack.markdownPath}</p>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="w-fit border-emerald-300/30 bg-emerald-300/10 text-emerald-100 hover:bg-emerald-300/20"
                        disabled={analyticsReportingPackMutation.isPending}
                        onClick={() => analyticsReportingPackMutation.mutate()}
                        data-testid="prepare-clippers-analytics-reporting-pack-button"
                      >
                        {analyticsReportingPackMutation.isPending ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <BarChart3 className="mr-2 h-3.5 w-3.5" />}
                        Reporting pack
                      </Button>
                    </div>

                    <div className="mt-3 grid gap-2 text-xs text-zinc-500 md:grid-cols-6">
                      <p>Exports: {formatNumber(status.analyticsReportingPack.totals.exports)}</p>
                      <p>Accounts: {formatNumber(status.analyticsReportingPack.totals.accounts)}</p>
                      <p>Platforms: {formatNumber(status.analyticsReportingPack.totals.platforms)}</p>
                      <p>Files: {formatNumber(status.analyticsReportingPack.totals.metricsFiles)}</p>
                      <p>Records: {formatNumber(status.analyticsReportingPack.totals.metricRecords)}</p>
                      <p>Goal: {formatNumber(status.analyticsReportingPack.totals.weeklyViewsGoal)}</p>
                    </div>

                    <div className="mt-3 grid gap-3 xl:grid-cols-[1fr_1fr]">
                      <div className="rounded-md border border-white/10 bg-black/30 p-3">
                        <p className="text-xs font-medium uppercase tracking-[0.2em] text-zinc-500">Runbook</p>
                        <div className="mt-2 space-y-2">
                          {status.analyticsReportingPack.runbook.slice(0, 4).map((step) => (
                            <p key={step} className="flex gap-2 text-xs leading-5 text-zinc-400">
                              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-200" />
                              {step}
                            </p>
                          ))}
                        </div>
                      </div>
                      <div className="rounded-md border border-white/10 bg-black/30 p-3">
                        <p className="text-xs font-medium uppercase tracking-[0.2em] text-zinc-500">CSV template</p>
                        <pre className="mt-2 max-h-28 overflow-auto whitespace-pre-wrap break-all rounded-md bg-black/40 p-2 text-[11px] leading-5 text-zinc-400">
                          {status.analyticsReportingPack.importTemplate.split("\n").slice(0, 4).join("\n")}
                        </pre>
                        <p className="mt-2 break-all text-xs text-zinc-600">{status.analyticsReportingPack.csvPath}</p>
                      </div>
                    </div>

                    <div className="mt-3 grid gap-3 md:grid-cols-3">
                      {status.analyticsReportingPack.items.slice(0, 6).map((item) => (
                        <div key={item.id} className="rounded-md border border-white/10 bg-black/30 p-3">
                          <div className="flex items-center justify-between gap-3">
                            <p className="truncate text-sm font-medium text-white">{item.accountName}</p>
                            <Badge className="border border-white/10 bg-zinc-900 text-zinc-300">{item.platform}</Badge>
                          </div>
                          <p className="mt-1 truncate text-xs text-zinc-500">{item.handle}</p>
                          <p className="mt-2 line-clamp-2 text-xs leading-5 text-zinc-500">{item.exportSource}</p>
                          <p className="mt-2 break-all text-xs text-zinc-600">{item.targetFileName}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

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
                          {item.remixBrief && (
                            <div className="mt-2 rounded border border-emerald-300/15 bg-emerald-950/10 p-2">
                              <p className="text-[10px] uppercase tracking-wide text-emerald-200">Owned remix brief</p>
                              <p className="mt-1 text-xs leading-4 text-emerald-100/80">{item.remixBrief}</p>
                              {item.scriptBeats.length > 0 && (
                                <p className="mt-2 text-xs leading-4 text-emerald-100/70">{item.scriptBeats[0]}</p>
                              )}
                            </div>
                          )}
                          <div className="mt-2 rounded border border-white/10 bg-black/40 p-2">
                            <p className="text-[10px] uppercase tracking-wide text-zinc-500">Allowlist template</p>
                            <pre className="mt-1 max-h-28 overflow-auto whitespace-pre-wrap break-words font-mono text-[10px] leading-4 text-zinc-300">{item.permissionRecordTemplate}</pre>
                          </div>
                          {item.publishSafetyChecklist.length > 0 && (
                            <p className="mt-2 line-clamp-2 text-xs leading-5 text-red-100/80">Safety: {item.publishSafetyChecklist[0]}</p>
                          )}
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
            {status?.publisherExecutionQueue && (
              <div className="rounded-md border border-white/10 bg-black/35 p-3">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-white">{status.publisherExecutionQueue.markdownPath}</p>
                    <p className="mt-1 text-xs text-zinc-500">{status.publisherExecutionQueue.nextStep}</p>
                  </div>
                  <Badge className={cn("w-fit border", publisherExecutionBadge(status.publisherExecutionQueue.status))}>{status.publisherExecutionQueue.status}</Badge>
                </div>
                <div className="mt-3 grid gap-2 text-xs text-zinc-500 md:grid-cols-5">
                  <p>Items: {status.publisherExecutionQueue.totals.items}</p>
                  <p>Blocked: {status.publisherExecutionQueue.totals.blocked}</p>
                  <p>Approval: {status.publisherExecutionQueue.totals.queuedForApproval}</p>
                  <p>Ready send: {status.publisherExecutionQueue.totals.readyToSend}</p>
                  <p>Real publish: {status.publisherExecutionQueue.realPublishEnabled ? "on" : "off"}</p>
                </div>
                <div className="mt-3 grid gap-3 md:grid-cols-3">
                  {status.publisherExecutionQueue.items.slice(0, 6).map((item) => (
                    <div key={item.id} className="rounded-md border border-white/10 bg-black/30 p-2">
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate text-xs font-medium text-white">{item.accountName} / {item.platform}</p>
                        <Badge className={cn("border text-[10px]", publisherExecutionBadge(item.status))}>{item.status}</Badge>
                      </div>
                      <p className="mt-2 truncate text-xs text-zinc-500">{item.endpoint}</p>
                      <p className="mt-1 text-xs text-zinc-500">Token: {item.requestSpec.tokenSource} · Approval: {item.approvalRequired ? "yes" : "no"}</p>
                      <p className="mt-1 truncate text-xs text-zinc-500">Source: {item.sourcePath || "missing"}</p>
                      {item.gates.length > 0 && (
                        <div className="mt-2 space-y-1">
                          {item.gates.slice(0, 3).map((gate) => (
                            <div key={`${item.id}-${gate.id}`} className="flex items-center justify-between gap-2 rounded border border-white/10 px-2 py-1">
                              <p className="truncate text-xs text-zinc-400">{gate.label}</p>
                              <Badge className={cn("shrink-0 border text-[10px]", gate.done ? "border-emerald-300/30 bg-emerald-300/10 text-emerald-200" : "border-zinc-600 bg-zinc-900 text-zinc-300")}>
                                {gate.done ? "ok" : "missing"}
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
                          <p className="font-semibold">{status.automation.lastRun.totals.posts}/{status.automation.lastRun.totals.dailyTargetPosts || status.automation.lastRun.totals.posts}</p>
                        </div>
                        <div className="rounded-md border border-white/10 bg-black/35 p-3">
                          <p className="text-xs text-zinc-500">Weekly target</p>
                          <p className="font-semibold">{status.automation.lastRun.totals.weeklyTargetClips || status.automationSchedule.weeklyTargetClips}</p>
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
                        <div className="rounded-md border border-white/10 bg-black/35 p-3">
                          <p className="text-xs text-zinc-500">Backlog</p>
                          <p className="font-semibold">{status.automation.lastRun.totals.backlogPosts || 0}</p>
                        </div>
                        <div className="rounded-md border border-white/10 bg-black/35 p-3">
                          <p className="text-xs text-zinc-500">Gap</p>
                          <p className="font-semibold">{status.automation.lastRun.totals.gapToDailyTarget || 0}</p>
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
                      <p className="mt-2 line-clamp-2 text-xs leading-5 text-sky-100/80">{(item.viralSearchQueries || [])[0] || item.suggestedSearch}</p>
                      <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-zinc-500">{item.minimumViralSignal || item.recencyWindow}</p>
                      <p className="mt-2 break-all text-[11px] leading-4 text-zinc-500">File: {item.targetFileName || "pending"} · {item.sourceDropManifestPath || item.sourceFolder}</p>
                      <div className="mt-2 space-y-1">
                        {(item.requiredInputs || []).slice(0, 3).map((input) => (
                          <p key={input} className="text-xs leading-5 text-zinc-500">- {input}</p>
                        ))}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {(item.viralSearchUrls || [])[0] && (
                          <a href={(item.viralSearchUrls || [])[0]} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md border border-cyan-300/20 px-2 py-1 text-xs text-cyan-100 hover:bg-cyan-300/10">
                            Buscar ahora
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                        {item.sourceDropManifestRow && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 border-emerald-300/20 bg-transparent px-2 text-xs text-emerald-100 hover:bg-emerald-300/10"
                            onClick={() => appendSourceIntakeBatchRows([item.sourceDropManifestRow])}
                          >
                            <UploadCloud className="mr-1 h-3 w-3" />
                            Intake row
                          </Button>
                        )}
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
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge className={cn("w-fit border", sourceAcquisitionBadge(status.sourceAcquisition?.status || "not_prepared"))}>
                        {status.sourceAcquisition?.status || "not_prepared"}
                      </Badge>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 border-cyan-300/30 px-3 text-xs text-cyan-100 hover:bg-cyan-300/10"
                        disabled={sourceSupplyDropKitMutation.isPending}
                        onClick={() => sourceSupplyDropKitMutation.mutate()}
                        data-testid="prepare-clippers-source-supply-drop-kit-button"
                      >
                        {sourceSupplyDropKitMutation.isPending ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <FolderOpen className="mr-2 h-3.5 w-3.5" />}
                        Drop kit
                      </Button>
                    </div>
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
                  {status.sourceSupplyDropKit && (
                    <div className="mt-3 rounded-md border border-cyan-300/15 bg-cyan-950/10 p-3" data-testid="clippers-source-supply-drop-kit">
                      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                        <div className="min-w-0">
                          <p className="truncate text-xs font-medium text-white">{status.sourceSupplyDropKit.markdownPath}</p>
                          <p className="mt-1 text-xs leading-5 text-zinc-500">{status.sourceSupplyDropKit.nextStep}</p>
                        </div>
                        <Badge className={cn("w-fit border", sourceAcquisitionBadge(status.sourceSupplyDropKit.status))}>{status.sourceSupplyDropKit.status}</Badge>
                      </div>
                      <div className="mt-3 grid gap-2 text-xs text-zinc-500 md:grid-cols-5">
                        <p>Rows: {status.sourceSupplyDropKit.totals.items}</p>
                        <p>Critical: {status.sourceSupplyDropKit.totals.critical}</p>
                        <p>High: {status.sourceSupplyDropKit.totals.high}</p>
                        <p>Missing/wk: {status.sourceSupplyDropKit.totals.weeklyMissingSourceSlots}</p>
                        <p>Rights OK: {status.sourceSupplyDropKit.totals.rightsReadyAssets}</p>
                      </div>
                      <p className="mt-2 break-all text-xs text-zinc-600">CSV: {status.sourceSupplyDropKit.csvPath}</p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 border-orange-300/30 px-3 text-xs text-orange-100 hover:bg-orange-300/10"
                          onClick={() => appendTrendCandidateBatchRows(status.sourceSupplyDropKit.items.map((item) => item.trendCandidateBatchRow))}
                          disabled={!status.sourceSupplyDropKit.items.length}
                          data-testid="add-source-supply-trend-candidate-rows-button"
                        >
                          <Search className="mr-2 h-3.5 w-3.5" />
                          Trend rows
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 border-cyan-300/30 px-3 text-xs text-cyan-100 hover:bg-cyan-300/10"
                          onClick={() => appendSourceIntakeBatchRows(status.sourceSupplyDropKit.items.map((item) => item.intakeBatchRow))}
                          disabled={!status.sourceSupplyDropKit.items.length}
                          data-testid="add-source-supply-drop-kit-rows-button"
                        >
                          <UploadCloud className="mr-2 h-3.5 w-3.5" />
                          Add all rows
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 border-sky-300/30 px-3 text-xs text-sky-100 hover:bg-sky-300/10"
                          onClick={() => void copySourceDropManifestRows(status.sourceSupplyDropKit.items.map((item) => item.intakeBatchRow))}
                          disabled={!status.sourceSupplyDropKit.items.length}
                          data-testid="copy-source-drop-manifest-rows-button"
                        >
                          <Copy className="mr-2 h-3.5 w-3.5" />
                          Manifest CSV
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 border-white/10 px-3 text-xs text-zinc-200 hover:bg-white/5"
                          onClick={() => appendSourceIntakeBatchRows(status.sourceSupplyDropKit.items.slice(0, 5).map((item) => item.intakeBatchRow))}
                          disabled={!status.sourceSupplyDropKit.items.length}
                        >
                          <Plus className="mr-2 h-3.5 w-3.5" />
                          Add 5
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 border-emerald-300/30 px-3 text-xs text-emerald-100 hover:bg-emerald-300/10"
                          onClick={() => appendLaunchEvidenceBatchRows(status.sourceSupplyDropKit.items.map((item) => item.rightsEvidenceBatchRow))}
                          disabled={!status.sourceSupplyDropKit.items.length}
                          data-testid="add-source-supply-rights-evidence-rows-button"
                        >
                          <ShieldCheck className="mr-2 h-3.5 w-3.5" />
                          Rights rows
                        </Button>
                      </div>
                      {(status.sourceSupplyDropKit.categoryBatches || []).length > 0 && (
                        <div className="mt-3 grid gap-3 md:grid-cols-3">
                          {status.sourceSupplyDropKit.categoryBatches.map((batch) => (
                            <div key={batch.id} className="rounded-md border border-cyan-300/15 bg-black/25 p-3">
                              <div className="flex items-center justify-between gap-2">
                                <p className="truncate text-sm font-medium text-white">{batch.label}</p>
                                <Badge className={cn("shrink-0 border text-[10px]", sourceAcquisitionBadge(batch.priority))}>{batch.priority}</Badge>
                              </div>
                              <div className="mt-2 grid grid-cols-2 gap-1 text-[11px] text-zinc-500">
                                <p>Items: {batch.items}</p>
                                <p>Queries: {batch.viralSearchQueries.length}</p>
                              </div>
                              <p className="mt-2 break-all text-[11px] leading-4 text-cyan-100/70">Drop dir: {batch.sourceDropDir}</p>
                              <p className="mt-1 break-all text-[11px] leading-4 text-sky-100/70">Manifest: {batch.sourceDropManifestPath}</p>
                              <p className="mt-1 break-all text-[11px] leading-4 text-emerald-100/70">README: {batch.sourceDropReadmePath}</p>
                              <p className="mt-2 text-xs leading-5 text-zinc-500">{batch.nextStep}</p>
                              <div className="mt-3 flex flex-wrap gap-2">
                                <Button size="sm" variant="outline" className="h-7 border-orange-300/20 bg-transparent px-2 text-xs text-orange-100 hover:bg-orange-300/10" onClick={() => setTrendCandidatesBatchText(batch.trendCandidateBatchTemplate || trendCandidatesBatchHeader)}>
                                  Trend CSV
                                </Button>
                                <Button size="sm" variant="outline" className="h-7 border-cyan-300/20 bg-transparent px-2 text-xs text-cyan-100 hover:bg-cyan-300/10" onClick={() => setSourceIntakeBatchText(batch.intakeBatchTemplate || sourceIntakeBatchHeader)}>
                                  Intake CSV
                                </Button>
                                <Button size="sm" variant="outline" className="h-7 border-sky-300/20 bg-transparent px-2 text-xs text-sky-100 hover:bg-sky-300/10" onClick={() => void copySourceDropManifestRows(batch.intakeBatchRows)}>
                                  Manifest
                                </Button>
                                <Button size="sm" variant="outline" className="h-7 border-emerald-300/20 bg-transparent px-2 text-xs text-emerald-100 hover:bg-emerald-300/10" onClick={() => setLaunchEvidenceBatchText(batch.rightsEvidenceBatchTemplate || launchEvidenceBatchHeader)}>
                                  Rights CSV
                                </Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                      <div className="mt-3 grid gap-2 md:grid-cols-3">
                        {status.sourceSupplyDropKit.items.slice(0, 6).map((item) => (
                          <div key={item.id} className="rounded-md border border-white/10 bg-black/30 p-2">
                            <div className="flex items-center justify-between gap-2">
                              <p className="truncate text-xs font-medium text-white">{item.targetFileName}</p>
                              <Badge className={cn("border text-[10px]", sourceAcquisitionBadge(item.priority))}>{item.priority}</Badge>
                            </div>
                            <p className="mt-2 text-xs leading-5 text-zinc-500">{item.suggestedTitle}</p>
                            <p className="mt-2 text-xs leading-5 text-cyan-200">{item.viralSearchQueries?.[0]}</p>
                            <div className="mt-2 space-y-1">
                              {(item.viralScoreChecklist || []).slice(0, 2).map((criteria) => (
                                <p key={criteria} className="text-xs leading-5 text-zinc-500">- {criteria}</p>
                              ))}
                            </div>
                            <p className="mt-2 truncate text-xs text-amber-200">{item.nextStep}</p>
                            <div className="mt-2 flex flex-wrap gap-1">
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 px-2 text-xs text-orange-100 hover:bg-orange-300/10"
                                onClick={() => appendTrendCandidateBatchRow(item.trendCandidateBatchRow)}
                              >
                                <Search className="mr-1 h-3 w-3" />
                                Trend
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 px-2 text-xs text-cyan-100 hover:bg-cyan-300/10"
                                onClick={() => appendSourceIntakeBatchRows([item.intakeBatchRow])}
                              >
                                <Plus className="mr-1 h-3 w-3" />
                                Intake
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 px-2 text-xs text-emerald-100 hover:bg-emerald-300/10"
                                onClick={() => appendLaunchEvidenceBatchRow(item.rightsEvidenceBatchRow)}
                              >
                                <ShieldCheck className="mr-1 h-3 w-3" />
                                Rights
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
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
                    {status.sourceDropDiagnostic && (
                      <div className="rounded-md border border-cyan-300/20 bg-cyan-950/10 p-3" data-testid="clippers-source-drop-diagnostic">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-white">Source drop diagnostic</p>
                            <p className="mt-1 text-xs leading-5 text-zinc-500">{status.sourceDropDiagnostic.nextStep}</p>
                            <p className="mt-2 break-all text-xs text-zinc-600">Reporte: {status.sourceDropDiagnostic.markdownPath}</p>
                            <p className="mt-1 break-all text-[11px] leading-4 text-cyan-100/70">Repair CSV: {status.sourceDropDiagnostic.repairWorksheetCsvPath}</p>
                          </div>
                          <Badge className={cn("w-fit border", status.sourceDropDiagnostic.status === "ready" || status.sourceDropDiagnostic.status === "ready_to_import" ? "border-emerald-300/30 bg-emerald-300/10 text-emerald-200" : status.sourceDropDiagnostic.status === "needs_rights" ? "border-amber-300/30 bg-amber-300/10 text-amber-200" : "border-red-300/30 bg-red-300/10 text-red-200")}>
                            {status.sourceDropDiagnostic.status}
                          </Badge>
                        </div>
                        <div className="mt-3 grid gap-2 text-xs text-zinc-500 md:grid-cols-4 xl:grid-cols-6">
                          <p>Files: {status.sourceDropDiagnostic.totals.files}</p>
                          <p>Import ready: {status.sourceDropDiagnostic.totals.importEligible}</p>
                          <p>Manifest ready: {status.sourceDropDiagnostic.totals.manifestReady || 0}</p>
                          <p>Manifest rows: {status.sourceDropDiagnostic.totals.manifestRows || 0}</p>
                          <p>Placeholders: {status.sourceDropDiagnostic.totals.manifestPlaceholderRows || 0}</p>
                          <p>Missing files: {status.sourceDropDiagnostic.totals.manifestMissingFiles || 0}</p>
                          <p>Rights-ready: {status.sourceDropDiagnostic.totals.rightsReadyAssets}</p>
                        </div>
                        <div className="mt-3 grid gap-2 md:grid-cols-3">
                          {status.sourceDropDiagnostic.categories.map((category) => (
                            <div key={category.category} className="rounded-md border border-white/10 bg-black/30 p-2">
                              <div className="flex items-center justify-between gap-2">
                                <p className="truncate text-xs font-medium text-white">{category.label}</p>
                                <Badge className={cn("border text-[10px]", category.missingSourceAssets === 0 ? "border-emerald-300/30 bg-emerald-300/10 text-emerald-200" : "border-amber-300/30 bg-amber-300/10 text-amber-200")}>
                                  {category.rightsReadyAssets}/{category.minimumWeeklySourceAssets}
                                </Badge>
                              </div>
                              <p className="mt-2 text-xs text-zinc-500">Drop: {category.dropFiles} · Import: {category.importEligible}</p>
                              <p className="mt-1 text-xs text-zinc-500">Manifest: {category.manifestRows || 0} rows · {category.manifestPlaceholderRows || 0} pending</p>
                              <p className="mt-1 text-xs text-zinc-500">Missing files: {category.manifestMissingFiles || 0} · Ready: {category.rightsReadyAssets}</p>
                              <p className="mt-1 text-xs text-zinc-500">Assets: {category.sourceAssets} · Missing: {category.missingSourceAssets}</p>
                              <p className="mt-2 break-all text-[11px] leading-4 text-zinc-600">{category.dropPath}</p>
                            </div>
                          ))}
                        </div>
                        {status.sourceDropDiagnostic.manifests.length > 0 && (
                          <div className="mt-3 grid gap-2 md:grid-cols-3">
                            {status.sourceDropDiagnostic.manifests.slice(0, 6).map((manifest) => (
                              <div key={manifest.relativePath} className="rounded-md border border-sky-300/15 bg-sky-950/10 p-2">
                                <div className="flex items-center justify-between gap-2">
                                  <p className="truncate text-xs font-medium text-white">{manifest.relativePath}</p>
                                  <Badge className={cn("border text-[10px]", manifest.placeholderRows === 0 && manifest.missingFiles.length === 0 ? "border-emerald-300/30 bg-emerald-300/10 text-emerald-200" : "border-amber-300/30 bg-amber-300/10 text-amber-200")}>
                                    {manifest.readyRows}/{manifest.rows}
                                  </Badge>
                                </div>
                                <div className="mt-2 grid grid-cols-2 gap-1 text-[11px] text-zinc-500">
                                  <p>Pending: {manifest.placeholderRows}</p>
                                  <p>Missing: {manifest.missingFiles.length}</p>
                                  <p>Proof: {manifest.evidenceReadyRows}</p>
                                  <p>Expected: {manifest.expectedFiles.length}</p>
                                </div>
                                <p className="mt-2 text-xs leading-5 text-zinc-500">{manifest.issue || manifest.nextStep}</p>
                              </div>
                            ))}
                          </div>
                        )}
                        {status.sourceDropDiagnostic.files.length > 0 && (
                          <div className="mt-3 space-y-2">
                            {status.sourceDropDiagnostic.files.slice(0, 4).map((file) => (
                              <div key={file.relativePath} className="rounded-md border border-white/10 bg-black/30 p-2">
                                <div className="flex items-center justify-between gap-2">
                                  <p className="truncate text-xs font-medium text-white">{file.relativePath}</p>
                                  <Badge className={cn("border text-[10px]", file.importEligible ? "border-emerald-300/30 bg-emerald-300/10 text-emerald-200" : "border-zinc-600 bg-zinc-900 text-zinc-300")}>
                                    {file.manifestEvidenceReady ? "manifest ready" : file.importEligible ? "importable" : file.location}
                                  </Badge>
                                </div>
                                <p className="mt-1 text-xs leading-4 text-zinc-500">{file.issue || file.nextStep}</p>
                                {file.manifestPath && <p className="mt-1 break-all text-[11px] leading-4 text-cyan-100/70">{file.manifestPath}</p>}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
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
                          <p>Manifest rows: {sourceDropImport.manifestRows || 0}</p>
                          <p>Rights written: {sourceDropImport.rightsEvidenceWritten || 0}</p>
                        </div>
                        <div className="mt-2 grid gap-2 text-xs text-zinc-500 md:grid-cols-3">
                          <p>Manifests: {sourceDropImport.manifestFilesScanned || 0}</p>
                          <p>Matched: {sourceDropImport.manifestMatched || 0}</p>
                          <p>Assets: {sourceDropImport.queue.sourceAssets.length}</p>
                        </div>
                        <p className="mt-2 text-xs leading-5 text-zinc-500">{sourceDropImport.nextStep}</p>
                        {sourceDropImport.items.slice(0, 4).map((item) => (
                          <p key={`${item.sourcePath}-${item.targetPath}`} className={cn("mt-2 break-all text-xs", item.status === "imported" ? "text-cyan-100" : "text-amber-200")}>
                            {item.status}: {item.fileName} {"->"} {item.targetPath || item.reason}
                            {item.rightsEvidencePath ? ` · ${item.rightsEvidencePath}` : ""}
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
