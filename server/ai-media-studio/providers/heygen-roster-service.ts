import { createHash } from "node:crypto";
import {
  createHeyGenRosterRequestSchema,
  type ConfigureHeyGenRosterResponse,
  type CreateHeyGenRosterRequest,
  type HeyGenRosterStatus,
  type HeyGenRosterDailyPlan,
} from "../../../shared/ai-media-studio-heygen-roster";
import type { TenantScope } from "../core/resource-domain";
import {
  HeyGenRosterError,
  toHeyGenRosterStatus,
  type HeyGenResolvedAccountContext,
  type HeyGenRosterAccountResolver,
  type HeyGenRosterNativeMember,
  type HeyGenRosterRecord,
  type HeyGenRosterRepository,
} from "./heygen-roster-contracts";

const FORBIDDEN_FIELD = /(?:api[_-]?key|authorization|credential|password|secret|token)/iu;

function assertPlainPublicInput(value: unknown): void {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new HeyGenRosterError("INVALID_REQUEST");
  }
  for (const key of Object.keys(value)) {
    if (FORBIDDEN_FIELD.test(key)) throw new HeyGenRosterError("INVALID_REQUEST");
    const child = (value as Record<string, unknown>)[key];
    if (Array.isArray(child)) {
      if (Object.getPrototypeOf(child) !== Array.prototype) throw new HeyGenRosterError("INVALID_REQUEST");
      for (const item of child) assertPlainPublicInput(item);
    } else if (child !== null && typeof child === "object") {
      assertPlainPublicInput(child);
    }
  }
}

function parseRequest(input: unknown): CreateHeyGenRosterRequest {
  try {
    assertPlainPublicInput(input);
    return createHeyGenRosterRequestSchema.parse(input);
  } catch {
    throw new HeyGenRosterError("INVALID_REQUEST");
  }
}

function stableRequestDigest(request: CreateHeyGenRosterRequest): string {
  return `sha256:${createHash("sha256").update(JSON.stringify({
    members: request.members.map((member) => ({
      name: member.name,
      avatarId: member.avatarId,
      voiceId: member.voiceId,
      language: member.language,
      accent: member.accent,
      gender: member.gender,
    })),
  })).digest("hex")}`;
}

function opaqueId(prefix: "roster" | "member", seed: string): string {
  return `${prefix}_${createHash("sha256").update(seed).digest("hex").slice(0, 24)}`;
}

function validScope(scope: TenantScope): boolean {
  return typeof scope?.ownerUserId === "string" && scope.ownerUserId.length > 0 && scope.ownerUserId.length <= 256
    && typeof scope?.workspaceId === "string" && scope.workspaceId.length > 0 && scope.workspaceId.length <= 256;
}

export class HeyGenRosterService {
  constructor(
    private readonly repository: HeyGenRosterRepository,
    private readonly accountResolver: HeyGenRosterAccountResolver,
    private readonly now: () => string = () => new Date().toISOString(),
    private readonly accountingTimeZone = "UTC",
  ) {}

  private trustedTimeZone(): string {
    try {
      if (typeof this.accountingTimeZone !== "string" || this.accountingTimeZone.length > 80
        || new Intl.DateTimeFormat("en-US", { timeZone: this.accountingTimeZone }).resolvedOptions().timeZone !== this.accountingTimeZone) {
        throw new Error("invalid zone");
      }
      return this.accountingTimeZone;
    } catch {
      throw new HeyGenRosterError("ROSTER_UNAVAILABLE");
    }
  }

  private async resolveActiveAccount(scope: TenantScope): Promise<HeyGenResolvedAccountContext> {
    let account;
    try {
      account = await this.accountResolver.resolve(scope);
    } catch {
      throw new HeyGenRosterError("ACCOUNT_UNAVAILABLE");
    }
    if (!account || !account.providerAccountId || !Number.isSafeInteger(account.credentialVersion)
      || account.credentialVersion < 1) {
      throw new HeyGenRosterError("ACCOUNT_UNAVAILABLE");
    }
    return account;
  }

  private assertRecordMatchesActiveAccount(
    record: HeyGenRosterRecord,
    account: HeyGenResolvedAccountContext,
  ): void {
    if (record.providerAccountId !== account.providerAccountId || record.credentialVersion !== account.credentialVersion) {
      throw new HeyGenRosterError("ROSTER_UNAVAILABLE");
    }
  }

  async configure(scope: TenantScope, unsafeInput: unknown): Promise<ConfigureHeyGenRosterResponse> {
    if (!validScope(scope)) throw new HeyGenRosterError("INVALID_REQUEST");
    const request = parseRequest(unsafeInput);
    const account = await this.resolveActiveAccount(scope);

    const requestDigest = stableRequestDigest(request);
    const rosterId = opaqueId("roster", `${scope.ownerUserId}\0${scope.workspaceId}\0${request.idempotencyKey}`);
    const members: HeyGenRosterNativeMember[] = request.members.map((member, index) => ({
      ...member,
      memberId: opaqueId("member", `${rosterId}\0${index}\0${member.avatarId}`),
    }));

    try {
      const record = await this.repository.configure({
        scope: { ...scope },
        providerAccountId: account.providerAccountId,
        credentialVersion: account.credentialVersion,
        rosterId,
        requestDigest,
        idempotencyKey: request.idempotencyKey,
        members,
        configuredAt: this.now(),
        accountingTimeZone: this.trustedTimeZone(),
      });
      return { roster: toHeyGenRosterStatus(record) };
    } catch (error) {
      if (error instanceof HeyGenRosterError) throw error;
      throw new HeyGenRosterError("ROSTER_UNAVAILABLE");
    }
  }

  async status(scope: TenantScope, rosterId: string): Promise<HeyGenRosterStatus | undefined> {
    if (!validScope(scope) || !/^roster_[a-f0-9]{24}$/u.test(rosterId)) {
      throw new HeyGenRosterError("INVALID_REQUEST");
    }
    const account = await this.resolveActiveAccount(scope);
    try {
      const record = await this.repository.get(scope, rosterId);
      if (record) this.assertRecordMatchesActiveAccount(record, account);
      return record ? toHeyGenRosterStatus(record) : undefined;
    } catch {
      throw new HeyGenRosterError("ROSTER_UNAVAILABLE");
    }
  }

  async currentStatus(scope: TenantScope): Promise<HeyGenRosterStatus | undefined> {
    if (!validScope(scope)) throw new HeyGenRosterError("INVALID_REQUEST");
    const account = await this.resolveActiveAccount(scope);
    try {
      const record = await this.repository.getCurrent(scope);
      if (record) this.assertRecordMatchesActiveAccount(record, account);
      return record ? toHeyGenRosterStatus(record) : undefined;
    } catch {
      throw new HeyGenRosterError("ROSTER_UNAVAILABLE");
    }
  }

  async currentDailyPlan(scope: TenantScope): Promise<HeyGenRosterDailyPlan | undefined> {
    if (!validScope(scope)) throw new HeyGenRosterError("INVALID_REQUEST");
    const account = await this.resolveActiveAccount(scope);
    try {
      const plan = await this.repository.getCurrentDailyPlan(scope);
      const roster = await this.repository.getCurrent(scope);
      if (!plan && !roster) return undefined;
      if (!plan || !roster) throw new HeyGenRosterError("ROSTER_UNAVAILABLE");
      this.assertRecordMatchesActiveAccount(roster, account);
      if (plan.rosterId !== roster.rosterId || plan.timeZone !== this.trustedTimeZone()) {
        throw new HeyGenRosterError("ROSTER_UNAVAILABLE");
      }
      return plan;
    } catch (error) {
      if (error instanceof HeyGenRosterError) throw error;
      throw new HeyGenRosterError("ROSTER_UNAVAILABLE");
    }
  }
}
