---
paths:
  - '**/auth/**'
  - '**/*guard*'
  - '**/*.env*'
  - 'docs/security/**'
  - '.claude/**'
---

# Reglas: security

- Autorización en servidor: rol + permiso + alcance de sucursal + recurso. Denegar por defecto.
- Backoffice: Google OAuth + usuario interno activo; nunca confiar en permisos del cliente.
- Sin secretos en repo/cliente/logs; `.env.example` sin valores reales.
- CORS por lista blanca, rate limiting, validación de entrada, errores sin detalles internos.
