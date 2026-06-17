import { createHash } from "crypto";
import { setTimeout as delay } from "timers/promises";
import sharp from "sharp";
import { storage } from "./storage";
import { getRadioSlotsForMonth, type RadioSlot } from "./radio-agent";
import { ensureRadioDriveFolder, uploadRadioTemplatePng } from "./google-drive";
import { syncGoogleCalendarToTasks } from "./calendar-sync";
import { getSystemUserId } from "./user-context";
import { getCanvaAccessToken } from "./canva-oauth";
import type { RadioTemplateAsset } from "@shared/schema";

const RADIO_TIMEZONE = "America/New_York";
const CANVA_API_BASE = "https://api.canva.com/rest/v1";
const CANVA_REFERENCE_DESIGN_ID = "DAGRzIet_rI";
const DEFAULT_CANVA_RADIO_BRAND_TEMPLATE_ID = "EAHMxABUd6M";
const DEFAULT_CANVA_DJ_FIELD = "dj_name";
const CANVA_TRANSPARENT_EXPORT = true;
const BLACK_BACKGROUND_ALPHA_THRESHOLD = 18;
const EDGE_CLEANUP_PIXELS = 2;

export interface GeneratedRadioTemplate {
  eventId: string;
  eventDate: string;
  slotHour: number;
  djName: string;
  filename: string;
  canvaDesignId: string | null;
  canvaEditUrl: string | null;
  canvaViewUrl: string | null;
  driveFileId: string | null;
  driveLink: string | null;
  status: "generated" | "skipped" | "failed";
  errorMessage?: string | null;
}

export interface RadioTemplateRunResult {
  dateKey: string;
  generated: number;
  skipped: number;
  failed: number;
  files: GeneratedRadioTemplate[];
}

interface CanvaAutofillResult {
  designId: string;
  editUrl: string | null;
  viewUrl: string | null;
}

function getRequiredCanvaTemplateConfig() {
  const brandTemplateId = process.env.CANVA_RADIO_BRAND_TEMPLATE_ID || DEFAULT_CANVA_RADIO_BRAND_TEMPLATE_ID;
  const djField = process.env.CANVA_RADIO_DJ_FIELD || DEFAULT_CANVA_DJ_FIELD;

  if (!brandTemplateId) {
    throw new Error(
      `Canva Connect is not configured. Add CANVA_RADIO_BRAND_TEMPLATE_ID. The Canva design ${CANVA_REFERENCE_DESIGN_ID} must be published as a brand template with a ${djField} autofill text field.`
    );
  }

  return { brandTemplateId, djField };
}

async function canvaRequest<T>(userId: string, path: string, init: RequestInit = {}): Promise<T> {
  const accessToken = await getCanvaAccessToken(userId);
  const response = await fetch(`${CANVA_API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    if (response.status === 401 || response.status === 403) {
      throw new Error(`Canva permission is missing or expired. ${body}`.trim());
    }
    throw new Error(`Canva API request failed (${response.status}). ${body}`.trim());
  }

  return response.json() as Promise<T>;
}

export function getDateKeyInTimezone(date: Date, timezone = RADIO_TIMEZONE): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function sanitizeRadioFilenamePart(value: string): string {
  const normalized = value
    .replace(/[Øø]/g, "O")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toUpperCase();

  return (normalized || "DJ").slice(0, 80);
}

export function buildRadioTemplateSourceHash(params: {
  eventId: string;
  eventDate: Date;
  slotHour: number;
  djName: string;
  rawDescription?: string | null;
  canvaBrandTemplateId?: string | null;
  canvaDjField?: string | null;
}): string {
  return createHash("sha256")
    .update(JSON.stringify({
      eventId: params.eventId,
      eventDate: params.eventDate.toISOString(),
      slotHour: params.slotHour,
      djName: params.djName.trim(),
      rawDescription: params.rawDescription || "",
      canvaBrandTemplateId: params.canvaBrandTemplateId || process.env.CANVA_RADIO_BRAND_TEMPLATE_ID || DEFAULT_CANVA_RADIO_BRAND_TEMPLATE_ID,
      canvaDjField: params.canvaDjField || process.env.CANVA_RADIO_DJ_FIELD || DEFAULT_CANVA_DJ_FIELD,
      transparentBackground: CANVA_TRANSPARENT_EXPORT,
      template: "canva-codeine-corvette-v2",
    }))
    .digest("hex");
}

function getSlotName(slot: RadioSlot, slotHour: number): string | null {
  if (slotHour === 7) return slot.slot7;
  if (slotHour === 8) return slot.slot8;
  if (slotHour === 9) return slot.slot9;
  return null;
}

function buildFilename(dateKey: string, slotHour: number, djName: string): string {
  return `${dateKey}_${slotHour}pm_${sanitizeRadioFilenamePart(djName)}.png`;
}

function getTemplateInputs(slot: RadioSlot): Array<{ slotHour: number; djName: string }> {
  const inputs: Array<{ slotHour: number; djName: string }> = [];
  for (const slotHour of [7, 8, 9] as const) {
    const djName = getSlotName(slot, slotHour);
    if (djName) inputs.push({ slotHour, djName });
  }
  return inputs;
}

async function createCanvaAutofill(userId: string, djName: string): Promise<CanvaAutofillResult> {
  const { brandTemplateId, djField } = getRequiredCanvaTemplateConfig();
  const created = await canvaRequest<{ job: { id: string } }>(userId, "/autofills", {
    method: "POST",
    body: JSON.stringify({
      brand_template_id: brandTemplateId,
      data: {
        [djField]: {
          type: "text",
          text: djName.toUpperCase(),
        },
      },
    }),
  });

  for (let attempt = 0; attempt < 24; attempt++) {
    const job = await canvaRequest<any>(userId, `/autofills/${created.job.id}`);
    const status = job.job?.status || job.status;

    if (status === "success") {
      const result = job.job?.result || job.result || {};
      const design = result.design || result;
      return {
        designId: design.id,
        editUrl: design.urls?.edit_url || result.urls?.edit_url || design.url || null,
        viewUrl: design.urls?.view_url || result.urls?.view_url || null,
      };
    }

    if (status === "failed") {
      throw new Error(job.job?.error?.message || job.error?.message || "Canva autofill failed");
    }

    await delay(1500);
  }

  throw new Error("Canva autofill timed out");
}

async function exportCanvaDesignPng(userId: string, designId: string): Promise<Buffer> {
  const created = await canvaRequest<{ job: { id: string } }>(userId, "/exports", {
    method: "POST",
    body: JSON.stringify({
      design_id: designId,
      format: {
        type: "png",
        transparent_background: CANVA_TRANSPARENT_EXPORT,
        lossless: true,
        pages: [1],
      },
    }),
  });

  for (let attempt = 0; attempt < 30; attempt++) {
    const job = await canvaRequest<any>(userId, `/exports/${created.job.id}`);
    const status = job.job?.status || job.status;

    if (status === "success") {
      const urls: string[] = job.job?.urls || job.urls || job.job?.result?.urls || [];
      const url = urls[0];
      if (!url) throw new Error("Canva export did not return a PNG URL");

      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to download Canva PNG export (${response.status})`);
      }
      return Buffer.from(await response.arrayBuffer());
    }

    if (status === "failed") {
      throw new Error(job.job?.error?.message || job.error?.message || "Canva export failed");
    }

    await delay(1500);
  }

  throw new Error("Canva export timed out");
}

export async function forceTransparentBackground(input: Buffer): Promise<Buffer> {
  const image = sharp(input).ensureAlpha();
  const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });

  for (let index = 0; index < data.length; index += info.channels) {
    const pixelIndex = index / info.channels;
    const x = pixelIndex % info.width;
    const y = Math.floor(pixelIndex / info.width);
    const red = data[index] || 0;
    const green = data[index + 1] || 0;
    const blue = data[index + 2] || 0;
    const alphaIndex = index + 3;

    if (
      red <= BLACK_BACKGROUND_ALPHA_THRESHOLD &&
      green <= BLACK_BACKGROUND_ALPHA_THRESHOLD &&
      blue <= BLACK_BACKGROUND_ALPHA_THRESHOLD
    ) {
      data[alphaIndex] = 0;
    } else if (
      x < EDGE_CLEANUP_PIXELS ||
      y < EDGE_CLEANUP_PIXELS ||
      x >= info.width - EDGE_CLEANUP_PIXELS ||
      y >= info.height - EDGE_CLEANUP_PIXELS
    ) {
      data[alphaIndex] = 0;
    }
  }

  return sharp(data, {
    raw: {
      width: info.width,
      height: info.height,
      channels: info.channels,
    },
  })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

export async function generateRadioTemplatesForDate(
  userId = getSystemUserId(),
  targetDate = new Date()
): Promise<RadioTemplateRunResult> {
  await syncGoogleCalendarToTasks(userId);

  const { brandTemplateId, djField } = getRequiredCanvaTemplateConfig();
  const dateKey = getDateKeyInTimezone(targetDate);
  const radioSlots = (await getRadioSlotsForMonth(userId))
    .filter((slot) => getDateKeyInTimezone(new Date(slot.date)) === dateKey);

  const files: GeneratedRadioTemplate[] = [];
  let generated = 0;
  let skipped = 0;
  let failed = 0;

  for (const slot of radioSlots) {
    const dateFolderName = `${dateKey} - Radio`;
    let folderId: string | null = null;

    for (const input of getTemplateInputs(slot)) {
      const eventDate = new Date(slot.date);
      const sourceHash = buildRadioTemplateSourceHash({
        eventId: slot.eventId,
        eventDate,
        slotHour: input.slotHour,
        djName: input.djName,
        rawDescription: slot.rawDescription,
        canvaBrandTemplateId: brandTemplateId,
        canvaDjField: djField,
      });
      const existing = await storage.getRadioTemplateAsset(userId, slot.eventId, input.slotHour);
      const filename = buildFilename(dateKey, input.slotHour, input.djName);

      if (existing?.sourceHash === sourceHash && existing.status === "generated" && existing.driveFileId) {
        skipped++;
        files.push({
          eventId: slot.eventId,
          eventDate: dateKey,
          slotHour: input.slotHour,
          djName: input.djName,
          filename,
          canvaDesignId: existing.canvaDesignId,
          canvaEditUrl: existing.canvaEditUrl,
          canvaViewUrl: existing.canvaViewUrl,
          driveFileId: existing.driveFileId,
          driveLink: existing.driveLink,
          status: "skipped",
        });
        continue;
      }

      const asset = await storage.upsertRadioTemplateAsset(userId, {
        userId,
        eventId: slot.eventId,
        eventDate,
        slotHour: input.slotHour,
        djName: input.djName,
        sourceHash,
        canvaBrandTemplateId: brandTemplateId,
        canvaDesignId: existing?.canvaDesignId || null,
        canvaEditUrl: existing?.canvaEditUrl || null,
        canvaViewUrl: existing?.canvaViewUrl || null,
        driveFileId: existing?.driveFileId || null,
        driveLink: existing?.driveLink || null,
        status: "pending",
        lastGeneratedAt: existing?.lastGeneratedAt || null,
        errorMessage: null,
      });

      try {
        const canvaDesign = await createCanvaAutofill(userId, input.djName);
        const exportedBuffer = await exportCanvaDesignPng(userId, canvaDesign.designId);
        const buffer = await forceTransparentBackground(exportedBuffer);
        folderId ||= await ensureRadioDriveFolder(dateFolderName);
        const upload = await uploadRadioTemplatePng({
          buffer,
          filename,
          folderId,
          existingFileId: asset.driveFileId,
        });

        await storage.updateRadioTemplateAsset(asset.id, {
          canvaBrandTemplateId: brandTemplateId,
          canvaDesignId: canvaDesign.designId,
          canvaEditUrl: canvaDesign.editUrl,
          canvaViewUrl: canvaDesign.viewUrl,
          driveFileId: upload.fileId,
          driveLink: upload.webViewLink || upload.webContentLink,
          status: "generated",
          lastGeneratedAt: new Date(),
          errorMessage: null,
        } as Partial<RadioTemplateAsset>);

        generated++;
        files.push({
          eventId: slot.eventId,
          eventDate: dateKey,
          slotHour: input.slotHour,
          djName: input.djName,
          filename,
          canvaDesignId: canvaDesign.designId,
          canvaEditUrl: canvaDesign.editUrl,
          canvaViewUrl: canvaDesign.viewUrl,
          driveFileId: upload.fileId,
          driveLink: upload.webViewLink || upload.webContentLink,
          status: "generated",
        });
      } catch (error: any) {
        failed++;
        const message = error?.message || "Failed to generate radio template";
        await storage.updateRadioTemplateAsset(asset.id, {
          status: "failed",
          errorMessage: message,
        } as Partial<RadioTemplateAsset>);
        files.push({
          eventId: slot.eventId,
          eventDate: dateKey,
          slotHour: input.slotHour,
          djName: input.djName,
          filename,
          canvaDesignId: asset.canvaDesignId,
          canvaEditUrl: asset.canvaEditUrl,
          canvaViewUrl: asset.canvaViewUrl,
          driveFileId: asset.driveFileId,
          driveLink: asset.driveLink,
          status: "failed",
          errorMessage: message,
        });
      }
    }
  }

  return { dateKey, generated, skipped, failed, files };
}
