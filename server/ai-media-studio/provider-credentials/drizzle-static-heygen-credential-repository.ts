import { sql, type SQL } from "drizzle-orm";
import {
  aiMediaProviderAccounts,
  aiMediaStaticCredentialBindings,
} from "../../../shared/models/ai-media-studio-db";
import {
  StaticHeyGenCredentialBindingError,
  assertStaticHeyGenCredentialInput,
  deriveStaticHeyGenCredentialRequestDigest,
  type BindStaticHeyGenCredential,
  type BindStaticHeyGenCredentialResult,
  type StaticHeyGenCredentialBinding,
  type StaticHeyGenCredentialRepository,
} from "./static-heygen-contracts";

type ExecuteResult = { rows?: unknown[] } | unknown[];
type Database = { execute(query: SQL): Promise<ExecuteResult> };
export type StaticHeyGenCredentialDatabase = Database & {
  transaction<T>(callback: (tx: Database) => Promise<T>): Promise<T>;
};
type Row = Record<string, unknown>;
class StaticHeyGenCredentialCasLost extends Error {}

function rows(result: ExecuteResult): Row[] {
  const value = Array.isArray(result) ? result : result.rows;
  return Array.isArray(value) ? value as Row[] : [];
}
function column(row: Row, camel: string, snake: string): unknown { return row[camel] ?? row[snake]; }
function timestamp(value: unknown): string {
  const date = value instanceof Date ? value : new Date(String(value));
  if (!Number.isFinite(date.getTime())) throw new StaticHeyGenCredentialBindingError();
  return date.toISOString();
}
function bindingFromRow(row: Row): StaticHeyGenCredentialBinding {
  const requestDigest = String(column(row, "requestDigest", "request_digest"));
  if (!/^sha256:[0-9a-f]{64}$/u.test(requestDigest)) throw new StaticHeyGenCredentialBindingError();
  return {
    id: String(row.id),
    scope: {
      ownerUserId: String(column(row, "ownerUserId", "owner_user_id")),
      workspaceId: String(column(row, "workspaceId", "workspace_id")),
    },
    actorUserId: String(column(row, "actorUserId", "actor_user_id")),
    providerAccountId: String(column(row, "providerAccountId", "provider_account_id")),
    providerKey: "heygen",
    expectedCredentialVersion: Number(column(row, "expectedCredentialVersion", "expected_credential_version")),
    credentialVersion: Number(column(row, "targetCredentialVersion", "target_credential_version")),
    secretRef: String(column(row, "secretRef", "secret_ref")),
    idempotencyKey: String(column(row, "idempotencyKey", "idempotency_key")),
    requestDigest: requestDigest as `sha256:${string}`,
    lifecycleState: String(column(row, "lifecycleState", "lifecycle_state")) as StaticHeyGenCredentialBinding["lifecycleState"],
    verificationState: "unverified",
    createdAt: timestamp(column(row, "createdAt", "created_at")),
    updatedAt: timestamp(column(row, "updatedAt", "updated_at")),
    supersededAt: column(row, "supersededAt", "superseded_at") == null
      ? null : timestamp(column(row, "supersededAt", "superseded_at")),
  };
}

export class DrizzleStaticHeyGenCredentialRepository implements StaticHeyGenCredentialRepository {
  constructor(private readonly db: StaticHeyGenCredentialDatabase) {}

  async bind(input: BindStaticHeyGenCredential): Promise<BindStaticHeyGenCredentialResult | undefined> {
    assertStaticHeyGenCredentialInput(input);
    const requestDigest = deriveStaticHeyGenCredentialRequestDigest(input);
    try {
      return await this.db.transaction(async (tx) => {
        const account = rows(await tx.execute(sql`SELECT id,credential_source,credential_version,status,credential_status
          FROM ${aiMediaProviderAccounts}
          WHERE id=${input.providerAccountId} AND owner_user_id=${input.scope.ownerUserId}
            AND workspace_id=${input.scope.workspaceId} AND provider_key='heygen'
          FOR UPDATE`))[0];
        if (!account) return undefined;

        const replay = rows(await tx.execute(sql`SELECT * FROM ${aiMediaStaticCredentialBindings}
          WHERE owner_user_id=${input.scope.ownerUserId} AND workspace_id=${input.scope.workspaceId}
            AND provider_account_id=${input.providerAccountId}
            AND (id=${input.bindingId} OR idempotency_key=${input.idempotencyKey})
          FOR UPDATE`))[0];
        if (replay) {
          if (String(replay.id) !== input.bindingId
            || String(column(replay, "requestDigest", "request_digest")) !== requestDigest) {
            throw new StaticHeyGenCredentialBindingError();
          }
          return Object.freeze({ outcome: "replayed" as const, binding: bindingFromRow(replay) });
        }

        if (Number(column(account, "credentialVersion", "credential_version")) !== input.expectedCredentialVersion
          || String(account.status) !== "disconnected"
          || String(column(account, "credentialStatus", "credential_status")) !== "unverified"
          || (input.expectedCredentialVersion === 0
            ? String(column(account, "credentialSource", "credential_source")) !== "not_bound"
            : String(column(account, "credentialSource", "credential_source")) !== "static_api_key")) {
          return undefined;
        }

        await tx.execute(sql`UPDATE ${aiMediaStaticCredentialBindings}
          SET lifecycle_state='superseded',superseded_at=clock_timestamp(),updated_at=clock_timestamp()
          WHERE owner_user_id=${input.scope.ownerUserId} AND workspace_id=${input.scope.workspaceId}
            AND provider_account_id=${input.providerAccountId} AND lifecycle_state='pending'`);

        const inserted = rows(await tx.execute(sql`INSERT INTO ${aiMediaStaticCredentialBindings} (
          id,owner_user_id,workspace_id,actor_user_id,provider_account_id,provider_key,
          expected_credential_version,target_credential_version,secret_ref,idempotency_key,
          request_digest,lifecycle_state,verification_state,created_at,updated_at
        ) VALUES (${input.bindingId},${input.scope.ownerUserId},${input.scope.workspaceId},${input.actorUserId},
          ${input.providerAccountId},'heygen',${input.expectedCredentialVersion},${input.expectedCredentialVersion + 1},
          ${input.secretRef},${input.idempotencyKey},${requestDigest},'pending','unverified',
          clock_timestamp(),clock_timestamp()) RETURNING *`));
        if (inserted.length !== 1) throw new StaticHeyGenCredentialCasLost();

        const updated = rows(await tx.execute(sql`UPDATE ${aiMediaProviderAccounts} SET
          credential_source='static_api_key',secret_ref=${input.secretRef},credential_version=${input.expectedCredentialVersion + 1},
          credential_status='unverified',status='disconnected',credential_actor_user_id=${input.actorUserId},
          credential_source_session_id=NULL,token_binding_id=NULL,credential_binding_id=NULL,token_kind=NULL,
          token_manifest_revision=NULL,external_account_id=NULL,granted_scopes='[]'::jsonb,capabilities='[]'::jsonb,
          credential_expires_at=NULL,credential_refresh_expires_at=NULL,credential_refreshed_at=NULL,last_verified_at=NULL,
          updated_at=clock_timestamp()
          WHERE id=${input.providerAccountId} AND owner_user_id=${input.scope.ownerUserId}
            AND workspace_id=${input.scope.workspaceId} AND provider_key='heygen'
            AND credential_version=${input.expectedCredentialVersion}
            AND status='disconnected' AND credential_status='unverified'
            AND credential_source=${input.expectedCredentialVersion === 0 ? "not_bound" : "static_api_key"}
          RETURNING id`));
        if (updated.length !== 1) throw new StaticHeyGenCredentialCasLost();
        return Object.freeze({ outcome: "created" as const, binding: bindingFromRow(inserted[0]!) });
      });
    } catch (error) {
      if (error instanceof StaticHeyGenCredentialCasLost) return undefined;
      throw error;
    }
  }
}
