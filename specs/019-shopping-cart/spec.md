# F18 — Carrito local y su contrato de datos

**Rama**: `feature/F18-shopping-cart` (desde `develop` con F00–F17) · **Dueño**: A · **Prioridad**: P0 · **Tipo**: WEB principal (sin endpoint ni tabla de carrito)
**Dependencias**: F11, F12, F13 (contratos de catálogo), F17 (lecturas de menú y ficha); F01 opcional · **Decisiones**: `docs/adr/0024-carrito-local.md` · **Pendientes**: P30–P38 en `docs/business-rules/decisiones-pendientes.md`
**Estado global**: `CONTRACT_DEFINED` (esquemas de entrada de cotización en `openapi.yaml`; sin operación). La parte WEB está **implementada con datos simulados** (`MOCK_ONLY`; ver «Estado de implementación»); F18 **no es `READY`** mientras dependa solo del mock. El cálculo es SIEMPRE provisional. Sin migraciones ni cambios de API.

## Alcance y fuera de alcance

Dentro: modelo tipado de línea, store persistido v2, política de sucursal, revalidación contra F17, cálculo provisional en centavos, `toQuoteInput`, conexión de los componentes del carrito, pruebas.
Fuera: F19 (cotización, `POST /v1/checkout/quote`), F20 (pedidos), tabla o endpoints de carrito, persistencia entre dispositivos, envío/PedidosYa/pagos, motor de promociones (F15 `PromotionEvaluator` NO se duplica), rediseños.

## 1. Inventario del carrito actual (lectura de código)

| Pieza                                                                                                                 | Qué hace hoy                                                                                                                                                     | Veredicto                                                                                       |
| --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `features/cart/cart.ts`                                                                                               | Líneas `{productId, quantity 1–99, note ≤140}`; fusiona mismo producto + misma nota; `estimateSubtotal` con `number` y `Math.round(x*100)/100`; `parseCart` laxo | Reescribir (modelo, clave, parse estricto, centavos). Se reutilizan `MAX_QUANTITY=99` y la nota |
| `features/cart/cart-context.tsx`                                                                                      | `createPersistedStore` + `useSyncExternalStore` (servidor = `[]`) dentro de un Context; API por **índice** (`increment(i)`)                                      | Conservar el patrón; cambiar el API a `lineId` (el índice es frágil si la lista se reordena)    |
| `lib/persisted-store.ts`                                                                                              | SSR-safe (lee en el primer `get` del cliente), ignora errores de storage; sin evento `storage`, sin TTL, sin versión                                             | Ampliar (opción `crossTab`, `onInvalid`), sin romper `order-mode`                               |
| `product-sheet-host.tsx`                                                                                              | Valida modificadores (F12) y entrega `SheetAddPayload` con `modifiers`, pero **sin `onAdd` llama `cart.add(product.id, qty, note)` y DESCARTA los extras**       | Conectar: es el hueco principal de F18                                                          |
| `CartDrawer.tsx`, `menu-cart-bar/aside`, `OrderStep`, `use-checkout-data`                                             | Resuelven precio por `productId` contra `useProducts()` (menú) y suman `product.price * quantity` en `number`; líneas sin producto en el menú se **ocultan**     | Reescribir sobre el modelo nuevo; nunca ocultar una línea en silencio                           |
| `reorder-dialog.tsx` / `account/reorder.ts`                                                                           | Reordena con `{productId, quantity, note}`, `mergeIntoCart` por producto+nota; ids del mock                                                                      | Adaptar a `addConfigured`; los extras del pedido anterior llegan con F20/F23 (hoy no hay)       |
| `StoreHeader` / `MobileNav`                                                                                           | Contador `cart.count` (unidades)                                                                                                                                 | Ya cumple; se conserva                                                                          |
| `store-shell-context` (`CartDrawer` abierto/cerrado)                                                                  | Estado de UI efímero                                                                                                                                             | Ya cumple                                                                                       |
| `CheckoutFlow` → `cart.clear()` tras la confirmación simulada                                                         | Vacía al «confirmar»                                                                                                                                             | Se conserva como único `clear` tras F20; ver §7                                                 |
| Pruebas e2e (`a11y`, `checkout`, `branch-schedule`, `store-aggregates`, `visual/store-*`) siembran `monsushi-cart-v1` | Fixtures de v1                                                                                                                                                   | Actualizar a v2 (ver §3)                                                                        |

Qué se rompe con los contratos reales: (a) ids del mock (`dumplings`) frente a UUID de la API; la validación de lectura NO exige UUID (lo exige solo `CartQuoteInput` en F19/http); (b) las selecciones de F12 no viajan; (c) no hay sucursal en la línea: dos sucursales pueden tener precio distinto; (d) el precio se resuelve por `productId` pero una línea no revalida modificadores; (e) `Math.round` sobre `number` no es aritmética exacta.

## 2. Modelo de línea

Estado global: **se mantiene React Context + store externo `useSyncExternalStore` (ya en uso para carrito y `order-mode`)**; no se añade zustand/redux (el proyecto no los tiene: `package.json` solo trae TanStack Query). Razón: el carrito es un pequeño documento JSON con ≤ 30 líneas y pocas acciones; el store ya da snapshot de servidor estable, suscripción y selectores por derivación. Costo asumido: escribir a mano `subscribe`/evento `storage` (≈ 30 líneas).

### Datos de CONFIANZA (únicos que salen hacia el servidor)

`productId`, `quantity` (1–99), `selections: {groupId, optionId, quantity}[]`; a nivel carrito `branchId`. Nada más viaja a F19.

### Datos de PRESENTACIÓN (solo pintar; nunca autoridad)

`slug` (necesario para pedir la ficha), `name`, `imageUrl` (solo URL aprobada por `safeMediaUrl`, ≤ 500), `unitCents` (precio EFECTIVO provisional de la sucursal, sin extras, entero), `currency: 'GTQ'`, por selección `groupName`, `optionName`, `extraCents`, y `seenAt` (ms; cuándo se vio el precio). `note` (≤ 140, observaciones; no cambia el precio) es del cliente y viaja a F20, no a F19 (P35).

### Esquema persistido `monsushi-cart-v2`

```
{ v: 2, branchId: string|null, updatedAt: number,
  lines: [{ lineId, productId, slug, quantity, note,
            selections: [{groupId, optionId, quantity}],
            display: { name, imageUrl|null, unitCents, currency:'GTQ', seenAt,
                       options: [{groupId, optionId, groupName, optionName, extraCents}] } }] }
```

Sin tokens, sin datos de pago ni PII (la nota es texto libre ≤ 140: aviso en UI «no escribas datos personales o de pago»).

### `lineId` determinista

`lineId = 'l1_' + hash128(canonical)` con `canonical = productId | branchId | note normalizada (NFC, trim, espacios colapsados, minúsculas para comparar) | g:o:q ordenadas por groupId, optionId (comparación binaria)`. Es independiente del orden de selección y del orden de grupos. `hash128` = dos hashes de 53 bits no criptográficos con semillas distintas (colisión despreciable con ≤ 30 líneas; no es un secreto). **`lineId` nunca se confía al leer: se recalcula**; si difiere, se usa el recalculado. Configuraciones idénticas se unifican sumando cantidad (tope 99); configuraciones distintas (otra opción, otra nota) son líneas separadas. Aquí la clave incluye la nota (comportamiento del prototipo); `toQuoteInput` fusiona sin nota (§7).

### Límites (provisionales, P31)

Cantidad por línea 1–99; líneas ≤ 30; unidades totales ≤ 200; selecciones por línea ≤ 30; nota ≤ 140; JSON ≤ 64 KB (límite de lectura: más = corrupto). Agregar sobre un tope = rechazo con mensaje (`cart.limit*`), nunca recorte silencioso.

## 3. Persistencia

- **Clave `monsushi-cart-v2`**; la v1 NO se migra (no tiene sucursal, ni selecciones, ni slug; los ids pueden ser del mock): al primer arranque se elimina `monsushi-cart-v1` y, si tenía líneas, se muestra un aviso único y no bloqueante «actualizamos tu carrito; volvé a agregar tus productos» (P38).
- **Lectura estricta** (`parseCartV2`): JSON válido, `v===2`, tipos exactos, `quantity` entero 1–99, `selections` sin `groupId:optionId` repetidos, ids = cadenas `[A-Za-z0-9_-]{1,64}`, `unitCents`/`extraCents` enteros ≥ 0 ≤ 99 999 900, todas las líneas con el mismo `branchId` del carrito, tamaños y topes de §2. Cualquier incumplimiento del documento = **estado seguro vacío**, se borra la clave y se avisa («tu carrito guardado estaba dañado y se reinició»). Una línea inválida aislada en un documento válido se descarta y se cuenta en el aviso.
- **TTL 7 días desde `updatedAt`** (provisional, P30): razón, precios/disponibilidad y modificadores envejecen y los dispositivos compartidos no deben conservar pedidos viejos. Al expirar: vacío + aviso. `updatedAt` cambia solo con mutaciones del usuario, no con revalidación.
- **Limpieza**: `cart.clear()` (acción del usuario con confirmación) y `clearAfterOrder` NO existe todavía: F20 la añadirá con un identificador de pedido confirmado por el servidor (único camino que vacía tras un pedido REAL; el mock solo usa `clear()`). Fallo de `setItem` (cuota/privado): el estado sigue en memoria y se avisa una vez.
- **SSR/hidratación**: el servidor y el primer render del cliente usan `getServer() = EMPTY` (ya es así); el contenido real se lee tras montar mediante `useSyncExternalStore` y `useClientReady()` (existe en `features/store/client-ready.ts`). Contador y listas no se pintan con datos hasta `ready` (placeholder del mismo tamaño) para evitar parpadeo y mismatch.
- **Pestañas**: se escucha `window` `storage` (solo `key === v2`) y se vuelve a leer con la misma validación. Justificación: compra paralela en dos pestañas es común en móvil/escritorio y sin esto la segunda pisa a la primera. Último-escritor-gana (sin merge) por simplicidad; se anuncia con `aria-live` «el carrito se actualizó en otra pestaña».
- **Invitado vs sesión**: el carrito es **anónimo del navegador**, no se vincula a identidad (P33). Iniciar sesión no lo duplica ni lo vacía; cerrar sesión explícita tampoco lo borra (no hay PII dentro). Riesgo aceptado en dispositivo compartido: mitigado por TTL y el botón vaciar. Cambiar de cuenta no mezcla nada porque no hay vínculo; el cliente ve el mismo carrito local. Sin sync a backend.

## 4. Política de sucursal

El carrito pertenece a UNA sucursal (`cart.branchId`), la del modo de pedido cuando se agregó la primera línea.

- **Agregar con sucursal distinta**: si el carrito tiene líneas de otra sucursal, la acción abre un diálogo «Tu carrito es de {A}. ¿Cambiar a {B}?» con tres salidas: «Revisar y cambiar» (conserva las válidas), «Vaciar y empezar» (con confirmación) y «Cancelar». Nunca se vacía en silencio ni se mezclan sucursales.
- **Cambiar sucursal en el selector (`order-mode`)**: se calcula el plan de cambio (`planBranchSwitch(cart, menuNuevo, fichas)`, función pura) y se muestra un resumen por línea: se mantiene, precio cambió (antes → ahora), agotado, no vendido en la nueva, producto inactivo, opción o grupo inexistente / selección inválida. Opciones: «Conservar las válidas» (elimina solo las inválidas, listadas, con confirmación), «Mantener la sucursal anterior» (revierte el selector) o «Vaciar». Hasta confirmar, el carrito sigue asociado a la sucursal anterior.
- **Bloquean «Continuar»**: carrito vacío; cualquier línea `UNAVAILABLE`, `INACTIVE/NOT_FOUND`, `MODIFIER_INVALID`, `OPTION_UNAVAILABLE`, `BRANCH_MISMATCH`; revalidación `pending` o `error` (no se puede afirmar que sea válido); sucursal del carrito distinta a la del modo de pedido. `PRICE_CHANGED` NO bloquea pero exige que el cliente vea la diferencia («Entendido» actualiza y limpia el aviso).

## 5. Revalidación (reutiliza F17, sin endpoints nuevos)

- Estados por línea: `OK`, `PRICE_CHANGED`, `UNAVAILABLE` (`available=false`), `INACTIVE` / `NOT_FOUND` (no está en el menú de la sucursal o la ficha da 404 `PRODUCT_NOT_FOUND`), `MODIFIER_INVALID` (grupo ya no asociado, nuevo grupo obligatorio sin selección, mínimo/máximo violado según `validateSelection` de `lib/modifier-rules`), `OPTION_UNAVAILABLE` (opción elegida ya no está), `BRANCH_MISMATCH`. Los códigos se evalúan en una función pura `evaluateLine(line, menuCard|null, detail|null)`.
- **Fuente de precio/disponibilidad**: el menú completo de la sucursal con el hook existente `useStoreMenu({branchId})` (clave `queryKeys.store.menu(branchId, {page:'all'})`, `staleTime` 15 s, refetch en foco y en `nextChangeAt`). Es la MISMA consulta que ya usan menú y checkout: sin petición extra si ya está en caché; una por sucursal, no por línea.
- **Fuente de modificadores**: ficha por slug (`getStoreProduct`, clave `queryKeys.products.storeDetail` y `staleTime` de F17) solo para PRODUCTOS ÚNICOS del carrito (no por línea), con `useQueries`. **Concurrencia limitada a 4 fichas sin resolver** (`DETAIL_CONCURRENCY`; peor caso 30 productos únicos: se habilita la siguiente cuando termina una). Las fichas tienen `refetchOnWindowFocus: false`: **solo el menú refresca al volver al foco**; las fichas se revalidan por `staleTime` al reabrir el cajón/checkout. Dependencia opcional documentada (P37): un lote `GET /v1/store/products?ids=` o `POST` de validación; NO indispensable (F19 revalida de forma definitiva), no se implementa.
- **Cuándo** (lo que el código hace): (a) **cajón**: se monta SOLO al abrirse (`next/dynamic`, `ssr:false`) y entonces revalida; cerrado no existe ni consulta; (b) **resumen del menú** (`MenuCartAside`): solo en pantallas `lg` (el cuerpo se monta con `useMediaQuery`, no solo por CSS), así que en móvil/tablet cargar `/menu` con un carrito persistido NO hace ninguna solicitud de fichas; en escritorio revalida al cargar con lo que el menú ya tiene en caché; (c) **checkout**: siempre; (d) **cambio de sucursal**: el diálogo del plan consulta la sucursal nueva (cambia la clave). **Nunca** al cambiar cantidades ni al agregar (las claves no incluyen cantidad).
- **Actualización de datos provisionales**: tras revalidar, `display.unitCents`, `name`, `imageUrl`, `options[].extraCents/names` se actualizan en memoria y en storage (acción `applyRevalidation`, sin tocar `updatedAt`), de modo que el subtotal mostrado use lo vigente y la diferencia se avise. Las `selections` NUNCA se modifican, añaden ni quitan solas: solo el usuario las edita/elimina.
- Sin sucursal elegida: sin revalidación; el carrito admite agregar solo con sucursal elegida (si no, se abre la hoja de modo de pedido; coherente con `branchId` obligatorio de F19).

## 6. Cálculo provisional

`lineUnitCents = display.unitCents + Σ(extraCents × selection.quantity)`; `lineSubtotalCents = lineUnitCents × quantity`; `subtotalCents = Σ lineSubtotalCents` (enteros; cualquier valor no entero o fuera de rango = línea inválida, nunca `Math.round` de flotantes). Se formatea con `formatMoney(cents / 100, …)` del helper existente (el único punto donde aparece un decimal es la presentación). Los precios `"85.00"` se pasan a centavos con `extraPriceToCents`/parser exacto de cadena (no `Number("85.00")*100`).
NO se calcula ni se muestra como cifra definitiva: envío, cobertura, propinas, impuestos, descuentos aplicados, total final. Etiqueta «Subtotal estimado». Promociones: solo se muestra `promo` de la tarjeta/ficha como información indicativa («Happy Hour: Q…», ya existente) y **nunca** se resta; mensaje «Las promociones y el total final se validan en el checkout.».

## 7. Contrato de salida para F19

Esquemas reutilizables en `openapi.yaml`: `CartQuoteSelectionInput`, `CartQuoteLineInput`, `CartQuoteInput` (ya añadidos; **sin operación**). Ubicación: `packages/contracts` y no solo un tipo web, porque el mismo cuerpo lo validará la API de F19 (evita divergencia); la web usa `components['schemas']['CartQuoteInput']`.
`toQuoteInput(cart): CartQuoteInput | null` (función pura): omite precios, nombres, imágenes y notas; fusiona líneas de igual configuración (suma cantidad, tope 99), ordena selecciones por `groupId, optionId` y líneas por `productId` y clave canónica; devuelve `null` si el carrito está vacío o si hay mezcla de sucursales. Precondiciones para llamar: todas las líneas `OK`/`PRICE_CHANGED` reconocido, sucursal única igual a la del modo de pedido, cantidades 1–99. `selections[].quantity` = 1 (F12).
Checkout actual (UI First con `checkout-model`): se conserva tal cual el flujo simulado; «Continuar» navega al checkout existente, que **no crea pedidos reales** ni se presenta como tales: la confirmación sigue siendo de demostración (`MOCK_ONLY`), `clear` solo se invoca desde el flujo simulado y nunca con un identificador de pedido real. Cuando exista F19 se sustituye el cálculo por el de la cotización; F20 emitirá `clearAfterOrder`. No se implementa ni simula una cotización real. Ids no-UUID del mock: `toQuoteInput` solo se usa con el adaptador http (con mock se omite el envío).

## 8. Experiencia

Conexiones: `ProductCard` («Agregar» abre la ficha si el producto tiene grupos de modificadores; si no los tiene, agrega 1 directo tras comprobar sucursal), `ProductSheetHost` (selección obligatoria validada ANTES de habilitar «Agregar»; `submit` llama `cart.addConfigured`), `CartDrawer`, `OrderStep` (resumen/checkout), `MenuCartBar/Aside`, `StoreHeader`/`MobileNav` (contador de UNIDADES; `aria-label` con cantidad).
Estados: vacío; con productos; línea no disponible (atenuada, motivo, «Quitar»); desactualizada (precio cambió, «Entendido»); error de revalidación (banner con «Reintentar», Continuar bloqueado); sucursal cambiada (diálogo §4); modificadores inválidos («Editar» abre la ficha precargada con la selección, nunca la modifica sola); cargando (esqueleto con `aria-busy`).
Confirmaciones: vaciar, eliminar líneas por cambio de sucursal. Eliminar una línea individual es inmediato con «Deshacer» (toast) — no es destructivo grave.
A11y: anuncios `aria-live="polite"` breves («Agregaste 2 × Rollo», «Carrito actualizado»), foco atrapado y devuelto en diálogos (`useDialog`), todo operable con teclado, botones ≥ 44 px, `prefers-reduced-motion` sin animar el contador. Móvil: barra inferior existente. Tema claro/oscuro y es/en: tokens existentes y claves `cart.*` en `i18n/messages/{es,en}.json` (nuevas: motivos de línea, límites, avisos). Rediseños fuera de alcance.

## 9. Pruebas (mapeo de los 40 puntos)

Niveles: U = unit (puro), H = hook/store (Vitest + Testing Library), C = componente, E = Playwright (mock), M = medible/comando.

| #   | Caso                                                                      | Nivel |
| --- | ------------------------------------------------------------------------- | ----- |
| 1   | carrito vacío (drawer, página, contador 0, Continuar oculto)              | C, E  |
| 2   | agregar producto sin modificadores                                        | H, E  |
| 3   | grupo obligatorio: «Agregar» deshabilitado hasta cumplir                  | C, E  |
| 4   | modificadores opcionales                                                  | C     |
| 5   | mínimo y máximo del grupo                                                 | U, C  |
| 6   | configuraciones distintas = líneas separadas                              | U, H  |
| 7   | configuraciones idénticas se unifican                                     | U, H  |
| 8   | `lineId` estable ante distinto orden de selección                         | U     |
| 9   | +/− cantidad, a 0 elimina                                                 | H, C  |
| 10  | cantidades inválidas (0, negativa, NaN, 100, decimal)                     | U     |
| 11  | eliminar línea y deshacer                                                 | H, C  |
| 12  | vaciar con confirmación                                                   | C, E  |
| 13  | subtotal con extras × cantidad                                            | U     |
| 14  | precisión (0.1+0.2, 3 × 33.33, extras 0.00)                               | U     |
| 15  | precio de la sucursal (override) usado                                    | U, H  |
| 16  | agregar con otra sucursal: diálogo, sin vaciar en silencio                | C, E  |
| 17  | cambio de sucursal: plan, diferencias, conservar válidas                  | U, E  |
| 18  | producto agotado                                                          | U, C  |
| 19  | producto desactivado / 404                                                | U, H  |
| 20  | modificador u opción eliminados                                           | U, H  |
| 21  | precio actualizado visible y no silencioso                                | U, C  |
| 22  | persistencia y recuperación tras recargar                                 | H, E  |
| 23  | JSON corrupto / versión errónea / topes → estado seguro + aviso           | U, H  |
| 24  | TTL vencido                                                               | U     |
| 25  | migración v1: se descarta con aviso                                       | U, H  |
| 26  | hidratación sin mismatch ni parpadeo                                      | H, E  |
| 27  | contador en unidades (header y móvil)                                     | C     |
| 28  | sincronización entre pestañas (`storage`)                                 | H     |
| 29  | invitado → sesión: sin duplicar ni vaciar                                 | H     |
| 30  | revalidación sin una petición por línea, no en cada cantidad              | H     |
| 31  | estados bloquean/permiten Continuar                                       | U, C  |
| 32  | `toQuoteInput` sin precios/nombres, orden determinista, null si mezcla    | U     |
| 33  | `CartQuoteInput` conforme al esquema (contra `schema.d.ts`)               | U, M  |
| 34  | el mock nunca confirma pedido real; `clear` solo vía flujo simulado       | C, E  |
| 35  | móvil (viewport estrecho)                                                 | E     |
| 36  | tema claro/oscuro                                                         | E     |
| 37  | i18n es/en (claves completas; `messages.test.ts`)                         | U     |
| 38  | accesibilidad (axe, foco, aria-live, teclado)                             | E     |
| 39  | sin PII/tokens/pago en el JSON guardado                                   | U     |
| 40  | `pnpm lint`, `typecheck`, `build` y `pnpm check`; `contracts:check` verde | M     |

## Estado de implementación (web, mock)

| Tema                                                | Estado                                                                                                               |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| §2 modelo, `lineId`, topes, centavos                | Implementado: `sushimon-web/src/lib/cart-rules.ts` (+ `cart-rules.test.ts`). `features/cart/cart.ts` se eliminó      |
| §3 persistencia v2, TTL, v1, `storage`, hidratación | Implementado: `lib/persisted-store.ts` (`crossTab`, `onLoad`, `onWriteError`), `features/cart/cart-context.tsx`      |
| §4 política de sucursal                             | Implementado: `CartBranchGuard` + `planBranchSwitch`/`applyBranchSwitch`                                             |
| §5 revalidación                                     | Implementado: `use-branch-live.ts`, `use-cart-view.ts`                                                               |
| §6 cálculo provisional                              | Implementado (centavos enteros; promociones solo informativas)                                                       |
| §7 `toQuoteInput`                                   | Implementada y probada; **sin consumidor** hasta F19                                                                 |
| §8 experiencia                                      | Implementada (cajón, resumen, barra móvil, checkout, ficha con edición, tarjetas, deshacer, vaciar con confirmación) |
| Reorden («Pedir de nuevo»)                          | Usa `cart.add(..., {replace})` con la sucursal elegida; sin extras (los pedidos no los guardan)                      |

### Decisiones tomadas al implementar (desvíos o precisiones de la spec)

- `display.priceChange?: { fromCents }` (opcional) guarda el precio anterior hasta el «Entendido»: la revalidación escribe el precio vigente de inmediato y el aviso no depende de que el precio guardado difiera. No viaja a F19.
- `INACTIVE` = el producto existe pero ya no está en el menú de la sucursal; `NOT_FOUND` = la ficha respondió 404 `PRODUCT_NOT_FOUND`. Con una opción desaparecida el estado es `OPTION_UNAVAILABLE` (no `MODIFIER_INVALID`).
- `PRICE_CHANGED` **no bloquea** «Continuar» y su «Entendido» no es condición para continuar (la spec decía «exige que el cliente vea la diferencia»: el aviso queda visible hasta reconocerlo).
- «Mixto» en `toQuoteInput`: la línea no lleva sucursal propia; `null` si el carrito no es de la sucursal esperada (`expectedBranchId`, la del modo de pedido), está vacío, no tiene sucursal o una configuración suma > 99. Agregar o subir cantidades se RECHAZA si una configuración (producto + selecciones, sin nota) pasaría de 99 entre líneas distintas.
- El cambio de sucursal se detecta de forma reactiva (sucursal del modo de pedido ≠ sucursal del carrito con líneas), también al recargar; el selector no se intercepta.
- Sin sucursal elegida no se puede agregar (se abre la hoja de modo de pedido) ni continuar.
- Contrato F17: las tarjetas del menú NO indican si el producto tiene grupos de extras; «Agregar» consulta antes la ficha (`fetchQuery`, misma clave y `staleTime`). Un campo `hasModifiers` en `StoreBranchMenuItem` evitaría esa solicitud.
- El checkout toma la sucursal DEL CARRITO para precios/disponibilidad; si la cobertura a domicilio asignara otra, F19 lo resolverá (hoy es simulado).

### Tabla de la política de sucursal (implementada)

| Situación                                                           | Resultado                                                                                                          |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Carrito vacío y se agrega con una sucursal                          | El carrito pasa a ser de esa sucursal                                                                              |
| Agregar con la sucursal del carrito                                 | Se agrega o se unifica                                                                                             |
| Agregar con otra sucursal (carrito con líneas)                      | Rechazo `BRANCH_MISMATCH` con mensaje; no se mezcla ni se vacía                                                    |
| Sucursal del modo de pedido ≠ sucursal del carrito (cambio/recarga) | Diálogo con el plan por línea; el carrito sigue en la sucursal anterior hasta confirmar                            |
| «Conservar las válidas»                                             | Pasa a la sucursal nueva con las líneas válidas y precios vigentes (aviso de cambio); quita las inválidas listadas |
| «Vaciar y empezar»                                                  | Segunda confirmación; solo entonces se vacía                                                                       |
| «Mantener la sucursal anterior»                                     | Revierte la sucursal del selector (si ya no existe, la opción no se ofrece); el carrito no cambia                  |
| Sin sucursal elegida                                                | No se agrega (se abre la hoja de modo de pedido) ni se continúa                                                    |

## Correcciones tras las revisiones (seguridad, rendimiento, UX/UI)

Implementado:

- **Rendimiento**: el contexto del carrito solo lleva ACCIONES estables; el estado se lee con selectores `useSyncExternalStore` de snapshot primitivo (`useCartCount`, `useCartQuantity(productId)`, `useCartProductShape`, `useCartLines`…). Encabezado y barra móvil solo se repintan si cambia el contador y cada tarjeta solo si cambia SU cantidad (prueba de renders con `Profiler`). `quantityOf` lee el store bajo demanda. Toast: contexto `{notify, dismiss}` estable (sin `message`). `useCartView`: `rows`/`catalog` memoizados, sin derivaciones con `enabled` falso y subtotal único; `CartLineItem` en `memo`. Un solo parse por lectura (`parse` y `onLoad` comparten resultado). El badge no anima el primer valor tras hidratar (`CountBadge`). Carga perezosa (`next/dynamic`, `ssr:false`) de `CartDrawer`, `ProductSheetHost` y del diálogo de `CartBranchGuard` (el detector, el contexto y el contador siguen en el paquete inicial).
- **Seguridad**: `updatedAt` > ahora + 5 min = documento corrupto; el TTL se reevalúa al volver al foco/visibilidad (`checkExpiry`). Un `newValue` externo inválido CONSERVA el estado válido en memoria y no borra la clave; los anuncios «actualizado en otra pestaña» se agrupan (un solo aviso por ráfaga) y no cuentan los ajustes idempotentes de revalidación (solo cambios de líneas, cantidades o sucursal). `onWrite(ok)` reinicia el aviso de almacenamiento al lograr una escritura; si una lectura descartó líneas se reescribe el documento limpio. Saneado de presentación (`cleanText`: sin control/bidi/invisibles, truncado a 200 puntos de código, sin rechazar el agregado); un importe no canónico del servidor (precio o extra) deja la revalidación en ERROR en lugar de caer al valor guardado. Editar una línea es atómico (`replaceLine`: misma posición, sucursal del carrito, nunca fija otra sucursal; una coincidencia con otra línea se unifica y se avisa). `CartBranchGuard` es `alertdialog`, avisa si la sucursal anterior ya no existe (salida: vaciar) y su segunda confirmación enfoca la salida segura. **`clearAfterOrder` se retiró de la API pública** hasta F20 (cuando exista se añadirá con un identificador de pedido CONFIRMADO por el servidor, con tipo propio); `cart-boundaries.test.ts` lo vigila.
- **UX/UI**: «Deshacer» INLINE en la fila (marcador «X eliminado · Deshacer», enfocado, con pausa por puntero/foco; varias eliminaciones conservan cada una el suyo); el toast pausa con puntero/foco y distingue advertencias (icono y `role="alert"`). Checkout paso 1 explica siempre el bloqueo con el mismo motivo que el cajón (`role="alert"`, foco al pulsar «Continuar», texto propio para otra sucursal, tuteo). El resumen lista extras por línea, usa `key=lineId` y «Editar» mide ≥ 44 px. «Editar» abre la ficha ENCIMA del cajón (sin cerrarlo) y devuelve el foco a la fila; «Cambios guardados» en lugar de «agregado». El stepper de la tarjeta muestra «En tu pedido: N» (abre el pedido) cuando hay varias configuraciones o extras; «−» desde 1 quita con «Deshacer». «Agregar» de la ficha usa `aria-disabled` + `aria-describedby`, motivo neutro hasta el primer intento. «Continuar» bloqueado: `aria-disabled` + motivo enlazado (tono muted para PENDING). Un solo canal de anuncios para los avisos de lectura (toast; el banner del cajón no lleva `role`). «Editar» en toda línea con extras o nota; nota con `line-clamp-2` y `title`; «Vaciar pedido» fuera de la lista; aria-label «Entendido, precio de {name}»; spinner y «Verificando extras…» en «Agregar» de la tarjeta.

Riesgos aceptados y decisiones:

- **Carrito anónimo compartido entre cuentas del mismo navegador**: no hay vínculo con la cuenta (P33); en un dispositivo compartido otra persona ve el carrito (y las notas, que pueden contener PII) hasta el TTL de 7 días o hasta vaciarlo. Mitigación: aviso `product.notesPrivacy` en la ficha, TTL, «Vaciar pedido». Riesgo aceptado, a confirmar con negocio.
- **El checkout simulado NO envía `selections`** (solo productId, cantidad y nota): un pedido real con extras exigirá que **F20 construya el pedido desde `toQuoteInput`** y que F19 reciba siempre `expectedBranchId`. La confirmación simulada muestra la insignia «Simulación» (`Confirmation.tsx`). Hallazgo de seguridad M1 anotado.
- Deuda / NO implementado (decisión explícita): debounce de escrituras a `localStorage` (M3: medir antes); reubicación del toast en móvil con medición real (M7); redundancia de precios en la línea (M10); `hasModifiers` en el menú (dependencia de contrato F17, ya registrado); endpoint de lote P37; paridad total de claves i18n más allá de `messages.test`; copy voseo/tuteo del resto de la tienda; teclado virtual iOS (no medido).

## Verificado / No verificado

Verificado (lectura y comandos): el carrito actual usa Context + `useSyncExternalStore` + `createPersistedStore` (`cart-context.tsx`, `persisted-store.ts`); `product-sheet-host.tsx` descarta los extras si no hay `onAdd`; el menú F17 trae `price`/`available`/`promo` y la ficha `modifierGroups` (`PublicModifierGroup`, opciones 0/1 vez); no existe `POST /v1/checkout/quote` ni endpoint de carrito; `pnpm contracts:generate` y `pnpm contracts:check` pasan con los 3 esquemas nuevos; los ids del mock no son UUID; las e2e siembran `monsushi-cart-v1`.
Verificado con el adaptador mock (vitest y Playwright, ver resultados en el informe de la feature): reglas puras, persistencia, sincronización entre pestañas, política de sucursal, estados por línea, accesibilidad axe en cajón y ficha. **Nada se probó contra la API real**.
No verificado: comportamiento real con la API/BD de F12/F13/F17 (SQL sin ejecutar); coste de ≤ 30 fichas en red real; localStorage en modo privado de Safari; el evento `storage` en todos los navegadores móviles; valores de TTL y topes (P30, P31).

## Tareas por dueño

web-engineer: `cart.ts` (modelo, `lineId`, parse v2, cálculo, `planBranchSwitch`, `evaluateLine`, `toQuoteInput`), `persisted-store` (crossTab/onInvalid), `cart-context` (API por `lineId`, `addConfigured`, `applyRevalidation`), hook `useCartRevalidation`, conexión de ficha/tarjeta/drawer/barra/checkout/reorder, i18n, actualizar fixtures e2e. qa-engineer: pruebas 1–40. ui-ux-reviewer: estados y a11y. security-reviewer: contenido del JSON, nota, `clear`. api-engineer: nada en F18 (F19 consumirá los esquemas).

## Preguntas abiertas

P30–P38 (TTL, topes, multi-dispositivo, vínculo a sesión, confirmación de sucursal, notas, cantidad de opción, lote de revalidación, descarte de v1).
