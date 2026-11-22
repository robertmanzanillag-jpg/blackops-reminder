// Technical audio-source verification only. This module neither grants rights nor publishes media.
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, readFile, lstat, open, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const exec = promisify(execFile);
const SHA = /^[a-f0-9]{64}$/;
const hash = value => createHash('sha256').update(value).digest('hex');
const MAX_TRACK_BYTES = 16 * 1024 * 1024, MAX_FINAL_BYTES = 32 * 1024 * 1024;
const fail = code => { throw Error(code); };
const nonempty = (value, max = 2000) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
export const APPROVED_DERIVATIVE_INSTRUMENTAL = Object.freeze({
  title: 'Monkeys Spinning Monkeys', composer: 'Kevin MacLeod', isrc: 'USUAN1400011',
  sha256: 'a5bb345c23849ad0786aa0bc5157a9f2d4039660fe00282e55754d475f36dc14', byteLength: 5005207,
  sourceUrl: 'https://incompetech.com/music/royalty-free/mp3-royaltyfree/Monkeys%20Spinning%20Monkeys.mp3',
  primaryTrackLicensePage: 'https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1400011',
  licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
  requiredAttribution: '"Monkeys Spinning Monkeys" Kevin MacLeod (incompetech.com). CC BY 4.0 https://creativecommons.org/licenses/by/4.0/ · Music excerpted, faded and mixed.',
});
export const DERIVATIVE_AUDIO_PIPELINE = 'lacy_aac160k_48k_fade025_060_minus12db_v1';
function exactObject(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
      Reflect.ownKeys(value).some(k => typeof k !== 'string' || !keys.includes(k)) || keys.some(k => !Object.hasOwn(value, k)) ||
      Object.values(Object.getOwnPropertyDescriptors(value)).some(d => !Object.hasOwn(d, 'value'))) fail('derivative_audio_profile_invalid');
}
/** A structural binding check, not an authentication or license-acquisition operation. */
export function validateDerivativeAudioReplacement(profile, { finalSha256, caption, captionSha256, durationSeconds, maker, checker, now = Date.now() } = {}) {
  exactObject(profile, ['schemaVersion', 'kind', 'track', 'pipeline', 'report']);
  if (profile.schemaVersion !== 1 || profile.kind !== 'licensed_instrumental_replacement') fail('derivative_audio_profile_invalid');
  exactObject(profile.track, Object.keys(APPROVED_DERIVATIVE_INSTRUMENTAL));
  if (Object.entries(APPROVED_DERIVATIVE_INSTRUMENTAL).some(([k, v]) => profile.track[k] !== v)) fail('derivative_audio_track_unapproved');
  exactObject(profile.pipeline, ['id', 'musicStartSeconds', 'durationSeconds', 'codec', 'bitRate', 'sampleRate', 'channels', 'pcmCodec', 'pcmFormat']);
  const p = profile.pipeline;
  if (p.id !== DERIVATIVE_AUDIO_PIPELINE || p.codec !== 'aac' || p.bitRate !== 160000 || p.sampleRate !== 48000 || p.channels !== 2 || p.pcmCodec !== 'pcm_f32le' || p.pcmFormat !== 'f32le' ||
      typeof p.musicStartSeconds !== 'number' || !Number.isFinite(p.musicStartSeconds) || p.musicStartSeconds < 0 || p.musicStartSeconds > 150 ||
      typeof durationSeconds !== 'number' || !Number.isFinite(durationSeconds) || durationSeconds < 10 || durationSeconds > 60 || p.durationSeconds !== durationSeconds) fail('derivative_audio_pipeline_unsupported');
  if (!SHA.test(finalSha256 ?? '') || !nonempty(caption, 2200) || hash(caption) !== captionSha256 || !caption.includes(profile.track.requiredAttribution)) fail('derivative_audio_caption_or_final_unbound');
  exactObject(profile.report, ['maker', 'checker', 'checkedAt', 'reportReference', 'reportSha256', 'finalSha256', 'captionSha256', 'licensedMusicSha256', 'decodedAudioPcmSha256', 'expectedIndependentMusicPcmSha256', 'originalMixedAudioIncluded', 'fullAudioDecoded', 'audioAuditioned']);
  const r = profile.report;
  const at = typeof r.checkedAt === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/.test(r.checkedAt) ? Date.parse(r.checkedAt) : NaN;
  if (!nonempty(maker, 200) || !nonempty(checker, 200) || maker === checker || r.maker !== maker || r.checker !== checker ||
      !Number.isFinite(at) || !Number.isFinite(now) || at > now || !nonempty(r.reportReference) || !SHA.test(r.reportSha256 ?? '') ||
      r.finalSha256 !== finalSha256 || r.captionSha256 !== captionSha256 || r.licensedMusicSha256 !== profile.track.sha256 ||
      !SHA.test(r.decodedAudioPcmSha256 ?? '') || r.decodedAudioPcmSha256 !== r.expectedIndependentMusicPcmSha256 ||
      r.originalMixedAudioIncluded !== false || r.fullAudioDecoded !== true || r.audioAuditioned !== false) fail('derivative_audio_independent_report_invalid');
  return profile;
}
async function boundedFile(file, expectedSha256, maxBytes, expectedLength = null) {
  if (!SHA.test(expectedSha256 ?? '')) fail('derivative_audio_file_changed');
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink() || info.size < 1024 || info.size > maxBytes || (expectedLength !== null && info.size !== expectedLength)) fail('derivative_audio_file_changed');
  const bytes = await readFile(file);
  if (bytes.length !== info.size || bytes.length > maxBytes || hash(bytes) !== expectedSha256) fail('derivative_audio_file_changed');
  return bytes;
}
/** Download only the one reviewed official track; no manifest-supplied URL or filesystem path is followed. */
export async function loadApprovedDerivativeInstrumental({ fetch: fetchImpl = globalThis.fetch } = {}) {
  const track = APPROVED_DERIVATIVE_INSTRUMENTAL;
  const directory = await mkdtemp(path.join(tmpdir(), 'clippers-licensed-track-'));
  const file = path.join(directory, 'licensed.mp3'), cleanup = () => rm(directory, { recursive: true, force: true });
  let reader, handle;
  try {
    const response = await fetchImpl(track.sourceUrl, { redirect: 'error', signal: AbortSignal.timeout(30000), headers: { accept: 'audio/mpeg,application/octet-stream' } });
    if (!response.ok || response.status !== 200 || !response.body?.getReader) fail('derivative_audio_track_unavailable');
    const length = response.headers.get('content-length'), type = response.headers.get('content-type') ?? '';
    if ((length !== null && Number(length) !== track.byteLength) || (type && !/^(audio\/(mpeg|mp3)|application\/octet-stream)(?:;|$)/i.test(type))) fail('derivative_audio_track_unavailable');
    reader = response.body.getReader(); handle = await open(file, 'wx', 0o600);
    let size = 0; const digest = createHash('sha256');
    while (true) { const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.byteLength; if (size > track.byteLength || size > MAX_TRACK_BYTES) fail('derivative_audio_track_size_mismatch'); digest.update(chunk.value); await handle.writeFile(chunk.value); }
    await handle.close(); handle = null;
    if (size !== track.byteLength || digest.digest('hex') !== track.sha256) fail('derivative_audio_track_hash_mismatch');
    return { file, cleanup, verification: { sha256: track.sha256, byteLength: size, origin: 'exact_reviewed_official_instrumental' } };
  } catch (error) { await reader?.cancel().catch(() => undefined); await handle?.close().catch(() => undefined); await cleanup(); throw error; }
}
/** Reconstruct the fixed encoder pipeline from licensed music alone, then compare every decoded sample. */
export async function verifyDerivativeAudioReplacement({ file, licensedTrackFile, profile, finalSha256, caption, captionSha256, durationSeconds, maker, checker, now = Date.now() }, { ffmpeg = 'ffmpeg', ffprobe = 'ffprobe', runner = exec } = {}) {
  validateDerivativeAudioReplacement(profile, { finalSha256, caption, captionSha256, durationSeconds, maker, checker, now });
  const finalBytes = await boundedFile(file, finalSha256, MAX_FINAL_BYTES), track = profile.track;
  const musicBytes = await boundedFile(licensedTrackFile, track.sha256, MAX_TRACK_BYTES, track.byteLength);
  const directory = await mkdtemp(path.join(tmpdir(), 'clippers-audio-source-check-'));
  const sealedFinal = path.join(directory, 'final.mp4'), sealedTrack = path.join(directory, 'licensed.mp3'), expected = path.join(directory, 'expected.m4a');
  try {
    await writeFile(sealedFinal, finalBytes, { flag: 'wx', mode: 0o600 }); await writeFile(sealedTrack, musicBytes, { flag: 'wx', mode: 0o600 });
    const options = { timeout: 45000, maxBuffer: MAX_FINAL_BYTES, encoding: 'buffer', env: { PATH: process.env.PATH } };
    const { stdout } = await runner(ffprobe, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', '-protocol_whitelist', 'file,pipe', sealedFinal], options);
    const probe = JSON.parse(stdout.toString()), audio = probe.streams?.filter(s => s.codec_type === 'audio') ?? [];
    if (audio.length !== 1 || audio[0].codec_name !== 'aac' || Number(audio[0].sample_rate) !== 48000 || audio[0].channels !== 2 || !Number.isFinite(Number(probe.format?.duration)) || Math.abs(Number(probe.format.duration) - durationSeconds) > 0.15) fail('derivative_audio_final_probe_mismatch');
    const p = profile.pipeline, duration = String(durationSeconds), filter = `atrim=duration=${duration},asetpts=PTS-STARTPTS,afade=t=in:d=0.25,afade=t=out:st=${Math.max(0, durationSeconds - 0.6)}:d=0.6,volume=-12dB`;
    await runner(ffmpeg, ['-nostdin', '-v', 'error', '-y', '-ss', String(p.musicStartSeconds), '-t', duration, '-protocol_whitelist', 'file,pipe', '-i', sealedTrack, '-af', filter, '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-t', duration, '-map_metadata', '-1', expected], options);
    const decode = async input => (await runner(ffmpeg, ['-nostdin', '-v', 'error', '-protocol_whitelist', 'file,pipe', '-i', input, '-vn', '-f', 'f32le', '-acodec', 'pcm_f32le', '-'], options)).stdout;
    const actual = await decode(sealedFinal), independent = await decode(expected);
    const actualHash = hash(actual), independentHash = hash(independent);
    if (!actual.length || actual.length !== independent.length || !actual.equals(independent) || actualHash !== profile.report.decodedAudioPcmSha256 || independentHash !== profile.report.expectedIndependentMusicPcmSha256) fail('derivative_audio_pcm_mismatch');
    return { origin: 'independent_licensed_music_pcm_reconstruction', finalSha256, captionSha256, licensedMusicSha256: track.sha256,
      decodedAudioPcmSha256: actualHash, expectedIndependentMusicPcmSha256: independentHash, decodedPcmBytes: actual.length,
      originalMixedAudioIncluded: false, fullAudioDecoded: true, audioAuditioned: false, pipeline: p.id };
  } finally { await rm(directory, { recursive: true, force: true }); }
}
