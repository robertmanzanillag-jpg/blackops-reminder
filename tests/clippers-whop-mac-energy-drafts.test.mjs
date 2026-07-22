import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, mkdtemp, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { CAMPAIGN, CLIP_SPECS } from "../script/clippers-prepare-whop-mac-energy-drafts.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..");
const scriptPath = path.join(repoRoot, "script/clippers-prepare-whop-mac-energy-drafts.mjs");

async function fixture({ missingSource, symlinkSource } = {}) {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "whop-mac-energy-test-"));
  const sourceDir = path.join(workspaceRoot, CAMPAIGN.sourceDrop);
  const binDir = path.join(workspaceRoot, "bin");
  const ffmpegLog = path.join(workspaceRoot, "ffmpeg.log");
  await mkdir(sourceDir, { recursive: true });
  await mkdir(binDir);
  const evidencePath = path.join(workspaceRoot, CAMPAIGN.campaignEvidence);
  await mkdir(path.dirname(evidencePath), { recursive: true });
  await writeFile(evidencePath, `Whop Content Rewards campaign evidence for ${CAMPAIGN.campaignId} and ${CAMPAIGN.experienceId}. Approved Content Bank: ${CAMPAIGN.contentBankUrl}. Content Bank only; approval required before publishing.`);

  for (const [index, spec] of CLIP_SPECS.entries()) {
    if (spec.sourceName === missingSource || spec.sourceName === symlinkSource) continue;
    await writeFile(path.join(sourceDir, spec.sourceName), `approved-source-${index}`);
  }
  if (symlinkSource) {
    const outside = path.join(await mkdtemp(path.join(os.tmpdir(), "whop-mac-outside-")), "outside.mp4");
    await writeFile(outside, "outside-source");
    await symlink(outside, path.join(sourceDir, symlinkSource));
  }

  const ffprobe = `#!/bin/sh
case "$@" in
  *"${CAMPAIGN.outputDrop}"*)
    printf '%s\\n' '{"streams":[{"codec_type":"video","codec_name":"h264","width":1080,"height":1920,"pix_fmt":"yuv420p"},{"codec_type":"audio","codec_name":"aac"}],"format":{"duration":"12.000000"}}'
    ;;
  *)
    printf '%s\\n' '{"streams":[{"codec_type":"video","codec_name":"h264","width":720,"height":1280,"pix_fmt":"yuv420p"},{"codec_type":"audio","codec_name":"aac"}],"format":{"duration":"2000.000000"}}'
    ;;
esac
`;
  const ffmpeg = `#!/bin/sh
printf '%s\\n' "$*" >> "$FFMPEG_LOG"
input=''
previous=''
for argument in "$@"; do
  if [ "$previous" = '-i' ]; then input="$argument"; fi
  previous="$argument"
  target="$argument"
done
cp "$input" "$target"
`;
  await writeFile(path.join(binDir, "ffprobe"), ffprobe);
  await writeFile(path.join(binDir, "ffmpeg"), ffmpeg);
  await Promise.all([chmod(path.join(binDir, "ffprobe"), 0o755), chmod(path.join(binDir, "ffmpeg"), 0o755)]);
  return { workspaceRoot, sourceDir, binDir, ffmpegLog };
}

function run(item) {
  return spawnSync(process.execPath, [scriptPath], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      CLIPPERS_WORKSPACE_ROOT: item.workspaceRoot,
      FFMPEG_LOG: item.ffmpegLog,
      PATH: `${item.binDir}${path.delimiter}${process.env.PATH || ""}`,
    },
  });
}

test("prepares exactly five deterministic approval-only MAC Energy drafts", async () => {
  const item = await fixture();
  const result = run(item);
  assert.equal(result.status, 0, result.stderr);

  const outputDir = path.join(item.workspaceRoot, CAMPAIGN.outputDrop);
  const manifest = JSON.parse(await readFile(path.join(outputDir, "draft-manifest.json"), "utf8"));
  assert.equal(manifest.campaignId, "whop-mac-energy-ryan-clavicular-conor-2026-07-22");
  assert.equal(manifest.experienceId, "exp_4f31WKOCZ8uxii");
  assert.equal(manifest.campaignName, "Ryan Garcia, Clavicular, Conor McGregor");
  assert.equal(manifest.sourceDrop, "source-drop/streamers/whop-mac-energy-2026-07-22");
  assert.equal(manifest.publishAllowed, false);
  assert.equal(manifest.realPublishEnabled, false);
  assert.equal(manifest.metricoolStatus, "approval_required");
  assert.equal(manifest.clips.length, 5);
  assert.deepEqual(manifest.clips.map((clip) => clip.sourceName), CLIP_SPECS.map((clip) => clip.sourceName));
  assert.deepEqual(manifest.clips.map((clip) => clip.sourceName), [
    "ryan-garcia-fanatics-fest-presser.mp4",
    "MAC energy.mp4",
    "Mac Energy Drink_ The BEST Flavor & Energy!.mp4",
    "VN20260712_234016.mp4",
    "clavicular-mac-energy-source.mov",
  ]);
  assert.equal(new Set(manifest.clips.map((clip) => clip.sourceName)).size, 5);
  assert.equal(manifest.clips[0].startSeconds, 530);
  assert.equal(manifest.clips[0].durationSeconds, 12);
  assert.equal(manifest.clips[1].startSeconds, 4);
  assert.equal(manifest.clips[1].featuredTalent, "Conor McGregor");
  assert.ok(manifest.clips.every((clip) => !clip.sourceName.includes("(1)")));

  for (const clip of manifest.clips) {
    assert.equal(clip.publishAllowed, false);
    assert.equal(clip.metricoolStatus, "approval_required");
    assert.match(clip.caption, /@drinkmacenergy/);
    assert.ok(clip.caption.includes(clip.talentTag));
    assert.match(clip.sourceSha256, /^[a-f0-9]{64}$/);
    assert.match(clip.draftSha256, /^[a-f0-9]{64}$/);
    assert.equal(clip.durationSeconds, 12);
    assert.equal(clip.audioSource, "source");
    await readFile(clip.targetPath);
  }

  const csv = await readFile(path.join(outputDir, "metricool-approval-queue.csv"), "utf8");
  const approvalHtml = await readFile(path.join(outputDir, "metricool-approval-queue.html"), "utf8");
  assert.equal(csv.match(/approval_required/g)?.length, 5);
  assert.equal(csv.match(/false/g)?.length, 5);
  assert.match(approvalHtml, /Publishing is disabled/);
  assert.equal(approvalHtml.match(/approval_required/g)?.length, 5);

  const ffmpegCalls = (await readFile(item.ffmpegLog, "utf8")).trim().split("\n");
  assert.equal(ffmpegCalls.length, 5);
  for (const call of ffmpegCalls) {
    assert.match(call, /-map \[v\] -map 0:a:0/);
    assert.match(call, /-c:v libx264/);
    assert.match(call, /-c:a aac/);
    assert.match(call, /-pix_fmt yuv420p/);
    assert.match(call, /-color_range tv/);
    assert.match(call, /-movflags \+faststart/);
    assert.match(call, /scale=1080:1920:force_original_aspect_ratio=increase:out_range=tv/);
    assert.match(call, /-filter_complex .*overlay=60:90/);
    assert.doesNotMatch(call, /drawtext|magick/);
  }
  assert.equal(manifest.cleanupPolicy.deleteSourcesBeforeEvidence, false);
  assert.deepEqual(manifest.cleanupPolicy.requiredProof, [
    "verified public TikTok post URL",
    "verified public TikTok publication timestamp",
    "verified Whop submission receipt",
    "matching source and draft SHA-256 ledger",
  ]);
});

test("missing approved source blocks before rendering or writing a false-ready manifest", async () => {
  const missingSource = CLIP_SPECS[2].sourceName;
  const item = await fixture({ missingSource });
  const result = run(item);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Required campaign source is missing/);
  await assert.rejects(readFile(item.ffmpegLog, "utf8"));
  await assert.rejects(readFile(path.join(item.workspaceRoot, CAMPAIGN.outputDrop, "draft-manifest.json"), "utf8"));
});

test("symlinked campaign sources are rejected", async () => {
  const item = await fixture({ symlinkSource: CLIP_SPECS[0].sourceName });
  const result = run(item);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /must not use symlinks/);
  await assert.rejects(readFile(item.ffmpegLog, "utf8"));
});

test("symlinked temporary hook output cannot overwrite a file outside the workspace", async () => {
  const item = await fixture();
  const outputDir = path.join(item.workspaceRoot, CAMPAIGN.outputDrop);
  const outsideDir = await mkdtemp(path.join(os.tmpdir(), "whop-mac-hook-outside-"));
  const outside = path.join(outsideDir, "outside.ppm");
  await mkdir(outputDir, { recursive: true });
  await writeFile(outside, "outside-unchanged");
  await symlink(outside, path.join(outputDir, `${CLIP_SPECS[0].id}.mp4.hook.ppm`));

  const result = run(item);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /outputs must not use symlinks/);
  assert.equal(await readFile(outside, "utf8"), "outside-unchanged");
});

test("missing campaign evidence blocks false-ready draft output", async () => {
  const item = await fixture();
  await writeFile(path.join(item.workspaceRoot, CAMPAIGN.campaignEvidence), "placeholder");
  const result = run(item);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /rights evidence is missing/);
  await assert.rejects(readFile(path.join(item.workspaceRoot, CAMPAIGN.outputDrop, "draft-manifest.json"), "utf8"));
});
