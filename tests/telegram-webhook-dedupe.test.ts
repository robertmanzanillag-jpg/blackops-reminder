import assert from "node:assert/strict";
import test from "node:test";
import { createTelegramUpdateDeduper } from "../server/telegram-webhook-dedupe";

test("deduplicates Telegram webhook updates by update_id", () => {
  const deduper = createTelegramUpdateDeduper();

  assert.equal(deduper.shouldProcess({ update_id: 100 }), true);
  assert.equal(deduper.shouldProcess({ update_id: 100 }), false);
  assert.equal(deduper.shouldProcess({ update_id: 101 }), true);
});

test("allows malformed Telegram webhook updates to flow through", () => {
  const deduper = createTelegramUpdateDeduper();

  assert.equal(deduper.shouldProcess({}), true);
  assert.equal(deduper.shouldProcess({ update_id: "100" }), true);
});

test("evicts old Telegram update ids when the dedupe window is full", () => {
  const deduper = createTelegramUpdateDeduper(2);

  assert.equal(deduper.shouldProcess({ update_id: 1 }), true);
  assert.equal(deduper.shouldProcess({ update_id: 2 }), true);
  assert.equal(deduper.shouldProcess({ update_id: 3 }), true);
  assert.equal(deduper.size(), 2);
  assert.equal(deduper.shouldProcess({ update_id: 1 }), true);
});
