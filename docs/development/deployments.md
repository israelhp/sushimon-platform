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
