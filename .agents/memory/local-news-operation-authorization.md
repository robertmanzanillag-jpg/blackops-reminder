---
name: Local news operation authorization
description: Safety-only scope, pending destination verification and approval needed before live news operation.
---

Solo preparar cambios de seguridad y fiabilidad para los agentes de noticias de Miami/New York. No publicar ni activar operación real sin autorización nueva. Preservar el hotfix de timeouts de Metricool, el resto de la app, todos los historiales/rechazos/intentos y los posts remotos existentes.

**Why:** el usuario pidió este alcance expresamente; preparar código local no puede detener una versión ya publicada.

**How to apply:** ejecutar pruebas aisladas con transportes simulados, sin credenciales reales. No reiniciar el servidor completo para verificar: arranca otros agentes. No hacer reenvíos ni editar/borrar posts remotos.

La identidad de Miami sigue pendiente de verificación; New York no tiene Facebook conectado según la inspección del 2026-10-06. Seleccionar un brand manualmente no prueba identidad, conexión ni permisos. Permisos desconocidos bloquean.

**Why:** el usuario no autoriza confiar en etiquetas o IDs de brand para enviar noticias.

**How to apply:** antes de cualquier futura activación, verificar destino y permiso real con evidencia actual. No inferir derechos de publicación de simpleProfiles si no informa permisos.

La operación futura deseada es cinco noticias verificadas diarias por cuenta, con métricas reales. No está autorizada su activación.

**Why:** el usuario separó explícitamente la meta futura de estas correcciones de seguridad.

**How to apply:** no aumentar actividad ni prometer publicaciones para cumplir una cuota. Una programación aceptada no es una publicación comprobada.

Los registros y locks locales no coordinan instancias de Autoscale. La pausa incorporada en la versión preparada debe seguir cerrada hasta contar con coordinación y conciliación durables compartidas.

**Why:** una respuesta incierta puede corresponder a un post aceptado remotamente; otro proceso sin el mismo registro podría reenviarlo.

**How to apply:** antes de levantar la pausa, resolver coordinación entre instancias y conciliación de intentos históricos. Nunca reintentar a ciegas.
