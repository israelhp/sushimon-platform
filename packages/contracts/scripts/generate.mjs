import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import openapiTS, { astToString } from 'openapi-typescript';

const root = new URL('../', import.meta.url);
const ast = await openapiTS(new URL('openapi/openapi.yaml', root));
const header =
  '/* AUTO-GENERADO desde openapi/openapi.yaml. No editar: ejecutar `pnpm contracts:generate`. */\n';
writeFileSync(fileURLToPath(new URL('src/schema.d.ts', root)), header + astToString(ast));
console.log('contracts: src/schema.d.ts generado');
