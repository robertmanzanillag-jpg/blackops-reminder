import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import pg from "pg";
const connectionString = process.env.BLACKOPS_TEST_DATABASE_URL;
test("isolated PostgreSQL + HTTP: real registration, session restart, owner identity and logout", { skip: !connectionString }, async () => {
  const url = new URL(connectionString!);
  assert.equal(url.hostname, "127.0.0.1"); assert.equal(url.port, "55439"); assert.equal(url.username, "kongtest"); assert.equal(url.pathname, "/blackopstest");
  process.env.DATABASE_URL = connectionString;
  process.env.NODE_ENV = "production";
  process.env.SESSION_SECRET = "cloud_fixture_session_secret_for_isolated_tests_only";
  process.env.LOCAL_AUTH_ENABLED = "true";
  process.env.ALLOW_LOCAL_AUTH_REGISTRATION = "true";
  delete process.env.DEFAULT_USER_ID;
  const pool = new pg.Pool({ connectionString });
  await pool.query("DROP TABLE IF EXISTS user_sessions; CREATE TABLE IF NOT EXISTS users(id varchar PRIMARY KEY DEFAULT gen_random_uuid(),username text NOT NULL UNIQUE,password text NOT NULL); DROP TABLE IF EXISTS app_rate_limit_buckets; CREATE TABLE app_rate_limit_buckets(bucket_key text PRIMARY KEY,count integer NOT NULL DEFAULT 0,reset_at timestamp NOT NULL,updated_at timestamp NOT NULL DEFAULT now()); TRUNCATE users,app_rate_limit_buckets");
  const { registerLocalAuthRoutes } = await import("../server/local-auth");
  const { createSessionMiddleware } = await import("../server/session-config");
  const { db } = await import("../server/db");
  const stores = new Set<any>();
  const start = async () => {
    const app = express(); app.use(express.json());
    app.use(createSessionMiddleware({ enabled: true, secret: process.env.SESSION_SECRET!, storeKind: "postgres", production: true, secureCookie: false })!);
    app.use((req, _res, next) => { stores.add((req as any).sessionStore); next(); });
    registerLocalAuthRoutes(app);
    const server = app.listen(0, "127.0.0.1"); await new Promise<void>(resolve => server.once("listening", resolve));
    return { server, base: `http://127.0.0.1:${(server.address() as { port: number }).port}` };
  };
  let current = await start();
  const closeServer = () => new Promise<void>(resolve => current.server.close(() => resolve()));
  const call = (path: string, body?: unknown, cookie?: string) => fetch(current.base + path, { method: body ? "POST" : "GET", headers: { ...(body ? { "Content-Type": "application/json", Origin: current.base } : {}), ...(cookie ? { Cookie: cookie } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  try {
    assert.equal((await call("/api/auth/me")).status, 401);
    const registered = await call("/api/auth/register", { username: "cloud-owner", password: "fixture-password-only" });
    assert.equal(registered.status, 201);
    const user = await registered.json(); assert.equal(user.authenticated, true); assert.ok(user.user.id);
    const cookie = registered.headers.getSetCookie().find(value => value.startsWith("blackops.sid="))?.split(";")[0]; assert.ok(cookie);
    const stored = (await pool.query("SELECT id,password FROM users WHERE username='cloud-owner'")).rows[0];
    assert.equal(stored.id, user.user.id); assert.ok(stored.password.startsWith("scrypt$")); assert.notEqual(stored.password, "fixture-password-only");
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM user_sessions")).rows[0].n, 1);
    await closeServer(); current = await start();
    const me = await (await call("/api/auth/me", undefined, cookie)).json();
    assert.equal(me.user.id, user.user.id); assert.equal(me.sessionBacked, true); assert.equal(me.usingDevFallback, false);
    assert.equal((await call("/api/auth/login", { username: "cloud-owner", password: "wrong-password" })).status, 401);
    const logout = await call("/api/auth/logout", {}, cookie); assert.equal(logout.status, 200);
    assert.equal((await call("/api/auth/me", undefined, cookie)).status, 401);
  } finally {
    await closeServer();
    for (const store of stores) if (store?.close) await store.close();
    await (db as any).$client.end(); await pool.end();
  }
});
