import { createHash } from "node:crypto";
import type { TenantScope } from "../core/resource-domain";
import {
  LAUNCH_AUTHORITY_CAPABILITIES,
  LaunchAuthorityServiceError,
  type AuthorizedLaunchAuthorityWrite,
  type CreateLaunchAuthoritySnapshotCommand,
  type DeclareLaunchIntentCommand,
  type LaunchAuthorityApprovalDecision,
  type LaunchAuthorityAuthenticationContext,
  type LaunchAuthorityCapability,
  type LaunchAuthorityPrincipalAuthenticator,
  type LaunchAuthorityReceipt,
  type LaunchAuthorityRepository,
  type LaunchAuthoritySnapshotReceipt,
  type RecordContentApprovalCommand,
  type RecordHumanLaunchApprovalCommand,
  type RecordMaximumQuoteAttestationCommand,
  type RecordSandboxAttestationCommand,
  type ReviseLaunchAdmissionPolicyCommand,
  type ReviseLaunchKillSwitchCommand,
  type TrustedLaunchAuthorityPrincipal,
} from "./launch-authority-contracts";

export const LAUNCH_AUTHORITY_OPERATIONS = [
  "revise_policy",
  "revise_kill_switch",
  "record_content_approval",
  "record_human_launch_approval",
  "declare_launch_intent",
  "record_sandbox_attestation",
  "record_maximum_quote_attestation",
  "create_authority_snapshot",
] as const;

export type LaunchAuthorityOperation = (typeof LAUNCH_AUTHORITY_OPERATIONS)[number];

const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const LANGUAGE = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,3}$/u;
const COUNTRY = /^[A-Z]{2}$/u;
const MONEY = /^(?:0|[1-9][0-9]*)$/u;
const MAX_MICRO_USD = 9_000_000_000_000_000n;
const CAPABILITIES = new Set<string>(LAUNCH_AUTHORITY_CAPABILITIES);

export type LaunchAuthorityCommand = ReviseLaunchAdmissionPolicyCommand | ReviseLaunchKillSwitchCommand
  | RecordContentApprovalCommand | RecordHumanLaunchApprovalCommand
  | DeclareLaunchIntentCommand
  | RecordSandboxAttestationCommand | RecordMaximumQuoteAttestationCommand
  | CreateLaunchAuthoritySnapshotCommand;

type MethodPolicy = Readonly<{
  capability: LaunchAuthorityCapability;
  principalKinds: readonly ("user" | "workload")[];
  receiptKind: LaunchAuthorityReceipt["kind"];
}>;

const METHOD_POLICY: Readonly<Record<LaunchAuthorityOperation, MethodPolicy>> = Object.freeze({
  revise_policy: { capability: "policy:revise", principalKinds: ["user"], receiptKind: "policy" },
  revise_kill_switch: { capability: "kill_switch:revise", principalKinds: ["user"], receiptKind: "kill_switch" },
  record_content_approval: { capability: "content:decide", principalKinds: ["user", "workload"], receiptKind: "content_approval" },
  record_human_launch_approval: { capability: "human_launch:decide", principalKinds: ["user"], receiptKind: "human_launch_approval" },
  declare_launch_intent: { capability: "launch_intent:declare", principalKinds: ["user"], receiptKind: "launch_intent" },
  record_sandbox_attestation: { capability: "sandbox:attest", principalKinds: ["workload"], receiptKind: "sandbox_proof" },
  record_maximum_quote_attestation: { capability: "quote:attest", principalKinds: ["workload"], receiptKind: "maximum_quote" },
  create_authority_snapshot: { capability: "snapshot:create", principalKinds: ["workload"], receiptKind: "authority_snapshot" },
});

/**
 * Domain-separated canonical digest shared with persistence. Authentication
 * context and capability arrays are intentionally excluded; the authenticated
 * subject and optional authentication evidence remain bound.
 */
export function launchAuthorityInputDigest(
  operation: LaunchAuthorityOperation,
  command: LaunchAuthorityCommand,
  principal: TrustedLaunchAuthorityPrincipal,
): `sha256:${string}` {
  if (!LAUNCH_AUTHORITY_OPERATIONS.includes(operation)) throw denied("INVALID_REQUEST");
  const canonical = canonicalJson({
    domain: "ai-media-launch-authority-input-v1",
    operation,
    principal: {
      kind: principal.kind,
      subjectId: principal.subjectId,
      ...(principal.authenticationEvidenceDigest
        ? { authenticationEvidenceDigest: principal.authenticationEvidenceDigest }
        : {}),
    },
    command,
  });
  return `sha256:${createHash("sha256").update(canonical).digest("hex")}`;
}

export class LaunchAuthorityService {
  constructor(private readonly dependencies: Readonly<{
    repository: LaunchAuthorityRepository;
    authenticator: LaunchAuthorityPrincipalAuthenticator;
  }>) {
    if (!dependencies?.repository || !dependencies?.authenticator) throw denied("UNAVAILABLE");
  }

  revisePolicy(context: LaunchAuthorityAuthenticationContext, command: ReviseLaunchAdmissionPolicyCommand) {
    const normalized = normalizePolicy(command);
    return this.execute("revise_policy", context, normalized,
      (input) => this.dependencies.repository.revisePolicy(input));
  }

  reviseKillSwitch(context: LaunchAuthorityAuthenticationContext, command: ReviseLaunchKillSwitchCommand) {
    const normalized = normalizeKillSwitch(command);
    return this.execute("revise_kill_switch", context, normalized,
      (input) => this.dependencies.repository.reviseKillSwitch(input));
  }

  recordContentApproval(context: LaunchAuthorityAuthenticationContext, command: RecordContentApprovalCommand) {
    const normalized = normalizeApproval(command);
    return this.execute("record_content_approval", context, normalized,
      (input) => this.dependencies.repository.recordContentApproval(input));
  }

  recordHumanLaunchApproval(context: LaunchAuthorityAuthenticationContext, command: RecordHumanLaunchApprovalCommand) {
    const normalized = normalizeApproval(command);
    return this.execute("record_human_launch_approval", context, normalized,
      (input) => this.dependencies.repository.recordHumanLaunchApproval(input));
  }

  declareLaunchIntent(context: LaunchAuthorityAuthenticationContext, command: DeclareLaunchIntentCommand) {
    const normalized = normalizeLaunchIntent(command);
    return this.execute("declare_launch_intent", context, normalized,
      (input) => this.dependencies.repository.declareLaunchIntent(input));
  }

  recordSandboxAttestation(context: LaunchAuthorityAuthenticationContext, command: RecordSandboxAttestationCommand) {
    const normalized = normalizeSandbox(command);
    return this.execute("record_sandbox_attestation", context, normalized,
      (input) => this.dependencies.repository.recordSandboxAttestation(input));
  }

  recordMaximumQuoteAttestation(context: LaunchAuthorityAuthenticationContext, command: RecordMaximumQuoteAttestationCommand) {
    const normalized = normalizeQuote(command);
    return this.execute("record_maximum_quote_attestation", context, normalized,
      (input) => this.dependencies.repository.recordMaximumQuoteAttestation(input));
  }

  createAuthoritySnapshot(context: LaunchAuthorityAuthenticationContext, command: CreateLaunchAuthoritySnapshotCommand) {
    const normalized = normalizeSnapshot(command);
    return this.execute("create_authority_snapshot", context, normalized,
      (input) => this.dependencies.repository.createAuthoritySnapshot(input));
  }

  private async execute<TCommand extends LaunchAuthorityCommand, TReceipt extends LaunchAuthorityReceipt>(
    operation: LaunchAuthorityOperation,
    context: LaunchAuthorityAuthenticationContext,
    command: TCommand,
    write: (input: AuthorizedLaunchAuthorityWrite<TCommand>) => Promise<TReceipt>,
  ): Promise<TReceipt> {
    const policy = METHOD_POLICY[operation];
    let principal: TrustedLaunchAuthorityPrincipal | undefined;
    try {
      principal = await this.dependencies.authenticator.authenticate({
        context, scope: command.scope, requiredCapability: policy.capability,
      });
    } catch {
      throw denied("UNAVAILABLE");
    }
    if (!principal) throw denied("UNAUTHENTICATED");
    assertPrincipal(principal);
    if (!policy.principalKinds.includes(principal.kind) || !principal.capabilities.includes(policy.capability)) {
      throw denied("FORBIDDEN");
    }

    const inputDigest = launchAuthorityInputDigest(operation, command, principal);
    try {
      const receipt = await write({ command, principal, inputDigest });
      if (!receipt || receipt.kind !== policy.receiptKind || receipt.inputDigest !== inputDigest
        || !UUID.test(receipt.id) || !SHA256.test(receipt.inputDigest)) throw denied("UNAVAILABLE");
      if (receipt.kind === "authority_snapshot") {
        const snapshot = receipt as unknown as LaunchAuthoritySnapshotReceipt;
        if (!SHA256.test(snapshot.authorityDigest) || !SHA256.test(snapshot.admissionDigest)) throw denied("UNAVAILABLE");
      }
      return receipt;
    } catch (error) {
      if (error instanceof LaunchAuthorityServiceError) throw error;
      throw denied("UNAVAILABLE");
    }
  }
}

function normalizePolicy(input: ReviseLaunchAdmissionPolicyCommand): ReviseLaunchAdmissionPolicyCommand {
  assertExactKeys(input, ["scope", "state", "dailyBudgetMicroUsd", "totalConcurrency", "providerConcurrency",
    "tenantConcurrency", "allowedLanguages", "allowedCountries", "allowedTimeZones", "idempotencyKey"]);
  const scope = normalizeScope(input.scope);
  if (input.state !== "active" && input.state !== "disabled") throw denied("INVALID_REQUEST");
  const budget = money(input.dailyBudgetMicroUsd, true);
  const total = boundedInteger(input.totalConcurrency, 0, 100_000);
  const provider = boundedInteger(input.providerConcurrency, 0, total);
  const tenant = boundedInteger(input.tenantConcurrency, 0, total);
  if (input.state === "active" && (budget === "0" || total === 0 || provider === 0 || tenant === 0)) {
    throw denied("INVALID_REQUEST");
  }
  return Object.freeze({
    scope, state: input.state, dailyBudgetMicroUsd: budget, totalConcurrency: total,
    providerConcurrency: provider, tenantConcurrency: tenant,
    allowedLanguages: Object.freeze(normalizedList(input.allowedLanguages, "language")),
    allowedCountries: Object.freeze(normalizedList(input.allowedCountries, "country")),
    allowedTimeZones: Object.freeze(normalizedList(input.allowedTimeZones, "timeZone")),
    idempotencyKey: idempotency(input.idempotencyKey),
  });
}

function normalizeKillSwitch(input: ReviseLaunchKillSwitchCommand): ReviseLaunchKillSwitchCommand {
  assertExactKeys(input, ["scope", "active", "reason", "idempotencyKey"]);
  if (typeof input.active !== "boolean") throw denied("INVALID_REQUEST");
  const reason = boundedText(input.reason, 1, 500);
  return Object.freeze({ scope: normalizeScope(input.scope), active: input.active, reason, idempotencyKey: idempotency(input.idempotencyKey) });
}

function normalizeApproval<T extends RecordContentApprovalCommand | RecordHumanLaunchApprovalCommand>(input: T): T {
  assertExactKeys(input, ["scope", "dailyPlanSlotId", "slotAttempt", "decision", "idempotencyKey"]);
  const decision: LaunchAuthorityApprovalDecision = input.decision;
  if (!(["approved", "rejected", "revoked"] as const).includes(decision)) throw denied("INVALID_REQUEST");
  return Object.freeze({ ...normalizeSlotCommand(input), decision }) as T;
}

function normalizeLaunchIntent(input: DeclareLaunchIntentCommand): DeclareLaunchIntentCommand {
  assertExactKeys(input, ["scope", "dailyPlanSlotId", "slotAttempt", "governanceUse", "governanceTerritory",
    "contentCountry", "idempotencyKey"]);
  const slot = normalizeSlotCommand(input);
  const governanceUse = boundedText(input.governanceUse, 1, 80);
  const governanceTerritory = boundedText(input.governanceTerritory, 1, 80);
  const contentCountry = boundedText(input.contentCountry, 2, 2);
  if (!COUNTRY.test(contentCountry)) throw denied("INVALID_REQUEST");
  return Object.freeze({ ...slot, governanceUse, governanceTerritory, contentCountry });
}

function normalizeSandbox(input: RecordSandboxAttestationCommand): RecordSandboxAttestationCommand {
  assertExactKeys(input, ["scope", "dailyPlanSlotId", "slotAttempt", "attestationHandle", "idempotencyKey"]);
  return Object.freeze({ ...normalizeSlotCommand(input), attestationHandle: attestationHandle(input.attestationHandle) });
}

function normalizeQuote(input: RecordMaximumQuoteAttestationCommand): RecordMaximumQuoteAttestationCommand {
  assertExactKeys(input, ["scope", "dailyPlanSlotId", "slotAttempt", "attestationHandle", "idempotencyKey"]);
  return Object.freeze({ ...normalizeSlotCommand(input), attestationHandle: attestationHandle(input.attestationHandle) });
}

function normalizeSnapshot(input: CreateLaunchAuthoritySnapshotCommand): CreateLaunchAuthoritySnapshotCommand {
  assertExactKeys(input, ["scope", "dailyPlanSlotId", "slotAttempt", "idempotencyKey"]);
  return normalizeSlotCommand(input);
}

function normalizeSlotCommand<T extends CreateLaunchAuthoritySnapshotCommand>(input: T): T {
  const scope = normalizeScope(input.scope);
  const dailyPlanSlotId = uuid(input.dailyPlanSlotId, "dailyPlanSlotId");
  const slotAttempt = boundedInteger(input.slotAttempt, 1, 1_000_000);
  const idempotencyKey = idempotency(input.idempotencyKey);
  return Object.freeze({ scope, dailyPlanSlotId, slotAttempt, idempotencyKey }) as T;
}

function assertPrincipal(principal: TrustedLaunchAuthorityPrincipal): void {
  assertExactKeys(principal, ["subjectId", "kind", "capabilities", "authenticationEvidenceDigest"], true);
  boundedText(principal.subjectId, 1, 200);
  if (principal.kind !== "user" && principal.kind !== "workload") throw denied("FORBIDDEN");
  if (!Array.isArray(principal.capabilities) || principal.capabilities.length === 0
    || new Set(principal.capabilities).size !== principal.capabilities.length
    || principal.capabilities.some((capability) => !CAPABILITIES.has(capability))) throw denied("FORBIDDEN");
  if (principal.authenticationEvidenceDigest !== undefined) digest(principal.authenticationEvidenceDigest);
}

function normalizeScope(scope: TenantScope): TenantScope {
  assertExactKeys(scope, ["ownerUserId", "workspaceId"]);
  return Object.freeze({
    ownerUserId: boundedText(scope.ownerUserId, 1, 256),
    workspaceId: boundedText(scope.workspaceId, 1, 256),
  });
}

function normalizedList(input: readonly string[], kind: "language" | "country" | "timeZone"): string[] {
  if (!Array.isArray(input) || input.length > 250) throw denied("INVALID_REQUEST");
  const values = input.map((value) => boundedText(value, 1, 80));
  if (new Set(values).size !== values.length) throw denied("INVALID_REQUEST");
  for (const value of values) {
    if (kind === "language" && !LANGUAGE.test(value)) throw denied("INVALID_REQUEST");
    if (kind === "country" && !COUNTRY.test(value)) throw denied("INVALID_REQUEST");
    if (kind === "timeZone") {
      try { new Intl.DateTimeFormat("en-US", { timeZone: value }); } catch { throw denied("INVALID_REQUEST"); }
    }
  }
  return values.sort((left, right) => left.localeCompare(right));
}

function money(input: unknown, allowZero: boolean): string {
  if (typeof input !== "string" || !MONEY.test(input)) throw denied("INVALID_REQUEST");
  const parsed = BigInt(input);
  if ((!allowZero && parsed === 0n) || parsed > MAX_MICRO_USD) throw denied("INVALID_REQUEST");
  return parsed.toString();
}

function boundedInteger(input: unknown, minimum: number, maximum: number): number {
  if (typeof input !== "number" || !Number.isSafeInteger(input) || input < minimum || input > maximum) throw denied("INVALID_REQUEST");
  return input;
}

function boundedText(input: unknown, minimum: number, maximum: number): string {
  if (typeof input !== "string" || input.trim() !== input || input.length < minimum || input.length > maximum || /[\u0000-\u001f\u007f]/u.test(input)) {
    throw denied("INVALID_REQUEST");
  }
  return input;
}

function uuid(input: unknown, _field: string): string {
  if (typeof input !== "string" || !UUID.test(input)) throw denied("INVALID_REQUEST");
  return input;
}

function opaqueId(input: unknown, _field: string): string {
  if (typeof input !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$/u.test(input)) throw denied("INVALID_REQUEST");
  return input;
}

function idempotency(input: unknown): string {
  return opaqueId(input, "idempotencyKey");
}

function attestationHandle(input: unknown): string {
  if (typeof input !== "string" || input.length < 32 || input.length > 200
    || !/^[A-Za-z0-9_-]+$/u.test(input)) throw denied("INVALID_REQUEST");
  return input;
}

function digest(input: unknown): `sha256:${string}` {
  if (typeof input !== "string" || !SHA256.test(input)) throw denied("INVALID_REQUEST");
  return input as `sha256:${string}`;
}

function assertExactKeys(value: unknown, allowed: readonly string[], optional = false): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw denied("INVALID_REQUEST");
  const keys = Object.keys(value);
  if (keys.some((key) => !allowed.includes(key)) || (!optional && allowed.some((key) => !keys.includes(key)))) throw denied("INVALID_REQUEST");
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw denied("INVALID_REQUEST");
    return String(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  throw denied("INVALID_REQUEST");
}

function denied(code: ConstructorParameters<typeof LaunchAuthorityServiceError>[0]): LaunchAuthorityServiceError {
  return new LaunchAuthorityServiceError(code);
}
