import { createHash } from "node:crypto";
import { chmodSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

type YtDlpDownloadMode = "video" | "audio";

export type YtDlpCommandSpec = {
  command: string;
  args: string[];
};

function hasConfiguredValue(value?: string | null): value is string {
  if (!value) return false;
  const normalized = value.trim();
  return Boolean(normalized) && !/^(changeme|change-me|todo|replace|replace-with|your-|<.*>)$/i.test(normalized);
}

function normalizeCookieFileContent(rawValue: string): string {
  const normalized = rawValue.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  return normalized.endsWith("\n") ? normalized : `${normalized}\n`;
}

function decodeBase64CookieSecret(rawValue: string): string | null {
  const trimmed = rawValue.trim();
  const encoded = trimmed.startsWith("data:")
    ? trimmed.slice(trimmed.indexOf(",") + 1)
    : trimmed;
  const decoded = Buffer.from(encoded.replace(/\s+/g, ""), "base64").toString("utf8");
  return hasConfiguredValue(decoded) ? normalizeCookieFileContent(decoded) : null;
}

function writeCookieSecretToTempFile(rawCookieFile: string): string {
  const cookieFile = normalizeCookieFileContent(rawCookieFile);
  const digest = createHash("sha256").update(cookieFile).digest("hex").slice(0, 16);
  const cookiePath = join(tmpdir(), `yt-dlp-youtube-cookies-${digest}.txt`);
  writeFileSync(cookiePath, cookieFile, { encoding: "utf8", mode: 0o600 });
  try {
    chmodSync(cookiePath, 0o600);
  } catch {
    // Best effort only. The file is still written outside the repo and never logged.
  }
  return cookiePath;
}

function configuredYoutubeCookieFileFromSecret(): string | null {
  const cookiesBase64 = process.env.YT_DLP_COOKIES_B64 || process.env.YT_DLP_COOKIES_BASE64;
  if (hasConfiguredValue(cookiesBase64)) {
    const decoded = decodeBase64CookieSecret(cookiesBase64);
    if (decoded) return writeCookieSecretToTempFile(decoded);
  }

  const cookiesRaw = process.env.YT_DLP_COOKIES;
  if (hasConfiguredValue(cookiesRaw)) {
    return writeCookieSecretToTempFile(cookiesRaw);
  }

  return null;
}

function configuredYoutubeCookieArgs(): string[] {
  const cookiesPath = process.env.YT_DLP_COOKIES_PATH?.trim();
  if (hasConfiguredValue(cookiesPath)) return ["--cookies", cookiesPath];

  const cookiesSecretPath = configuredYoutubeCookieFileFromSecret();
  if (cookiesSecretPath) return ["--cookies", cookiesSecretPath];

  const cookiesFromBrowser = process.env.YT_DLP_COOKIES_FROM_BROWSER?.trim();
  if (hasConfiguredValue(cookiesFromBrowser)) return ["--cookies-from-browser", cookiesFromBrowser];

  return [];
}

function uniqueCommandSpecs(specs: YtDlpCommandSpec[]): YtDlpCommandSpec[] {
  const seen = new Set<string>();
  return specs.filter((spec) => {
    const key = `${spec.command}\0${spec.args.join("\0")}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function buildYtDlpCommandSpecs(params: {
  url: string;
  outputTemplate: string;
  mode: YtDlpDownloadMode;
  explicitBinary?: string;
  cookieArgs?: string[];
}): YtDlpCommandSpec[] {
  const cookieArgs = params.cookieArgs || configuredYoutubeCookieArgs();
  const format = params.mode === "video"
    ? "bv*[height<=1080]+ba/b[height<=1080]/bv*+ba/best"
    : "ba/bestaudio";
  const baseArgs = [
    "--no-playlist",
    ...cookieArgs,
    "-f",
    format,
    ...(params.mode === "video" ? ["--merge-output-format", "mp4"] : []),
    "--restrict-filenames",
    "-o",
    params.outputTemplate,
    params.url,
  ];
  const runtimeVariants = [
    ["--js-runtimes", "deno"],
    ["--js-runtimes", "node"],
    [],
  ];
  const binaries = [
    ...(params.explicitBinary?.trim() ? [params.explicitBinary.trim()] : []),
    "yt-dlp",
    "python3",
    "python",
  ];

  return uniqueCommandSpecs(binaries.flatMap((command) => {
    const commandPrefix = command === "python3" || command === "python" ? ["-m", "yt_dlp"] : [];
    return runtimeVariants.map((runtimeArgs) => ({
      command,
      args: [...commandPrefix, ...runtimeArgs, ...baseArgs],
    }));
  }));
}

export function formatYtDlpFailureMessage(rawError: string, mediaLabel: "video" | "audio" = "video"): string {
  const lower = rawError.toLowerCase();

  if (/sign in to confirm|not a bot|confirm you.?re not a bot|use --cookies|cookies for the authentication|http error 429/.test(lower)) {
    return [
      `No pude descargar el ${mediaLabel} de YouTube porque YouTube bloqueó la descarga desde Replit con verificación de bot/login.`,
      "Google Drive puede estar conectado bien; el bloqueo ocurre antes, al bajar el YouTube.",
      "Para automatizarlo de forma estable, configura cookies de YouTube en un Replit Secret YT_DLP_COOKIES_B64 o YT_DLP_COOKIES_PATH; no pegues cookies en el chat. Alternativa: sube el MP4 fuente a Google Drive y pásame ese archivo como entrada.",
    ].join(" ");
  }

  if (/no such option:\s*--js-runtimes|unsupported option.*js-runtimes/.test(lower)) {
    return [
      `No pude descargar el ${mediaLabel} de YouTube porque la versión de yt-dlp instalada no soporta --js-runtimes.`,
      "Actualiza yt-dlp en Replit o usa el fallback sin ese flag; el agente ya intenta ambas rutas en esta versión.",
    ].join(" ");
  }

  if (/no supported javascript runtime could be found|javascript runtime/.test(lower)) {
    return [
      `No pude descargar el ${mediaLabel} de YouTube porque falta un runtime JavaScript para yt-dlp.`,
      "Instala deno en Replit y vuelve a intentar.",
    ].join(" ");
  }

  if (/command not found|enoent|no module named yt_dlp|no module named yt-dlp/.test(lower)) {
    return [
      `No pude descargar el ${mediaLabel} de YouTube porque yt-dlp no está instalado o no está en PATH.`,
      "Instala yt-dlp en Replit o configura YT_DLP_PATH con la ruta correcta.",
    ].join(" ");
  }

  return `No pude descargar el ${mediaLabel} de YouTube. Detalle: ${rawError}`;
}
