import type { AppProject, InsertAppProject } from "@shared/schema";
import { storage } from "./storage";

type DeveloperHealthInventoryDeps = {
  getAppProjects(userId: string): Promise<AppProject[]>;
  createAppProject(userId: string, project: InsertAppProject): Promise<AppProject>;
  updateAppProject(id: string, updates: Partial<AppProject>): Promise<AppProject>;
};

export type DeveloperHealthInventoryResult = {
  created: AppProject[];
  updated: AppProject[];
  unchanged: AppProject[];
  totalKnownApps: number;
};

const KNOWN_DEVELOPER_HEALTH_APPS: InsertAppProject[] = [
  {
    name: "Br Website",
    slug: "br-website",
    description: "Black Room website repo. GitHub: robertmanzanillag-jpg/br-website.",
    environment: "production",
    publicUrl: "https://blackroomus.com",
    healthUrl: null,
    repoOwner: "robertmanzanillag-jpg",
    repoName: "br-website",
    githubRepo: "robertmanzanillag-jpg/br-website",
    deploymentProvider: "custom-domain",
    deploymentId: null,
    testCommand: "npm run check",
    buildCommand: "npm run build",
    sentryProjectId: null,
    stripeAccountId: null,
    stripeWebhookEndpointId: null,
    logSource: null,
    priority: "high",
    ownerLabel: "Robert",
    tags: ["known-github-inventory", "verified-public-url", "needs-health-url"],
  },
  {
    name: "Blackops Reminder",
    slug: "blackops-reminder",
    description: "BlackOps Reminder full-stack TypeScript PWA, also referred to as Dialer Planner when running from its alternate Replit deployment. GitHub: robertmanzanillag-jpg/blackops-reminder.",
    environment: "production",
    publicUrl: "https://robplanner.replit.app",
    healthUrl: "https://robplanner.replit.app/api/health",
    repoOwner: "robertmanzanillag-jpg",
    repoName: "blackops-reminder",
    githubRepo: "robertmanzanillag-jpg/blackops-reminder",
    deploymentProvider: "replit",
    deploymentId: null,
    testCommand: "npm run test:ceo-assistant && npm run test:revenue-engine && npm run test:developer-autopilot && npm run test:app-qa-agent",
    buildCommand: "npm run build",
    sentryProjectId: null,
    stripeAccountId: null,
    stripeWebhookEndpointId: null,
    logSource: null,
    priority: "high",
    ownerLabel: "Robert",
    tags: ["known-github-inventory", "alias-dialer-planner", "alternate-replit-deployment", "liveness-health-endpoint"],
  },
  {
    name: "DROPKIT",
    slug: "dropkit",
    description: "Dropkit app repo. GitHub: robertmanzanillag-jpg/DROPKIT.",
    environment: "production",
    publicUrl: "https://dropkit.replit.app",
    healthUrl: null,
    repoOwner: "robertmanzanillag-jpg",
    repoName: "DROPKIT",
    githubRepo: "robertmanzanillag-jpg/DROPKIT",
    deploymentProvider: "replit",
    deploymentId: null,
    testCommand: "npm run check",
    buildCommand: "npm run build",
    sentryProjectId: null,
    stripeAccountId: null,
    stripeWebhookEndpointId: null,
    logSource: null,
    priority: "high",
    ownerLabel: "Robert",
    tags: ["known-github-inventory", "verified-public-url", "needs-health-url"],
  },
  {
    name: "Kong Nightlife",
    slug: "kong-nightlife",
    description: "Kong Nightlife app repo. GitHub: robertmanzanillag-jpg/kong-nightlife.",
    environment: "production",
    publicUrl: "https://kong--app.replit.app",
    healthUrl: "https://kong--app.replit.app/api/health",
    repoOwner: "robertmanzanillag-jpg",
    repoName: "kong-nightlife",
    githubRepo: "robertmanzanillag-jpg/kong-nightlife",
    deploymentProvider: "replit",
    deploymentId: null,
    testCommand: "npm run check",
    buildCommand: "EXPO_PUBLIC_DOMAIN=kong--app.replit.app npm run expo:static:build",
    sentryProjectId: null,
    stripeAccountId: null,
    stripeWebhookEndpointId: null,
    logSource: null,
    priority: "high",
    ownerLabel: "Robert",
    tags: ["known-github-inventory", "health-verified"],
  },
];

function normalizeRepo(repo: string | null | undefined): string {
  return (repo || "").trim().toLowerCase();
}

function tags(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((tag): tag is string => typeof tag === "string" && tag.trim().length > 0) : [];
}

function mergeTags(existing: unknown, incoming: unknown): string[] {
  return Array.from(new Set([...tags(existing), ...tags(incoming)]));
}

function normalizeKnownAppTags(existing: AppProject, known: InsertAppProject, mergedTags: string[]): string[] {
  const hasPublicUrl = Boolean(known.publicUrl || existing.publicUrl);
  const hasDeploymentProvider = Boolean(known.deploymentProvider || existing.deploymentProvider);
  const hasHealthUrl = Boolean(known.healthUrl || existing.healthUrl);
  const hasTestCommand = Boolean(known.testCommand || existing.testCommand);
  const hasBuildCommand = Boolean(known.buildCommand || existing.buildCommand);
  return mergedTags.filter((tag) => {
    if (hasPublicUrl && tag === "needs-public-url") return false;
    if (hasDeploymentProvider && tag === "needs-deploy-provider") return false;
    if (hasHealthUrl && tag === "needs-health-url") return false;
    if (hasTestCommand && tag === "needs-test-command") return false;
    if (hasBuildCommand && tag === "needs-build-command") return false;
    return true;
  });
}

function mergeKnownApp(existing: AppProject, known: InsertAppProject): Partial<AppProject> {
  const mergedTags = normalizeKnownAppTags(existing, known, mergeTags(existing.tags, known.tags));
  const updates: Partial<AppProject> = {};

  const fields: Array<keyof InsertAppProject> = [
    "name",
    "slug",
    "description",
    "environment",
    "publicUrl",
    "healthUrl",
    "repoOwner",
    "repoName",
    "githubRepo",
    "deploymentProvider",
    "testCommand",
    "buildCommand",
    "priority",
    "ownerLabel",
  ];

  for (const field of fields) {
    const nextValue = known[field];
    if (nextValue === null || nextValue === undefined || nextValue === "") continue;
    if (field === "deploymentProvider" && existing.deploymentProvider === "github-homepage") {
      updates.deploymentProvider = String(nextValue);
      continue;
    }
    if (["publicUrl", "healthUrl", "deploymentProvider"].includes(field) && (existing as any)[field]) continue;
    if ((existing as any)[field] !== nextValue) {
      (updates as any)[field] = nextValue;
    }
  }

  if (JSON.stringify(tags(existing.tags).sort()) !== JSON.stringify(mergedTags.slice().sort())) {
    updates.tags = mergedTags;
  }

  return updates;
}

export function knownDeveloperHealthApps(): InsertAppProject[] {
  return KNOWN_DEVELOPER_HEALTH_APPS.map((app) => ({
    ...app,
    tags: tags(app.tags),
  }));
}

export async function upsertKnownDeveloperHealthInventory(
  userId: string,
  deps: DeveloperHealthInventoryDeps = storage,
): Promise<DeveloperHealthInventoryResult> {
  const existingApps = await deps.getAppProjects(userId);
  const byRepo = new Map(existingApps.map((app) => [normalizeRepo(app.githubRepo), app]));
  const result: DeveloperHealthInventoryResult = {
    created: [],
    updated: [],
    unchanged: [],
    totalKnownApps: KNOWN_DEVELOPER_HEALTH_APPS.length,
  };

  for (const known of KNOWN_DEVELOPER_HEALTH_APPS) {
    const repoKey = normalizeRepo(known.githubRepo);
    const existing = byRepo.get(repoKey);
    if (!existing) {
      result.created.push(await deps.createAppProject(userId, known));
      continue;
    }

    const updates = mergeKnownApp(existing, known);
    if (Object.keys(updates).length === 0) {
      result.unchanged.push(existing);
      continue;
    }

    result.updated.push(await deps.updateAppProject(existing.id, updates));
  }

  return result;
}
