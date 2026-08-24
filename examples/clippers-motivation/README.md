# Paquete de Shorts motivacionales

Estos cinco manifests contienen guiones originales en español para piezas de 20–40 segundos. No contienen citas, discursos, celebridades, podcasts, promesas de riqueza o salud, ni material externo.

Todos usan el identificador estable `channelId: "motivation-es"` y `language: "es"`. El gate editorial declara explícitamente un hook en el primer segundo, una acción concreta y `noQuotaFiller: true`: si un futuro candidato no alcanza ese nivel, se rechaza en vez de rellenar una cuota.

Los campos de voz son marcadores deliberados:

- `voice.file` apunta a una ruta que empieza con `PLACEHOLDER_`.
- `voice.rightsEvidenceFile` apunta a una evidencia todavía inexistente.
- `voice.sha256` contiene 64 ceros, un marcador que satisface únicamente la forma del campo.

No se debe renderizar ni publicar ningún manifest en este estado. Primero Robert debe grabar una voz local de 20–40 segundos, guardar el archivo dentro del workspace, calcular su SHA-256 y crear la evidencia de derechos correspondiente. Los manifests ya pasan los gates de esquema, idioma, canal, seguridad y calidad; el renderer falla cerrado únicamente porque falta la voz local indicada.
