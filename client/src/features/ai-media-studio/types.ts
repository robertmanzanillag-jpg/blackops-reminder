import type {
  AiMediaStudioDashboardResponse,
  AiMediaStudioOptionsResponse,
  CreateGenerationRequest,
  CreateGenerationResponse as SharedCreateGenerationResponse,
  MediaJob as SharedMediaJob,
  MediaJobStatus,
  ProviderHealthStatus,
} from "@shared/ai-media-studio";

export type JobStatus = MediaJobStatus;
export type ProviderStatus = ProviderHealthStatus;
export type MediaJob = SharedMediaJob;
export type StudioDashboard = AiMediaStudioDashboardResponse;
export type StudioOptions = AiMediaStudioOptionsResponse;
export type CreateGenerationInput = CreateGenerationRequest;
export type CreateGenerationResponse = SharedCreateGenerationResponse;
export type MediaStudioSummary = StudioDashboard["summary"];
export type ProviderHealth = StudioDashboard["providers"][number];
export type QueueSnapshot = StudioDashboard["queue"];
export type StudioActivity = StudioDashboard["recentActivity"][number];
export type InfluencerOption = StudioOptions["influencers"][number];
export type VoiceOption = StudioOptions["voices"][number];
export type LanguageOption = StudioOptions["languages"][number];
