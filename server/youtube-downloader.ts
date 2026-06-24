import { createHash } from "node:crypto";
import { chmodSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

type YtDlpDownloadMode = "video" | "audio";

export type YtDlpCommandSpec = {
  command: string;
  args: string[];
  env?: NodeJS.ProcessEnv;
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

function configuredYoutubeCookieArgVariants(explicitCookieArgs?: string[]): string[][] {
  if (explicitCookieArgs) return [explicitCookieArgs];

  const configured = configuredYoutubeCookieArgs();
  if (configured.length === 0) return [[]];

  // A stale browser cookie export can make YouTube return HTTP 400/precondition errors.
  // Try the authenticated path first, then fall back to the anonymous extractor path.
  return [configured, []];
}

function uniqueCommandSpecs(specs: YtDlpCommandSpec[]): YtDlpCommandSpec[] {
  const seen = new Set<string>();
  return specs.filter((spec) => {
    const key = `${spec.command}\0${spec.args.join("\0")}\0${spec.env?.PYTHONPATH || ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function configuredJsRuntimeVariants(): string[][] {
  const rawRuntimes = process.env.YT_DLP_JS_RUNTIMES?.trim();
  if (!hasConfiguredValue(rawRuntimes) || /^(0|false|off|none|disabled)$/i.test(rawRuntimes)) {
    return [[]];
  }

  const runtimes = rawRuntimes
    .split(/[,\s]+/)
    .map((runtime) => runtime.trim())
    .filter(Boolean);

  return [
    [],
    ...runtimes.map((runtime) => ["--js-runtimes", runtime]),
  ];
}

function configuredYoutubeClientVariants(): string[][] {
  const rawClients = process.env.YT_DLP_YOUTUBE_CLIENTS?.trim();
  if (/^(0|false|off|none|disabled)$/i.test(rawClients || "")) return [[]];

  const clientSets = hasConfiguredValue(rawClients)
    ? rawClients.split(/[;\n]+/).map((clientSet) => clientSet.trim()).filter(Boolean)
    : [
        "web,ios,android",
        "mweb",
      ];

  return [
    [],
    ...clientSets.map((clientSet) => ["--extractor-args", `youtube:player_client=${clientSet}`]),
  ];
}

function formatVariants(mode: YtDlpDownloadMode): string[] {
  if (mode === "audio") return ["ba/bestaudio/best"];

  return [
    "bv*[height<=1080][ext=mp4]+ba[ext=m4a]/bv*[height<=1080]+ba/b[height<=1080][ext=mp4]/b[height<=1080]/best[height<=1080]/best",
    "bv*[height<=1080]+ba/b[height<=1080]/best[height<=1080]/best",
    "bestvideo[height<=1080]+bestaudio/best[height<=1080]/best",
  ];
}

function pythonEnvForPackageDir(packageDir: string): NodeJS.ProcessEnv {
  const currentPythonPath = process.env.PYTHONPATH?.trim();
  return {
    ...process.env,
    PYTHONPATH: currentPythonPath ? `${packageDir}${delimiter}${currentPythonPath}` : packageDir,
  };
}

export function buildYtDlpCommandSpecs(params: {
  url: string;
  outputTemplate: string;
  mode: YtDlpDownloadMode;
  explicitBinary?: string;
  cookieArgs?: string[];
  freshPythonPackageDir?: string | null;
}): YtDlpCommandSpec[] {
  const cookieArgVariants = configuredYoutubeCookieArgVariants(params.cookieArgs);
  const clientVariants = configuredYoutubeClientVariants();
  const formats = formatVariants(params.mode);
  const runtimeVariants = configuredJsRuntimeVariants();
  const binaries: Array<{ command: string; argsPrefix?: string[]; env?: NodeJS.ProcessEnv }> = [
    ...(hasConfiguredValue(params.freshPythonPackageDir)
      ? [{ command: "python3", argsPrefix: ["-m", "yt_dlp"], env: pythonEnvForPackageDir(params.freshPythonPackageDir) }]
      : []),
    ...(params.explicitBinary?.trim() ? [{ command: params.explicitBinary.trim() }] : []),
    { command: "yt-dlp" },
    { command: "python3", argsPrefix: ["-m", "yt_dlp"] },
    { command: "python", argsPrefix: ["-m", "yt_dlp"] },
  ];

  return uniqueCommandSpecs(binaries.flatMap((binary) => runtimeVariants.flatMap((runtimeArgs) =>
    clientVariants.flatMap((clientArgs) => formats.flatMap((format) =>
      cookieArgVariants.map((cookieArgs) => ({
        command: binary.command,
        env: binary.env,
        args: [
          ...(binary.argsPrefix || []),
          ...runtimeArgs,
          ...clientArgs,
          "--no-playlist",
          ...cookieArgs,
          "-f",
          format,
          ...(params.mode === "video" ? ["--merge-output-format", "mp4"] : []),
          "--restrict-filenames",
          "-o",
          params.outputTemplate,
          params.url,
        ],
      }))
    ))
  )));
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

  if (/precondition check failed|signature extraction failed|only images are available|requested format is not available|unable to download api page|http error 400|bad request/.test(lower)) {
    return [
      `No pude descargar el ${mediaLabel} de YouTube porque YouTube devolvió formatos inválidos o incompletos para yt-dlp.`,
      "Esto suele pasar cuando yt-dlp está viejo o cuando las cookies de YouTube expiraron/rompen el extractor.",
      "El agente intenta primero un yt-dlp actualizado y también prueba con y sin cookies; si sigue pasando, regenera el secret YT_DLP_COOKIES_B64 o usa un MP4 fuente desde Google Drive.",
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
