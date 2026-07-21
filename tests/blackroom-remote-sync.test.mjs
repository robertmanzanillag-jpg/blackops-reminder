import assert from "node:assert/strict";
import test from "node:test";
import { planBlackRoomRemoteSync } from "../script/blackroom-remote-sync.mjs";

test("newer pause cannot be undone by an older play response", () => {
  const play = planBlackRoomRemoteSync({
    control: { generation: 1, desiredEnabled: true }, localEnabled: false, lastAppliedGeneration: -1,
  });
  assert.deepEqual(play, { action: "start", generation: 1 });

  const pause = planBlackRoomRemoteSync({
    control: { generation: 2, desiredEnabled: false }, localEnabled: true, lastAppliedGeneration: play.generation,
  });
  assert.deepEqual(pause, { action: "pause", generation: 2 });

  const stalePlay = planBlackRoomRemoteSync({
    control: { generation: 1, desiredEnabled: true }, localEnabled: false, lastAppliedGeneration: pause.generation,
  });
  assert.deepEqual(stalePlay, { action: "ignore", generation: 2 });
});

test("already-applied desired state advances generation without restarting", () => {
  assert.deepEqual(planBlackRoomRemoteSync({
    control: { generation: 4, desiredEnabled: true }, localEnabled: true, lastAppliedGeneration: 3,
  }), { action: "none", generation: 4 });
});
