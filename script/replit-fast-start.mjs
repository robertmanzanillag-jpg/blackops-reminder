import http from "node:http";
import net from "node:net";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

const STARTUP_HEALTH_PATHS = new Set(["/", "/health", "/api/health"]);

function listen(server, port, host) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });
}

function closeServer(server) {
  return new Promise((resolve) => {
    if (!server.listening) return resolve();
    server.close(() => resolve());
  });
}

function runNodePreflight(entry, options) {
  if (!entry) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [entry], {
      cwd: options.cwd || process.cwd(),
      env: process.env,
      stdio: options.childStdio || "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => code === 0 ? resolve() : reject(new Error(`preflight exited (${signal || code || 0})`)));
  });
}

function proxyHeaders(req, upstreamHost) {
  const forwardedFor = String(req.headers["x-forwarded-for"] || "").trim();
  const remoteAddress = req.socket.remoteAddress || "";
  return {
    ...req.headers,
    host: req.headers.host || upstreamHost,
    "x-forwarded-for": [forwardedFor, remoteAddress].filter(Boolean).join(", "),
    "x-forwarded-host": req.headers.host || "",
    "x-forwarded-proto": String(req.headers["x-forwarded-proto"] || (req.socket.encrypted ? "https" : "http")),
  };
}

export async function startReplitFastStart(options = {}) {
  const publicHost = options.publicHost || process.env.HOST || "0.0.0.0";
  const publicPort = Number(options.publicPort ?? process.env.PORT ?? 5000);
  const upstreamHost = options.upstreamHost || "127.0.0.1";
  const upstreamPort = Number(options.upstreamPort ?? process.env.REPLIT_UPSTREAM_PORT ?? 5001);
  const childEntry = options.childEntry || process.env.REPLIT_CHILD_ENTRY || "dist/index.cjs";
  const preflightEntry = options.preflightEntry === false ? null : options.preflightEntry || process.env.REPLIT_PREFLIGHT_ENTRY || "dist/compact-local-news-state.cjs";
  const readinessIntervalMs = Number(options.readinessIntervalMs ?? 200);
  const startupStartedAt = Date.now();
  let upstreamReady = false;
  let stopping = false;
  let child;

  const proxyRequest = (req, res) => {
    const path = new URL(req.url || "/", "http://replit.local").pathname;
    if (!upstreamReady) {
      if (STARTUP_HEALTH_PATHS.has(path)) {
        res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
        res.end(JSON.stringify({ status: "starting", uptimeMs: Date.now() - startupStartedAt }));
        return;
      }
      res.writeHead(503, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "retry-after": "1" });
      res.end(JSON.stringify({ status: "starting" }));
      return;
    }

    const upstream = http.request({
      host: upstreamHost,
      port: upstreamPort,
      method: req.method,
      path: req.url,
      headers: proxyHeaders(req, `${upstreamHost}:${upstreamPort}`),
    }, (upstreamResponse) => {
      res.writeHead(upstreamResponse.statusCode || 502, upstreamResponse.headers);
      upstreamResponse.pipe(res);
    });
    upstream.setTimeout(30_000, () => upstream.destroy(new Error("upstream timeout")));
    upstream.on("error", () => {
      upstreamReady = false;
      if (res.headersSent) return res.destroy();
      res.writeHead(503, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "retry-after": "1" });
      res.end(JSON.stringify({ status: "restarting" }));
    });
    req.pipe(upstream);
  };

  const server = http.createServer(proxyRequest);
  server.on("upgrade", (req, socket, head) => {
    if (!upstreamReady) return socket.destroy();
    const upstreamSocket = net.connect(upstreamPort, upstreamHost, () => {
      const headers = Object.entries(proxyHeaders(req, `${upstreamHost}:${upstreamPort}`))
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(", ") : value}`)
        .join("\r\n");
      upstreamSocket.write(`${req.method} ${req.url} HTTP/${req.httpVersion}\r\n${headers}\r\n\r\n`);
      if (head.length) upstreamSocket.write(head);
      socket.pipe(upstreamSocket).pipe(socket);
    });
    upstreamSocket.on("error", () => socket.destroy());
  });

  await listen(server, publicPort, publicHost);
  const address = server.address();
  const boundPort = typeof address === "object" && address ? address.port : publicPort;
  console.log(`[replit-fast-start] listening on ${publicHost}:${boundPort}; booting application on ${upstreamHost}:${upstreamPort}`);

  await runNodePreflight(preflightEntry, options);

  child = spawn(process.execPath, [childEntry], {
    cwd: options.cwd || process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: "production",
      HOST: upstreamHost,
      PORT: String(upstreamPort),
    },
    stdio: options.childStdio || "inherit",
  });

  const pollReadiness = () => {
    const request = http.get({ host: upstreamHost, port: upstreamPort, path: "/api/health", timeout: 1_000 }, (response) => {
      response.resume();
      if ((response.statusCode || 500) < 500 && !upstreamReady) {
        upstreamReady = true;
        console.log(`[replit-fast-start] application ready on ${upstreamHost}:${upstreamPort}`);
      }
    });
    request.on("timeout", () => request.destroy());
    request.on("error", () => {
      upstreamReady = false;
    });
  };
  const readinessTimer = setInterval(pollReadiness, readinessIntervalMs);
  readinessTimer.unref();
  pollReadiness();

  child.once("exit", async (code, signal) => {
    clearInterval(readinessTimer);
    upstreamReady = false;
    if (stopping) return;
    console.error(`[replit-fast-start] application exited (${signal || code || 0})`);
    await closeServer(server);
    process.exitCode = code || (signal ? 1 : 0);
  });
  child.once("error", async (error) => {
    clearInterval(readinessTimer);
    upstreamReady = false;
    if (stopping) return;
    console.error(`[replit-fast-start] failed to launch application: ${error.message}`);
    await closeServer(server);
    process.exitCode = 1;
  });

  const stop = async (signal = "SIGTERM") => {
    if (stopping) return;
    stopping = true;
    clearInterval(readinessTimer);
    if (child && child.exitCode == null && child.signalCode == null) child.kill(signal);
    await closeServer(server);
  };

  return {
    child,
    port: boundPort,
    server,
    stop,
    isUpstreamReady: () => upstreamReady,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const runtime = await startReplitFastStart();
  const shutdown = async (signal) => {
    await runtime.stop(signal);
    process.exit(0);
  };
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  process.once("SIGINT", () => void shutdown("SIGINT"));
}
