---
paths:
  - 'docs/database/**'
  - '**/migrations/**'
  - '**/*.sql'
  - 'docs/references/*.dbml'
---

# Reglas: database

- `docs/references/monsushi_dbdiagram.dbml` es inmutable: documentar brechas en `docs/database/`.
- Cambios por migración SQL revisable, reversible cuando sea posible; CHECK/índices parciales explícitos.
- Prohibido DROP/TRUNCATE sin aprobación humana. Nunca aplicar migraciones a bases reales desde el agente.
- Pedidos con snapshots históricos; pagos/entregas con ciclos de vida propios; auditoría monetaria.
