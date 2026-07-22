import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const BLACKROOM_METRICOOL_BLOG_ID = 6585226;
export const BLACKROOM_TIMEZONE = "America/New_York";
export const BLACKROOM_FACEBOOK_MAIN_URL = "https://www.facebook.com/profile.php?id=61568193332044";
export const BLACKROOM_METRICOOL_NETWORKS = ["tiktok", "facebook", "youtube"] as const;
export type BlackRoomMetricoolNetwork = (typeof BLACKROOM_METRICOOL_NETWORKS)[number];

export interface BlackRoomMetricoolScheduleInput {
  caption: string;
  publicationDateTime: string;
  mediaUrl: string;
  blogId?: number;
  timezone?: string;
  language?: "en" | "es";
  sourceVideoId: string;
  durationSeconds: number;
  videoFormat: "vertical" | "horizontal";
}

export interface BlackRoomMetricoolReceipt {
  metricoolId: string;
  publicationDateTime: string;
  caption: string;
  verified: true;
  platformReceipts: Partial<Record<BlackRoomMetricoolNetwork, string>>;
}

type FetchLike = typeof fetch;

const METRICOOL_MCP_URL = "https://ai.metricool.com/mcp";

export function formatMetricoolMcpDate(publicationDateTime: string, timezone = BLACKROOM_TIMEZONE): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/.exec(publicationDateTime);
  if (!match) throw new Error("Invalid Metricool publication date");
  const [, year, month, day, hour, minute, second] = match;
  const expectedWallClockMs = Date.UTC(
    Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second),
  );
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  let instantMs = expectedWallClockMs;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = Object.fromEntries(
      formatter.formatToParts(new Date(instantMs)).map((part) => [part.type, part.value]),
    );
    const observedWallClockMs = Date.UTC(
      Number(parts.year), Number(parts.month) - 1, Number(parts.day),
      Number(parts.hour), Number(parts.minute), Number(parts.second),
    );
    const correctionMs = expectedWallClockMs - observedWallClockMs;
    instantMs += correctionMs;
    if (correctionMs === 0) break;
  }
  const finalParts = Object.fromEntries(
    formatter.formatToParts(new Date(instantMs)).map((part) => [part.type, part.value]),
  );
  const normalized = `${finalParts.year}-${finalParts.month}-${finalParts.day}T${finalParts.hour}:${finalParts.minute}:${finalParts.second}`;
  if (normalized !== publicationDateTime) {
    throw new Error(`Metricool publication date does not exist in timezone ${timezone}`);
  }
  const offsetMinutes = Math.round((expectedWallClockMs - instantMs) / 60_000);
  if (!Number.isFinite(offsetMinutes) || Math.abs(offsetMinutes) > 14 * 60) {
    throw new Error(`Invalid Metricool timezone offset for ${timezone}`);
  }
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absoluteMinutes = Math.abs(offsetMinutes);
  const offset = `${String(Math.floor(absoluteMinutes / 60)).padStart(2, "0")}:${String(absoluteMinutes % 60).padStart(2, "0")}`;
  return `${publicationDateTime}${sign}${offset}`;
}

export class BlackRoomMetricoolUncertainError extends Error {
  readonly uncertain = true;
  constructor(message: string) {
    super(message);
    this.name = "BlackRoomMetricoolUncertainError";
  }
}

export async function postMetricoolJsonBytes(
  url: string,
  token: string,
  serializedPayload: string,
  timeoutMs = 120_000,
  spawnProcess: typeof spawn = spawn,
): Promise<Response> {
  const target = new URL(url);
  if (!['http:', 'https:'].includes(target.protocol)) throw new Error("Invalid Metricool scheduler protocol");
  if (/[\r\n]/.test(token)) throw new Error("Invalid Metricool scheduler token");
  const payloadBytes = Buffer.from(serializedPayload, "utf8");
  const payloadDirectory = mkdtempSync(join(tmpdir(), "blackroom-metricool-"));
  const payloadPath = join(payloadDirectory, "payload.json");
  writeFileSync(payloadPath, payloadBytes, { mode: 0o600 });
  const escapedToken = token.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const curlConfig = [
    `header = "X-Mc-Auth: ${escapedToken}"`,
    'header = "content-type: application/json"',
    'header = "accept: application/json"',
    "",
  ].join("\n");
  return new Promise<Response>((resolve, reject) => {
    const spawnCurl = () => spawnProcess("curl", [
      "--silent",
      "--show-error",
      "--http1.1",
      "--request", "POST",
      "--url", target.toString(),
      "--config", "-",
      "--data-binary", `@${payloadPath}`,
      "--output", "-",
      "--write-out", "\n%{http_code}",
    ], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let child: ReturnType<typeof spawnCurl>;
    try { child = spawnCurl(); }
    catch (error) {
      try { rmSync(payloadDirectory, { recursive: true, force: true }); }
      catch { /* best-effort cleanup if curl cannot start */ }
      reject(error);
      return;
    }
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let settled = false;
    const finish = (error?: Error, response?: Response) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      try { rmSync(payloadDirectory, { recursive: true, force: true }); }
      catch { /* best-effort cleanup after curl closes */ }
      if (error) reject(error);
      else resolve(response!);
    };
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      finish(new Error("Metricool scheduler request timed out"));
    }, timeoutMs);
    const failStream = (streamName: string, error: Error) => {
      child.kill("SIGKILL");
      const detail = error.message
        .replace(token, "[redacted]")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 200);
      finish(new Error(`Metricool scheduler ${streamName} stream failed${detail ? `: ${detail}` : ""}`));
    };
    child.once("error", (error) => finish(error));
    child.stdin.once("error", (error) => failStream("request", error));
    child.stdout.once("error", (error) => failStream("response", error));
    child.stderr.once("error", (error) => failStream("diagnostic", error));
    child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
    child.once("close", (code) => {
      if (code !== 0) {
        const detail = Buffer.concat(stderr).toString("utf8").replace(token, "[redacted]").replace(/\s+/g, " ").trim().slice(0, 300);
        return finish(new Error(`Metricool scheduler transport failed${detail ? `: ${detail}` : ""}`));
      }
      const output = Buffer.concat(stdout);
      const separator = output.lastIndexOf(10);
      const status = Number(output.subarray(separator + 1).toString("ascii"));
      if (separator < 0 || !Number.isInteger(status) || status < 100 || status > 599) {
        return finish(new Error("Metricool scheduler transport returned an invalid status"));
      }
      const body = output.subarray(0, separator);
      finish(undefined, new Response(status === 204 ? null : body, { status }));
    });
    child.stdin.end(curlConfig);
  });
}

function requiredEnv(env: NodeJS.ProcessEnv, name: "METRICOOL_USER_TOKEN" | "METRICOOL_USER_ID"): string {
  const value = String(env[name] || "").trim();
  if (!value || /replace|example|your[-_ ]?token/i.test(value)) throw new Error(`${name} is not configured`);
  return value;
}

function objects(value: unknown): Record<string, any>[] {
  const found: Record<string, any>[] = [];
  const visit = (candidate: unknown) => {
    if (Array.isArray(candidate)) return candidate.forEach(visit);
    if (!candidate || typeof candidate !== "object") return;
    const record = candidate as Record<string, any>;
    found.push(record);
    Object.values(record).forEach(visit);
  };
  visit(value);
  return found;
}

export function extractMetricoolMediaId(value: unknown): string {
  if (typeof value === "string") {
    const normalizedUrl = value.trim();
    try {
      const parsed = new URL(normalizedUrl);
      if (["http:", "https:"].includes(parsed.protocol)) return normalizedUrl;
    } catch { /* handled below */ }
  }
  for (const record of objects(value)) {
    const mediaId = record.mediaId ?? record.media_id;
    if (typeof mediaId === "string" || typeof mediaId === "number") return String(mediaId);
  }
  const data = value && typeof value === "object" ? (value as Record<string, any>).data : null;
  if (data && !Array.isArray(data) && (typeof data.id === "string" || typeof data.id === "number")) return String(data.id);
  throw new Error("Metricool did not return a mediaId");
}

async function metricoolMediaId(response: Response): Promise<string> {
  const raw = (await response.text()).trim();
  if (!response.ok) {
    const detail = raw.replace(/(token|authorization|x-mc-auth)["'\s:=]+[^,"'\s}]+/gi, "$1=[redacted]").replace(/\s+/g, " ").slice(0, 500);
    throw new Error(`Metricool media normalization failed with HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
  }
  if (!raw) throw new Error("Metricool media normalization returned an empty response");
  if (/^application\/json\b/i.test(response.headers.get("content-type") || "") || /^[\[{]/.test(raw)) {
    try { return extractMetricoolMediaId(JSON.parse(raw)); }
    catch (error) {
      if (error instanceof SyntaxError) throw new Error("Metricool media normalization returned invalid JSON");
      throw error;
    }
  }
  return extractMetricoolMediaId(raw);
}

export function blackRoomYoutubeWatchUrl(sourceVideoId: string): string {
  const videoId = sourceVideoId.trim();
  if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) throw new Error("Invalid BlackRoom YouTube videoId");
  return `https://www.youtube.com/watch?v=${videoId}`;
}

export function buildBlackRoomFacebookCaption(
  caption: string,
  sourceVideoId: string,
  language: "en" | "es" = "en",
): string {
  const fullVideo = language === "es" ? "Mira el set completo en YouTube" : "Watch the full set on YouTube";
  const callToAction = language === "es"
    ? "Sigue la experiencia completa de BlackRoom"
    : "Follow the full BlackRoom experience";
  return `${caption.trim()}\n\n${fullVideo}: ${blackRoomYoutubeWatchUrl(sourceVideoId)}\n${callToAction}: ${BLACKROOM_FACEBOOK_MAIN_URL}`;
}

export function buildBlackRoomYouTubeCaption(input: BlackRoomMetricoolScheduleInput): string {
  const fullVideo = input.language === "es" ? "Set completo" : "Full set";
  return `${input.caption.trim()}\n\n${fullVideo}: ${blackRoomYoutubeWatchUrl(input.sourceVideoId)}\n#Shorts #BlackRoom`;
}

export function blackRoomMetricoolNetworks(input: BlackRoomMetricoolScheduleInput): BlackRoomMetricoolNetwork[] {
  const isShort = input.videoFormat === "vertical"
    && Number.isFinite(input.durationSeconds)
    && input.durationSeconds >= 3
    && input.durationSeconds <= 178;
  return isShort ? ["tiktok", "facebook", "youtube"] : ["tiktok", "facebook"];
}

export function buildMetricoolPayload(
  input: BlackRoomMetricoolScheduleInput,
  mediaId: string,
  network: BlackRoomMetricoolNetwork,
  caption = input.caption,
) {
  const timezone = input.timezone || BLACKROOM_TIMEZONE;
  const postTitle = caption.replace(/https?:\/\/\S+/g, "").replace(/\s+/g, " ").trim().slice(0, 100);
  const payload: Record<string, any> = {
    autoPublish: true,
    descendants: [],
    draft: false,
    firstCommentText: "",
    hasNotReadNotes: false,
    media: { mediaId },
    mediaAltText: [],
    providers: [{ network }],
    publicationDate: { dateTime: input.publicationDateTime, timezone },
    shortener: false,
    smartLinkData: { ids: [] },
    text: caption,
  };
  if (network === "tiktok") payload.tiktokData = {
      disableComment: false,
      disableDuet: false,
      disableStitch: false,
      privacyOption: "PUBLIC_TO_EVERYONE",
      commercialContentThirdParty: false,
      commercialContentOwnBrand: false,
      title: postTitle || "BlackRoom DJ clip",
      autoAddMusic: false,
      photoCoverIndex: 0,
    };
  if (network === "facebook") payload.facebookData = {
    type: input.videoFormat === "vertical" && input.durationSeconds >= 3 && input.durationSeconds <= 90 ? "REEL" : "POST",
    title: postTitle || "BlackRoom DJ clip",
  };
  if (network === "youtube") payload.youtubeData = {
    title: postTitle || "BlackRoom DJ Short",
    type: "short",
    privacy: "public",
    tags: ["BlackRoom", "DJ", "Music", "Shorts"],
    category: "MUSIC",
    madeForKids: false,
  };
  return payload;
}

export function buildMetricoolTikTokPayload(input: BlackRoomMetricoolScheduleInput, mediaId: string) {
  return buildMetricoolPayload(input, mediaId, "tiktok");
}

export function buildMetricoolFacebookPayload(input: BlackRoomMetricoolScheduleInput, mediaId: string) {
  return buildMetricoolPayload(
    input,
    mediaId,
    "facebook",
    buildBlackRoomFacebookCaption(input.caption, input.sourceVideoId, input.language),
  );
}

export function buildMetricoolYouTubeShortPayload(input: BlackRoomMetricoolScheduleInput, mediaId: string) {
  if (!blackRoomMetricoolNetworks(input).includes("youtube")) {
    throw new Error("BlackRoom YouTube Shorts require a vertical clip between 3 and 178 seconds");
  }
  return buildMetricoolPayload(input, mediaId, "youtube", buildBlackRoomYouTubeCaption(input));
}

export function findVerifiedMetricoolPost(value: unknown, caption: string, publicationDateTime: string): Record<string, any> | null {
  return objects(value).find((record) => {
    const text = String(record.text ?? record.caption ?? record.content ?? "");
    const publication = record.publicationDate;
    const dateTime = typeof publication === "string"
      ? publication
      : String(publication?.dateTime ?? record.publicationDateTime ?? record.date ?? "");
    return text === caption && dateTime.startsWith(publicationDateTime);
  }) || null;
}

async function metricoolJson(response: Response, operation: string): Promise<any> {
  const raw = await response.text();
  if (!response.ok) {
    const detail = raw.replace(/(token|authorization|x-mc-auth)["'\s:=]+[^,"'\s}]+/gi, "$1=[redacted]").replace(/\s+/g, " ").trim().slice(0, 500);
    throw new Error(`Metricool ${operation} failed with HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
  }
  const value = raw ? (() => { try { return JSON.parse(raw); } catch { return null; } })() : null;
  if (value == null) throw new Error(`Metricool ${operation} returned no JSON`);
  return value;
}

async function callMetricoolMcpTool(
  fetcher: FetchLike,
  token: string,
  name: string,
  args: Record<string, unknown>,
): Promise<any> {
  const response = await fetcher(METRICOOL_MCP_URL, {
    method: "POST",
    headers: {
      "X-Mc-Auth": token,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: `blackroom-${Date.now()}`,
      method: "tools/call",
      params: { name, arguments: args },
    }),
    signal: AbortSignal.timeout(180_000),
  });
  const raw = await response.text();
  if (!response.ok) {
    const detail = raw.replace(/(token|authorization|x-mc-auth)["'\s:=]+[^,"'\s}]+/gi, "$1=[redacted]").replace(/\s+/g, " ").trim().slice(0, 500);
    throw new Error(`Metricool MCP ${name} failed with HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
  }
  let envelope: any;
  try {
    if (/^text\/event-stream\b/i.test(response.headers.get("content-type") || "") || /^\s*(?:event:|data:)/m.test(raw)) {
      const events = raw.split(/\r?\n\r?\n/).flatMap((event) => {
        const data = event.split(/\r?\n/)
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trim())
          .join("\n");
        if (!data || data === "[DONE]") return [];
        return [JSON.parse(data)];
      });
      envelope = events.findLast((event) => event?.result || event?.error) || events.at(-1);
    } else envelope = JSON.parse(raw);
  } catch { throw new Error(`Metricool MCP ${name} returned invalid JSON or SSE`); }
  if (!envelope) throw new Error(`Metricool MCP ${name} returned no result`);
  if (envelope?.error) throw new Error(`Metricool MCP ${name} failed: ${String(envelope.error.message || "unknown error").slice(0, 500)}`);
  if (envelope?.result?.isError) {
    const detail = Array.isArray(envelope.result.content)
      ? envelope.result.content.map((item: any) => String(item?.text || "")).filter(Boolean).join(" ").slice(0, 500)
      : "unknown tool error";
    throw new Error(`Metricool MCP ${name} failed: ${detail}`);
  }
  return envelope?.result;
}

export async function scheduleBlackRoomMetricoolPost(
  input: BlackRoomMetricoolScheduleInput,
  options: {
    env?: NodeJS.ProcessEnv;
    fetch?: FetchLike;
    verifyOnly?: boolean;
    verificationAttempts?: number;
    verificationIntervalMs?: number;
    networks?: BlackRoomMetricoolNetwork[];
  } = {},
): Promise<BlackRoomMetricoolReceipt> {
  const env = options.env || process.env;
  const fetcher = options.fetch || fetch;
  const token = requiredEnv(env, "METRICOOL_USER_TOKEN");
  const userId = requiredEnv(env, "METRICOOL_USER_ID");
  const blogId = input.blogId || Number(env.BLACKROOM_METRICOOL_BLOG_ID || BLACKROOM_METRICOOL_BLOG_ID);
  if (!Number.isInteger(blogId) || blogId <= 0) throw new Error("Invalid Metricool blogId");
  if (!input.caption.trim() || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(input.publicationDateTime)) {
    throw new Error("Invalid Metricool caption or publication date");
  }
  // Read operations still use Metricool's scheduler API. Mutating operations
  // go through the current official MCP endpoint and tool contract.
  const headers = { "X-Mc-Auth": token, "content-type": "application/json", accept: "application/json" };
  const date = input.publicationDateTime.slice(0, 10);
  const localTimezone = input.timezone || BLACKROOM_TIMEZONE;
  const timezone = encodeURIComponent(localTimezone);
  const mcpDate = formatMetricoolMcpDate(input.publicationDateTime, localTimezone);
  const schedulerUrl = `https://app.metricool.com/api/v2/scheduler/posts?blogId=${blogId}&userId=${encodeURIComponent(userId)}&integrationSource=MCP`;
  const verifyUrl = `${schedulerUrl}&start=${date}T00%3A00%3A00&end=${date}T23%3A59%3A59&timezone=${timezone}&extendedRange=false`;
  const existing = await metricoolJson(await fetcher(verifyUrl, { headers, signal: AbortSignal.timeout(60_000) }), "duplicate preflight");
  const captions: Record<BlackRoomMetricoolNetwork, string> = {
    tiktok: input.caption,
    facebook: buildBlackRoomFacebookCaption(input.caption, input.sourceVideoId, input.language),
    youtube: buildBlackRoomYouTubeCaption(input),
  };
  const eligibleNetworks = blackRoomMetricoolNetworks(input);
  const requestedNetworks = options.networks?.length ? Array.from(new Set(options.networks)) : eligibleNetworks;
  if (requestedNetworks.some((network) => !eligibleNetworks.includes(network))) {
    throw new Error("Requested Metricool network is not eligible for this BlackRoom clip");
  }
  const requiredNetworks = requestedNetworks;
  const platformReceipts: Partial<Record<BlackRoomMetricoolNetwork, string>> = {};
  const missingNetworks: BlackRoomMetricoolNetwork[] = [];
  for (const network of requiredNetworks) {
    const existingMatch = findVerifiedMetricoolPost(existing, captions[network], input.publicationDateTime);
    const existingId = existingMatch?.id ?? existingMatch?.uuid;
    if (existingId == null || String(existingId).trim() === "") missingNetworks.push(network);
    else platformReceipts[network] = String(existingId);
  }
  if (!missingNetworks.length) {
    return {
      metricoolId: platformReceipts.tiktok || platformReceipts[requiredNetworks[0]]!,
      platformReceipts,
      publicationDateTime: input.publicationDateTime,
      caption: input.caption,
      verified: true,
    };
  }
  if (options.verifyOnly) {
    throw new BlackRoomMetricoolUncertainError(`Metricool verification is still pending for ${missingNetworks.join(", ")}`);
  }
  for (const network of missingNetworks) {
    const payload = buildMetricoolPayload(input, "", network, captions[network]);
    // The live MCP schema exposes mediaFiles for attached files. Keep the
    // public MP4 in info.media too, so non-ChatGPT MCP clients retain media.
    payload.media = [input.mediaUrl];
    let scheduled: any;
    try {
      scheduled = await callMetricoolMcpTool(fetcher, token, "createScheduledPost", {
        date: mcpDate,
        blogId: String(blogId),
        info: JSON.stringify(payload),
        mediaFiles: [{
          download_url: input.mediaUrl,
          file_id: `blackroom-${input.sourceVideoId}-${network}.mp4`,
        }],
      });
    } catch (error) {
      if (error instanceof Error && /MCP createScheduledPost failed(?: with HTTP 4\d\d|:)/.test(error.message)) throw error;
      throw new BlackRoomMetricoolUncertainError(
        `Metricool ${network} scheduling outcome is uncertain: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    let matched: Record<string, any> | null = null;
    const verificationAttempts = Math.max(1, Math.min(12, options.verificationAttempts ?? 6));
    const verificationIntervalMs = Math.max(0, Math.min(10_000, options.verificationIntervalMs ?? 2_000));
    try {
      for (let attempt = 0; attempt < verificationAttempts && !matched; attempt += 1) {
        if (attempt && verificationIntervalMs) await new Promise((resolve) => setTimeout(resolve, verificationIntervalMs));
        const verification = await metricoolJson(
          await fetcher(verifyUrl, { headers, signal: AbortSignal.timeout(60_000) }),
          `${network} post verification`,
        );
        matched = findVerifiedMetricoolPost(verification, captions[network], input.publicationDateTime);
      }
    } catch (error) {
      throw new BlackRoomMetricoolUncertainError(
        `Metricool ${network} verification outcome is uncertain: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (!matched) {
      throw new BlackRoomMetricoolUncertainError(`Metricool ${network} post was submitted but verification is still pending`);
    }
    const id = matched.id ?? matched.uuid ?? scheduled?.id ?? scheduled?.uuid;
    if (id == null || String(id).trim() === "") throw new Error(`Metricool scheduled ${network} post has no identifier`);
    platformReceipts[network] = String(id);
  }
  if (requiredNetworks.some((network) => !platformReceipts[network])) {
    throw new Error("Metricool did not confirm every BlackRoom network");
  }
  return {
    metricoolId: platformReceipts.tiktok || platformReceipts[requiredNetworks[0]]!,
    platformReceipts,
    publicationDateTime: input.publicationDateTime,
    caption: input.caption,
    verified: true,
  };
}
