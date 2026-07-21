import type { TenantScope } from "../core/resource-domain";
import {
  HeyGenRosterError,
  type ConfigureHeyGenRosterRecord,
  type HeyGenRosterRecord,
  type HeyGenRosterRepository,
} from "./heygen-roster-contracts";

function scopeKey(scope: TenantScope): string {
  return `${scope.ownerUserId}\0${scope.workspaceId}`;
}

function clone(record: HeyGenRosterRecord): HeyGenRosterRecord {
  return structuredClone(record);
}

export class InMemoryHeyGenRosterRepository implements HeyGenRosterRepository {
  private readonly byRosterId = new Map<string, HeyGenRosterRecord>();
  private readonly byIdempotencyKey = new Map<string, HeyGenRosterRecord>();

  async configure(input: ConfigureHeyGenRosterRecord): Promise<HeyGenRosterRecord> {
    const idempotencyStorageKey = `${scopeKey(input.scope)}\0${input.idempotencyKey}`;
    const existing = this.byIdempotencyKey.get(idempotencyStorageKey);
    if (existing) {
      if (existing.requestDigest !== input.requestDigest
        || existing.providerAccountId !== input.providerAccountId
        || existing.credentialVersion !== input.credentialVersion) {
        throw new HeyGenRosterError("IDEMPOTENCY_CONFLICT");
      }
      return clone(existing);
    }

    const record = clone(input);
    this.byIdempotencyKey.set(idempotencyStorageKey, record);
    this.byRosterId.set(`${scopeKey(input.scope)}\0${input.rosterId}`, record);
    return clone(record);
  }

  async get(scope: TenantScope, rosterId: string): Promise<HeyGenRosterRecord | undefined> {
    const record = this.byRosterId.get(`${scopeKey(scope)}\0${rosterId}`);
    return record ? clone(record) : undefined;
  }
}
