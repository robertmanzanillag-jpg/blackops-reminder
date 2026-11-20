// Cloud (GitHub Actions, Linux) download + render for the streamer clip pages. $0: no AI, no paid APIs.
//
// - Download: yt-dlp (repo bin/yt-dlp or a pip install), `--impersonate chrome` first for YouTube
//   (.agents/memory/yt-dlp-impersonate.md), only the selected section (never a full VOD).
//   Twitch clips: the official Helix clip metadata (url, duration) picks the clip; yt-dlp fetches it.
// - Cut: whole clip when it is already <= the target; otherwise the YouTube "most replayed" heatmap
//   peak window (yt-dlp info JSON), else a fixed early-middle fallback. Always <= 60 s.
// - Render: ffmpeg only (no ImageMagick, no zsh, no BSD stat): 1080x1920, blurred fill + fitted
//   source, burned hook text and "@handle" credit with the bundled DejaVu font, loudness normalised,
//   fades, H.264/AAC, faststart. ffprobe validates size, audio and duration before it is accepted.
// Every external program is started with execFile (no shell) and a timeout.
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { copyFile, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { STREAMER_CLIP_MAX_SECONDS } from '../shared/clippers-streamer-policy.mjs';

export const BUNDLED_FONT = fileURLToPath(new URL('../assets/fonts/DejaVuSans-Bold.ttf', import.meta.url));
export const RENDER_WIDTH = 1080;
export const RENDER_HEIGHT = 1920;
export const MAX_SOURCE_BYTES = 400 * 1024 * 1024;
const SAFE_PATH = /^[A-Za-z0-9_./-]+$/;

const clean = (value, max) => String(value ?? '').normalize('NFC').replace(/[\x00-\x1f\x7f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

/**
 * Pick the source window. `heatmap` is yt-dlp's [{start_time,end_time,value}] ("most replayed").
 * Returns integer-ish seconds; duration is always within (0, maxSec].
 */
export function selectCutWindow({ durationSec, heatmap = null, targetSec = 45, maxSec = STREAMER_CLIP_MAX_SECONDS }) {
  const target = Math.max(5, Math.min(maxSec, Number(targetSec) || 45));
  const total = Number(durationSec);
  if (!Number.isFinite(total) || total <= 0) return { start: 0, duration: target, source: 'unknown_duration' };
  if (total <= target + 0.5) return { start: 0, duration: Math.min(total, maxSec), source: 'full_clip' };
  const marks = Array.isArray(heatmap) ? heatmap.filter(m => Number.isFinite(m?.start_time) && Number.isFinite(m?.end_time) && Number.isFinite(m?.value) && m.end_time > m.start_time) : [];
  // Skip the first 3% (intros) and the last 3% (end screens) of long videos.
  const lo = total > 120 ? total * 0.03 : 0, hi = total > 120 ? total * 0.97 : total;
  if (marks.length >= 5) {
    let best = null;
    for (const m of marks) {
      const start = Math.max(lo, Math.min(m.start_time - target * 0.25, hi - target));
      const end = start + target;
      let heat = 0;
      for (const n of marks) heat += Math.max(0, Math.min(end, n.end_time) - Math.max(start, n.start_time)) * n.value;
      if (!best || heat > best.heat) best = { start, heat };
    }
    if (best) return { start: Math.round(best.start * 10) / 10, duration: target, source: 'heatmap_peak' };
  }
  const start = Math.max(lo, Math.min(total * 0.2, hi - target));
  return { start: Math.round(start * 10) / 10, duration: target, source: 'fallback_offset' };
}

/** Greedy word wrap for the burned hook (drawtext does not wrap). */
export function wrapLines(text, maxChars = 22, maxLines = 3) {
  const words = clean(text, 200).split(' ').filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    const piece = word.length > maxChars ? word.slice(0, maxChars - 1) + '…' : word;
    if (!line) line = piece;
    else if ((line + ' ' + piece).length <= maxChars) line += ' ' + piece;
    else { lines.push(line); line = piece; }
  }
  if (line) lines.push(line);
  if (lines.length <= maxLines) return lines.join('\n');
  const kept = lines.slice(0, maxLines);
  kept[maxLines - 1] = kept[maxLines - 1].slice(0, maxChars - 1).replace(/\s+$/, '') + '…';
  return kept.join('\n');
}

export function hookText({ variant, title, handle, language = 'es' }) {
  const h = '@' + clean(handle, 40).replace(/^@+/, '').replace(/[^A-Za-z0-9_.-]/g, '');
  if (variant === 'teaser') return language === 'en' ? `Watch what happened to ${h}` : `Mira lo que le pasó a ${h}`;
  return clean(title, 90) || (language === 'en' ? `Best of ${h}` : `Lo mejor de ${h}`);
}

export function creditText({ handle, platform }) {
  const h = '@' + clean(handle, 40).replace(/^@+/, '').replace(/[^A-Za-z0-9_.-]/g, '');
  return `Créditos: ${h} · ${platform === 'twitch' ? 'Twitch' : 'YouTube'}`;
}

function filterPath(p) {
  if (!SAFE_PATH.test(p)) throw new Error('RENDER_UNSAFE_PATH');
  return p;
}

/** yt-dlp spec: the binary, its env additions and the leading args. Impersonation first for YouTube. */
export function ytDlpBase(env = process.env) {
  const bin = clean(env.CLIPPERS_YTDLP_BIN, 300) || fileURLToPath(new URL('../bin/yt-dlp', import.meta.url));
  const extraEnv = env.CLIPPERS_CURL_CFFI_DIR ? { PYTHONPATH: [env.CLIPPERS_CURL_CFFI_DIR, env.PYTHONPATH].filter(Boolean).join(path.delimiter) } : {};
  const impersonate = String(env.YT_DLP_IMPERSONATE || 'chrome').split(',').map(s => s.trim()).filter(s => /^[a-z0-9.:-]{1,30}$/i.test(s));
  return { bin, extraEnv, impersonate: impersonate.length ? impersonate : ['chrome'] };
}

export function ytDlpInfoArgs({ url, impersonate }) {
  return [...(impersonate ? ['--impersonate', impersonate] : []), '--js-runtimes', 'node', '--no-playlist', '--no-warnings', '--skip-download', '--dump-single-json', '--', url];
}

export function ytDlpDownloadArgs({ url, platform, start, duration, outTemplate, impersonate }) {
  const format = platform === 'twitch' ? 'best[ext=mp4]/best' : 'bv*[height<=1080][ext=mp4]+ba[ext=m4a]/b[height<=1080][ext=mp4]/bv*[height<=1080]+ba/b';
  const args = [...(impersonate ? ['--impersonate', impersonate] : []), '--js-runtimes', 'node', '--no-playlist', '--no-warnings', '--no-part',
    '--max-filesize', String(MAX_SOURCE_BYTES), '-f', format, '--merge-output-format', 'mp4', '-o', outTemplate];
  // Only the selected section is downloaded (never the whole video/VOD).
  if (platform !== 'twitch' || start > 0) args.push('--download-sections', `*${Math.max(0, start).toFixed(1)}-${(Math.max(0, start) + duration + 1).toFixed(1)}`);
  return [...args, '--', url];
}

/** ffmpeg args for the vertical edit. Inputs must be in a safe temp dir (paths go into the filtergraph). */
export function ffmpegRenderArgs({ input, output, hookFile, creditFile, fontFile, duration }) {
  const d = Math.max(1, Math.min(STREAMER_CLIP_MAX_SECONDS, Number(duration)));
  const font = filterPath(fontFile), hook = filterPath(hookFile), credit = filterPath(creditFile);
  const text = (file, size, y, box) => `drawtext=fontfile=${font}:textfile=${file}:expansion=none:fontsize=${size}:fontcolor=white:borderw=5:bordercolor=black@0.85:line_spacing=10:text_align=C:x=(w-text_w)/2:y=${y}${box ? ':box=1:boxcolor=black@0.35:boxborderw=18' : ''}`;
  const graph = [
    `[0:v]fps=30,split=2[a][b]`,
    `[a]scale=${RENDER_WIDTH}:${RENDER_HEIGHT}:force_original_aspect_ratio=increase,crop=${RENDER_WIDTH}:${RENDER_HEIGHT},gblur=sigma=28,eq=brightness=-0.10[bg]`,
    `[b]scale=${RENDER_WIDTH}:${RENDER_HEIGHT}:force_original_aspect_ratio=decrease,setsar=1[fg]`,
    `[bg][fg]overlay=(W-w)/2:(H-h)/2,${text(hook, 64, 'h*0.12', true)},${text(credit, 40, 'h*0.86', false)},format=yuv420p[v]`,
    `[0:a]aresample=48000,loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000,afade=t=in:d=0.25,afade=t=out:st=${Math.max(0, d - 0.6).toFixed(2)}:d=0.6[aout]`,
  ].join(';');
  return ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-i', input, '-t', d.toFixed(2), '-filter_complex', graph,
    '-map', '[v]', '-map', '[aout]', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', '-profile:v', 'high', '-r', '30',
    '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-map_metadata', '-1', '-movflags', '+faststart', output];
}

/** Rendered output check: exact 1080x1920 video, audio present, 3 s <= duration <= 60 s (+0.5 tolerance). */
export function validateRenderProbe(probe, { maxSec = STREAMER_CLIP_MAX_SECONDS } = {}) {
  const streams = Array.isArray(probe?.streams) ? probe.streams : [];
  const duration = Number(probe?.format?.duration);
  const errors = [];
  if (!streams.some(s => s.codec_type === 'video' && s.width === RENDER_WIDTH && s.height === RENDER_HEIGHT)) errors.push('render_not_1080x1920');
  if (!streams.some(s => s.codec_type === 'audio')) errors.push('render_without_audio');
  if (!Number.isFinite(duration) || duration < 3 || duration > maxSec + 0.5) errors.push('render_duration_out_of_range');
  return { ok: errors.length === 0, errors, durationSec: Number.isFinite(duration) ? Math.round(duration * 100) / 100 : null };
}

/** Child processes get only what they need: never DATABASE_URL, Metricool, GitHub or API secrets. */
export const CHILD_ENV_KEYS = Object.freeze(['PATH', 'HOME', 'TMPDIR', 'LANG', 'PYTHONPATH']);
export function childEnv(parent = process.env, extra = {}) {
  const out = {};
  for (const key of CHILD_ENV_KEYS) if (typeof parent[key] === 'string') out[key] = parent[key];
  for (const [key, value] of Object.entries(extra)) if (CHILD_ENV_KEYS.includes(key) && typeof value === 'string') out[key] = value;
  return out;
}

/**
 * Text made safe for public logs (the repository is public): credentials, signed URLs, cookies and
 * tokens are removed; paths under home/tmp and long opaque ids are replaced.
 */
export function scrubText(text, max = 200) {
  return String(text ?? '')
    .replace(/[\x00-\x1f\x7f]/g, ' ')
    .replace(/\b(authorization|proxy-authorization|cookie|set-cookie)\s*:.*$/gi, '$1: [redacted]')
    .replace(/\b(Bearer|OAuth|Basic|Token)\s+[^\s,;]+/gi, '$1 [redacted]')
    .replace(/\b[a-z][\w+.-]*:\/\/\S+/gi, '[url]')
    .replace(/\b(?:[a-z0-9-]+\.)+[a-z]{2,}(?::\d+)?\/\S*\?\S*/gi, '[url]')
    .replace(/\b(sig|token|signature|key|auth|access_token|refresh_token|client_secret|client_id|password|passwd|secret|nauthsig|nauth|X-Amz-[\w-]+)=[^&\s]+/gi, '$1=[redacted]')
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[email]')
    .replace(/\/(?:home|Users|tmp|root)\/\S*/g, '[path]')
    .replace(/[A-Za-z0-9_+/=-]{24,}/g, '[id]')
    .replace(/\s+/g, ' ').trim().slice(0, max);
}

/** Last meaningful stderr line, scrubbed with scrubText. */
export function scrubDiagnostic(text, max = 200) {
  const lines = String(text ?? '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const pick = [...lines].reverse().find(l => /ERROR|error|Error|WARNING/.test(l)) ?? lines.at(-1) ?? '';
  return scrubText(pick, max);
}

function run(bin, args, { timeoutMs = 300_000, env = {}, maxBuffer = 64 * 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { timeout: timeoutMs, maxBuffer, windowsHide: true, env: childEnv(process.env, env) }, (error, stdout, stderr) => {
      if (error) {
        // Never echo URLs/tokens: only a short code-like tail of stderr.
        const exitCode = Number.isInteger(error.code) ? error.code : null;
        return reject(Object.assign(new Error(`${path.basename(bin).toUpperCase().replace(/[^A-Z0-9]/g, '_')}_FAILED`),
          { exitCode, signal: error.signal ?? null, timedOut: error.killed === true, detail: scrubDiagnostic(stderr || (typeof error.code === 'string' ? error.code : '')) }));
      }
      resolve({ stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

export async function sha256File(file) {
  return createHash('sha256').update(await readFile(file)).digest('hex');
}

export async function makeWorkDir() {
  const dir = await mkdtemp(path.join(tmpdir(), 'clippers-streamer-'));
  if (!SAFE_PATH.test(dir)) { await rm(dir, { recursive: true, force: true }); throw new Error('RENDER_UNSAFE_TMPDIR'); }
  return dir;
}

export const BOT_CHECK = /confirm you.?re not a bot|Sign in to confirm/i;

/** Download only the needed section. Returns { file, cut }. */
export async function downloadSource({ candidate, workDir, targetSec = 45, env = process.env, runner = run }) {
  const base = ytDlpBase(env);
  const url = candidate.sourceUrl;
  if (!/^https:\/\//.test(url)) throw new Error('SOURCE_URL_INVALID');
  let cut;
  let lastError = null;
  const attempts = [];
  // Impersonation targets first (YouTube TLS fingerprinting), then plain yt-dlp.
  const variants = candidate.platform === 'youtube' ? [...base.impersonate, null] : [null, ...base.impersonate];
  for (const impersonate of variants) {
    let step = 'info';
    try {
      if (!cut) {
        if (candidate.platform === 'twitch' && Number.isFinite(candidate.durationSec) && candidate.durationSec > 0) {
          cut = selectCutWindow({ durationSec: candidate.durationSec, targetSec: STREAMER_CLIP_MAX_SECONDS });
        } else {
          const { stdout } = await runner(base.bin, ytDlpInfoArgs({ url, impersonate }), { env: base.extraEnv, timeoutMs: 120_000 });
          const info = JSON.parse(stdout);
          if (info?.is_live || info?.live_status === 'is_live') throw Object.assign(new Error('SOURCE_IS_LIVE'), { fatal: true });
          cut = selectCutWindow({ durationSec: Number(info?.duration) || candidate.durationSec, heatmap: info?.heatmap, targetSec });
        }
      }
      const outTemplate = path.join(workDir, 'source.%(ext)s');
      step = 'download';
      await runner(base.bin, ytDlpDownloadArgs({ url, platform: candidate.platform, start: cut.start, duration: cut.duration, outTemplate, impersonate }), { env: base.extraEnv, timeoutMs: 600_000 });
      const file = (await readdir(workDir)).filter(n => n.startsWith('source.')).map(n => path.join(workDir, n))[0];
      if (!file) throw new Error('SOURCE_DOWNLOAD_EMPTY');
      const info = await stat(file);
      if (!info.isFile() || info.size < 10_000 || info.size > MAX_SOURCE_BYTES) throw new Error('SOURCE_DOWNLOAD_SIZE');
      // With --download-sections the file already starts at the cut.
      return { file, cut: { ...cut, offsetInFile: 0 } };
    } catch (error) {
      attempts.push({ step, impersonate: impersonate ?? 'none', error: scrubText(error?.message ?? 'ERROR', 40), exitCode: error?.exitCode ?? null,
        timedOut: error?.timedOut ?? false, detail: error?.detail ?? null });
      if (error?.fatal) throw Object.assign(error, { diagnostics: { platform: candidate.platform, attempts } });
      lastError = error;
      // A fresh directory state for the next variant (a partial file must not be mistaken for the source).
      for (const n of await readdir(workDir).catch(() => [])) if (n.startsWith('source.')) await rm(path.join(workDir, n), { force: true }).catch(() => undefined);
    }
  }
  const diagnostics = { platform: candidate.platform, attempts };
  // Every variant hit the datacenter-IP bot check: report it as such (not a code or format problem).
  if (attempts.length && attempts.every(a => BOT_CHECK.test(a.detail ?? ''))) throw Object.assign(new Error('SOURCE_BOT_CHECK'), { diagnostics });
  throw Object.assign(lastError ?? new Error('SOURCE_DOWNLOAD_FAILED'), { diagnostics });
}

/** Render the vertical edit and validate it. Returns { file, sha256, durationSec }. */
export async function renderVerticalClip({ sourceFile, workDir, duration, hook, credit, ffmpeg = 'ffmpeg', ffprobe = 'ffprobe', runner = run }) {
  const probeIn = JSON.parse((await runner(ffprobe, ['-v', 'error', '-show_entries', 'stream=codec_type:format=duration', '-of', 'json', sourceFile], { timeoutMs: 60_000 })).stdout);
  if (!probeIn.streams?.some(s => s.codec_type === 'audio')) throw new Error('SOURCE_WITHOUT_AUDIO');
  if (!probeIn.streams?.some(s => s.codec_type === 'video')) throw new Error('SOURCE_WITHOUT_VIDEO');
  const available = Number(probeIn.format?.duration);
  const d = Math.min(STREAMER_CLIP_MAX_SECONDS, Number(duration) || STREAMER_CLIP_MAX_SECONDS, Number.isFinite(available) ? available : Infinity);
  if (!(d >= 3)) throw new Error('SOURCE_TOO_SHORT');
  const fontFile = path.join(workDir, 'font.ttf');
  await copyFile(BUNDLED_FONT, fontFile);
  const hookFile = path.join(workDir, 'hook.txt'), creditFile = path.join(workDir, 'credit.txt');
  await writeFile(hookFile, wrapLines(hook, 22, 3), 'utf8');
  await writeFile(creditFile, clean(credit, 80), 'utf8');
  const output = path.join(workDir, 'render.mp4');
  await runner(ffmpeg, ffmpegRenderArgs({ input: sourceFile, output, hookFile, creditFile, fontFile, duration: d }), { timeoutMs: 600_000 });
  const probe = JSON.parse((await runner(ffprobe, ['-v', 'error', '-show_entries', 'stream=codec_type,width,height:format=duration', '-of', 'json', output], { timeoutMs: 60_000 })).stdout);
  const check = validateRenderProbe(probe);
  if (!check.ok) throw new Error(check.errors[0].toUpperCase());
  return { file: output, sha256: await sha256File(output), durationSec: check.durationSec, sizeBytes: (await stat(output)).size };
}
