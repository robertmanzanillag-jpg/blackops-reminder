# CEO Assistant Runbook

Guia operativa para dejar BlackOps funcionando como CEO Assistant con Telegram como canal principal.

## 1. Variables requeridas

Usa `CEO_ASSISTANT_ENV.example` como plantilla para produccion.

Minimo para API/app:

- `DATABASE_URL`: conexion PostgreSQL usada por Drizzle.
- `AI_INTEGRATIONS_GEMINI_API_KEY`: requerida para chat del app y chat de Telegram.
- `DEFAULT_USER_ID`: usuario single-user explicito para system jobs en produccion; no autentica requests web/API.
- `ALLOW_DEV_USER_FALLBACK`: recomendado `false` en produccion para evitar `mock-user-123`.
- `SESSION_SECRET`: requerida para login con sesion en produccion; usa un secreto real aleatorio de al menos 32 caracteres.
- `LOCAL_AUTH_ENABLED`: usar `true` para activar auth local username/password en produccion.
- `ALLOW_LOCAL_AUTH_REGISTRATION`: usar `true` solo para crear usuario local inicial; apagar despues de crear el usuario.

Minimo para Telegram:

- `TELEGRAM_BOT_TOKEN`: token del bot.
- `PUBLIC_APP_URL` o `TELEGRAM_WEBHOOK_URL`: URL publica HTTPS que apunta al app.
- `TELEGRAM_WEBHOOK_SECRET`: secret token real, no placeholder, para validar `x-telegram-bot-api-secret-token`.

Scheduler:

- `SCHEDULER_TIMEZONE`: default `America/New_York`.
- `CEO_BRIEF_HOUR`: default `7`.
- `CEO_BRIEF_MINUTE`: default `0`.
- `INSIGHTS_HOUR`: default `8`.
- `NEWS_DIGEST_HOUR`: default `9`.
- `EVENING_REVIEW_HOUR`: default `21`.

Backup/restore:

- `CEO_BACKUP_DIR`: directorio local donde se preparan dumps y artefactos antes de moverlos a storage externo.
- `CEO_BACKUP_SECRETS_ENCRYPTED`: usar `true` solo si `credentials/` y `secrets/` estan cubiertos por backup cifrado fuera de la maquina.

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

`ceo:doctor` falla si detecta placeholders, secretos cortos, URL publica que no sea HTTPS, fallback dev habilitado o `DEFAULT_USER_ID` diferente al `--user-id` revisado.

Para correr el smoke test operativo completo sin enviar mensajes reales:

```bash
npm run ceo:smoke -- --user-id=<real-user-id> --chat-id=<telegram-chat-id>
```

Para incluir un brief real de Telegram dentro del smoke test:

```bash
npm run ceo:smoke -- --user-id=<real-user-id> --chat-id=<telegram-chat-id> --send-brief --execute
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
- `npm run ceo:db-check -- --json`: valida que el schema operativo exista en Postgres.
- `npm run ceo:backup-check -- --json`: valida herramientas de backup/restore, directorio destino y politica de artefactos sensibles.
- `npm run ceo:smoke -- --user-id=<real-user-id> --chat-id=<telegram-chat-id>`: preflight operacional combinado de doctor, schema, backup/restore y readiness sin enviar brief.
- `npm run ceo:smoke -- --user-id=<real-user-id> --chat-id=<telegram-chat-id> --send-brief --execute`: preflight combinado y envio real de brief CEO.
- `npm run telegram:configure -- --user-id=<real-user-id> --chat-id=<telegram-chat-id> --execute`: vincula Telegram al owner real.
- `npm run telegram:configure -- --user-id=<real-user-id> --latest --execute`: vincula el ultimo chat que envio `/start`.
- `npm run telegram:webhook -- status`: valida URL registrada, URL esperada, pendientes y ultimo error.
- El webhook no auto-vincula chats desconocidos a `DEFAULT_USER_ID`; un chat nuevo debe conectarse con el panel web o `telegram:configure`.

Desde Telegram:

- `health` o `estado sistema`: diagnostico tecnico de Telegram.
- `readiness` o `estado CEO`: readiness agregado del CEO Assistant.
- `brief`, `resumen`, `agenda`, `prioridades`: contexto CEO actual.
- `top 3` o `foco`: tres prioridades principales.
- `bloqueos` o `riesgos`: atascos operativos detectados.
- `a quien tengo que perseguir`: follow-ups vencidos y compromisos abiertos.
- `cerrar dia`: checklist ejecutivo para terminar el dia.
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

## 6. Schema y multiinstancia

Antes de correr mas de una instancia del backend, aplicar el schema en Postgres:

```bash
npm run db:push
npm run ceo:db-check -- --json
```

Esto crea/actualiza tablas operativas como:

- `telegram_processed_updates`: deduplica `update_id` de Telegram entre instancias.
- `app_rate_limit_buckets`: comparte rate limits de auth local y webhook Telegram entre instancias.

Si esas tablas aun no existen, el backend cae temporalmente a memoria y registra un warning, pero eso no protege completamente contra duplicados o abuso entre procesos.

## 7. Backup y restore

Antes de operar con datos reales, confirmar que el entorno puede respaldar y restaurar:

```bash
npm run ceo:backup-check -- --json
```

El chequeo requiere:

- `DATABASE_URL` configurado.
- Herramientas `pg_dump`, `pg_restore`, `psql` y `tar` disponibles.
- `CEO_BACKUP_DIR` escribible.
- Si existen `credentials/` o `secrets/`, `CEO_BACKUP_SECRETS_ENCRYPTED=true` despues de configurar backup cifrado fuera de la maquina.

El reporte imprime comandos auditables para:

- Crear el directorio de backup.
- Exportar Postgres con `pg_dump --format=custom`.
- Empaquetar artefactos locales no sensibles.
- Probar conexion con `psql`.
- Restaurar con `pg_restore --clean --if-exists`.

No guardes dumps ni artefactos sensibles en git. El directorio local debe ser una parada temporal antes de mover el respaldo a storage cifrado.

## 8. Criterio operativo de listo

El sistema esta listo para operar como CEO Assistant single-user cuando:

- `/api/ceo/readiness` responde `status: "ready"`.
- `npm run ceo:readiness -- --user-id=<real-user-id>` termina con exit code 0.
- `npm run ceo:db-check -- --json` termina con exit code 0.
- `npm run ceo:backup-check -- --json` termina con exit code 0.
- `npm run ceo:smoke -- --user-id=<real-user-id> --chat-id=<telegram-chat-id>` termina con exit code 0.
- `/api/telegram/health` responde `readyForBriefs: true` y `readyForChat: true`.
- `/api/ceo/conversation-history` muestra mensajes recientes despues de conversar desde web o Telegram.
- `npm run test:ceo-assistant` pasa completo.
- `POST /api/telegram/test-ceo-brief` envia el brief real.
- `npm run ceo:send-brief -- --user-id=<real-user-id> --execute` envia el brief real desde CLI.
- En Telegram, `readiness`, `health`, `brief`, `pendientes`, `aprobar ID` y `rechazar ID` responden correctamente.
- Una conversacion iniciada en Telegram aparece como contexto reciente cuando continuas desde el chat del app, y viceversa.

## 9. Pendientes antes de produccion multiusuario

- Conectar proveedor real de auth para poblar `req.user` o `req.session.userId`.
- Si usas auth local temporal: configurar `SESSION_SECRET`, `DATABASE_URL`, `LOCAL_AUTH_ENABLED=true`, crear el usuario con `npm run auth:create-user -- --username=<username> --password=<password> --print-user-id`.
- Usar el id impreso para migrar datos: `npm run user:migrate -- --from=mock-user-123 --to=<real-user-id> --execute`.
- Mantener `ALLOW_LOCAL_AUTH_REGISTRATION=false` en produccion; el registro web queda solo para emergencias controladas.
- No dependas de `DEFAULT_USER_ID` para autenticar requests web/API; en produccion el usuario debe venir de sesion local o de un proveedor que llene `req.user`/`req.session`.
- Si el backend responde 401, el frontend muestra la pantalla de acceso local para login/registro.
- Migrar datos de `mock-user-123` al usuario real.
- Completar ownership por ID en rutas heredadas que todavia no fueron auditadas fuera del camino CEO/Telegram; portfolio, DJ contacts, monitored projects, weekly summaries y acciones Clippers de cuenta/credenciales/plataforma/imports/records/render/automation/permisos/fuentes/trends ya cubren operaciones por id/accion con usuario autenticado.
- Agregar tests de integracion con storage mockeado para `handleTelegramMessage`, scheduler y endpoints `/api/ceo`.
- Rate limiting de auth local y webhook Telegram ya usa Postgres cuando `app_rate_limit_buckets` existe; confirmar `npm run db:push` antes de escalar.
- Dedupe de Telegram por `update_id` ya usa Postgres cuando `telegram_processed_updates` existe; confirmar `npm run db:push` antes de escalar.
- El scheduler diario procesa owners descubiertos por Telegram habilitado y push subscriptions; `DEFAULT_USER_ID` queda como fallback single-user.
- La deduplicacion de tareas al arrancar procesa owners con Telegram habilitado y usa `DEFAULT_USER_ID` solo como fallback single-user.
- Promo video daily scheduler procesa owners con Telegram habilitado y usa `DEFAULT_USER_ID` solo como fallback single-user para uploads a Drive.
- Mantener una prueba periodica de restore usando el dump generado por el proceso validado en `ceo:backup-check`.

## 10. Migrar datos del usuario dev

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
