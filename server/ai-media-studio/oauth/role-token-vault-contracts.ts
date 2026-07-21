import { createHash } from "node:crypto";
import { aiMediaOAuthPlatformSchema, type AiMediaOAuthPlatform } from "../../../shared/ai-media-studio-oauth";
import {
  OAUTH_PROVIDER_TARGET_KINDS,
  type OAuthProviderTargetKind,
  type OAuthProviderTokenArtifactRole,
  type OAuthProviderTokenLifetime,
} from "./provider-connection-contracts";

export const OAUTH_ROLE_TOKEN_VAULT_VERSION = 2 as const;
export const OAUTH_ROLE_TOKEN_REFERENCE_PREFIX = "vault://ai-media-studio/oauth-role-token/v2" as const;
export const OAUTH_ROLE_TOKEN_VAULT_ROLES = ["operational_access", "refresh"] as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const SAFE_VALUE = /^[A-Za-z0-9._:/-]+$/u;
const MAX_REVALIDATION_MS = 366 * 24 * 60 * 60 * 1_000;
const CONTEXT_KEYS = [
  "artifactBindingId", "actorUserId", "attemptId", "candidateId", "ownerUserId", "platform",
  "providerAccountId", "purpose", "role", "selectionDigest", "sessionId", "manifestRevision", "targetCredentialVersion",
  "targetId", "targetKind", "tokenBindingId", "workspaceId",
] as const;

export type OAuthRoleTokenVaultContext = Readonly<{
  purpose: "ai_media_oauth_role_token_v2";
  ownerUserId: string;
  workspaceId: string;
  actorUserId: string;
  providerAccountId: string;
  platform: AiMediaOAuthPlatform;
  sessionId: string;
  attemptId: string;
  targetCredentialVersion: number;
  tokenBindingId: string;
  artifactBindingId: string;
  role: OAuthProviderTokenArtifactRole;
  candidateId: string;
  targetKind: OAuthProviderTargetKind;
  targetId: string;
  selectionDigest: string;
  manifestRevision: string;
}>;

/** Safe metadata only: never includes a secret or a durable vault reference. */
export type OAuthRoleTokenDescriptor = Readonly<{
  role: OAuthProviderTokenArtifactRole;
  lifetime: OAuthProviderTokenLifetime;
  manifestRevision: string;
}>;

export type OAuthRoleTokenVaultRecord = Readonly<{
  reference: string;
  descriptor: OAuthRoleTokenDescriptor;
}>;

export interface OAuthRoleTokenVault {
  putOnce(input: Readonly<{
    context: OAuthRoleTokenVaultContext;
    secret: string;
    descriptor: OAuthRoleTokenDescriptor;
  }>): Promise<OAuthRoleTokenVaultRecord>;
  find(context: OAuthRoleTokenVaultContext): Promise<OAuthRoleTokenVaultRecord | undefined>;
  readDescriptor(reference: string, context: OAuthRoleTokenVaultContext): Promise<OAuthRoleTokenDescriptor>;
  delete(reference: string, context: OAuthRoleTokenVaultContext): Promise<void>;
}

/** Deliberately separate from OAuthRoleTokenVault so ordinary orchestration cannot read credentials. */
export interface OAuthRoleTokenSecretReader {
  readSecret(reference: string, context: OAuthRoleTokenVaultContext): Promise<string>;
}

export class OAuthRoleTokenVaultError extends Error {
  constructor() {
    super("OAuth role token vault request was rejected");
    this.name = "OAuthRoleTokenVaultError";
  }
}

export function validateOAuthRoleTokenVaultContext(raw: unknown): OAuthRoleTokenVaultContext {
  const value = exactRecord(raw, CONTEXT_KEYS);
  if (value.purpose !== "ai_media_oauth_role_token_v2"
    || !safeField(value.ownerUserId) || !safeField(value.workspaceId) || !safeField(value.actorUserId)
    || !UUID.test(asString(value.providerAccountId)) || !aiMediaOAuthPlatformSchema.safeParse(value.platform).success
    || !UUID.test(asString(value.sessionId)) || !safeField(value.attemptId)
    || !Number.isSafeInteger(value.targetCredentialVersion) || Number(value.targetCredentialVersion) < 1
    || !UUID.test(asString(value.tokenBindingId)) || !UUID.test(asString(value.artifactBindingId))
    || value.tokenBindingId === value.artifactBindingId
    || !OAUTH_ROLE_TOKEN_VAULT_ROLES.includes(value.role as typeof OAUTH_ROLE_TOKEN_VAULT_ROLES[number])
    || !safeField(value.candidateId) || !OAUTH_PROVIDER_TARGET_KINDS.includes(value.targetKind as OAuthProviderTargetKind)
    || !safeField(value.targetId) || !SHA256.test(asString(value.selectionDigest))
    || !safeField(value.manifestRevision, 100)
    || !platformAllowsRole(value.platform as AiMediaOAuthPlatform, value.role as OAuthProviderTokenArtifactRole)
    || !platformMatchesTargetKind(value.platform as AiMediaOAuthPlatform, value.targetKind as OAuthProviderTargetKind)) {
    throw rejected();
  }
  return Object.freeze({
    purpose: "ai_media_oauth_role_token_v2",
    ownerUserId: value.ownerUserId as string,
    workspaceId: value.workspaceId as string,
    actorUserId: value.actorUserId as string,
    providerAccountId: value.providerAccountId as string,
    platform: value.platform as AiMediaOAuthPlatform,
    sessionId: value.sessionId as string,
    attemptId: value.attemptId as string,
    targetCredentialVersion: value.targetCredentialVersion as number,
    tokenBindingId: value.tokenBindingId as string,
    artifactBindingId: value.artifactBindingId as string,
    role: value.role as OAuthProviderTokenArtifactRole,
    candidateId: value.candidateId as string,
    targetKind: value.targetKind as OAuthProviderTargetKind,
    targetId: value.targetId as string,
    selectionDigest: value.selectionDigest as string,
    manifestRevision: value.manifestRevision as string,
  });
}

export function validateOAuthRoleTokenDescriptor(
  raw: unknown,
  expectedRole: OAuthProviderTokenArtifactRole,
  now?: string,
): OAuthRoleTokenDescriptor {
  const value = exactRecord(raw, ["lifetime", "manifestRevision", "role"] as const);
  if (value.role !== expectedRole || !OAUTH_ROLE_TOKEN_VAULT_ROLES.includes(value.role as typeof OAUTH_ROLE_TOKEN_VAULT_ROLES[number])
    || !safeField(value.manifestRevision, 200)) throw rejected();
  const lifetime = validateLifetime(value.lifetime, now);
  return Object.freeze({
    role: value.role as OAuthProviderTokenArtifactRole,
    lifetime,
    manifestRevision: value.manifestRevision as string,
  });
}

export function validateOAuthRoleTokenDescriptorForContext(
  raw: unknown,
  contextInput: OAuthRoleTokenVaultContext,
  now?: string,
): OAuthRoleTokenDescriptor {
  const context = validateOAuthRoleTokenVaultContext(contextInput);
  const descriptor = validateOAuthRoleTokenDescriptor(raw, context.role, now);
  if (descriptor.manifestRevision !== context.manifestRevision
    || !platformAllowsLifetime(context.platform, context.role, descriptor.lifetime.kind)) throw rejected();
  return descriptor;
}

export function validateOAuthRoleTokenSecret(raw: unknown): string {
  if (typeof raw !== "string" || raw.length < 1 || raw.length > 32_768 || /[\u0000-\u0020\u007f]/u.test(raw)) throw rejected();
  return raw;
}

export function oauthRoleTokenReferenceFor(context: OAuthRoleTokenVaultContext): string {
  const normalized = validateOAuthRoleTokenVaultContext(context);
  const opaqueBinding = createHash("sha256")
    .update(JSON.stringify([normalized.artifactBindingId, normalized.role]), "utf8")
    .digest("hex");
  return `${OAUTH_ROLE_TOKEN_REFERENCE_PREFIX}/${opaqueBinding}`;
}

export function parseOAuthRoleTokenReference(reference: string): string {
  if (typeof reference !== "string") throw rejected();
  const match = new RegExp(`^${escapeRegExp(OAUTH_ROLE_TOKEN_REFERENCE_PREFIX)}/([0-9a-f]{64})$`, "u").exec(reference);
  if (!match) throw rejected();
  return match[1];
}

function validateLifetime(raw: unknown, now?: string): OAuthProviderTokenLifetime {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw rejected();
  const kind = (raw as Record<string, unknown>).kind;
  if (kind === "expires_at") {
    const value = exactRecord(raw, ["expiresAt", "kind", "revalidateAt"] as const);
    const expiresAt = canonicalIso(value.expiresAt);
    const revalidateAt = canonicalIso(value.revalidateAt);
    if (Date.parse(revalidateAt) > Date.parse(expiresAt)) throw rejected();
    validateAgainstNow(expiresAt, revalidateAt, now);
    return Object.freeze({ kind, expiresAt, revalidateAt });
  }
  if (kind === "provider_non_expiring" || kind === "revocation_bound") {
    const value = exactRecord(raw, ["kind", "revalidateAt"] as const);
    const revalidateAt = canonicalIso(value.revalidateAt);
    validateAgainstNow(undefined, revalidateAt, now);
    return Object.freeze({ kind, revalidateAt });
  }
  throw rejected();
}

function validateAgainstNow(expiresAt: string | undefined, revalidateAt: string, now: string | undefined): void {
  if (now === undefined) return;
  const nowMs = Date.parse(canonicalIso(now));
  const revalidateMs = Date.parse(revalidateAt);
  if (revalidateMs <= nowMs || revalidateMs > nowMs + MAX_REVALIDATION_MS
    || (expiresAt !== undefined && Date.parse(expiresAt) <= nowMs)) throw rejected();
}

function exactRecord<const T extends readonly string[]>(raw: unknown, expectedKeys: T): Record<T[number], unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)
    || (Object.getPrototypeOf(raw) !== Object.prototype && Object.getPrototypeOf(raw) !== null)) throw rejected();
  const value = raw as Record<string, unknown>;
  const keys = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) throw rejected();
  return value as Record<T[number], unknown>;
}

function safeField(value: unknown, max = 255): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max && SAFE_VALUE.test(value);
}

function platformMatchesTargetKind(platform: AiMediaOAuthPlatform, targetKind: OAuthProviderTargetKind): boolean {
  return (platform === "tiktok" && targetKind === "tiktok_user")
    || (platform === "youtube_shorts" && targetKind === "youtube_channel")
    || (platform === "facebook" && targetKind === "facebook_page")
    || (platform === "instagram" && targetKind === "instagram_professional_account");
}

function platformAllowsRole(platform: AiMediaOAuthPlatform, role: OAuthProviderTokenArtifactRole): boolean {
  return role === "operational_access" || (role === "refresh" && (platform === "tiktok" || platform === "youtube_shorts"));
}

function platformAllowsLifetime(
  platform: AiMediaOAuthPlatform,
  role: OAuthProviderTokenArtifactRole,
  lifetimeKind: OAuthProviderTokenLifetime["kind"],
): boolean {
  if (lifetimeKind === "expires_at") return true;
  if (lifetimeKind === "provider_non_expiring") {
    return role === "operational_access" && (platform === "facebook" || platform === "instagram");
  }
  return lifetimeKind === "revocation_bound" && platform === "youtube_shorts" && role === "refresh";
}

function canonicalIso(value: unknown): string {
  if (typeof value !== "string") throw rejected();
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) throw rejected();
  return value;
}

function asString(value: unknown): string { return typeof value === "string" ? value : ""; }
function escapeRegExp(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"); }
function rejected(): OAuthRoleTokenVaultError { return new OAuthRoleTokenVaultError(); }
