import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Clock3, ExternalLink, Globe2, MapPin, RefreshCw } from "lucide-react";
import { useLocation, useSearch } from "wouter";

type NewsLanguage = "en" | "es";
type NewsCity = "miami" | "new-york";

type PublicNewsArticle = {
  slug: string;
  city: NewsCity;
  lane?: string;
  lang: NewsLanguage;
  title: string;
  summary: string;
  body: string;
  source: string;
  sourceUrl: string;
  publishedAt: string;
  category?: string;
  location?: string;
  lifecycle?: string;
};

type PublicNewsFeed = {
  updatedAt: string;
  lang: NewsLanguage;
  city: NewsCity | "";
  articles: PublicNewsArticle[];
};

type Copy = {
  independent: string;
  live: string;
  latest: string;
  miami: string;
  newYork: string;
  allNews: string;
  readStory: string;
  source: string;
  updated: string;
  published: string;
  refreshing: string;
  loading: string;
  errorTitle: string;
  errorBody: string;
  retry: string;
  emptyTitle: string;
  emptyBody: string;
  back: string;
  notFoundTitle: string;
  notFoundBody: string;
  disclaimer: string;
  skip: string;
};

const COPY: Record<NewsLanguage, Copy> = {
  en: {
    independent: "Independent local news desk",
    live: "Live local brief",
    latest: "Today across Miami & New York",
    miami: "Miami",
    newYork: "New York",
    allNews: "All news",
    readStory: "Read full update",
    source: "Original source",
    updated: "Desk updated",
    published: "Published",
    refreshing: "Refreshing",
    loading: "Loading the latest local updates",
    errorTitle: "The local feed is temporarily unavailable",
    errorBody: "We could not retrieve the verified updates. Please try again in a moment.",
    retry: "Try again",
    emptyTitle: "No current updates in this edition",
    emptyBody: "The desk is monitoring verified public sources. New items will appear here automatically.",
    back: "Back to today’s news",
    notFoundTitle: "This update is no longer available",
    notFoundBody: "It may have expired or been replaced by a newer verified update.",
    disclaimer: "Metro Current is an independent publication and is not affiliated with any city, police department, transit agency, 511 service, or government office. Follow the linked source for official instructions.",
    skip: "Skip to news",
  },
  es: {
    independent: "Mesa local independiente",
    live: "Resumen local en vivo",
    latest: "Hoy en Miami y Nueva York",
    miami: "Miami",
    newYork: "Nueva York",
    allNews: "Todas las noticias",
    readStory: "Leer actualización completa",
    source: "Fuente original",
    updated: "Mesa actualizada",
    published: "Publicado",
    refreshing: "Actualizando",
    loading: "Cargando las últimas actualizaciones locales",
    errorTitle: "El servicio local no está disponible temporalmente",
    errorBody: "No pudimos recuperar las actualizaciones verificadas. Inténtalo de nuevo en un momento.",
    retry: "Intentar de nuevo",
    emptyTitle: "No hay actualizaciones vigentes en esta edición",
    emptyBody: "La mesa está monitoreando fuentes públicas verificadas. Las noticias nuevas aparecerán automáticamente.",
    back: "Volver a las noticias de hoy",
    notFoundTitle: "Esta actualización ya no está disponible",
    notFoundBody: "Puede haber vencido o haber sido reemplazada por una actualización verificada más reciente.",
    disclaimer: "Metro Current es una publicación independiente y no está afiliada con ninguna ciudad, policía, agencia de tránsito, servicio 511 u oficina gubernamental. Sigue la fuente enlazada para instrucciones oficiales.",
    skip: "Ir a las noticias",
  },
};

const CITY_META: Record<NewsCity, { name: Record<NewsLanguage, string>; logo: string; accent: string }> = {
  miami: {
    name: { en: "Miami", es: "Miami" },
    logo: "/local-news/miami-news-profile.png",
    accent: "bg-[#e35d44]",
  },
  "new-york": {
    name: { en: "New York", es: "Nueva York" },
    logo: "/local-news/ny-news-profile.png",
    accent: "bg-[#17395c]",
  },
};

function isLanguage(value: string | null): value is NewsLanguage {
  return value === "en" || value === "es";
}

function resolveLanguage(search?: string): NewsLanguage {
  if (typeof window === "undefined") return "en";
  const queryLanguage = new URLSearchParams(search ?? window.location.search).get("lang");
  if (isLanguage(queryLanguage)) return queryLanguage;
  const saved = window.localStorage.getItem("metro-current-language");
  if (isLanguage(saved)) return saved;
  return window.navigator.language.toLowerCase().startsWith("es") ? "es" : "en";
}

function normalizeCity(value: unknown): NewsCity {
  const normalized = String(value || "").toLowerCase();
  return normalized === "new-york" || normalized === "new_york" || normalized === "ny" || normalized === "ny-news"
    ? "new-york"
    : "miami";
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

function publicSourceUrl(value: unknown): string {
  const candidate = text(value);
  if (!candidate) return "";
  try {
    const url = new URL(candidate);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : "";
  } catch {
    return "";
  }
}

function normalizeArticle(value: unknown, fallbackLanguage: NewsLanguage): PublicNewsArticle | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const translations = raw.translations && typeof raw.translations === "object"
    ? raw.translations as Record<string, unknown>
    : {};
  const translated = translations[fallbackLanguage] && typeof translations[fallbackLanguage] === "object"
    ? translations[fallbackLanguage] as Record<string, unknown>
    : {};
  const title = text(translated.title, text(raw.title));
  const slug = text(raw.slug, text(raw.id));
  if (!slug || !title) return null;
  const sourceObject = raw.source && typeof raw.source === "object" ? raw.source as Record<string, unknown> : null;
  const source = sourceObject ? text(sourceObject.name, text(sourceObject.label, "Verified public source")) : text(raw.source, "Verified public source");
  const sourceUrl = publicSourceUrl(sourceObject ? text(sourceObject.url, text(raw.sourceUrl)) : raw.sourceUrl);

  return {
    slug,
    city: normalizeCity(raw.city ?? raw.lane),
    lane: text(raw.lane),
    lang: isLanguage(text(raw.lang)) ? text(raw.lang) as NewsLanguage : fallbackLanguage,
    title,
    summary: text(translated.summary, text(raw.summary, text(raw.description))),
    body: text(translated.body, text(raw.body, text(raw.summary, text(raw.description)))),
    source,
    sourceUrl,
    publishedAt: text(raw.publishedAt, text(raw.updatedAt)),
    category: text(raw.category),
    location: text(raw.location),
    lifecycle: text(raw.lifecycle),
  };
}

async function getJson(url: string): Promise<unknown> {
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`News request failed: ${response.status}`);
  return response.json();
}

function normalizeFeed(payload: unknown, language: NewsLanguage, city: NewsCity | ""): PublicNewsFeed {
  const raw = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const sourceItems = Array.isArray(raw.articles) ? raw.articles : Array.isArray(raw.items) ? raw.items : [];
  const articles = sourceItems
    .map((item) => normalizeArticle(item, language))
    .filter((item): item is PublicNewsArticle => Boolean(item));
  return {
    updatedAt: text(raw.updatedAt, new Date().toISOString()),
    lang: language,
    city,
    articles,
  };
}

function formatDate(value: string, language: NewsLanguage, includeTime = true): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(language === "es" ? "es-US" : "en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    ...(includeTime ? { hour: "numeric", minute: "2-digit" } : {}),
    timeZoneName: includeTime ? "short" : undefined,
  }).format(date);
}

function articleHref(article: PublicNewsArticle, language: NewsLanguage): string {
  return `/news/article/${encodeURIComponent(article.slug)}?lang=${language}`;
}

function cityHref(city: NewsCity | "", language: NewsLanguage): string {
  const path = city ? `/news/${city}` : "/news";
  return `${path}?lang=${language}`;
}

function usePageContext() {
  const path = typeof window === "undefined" ? "/news" : window.location.pathname;
  const articleMatch = path.match(/^\/news\/article\/([^/]+)\/?$/);
  const city: NewsCity | "" = path.startsWith("/news/miami")
    ? "miami"
    : path.startsWith("/news/new-york")
      ? "new-york"
      : "";
  return { city, slug: articleMatch ? decodeURIComponent(articleMatch[1]) : "" };
}

function LanguageSwitch({ language, path }: { language: NewsLanguage; path: string }) {
  const [, navigate] = useLocation();
  const setLanguage = (next: NewsLanguage) => {
    window.localStorage.setItem("metro-current-language", next);
    navigate(`${path}?lang=${next}`);
  };

  return (
    <div className="inline-flex rounded-full border border-[#17395c]/20 bg-white p-1" aria-label="Language / Idioma">
      {(["en", "es"] as const).map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => setLanguage(option)}
          aria-pressed={language === option}
          className={`rounded-full px-3 py-1.5 text-xs font-bold tracking-[0.16em] transition ${language === option ? "bg-[#17395c] text-white" : "text-[#53606c] hover:bg-[#edf0f2]"}`}
        >
          {option.toUpperCase()}
        </button>
      ))}
    </div>
  );
}

function SiteHeader({ language, city, path }: { language: NewsLanguage; city: NewsCity | ""; path: string }) {
  const copy = COPY[language];
  return (
    <>
      <a href="#news-content" className="fixed left-3 top-3 z-[100] -translate-y-20 rounded bg-[#17395c] px-4 py-2 text-sm font-bold text-white focus:translate-y-0">
        {copy.skip}
      </a>
      <div className="border-b border-[#17395c]/15 bg-[#17395c] text-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] sm:px-6">
          <span>{copy.independent}</span>
          <span className="hidden items-center gap-2 sm:flex"><span className="h-2 w-2 rounded-full bg-[#f1b24a]" />{copy.live}</span>
        </div>
      </div>
      <header className="bg-[#fbfaf6]">
        <div className="mx-auto grid max-w-7xl grid-cols-[1fr_auto] items-center gap-4 px-4 py-5 sm:grid-cols-[1fr_auto_1fr] sm:px-6 sm:py-7">
          <div className="hidden text-xs font-semibold uppercase tracking-[0.12em] text-[#68737d] sm:block">
            {formatDate(new Date().toISOString(), language, false)}
          </div>
          <a href={cityHref("", language)} className="group text-left sm:text-center" aria-label="Metro Current home">
            <span className="block font-serif text-3xl font-black tracking-[-0.06em] text-[#132f4b] transition group-hover:text-[#e35d44] sm:text-5xl">Metro Current</span>
            <span className="mt-1 block text-[9px] font-bold uppercase tracking-[0.34em] text-[#e35d44] sm:text-[10px]">Miami · New York</span>
          </a>
          <div className="justify-self-end"><LanguageSwitch language={language} path={path} /></div>
        </div>
        <nav className="border-y border-[#17395c]/20" aria-label="Local editions">
          <div className="mx-auto flex max-w-7xl items-center justify-center gap-1 overflow-x-auto px-4 sm:px-6">
            {([
              { id: "" as const, label: copy.allNews },
              { id: "miami" as const, label: copy.miami },
              { id: "new-york" as const, label: copy.newYork },
            ]).map((item) => (
              <a
                key={item.id || "all"}
                href={cityHref(item.id, language)}
                aria-current={city === item.id ? "page" : undefined}
                className={`border-b-2 px-5 py-3 text-xs font-bold uppercase tracking-[0.17em] transition ${city === item.id ? "border-[#e35d44] text-[#132f4b]" : "border-transparent text-[#65717c] hover:border-[#17395c]/30 hover:text-[#132f4b]"}`}
              >
                {item.label}
              </a>
            ))}
          </div>
        </nav>
      </header>
    </>
  );
}

function ArticleMeta({ article, language }: { article: PublicNewsArticle; language: NewsLanguage }) {
  const copy = COPY[language];
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs font-medium text-[#65717c]">
      {article.publishedAt && <span className="inline-flex items-center gap-1.5"><Clock3 className="h-3.5 w-3.5" aria-hidden="true" />{copy.published} {formatDate(article.publishedAt, language)}</span>}
      {article.location && <span className="inline-flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5" aria-hidden="true" />{article.location}</span>}
      {article.category && <span className="rounded-full bg-[#edf0f2] px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-[#374d61]">{article.category}</span>}
    </div>
  );
}

function LeadArticle({ article, language }: { article: PublicNewsArticle; language: NewsLanguage }) {
  const city = CITY_META[article.city];
  return (
    <article className="grid gap-6 border-b border-[#17395c]/20 pb-8 lg:grid-cols-[minmax(0,1.45fr)_minmax(240px,.55fr)] lg:gap-10">
      <div>
        <ArticleMeta article={article} language={language} />
        <h3 className="mt-4 max-w-4xl font-serif text-4xl font-black leading-[1.02] tracking-[-0.035em] text-[#102a43] sm:text-5xl">
          <a href={articleHref(article, language)} className="decoration-[#e35d44] decoration-2 underline-offset-4 hover:underline">{article.title}</a>
        </h3>
        {article.summary && <p className="mt-5 max-w-3xl text-lg leading-8 text-[#455462]">{article.summary}</p>}
        <a href={articleHref(article, language)} className="mt-6 inline-flex items-center border-b-2 border-[#e35d44] pb-1 text-xs font-black uppercase tracking-[0.16em] text-[#17395c]">
          {COPY[language].readStory}
        </a>
      </div>
      <a href={articleHref(article, language)} className="group relative flex min-h-52 items-center justify-center overflow-hidden bg-[#e9edf0] p-8">
        <span className={`absolute inset-x-0 top-0 h-1.5 ${city.accent}`} />
        <img src={city.logo} alt={`${city.name[language]} News`} className="h-36 w-36 rounded-full object-cover shadow-[0_18px_45px_rgba(16,42,67,.18)] transition duration-300 group-hover:scale-105" />
      </a>
    </article>
  );
}

function SecondaryArticle({ article, language }: { article: PublicNewsArticle; language: NewsLanguage }) {
  return (
    <article className="flex h-full flex-col border-t-4 border-[#17395c] bg-white p-5 shadow-[0_12px_35px_rgba(16,42,67,.07)] sm:p-6">
      <ArticleMeta article={article} language={language} />
      <h3 className="mt-4 font-serif text-2xl font-bold leading-tight tracking-[-0.02em] text-[#102a43]">
        <a href={articleHref(article, language)} className="hover:text-[#d94f36]">{article.title}</a>
      </h3>
      {article.summary && <p className="mt-3 line-clamp-4 text-sm leading-6 text-[#566471]">{article.summary}</p>}
      <a href={articleHref(article, language)} className="mt-auto pt-5 text-xs font-black uppercase tracking-[0.13em] text-[#c84631]">
        {COPY[language].readStory} →
      </a>
    </article>
  );
}

function CityEdition({ city, articles, language }: { city: NewsCity; articles: PublicNewsArticle[]; language: NewsLanguage }) {
  if (!articles.length) return null;
  const meta = CITY_META[city];
  return (
    <section className="scroll-mt-6" aria-labelledby={`${city}-heading`}>
      <div className="mb-7 flex items-end justify-between gap-4 border-b-4 border-[#17395c] pb-3">
        <div className="flex items-center gap-3">
          <img src={meta.logo} alt="" className="h-10 w-10 rounded-full object-cover" aria-hidden="true" />
          <h2 id={`${city}-heading`} className="font-serif text-3xl font-black tracking-[-0.04em] text-[#102a43] sm:text-4xl">{meta.name[language]}</h2>
        </div>
        <a href={cityHref(city, language)} className="text-[11px] font-black uppercase tracking-[0.14em] text-[#c84631]">
          {language === "es" ? "Ver edición" : "View edition"} →
        </a>
      </div>
      <LeadArticle article={articles[0]} language={language} />
      {articles.length > 1 && (
        <div className="mt-8 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {articles.slice(1).map((article) => <SecondaryArticle key={`${article.slug}-${article.lang}`} article={article} language={language} />)}
        </div>
      )}
    </section>
  );
}

function LoadingState({ language }: { language: NewsLanguage }) {
  return (
    <div className="py-24 text-center" role="status" aria-live="polite">
      <RefreshCw className="mx-auto h-7 w-7 animate-spin text-[#e35d44]" aria-hidden="true" />
      <p className="mt-4 text-sm font-bold uppercase tracking-[0.14em] text-[#566471]">{COPY[language].loading}</p>
    </div>
  );
}

function ErrorState({ language, retry }: { language: NewsLanguage; retry: () => void }) {
  const copy = COPY[language];
  return (
    <div className="mx-auto max-w-xl border-y border-[#17395c]/20 py-20 text-center" role="alert">
      <h2 className="font-serif text-3xl font-black text-[#102a43]">{copy.errorTitle}</h2>
      <p className="mt-3 leading-7 text-[#566471]">{copy.errorBody}</p>
      <button type="button" onClick={retry} className="mt-6 rounded-sm bg-[#17395c] px-5 py-3 text-xs font-black uppercase tracking-[0.14em] text-white hover:bg-[#24527d]">{copy.retry}</button>
    </div>
  );
}

function EmptyState({ language }: { language: NewsLanguage }) {
  const copy = COPY[language];
  return (
    <div className="mx-auto max-w-xl border-y border-[#17395c]/20 py-20 text-center">
      <h2 className="font-serif text-3xl font-black text-[#102a43]">{copy.emptyTitle}</h2>
      <p className="mt-3 leading-7 text-[#566471]">{copy.emptyBody}</p>
    </div>
  );
}

function ArticleNotFound({ language }: { language: NewsLanguage }) {
  const copy = COPY[language];
  return (
    <div className="mx-auto max-w-xl border-y border-[#17395c]/20 py-20 text-center">
      <h1 className="font-serif text-3xl font-black text-[#102a43]">{copy.notFoundTitle}</h1>
      <p className="mt-3 leading-7 text-[#566471]">{copy.notFoundBody}</p>
      <a href={cityHref("", language)} className="mt-6 inline-flex items-center gap-2 text-xs font-black uppercase tracking-[0.14em] text-[#c84631]">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />{copy.back}
      </a>
    </div>
  );
}

function NewsFeed({ language, city }: { language: NewsLanguage; city: NewsCity | "" }) {
  const query = useQuery({
    queryKey: ["public-local-news", city, language],
    queryFn: async () => {
      const params = new URLSearchParams({ lang: language });
      if (city) params.set("city", city);
      return normalizeFeed(await getJson(`/api/public/local-news?${params.toString()}`), language, city);
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    retry: 1,
  });
  const grouped = useMemo(() => ({
    miami: query.data?.articles.filter((article) => article.city === "miami") || [],
    "new-york": query.data?.articles.filter((article) => article.city === "new-york") || [],
  }), [query.data]);
  const cities: NewsCity[] = city ? [city] : ["miami", "new-york"];
  const hasArticles = cities.some((item) => grouped[item].length > 0);

  if (query.isLoading) return <LoadingState language={language} />;
  if (query.isError) return <ErrorState language={language} retry={() => void query.refetch()} />;

  return (
    <>
      <div className="mb-12 flex flex-col gap-4 border-b border-[#17395c]/20 pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[11px] font-black uppercase tracking-[0.2em] text-[#e35d44]">{COPY[language].live}</p>
          <h1 className="mt-2 font-serif text-3xl font-black tracking-[-0.035em] text-[#102a43] sm:text-5xl">
            {city ? CITY_META[city].name[language] : COPY[language].latest}
          </h1>
        </div>
        <div className="flex items-center gap-2 text-xs text-[#65717c]" aria-live="polite">
          {query.isFetching && <RefreshCw className="h-3.5 w-3.5 animate-spin" aria-label={COPY[language].refreshing} />}
          <span>{COPY[language].updated}: {formatDate(query.data?.updatedAt || new Date().toISOString(), language)}</span>
        </div>
      </div>
      {!hasArticles ? <EmptyState language={language} /> : (
        <div className="space-y-16">
          {cities.map((item) => <CityEdition key={item} city={item} articles={grouped[item]} language={language} />)}
        </div>
      )}
    </>
  );
}

function normalizeArticleResponse(payload: unknown, language: NewsLanguage): PublicNewsArticle | null {
  if (!payload || typeof payload !== "object") return null;
  const raw = payload as Record<string, unknown>;
  return normalizeArticle(raw.article ?? raw, language);
}

function NewsArticle({ slug, language }: { slug: string; language: NewsLanguage }) {
  const query = useQuery({
    queryKey: ["public-local-news-article", slug, language],
    queryFn: async () => normalizeArticleResponse(
      await getJson(`/api/public/local-news/${encodeURIComponent(slug)}?lang=${language}`),
      language,
    ),
    staleTime: 30_000,
    refetchInterval: 90_000,
    refetchOnWindowFocus: true,
    retry: 1,
  });
  if (query.isLoading) return <LoadingState language={language} />;
  if (query.isError) return <ErrorState language={language} retry={() => void query.refetch()} />;
  const article = query.data;
  if (!article) return <ArticleNotFound language={language} />;
  const paragraphs = article.body.split(/\n{2,}/).map((paragraph) => paragraph.trim()).filter(Boolean);
  const meta = CITY_META[article.city];

  return (
    <article className="mx-auto max-w-4xl">
      <a href={cityHref(article.city, language)} className="inline-flex items-center gap-2 text-xs font-black uppercase tracking-[0.14em] text-[#c84631] hover:text-[#17395c]">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />{COPY[language].back}
      </a>
      <div className="mt-8 flex items-center gap-3">
        <img src={meta.logo} alt="" aria-hidden="true" className="h-11 w-11 rounded-full object-cover" />
        <span className="text-xs font-black uppercase tracking-[0.18em] text-[#17395c]">{meta.name[language]}</span>
      </div>
      <h1 className="mt-7 font-serif text-4xl font-black leading-[1.02] tracking-[-0.04em] text-[#102a43] sm:text-6xl">{article.title}</h1>
      {article.summary && <p className="mt-6 border-l-4 border-[#e35d44] pl-5 text-xl leading-8 text-[#455462] sm:text-2xl">{article.summary}</p>}
      <div className="mt-7 border-y border-[#17395c]/20 py-4"><ArticleMeta article={article} language={language} /></div>
      <div className="mx-auto mt-10 max-w-3xl space-y-6 font-serif text-lg leading-8 text-[#253b4f] sm:text-xl sm:leading-9">
        {(paragraphs.length ? paragraphs : [article.summary]).map((paragraph, index) => <p key={`${article.slug}-${index}`}>{paragraph}</p>)}
      </div>
      {article.sourceUrl && (
        <aside className="mx-auto mt-12 max-w-3xl border-l-4 border-[#17395c] bg-white p-6 shadow-[0_10px_28px_rgba(16,42,67,.06)]">
          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-[#68737d]">{COPY[language].source}</p>
          <a href={article.sourceUrl} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-2 font-bold text-[#17395c] underline decoration-[#e35d44] decoration-2 underline-offset-4">
            {article.source}<ExternalLink className="h-4 w-4" aria-hidden="true" />
          </a>
        </aside>
      )}
    </article>
  );
}

function SiteFooter({ language }: { language: NewsLanguage }) {
  return (
    <footer className="mt-20 border-t-4 border-[#17395c] bg-[#e9edf0]">
      <div className="mx-auto grid max-w-7xl gap-5 px-4 py-8 sm:grid-cols-[auto_1fr] sm:px-6">
        <div className="flex items-center gap-2 font-serif text-xl font-black tracking-[-0.04em] text-[#17395c]"><Globe2 className="h-5 w-5" aria-hidden="true" />Metro Current</div>
        <p className="max-w-4xl text-xs leading-5 text-[#566471] sm:justify-self-end sm:text-right">{COPY[language].disclaimer}</p>
      </div>
    </footer>
  );
}

export default function LocalNewsPublicPage() {
  const search = useSearch();
  const language = resolveLanguage(search);
  const { city, slug } = usePageContext();
  const path = typeof window === "undefined" ? "/news" : window.location.pathname;

  useEffect(() => {
    window.localStorage.setItem("metro-current-language", language);
    document.documentElement.lang = language;
    document.title = `${slug ? "Local update" : city ? CITY_META[city].name[language] : "Miami & New York"} | Metro Current`;
  }, [city, language, slug]);

  return (
    <div className="min-h-screen bg-[#fbfaf6] text-[#102a43] selection:bg-[#f4c6bb] selection:text-[#102a43]">
      <SiteHeader language={language} city={city} path={path} />
      <main id="news-content" className="mx-auto max-w-7xl px-4 py-10 sm:px-6 sm:py-14">
        {slug ? <NewsArticle slug={slug} language={language} /> : <NewsFeed language={language} city={city} />}
      </main>
      <SiteFooter language={language} />
    </div>
  );
}
