import { createHash } from "node:crypto";
import {
  PRODUCTION_BATCH_MAX_AVATARS,
  PRODUCTION_BATCH_MAX_VIDEOS,
  PRODUCTION_BATCH_MIN_AVATARS,
  PRODUCTION_BATCH_MIN_VIDEOS,
  PRODUCTION_BATCH_VIDEOS_PER_AVATAR,
  productionBatchCreativeReviewSchema,
} from "../../../shared/ai-media-studio-production-batches";
import { SOURCE_CATEGORIES, type SourceCategory } from "../sources/contracts";

type ProductionBatchCreativeReview = ReturnType<typeof productionBatchCreativeReviewSchema.parse>;

export type ProductionBatchEnvelope = Readonly<{
  version: 1;
  batchId: string;
  planId: string;
  slotId: string;
  scriptKey: string;
  idempotencyKey: string;
  inputDigest: string;
  sourceContentHash: string;
  sourceContentChecksum: string;
  sourceTitle: string;
  sourceCategory: SourceCategory;
  generatorVersion: string;
  variantCount: number;
  preparedAt: string;
}>;

export type ProductionBatchApprovalEnvelope = Readonly<{
  version: 1;
  ownerUserId: string;
  workspaceId: string;
  batchId: string;
  planId: string;
  slotId: string;
  scriptKey: string;
  selectedVariantChecksum: string;
  selectedCreativeDigest: string;
  inputDigest: string;
  idempotencyKey: string;
  approvedAt: string;
}>;

export type VerifiedProductionVariant = Readonly<{
  creative: ProductionBatchCreativeReview;
  creativeDigest: string;
}>;

export type ApprovedProductionBatchSlotFacts = Readonly<{
  scope: Readonly<{ ownerUserId: string; workspaceId: string }>;
  databaseNow: Date;
  plan: Readonly<{ publicKey: string; status: string; plannedSlotCount: number }>;
  planSlots: readonly Readonly<{ sourceMemberKey: string; videoNumber: number; status: string }>[];
  slot: Readonly<{ publicKey: string; status: string; scriptVariantId: string }>;
  script: Readonly<{
    id: string;
    title: string;
    status: string;
    currentVariantId: string;
    metadata: unknown;
    sourceType: string;
    sourceItemId: string | null;
  }>;
  source: Readonly<{
    id: string;
    type: string;
    title: string;
    content: string;
    contentHash: string;
    status: string;
    rightsStatus: string;
    moderationStatus: string;
  }>;
  variants: readonly Readonly<{
    id: string;
    version: number;
    label: string;
    content: string;
    status: string;
    checksum: string;
    metadata: unknown;
  }>[];
}>;

const VERIFIED_PRODUCTION_BATCH_APPROVAL = Symbol("verified-production-batch-approval");
export type VerifiedProductionBatchApprovalBinding = Readonly<{
  [VERIFIED_PRODUCTION_BATCH_APPROVAL]: true;
  batchId: string;
  planId: string;
  slotId: string;
  scriptKey: string;
}>;

const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const RAW_SHA256 = /^[a-f0-9]{64}$/u;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{8,200}$/u;
const ENVELOPE_KEYS = [
  "batchId", "generatorVersion", "idempotencyKey", "inputDigest", "planId", "preparedAt",
  "scriptKey", "slotId", "sourceCategory", "sourceContentChecksum", "sourceContentHash", "sourceTitle",
  "variantCount", "version",
] as const;
const VARIANT_KEYS = [...ENVELOPE_KEYS, "selected", "variantIndex", "variantKey"].sort();
const CREATIVE_KEYS = ["angle", "caption", "creativeDigest", "cta", "hashtags", "hook", "script", "seoKeywords", "title"] as const;
const APPROVAL_KEYS = [
  "approvedAt", "batchId", "idempotencyKey", "inputDigest", "ownerUserId", "planId", "scriptKey",
  "selectedCreativeDigest", "selectedVariantChecksum", "slotId", "version", "workspaceId",
] as const;

function record(input: unknown): Record<string, unknown> | undefined {
  if (typeof input === "string") {
    try { return record(JSON.parse(input)); } catch { return undefined; }
  }
  return input !== null && typeof input === "object" && !Array.isArray(input)
    ? input as Record<string, unknown> : undefined;
}

function exactKeys(input: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(input).sort();
  const sorted = [...expected].sort();
  return actual.length === sorted.length && actual.every((key, index) => key === sorted[index]);
}

function metadataKeys(input: Record<string, unknown>, expected: readonly string[]): boolean {
  return exactKeys(input, expected);
}

function knownMetadataKeys(input: Record<string, unknown>): boolean {
  const allowed = ["productionBatchApprovalV1", "productionBatchV1", "productionCreativeV1"];
  return Object.keys(input).every((key) => allowed.includes(key)) && "productionBatchV1" in input;
}

function hash(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function exactIso(input: unknown): input is string {
  if (typeof input !== "string") return false;
  const parsed = new Date(input);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === input;
}

function digest(input: unknown): string {
  return `sha256:${hash(JSON.stringify(input))}`;
}

export function productionCreativeDigest(creative: ProductionBatchCreativeReview): string {
  return digest({ domain: "ai-media-production-creative-v1", ...creative });
}

export function productionApprovalInputDigest(input: {
  ownerUserId: string;
  workspaceId: string;
  planId: string;
  expectedBatchId: string;
  idempotencyKey: string;
}): string {
  return digest({
    domain: "ai-media-production-batch-approval-v1",
    ownerUserId: input.ownerUserId,
    workspaceId: input.workspaceId,
    planId: input.planId,
    expectedBatchId: input.expectedBatchId,
    idempotencyKey: input.idempotencyKey,
  });
}

export function readProductionBatchEnvelope(metadataInput: unknown): ProductionBatchEnvelope | undefined {
  const metadata = record(metadataInput);
  if (!metadata || !knownMetadataKeys(metadata)) return undefined;
  const envelope = record(metadata.productionBatchV1);
  if (!envelope || !exactKeys(envelope, ENVELOPE_KEYS)
    || envelope.version !== 1
    || typeof envelope.batchId !== "string" || !/^batch_[a-f0-9]{24}$/u.test(envelope.batchId)
    || typeof envelope.planId !== "string" || !/^plan_[a-f0-9]{24}$/u.test(envelope.planId)
    || typeof envelope.slotId !== "string" || !/^slot_[a-f0-9]{24}$/u.test(envelope.slotId)
    || typeof envelope.scriptKey !== "string" || !/^script_[a-f0-9]{24}$/u.test(envelope.scriptKey)
    || typeof envelope.idempotencyKey !== "string" || !IDEMPOTENCY_KEY.test(envelope.idempotencyKey)
    || typeof envelope.inputDigest !== "string" || !SHA256.test(envelope.inputDigest)
    || typeof envelope.sourceContentHash !== "string" || !SHA256.test(envelope.sourceContentHash)
    || typeof envelope.sourceContentChecksum !== "string" || !RAW_SHA256.test(envelope.sourceContentChecksum)
    || typeof envelope.sourceTitle !== "string" || envelope.sourceTitle.trim() !== envelope.sourceTitle
    || envelope.sourceTitle.length < 1 || envelope.sourceTitle.length > 200
    || /[\u0000-\u001f\u007f]/u.test(envelope.sourceTitle)
    || !SOURCE_CATEGORIES.includes(envelope.sourceCategory as SourceCategory)
    || typeof envelope.generatorVersion !== "string" || !envelope.generatorVersion || envelope.generatorVersion.length > 120
    || !Number.isInteger(envelope.variantCount) || Number(envelope.variantCount) < 1 || Number(envelope.variantCount) > 5
    || !exactIso(envelope.preparedAt)) return undefined;
  return envelope as unknown as ProductionBatchEnvelope;
}

export function readProductionVariantMetadata(
  metadataInput: unknown,
  base: ProductionBatchEnvelope,
  index: number,
): VerifiedProductionVariant | undefined {
  const metadata = record(metadataInput);
  if (!metadata || !knownMetadataKeys(metadata) || !("productionCreativeV1" in metadata)) return undefined;
  const envelope = record(metadata.productionBatchV1);
  if (!envelope || !exactKeys(envelope, VARIANT_KEYS)) return undefined;
  const { variantKey, variantIndex, selected, ...candidate } = envelope;
  const baseRecord = base as unknown as Record<string, unknown>;
  if (!ENVELOPE_KEYS.every((key) => candidate[key] === baseRecord[key])
    || typeof variantKey !== "string" || !/^variant_[a-f0-9]{24}$/u.test(variantKey)
    || variantIndex !== index || selected !== (index === 0)) return undefined;
  const creative = record(metadata.productionCreativeV1);
  if (!creative || !exactKeys(creative, CREATIVE_KEYS)) return undefined;
  const { creativeDigest, ...review } = creative;
  const parsed = productionBatchCreativeReviewSchema.safeParse(review);
  return parsed.success && typeof creativeDigest === "string" && SHA256.test(creativeDigest)
    && creativeDigest === productionCreativeDigest(parsed.data)
    ? { creative: parsed.data, creativeDigest } : undefined;
}

export function readProductionApproval(
  metadataInput: unknown,
  base: ProductionBatchEnvelope,
  scope: { ownerUserId: string; workspaceId: string },
  selectedChecksum: string,
  selectedCreativeDigest: string,
): ProductionBatchApprovalEnvelope | undefined {
  const metadata = record(metadataInput);
  if (!metadata || !knownMetadataKeys(metadata) || !("productionBatchApprovalV1" in metadata)) return undefined;
  const approval = record(metadata.productionBatchApprovalV1);
  if (!approval || !exactKeys(approval, APPROVAL_KEYS) || approval.version !== 1
    || approval.ownerUserId !== scope.ownerUserId || approval.workspaceId !== scope.workspaceId
    || approval.batchId !== base.batchId || approval.planId !== base.planId || approval.slotId !== base.slotId
    || approval.scriptKey !== base.scriptKey
    || typeof approval.inputDigest !== "string" || !SHA256.test(approval.inputDigest)
    || approval.selectedVariantChecksum !== selectedChecksum || !RAW_SHA256.test(selectedChecksum)
    || approval.selectedCreativeDigest !== selectedCreativeDigest || !SHA256.test(selectedCreativeDigest)
    || typeof approval.idempotencyKey !== "string" || !IDEMPOTENCY_KEY.test(approval.idempotencyKey)
    || !exactIso(approval.approvedAt)) return undefined;
  return approval as unknown as ProductionBatchApprovalEnvelope;
}

/**
 * Strict PR144 boundary used immediately before launch authority is issued.
 * It accepts only the exact approved production-batch representation; legacy
 * script metadata, extensions, partial approvals, and ambiguous selections fail closed.
 */
export function verifyApprovedProductionBatchSlotMetadata(facts: ApprovedProductionBatchSlotFacts): boolean {
  if (!(facts.databaseNow instanceof Date) || !Number.isFinite(facts.databaseNow.getTime())
    || facts.plan.status !== "planned" || facts.slot.status !== "planned"
    || facts.script.status !== "approved" || facts.source.id !== facts.script.sourceItemId
    || facts.source.type !== facts.script.sourceType
    || !["accepted", "ready"].includes(facts.source.status)
    || !["owned", "licensed"].includes(facts.source.rightsStatus)
    || facts.source.moderationStatus !== "approved") return false;

  const members = new Map<string, Set<number>>();
  for (const slot of facts.planSlots) {
    if (slot.status !== "planned" || !/^member_[a-f0-9]{24}$/u.test(slot.sourceMemberKey)
      || !Number.isInteger(slot.videoNumber) || slot.videoNumber < 1
      || slot.videoNumber > PRODUCTION_BATCH_VIDEOS_PER_AVATAR) return false;
    const videos = members.get(slot.sourceMemberKey) ?? new Set<number>();
    videos.add(slot.videoNumber);
    members.set(slot.sourceMemberKey, videos);
  }
  if (!Number.isInteger(facts.plan.plannedSlotCount)
    || facts.plan.plannedSlotCount < PRODUCTION_BATCH_MIN_VIDEOS
    || facts.plan.plannedSlotCount > PRODUCTION_BATCH_MAX_VIDEOS
    || facts.planSlots.length !== facts.plan.plannedSlotCount
    || members.size < PRODUCTION_BATCH_MIN_AVATARS || members.size > PRODUCTION_BATCH_MAX_AVATARS
    || facts.plan.plannedSlotCount !== members.size * PRODUCTION_BATCH_VIDEOS_PER_AVATAR
    || [...members.values()].some((videos) => videos.size !== PRODUCTION_BATCH_VIDEOS_PER_AVATAR)) return false;

  const scriptMetadata = record(facts.script.metadata);
  if (!scriptMetadata || !metadataKeys(scriptMetadata, ["productionBatchApprovalV1", "productionBatchV1"])) return false;
  const base = readProductionBatchEnvelope(scriptMetadata);
  if (!base || base.planId !== facts.plan.publicKey || base.slotId !== facts.slot.publicKey
    || base.sourceContentHash !== facts.source.contentHash
    || base.sourceContentChecksum !== hash(facts.source.content)
    || base.sourceTitle !== facts.source.title || base.sourceCategory !== facts.source.type
    || Date.parse(base.preparedAt) > facts.databaseNow.getTime()
    || facts.variants.length !== base.variantCount) return false;

  const ordered = [...facts.variants].sort((left, right) => left.version - right.version);
  if (ordered.some((variant, index) => variant.version !== index + 1)) return false;
  const selected = ordered[0];
  if (!selected || facts.slot.scriptVariantId !== selected.id || facts.script.currentVariantId !== selected.id) return false;
  const selectedMetadata = record(selected.metadata);
  if (!selectedMetadata || !metadataKeys(selectedMetadata,
    ["productionBatchApprovalV1", "productionBatchV1", "productionCreativeV1"])) return false;
  const selectedVerified = readProductionVariantMetadata(selectedMetadata, base, 0);
  if (!selectedVerified || selected.status !== "approved" || selected.checksum !== hash(selected.content)
    || selectedVerified.creative.title !== selected.label || selectedVerified.creative.title !== facts.script.title
    || selectedVerified.creative.script !== selected.content) return false;

  const scriptApproval = readProductionApproval(scriptMetadata, base, facts.scope,
    selected.checksum, selectedVerified.creativeDigest);
  const variantApproval = readProductionApproval(selectedMetadata, base, facts.scope,
    selected.checksum, selectedVerified.creativeDigest);
  if (!scriptApproval || !variantApproval
    || !APPROVAL_KEYS.every((key) => scriptApproval[key] === variantApproval[key])
    || scriptApproval.inputDigest !== productionApprovalInputDigest({
      ...facts.scope, planId: base.planId, expectedBatchId: base.batchId,
      idempotencyKey: scriptApproval.idempotencyKey,
    })
    || Date.parse(scriptApproval.approvedAt) < Date.parse(base.preparedAt)
    || Date.parse(scriptApproval.approvedAt) > facts.databaseNow.getTime()) return false;

  for (const [index, variant] of ordered.entries()) {
    const metadata = record(variant.metadata);
    const expectedKeys = index === 0
      ? ["productionBatchApprovalV1", "productionBatchV1", "productionCreativeV1"]
      : ["productionBatchV1", "productionCreativeV1"];
    const verified = metadata && metadataKeys(metadata, expectedKeys)
      ? readProductionVariantMetadata(metadata, base, index) : undefined;
    if (!verified || variant.checksum !== hash(variant.content)
      || verified.creative.title !== variant.label || verified.creative.script !== variant.content
      || (index === 0 ? variant.status !== "approved" : variant.status !== "draft")) return false;
  }
  return true;
}

/** Nominal result for authority code: callers cannot construct it from HTTP input. */
export function verifiedProductionBatchApprovalBinding(
  facts: ApprovedProductionBatchSlotFacts,
): VerifiedProductionBatchApprovalBinding | undefined {
  if (!verifyApprovedProductionBatchSlotMetadata(facts)) return undefined;
  const envelope = readProductionBatchEnvelope(facts.script.metadata);
  if (!envelope) return undefined;
  return Object.freeze({
    [VERIFIED_PRODUCTION_BATCH_APPROVAL]: true as const,
    batchId: envelope.batchId,
    planId: envelope.planId,
    slotId: envelope.slotId,
    scriptKey: envelope.scriptKey,
  });
}
