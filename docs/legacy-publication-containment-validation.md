# Corrección legacy aislada — verificación

Base UI: `7aa4e02756e0ce5dfb56d51bf160f8d3df1decf5`.
Checkout nuevo: `.local/worktrees/legacy-publication-containment`.
Rama: `fix/legacy-publication-containment-isolated`.
Main observado, sin cambios rastreados: `bf64e573aa787933f95343824fbc284ac9bb432d`.

## Alcance implementado

- `desiredEnabled`: únicamente el booleano `true` habilita.
- Bridge con autorización dedicada default-off, aprobación desactivada explícitamente, control existente habilitado, cola local habilitada y job elegible. No se configuró ningún flag.
- Veto antes de credenciales Metricool y antes de preflight, POST, reintentos y confirmaciones.
- Incertidumbre y recibos parciales conservados; ningún error de transporte permite reset automático. Un veto positivamente confirmado antes del envío se persiste como `blocked`, sin degradar incertidumbre anterior.
- Recibos verificados independientes de fallos auxiliares de metadata/limpieza. Uploads en vuelo, bloqueados o inciertos excluidos de la caducidad automática.
- Registro de defaults y búsqueda para runs solo consultan definiciones existentes: no crean ni reactivan.
- Analítica comprueba definiciones activas antes de sync; conserva cuentas/config y polling diario existente. Ausentes/pausadas/disabled no generan runs ficticios.
- Mundo 3D sin GET automático BlackRoom; fuente explícitamente no disponible. Autenticación y permisos intactos.

## Verificación y evidencia

Entorno operativo eliminado con `env -i`. Solo se proporcionaron PATH, HOME temporal, NODE_ENV y la ruta al Chromium ya instalado. Los objetos de autorización del test son fixtures en memoria, no secretos ni configuración del proceso.

- 35 pruebas de contención: pasan; 0 fallos finales.
- 9 unitarios existentes del mundo 3D: pasan; sin cambios posteriores al código que miden.
- 156 comprobaciones del renderer integrado, 7 escenarios: pasan. Escritorio, móvil, movimiento reducido, fallback sin WebGL, fuente denegada, sesión expirada e inventario grande.
- Todas las peticiones del navegador interceptadas; 0 escapes y 0 errores de navegador.
- TypeScript completo: pasa (`--noEmit --incremental false`).
- Compilación estática completa de cliente, servidor y compactor: pasa; recursos SQL copiados como archivos, nunca ejecutados. Advertencia de chunks grandes de Vite no bloqueante.
- No se ejecutó el script ordinario de build, su instalación opcional pip ni los bundles resultantes. `script/build-containment-static.mjs` conserva el grafo cliente completo y obtiene la allowlist de dependencias del build existente.
- Adapters reales de DB, storage, audit, métricas y IO operativo sustituidos antes de cargar módulos de test; fetch real prohibido. Reloj y timers de analítica inyectados.
- No se corrió indiscriminadamente la suite histórica que inicia listeners, usa FS operativo o importa DB real.

Logs finales: `.local/containment-tests/{unit-final,types-final,build-final,renderer-final}.log`.
Capturas offline revisadas: `.local/agents-world-harness/{desktop,mobile}.png`.

En la primera pasada fallaron cuatro pruebas por un ID inválido del fixture y un chequeo de tipos del contrato de flags. Ambos corregidos; no hay fallos finales.

## Revisión independiente

Revisión solo lectura del diff crudo intermedio:
`0c740a9f8516273dfcea23886797f653dde5b66f941be043b41153db48e58eb7`.
Original preservado en `.local/containment-tests/raw-review.diff`.

Encontró pérdida de incertidumbre tras fallos auxiliares, veto inicial imposible de reanudar, caducidad de uploads retenidos y un falso positivo del harness. Corregidos y cubiertos por pruebas del endpoint, cleanup y catch reales del worker extraídos mediante AST, más la regresión integrada final.

No se solicitó una segunda revisión independiente; no se afirma aprobación independiente del diff final.

## Límites explícitos

- Sin prueba de runtime, tablas, credenciales, colas o proveedores reales.
- La cola autoritativa local del backend debe existir y ser elegible. Un resumen remoto no autoriza; ausencia/error cierra el bridge.
- Definiciones ausentes siguen ausentes. Bootstrap explícito puede quedar pendiente; no se añadió uno nuevo.
- Retención de uploads sigue siendo local al proceso existente; no se creó almacenamiento duradero ni pipeline de conciliación. Los retenidos pueden permanecer indefinidamente y requieren resolución segura posterior.
- Una llamada ya enviada puede ser aceptada antes de observar una pausa. Se conserva incertidumbre; no se promete cancelar solicitudes ni publicaciones externas.
- No se afirma contención universal de servicios, canales alternativos, tokens o despliegues previos.
- No startup, restart, cambios de workflows, DB/proveedores reales, lectura/cambio de secretos, instalación de paquetes, activación, publicación, push, merge ni PR.
- Directorio y rama UI anteriores preservados, incluso con `.git` ausente: no prune, reset, clean ni reparación.
