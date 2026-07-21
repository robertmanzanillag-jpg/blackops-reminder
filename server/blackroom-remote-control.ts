import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export const BLACKROOM_REMOTE_CONTROL_PATH = "clippers_workspace/blackroom/agent/remote-control.json";
export const BLACKROOM_REMOTE_ONLINE_WINDOW_MS = 90_000;

export interface BlackRoomRemoteDeviceStatus {
  deviceId: string;
  seenAt: string;
  queue: Record<string, unknown>;
  worker: Record<string, unknown>;
  lastError: string | null;
}

export interface BlackRoomRemoteControlState {
  version: 1;
  desiredEnabled: boolean;
  weeks: number;
  generation: number;
  updatedAt: string;
  device: BlackRoomRemoteDeviceStatus | null;
}

export function createBlackRoomRemoteControlState(now = new Date()): BlackRoomRemoteControlState {
  return {
    version: 1,
    desiredEnabled: false,
    weeks: 2,
    generation: 0,
    updatedAt: now.toISOString(),
    device: null,
  };
}

export function setBlackRoomRemoteCommand(
  state: BlackRoomRemoteControlState,
  enabled: boolean,
  weeks = state.weeks,
  now = new Date(),
): BlackRoomRemoteControlState {
  state.desiredEnabled = enabled;
  state.weeks = Math.max(1, Math.min(4, Math.floor(Number.isFinite(weeks) ? weeks : 2)));
  state.generation += 1;
  state.updatedAt = now.toISOString();
  return state;
}

export function recordBlackRoomRemoteHeartbeat(
  state: BlackRoomRemoteControlState,
  input: Omit<BlackRoomRemoteDeviceStatus, "seenAt">,
  now = new Date(),
): BlackRoomRemoteControlState {
  state.device = {
    deviceId: String(input.deviceId || "blackroom-mac").slice(0, 100),
    seenAt: now.toISOString(),
    queue: input.queue && typeof input.queue === "object" ? input.queue : {},
    worker: input.worker && typeof input.worker === "object" ? input.worker : {},
    lastError: input.lastError ? String(input.lastError).slice(0, 1_000) : null,
  };
  return state;
}

export function isBlackRoomRemoteDeviceOnline(state: BlackRoomRemoteControlState, now = new Date()): boolean {
  if (!state.device?.seenAt) return false;
  const seenAt = new Date(state.device.seenAt).getTime();
  return Number.isFinite(seenAt) && now.getTime() - seenAt <= BLACKROOM_REMOTE_ONLINE_WINDOW_MS;
}

export async function readBlackRoomRemoteControl(
  filePath = process.env.BLACKROOM_REMOTE_CONTROL_PATH || BLACKROOM_REMOTE_CONTROL_PATH,
): Promise<BlackRoomRemoteControlState> {
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8")) as Partial<BlackRoomRemoteControlState>;
    return {
      ...createBlackRoomRemoteControlState(),
      ...parsed,
      version: 1,
      desiredEnabled: Boolean(parsed.desiredEnabled),
      weeks: Math.max(1, Math.min(4, Math.floor(Number(parsed.weeks || 2)))),
      generation: Math.max(0, Math.floor(Number(parsed.generation || 0))),
      device: parsed.device || null,
    };
  } catch (error: any) {
    if (error?.code === "ENOENT") return createBlackRoomRemoteControlState();
    throw error;
  }
}

export async function writeBlackRoomRemoteControl(
  state: BlackRoomRemoteControlState,
  filePath = process.env.BLACKROOM_REMOTE_CONTROL_PATH || BLACKROOM_REMOTE_CONTROL_PATH,
): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp`;
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await rename(temporary, filePath);
}
