import path from "node:path";
import type { RadioYoutubeProcessResult } from "./radio-video-edit-agent";

export type DirectRadioYoutubeCommand = {
  youtubeUrl: string;
  driveFolderPath: string[];
  createFolderIfMissing?: boolean;
  djName?: string;
  musicUrl?: string;
  needsMusicUrl?: boolean;
  content: string;
  command: string;
};

const ESTIMATED_COST_PER_EDITED_VIDEO_USD = 0;

function normalizeText(message: string): string {
  return message
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s:/.-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractFirstUrl(message: string): string | null {
  return message.match(/https?:\/\/[^\s"'<>]+/i)?.[0]?.replace(/[),.;]+$/, "") || null;
}

function extractUrls(message: string): string[] {
  return [...message.matchAll(/https?:\/\/[^\s"'<>]+/gi)]
    .map((match) => match[0].replace(/[),.;]+$/, ""));
}

function isYouTubeUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/^www\./, "").toLowerCase();
    return host === "youtube.com" || host.endsWith(".youtube.com") || host === "youtu.be";
  } catch {
    return false;
  }
}

function cleanFolderHint(value?: string): string | null {
  if (!value) return null;
  const cleaned = value
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/\b(?:por favor|please|hazlo|hacerlo|sacalos|sácalos|youtube|link)\b/gi, " ")
    .replace(/\s+(?:y|para|con)\s+(?:que|cuando|si)\b.*$/i, "")
    .replace(/\s+con\s+(?:el\s+)?t[ií]tulo\b.*$/i, "")
    .replace(/^(?:de|del)\s+(?:google\s+)?drive\b.*$/i, "")
    .replace(/[."'“”‘’]+$/g, "")
    .replace(/^["'“”‘’]+/g, "")
    .replace(/\s+/g, " ")
    .trim();

  return cleaned.length >= 2 ? cleaned : null;
}

function splitDriveFolderPath(value: string): string[] {
  return value
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);
}

function cleanCreateFolderHint(value?: string): string | null {
  const cleaned = cleanFolderHint(value)
    ?.replace(/\b(?:crea|crear|creame|créame|carpeta|subcarpeta|folder|drive|google drive)\b/gi, " ")
    .replace(/^(?:de|del|la|el|los|las|con)\s+/i, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned && cleaned.length >= 2 ? cleaned : null;
}

function cleanChildFolderHint(value?: string): string | null {
  if (!value) return null;
  if (/videos?\s+que\s+creaste|clips?\s+que\s+creaste/i.test(value)) {
    return "Videos creados";
  }
  return cleanCreateFolderHint(value);
}

function buildDriveFolderPath(parent?: string | null, child?: string | null): string[] | null {
  const parentParts = parent ? splitDriveFolderPath(parent) : [];
  const childParts = child ? splitDriveFolderPath(child) : [];
  const driveFolderPath = [...parentParts, ...childParts].filter(Boolean);
  return driveFolderPath.length ? driveFolderPath : null;
}

function extractDriveCreateFolderPath(message: string): string[] | null {
  const quotedPath = message.match(/\b(?:carpeta|subcarpeta|folder)\s+["“”']([^"“”']{2,160})["“”']/i)?.[1];
  const quotedCleaned = cleanCreateFolderHint(quotedPath);
  if (quotedCleaned) return splitDriveFolderPath(quotedCleaned);

  const nestedPatterns = [
    /(?:en|dentro\s+de)\s+(?:la\s+)?carpeta\s+(.+?)\s+crea(?:r|me)?\s+(?:una\s+)?(?:subcarpeta|carpeta|folder)\s+(?:llamada\s+|nombre\s+|de\s+|para\s+)?(.+?)(?:\s+(?:de|del)\s+(?:google\s+)?drive\b|[.,;]|$)/i,
    /crea(?:r|me)?\s+(?:una\s+)?(?:subcarpeta|carpeta|folder)\s+(?:llamada\s+|nombre\s+|de\s+|para\s+)?(.+?)\s+(?:en|dentro\s+de)\s+(?:la\s+)?carpeta\s+(.+?)(?:\s+(?:de|del)\s+(?:google\s+)?drive\b|[.,;]|$)/i,
  ];

  const firstNested = message.match(nestedPatterns[0]);
  if (firstNested) {
    return buildDriveFolderPath(cleanCreateFolderHint(firstNested[1]), cleanChildFolderHint(firstNested[2]));
  }

  const secondNested = message.match(nestedPatterns[1]);
  if (secondNested) {
    return buildDriveFolderPath(cleanCreateFolderHint(secondNested[2]), cleanChildFolderHint(secondNested[1]));
  }

  return null;
}

function cleanDjHint(value?: string): string | null {
  if (!value) return null;
  const cleaned = value
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/\b(?:y|con|en|para|guard|guarda|sube|carpeta|drive)\b.*$/i, "")
    .replace(/[^a-zA-Z0-9ÁÉÍÓÚÜÑáéíóúüñ ._-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length >= 2 && cleaned.length <= 60 ? cleaned : null;
}

function extractDjNameFromMessage(message: string): string | null {
  const patterns = [
    /\b(?:dj|nombre\s+del\s+dj|artista)\s*(?:es|:|-)?\s+([a-zA-Z0-9ÁÉÍÓÚÜÑáéíóúüñ ._-]{2,60})(?:[.,;]|$)/i,
    /\b(?:para|de)\s+(?:el\s+)?dj\s+([a-zA-Z0-9ÁÉÍÓÚÜÑáéíóúüñ ._-]{2,60})(?:[.,;]|$)/i,
  ];

  for (const pattern of patterns) {
    const cleaned = cleanDjHint(message.match(pattern)?.[1]);
    if (cleaned) return cleaned;
  }

  return null;
}

export function extractDriveFolderPathFromMessage(message: string): string[] | null {
  const createFolderPath = extractDriveCreateFolderPath(message);
  if (createFolderPath?.length) return createFolderPath;

  const quotedFolder = message.match(/\b(?:carpeta|folder)\s+["“”']([^"“”']{2,120})["“”']/i)?.[1];
  const quotedCleaned = cleanFolderHint(quotedFolder);
  if (quotedCleaned) return splitDriveFolderPath(quotedCleaned);

  const patterns = [
    /(?:gu[aá]rd(?:a|alo|alos|ame)?|sube|pon(?:lo|los)?|save|upload).*?\b(?:en|a)\s+(?:la\s+)?carpeta\s+(.+?)(?:\s+(?:de|del)\s+(?:google\s+)?drive\b|[.,;]|$)/i,
    /(?:gu[aá]rd(?:a|alo|alos|ame)?|sube|pon(?:lo|los)?|save|upload).*?\b(?:en|a)\s+(.+?)(?:\s+(?:de|del)\s+(?:google\s+)?drive\b)/i,
    /(?:google\s+drive|drive)\s+(?:carpeta|folder)\s+(.+?)(?:[.,;]|$)/i,
    /(?:carpeta|folder)\s+(.+?)(?:\s+(?:de|del)\s+(?:google\s+)?drive\b|[.,;]|$)/i,
  ];

  for (const pattern of patterns) {
    const cleaned = cleanFolderHint(message.match(pattern)?.[1]);
    if (cleaned) return splitDriveFolderPath(cleaned);
  }

  return null;
}

export function buildDirectRadioYoutubeCommand(message?: string): DirectRadioYoutubeCommand | null {
  if (!message) return null;
  const urls = extractUrls(message);
  const youtubeUrl = urls.find(isYouTubeUrl) || extractFirstUrl(message);
  if (!youtubeUrl || !isYouTubeUrl(youtubeUrl)) return null;

  const text = normalizeText(message);
  const mentionsRadio = /\b(radio|black room|dj|djs)\b/.test(text);
  const mentionsClips = /\b(clips?|videos?|edits?|reels?|tiktok|instagram|ig|shorts?)\b/.test(text);
  const wantsCreate = /\b(haz\w*|saca\w*|genera\w*|edita\w*|prepara\w*|quiero|necesito|guard\w*|sube\w*)\b/.test(text);
  const mentionsDriveDestination = /\b(?:google\s+drive|drive|carpeta|folder|subcarpeta|guard\w*|sube\w*|agrega\w*)\b/.test(text);
  if (!(mentionsRadio || mentionsDriveDestination) || !mentionsClips || !wantsCreate) return null;

  const musicUrl = urls.find((url) => url !== youtubeUrl && isYouTubeUrl(url));
  const wantsMusicDrop = /\b(audio|cancion|canción|musica|música|song|track|drop)\b/.test(text);
  const driveFolderPath = extractDriveFolderPathFromMessage(message);
  const createFolderIfMissing = /\b(crea\w*|crear|nueva|nuevo|subcarpeta|folder nuevo|new folder)\b/.test(text);
  const djName = extractDjNameFromMessage(message) || undefined;
  if (!driveFolderPath?.length) {
    return {
      youtubeUrl,
      driveFolderPath: [],
      createFolderIfMissing,
      djName,
      musicUrl,
      content: "Puedo hacerlo. Mándame también el nombre o ruta de la carpeta de Google Drive donde quieres que guarde los clips.",
      command: "",
    };
  }

  const folderLabel = driveFolderPath.join("/");
  return {
    youtubeUrl,
    driveFolderPath,
    createFolderIfMissing,
    djName,
    musicUrl,
    content: `Dale. Voy a descargar ese YouTube, sacar los clips de radio para Instagram y TikTok, usar el drop ${musicUrl ? "de la canción enviada" : "del mismo video"} como audio, nombrarlos con ${djName || "el DJ que lea abajo a la izquierda"} y ${createFolderIfMissing ? "crear/usar" : "guardar en"} Google Drive: ${folderLabel}.`,
    command: `[RADIO_YOUTUBE_CLIPS: ${JSON.stringify({ youtubeUrl, driveFolderPath, createFolderIfMissing, djName, musicUrl, sourceAudioDrop: !musicUrl || wantsMusicDrop })}]`,
  };
}

export async function executeDirectRadioYoutubeCommand(command: DirectRadioYoutubeCommand, userId: string): Promise<RadioYoutubeProcessResult> {
  if (!command.driveFolderPath.length) {
    throw new Error("Falta la carpeta de Google Drive donde guardar los clips.");
  }

  const { processYoutubeRadioVideoLink } = await import("./radio-video-edit-agent");
  return processYoutubeRadioVideoLink({
    userId,
    youtubeUrl: command.youtubeUrl,
    driveFolderPath: command.driveFolderPath,
    createFolderIfMissing: Boolean(command.createFolderIfMissing),
    djName: command.djName,
    musicUrl: command.musicUrl,
  });
}

export function formatRadioYoutubeResult(result: RadioYoutubeProcessResult): string {
  if (result.status === "queued" && result.pendingActionId) {
    return [
      "No encontré esa carpeta en Google Drive.",
      `Dejé una confirmación pendiente para crearla y guardar ahí los clips: ${result.pendingActionId}`,
      "Escribe “aprobado” o apruébalo desde Decisiones y aprobaciones.",
    ].join("\n");
  }

  if (result.status === "needs_dj_name" && result.pendingActionId) {
    return [
      "Descargué el video, pero no pude leer el nombre del DJ.",
      `Pendiente para completar el render: ${result.pendingActionId}`,
      `Puedes responder: nombre ${result.pendingActionId} DJ_NAME`,
    ].join("\n");
  }

  if (result.status !== "completed") {
    return `No pude completar los clips: ${result.error || "error desconocido"}`;
  }

  const links = (result.clips || [])
    .map((clip) => clip.driveWebViewLink)
    .filter(Boolean) as string[];
  const names = (result.clips || []).map((clip) => `${path.basename(clip.path)} (${clip.width}x${clip.height}, ${clip.durationSeconds}s)`);
  const clipCount = result.clips?.length || 0;
  const totalEstimatedCost = clipCount * ESTIMATED_COST_PER_EDITED_VIDEO_USD;
  const usedMusicDrop = (result.clips || []).some((clip) => clip.audioSource === "music_drop");
  const usedSourceDrop = (result.clips || []).some((clip) => clip.audioSource === "source_drop");

  return [
    `Listo. Generé los clips de ${result.djName || "radio"} y los guardé en ${result.driveFolderPath?.join("/") || "Google Drive"}.`,
    result.driveFolderCreated ? "Carpeta: la creé en Google Drive porque el pedido lo autorizaba." : null,
    usedMusicDrop
      ? "Audio: usé el drop de la canción enviada y lo recorté al largo exacto de cada video."
      : usedSourceDrop
        ? "Audio: usé el drop del mismo video fuente y lo recorté al largo exacto de cada video."
        : "Audio: usé el audio original sincronizado del video.",
    names.length ? `Archivos: ${names.join(" | ")}` : null,
    links.length ? `Links: ${links.join(" | ")}` : null,
    `Costo estimado por video editado: $${ESTIMATED_COST_PER_EDITED_VIDEO_USD.toFixed(2)} USD.`,
    `Total estimado de esta edición: $${totalEstimatedCost.toFixed(2)} USD para ${clipCount} video${clipCount === 1 ? "" : "s"}.`,
    "Nota: usa herramientas locales gratuitas; Google Drive solo puede consumir almacenamiento de tu cuenta.",
  ].filter(Boolean).join("\n");
}
