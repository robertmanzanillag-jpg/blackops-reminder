# Paquete de Shorts motivacionales

Estos quince manifests contienen guiones originales para piezas de 20-40 segundos: cinco en espanol y diez concebidos directamente en ingles. Los guiones ingleses no son traducciones literales de los espanoles; los cinco extra en ingles son buffer editorial para elegir mejores piezas, no permiso para pasar el limite diario. No contienen citas, discursos, celebridades, podcasts, promesas de riqueza o salud, ni material externo.

Los manifests en espanol usan `channelId: "motivation-es"` y `language: "es"`. Los manifests en ingles usan `channelId: "motivation-en"` y `language: "en"`. El gate editorial declara explicitamente un hook en el primer segundo, una accion concreta y `noQuotaFiller: true`: si un futuro candidato no alcanza ese nivel, se rechaza en vez de rellenar una cuota.

Los campos de voz son marcadores deliberados:

- `voice.file` apunta a una ruta que empieza con `PLACEHOLDER_`.
- `voice.rightsEvidenceFile` apunta a una evidencia todavía inexistente.
- `voice.sha256` contiene 64 ceros, un marcador que satisface únicamente la forma del campo.

No se debe renderizar ni publicar ningun manifest en este estado. Primero Robert debe grabar una voz local de 20-40 segundos en el idioma correspondiente, guardar el archivo dentro del workspace, calcular su SHA-256 y crear la evidencia de derechos correspondiente. Los quince manifests ya pasan los gates de esquema, idioma, canal, seguridad y calidad; el renderer falla cerrado unicamente porque falta la voz local indicada.
