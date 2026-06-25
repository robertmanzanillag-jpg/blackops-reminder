import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

const socialPlatformSchema = z.enum(["instagram", "tiktok", "youtube", "facebook", "linkedin", "x", "pinterest", "other"]);
type SocialPlatform = z.infer<typeof socialPlatformSchema>;

export const instagramAccountInputSchema = z.object({
  handle: z.string().trim().min(1).max(120),
  url: z.string().trim().max(300).optional().default(""),
  platform: socialPlatformSchema.optional(),
  notes: z.string().trim().max(4000).optional().default(""),
});

export const instagramCampaignStudySchema = z.object({
  brandName: z.string().trim().min(1).max(120),
  businessType: z.string().trim().max(160).optional().default(""),
  targetAudience: z.string().trim().max(300).optional().default(""),
  goal: z.string().trim().max(500).optional().default("Crear una cuenta propia inspirada por referencias, sin copiar literal."),
  accounts: z.array(instagramAccountInputSchema).min(3).max(12),
});

type InstagramCampaignStudyInput = z.infer<typeof instagramCampaignStudySchema>;
type InstagramAccountProfile = {
  platform: SocialPlatform;
  handle: string;
  url: string;
  notes: string;
  researchStatus: "needs_manual_review" | "notes_supplied";
  likelySignals: string[];
  platformFocus: string[];
  missingEvidence: string[];
};

type InstagramCampaignStudy = {
  id: string;
  createdAt: string;
  brandName: string;
  businessType: string;
  targetAudience: string;
  goal: string;
  accounts: InstagramAccountProfile[];
  analysisAxes: Array<{ id: string; label: string; whatToCapture: string[] }>;
  sharedPatterns: string[];
  ownableStrategy: {
    positioning: string;
    contentPillars: string[];
    visualRules: string[];
    approvalRules: string[];
  };
  platformPlans: Array<{
    platform: SocialPlatform;
    goal: string;
    formats: string[];
    dataToCapture: string[];
    campaignAngles: string[];
    postingRhythm: string;
  }>;
  photoDirections: Array<{ id: string; name: string; shotList: string[]; productionNotes: string[] }>;
  campaignBlueprints: Array<{ id: string; name: string; posts: string[]; reels: string[]; ctas: string[] }>;
  promptPack: Array<{ id: string; useFor: string; prompt: string }>;
  nextInputsNeeded: string[];
  safetyCheck: string[];
};

const analysisAxes = [
  {
    id: "visual-system",
    label: "Sistema visual",
    whatToCapture: ["colores dominantes", "fondos", "iluminacion", "encuadres", "nivel de edicion", "texto en pantalla"],
  },
  {
    id: "content-mix",
    label: "Mix de contenido",
    whatToCapture: ["fotos producto/servicio", "lifestyle", "antes/despues", "testimonios", "educativo", "ofertas", "lives", "shorts"],
  },
  {
    id: "campaigns",
    label: "Campanas",
    whatToCapture: ["promos repetidas", "temporadas", "series", "launches", "giveaways", "urgencia y CTA"],
  },
  {
    id: "reels",
    label: "Video corto",
    whatToCapture: ["hook inicial", "duracion", "ritmo", "voiceover", "texto", "transiciones", "final/loop", "retencion", "watch time"],
  },
  {
    id: "copy",
    label: "Copy y captions",
    whatToCapture: ["tono", "estructura", "hashtags", "CTA", "preguntas", "prueba social"],
  },
];

let studiesPathOverride: string | null = null;
let loaded = false;
const studies: InstagramCampaignStudy[] = [];

const accountProfileSchema = z.object({
  platform: socialPlatformSchema.default("instagram"),
  handle: z.string(),
  url: z.string(),
  notes: z.string(),
  researchStatus: z.enum(["needs_manual_review", "notes_supplied"]),
  likelySignals: z.array(z.string()),
  platformFocus: z.array(z.string()).default(["grid 4:5", "reels 9:16", "stories", "highlights", "DM CTA", "saves/shares"]),
  missingEvidence: z.array(z.string()),
});

const persistedStudySchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  brandName: z.string(),
  businessType: z.string(),
  targetAudience: z.string(),
  goal: z.string(),
  accounts: z.array(accountProfileSchema),
  analysisAxes: z.array(z.object({ id: z.string(), label: z.string(), whatToCapture: z.array(z.string()) })),
  sharedPatterns: z.array(z.string()),
  ownableStrategy: z.object({
    positioning: z.string(),
    contentPillars: z.array(z.string()),
    visualRules: z.array(z.string()),
    approvalRules: z.array(z.string()),
  }),
  platformPlans: z.array(z.object({
    platform: socialPlatformSchema,
    goal: z.string(),
    formats: z.array(z.string()),
    dataToCapture: z.array(z.string()),
    campaignAngles: z.array(z.string()),
    postingRhythm: z.string(),
  })).default([]),
  photoDirections: z.array(z.object({ id: z.string(), name: z.string(), shotList: z.array(z.string()), productionNotes: z.array(z.string()) })),
  campaignBlueprints: z.array(z.object({ id: z.string(), name: z.string(), posts: z.array(z.string()), reels: z.array(z.string()), ctas: z.array(z.string()) })),
  promptPack: z.array(z.object({ id: z.string(), useFor: z.string(), prompt: z.string() })),
  nextInputsNeeded: z.array(z.string()),
  safetyCheck: z.array(z.string()),
});

function getStudiesPath() {
  return studiesPathOverride || process.env.INSTAGRAM_CAMPAIGN_LAB_PATH || path.join(process.cwd(), "marketing_command_center_data", "instagram-campaign-studies.json");
}

function loadStudies() {
  if (loaded) return;
  const filePath = getStudiesPath();
  if (!fs.existsSync(filePath)) {
    studies.splice(0, studies.length);
    loaded = true;
    return;
  }
  const raw = fs.readFileSync(filePath, "utf8");
  const parsed = z.array(persistedStudySchema).safeParse(JSON.parse(raw));
  if (!parsed.success) throw new Error("Instagram Campaign Lab data is invalid.");
  studies.splice(0, studies.length, ...parsed.data);
  loaded = true;
}

function persistStudies() {
  const filePath = getStudiesPath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(studies, null, 2)}\n`, "utf8");
}

function inferPlatform(value: string, url = ""): SocialPlatform {
  const text = `${value} ${url}`.toLowerCase();
  if (text.includes("tiktok.com") || text.startsWith("tiktok:")) return "tiktok";
  if (text.includes("youtube.com") || text.includes("youtu.be") || text.startsWith("youtube:")) return "youtube";
  if (text.includes("facebook.com") || text.includes("fb.com") || text.startsWith("facebook:")) return "facebook";
  if (text.includes("linkedin.com") || text.startsWith("linkedin:")) return "linkedin";
  if (text.includes("twitter.com") || text.includes("x.com") || text.startsWith("x:")) return "x";
  if (text.includes("pinterest.com") || text.startsWith("pinterest:")) return "pinterest";
  if (text.includes("instagram.com") || text.startsWith("instagram:") || text.startsWith("@")) return "instagram";
  return "other";
}

function cleanHandle(value: string, platform: SocialPlatform) {
  const withoutPrefix = value.trim().replace(/^(instagram|tiktok|youtube|facebook|linkedin|x|pinterest):/i, "");
  if (platform === "instagram") {
    return withoutPrefix.replace(/^https?:\/\/(www\.)?instagram\.com\//i, "").replace(/^@/, "").replace(/\/$/, "");
  }
  if (platform === "tiktok") {
    return withoutPrefix.replace(/^https?:\/\/(www\.)?tiktok\.com\//i, "").replace(/^@/, "").replace(/\/$/, "");
  }
  if (platform === "youtube") {
    return withoutPrefix.replace(/^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\//i, "").replace(/^@/, "").replace(/\/$/, "");
  }
  return withoutPrefix
    .trim()
    .replace(/^https?:\/\/(www\.)?[^/]+\//i, "")
    .replace(/^@/, "")
    .replace(/\/$/, "");
}

function defaultAccountUrl(platform: SocialPlatform, handle: string) {
  if (handle.startsWith("http")) return handle;
  if (platform === "instagram") return `https://instagram.com/${handle}`;
  if (platform === "tiktok") return `https://www.tiktok.com/@${handle}`;
  if (platform === "youtube") return `https://www.youtube.com/@${handle}`;
  if (platform === "facebook") return `https://www.facebook.com/${handle}`;
  if (platform === "linkedin") return `https://www.linkedin.com/in/${handle}`;
  if (platform === "x") return `https://x.com/${handle}`;
  if (platform === "pinterest") return `https://www.pinterest.com/${handle}`;
  return handle;
}

function platformFocus(platform: SocialPlatform) {
  const map: Record<SocialPlatform, string[]> = {
    instagram: ["grid 4:5", "reels 9:16", "stories", "highlights", "DM CTA", "saves/shares"],
    tiktok: ["hook en 1-2 segundos", "retencion", "watch time", "series", "comments", "creator-style video"],
    youtube: ["Shorts", "thumbnail/title", "retention curve", "series", "search intent", "subscribe CTA"],
    facebook: ["reels", "groups", "local proof", "event posts", "comments", "shareability"],
    linkedin: ["thought leadership", "proof posts", "document posts", "founder voice", "lead-gen CTA", "credibility"],
    x: ["threads", "short posts", "conversation hooks", "timely takes", "quote posts", "link clicks"],
    pinterest: ["pins", "boards", "search keywords", "vertical creative", "evergreen traffic", "save intent"],
    other: ["formatos nativos", "hooks", "cadencia", "CTA", "metricas disponibles", "assets propios"],
  };
  return map[platform];
}

function inferSignals(notes: string, platform: SocialPlatform) {
  const text = notes.toLowerCase();
  const signals = new Set<string>();
  if (platform === "tiktok") signals.add("priorizar hooks, retencion y video nativo tipo creador");
  if (platform === "youtube") signals.add("mapear Shorts, titulos, thumbnails y series");
  if (platform === "linkedin") signals.add("convertir prueba y expertise en autoridad");
  if (platform === "facebook") signals.add("adaptar a comunidad local, shares y eventos");
  if (text.includes("reel") || text.includes("video")) signals.add("priorizar reels y clips verticales");
  if (text.includes("tiktok") || text.includes("trend")) signals.add("detectar trends reutilizables sin copiar audio/asset protegido");
  if (text.includes("retencion") || text.includes("watch")) signals.add("medir watch time y abandono del hook");
  if (text.includes("foto") || text.includes("photo")) signals.add("estudiar composicion fotografica");
  if (text.includes("promo") || text.includes("oferta") || text.includes("campaign")) signals.add("mapear ofertas y campanas repetibles");
  if (text.includes("luxury") || text.includes("premium") || text.includes("elegante")) signals.add("mantener direccion visual premium");
  if (text.includes("testimonio") || text.includes("review")) signals.add("convertir prueba social en contenido");
  if (text.includes("before") || text.includes("antes")) signals.add("usar transformaciones antes/despues si aplica");
  return [...signals];
}

function buildAccounts(input: InstagramCampaignStudyInput): InstagramAccountProfile[] {
  return input.accounts.map((account) => {
    const platform = account.platform || inferPlatform(account.handle, account.url);
    const handle = cleanHandle(account.handle, platform);
    const notes = account.notes.trim();
    const signals = inferSignals(notes, platform);
    return {
      platform,
      handle,
      url: account.url || defaultAccountUrl(platform, handle),
      notes,
      researchStatus: notes ? "notes_supplied" : "needs_manual_review",
      likelySignals: signals.length ? signals : ["requiere captura manual de posts, videos, captions y campanas"],
      platformFocus: platformFocus(platform),
      missingEvidence: [
        "3 piezas top por cuenta",
        "3 videos top por cuenta",
        "captions representativos",
        "screenshots del perfil/feed",
        "metricas visibles: views, likes, comments, shares, saves si aplica",
        "ofertas o campanas recientes",
      ].filter((item) => !notes.toLowerCase().includes(item.split(" ")[0])),
    };
  });
}

function buildPlatformPlans(accounts: InstagramAccountProfile[], brand: string) {
  const platforms = [...new Set(accounts.map((account) => account.platform))];
  return platforms.map((platform) => {
    const focus = platformFocus(platform);
    if (platform === "tiktok") {
      return {
        platform,
        goal: `Convertir referencias de TikTok en un sistema de videos nativos para ${brand}, optimizado para retencion y comentarios.`,
        formats: ["videos 9:16", "series", "respuesta a comentarios", "POV", "demo/proceso", "trend adaptado con asset propio"],
        dataToCapture: ["views", "watch time si esta disponible", "likes", "comments", "shares", "saves", "hook usado", "duracion"],
        campaignAngles: ["problema en 2 segundos", "prueba visual", "serie educativa", "detras de camara", "oferta suave por comentario/DM"],
        postingRhythm: "3-7 videos por semana al inicio; repetir hooks ganadores con nuevo angulo visual.",
      };
    }
    if (platform === "instagram") {
      return {
        platform,
        goal: `Construir presencia visual de ${brand} con grid, Reels, Stories y DM CTA propios.`,
        formats: ["reels 9:16", "feed 4:5", "stories", "carruseles", "highlights"],
        dataToCapture: ["reach", "plays", "saves", "shares", "comments", "profile visits", "DMs", "link taps"],
        campaignAngles: ["prueba visual", "lifestyle", "oferta semanal", "testimonio", "recap", "FAQ"],
        postingRhythm: "3-5 piezas por semana con stories en dias activos y recap despues de cada campana.",
      };
    }
    if (platform === "youtube") {
      return {
        platform,
        goal: `Convertir referencias en Shorts y series buscables para ${brand}.`,
        formats: ["Shorts", "series", "thumbnail/title tests", "clips educativos", "recaps"],
        dataToCapture: ["views", "retention", "average view duration", "likes", "comments", "subscribers gained", "traffic source"],
        campaignAngles: ["busqueda/respuesta", "antes/despues", "top 3", "mito vs realidad", "demo rapido"],
        postingRhythm: "2-5 Shorts por semana con series repetibles y titulos claros.",
      };
    }
    return {
      platform,
      goal: `Adaptar referencias de ${platform} a campanas propias para ${brand}.`,
      formats: focus,
      dataToCapture: ["impresiones/views", "engagement", "comments", "shares", "clicks", "conversion signal"],
      campaignAngles: ["prueba", "educacion", "oferta", "comunidad", "autoridad", "recap"],
      postingRhythm: "Definir cadencia despues de revisar metricas y capacidad de produccion.",
    };
  });
}

function buildStudy(input: InstagramCampaignStudyInput): InstagramCampaignStudy {
  const accounts = buildAccounts(input);
  const brand = input.brandName;
  const audience = input.targetAudience || "audiencia objetivo por definir";
  const business = input.businessType || "marca/negocio por definir";
  const platforms = [...new Set(accounts.map((account) => account.platform))].join(", ");
  return {
    id: `social-study-${Date.now()}`,
    createdAt: new Date().toISOString(),
    brandName: brand,
    businessType: business,
    targetAudience: audience,
    goal: input.goal,
    accounts,
    analysisAxes,
    sharedPatterns: [
      "Comparar estructuras repetidas entre cuentas, no piezas exactas.",
      "Separar estilo visual, formato de contenido, oferta, CTA y metrica por red social para recombinar a nuestro modo.",
      "Marcar como pendiente cualquier conclusion que no tenga screenshot, caption, video note o metrica observada.",
      "Convertir cada patron en una regla propia para la marca antes de producir assets.",
    ],
    ownableStrategy: {
      positioning: `${brand} debe tomar referencias de estructura y calidad en ${platforms}, pero hablarle a ${audience} como ${business}, con prueba propia y ofertas propias.`,
      contentPillars: ["prueba visual", "educacion rapida", "detras de camara", "oferta/campana", "testimonio o resultado", "lifestyle de marca"],
      visualRules: [
        "Crear una paleta propia antes de producir.",
        "No replicar composiciones exactas, poses identificables, captions o claims de otra cuenta.",
        "Mantener templates editables para reels, carruseles, stories y promos.",
        "Documentar cada referencia como inspiracion: formato, no copia.",
      ],
      approvalRules: [
        "No publicar, pautar ni contactar cuentas externas sin aprobacion.",
        "No usar fotos, logos, videos, canciones o textos de cuentas referencia como asset final.",
        "Todo output queda en draft hasta revision humana.",
      ],
    },
    platformPlans: buildPlatformPlans(accounts, brand),
    photoDirections: [
      {
        id: "signature-grid",
        name: "Grid propio de marca",
        shotList: ["foto hero vertical 4:5", "detalle/close-up", "persona usando producto/servicio", "ambiente/lifestyle", "resultado o prueba social"],
        productionNotes: ["usar luz consistente", "dejar espacio para texto corto", "tomar versiones 4:5 y 9:16", "nombrar archivos por campana"],
      },
      {
        id: "campaign-assets",
        name: "Assets por campana",
        shotList: ["portada de promo", "story con CTA", "reel hook frame", "foto detalle para carrusel", "recap o prueba posterior"],
        productionNotes: ["crear paquete minimo por campana", "mantener CTA claro", "preparar variaciones A/B de hook visual"],
      },
      {
        id: "trust-proof",
        name: "Prueba y confianza",
        shotList: ["testimonio visual", "antes/despues si aplica", "equipo/proceso", "empaque o entrega", "FAQ visual"],
        productionNotes: ["evitar claims no comprobados", "usar lenguaje claro", "guardar evidencia de permiso para testimonios"],
      },
    ],
    campaignBlueprints: [
      {
        id: "reference-remix-sprint",
        name: "Sprint referencia a nuestro modo",
        posts: ["post ADN visual propio", "carrusel de objeciones", "post oferta con prueba", "recap/testimonio"],
        reels: ["hook problema-solucion", "behind the scenes", "3 razones para elegirnos", "resultado en 7 segundos"],
        ctas: ["DM para info", "Reserva hoy", "Ver opciones", "Pide cotizacion", "Guarda esto"],
      },
      {
        id: "weekly-proof-loop",
        name: "Loop semanal de prueba",
        posts: ["lunes: educacion", "miercoles: prueba visual", "viernes: oferta", "domingo: recap/aprendizaje"],
        reels: ["hook corto", "demo", "respuesta a objecion", "social proof"],
        ctas: ["Comenta", "Escribenos", "Comparte", "Agenda"],
      },
    ],
    promptPack: [
      {
        id: "photo-brief",
        useFor: "Generar o dirigir fotos",
        prompt: `Crear una direccion fotografica original para ${brand}, ${business}, dirigida a ${audience}. Inspirarse solo en patrones generales de las cuentas referencia; no copiar composiciones, textos, logos ni assets. Entregar shot list 4:5 y 9:16, iluminacion, fondos, props y notas de edicion.`,
      },
      {
        id: "campaign-brief",
        useFor: "Crear campana mensual multi-red",
        prompt: `Disenar una campana para ${brand} en estas redes: ${platforms}. Crear 4 semanas de piezas nativas por plataforma, con hooks, captions, CTAs, formatos y metricas. Usar las referencias como benchmark de calidad, pero crear conceptos, captions, visuales y ofertas propias.`,
      },
      {
        id: "platform-adapter",
        useFor: "Adaptar una idea por red",
        prompt: `Tomar una idea central de campana para ${brand} y convertirla en versiones nativas para ${platforms}: TikTok/Shorts con hook y retencion, Instagram con Reel/feed/story, y otras redes segun formato. No copiar trends, audios, captions ni assets de cuentas referencia.`,
      },
      {
        id: "originality-check",
        useFor: "Revisar que no sea copia",
        prompt: "Revisar cada pieza propuesta y marcar cualquier elemento demasiado parecido a una cuenta referencia: composicion, pose, frase, oferta, color dominante, formato exacto o asset protegido. Proponer alternativa propia.",
      },
    ],
    nextInputsNeeded: [
      "Pegar links de 3 o mas cuentas de cualquier red social.",
      "Agregar screenshots o notas de posts/videos/reels/shorts favoritos.",
      "Definir negocio, audiencia, oferta principal y tono de marca.",
      "Agregar metricas visibles o capturas de analytics cuando existan.",
      "Subir fotos propias o referencias internas antes de producir piezas finales.",
    ],
    safetyCheck: [
      "Inspiracion permitida: estrategia, formato, cadencia, calidad, tipos de tomas.",
      "No permitido: copiar fotos, captions, logos, videos, identidad visual exacta, claims o assets.",
      "La extraccion directa de redes sociales requiere permisos/API o trabajo manual; esta version no scrapea cuentas.",
      "Publicacion, ads y contacto externo quedan bloqueados hasta aprobacion.",
    ],
  };
}

export function getInstagramCampaignLabSnapshot() {
  loadStudies();
  return {
    generatedAt: new Date().toISOString(),
    status: "ready",
    minimumAccounts: 3,
    maxAccountsPerStudy: 12,
    supportedPlatforms: socialPlatformSchema.options,
    studies: [...studies].slice(-12).reverse(),
    latestStudy: studies.at(-1) || null,
    workflow: [
      "Pegar 3 o mas cuentas de IG, TikTok, YouTube Shorts u otra red con notas o screenshots.",
      "Extraer ADN visual, video, campanas, copy, CTAs y metricas visibles por plataforma.",
      "Traducir patrones a reglas propias de la marca por red social.",
      "Producir shot lists, campanas, prompts y formatos nativos.",
      "Revisar originalidad y permisos antes de publicar.",
    ],
    installedStack: [
      { name: "Codex Creative Production", status: "available", useFor: "moodboards, scenes, ads, offers, shot exploration" },
      { name: "Codex imagegen", status: "available", useFor: "generar fotos/visuals originales desde prompts" },
      { name: "Canva", status: "available", useFor: "diseños editables y piezas finales" },
      { name: "Google Drive/Sheets", status: "available", useFor: "guardar referencias, calendarios y reportes" },
      { name: "Claude CLI/skills", status: "not_detected_in_this_session", useFor: "pendiente de instalar o confirmar fuera de Codex" },
    ],
  };
}

export function createInstagramCampaignStudy(input: unknown) {
  const parsed = instagramCampaignStudySchema.parse(input);
  loadStudies();
  const study = buildStudy(parsed);
  studies.push(study);
  persistStudies();
  return { status: "created" as const, study, snapshot: getInstagramCampaignLabSnapshot() };
}

export function setInstagramCampaignLabPathForTests(value: string | null) {
  studiesPathOverride = value;
}

export function resetInstagramCampaignLabForTests() {
  loaded = false;
  studies.splice(0, studies.length);
}
