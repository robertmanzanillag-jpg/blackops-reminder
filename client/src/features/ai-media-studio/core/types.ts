import type {
  CreateInfluencerRequest,
  Influencer,
  InfluencerGender,
  InfluencerListRequest,
  InfluencerStatus,
  MediaAsset,
  MediaLibraryRequest,
  ProviderResource,
  ProviderResourceListRequest,
  UpdateInfluencerRequest,
} from "@shared/ai-media-studio-core";
import type {
  ConfigureHeyGenRosterResponse,
  CreateHeyGenRosterMember,
  CreateHeyGenRosterRequest,
  HeyGenRosterDailyPlan,
  HeyGenRosterDailyPlanBlocker,
  HeyGenRosterDailyPlanResponse,
  HeyGenRosterDailyPlanSlot,
  HeyGenRosterGender,
  HeyGenRosterPublicMember,
  HeyGenRosterStatus,
} from "@shared/ai-media-studio-heygen-roster";
import type {
  ApproveProductionBatchRequest,
  PrepareProductionBatchRequest,
  ProductionBatch,
  ProductionBatchResponse,
} from "@shared/ai-media-studio-production-batches";
import type {
  LaunchPreflight,
  LaunchPreflightGate,
} from "@shared/ai-media-studio-launch-preflight";
import type {
  SandboxReadiness,
  SandboxReadinessGate,
} from "@shared/ai-media-studio-sandbox-readiness";

export type {
  CreateInfluencerRequest,
  Influencer,
  InfluencerGender,
  InfluencerListRequest,
  InfluencerStatus,
  MediaAsset,
  MediaLibraryRequest,
  ProviderResource,
  ProviderResourceListRequest,
  UpdateInfluencerRequest,
};

export type {
  ConfigureHeyGenRosterResponse,
  CreateHeyGenRosterMember,
  CreateHeyGenRosterRequest,
  HeyGenRosterDailyPlan,
  HeyGenRosterDailyPlanBlocker,
  HeyGenRosterDailyPlanResponse,
  HeyGenRosterDailyPlanSlot,
  HeyGenRosterGender,
  HeyGenRosterPublicMember,
  HeyGenRosterStatus,
};

export type {
  ApproveProductionBatchRequest,
  PrepareProductionBatchRequest,
  ProductionBatch,
  ProductionBatchResponse,
};

export type {
  LaunchPreflight,
  LaunchPreflightGate,
};

export type {
  SandboxReadiness,
  SandboxReadinessGate,
};

export type MediaAssetKind = MediaAsset["kind"];
export type MediaAssetStatus = MediaAsset["status"];
export type ProviderResourceKind = ProviderResource["kind"];

export type AssetDelivery = {
  url: string;
  expiresAt: string;
};

export type InfluencerFormValues = {
  name: string;
  avatarResourceId: string;
  voiceResourceId: string;
  accent: string;
  language: string;
  gender: InfluencerGender;
  minimumAge: string;
  maximumAge: string;
  personality: string;
  tone: string;
  speakingStyle: string;
  categories: string;
  intro: string;
  outro: string;
  energyLevel: string;
  facialExpressions: string;
  brandColors: string;
  status: InfluencerStatus;
};

export const emptyInfluencerForm: InfluencerFormValues = {
  name: "",
  avatarResourceId: "",
  voiceResourceId: "",
  accent: "Neutral",
  language: "en-US",
  gender: "unspecified",
  minimumAge: "25",
  maximumAge: "34",
  personality: "",
  tone: "",
  speakingStyle: "",
  categories: "",
  intro: "",
  outro: "",
  energyLevel: "7",
  facialExpressions: "",
  brandColors: "#34D399",
  status: "draft",
};

export function commaList(value: string): string[] {
  return Array.from(new Set(value.split(",").map((item) => item.trim()).filter(Boolean)));
}

export function toInfluencerRequest(values: InfluencerFormValues): CreateInfluencerRequest {
  return {
    name: values.name.trim(),
    avatarResourceId: values.avatarResourceId || null,
    voiceResourceId: values.voiceResourceId || null,
    accent: values.accent.trim(),
    language: values.language.trim(),
    gender: values.gender,
    ageRange: {
      minimum: Number(values.minimumAge),
      maximum: Number(values.maximumAge),
    },
    personality: commaList(values.personality),
    tone: commaList(values.tone),
    speakingStyle: values.speakingStyle.trim(),
    categories: commaList(values.categories),
    intro: values.intro.trim(),
    outro: values.outro.trim(),
    energyLevel: Number(values.energyLevel),
    facialExpressions: commaList(values.facialExpressions),
    brandColors: commaList(values.brandColors),
    status: values.status,
  };
}

export function influencerToForm(influencer: Influencer): InfluencerFormValues {
  return {
    name: influencer.name,
    avatarResourceId: influencer.avatarResourceId ?? "",
    voiceResourceId: influencer.voiceResourceId ?? "",
    accent: influencer.accent,
    language: influencer.language,
    gender: influencer.gender,
    minimumAge: String(influencer.ageRange.minimum),
    maximumAge: String(influencer.ageRange.maximum),
    personality: influencer.personality.join(", "),
    tone: influencer.tone.join(", "),
    speakingStyle: influencer.speakingStyle,
    categories: influencer.categories.join(", "),
    intro: influencer.intro,
    outro: influencer.outro,
    energyLevel: String(influencer.energyLevel),
    facialExpressions: influencer.facialExpressions.join(", "),
    brandColors: influencer.brandColors.join(", "),
    status: influencer.status,
  };
}
