# Seam de publicación social (`SOCIAL_PUBLISHING_PROVIDER`)

Toda publicación de BlackOps (clippers, marketing, Black Room, noticias locales, reels de KONG…) pasa por un
**proveedor de publicación** intercambiable, igual que las analíticas pasan por `SOCIAL_ANALYTICS_PROVIDER`.

| Lado | Seam | Adaptador Metricool | Plantilla del hub propio |
|------|------|---------------------|--------------------------|
| Scripts `.mjs` | `script/social-publishing/provider.mjs` | `script/social-publishing/metricool.mjs` | `script/social-publishing/blackops-hub.mjs` |
| Servidor `.ts` | `server/social-publishing/provider.ts` | `server/social-publishing/metricool.ts` | `server/social-publishing/blackops-hub.ts` |

- `SOCIAL_PUBLISHING_PROVIDER` vacío ⇒ `metricool` (comportamiento idéntico al actual).
- Valor desconocido ⇒ **falla cerrado**: no se publica nada y se registra
  `[social-publishing] refused site=<sitio> reason=unknown_social_publishing_provider:<nombre>`.
- `blackops-hub` **no está registrado por defecto**. Para activarlo: añadirlo a `SOCIAL_PUBLISHING_PROVIDERS`
  en ambos `provider.*`, y definir `SOCIAL_PUBLISHING_PROVIDER=blackops-hub`, `BLACKOPS_HUB_URL` (https) y
  `SOCIAL_HUB_AGENT_TOKEN` (≥ 32 caracteres, el mismo token de la Agent API del Social Hub).
- Los flujos que hoy sólo existen en Metricool (MCP `createScheduledPost`, calendario, Black Room multi-red,
  noticias locales, cliente rico de clippers) se exponen como `legacy`/`createClient` del adaptador Metricool.
  Un proveedor que no los implemente hace que esos sitios **fallen cerrado** (`social_publishing_provider_lacks:<capacidad>:<proveedor>`)
  hasta que se porten al contrato neutral. Nunca hay fallback silencioso a Metricool.

## Contrato neutral (lo que implementa cada adaptador)

```ts
accountRef = { network: "tiktok" | "facebook" | "instagram" | "youtube" | ..., handle?: string, providerAccountId?: string }

schedulePost({ provider, accountRef, mediaUrl, caption, hashtags[], scheduledFor /* ISO-8601 */, idempotencyKey })
  -> { provider, status, providerPostId, publicUrl, reason? }
getPublication({ providerPostId, accountRef, scheduledFor? })
  -> { provider, status, providerPostId, publicUrl /* sólo cuando ya está publicado */, publishedAt? }
cancel({ providerPostId, accountRef })        -> { provider, status: "cancelled" | "refused", reason? }
freeSlots({ accountRef, day /* YYYY-MM-DD */ }) -> { provider, slots: ["YYYY-MM-DDTHH:mm:ss"], timezone }
```

`status` ∈ `scheduled | published | pending_reconciliation | unverified | refused | failed | cancelled | unknown`.

`createSocialPublisher()` (en ambos lados) valida la petición, aplica **idempotencia** y falla cerrado:
una `idempotencyKey` ya vista (incluido un resultado incierto o en curso) **nunca** se reenvía al proveedor;
devuelve el resultado previo con `duplicate: true`. Una excepción del proveedor queda como
`pending_reconciliation` (no se reintenta a ciegas).

## Endpoints que debe exponer la nueva app (`blackops-hub`)

Base: `BLACKOPS_HUB_URL`. Autenticación: `Authorization: Bearer <SOCIAL_HUB_AGENT_TOKEN>` (comparación en tiempo
constante, igual que `/social-hub-agent/*`). JSON en ambos sentidos. Sin cookies, sin redirecciones.

### `POST /social-hub-agent/v1/publishing/posts`
Cabecera `Idempotency-Key: <idempotencyKey>` (también va en el cuerpo).
```json
{ "accountRef": { "network": "tiktok", "handle": "streamersus", "providerAccountId": "acc_123" },
  "mediaUrl": "https://…/clip.mp4", "caption": "texto", "hashtags": ["#fyp"],
  "scheduledFor": "2026-12-01T15:00:00Z", "idempotencyKey": "clip-0001-tiktok" }
```
Respuesta 200/201: `{ "status": "scheduled", "providerPostId": "post_abc", "publicUrl": null }`.
- Misma `idempotencyKey` otra vez ⇒ **mismo** `providerPostId` y estado, sin crear un segundo post (200).
- Cuenta desconocida/no autorizada ⇒ 403 `{ "reason": "account_not_allowed" }`. Validación ⇒ 400 `{ "reason": "…" }`.
- El hub descarga `mediaUrl` (https público) y la conserva hasta publicar.

### `GET /social-hub-agent/v1/publishing/posts/:providerPostId`
`{ "status": "scheduled|published|failed|cancelled", "providerPostId": "…", "publicUrl": "https://www.tiktok.com/@x/video/1" | null, "publishedAt": "ISO" | null, "reason": "…"? }`
`publicUrl` sólo cuando la red confirmó la publicación (nunca inventado). 404 si no existe.

### `POST /social-hub-agent/v1/publishing/posts/:providerPostId/cancel`
Cuerpo `{}`. `{ "status": "cancelled", "providerPostId": "…" }`; si ya está publicado ⇒ 409 `{ "reason": "already_published" }`.

### `GET /social-hub-agent/v1/publishing/slots?network=&handle=&providerAccountId=&day=YYYY-MM-DD`
`{ "slots": ["2026-12-01T10:00:00", "…"], "timezone": "America/New_York" }` — huecos libres respetando el
tope diario por cuenta (hoy 5 por cuenta/red en clippers).

## Reglas que el hub debe mantener
- No publicar sin cuenta verificada/permitida; no reintentar una escritura con resultado incierto.
- Respetar topes diarios y duplicados (mismo caption/media/hora) como hoy hace Metricool + ledgers.
- No gasto pagado ni publicación externa nueva sin aprobación de Robert (AGENTS.md).

## Sitios de llamada enrutados por el seam
Scripts: `clippers-metricool-autopilot.mjs` (MCP createScheduledPost + verificación + preflight),
`clippers-reconcile-publications.mjs` (lectura de publicación), `clippers-streamer-cloud-worker.mjs`,
`clippers-weekly-scheduler.mjs`, `clippers-daily-learning.mjs`, `clippers-native-media-receipts.mjs`,
`clippers-reviewed-hour-window-cloud.mjs` (cliente rico vía `createPublishingClient`).
Servidor: `blackroom-control-routes.ts` (Black Room → `scheduleBlackRoomPost`), `routes.ts` y
`clippers-local-news-scheduler.ts` (noticias → `deliverLocalNews`), `social-hub/routes.ts` (calendario →
`scheduledCalendar`), `clippers-reviewed-derivative-routes.ts` (reconciliación), y
`script/blackroom-publication-collector.ts` (sólo lee calendario si el proveedor es Metricool).

## Pasos para activar el hub
1. Implementar los 4 endpoints de arriba en la app nueva.
2. Registrar `blackops-hub` en `SOCIAL_PUBLISHING_PROVIDERS` (ambos lados) en un PR.
3. Portar los flujos `legacy` (clippers, Black Room, noticias) a `createSocialPublisher().schedulePost`.
4. Cambiar `SOCIAL_PUBLISHING_PROVIDER` en Replit/Actions sólo con aprobación de Robert.
