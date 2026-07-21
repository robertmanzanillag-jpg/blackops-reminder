import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { hasValidBlackRoomRemoteToken } from "../server/blackroom-control-routes";
import {
  createBlackRoomRemoteControlState,
  isBlackRoomRemoteDeviceOnline,
  readBlackRoomRemoteControl,
  recordBlackRoomRemoteHeartbeat,
  setBlackRoomRemoteCommand,
  writeBlackRoomRemoteControl,
} from "../server/blackroom-remote-control";

test("remote command survives disk persistence and increments its generation", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "blackroom-remote-"));
  const filePath = path.join(directory, "remote.json");
  const now = new Date("2026-07-21T12:00:00.000Z");
  const state = createBlackRoomRemoteControlState(now);
  setBlackRoomRemoteCommand(state, true, 3, now);
  await writeBlackRoomRemoteControl(state, filePath);
  const restored = await readBlackRoomRemoteControl(filePath);
  assert.equal(restored.desiredEnabled, true);
  assert.equal(restored.weeks, 3);
  assert.equal(restored.generation, 1);
});

test("heartbeat reports the Mac online only inside the freshness window", () => {
  const state = createBlackRoomRemoteControlState();
  recordBlackRoomRemoteHeartbeat(state, {
    deviceId: "blackroom-mac",
    queue: { enabled: true },
    worker: { running: true },
    lastError: null,
  }, new Date("2026-07-21T12:00:00.000Z"));
  assert.equal(isBlackRoomRemoteDeviceOnline(state, new Date("2026-07-21T12:01:00.000Z")), true);
  assert.equal(isBlackRoomRemoteDeviceOnline(state, new Date("2026-07-21T12:02:00.000Z")), false);
});

test("device authentication rejects missing, short, placeholder, and incorrect tokens", () => {
  const token = "a-secure-blackroom-device-token-1234567890";
  assert.equal(hasValidBlackRoomRemoteToken(`Bearer ${token}`, token), true);
  assert.equal(hasValidBlackRoomRemoteToken(undefined, token), false);
  assert.equal(hasValidBlackRoomRemoteToken("Bearer wrong", token), false);
  assert.equal(hasValidBlackRoomRemoteToken("Bearer your-token", "your-token"), false);
});
