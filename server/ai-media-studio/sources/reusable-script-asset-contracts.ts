import type {
  ReusableScriptAsset,
  ReusableScriptAssetListRequest,
  ReusableScriptAssetListResponse,
} from "../../../shared/ai-media-studio-reusable-script-assets";
import type { ParsedSourceScriptPreviewRequest } from "../../../shared/ai-media-studio-source-to-script";
import type { ScriptSet } from "../../../shared/ai-media-studio-scripts";
import type { TenantScope } from "../core/resource-domain";

export type ReusableScriptAssetRepositoryErrorCode =
  | "NOT_FOUND"
  | "SOURCE_REFRESHED"
  | "SOURCE_INELIGIBLE"
  | "PREVIEW_STALE"
  | "INFLUENCER_NOT_FOUND"
  | "IDEMPOTENCY_CONFLICT"
  | "INVALID_CURSOR"
  | "PERSISTENCE_UNAVAILABLE";

export class ReusableScriptAssetRepositoryError extends Error {
  constructor(readonly code: ReusableScriptAssetRepositoryErrorCode) {
    super("Reusable script persistence is unavailable");
    this.name = "ReusableScriptAssetRepositoryError";
  }
}

export interface PersistReusableScriptAssetInput {
  actorUserId: string;
  sourceItemId: string;
  expectedSourceContentHash: `sha256:${string}`;
  expectedPreviewDigest: `sha256:${string}`;
  previewRequest: ParsedSourceScriptPreviewRequest;
  saveIdempotencyKey: string;
  inputDigest: `sha256:${string}`;
  generatorVersion: "deterministic-v1";
  selectedVariantId: string;
  scriptSet: ScriptSet;
}

export interface PersistReusableScriptAssetResult {
  asset: ReusableScriptAsset;
  replayed: boolean;
}

export interface ReusableScriptAssetRepository {
  replay(
    scope: TenantScope,
    saveIdempotencyKey: string,
    inputDigest: `sha256:${string}`,
  ): Promise<PersistReusableScriptAssetResult | null>;
  save(
    scope: TenantScope,
    input: PersistReusableScriptAssetInput,
  ): Promise<PersistReusableScriptAssetResult>;
  list(scope: TenantScope, request: ReusableScriptAssetListRequest): Promise<ReusableScriptAssetListResponse>;
}
