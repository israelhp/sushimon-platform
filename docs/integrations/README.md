# Integraciones externas

| Proveedor         | Propósito         | Estado documental        | Notas                                                                   |
| ----------------- | ----------------- | ------------------------ | ----------------------------------------------------------------------- |
| PedidosYa Courier | Reparto externo   | `AWAITING_DOCUMENTATION` | Sin docs, credenciales ni sandbox                                       |
| Neonet            | Pago con tarjeta  | `AWAITING_DOCUMENTATION` | Sin docs, credenciales ni sandbox                                       |
| WhatsApp          | Notificaciones    | `PLANNED`                | Proveedor/canal por definir (`notifications.channel`)                   |
| Cloudflare R2     | Medios (imágenes) | `BLOCKED_EXTERNAL` (F14) | Sin bucket, dominio ni credenciales verificados; ver `cloudflare-r2.md` |

Estados: `PLANNED · AWAITING_DOCUMENTATION · AWAITING_SANDBOX · MOCK_READY · IN_DEVELOPMENT · SANDBOX_VERIFIED · PRODUCTION_APPROVED`.
**No** equivalen a estados de pago, pedido ni envío. El proveedor no define entidades centrales del dominio: un adaptador traduce.

Rutina: documentación oficial → interfaz/adaptador → mock → sandbox → seguridad → producción aprobada.
Regla dura: no inventar endpoints, payloads ni estados; no solicitudes reales sin credenciales autorizadas.
