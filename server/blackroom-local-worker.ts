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
  ];
  if (![entry.renderPath, entry.sourcePath].map((item) => path.resolve(item)).includes(resolvedFile)) throw new Error("file is not part of this reservation");
  if (!allowedRoots.some((root) => resolvedFile.startsWith(`${root}${path.sep}`))) throw new Error("file is outside BlackRoom media directories");
  return resolvedFile;
}

export function buildBlackRoomWorkerPrompt(projectDir: string): string {
  const queuePath = path.join(projectDir, "clippers_workspace/blackroom/agent/queue.json");
  const ledgerPath = path.join(projectDir, BLACKROOM_WORKER_LEDGER_PATH);
  return `Eres el trabajador local de BlackRoom. Procesa EXACTAMENTE un post pendiente y termina. Usa shell para YouTube/edición y usa la sesión de Chrome del usuario con la habilidad chrome:control-chrome exclusivamente para Metricool; escribe archivos solo dentro de ${projectDir}.

Objetivo: canal fuente https://www.youtube.com/@blackroom_us -> edición -> Metricool -> TikTok @blackroom.clipss.

Estado persistente:
- Cola: ${queuePath}
- Ledger de recibos/reservas: ${ledgerPath}

Reglas obligatorias:
1. Lee la cola al empezar. Si enabled no es true, termina sin descargar, editar, subir ni cambiar trabajos. Vuelve a comprobar enabled justo antes de reservar y justo antes de subir; si está pausado, aborta.
2. Procesa un solo slot no confirmado del primer lote queued/retry/processing. Mantén 10 posts diarios, 5 DJs distintos, horarios separados 90 minutos y cobertura de madrugada.
3. No abras ni navegues YouTube con Chrome. Obtén el inventario del canal y selecciona la fuente exclusivamente desde shell con /opt/homebrew/bin/yt-dlp contra https://www.youtube.com/@blackroom_us/videos (por ejemplo, primero --flat-playlist --dump-single-json y luego descarga una URL de video concreta). Selecciona al azar un video que no aparezca en sourceHistory ni en el ledger. Nunca repitas video fuente ni uses segmentos solapados.
4. Alterna inglés/español y vertical/horizontal; el momento vertical debe ser diferente del horizontal para un mismo DJ.
5. Prueba 15, 30, 60, 120, 300 y 600 segundos conforme a requirements. El corte debe incluir un drop cerca del principio. No inventes que un video corto soporta una duración mayor.
6. No descargues el set completo. Elige primero una ventana aleatoria suficientemente larga para el formato (duración objetivo + 90 s de margen; para 5/10 min usa +180 s), sin solapar segmentos usados. Descarga solo esa ventana en la mayor calidad disponible mediante /opt/homebrew/bin/yt-dlp con --download-sections "*INICIO-FIN" y --force-keyframes-at-cuts. Analiza el audio de esa ventana con /opt/homebrew/bin/ffmpeg y sitúa un aumento fuerte/drop dentro de los primeros segundos del corte final. Guarda una sola fuente parcial bajo clippers_workspace/blackroom/sources; registra en el ledger los tiempos absolutos del set original. Renderiza con /opt/homebrew/bin/ffmpeg a MP4 H.264 + AAC compatible con Metricool/QuickTime y verifica con /opt/homebrew/bin/ffprobe antes de subir. YouTube nunca se opera mediante Chrome; Chrome se reserva para Metricool.
7. Antes de reservar la fuente, vuelve a leer cola y ledger. Reserva exclusivamente con npm run blackroom:ledger -- --reserve --job ID --slot HH:MM --video ID --dj NOMBRE --language en|es --format vertical|horizontal --duration SEGUNDOS --segment-start SEGUNDO --segment-end SEGUNDO --caption TEXTO --render RUTA --source RUTA. Si falla, no publiques. No escribas el ledger directamente.
8. Programa el post en Metricool para TikTok, en el slot exacto, con caption natural en el idioma elegido. No añadas link de YouTube en el caption.
9. Solo confirma con npm run blackroom:ledger -- --confirm --reservation ... --metricool-id ... y registra la fuente después de ver confirmación inequívoca de Metricool. Si se intentó subir pero no hay confirmación, usa --uncertain; ese slot queda bloqueado y no se repite.
10. No borres archivos directamente. Después de confirmar, usa npm run blackroom:ledger -- --delete-confirmed --reservation ... --file ... para cada archivo exacto. Nunca borres carpetas.
11. No resuelvas CAPTCHA, no introduzcas contraseñas, no publiques inmediatamente y no cambies ajustes de cuenta. Si hace falta login/CAPTCHA o Chrome/Metricool no está disponible, registra el bloqueo y termina.
12. Cuando el ledger tenga 10 recibos confirmados para el lote, marca ese lote complete. De otro modo déjalo disponible para el próximo ciclo.
13. Deja en el ledger: jobId, slot, videoId, DJ, idioma, formato, duración, segmento, ruta de render, caption, estado, URL/identificador de Metricool si existe y timestamps.

No afirmes éxito sin evidencia visible. Al final devuelve un resumen compacto y verificable.`;
}
