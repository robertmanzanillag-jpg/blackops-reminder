import test from "node:test";
import assert from "node:assert/strict";
import { describeOwnerLockHolders, isLockNotAvailable, skipOnOwnerLockTimeout } from "../server/office-lock-timeout";
import { councilApplicationName } from "../server/agent-council-store";

const lockError = () => Object.assign(new Error("canceling statement due to lock timeout"), { code: "55P03" });

test("55P03 is detected directly and through a cause chain only", () => {
  assert.equal(isLockNotAvailable(lockError()), true);
  assert.equal(isLockNotAvailable(new Error("wrapped", { cause: lockError() })), true);
  assert.equal(isLockNotAvailable(Object.assign(new Error("x"), { code: "28P01" })), false);
  assert.equal(isLockNotAvailable(null), false);
});

test("a lock timeout skips the cycle and logs holders without private data", async () => {
  const lines: string[] = [];
  const step = skipOnOwnerLockTimeout("capability", async () => { throw lockError(); },
    async () => [{ pid: 42, application: "blackops-council:replit-web", state: "idle in transaction", granted: true, xactSeconds: 25 }],
    line => lines.push(line));
  await step();
  const entry = JSON.parse(lines[0]);
  assert.equal(entry.event, "office_owner_lock_busy");
  assert.equal(entry.step, "capability");
  assert.equal(entry.holders[0].application, "blackops-council:replit-web");
  assert.doesNotMatch(lines[0], /canceling statement/, "no driver message text");
});

test("other errors still end the run as before", async () => {
  const step = skipOnOwnerLockTimeout("academy", async () => { throw Object.assign(new Error("x"), { code: "28P01" }); }, async () => [], () => undefined);
  await assert.rejects(step(), /x/);
});

test("diagnostics failure does not turn a skip into a failure", async () => {
  const lines: string[] = [];
  await skipOnOwnerLockTimeout("academy", async () => { throw lockError(); }, async () => { throw new Error("no"); }, l => lines.push(l))();
  assert.equal(JSON.parse(lines[0]).holders, "unavailable");
});

test("holder rows are sanitized and the key is a parameter", async () => {
  let values: unknown[] | undefined;
  const rows = await describeOwnerLockHolders({ async query(_sql, v) { values = v; return { rows: [{ pid: "7", application: "evil\u0000name;DROP", state: "active", granted: false, xact_seconds: null }] }; } }, "abc");
  assert.deepEqual(values, ["abc"]);
  assert.deepEqual(rows, [{ pid: 7, application: "evil?name?DROP", state: "active", granted: false, xactSeconds: null }]);
});

test("council connections carry a non-secret host label", () => {
  assert.equal(councilApplicationName({ GITHUB_ACTIONS: "true", GITHUB_JOB: "office-once" }), "blackops-council:gha-office-once");
  assert.equal(councilApplicationName({ REPLIT_DEPLOYMENT: "1" }), "blackops-council:replit-web");
  assert.equal(councilApplicationName({}), "blackops-council:local");
});

test("Kong supervisor reads video status before taking the council owner lock", async () => {
  const { createKongSupervisorConversation } = await import("../server/kong-supervisor-conversation");
  const { emptyKongSupervision, parseKongSupervision } = await import("../shared/kong-supervisor");
  let raw = JSON.stringify(emptyKongSupervision());
  let inLock = false, readsInsideLock = 0, reads = 0;
  const service = createKongSupervisorConversation({
    now: () => Date.parse("2026-11-05T01:00:00Z"),
    read: async () => parseKongSupervision(JSON.parse(raw)),
    readVideoStatus: async () => { reads++; if (inLock) readsInsideLock++; return { state: "working" } as any; },
    commit: async change => { inLock = true; try { const next = await change(parseKongSupervision(JSON.parse(raw))); raw = JSON.stringify(next); return next; } finally { inLock = false; } },
  } as any);
  await service.talk({ message: "revisar", requestId: "request-0001", agentId: "kong-supervisor" });
  assert.equal(reads, 1);
  assert.equal(readsInsideLock, 0);
});

test("every pool role gets a named application_name; council pools cap idle-in-transaction at 30 s", async () => {
  const { blackopsApplicationName, councilPoolConfig, COUNCIL_IDLE_IN_TRANSACTION_MS } = await import("../server/agent-council-store");
  assert.equal(blackopsApplicationName("streamers", { GITHUB_ACTIONS: "true", GITHUB_JOB: "discover" }), "blackops-streamers:gha-discover");
  assert.equal(blackopsApplicationName("web-db", { REPLIT_DEPLOYMENT: "1" }), "blackops-web-db:replit-web");
  assert.ok(blackopsApplicationName("x".repeat(80), { GITHUB_ACTIONS: "true", GITHUB_JOB: "y".repeat(80) }).length <= 63);
  const config = councilPoolConfig("postgres://example/db", "credit-notify", {});
  assert.equal(config.application_name, "blackops-credit-notify:local");
  assert.equal(config.idle_in_transaction_session_timeout, 30_000);
  assert.equal(COUNCIL_IDLE_IN_TRANSACTION_MS, 30_000);
});

test("no PostgreSQL pool in server/ or script/ is left without application_name", async () => {
  const { readdirSync, readFileSync } = await import("node:fs");
  const unnamed: string[] = [];
  for (const dir of ["server", "script"]) for (const file of (readdirSync(new URL(`../${dir}/`, import.meta.url), { recursive: true }) as string[]).filter(f => !f.startsWith("office-api-budget-v6/") && f !== "software-factory-store.ts" && !f.startsWith("release-gate/"))) {
    if (!/\.(ts|mjs)$/.test(file) || /\.test\./.test(file)) continue;
    const src = readFileSync(new URL(`../${dir}/${file}`, import.meta.url), "utf8");
    for (const m of src.matchAll(/new (?:pg\.)?Pool\(\{[^;]*?\}\)/gs)) if (!/application_name/.test(m[0]) && !/councilPoolConfig/.test(m[0])) unnamed.push(`${dir}/${file}`);
  }
  assert.deepEqual(unnamed, []);
});
