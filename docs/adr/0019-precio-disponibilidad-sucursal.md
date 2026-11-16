# ADR-0019 Precio y disponibilidad por sucursal: tabla de excepciones, overlay público con caché de 15 s y servicio reutilizable en servidor

**Estado**: **propuesta** (2026-11-15, F13). Se acepta al fusionar `specs/014-branch-pricing-availability`.

**Contexto**: el catálogo es global (F11 `base_price`; F12 modificadores globales). El DBML define `app.branch_products (branch_id, product_id, price_override, available)` sin stock. F17 (agregados) y F19 (cotización) necesitan precio efectivo y
disponibilidad por sucursal; la web simula hoy la disponibilidad en `/v1/demo/catalog/*`. F13 no invade F14, F15, F17 ni F19.

## Decisión

1. **Tabla de excepciones**: `app.branch_products` (migración `0014`) con las columnas del DBML + `created_at`/`updated_at`, PK `(branch_id, product_id)`, `CHECK price_override IS NULL OR (> 0 AND <= 999999.99)`, FKs `RESTRICT` a `branches` y `products`, índice por `product_id`, RLS sin políticas.
   **Ausencia de fila = disponible al precio base**; la fila existe solo con override o `available=false`, y la API la elimina al volver al estado por defecto. Así los productos y sucursales nuevos funcionan sin sembrar datos. Alternativa descartada: materializar el producto cartesiano
   sucursal×producto (crece con cada alta y exige mantenimiento).
2. **Sin stock numérico**: «agotado» = `available=false`. El DBML no contempla inventario; añadir cantidades obligaría a decidir reservas, concurrencia y kardex (fuera de alcance, riesgo de «prometer stock»).
3. **Precio efectivo en servidor**: `coalesce(price_override, base_price)` en SQL (`numeric`), expuesto como cadena decimal `"85.00"` (como ADR-0017). El cliente nunca es fuente de verdad. El precio de modificadores permanece global (ADR-0018); opciones por sucursal quedan fuera.
4. **Overlay público ligero** `GET /v1/store/menu?branchId=` en vez de enriquecer `listStoreProducts` con parámetro de sucursal: mantiene intacta y cacheable (60 s) la lista de F11, evita multiplicar entradas de caché por texto/categoría/página y limita el payload a `productId, slug, price, available`.
   No expone precio base ni si hay override (no se filtran precios de otra sucursal; cada respuesta es de una sola sucursal). Solo productos visibles (F11) y sucursal activa (404 si no). La web combina las dos lecturas; F17 ofrecerá el agregado.
5. **Caché e invalidación sin infraestructura nueva**: `Cache-Control: public, max-age=15`, sin `stale-while-revalidate` ni `ETag`. La caché HTTP no puede invalidarse; «invalidar» significa ventana de obsolescencia ≤ 15 s más `invalidateQueries` de TanStack Query en la web. No se añade Redis, colas ni webhooks. La caché
   es informativa: el servidor revalida en checkout. Se acepta que un cliente vea un producto agotado como disponible hasta 15 s.
6. **Autorización por sucursal con permisos existentes** (ADR-0010): lectura `catalog.read`; precio `catalog.update`; disponibilidad `catalog.manage_availability`; todas con `AuthorizationService.canAccess(staff, permiso, branchId)`; fuera de alcance = 404 (no se revela existencia; patrón F07/F08);
   la matriz por producto filtra con `scopeFor`. A diferencia de F11/F12 (catálogo global ⇒ alcance global), aquí el alcance es **por sucursal**. Consecuencia: el encargado puede marcar agotados en su sucursal, pero fijar precios exige `catalog.update` (por defecto solo `admin`).
7. **Escritura atómica sin lock global**: `INSERT … ON CONFLICT DO UPDATE` modificando solo la columna escrita + `DELETE` condicional de la fila por defecto, en una transacción `ReadCommitted`, con auditoría en la misma transacción (`branch_product.price_set|price_cleared|availability_changed`, sin PII). Idempotente (sin cambios ⇒ 200 sin
   escribir ni auditar). Último en escribir gana (un campo por operación; sin versión optimista). `BRANCH_PRODUCTS_BUSY` (503) solo por timeout/bloqueo de la transacción.
8. **Errores**: 400 para toda forma de precio inválida (coherente con ADR-0017/0018); 422 `BRANCH_PRICE_INVALID` solo para `"0.00"` (bien formado, ≤ 0). 404 `BRANCH_NOT_FOUND`/`PRODUCT_NOT_FOUND`. Los clientes ramifican por `code`.
9. **Servicio reutilizable** `BranchOffersService` (exportado por `BranchProductsModule`): `resolve(branchId, productIds[])` → `Map<productId,{price, basePrice, available}>` en una consulta, y `assertOrderable(branchId, productIds[])` → 422 `PRODUCT_NOT_AVAILABLE` con `violations` por producto
   (`PRODUCT_UNKNOWN`, `PRODUCT_HIDDEN`, `PRODUCT_SOLD_OUT`). Un producto no visible públicamente (inactivo o categoría oculta) nunca es ordenable aunque tenga fila; esta es la verdad en checkout, no la caché del menú. Sin endpoint ni lógica de checkout en F13: F17 consume `resolve`; F19 consume ambos en cada cotización.
10. **Fronteras de módulo**: `src/branch-products/` depende de `CategoriesModule` (visibilidad) y `AuthModule`; `ProductsModule` y `ModifiersModule` no cambian y no dependen de él (sin ciclos). Un producto desactivado en F11 deja de ofertarse en todas las sucursales sin tocar `branch_products`.

## Consecuencias

- Hasta 15 s de desfase visible en el menú público tras un cambio; el checkout nunca lo hereda. Si negocio exige inmediatez, habría que pasar a `no-store` + ETag o a una caché invalidable (nueva ADR).
- Un override igual al precio base se conserva y «congela» el precio de la sucursal frente a cambios del base; si no se desea, el administrador lo elimina con `priceOverride: null`.
- `available=false` no distingue «agotado hoy» de «no se vende en esta sucursal». Separar ambos requeriría una columna adicional (cambio de esquema posterior).
- La tabla solo crece con excepciones (≲ catálogo × sucursales). Sin índice por `(branch_id, available)`: la PK basta a esta escala.
- **Desviaciones de la migración 0014 respecto al DBML** (reportadas por database-engineer; el DBML no se edita): se añaden `created_at`/`updated_at` (`timestamptz`, `DEFAULT now()`; la API mantiene `updated_at` en el `ON CONFLICT DO UPDATE`, sin trigger); `CHECK` de rango del override (`NULL` o `0 < x <= 999999.99`); FKs con `ON DELETE RESTRICT ON UPDATE CASCADE` explícito (el DBML no indica acción); tope práctico 999999.99 aunque `numeric(12,2)` admita más. **No se creó el índice `(branch_id, available)`**: la PK `(branch_id, product_id)` cubre las consultas por sucursal y el único índice adicional es `(product_id)`; reevaluar si la tabla crece por órdenes de magnitud o aparece un filtro frecuente por `available` sin sucursal.
- **Implementación de la API** (`sushimon-api/src/branch-products/`): `BranchProductsRepository` con SQL propio (el repositorio de productos solo exporta el helper `folded` de búsqueda); `AdminBranchProductsService` (matrices y escrituras), `BranchMenuQueryService` (overlay), `BranchOffersService` (`resolve`/`assertOrderable`, exportado, sin endpoint). `assertOrderable` hace tres lecturas en paralelo (sucursal, categorías visibles F10, `resolve`) y no dos, porque la comprobación de sucursal activa es una lectura independiente.
- F20 (pedidos) guardará snapshot de precio; no habrá FK de pedidos a `branch_products`.
- La web retira la disponibilidad simulada (`/v1/demo/catalog/products/:id/availability`) y el campo `available/availability` del extra simulado; el resto de extras demo (ilustración, destacado, textos EN) sigue simulado.
- La migración 0014 debe aplicarse antes de desplegar la API de F13.
- **Contrato para F19/F20**: `resolve` es SOLO precio/disponibilidad (`price`, `basePrice`, `available`; sin `offered`, sin visibilidad); F19 cobra `price`, nunca `basePrice`. `assertOrderable` es el único punto de decisión de «ordenable» (lista vacía/no arreglo/>200 => 422 `PRODUCT_NOT_AVAILABLE`, violaciones `productIds[i]`). TOCTOU: F20 recalcula precio y disponibilidad dentro de la transacción del pedido o documenta la ventana; el pedido guarda snapshot de precio (sin FK a `branch_products`); nunca se aceptan precios del cliente; los modificadores se validan aparte (`ModifierSelectionService`).
- **Sucursales inactivas**: el alcance GLOBAL puede configurar precio/disponibilidad de sucursales inactivas; el empleado acotado no (sus `grants` solo incluyen sucursales activas; 404 `BRANCH_NOT_FOUND`).
- **Estado previo**: `findRow` usa `FOR NO KEY UPDATE` en la transacción de escritura (decisión de no-op y valores `old` de auditoría consistentes; una fila por transacción, sin deadlock con el upsert por PK).
- **Orden de despliegue**: aplicar la migración 0014 ANTES de desplegar la API; el menú público responde 500 si falta (sin captura de error ni cambios en `/v1/health/ready`). Línea para el PR: «Despliegue: aplicar la migración 0014_branch_products antes de desplegar la API.»

## Alternativas descartadas

Stock numérico/kardex; filas materializadas por cada combinación; parámetro `branchId` en `listStoreProducts`; invalidación por Redis/webhook; `no-store` en el menú; permiso nuevo por sucursal; lectura admin que distinga «fuera de alcance» de «inexistente»; ocultar productos con 404 en vez de `available=false`.
