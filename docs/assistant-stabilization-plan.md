# Assistant Stabilization Plan

Plan para convertir el proyecto en un CEO Assistant operable, mantenible y listo para produccion real.

## Fase 0 - Compuertas tecnicas

Estado: completado localmente el 2026-06-17.

- `npm run check` debe pasar sin errores TypeScript.
- `npm run build` debe producir cliente y servidor.
- `npm run test:ceo-assistant` debe pasar completo.
- Tests focalizados de dominios grandes deben pasar cuando se toquen:
  - `node --import tsx --test tests/revenue-engine.test.ts`
  - `node --import tsx --test tests/clippers-agent.test.ts`
- `npm run ceo:smoke -- --user-id=<real-user-id> --chat-id=<telegram-chat-id>` debe ser el preflight operativo antes de declarar un deploy listo; cubre doctor, schema, backup/restore y readiness.

Cambios realizados:

- Tipos React/JSX y target TypeScript corregidos en `tsconfig.json`.
- Errores de `Timeout`, `Uint8Array`, narrowing de Revenue UI y contratos de Clippers corregidos.
- Inserciones Drizzle de storage/trust alineadas con tipos de tabla.
- Snapshot de portafolio alinea `userId` con el insert schema.

## Fase 1 - Produccion single-user real

Objetivo: que el asistente opere para Robert sin fallback silencioso de desarrollo.

- Configurar `DATABASE_URL`, `SESSION_SECRET`, `LOCAL_AUTH_ENABLED=true`, `ALLOW_DEV_USER_FALLBACK=false`.
- Crear usuario real con `npm run auth:create-user`.
- Migrar datos desde `mock-user-123` con `npm run user:migrate -- --from=mock-user-123 --to=<real-user-id> --execute`.
- Configurar `DEFAULT_USER_ID=<real-user-id>` para jobs single-user.
- Confirmar que requests web/API autentican por sesion/provider, no por `DEFAULT_USER_ID`.
- Configurar Telegram real: token, chat, webhook URL y `TELEGRAM_WEBHOOK_SECRET`.
- Bloquear deploy si `ceo:doctor` detecta placeholders, secretos debiles, URL no HTTPS, fallback dev o `DEFAULT_USER_ID` desalineado.
- Confirmar schema operativo con `npm run ceo:db-check -- --json` despues de `npm run db:push`.
- Confirmar backup/restore con `npm run ceo:backup-check -- --json` antes de operar con datos reales.
- Verificar:
  - `npm run ceo:doctor -- --user-id=<real-user-id> --chat-id=<telegram-chat-id> --json`
  - `npm run ceo:db-check -- --json`
  - `npm run ceo:backup-check -- --json`
  - `npm run ceo:readiness -- --user-id=<real-user-id>`
  - `npm run ceo:smoke -- --user-id=<real-user-id> --chat-id=<telegram-chat-id>`
  - `npm run ceo:send-brief -- --user-id=<real-user-id> --execute`

## Fase 2 - Observabilidad y operacion

Objetivo: saber que paso, que fallo y que requiere accion sin abrir logs crudos.

- Crear vista de jobs con ultima ejecucion, duracion, status, error y proximo intento.
- Exponer resumen de job health en `/api/ceo-dashboard` y en el dashboard CEO.
- Registrar `automation_runs` desde los jobs principales del scheduler para que el dashboard tenga historial real de success/failed/skipped.
- Persistir errores de scheduler, Telegram, IA, Drive/OAuth y revenue/clippers runs.
- Agregar retry metadata y dedupe persistente para jobs/webhooks si hay mas de una instancia.
  - Telegram webhook ya registra `update_id` en `telegram_processed_updates` y cae a dedupe en memoria si el schema aun no fue aplicado.
  - Rate limits de auth local y Telegram webhook ya usan `app_rate_limit_buckets` con fallback en memoria si el schema aun no fue aplicado.
- Mostrar en `/ceo` un bloque de "Sistema" con blockers accionables.
- Mantener `npm run ceo:smoke` como smoke command unico para doctor/schema/backup/readiness y brief real opcional bajo `--send-brief --execute`.
- `npm run ceo:backup-check -- --json` valida herramientas de backup/restore y politica de artefactos locales sensibles antes de produccion real.

## Fase 3 - Arquitectura modular

Objetivo: que nuevas capacidades no hagan mas fragil el proyecto.

- Dividir `server/routes.ts` por dominio:
  - `routes/tasks`
  - `routes/ceo`
  - `routes/telegram` - iniciado con `server/telegram-routes.ts`
  - `routes/finance`
  - `routes/revenue`
  - `routes/clippers`
  - `routes/integrations`
- Dividir agentes grandes en submodulos internos:
  - contratos/types
  - persistence
  - renderers
  - commands
  - tests por feature
- Mantener `npm run check`, `npm run build` y suites focalizadas como gate antes de merge/deploy.
- Frontend: rutas principales cargan por lazy loading para evitar que herramientas pesadas como Clippers y Revenue Engine inflen el bundle inicial.

## Fase 4 - CEO Operating System diario

Objetivo: que el asistente no sea solo herramientas, sino rutina ejecutiva.

Estado: parcial. Telegram ya soporta comandos deterministas de rutina (`top 3`, `bloqueos`, `a quien tengo que perseguir`, `cerrar dia`) alimentados por el mismo snapshot del brief CEO.

- Convertir follow-ups/commitments en Delegation OS:
  - owner
  - due date
  - status
  - blocked reason
  - escalation rule
  - last touch
- Brief diario debe producir:
  - top 3 prioridades
  - aprobaciones pendientes
  - riesgos nuevos
  - follow-ups vencidos
  - una recomendacion concreta de foco
- Dashboard CEO debe priorizar acciones sobre informacion.
- Telegram debe soportar comandos de rutina:
  - `top 3` - implementado localmente
  - `que bloqueo hay` - implementado localmente como `bloqueos`
  - `a quien tengo que perseguir` - implementado localmente
  - `aprobar/rechazar`
  - `cerrar dia` - implementado localmente

## Fase 5 - Multiusuario y hardening

Objetivo: escalar sin fugas de datos ni jobs duplicados.

Estado: parcial. `DEFAULT_USER_ID` ya no autentica requests ni auto-vincula chats Telegram desconocidos; Telegram webhook tiene dedupe persistente por `update_id`; auth local y webhook Telegram tienen rate limit persistente para reducir diferencias entre instancias; backup/restore tiene preflight local.

- Eliminar `DEFAULT_USER_ID` de rutas request-bound.
- Jobs siempre deben resolver owners desde config/subscription.
  - Scheduler diario ya descubre owners desde Telegram habilitado y push subscriptions; `DEFAULT_USER_ID` queda solo como fallback single-user si no hay owners.
  - Startup task dedupe ya descubre owners desde Telegram configs habilitadas y solo cae a `DEFAULT_USER_ID` cuando no hay owners configurados.
  - Promo video daily scheduler ya descubre owners desde Telegram configs habilitadas y pasa `userId` explicito a los uploads de Google Drive.
- Completar ownership checks por ID en rutas heredadas.
  - Portfolio summary/gains/rebalance/opportunities/report y test manual de market update ya usan el usuario autenticado y tienen prueba de regresion.
  - DJ contact update/delete/message ya verifican el owner antes de operar y tienen prueba de regresion.
  - Monitored project read/update/delete/check/logs/incidents ya verifican el owner antes de operar y tienen prueba de regresion.
  - Weekly summary update ya verifica el owner antes de mutar por id y tiene prueba de regresion.
  - Clippers daily plan, bootstrap, account setup/manual posting/production queue, credenciales/plataforma/OAuth, imports/records/render/automation y permisos/fuentes/trends/external execution request-bound ya reciben el usuario autenticado y tienen prueba de regresion.
  - Reportes guardados de Clippers ya persisten `userId`; `/api/clippers/reports/:id` exige el usuario autenticado antes de devolver un reporte y tiene pruebas de regresion.
- Mover rate limit y Telegram dedupe de memoria a Postgres o Redis.
  - Telegram dedupe movido a Postgres con fallback en memoria.
  - Rate limit de auth local y Telegram webhook movido a Postgres con fallback en memoria.
- Agregar backup/restore probado para Postgres y artefactos locales importantes.
  - Preflight local implementado con `ceo:backup-check`.
  - Falta ejecutar backup real y prueba de restore contra entorno de produccion/staging.
