# Clippers: paquete inicial de motivación

Este paquete editorial incluye cinco guiones originales en español, pensados para narraciones de 20–40 segundos y video vertical 9:16:

| Manifest | Tema | Acción final |
| --- | --- | --- |
| `motiva-disciplina-001.json` | Disciplina sin depender de las ganas | Completar veinte minutos de una tarea pendiente |
| `motiva-rechazo-001.json` | Convertir el rechazo en información | Mejorar algo concreto y volver a intentar |
| `motiva-miedo-001.json` | Avanzar sin esperar certeza total | Completar el paso seguro más pequeño |
| `motiva-consistencia-001.json` | Sostener un mínimo diario | Definir y completar el mínimo del día |
| `motiva-empezar-tarde-001.json` | Empezar sin compararse | Terminar hoy el primer paso |

Cada guion sigue la estructura exigida por `script/clippers-motivation-shorts.mjs`: conflicto específico en `hook`, desarrollo de la idea en `beats` y una acción práctica en `close`. Todos pertenecen al canal estable en español `motivation-es`, se declaran `owned_original`, sin fuentes externas, citas, discursos, celebridades, podcasts, voces clonadas ni promesas de riqueza o salud.

Los cinco superan el gate editorial explícito: hook inmediato, cierre accionable, revisión identificada y `noQuotaFiller: true`. Una pieza futura que no pase esos criterios debe rechazarse y no reemplazarse por contenido débil para completar una cuota.

## Estado de los manifests

Los JSON de `examples/clippers-motivation/` son válidos en esquema, canal, idioma, seguridad y calidad editorial, pero **no están listos para render ni publicación**. Los tres campos de voz son placeholders explícitos:

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

La existencia de este paquete no autoriza publicar. El renderer mantiene `publishEnabled: false`, costo API USD 0 y un límite técnico de un render diario y cinco en siete días.

## Validación estática

La forma editorial de los cinco manifests puede validarse sin crear archivos ni modificar la suite de pruebas:

```bash
node --input-type=module -e 'import { readFile } from "node:fs/promises"; import { validateManifestShape } from "./script/clippers-motivation-shorts.mjs"; for (const name of ["disciplina", "rechazo", "miedo", "consistencia", "empezar-tarde"]) { const file = `examples/clippers-motivation/motiva-${name}-001.json`; const manifest = JSON.parse(await readFile(file, "utf8")); const blockers = validateManifestShape(manifest); if (blockers.length) throw new Error(`${file}: ${blockers.join(",")}`); console.log(`OK ${file}`); }'
```
