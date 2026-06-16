import { useState, useRef, useEffect, useCallback } from "react";
import { Download, ImageIcon, RefreshCw, CalendarCheck, Users, Eye, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useQueryClient } from "@tanstack/react-query";

interface RadioSlot {
  eventId: string;
  date: string;
  dateStr: string;
  slot7: string | null;
  slot8: string | null;
  slot9: string | null;
  emptySlots?: number[];
  rawDescription?: string | null;
  eventTitle?: string;
  weekday?: string;
  dayNumber?: number;
  ordinalDay?: string;
}

interface GlobalConfig {
  format: "flyer" | "story" | "post";
}

// ─── Canvas rendering ────────────────────────────────────────────────────────

const COLORS = {
  bg: "#030303",
  white: "#E6E6E6",
  red: "#1A1A1A",
  redVivid: "#2A2A2A",
  gray: "#BDBDBD",
};

function addGrain(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const imageData = ctx.getImageData(0, 0, w, h);
  const data = imageData.data;

  // Fine film grain
  for (let i = 0; i < data.length; i += 4) {
    const n = (Math.random() - 0.5) * 42;
    data[i]     = Math.min(255, Math.max(0, data[i]     + n));
    data[i + 1] = Math.min(255, Math.max(0, data[i + 1] + n));
    data[i + 2] = Math.min(255, Math.max(0, data[i + 2] + n));
  }

  // Medium "sand" particles — sparse brighter dots
  const particles = Math.floor((w * h) / 120);
  for (let p = 0; p < particles; p++) {
    const px = Math.floor(Math.random() * w);
    const py = Math.floor(Math.random() * h);
    const idx = (py * w + px) * 4;
    const v = 18 + Math.random() * 22;
    data[idx]     = Math.min(255, data[idx]     + v);
    data[idx + 1] = Math.min(255, data[idx + 1] + v);
    data[idx + 2] = Math.min(255, data[idx + 2] + v);
  }

  ctx.putImageData(imageData, 0, 0);

  // Vignette
  const g = ctx.createRadialGradient(w / 2, h / 2, h * 0.25, w / 2, h / 2, h * 0.9);
  g.addColorStop(0, "rgba(0,0,0,0)");
  g.addColorStop(1, "rgba(0,0,0,0.6)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

function getOrdinalParts(slot: RadioSlot): { number: string; suffix: string } | null {
  const ordinal = slot.ordinalDay || (() => {
    const day = slot.dayNumber || new Date(slot.date).getDate();
    if (!Number.isFinite(day)) return "";
    const lastTwo = day % 100;
    let suffix = "TH";
    if (lastTwo < 11 || lastTwo > 13) {
      if (day % 10 === 1) suffix = "ST";
      if (day % 10 === 2) suffix = "ND";
      if (day % 10 === 3) suffix = "RD";
    }
    return `${day}${suffix}`;
  })();

  const match = ordinal.match(/^(\d+)([A-Z]+)$/);
  if (!match) return null;
  return { number: match[1], suffix: match[2] };
}

function renderToCanvas(
  canvas: HTMLCanvasElement,
  bgImage: HTMLImageElement | null,
  slot: RadioSlot,
  config: GlobalConfig
): void {
  const dimensions = {
    flyer: { width: 1024, height: 1536 },
    story: { width: 1080, height: 1920 },
    post: { width: 1080, height: 1350 },
  }[config.format];
  const W = dimensions.width;
  const H = dimensions.height;
  canvas.width = W;
  canvas.height = H;

  // Scale helper: overlay coords are measured from the native 1024x1536 flyer.
  const R = H / 1536;
  const sc = (v: number) => Math.round(v * R);

  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, W, H);

  // ── Background: left-anchored cover fit (crop right side only, keep left edge) ──
  if (bgImage) {
    const ia = bgImage.naturalWidth / bgImage.naturalHeight;
    const ca = W / H;
    let sx = 0, sy = 0, sw = bgImage.naturalWidth, sh = bgImage.naturalHeight;
    if (ia > ca) {
      sw = sh * ca; // visible width in template pixels
      sx = 0;       // anchor to LEFT — crop from right, not center
    } else {
      sh = sw / ca;
      sy = (bgImage.naturalHeight - sh) / 2;
    }
    ctx.drawImage(bgImage, sx, sy, sw, sh, 0, 0, W, H);
  } else {
    addGrain(ctx, W, H);
  }

  // ── Redraw the full date line so the weekday and number share the same type.
  const ordinalParts = getOrdinalParts(slot);
  if (ordinalParts) {
    const dateSz = sc(48);
    const dateX = sc(48);
    const dateY = sc(1138);

    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = COLORS.white;
    ctx.shadowColor = "rgba(0,0,0,0.9)";
    ctx.shadowBlur = sc(8);
    ctx.shadowOffsetX = sc(2);
    ctx.shadowOffsetY = sc(2);

    if (bgImage) {
      ctx.save();
      ctx.shadowBlur = 0;
      ctx.drawImage(
        bgImage,
        Math.round(bgImage.naturalWidth * 0.60),
        Math.round(bgImage.naturalHeight * 0.58),
        Math.round(bgImage.naturalWidth * 0.25),
        Math.round(bgImage.naturalHeight * 0.08),
        sc(42),
        sc(1094),
        sc(300),
        sc(66),
      );
      ctx.fillStyle = "rgba(0,0,0,0.18)";
      ctx.fillRect(sc(42), sc(1094), sc(300), sc(66));
      ctx.restore();
      ctx.fillStyle = COLORS.white;
      ctx.shadowColor = "rgba(0,0,0,0.9)";
      ctx.shadowBlur = sc(8);
    }

    ctx.font = `normal ${dateSz}px "Bebas Neue", "Arial Narrow", Arial`;
    (ctx as any).letterSpacing = `${(45 / 1000) * dateSz}px`;
    ctx.fillText(`THURSDAY ${ordinalParts.number}${ordinalParts.suffix}`, dateX, dateY);

    ctx.shadowBlur = 0;
    ctx.shadowColor = "transparent";
  }

  // ── DJ names: right of "7:00 PM / 8:00 PM / 9:00 PM" baked into template.
  // rowYs shifted down — sc(938) was at LINE UP header, actual time rows start lower.
  const nameX = sc(238);
  const djFontSz = sc(58);
  const rowYs = [sc(842), sc(938), sc(1034)];
  const djSlots = [slot.slot7, slot.slot8, slot.slot9];

  // The official template includes placeholder DJ names. Patch that area with
  // clean texture from the right side before drawing real calendar names.
  ctx.save();
  if (bgImage) {
    ctx.drawImage(
      bgImage,
      Math.round(bgImage.naturalWidth * 0.62),
      Math.round(bgImage.naturalHeight * 0.50),
      Math.round(bgImage.naturalWidth * 0.32),
      Math.round(bgImage.naturalHeight * 0.20),
      sc(246),
      sc(780),
      sc(430),
      sc(300),
    );
  }
  ctx.fillStyle = "rgba(0,0,0,0.18)";
  ctx.fillRect(sc(246), sc(780), sc(430), sc(300));
  ctx.restore();

  for (let i = 0; i < 3; i++) {
    if (!djSlots[i]) continue;
    const name = djSlots[i]!.toUpperCase();
    const maxW = W - nameX - sc(46);

    // Auto-shrink if name is too long
    let nameSz = djFontSz;
    ctx.font = `normal ${nameSz}px "Bebas Neue", Arial`;
    (ctx as any).letterSpacing = `${(90 / 1000) * nameSz}px`;
    while (ctx.measureText(name).width > maxW && nameSz > sc(32)) {
      nameSz -= sc(3);
      ctx.font = `normal ${nameSz}px "Bebas Neue", Arial`;
      (ctx as any).letterSpacing = `${(90 / 1000) * nameSz}px`;
    }

    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = COLORS.white;
    ctx.shadowColor = "rgba(0,0,0,0.95)";
    ctx.shadowBlur = sc(10);
    ctx.shadowOffsetX = sc(2);
    ctx.shadowOffsetY = sc(3);
    // Vertically center if nameSz was shrunk
    const baselineOffset = Math.round((djFontSz - nameSz) / 2);
    ctx.fillText(name, nameX, rowYs[i] - baselineOffset);
    ctx.shadowBlur = 0;
    ctx.shadowColor = "transparent";
  }
}

async function generateDataUrl(
  slot: RadioSlot,
  bgImage: HTMLImageElement | null,
  config: GlobalConfig
): Promise<string> {
  // Ensure Bebas Neue is fully loaded before drawing to canvas
  await document.fonts.load('400 72px "Bebas Neue"').catch(() => {});
  await document.fonts.ready.catch(() => {});
  const canvas = document.createElement("canvas");
  renderToCanvas(canvas, bgImage, slot, config);
  return canvas.toDataURL("image/png");
}

function downloadDataUrl(url: string, filename: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
}

// ─── Component ───────────────────────────────────────────────────────────────

export function FlyerGenerator({ slots }: { slots: RadioSlot[] }) {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [bgImage, setBgImage] = useState<HTMLImageElement | null>(null);
  const [fontReady, setFontReady] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [flyerUrls, setFlyerUrls] = useState<Record<string, string>>({});
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewTitle, setPreviewTitle] = useState<string>("");
  const [previewFilename, setPreviewFilename] = useState<string>("blackroom-flyer.png");
  const [config, setConfig] = useState<GlobalConfig>({ format: "flyer" });

  // Load the official empty BR flyer template.
  useEffect(() => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      setBgImage(img);
    };
    img.src = "/br-radio-template.png";
  }, []);

  // Font ready — wait for Bebas Neue explicitly so canvas uses the correct face
  useEffect(() => {
    document.fonts.load('400 72px "Bebas Neue"').then(() => document.fonts.ready).then(() => setFontReady(true));
  }, []);

  // Generate all flyers when data/config changes
  const generateAll = useCallback(async () => {
    if (!fontReady) return;
    const slotsWithDjs = slots.filter(s => s.slot7 || s.slot8 || s.slot9);
    if (slotsWithDjs.length === 0) return;
    setGenerating(true);
    const urls: Record<string, string> = {};
    for (const slot of slotsWithDjs) {
      urls[slot.eventId] = await generateDataUrl(slot, bgImage, config);
    }
    setFlyerUrls(urls);
    setGenerating(false);
  }, [slots, bgImage, config, fontReady]);

  useEffect(() => {
    generateAll();
  }, [generateAll]);

  const handleBgUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const img = new Image();
      img.onload = () => setBgImage(img);
      img.src = ev.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  const downloadFlyer = (slot: RadioSlot) => {
    const url = flyerUrls[slot.eventId];
    if (!url) return;
    downloadDataUrl(url, `blackroom-${slot.dateStr.replace(/\s+/g, "-")}.png`);
  };

  const openFlyer = (slot: RadioSlot) => {
    const url = flyerUrls[slot.eventId];
    if (!url) return;
    setPreviewUrl(url);
    setPreviewTitle(slot.eventTitle || slot.dateStr);
    setPreviewFilename(`blackroom-${slot.dateStr.replace(/\s+/g, "-")}.png`);
  };

  const openDemo = async () => {
    const demoSlot: RadioSlot = {
      eventId: "demo",
      date: "2026-06-18T16:00:00-04:00",
      dateStr: "jueves 18 de junio",
      weekday: "THURSDAY",
      dayNumber: 18,
      ordinalDay: "18TH",
      slot7: "DANIØ",
      slot8: "INSTEAD OF SEVEN",
      slot9: "N1T0",
    };
    setGenerating(true);
    const url = await generateDataUrl(demoSlot, bgImage, config);
    setGenerating(false);
    setFlyerUrls(prev => ({ ...prev, demo: url }));
    setPreviewUrl(url);
    setPreviewTitle("Ejemplo con 3 DJs");
    setPreviewFilename("blackroom-demo-3-djs.png");
  };

  const syncAndRegenerate = async () => {
    setGenerating(true);
    try {
      await fetch("/api/calendar/sync", { method: "POST" });
      await queryClient.invalidateQueries({ queryKey: ["/api/radio/slots"] });
      // generateAll runs via useEffect on slots change
    } finally {
      setGenerating(false);
    }
  };

  const slotsWithDjs  = slots.filter(s => s.slot7 || s.slot8 || s.slot9);
  const slotsEmpty    = slots.filter(s => !s.slot7 && !s.slot8 && !s.slot9);

  return (
    <Card className="bg-zinc-900 border-zinc-800">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-zinc-400">
          <ImageIcon className="h-5 w-5" />
          Flyers por evento
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">

        {/* Global controls */}
        <div className="flex items-center gap-3">
          <Label className="text-xs text-zinc-400">Formato</Label>
          <div className="flex gap-1">
            {(["flyer", "story", "post"] as const).map(f => (
              <button key={f} onClick={() => setConfig(p => ({ ...p, format: f }))}
                className={`px-3 py-1 text-xs rounded border ${config.format === f ? "bg-zinc-900/30 border-zinc-700 text-zinc-400" : "bg-zinc-800 border-zinc-700 text-zinc-400"}`}
                data-testid={`format-${f}`}
              >
                {f === "flyer" ? "Flyer 2:3" : f === "story" ? "Story 9:16" : "Post 4:5"}
              </button>
            ))}
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={syncAndRegenerate} disabled={generating}
            className="border-zinc-700 text-zinc-400 hover:text-white" data-testid="flyer-sync-button">
            <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${generating ? "animate-spin" : ""}`} />
            Sincronizar y regenerar
          </Button>
          <Button size="sm" variant="outline" onClick={openDemo} disabled={generating}
            className="border-zinc-700 text-zinc-400 hover:text-white" data-testid="flyer-demo-button">
            <Eye className="h-3.5 w-3.5 mr-1.5" />
            Ver ejemplo con 3 DJs
          </Button>
          <label className="cursor-pointer">
            <input ref={fileInputRef} type="file" accept="image/*" onChange={handleBgUpload} className="hidden" />
            <div onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-md border border-zinc-700 text-zinc-400 hover:text-white cursor-pointer">
              <ImageIcon className="h-3 w-3" />
              Cambiar fondo
            </div>
          </label>
        </div>

        {previewUrl && (
          <div className="rounded-lg border border-zinc-700 bg-zinc-950/70 p-3" data-testid="flyer-preview-panel">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-white">{previewTitle}</p>
                <p className="text-xs text-zinc-500">Vista previa generada dentro de la app</p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  onClick={() => downloadDataUrl(previewUrl, previewFilename)}
                  className="h-8 bg-zinc-800 hover:bg-zinc-700"
                  data-testid="download-preview-flyer"
                >
                  <Download className="h-3.5 w-3.5 mr-1" />
                  PNG
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => setPreviewUrl(null)}
                  className="h-8 w-8 text-zinc-400 hover:text-white"
                  data-testid="close-flyer-preview"
                  aria-label="Cerrar vista previa"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <div className="mx-auto max-w-[280px] overflow-hidden rounded-md border border-zinc-800 bg-black">
              <img src={previewUrl} alt={previewTitle} className="block w-full" />
            </div>
          </div>
        )}

        {/* Events with DJs → flyers */}
        {slotsWithDjs.length === 0 && !generating && (
          <div className="text-center py-6 text-zinc-500 text-sm">
            <CalendarCheck className="h-7 w-7 mx-auto mb-2 opacity-30" />
            {slots.length === 0 ? (
              <>
                No encontré eventos de Radio todavía.
                <br />
                <span className="text-xs">Sincroniza el calendario y usa títulos con Radio o Black Room.</span>
              </>
            ) : (
              <>
                Encontré eventos, pero no hay DJs parseables en la descripción.
                <br />
                <span className="text-xs">Ejemplo: 7: DJ A, 8pm: DJ B, 9:00 PM - DJ C.</span>
              </>
            )}
          </div>
        )}

        <div className="space-y-3">
          {slotsWithDjs.map(slot => {
            const url = flyerUrls[slot.eventId];
            return (
              <div key={slot.eventId}
                className="flex gap-3 items-start p-3 bg-zinc-800/50 rounded-lg border border-zinc-700"
                data-testid={`flyer-event-${slot.eventId}`}
              >
                {/* Thumbnail */}
                <div className="flex-shrink-0 w-16 rounded overflow-hidden border border-zinc-700 bg-zinc-950"
                  style={{ aspectRatio: config.format === "flyer" ? "2/3" : config.format === "story" ? "9/16" : "4/5" }}>
                  {url ? (
                    <img src={url} alt={slot.dateStr} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      {generating ? (
                        <RefreshCw className="h-4 w-4 text-zinc-600 animate-spin" />
                      ) : (
                        <ImageIcon className="h-4 w-4 text-zinc-700" />
                      )}
                    </div>
                  )}
                </div>

                {/* Info + download */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white capitalize">{slot.dateStr}</p>
                  <div className="mt-1 space-y-0.5 text-xs">
                    {slot.slot7 && <p className="text-zinc-300"><span className="text-zinc-400 mr-1">7pm</span>{slot.slot7}</p>}
                    {slot.slot8 && <p className="text-zinc-300"><span className="text-zinc-400 mr-1">8pm</span>{slot.slot8}</p>}
                    {slot.slot9 && <p className="text-zinc-300"><span className="text-zinc-400 mr-1">9pm</span>{slot.slot9}</p>}
                  </div>
                </div>

                <div className="flex flex-col gap-1">
                  <Button
                    size="sm"
                    onClick={() => openFlyer(slot)}
                    disabled={!url || generating}
                    className="flex-shrink-0 bg-zinc-700 hover:bg-zinc-600 h-8 px-3"
                    data-testid={`view-flyer-${slot.eventId}`}
                  >
                    <Eye className="h-3.5 w-3.5 mr-1" />
                    Ver
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => downloadFlyer(slot)}
                    disabled={!url || generating}
                    className="flex-shrink-0 bg-zinc-800 hover:bg-zinc-800 h-8 px-3"
                    data-testid={`download-flyer-${slot.eventId}`}
                  >
                    <Download className="h-3.5 w-3.5 mr-1" />
                    PNG
                  </Button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Events without DJs */}
        {slotsEmpty.length > 0 && (
          <div className="space-y-1">
            <p className="text-xs text-zinc-600 flex items-center gap-1">
              <Users className="h-3 w-3" />
              Sin DJs confirmados ({slotsEmpty.length} eventos)
            </p>
            <div className="space-y-2">
              {slotsEmpty.map(s => (
                <div key={s.eventId} className="rounded-md border border-zinc-800 bg-zinc-950/50 p-2 text-xs text-zinc-500">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className="text-zinc-500 border-zinc-700 text-xs capitalize">
                      {s.dateStr}
                    </Badge>
                    {s.eventTitle && <span className="text-zinc-400">{s.eventTitle}</span>}
                  </div>
                  <p className="mt-1">
                    {s.rawDescription
                      ? "La descripción existe, pero no tiene slots 7/8/9 en un formato reconocido."
                      : "Este evento no tiene descripción para sacar los nombres."}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
