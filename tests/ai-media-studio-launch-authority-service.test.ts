import assert from "node:assert/strict";
import test from "node:test";
import type { TenantScope } from "../server/ai-media-studio/core/resource-domain";
import {
  LaunchAuthorityServiceError,
  type AuthorizedLaunchAuthorityWrite,
  type CreateLaunchAuthoritySnapshotCommand,
  type DeclareLaunchIntentCommand,
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
} from "../server/ai-media-studio/planning/launch-authority-contracts";
import {
  LAUNCH_AUTHORITY_OPERATIONS,
  LaunchAuthorityService,
  launchAuthorityInputDigest,
} from "../server/ai-media-studio/planning/launch-authority-service";

const scope = Object.freeze({ ownerUserId: "owner-1", workspaceId: "workspace-1" }) satisfies TenantScope;
const slotId = "22222222-2222-4222-8222-222222222222";
const receiptId = "99999999-9999-4999-8999-999999999999";
const authEvidenceDigest = `sha256:${"e".repeat(64)}` as const;

function principal(
  capability: LaunchAuthorityCapability,
  kind: "user" | "workload",
  overrides: Partial<TrustedLaunchAuthorityPrincipal> = {},
): TrustedLaunchAuthorityPrincipal {
  return {
    subjectId: kind === "user" ? "owner-1" : `workload:${capability}`,
    kind,
    capabilities: [capability],
    authenticationEvidenceDigest: authEvidenceDigest,
    ...overrides,
  } as TrustedLaunchAuthorityPrincipal;
}

const sandboxAttestationHandle = `lar_${"s".repeat(43)}`;
const quoteAttestationHandle = `lar_${"q".repeat(43)}`;

const policyCommand: ReviseLaunchAdmissionPolicyCommand = {
  scope,
  state: "active",
  dailyBudgetMicroUsd: "50000000",
  totalConcurrency: 10,
  providerConcurrency: 5,
  tenantConcurrency: 3,
  allowedLanguages: ["es-US", "en-US"],
  allowedCountries: ["US", "DO"],
  allowedTimeZones: ["UTC", "America/New_York"],
  idempotencyKey: "policy-revision-0001",
};

const killCommand: ReviseLaunchKillSwitchCommand = {
  scope, active: false, reason: "Launch remains explicitly gated", idempotencyKey: "kill-switch-revision-0001",
};

const contentCommand: RecordContentApprovalCommand = {
  scope, dailyPlanSlotId: slotId, slotAttempt: 1, decision: "approved", idempotencyKey: "content-approval-0001",
};

const humanCommand: RecordHumanLaunchApprovalCommand = {
  scope, dailyPlanSlotId: slotId, slotAttempt: 1, decision: "approved", idempotencyKey: "human-launch-approval-0001",
};

const launchIntentCommand: DeclareLaunchIntentCommand = {
  scope,
  dailyPlanSlotId: slotId,
  slotAttempt: 1,
  governanceUse: "commercial_social_video",
  governanceTerritory: "US",
  contentCountry: "US",
  idempotencyKey: "launch-intent-0001",
};

const sandboxCommand: RecordSandboxAttestationCommand = {
  scope, dailyPlanSlotId: slotId, slotAttempt: 1, attestationHandle: sandboxAttestationHandle, idempotencyKey: "sandbox-attestation-0001",
};

const quoteCommand: RecordMaximumQuoteAttestationCommand = {
  scope, dailyPlanSlotId: slotId, slotAttempt: 1, attestationHandle: quoteAttestationHandle, idempotencyKey: "quote-attestation-0001",
};

const snapshotCommand: CreateLaunchAuthoritySnapshotCommand = {
  scope, dailyPlanSlotId: slotId, slotAttempt: 1, idempotencyKey: "authority-snapshot-0001",
};

type Captured = { method: keyof LaunchAuthorityRepository; input: AuthorizedLaunchAuthorityWrite<any> };

function repository(captured: Captured[], receiptOverride?: Partial<LaunchAuthorityReceipt>): LaunchAuthorityRepository {
  const receipt = (method: keyof LaunchAuthorityRepository, kind: LaunchAuthorityReceipt["kind"], input: AuthorizedLaunchAuthorityWrite<any>) => {
    captured.push({ method, input });
    return Promise.resolve({ id: receiptId, kind, inputDigest: input.inputDigest, replayed: false, ...receiptOverride } as LaunchAuthorityReceipt);
  };
  return {
    revisePolicy: (input) => receipt("revisePolicy", "policy", input),
    reviseKillSwitch: (input) => receipt("reviseKillSwitch", "kill_switch", input),
    recordContentApproval: (input) => receipt("recordContentApproval", "content_approval", input),
    recordHumanLaunchApproval: (input) => receipt("recordHumanLaunchApproval", "human_launch_approval", input),
    declareLaunchIntent: (input) => receipt("declareLaunchIntent", "launch_intent", input),
    recordSandboxAttestation: (input) => receipt("recordSandboxAttestation", "sandbox_proof", input),
    recordMaximumQuoteAttestation: (input) => receipt("recordMaximumQuoteAttestation", "maximum_quote", input),
    createAuthoritySnapshot: async (input) => {
      captured.push({ method: "createAuthoritySnapshot", input });
      return {
        id: receiptId,
        kind: "authority_snapshot",
        inputDigest: input.inputDigest,
        replayed: false,
        authorityDigest: `sha256:${"a".repeat(64)}`,
        admissionDigest: `sha256:${"b".repeat(64)}`,
        ...receiptOverride,
      } as LaunchAuthoritySnapshotReceipt;
    },
  };
}

function authenticator(resolve: LaunchAuthorityPrincipalAuthenticator["authenticate"]): LaunchAuthorityPrincipalAuthenticator {
  return { authenticate: resolve };
}

test("separate authority methods enforce the exact capability and principal-kind matrix", async () => {
  const cases = [
    { capability: "policy:revise", kind: "user", method: "revisePolicy", command: policyCommand },
    { capability: "kill_switch:revise", kind: "user", method: "reviseKillSwitch", command: killCommand },
    { capability: "content:decide", kind: "user", method: "recordContentApproval", command: contentCommand },
    { capability: "human_launch:decide", kind: "user", method: "recordHumanLaunchApproval", command: humanCommand },
    { capability: "launch_intent:declare", kind: "user", method: "declareLaunchIntent", command: launchIntentCommand },
    { capability: "sandbox:attest", kind: "workload", method: "recordSandboxAttestation", command: sandboxCommand },
    { capability: "quote:attest", kind: "workload", method: "recordMaximumQuoteAttestation", command: quoteCommand },
    { capability: "snapshot:create", kind: "workload", method: "createAuthoritySnapshot", command: snapshotCommand },
  ] as const;

  assert.equal(cases.length, LAUNCH_AUTHORITY_OPERATIONS.length);
  for (const item of cases) {
    const captured: Captured[] = [];
    const seen: Array<{ requiredCapability: LaunchAuthorityCapability; scope: TenantScope; context: unknown }> = [];
    const service = new LaunchAuthorityService({
      repository: repository(captured),
      authenticator: authenticator(async (input) => {
        seen.push(input);
        return principal(item.capability, item.kind);
      }),
    });
    await (service[item.method] as any)({ serverCredential: item.capability }, item.command);
    assert.equal(captured.length, 1);
    assert.equal(captured[0].method, item.method === "createAuthoritySnapshot" ? "createAuthoritySnapshot" : item.method);
    assert.equal(seen[0].requiredCapability, item.capability);
    assert.deepEqual(seen[0].scope, scope);
    assert.equal(captured[0].input.principal.subjectId, principal(item.capability, item.kind).subjectId);
    assert.match(captured[0].input.inputDigest, /^sha256:[0-9a-f]{64}$/u);
  }
});

test("missing capability, wrong principal kind, missing identity, and authenticator failure deny before persistence", async () => {
  const scenarios: Array<{
    expected: LaunchAuthorityServiceError["code"];
    resolved?: TrustedLaunchAuthorityPrincipal;
    throws?: boolean;
  }> = [
    { expected: "UNAUTHENTICATED" },
    { expected: "FORBIDDEN", resolved: principal("quote:attest", "user") },
    { expected: "FORBIDDEN", resolved: principal("sandbox:attest", "workload") },
    { expected: "UNAVAILABLE", throws: true },
  ];
  for (const scenario of scenarios) {
    const captured: Captured[] = [];
    const service = new LaunchAuthorityService({
      repository: repository(captured),
      authenticator: authenticator(async () => {
        if (scenario.throws) throw new Error("identity-provider-secret-detail");
        return scenario.resolved;
      }),
    });
    await assert.rejects(
      service.recordMaximumQuoteAttestation({}, quoteCommand),
      (error: unknown) => error instanceof LaunchAuthorityServiceError
        && error.code === scenario.expected
        && !error.message.includes("secret"),
    );
    assert.equal(captured.length, 0);
  }
});

test("human and content inputs reject all caller self-certification fields", async () => {
  const forbidden = [
    "actorUserId", "sourceKind", "validFrom", "expiresAt", "createdAt", "evidenceDigest", "inputDigest",
    "providerAccountId", "providerKey", "providerCredentialVersion", "governanceProfileId", "governanceUse",
    "governanceTerritory", "contentCountry", "revision", "previousEvidenceId", "amountMicroUsd", "currency",
    "policyDigest", "killSwitchActive", "sandboxPassed", "authorityDigest", "admissionDigest",
  ];
  for (const field of forbidden) {
    let authCalls = 0;
    const service = new LaunchAuthorityService({
      repository: repository([]),
      authenticator: authenticator(async () => {
        authCalls += 1;
        return principal("human_launch:decide", "user");
      }),
    });
    assert.throws(
      () => service.recordHumanLaunchApproval({}, { ...humanCommand, [field]: field === "amountMicroUsd" ? "1" : "spoofed" } as any),
      (error: unknown) => error instanceof LaunchAuthorityServiceError && error.code === "INVALID_REQUEST",
    );
    assert.equal(authCalls, 0, `${field} must be rejected before authentication/persistence`);
  }
  assert.deepEqual(Object.keys(humanCommand).sort(), ["dailyPlanSlotId", "decision", "idempotencyKey", "scope", "slotAttempt"]);
  assert.deepEqual(Object.keys(contentCommand).sort(), ["dailyPlanSlotId", "decision", "idempotencyKey", "scope", "slotAttempt"]);
});

test("launch intent is human-only and exposes only governance selections over a server-resolved slot", async () => {
  const captured: Captured[] = [];
  const userService = new LaunchAuthorityService({
    repository: repository(captured),
    authenticator: authenticator(async () => principal("launch_intent:declare", "user")),
  });
  await userService.declareLaunchIntent({}, launchIntentCommand);
  assert.deepEqual(Object.keys(captured[0].input.command).sort(), [
    "contentCountry", "dailyPlanSlotId", "governanceTerritory", "governanceUse", "idempotencyKey", "scope", "slotAttempt",
  ]);
  for (const forbidden of ["providerAccountId", "scriptVariantId", "sourceRosterKey", "sourceMemberKey",
    "launchIntentId", "launchIntentDigest", "launchSubjectDigest", "validFrom", "createdAt"]) {
    assert.throws(() => userService.declareLaunchIntent({}, { ...launchIntentCommand, [forbidden]: "spoofed" } as any),
      (error: unknown) => error instanceof LaunchAuthorityServiceError && error.code === "INVALID_REQUEST");
  }
  for (const field of ["governanceUse", "governanceTerritory"] as const) {
    assert.throws(() => userService.declareLaunchIntent({}, { ...launchIntentCommand, [field]: "x".repeat(81) }),
      (error: unknown) => error instanceof LaunchAuthorityServiceError && error.code === "INVALID_REQUEST");
  }
  const workloadService = new LaunchAuthorityService({
    repository: repository([]),
    authenticator: authenticator(async () => principal("launch_intent:declare", "workload")),
  });
  await assert.rejects(workloadService.declareLaunchIntent({}, launchIntentCommand),
    (error: unknown) => error instanceof LaunchAuthorityServiceError && error.code === "FORBIDDEN");
});

test("runtime evidence commands accept only bounded opaque attestation handles", async () => {
  const captured: Captured[] = [];
  const service = new LaunchAuthorityService({
    repository: repository(captured),
    authenticator: authenticator(async ({ requiredCapability }) => principal(requiredCapability, "workload")),
  });
  await service.recordSandboxAttestation({}, sandboxCommand);
  await service.recordMaximumQuoteAttestation({}, quoteCommand);
  assert.deepEqual(Object.keys(captured[0].input.command).sort(), [
    "attestationHandle", "dailyPlanSlotId", "idempotencyKey", "scope", "slotAttempt",
  ]);
  assert.deepEqual(Object.keys(captured[1].input.command).sort(), [
    "attestationHandle", "dailyPlanSlotId", "idempotencyKey", "scope", "slotAttempt",
  ]);

  for (const invalid of ["short", "contains spaces".repeat(4), `x${"a".repeat(200)}`]) {
    assert.throws(
      () => service.recordMaximumQuoteAttestation({}, {
        ...quoteCommand,
        attestationHandle: invalid,
      }),
      (error: unknown) => error instanceof LaunchAuthorityServiceError && error.code === "INVALID_REQUEST",
    );
  }
});

test("canonical input digests are stable, principal-bound, and repository receipts must echo them", async () => {
  const actor = principal("policy:revise", "user");
  const reordered: ReviseLaunchAdmissionPolicyCommand = {
    idempotencyKey: policyCommand.idempotencyKey,
    allowedTimeZones: ["America/New_York", "UTC"],
    allowedCountries: ["DO", "US"],
    allowedLanguages: ["en-US", "es-US"],
    tenantConcurrency: 3,
    providerConcurrency: 5,
    totalConcurrency: 10,
    dailyBudgetMicroUsd: "50000000",
    state: "active",
    scope: { workspaceId: "workspace-1", ownerUserId: "owner-1" },
  };
  const captured: Captured[] = [];
  const service = new LaunchAuthorityService({
    repository: repository(captured), authenticator: authenticator(async () => actor),
  });
  await service.revisePolicy({}, policyCommand);
  await service.revisePolicy({}, reordered);
  assert.equal(captured[0].input.inputDigest, captured[1].input.inputDigest);
  assert.equal(captured[0].input.inputDigest,
    launchAuthorityInputDigest("revise_policy", captured[0].input.command, actor));
  assert.notEqual(
    captured[0].input.inputDigest,
    launchAuthorityInputDigest("revise_policy", captured[0].input.command,
      principal("policy:revise", "user", { subjectId: "different-owner" })),
  );

  const mismatched = new LaunchAuthorityService({
    repository: repository([], { inputDigest: `sha256:${"0".repeat(64)}` }),
    authenticator: authenticator(async () => actor),
  });
  await assert.rejects(
    mismatched.revisePolicy({}, policyCommand),
    (error: unknown) => error instanceof LaunchAuthorityServiceError && error.code === "UNAVAILABLE",
  );
});

test("service surface has no generic issue-evidence or activation method", () => {
  const methods = Object.getOwnPropertyNames(LaunchAuthorityService.prototype).filter((name) => name !== "constructor").sort();
  assert.deepEqual(methods, [
    "createAuthoritySnapshot",
    "declareLaunchIntent",
    "execute",
    "recordContentApproval",
    "recordHumanLaunchApproval",
    "recordMaximumQuoteAttestation",
    "recordSandboxAttestation",
    "reviseKillSwitch",
    "revisePolicy",
  ]);
  assert.doesNotMatch(methods.join(" "), /issue|generic|provider|job|outbox|spend|activate/iu);
});
