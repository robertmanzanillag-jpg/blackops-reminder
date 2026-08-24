# Clippers: paquete inicial de motivación

Este paquete editorial incluye quince guiones originales, pensados para narraciones de 20-40 segundos y video vertical 9:16: cinco en espanol y diez concebidos directamente en ingles. El objetivo operativo sigue siendo producir hasta cinco por canal por dia cuando cinco candidatos pasan todos los gates; los candidatos extra en ingles sirven como buffer editorial, no como permiso para publicar mas de cinco.

| Manifest | Tema | Acción final |
| --- | --- | --- |
| `motiva-disciplina-001.json` | Disciplina sin depender de las ganas | Completar veinte minutos de una tarea pendiente |
| `motiva-rechazo-001.json` | Convertir el rechazo en información | Mejorar algo concreto y volver a intentar |
| `motiva-miedo-001.json` | Avanzar sin esperar certeza total | Completar el paso seguro más pequeño |
| `motiva-consistencia-001.json` | Sostener un mínimo diario | Definir y completar el mínimo del día |
| `motiva-empezar-tarde-001.json` | Empezar sin compararse | Terminar hoy el primer paso |
| `motivate-discipline-001.json` | Discipline without waiting for motivation | Run a twenty-minute focused start |
| `motivate-rejection-001.json` | Turning rejection into signal | Make one concrete improvement and try again |
| `motivate-fear-001.json` | Shrinking fear into a measurable step | Complete the smallest safe action |
| `motivate-consistency-001.json` | Building a repeatable minimum | Finish the minimum action before day end |
| `motivate-late-start-001.json` | Starting without comparison | Complete the first honest step today |
| `motivate-focus-001.json` | Protecting focused attention | Work on one priority for twenty minutes |
| `motivate-patience-001.json` | Continuing through slow progress | Record one improvement and return tomorrow |
| `motivate-self-trust-001.json` | Making a thoughtful independent decision | Own one small decision without reopening it |
| `motivate-setback-001.json` | Learning from one poor result | Apply one lesson in the next attempt |
| `motivate-fresh-start-001.json` | Resetting without waiting for a special date | Begin one clean action within five minutes |

Los conceptos en ingles no son traducciones literales de los guiones espanoles: usan temas, desarrollo y acciones escritos directamente para `motivation-en`.

Cada guion sigue la estructura exigida por `script/clippers-motivation-shorts.mjs`: conflicto especifico en `hook`, desarrollo de la idea en `beats` y una accion practica en `close`. Los guiones ES pertenecen al canal estable `motivation-es`; los EN pertenecen a `motivation-en`. Todos se declaran `owned_original`, sin fuentes externas, citas, discursos, celebridades, podcasts, voces clonadas ni promesas de riqueza o salud.

Los quince superan el gate editorial explicito: hook inmediato, cierre accionable, revision identificada y `noQuotaFiller: true`. Una pieza futura que no pase esos criterios debe rechazarse y no reemplazarse por contenido debil para completar una cuota.

## Estado de los manifests

Los JSON de `examples/clippers-motivation/` son validos en esquema, canal, idioma, seguridad y calidad editorial, pero **no estan listos para render ni publicacion**. Los tres campos de voz son placeholders explicitos:

- `voice.file`: ruta `PLACEHOLDER_RECORD_LOCAL_VOICE/...`.
- `voice.rightsEvidenceFile`: ruta `PLACEHOLDER_ADD_RIGHTS_EVIDENCE/...`.
- `voice.sha256`: 64 ceros para conservar la forma requerida, no el hash de un archivo real.

El renderer falla cerrado únicamente porque la grabación señalada no existe. No genera ni publica nada y devuelve `voice_missing_or_unsafe`. No se debe crear un audio vacío o sintético para superar este gate.

## Activación segura por cada Short

1. Robert graba localmente la lectura del guion, sin imitar a terceros, y confirma que dura entre 20 y 40 segundos.
2. Se guarda el audio dentro del workspace de ejecución, por ejemplo `input/motiva-disciplina-001.wav`.
3. Se calcula el SHA-256 real del archivo:

   ```bash
   shasum -a 256 input/motiva-disciplina-001.wav
   ```

4. Se reemplazan la ruta placeholder y los 64 ceros en el manifest.
5. Se crea la evidencia JSON indicada en `docs/clippers-motivation-shorts.md`, con el mismo `shortId`, archivo y SHA-256; `speakerConsent` y `commercialUseAuthorized` deben ser verdaderos y verificables.
6. Se ejecuta el renderer local. Este verificará archivo, hash, evidencia, audio-only, duración, resolución, duplicados y límites de volumen.
7. Se revisan visualmente inicio, centro y final antes de cualquier decisión separada de publicación.

La existencia de este paquete no autoriza publicar. El renderer mantiene `publishEnabled: false`, costo API USD 0 y un limite tecnico de cinco renders por `channelId` por dia en America/New_York.

## Validación estática

La forma editorial de los quince manifests puede validarse sin crear archivos ni modificar la suite de pruebas:

```bash
node --input-type=module -e 'import { readdir, readFile } from "node:fs/promises"; import path from "node:path"; import { validateManifestShape } from "./script/clippers-motivation-shorts.mjs"; const dir = "examples/clippers-motivation"; const files = (await readdir(dir)).filter((name) => name.endsWith(".json")).sort(); for (const name of files) { const file = path.join(dir, name); const manifest = JSON.parse(await readFile(file, "utf8")); const blockers = validateManifestShape(manifest); if (blockers.length) throw new Error(`${file}: ${blockers.join(",")}`); console.log(`OK ${file}`); }'
```
