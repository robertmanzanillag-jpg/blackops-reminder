import { createHash } from "node:crypto";
import type { OneVideoExecutionControl } from "../../../shared/ai-media-studio-one-video-execution-control";
import type { TenantScope } from "../core/resource-domain";

export type OneVideoExecutionControlErrorCode = "INVALID_REQUEST" | "NOT_FOUND" | "UNAVAILABLE";

export class OneVideoExecutionControlError extends Error {
  readonly statusCode: number;
  constructor(readonly code: OneVideoExecutionControlErrorCode) {
    super(code); this.name = "OneVideoExecutionControlError";
    this.statusCode = code === "INVALID_REQUEST" ? 400 : code === "NOT_FOUND" ? 404 : 503;
  }
}

export interface OneVideoExecutionControlRepository {
  /** One exact tenant slot, observed with PostgreSQL time in a repeatable-read/read-only transaction. */
  observe(scope: TenantScope, publicPlanKey: string, publicSlotKey: string): Promise<OneVideoExecutionControl | undefined>;
}

export type LaunchRenderSpecInput = Readonly<{
  providerAccountId: string;
  providerKey: string;
  providerCredentialVersion: number;
  avatarResourceId: string;
  voiceResourceId: string;
  scriptVariantId: string;
  scriptVariantChecksum: string;
}>;

export type MaximumQuoteKeyInput = Readonly<{
  evidenceId: string;
  evidenceRevision: number;
  evidenceDigest: `sha256:${string}`;
  amountMicroUsd: string;
  currency: "USD";
  expiresAt: Date;
  renderSpecDigest: `sha256:${string}`;
}>;

const canonicalDigest = (domain: string, value: unknown): `sha256:${string}` =>
  `sha256:${createHash("sha256").update(`${domain}\0${canonicalJson(value)}`).digest("hex")}`;

/** Exact server-owned provider payload identity. The engine and output format are intentionally fixed. */
export function deriveLaunchRenderSpecDigest(input: LaunchRenderSpecInput): `sha256:${string}` {
  if (!input || typeof input !== "object" || typeof input.providerAccountId !== "string"
    || typeof input.providerKey !== "string" || input.providerKey.length < 1 || input.providerKey.length > 80
    || !Number.isSafeInteger(input.providerCredentialVersion) || input.providerCredentialVersion < 1
    || ![input.avatarResourceId, input.voiceResourceId, input.scriptVariantId]
      .every((value) => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(value))
    || typeof input.scriptVariantChecksum !== "string" || !/^[0-9a-f]{64}$/u.test(input.scriptVariantChecksum)) {
    throw new TypeError("Invalid launch render specification");
  }
  return canonicalDigest("ai-media-launch-render-spec-v1", {
    engine: "heygen-video-generate-v2",
    aspectRatio: "9:16",
    container: "mp4",
    providerAccountId: input.providerAccountId,
    providerKey: input.providerKey,
    providerCredentialVersion: input.providerCredentialVersion,
    avatarResourceId: input.avatarResourceId,
    voiceResourceId: input.voiceResourceId,
    scriptVariantId: input.scriptVariantId,
    scriptVariantChecksum: input.scriptVariantChecksum,
  });
}

/** Public CAS token: deliberately not an evidence UUID, digest, amount, or provider identifier. */
export function deriveMaximumQuoteKey(input: MaximumQuoteKeyInput): string {
  if (!input || typeof input !== "object"
    || typeof input.evidenceId !== "string"
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(input.evidenceId)
    || !Number.isSafeInteger(input.evidenceRevision) || input.evidenceRevision < 1
    || !/^sha256:[0-9a-f]{64}$/u.test(input.evidenceDigest)
    || !/^[1-9][0-9]{0,15}$/u.test(input.amountMicroUsd)
    || BigInt(input.amountMicroUsd) > 9_000_000_000_000_000n
    || input.currency !== "USD" || !(input.expiresAt instanceof Date)
    || !Number.isFinite(input.expiresAt.getTime())
    || !/^sha256:[0-9a-f]{64}$/u.test(input.renderSpecDigest)) {
    throw new TypeError("Invalid maximum quote key input");
  }
  return `quote_${canonicalDigest("ai-media-maximum-quote-key-v1", {
    evidenceId: input.evidenceId,
    evidenceRevision: input.evidenceRevision,
    evidenceDigest: input.evidenceDigest,
    amountMicroUsd: input.amountMicroUsd,
    currency: input.currency,
    expiresAt: input.expiresAt.toISOString(),
    renderSpecDigest: input.renderSpecDigest,
  }).slice("sha256:".length, "sha256:".length + 24)}`;
}

export function deriveRenderSpecKey(renderSpecDigest: `sha256:${string}`): string {
  return `render_spec_${canonicalDigest("ai-media-render-spec-key-v1", renderSpecDigest)
    .slice("sha256:".length, "sha256:".length + 24)}`;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new TypeError("Invalid launch authority key input");
    return String(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (!value || typeof value !== "object") throw new TypeError("Invalid launch authority key input");
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}
