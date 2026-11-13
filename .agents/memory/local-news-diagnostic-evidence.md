---
name: Local news diagnostic evidence
description: Limits on claims about live source health and why observability must not change news operation.
---

No atribuir fallos a fuentes concretas ni certificar cobertura reciente a partir de cifras agregadas de ciclos. Los errores antiguos sin identidad registrada no se pueden reconstruir retrospectivamente.

**Why:** una inspección de producción encontró ciclos terminados con errores de fuentes, pero sus registros solo conservaban el total de errores; no existía evidencia para identificar cuáles habían fallado.

**How to apply:** diferenciar datos reales observados por fuente, datos ausentes y pruebas con transportes simulados. Las pruebas aisladas no demuestran que los conectores de producción funcionen.

Los diagnósticos son observabilidad opcional, no un nuevo requisito para ingerir noticias. No cambiar el diseño de agentes ni sus controles de entrega al añadirlos.

**Why:** el usuario limitó la actualización a diagnóstico, manteniendo la funcionalidad existente; una avería del almacenamiento de telemetría no debe convertirse en una avería de ingesta.

**How to apply:** informar explícitamente los fallos de diagnóstico sin detener ingesta. No confundir candidatos fechados extraídos con aportes nuevos aceptados; el filtrado, la deduplicación y la traducción pueden descartarlos.
