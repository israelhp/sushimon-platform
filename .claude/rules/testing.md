---
paths:
  - '**/*.spec.ts'
  - '**/*.test.ts'
  - '**/*.test.mjs'
  - '**/*.e2e-spec.ts'
  - '**/e2e/**'
---

# Reglas: testing

- Un bug = una prueba de regresión que falla antes del fix.
- Pruebas deterministas y sin red externa; no debilitar aserciones para pasar.
- Reportar solo resultados de comandos realmente ejecutados.
