# Metodología híbrida: UI First + Contract First + Vertical Slice

| Etapa | Contenido                                                             | Estado         |
| ----- | --------------------------------------------------------------------- | -------------- |
| 0     | Arquitectura, agentes, monorepo, commit inicial                       | ✅ este commit |
| 1     | Prototipos → Next.js con Mock Data (`feature/ui-first-mock-platform`) | 📐 siguiente   |
| 2     | Contratos OpenAPI estabilizados progresivamente                       | 📐             |
| 3     | Integración vertical: auth → sucursales → catálogo                    | 📐             |
| 4     | Pedidos, checkout, backoffice, entregas propias                       | 📐             |
| 5     | PedidosYa y Neonet reales (con documentación y sandbox)               | ⏳             |
| 6     | Observabilidad, rendimiento, seguridad de producción                  | 📐             |

Contract First se aplica antes de integrar cada slice y puede prepararse en paralelo a la UI.

## Flujo de un slice

spec → clarificar → revisar prototipo y DBML → contrato → plan → tareas → implementar →
pruebas → converge → PR. Estado de integración (seguimiento interno, **no** estado de negocio):
`MOCK_ONLY · CONTRACT_DEFINED · API_IMPLEMENTED · INTEGRATED · VERIFIED · BLOCKED_EXTERNAL`.

## Rutinas

- **UI First**: analizar pantalla → componentes → Mock Data → interacciones → a11y → validación visual.
- **Contract First**: requisitos → OpenAPI → tipos/errores → cliente generado → compatibilidad.
- **Corrección**: reproducir → causa → prueba de regresión → fix → verificar.
- **Base de datos**: DBML → impacto → migración propuesta → restricciones → pruebas → aprobación.
- **Proveedor externo**: documentación oficial → adaptador → mock → sandbox → seguridad → producción aprobada.
- **Git Flow / release**: ver `docs/development/gitflow.md`.

Escenarios de Mock Data requeridos: ver `docs/ui/mock-data-strategy.md`.
