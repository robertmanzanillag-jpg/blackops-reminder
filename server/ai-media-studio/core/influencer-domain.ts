import { randomUUID } from "node:crypto";
import type {
  CreateInfluencerRequest,
  Influencer,
  InfluencerAgeRange,
  InfluencerGender,
  InfluencerStatus,
  UpdateInfluencerRequest,
} from "../../../shared/ai-media-studio-core";
import type { CanonicalMediaResource, CanonicalResourceRepository, TenantScope } from "./resource-domain";
import { CoreDomainNotFoundError, CoreDomainValidationError } from "./resource-domain";

/** Persistence aggregate. Tenant scope and slug never cross the public DTO boundary. */
export type AiInfluencer = Influencer & {
  ownerUserId: string;
  workspaceId: string;
  slug: string;
  archivedAt?: string;
};

export type CreateInfluencerInput = CreateInfluencerRequest;
export type UpdateInfluencerInput = UpdateInfluencerRequest;

export interface InfluencerOption {
  id: string;
  name: string;
  categories: string[];
  language: string;
  voiceId: string;
  avatarId: string;
  status: InfluencerStatus;
}

export interface InfluencerRepository {
  create(scope: TenantScope, influencer: Omit<AiInfluencer, "ownerUserId" | "workspaceId">): Promise<AiInfluencer>;
  get(scope: TenantScope, influencerId: string): Promise<AiInfluencer | undefined>;
  getBySlug(scope: TenantScope, slug: string): Promise<AiInfluencer | undefined>;
  list(scope: TenantScope, filter?: { includeArchived?: boolean }): Promise<AiInfluencer[]>;
  update(scope: TenantScope, influencer: AiInfluencer): Promise<AiInfluencer>;
}

export class InfluencerSlugConflictError extends Error {
  readonly code = "INFLUENCER_SLUG_CONFLICT";
}

const PUBLIC_KEYS = new Set([
  "name", "avatarResourceId", "voiceResourceId", "accent", "language", "gender", "ageRange",
  "personality", "tone", "speakingStyle", "categories", "intro", "outro", "energyLevel",
  "facialExpressions", "brandColors", "status",
]);
const GENDERS = new Set<InfluencerGender>(["female", "male", "non_binary", "unspecified"]);
const STATUSES = new Set<InfluencerStatus>(["draft", "active", "paused", "archived"]);

function assertPlainPublicDto(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new CoreDomainValidationError(`${label} must be a plain object`);
  }
  for (const key of Object.keys(value)) {
    if (!PUBLIC_KEYS.has(key)) {
      throw new CoreDomainValidationError(`${label} contains forbidden or unknown field: ${key}`);
    }
  }
}

function requiredString(value: unknown, field: string, max = 500): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.trim().length > max) {
    throw new CoreDomainValidationError(`${field} must be a non-empty string of at most ${max} characters`);
  }
  return value.trim();
}

function canonicalId(value: unknown, field: string): string | null {
  if (value === null) return null;
  const id = requiredString(value, field, 128);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(id)) throw new CoreDomainValidationError(`${field} is not a canonical ID`);
  return id;
}

function normalizedStringList(value: unknown, field: string, maximum: number): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > maximum) {
    throw new CoreDomainValidationError(`${field} must contain between 1 and ${maximum} values`);
  }
  return [...new Set(value.map((item) => requiredString(item, `${field} item`, 80)))];
}

function normalizedColorList(value: unknown): string[] {
  return normalizedStringList(value, "brandColors", 12).map((color) => {
    const normalized = color.toUpperCase();
    if (!/^#[0-9A-F]{6}$/.test(normalized)) {
      throw new CoreDomainValidationError("brandColors must contain six-digit hexadecimal colors");
    }
    return normalized;
  });
}

function influencerStatus(value: unknown): InfluencerStatus {
  if (typeof value !== "string" || !STATUSES.has(value as InfluencerStatus)) {
    throw new CoreDomainValidationError("status must be draft, active, paused, or archived");
  }
  return value as InfluencerStatus;
}

function influencerGender(value: unknown): InfluencerGender {
  if (typeof value !== "string" || !GENDERS.has(value as InfluencerGender)) {
    throw new CoreDomainValidationError("gender must be female, male, non_binary, or unspecified");
  }
  return value as InfluencerGender;
}

function ageRange(value: unknown): InfluencerAgeRange {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new CoreDomainValidationError("ageRange must be an object");
  }
  const keys = Object.keys(value);
  if (keys.some((key) => key !== "minimum" && key !== "maximum")) {
    throw new CoreDomainValidationError("ageRange contains unknown fields");
  }
  const minimum = (value as { minimum?: unknown }).minimum;
  const maximum = (value as { maximum?: unknown }).maximum;
  if (!Number.isInteger(minimum) || !Number.isInteger(maximum)
    || (minimum as number) < 18 || (maximum as number) > 120 || (minimum as number) > (maximum as number)) {
    throw new CoreDomainValidationError("ageRange must contain integer ages from 18 to 120 with minimum <= maximum");
  }
  return { minimum: minimum as number, maximum: maximum as number };
}

function energyLevel(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 10) {
    throw new CoreDomainValidationError("energyLevel must be an integer from 1 to 10");
  }
  return value;
}

function slugFromName(name: string): string {
  const generated = name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80).replace(/-$/g, "");
  if (!generated) throw new CoreDomainValidationError("name must contain characters usable in a slug");
  return generated;
}

function scope(value: TenantScope): TenantScope {
  return {
    ownerUserId: requiredString(value.ownerUserId, "ownerUserId", 256),
    workspaceId: requiredString(value.workspaceId, "workspaceId", 256),
  };
}

function cloneInfluencer(value: AiInfluencer): AiInfluencer {
  return {
    ...value,
    ageRange: { ...value.ageRange },
    personality: [...value.personality],
    tone: [...value.tone],
    categories: [...value.categories],
    facialExpressions: [...value.facialExpressions],
    brandColors: [...value.brandColors],
  };
}

async function linkedResource(
  repository: CanonicalResourceRepository,
  tenant: TenantScope,
  id: string,
  expectedKind: "avatar" | "voice",
): Promise<CanonicalMediaResource> {
  const resource = await repository.get(tenant, id);
  if (!resource || resource.kind !== expectedKind) {
    throw new CoreDomainValidationError(`${expectedKind}ResourceId must reference a canonical ${expectedKind} in this workspace`);
  }
  if (resource.status !== "active") throw new CoreDomainValidationError(`${expectedKind} resource must be active`);
  return resource;
}

async function validateLinks(
  repository: CanonicalResourceRepository,
  tenant: TenantScope,
  avatarResourceId: string | null,
  voiceResourceId: string | null,
  status: InfluencerStatus,
): Promise<void> {
  if (status === "archived") return;
  if (status !== "draft" && (!avatarResourceId || !voiceResourceId)) {
    throw new CoreDomainValidationError("Active or paused influencers require canonical avatar and voice resources");
  }
  const validations: Promise<CanonicalMediaResource>[] = [];
  if (avatarResourceId) validations.push(linkedResource(repository, tenant, avatarResourceId, "avatar"));
  if (voiceResourceId) validations.push(linkedResource(repository, tenant, voiceResourceId, "voice"));
  await Promise.all(validations);
}

export interface InfluencerServiceOptions {
  idFactory?: () => string;
  now?: () => Date;
}

export class InfluencerService {
  private readonly idFactory: () => string;
  private readonly now: () => Date;

  constructor(
    private readonly repository: InfluencerRepository,
    private readonly resources: CanonicalResourceRepository,
    options: InfluencerServiceOptions = {},
  ) {
    this.idFactory = options.idFactory ?? randomUUID;
    this.now = options.now ?? (() => new Date());
  }

  async create(scopeInput: TenantScope, input: CreateInfluencerInput): Promise<AiInfluencer> {
    const tenant = scope(scopeInput);
    assertPlainPublicDto(input, "influencer input");
    const name = requiredString(input.name, "name", 120);
    const slug = slugFromName(name);
    if (await this.repository.getBySlug(tenant, slug)) {
      throw new InfluencerSlugConflictError(`Influencer slug already exists in this workspace: ${slug}`);
    }
    const nextStatus = influencerStatus(input.status);
    if (nextStatus === "archived") throw new CoreDomainValidationError("New influencers cannot be archived");
    const avatarResourceId = canonicalId(input.avatarResourceId, "avatarResourceId");
    const voiceResourceId = canonicalId(input.voiceResourceId, "voiceResourceId");
    await validateLinks(this.resources, tenant, avatarResourceId, voiceResourceId, nextStatus);
    const timestamp = this.now().toISOString();
    const influencer: Omit<AiInfluencer, "ownerUserId" | "workspaceId"> = {
      id: this.idFactory(),
      slug,
      name,
      avatarResourceId,
      voiceResourceId,
      accent: requiredString(input.accent, "accent", 80),
      language: requiredString(input.language, "language", 35),
      gender: influencerGender(input.gender),
      ageRange: ageRange(input.ageRange),
      personality: normalizedStringList(input.personality, "personality", 20),
      tone: normalizedStringList(input.tone, "tone", 12),
      speakingStyle: requiredString(input.speakingStyle, "speakingStyle", 500),
      categories: normalizedStringList(input.categories, "categories", 30),
      intro: requiredString(input.intro, "intro", 1_000),
      outro: requiredString(input.outro, "outro", 1_000),
      energyLevel: energyLevel(input.energyLevel),
      facialExpressions: normalizedStringList(input.facialExpressions, "facialExpressions", 20),
      brandColors: normalizedColorList(input.brandColors),
      status: nextStatus,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    return cloneInfluencer(await this.repository.create(tenant, influencer));
  }

  async get(scopeInput: TenantScope, influencerId: string): Promise<AiInfluencer> {
    const tenant = scope(scopeInput);
    const influencer = await this.repository.get(tenant, requiredString(influencerId, "influencerId", 128));
    if (!influencer) throw new CoreDomainNotFoundError("AI influencer not found");
    return cloneInfluencer(influencer);
  }

  async list(scopeInput: TenantScope, filter: { includeArchived?: boolean } = {}): Promise<AiInfluencer[]> {
    return (await this.repository.list(scope(scopeInput), filter)).map(cloneInfluencer);
  }

  async update(scopeInput: TenantScope, influencerId: string, input: UpdateInfluencerInput): Promise<AiInfluencer> {
    const tenant = scope(scopeInput);
    assertPlainPublicDto(input, "influencer update");
    if (Object.keys(input).length === 0) throw new CoreDomainValidationError("At least one influencer field is required");
    const current = await this.get(tenant, influencerId);
    if (current.status === "archived") throw new CoreDomainValidationError("Archived influencers cannot be updated");
    const nextStatus = input.status === undefined ? current.status : influencerStatus(input.status);
    const avatarResourceId = input.avatarResourceId === undefined ? current.avatarResourceId : canonicalId(input.avatarResourceId, "avatarResourceId");
    const voiceResourceId = input.voiceResourceId === undefined ? current.voiceResourceId : canonicalId(input.voiceResourceId, "voiceResourceId");
    await validateLinks(this.resources, tenant, avatarResourceId, voiceResourceId, nextStatus);
    const timestamp = this.now().toISOString();
    const next: AiInfluencer = {
      ...current,
      name: input.name === undefined ? current.name : requiredString(input.name, "name", 120),
      avatarResourceId,
      voiceResourceId,
      accent: input.accent === undefined ? current.accent : requiredString(input.accent, "accent", 80),
      language: input.language === undefined ? current.language : requiredString(input.language, "language", 35),
      gender: input.gender === undefined ? current.gender : influencerGender(input.gender),
      ageRange: input.ageRange === undefined ? current.ageRange : ageRange(input.ageRange),
      personality: input.personality === undefined ? current.personality : normalizedStringList(input.personality, "personality", 20),
      tone: input.tone === undefined ? current.tone : normalizedStringList(input.tone, "tone", 12),
      speakingStyle: input.speakingStyle === undefined ? current.speakingStyle : requiredString(input.speakingStyle, "speakingStyle", 500),
      categories: input.categories === undefined ? current.categories : normalizedStringList(input.categories, "categories", 30),
      intro: input.intro === undefined ? current.intro : requiredString(input.intro, "intro", 1_000),
      outro: input.outro === undefined ? current.outro : requiredString(input.outro, "outro", 1_000),
      energyLevel: input.energyLevel === undefined ? current.energyLevel : energyLevel(input.energyLevel),
      facialExpressions: input.facialExpressions === undefined ? current.facialExpressions : normalizedStringList(input.facialExpressions, "facialExpressions", 20),
      brandColors: input.brandColors === undefined ? current.brandColors : normalizedColorList(input.brandColors),
      status: nextStatus,
      archivedAt: nextStatus === "archived" ? timestamp : undefined,
      updatedAt: timestamp,
    };
    return cloneInfluencer(await this.repository.update(tenant, next));
  }

  async archive(scopeInput: TenantScope, influencerId: string): Promise<AiInfluencer> {
    const tenant = scope(scopeInput);
    const current = await this.get(tenant, influencerId);
    if (current.status === "archived") return current;
    const timestamp = this.now().toISOString();
    return cloneInfluencer(await this.repository.update(tenant, {
      ...current,
      status: "archived",
      archivedAt: timestamp,
      updatedAt: timestamp,
    }));
  }

  async options(scopeInput: TenantScope): Promise<InfluencerOption[]> {
    const tenant = scope(scopeInput);
    const influencers = (await this.list(tenant)).filter((item) => item.status === "active");
    const resourceIds = [...new Set(influencers.flatMap((item) => [item.avatarResourceId, item.voiceResourceId]))]
      .filter((id): id is string => id !== null);
    const resources = new Map((await this.resources.getMany(tenant, resourceIds)).map((resource) => [resource.id, resource]));
    return influencers.filter((item): item is AiInfluencer & { avatarResourceId: string; voiceResourceId: string } => {
      if (!item.avatarResourceId || !item.voiceResourceId) return false;
      const avatar = resources.get(item.avatarResourceId);
      const voice = resources.get(item.voiceResourceId);
      return avatar?.kind === "avatar" && avatar.status === "active"
        && voice?.kind === "voice" && voice.status === "active";
    }).map((item) => ({
      id: item.id,
      name: item.name,
      categories: [...item.categories],
      language: item.language,
      voiceId: item.voiceResourceId,
      avatarId: item.avatarResourceId,
      status: item.status,
    }));
  }
}
