import { randomUUID } from "node:crypto";
import type { InfluencerGender, ProviderResource } from "../../../shared/ai-media-studio-core";

export type TenantScope = Readonly<{
  ownerUserId: string;
  workspaceId: string;
}>;

export type CanonicalResourceType = ProviderResource["kind"];
export type CanonicalResourceStatus = ProviderResource["status"];

/** A Kong-owned resource. Provider-native IDs live behind adapter boundaries. */
export type CanonicalMediaResource = ProviderResource & {
  ownerUserId: string;
  workspaceId: string;
};

export interface CreateCanonicalResourceInput {
  kind: CanonicalResourceType;
  name: string;
  language: string | null;
  accent: string | null;
  gender: InfluencerGender | null;
  previewUrl: string | null;
  thumbnailUrl: string | null;
  status?: Exclude<CanonicalResourceStatus, "archived">;
}

export interface UpdateCanonicalResourceInput {
  name?: string;
  language?: string | null;
  accent?: string | null;
  gender?: InfluencerGender | null;
  previewUrl?: string | null;
  thumbnailUrl?: string | null;
  status?: Exclude<CanonicalResourceStatus, "archived">;
}

export interface CanonicalResourceOption {
  id: string;
  name: string;
  kind: CanonicalResourceType;
  language: string | null;
  accent: string | null;
  gender: InfluencerGender | null;
  previewUrl: string | null;
  thumbnailUrl: string | null;
  status: CanonicalResourceStatus;
}

export interface CanonicalResourceOptions {
  avatars: CanonicalResourceOption[];
  voices: CanonicalResourceOption[];
}

export interface CanonicalResourceRepository {
  create(scope: TenantScope, resource: Omit<CanonicalMediaResource, "ownerUserId" | "workspaceId">): Promise<CanonicalMediaResource>;
  get(scope: TenantScope, resourceId: string): Promise<CanonicalMediaResource | undefined>;
  getMany(scope: TenantScope, resourceIds: readonly string[]): Promise<CanonicalMediaResource[]>;
  list(scope: TenantScope, filter?: { kind?: CanonicalResourceType; includeArchived?: boolean }): Promise<CanonicalMediaResource[]>;
  update(scope: TenantScope, resource: CanonicalMediaResource): Promise<CanonicalMediaResource>;
}

export class CoreDomainValidationError extends Error {
  readonly code = "CORE_DOMAIN_VALIDATION";
}

export class CoreDomainNotFoundError extends Error {
  readonly code = "CORE_DOMAIN_NOT_FOUND";
}

const CREATE_KEYS = new Set([
  "kind", "name", "language", "accent", "gender", "previewUrl", "thumbnailUrl", "status",
]);
const UPDATE_KEYS = new Set([
  "name", "language", "accent", "gender", "previewUrl", "thumbnailUrl", "status",
]);
const GENDERS = new Set<InfluencerGender>(["female", "male", "non_binary", "unspecified"]);

function assertPlainPublicDto(value: unknown, allowedKeys: ReadonlySet<string>, label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new CoreDomainValidationError(`${label} must be a plain object`);
  }
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      throw new CoreDomainValidationError(`${label} contains forbidden or unknown field: ${key}`);
    }
  }
}

function requiredString(value: unknown, field: string, max = 160): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.trim().length > max) {
    throw new CoreDomainValidationError(`${field} must be a non-empty string of at most ${max} characters`);
  }
  return value.trim();
}

function nullableString(value: unknown, field: string, max: number): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || value.trim().length > max) {
    throw new CoreDomainValidationError(`${field} must be null or a string of at most ${max} characters`);
  }
  return value.trim();
}

function httpsUrl(value: unknown, field: string): string | null {
  if (value === null) return null;
  if (typeof value !== "string") throw new CoreDomainValidationError(`${field} must be null or an HTTPS URL`);
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:") throw new Error("not HTTPS");
    return parsed.toString();
  } catch {
    throw new CoreDomainValidationError(`${field} must be null or an HTTPS URL`);
  }
}

function resourceKind(value: unknown): CanonicalResourceType {
  if (value !== "avatar" && value !== "voice") throw new CoreDomainValidationError("kind must be avatar or voice");
  return value;
}

function mutableStatus(value: unknown): Exclude<CanonicalResourceStatus, "archived"> {
  if (value !== "active" && value !== "inactive") {
    throw new CoreDomainValidationError("status must be active or inactive; use archive() to archive a resource");
  }
  return value;
}

function gender(value: unknown): InfluencerGender | null {
  if (value === null) return null;
  if (typeof value !== "string" || !GENDERS.has(value as InfluencerGender)) {
    throw new CoreDomainValidationError("gender must be female, male, non_binary, unspecified, or null");
  }
  return value as InfluencerGender;
}

function assertScope(scope: TenantScope): TenantScope {
  return {
    ownerUserId: requiredString(scope.ownerUserId, "ownerUserId", 256),
    workspaceId: requiredString(scope.workspaceId, "workspaceId", 256),
  };
}

function cloneResource(resource: CanonicalMediaResource): CanonicalMediaResource {
  return { ...resource };
}

export interface CanonicalResourceServiceOptions {
  idFactory?: () => string;
  now?: () => Date;
}

export class CanonicalResourceService {
  private readonly idFactory: () => string;
  private readonly now: () => Date;

  constructor(
    private readonly repository: CanonicalResourceRepository,
    options: CanonicalResourceServiceOptions = {},
  ) {
    this.idFactory = options.idFactory ?? randomUUID;
    this.now = options.now ?? (() => new Date());
  }

  async create(scopeInput: TenantScope, input: CreateCanonicalResourceInput): Promise<CanonicalMediaResource> {
    const scope = assertScope(scopeInput);
    assertPlainPublicDto(input, CREATE_KEYS, "resource input");
    const resource: Omit<CanonicalMediaResource, "ownerUserId" | "workspaceId"> = {
      id: this.idFactory(),
      kind: resourceKind(input.kind),
      name: requiredString(input.name, "name", 120),
      language: input.language === null ? null : requiredString(input.language, "language", 35),
      accent: nullableString(input.accent, "accent", 80),
      gender: gender(input.gender),
      previewUrl: httpsUrl(input.previewUrl, "previewUrl"),
      thumbnailUrl: httpsUrl(input.thumbnailUrl, "thumbnailUrl"),
      status: input.status === undefined ? "active" : mutableStatus(input.status),
      synchronizedAt: this.now().toISOString(),
    };
    return cloneResource(await this.repository.create(scope, resource));
  }

  async get(scopeInput: TenantScope, resourceId: string): Promise<CanonicalMediaResource> {
    const scope = assertScope(scopeInput);
    const resource = await this.repository.get(scope, requiredString(resourceId, "resourceId", 128));
    if (!resource) throw new CoreDomainNotFoundError("Canonical media resource not found");
    return cloneResource(resource);
  }

  async list(
    scopeInput: TenantScope,
    filter: { kind?: CanonicalResourceType; includeArchived?: boolean } = {},
  ): Promise<CanonicalMediaResource[]> {
    const scope = assertScope(scopeInput);
    if (filter.kind !== undefined) resourceKind(filter.kind);
    return (await this.repository.list(scope, filter)).map(cloneResource);
  }

  async update(scopeInput: TenantScope, resourceId: string, input: UpdateCanonicalResourceInput): Promise<CanonicalMediaResource> {
    const scope = assertScope(scopeInput);
    assertPlainPublicDto(input, UPDATE_KEYS, "resource update");
    const current = await this.get(scope, resourceId);
    if (current.status === "archived") throw new CoreDomainValidationError("Archived resources cannot be updated");
    const next: CanonicalMediaResource = {
      ...current,
      name: input.name === undefined ? current.name : requiredString(input.name, "name", 120),
      language: input.language === undefined ? current.language : input.language === null ? null : requiredString(input.language, "language", 35),
      accent: input.accent === undefined ? current.accent : nullableString(input.accent, "accent", 80),
      gender: input.gender === undefined ? current.gender : gender(input.gender),
      previewUrl: input.previewUrl === undefined ? current.previewUrl : httpsUrl(input.previewUrl, "previewUrl"),
      thumbnailUrl: input.thumbnailUrl === undefined ? current.thumbnailUrl : httpsUrl(input.thumbnailUrl, "thumbnailUrl"),
      status: input.status === undefined ? current.status : mutableStatus(input.status),
      synchronizedAt: this.now().toISOString(),
    };
    return cloneResource(await this.repository.update(scope, next));
  }

  async archive(scopeInput: TenantScope, resourceId: string): Promise<CanonicalMediaResource> {
    const scope = assertScope(scopeInput);
    const current = await this.get(scope, resourceId);
    if (current.status === "archived") return current;
    return cloneResource(await this.repository.update(scope, {
      ...current,
      status: "archived",
      synchronizedAt: this.now().toISOString(),
    }));
  }

  async options(scopeInput: TenantScope): Promise<CanonicalResourceOptions> {
    const resources = await this.list(scopeInput);
    const toOption = (resource: CanonicalMediaResource): CanonicalResourceOption => ({
      id: resource.id,
      name: resource.name,
      kind: resource.kind,
      language: resource.language,
      accent: resource.accent,
      gender: resource.gender,
      previewUrl: resource.previewUrl,
      thumbnailUrl: resource.thumbnailUrl,
      status: resource.status,
    });
    return {
      avatars: resources.filter((item) => item.kind === "avatar" && item.status === "active").map(toOption),
      voices: resources.filter((item) => item.kind === "voice" && item.status === "active").map(toOption),
    };
  }
}
