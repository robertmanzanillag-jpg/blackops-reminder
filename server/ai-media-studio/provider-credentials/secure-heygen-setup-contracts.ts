import { createHash } from "node:crypto";
import type { TenantScope } from "../core/resource-domain";
import { DEFAULT_STATIC_HEYGEN_SECRET_REF } from "./static-heygen-contracts";

export const SECURE_HEYGEN_SETUP_SECRET_REF = DEFAULT_STATIC_HEYGEN_SECRET_REF;

export type SecureHeyGenSetupErrorCode = "INVALID_REQUEST" | "AMBIGUOUS" | "CONFLICT" | "UNAVAILABLE";

export type SecureHeyGenSetupInput = Readonly<{
  scope: TenantScope;
  actorUserId: string;
  idempotencyKey: string;
}>;

export type PreparedSecureHeyGenSetup = Readonly<{
  scope: TenantScope;
  actorUserId: string;
  idempotencyKey: string;
  accountIdCandidate: string;
  bindingId: string;
  secretRef: typeof SECURE_HEYGEN_SETUP_SECRET_REF;
}>;

export type SecureHeyGenSetupRecord = Readonly<{
  outcome: "created" | "replayed";
  providerAccountId: string;
  bindingId: string;
  credentialVersion: number;
  verificationState: "unverified" | "verified";
}>;

export interface SecureHeyGenSetupRepository {
  setup(input: PreparedSecureHeyGenSetup): Promise<SecureHeyGenSetupRecord>;
}

export class SecureHeyGenSetupError extends Error {
  readonly statusCode: 400 | 409 | 503;

  constructor(readonly code: SecureHeyGenSetupErrorCode) {
    super("Secure HeyGen setup is unavailable");
    this.name = "SecureHeyGenSetupError";
    this.statusCode = code === "INVALID_REQUEST" ? 400 : code === "UNAVAILABLE" ? 503 : 409;
  }
}

const SAFE_ACTOR = /^[A-Za-z0-9][A-Za-z0-9@._:-]{0,254}$/u;
const SAFE_IDEMPOTENCY = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const INPUT_KEYS = ["actorUserId", "idempotencyKey", "scope"] as const;
const SCOPE_KEYS = ["ownerUserId", "workspaceId"] as const;

function exactKeys(value: object, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  return actual.length === expected.length && actual.every((key, index) => key === [...expected].sort()[index]);
}

function validScopePart(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 255 && value === value.trim()
    && !/[\u0000-\u001f\u007f]/u.test(value);
}

export function assertSecureHeyGenSetupInput(input: unknown): asserts input is SecureHeyGenSetupInput {
  if (!input || typeof input !== "object" || Array.isArray(input) || !exactKeys(input, INPUT_KEYS)) {
    throw new SecureHeyGenSetupError("INVALID_REQUEST");
  }
  const candidate = input as Record<string, unknown>;
  const scope = candidate.scope;
  if (!scope || typeof scope !== "object" || Array.isArray(scope) || !exactKeys(scope, SCOPE_KEYS)) {
    throw new SecureHeyGenSetupError("INVALID_REQUEST");
  }
  const typedScope = scope as Record<string, unknown>;
  if (!validScopePart(typedScope.ownerUserId)
    || !validScopePart(typedScope.workspaceId)
    || typeof candidate.actorUserId !== "string"
    || !SAFE_ACTOR.test(candidate.actorUserId)
    || typeof candidate.idempotencyKey !== "string"
    || !SAFE_IDEMPOTENCY.test(candidate.idempotencyKey)) {
    throw new SecureHeyGenSetupError("INVALID_REQUEST");
  }
}

function uuid(seed: string): string {
  const hex = createHash("sha256").update(seed, "utf8").digest("hex").slice(0, 32).split("");
  hex[12] = "4";
  hex[16] = (8 + (Number.parseInt(hex[16] ?? "0", 16) % 4)).toString(16);
  return `${hex.slice(0, 8).join("")}-${hex.slice(8, 12).join("")}-${hex.slice(12, 16).join("")}-${hex.slice(16, 20).join("")}-${hex.slice(20).join("")}`;
}

export function prepareSecureHeyGenSetup(input: SecureHeyGenSetupInput): PreparedSecureHeyGenSetup {
  assertSecureHeyGenSetupInput(input);
  const tenantSeed = JSON.stringify([input.scope.ownerUserId, input.scope.workspaceId]);
  const accountIdCandidate = uuid(`ai-media-secure-heygen-account-v1\0${tenantSeed}`);
  const bindingId = uuid(`ai-media-secure-heygen-binding-v1\0${tenantSeed}\0${input.idempotencyKey}`);
  return Object.freeze({
    scope: Object.freeze({ ...input.scope }),
    actorUserId: input.actorUserId,
    idempotencyKey: input.idempotencyKey,
    accountIdCandidate,
    bindingId,
    secretRef: SECURE_HEYGEN_SETUP_SECRET_REF,
  });
}

export function assertSecureHeyGenSetupRecord(
  prepared: PreparedSecureHeyGenSetup,
  record: SecureHeyGenSetupRecord,
): void {
  if (!["created", "replayed"].includes(record.outcome)
    || !UUID.test(record.providerAccountId)
    || record.bindingId !== prepared.bindingId
    || !Number.isSafeInteger(record.credentialVersion)
    || record.credentialVersion < 1
    || !["unverified", "verified"].includes(record.verificationState)) {
    throw new SecureHeyGenSetupError("UNAVAILABLE");
  }
}
