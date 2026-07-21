import path from "node:path";

export const BLACKROOM_WORKER_STATE_PATH = "clippers_workspace/blackroom/agent/worker-state.json";
export const BLACKROOM_WORKER_LEDGER_PATH = "clippers_workspace/blackroom/agent/worker-ledger.json";
export const BLACKROOM_WORKER_LOCK_PATH = "clippers_workspace/blackroom/agent/worker.lock";

export interface BlackRoomLocalWorkerState {
  running: boolean;
  workerPid: number | null;
  pid: number | null;
  startedAt: string | null;
  finishedAt: string | null;
  lastExitCode: number | null;
  lastError: string | null;
  runs: number;
}

export const BLACKROOM_REMOTE_UPLOAD_CHUNK_BYTES = 4 * 1024 * 1024;
export const BLACKROOM_FFPROBE_SHOW_ENTRIES = "format=format_name,duration:stream=codec_type,codec_name,width,height,pix_fmt,duration,channels";

export function buildBlackRoomUploadChunks(totalBytes: number, chunkBytes = BLACKROOM_REMOTE_UPLOAD_CHUNK_BYTES): Array<{ index: number; start: number; end: number; size: number }> {
  if (!Number.isSafeInteger(totalBytes) || totalBytes <= 0 || !Number.isSafeInteger(chunkBytes) || chunkBytes <= 0) throw new Error("Invalid BlackRoom upload size");
  const chunks: Array<{ index: number; start: number; end: number; size: number }> = [];
  for (let start = 0, index = 0; start < totalBytes; start += chunkBytes, index += 1) {
    const end = Math.min(totalBytes - 1, start + chunkBytes - 1);
    chunks.push({ index, start, end, size: end - start + 1 });
  }
  return chunks;
}

export type BlackRoomLedgerStatus = "reserved" | "confirmed" | "uncertain";

export interface BlackRoomLedgerEntry {
  reservationId: string;
  jobId: string;
  slot: string;
  videoId: string;
  dj: string;
  language: "en" | "es";
  format: "vertical" | "horizontal";
  durationSeconds: 15 | 30 | 60 | 120 | 300 | 600;
  segmentStartSeconds: number;
  segmentEndSeconds: number;
  caption: string;
  renderPath: string;
  sourcePath: string;
  status: BlackRoomLedgerStatus;
  metricoolId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BlackRoomWorkerLedger { version: 1; entries: BlackRoomLedgerEntry[] }

export function createBlackRoomWorkerLedger(): BlackRoomWorkerLedger {
  return { version: 1, entries: [] };
}

export function createBlackRoomLocalWorkerState(): BlackRoomLocalWorkerState {
  return {
    running: false,
    workerPid: null,
    pid: null,
    startedAt: null,
    finishedAt: null,
    lastExitCode: null,
    lastError: null,
    runs: 0,
  };
}

export function buildBlackRoomCodexArgs(projectDir: string): string[] {
  return [
    "exec",
    "--ephemeral",
    "--color",
    "never",
    "-s",
    "workspace-write",
    "-c",
    "sandbox_workspace_write.network_access=true",
    "-C",
    projectDir,
    "-",
  ];
}

export function shouldRunBlackRoomWorker(
  queue: { enabled?: unknown; jobs?: Array<{ status?: string; notBefore?: string }> },
  now = new Date(),
): boolean {
  return queue.enabled === true && Array.isArray(queue.jobs)
    && queue.jobs.some((job) => ["queued", "retry", "processing"].includes(String(job.status || ""))
      && (!job.notBefore || new Date(job.notBefore).getTime() <= now.getTime()));
}

export function isBlackRoomJobPublishable(
  queue: { enabled?: unknown; jobs?: Array<{ id?: string; status?: string; notBefore?: string }> },
  jobId: string,
  now = new Date(),
): boolean {
  if (queue.enabled !== true) return false;
  const job = queue.jobs?.find((candidate) => candidate.id === jobId);
  return Boolean(job && ["queued", "retry", "processing"].includes(String(job.status || ""))
    && (!job.notBefore || new Date(job.notBefore).getTime() <= now.getTime()));
}

export function selectPublishableBlackRoomReservation<T extends { status?: string; jobId?: string }>(
  queue: { enabled?: unknown; jobs?: Array<{ id?: string; status?: string; notBefore?: string }> },
  entries: T[],
  now = new Date(),
): T | null {
  return entries.find((entry) => entry.status === "reserved" && isBlackRoomJobPublishable(queue, String(entry.jobId || ""), now)) || null;
}

function addUtcCalendarDay(date: string): string {
  const value = new Date(`${date}T12:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + 1);
  return value.toISOString().slice(0, 10);
}

export function nextBlackRoomPublicationDateTime(
  targetDate: string,
  slot: string,
  timezone = "America/New_York",
  now = new Date(),
): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate) || !/^\d{2}:\d{2}$/.test(slot)) throw new Error("invalid BlackRoom target date or slot");
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const currentLocal = `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}`;
  let candidate = `${targetDate}T${slot}`;
  while (candidate <= currentLocal) candidate = `${addUtcCalendarDay(candidate.slice(0, 10))}T${slot}`;
  return `${candidate}:00`;
}

export function validateBlackRoomRenderProbe(
  probe: { format?: { format_name?: string; duration?: string | number }; streams?: Array<Record<string, any>> },
  expectedDurationSeconds: number,
): { durationSeconds: number; width: number; height: number } {
  const formatName = String(probe.format?.format_name || "");
  const durationSeconds = Number(probe.format?.duration);
  const video = (probe.streams || []).find((stream) => stream.codec_type === "video");
  const audio = (probe.streams || []).find((stream) => stream.codec_type === "audio");
  const width = Number(video?.width);
  const height = Number(video?.height);
  if (!formatName.split(",").includes("mp4")) throw new Error("BlackRoom render is not an MP4");
  if (video?.codec_name !== "h264" || !["yuv420p", "yuvj420p"].includes(String(video?.pix_fmt || ""))) {
    throw new Error("BlackRoom render must use H.264 4:2:0 video");
  }
  if (audio?.codec_name !== "aac") throw new Error("BlackRoom render must use AAC audio");
  const audioDurationSeconds = Number(audio?.duration);
  const audioChannels = Number(audio?.channels);
  if (!Number.isFinite(audioDurationSeconds) || audioDurationSeconds < expectedDurationSeconds - 1 || !Number.isSafeInteger(audioChannels) || audioChannels < 1) {
    throw new Error("BlackRoom render audio track is missing, incomplete, or has no channels");
  }
  if (!Number.isFinite(width) || !Number.isFinite(height) || Math.min(width, height) < 540) {
    throw new Error("BlackRoom render resolution is below TikTok's 540 px minimum");
  }
  if (!Number.isFinite(durationSeconds) || durationSeconds < expectedDurationSeconds - 0.75 || durationSeconds > expectedDurationSeconds + 2) {
    throw new Error(`BlackRoom render duration does not match ${expectedDurationSeconds} seconds`);
  }
  return { durationSeconds, width, height };
}

export function validateBlackRoomAudioLoudness(output: string): { meanVolumeDb: number; maxVolumeDb: number } {
  const parseDb = (label: "mean_volume" | "max_volume") => {
    const value = output.match(new RegExp(`${label}:\\s*(-?inf|-?\\d+(?:\\.\\d+)?)\\s*dB`, "i"))?.[1];
    if (!value || /inf/i.test(value)) return Number.NEGATIVE_INFINITY;
    return Number(value);
  };
  const meanVolumeDb = parseDb("mean_volume");
  const maxVolumeDb = parseDb("max_volume");
  if (!Number.isFinite(meanVolumeDb) || !Number.isFinite(maxVolumeDb) || meanVolumeDb < -45 || maxVolumeDb < -30) {
    throw new Error("BlackRoom render audio is silent or below the audible-volume threshold");
  }
  return { meanVolumeDb, maxVolumeDb };
}

export function reserveBlackRoomLedgerEntry(
  ledger: BlackRoomWorkerLedger,
  input: Omit<BlackRoomLedgerEntry, "reservationId" | "status" | "metricoolId" | "createdAt" | "updatedAt">,
  usedSourceVideoIds: Iterable<string> = [],
  now = new Date(),
): BlackRoomLedgerEntry {
  if (!input.jobId || !input.slot || !input.videoId) throw new Error("jobId, slot, and videoId are required");
  if (!input.dj.trim() || !input.caption.trim()) throw new Error("dj and caption are required");
  if (!input.renderPath.trim() || !input.sourcePath.trim()) throw new Error("renderPath and sourcePath are required");
  if (![15, 30, 60, 120, 300, 600].includes(input.durationSeconds)) throw new Error("unsupported duration");
  if (!Number.isFinite(input.segmentStartSeconds) || !Number.isFinite(input.segmentEndSeconds)
    || input.segmentStartSeconds < 0 || input.segmentEndSeconds <= input.segmentStartSeconds) throw new Error("invalid segment");
  if (new Set(usedSourceVideoIds).has(input.videoId)) throw new Error("source video already used by queue history");
  if (ledger.entries.some((entry) => entry.jobId === input.jobId && entry.slot === input.slot)) throw new Error("slot already reserved");
  if (ledger.entries.some((entry) => entry.videoId === input.videoId)) throw new Error("source video already reserved");
  const timestamp = now.toISOString();
  const entry: BlackRoomLedgerEntry = {
    ...input,
    reservationId: `${input.jobId}:${input.slot}:${input.videoId}`,
    status: "reserved",
    metricoolId: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  ledger.entries.push(entry);
  return entry;
}

export function updateBlackRoomLedgerEntry(
  ledger: BlackRoomWorkerLedger,
  reservationId: string,
  update: { status: "confirmed"; metricoolId: string } | { status: "uncertain" },
  now = new Date(),
): BlackRoomLedgerEntry {
  const entry = ledger.entries.find((candidate) => candidate.reservationId === reservationId);
  if (!entry) throw new Error("reservation not found");
  if (entry.status === "confirmed") throw new Error("confirmed reservation is immutable");
  if (update.status === "confirmed" && !update.metricoolId.trim()) throw new Error("metricoolId is required for confirmation");
  entry.status = update.status;
  entry.metricoolId = update.status === "confirmed" ? update.metricoolId.trim() : null;
  entry.updatedAt = now.toISOString();
  return entry;
}

export function assertSafeConfirmedDeletion(projectDir: string, entry: BlackRoomLedgerEntry, filePath: string): string {
  if (entry.status !== "confirmed" || !entry.metricoolId) throw new Error("Metricool confirmation is required before deletion");
  const resolvedProject = path.resolve(projectDir);
  const resolvedFile = path.resolve(filePath);
  const allowedRoots = [
    path.join(resolvedProject, "clippers_workspace/blackroom/sources"),
    path.join(resolvedProject, "clippers_workspace/blackroom/rendered"),
    // Legacy pilot renders used this directory before the worker standardized
    // on `rendered`; exact ledger membership is still required above.
    path.join(resolvedProject, "clippers_workspace/blackroom/renders"),
  ];
  if (![entry.renderPath, entry.sourcePath].map((item) => path.resolve(item)).includes(resolvedFile)) throw new Error("file is not part of this reservation");
  if (!allowedRoots.some((root) => resolvedFile.startsWith(`${root}${path.sep}`))) throw new Error("file is outside BlackRoom media directories");
  return resolvedFile;
}

export function buildBlackRoomWorkerPrompt(projectDir: string): string {
  const queuePath = path.join(projectDir, "clippers_workspace/blackroom/agent/queue.json");
  const ledgerPath = path.join(projectDir, BLACKROOM_WORKER_LEDGER_PATH);
  return `Eres el editor local de BlackRoom. Prepara y reserva EXACTAMENTE un video pendiente y termina. Usa shell para YouTube/edición; no abras Chrome ni intentes entrar en Metricool. El proceso determinista que te invoca se encarga de subir, verificar y limpiar después. Escribe archivos solo dentro de ${projectDir}.

Objetivo: canal fuente https://www.youtube.com/@blackroom_us -> edición -> Metricool -> TikTok @blackroom.clipss, la página de clips de Facebook y YouTube Shorts. Facebook llevará un CTA separado hacia la página principal; el publicador determinista lo añade sin poner ese enlace en TikTok. Los cortes verticales de hasta 178 segundos también se publican como Shorts; los horizontales y los de 5/10 minutos no se fuerzan como Shorts.

Estado persistente:
- Cola: ${queuePath}
- Ledger de recibos/reservas: ${ledgerPath}

Reglas obligatorias:
1. Lee la cola al empezar. Si enabled no es true, termina sin descargar, editar ni cambiar trabajos. Vuelve a comprobar enabled justo antes de reservar; si está pausado, aborta.
2. Procesa un solo slot no confirmado del primer lote queued/retry/processing. Respeta la cantidad, DJs y horarios que figuran en requirements/slots; la cantidad puede cambiar por una orden del chat.
3. No abras ni navegues YouTube con Chrome. Si prioritySources contiene una entrada pending, usa primero esa URL y verifica con yt-dlp que pertenece al canal BlackRoom; si no pertenece, no la reserves y explica el error. Si no hay prioridad, obtén el inventario del canal y selecciona la fuente exclusivamente desde shell con /opt/homebrew/bin/yt-dlp contra https://www.youtube.com/@blackroom_us/videos (por ejemplo, primero --flat-playlist --dump-single-json y luego descarga una URL concreta). Selecciona al azar un video que no aparezca en sourceHistory ni en el ledger. Nunca repitas video fuente ni uses segmentos solapados.
4. Alterna inglés/español y vertical/horizontal; el momento vertical debe ser diferente del horizontal para un mismo DJ.
5. Prueba 15, 30, 60, 120, 300 y 600 segundos conforme a requirements. El corte debe incluir un drop cerca del principio. No inventes que un video corto soporta una duración mayor.
6. No descargues el set completo. Elige primero una ventana aleatoria suficientemente larga para el formato (duración objetivo + 90 s de margen; para 5/10 min usa +180 s), sin solapar segmentos usados. Descarga solo esa ventana en la mayor calidad disponible mediante /opt/homebrew/bin/yt-dlp con --download-sections "*INICIO-FIN" y --force-keyframes-at-cuts. Analiza el audio de esa ventana con /opt/homebrew/bin/ffmpeg y sitúa un aumento fuerte/drop dentro de los primeros segundos del corte final. Guarda una sola fuente parcial bajo clippers_workspace/blackroom/sources y el render final bajo clippers_workspace/blackroom/rendered; registra en el ledger los tiempos absolutos del set original. Renderiza a 1080p con /opt/homebrew/bin/ffmpeg como MP4 H.264 y AAC 128 kbps, y usa -movflags +faststart. Mantén el video entre 5 y 25 Mbps; para 5/10 minutos usa un objetivo cercano a 5 Mbps para que el MP4 final quede inequívocamente debajo de 500 MB. Si ffmpeg falla o el archivo queda vacío, incompleto o supera 500 MB, borra solo ese render fallido y vuelve a renderizar antes de reservar. Verifica duración, codecs, pixel format, resolución y tamaño con /opt/homebrew/bin/ffprobe y mide el render final con ffmpeg volumedetect; no reserves si la pista AAC no cubre el clip completo, no tiene canales, es silenciosa o su volumen máximo está por debajo de -30 dBFS. No uses Chrome.
7. Antes de reservar la fuente, vuelve a leer cola y ledger. Reserva exclusivamente con npm run blackroom:ledger -- --reserve --job ID --slot HH:MM --video ID --dj NOMBRE --language en|es --format vertical|horizontal --duration SEGUNDOS --segment-start SEGUNDO --segment-end SEGUNDO --caption TEXTO --render RUTA --source RUTA. Si falla, no publiques. No escribas el ledger directamente.
8. Termina justo después de que la reserva se haya escrito correctamente. No confirmes, no marques uncertain, no borres archivos, no registres sourceHistory y no cambies el estado final del lote; el publicador determinista hará esas acciones después de obtener evidencia inequívoca de Metricool para TikTok, Facebook y, cuando el formato califique, YouTube Shorts.
9. No añadas links en el caption que generas: TikTok queda sin enlaces y el publicador determinista añadirá solamente al caption de Facebook el enlace exacto del video completo de YouTube y el enlace de la página principal. No resuelvas CAPTCHA, no introduzcas contraseñas y no cambies ajustes de ninguna cuenta.
10. Deja en el ledger: jobId, slot, videoId, DJ, idioma, formato, duración, segmento, ruta de render, caption, estado reserved y timestamps.

No afirmes que el post fue subido o programado. Al final devuelve un resumen compacto de la reserva y las rutas verificadas.`;
}
