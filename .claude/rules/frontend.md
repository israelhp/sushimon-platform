---
paths:
  - 'sushimon-web/**'
---

# Reglas: frontend

- Server Components por defecto; `'use client'` solo si hay interactividad.
- Sin `fetch` en componentes: usar services → `lib/data-access`.
- Tokens de `globals.css`, sin hex sueltos; claro/oscuro; accesible por teclado.
- Textos fuera de componentes (es/en). Tipos de API desde `@sushimon/contracts`.
