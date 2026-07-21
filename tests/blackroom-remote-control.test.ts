import assert from "node:assert/strict";
import test from "node:test";
import { blackRoomPage, hasValidBlackRoomRemoteToken } from "../server/blackroom-control-routes";
import {
  createBlackRoomRemoteControlState,
  isBlackRoomRemoteDeviceOnline,
  recordBlackRoomRemoteHeartbeat,
  setBlackRoomRemoteCommand,
} from "../server/blackroom-remote-control";
import { isPublicApiPath } from "../server/user-context";

test("remote command increments its monotonic generation", () => {
  const now = new Date("2026-07-21T12:00:00.000Z");
  const state = createBlackRoomRemoteControlState(now);
  setBlackRoomRemoteCommand(state, true, 3, now);
  assert.equal(state.desiredEnabled, true);
  assert.equal(state.weeks, 3);
  assert.equal(state.generation, 1);
});

test("heartbeat reports the Mac online only inside the freshness window", () => {
  const state = createBlackRoomRemoteControlState();
  recordBlackRoomRemoteHeartbeat(state, {
    deviceId: "blackroom-mac",
    queue: { enabled: true },
    worker: { running: true },
    lastError: null,
    appliedGeneration: 3,
  }, new Date("2026-07-21T12:00:00.000Z"));
  assert.equal(isBlackRoomRemoteDeviceOnline(state, new Date("2026-07-21T12:01:00.000Z")), true);
  assert.equal(isBlackRoomRemoteDeviceOnline(state, new Date("2026-07-21T12:02:00.000Z")), false);
  assert.equal(state.device?.appliedGeneration, 3);
});

test("device authentication rejects missing, short, placeholder, and incorrect tokens", () => {
  const token = "a-secure-blackroom-device-token-1234567890";
  assert.equal(hasValidBlackRoomRemoteToken(`Bearer ${token}`, token), true);
  assert.equal(hasValidBlackRoomRemoteToken(undefined, token), false);
  assert.equal(hasValidBlackRoomRemoteToken("Bearer wrong", token), false);
  assert.equal(hasValidBlackRoomRemoteToken("Bearer your-token", "your-token"), false);
});

test("token-protected BlackRoom bridge paths bypass cookie auth for the local worker", () => {
  assert.equal(isPublicApiPath("/api/blackroom-agent/metricool/schedule"), true);
  assert.equal(isPublicApiPath("/api/blackroom-agent/media/reservation-1"), true);
  assert.equal(isPublicApiPath("/api/blackroom-agent/media/reservation-1/extra"), false);
});

test("offline paused panel keeps Play available so the command can be queued", () => {
  assert.match(blackRoomPage, /pausing=!desired&&remote\.online&&!synced/);
  assert.match(blackRoomPage, /play\.hidden=desired\|\|pausing/);
  const desired = false;
  const remoteOnline = false;
  const synced = false;
  const pausing = !desired && remoteOnline && !synced;
  assert.equal(desired || pausing, false);
});
