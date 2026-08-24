# Paquete de Shorts motivacionales

Estos diez manifests contienen guiones originales para piezas de 20-40 segundos: cinco en espanol y cinco en ingles. No contienen citas, discursos, celebridades, podcasts, promesas de riqueza o salud, ni material externo.

Los manifests en espanol usan `channelId: "motivation-es"` y `language: "es"`. Los manifests en ingles usan `channelId: "motivation-en"` y `language: "en"`. El gate editorial declara explicitamente un hook en el primer segundo, una accion concreta y `noQuotaFiller: true`: si un futuro candidato no alcanza ese nivel, se rechaza en vez de rellenar una cuota.

Los campos de voz son marcadores deliberados:

- `voice.file` apunta a una ruta que empieza con `PLACEHOLDER_`.
- `voice.rightsEvidenceFile` apunta a una evidencia todavía inexistente.
- `voice.sha256` contiene 64 ceros, un marcador que satisface únicamente la forma del campo.

No se debe renderizar ni publicar ningún manifest en este estado. Primero Robert debe grabar una voz local de 20–40 segundos, guardar el archivo dentro del workspace, calcular su SHA-256 y crear la evidencia de derechos correspondiente. Los manifests ya pasan los gates de esquema, idioma, canal, seguridad y calidad; el renderer falla cerrado únicamente porque falta la voz local indicada.
