import type { TenantScope } from "../core/resource-domain";

export const LAUNCH_AUTHORITY_CAPABILITIES = [
  "policy:revise",
  "kill_switch:revise",
  "content:decide",
  "human_launch:decide",
  "sandbox:attest",
  "quote:attest",
  "snapshot:create",
] as const;

export type LaunchAuthorityCapability = (typeof LAUNCH_AUTHORITY_CAPABILITIES)[number];
export type LaunchAuthorityPrincipalKind = "user" | "workload";

declare const trustedLaunchAuthorityPrincipalBrand: unique symbol;
declare const trustedSandboxAttestationBrand: unique symbol;
declare const trustedMaximumQuoteAttestationBrand: unique symbol;

/**
 * Minted only by a server-owned authenticator. HTTP/body DTOs must never carry
 * this shape and there is intentionally no public constructor for its brand.
 */
export interface TrustedLaunchAuthorityPrincipal {
  readonly subjectId: string;
  readonly kind: LaunchAuthorityPrincipalKind;
  readonly capabilities: readonly LaunchAuthorityCapability[];
  readonly authenticationEvidenceDigest?: `sha256:${string}`;
  readonly [trustedLaunchAuthorityPrincipalBrand]: true;
}

/** Opaque input understood only by the injected server authentication adapter. */
export type LaunchAuthorityAuthenticationContext = unknown;

export interface LaunchAuthorityPrincipalAuthenticator {
  authenticate(input: Readonly<{
    context: LaunchAuthorityAuthenticationContext;
    scope: TenantScope;
    requiredCapability: LaunchAuthorityCapability;
  }>): Promise<TrustedLaunchAuthorityPrincipal | undefined>;
}

/**
 * A sandbox adapter may attest a result, but cannot select the tenant, slot,
 * provider account, governance subject, timestamps, revision, or digest.
 */
export interface TrustedSandboxAttestation {
  readonly attestationId: string;
  readonly decision: "passed" | "failed" | "revoked";
  readonly sourceEvidenceDigest: `sha256:${string}`;
  readonly [trustedSandboxAttestationBrand]: true;
}

/**
 * A quote adapter is the only input boundary allowed to carry provider-priced
 * micro-USD. Browser/human commands never accept money.
 */
export interface TrustedMaximumQuoteAttestation {
  readonly attestationId: string;
  readonly decision: "quoted" | "declined" | "revoked";
  readonly maximumQuoteMicroUsd: string;
  readonly currency: "USD";
  readonly sourceEvidenceDigest: `sha256:${string}`;
  readonly [trustedMaximumQuoteAttestationBrand]: true;
}

declare const trustedLaunchSubjectBrand: unique symbol;

/**
 * Resolved from server-owned plan/slot/account/script/governance state. It is a
 * repository dependency, never an HTTP or service command field.
 */
export interface TrustedLaunchSubject {
  readonly scope: TenantScope;
  readonly dailyPlanId: string;
  readonly dailyPlanSlotId: string;
  readonly slotAttempt: number;
  readonly planDigest: `sha256:${string}`;
  readonly slotDigest: `sha256:${string}`;
  readonly providerAccountId: string;
  readonly providerKey: string;
  readonly providerCredentialVersion: number;
  readonly scriptVariantId: string;
  readonly scriptVariantChecksum: string;
  readonly governanceProfileId: string;
  readonly governanceEvidenceDigest: `sha256:${string}`;
  readonly governanceUse: string;
  readonly governanceTerritory: string;
  readonly contentCountry: string;
  readonly launchSubjectDigest: `sha256:${string}`;
  readonly [trustedLaunchSubjectBrand]: true;
}

export interface LaunchSubjectResolver {
  resolve(input: Readonly<{
    scope: TenantScope;
    dailyPlanSlotId: string;
    slotAttempt: number;
  }>): Promise<TrustedLaunchSubject | undefined>;
}

/** DB time owns valid-from; this policy contributes only bounded durations. */
export interface LaunchAuthorityValidityPolicy {
  ttlSeconds(input: Readonly<{
    kind: "content_approval" | "human_launch_approval" | "sandbox_proof" | "maximum_quote" | "authority_snapshot";
    scope: TenantScope;
  }>): number;
}

export type LaunchAuthorityPolicyState = "active" | "disabled";
export type LaunchAuthorityApprovalDecision = "approved" | "rejected" | "revoked";

export interface ReviseLaunchAdmissionPolicyCommand {
  scope: TenantScope;
  state: LaunchAuthorityPolicyState;
  dailyBudgetMicroUsd: string;
  totalConcurrency: number;
  providerConcurrency: number;
  tenantConcurrency: number;
  allowedLanguages: readonly string[];
  allowedCountries: readonly string[];
  allowedTimeZones: readonly string[];
  idempotencyKey: string;
}

export interface ReviseLaunchKillSwitchCommand {
  scope: TenantScope;
  active: boolean;
  reason: string;
  idempotencyKey: string;
}

export interface RecordContentApprovalCommand {
  scope: TenantScope;
  dailyPlanSlotId: string;
  slotAttempt: number;
  decision: LaunchAuthorityApprovalDecision;
  idempotencyKey: string;
}

export interface RecordHumanLaunchApprovalCommand {
  scope: TenantScope;
  dailyPlanSlotId: string;
  slotAttempt: number;
  decision: LaunchAuthorityApprovalDecision;
  idempotencyKey: string;
}

export interface RecordSandboxAttestationCommand {
  scope: TenantScope;
  dailyPlanSlotId: string;
  slotAttempt: number;
  attestation: TrustedSandboxAttestation;
  idempotencyKey: string;
}

export interface RecordMaximumQuoteAttestationCommand {
  scope: TenantScope;
  dailyPlanSlotId: string;
  slotAttempt: number;
  attestation: TrustedMaximumQuoteAttestation;
  idempotencyKey: string;
}

export interface CreateLaunchAuthoritySnapshotCommand {
  scope: TenantScope;
  dailyPlanSlotId: string;
  slotAttempt: number;
  idempotencyKey: string;
}

export interface LaunchAuthorityReceipt {
  id: string;
  kind: "policy" | "kill_switch" | "content_approval" | "human_launch_approval"
    | "sandbox_proof" | "maximum_quote" | "authority_snapshot";
  inputDigest: `sha256:${string}`;
  replayed: boolean;
}

export interface LaunchAuthoritySnapshotReceipt extends LaunchAuthorityReceipt {
  kind: "authority_snapshot";
  authorityDigest: `sha256:${string}`;
  admissionDigest: `sha256:${string}`;
}

export type AuthorizedLaunchAuthorityWrite<TCommand> = Readonly<{
  command: Readonly<TCommand>;
  principal: TrustedLaunchAuthorityPrincipal;
  inputDigest: `sha256:${string}`;
}>;

/**
 * Persistence owns all database-derived rows and facts: current revisions,
 * previous links, actor/source projection, DB time, subject/provider/governance
 * binding, evidence digests and snapshot composition.
 */
export interface LaunchAuthorityRepository {
  revisePolicy(input: AuthorizedLaunchAuthorityWrite<ReviseLaunchAdmissionPolicyCommand>): Promise<LaunchAuthorityReceipt>;
  reviseKillSwitch(input: AuthorizedLaunchAuthorityWrite<ReviseLaunchKillSwitchCommand>): Promise<LaunchAuthorityReceipt>;
  recordContentApproval(input: AuthorizedLaunchAuthorityWrite<RecordContentApprovalCommand>): Promise<LaunchAuthorityReceipt>;
  recordHumanLaunchApproval(input: AuthorizedLaunchAuthorityWrite<RecordHumanLaunchApprovalCommand>): Promise<LaunchAuthorityReceipt>;
  recordSandboxAttestation(input: AuthorizedLaunchAuthorityWrite<RecordSandboxAttestationCommand>): Promise<LaunchAuthorityReceipt>;
  recordMaximumQuoteAttestation(input: AuthorizedLaunchAuthorityWrite<RecordMaximumQuoteAttestationCommand>): Promise<LaunchAuthorityReceipt>;
  createAuthoritySnapshot(input: AuthorizedLaunchAuthorityWrite<CreateLaunchAuthoritySnapshotCommand>): Promise<LaunchAuthoritySnapshotReceipt>;
}

export type LaunchAuthorityServiceErrorCode = "UNAUTHENTICATED" | "FORBIDDEN" | "INVALID_REQUEST" | "UNAVAILABLE";

/** Generic messages avoid leaking tenant, provider, evidence, or policy state. */
export class LaunchAuthorityServiceError extends Error {
  constructor(readonly code: LaunchAuthorityServiceErrorCode) {
    super(code === "UNAVAILABLE" ? "Launch authority service is unavailable" : "Launch authority request denied");
    this.name = "LaunchAuthorityServiceError";
  }
}
