import { createHash } from "node:crypto";
import {
  sourceScriptPreviewResponseSchema,
  type ParsedSourceScriptPreviewRequest,
  type SourceScriptPreviewResponse,
} from "../../../shared/ai-media-studio-source-to-script";
import type { MediaSourceSnapshot } from "../../../shared/ai-media-studio-scripts";
import type { TenantScope } from "../core/resource-domain";
import { DeterministicScriptService } from "../script-service";
import { SOURCE_CATEGORIES, type CanonicalSourceItem, type SourceRepository } from "./contracts";

export type SourceToScriptPreviewErrorCode =
  | "INVALID_CONFIGURATION"
  | "INVALID_REQUEST"
  | "NOT_FOUND"
  | "SOURCE_INELIGIBLE"
  | "SOURCE_UNAVAILABLE";

export class SourceToScriptPreviewError extends Error {
  readonly statusCode: number;

  constructor(readonly code: SourceToScriptPreviewErrorCode) {
    super("Source script preview is unavailable");
    this.name = "SourceToScriptPreviewError";
    this.statusCode = code === "INVALID_REQUEST" ? 400
      : code === "NOT_FOUND" ? 404
        : code === "SOURCE_INELIGIBLE" ? 409
          : code === "SOURCE_UNAVAILABLE" ? 503
            : 500;
  }
}

const ALLOWED_RIGHTS = new Set(["owned", "licensed"]);
const ALLOWED_STATUSES = new Set(["accepted", "ready"]);
const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const SOURCE_CONTENT_LIMIT = 4_000;

/**
 * Read-only source-to-script preview boundary. It consumes only tenant-owned
 * source IDs already persisted by AI Media Studio and never persists scripts,
 * creates orchestration runs, queues renders, resolves secrets, calls video
 * providers, publishes, deploys or commits spend.
 */
export class SourceToScriptPreviewService {
  constructor(
    private readonly repository: Pick<SourceRepository, "get">,
    private readonly scripts = new DeterministicScriptService(),
  ) {
    if (!repository || typeof repository.get !== "function") {
      throw new SourceToScriptPreviewError("INVALID_CONFIGURATION");
    }
  }

  async preview(scope: TenantScope, input: ParsedSourceScriptPreviewRequest): Promise<SourceScriptPreviewResponse> {
    if (!scope.ownerUserId.trim() || !scope.workspaceId.trim()) {
      throw new SourceToScriptPreviewError("INVALID_REQUEST");
    }
    let source: CanonicalSourceItem | undefined;
    try {
      source = await this.repository.get(scope, input.sourceItemId);
    } catch {
      throw new SourceToScriptPreviewError("SOURCE_UNAVAILABLE");
    }
    if (!source) throw new SourceToScriptPreviewError("NOT_FOUND");
    try {
      const eligible = normalizeEligibleSource(source, scope, input.sourceItemId);
      const scriptRequest = {
        source: toMediaSourceSnapshot(eligible),
        ...(input.influencerId ? { influencerId: input.influencerId } : {}),
        language: input.language,
        ...(input.angle ? { angle: input.angle } : {}),
        variantCount: input.variantCount,
      };
      const generated = this.scripts.generate(scriptRequest);
      const digest = previewDigest({
        source: {
          id: eligible.id,
          category: eligible.category,
          contentHash: eligible.contentHash,
          updatedAt: eligible.updatedAt,
        },
        request: input,
        scriptSet: generated.scriptSet,
      });
      return sourceScriptPreviewResponseSchema.parse({
      source: {
        id: eligible.id,
        category: eligible.category,
        title: eligible.title,
        contentHash: eligible.contentHash,
        status: eligible.status,
        rightsStatus: eligible.rightsStatus,
        moderationStatus: eligible.moderationStatus,
      },
      scriptSet: generated.scriptSet,
      previewDigest: digest,
      downstreamState: "blocked_before_render_admission",
      generation: generated.generation,
      effects: {
        sourceRead: true,
        scriptPreviewGenerated: true,
        scriptPersisted: false,
        orchestrationRunCreated: false,
        renderQueued: false,
        outboxCreated: false,
        videoProviderCalled: false,
        secretResolved: false,
        spendCommitted: false,
        publishingCreated: false,
        migrationApplied: false,
        deploymentPerformed: false,
      },
      });
    } catch (error) {
      if (error instanceof SourceToScriptPreviewError) throw error;
      throw new SourceToScriptPreviewError("SOURCE_UNAVAILABLE");
    }
  }
}

type EligibleSource = CanonicalSourceItem & {
  title: string;
  content: string;
  rightsStatus: "owned" | "licensed";
  moderationStatus: "approved";
  status: "accepted" | "ready";
};

function normalizeEligibleSource(source: CanonicalSourceItem, scope: TenantScope, requestedId: string): EligibleSource {
  let candidate: CanonicalSourceItem;
  try {
    candidate = structuredClone(source);
  } catch {
    throw new SourceToScriptPreviewError("SOURCE_UNAVAILABLE");
  }
  if (candidate.ownerUserId !== scope.ownerUserId || candidate.workspaceId !== scope.workspaceId
    || typeof candidate.id !== "string" || candidate.id !== requestedId
    || !SOURCE_CATEGORIES.includes(candidate.category)
    || typeof candidate.title !== "string" || !candidate.title.trim() || candidate.title !== candidate.title.trim()
    || candidate.title.length > 200 || /[\u0000-\u001f\u007f]/u.test(candidate.title)
    || typeof candidate.content !== "string" || !candidate.content.trim() || candidate.content !== candidate.content.trim()
    || candidate.content.length > SOURCE_CONTENT_LIMIT
    || typeof candidate.contentHash !== "string" || !SHA256.test(candidate.contentHash)
    || typeof candidate.updatedAt !== "string" || !canonicalIso(candidate.updatedAt)
    || !ALLOWED_STATUSES.has(candidate.status)
    || !ALLOWED_RIGHTS.has(candidate.rightsStatus)
    || candidate.moderationStatus !== "approved") {
    throw new SourceToScriptPreviewError("SOURCE_INELIGIBLE");
  }
  return candidate as EligibleSource;
}

function canonicalIso(input: string): boolean {
  const date = new Date(input);
  return Number.isFinite(date.getTime()) && date.toISOString() === input;
}

function toMediaSourceSnapshot(source: EligibleSource): MediaSourceSnapshot {
  return {
    type: source.category,
    id: source.id,
    title: source.title.slice(0, 200),
    summary: source.content.slice(0, SOURCE_CONTENT_LIMIT),
  };
}

function previewDigest(value: unknown): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}
