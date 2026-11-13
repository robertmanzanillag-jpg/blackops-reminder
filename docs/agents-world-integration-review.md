# Integración local aislada del mundo 3D

## Alcance y estado

- Rama: `integration/agents-world-3d-local`.
- Checkout separado: `.local/worktrees/agents-world-3d` dentro del workspace principal.
- Base: `bbcc86842ff27b24e8f616c06475251c38e243a0`.
- HEAD final: consultar `git rev-parse HEAD` en este checkout; el identificador se entrega también en el resumen de la integración.
- No se modificó ni se cambió de rama el checkout que usa la aplicación real.
- No se ejecutaron workflows, Express, schedulers, workers, consultas DB, APIs reales, proveedores ni lectura de valores secretos.
- No se instaló software ni se cambiaron package.json, lock, backend, shared, auth, bridges, schedulers o configuración de publicación.
- Sin push, merge, PR remoto o publicación. KONG no fue modificado.
- Republicación bloqueada: este trabajo no resuelve la contención de consumidores antiguos de Metricool.

## Verificación del paquete

ZIP: `agents-world-review_1791508482339.zip`, 1.027.633 bytes.

SHA256:
`82fd50ab9cc8067baef1dcf3e93f88e043d1ebb6462036a7ffaed138f7dd2d3c`

Se verificaron tamaños y SHA256 de las 26 entradas del manifest antes de crear la rama. No se extrajo ni aplicó el parche completo, la página anterior del paquete, package.json o lock.

Módulos transferidos:

| Archivo | SHA256 verificado de origen | SHA256 final |
| --- | --- | --- |
| `client/src/components/agents-world-scene.tsx` | `c8cdbca7be40950929f23496e14e292d785ed73f6d471a95f1656a617b154969` | `ddc96c15c7a16416521d2829d935d33fa8b1600e75bd621c9f2ea26cfd6091e0` |
| `client/src/lib/agents-world.ts` | `e8e0ae9e80d3ca05d1aaf8cbee6c6d5ce621c81515a2c33050e514cead143162` | Igual al origen |
| `client/src/lib/agents-world-layout.ts` | `0c561e52d83ca21926529bd3941e78b3102692fceff24f07158b8ef29e5b04be` | Igual al origen |
| `client/src/lib/agents-world-learning.ts` | `c6f30ff9b5ea567d36bd6de5f865c4e70f34b443e1f422cf420b4fdac5d9e4df` | Igual al origen |

Única adaptación del renderer: comprobar que el ID del objeto seleccionado es string antes de usarlo. No cambia transportes, ejecución ni controles.

## Conexión real con la página existente

```text
App.tsx (sin cambios)
  /agents-office -> pages/agents-office.tsx (sin cambios)
    CompanyOffice key={ownerId}
      AgentsWorldOffice key={ownerId} ownerId={ownerId} suspended={!running}
        lazy AgentsWorldScene del paquete verificado
```

El montaje en CompanyOffice añade únicamente un import y una línea JSX. Conserva campus/simulación original, controles, navegación, metas y almacenamiento separado por usuario.

El centro anterior permanece bajo demanda, `showLive=false` inicialmente. El harness no pulsa su botón y aborta cualquier consulta prohibida.

La vista nueva tiene selección por etiquetas, selector y lista accesible; filtros; ficha de fuente/evidencia; cámara orbital, zoom, desplazamiento y teclado; movimiento decorativo explícito; reduced-motion; fallback WebGL y límite de estaciones. Los roles de contenido siguen No conectado. Nunca se infiere ejecución desde animaciones, online, desiredEnabled o tareas marcadas completadas.

## Lecturas y contratos revisados por fuente

- `/api/auth/me`: `server/local-auth.ts:151–176`. Requiere `authenticated === true` y `user.id === ownerId` antes de iniciar lecturas del mundo.
- `/api/projects`: `server/routes.ts:7181–7188`; storage filtra `userId`. El adaptador vuelve a filtrar los registros por propietario y solo proyecta identidad, nombre, descripción, salud y fechas. Salud del sitio no implica trabajo de un agente.
- `/api/tasks`: `server/routes.ts:843–849`, `server/storage.ts:238–244`. Registros filtrados por `userId`; títulos/fechas y completed son registros de agenda, no resultados de agentes.
- `/api/blackroom-agent`: `server/blackroom-control-routes.ts:319–320,347–353`. Owner-only del servidor; lee panel local/remoto. El cliente proyecta únicamente señal/eventos/decisiones reportadas; denegación permanece visible y no se intenta otro acceso.
- `/api/monthly-goals`: consulta ya existente de CompanyOffice, no se añadió al transporte del mundo. Se conserva su validación HTTP/id/title/completed y revisión previa del filtro por usuario.

No se añade ningún otro transporte. Se abortan solicitudes anteriores al desmontar o actualizar; se descarta el lote ante denegación de proyectos/tareas. La clave por usuario evita conservar datos al cambiar de sesión. Fuentes vacías, errores, denegación y señales obsoletas no se presentan como éxito operativo.

GET no garantiza ausencia de efectos: las sesiones nativas pueden tocar persistencia. Ninguno de estos GET fue llamado contra la aplicación real en este trabajo.

## Verificación ejecutada

Todos los comandos se ejecutaron dentro del checkout aislado, con entorno vacío excepto PATH/HOME/NODE_ENV y, para el navegador, el path del Chromium ya instalado. No se usaron credenciales.

1. `node --import tsx --test tests/agents-world-integration.test.ts`: **9/9** pruebas unitarias puras, sin IO operativo.
2. `node script/build-agents-world-client.mjs`: **build cliente completo aprobado** con la página real y renderer diferido.
3. `node .../typescript/lib/tsc.js --noEmit --incremental false --pretty false`: **aprobado**, sin errores.
4. `AGENTS_WORLD_BROWSER=<Chromium instalado> node tests/agents-world-integrated-ui.mjs`: **143 checks, 7 escenarios aprobados**. Escritorio, móvil, reduced-motion/arrays vacíos, fallback WebGL, owner denegado, sesión expirada e inventario de 1.000 proyectos.
5. `... node tests/agents-world-integrated-ui.mjs --smoke`: **23 checks aprobados después de la adaptación del renderer**, incluyendo selección por etiqueta y actualización de ficha.
6. `git diff --check`: aprobado.
7. Diff protegido contra la base: sin cambios en server, shared, package/lock, App, página de Office, helpers auth/storage, CSS original o `.replit`.

El harness compila e importa la página actual, no la página del ZIP. Playwright intercepta **todas** las solicitudes: HTML, JS, CSS y fixtures API sobre un origen ficticio `.invalid`. No abre un listener HTTP, no usa Express ni un dev server. Cualquier URL externa, método no GET o API no prevista se aborta y falla la prueba. Las 143 comprobaciones registraron cero escapes de red y cero errores de página.

Evidencia local ignorada por Git:

- `.local/agents-world-harness/results.json`: siete escenarios, requests y resultados.
- `.local/agents-world-harness/results-smoke.json`: comprobación final del renderer adaptado.
- `.local/agents-world-harness/desktop.png` y `mobile.png`: capturas de fixtures, no de producción.
- `.local/agents-world-client-build/`: artefactos compilados del cliente.

## Fallos iniciales resueltos

- Build alternativo inicial: descubrió PostCSS del proyecto. Se desactivó su descubrimiento **solo en el script alternativo** y se usó el plugin Tailwind ya instalado. Ningún cambio de configuración global.
- Primera pasada de navegador: selector demasiado estricto para la meta original, que contiene un prefijo visual. Se corrigió el selector de prueba, no la UI.
- TypeScript inicial: faltaban declaraciones para Three/OrbitControls. Se añadió un contrato local explícito de la API utilizada, sin instalar @types ni introducir un módulo any.

Si se autoriza incorporar declaraciones completas de Three en el futuro, reemplazar el contrato local; no combinar dos declaraciones de las mismas clases.

El build mantiene avisos de chunks grandes, incluido Three (~520 kB minificado, ~131 kB gzip), en su chunk lazy. No se cambió el umbral ni se ocultaron warnings.

## No ejecutado / no demostrado

- `npm run build`: su script intenta instalar dependencias Python con pip; prohibido por esta solicitud. Se utilizó el build alternativo exclusivo del cliente.
- Startup o reinicio real, backend build/execution, DB, proveedores, API reales, auth con cuentas reales, publicaciones o comprobación de producción.
- Benchmark físico móvil: Chromium usa WebGL2 software; los límites de render no son una certificación de hardware.
- El registro Git Published no prueba el artefacto activo; no se consultó ni alteró despliegue en esta integración.
