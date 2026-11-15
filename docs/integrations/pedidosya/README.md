# PedidosYa Courier

**Estado**: `AWAITING_DOCUMENTATION` (pendiente de documentación, credenciales y ambiente de pruebas).

## Propósito y responsabilidades

Segunda modalidad de reparto junto a repartidores propios. El restaurante elige modalidad al despachar un pedido listo.

## Arquitectura prevista (📐)

`DeliveryApplicationService → DeliveryProvider → { OwnRiderProvider, PedidosYaProvider }`. El ciclo del pedido no
depende del JSON del proveedor; las capacidades difieren y no se asume equivalencia 1:1.

## Contrato neutral de cobertura (F09, `specs/008-delivery-zones-coverage`, ADR-0013)

El estado sigue siendo `AWAITING_DOCUMENTATION` / `BLOCKED_EXTERNAL`. F09 solo define el puerto interno `CourierCoveragePort`
(`{ provider: 'PEDIDOSYA', status: AVAILABLE|UNAVAILABLE|UNKNOWN, integrationStatus, reason? }`), separado de la cotización, y dos adaptadores:
`UnavailableIntegrationAdapter` (defecto y producción: siempre `UNKNOWN`) y `MockPedidosYaCoverageAdapter` (`MOCK_READY`, solo desarrollo/pruebas,
la API no arranca con él en `NODE_ENV=production`). No asume endpoints, payloads, tarifas, tiempos ni estados del proveedor; timeout o error ⇒
`UNKNOWN`. El adaptador real y su política de caché/reintentos corresponden a F29.

## A confirmar con la documentación oficial (no asumido)

Cotización · solicitud de courier · identificadores externos · confirmación de asignación · seguimiento (webhooks o
polling) · cancelación y sus condiciones · estados del proveedor · costo estimado vs. final · errores · reintentos ·
idempotencia · autenticación y firma de webhooks.

## Datos pendientes

Credenciales sandbox/producción · contrato comercial (tarifas) · límites/SLAs · formato de estados · política de diferencias de costo.

## Seguridad y pruebas

Secretos solo en gestor de secretos; verificar firma de webhooks; auditar eventos externos (`gap B4`). Estrategia: mock
(`MOCK_READY`) → sandbox → producción aprobada. Hoy: solo UI mock rotulada “Simulación” (cotización, asignación,
cambios de estado, errores del proveedor, repartidores propios ocupados, entrega completada, regreso a sucursal).

## Errores y reintentos

Backoff exponencial acotado con idempotencia; clasificar errores reintentables vs. definitivos **según la doc**.
Brechas de modelo: `docs/database/schema-gap-analysis.md` §B.
