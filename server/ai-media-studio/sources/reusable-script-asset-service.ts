import { createHash } from "node:crypto";
import {
  reusableScriptAssetListRequestSchema,
  reusableScriptAssetListResponseSchema,
  reusableScriptAssetSaveRequestSchema,
  reusableScriptAssetSaveResponseSchema,
  type ReusableScriptAssetListResponse,
  type ReusableScriptAssetSaveResponse,
} from "../../../shared/ai-media-studio-reusable-script-assets";
import type { TenantScope } from "../core/resource-domain";
import {
  ReusableScriptAssetRepositoryError,
  type ReusableScriptAssetRepository,
} from "./reusable-script-asset-contracts";
import {
  SourceToScriptPreviewError,
  type SourceToScriptPreviewService,
} from "./source-to-script-preview-service";

export type ReusableScriptAssetErrorCode =
  | "INVALID_CONFIGURATION"
  | "INVALID_REQUEST"
  | "NOT_FOUND"
  | "SOURCE_INELIGIBLE"
  | "SOURCE_REFRESHED"
  | "PREVIEW_STALE"
  | "IDEMPOTENCY_CONFLICT"
  | "PERSISTENCE_UNAVAILABLE";

export class ReusableScriptAssetError extends Error {
  readonly statusCode: number;

  constructor(readonly code: ReusableScriptAssetErrorCode) {
    super("Reusable script asset is unavailable");
    this.name = "ReusableScriptAssetError";
    this.statusCode = code === "INVALID_REQUEST" ? 400
      : code === "NOT_FOUND" ? 404
        : ["SOURCE_INELIGIBLE", "SOURCE_REFRESHED", "PREVIEW_STALE", "IDEMPOTENCY_CONFLICT"].includes(code) ? 409
          : code === "PERSISTENCE_UNAVAILABLE" ? 503
            : 500;
  }
}

const EFFECTS = Object.freeze({
  sourceRead: true,
  scriptPreviewGenerated: true,
  scriptPersisted: true,
  orchestrationRunCreated: false,
  renderQueued: false,
  outboxCreated: false,
  videoProviderCalled: false,
  secretResolved: false,
  spendCommitted: false,
  publishingCreated: false,
  migrationApplied: false,
  deploymentPerformed: false,
} as const);

export class ReusableScriptAssetService {
  constructor(
    private readonly previewService: Pick<SourceToScriptPreviewService, "preview">,
    private readonly repository: ReusableScriptAssetRepository,
  ) {
    if (!previewService || typeof previewService.preview !== "function"
      || !repository || typeof repository.replay !== "function"
      || typeof repository.save !== "function" || typeof repository.list !== "function") {
      throw new ReusableScriptAssetError("INVALID_CONFIGURATION");
    }
  }

  async save(scope: TenantScope, actorUserId: string, rawInput: unknown): Promise<ReusableScriptAssetSaveResponse> {
    const parsed = reusableScriptAssetSaveRequestSchema.safeParse(rawInput);
    if (!validScope(scope) || !actorUserId?.trim() || !parsed.success) {
      throw new ReusableScriptAssetError("INVALID_REQUEST");
    }
    const inputDigest = digest(parsed.data);
    try {
      const replay = await this.repository.replay(scope, parsed.data.saveIdempotencyKey, inputDigest);
      if (replay) {
        return reusableScriptAssetSaveResponseSchema.parse({
          ...replay,
          downstreamState: "blocked_before_render_admission",
          effects: EFFECTS,
        });
      }
    } catch (error) {
      throw mapRepositoryError(error);
    }
    let preview;
    try {
      preview = await this.previewService.preview(scope, parsed.data.previewRequest);
    } catch (error) {
      throw mapPreviewError(error);
    }
    if (preview.source.contentHash !== parsed.data.expectedSourceContentHash) {
      throw new ReusableScriptAssetError("SOURCE_REFRESHED");
    }
    if (preview.previewDigest !== parsed.data.expectedPreviewDigest) {
      throw new ReusableScriptAssetError("PREVIEW_STALE");
    }
    if (!preview.scriptSet.variants.some((variant) => variant.id === parsed.data.selectedVariantId)) {
      throw new ReusableScriptAssetError("PREVIEW_STALE");
    }
    try {
      const result = await this.repository.save(scope, {
        actorUserId: actorUserId.trim(),
        sourceItemId: parsed.data.previewRequest.sourceItemId,
        expectedSourceContentHash: parsed.data.expectedSourceContentHash as `sha256:${string}`,
        expectedPreviewDigest: parsed.data.expectedPreviewDigest as `sha256:${string}`,
        previewRequest: parsed.data.previewRequest,
        saveIdempotencyKey: parsed.data.saveIdempotencyKey,
        inputDigest,
        generatorVersion: "deterministic-v1",
        selectedVariantId: parsed.data.selectedVariantId,
        scriptSet: preview.scriptSet,
      });
      return reusableScriptAssetSaveResponseSchema.parse({
        ...result,
        downstreamState: "blocked_before_render_admission",
        effects: EFFECTS,
      });
    } catch (error) {
      if (error instanceof ReusableScriptAssetError) throw error;
      throw mapRepositoryError(error);
    }
  }

  async list(scope: TenantScope, rawRequest: unknown): Promise<ReusableScriptAssetListResponse> {
    const parsed = reusableScriptAssetListRequestSchema.safeParse(rawRequest);
    if (!validScope(scope) || !parsed.success) throw new ReusableScriptAssetError("INVALID_REQUEST");
    try {
      return reusableScriptAssetListResponseSchema.parse(await this.repository.list(scope, parsed.data));
    } catch (error) {
      throw mapRepositoryError(error);
    }
  }
}

function validScope(scope: TenantScope): boolean {
  return Boolean(scope?.ownerUserId?.trim() && scope?.workspaceId?.trim());
}

function digest(value: unknown): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function mapPreviewError(error: unknown): ReusableScriptAssetError {
  if (!(error instanceof SourceToScriptPreviewError)) return new ReusableScriptAssetError("PERSISTENCE_UNAVAILABLE");
  if (error.code === "INVALID_REQUEST") return new ReusableScriptAssetError("INVALID_REQUEST");
  if (error.code === "NOT_FOUND") return new ReusableScriptAssetError("NOT_FOUND");
  if (error.code === "SOURCE_INELIGIBLE") return new ReusableScriptAssetError("SOURCE_INELIGIBLE");
  return new ReusableScriptAssetError("PERSISTENCE_UNAVAILABLE");
}

function mapRepositoryError(error: unknown): ReusableScriptAssetError {
  if (!(error instanceof ReusableScriptAssetRepositoryError)) {
    return new ReusableScriptAssetError("PERSISTENCE_UNAVAILABLE");
  }
  if (error.code === "NOT_FOUND" || error.code === "INFLUENCER_NOT_FOUND") {
    return new ReusableScriptAssetError("NOT_FOUND");
  }
  if (error.code === "SOURCE_INELIGIBLE") return new ReusableScriptAssetError("SOURCE_INELIGIBLE");
  if (error.code === "SOURCE_REFRESHED") return new ReusableScriptAssetError("SOURCE_REFRESHED");
  if (error.code === "PREVIEW_STALE") return new ReusableScriptAssetError("PREVIEW_STALE");
  if (error.code === "IDEMPOTENCY_CONFLICT") return new ReusableScriptAssetError("IDEMPOTENCY_CONFLICT");
  if (error.code === "INVALID_CURSOR") return new ReusableScriptAssetError("INVALID_REQUEST");
  return new ReusableScriptAssetError("PERSISTENCE_UNAVAILABLE");
}
