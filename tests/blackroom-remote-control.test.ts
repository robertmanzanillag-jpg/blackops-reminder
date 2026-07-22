import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { BLACKROOM_PUBLIC_MEDIA_PATHS, blackRoomMediaHeaders, blackRoomPage, hasBlackRoomChatAccess, hasValidBlackRoomRemoteToken, parseBlackRoomMediaRange, resolveBlackRoomPanelAgent } from "../server/blackroom-control-routes";
import {
  createBlackRoomRemoteControlState,
  isBlackRoomRemoteDeviceOnline,
  recordBlackRoomRemoteHeartbeat,
  setBlackRoomRemoteCommand,
  appendBlackRoomRemoteCommand,
  appendBlackRoomCeoCommand,
} from "../server/blackroom-remote-control";
import { isPublicApiPath } from "../server/user-context";
import { DEFAULT_DEV_USER_ID } from "../server/user-context";
import { isConfiguredSingleUserOwner } from "../server/single-user-owner";

test("tools page links its BlackRoom card directly to the live panel", () => {
  const toolsPage = readFileSync("client/src/pages/tools.tsx", "utf8");

  assert.match(toolsPage, /<a href="\/blackroom" data-testid="tool-blackroom">/);
  assert.doesNotMatch(toolsPage, /<Link href="\/blackroom">/);
  assert.match(blackRoomPage, /<title>BlackRoom Content Agent<\/title>/);
});

test("remote command increments its monotonic generation", () => {
  const now = new Date("2026-07-21T12:00:00.000Z");
  const state = createBlackRoomRemoteControlState(now);
  setBlackRoomRemoteCommand(state, true, 3, now);
  assert.equal(state.desiredEnabled, true);
  assert.equal(state.weeks, 3);
  assert.equal(state.generation, 1);
});

test("remote control cannot reduce the campaign below two weeks", () => {
  const state = createBlackRoomRemoteControlState();
  setBlackRoomRemoteCommand(state, true, 1);
  assert.equal(state.weeks, 2);
});

test("CEO schedule advances the generation without adding fake chat messages", () => {
  const now = new Date("2026-07-22T12:00:00.000Z");
  const state = createBlackRoomRemoteControlState(now);
  appendBlackRoomCeoCommand(state, {
    id: "ceo-1", type: "ceo_schedule", slotsByDate: { "2026-07-23": ["00:30", "04:00"] }, createdAt: now.toISOString(),
    analytics: { sampleCount: 4, lastCheckedAt: now.toISOString(), nextCheckAt: now.toISOString(), confidence: "collecting", networkSamples: { tiktok: 2, facebook: 1, youtube: 1 }, recommendedTimes: [], reason: "collecting" },
  });
  assert.equal(state.generation, 1);
  assert.equal(state.commands.at(-1)?.type, "ceo_schedule");
  assert.equal(state.chatHistory.length, 0);
});

test("BlackRoom shared controls accept only the configured owner", async () => {
  assert.equal(await isConfiguredSingleUserOwner(DEFAULT_DEV_USER_ID), true);
  assert.equal(await isConfiguredSingleUserOwner("not-the-owner"), false);
  const request = (userId: string) => ({
    headers: {},
    header: (name: string) => name.toLowerCase() === "x-user-id" ? userId : undefined,
  }) as any;
  assert.equal(await hasBlackRoomChatAccess(request(DEFAULT_DEV_USER_ID)), true);
  assert.equal(await hasBlackRoomChatAccess(request("not-the-owner")), false);
});

test("chat command is persisted and advances the remote generation", () => {
  const now = new Date("2026-07-21T12:00:00.000Z");
  const state = createBlackRoomRemoteControlState(now);
  appendBlackRoomRemoteCommand(state, {
    message: "sube 3 videos más hoy",
    reply: "Listo",
    command: { id: "extra-3", type: "extra_posts", posts: 3, targetDate: "2026-07-21", createdAt: now.toISOString() },
  }, now);
  assert.equal(state.generation, 1);
  assert.equal(state.commands.length, 1);
  assert.deepEqual(state.chatHistory.map((message) => message.role), ["user", "assistant"]);
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

test("panel keeps last confirmed delivery counters when the Mac goes offline", () => {
  const localQueue = {
    enabled: true, pausedAt: null, updatedAt: "2026-07-22T07:00:00.000Z", timezone: "America/New_York",
    bufferDays: 14, bufferWeeks: 2, postsPerDay: 10, pendingPrioritySources: 0, usedSourceVideos: 0,
    durationSamples: {}, analytics: {}, nextJob: null,
    totals: { queued: 15, processing: 0, retry: 1, scheduled: 0, completed: 0 },
  } as any;
  const remoteQueue = {
    ...localQueue,
    totals: { ...localQueue.totals, scheduled: 3, completed: 1 },
    delivery: { scheduled: 3, completed: 1, confirmed: 4 },
  };

  assert.equal(resolveBlackRoomPanelAgent(localQueue, remoteQueue, true), remoteQueue);
  assert.deepEqual(resolveBlackRoomPanelAgent(localQueue, remoteQueue, false).totals, {
    queued: 15, processing: 0, retry: 1, scheduled: 3, completed: 1,
  });
  assert.deepEqual(resolveBlackRoomPanelAgent(localQueue, remoteQueue, false).delivery, remoteQueue.delivery);
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
  assert.equal(isPublicApiPath("/api/blackroom-agent/media/reservation-1.mp4"), true);
  assert.equal(isPublicApiPath("/api/blackroom-agent/media/chunked/upload-1/0"), true);
  assert.equal(isPublicApiPath("/api/blackroom-agent/media/chunked/upload-1/complete"), true);
  assert.equal(isPublicApiPath("/api/blackroom-agent/media/chunked/upload-1/delete"), false);
  assert.equal(isPublicApiPath("/api/blackroom-agent/media/reservation-1/extra"), false);
});

test("public MP4 serving accepts browser and video-probe byte ranges", () => {
  assert.equal(BLACKROOM_PUBLIC_MEDIA_PATHS[0], "/api/blackroom-agent/media/:uploadId.mp4");
  assert.equal(parseBlackRoomMediaRange(undefined, 1_000), null);
  assert.deepEqual(parseBlackRoomMediaRange("bytes=0-99", 1_000), { start: 0, end: 99 });
  assert.deepEqual(parseBlackRoomMediaRange("bytes=900-", 1_000), { start: 900, end: 999 });
  assert.deepEqual(parseBlackRoomMediaRange("bytes=-100", 1_000), { start: 900, end: 999 });
  assert.equal(parseBlackRoomMediaRange("bytes=1000-", 1_000), false);
  assert.equal(parseBlackRoomMediaRange("items=0-1", 1_000), false);
});

test("full MP4 downloads stream through deployment proxies without a fixed response length", () => {
  const fullGet = blackRoomMediaHeaders("upload-1", 92_157_383, null, "GET");
  assert.equal(fullGet["Content-Length"], undefined);
  assert.equal(fullGet["Accept-Ranges"], "bytes");
  assert.equal(fullGet["Content-Type"], "video/mp4");

  const head = blackRoomMediaHeaders("upload-1", 92_157_383, null, "HEAD");
  assert.equal(head["Content-Length"], "92157383");

  const range = blackRoomMediaHeaders("upload-1", 92_157_383, { start: 0, end: 1_048_575 }, "GET");
  assert.equal(range["Content-Length"], "1048576");
  assert.equal(range["Content-Range"], "bytes 0-1048575/92157383");
});

test("offline paused panel keeps Play available so the command can be queued", () => {
  assert.match(blackRoomPage, /pausing=!desired&&remote\.online&&!synced/);
  assert.match(blackRoomPage, /els\.play\.hidden=desired\|\|pausing/);
  const desired = false;
  const remoteOnline = false;
  const synced = false;
  const pausing = !desired && remoteOnline && !synced;
  assert.equal(desired || pausing, false);
  assert.match(blackRoomPage, /let mutationBusy=false,requestGeneration=0/);
  assert.match(blackRoomPage, /async function refreshStatus\(\)\{if\(mutationBusy\)return/);
  assert.match(blackRoomPage, /async function mutate\(path,opt\)\{if\(mutationBusy\)return/);
  assert.match(blackRoomPage, /function disableActions\(value\)/);
  assert.match(blackRoomPage, /els\.pause\.onclick=\(\)=>mutate\('\/api\/blackroom-agent\/pause'/);
  assert.match(blackRoomPage, /if\(!message\|\|mutationBusy\)return/);
  assert.match(blackRoomPage, /generation===requestGeneration/);
});

test("BlackRoom panel exposes the chat controls", () => {
  assert.match(blackRoomPage, /Habla con el agente/);
  assert.match(blackRoomPage, /\/api\/blackroom-agent\/chat/);
  assert.match(blackRoomPage, /sube 3 videos más hoy/);
  assert.match(blackRoomPage, /TikTok \+ Facebook \+ YouTube/);
  assert.match(blackRoomPage, /facebook\.com\/profile\.php\?id=61568193332044/);
  assert.match(blackRoomPage, /confirmar las tres cuentas/);
  assert.match(blackRoomPage, /const byId=id=>document\.getElementById\(id\)/);
  assert.match(blackRoomPage, /Trabajando de verdad/);
  const script = blackRoomPage.match(/<script>([\s\S]*)<\/script>/)?.[1] || "";
  assert.doesNotThrow(() => new Function(script));
});
