---
name: Diagnóstico seguro de sesiones publicadas
description: Evidencia de destino activo y límites de los controles de sesiones que deben ser solo de lectura.
---

Antes de proponer cambios de base de datos, confirmar mediante lecturas el destino y esquema realmente usados por el almacén del runtime y su relación con la réplica consultada. Una consulta a la réplica administrada no sustituye esa confirmación. Si falta el canal de lectura del runtime, informar el bloqueo y preparar solo un procedimiento condicional.

**Why:** el usuario exigió esta comprobación antes de pedir autorización; el resultado anterior de ausencia en réplica no acreditaba por sí solo el destino activo.

**How to apply:** distinguir metadata de configuración, referencia de código de una publicación y evidencia del proceso activo. No tratar nombres de base iguales ni huellas de esos nombres como identificadores únicos del recurso.

No instanciar un almacén de sesiones ni reproducir un login/cookie para una investigación que prohíbe escrituras sin comprobar sus efectos automáticos.

**Why:** la creación automática de tabla, el guardado/touch de sesiones y la limpieza de expiradas pueden ejecutar escrituras durante comprobaciones que aparentan ser de lectura.

**How to apply:** usar catálogos y consultas SELECT desde un canal aprobado que no inicialice middleware nuevo; pedir autorización separada para pruebas de persistencia. Distinguir errores de conexión, tabla no resoluble y recursos SQL ausentes, sin ocultar ninguno.
