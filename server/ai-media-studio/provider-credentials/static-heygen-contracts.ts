import { createHash } from "node:crypto";
import type { TenantScope } from "../core/resource-domain";

export const STATIC_HEYGEN_PROVIDER_KEY = "heygen" as const;
export const DEFAULT_STATIC_HEYGEN_SECRET_REF = "env://AI_MEDIA_STUDIO_SECRET_HEYGEN_API_KEY" as const;
export const STATIC_HEYGEN_SECRET_REF = /^env:\/\/AI_MEDIA_STUDIO_SECRET_HEYGEN_API_KEY(?:_[A-Z0-9]{1,32})?$/u;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/u;
const SAFE_ACTOR = /^[A-Za-z0-9][A-Za-z0-9@._:-]{0,254}$/u;

export type StaticHeyGenCredentialLifecycleState = "pending" | "superseded" | "revoked";
export type StaticHeyGenVerificationState = "unverified";

export interface StaticHeyGenCredentialBinding {
  id: string;
  scope: TenantScope;
  actorUserId: string;
  providerAccountId: string;
  providerKey: typeof STATIC_HEYGEN_PROVIDER_KEY;
  expectedCredentialVersion: number;
  credentialVersion: number;
  secretRef: string;
  idempotencyKey: string;
  requestDigest: `sha256:${string}`;
  lifecycleState: StaticHeyGenCredentialLifecycleState;
  verificationState: StaticHeyGenVerificationState;
  createdAt: string;
  updatedAt: string;
  supersededAt: string | null;
}

export interface BindStaticHeyGenCredential {
  bindingId: string;
  scope: TenantScope;
  actorUserId: string;
  providerAccountId: string;
  expectedCredentialVersion: number;
  secretRef: string;
  idempotencyKey: string;
}

export type BindStaticHeyGenCredentialResult = Readonly<{
  outcome: "created" | "replayed";
  binding: StaticHeyGenCredentialBinding;
}>;

export interface StaticHeyGenCredentialRepository {
  bind(input: BindStaticHeyGenCredential): Promise<BindStaticHeyGenCredentialResult | undefined>;
}

export class StaticHeyGenCredentialBindingError extends Error {
  constructor() {
    super("Static HeyGen credential binding is invalid");
    this.name = "StaticHeyGenCredentialBindingError";
  }
}

export function assertStaticHeyGenCredentialInput(input: BindStaticHeyGenCredential): void {
  if (!UUID.test(input.bindingId)
    || !UUID.test(input.providerAccountId)
    || !input.scope.ownerUserId.trim()
    || input.scope.ownerUserId.length > 255
    || !input.scope.workspaceId.trim()
    || input.scope.workspaceId.length > 255
    || !SAFE_ACTOR.test(input.actorUserId)
    || !Number.isSafeInteger(input.expectedCredentialVersion)
    || input.expectedCredentialVersion < 0
    || input.expectedCredentialVersion >= 2_147_483_647
    || !STATIC_HEYGEN_SECRET_REF.test(input.secretRef)
    || !IDEMPOTENCY_KEY.test(input.idempotencyKey)) {
    throw new StaticHeyGenCredentialBindingError();
  }
}

export function deriveStaticHeyGenCredentialRequestDigest(
  input: BindStaticHeyGenCredential,
): `sha256:${string}` {
  assertStaticHeyGenCredentialInput(input);
  const canonical = JSON.stringify([
    "ai-media-static-heygen-credential-binding-v1",
    input.bindingId,
    input.scope.ownerUserId,
    input.scope.workspaceId,
    input.actorUserId,
    input.providerAccountId,
    input.expectedCredentialVersion,
    input.expectedCredentialVersion + 1,
    input.secretRef,
    input.idempotencyKey,
  ]);
  return `sha256:${createHash("sha256").update(canonical, "utf8").digest("hex")}`;
}

