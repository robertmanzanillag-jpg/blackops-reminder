import { sql, type SQL } from "drizzle-orm";
import {
  aiMediaDailyPlans,
  aiMediaDailyPlanSlots,
  aiMediaProviderAccounts,
  aiMediaProviderResources,
  aiMediaStaticCredentialBindings,
  aiMediaStaticHeyGenResourceVerifications,
  aiMediaStaticHeyGenVerificationHeaders,
} from "../../../shared/models/ai-media-studio-db";
import {
  StaticHeyGenVerificationError,
  assertPreparedStaticHeyGenVerification,
  opaqueEvidenceKey,
  opaqueVerificationKey,
  sha256,
  type PreparedStaticHeyGenResourceVerification,
  type PreparedStaticHeyGenVerificationRecord,
  type StaticHeyGenVerificationReceipt,
  type StaticHeyGenVerificationRepository,
} from "./static-heygen-verification-contracts";

type ExecuteResult = { rows?: unknown[] } | unknown[];
type Row = Record<string, unknown>;
type Database = { execute(query: SQL): Promise<ExecuteResult> };
export type StaticHeyGenVerificationDatabase = Database & {
  transaction<T>(callback: (tx: Database) => Promise<T>, config?: Readonly<{
    isolationLevel?: "serializable"; accessMode?: "read write";
  }>): Promise<T>;
};

const rows = (result: ExecuteResult): Row[] => (Array.isArray(result) ? result : result.rows ?? []) as Row[];
const value = (row: Row, camel: string, snake: string): unknown => row[camel] ?? row[snake];
const text = (row: Row, camel: string, snake: string): string => String(value(row, camel, snake) ?? "");
const number = (row: Row, camel: string, snake: string): number => Number(value(row, camel, snake));
const iso = (input: unknown): string => {
  const date = input instanceof Date ? input : new Date(String(input));
  if (!Number.isFinite(date.getTime())) throw new StaticHeyGenVerificationError("UNAVAILABLE");
  return date.toISOString();
};

function receipt(
  outcome: StaticHeyGenVerificationReceipt["outcome"],
  input: Pick<PreparedStaticHeyGenVerificationRecord,
    "verificationId" | "evidenceDigest" | "providerCredentialVersion" | "observedAt" | "expiresAt" | "resources">,
): StaticHeyGenVerificationReceipt {
  return Object.freeze({
    outcome,
    verification: {
      verificationKey: opaqueVerificationKey(input.verificationId),
      evidenceKey: opaqueEvidenceKey(input.evidenceDigest),
      providerKey: "heygen" as const,
      providerCredentialVersion: input.providerCredentialVersion,
      verifiedAt: input.observedAt,
      expiresAt: input.expiresAt,
      avatarCount: input.resources.filter((resource) => resource.resourceType === "avatar").length,
      voiceCount: input.resources.filter((resource) => resource.resourceType === "voice").length,
    },
  });
}

function resourceKey(kind: string, externalId: string): string {
  return `${kind}\0${externalId}`;
}

function assertDatabaseClock(input: PreparedStaticHeyGenVerificationRecord, databaseNow: Date): void {
  const observedAt = new Date(input.observedAt);
  const expiresAt = new Date(input.expiresAt);
  if (observedAt.getTime() > databaseNow.getTime()
    || expiresAt.getTime() <= databaseNow.getTime()
    || expiresAt.getTime() <= observedAt.getTime()
    || expiresAt.getTime() - observedAt.getTime() > 24 * 60 * 60 * 1_000) {
    throw new StaticHeyGenVerificationError("STALE");
  }
}

export class DrizzleStaticHeyGenVerificationRepository implements StaticHeyGenVerificationRepository {
  constructor(private readonly db: StaticHeyGenVerificationDatabase) {}

  async recordPassed(input: PreparedStaticHeyGenVerificationRecord): Promise<StaticHeyGenVerificationReceipt | undefined> {
    assertPreparedStaticHeyGenVerification(input);
    try {
      return await this.db.transaction((tx) => this.recordTransaction(tx, input), {
        isolationLevel: "serializable",
        accessMode: "read write",
      });
    } catch (error) {
      if (error instanceof StaticHeyGenVerificationError) throw error;
      throw new StaticHeyGenVerificationError("UNAVAILABLE");
    }
  }

  private async recordTransaction(
    tx: Database,
    input: PreparedStaticHeyGenVerificationRecord,
  ): Promise<StaticHeyGenVerificationReceipt | undefined> {
    const clock = rows(await tx.execute(sql`SELECT transaction_timestamp() AS observed_at`));
    if (clock.length !== 1) throw new StaticHeyGenVerificationError("UNAVAILABLE");
    assertDatabaseClock(input, new Date(iso(value(clock[0]!, "observedAt", "observed_at"))));

    const replay = rows(await tx.execute(sql`
      SELECT id,evidence_digest,input_digest,provider_credential_version,observed_at,expires_at
      FROM ${aiMediaStaticHeyGenVerificationHeaders}
      WHERE owner_user_id=${input.scope.ownerUserId} AND workspace_id=${input.scope.workspaceId}
        AND provider_account_id=${input.providerAccountId}
        AND (id=${input.verificationId} OR idempotency_key=${input.idempotencyKey})
      FOR UPDATE
    `))[0];
    if (replay) {
      if (text(replay, "id", "id") !== input.verificationId
        || text(replay, "evidenceDigest", "evidence_digest") !== input.evidenceDigest
        || text(replay, "inputDigest", "input_digest") !== input.inputDigest
        || number(replay, "providerCredentialVersion", "provider_credential_version") !== input.providerCredentialVersion) {
        throw new StaticHeyGenVerificationError("MISMATCH");
      }
      if (iso(value(replay, "observedAt", "observed_at")) !== input.observedAt
        || iso(value(replay, "expiresAt", "expires_at")) !== input.expiresAt) {
        throw new StaticHeyGenVerificationError("MISMATCH");
      }
      return receipt("replayed", input);
    }

    const context = rows(await tx.execute(sql`
      SELECT accounts.id AS account_id,accounts.status AS account_status,accounts.credential_status,
        accounts.credential_source,accounts.credential_version,
        bindings.id AS binding_id,bindings.target_credential_version,bindings.request_digest,
        bindings.lifecycle_state,bindings.verification_state AS binding_verification_state,
        plans.id AS daily_plan_id,plans.source_roster_key,plans.source_roster_digest,plans.plan_digest,
        plans.provider_credential_version,plans.status AS plan_status,plans.planned_slot_count
      FROM ${aiMediaProviderAccounts} accounts
      INNER JOIN ${aiMediaStaticCredentialBindings} bindings
        ON bindings.owner_user_id=accounts.owner_user_id AND bindings.workspace_id=accounts.workspace_id
        AND bindings.provider_account_id=accounts.id AND bindings.provider_key=accounts.provider_key
      INNER JOIN ${aiMediaDailyPlans} plans
        ON plans.owner_user_id=accounts.owner_user_id AND plans.workspace_id=accounts.workspace_id
        AND plans.provider_account_id=accounts.id AND plans.provider_key=accounts.provider_key
      WHERE accounts.id=${input.providerAccountId} AND accounts.owner_user_id=${input.scope.ownerUserId}
        AND accounts.workspace_id=${input.scope.workspaceId} AND accounts.provider_key='heygen'
        AND bindings.id=${input.staticCredentialBindingId}
        AND bindings.target_credential_version=${input.providerCredentialVersion}
        AND bindings.request_digest=${input.credentialBindingRequestDigest}
        AND plans.id=${input.dailyPlanId}
        AND plans.source_roster_key=${input.sourceRosterKey}
        AND plans.source_roster_digest=${input.sourceRosterDigest}
        AND plans.plan_digest=${input.planDigest}
        AND plans.provider_credential_version=${input.providerCredentialVersion}
      FOR UPDATE
    `));
    if (context.length !== 1) return undefined;
    const bound = context[0]!;
    if (text(bound, "accountStatus", "account_status") !== "disconnected"
      || text(bound, "credentialStatus", "credential_status") !== "unverified"
      || text(bound, "credentialSource", "credential_source") !== "static_api_key"
      || number(bound, "credentialVersion", "credential_version") !== input.providerCredentialVersion
      || text(bound, "lifecycleState", "lifecycle_state") !== "pending"
      || text(bound, "bindingVerificationState", "binding_verification_state") !== "unverified"
      || text(bound, "planStatus", "plan_status") !== "blocked"
      || number(bound, "plannedSlotCount", "planned_slot_count") < 50
      || number(bound, "plannedSlotCount", "planned_slot_count") > 100) {
      return undefined;
    }

    const slotSummary = rows(await tx.execute(sql`
      WITH exact_slots AS (
        SELECT avatar_resource_id,voice_resource_id,video_number,status
        FROM ${aiMediaDailyPlanSlots}
        WHERE owner_user_id=${input.scope.ownerUserId} AND workspace_id=${input.scope.workspaceId}
          AND daily_plan_id=${input.dailyPlanId} AND provider_account_id=${input.providerAccountId}
          AND provider_key='heygen' AND provider_credential_version=${input.providerCredentialVersion}
        LIMIT 101
      ), per_avatar AS (
        SELECT avatar_resource_id,count(*)::integer AS slot_count,
          count(DISTINCT video_number)::integer AS video_count,
          min(video_number)::integer AS min_video,max(video_number)::integer AS max_video
        FROM exact_slots GROUP BY avatar_resource_id
      )
      SELECT count(*)::integer AS total_slots,
        count(DISTINCT avatar_resource_id)::integer AS avatar_count,
        count(DISTINCT voice_resource_id)::integer AS voice_count,
        count(DISTINCT (avatar_resource_id,video_number))::integer AS avatar_video_pairs,
        bool_and(status='blocked') AS all_blocked,
        bool_and(video_number BETWEEN 1 AND 10) AS video_numbers_bounded,
        COALESCE((SELECT bool_and(slot_count=10 AND video_count=10 AND min_video=1 AND max_video=10)
          FROM per_avatar), false) AS every_avatar_has_ten
      FROM exact_slots
    `));
    if (slotSummary.length !== 1) throw new StaticHeyGenVerificationError("UNAVAILABLE");
    const summary = slotSummary[0]!;
    const totalSlots = number(summary, "totalSlots", "total_slots");
    const avatarCount = number(summary, "avatarCount", "avatar_count");
    if (totalSlots !== number(bound, "plannedSlotCount", "planned_slot_count")
      || totalSlots < 50
      || totalSlots > 100
      || avatarCount < 5
      || avatarCount > 10
      || number(summary, "avatarVideoPairs", "avatar_video_pairs") !== totalSlots
      || value(summary, "allBlocked", "all_blocked") !== true
      || value(summary, "videoNumbersBounded", "video_numbers_bounded") !== true
      || value(summary, "everyAvatarHasTen", "every_avatar_has_ten") !== true) {
      throw new StaticHeyGenVerificationError("MISMATCH");
    }

    const planResources = rows(await tx.execute(sql`
      SELECT resources.id,resources.resource_type,resources.external_resource_id,resources.status,
        resources.verified_credential_version,resources.verification_header_id
      FROM ${aiMediaProviderResources} resources
      WHERE resources.owner_user_id=${input.scope.ownerUserId} AND resources.workspace_id=${input.scope.workspaceId}
        AND resources.provider_account_id=${input.providerAccountId} AND resources.provider_key='heygen'
        AND resources.id IN (
          SELECT avatar_resource_id FROM ${aiMediaDailyPlanSlots}
          WHERE owner_user_id=${input.scope.ownerUserId} AND workspace_id=${input.scope.workspaceId}
            AND daily_plan_id=${input.dailyPlanId} AND provider_account_id=${input.providerAccountId}
            AND provider_key='heygen' AND provider_credential_version=${input.providerCredentialVersion}
          UNION
          SELECT voice_resource_id FROM ${aiMediaDailyPlanSlots}
          WHERE owner_user_id=${input.scope.ownerUserId} AND workspace_id=${input.scope.workspaceId}
            AND daily_plan_id=${input.dailyPlanId} AND provider_account_id=${input.providerAccountId}
            AND provider_key='heygen' AND provider_credential_version=${input.providerCredentialVersion}
        )
      ORDER BY resources.resource_type,resources.external_resource_id
      FOR UPDATE
    `));
    const byExternal = new Map(planResources.map((row) => [resourceKey(text(row, "resourceType", "resource_type"), text(row, "externalResourceId", "external_resource_id")), row]));
    const avatarRows = planResources.filter((row) => text(row, "resourceType", "resource_type") === "avatar");
    const voiceRows = planResources.filter((row) => text(row, "resourceType", "resource_type") === "voice");
    if (avatarRows.length < 5 || avatarRows.length > 10 || voiceRows.length < 1 || planResources.length !== input.resources.length) {
      throw new StaticHeyGenVerificationError("MISMATCH");
    }

    const resources = input.resources.map((resource) => {
      const row = byExternal.get(resourceKey(resource.resourceType, resource.providerExternalId));
      if (!row
        || text(row, "status", "status") !== "pending_verification"
        || value(row, "verificationHeaderId", "verification_header_id") != null
        || (value(row, "verifiedCredentialVersion", "verified_credential_version") != null
          && number(row, "verifiedCredentialVersion", "verified_credential_version") !== input.providerCredentialVersion)
        || sha256(text(row, "externalResourceId", "external_resource_id")) !== resource.providerResourceExternalIdDigest) {
        throw new StaticHeyGenVerificationError("MISMATCH");
      }
      return Object.freeze({ ...resource, providerResourceId: text(row, "id", "id") });
    });
    if (new Set(resources.map((resource) => resource.providerResourceId)).size !== resources.length) {
      throw new StaticHeyGenVerificationError("MISMATCH");
    }

    const insertedHeader = rows(await tx.execute(sql`
      INSERT INTO ${aiMediaStaticHeyGenVerificationHeaders} (
        id,owner_user_id,workspace_id,actor_user_id,provider_account_id,provider_key,
        static_credential_binding_id,provider_credential_version,credential_binding_request_digest,
        daily_plan_id,source_roster_key,source_roster_digest,plan_digest,verification_state,
        account_evidence_digest,billing_model,verification_request_digest,evidence_digest,input_digest,
        idempotency_key,observed_at,expires_at,created_at
      ) VALUES (${input.verificationId},${input.scope.ownerUserId},${input.scope.workspaceId},${input.actorUserId},
        ${input.providerAccountId},'heygen',${input.staticCredentialBindingId},${input.providerCredentialVersion},
        ${input.credentialBindingRequestDigest},${input.dailyPlanId},${input.sourceRosterKey},${input.sourceRosterDigest},
        ${input.planDigest},'verified',${input.accountEvidenceDigest},${input.billingModel},
        ${input.verificationRequestDigest},${input.evidenceDigest},${input.inputDigest},${input.idempotencyKey},
        ${input.observedAt}::timestamptz,${input.expiresAt}::timestamptz,transaction_timestamp())
      RETURNING id
    `));
    if (insertedHeader.length !== 1) throw new StaticHeyGenVerificationError("UNAVAILABLE");

    for (const resource of resources) {
      await this.insertResourceEvidence(tx, input, resource as PreparedStaticHeyGenResourceVerification & { providerResourceId: string });
      const updated = rows(await tx.execute(sql`
        UPDATE ${aiMediaProviderResources}
        SET status='active',synchronized_at=${input.observedAt}::timestamptz,
          verification_header_id=${input.verificationId},verification_resource_evidence_id=${resource.id},
          verification_evidence_digest=${resource.evidenceDigest},verified_credential_version=${input.providerCredentialVersion},
          verified_at=${input.observedAt}::timestamptz,verification_expires_at=${input.expiresAt}::timestamptz,
          updated_at=transaction_timestamp()
        WHERE owner_user_id=${input.scope.ownerUserId} AND workspace_id=${input.scope.workspaceId}
          AND provider_account_id=${input.providerAccountId} AND provider_key='heygen'
          AND id=${resource.providerResourceId} AND status='pending_verification'
          AND verification_header_id IS NULL
        RETURNING id
      `));
      if (updated.length !== 1) throw new StaticHeyGenVerificationError("STALE");
    }

    const account = rows(await tx.execute(sql`
      UPDATE ${aiMediaProviderAccounts}
      SET status='active',credential_status='active',capabilities='["render_video"]'::jsonb,
        static_credential_verification_id=${input.verificationId},
        static_credential_verification_digest=${input.evidenceDigest},
        static_credential_verified_at=${input.observedAt}::timestamptz,
        static_credential_verification_expires_at=${input.expiresAt}::timestamptz,
        credential_expires_at=${input.expiresAt}::timestamptz,last_verified_at=${input.observedAt}::timestamptz,
        updated_at=transaction_timestamp()
      WHERE id=${input.providerAccountId} AND owner_user_id=${input.scope.ownerUserId}
        AND workspace_id=${input.scope.workspaceId} AND provider_key='heygen'
        AND credential_source='static_api_key' AND credential_version=${input.providerCredentialVersion}
        AND status='disconnected' AND credential_status='unverified'
        AND static_credential_verification_id IS NULL
      RETURNING id
    `));
    if (account.length !== 1) throw new StaticHeyGenVerificationError("STALE");
    return receipt("recorded", input);
  }

  private async insertResourceEvidence(
    tx: Database,
    header: PreparedStaticHeyGenVerificationRecord,
    resource: PreparedStaticHeyGenResourceVerification & { providerResourceId: string },
  ): Promise<void> {
    const inserted = rows(await tx.execute(sql`
      INSERT INTO ${aiMediaStaticHeyGenResourceVerifications} (
        id,owner_user_id,workspace_id,verification_header_id,provider_account_id,provider_key,
        provider_credential_version,provider_resource_id,resource_type,provider_resource_external_id_digest,
        avatar_look_id_digest,avatar_look_status,avatar_group_id_digest,avatar_group_status,
        avatar_group_consent_status,avatar_engines_digest,voice_id_digest,language,voice_support_digest,
        resource_response_digest,evidence_digest,input_digest,idempotency_key,observed_at,expires_at,created_at
      ) VALUES (${resource.id},${header.scope.ownerUserId},${header.scope.workspaceId},${header.verificationId},
        ${header.providerAccountId},'heygen',${header.providerCredentialVersion},${resource.providerResourceId},
        ${resource.resourceType},${resource.providerResourceExternalIdDigest},${resource.avatarLookIdDigest},
        ${resource.avatarLookStatus},${resource.avatarGroupIdDigest},${resource.avatarGroupStatus},
        ${resource.avatarGroupConsentStatus},${resource.avatarEnginesDigest},${resource.voiceIdDigest},
        ${resource.language},${resource.voiceSupportDigest},${resource.resourceResponseDigest},${resource.evidenceDigest},
        ${resource.inputDigest},${resource.idempotencyKey},${header.observedAt}::timestamptz,
        ${header.expiresAt}::timestamptz,transaction_timestamp())
      RETURNING id
    `));
    if (inserted.length !== 1) throw new StaticHeyGenVerificationError("UNAVAILABLE");
  }
}
