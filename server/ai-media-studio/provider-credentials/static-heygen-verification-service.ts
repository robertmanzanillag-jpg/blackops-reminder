import {
  StaticHeyGenVerificationError,
  assertPreparedStaticHeyGenVerification,
  assertStaticHeyGenVerificationCommand,
  deterministicUuid,
  sha256,
  type PreparedStaticHeyGenResourceVerification,
  type PreparedStaticHeyGenVerificationRecord,
  type Sha256Digest,
  type StaticHeyGenVerificationCommand,
  type StaticHeyGenVerificationReceipt,
  type StaticHeyGenVerificationRepository,
} from "./static-heygen-verification-contracts";

function resourceInputDigest(value: unknown): Sha256Digest {
  return sha256(["ai-media-static-heygen-resource-verification-input-v1", value]);
}

function resourceEvidenceDigest(value: unknown): Sha256Digest {
  return sha256(["ai-media-static-heygen-resource-verification-evidence-v1", value]);
}

function compareResources(
  left: PreparedStaticHeyGenResourceVerification,
  right: PreparedStaticHeyGenResourceVerification,
): number {
  return left.resourceType === right.resourceType
    ? left.providerResourceExternalIdDigest.localeCompare(right.providerResourceExternalIdDigest)
    : left.resourceType.localeCompare(right.resourceType);
}

export function prepareStaticHeyGenPassedVerification(
  command: StaticHeyGenVerificationCommand,
): PreparedStaticHeyGenVerificationRecord {
  assertStaticHeyGenVerificationCommand(command);
  const observedAt = new Date(command.providerOutcome.observedAt).toISOString();
  const expiresAt = new Date(command.policyExpiresAt).toISOString();
  const accountFacts = {
    accountEvidenceDigest: command.providerOutcome.accountEvidenceDigest,
    billingModel: command.providerOutcome.billingModel,
    observedAt,
    expiresAt,
  };
  const resources: PreparedStaticHeyGenResourceVerification[] = [
    ...command.providerOutcome.avatars.map((avatar) => {
      const providerResourceExternalIdDigest = avatar.lookIdDigest;
      const avatarEnginesDigest = sha256([...avatar.supportedEngines].sort());
      const resourceResponseDigest = sha256({
        avatarLookIdDigest: avatar.lookIdDigest,
        avatarGroupIdDigest: avatar.groupIdDigest,
        lookStatus: avatar.lookStatus,
        groupStatus: avatar.groupStatus,
        groupConsentStatus: avatar.groupConsentStatus,
        supportedEngines: [...avatar.supportedEngines].sort(),
        evidenceDigest: avatar.evidenceDigest,
      });
      const inputDigest = resourceInputDigest({
        resourceType: "avatar",
        providerResourceExternalIdDigest,
        avatarGroupIdDigest: avatar.groupIdDigest,
        avatarEnginesDigest,
        resourceResponseDigest,
      });
      const evidenceDigest = resourceEvidenceDigest({
        verificationId: command.verificationId,
        providerAccountId: command.providerAccountId,
        providerCredentialVersion: command.providerCredentialVersion,
        inputDigest,
      });
      return {
        id: deterministicUuid(`static-heygen-resource-evidence\0${command.verificationId}\0avatar\0${providerResourceExternalIdDigest}`),
        resourceType: "avatar" as const,
        providerExternalId: avatar.avatarLookId,
        providerResourceExternalIdDigest,
        avatarLookIdDigest: providerResourceExternalIdDigest,
        avatarLookStatus: "completed" as const,
        avatarGroupIdDigest: avatar.groupIdDigest,
        avatarGroupStatus: "completed" as const,
        avatarGroupConsentStatus: "approved" as const,
        avatarEnginesDigest,
        voiceIdDigest: null,
        language: null,
        voiceSupportDigest: null,
        resourceResponseDigest,
        evidenceDigest,
        inputDigest,
        idempotencyKey: `${command.idempotencyKey}:avatar:${providerResourceExternalIdDigest.slice("sha256:".length, 40)}`,
      };
    }),
    ...command.providerOutcome.voices.map((voice) => {
      const providerResourceExternalIdDigest = voice.voiceIdDigest;
      const voiceSupportDigest = sha256({
        supportPause: voice.supportPause === true,
        supportLocale: voice.supportLocale === true,
        supportInteractiveAvatar: voice.supportInteractiveAvatar === true,
      });
      const resourceResponseDigest = sha256({
        voiceIdDigest: voice.voiceIdDigest,
        language: voice.language,
        gender: voice.gender ?? null,
        voiceSupportDigest,
        evidenceDigest: voice.evidenceDigest,
      });
      const inputDigest = resourceInputDigest({
        resourceType: "voice",
        providerResourceExternalIdDigest,
        language: voice.language,
        voiceSupportDigest,
        resourceResponseDigest,
      });
      const evidenceDigest = resourceEvidenceDigest({
        verificationId: command.verificationId,
        providerAccountId: command.providerAccountId,
        providerCredentialVersion: command.providerCredentialVersion,
        inputDigest,
      });
      return {
        id: deterministicUuid(`static-heygen-resource-evidence\0${command.verificationId}\0voice\0${providerResourceExternalIdDigest}`),
        resourceType: "voice" as const,
        providerExternalId: voice.voiceId,
        providerResourceExternalIdDigest,
        avatarLookIdDigest: null,
        avatarLookStatus: null,
        avatarGroupIdDigest: null,
        avatarGroupStatus: null,
        avatarGroupConsentStatus: null,
        avatarEnginesDigest: null,
        voiceIdDigest: providerResourceExternalIdDigest,
        language: voice.language,
        voiceSupportDigest,
        resourceResponseDigest,
        evidenceDigest,
        inputDigest,
        idempotencyKey: `${command.idempotencyKey}:voice:${providerResourceExternalIdDigest.slice("sha256:".length, 40)}`,
      };
    }),
  ].sort(compareResources);

  const verificationRequestDigest = command.providerOutcome.requestDigest;
  const inputDigest = sha256([
    "ai-media-static-heygen-verification-input-v1",
    verificationRequestDigest,
    command.credentialBindingRequestDigest,
    accountFacts,
    resources.map((resource) => resource.inputDigest),
  ]);
  const evidenceDigest = sha256([
    "ai-media-static-heygen-verification-evidence-v1",
    command.verificationId,
    verificationRequestDigest,
    command.credentialBindingRequestDigest,
    command.providerOutcome.accountEvidenceDigest,
    resources.map((resource) => resource.evidenceDigest),
  ]);
  const record: PreparedStaticHeyGenVerificationRecord = {
    verificationId: command.verificationId,
    scope: { ownerUserId: command.scope.ownerUserId, workspaceId: command.scope.workspaceId },
    actorUserId: command.actorUserId,
    providerAccountId: command.providerAccountId,
    staticCredentialBindingId: command.staticCredentialBindingId,
    providerCredentialVersion: command.providerCredentialVersion,
    credentialBindingRequestDigest: command.credentialBindingRequestDigest,
    dailyPlanId: command.dailyPlanId,
    sourceRosterKey: command.sourceRosterKey,
    sourceRosterDigest: command.sourceRosterDigest,
    planDigest: command.planDigest,
    verificationState: "verified",
    accountEvidenceDigest: command.providerOutcome.accountEvidenceDigest,
    billingModel: command.providerOutcome.billingModel,
    verificationRequestDigest,
    evidenceDigest,
    inputDigest,
    idempotencyKey: command.idempotencyKey,
    observedAt,
    expiresAt,
    resources,
  };
  assertPreparedStaticHeyGenVerification(record);
  return Object.freeze({ ...record, resources: Object.freeze([...resources]) });
}

export class StaticHeyGenVerificationService {
  constructor(private readonly repository: StaticHeyGenVerificationRepository) {}

  async recordPassed(command: StaticHeyGenVerificationCommand): Promise<StaticHeyGenVerificationReceipt> {
    const prepared = prepareStaticHeyGenPassedVerification(command);
    const receipt = await this.repository.recordPassed(prepared);
    if (!receipt) throw new StaticHeyGenVerificationError("STALE");
    return Object.freeze(receipt);
  }
}
