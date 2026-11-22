// Fetch an already reviewed native final, never the original Twitch/VOD source.
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, open, lstat, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { approvedNativeMediaUrl } from '../shared/clippers-reviewed-derivative.mjs';

const exec = promisify(execFile);
const MAX_BYTES = 32 * 1024 * 1024;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export async function probeReviewedDerivative(file) {
  const { stdout } = await exec('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', '-protocol_whitelist', 'file,pipe', file], {
    timeout: 15000, maxBuffer: 512 * 1024, env: { PATH: process.env.PATH },
  });
  return JSON.parse(stdout);
}
export function validateSealedDerivativeProbe(probe, media) {
  const videos = (probe?.streams ?? []).filter(s => s.codec_type === 'video');
  const audio = (probe?.streams ?? []).filter(s => s.codec_type === 'audio');
  const duration = Number(probe?.format?.duration);
  if ((probe?.streams??[]).some(s=>!['video','audio'].includes(s.codec_type)) || videos.length !== 1 || videos[0].width !== media.width || videos[0].height !== media.height || (media.audio === 'absent' ? audio.length !== 0 : media.audio !== 'licensed_instrumental_only' || audio.length !== 1 || audio[0].codec_name !== 'aac' || Number(audio[0].sample_rate) !== 48000 || audio[0].channels !== 2) ||
      !Number.isFinite(duration) || Math.abs(duration - media.durationSeconds) > 0.15 ||
      !String(probe?.format?.format_name ?? '').split(',').some(v => ['mov', 'mp4'].includes(v))) throw Error('derivative_final_probe_mismatch');
}
export async function verifySealedDerivativeFile(file, media) {
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink() || info.size !== media.byteLength || info.size > MAX_BYTES || (info.mode & 0o077)) throw Error('derivative_final_file_changed');
  const bytes = await readFile(file);
  if (bytes.length !== media.byteLength || hash(bytes) !== media.sha256) throw Error('derivative_final_file_changed');
  return true;
}
export async function loadSealedReviewedDerivative(media, { fetch: fetchImpl = globalThis.fetch, probe = probeReviewedDerivative } = {}) {
  if (!approvedNativeMediaUrl(media?.url) || !Number.isSafeInteger(media.byteLength) || media.byteLength < 1024 || media.byteLength > MAX_BYTES) throw Error('derivative_final_url_invalid');
  const directory = await mkdtemp(path.join(tmpdir(), 'clippers-reviewed-final-'));
  const file = path.join(directory, 'sealed.mp4');
  const cleanup = () => rm(directory, { recursive: true, force: true });
  let reader, handle;
  try {
    const response = await fetchImpl(media.url, { redirect: 'error', signal: AbortSignal.timeout(30000), headers: { accept: 'video/mp4,application/octet-stream' } });
    if (!response.ok || response.status !== 200 || !response.body?.getReader) throw Error('derivative_final_unavailable');
    const length = response.headers.get('content-length');
    if (length != null && Number(length) !== media.byteLength) throw Error('derivative_final_size_mismatch');
    const type = response.headers.get('content-type') ?? '';
    if (type && !/^(video\/mp4|application\/octet-stream)(?:;|$)/i.test(type)) throw Error('derivative_final_type_mismatch');
    reader = response.body.getReader();
    handle = await open(file, 'wx', 0o600);
    const digest = createHash('sha256'); let size = 0;
    while (true) {
      const chunk = await reader.read(); if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > media.byteLength || size > MAX_BYTES) throw Error('derivative_final_size_mismatch');
      digest.update(chunk.value); await handle.writeFile(chunk.value);
    }
    await handle.close(); handle = null;
    if (size !== media.byteLength || digest.digest('hex') !== media.sha256) throw Error('derivative_final_hash_mismatch');
    const inspected=await probe(file); validateSealedDerivativeProbe(inspected, media);
    await verifySealedDerivativeFile(file, media);
    return { file, cleanup, verification: { origin: 'sealed_external_final_byte_check', sha256: media.sha256, byteLength: size, audioStreams: inspected.streams.filter(s=>s.codec_type==='audio').length } };
  } catch (error) {
    await reader?.cancel().catch(() => undefined); await handle?.close().catch(() => undefined); await cleanup();
    throw error;
  }
}

/** Read-back identity check for a native CDN receipt; no claim about its rights or audio profile. */
export async function verifyNativeDerivativeReceipt(media, {fetch:fetchImpl=globalThis.fetch}={}) {
  if(!approvedNativeMediaUrl(media?.mediaUrl)||!Number.isSafeInteger(media.byteLength)||media.byteLength<1024||media.byteLength>MAX_BYTES)throw Error('derivative_baseline_media_unverified');
  const r=await fetchImpl(media.mediaUrl,{redirect:'error',signal:AbortSignal.timeout(30000)});
  if(r.status!==200||!r.body?.getReader)throw Error('derivative_baseline_media_unverified');
  const reader=r.body.getReader(),digest=createHash('sha256');let size=0;
  try{while(true){const c=await reader.read();if(c.done)break;size+=c.value.byteLength;if(size>media.byteLength)throw Error('derivative_baseline_media_unverified');digest.update(c.value);}}
  finally{await reader.cancel().catch(()=>undefined);}
  if(size!==media.byteLength||digest.digest('hex')!==media.mediaSha256)throw Error('derivative_baseline_media_unverified');
}
