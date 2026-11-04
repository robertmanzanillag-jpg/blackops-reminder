import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { getGoogleAccessToken, hasConnectedReplitGoogleConnector } from "../server/google-calendar";

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

test("Calendar does not accept a Drive token when its own connection has no token", async () => {
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
    await assert.rejects(getGoogleAccessToken(), /Google connector not connected/);
    assert.equal(fetchMock.mock.calls.length, 1);
    assert.match(String(fetchMock.mock.calls[0].arguments[0]), /connector_names=google-calendar$/);
  } finally {
    fetchMock.mock.restore();
    restoreEnv(snapshot);
  }
});

test("Calendar accepts its nested token even when a Drive token is returned", async () => {
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
    assert.equal(await getGoogleAccessToken(), "calendar-access-token");
    assert.equal(fetchMock.mock.calls.length, 1);
  } finally {
    fetchMock.mock.restore();
    restoreEnv(snapshot);
  }
});

test("Drive requests only Drive and keeps its cached token separate from Calendar", async () => {
  const snapshot = snapshotEnv(REPLIT_CONNECTOR_ENV_VARS);
  process.env.REPLIT_CONNECTORS_HOSTNAME = "connectors-scoped.example.test";
  process.env.REPL_IDENTITY = "scoped-test-identity";
  delete process.env.WEB_REPL_RENEWAL;
  const fetchMock = mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({ items: [
    { connector_name: "google-calendar", settings: { access_token: "calendar-only" } },
    { connector_name: "google-drive", settings: { oauth: { tokens: { accessToken: "drive-only" } } } },
  ] })));
  try {
    assert.equal(await getGoogleAccessToken(), "calendar-only");
    assert.equal(await getGoogleAccessToken("google-drive"), "drive-only");
    assert.equal(await getGoogleAccessToken(), "calendar-only");
    assert.equal(await getGoogleAccessToken("google-drive"), "drive-only");
    assert.equal(fetchMock.mock.calls.length, 2);
    assert.match(String(fetchMock.mock.calls[1].arguments[0]), /connector_names=google-drive$/);
  } finally { fetchMock.mock.restore(); restoreEnv(snapshot); }
});

test("Drive status stays disconnected with only Calendar available", async () => {
  const snapshot = snapshotEnv(REPLIT_CONNECTOR_ENV_VARS);
  process.env.REPLIT_CONNECTORS_HOSTNAME = "connectors-no-drive.example.test";
  process.env.REPL_IDENTITY = "missing-drive-identity";
  delete process.env.WEB_REPL_RENEWAL;
  const fetchMock = mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({ items: [
    { name: "google-calendar", settings: { access_token: "calendar-only" } },
  ] })));
  try {
    assert.equal(await hasConnectedReplitGoogleConnector("google-drive"), false);
    await assert.rejects(getGoogleAccessToken("google-drive"), /Google connector not connected/);
  } finally { fetchMock.mock.restore(); restoreEnv(snapshot); }
});

test("Denied Drive lookup fails without printing provider response or credentials", async () => {
  const snapshot = snapshotEnv(REPLIT_CONNECTOR_ENV_VARS);
  process.env.REPLIT_CONNECTORS_HOSTNAME = "connectors-denied.example.test";
  process.env.REPL_IDENTITY = "denied-drive-identity";
  delete process.env.WEB_REPL_RENEWAL;
  const fetchMock = mock.method(globalThis, "fetch", async () => new Response("private-provider-detail", { status: 401 }));
  try {
    await assert.rejects(getGoogleAccessToken("google-drive"), (error: Error) =>
      error.message === "Google connector not connected (google-drive, HTTP 401)");
    assert.equal(await hasConnectedReplitGoogleConnector("google-drive"), false);
  } finally { fetchMock.mock.restore(); restoreEnv(snapshot); }
});
