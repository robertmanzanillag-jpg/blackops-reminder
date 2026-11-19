import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);
export const editorialEngineSha256 = createHash('sha256').update(await readFile(new URL(import.meta.url))).digest('hex');

async function binary(command, args) {
  try {
    return await exec(command, args, { timeout: 120_000, maxBuffer: 2_000_000, windowsHide: true });
  } catch {
    throw Error('editorial_local_render_failed');
  }
}

async function probe(file) {
  const { stdout } = await binary('ffprobe', ['-v', 'error', '-protocol_whitelist', 'file,pipe', '-f', 'mov',
    '-show_entries', 'stream=codec_type,codec_name,width,height,pix_fmt,duration:format=duration', '-of', 'json', file]);
  const data = JSON.parse(stdout);
  return { streams: data.streams ?? [], duration: Number(data.format?.duration) };
}

async function captionImage(file, text, { height = 220, size = 58 } = {}) {
  await binary('magick', ['-background', 'none', '-fill', 'white', '-stroke', 'black', '-strokewidth', '2',
    '-font', 'Arial-Bold', '-pointsize', String(size), '-gravity', 'center', '-size', '940x' + height, 'caption:' + text, 'PNG32:' + file]);
}

async function writeFrameTrack(directory, name, runs, finalImage) {
  const list = path.join(directory, name + '.ffconcat');
  const lines = runs.flatMap(([file, duration]) => ["file '" + file + "'", 'duration ' + duration.toFixed(6)]);
  await writeFile(list, ['ffconcat version 1.0', ...lines, "file '" + finalImage + "'", 'duration 3600',
    "file '" + finalImage + "'", ''].join('\n'), { mode: 0o600, flag: 'wx' });
  return list;
}

async function cardTrack(directory, cards) {
  const runs = [];
  for (const [index, card] of cards.entries()) {
    const name = 'card-' + index + '.png';
    await binary('magick', ['-size', '1080x1920', 'canvas:#101B28',
      '-fill', '#73D7F8', '-draw', 'rectangle 112,320 298,332',
      '(', '-background', 'none', '-fill', '#FFFFFF', '-font', 'Arial-Bold', '-pointsize', '76', '-gravity', 'northwest',
      '-size', '856x380', 'caption:' + card.heading, ')', '-gravity', 'northwest', '-geometry', '+112+420', '-composite',
      '(', '-background', 'none', '-fill', '#D9E6F2', '-font', 'Arial', '-pointsize', '54', '-gravity', 'northwest',
      '-size', '856x600', 'caption:' + card.body, ')', '-gravity', 'northwest', '-geometry', '+112+820', '-composite',
      'PNG24:' + path.join(directory, name)]);
    runs.push([name, card.endSeconds - card.startSeconds]);
  }
  return writeFrameTrack(directory, 'cards', runs, runs.at(-1)[0]);
}

async function subtitleTrack(directory, subtitles) {
  const blank = 'subtitle-blank.png';
  await binary('magick', ['-size', '940x170', 'xc:none', 'PNG32:' + path.join(directory, blank)]);
  const runs = [];
  let cursor = 0;
  for (const [index, cue] of subtitles.entries()) {
    const name = 'subtitle-' + index + '.png';
    await captionImage(path.join(directory, name), cue.text, { height: 170, size: 51 });
    if (cue.startSeconds > cursor) runs.push([blank, cue.startSeconds - cursor]);
    runs.push([name, cue.endSeconds - cue.startSeconds]);
    cursor = cue.endSeconds;
  }
  return writeFrameTrack(directory, 'subtitles', runs, blank);
}

export async function renderEditorialMp4({ source, output, overlay, start, params, captionText, subtitles, visualPlan }) {
  const input = await probe(source);
  if (!Number.isFinite(input.duration) || start + params.duration > input.duration) throw Error('editorial_source_interval_invalid');
  const video = input.streams.find(stream => stream.codec_type === 'video');
  const rectangle = params.crop && typeof params.crop === 'object' ? params.crop : null;
  if (rectangle && (!video || rectangle.x + rectangle.width > video.width || rectangle.y + rectangle.height > video.height)) {
    throw Error('editorial_source_crop_invalid');
  }
  const header = params.caption_layout === 'header';
  const height = header ? 1680 : 1920;
  let framing;
  if (visualPlan) {
    framing = 'fps=30,format=yuv420p,setsar=1';
  } else if (rectangle || header) {
    const sourceCrop = rectangle ? `crop=${rectangle.width}:${rectangle.height}:${rectangle.x}:${rectangle.y}:exact=1,` : '';
    const position = header ? '(oh-ih+240)/2' : '(oh-ih)/2';
    framing = sourceCrop + 'scale=1080:' + height + ':force_original_aspect_ratio=decrease:force_divisible_by=2,' +
      'pad=1080:1920:(ow-iw)/2:' + position + ',setsar=1';
  } else {
    const offset = { left: '0', center: '(iw-ow)/2', right: 'iw-ow' }[params.crop];
    framing = 'scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920:' + offset + ':(ih-oh)/2,setsar=1';
  }
  const args = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-protocol_whitelist', 'file,pipe', '-noautorotate',
    '-ss', String(start), '-f', 'mov', '-i', source];
  const tracks = [];
  let videoInput = 0;
  if (visualPlan) {
    const list = await cardTrack(path.dirname(overlay), visualPlan.cards);
    args.push('-protocol_whitelist', 'file,pipe', '-f', 'concat', '-safe', '1', '-i', list);
    videoInput = 1;
  }
  if (params.caption_layout !== 'off') {
    await captionImage(overlay, captionText);
    args.push('-protocol_whitelist', 'file,pipe', '-i', overlay);
    tracks.push(header ? '10' : params.caption_layout === 'upper' ? 'H*0.2-h/2' : 'H*0.68-h/2');
  }
  if (subtitles.length) {
    const list = await subtitleTrack(path.dirname(overlay), subtitles);
    args.push('-protocol_whitelist', 'file,pipe', '-f', 'concat', '-safe', '1', '-i', list);
    tracks.push('H*0.82-h/2');
  }
  if (!tracks.length) args.push('-map', videoInput + ':V:0', '-vf', framing);
  else {
    const layers = tracks.map((y, index) => `[base${index}][${videoInput + index + 1}:v]overlay=(W-w)/2:${y}[base${index + 1}]`);
    args.push('-filter_complex', ['[' + videoInput + ':V:0]' + framing + '[base0]', ...layers].join(';'), '-map', `[base${tracks.length}]`);
  }
  args.push('-map', '0:a:0');
  args.push('-t', String(params.duration), '-fs', '250000000', '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-map_metadata', '-1', '-map_chapters', '-1', '-movflags', '+faststart', output);
  await binary('ffmpeg', args);
  const actual = await probe(output);
  const audio = actual.streams.find(s => s.codec_type === 'audio' && s.codec_name === 'aac');
  const audioDuration = Number(audio?.duration);
  if (actual.streams.length !== 2 ||
      !actual.streams.some(s => s.codec_type === 'video' && s.codec_name === 'h264' && s.width === 1080 && s.height === 1920 && s.pix_fmt === 'yuv420p') ||
      !Number.isFinite(audioDuration) || Math.abs(audioDuration - params.duration) > 0.35 ||
      !Number.isFinite(actual.duration) || Math.abs(actual.duration - params.duration) > 0.35) throw Error('editorial_render_probe_invalid');
  return { outputDurationSeconds: actual.duration, outputAudioDurationSeconds: audioDuration };
}
