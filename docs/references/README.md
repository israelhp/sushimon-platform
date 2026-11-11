# Referencias de negocio (inmutables)

| Archivo                        | Origen (nombre original)                                               | Rol                                  |
| ------------------------------ | ---------------------------------------------------------------------- | ------------------------------------ |
| `backoffice-prototype.html`    | `Backoffice Sushi Mon – … prototipo interactivo.html`                  | Referencia funcional/visual backoffice |
| `public-store-prototype.html`  | `MON-SUSHI-prototipo.html`                                             | Referencia funcional/visual tienda   |
| `monsushi_dbdiagram.dbml`      | `monsushi_dbdiagram.dbml` (versión con identificadores originales)     | Línea base del modelo relacional     |
| `SHA256SUMS`                   | —                                                                      | Integridad (`shasum -c SHA256SUMS`)  |

- Los nombres se normalizaron a ASCII; el contenido es byte a byte el original.
- Existe además `monsushi_dbdiagram_espanol.dbml` (traducción de lectura que **no** usa los identificadores
  de la migración SQL). **No** se incorporó: la línea base es la versión en inglés.
- Estos archivos no se editan (lo impide un hook). Los prototipos no son código de producción.
- El backoffice se inspeccionó **sin ejecutarlo** (extracción estática del bundle). Verificar pantalla por
  pantalla durante la Etapa 1.
