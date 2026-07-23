import { sql, type SQL } from "drizzle-orm";
import {
  aiMediaProviderAccounts,
  aiMediaStaticCredentialBindings,
  aiMediaStaticHeyGenVerificationHeaders,
} from "../../../shared/models/ai-media-studio-db";
import type { TenantScope } from "../core/resource-domain";
import type { HeyGenV3AdmittedProviderOptions } from "../providers/heygen-v3-admitted-render-provider";
import type {
  RuntimeProviderCredentialIdentity,
  RuntimeProviderCredentialMaterializer,
} from "./runtime-provider-credential-contracts";
import {
  STATIC_HEYGEN_SECRET_REF,
} from "./static-heygen-contracts";
import type { StaticHeyGenSecretResolver } from "./static-heygen-secret-resolver";

type ExecuteResult = { rows?: unknown[] } | unknown[];
type Row = Record<string, unknown>;

export interface VerifiedStaticHeyGenRuntimeCredentialDatabase {
  execute(query: SQL): Promise<ExecuteResult>;
}

export interface VerifiedStaticHeyGenRuntimeCredentialMetadata {
  readonly scope: TenantScope;
  readonly providerAccountId: string;
  readonly providerKey: "heygen";
  readonly providerCredentialVersion: number;
  readonly secretRef: string;
  readonly verifiedAt: string;
  readonly expiresAt: string;
}

export interface VerifiedStaticHeyGenRuntimeCredentialLoader {
  load(
    identity: RuntimeProviderCredentialIdentity,
  ): Promise<VerifiedStaticHeyGenRuntimeCredentialMetadata | undefined>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;

const resultRows = (result: ExecuteResult): Row[] => {
  const candidate = Array.isArray(result) ? result : result.rows;
  return Array.isArray(candidate)
    && candidate.every((row) => row !== null && typeof row === "object" && !Array.isArray(row))
    ? candidate as Row[]
    : [];
};
const value = (row: Row, camel: string, snake: string): unknown => row[camel] ?? row[snake];
const text = (row: Row, camel: string, snake: string): string => String(value(row, camel, snake) ?? "");
const number = (row: Row, camel: string, snake: string): number => Number(value(row, camel, snake));

/** Loads only an exact, currently verified static HeyGen credential binding. */
export class DrizzleVerifiedStaticHeyGenRuntimeCredentialLoader
implements VerifiedStaticHeyGenRuntimeCredentialLoader {
  constructor(private readonly db: VerifiedStaticHeyGenRuntimeCredentialDatabase) {}

  async load(
    identity: RuntimeProviderCredentialIdentity,
  ): Promise<VerifiedStaticHeyGenRuntimeCredentialMetadata | undefined> {
    if (!validIdentity(identity)) return undefined;
    try {
      const loaded = resultRows(await this.db.execute(sql`
        SELECT accounts.id AS provider_account_id,accounts.provider_key,
          accounts.credential_version,accounts.secret_ref,
          accounts.static_credential_verification_id,
          accounts.static_credential_verification_digest,
          bindings.id AS binding_id,bindings.target_credential_version,
          bindings.request_digest AS binding_request_digest,
          bindings.secret_ref AS binding_secret_ref,
          bindings.lifecycle_state AS binding_lifecycle_state,
          bindings.verification_state AS binding_verification_state,
          verification.id AS verification_id,
          verification.provider_credential_version AS verification_credential_version,
          verification.credential_binding_request_digest,
          verification.evidence_digest AS verification_evidence_digest,
          verification.verification_state AS header_verification_state,
          verification.observed_at AS verification_observed_at,
          verification.expires_at AS verification_expires_at
        FROM ${aiMediaProviderAccounts} accounts
        INNER JOIN ${aiMediaStaticCredentialBindings} bindings
          ON bindings.owner_user_id=accounts.owner_user_id
          AND bindings.workspace_id=accounts.workspace_id
          AND bindings.provider_account_id=accounts.id
          AND bindings.provider_key=accounts.provider_key
          AND bindings.target_credential_version=accounts.credential_version
          AND bindings.secret_ref=accounts.secret_ref
        INNER JOIN ${aiMediaStaticHeyGenVerificationHeaders} verification
          ON verification.owner_user_id=accounts.owner_user_id
          AND verification.workspace_id=accounts.workspace_id
          AND verification.provider_account_id=accounts.id
          AND verification.provider_key=accounts.provider_key
          AND verification.static_credential_binding_id=bindings.id
          AND verification.provider_credential_version=accounts.credential_version
          AND verification.credential_binding_request_digest=bindings.request_digest
          AND verification.id=accounts.static_credential_verification_id
          AND verification.evidence_digest=accounts.static_credential_verification_digest
        WHERE accounts.owner_user_id=${identity.scope.ownerUserId}
          AND accounts.workspace_id=${identity.scope.workspaceId}
          AND accounts.id=${identity.providerAccountId}
          AND accounts.provider_key='heygen'
          AND accounts.credential_version=${identity.providerCredentialVersion}
          AND accounts.status='active' AND accounts.credential_status='active'
          AND accounts.credential_source='static_api_key'
          AND accounts.capabilities='["render_video"]'::jsonb
          AND accounts.granted_scopes='[]'::jsonb
          AND accounts.static_credential_verified_at=verification.observed_at
          AND accounts.last_verified_at=verification.observed_at
          AND accounts.static_credential_verification_expires_at=verification.expires_at
          AND accounts.credential_expires_at=verification.expires_at
          AND bindings.lifecycle_state='pending'
          AND bindings.verification_state='unverified'
          AND verification.verification_state='verified'
          AND verification.observed_at<=transaction_timestamp()
          AND verification.expires_at>transaction_timestamp()
        LIMIT 2
      `));
      if (loaded.length !== 1 || !validRow(loaded[0]!, identity)) return undefined;
      const row = loaded[0]!;
      return Object.freeze({
        scope: Object.freeze({ ...identity.scope }),
        providerAccountId: identity.providerAccountId,
        providerKey: "heygen" as const,
        providerCredentialVersion: identity.providerCredentialVersion,
        secretRef: text(row, "secretRef", "secret_ref"),
        verifiedAt: exactTimestamp(row, "verificationObservedAt", "verification_observed_at"),
        expiresAt: exactTimestamp(row, "verificationExpiresAt", "verification_expires_at"),
      });
    } catch {
      throw unavailable();
    }
  }
}

/** Resolves secret material only after current database admission succeeds. */
export class VerifiedStaticHeyGenRuntimeCredentialMaterializer
implements RuntimeProviderCredentialMaterializer<HeyGenV3AdmittedProviderOptions> {
  constructor(
    private readonly loader: VerifiedStaticHeyGenRuntimeCredentialLoader,
    private readonly secretResolver: StaticHeyGenSecretResolver,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async materialize(
    identity: RuntimeProviderCredentialIdentity,
  ): Promise<HeyGenV3AdmittedProviderOptions | undefined> {
    let metadata: VerifiedStaticHeyGenRuntimeCredentialMetadata | undefined;
    try {
      metadata = await this.loader.load(identity);
    } catch {
      throw unavailable();
    }
    try {
      if (!metadata || !metadataMatchesIdentity(metadata, identity)
        || Date.parse(metadata.expiresAt) <= this.now().getTime() + 30_000) return undefined;
    } catch {
      throw unavailable();
    }
    try {
      const apiKey = await this.secretResolver.resolve(metadata.secretRef);
      if (!apiKey) throw unavailable();
      return Object.freeze({
        apiKey,
        providerAccountId: metadata.providerAccountId,
        providerCredentialVersion: metadata.providerCredentialVersion,
        credentialExpiresAt: metadata.expiresAt,
        assertCredentialCurrent: async () => {
          let current: VerifiedStaticHeyGenRuntimeCredentialMetadata | undefined;
          try {
            current = await this.loader.load(identity);
          } catch {
            throw unavailable();
          }
          if (!current || !metadataMatchesIdentity(current, identity)
            || current.secretRef !== metadata.secretRef
            || current.verifiedAt !== metadata.verifiedAt
            || current.expiresAt !== metadata.expiresAt
            || Date.parse(current.expiresAt) <= this.now().getTime() + 30_000) {
            throw unavailable();
          }
          let currentApiKey: string | undefined;
          try {
            currentApiKey = await this.secretResolver.resolve(current.secretRef);
          } catch {
            throw unavailable();
          }
          if (!currentApiKey || currentApiKey !== apiKey) throw unavailable();
        },
      });
    } catch {
      throw unavailable();
    }
  }
}

function validIdentity(identity: RuntimeProviderCredentialIdentity): boolean {
  return Boolean(identity && identity.scope)
    && identity.providerKey === "heygen"
    && typeof identity.providerAccountId === "string"
    && UUID.test(identity.providerAccountId)
    && Number.isSafeInteger(identity.providerCredentialVersion)
    && identity.providerCredentialVersion >= 1
    && exactScopePart(identity.scope.ownerUserId)
    && exactScopePart(identity.scope.workspaceId);
}

function metadataMatchesIdentity(
  metadata: VerifiedStaticHeyGenRuntimeCredentialMetadata,
  identity: RuntimeProviderCredentialIdentity,
): boolean {
  return validIdentity(identity)
    && metadata.providerKey === "heygen"
    && metadata.providerAccountId === identity.providerAccountId
    && metadata.providerCredentialVersion === identity.providerCredentialVersion
    && Boolean(metadata.scope)
    && metadata.scope.ownerUserId === identity.scope.ownerUserId
    && metadata.scope.workspaceId === identity.scope.workspaceId
    && typeof metadata.secretRef === "string"
    && STATIC_HEYGEN_SECRET_REF.test(metadata.secretRef)
    && validVerificationWindow(metadata.verifiedAt, metadata.expiresAt);
}

function exactScopePart(candidate: unknown): candidate is string {
  return typeof candidate === "string"
    && candidate.length >= 1 && candidate.length <= 255 && candidate === candidate.trim();
}

function validRow(row: Row, identity: RuntimeProviderCredentialIdentity): boolean {
  const version = identity.providerCredentialVersion;
  const secretRef = text(row, "secretRef", "secret_ref");
  const bindingSecretRef = text(row, "bindingSecretRef", "binding_secret_ref");
  const bindingDigest = text(row, "bindingRequestDigest", "binding_request_digest");
  const observedAt = exactTimestamp(row, "verificationObservedAt", "verification_observed_at");
  const expiresAt = exactTimestamp(row, "verificationExpiresAt", "verification_expires_at");
  return text(row, "providerAccountId", "provider_account_id") === identity.providerAccountId
    && text(row, "providerKey", "provider_key") === "heygen"
    && number(row, "credentialVersion", "credential_version") === version
    && STATIC_HEYGEN_SECRET_REF.test(secretRef)
    && bindingSecretRef === secretRef
    && UUID.test(text(row, "bindingId", "binding_id"))
    && number(row, "targetCredentialVersion", "target_credential_version") === version
    && SHA256.test(bindingDigest)
    && text(row, "bindingLifecycleState", "binding_lifecycle_state") === "pending"
    && text(row, "bindingVerificationState", "binding_verification_state") === "unverified"
    && UUID.test(text(row, "verificationId", "verification_id"))
    && text(row, "staticCredentialVerificationId", "static_credential_verification_id")
      === text(row, "verificationId", "verification_id")
    && number(row, "verificationCredentialVersion", "verification_credential_version") === version
    && text(row, "credentialBindingRequestDigest", "credential_binding_request_digest") === bindingDigest
    && SHA256.test(text(row, "verificationEvidenceDigest", "verification_evidence_digest"))
    && text(row, "staticCredentialVerificationDigest", "static_credential_verification_digest")
      === text(row, "verificationEvidenceDigest", "verification_evidence_digest")
    && text(row, "headerVerificationState", "header_verification_state") === "verified"
    && validVerificationWindow(observedAt, expiresAt);
}

function exactTimestamp(row: Row, camel: string, snake: string): string {
  const candidate = value(row, camel, snake);
  if (candidate instanceof Date && Number.isFinite(candidate.getTime())) return candidate.toISOString();
  if (typeof candidate === "string" && Number.isFinite(Date.parse(candidate))) {
    return new Date(candidate).toISOString();
  }
  return "";
}

function validVerificationWindow(verifiedAt: string, expiresAt: string): boolean {
  const verifiedAtMs = Date.parse(verifiedAt);
  const expiresAtMs = Date.parse(expiresAt);
  return Number.isFinite(verifiedAtMs) && Number.isFinite(expiresAtMs) && expiresAtMs > verifiedAtMs;
}

function unavailable(): Error {
  return new Error("Verified static HeyGen runtime credential unavailable");
}
