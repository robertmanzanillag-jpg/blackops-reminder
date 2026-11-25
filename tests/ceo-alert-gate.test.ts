import assert from "node:assert/strict";
import test from "node:test";
import {
  CEO_ALERT_REMINDER_MS,
  emptyCeoAlertLedger,
  parseCeoAlertLedger,
  planCeoAlerts,
  runCeoAlertGate,
  selfHealToCeoView,
  type CeoProblem,
} from "../server/ceo-alert-gate";

const T0 = Date.parse("2026-11-24T10:00:00Z");
const HOUR = 3600_000;
const PR = "https://github.com/robertmanzanillag-jpg/blackops-reminder/pull/777";

function memoryDeps(start = T0) {
  let raw: string | null = null;
  let now = start;
  const sent: string[] = [];
  return {
    sent,
    setNow(value: number) { now = value; },
    deps: {
      async transact(update: (raw: string | null) => Promise<string>) { raw = await update(raw); return raw; },
      async send(text: string) { sent.push(text); return true; },
      now: () => now,
    },
  };
}

const fixable: CeoProblem = { key: "kong:route-scout:Login 500", source: "app-qa", title: "Kong: Login 500", kind: "factory" };
const ownerOnly: CeoProblem = { key: "kong:uptime:sin SSL", source: "cybersecurity", title: "Kong: sin SSL", kind: "owner", ownerAction: "Renueva el certificado en Replit." };

function selfHealEntry(status: string, prUrl?: string) {
  return {
    key: "a".repeat(64), role: "code", code: "PR_FAILING_CHECKS", prNumber: 501, status, reason: status === "needs_owner" ? "FACTORY_NOT_ADMITTED" : undefined,
    attempts: [{ n: 1, ...(prUrl ? { factory: { prUrl } } : {}) }],
  } as any;
}

test("healthy scan: silence", async () => {
  const m = memoryDeps();
  const result = await runCeoAlertGate({ problems: [], scope: ["app-qa", "cybersecurity", "self-heal"] }, m.deps);
  assert.equal(result.sent, 0);
  assert.deepEqual(m.sent, []);
});

test("same open problem does not re-notify every hour; at most one daily reminder", async () => {
  const m = memoryDeps();
  for (let h = 0; h < 23; h++) {
    m.setNow(T0 + h * HOUR);
    await runCeoAlertGate({ problems: [fixable, ownerOnly], scope: ["app-qa", "cybersecurity"] }, m.deps);
  }
  assert.equal(m.sent.length, 2, "only the two first-time messages in 23 hourly scans");
  assert.match(m.sent[0], /Fallo nuevo/);
  assert.match(m.sent[0], /fábrica/);
  assert.match(m.sent[1], /Renueva el certificado/);
  m.setNow(T0 + CEO_ALERT_REMINDER_MS);
  await runCeoAlertGate({ problems: [fixable, ownerOnly], scope: ["app-qa", "cybersecurity"] }, m.deps);
  assert.equal(m.sent.length, 3, "one daily reminder for the fixable one, owner action is never repeated");
  assert.match(m.sent[2], /Sigue abierto/);
});

test("new self-heal order: one message saying the factory works on it", async () => {
  const m = memoryDeps();
  const view = selfHealToCeoView([selfHealEntry("ordered")]);
  await runCeoAlertGate({ problems: view.problems, scope: ["self-heal"], resolvedKeys: view.resolved }, m.deps);
  await runCeoAlertGate({ problems: view.problems, scope: ["self-heal"], resolvedKeys: view.resolved }, m.deps);
  assert.equal(m.sent.length, 1);
  assert.match(m.sent[0], /La fábrica ya tiene la orden/);
  assert.match(m.sent[0], /PR #501/);
});

test("verified self-heal entry: exactly one resolved message with the PR link", async () => {
  const m = memoryDeps();
  let view = selfHealToCeoView([selfHealEntry("in_factory", PR)]);
  await runCeoAlertGate({ problems: view.problems, scope: ["self-heal"], resolvedKeys: view.resolved }, m.deps);
  view = selfHealToCeoView([selfHealEntry("verified", PR)]);
  for (let i = 0; i < 3; i++) {
    m.setNow(T0 + (i + 1) * HOUR);
    await runCeoAlertGate({ problems: view.problems, scope: ["self-heal"], resolvedKeys: view.resolved }, m.deps);
  }
  assert.equal(m.sent.length, 2);
  assert.match(m.sent[1], /Resuelto/);
  assert.ok(m.sent[1].includes(PR));
});

test("needs_owner says what Robert must do, once; resolution from owner state sends one message", async () => {
  const m = memoryDeps();
  let view = selfHealToCeoView([selfHealEntry("needs_owner")]);
  await runCeoAlertGate({ problems: view.problems, scope: ["self-heal"], resolvedKeys: view.resolved }, m.deps);
  await runCeoAlertGate({ problems: view.problems, scope: ["self-heal"], resolvedKeys: view.resolved }, m.deps);
  assert.equal(m.sent.length, 1);
  assert.match(m.sent[0], /software-factory-cloud/);
  view = selfHealToCeoView([selfHealEntry("cleared")]);
  await runCeoAlertGate({ problems: view.problems, scope: ["self-heal"], resolvedKeys: view.resolved }, m.deps);
  await runCeoAlertGate({ problems: view.problems, scope: ["self-heal"], resolvedKeys: view.resolved }, m.deps);
  assert.equal(m.sent.length, 2);
  assert.match(m.sent[1], /Resuelto/);
});

test("problem gone from its own complete scan: one resolved message; other sources untouched", () => {
  let plan = planCeoAlerts({ ledger: emptyCeoAlertLedger(), problems: [fixable, ownerOnly], scope: ["app-qa", "cybersecurity"], now: T0 });
  plan = planCeoAlerts({ ledger: plan.ledger, problems: [], scope: ["app-qa"], now: T0 + HOUR });
  assert.equal(plan.messages.length, 1);
  assert.match(plan.messages[0], /Resuelto \(app-qa\)/);
  const again = planCeoAlerts({ ledger: plan.ledger, problems: [], scope: ["app-qa"], now: T0 + 2 * HOUR });
  assert.equal(again.messages.length, 0);
});

test("fail closed: unreadable ledger sends nothing", async () => {
  const sent: string[] = [];
  const result = await runCeoAlertGate({ problems: [fixable], scope: ["app-qa"] }, {
    async transact() { throw new Error("db down"); },
    async send(text) { sent.push(text); return true; },
    now: () => T0,
  });
  assert.equal(result.sent, 0);
  assert.match(result.skippedReason || "", /CEO_ALERT_LEDGER_UNAVAILABLE/);
  assert.deepEqual(sent, []);
  assert.throws(() => parseCeoAlertLedger("{\"version\":2}"));
});
