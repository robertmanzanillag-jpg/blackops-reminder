import { sql, type SQL } from "drizzle-orm";
import {
  aiMediaProviderAccounts,
  aiMediaStaticCredentialBindings,
} from "../../../shared/models/ai-media-studio-db";
import {
  deriveStaticHeyGenCredentialRequestDigest,
  type BindStaticHeyGenCredential,
} from "./static-heygen-contracts";
import {
  SECURE_HEYGEN_SETUP_SECRET_REF,
  SecureHeyGenSetupError,
  type PreparedSecureHeyGenSetup,
  type SecureHeyGenSetupRecord,
  type SecureHeyGenSetupRepository,
} from "./secure-heygen-setup-contracts";

type ExecuteResult = { rows?: unknown[] } | unknown[];
type Executor = { execute(query: SQL): Promise<ExecuteResult> };
export type SecureHeyGenSetupDatabase = Executor & {
  transaction<T>(
    callback: (tx: Executor) => Promise<T>,
    config?: { isolationLevel: "serializable" },
  ): Promise<T>;
};
type Row = Record<string, unknown>;

function rows(result: ExecuteResult): Row[] {
  const value = Array.isArray(result) ? result : result.rows;
  return Array.isArray(value) ? value as Row[] : [];
}

function column(row: Row, camel: string, snake: string): unknown {
  return row[camel] ?? row[snake];
}

function text(row: Row, camel: string, snake: string): string {
  const value = column(row, camel, snake);
  return typeof value === "string" ? value : "";
}

function integer(row: Row, camel: string, snake: string): number {
  const value = Number(column(row, camel, snake));
  if (!Number.isSafeInteger(value) || value < 0) throw new SecureHeyGenSetupError("UNAVAILABLE");
  return value;
}

function verificationState(account: Row): "unverified" | "verified" {
  const status = text(account, "status", "status");
  const credentialStatus = text(account, "credentialStatus", "credential_status");
  if (status === "disconnected" && credentialStatus === "unverified") return "unverified";
  if (status === "active" && credentialStatus === "active") return "verified";
  throw new SecureHeyGenSetupError("CONFLICT");
}

/**
 * Creates or reuses the single tenant-owned HeyGen account and binds only the
 * deployment-managed secret reference. The transaction never resolves the
 * reference and contains no provider transport.
 */
export class DrizzleSecureHeyGenSetupRepository implements SecureHeyGenSetupRepository {
  constructor(private readonly db: SecureHeyGenSetupDatabase) {}

  async setup(input: PreparedSecureHeyGenSetup): Promise<SecureHeyGenSetupRecord> {
    try {
      return await this.db.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(
          ${JSON.stringify(["ai-media-secure-heygen-setup-v1", input.scope.ownerUserId, input.scope.workspaceId])}::text,0))`);

        let accounts = await this.accounts(tx, input);
        if (accounts.length > 1) throw new SecureHeyGenSetupError("AMBIGUOUS");
        if (accounts.length === 0) {
          await tx.execute(sql`INSERT INTO ${aiMediaProviderAccounts} (
            id,owner_user_id,workspace_id,provider_key,display_name,status,credential_status,
            credential_version,credential_source,capabilities,granted_scopes,configuration
          ) VALUES (${input.accountIdCandidate},${input.scope.ownerUserId},${input.scope.workspaceId},
            'heygen','HeyGen','disconnected','unverified',0,'not_bound','[]'::jsonb,'[]'::jsonb,'{}'::jsonb)
          ON CONFLICT (id) DO NOTHING`);
          accounts = await this.accounts(tx, input);
          if (accounts.length !== 1) throw new SecureHeyGenSetupError("UNAVAILABLE");
        }

        const account = accounts[0]!;
        const providerAccountId = text(account, "id", "id");
        const credentialVersion = integer(account, "credentialVersion", "credential_version");
        const source = text(account, "credentialSource", "credential_source");
        if (!providerAccountId) throw new SecureHeyGenSetupError("UNAVAILABLE");

        if (source === "static_api_key") {
          return this.replay(tx, input, account, providerAccountId, credentialVersion);
        }
        if (source !== "not_bound" || credentialVersion !== 0
          || text(account, "status", "status") !== "disconnected"
          || text(account, "credentialStatus", "credential_status") !== "unverified") {
          throw new SecureHeyGenSetupError("CONFLICT");
        }

        const bindingInput: BindStaticHeyGenCredential = {
          bindingId: input.bindingId,
          scope: input.scope,
          actorUserId: input.actorUserId,
          providerAccountId,
          expectedCredentialVersion: 0,
          secretRef: SECURE_HEYGEN_SETUP_SECRET_REF,
          idempotencyKey: input.idempotencyKey,
        };
        const requestDigest = deriveStaticHeyGenCredentialRequestDigest(bindingInput);
        const inserted = rows(await tx.execute(sql`INSERT INTO ${aiMediaStaticCredentialBindings} (
          id,owner_user_id,workspace_id,actor_user_id,provider_account_id,provider_key,
          expected_credential_version,target_credential_version,secret_ref,idempotency_key,
          request_digest,lifecycle_state,verification_state,created_at,updated_at
        ) VALUES (${input.bindingId},${input.scope.ownerUserId},${input.scope.workspaceId},${input.actorUserId},
          ${providerAccountId},'heygen',0,1,${SECURE_HEYGEN_SETUP_SECRET_REF},${input.idempotencyKey},
          ${requestDigest},'pending','unverified',transaction_timestamp(),transaction_timestamp())
        ON CONFLICT DO NOTHING RETURNING id`));
        if (inserted.length !== 1) throw new SecureHeyGenSetupError("CONFLICT");

        const updated = rows(await tx.execute(sql`UPDATE ${aiMediaProviderAccounts} SET
          credential_source='static_api_key',secret_ref=${SECURE_HEYGEN_SETUP_SECRET_REF},credential_version=1,
          credential_status='unverified',status='disconnected',credential_actor_user_id=${input.actorUserId},
          credential_source_session_id=NULL,token_binding_id=NULL,credential_binding_id=NULL,token_kind=NULL,
          token_manifest_revision=NULL,external_account_id=NULL,granted_scopes='[]'::jsonb,capabilities='[]'::jsonb,
          credential_expires_at=NULL,credential_refresh_expires_at=NULL,credential_refreshed_at=NULL,last_verified_at=NULL,
          updated_at=transaction_timestamp()
          WHERE id=${providerAccountId} AND owner_user_id=${input.scope.ownerUserId}
            AND workspace_id=${input.scope.workspaceId} AND provider_key='heygen'
            AND credential_source='not_bound' AND credential_version=0
            AND status='disconnected' AND credential_status='unverified'
          RETURNING id`));
        if (updated.length !== 1) throw new SecureHeyGenSetupError("CONFLICT");
        return Object.freeze({
          outcome: "created" as const,
          providerAccountId,
          bindingId: input.bindingId,
          credentialVersion: 1,
          verificationState: "unverified" as const,
        });
      }, { isolationLevel: "serializable" });
    } catch (error) {
      if (error instanceof SecureHeyGenSetupError) throw error;
      throw new SecureHeyGenSetupError("UNAVAILABLE");
    }
  }

  private async accounts(tx: Executor, input: PreparedSecureHeyGenSetup): Promise<Row[]> {
    return rows(await tx.execute(sql`SELECT id,status,credential_status,credential_version,credential_source,
      secret_ref,credential_actor_user_id FROM ${aiMediaProviderAccounts}
      WHERE owner_user_id=${input.scope.ownerUserId} AND workspace_id=${input.scope.workspaceId}
        AND provider_key='heygen' ORDER BY id LIMIT 2 FOR UPDATE`));
  }

  private async replay(
    tx: Executor,
    input: PreparedSecureHeyGenSetup,
    account: Row,
    providerAccountId: string,
    credentialVersion: number,
  ): Promise<SecureHeyGenSetupRecord> {
    if (text(account, "secretRef", "secret_ref") !== SECURE_HEYGEN_SETUP_SECRET_REF || credentialVersion < 1) {
      throw new SecureHeyGenSetupError("CONFLICT");
    }
    const bindings = rows(await tx.execute(sql`SELECT id,actor_user_id,idempotency_key,target_credential_version,
      secret_ref,lifecycle_state FROM ${aiMediaStaticCredentialBindings}
      WHERE owner_user_id=${input.scope.ownerUserId} AND workspace_id=${input.scope.workspaceId}
        AND provider_account_id=${providerAccountId} AND provider_key='heygen'
        AND lifecycle_state='pending' ORDER BY id LIMIT 2 FOR UPDATE`));
    if (bindings.length !== 1) throw new SecureHeyGenSetupError(bindings.length > 1 ? "AMBIGUOUS" : "CONFLICT");
    const binding = bindings[0]!;
    if (text(binding, "id", "id") !== input.bindingId
      || text(binding, "actorUserId", "actor_user_id") !== input.actorUserId
      || text(binding, "idempotencyKey", "idempotency_key") !== input.idempotencyKey
      || text(binding, "secretRef", "secret_ref") !== SECURE_HEYGEN_SETUP_SECRET_REF
      || integer(binding, "targetCredentialVersion", "target_credential_version") !== credentialVersion) {
      throw new SecureHeyGenSetupError("CONFLICT");
    }
    return Object.freeze({
      outcome: "replayed" as const,
      providerAccountId,
      bindingId: input.bindingId,
      credentialVersion,
      verificationState: verificationState(account),
    });
  }
}
