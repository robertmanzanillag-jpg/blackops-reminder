# CEO Assistant Runbook

Guia operativa para dejar BlackOps funcionando como CEO Assistant con Telegram como canal principal.

## 1. Variables requeridas

Usa `CEO_ASSISTANT_ENV.example` como plantilla para produccion.

Minimo para API/app:

- `DATABASE_URL`: conexion PostgreSQL usada por Drizzle.
- `AI_INTEGRATIONS_GEMINI_API_KEY`: requerida para chat del app y chat de Telegram.
- `DEFAULT_USER_ID`: usuario single-user explicito para system jobs en produccion hasta conectar auth real.
- `ALLOW_DEV_USER_FALLBACK`: recomendado `false` en produccion para evitar `mock-user-123`.
- `SESSION_SECRET`: requerida para login con sesion en produccion.
- `LOCAL_AUTH_ENABLED`: usar `true` para activar auth local username/password en produccion.
- `ALLOW_LOCAL_AUTH_REGISTRATION`: usar `true` solo para crear usuario local inicial; apagar despues de crear el usuario.

Minimo para Telegram:

- `TELEGRAM_BOT_TOKEN`: token del bot.
- `PUBLIC_APP_URL` o `TELEGRAM_WEBHOOK_URL`: URL publica HTTPS que apunta al app.
- `TELEGRAM_WEBHOOK_SECRET`: secret token para validar `x-telegram-bot-api-secret-token`.

Scheduler:

- `SCHEDULER_TIMEZONE`: default `America/New_York`.
- `CEO_BRIEF_HOUR`: default `7`.
- `CEO_BRIEF_MINUTE`: default `0`.
- `INSIGHTS_HOUR`: default `8`.
- `NEWS_DIGEST_HOUR`: default `9`.
- `EVENING_REVIEW_HOUR`: default `21`.

Opcionales utiles:

- `FINNHUB_API_KEY`: noticias/market data.
- `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`, `ZOHO_REFRESH_TOKEN`: Zoho Calendar.
- `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`: push notifications.

## 2. Configurar Telegram

Antes de tocar produccion, puedes imprimir el checklist completo:

```bash
npm run ceo:doctor -- --user-id=<real-user-id> --chat-id=<telegram-chat-id>
```

Para un preflight automatizable en CI/deploy:

```bash
npm run ceo:doctor -- --user-id=<real-user-id> --chat-id=<telegram-chat-id> --json
```

1. Crear bot en Telegram con BotFather y guardar `TELEGRAM_BOT_TOKEN`.
2. Definir `PUBLIC_APP_URL=https://tu-dominio.com` o `TELEGRAM_WEBHOOK_URL=https://tu-dominio.com/api/telegram/webhook`.
3. Definir `TELEGRAM_WEBHOOK_SECRET`.
4. Levantar el servidor.
5. Enviar `/start` al bot.
6. Configurar el chat desde la app, endpoint de Telegram config, o CLI:
   `npm run telegram:configure -- --user-id=<real-user-id> --chat-id=<telegram-chat-id> --execute`.
   Si acabas de enviar `/start`, tambien puedes usar:
   `npm run telegram:configure -- --user-id=<real-user-id> --latest --execute`.
7. Validar status desde CLI: `npm run telegram:webhook -- status`.
8. Registrar webhook desde la app, `POST /api/telegram/setup-webhook`, o CLI: `npm run telegram:webhook -- setup --execute`.

## 3. Validar readiness

Desde API:

- `GET /api/telegram/health`: valida token, IA, chat, webhook, secret, scheduler y readiness de brief/chat.
- `GET /api/ceo/readiness`: valida auth, IA, Telegram, webhook secret y scheduler en una sola respuesta.
- `GET /api/ceo/conversation-history?limit=6`: valida que el chat web y Telegram comparten historial CEO reciente.
- `GET /api/auth/me`: valida si hay sesion activa.
- `npm run ceo:readiness -- --user-id=<real-user-id>`: valida readiness sin depender del frontend.
- `npm run ceo:doctor -- --user-id=<real-user-id> --chat-id=<telegram-chat-id> --json`: preflight parseable para env/auth/scheduler/Telegram.
- `npm run telegram:configure -- --user-id=<real-user-id> --chat-id=<telegram-chat-id> --execute`: vincula Telegram al owner real.
- `npm run telegram:configure -- --user-id=<real-user-id> --latest --execute`: vincula el ultimo chat que envio `/start`.
- `npm run telegram:webhook -- status`: valida URL registrada, URL esperada, pendientes y ultimo error.

Desde Telegram:

- `health` o `estado sistema`: diagnostico tecnico de Telegram.
- `readiness` o `estado CEO`: readiness agregado del CEO Assistant.
- `brief`, `resumen`, `agenda`, `prioridades`: contexto CEO actual.
- `pendientes`: acciones esperando aprobacion.
- `aprobar ID` / `rechazar ID`: aprobar o bloquear acciones sensibles.

## 4. Validar brief matutino

1. Confirmar `SCHEDULER_TIMEZONE`, `CEO_BRIEF_HOUR` y `CEO_BRIEF_MINUTE`.
2. Confirmar que `GET /api/telegram/health` tenga `readyForBriefs: true`.
3. Probar envio manual con `POST /api/telegram/test-ceo-brief`.
4. Probar envio manual desde terminal con `npm run ceo:send-brief -- --user-id=<real-user-id> --execute`.
5. Confirmar llegada del mensaje en Telegram.
6. Validar que no se trunque: mensajes largos se dividen automaticamente.

## 5. Smoke test local

Ejecutar:

```bash
npm run test:ceo-assistant
```

Cubre:

- Auth boundary y callbacks publicos.
- Ownership de alertas/manual tests/Zoho/market updates para evitar acciones sobre el usuario equivocado.
- CEO readiness.
- CEO doctor/checklist.
- Scheduler diario y anti-duplicados.
- Formato del brief CEO.
- Comandos Telegram, historial compartido, dedupe de webhook y particion de mensajes largos.

## 6. Criterio operativo de listo

El sistema esta listo para operar como CEO Assistant single-user cuando:

- `/api/ceo/readiness` responde `status: "ready"`.
- `npm run ceo:readiness -- --user-id=<real-user-id>` termina con exit code 0.
- `/api/telegram/health` responde `readyForBriefs: true` y `readyForChat: true`.
- `/api/ceo/conversation-history` muestra mensajes recientes despues de conversar desde web o Telegram.
- `npm run test:ceo-assistant` pasa completo.
- `POST /api/telegram/test-ceo-brief` envia el brief real.
- `npm run ceo:send-brief -- --user-id=<real-user-id> --execute` envia el brief real desde CLI.
- En Telegram, `readiness`, `health`, `brief`, `pendientes`, `aprobar ID` y `rechazar ID` responden correctamente.
- Una conversacion iniciada en Telegram aparece como contexto reciente cuando continuas desde el chat del app, y viceversa.

## 7. Pendientes antes de produccion multiusuario

- Conectar proveedor real de auth para poblar `req.user` o `req.session.userId`.
- Si usas auth local temporal: configurar `SESSION_SECRET`, `DATABASE_URL`, `LOCAL_AUTH_ENABLED=true`, crear el usuario con `npm run auth:create-user -- --username=<username> --password=<password> --print-user-id`.
- Usar el id impreso para migrar datos: `npm run user:migrate -- --from=mock-user-123 --to=<real-user-id> --execute`.
- Mantener `ALLOW_LOCAL_AUTH_REGISTRATION=false` en produccion; el registro web queda solo para emergencias controladas.
- Si el backend responde 401, el frontend muestra la pantalla de acceso local para login/registro.
- Migrar datos de `mock-user-123` al usuario real.
- Completar ownership por ID en rutas heredadas que todavia no fueron auditadas fuera del camino CEO/Telegram.
- Agregar tests de integracion con storage mockeado para `handleTelegramMessage`, scheduler y endpoints `/api/ceo`.
- Rate limiting y dedupe inicial por `update_id` existen para auth local/webhook Telegram en una sola instancia; si escalas a multiples instancias, mover rate limits y dedupe a Redis/Postgres.
- Agregar observabilidad de jobs/webhooks y backups.

## 8. Migrar datos del usuario dev

Antes de conectar auth real, auditar datos actuales:

```bash
npm run user:migrate -- --from=mock-user-123 --to=<real-user-id>
```

Ese comando es dry-run: imprime cuantas filas se moverian por tabla y bloquea conflictos en tablas de configuracion unica.

Para aplicar:

```bash
npm run user:migrate -- --from=mock-user-123 --to=<real-user-id> --execute
```

Despues de aplicar:

- Configurar `DEFAULT_USER_ID=<real-user-id>`.
- Poner `ALLOW_DEV_USER_FALLBACK=false`.
- Revisar `/api/ceo/readiness`.
- Enviar `readiness` en Telegram.
- Ejecutar `npm run test:ceo-assistant`.
