---
name: Legacy publication reconciliation
description: Safety tradeoff for pre-dispatch blocks, uncertain results and retained uploads.
---

Un resultado incierto debe reconciliarse con el proveedor; una pausa o un error de transporte no demuestra que no se publicó. La prueba de veto antes del envío debe distinguirse de la incertidumbre de un envío anterior.

**Why:** La revisión independiente detectó que confundir errores auxiliares con rechazos podía duplicar publicaciones, y que confundir un veto inicial con incertidumbre impedía reanudar.

**How to apply:** No autorizar reenvíos basándose en errores HTTP genéricos. Conservar las pruebas confirmadas aunque fallen las escrituras auxiliares.

Los uploads retenidos por bloqueo/incertidumbre no deben caducar automáticamente sin conciliación segura, aunque ello implique retención indefinida.

**Why:** El usuario exigió conservar uploads y recibos al pausar. Se priorizó evitar pérdida de evidencia sobre liberar espacio automáticamente; no se autorizó crear un pipeline nuevo de conciliación.

**How to apply:** Tratar la gestión de espacio y la conciliación operativa como decisiones explícitas posteriores, no como permiso para borrar evidencia o activar publicaciones.
