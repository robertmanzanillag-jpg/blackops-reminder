import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

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

let _cachedCookieTempPath: string | null = null;

async function writeCookieTempFile(content: string): Promise<string> {
  if (_cachedCookieTempPath) {
    try {
      await fs.access(_cachedCookieTempPath);
      return _cachedCookieTempPath;
    } catch {
      _cachedCookieTempPath = null;
    }
  }
  const hash = crypto.createHash("sha1").update(content).digest("hex").slice(0, 8);
  const filePath = path.join(os.tmpdir(), `yt-dlp-cookies-${hash}.txt`);
  await fs.writeFile(filePath, content, { mode: 0o600 });
  _cachedCookieTempPath = filePath;
  return filePath;
}

export async function resolveCookieArgsForYtDlp(): Promise<string[]> {
  const cookiesPath = process.env.YT_DLP_COOKIES_PATH?.trim();
  if (hasConfiguredValue(cookiesPath)) return ["--cookies", cookiesPath];

  const cookiesFromBrowser = process.env.YT_DLP_COOKIES_FROM_BROWSER?.trim();
  if (hasConfiguredValue(cookiesFromBrowser)) return ["--cookies-from-browser", cookiesFromBrowser];

  const b64 =
    process.env.YT_DLP_COOKIES_B64?.trim() ||
    process.env.YT_DLP_COOKIES_BASE64?.trim();
  if (hasConfiguredValue(b64)) {
    try {
      const decoded = Buffer.from(b64, "base64").toString("utf8");
      if (decoded.trim()) {
        const tempPath = await writeCookieTempFile(decoded);
        return ["--cookies", tempPath];
      }
    } catch {
      // fall through
    }
  }

  const rawCookies = process.env.YT_DLP_COOKIES?.trim();
  if (hasConfiguredValue(rawCookies)) {
    const tempPath = await writeCookieTempFile(rawCookies);
    return ["--cookies", tempPath];
  }

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
  const cookieArgs = params.cookieArgs ?? [];
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
      "Para automatizarlo, agrega el secret YT_DLP_COOKIES_B64 con tus cookies de YouTube en base64.",
      "Instrucciones: exporta cookies desde Chrome con la extensión 'Get cookies.txt LOCALLY', codifícalas en base64 (base64 cookies.txt) y pega el resultado en el secret.",
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
