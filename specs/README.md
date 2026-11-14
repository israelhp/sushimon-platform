# Especificaciones (Spec Kit)

Cada funcionalidad importante vive en `specs/NNN-nombre/` (`spec.md`, `plan.md`, `tasks.md`) creada con `/speckit-specify`
y compañía. Las ramas de trabajo siguen Git Flow (`feature/*`), no la numeración de Spec Kit. Constitución: `.specify/memory/constitution.md`.
Cada spec debe declarar su **estado de integración** (`MOCK_ONLY … VERIFIED | BLOCKED_EXTERNAL`).

## Índice

| Spec                        | Feature                                | Estado             |
| --------------------------- | -------------------------------------- | ------------------ |
| `005-branches-management`   | F07 Sucursales                         | API implementada   |
| `006-staff-rbac-management` | F03 Empleados, roles y permisos        | API implementada   |
| `007-branch-hours-closures` | F08 Horarios, cierres y disponibilidad | `CONTRACT_DEFINED` |
