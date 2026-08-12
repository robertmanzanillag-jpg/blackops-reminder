import { useState, useRef, useEffect, useCallback } from "react";
import { Download, ImageIcon, RefreshCw, CalendarCheck, Users, Eye } from "lucide-react";
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
  city: "miami" | "berlin" | "buenos_aires";
  timezone: string;
  lineup: Array<{ hour: number; label: string; djName: string | null }>;
  timezoneLines: string[];
  weekday?: string;
  ordinalDay?: string;
  emptySlots?: number[];
}

interface GlobalConfig {
  format: "story" | "post";
}

const BACKGROUND_URLS: Record<RadioSlot["city"], string> = {
  miami: "/radio-flyers/miami.png?v=calendar-v1",
  berlin: "/radio-flyers/berlin.png?v=calendar-v1",
  buenos_aires: "/radio-flyers/buenos-aires.png?v=calendar-v1",
};

// ─── Canvas rendering ────────────────────────────────────────────────────────

const COLORS = {
  bg: "#030303",
  white: "#E6E6E6",
  red: "#8B0000",
  redVivid: "#B00000",
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

function renderToCanvas(
  canvas: HTMLCanvasElement,
  bgImage: HTMLImageElement | null,
  slot: RadioSlot,
  config: GlobalConfig
): void {
  const isStory = config.format === "story";
  const W = 1080;
  const H = isStory ? 1920 : 1350;
  canvas.width = W;
  canvas.height = H;

  // Scale helper: all coords designed for 1920h, scaled down for post
  const R = H / 1920;
  const sc = (v: number) => Math.round(v * R);
  const isMiami = slot.city === "miami";

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

  // ── Calendar-controlled weekday, day number and ordinal suffix.
  const dayNum = slot.dateStr.match(/\d+/)?.[0] ?? "";
  if (dayNum) {
    const dateX = sc(isMiami ? 48 : 68);
    const dateY = sc(isMiami ? 1360 : 1432);
    const dateBaseline = dateY + sc(70);
    const dateFontSz = sc(isMiami ? 66 : 58);
    const supSz = sc(isMiami ? 32 : 28);
    const weekday = (slot.weekday || "THURSDAY").toUpperCase();
    const ordinal = slot.ordinalDay || `${dayNum}TH`;
    const suffix = ordinal.replace(/^\d+/, "") || "TH";

    ctx.fillStyle = "#030303";
    ctx.fillRect(dateX - sc(12), dateY - sc(16), sc(420), sc(112));

    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = COLORS.white;
    ctx.shadowColor = "rgba(0,0,0,0.9)";
    ctx.shadowBlur = sc(8);
    ctx.shadowOffsetX = sc(2);
    ctx.shadowOffsetY = sc(2);

    ctx.font = `normal ${dateFontSz}px "Bebas Neue", Arial`;
    (ctx as any).letterSpacing = `${(60 / 1000) * dateFontSz}px`;
    ctx.fillText(`${weekday} ${dayNum}`, dateX, dateBaseline);

    const baseText = `${weekday} ${dayNum}`;
    const numW = ctx.measureText(baseText).width + (60 / 1000) * dateFontSz * baseText.length;
    ctx.font = `normal ${supSz}px "Bebas Neue", Arial`;
    (ctx as any).letterSpacing = `${(80 / 1000) * supSz}px`;
    ctx.fillText(suffix, dateX + numW + sc(3), dateBaseline - sc(34));

    ctx.shadowBlur = 0;
    ctx.shadowColor = "transparent";
  }

  // ── Calendar-controlled timezone lines for Berlin and Buenos Aires.
  if (!isMiami && slot.timezoneLines?.length) {
    const blockX = sc(68);
    const blockY = sc(1518);
    const lineHeight = sc(42);
    ctx.fillStyle = "#030303";
    ctx.fillRect(blockX - sc(8), blockY - sc(10), sc(430), sc(112));
    ctx.fillStyle = COLORS.redVivid;
    ctx.font = `normal ${sc(30)}px "Bebas Neue", Arial`;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    (ctx as any).letterSpacing = `${sc(2)}px`;
    slot.timezoneLines.slice(0, 2).forEach((line, index) => {
      ctx.fillText(line.toUpperCase(), blockX, blockY + index * lineHeight);
    });
  }

  // ── DJ names: right of "7:00 PM / 8:00 PM / 9:00 PM" baked into template.
  // rowYs shifted down — sc(938) was at LINE UP header, actual time rows start lower.
  const nameX = sc(isMiami ? 300 : 210);
  const djFontSz = sc(isMiami ? 76 : 45);
  // rowYs measured from template: red-pixel cluster baselines at canvas y 1054/1163/1272
  const rowYs = isMiami
    ? [sc(1054), sc(1163), sc(1272)]
    : [sc(1160), sc(1238), sc(1316), sc(1394)];
  const djSlots = (slot.lineup?.length ? slot.lineup : [
    { hour: 7, label: "7:00 PM", djName: slot.slot7 },
    { hour: 8, label: "8:00 PM", djName: slot.slot8 },
    { hour: 9, label: "9:00 PM", djName: slot.slot9 },
  ]).map((entry) => entry.djName);

  for (let i = 0; i < Math.min(djSlots.length, rowYs.length); i++) {
    if (!djSlots[i]) continue;
    const name = djSlots[i]!.toUpperCase();
    const maxW = W - nameX - sc(40);

    // Auto-shrink if name is too long
    let nameSz = djFontSz;
    ctx.font = `normal ${nameSz}px "Bebas Neue", Arial`;
    (ctx as any).letterSpacing = `${(150 / 1000) * nameSz}px`;
    while (ctx.measureText(name).width > maxW && nameSz > sc(32)) {
      nameSz -= sc(3);
      ctx.font = `normal ${nameSz}px "Bebas Neue", Arial`;
      (ctx as any).letterSpacing = `${(150 / 1000) * nameSz}px`;
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
  await document.fonts.load('900 72px "Bebas Neue"').catch(() => {});
  await document.fonts.load('normal 72px "Bebas Neue"').catch(() => {});
  const canvas = document.createElement("canvas");
  renderToCanvas(canvas, bgImage, slot, config);
  return canvas.toDataURL("image/png");
}

// ─── Component ───────────────────────────────────────────────────────────────

export function FlyerGenerator({ slots }: { slots: RadioSlot[] }) {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [bgImages, setBgImages] = useState<Partial<Record<RadioSlot["city"], HTMLImageElement>>>({});
  const [bgLoaded, setBgLoaded] = useState(false);
  const [fontReady, setFontReady] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [flyerUrls, setFlyerUrls] = useState<Record<string, string>>({});
  const [config, setConfig] = useState<GlobalConfig>({ format: "story" });

  // Load the approved city templates. Calendar event titles select the city.
  useEffect(() => {
    let remaining = Object.keys(BACKGROUND_URLS).length;
    const loaded: Partial<Record<RadioSlot["city"], HTMLImageElement>> = {};
    for (const [city, src] of Object.entries(BACKGROUND_URLS) as Array<[RadioSlot["city"], string]>) {
      const img = new Image();
      img.crossOrigin = "anonymous";
      const finish = () => {
        remaining -= 1;
        if (remaining === 0) {
          setBgImages(loaded);
          setBgLoaded(true);
        }
      };
      img.onload = () => { loaded[city] = img; finish(); };
      img.onerror = finish;
      img.src = src;
    }
  }, []);

  // Font ready — wait for Bebas Neue explicitly so canvas uses the correct face
  useEffect(() => {
    document.fonts.load('72px "Bebas Neue"').then(() => setFontReady(true));
  }, []);

  // Generate all flyers when data/config changes
  const generateAll = useCallback(async () => {
    if (!fontReady || !bgLoaded) return;
    const slotsWithDjs = slots.filter(s => s.lineup?.some((entry) => entry.djName) || s.slot7 || s.slot8 || s.slot9);
    if (slotsWithDjs.length === 0) return;
    setGenerating(true);
    const urls: Record<string, string> = {};
    for (const slot of slotsWithDjs) {
      urls[slot.eventId] = await generateDataUrl(slot, bgImages[slot.city] || null, config);
    }
    setFlyerUrls(urls);
    setGenerating(false);
  }, [slots, bgImages, config, fontReady, bgLoaded]);

  useEffect(() => {
    generateAll();
  }, [generateAll]);

  const handleBgUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const img = new Image();
      img.onload = () => {
        setBgImages((current) => ({ ...current, miami: img, berlin: img, buenos_aires: img }));
        setBgLoaded(true);
      };
      img.src = ev.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  const downloadFlyer = (slot: RadioSlot) => {
    const url = flyerUrls[slot.eventId];
    if (!url) return;
    const a = document.createElement("a");
    a.href = url;
    a.download = `blackroom-${slot.dateStr.replace(/\s+/g, "-")}.png`;
    a.click();
  };

  const openFlyer = (eventId: string) => {
    const url = flyerUrls[eventId];
    if (!url) return;
    window.open(url, "_blank");
  };

  const openDemo = async () => {
    const demoSlot: RadioSlot = {
      eventId: "demo",
      date: new Date().toISOString(),
      dateStr: "jueves 19 de junio",
      city: "buenos_aires",
      timezone: "America/Argentina/Buenos_Aires",
      lineup: [
        { hour: 4, label: "4:00 PM", djName: "ZAMURAI" },
        { hour: 5, label: "5:00 PM", djName: "DANIØ" },
        { hour: 6, label: "6:00 PM", djName: "INSTEAD OF SEVEN" },
        { hour: 7, label: "7:00 PM", djName: "N1T0" },
      ],
      timezoneLines: ["4PM ART [BUENOS AIRES]", "3PM ET [MIAMI]"],
      ordinalDay: "19TH",
      slot7: "N1T0",
      slot8: null,
      slot9: null,
    };
    setGenerating(true);
    const url = await generateDataUrl(demoSlot, bgImages.buenos_aires || null, config);
    setGenerating(false);
    window.open(url, "_blank");
  };

  const syncAndRegenerate = async () => {
    setGenerating(true);
    await fetch("/api/calendar/sync", { method: "POST" });
    await queryClient.invalidateQueries({ queryKey: ["/api/radio/slots"] });
    // generateAll runs via useEffect on slots change
  };

  const slotsWithDjs  = slots.filter(s => s.lineup?.some((entry) => entry.djName) || s.slot7 || s.slot8 || s.slot9);
  const slotsEmpty    = slots.filter(s => !s.lineup?.some((entry) => entry.djName) && !s.slot7 && !s.slot8 && !s.slot9);

  return (
    <Card className="bg-zinc-900 border-zinc-800">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-purple-400">
          <ImageIcon className="h-5 w-5" />
          Flyers por evento
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">

        {/* Global controls */}
        <div className="flex items-center gap-3">
          <Label className="text-xs text-zinc-400">Formato</Label>
          <div className="flex gap-1">
            {(["story", "post"] as const).map(f => (
              <button key={f} onClick={() => setConfig(p => ({ ...p, format: f }))}
                className={`px-3 py-1 text-xs rounded border ${config.format === f ? "bg-purple-600/30 border-purple-500 text-purple-300" : "bg-zinc-800 border-zinc-700 text-zinc-400"}`}
                data-testid={`format-${f}`}
              >
                {f === "story" ? "Story 9:16" : "Post 4:5"}
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
            className="border-purple-700 text-purple-400 hover:text-purple-300" data-testid="flyer-demo-button">
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

        {/* Events with DJs → flyers */}
        {slotsWithDjs.length === 0 && !generating && (
          <div className="text-center py-6 text-zinc-600 text-sm">
            <CalendarCheck className="h-7 w-7 mx-auto mb-2 opacity-30" />
            No hay DJs confirmados en el calendario aún.
            <br />
            <span className="text-xs">Sincroniza el calendario para traer los datos.</span>
          </div>
        )}

        <div className="space-y-3">
          {slotsWithDjs.map(slot => {
            const url = flyerUrls[slot.eventId];
            const hasDj = slot.lineup?.some((entry) => entry.djName) || slot.slot7 || slot.slot8 || slot.slot9;
            return (
              <div key={slot.eventId}
                className="flex gap-3 items-start p-3 bg-zinc-800/50 rounded-lg border border-zinc-700"
                data-testid={`flyer-event-${slot.eventId}`}
              >
                {/* Thumbnail */}
                <div className="flex-shrink-0 w-16 rounded overflow-hidden border border-zinc-700 bg-zinc-950"
                  style={{ aspectRatio: config.format === "story" ? "9/16" : "4/5" }}>
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
                    {slot.lineup?.filter((entry) => entry.djName).map((entry) => (
                      <p key={entry.hour} className="text-zinc-300"><span className="text-red-500 mr-1">{entry.hour}pm</span>{entry.djName}</p>
                    ))}
                  </div>
                </div>

                <div className="flex flex-col gap-1">
                  <Button
                    size="sm"
                    onClick={() => openFlyer(slot.eventId)}
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
                    className="flex-shrink-0 bg-purple-600 hover:bg-purple-700 h-8 px-3"
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
            <div className="flex flex-wrap gap-2">
              {slotsEmpty.map(s => (
                <Badge key={s.eventId} variant="outline"
                  className="text-zinc-500 border-zinc-700 text-xs capitalize">
                  {s.dateStr}
                </Badge>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
