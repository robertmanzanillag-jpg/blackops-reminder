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

export interface BlackRoomRemoteControlState {
  version: 1;
  desiredEnabled: boolean;
  weeks: number;
  generation: number;
  updatedAt: string;
  device: BlackRoomRemoteDeviceStatus | null;
  commands: BlackRoomRemoteCommand[];
  chatHistory: Array<{ id: string; role: "user" | "assistant"; text: string; createdAt: string }>;
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
  };
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
