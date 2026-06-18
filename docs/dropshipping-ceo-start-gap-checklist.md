# Dropshipping CEO start gap checklist

Estado: el agente ya esta implementado en modo pre-cuentas. Esta lista resume lo que falta para empezar a operarlo con cuentas reales sin mezclar secretos ni acciones externas no aprobadas.

## Ya esta listo

- Area `/dropshipping-ceo` en la app.
- Engine `server/dropshipping-ceo.ts` con Product Scout, Supplier Analyst, Store Builder, Marketing CMO, Profit Guard, Growth Board, approvals y reportes.
- Producto foco inicial: `Pet water bottle for walks`.
- Launch pack draft con copy, posts organicos y preflight de Shopify.
- Readiness gate para Postgres, checkout, producto/proveedor, politicas y automatizacion.
- Approval outbox local cuando Trust Center/Postgres no esta activo.
- Migracion de approval outbox local a pending approvals del Trust Center.
- Politicas publicas draft:
  - `/dropshipping/legal/privacy`
  - `/dropshipping/legal/refund-policy`
  - `/dropshipping/legal/shipping-policy`
  - `/dropshipping/legal/terms`
  - `/dropshipping/legal/checkout-readiness`
- Tests focalizados en `tests/dropshipping-ceo.test.ts`.

## Falta para operar real

1. Conectar Shopify.
   - Configurar `SHOPIFY_SHOP_DOMAIN`.
   - Configurar `SHOPIFY_ADMIN_ACCESS_TOKEN`.
   - Crear el producto como `DRAFT`, no publicar directo.

2. Conectar Postgres/Trust Center.
   - Configurar `DATABASE_URL`.
   - Ejecutar `npm run db:push`.
   - Correr `npm run ceo:db-check -- --json`.
   - Migrar approvals locales primero con dry-run.

3. Conectar Telegram.
   - Configurar `TELEGRAM_BOT_TOKEN`.
   - Vincular chat real del usuario.
   - Validar reporte test antes de depender de reportes diarios.

4. Definir proveedor.
   - Elegir proveedor primario y backup.
   - Confirmar rating, reviews, tracking, stock, return path y shipping range real.
   - Comprar sample solo con approval y dentro del budget permitido.

5. Cerrar checkout y politicas.
   - Store name, support email, legal entity si aplica y URLs finales.
   - Payment processor en test mode o live mode.
   - Shipping, tax, refund/cancel y order confirmation probados.

6. Conectar social/manual publishing.
   - Mantener publishing manual si no hay webhook confiable.
   - Publicar primer contenido organico solo con approval.
   - Mantener ads en `$0` hasta tener tracking y senal organica.

## Primer dia operativo recomendado

1. Abrir `/dropshipping-ceo` y revisar `Execution` + `Approvals`.
2. Conectar Shopify y generar draft del producto.
3. Conectar Postgres y migrar approvals locales.
4. Probar Telegram con un reporte manual.
5. Revisar proveedor primario/backup.
6. Aprobar solo contenido organico inicial.
7. Medir views, clicks, add-to-cart, ordenes, spend, refunds y comentarios.

## Guardrails que no se deben apagar

- No comprar inventario.
- No publicar producto real sin draft revisado.
- No gastar en ads sin tracking, cap diario y approval.
- No contactar proveedor, publicar social, comprar sample ni fulfill sin approval.
- No prometer shipping exacto sin evidencia.
- No usar claims medicos, marcas ajenas ni guarantees absolutas.

## Comandos utiles

```bash
npm run test:dropshipping-ceo
npm run build
npm run ceo:db-check -- --json
```

## Siguiente decision de Robert

La decision principal no es escribir mas codigo. Es elegir el orden de conexion:

1. Shopify + Postgres primero si queremos preparar la tienda.
2. Telegram + approvals primero si queremos control operativo.
3. Proveedor + sample primero si queremos validar calidad antes de publicar.
