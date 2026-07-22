import { sql, type SQL } from "drizzle-orm";
import {
  aiMediaStaticHeyGenResourceVerifications,
  aiMediaStaticHeyGenVerificationHeaders,
} from "../../../shared/models/ai-media-studio-db";
import {
  opaqueEvidenceKey,
  opaqueVerificationKey,
  type Sha256Digest,
  type StaticHeyGenVerificationReceipt,
} from "./static-heygen-verification-contracts";
import type { StaticHeyGenLiveVerificationReplayReader } from "./static-heygen-verification-coordinator";

type ExecuteResult = { rows?: unknown[] } | unknown[];
type Row = Record<string, unknown>;
export interface StaticHeyGenVerificationReplayDatabase {
  execute(query: SQL): Promise<ExecuteResult>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const rows = (result: ExecuteResult): Row[] => {
  const values = Array.isArray(result) ? result : result.rows;
  return Array.isArray(values) && values.every((row) => row && typeof row === "object" && !Array.isArray(row))
    ? values as Row[]
    : [];
};
const value = (row: Row, camel: string, snake: string): unknown => row[camel] ?? row[snake];
const text = (row: Row, camel: string, snake: string): string => String(value(row, camel, snake) ?? "");
const integer = (row: Row, camel: string, snake: string): number => Number(value(row, camel, snake));
const iso = (input: unknown): string | undefined => {
  const date = input instanceof Date ? input : new Date(String(input));
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
};

/**
 * Returns an immutable successful receipt before secret resolution/provider I/O.
 * The evidence graph is append-only, so an exact aggregate is replay-stable.
 */
export class DrizzleStaticHeyGenVerificationReplayReader implements StaticHeyGenLiveVerificationReplayReader {
  constructor(private readonly db: StaticHeyGenVerificationReplayDatabase) {}

  async find(scope: Readonly<{ ownerUserId: string; workspaceId: string }>, idempotencyKey: string) {
    const results = rows(await this.db.execute(sql`
      SELECT headers.id,headers.evidence_digest,headers.provider_credential_version,
        headers.observed_at,headers.expires_at,
        count(*) FILTER (WHERE resources.resource_type='avatar')::integer AS avatar_count,
        count(*) FILTER (WHERE resources.resource_type='voice')::integer AS voice_count
      FROM ${aiMediaStaticHeyGenVerificationHeaders} headers
      INNER JOIN ${aiMediaStaticHeyGenResourceVerifications} resources
        ON resources.owner_user_id=headers.owner_user_id
        AND resources.workspace_id=headers.workspace_id
        AND resources.verification_header_id=headers.id
        AND resources.provider_account_id=headers.provider_account_id
        AND resources.provider_key=headers.provider_key
        AND resources.provider_credential_version=headers.provider_credential_version
      WHERE headers.owner_user_id=${scope.ownerUserId} AND headers.workspace_id=${scope.workspaceId}
        AND headers.provider_key='heygen' AND headers.verification_state='verified'
        AND headers.idempotency_key=${idempotencyKey}
      GROUP BY headers.id,headers.evidence_digest,headers.provider_credential_version,
        headers.observed_at,headers.expires_at
      ORDER BY headers.id
      LIMIT 2
    `));
    if (results.length === 0) return undefined;
    if (results.length !== 1) throw new Error("Ambiguous live verification replay");
    const row = results[0]!;
    const id = text(row, "id", "id");
    const evidenceDigest = text(row, "evidenceDigest", "evidence_digest");
    const providerCredentialVersion = integer(row, "providerCredentialVersion", "provider_credential_version");
    const avatarCount = integer(row, "avatarCount", "avatar_count");
    const voiceCount = integer(row, "voiceCount", "voice_count");
    const verifiedAt = iso(value(row, "observedAt", "observed_at"));
    const expiresAt = iso(value(row, "expiresAt", "expires_at"));
    if (!UUID.test(id) || !SHA256.test(evidenceDigest)
      || !Number.isSafeInteger(providerCredentialVersion) || providerCredentialVersion < 1
      || !Number.isSafeInteger(avatarCount) || avatarCount < 5 || avatarCount > 10
      || !Number.isSafeInteger(voiceCount) || voiceCount < 1 || voiceCount > 10
      || !verifiedAt || !expiresAt || Date.parse(expiresAt) <= Date.parse(verifiedAt)) {
      throw new Error("Invalid live verification replay");
    }
    return Object.freeze({
      outcome: "replayed" as const,
      verification: Object.freeze({
        verificationKey: opaqueVerificationKey(id),
        evidenceKey: opaqueEvidenceKey(evidenceDigest as Sha256Digest),
        providerKey: "heygen" as const,
        providerCredentialVersion,
        verifiedAt,
        expiresAt,
        avatarCount,
        voiceCount,
      }),
    }) satisfies StaticHeyGenVerificationReceipt;
  }
}
