import { createHash, randomBytes } from "node:crypto";
import type { TenantScope } from "../core/resource-domain";
import type {
  LaunchRuntimeAttestationVerifier,
  TrustedLaunchAuthorityPrincipal,
  TrustedLaunchSubject,
  VerifiedLaunchRuntimeAttestation,
  VerifiedMaximumQuoteAttestation,
  VerifiedSandboxAttestation,
  VerifyLaunchRuntimeAttestationInput,
} from "./launch-authority-contracts";

type Digest = `sha256:${string}`;
type RuntimeKind = VerifiedLaunchRuntimeAttestation["kind"];

export interface RuntimeAttestationBinding {
  readonly scope: TenantScope;
  readonly principal: TrustedLaunchAuthorityPrincipal;
  readonly subject: TrustedLaunchSubject;
  readonly idempotencyKey: string;
  readonly validFrom: Date;
  readonly expiresAt: Date;
}

export interface MintSandboxAttestationInput extends RuntimeAttestationBinding {
  readonly attestationId: string;
  readonly decision: VerifiedSandboxAttestation["decision"];
  readonly sourceEvidenceDigest: Digest;
}

export interface MintMaximumQuoteAttestationInput extends RuntimeAttestationBinding {
  readonly attestationId: string;
  readonly decision: VerifiedMaximumQuoteAttestation["decision"];
  readonly maximumQuoteMicroUsd: string;
  readonly quoteExpiresAt: Date;
  readonly sourceEvidenceDigest: Digest;
}

export interface ProcessLocalSandboxAttestationIssuer {
  mint(input: Readonly<MintSandboxAttestationInput>): string;
}

export interface ProcessLocalMaximumQuoteAttestationIssuer {
  mint(input: Readonly<MintMaximumQuoteAttestationInput>): string;
}

export interface ProcessLocalLaunchRuntimeAttestationFacets {
  readonly sandboxIssuer: ProcessLocalSandboxAttestationIssuer;
  readonly quoteIssuer: ProcessLocalMaximumQuoteAttestationIssuer;
  readonly verifier: LaunchRuntimeAttestationVerifier;
}

type FrozenEnvelope = Readonly<{
  kind: RuntimeKind;
  scopeDigest: Digest;
  principalDigest: Digest;
  subjectDigest: Digest;
  idempotencyKey: string;
  validFromMs: number;
  expiresAtMs: number;
  attestation: VerifiedLaunchRuntimeAttestation;
}>;

const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{7,199}$/u;
const MONEY = /^(?:0|[1-9][0-9]*)$/u;
const MAX_MICRO_USD = 9_000_000_000_000_000n;
const MAX_LIFETIME_MS = 86_400_000;

/**
 * Server-only, process-local reference implementation. It intentionally has no
 * network, environment, secret, persistence, route, or public-barrel wiring.
 * Losing the process loses every handle, making this suitable for tests and
 * local composition only, not production runtime attestation.
 */
class ProcessLocalLaunchRuntimeAttestationRegistry implements LaunchRuntimeAttestationVerifier {
  readonly #registry = new Map<string, FrozenEnvelope>();

  mintSandboxAttestation(input: Readonly<MintSandboxAttestationInput>): string {
    assertExactKeys(input, ["scope", "principal", "subject", "idempotencyKey", "validFrom", "expiresAt",
      "attestationId", "decision", "sourceEvidenceDigest"]);
    if (!(input.decision === "passed" || input.decision === "failed" || input.decision === "revoked")) {
      throw new TypeError("Invalid runtime attestation");
    }
    const attestation = Object.freeze({
      kind: "sandbox_proof" as const,
      attestationId: safeId(input.attestationId),
      decision: input.decision,
      sourceEvidenceDigest: sourceDigest(input.sourceEvidenceDigest),
    }) as VerifiedSandboxAttestation;
    return this.#mint("sandbox_proof", input, attestation);
  }

  mintMaximumQuoteAttestation(input: Readonly<MintMaximumQuoteAttestationInput>): string {
    assertExactKeys(input, ["scope", "principal", "subject", "idempotencyKey", "validFrom", "expiresAt",
      "attestationId", "decision", "maximumQuoteMicroUsd", "quoteExpiresAt", "sourceEvidenceDigest"]);
    if (!(input.decision === "quoted" || input.decision === "declined" || input.decision === "revoked")) {
      throw new TypeError("Invalid runtime attestation");
    }
    const amount = microUsd(input.maximumQuoteMicroUsd);
    if (!validDatabaseTime(input.quoteExpiresAt) || input.quoteExpiresAt <= input.validFrom) {
      throw new TypeError("Invalid runtime attestation");
    }
    const attestation = Object.freeze({
      kind: "maximum_quote" as const,
      attestationId: safeId(input.attestationId),
      decision: input.decision,
      maximumQuoteMicroUsd: amount,
      currency: "USD" as const,
      quoteExpiresAt: input.quoteExpiresAt.toISOString(),
      sourceEvidenceDigest: sourceDigest(input.sourceEvidenceDigest),
    }) as VerifiedMaximumQuoteAttestation;
    return this.#mint("maximum_quote", input, attestation);
  }

  async verify(input: Readonly<VerifyLaunchRuntimeAttestationInput>): Promise<VerifiedLaunchRuntimeAttestation | undefined> {
    // The command contributes no attestation shape: only an unguessable scalar
    // lookup key. Every trusted value is recovered from the private registry.
    if (!input || typeof input !== "object" || typeof input.attestationHandle !== "string") return undefined;
    const envelope = this.#registry.get(input.attestationHandle);
    if (!envelope || envelope.kind !== input.kind || !validDatabaseTime(input.databaseNow)) return undefined;
    const now = input.databaseNow.getTime();
    if (now < envelope.validFromMs || now >= envelope.expiresAtMs) return undefined;
    if (input.idempotencyKey !== envelope.idempotencyKey
      || fingerprint(input.scope) !== envelope.scopeDigest
      || fingerprintPrincipal(input.principal) !== envelope.principalDigest
      || fingerprintSubject(input.subject) !== envelope.subjectDigest) return undefined;
    return envelope.attestation;
  }

  #mint(
    kind: RuntimeKind,
    binding: Readonly<RuntimeAttestationBinding>,
    attestation: VerifiedLaunchRuntimeAttestation,
  ): string {
    validateBinding(binding);
    const envelope = Object.freeze({
      kind,
      scopeDigest: fingerprint(binding.scope),
      principalDigest: fingerprintPrincipal(binding.principal),
      subjectDigest: fingerprintSubject(binding.subject),
      idempotencyKey: safeId(binding.idempotencyKey),
      validFromMs: binding.validFrom.getTime(),
      expiresAtMs: binding.expiresAt.getTime(),
      attestation,
    });
    let handle: string;
    do { handle = `lar_${randomBytes(32).toString("base64url")}`; } while (this.#registry.has(handle));
    this.#registry.set(handle, envelope);
    return handle;
  }
}

/**
 * Produces separate frozen least-privilege facets. Persistence receives only
 * `verifier`; a sandbox adapter cannot mint quotes and a quote adapter cannot
 * mint sandbox results.
 */
export function createProcessLocalLaunchRuntimeAttestationFacets(): Readonly<ProcessLocalLaunchRuntimeAttestationFacets> {
  const registry = new ProcessLocalLaunchRuntimeAttestationRegistry();
  const sandboxIssuer = Object.freeze<ProcessLocalSandboxAttestationIssuer>({
    mint: (input) => registry.mintSandboxAttestation(input),
  });
  const quoteIssuer = Object.freeze<ProcessLocalMaximumQuoteAttestationIssuer>({
    mint: (input) => registry.mintMaximumQuoteAttestation(input),
  });
  const verifier = Object.freeze<LaunchRuntimeAttestationVerifier>({
    verify: (input) => registry.verify(input),
  });
  return Object.freeze({ sandboxIssuer, quoteIssuer, verifier });
}

function validateBinding(input: Readonly<RuntimeAttestationBinding>): void {
  safeId(input.idempotencyKey);
  if (!validDatabaseTime(input.validFrom) || !validDatabaseTime(input.expiresAt)) throw new TypeError("Invalid runtime attestation");
  const lifetime = input.expiresAt.getTime() - input.validFrom.getTime();
  if (lifetime <= 0 || lifetime > MAX_LIFETIME_MS) throw new TypeError("Invalid runtime attestation");
  fingerprint(input.scope);
  fingerprintPrincipal(input.principal);
  fingerprintSubject(input.subject);
}

function validDatabaseTime(value: unknown): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function safeId(value: unknown): string {
  if (typeof value !== "string" || !SAFE_ID.test(value)) throw new TypeError("Invalid runtime attestation");
  return value;
}

function sourceDigest(value: unknown): Digest {
  if (typeof value !== "string" || !SHA256.test(value)) throw new TypeError("Invalid runtime attestation");
  return value as Digest;
}

function microUsd(value: unknown): string {
  if (typeof value !== "string" || !MONEY.test(value)) throw new TypeError("Invalid runtime attestation");
  const amount = BigInt(value);
  if (amount <= 0n || amount > MAX_MICRO_USD) throw new TypeError("Invalid runtime attestation");
  return amount.toString();
}

function fingerprintPrincipal(value: TrustedLaunchAuthorityPrincipal): Digest {
  return fingerprint(value);
}

function fingerprintSubject(value: TrustedLaunchSubject): Digest {
  return fingerprint(value);
}

function fingerprint(value: unknown): Digest {
  const canonical = canonicalJson(value);
  return `sha256:${createHash("sha256").update(canonical).digest("hex")}`;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new TypeError("Invalid runtime attestation");
    return String(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (!value || typeof value !== "object") throw new TypeError("Invalid runtime attestation");
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).filter((key) => typeof record[key] !== "undefined").sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

function assertExactKeys(value: unknown, keys: readonly string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype
    || Object.keys(value).length !== keys.length || Object.keys(value).some((key) => !keys.includes(key))) {
    throw new TypeError("Invalid runtime attestation");
  }
}
