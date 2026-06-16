import assert from "node:assert/strict";
import test from "node:test";
import { formatCeoReadinessText, parseCeoReadinessArgs } from "../server/ceo-readiness-cli";

test("parses CEO readiness CLI options", () => {
  assert.deepEqual(parseCeoReadinessArgs([]), { userId: "", json: false });
  assert.deepEqual(parseCeoReadinessArgs(["--user-id=user-123", "--json"]), { userId: "user-123", json: true });
});

test("formats CEO readiness text output", () => {
  const output = formatCeoReadinessText({
    ready: false,
    status: "warning",
    checks: [
      { id: "auth", label: "Auth", status: "ready", detail: "Resolved user context." },
      { id: "telegram", label: "Telegram", status: "warning", detail: "Webhook missing secret." },
    ],
  });

  assert.match(output, /CEO Assistant status: warning/);
  assert.match(output, /Ready: no/);
  assert.match(output, /\[ready\] Auth/);
  assert.match(output, /\[warning\] Telegram/);
});
