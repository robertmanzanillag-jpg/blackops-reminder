import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mock, test } from "node:test";
import {
  buildGoogleCalendarEventTimeFields,
  chooseBlackRoomCalendarId,
  getGoogleAccessToken,
  getGoogleCalendarAccessToken,
  makeGoogleCalendarExternalId,
  parseGoogleCalendarExternalId,
} from "../server/google-calendar";

const REPLIT_CONNECTOR_ENV_VARS = [
  "REPLIT_CONNECTORS_HOSTNAME",
  "REPL_IDENTITY",
  "WEB_REPL_RENEWAL",
];

function snapshotEnv(names: string[]) {
  return new Map(names.map((name) => [name, process.env[name]]));
}

function restoreEnv(snapshot: Map<string, string | undefined>) {
  for (const [name, value] of snapshot) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

test("Google connector access token skips connector rows without tokens", async () => {
  const snapshot = snapshotEnv(REPLIT_CONNECTOR_ENV_VARS);
  process.env.REPLIT_CONNECTORS_HOSTNAME = "connectors.example.test";
  process.env.REPL_IDENTITY = "test-repl-identity";
  delete process.env.WEB_REPL_RENEWAL;

  const fetchMock = mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({
    items: [
      { name: "google-calendar", settings: {} },
      { name: "google-drive", settings: { access_token: "drive-access-token" } },
    ],
  })));

  try {
    assert.equal(await getGoogleAccessToken(), "drive-access-token");
    assert.equal(fetchMock.mock.calls.length, 1);
  } finally {
    fetchMock.mock.restore();
    restoreEnv(snapshot);
  }
});

test("Google connector access token accepts nested OAuth token shapes and prefers Drive", async () => {
  const snapshot = snapshotEnv(REPLIT_CONNECTOR_ENV_VARS);
  process.env.REPLIT_CONNECTORS_HOSTNAME = "connectors-nested.example.test";
  process.env.REPL_IDENTITY = "test-repl-identity";
  delete process.env.WEB_REPL_RENEWAL;

  const fetchMock = mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({
    items: [
      { name: "google-calendar", settings: { oauth: { tokens: { accessToken: "calendar-access-token" } } } },
      { name: "google-drive", settings: { connection: { credentials: { accessToken: "drive-access-token" } } } },
    ],
  })));

  try {
    assert.equal(await getGoogleAccessToken(), "drive-access-token");
    assert.equal(fetchMock.mock.calls.length, 1);
  } finally {
    fetchMock.mock.restore();
    restoreEnv(snapshot);
  }
});

test("Google Calendar access token prefers the calendar connector over Drive", async () => {
  const snapshot = snapshotEnv(REPLIT_CONNECTOR_ENV_VARS);
  process.env.REPLIT_CONNECTORS_HOSTNAME = "connectors-calendar.example.test";
  process.env.REPL_IDENTITY = "test-repl-identity";
  delete process.env.WEB_REPL_RENEWAL;

  const fetchMock = mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({
    items: [
      { name: "google-drive", settings: { access_token: "drive-access-token" } },
      { name: "google-calendar", settings: { access_token: "calendar-access-token" } },
    ],
  })));

  try {
    assert.equal(await getGoogleCalendarAccessToken(), "calendar-access-token");
    assert.equal(fetchMock.mock.calls.length, 1);
  } finally {
    fetchMock.mock.restore();
    restoreEnv(snapshot);
  }
});

test("Google Calendar target prefers the Black Room calendar over primary", () => {
  assert.equal(
    chooseBlackRoomCalendarId([
      { id: "primary", summary: "Robert Personal" },
      { id: "blackroom-calendar@example.com", summary: "Black Room" },
    ]),
    "blackroom-calendar@example.com",
  );
});

test("Google Calendar target can be fixed by Black Room env", () => {
  const snapshot = snapshotEnv(["BLACKROOM_GOOGLE_CALENDAR_ID"]);
  process.env.BLACKROOM_GOOGLE_CALENDAR_ID = "configured-blackroom-calendar@example.com";

  try {
    assert.equal(
      chooseBlackRoomCalendarId([
        { id: "primary", summary: "Robert Personal" },
        { id: "other@example.com", summary: "Other" },
      ]),
      "configured-blackroom-calendar@example.com",
    );
  } finally {
    restoreEnv(snapshot);
  }
});

test("Google Calendar target does not fall back to primary without Black Room match", () => {
  assert.equal(
    chooseBlackRoomCalendarId([
      { id: "primary", summary: "Robert Personal", primary: true },
      { id: "other@example.com", summary: "Personal Events" },
    ]),
    null,
  );
  assert.equal(
    chooseBlackRoomCalendarId([
      { id: "other@example.com", summary: "Personal Events" },
    ]),
    null,
  );
});

test("Google Calendar target ignores generic GOOGLE_CALENDAR_ID for Black Room", () => {
  const snapshot = snapshotEnv(["GOOGLE_CALENDAR_ID"]);
  process.env.GOOGLE_CALENDAR_ID = "primary";

  try {
    assert.equal(
      chooseBlackRoomCalendarId([
        { id: "primary", summary: "Robert Personal", primary: true },
      ]),
      null,
    );
  } finally {
    restoreEnv(snapshot);
  }
});

test("Google Calendar external ids preserve calendar id for edits", () => {
  const externalId = makeGoogleCalendarExternalId("blackroom-calendar@example.com", "event-123");

  assert.equal(externalId, "blackroom-calendar@example.com::event-123");
  assert.deepEqual(parseGoogleCalendarExternalId(externalId), {
    calendarId: "blackroom-calendar@example.com",
    eventId: "event-123",
  });
  assert.deepEqual(parseGoogleCalendarExternalId("legacy-event-123"), {
    eventId: "legacy-event-123",
  });
});

test("Google connector cache refetches nested expired tokens", async () => {
  const snapshot = snapshotEnv(REPLIT_CONNECTOR_ENV_VARS);
  process.env.REPLIT_CONNECTORS_HOSTNAME = "connectors-expired.example.test";
  process.env.REPL_IDENTITY = "test-repl-identity";
  delete process.env.WEB_REPL_RENEWAL;

  let calls = 0;
  const fetchMock = mock.method(globalThis, "fetch", async () => {
    calls += 1;
    return new Response(JSON.stringify({
      items: [
        {
          name: "google-calendar",
          settings: {
            oauth: {
              tokens: {
                accessToken: calls === 1 ? "expired-calendar-token" : "fresh-calendar-token",
                expiryDate: calls === 1 ? Date.now() - 60_000 : Date.now() + 60_000,
              },
            },
          },
        },
      ],
    }));
  });

  try {
    await assert.rejects(
      getGoogleCalendarAccessToken(),
      /Google connector not connected/,
    );
    assert.equal(await getGoogleCalendarAccessToken(), "fresh-calendar-token");
    assert.equal(fetchMock.mock.calls.length, 2);
  } finally {
    fetchMock.mock.restore();
    restoreEnv(snapshot);
  }
});

test("Google Calendar all-day event body uses exclusive next-day end date", () => {
  assert.deepEqual(
    buildGoogleCalendarEventTimeFields({
      date: "2026-07-04T23:30:00-04:00",
      isAllDay: true,
    }),
    {
      start: { date: "2026-07-04" },
      end: { date: "2026-07-05" },
    },
  );

  assert.deepEqual(
    buildGoogleCalendarEventTimeFields({
      date: "2026-07-04",
      endDate: "2026-07-04",
      isAllDay: true,
    }),
    {
      start: { date: "2026-07-04" },
      end: { date: "2026-07-05" },
    },
  );
});

test("Google Calendar can update only isAllDay by reading the current event date", () => {
  const source = readFileSync("server/google-calendar.ts", "utf8");

  assert.match(source, /params\.isAllDay !== undefined/);
  assert.match(source, /calendar\.events\.get/);
  assert.match(source, /currentEvent\.data\.start\?\.dateTime \|\| currentEvent\.data\.start\?\.date/);
  assert.match(source, /requireBlackRoomCalendarId\(calendar, "writer"\)/);
  assert.doesNotMatch(source, /"GOOGLE_CALENDAR_ID"/);
});
