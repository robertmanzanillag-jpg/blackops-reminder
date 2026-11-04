import { spawn } from "node:child_process";
import { constants, createReadStream } from "node:fs";
import { copyFile, lstat, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";

export interface AuthorizedFile { path: string; rightsEvidence: string; }
export interface RenderInput {
  layout: "pov" | "reveal" | "montage";
  clips: (AuthorizedFile & { startSeconds: number })[];
  soundtrack: AuthorizedFile;
  logo: { path: string; approvedSha256: string };
  fontPath: string; hook: string; reveal?: string; durationSeconds: number; outputPath: string;
}
export type CommandRunner = (binary: string, args: string[], options: { cwd: string; timeoutMs: number; maxOutputBytes: number }) => Promise<{ stdout: string; stderr: string }>;
export const runRenderCommand: CommandRunner = (binary, args, options) => new Promise((resolve, reject) => {
  const child = spawn(binary, args, { cwd: options.cwd, shell: false, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "", stderr = "", bytes = 0, failure: Error | undefined;
  const kill = (reason: string) => { failure ||= new Error(reason); child.kill("SIGKILL"); };
  const timeout = setTimeout(() => kill("render_timeout"), options.timeoutMs);
  const collect = (chunk: Buffer, stream: "stdout" | "stderr") => {
    bytes += chunk.length;
    if (bytes > options.maxOutputBytes) { kill("render_output_limit"); return; }
    if (stream === "stdout") stdout += chunk.toString("utf8"); else stderr += chunk.toString("utf8");
  };
  child.stdout.on("data", chunk => collect(chunk, "stdout")); child.stderr.on("data", chunk => collect(chunk, "stderr"));
  child.on("error", () => { clearTimeout(timeout); reject(new Error("render_binary_unavailable")); });
  child.on("close", code => { clearTimeout(timeout); if (failure) reject(failure); else if (code !== 0) reject(new Error("render_command_failed", { cause: { exitCode: code, diagnostic: stderr.slice(-2000) } })); else resolve({ stdout, stderr }); });
});
export function wrapRenderText(text: string): string {
  if (typeof text !== "string" || !text.trim() || text.length > 90 || /[\x00-\x08\x0b-\x1f\x7f%\\]/.test(text) || /\bfree\b|\bgratis\b/i.test(text)) throw Error("invalid_render_text");
  const words = text.trim().split(/\s+/), lines: string[] = []; let line = "";
  for (const word of words) {
    if (word.length > 26) throw Error("render_word_too_long");
    if ((line ? `${line} ${word}` : word).length > 26) { lines.push(line); line = word; }
    else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  if (lines.length > 3) throw Error("render_text_too_many_lines");
  return lines.join("\n");
}
export function validateRenderInput(input: RenderInput) {
  if (!["pov", "reveal", "montage"].includes(input.layout)) throw Error("invalid_layout");
  if (!Number.isFinite(input.durationSeconds) || input.durationSeconds < 3 || input.durationSeconds > 30) throw Error("invalid_duration");
  if (input.layout === "montage" ? input.clips.length < 3 || input.clips.length > 6 : input.clips.length !== 1) throw Error("invalid_clip_count");
  for (const clip of [...input.clips, input.soundtrack]) {
    if (!clip.rightsEvidence?.trim()) throw Error("missing_rights_evidence");
    if (!path.isAbsolute(clip.path) || /[\x00\r\n]/.test(clip.path)) throw Error("invalid_local_media_path");
  }
  for (const clip of input.clips) if (!Number.isFinite(clip.startSeconds) || clip.startSeconds < 0) throw Error("invalid_clip_start");
  for (const filename of [input.logo.path, input.fontPath, input.outputPath]) if (!path.isAbsolute(filename) || /[\x00\r\n]/.test(filename)) throw Error("invalid_local_path");
  if (!/^[a-f0-9]{64}$/.test(input.logo.approvedSha256)) throw Error("invalid_logo_hash");
  if (path.extname(input.outputPath).toLowerCase() !== ".mp4") throw Error("output_must_be_mp4");
  wrapRenderText(input.hook);
  if (input.layout === "reveal") wrapRenderText(input.reveal || "");
}
async function regularFile(filename: string, limit: number) {
  const file = await lstat(filename);
  if (!file.isFile() || file.size <= 0 || file.size > limit) throw Error("invalid_media_file");
}
async function hashFile(filename: string) {
  const hash = createHash("sha256"); for await (const chunk of createReadStream(filename)) hash.update(chunk); return hash.digest("hex");
}
export function buildRenderArgs(input: RenderInput): string[] {
  validateRenderInput(input);
  const args = ["-nostdin", "-hide_banner", "-loglevel", "error", "-n"];
  for (const clip of input.clips) args.push("-protocol_whitelist", "file,pipe", "-ss", String(clip.startSeconds), "-i", clip.path);
  args.push("-protocol_whitelist", "file,pipe", "-stream_loop", "-1", "-i", input.soundtrack.path, "-loop", "1", "-i", "logo.png");
  for (const image of input.layout === "reveal" ? ["hook.png", "reveal.png", "cta.png"] : ["hook.png", "cta.png"])
    args.push("-loop", "1", "-i", image);
  const seconds = input.durationSeconds / input.clips.length;
  const filters = input.clips.map((_, i) => `[${i}:v:0]trim=duration=${seconds},setpts=PTS-STARTPTS,scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,fps=30,format=yuv420p[v${i}]`);
  filters.push(`${input.clips.map((_, i) => `[v${i}]`).join("")}concat=n=${input.clips.length}:v=1:a=0[cut]`);
  filters.push(`[${input.clips.length + 1}:v:0]scale=96:-1[logo]`, "[cut][logo]overlay=90:180:shortest=1[brand]");
  {
    const hook = input.clips.length + 2;
    filters.push(`[brand][${hook}:v:0]overlay=x=(W-w)/2:y=${input.layout === "montage" ? 1100 : 350}:shortest=1[text]`);
    if (input.layout === "reveal") {
      filters.push(`[text][${hook + 1}:v:0]overlay=x=(W-w)/2:y=1050:shortest=1:enable='gte(t,${input.durationSeconds * .55})'[revealed]`);
      filters.push(`[revealed][${hook + 2}:v:0]overlay=x=(W-w)/2:y=1470:shortest=1[video]`);
    } else filters.push(`[text][${hook + 1}:v:0]overlay=x=(W-w)/2:y=1470:shortest=1[video]`);
  }
  // Never map source audio: only the separately authorized soundtrack survives.
  filters.push(`[${input.clips.length}:a:0]atrim=duration=${input.durationSeconds},asetpts=PTS-STARTPTS,loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000[audio]`);
  args.push("-filter_complex", filters.join(";"), "-map", "[video]", "-map", "[audio]", "-t", String(input.durationSeconds),
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p", "-r", "30", "-c:a", "aac", "-b:a", "128k",
    "-ar", "48000", "-movflags", "+faststart", "render.mp4");
  return args;
}
export function validateTechnicalProbe(probe: any, expectedSeconds: number) {
  const videos = probe?.streams?.filter((s: any) => s.codec_type === "video") || [];
  const audios = probe?.streams?.filter((s: any) => s.codec_type === "audio") || [];
  const duration = Number(probe?.format?.duration);
  if (videos.length !== 1 || videos[0].codec_name !== "h264" || videos[0].width !== 1080 || videos[0].height !== 1920
    || videos[0].pix_fmt !== "yuv420p" || audios.length !== 1 || audios[0].codec_name !== "aac"
    || !Number.isFinite(duration) || Math.abs(duration - expectedSeconds) > .25 || duration > 30.25) throw Error("render_technical_qa_failed");
  return { width: 1080, height: 1920, durationSeconds: duration, videoCodec: "h264", audioCodec: "aac", probe };
}
export async function renderKongVideo(input: RenderInput, options: { runner?: CommandRunner; ffmpegPath?: string; ffprobePath?: string; magickPath?: string; timeoutMs?: number } = {}) {
  validateRenderInput(input);
  if (await stat(input.outputPath).then(() => true, error => { if (error.code === "ENOENT") return false; throw error; })) throw Error("output_already_exists");
  for (const clip of [...input.clips, input.soundtrack]) await regularFile(clip.path, 250_000_000);
  await regularFile(input.logo.path, 5_000_000); await regularFile(input.fontPath, 20_000_000);
  if (await hashFile(input.logo.path) !== input.logo.approvedSha256) throw Error("official_logo_hash_mismatch");
  const runner = options.runner || runRenderCommand;
  const temporary = await mkdtemp(path.join(tmpdir(), "kong-render-"));
  const execOptions = { cwd: temporary, timeoutMs: Math.min(300_000, Math.max(1000, options.timeoutMs || 180_000)), maxOutputBytes: 2_000_000 };
  const probe = async (filename: string) => JSON.parse((await runner(options.ffprobePath || "ffprobe", ["-v", "error", "-protocol_whitelist", "file,pipe", "-show_streams", "-show_format", "-of", "json", filename], execOptions)).stdout);
  try {
    await copyFile(input.logo.path, path.join(temporary, "logo.png")); await copyFile(input.fontPath, path.join(temporary, "font.ttf"));
    if (await hashFile(path.join(temporary, "logo.png")) !== input.logo.approvedSha256) throw Error("official_logo_hash_mismatch");
    await writeFile(path.join(temporary, "hook.txt"), wrapRenderText(input.hook));
    await writeFile(path.join(temporary, "reveal.txt"), input.reveal ? wrapRenderText(input.reveal) : "");
    await writeFile(path.join(temporary, "cta.txt"), "kongnightlife.com");
    for (const clip of input.clips) {
      const p = await probe(clip.path), duration = Number(p?.format?.duration);
      if (!p?.streams?.some((s: any) => s.codec_type === "video") || !Number.isFinite(duration)
        || duration < clip.startSeconds + input.durationSeconds / input.clips.length) throw Error("source_video_too_short_or_invalid");
    }
    const audio = await probe(input.soundtrack.path);
    if (!audio?.streams?.some((s: any) => s.codec_type === "audio")) throw Error("soundtrack_has_no_audio");
    // Always composite the exact measured raster, even if drawtext exists. A
    // character-count limit alone cannot guarantee wide glyphs fit safe zones.
    const textMode = "raster" as const;
    {
      for (const name of input.layout === "reveal" ? ["hook", "reveal", "cta"] : ["hook", "cta"]) {
        await runner(options.magickPath || "magick", ["-limit", "memory", "64MiB", "-limit", "map", "128MiB", "-background", "none", "-font", "font.ttf",
          "-pointsize", "52", "-fill", "white", "-stroke", "black", "-strokewidth", "3", "-gravity", "center", `label:@${name}.txt`, `${name}.png`], execOptions);
        const textProbe = await probe(path.join(temporary, `${name}.png`));
        const dimensions = textProbe.streams?.find((s: any) => s.codec_type === "video");
        if (!dimensions || !Number.isFinite(dimensions.width) || !Number.isFinite(dimensions.height)
          || dimensions.width <= 0 || dimensions.height <= 0 || dimensions.width > 888 || dimensions.height > 250) throw Error("render_text_exceeds_safe_zone");
      }
    }
    await runner(options.ffmpegPath || "ffmpeg", buildRenderArgs(input), execOptions);
    const rendered = path.join(temporary, "render.mp4");
    const technical = validateTechnicalProbe(await probe(rendered), input.durationSeconds);
    await regularFile(rendered, 100_000_000);
    const sha256 = await hashFile(rendered);
    await copyFile(rendered, input.outputPath, constants.COPYFILE_EXCL);
    return { outputPath: input.outputPath, sha256, layout: input.layout, textMode, technical, visualQaRequired: true as const,
      audioNormalization: "ffmpeg_loudnorm_single_pass" as const, sourceAudioDiscarded: true as const,
      logoSha256: input.logo.approvedSha256 };
  } finally { await rm(temporary, { recursive: true, force: true }); }
}
