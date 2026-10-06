# Agents Office: plan y aceptación cloud

Revisión del 5 de octubre de 2026. Base BlackOps: `42dd770b09afee98fe3007a712881b20de8633e4`; rama local `fix/agents-office-cloud-audit`. Estos cambios se reconstruyeron desde main. No se portó el snapshot privado del Mac: el ZIP de Library no llegó al cloud.

## Plan único

1. Conservar la identidad y la evidencia: autenticación real, separación por propietario y ninguna métrica inventada.
2. Corregir proyecciones de calendario, pausas y diagnóstico de sincronización.
3. Verificar contenido y aprendizaje con entradas simuladas; exigir evidencia real para resultados operativos.
4. Identificar el directorio musical antes de escribir en otro proyecto; registrar emails profesionales con fuente, fecha, finalidad y estado.
5. Comparar KONG actual por ciudad y categoría, preservar novedades y verificar propiedad, exclusión e idempotencia.
6. Ejecutar pruebas cloud y revisión independiente; cerrar cada fila solo con evidencia o bloqueo específico.

## Matriz de aceptación

| Área | Evidencia local | Lo que queda pendiente |
| --- | --- | --- |
| Identidad | Runtime desconocido/producción rechazan fallback mock. Cliente exige sesión backend. Se retiraron login/biometría de navegador sin sesión servidor. Nueva prueba HTTP/PostgreSQL local verifica registro real, hash, sesión tras reinicio, identidad, password incorrecto y logout. | No acredita sesión/DB productivas. Chromium ahora disponible; se verificó UI KONG, no toda UI BlackOps. |
| Marketing | Rutas usan propietario autenticado; historial filtrado por propietario, sin asignar registros antiguos sin dueño. Idempotencia por dueño/foco/clave; persistencia precede respuesta y caché. Revisiones sin evidencia no actualizan reglas. | Métricas atribuidas, decisión persistente, ajuste y resultado real no están disponibles. El almacenamiento de revisiones sigue siendo un archivo de un solo proceso, no coordinación distribuida. |
| Scheduler | Zona horaria/DST, validación, próximas fechas actuales, pausas conservadas. `missedRunAt` mantiene evidencia de vencimientos tras recalcular la proyección. Sin historial no equivale a saludable. | Proyección de fecha no demuestra ejecución. No se ejecutaron jobs externos. |
| Metricool Miami/NY | Contadores por intento; diagnósticos de marcas faltantes; posts/duplicados/no asociados visibles; rechazo del scheduler manejado. | Acceso y recibos de producción no verificados. Cero registros puede indicar duplicados/no asociados, no credenciales inválidas. |
| Contenido | Cola de requisitos ausentes incluye runtime aun sin archivos; valores configurados no figuran pendientes. Nuevas cuentas no arrancan con vistas ficticias. | Derechos, conexiones, publicaciones y métricas reales siguen sin verificarse. No se activó publicación. |
| KONG | Checkout completo `/workspace/kong-nightlife-cloud` integra main648484 y PR237 en commit local c002850a. Unicode aplicado localmente; guards de ciudad, cobertura sports, idempotencia y nueva historia de completions probados con PostgreSQL aislado. 24×7=168 jobs definidos. | No se activaron workers. Migración0031 solo local; faltan runs/resultados productivos por ciudad. |
| Directorio musical | Candidato `robertmanzanillag-jpg/DROPKIT`: `OutreachContactsScreen.tsx`, `RecordLabelsScreen.tsx`, `POST /api/outreach/contacts/discover`. El flujo toma booking email del modelo sin verificar fuente del email. | El PR KONG #237 identifica un candidato mucho más cercano: pantalla `MusicDirectory`, deep link `music-directory`, API `GET /api/music-directory`. Sigue draft, sin merge y sin contactos corroborados según su registro. Su contrato actual no contiene email. No se modificó el PR ni se activó el servicio; DROPKIT no se trató como destino confirmado. Pendiente confirmar URL/runtime y verificar DJ/colectivo/label. |
| Handoff | Referencia Library confirmada; entorno y checkout independientes del Mac. | `oaisdmntpreastus.blob.core.windows.net`: proxy devuelve 403. Sin bytes/SHA256 verificados. No más reintentos ni rutas alternativas. |

## Pruebas y revisión

Los logs están en `/tmp/blackops-*.log`. La batería amplia final terminó con **259/259, cero fallos**, exit 0 y duración 740616 ms (`/tmp/blackops-cloud-regressions-final.log`). Incluye identidad, Marketing, política scheduler, BlackRoom, Clippers, ownership/health CEO y App QA. La primera corrida 250/254 permitió detectar expectativas antiguas y una omisión de runtime; no se suma a la final. Las baterías enfocadas 88/88, 20/20 y scheduler 14/14 tienen solapamiento y tampoco se suman. KONG ciudad/cola dio 8/8 y el extractor del PR #237 dio 16/16 en cloud con fuentes simuladas. Typecheck y builds finales pasaron.

Segunda fase: KONG integrado completó una corrida conjunta **240/240**, cero fallos/skips, con PostgreSQL/Chromium locales y providers simulados (`/tmp/kong-cloud-acceptance-final.log`). BlackOps añadió una prueba aislada de autenticación HTTP+sesión PostgreSQL **1/1** (`/tmp/blackops-cloud-http-postgres.log`) y confirmó typecheck. Estos resultados no se suman a corridas anteriores.

La revisión independiente encontró y ayudó a corregir persistencia falsa tras error de disco, autenticación cacheada ante error y ocultación de vencimientos al recalcular fechas. El checker aprobó las reparaciones finales y la regresión DST: una fecha local ya ejecutada no anuncia otra ejecución en la hora repetida. Su verificación independiente más reciente dio 14/14 y diff limpio.

## Emails públicos revisados

La tabla de `music-public-contact-audit.csv` conserva finalidad y límites. Una sintaxis válida no demuestra entregabilidad. No se envió ningún email. NTS publica prensa y partnerships; esos contactos no equivalen a submissions de DJs. La fuente histórica de Dispatch no acredita vigencia en 2026. Los emails ocultos, snippets no verificables y formularios se mantienen pendientes.

El directorio solicitado quedó localizado en [KONG PR #237](https://github.com/robertmanzanillag-jpg/kong-nightlife/pull/237), head `bd3693b14ce561e563db539c530ce81933591817`. La revisión cloud fijó ese snapshot en `/workspace/kong-directory-audit`; sus 16 pruebas cubren extracción con fuentes simuladas, no contactos corroborados ni operación continua. Sus 235 entradas iniciales y ocho lanes declarados no acreditan emails, ejecuciones actuales ni entregabilidad. La pantalla y ruta de código están identificadas; la URL desplegada sigue sin verificar.

Ruta exacta de UI: `client/screens/MusicDirectoryScreen.tsx`, screen `MusicDirectory`, título «Music connections», deep link confirmado `kong://music-directory` en `client/navigation/linking.ts`. API autenticada: `GET /api/music-directory`. Categorías del contrato: label, collective, radio, promoter, event-series y podcast; está dirigido a DJs, no contiene una categoría DJ. El contrato conserva `sourceUrl`, `lastCheckedAt`, `status`, `verificationStatus` y evidencia URL/fecha/tipo para la entidad y su Instagram. No tiene email ni procedencia o validación específica de email. «Corroborated» se refiere a nombre e Instagram entre familias de fuentes, no permiso para demos, titularidad de correo o entregabilidad. El crawler mantiene candidatos pendientes y no extrae email. Hay scripts de workers opt-in, pruebas y persistencia en el PR; sus comprobaciones históricas no sustituyen pruebas cloud actuales.

La segunda fase obtuvo el checkout completo KONG por git autorizado, integró main/PR en rama local y añadió emails al esquema/API/UI/pipeline. [Aceptación KONG](/workspace/kong-nightlife-cloud/docs/public-music-email-cloud-acceptance.md) detalla esa implementación. PostgreSQL y Chromium locales verificaron persistencia y pantalla; no se sobrescribió el PR ni se activaron servicios externos. El esquema anterior descrito arriba es el snapshot remoto previo a esta reparación local.

## Límites de salida

No hubo push, PR, merge, deploy, campañas, emails, posts, OAuth ni migraciones de producción. No se modificaron credenciales ni configuración de cuentas. El repo exige PR y QA para considerarlo listo para entrega: sin autorización de PR, este trabajo permanece local y no está aprobado para release. Revertir los archivos del diff revierte la reparación; no hay migraciones ni cambios productivos que revertir.

## Consolidación autorizada del 6 octubre 2026 — PR299 existente

El usuario autorizó actualizar esta misma rama/PR con las reparaciones revisadas. No autorizó merge, despliegue, cambios de infraestructura, credenciales, publicaciones sociales ni activación de agentes. La autorización anterior de publicación GitHub se amplía a estos commits; no se abren otros PRs.

Prioridad posts: validación completa de destino/plataforma/blog/media/expiración antes de deduplicar; recibos confirmados separados por cuenta/blog/usuario/red; pendientes ambiguos no se reenvían ni se declaran publicados.39/39 pruebas con proveedores simulados y checker independiente. No existe clippers_workspace operativo en cloud: drafts, media, derechos, captions, calendario, historial y recibos actuales requieren inventario de producción. Los70specs de motivación son ejemplos, no posts operativos.

Office16roles y chat local explican que no acreditan ejecución. GET AppQA omite alertas/cooldown/historial/clics visuales incluso en every_scan, conservando lecturas HTTP/GitHub; POST/scheduler conservan sus efectos existentes.27/27 pruebas y checker.

Estabilidad: timeout PG nativo10segundos, configurable DB_CONNECTION_TIMEOUT_MS1..120000, conserva max10/idle10segundos. Métricas y errores saneados; monitor con start idempotente y guard por proceso.18/18 fixtures y revisión de pg/connect-pg-simple. No reintentos de escrituras ni prueba de resolución de la causa productiva. Arranque frío puede necesitar un límite mayor; sessionpool no expone counts. Typecheck y build final cloud pasaron.

Sin workflows GitHub en la rama/base inspeccionados; no se declara CI verde cuando no hay checks. Los anteriores commits y main permanecen. Antes de producción: confirmar cuenta/perfil, estilo histórico, materiales/derechos y calendario; preparar cola revisable; obtener autorización concreta de despliegue/arranque y ejecutar gates de salud/sessionDB. Registrar publicación real y métricas fechadas antes de atribuir aprendizaje CEO. No activar todos los schedulers por defecto para validar. Rollback: revertir los commits nuevos y conservar datos/sesiones/ledgers; ninguna migración nueva en esta consolidación.
