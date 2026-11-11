# WhatsApp (notificaciones)

**Estado**: `PLANNED`. Canal/proveedor sin decidir (WhatsApp Business API vs. otro). No hay documentación ni credenciales.
Modelo existente: `app.notifications` (`channel`, `destination`, `template_code`, `status`, `provider_reference`, `sent_at`).
Pendiente: plantillas aprobadas, consentimiento del cliente, estrategia de reintentos (evaluar patrón _outbox_), costos reales.
No enviar mensajes reales hasta tener proveedor y autorización.
