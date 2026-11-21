import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildRenderArgs, renderKongVideo, runRenderCommand, validateRenderInput, validateTechnicalProbe, wrapRenderText, type RenderInput } from "../server/kong-cloud-renderer";
const input = (): RenderInput => ({ layout: "pov", clips: [{ path: "/tmp/authorized.mp4", startSeconds: 0, rightsEvidence: "owner:clip" }],
  soundtrack: { path: "/tmp/authorized.wav", rightsEvidence: "owner:music" }, logo: { path: "/tmp/logo.png", approvedSha256: "a".repeat(64) },
  fontPath: "/tmp/font.ttf", hook: "Your group found the plan", durationSeconds: 9, outputPath: "/tmp/final.mp4" });
test("layouts produce different filters, preserve text outside filter syntax, and discard source audio", () => {
  const pov = buildRenderArgs(input());
  const reveal = buildRenderArgs({ ...input(), layout: "reveal", reveal: "The night is just starting" });
  const montage = buildRenderArgs({ ...input(), layout: "montage", clips: Array.from({ length: 3 }, () => input().clips[0]) });
  const filter = (args: string[]) => args[args.indexOf("-filter_complex") + 1];
  assert.notEqual(filter(pov), filter(reveal)); assert.notEqual(filter(pov), filter(montage));
  assert.match(filter(montage), /concat=n=3:v=1:a=0/);
  assert.match(filter(pov), /\[1:a:0\].*loudnorm/); assert.doesNotMatch(filter(pov), /\[0:a/);
  assert.match(filter(reveal), /enable='gte\(t,4\.95\)'/);
  assert.doesNotMatch(filter(pov), /drawtext|Your group/);
  assert.equal(pov.includes("-y"), false); assert.equal(pov.at(-1), "render.mp4");
});
test("rejects bad rights, paths, length, layout, logo hash and text", () => {
  assert.throws(() => validateRenderInput({ ...input(), durationSeconds: 31 }));
  assert.throws(() => validateRenderInput({ ...input(), clips: [{ ...input().clips[0], path: "https://example.com/video.mp4" }] }));
  assert.throws(() => validateRenderInput({ ...input(), soundtrack: { ...input().soundtrack, rightsEvidence: "" } }));
  assert.throws(() => validateRenderInput({ ...input(), layout: "montage" }));
  assert.throws(() => validateRenderInput({ ...input(), hook: "x".repeat(27) }));
  assert.throws(() => wrapRenderText("hello\u0000world"));
  assert.equal(wrapRenderText("Plan tonight with your group and KONG"), "Plan tonight with your\ngroup and KONG");
});
test("technical probe rejects missing audio and mismatched codecs/geometry", () => {
  const p = { format: { duration: "9.01" }, streams: [{ codec_type: "video", codec_name: "h264", width: 1080, height: 1920, pix_fmt: "yuv420p" }, { codec_type: "audio", codec_name: "aac" }] };
  assert.equal(validateTechnicalProbe(p, 9).durationSeconds, 9.01);
  assert.throws(() => validateTechnicalProbe({ ...p, streams: p.streams.slice(0, 1) }, 9));
  assert.throws(() => validateTechnicalProbe(p, 15));
});
test("runner bounds process time and output without a shell", async () => {
  const options = { cwd: tmpdir(), timeoutMs: 1000, maxOutputBytes: 100 };
  await assert.rejects(runRenderCommand(process.execPath, ["-e", "process.stdout.write('a'.repeat(10000))"], options), /render_output_limit/);
  await assert.rejects(runRenderCommand(process.execPath, ["-e", "setTimeout(()=>{},10000)"], { ...options, timeoutMs: 30 }), /render_timeout/);
});
test("injected runner creates artifact and report without visual approval", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "kong-render-unit-"));
  try {
    const names = ["source.mp4", "track.wav", "logo.png", "font.ttf"];
    for (const name of names) await writeFile(path.join(dir, name), "fixture");
    const request: RenderInput = { ...input(), clips: [{ path: path.join(dir, names[0]), startSeconds: 0, rightsEvidence: "fixture" }],
      soundtrack: { path: path.join(dir, names[1]), rightsEvidence: "fixture" }, logo: { path: path.join(dir, names[2]), approvedSha256: createHash("sha256").update("fixture").digest("hex") }, fontPath: path.join(dir, names[3]), outputPath: path.join(dir, "out.mp4") };
    const commands: string[] = [];
    const result = await renderKongVideo(request, { runner: async (binary, args, options) => {
      commands.push(binary);
      if (binary === "magick") return { stdout: "", stderr: "" };
      if (binary === "ffmpeg") { await writeFile(path.join(options.cwd, "render.mp4"), "rendered"); return { stdout: "", stderr: "" }; }
      const isFinal = args.at(-1)!.endsWith("render.mp4");
      return { stdout: JSON.stringify({ format: { duration: "9" }, streams: isFinal ? [
        { codec_type: "video", codec_name: "h264", width: 1080, height: 1920, pix_fmt: "yuv420p" }, { codec_type: "audio", codec_name: "aac" },
      ] : [{ codec_type: args.at(-1)!.endsWith(".wav") ? "audio" : "video", width: 700, height: 120 }] }), stderr: "" };
    } });
    assert.equal(result.visualQaRequired, true); assert.equal(result.sourceAudioDiscarded, true);
    assert.ok(commands.includes("ffmpeg")); assert.ok(commands.includes("ffprobe"));
    assert.equal(await readFile(result.outputPath, "utf8"), "rendered");
    await assert.rejects(renderKongVideo(request), /output_already_exists/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test("actual ffmpeg synthetic fixture smoke", { skip: process.env.KONG_RENDER_SMOKE !== "1" }, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "kong-render-smoke-"));
  const options = { cwd: dir, timeoutMs: 120000, maxOutputBytes: 2_000_000 };
  try {
    await runRenderCommand("ffmpeg", ["-nostdin", "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=320x568:rate=30", "-t", "4", "-c:v", "libx264", "source.mp4"], options);
    await runRenderCommand("ffmpeg", ["-nostdin", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000", "-t", "4", "sound.wav"], options);
    await runRenderCommand("ffmpeg", ["-nostdin", "-v", "error", "-f", "lavfi", "-i", "color=white:size=64x64", "-frames:v", "1", "logo.png"], options);
    const request: RenderInput = { ...input(), durationSeconds: 3, clips: [{ path: path.join(dir, "source.mp4"), startSeconds: 0, rightsEvidence: "generated_test_pattern" }],
      soundtrack: { path: path.join(dir, "sound.wav"), rightsEvidence: "generated_test_tone" },
      logo: { path: path.join(dir, "logo.png"), approvedSha256: createHash("sha256").update(await readFile(path.join(dir, "logo.png"))).digest("hex") },
      fontPath: process.env.KONG_TEST_FONT || "/System/Library/Fonts/Supplemental/Arial.ttf", outputPath: path.join(dir, "out.mp4") };
    const hashes: string[] = [];
    for (const layout of ["pov", "reveal", "montage"] as const) {
      const result = await renderKongVideo({ ...request, layout, reveal: "The night just started",
        clips: layout === "montage" ? [0, 1, 2].map(startSeconds => ({ ...request.clips[0], startSeconds })) : request.clips,
        outputPath: path.join(dir, `${layout}.mp4`) });
      assert.equal(result.technical.width, 1080); assert.equal(result.technical.height, 1920);
      assert.equal(result.sha256.length, 64); assert.equal(result.visualQaRequired, true);
      hashes.push(result.sha256);
      if (layout === "reveal" && process.env.KONG_RENDER_QA_FRAME) await runRenderCommand("ffmpeg", ["-nostdin", "-v", "error", "-n", "-ss", "2", "-i", result.outputPath, "-frames:v", "1", process.env.KONG_RENDER_QA_FRAME], options);
    }
    assert.equal(new Set(hashes).size, 3);
    await assert.rejects(renderKongVideo({ ...request, hook: "W".repeat(26), outputPath: path.join(dir, "wide.mp4") }), /render_text_exceeds_safe_zone/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
