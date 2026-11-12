# Despliegues (⏳ documentados, **no activos**)

| Rama        | Entorno                        | Notas                                                                                                       |
| ----------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `feature/*` | Preview / desarrollo           | Preview por PR                                                                                              |
| `develop`   | Staging                        | **Vercel no asocia `develop` a staging automáticamente**: configurar dominio/entorno de rama en el proyecto |
| `release/*` | Validación previa a producción |                                                                                                             |
| `main`      | Producción                     | Production Branch = `main`                                                                                  |

Apps separadas: `sushimon-web` (candidata a Vercel; Root Directory `sushimon-web`) y `sushimon-api` (host por decidir,
ADR-0006). Variables por entorno según los `.env.example`; secretos solo en el gestor del proveedor/GitHub Environments
con aprobadores. `.github/workflows/deploy.yml.disabled` es una plantilla inerte. No se realizaron despliegues.

## Demo con datos simulados (Etapa 1)

La web puede compilarse y servirse como demo al cliente **sin API**. Verificado el 2026-11-11 con `next build` +
`next start`: todas las rutas responden y no hay solicitudes de red externas (`e2e/no-external-requests.spec.ts`).

- Las variables `NEXT_PUBLIC_*` se **fijan al compilar**: deben estar definidas en el `build`, no solo al arrancar.
- En producción el mock está prohibido por defecto (`resolveDataSource`). Para una demo explícita compila con
  `NEXT_PUBLIC_DATA_SOURCE=mock` y `NEXT_PUBLIC_ALLOW_MOCK_IN_PRODUCTION=true`. Sin ese permiso la app falla de forma
  explícita en lugar de simular datos en silencio.
- Es una demostración: los datos viven en el navegador (`sessionStorage`) y las integraciones (PedidosYa, NeoNet) son
  simulaciones rotuladas. No usar este modo para operación real.
