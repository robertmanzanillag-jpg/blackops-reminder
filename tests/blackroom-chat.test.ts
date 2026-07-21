import assert from "node:assert/strict";
import test from "node:test";
import { parseBlackRoomChatCommand } from "../server/blackroom-chat";

const now = new Date("2026-07-21T14:00:00.000Z");

test("parses extra posts for today", () => {
  const result = parseBlackRoomChatCommand("sube 3 videos más hoy", { now });
  assert.equal(result.command?.type, "extra_posts");
  if (result.command?.type !== "extra_posts") throw new Error("expected extra_posts");
  assert.equal(result.command.posts, 3);
  assert.equal(result.command.targetDate, "2026-07-21");
});

test("parses a new daily target", () => {
  const result = parseBlackRoomChatCommand("quiero 12 videos por día", { now });
  assert.equal(result.command?.type, "daily_target");
  if (result.command?.type !== "daily_target") throw new Error("expected daily_target");
  assert.equal(result.command.posts, 12);
});

test("queues a specific YouTube source", () => {
  const result = parseBlackRoomChatCommand("saca clips de https://youtu.be/abc123xyz", { now });
  assert.equal(result.command?.type, "priority_source");
  if (result.command?.type !== "priority_source") throw new Error("expected priority_source");
  assert.match(result.command.url, /abc123xyz/);
});

test("does not invent an analytics recommendation with too little data", () => {
  const result = parseBlackRoomChatCommand("¿debería subir más según analytics?", { now, analyticsSamples: 4, currentPostsPerDay: 10 });
  assert.equal(result.command, null);
  assert.match(result.reply, /4\/20/);
});

test("rejects extra-today requests that no longer fit safely", () => {
  const late = new Date("2026-07-22T03:30:00.000Z"); // 23:30 America/New_York
  const result = parseBlackRoomChatCommand("sube 3 videos más hoy", { now: late });
  assert.equal(result.command, null);
  assert.match(result.reply, /solo cabe(?:n)? 1/);
});
