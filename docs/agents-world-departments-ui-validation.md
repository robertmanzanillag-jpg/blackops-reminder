# Revisión UI aislada: departamentos y propuestas

## Alcance y procedencia

Base: `db7c230576a6a79a72e51a0f0131eb0c5499dd04`.
Checkout: `.local/worktrees/agents-world-departments-ui`.
Rama: `ui/agents-world-departments-isolated`.
Main observado antes y después de las pruebas:
`31ce1dd2132477500d8a8f49722fb878838d4f23`, rama
`fix/metricool-timeout-containment`; solo el adjunto nuevo sin seguimiento.
El commit final y sus hashes se incluyen en el manifiesto externo, evitando
una referencia circular dentro del propio commit.

## Cambios

- Doce departamentos funcionales conceptuales; no constituyen un organigrama real.
- Departamento y marca/proyecto independientes en datos, filtros y fichas.
- Correspondencia basada en registros propios; no se infiere KONG del nombre.
- Registros sin departamento declarado y reconocido quedan Desconocido.
  No se inventa una estación departamental: siguen en lista y selector.
- Se conservan las entradas previas del catálogo, roles de contenido,
  referencia KONG, Daily Planner y BlackRoom. Se añaden únicamente CTO y
  Entrenador/evaluador de IA, Propuesto / No conectado, sin enlace operativo,
  tarea, resultado o entrenamiento afirmado.
- Propuesta → pruebas → revisión independiente → despliegue autorizado:
  información descriptiva, no ejecución ni certificación de pasos cumplidos.
  Costes sin números inventados, presupuesto ni permiso de gasto.
- Se conserva autenticación, allowlist, frecuencia, BlackRoom sin GET
  automático, movimiento decorativo, reduced-motion, cámara, fallback y
  simulación previa. Sin nuevas rutas o proveedores.

## Pruebas

Ejecutadas con entorno de proceso vacío salvo PATH y, para el navegador,
la ruta explícita al Chromium ya instalado. Sin instalaciones ni carga de
archivos de entorno. El harness compila solo el cliente de prueba con
esbuild y sirve recursos mediante interceptación, sin listener HTTP.

| Comprobación | Resultado | Código de salida |
| --- | --- | --- |
| `node --import tsx --test tests/agents-world-integration.test.ts` | PASS, 11 pruebas | 0 |
| `node node_modules/typescript/bin/tsc --noEmit --incremental false` | PASS | 0 |
| `node tests/agents-world-integrated-ui.mjs` | PASS, 240 checks / 7 escenarios | 0 |
| `git diff --check` | PASS | 0 |

Escenarios: escritorio, móvil, reduced-motion, fallback sin WebGL, fuentes
denegadas, sesión caducada e inventario grande. Comprueban filtros combinados,
roles propuestos sin acción, estados desconocidos, fuentes, cambio de owner,
ausencia de overflow y mantenimiento del montaje real de CompanyOffice.
Todas las solicitudes del navegador son interceptadas; cero APIs reales,
cero servidores iniciados y cero errores de navegador en el pase final.
Capturas offline de escritorio y móvil examinadas como evidencia local;
no se contactó la app real para capturarlas.

Tres intentos iniciales de navegador fallaron: título antiguo en el harness,
nombre accesible del nuevo select y selector CTO ambiguo por el texto
“proyecto”. Se corrigieron y conservaron los logs completos con EXIT_CODE=1.
Los logs finales llevan EXIT_CODE=0; no se presentan los intentos como PASS.
El export incluye resultados finales y todos esos logs.

No ejecutadas: backend/contención, build de producción, app real, DB,
proveedores, workflows, startup/restart, publicación, push, merge o PR.

## Revisión pequeña del diff final

Revisión local del diff: cinco módulos UI existentes, dos pruebas UI,
este informe y una aclaración de alcance en memoria existente.
Sin cambio de backend, shared, scripts operativos, configuración, paquetes,
lockfiles, flags, secretos, permisos o frecuencia.
Se revisó conservación del catálogo previo, roles honestos, no inferencia
de actividad, clasificación desconocida, filtros independientes y controles
accesibles. No se presenta esta revisión local como aprobación independiente.

El manifiesto externo compara OIDs de árboles y blobs protegidos entre base
y final, y compara los bytes del backend y scripts versionados del checkout
contra sus blobs base. Eso acredita igualdad; no equivale a ejecutar backend
ni a certificar un runtime publicado.

El export se genera desde objetos Git del commit, incluyendo diff crudo,
fuentes finales, preimágenes y hashes SHA-256 por archivo. Base64 plano
decodificado y cotejado con el ZIP. Activación/despliegue quedan al padre.
