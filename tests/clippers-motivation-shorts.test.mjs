import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdtemp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { buildSrt, canonicalScript, renderMotivationShort, validateManifestShape, volumeBlocker } from "../script/clippers-motivation-shorts.mjs";

const execFileAsync = promisify(execFile);
const sha256File = async (file) => createHash("sha256").update(await readFile(file)).digest("hex");

function baseManifest() {
  return {
    schemaVersion: 1,
    shortId: "motiva-001",
    language: "es",
    format: "youtube_short_9x16",
    script: {
      hook: "No necesitas sentirte listo para comenzar.",
      beats: [
        "Da hoy un paso pequeño, incluso si nadie lo aplaude.",
        "La disciplina crece cuando cumples la promesa que te hiciste.",
      ],
      close: "Empieza ahora y deja que tus acciones construyan la confianza.",
      originality: {
        status: "owned_original",
        author: "Equipo Clippers",
        thirdPartyQuotes: false,
        thirdPartySpeeches: false,
        sources: [],
      },
      structure: { conflict: "hook", idea: "beats", action: "close" },
    },
    contentSafety: {
      celebrities: false,
      podcasts: false,
      clonedVoices: false,
      thirdPartyQuotes: false,
      wealthPromises: false,
      healthPromises: false,
    },
    voice: {
      sourceType: "local_recording",
      file: "input/motiva-001.wav",
      rightsEvidenceFile: "rights/motiva-001-voice.json",
      sha256: "a".repeat(64),
    },
    style: { backgroundColor: "#111827" },
  };
}

async function writeAuthorizedManifest(workspace, manifest = baseManifest()) {
  await mkdir(path.join(workspace, "input"), { recursive: true });
  await mkdir(path.join(workspace, "rights"), { recursive: true });
  await mkdir(path.join(workspace, "manifests"), { recursive: true });
  const voiceFile = path.join(workspace, manifest.voice.file);
  await execFileAsync("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", "sine=frequency=330:sample_rate=48000:duration=20",
    "-c:a", "pcm_s16le", voiceFile,
  ]);
  manifest.voice.sha256 = await sha256File(voiceFile);
  await writeFile(path.join(workspace, manifest.voice.rightsEvidenceFile), `${JSON.stringify({
    schemaVersion: 1,
    assetType: "voice_recording",
    shortId: manifest.shortId,
    file: manifest.voice.file,
    sha256: manifest.voice.sha256,
    rightsStatus: "owned",
    speakerConsent: true,
    commercialUseAuthorized: true,
    provenance: "local_recording",
    verifiedBy: "Robert",
    verifiedAt: "2026-08-24T12:00:00.000Z",
  }, null, 2)}\n`);
  const manifestPath = path.join(workspace, "manifests", `${manifest.shortId}.json`);
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return { manifest, manifestFile: path.relative(workspace, manifestPath) };
}

test("validates explicit Spanish original-script manifest and deterministic captions", () => {
  const manifest = baseManifest();
  assert.deepEqual(validateManifestShape(manifest), []);
  const script = canonicalScript(manifest);
  const first = buildSrt(script, 24);
  assert.equal(first, buildSrt(script, 24));
  assert.match(first, /00:00:00,000 -->/);
  assert.match(first, /00:00:24,000/);
  assert.ok(first.split("\n\n").every((cue) => cue.split("\n").at(-1).length <= 34));
});

test("fails closed for non-original material and absent local voice authorization", () => {
  const manifest = baseManifest();
  manifest.script.originality.thirdPartySpeeches = true;
  manifest.script.originality.sources = ["https://example.com/speech"];
  manifest.voice.sourceType = "remote_tts";
  const blockers = validateManifestShape(manifest);
  assert.ok(blockers.includes("third_party_speeches_not_excluded"));
  assert.ok(blockers.includes("external_script_sources_present"));
  assert.ok(blockers.includes("voice_not_local_recording"));
});

test("requires the conflict, idea and action structure plus all content exclusions", () => {
  const manifest = baseManifest();
  manifest.script.structure.action = "beats";
  manifest.contentSafety.wealthPromises = true;
  const blockers = validateManifestShape(manifest);
  assert.ok(blockers.includes("motivation_structure_invalid"));
  assert.ok(blockers.includes("content_safety_exclusions_missing"));
});

test("enforces one render per New York day and five in a rolling seven days", () => {
  const now = new Date("2026-08-24T16:00:00.000Z");
  assert.equal(volumeBlocker([{ renderedAt: "2026-08-24T12:00:00.000Z" }], now), "daily_render_limit_reached");
  const priorDays = [1, 2, 3, 4, 5].map((days) => ({ renderedAt: new Date(now.getTime() - days * 86_400_000).toISOString() }));
  assert.equal(volumeBlocker(priorDays, now), "rolling_seven_day_render_limit_reached");
  assert.equal(volumeBlocker(priorDays.slice(0, 4), now), null);
});

test("renders an authorized local voice to a deduplicated 9:16 Short with QA evidence", { timeout: 120_000 }, async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "clippers-motivation-test-"));
  const { manifestFile } = await writeAuthorizedManifest(workspace);

  const result = await renderMotivationShort({ workspaceRoot: workspace, manifestFile, now: new Date("2026-08-24T13:00:00.000Z") });
  assert.equal(result.status, "rendered", JSON.stringify(result));
  assert.equal(result.width, 1080);
  assert.equal(result.height, 1920);
  assert.equal(result.publishEnabled, false);
  assert.equal(result.apiCostUsd, 0);
  assert.equal(result.evidenceFrames.length, 3);
  assert.ok((await stat(path.join(workspace, result.outputFile))).size > 1000);
  assert.ok((await stat(path.join(workspace, "evidence-drop", "motivation", "motiva-001", "provenance.json"))).size > 100);

  const duplicate = await renderMotivationShort({ workspaceRoot: workspace, manifestFile });
  assert.equal(duplicate.status, "duplicate");
  assert.deepEqual(duplicate.blockers, ["already_rendered"]);
});

test("blocks existing artifacts without deleting files when the ledger is missing", { timeout: 120_000 }, async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "clippers-motivation-test-"));
  const { manifestFile } = await writeAuthorizedManifest(workspace);
  const existingOutput = path.join(workspace, "motivation", "rendered", "motiva-001", "motiva-001.mp4");
  await mkdir(path.dirname(existingOutput), { recursive: true });
  await writeFile(existingOutput, "do not delete");

  const result = await renderMotivationShort({ workspaceRoot: workspace, manifestFile });
  assert.equal(result.status, "blocked");
  assert.deepEqual(result.blockers, ["existing_artifact_without_ledger"]);
  assert.equal(await readFile(existingOutput, "utf8"), "do not delete");
  assert.equal(result.publishEnabled, false);
});

test("cleans its partial SRT after a transient render failure so a retry can succeed", { timeout: 120_000 }, async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "clippers-motivation-test-"));
  const { manifestFile } = await writeAuthorizedManifest(workspace);
  const subtitlePath = path.join(workspace, "motivation", "rendered", "motiva-001", "motiva-001.srt");
  let failedOnce = false;
  const transientRun = async (binary, args) => {
    if (!failedOnce && binary === "ffmpeg" && args.includes("-filter_complex")) {
      failedOnce = true;
      throw new Error("transient ffmpeg failure");
    }
    return execFileAsync(binary, args, { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
  };

  const failed = await renderMotivationShort({ workspaceRoot: workspace, manifestFile, run: transientRun });
  assert.equal(failed.status, "blocked");
  assert.deepEqual(failed.blockers, ["render_failed"]);
  await assert.rejects(access(subtitlePath));

  const retry = await renderMotivationShort({ workspaceRoot: workspace, manifestFile });
  assert.equal(retry.status, "rendered", JSON.stringify(retry));
  assert.notDeepEqual(retry.blockers, ["existing_artifact_without_ledger"]);
  assert.ok((await stat(subtitlePath)).size > 0);
});

test("blocks missing voice files without generating or publishing anything", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "clippers-motivation-test-"));
  await mkdir(path.join(workspace, "manifests"), { recursive: true });
  const manifest = baseManifest();
  await writeFile(path.join(workspace, "manifests", "missing.json"), `${JSON.stringify(manifest)}\n`);
  const result = await renderMotivationShort({ workspaceRoot: workspace, manifestFile: "manifests/missing.json" });
  assert.equal(result.status, "blocked");
  assert.deepEqual(result.blockers, ["voice_missing_or_unsafe"]);
  assert.equal(result.publishEnabled, false);
});
