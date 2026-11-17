# ADR-0024 Carrito local: store externo ligero sobre Context, clave de línea determinista, localStorage v2 y revalidación con las lecturas de F17

**Estado**: **propuesta** (2026-11-16, F18). Se acepta al fusionar `specs/019-shopping-cart`.

**Contexto**: el carrito del UI First guarda `{productId, quantity, note}` en `monsushi-cart-v1`, no transporta extras de F12, no conoce la sucursal ni revalida precios (`specs/019-shopping-cart/spec.md` §1). El DBML no tiene carrito persistente; F19 cotizará en servidor y F20 creará pedidos.

## Decisión

1. **Estado**: se mantiene React Context + store externo con `useSyncExternalStore` (`createPersistedStore`, ya usado por `order-mode`). No se añade zustand/redux/jotai: el proyecto no los tiene, el estado es un documento pequeño, y `useSyncExternalStore` ya resuelve snapshot de servidor, suscripción y tearing. Alternativa descartada: librería de estado (dependencia nueva sin necesidad medida).
2. **Línea**: datos de confianza (`productId`, `quantity`, `selections {groupId, optionId, quantity}`, `branchId` del carrito) separados de presentación (nombre, slug, imagen, precio provisional en centavos, nombres de opciones). `lineId` = hash de 128 bits de una clave canónica ordenada (producto, sucursal, nota, selecciones); se recalcula siempre al leer. Se rechaza usar el índice o un `uuid` aleatorio: no unifica configuraciones idénticas.
3. **Persistencia**: `monsushi-cart-v2` con lectura estricta (corrupto → vacío + aviso), TTL 7 días, v1 no se migra (sin sucursal ni extras), evento `storage` para sincronizar pestañas, anónimo del navegador (sin vínculo a cuenta), sin sync a backend. Cross-device exigiría tabla y endpoints: fuera de alcance (P32).
4. **Sucursal única**: el carrito pertenece a una sucursal; cambiar exige plan visible y confirmación; jamás se vacía en silencio.
5. **Revalidación**: sin endpoint nuevo; menú completo de la sucursal (`useStoreMenu`) para precio/disponibilidad y ficha por slug de productos únicos (`useStoreProduct`) para modificadores, con las claves y `staleTime` de F17; no se revalida al cambiar cantidades. Las selecciones nunca se alteran solas.
6. **Dinero**: centavos enteros; los importes `"85.00"` se convierten por cadena. Las cifras del carrito son provisionales; promociones solo informativas (no se duplica `PromotionEvaluator` de F15).
7. **Contrato F19**: esquemas `CartQuoteSelectionInput`, `CartQuoteLineInput`, `CartQuoteInput` en `packages/contracts` (compartidos con la futura API), sin operación; `toQuoteInput` los produce sin precios ni nombres.

## Consecuencias

- Los productos agregados antes de F18 (v1) se pierden con aviso (una vez).
- El carrito no vincula cuentas: en un dispositivo compartido lo ve quien abra el navegador hasta el TTL o hasta vaciarlo.
- Hasta F19 el total es una estimación y el checkout sigue simulado; el mock nunca confirma pedidos reales.
- Peor caso de revalidación: ≤ 30 fichas (tope de líneas); un endpoint por lote queda como mejora opcional (P37).
- Las e2e que siembran v1 deben migrar a v2.
- Riesgo aceptado: el carrito anónimo es visible para cualquier cuenta que use el mismo navegador (las notas pueden contener PII; TTL 7 días; aviso en la ficha; «Vaciar pedido»).
- El checkout simulado no envía `selections`: F20 debe construir el pedido desde `toQuoteInput` (con `expectedBranchId`); `clearAfterOrder` se añade en F20 con un identificador de pedido confirmado por el servidor.
