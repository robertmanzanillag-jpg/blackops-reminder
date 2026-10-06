# Agents Office: publicación y despliegue pendientes de autorización

Plan del 5 octubre 2026, para el mismo cloud. No es autorización de push, PR, merge, deploy, migración productiva ni activación de agentes. El plan único funcional y sus límites están en `agents-office-cloud-acceptance.md`; este documento concreta la entrega.

## Ramas y cambios

| Repo / rama | Base main confirmada por git remoto | HEAD de código preparado |
| --- | --- | --- |
| robertmanzanillag-jpg/blackops-reminder — `fix/agents-office-cloud-audit` | `42dd770b09afee98fe3007a712881b20de8633e4` | `d6d1270c8ebdf9637f1f8507e8d3f06e7b470a1b` |
| robertmanzanillag-jpg/kong-nightlife — `fix/public-music-email-cloud` | `6484848515c9a26384851a98fc11d8b4e224f204` | `06b162f7d092c322d2ef5f08cc63ceebd47c46a1` |

El commit final de documentación BlackOps puede avanzar su HEAD sin cambiar código; los HEAD exactos para publicar y checksums se conservan en `/workspace/agents-office-cloud-evidence/manifest.json`. Volver a comparar main y ambos HEAD inmediatamente antes de publicar; si avanzó main, integrar en rama local, conservar novedades y verificar los cambios nuevos antes del push. No usar force push.

BlackOps: 28 archivos del commit de código; sesión backend real, fail-closed fuera de dev/test, caché auth segura, separación por dueño/idempotencia Marketing, persistencia antes de éxito, ningún aprendizaje inventado, calendario/DST/pausas/overdue, diagnóstico Metricool, requisitos y vistas honestos en contenido, regresiones y mapas. No añade una migración manual ni campañas.

KONG: el diff contra main incorpora el directorio completo del PR237 y su historia, junto con emails publicados con procedencia y estados, DOM estático, UI/API, protección de ciudad/Unicode, coverage deportivo, colectores/monedas, historial de completions y correcciones CEO/idempotencia. El seed inicial de235 proyectos no equivale a235 emails. El PR resultante es mayor que el parche nuevo porque main todavía no incluye el directorio.

## Publicación propuesta, todavía sin ejecutar

1. Autorizar por separado push de ambas ramas y apertura de dos PRs draft contra main. Títulos: «Repair Agents Office identity, scheduling and evidence» y «Add sourced public music emails and durable city-agent results». Incluir problema, resultado, pruebas, checker, límites y rollback en cada cuerpo.
2. Publicar únicamente las dos ramas nuevas con `git push --set-upstream origin fix/agents-office-cloud-audit` y `git push --set-upstream origin fix/public-music-email-cloud` desde sus respectivos repos. Estos comandos son propuesta, no han sido ejecutados.
3. El nuevo PR KONG indicará «Supersedes the code proposed in #237; original draft retained for history». HEAD contiene como ancestros main648484 y el PR237 exacto bd3693b14ce561e563db539c530ce81933591817, unidos en c002850a. No cambiar ni force-push la rama `codex/music-directory-agent`; no cerrar/comentar/modificar PR237 sin autorización para esa gestión. Tras aprobación del nuevo PR, cerrar el anterior como superseded puede autorizarse aparte.
4. No merge hasta revisión de los HEAD exactos. KONG Full build escucha push a main y workflow_dispatch, no pull_request; abrir el draft no garantiza CI. Una ejecución manual de build debe apuntar explícitamente a la nueva rama. El workflow sube artefactos y no sustituye el despliegue Replit. BlackOps no tiene `.github/workflows`; los checks locales/checker deben figurar como evidencia, sin inventar checks verdes de GitHub.

## Destinos y acceso verificados

GitHub permite lectura por connector y git autenticado existente; no se probó escritura porque falta autorización. No crear tokens ni cambiar OAuth para publicar.

Replit conectado: «Kong Ultimate Native», replId0339048d-47dd-4e30-b7ab-ce06497a52ab, tiene publicación success en https://kongnightlife.com. «KONG VIP Daily Worker»649dcb2d-1e74-4dd2-8cd6-276fbdc51a26 está publicado, pero no se verificó que ese worker use este checkout. «KongApp» no está publicado y «Kong Mirror» sirve https://kong-app.replit.app; no son destinos intercambiables. Publish status no acredita SHA, configuración, DB ni cobertura operativa del código nuevo.

BlackOps no se resolvió por ese nombre ni por «Dialer Planner». El repo registra https://robplanner.replit.app; Replit devolvió «Daily Planner»996097da-891f-490f-b35f-c02f361c4e34 publicado en https://robertwebsites.com. La correspondencia con el repo/DB no está acreditada. No publicar ahí por semejanza del nombre. Antes del deploy falta confirmar app correcta, conexión al repo, SHA, DB, procesos actuales y capacidad de rollback. La lectura web de readiness/deploy-info KONG y de esas URLs BlackOps no estuvo disponible; no se infirió versión live.

## Migraciones, backup y reversión

KONG necesita0028_music_directory.sql y0029_music_directory_web.sql para persistir discovery, además de0029_city_agents.sql,0030_city_agent_records.sql y nueva0031_city_agent_run_history.sql para el worker actualizado. Los nombres0029 distintos no deben confundirse. Music migrations se aplican explícitamente; el preflight actual solo automatiza las company migrations según flags.

0031 crea una tabla e índice nuevos, sin ALTER/backfill en jobs/records existentes. `id` es el token UUID de la lease que realmente completó/falló; CTE registra una sola terminalización atomizada con actualización del job y su fence. Sin report nuevo, un fallo registra {}, no atribuye el snapshot previo a esa ejecución. No se inventan runs antiguos ni historial de leases abandonadas. Esta tabla debe existir antes de usar la nueva queue: ausencia produce rollback de finish/fail, no un éxito falso. DDL usa transacción, advisory lock y lock_timeout15s en el migrador.

Antes de toda migración/restart autorizado: backup verificable de DB KONG (schema+data, incluyendo tablas de jobs, records, directorio y CEO), guardar artefacto/SHA desplegado previo y configuración de procesos/flags sin exponer secretos. Exportar histórico0031 si ya existe. Probar que el backup se restaura en DB aislada, no sobre producción. No ejecutar backup/migración con una URL deducida ni con credenciales nuevas.

En BlackOps, conservar backup DB/sesiones y del archivo persistente Marketing (`MARKETING_COMMAND_CENTER_LEARNING_PATH` o `marketing_command_center_data/learning-runs.json`) antes de reiniciar. Los registros legacy sin dueño se retienen; no se asignan a un usuario por migración. La atomicidad de archivo sigue limitada a un solo proceso.

Rollback KONG: detener/drenar los workers aprobados; restaurar la versión anterior web/worker de forma coordinada; dejar las tablas aditivas y exportar evidencia. No DROP destructivo como rollback rutinario. El código anterior funciona con esas tablas extra, pero ya no escribirá nuevo historial0031. Rollback BlackOps: volver al artefacto anterior preservando DB/archivo Marketing; los registros nuevos con owner/key siguen almacenados. Restore de backup es un procedimiento separado, solo si se demuestra corrupción o una necesidad autorizada.

## Despliegue y reanudación son decisiones distintas

KONG `.replit` actual declara KONG_CEO_ENABLED=true y KONG_CITY_AGENTS_ENABLED=true; su run arranca worker loop junto al web después del preflight. Un publish automático puede migrar y reanudar esos agentes. No ejecutar el comando completo con aprobación limitada a mostrar código. Para staging de lectura, usar DB aislada y worker deshabilitado/ausente, con CEO/city/discovery/external execution off. Un cambio productivo de proceso/flags debe figurar en la aprobación concreta, sin modificar seguridad de cuentas ni secretos.

El export estático completo de producción todavía requiere verificación antes del despliegue; server, worker y directory builds sí pasaron en cloud. Build KONG aprobado posteriormente: server:build, worker:build, export estático (`WEB_DEPLOY_ONLY=true node scripts/build.js` en la receta Replit), write-deploy-info.js. Music-directory:build solo si se autoriza su proceso separado; ambos flags MUSIC_DIRECTORY_DISCOVERY_ENABLED y MUSIC_DIRECTORY_WEB_ENABLED requieren habilitación explícita. No arrancar scripts --once como smoke: hacen requests externos. Detener y drenar coordinadamente los workers city/CEO anteriores antes de cambiar artefactos; comprobar esquema antes de reanudarlos para evitar ejecuciones mixtas sin historial. Reanudar city/CEO después de migración y checks requiere autorización para esos procesos existentes; publicación de posts, email, campañas o nuevos proveedores siguen fuera.

BlackOps usa Replit VM, build `npm run deploy:build`, run `node script/replit-fast-start.mjs`. Fast-start ofrece HTTP200 con status starting antes de readiness: eso no es salud. El server inicia recordatorios, health/market news, local-news publisher y analytics; CLIPPERS_LOCAL_NEWS_SCHEDULER_ENABLED=false y METRICOOL_ANALYTICS_SYNC_ENABLED=false controlan estos dos últimos, pero el flag de recursos intensivos no desactiva todo. Se necesita inventario de procesos y una política de arranque aprobada antes del restart; no ejecutar startup productivo para una prueba aislada.

## Checks posteriores sin ejecución externa

Usar primero staging sin workers, DB/sesiones y auth de fixture. BlackOps: HTTP200/status ok/ready true no comprueban DB ni inicialización; exigir lectura autenticada respaldada por DB, SELECT1/sesiones y logs de inicialización completa. Verificar nuevo startedAt y uptime coherente tras restart; instanceId puede conservar REPLIT_DEPLOYMENT_ID. Acreditar SHA del artefacto por separado; comprobar auth me401 anónimo, login real, logout, aislamiento de owner, retry idempotente y estados needs_data. Las pruebas con POST son solo fixtures/local: ningún run-all, publicación, email ni campaña productiva.

KONG: comprobar deploy-info con SHA objetivo y `/api/ready` con inicialización+DB ready, no solo `/api/health`. Anónimo directory401; usuario normal admin runs403; admin GET de jobs/runs y directory devuelve estados honestos. UI muestra email, source/time y deliverability not_tested; fixtures heredados/retirados no se cuentan actuales. Consultas DB de conteos/esquema y SELECT1 son lectura; no claim/requestRun de city, no --once de discovery, no OAuth/send/post. Si hay workers explícitamente aprobados, usar sus recibos existentes y guardar resultado real sin fabricar éxito.

## Evidencia y bloqueos actuales

KONG corrida única240/240 con PostgreSQL/HTTP/Chromium y providers simulados; typecheck, server, worker y directory builds exit0. BlackOps suite previa259/259 y nueva prueba HTTP/sesión PG1/1; typecheck/build correctos. Checker aprobó código; nueva documentación no modifica runtime. Evidencia local se conserva con SHA256 en `/workspace/agents-office-cloud-evidence`.

Lectura pública acotada actual: NTS publica press@ntslive.co.uk para prensa y hello@soup.world para partnerships (https://www.nts.live/about), con show proposals por formulario. No son direcciones de submissions ni entregabilidad probada. Las otras páginas intentadas no fueron accesibles; no se añadieron emails ni métricas por ello. ZIP Library403 sigue bloqueado, sin reintentos alternativos ni checksum verificado.

Siguiente bloqueo: autorización para push/apertura de PRs. Merge, despliegue, migraciones productivas y reanudación de procesos necesitan autorización específica posterior, además de confirmar el destino BlackOps y runtime/backup. No hay cierre global.

## Autorización actualizada — 6 octubre 2026

La actualización de las ramas de PR299 y PR251 existentes está expresamente autorizada; la restricción provisional de nuevos pushes queda revocada solo para esos destinos. Las etapas de merge, deploy, migraciones productivas, posts/email, gastos, credenciales e inicio de workers siguen separadas. Ver aceptación consolidada para cambios de timeout, AppQA y posts. El hotfix Metricool productivo coordinado por el parent es un artefacto separado: no se declara incorporado por esta publicación.
