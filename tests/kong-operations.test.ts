import assert from "node:assert/strict";
import test from "node:test";
import {
  KongOpsError,
  LEASE_TTL_MS,
  RECONCILE_GRACE_MS,
  claimLease,
  deliverCards,
  emptyKongOperations,
  kongOperationsStatus,
  measurePublications,
  parseKongOperations,
  planPublication,
  reconcileByUuid,
  recordAttempt,
  releaseLease,
  uuidOf,
  verifyCard,
} from "../shared/kong-operations";

// Test data only: fictitious venues and promoters, fixed UUIDs.
const NOW = Date.parse("2026-11-05T20:00:00Z");
const MIN = 60_000;
const at = (ms: number) => new Date(ms).toISOString();
const U = {
  venue: "11111111-1111-4111-8111-111111111111",
  promoter: "22222222-2222-4222-8222-222222222222",
  pub1: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  pub2: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  pub3: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
};
const venue = (overrides: Record<string, unknown> = {}) => ({
  cardId: U.venue,
  kind: "venue",
  name: "Club Prueba",
  city: "Miami",
  highlight: "Sabado 7: mesas VIP con botella incluida",
  schedule: "Sab 11pm-4am",
  publicHandle: "@clubprueba",
  sources: [{ url: "https://example.com/clubprueba/eventos", checkedAt: at(NOW - 2 * 60 * MIN) }],
  verifiedBy: "kong:Venues",
  verifiedAt: at(NOW - 60 * MIN),
  ...overrides,
});
const promoter = () => ({
  cardId: U.promoter,
  kind: "promoter",
  name: "Promo Prueba",
  city: "Miami",
  highlight: "Lista de invitados gratis hasta la 1am",
  sources: [{ url: "https://example.com/promo", checkedAt: at(NOW - 30 * MIN) }],
  verifiedBy: "kong:Promoters + Mesas",
  verifiedAt: at(NOW - 20 * MIN),
});

test("only verified cards reach Videos KONG", () => {
  assert.equal(verifyCard(venue(), NOW).ok, true);
  const bad = [
    venue({ sources: [] }),
    venue({ sources: [{ url: "http://example.com", checkedAt: at(NOW) }] }),
    venue({ verifiedAt: at(NOW - 9 * 24 * 60 * MIN), sources: [{ url: "https://example.com/x", checkedAt: at(NOW - 9 * 24 * 60 * MIN) }] }),
    venue({ verifiedBy: "kong:KONG AI" }),
    venue({ publicHandle: "dueño 555-123-4567" }),
    venue({ phone: "+1 305 000 0000" }),
    venue({ cardId: "no-uuid" }),
  ];
  for (const card of bad) assert.equal(verifyCard(card, NOW).ok, false, JSON.stringify(card).slice(0, 80));
});

test("delivery: verified cards become video briefs once; a changed offer is a new version", () => {
  let state = emptyKongOperations();
  const first = deliverCards(state, [venue(), promoter(), venue({ cardId: "x" })], NOW);
  state = first.state;
  assert.equal(first.delivered.length, 2);
  assert.equal(first.rejected.length, 1);
  assert.deepEqual(state.inbox.map((brief) => [brief.from, brief.to]).sort(), [["kong:Promoters + Mesas", "kong-videos"], ["kong:Venues", "kong-videos"]]);
  const again = deliverCards(state, [venue()], NOW + MIN);
  assert.equal(again.delivered.length, 0);
  assert.equal(again.duplicates.length, 1, "re-sending the same verified card is not a new delivery");
  const changed = deliverCards(again.state, [venue({ highlight: "Sabado 7: open bar hasta la 1am" })], NOW + 2 * MIN);
  assert.equal(changed.delivered.length, 1);
  assert.equal(changed.state.inbox.filter((brief) => brief.cardId === U.venue).length, 2);
});

function withInbox() {
  return deliverCards(emptyKongOperations(), [venue(), promoter()], NOW).state;
}
const briefOf = (state: ReturnType<typeof withInbox>, cardId: string) => state.inbox.find((brief) => brief.cardId === cardId)!.briefId;

test("single holder: a second publisher cannot take the lease while it is valid", () => {
  let state = claimLease(withInbox(), "codex-local", "lease-a", NOW);
  assert.equal(state.lease?.epoch, 1);
  assert.throws(() => claimLease(state, "blackops-cloud", "lease-b", NOW + MIN), (error: unknown) => error instanceof KongOpsError && error.code === "lease_held");
  state = claimLease(state, "codex-local", "lease-a", NOW + 5 * MIN);
  assert.equal(state.lease?.epoch, 1, "renewing keeps the epoch");
  state = releaseLease(state, "codex-local", "lease-a", NOW + 6 * MIN);
  state = claimLease(state, "blackops-cloud", "lease-b", NOW + 7 * MIN);
  assert.equal(state.lease?.holder, "blackops-cloud");
  assert.equal(state.lease?.epoch, 2);
});

test("ledger: one UUID per publication, no second live publication for the same brief and network", () => {
  let state = claimLease(withInbox(), "codex-local", "lease-a", NOW);
  const briefId = briefOf(state, U.venue);
  state = planPublication(state, { holder: "codex-local", epoch: 1, uuid: U.pub1, briefId, network: "instagram" }, NOW + MIN);
  assert.equal(planPublication(state, { holder: "codex-local", epoch: 1, uuid: U.pub1, briefId, network: "instagram" }, NOW + 2 * MIN), state, "idempotent by UUID");
  assert.throws(() => planPublication(state, { holder: "codex-local", epoch: 1, uuid: U.pub2, briefId, network: "instagram" }, NOW + 2 * MIN), (error: unknown) => error instanceof KongOpsError && error.code === "already_published");
  state = planPublication(state, { holder: "codex-local", epoch: 1, uuid: U.pub2, briefId, network: "tiktok" }, NOW + 2 * MIN);
  assert.equal(state.inbox.find((brief) => brief.briefId === briefId)?.status, "en_produccion");
  assert.throws(() => planPublication(state, { holder: "blackops-cloud", epoch: 1, uuid: U.pub3, briefId, network: "youtube" }, NOW + 3 * MIN), (error: unknown) => error instanceof KongOpsError && error.code === "not_holder");
});

test("handoff after a crash: the old holder is fenced and the new one reconciles by UUID instead of republishing", () => {
  // codex-local reserves and submits, then dies before hearing back.
  let state = claimLease(withInbox(), "codex-local", "lease-a", NOW);
  const briefId = briefOf(state, U.venue);
  state = planPublication(state, { holder: "codex-local", epoch: 1, uuid: U.pub1, briefId, network: "instagram" }, NOW + MIN);
  state = recordAttempt(state, { holder: "codex-local", epoch: 1, uuid: U.pub1, outcome: "submitted" }, NOW + 2 * MIN);
  // Its lease expires; the cloud takes over with a new epoch.
  const later = NOW + 2 * MIN + LEASE_TTL_MS + MIN;
  state = claimLease(state, "blackops-cloud", "lease-b", later);
  assert.equal(state.lease?.epoch, 2);
  // A late answer from the old holder is rejected (fencing).
  assert.throws(() => recordAttempt(state, { holder: "codex-local", epoch: 1, uuid: U.pub1, outcome: "failed", error: "timeout" }, later + MIN), (error: unknown) => error instanceof KongOpsError && (error.code === "not_holder" || error.code === "stale_epoch"));
  // The new holder cannot plan a second publication for the same brief while the first is open.
  assert.throws(() => planPublication(state, { holder: "blackops-cloud", epoch: 2, uuid: U.pub2, briefId, network: "instagram" }, later + MIN), (error: unknown) => error instanceof KongOpsError && error.code === "already_published");
  // What really went out (as read from the network): the post carries our UUID tag.
  const posts = [{ postId: "ig-555", text: `Club Prueba este sabado #kong kong:${U.pub1}`, publishedAt: at(NOW + 3 * MIN) }];
  const result = reconcileByUuid(state, posts, later + 2 * MIN);
  assert.deepEqual(result.confirmed, [U.pub1]);
  const publication = result.state.publications.find((item) => item.uuid === U.pub1)!;
  assert.equal(publication.status, "confirmed");
  assert.equal(publication.externalPostId, "ig-555");
  assert.equal(result.state.inbox.find((brief) => brief.briefId === briefId)?.status, "publicado");
  // Reconciling again changes nothing (idempotent).
  assert.equal(reconcileByUuid(result.state, posts, later + 3 * MIN).confirmed.length, 0);
});

test("a failed attempt that never went out becomes retryable only after the grace period, then a new UUID can publish it", () => {
  let state = claimLease(withInbox(), "codex-local", "lease-a", NOW);
  const briefId = briefOf(state, U.promoter);
  state = planPublication(state, { holder: "codex-local", epoch: 1, uuid: U.pub1, briefId, network: "tiktok" }, NOW);
  state = recordAttempt(state, { holder: "codex-local", epoch: 1, uuid: U.pub1, outcome: "unknown", error: "sin respuesta de la red" }, NOW + MIN);
  assert.equal(reconcileByUuid(state, [], NOW + 5 * MIN).retryable.length, 0, "too early: it may still appear");
  const settled = reconcileByUuid(state, [{ postId: "tt-1", text: "otro post sin uuid" }], NOW + MIN + RECONCILE_GRACE_MS);
  assert.deepEqual(settled.retryable, [U.pub1]);
  state = claimLease(settled.state, "codex-local", "lease-a", NOW + MIN + RECONCILE_GRACE_MS);
  state = planPublication(state, { holder: "codex-local", epoch: state.lease!.epoch, uuid: U.pub2, briefId, network: "tiktok" }, NOW + 2 * MIN + RECONCILE_GRACE_MS);
  assert.equal(state.publications.filter((item) => item.briefId === briefId).length, 2);
});

test("UUID tag detection is exact", () => {
  assert.equal(uuidOf({ postId: "1", text: `hola kong:${U.pub1.toUpperCase()} fin` }), U.pub1);
  assert.equal(uuidOf({ postId: "1", uuid: U.pub2 }), U.pub2);
  assert.equal(uuidOf({ postId: "1", text: "kong:aaaa" }), null);
});

test("metrics agent: results per confirmed publication from the Metricool rows", () => {
  let state = claimLease(withInbox(), "codex-local", "lease-a", NOW);
  const briefId = briefOf(state, U.venue);
  state = planPublication(state, { holder: "codex-local", epoch: 1, uuid: U.pub1, briefId, network: "instagram" }, NOW);
  state = recordAttempt(state, { holder: "codex-local", epoch: 1, uuid: U.pub1, outcome: "confirmed", externalPostId: "ig-555", publishedAt: at(NOW) }, NOW + MIN);
  assert.equal(kongOperationsStatus(state, NOW + MIN)["kong-metrics"].state, "needs-setup");
  // Same shape parseMetricoolPostMetrics returns (server/metricool-analytics-sync.ts).
  const row = (postId: string, observedAt: string, impressions: number, reach = 0, videoViews = 0, engagements = 0) => ({ postId, queueItemId: null, contentHash: null, observedAt, impressions, reach, videoViews, engagements, clicks: 3, shares: 9 });
  const rows = [row("ig-555", at(NOW + 60 * MIN), 1200, 900, 700, 97), row("ig-555", at(NOW + 30 * MIN), 400, 300, 200), row("otro-post", at(NOW), 99)];
  state = measurePublications(state, rows, NOW + 2 * 60 * MIN);
  assert.equal(state.results.length, 1);
  assert.equal(state.results[0].uuid, U.pub1);
  assert.equal(state.results[0].impressions, 1200, "latest observation wins");
  assert.equal(state.results[0].title, "Venue: Club Prueba (Miami)");
  assert.equal(kongOperationsStatus(state, NOW + 3 * 60 * MIN)["kong-metrics"].state, "working");
});

test("state from disk: unknown or broken shapes never crash", () => {
  assert.deepEqual(parseKongOperations(null), emptyKongOperations());
  const parsed = parseKongOperations({ version: 1, cards: [null, { card: { cardId: "x" } }], inbox: [{ briefId: "b", cardId: "c" }, null], lease: { holder: 1 }, publications: [{ uuid: "no" }], events: [{ text: "ok" }] });
  assert.equal(parsed.cards.length, 0);
  assert.equal(parsed.inbox.length, 1);
  assert.equal(parsed.lease, null);
  assert.equal(parsed.publications.length, 0);
});

// ---------- Service: two instances sharing storage (Autoscale) ----------
import { KongOpsStateConflict, createKongOperations } from "../server/kong-operations";

function sharedStore() {
  let raw: string | null = null;
  let revision: number | null = null;
  return {
    read: async () => ({ raw, revision }),
    write: async (next: string, expected: number | null) => {
      await new Promise((resolve) => setTimeout(resolve, 3));
      if (expected !== revision) throw new KongOpsStateConflict("state conflict");
      raw = next;
      revision = (revision ?? 0) + 1;
      return revision;
    },
  };
}

test("service: two instances racing for the publisher lease -> exactly one holder", async () => {
  const store = sharedStore();
  const a = createKongOperations({ store, now: () => NOW });
  const b = createKongOperations({ store, now: () => NOW });
  const outcomes = await Promise.allSettled([a.claim("codex-local", "lease-aaaaaa"), b.claim("blackops-cloud", "lease-bbbbbb")]);
  assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);
  const rejected = outcomes.find((outcome) => outcome.status === "rejected") as PromiseRejectedResult;
  assert.ok(rejected.reason instanceof KongOpsError && rejected.reason.code === "lease_held");
  const view = await a.view();
  assert.equal(view.lease?.epoch, 1);
  assert.equal(view.status.holder, view.lease?.holder);
});

test("service: the same card delivered by two instances at once lands once; reconcile/metrics round-trip", async () => {
  const store = sharedStore();
  const a = createKongOperations({ store, now: () => NOW });
  const b = createKongOperations({ store, now: () => NOW });
  await Promise.all([a.deliver([venue()]), b.deliver([venue()])]);
  const view = await a.view();
  assert.equal(view.inbox.length, 1);
  await a.claim("codex-local", "lease-aaaaaa");
  await a.plan({ holder: "codex-local", epoch: 1, uuid: U.pub1, briefId: view.inbox[0].briefId, network: "instagram" });
  await a.attempt({ holder: "codex-local", epoch: 1, uuid: U.pub1, outcome: "unknown", error: "timeout" });
  const reconciled = await b.reconcile([{ postId: "ig-9", text: `kong:${U.pub1}` }]);
  assert.deepEqual(reconciled.confirmed, [U.pub1]);
  const results = await b.measure([{ postId: "ig-9", observedAt: at(NOW), impressions: 50, reach: 40, videoViews: 30, engagements: 5, clicks: 1, shares: 1 }]);
  assert.equal(results.length, 1);
  assert.equal((await a.view()).status["kong-metrics"].state, "working");
});

// ---------- Review regressions ----------

test("a 'failed' attempt keeps the slot: no new UUID for the same brief+network until reconciliation", () => {
  let state = claimLease(withInbox(), "codex-local", "lease-a", NOW);
  const briefId = briefOf(state, U.venue);
  state = planPublication(state, { holder: "codex-local", epoch: 1, uuid: U.pub1, briefId, network: "instagram" }, NOW);
  state = recordAttempt(state, { holder: "codex-local", epoch: 1, uuid: U.pub1, outcome: "failed", error: "timeout de la red" }, NOW + MIN);
  assert.throws(() => planPublication(state, { holder: "codex-local", epoch: 1, uuid: U.pub2, briefId, network: "instagram" }, NOW + 2 * MIN), (error: unknown) => error instanceof KongOpsError && error.code === "already_published");
  // It actually went out: reconciliation confirms it and the retry never happens.
  const out = reconcileByUuid(state, [{ postId: "ig-1", text: `kong:${U.pub1}` }], NOW + 3 * MIN);
  assert.deepEqual(out.confirmed, [U.pub1]);
  // A late report cannot reopen a confirmed publication.
  assert.equal(recordAttempt(out.state, { holder: "codex-local", epoch: 1, uuid: U.pub1, outcome: "failed" }, NOW + 4 * MIN), out.state);
});

test("the original post showing up after a retry is detected as a duplicate", () => {
  let state = claimLease(withInbox(), "codex-local", "lease-a", NOW);
  const briefId = briefOf(state, U.venue);
  state = planPublication(state, { holder: "codex-local", epoch: 1, uuid: U.pub1, briefId, network: "instagram" }, NOW);
  state = recordAttempt(state, { holder: "codex-local", epoch: 1, uuid: U.pub1, outcome: "unknown" }, NOW + MIN);
  state = reconcileByUuid(state, [], NOW + MIN + RECONCILE_GRACE_MS).state;
  state = claimLease(state, "codex-local", "lease-a", NOW + MIN + RECONCILE_GRACE_MS);
  const epoch = state.lease!.epoch;
  state = planPublication(state, { holder: "codex-local", epoch, uuid: U.pub2, briefId, network: "instagram" }, NOW + 2 * MIN + RECONCILE_GRACE_MS);
  state = recordAttempt(state, { holder: "codex-local", epoch, uuid: U.pub2, outcome: "confirmed", externalPostId: "ig-2" }, NOW + 3 * MIN + RECONCILE_GRACE_MS);
  // Hours later the first post appears (stuck queue / Metricool lag).
  const late = reconcileByUuid(state, [{ postId: "ig-1", text: `kong:${U.pub1}` }], NOW + 3 * 60 * MIN);
  assert.deepEqual(late.duplicates, [U.pub1]);
  const dup = late.state.publications.find((item) => item.uuid === U.pub1)!;
  assert.equal(dup.status, "duplicate");
  assert.match(dup.lastError || "", /Duplicado de/);
  assert.equal(kongOperationsStatus(late.state, NOW + 3 * 60 * MIN).duplicates, 1);
});

test("personal contact data never passes: handle, highlight, name, schedule", () => {
  const leaks = [
    venue({ publicHandle: "juan.perez@gmail.com" }),
    venue({ publicHandle: "+584121234567" }),
    venue({ publicHandle: "04121234567" }),
    venue({ highlight: "Llama a Juan 0412-1234567 para mesas" }),
    venue({ highlight: "Reservas: juan@gmail.com" }),
    venue({ name: "Club (305) 555-0199" }),
    venue({ schedule: "WhatsApp +1 305 555 0199" }),
  ];
  for (const card of leaks) {
    const check = verifyCard(card, NOW);
    assert.equal(check.ok, false, JSON.stringify(card).slice(0, 120));
  }
  // Normal promo text with dates, times and prices still passes.
  assert.equal(verifyCard(venue({ highlight: "Sabado 7/11 de 11pm a 4am, mesas desde $250, 2x1 hasta la 1am" }), NOW).ok, true);
  assert.equal(verifyCard(venue({ publicHandle: "@club_prueba.mia" }), NOW).ok, true);
});

test("ledger: UUID reused for another brief is rejected; uppercase UUIDs are the same UUID", () => {
  let state = claimLease(withInbox(), "codex-local", "lease-a", NOW);
  const venueBrief = briefOf(state, U.venue);
  const promoBrief = briefOf(state, U.promoter);
  state = planPublication(state, { holder: "codex-local", epoch: 1, uuid: U.pub1.toUpperCase(), briefId: venueBrief, network: "instagram" }, NOW);
  assert.equal(state.publications[0].uuid, U.pub1);
  assert.throws(() => planPublication(state, { holder: "codex-local", epoch: 1, uuid: U.pub1, briefId: promoBrief, network: "instagram" }, NOW), (error: unknown) => error instanceof KongOpsError && error.code === "uuid_mismatch");
  state = recordAttempt(state, { holder: "codex-local", epoch: 1, uuid: U.pub1.toUpperCase(), outcome: "submitted" }, NOW + MIN);
  assert.equal(state.publications[0].status, "submitted");
});

test("the same holder cannot open a second parallel lease (two processes with the same name)", () => {
  const state = claimLease(withInbox(), "codex-local", "lease-a", NOW);
  assert.throws(() => claimLease(state, "codex-local", "lease-z", NOW + MIN), (error: unknown) => error instanceof KongOpsError && error.code === "lease_held");
  assert.equal(claimLease(state, "codex-local", "lease-z", NOW + LEASE_TTL_MS + MIN).lease?.epoch, 2, "after expiry it is a new turn");
});

test("metrics: a row without date never hides a dated observation", () => {
  let state = claimLease(withInbox(), "codex-local", "lease-a", NOW);
  const briefId = briefOf(state, U.venue);
  state = planPublication(state, { holder: "codex-local", epoch: 1, uuid: U.pub1, briefId, network: "instagram" }, NOW);
  state = recordAttempt(state, { holder: "codex-local", epoch: 1, uuid: U.pub1, outcome: "confirmed", externalPostId: "ig-7" }, NOW);
  const base = { queueItemId: null, contentHash: null, reach: 0, videoViews: 0, engagements: 0, clicks: 0, shares: 0 };
  state = measurePublications(state, [{ ...base, postId: "ig-7", observedAt: null, impressions: 1 }, { ...base, postId: "ig-7", observedAt: at(NOW + MIN), impressions: 999 }], NOW + 2 * MIN);
  assert.equal(state.results[0].impressions, 999);
});
