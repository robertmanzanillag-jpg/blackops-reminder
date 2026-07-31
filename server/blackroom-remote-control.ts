import { eq, sql } from "drizzle-orm";
import { blackRoomRemoteControl } from "@shared/schema";
import type { BlackRoomRemoteCommand } from "./blackroom-chat";

export const BLACKROOM_REMOTE_ONLINE_WINDOW_MS = 90_000;
const BLACKROOM_REMOTE_CONTROL_ID = "blackroom-primary";
let initializationPromise: Promise<void> | undefined;

export interface BlackRoomRemoteDeviceStatus {
  deviceId: string;
  seenAt: string;
  queue: Record<string, unknown>;
  worker: Record<string, unknown>;
  lastError: string | null;
  appliedGeneration: number;
}

export interface BlackRoomActivityEvent {
  id: string;
  createdAt: string;
  stage: string;
  level: "info" | "success" | "error";
  message: string;
}

export type BlackRoomAnalyticsNetwork = "tiktok" | "facebook" | "youtube";

export interface BlackRoomImportedAnalyticsSample {
  id: string;
  views: number;
  publishedAt?: string;
  durationSeconds?: number;
}

export interface BlackRoomAnalyticsImport {
  samples: BlackRoomImportedAnalyticsSample[];
  sourceFiles: string[];
  importedAt: string;
}

export interface BlackRoomRescheduleExperiment {
  postId: string;
  uuid: string;
  network: BlackRoomAnalyticsNetwork;
  from: string;
  to: string;
  movedAt: string;
  status: "verified" | "uncertain" | "failed";
  error?: string;
}

export interface BlackRoomRescheduleLearning {
  lastCheckedAt: string | null;
  lastMovedAt: string | null;
  movedCount: number;
  lastError: string | null;
  experiments: BlackRoomRescheduleExperiment[];
}

export interface BlackRoomRemoteControlState {
  version: 1;
  desiredEnabled: boolean;
  weeks: number;
  generation: number;
  updatedAt: string;
  device: BlackRoomRemoteDeviceStatus | null;
  commands: BlackRoomRemoteCommand[];
  chatHistory: Array<{ id: string; role: "user" | "assistant"; text: string; createdAt: string }>;
  analyticsImports: Partial<Record<BlackRoomAnalyticsNetwork, BlackRoomAnalyticsImport>>;
  rescheduleLearning: BlackRoomRescheduleLearning;
}

export function createBlackRoomRemoteControlState(now = new Date()): BlackRoomRemoteControlState {
  return {
    version: 1,
    desiredEnabled: false,
    weeks: 2,
    generation: 0,
    updatedAt: now.toISOString(),
    device: null,
    commands: [],
    chatHistory: [],
    analyticsImports: {},
    rescheduleLearning: { lastCheckedAt: null, lastMovedAt: null, movedCount: 0, lastError: null, experiments: [] },
  };
}

function normalizeRescheduleLearning(value: unknown): BlackRoomRescheduleLearning {
  const raw = value && typeof value === "object" ? value as Partial<BlackRoomRescheduleLearning> : {};
  const experiments = Array.isArray(raw.experiments) ? raw.experiments.flatMap((item) => {
    const experiment = item && typeof item === "object" ? item as Partial<BlackRoomRescheduleExperiment> : {};
    const network = String(experiment.network);
    const status = String(experiment.status);
    if (!experiment.postId || !experiment.uuid || !["tiktok", "facebook", "youtube"].includes(network)
      || !["verified", "uncertain", "failed"].includes(status)) return [];
    return [{ ...experiment, network, status } as BlackRoomRescheduleExperiment];
  }).slice(-200) : [];
  return {
    lastCheckedAt: raw.lastCheckedAt || null,
    lastMovedAt: raw.lastMovedAt || null,
    movedCount: experiments.filter((item) => item.status === "verified").length,
    lastError: raw.lastError ? String(raw.lastError).slice(0, 500) : null,
    experiments,
  };
}

export function recordBlackRoomRescheduleReport(
  state: BlackRoomRemoteControlState,
  report: { checkedAt: string; experiments: BlackRoomRescheduleExperiment[]; error?: string },
): BlackRoomRemoteControlState {
  state.rescheduleLearning.experiments = [...state.rescheduleLearning.experiments, ...report.experiments].slice(-200);
  state.rescheduleLearning.lastCheckedAt = report.checkedAt;
  const moved = report.experiments.filter((item) => item.status === "verified");
  if (moved.length) state.rescheduleLearning.lastMovedAt = report.checkedAt;
  state.rescheduleLearning.movedCount = state.rescheduleLearning.experiments.filter((item) => item.status === "verified").length;
  state.rescheduleLearning.lastError = report.error || report.experiments.find((item) => item.status === "failed")?.error || null;
  state.updatedAt = report.checkedAt;
  return state;
}

function normalizeImportedAnalyticsSample(value: unknown): BlackRoomImportedAnalyticsSample | null {
  const sample = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const id = String(sample.id || "").trim().slice(0, 500);
  const views = Math.floor(Number(sample.views));
  if (!id || !Number.isSafeInteger(views) || views < 0) return null;
  const rawPublishedAt = String(sample.publishedAt || "").trim();
  const publishedAt = rawPublishedAt && Number.isFinite(new Date(rawPublishedAt).getTime())
    ? rawPublishedAt.slice(0, 40)
    : undefined;
  const rawDuration = Math.round(Number(sample.durationSeconds));
  const durationSeconds = Number.isSafeInteger(rawDuration) && rawDuration > 0 && rawDuration <= 86_400
    ? rawDuration
    : undefined;
  return { id, views, ...(publishedAt ? { publishedAt } : {}), ...(durationSeconds ? { durationSeconds } : {}) };
}

function normalizeAnalyticsImports(value: unknown): BlackRoomRemoteControlState["analyticsImports"] {
  const imports = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return Object.fromEntries((["tiktok", "facebook", "youtube"] as BlackRoomAnalyticsNetwork[]).flatMap((network) => {
    const raw = imports[network] && typeof imports[network] === "object"
      ? imports[network] as Record<string, unknown>
      : null;
    if (!raw) return [];
    const samples = Array.isArray(raw.samples)
      ? raw.samples.map(normalizeImportedAnalyticsSample).filter((sample): sample is BlackRoomImportedAnalyticsSample => Boolean(sample)).slice(-10_000)
      : [];
    const sourceFiles = Array.isArray(raw.sourceFiles)
      ? [...new Set(raw.sourceFiles.map((file) => String(file || "").trim().slice(0, 240)).filter(Boolean))].slice(-100)
      : [];
    const importedAt = String(raw.importedAt || "");
    return [[network, {
      samples,
      sourceFiles,
      importedAt: Number.isFinite(new Date(importedAt).getTime()) ? importedAt : new Date(0).toISOString(),
    }]];
  })) as BlackRoomRemoteControlState["analyticsImports"];
}

export function upsertBlackRoomAnalyticsImports(
  state: BlackRoomRemoteControlState,
  imports: Array<{ network: BlackRoomAnalyticsNetwork; sourceFiles?: string[]; samples: unknown[] }>,
  now = new Date(),
): Record<BlackRoomAnalyticsNetwork, number> {
  const totals = { tiktok: 0, facebook: 0, youtube: 0 };
  for (const input of imports) {
    const current = state.analyticsImports[input.network];
    const byId = new Map((current?.samples || []).map((sample) => [sample.id, sample]));
    for (const value of input.samples.slice(0, 2_000)) {
      const sample = normalizeImportedAnalyticsSample(value);
      if (sample) byId.set(sample.id, sample);
    }
    const samples = [...byId.values()]
      .sort((left, right) => String(left.publishedAt || "").localeCompare(String(right.publishedAt || "")))
      .slice(-10_000);
    const sourceFiles = [...new Set([
      ...(current?.sourceFiles || []),
      ...(input.sourceFiles || []).map((file) => String(file || "").split(/[\\/]/).pop() || ""),
    ].map((file) => file.trim().slice(0, 240)).filter(Boolean))].slice(-100);
    state.analyticsImports[input.network] = { samples, sourceFiles, importedAt: now.toISOString() };
    totals[input.network] = samples.length;
  }
  state.updatedAt = now.toISOString();
  return totals;
}

export function setBlackRoomRemoteCommand(
  state: BlackRoomRemoteControlState,
  enabled: boolean,
  weeks = state.weeks,
  now = new Date(),
): BlackRoomRemoteControlState {
  state.desiredEnabled = enabled;
  state.weeks = Math.max(2, Math.min(4, Math.floor(Number.isFinite(weeks) ? weeks : 2)));
  state.generation += 1;
  state.updatedAt = now.toISOString();
  return state;
}

export function recordBlackRoomRemoteHeartbeat(
  state: BlackRoomRemoteControlState,
  input: Omit<BlackRoomRemoteDeviceStatus, "seenAt">,
  now = new Date(),
): BlackRoomRemoteControlState {
  const worker = input.worker && typeof input.worker === "object" ? input.worker as Record<string, unknown> : {};
  const activity = Array.isArray(worker.activity) ? worker.activity.slice(-80).map((item, index) => {
    const event = item && typeof item === "object" ? item as Record<string, unknown> : {};
    const createdAt = String(event.createdAt || now.toISOString());
    return {
      id: String(event.id || `${createdAt}-${index}`).slice(0, 160),
      createdAt: Number.isFinite(new Date(createdAt).getTime()) ? createdAt : now.toISOString(),
      stage: String(event.stage || "sistema").slice(0, 80),
      level: (["info", "success", "error"].includes(String(event.level)) ? String(event.level) : "info") as BlackRoomActivityEvent["level"],
      message: String(event.message || "").trim().slice(0, 1_000),
    };
  }).filter((event) => event.message) : [];
  state.device = {
    deviceId: String(input.deviceId || "blackroom-mac").slice(0, 100),
    seenAt: now.toISOString(),
    queue: input.queue && typeof input.queue === "object" ? input.queue : {},
    worker: { ...worker, activity },
    lastError: input.lastError ? String(input.lastError).slice(0, 1_000) : null,
    appliedGeneration: Math.max(0, Math.floor(Number(input.appliedGeneration || 0))),
  };
  return state;
}

export function appendBlackRoomRemoteCommand(
  state: BlackRoomRemoteControlState,
  input: { message: string; reply: string; command: BlackRoomRemoteCommand | null },
  now = new Date(),
): BlackRoomRemoteControlState {
  const createdAt = now.toISOString();
  state.chatHistory.push(
    { id: `${createdAt}-user`, role: "user", text: input.message.slice(0, 1_000), createdAt },
    { id: `${createdAt}-assistant`, role: "assistant", text: input.reply.slice(0, 2_000), createdAt },
  );
  state.chatHistory = state.chatHistory.slice(-40);
  if (input.command) {
    state.commands.push(input.command);
    state.commands = state.commands.slice(-100);
    state.generation += 1;
    state.updatedAt = createdAt;
  }
  return state;
}

export function appendBlackRoomCeoCommand(
  state: BlackRoomRemoteControlState,
  command: Extract<BlackRoomRemoteCommand, { type: "ceo_schedule" }>,
): BlackRoomRemoteControlState {
  if (state.commands.some((item) => item.id === command.id)) return state;
  state.commands.push(command);
  state.commands = state.commands.slice(-100);
  state.generation += 1;
  state.updatedAt = command.createdAt;
  return state;
}

export function isBlackRoomRemoteDeviceOnline(state: BlackRoomRemoteControlState, now = new Date()): boolean {
  if (!state.device?.seenAt) return false;
  const seenAt = new Date(state.device.seenAt).getTime();
  return Number.isFinite(seenAt) && now.getTime() - seenAt <= BLACKROOM_REMOTE_ONLINE_WINDOW_MS;
}

function normalizeRemoteControlState(value: unknown): BlackRoomRemoteControlState {
  const parsed = value && typeof value === "object" ? value as Partial<BlackRoomRemoteControlState> : {};
  return {
    ...createBlackRoomRemoteControlState(),
    ...parsed,
    version: 1,
    desiredEnabled: Boolean(parsed.desiredEnabled),
    weeks: Math.max(2, Math.min(4, Math.floor(Number(parsed.weeks || 2)))),
    generation: Math.max(0, Math.floor(Number(parsed.generation || 0))),
    device: parsed.device || null,
    commands: Array.isArray(parsed.commands) ? parsed.commands.slice(-100) : [],
    chatHistory: Array.isArray(parsed.chatHistory) ? parsed.chatHistory.slice(-40) : [],
    analyticsImports: normalizeAnalyticsImports(parsed.analyticsImports),
    rescheduleLearning: normalizeRescheduleLearning(parsed.rescheduleLearning),
  };
}

async function database() {
  return (await import("./db")).db;
}

export async function initializeBlackRoomRemoteControlPersistence(): Promise<void> {
  initializationPromise ??= database().then((db) => db.execute(sql`
      CREATE TABLE IF NOT EXISTS blackroom_remote_control (
        id varchar PRIMARY KEY,
        data jsonb NOT NULL,
        revision integer NOT NULL DEFAULT 1,
        updated_at timestamp NOT NULL DEFAULT now()
      )
    `)).then(() => undefined).catch((error) => {
      initializationPromise = undefined;
      throw error;
    });
  await initializationPromise;
}

export async function readBlackRoomRemoteControl(): Promise<BlackRoomRemoteControlState> {
  await initializeBlackRoomRemoteControlPersistence();
  const db = await database();
  const [row] = await db.select().from(blackRoomRemoteControl).where(eq(blackRoomRemoteControl.id, BLACKROOM_REMOTE_CONTROL_ID));
  return row ? normalizeRemoteControlState(row.data) : createBlackRoomRemoteControlState();
}

export async function mutateBlackRoomRemoteControl(
  mutation: (state: BlackRoomRemoteControlState) => void,
): Promise<BlackRoomRemoteControlState> {
  await initializeBlackRoomRemoteControlPersistence();
  const db = await database();
  return db.transaction(async (tx) => {
    let [row] = await tx.select().from(blackRoomRemoteControl)
      .where(eq(blackRoomRemoteControl.id, BLACKROOM_REMOTE_CONTROL_ID)).for("update");
    if (!row) {
      await tx.insert(blackRoomRemoteControl).values({
        id: BLACKROOM_REMOTE_CONTROL_ID,
        data: createBlackRoomRemoteControlState(),
      }).onConflictDoNothing();
      [row] = await tx.select().from(blackRoomRemoteControl)
        .where(eq(blackRoomRemoteControl.id, BLACKROOM_REMOTE_CONTROL_ID)).for("update");
    }
    if (!row) throw new Error("BlackRoom remote control row could not be initialized");
    const state = normalizeRemoteControlState(row.data);
    mutation(state);
    await tx.update(blackRoomRemoteControl).set({
      data: state,
      revision: row.revision + 1,
      updatedAt: new Date(),
    }).where(eq(blackRoomRemoteControl.id, BLACKROOM_REMOTE_CONTROL_ID));
    return state;
  });
}
