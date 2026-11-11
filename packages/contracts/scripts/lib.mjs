import { readFileSync } from 'node:fs';
import { parse } from 'yaml';

const METHODS = ['get', 'post', 'put', 'patch', 'delete'];

export function loadYaml(path) {
  return parse(readFileSync(path, 'utf8'));
}

/** Operaciones de un documento OpenAPI como "METHOD /path#operationId:status,status". */
export function operationsOf(doc) {
  const out = [];
  for (const [path, item] of Object.entries(doc.paths ?? {})) {
    for (const m of METHODS) {
      const op = item?.[m];
      if (!op) continue;
      const codes = Object.keys(op.responses ?? {})
        .sort()
        .join(',');
      out.push(`${m.toUpperCase()} ${path}#${op.operationId}:${codes}`);
    }
  }
  return out.sort();
}

/** Diferencias entre el contrato canónico y el documento emitido por la API. */
export function diffContracts(canonical, emitted) {
  const a = new Set(operationsOf(canonical));
  const b = new Set(operationsOf(emitted));
  return {
    missingInApi: [...a].filter((x) => !b.has(x)),
    undocumented: [...b].filter((x) => !a.has(x)),
  };
}
