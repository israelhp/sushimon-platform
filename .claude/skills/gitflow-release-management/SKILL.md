---
name: gitflow-release-management
description: 'Releases, hotfixes y versionado SemVer con Git Flow. Úsala al preparar una versión o corrección urgente.'
---

# Releases y hotfixes

- **Release**: `release/x.y.z` desde `develop`; solo correcciones, config, docs y validaciones →
  PR a `main` → tag `vX.Y.Z` → PR de vuelta a `develop` → borrar la rama.
- **Hotfix**: `hotfix/x.y.z` desde `main` → PR a `main` + tag → incorporar a `develop` (y al release abierto).
- Verificar que `develop` contiene todo lo de `main` tras cada publicación.
- Todo push/tag/release remoto requiere autorización humana. Detalle: `docs/development/gitflow.md`.
