import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';

/**
 * Validador MÍNIMO de esquemas del contrato (`packages/contracts/openapi/openapi.yaml`) para pruebas de paridad del mock: cubre solo lo
 * que usan los esquemas de F23 (`$ref`, `allOf` de un `$ref`, `type`, `nullable`, `enum`, `required`, `properties`, `items`,
 * `pattern`, `format` uuid/date-time, límites y `additionalProperties: false`). No pretende ser un validador OpenAPI completo.
 */
type Schema = {
  $ref?: string;
  allOf?: Schema[];
  type?: string;
  nullable?: boolean;
  enum?: unknown[];
  required?: string[];
  properties?: Record<string, Schema>;
  items?: Schema;
  pattern?: string;
  format?: string;
  maxItems?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  additionalProperties?: boolean | Schema;
};

let cached: { components: { schemas: Record<string, Schema> } } | null = null;
function spec() {
  cached ??= parse(
    readFileSync(join(__dirname, '../../../packages/contracts/openapi/openapi.yaml'), 'utf8'),
  ) as { components: { schemas: Record<string, Schema> } };
  return cached;
}

function check(schema: Schema, value: unknown, path: string, errors: string[]): void {
  if (value === null && schema.nullable) return;
  if (schema.$ref) {
    const name = schema.$ref.replace('#/components/schemas/', '');
    const target = spec().components.schemas[name];
    if (!target) return void errors.push(`${path}: esquema ${name} inexistente`);
    return check(target, value, path, errors);
  }
  if (schema.allOf) {
    for (const part of schema.allOf) check(part, value, path, errors);
    return;
  }
  if (value === null) {
    if (!schema.nullable) errors.push(`${path}: no admite null`);
    return;
  }
  if (schema.enum && !schema.enum.includes(value)) {
    errors.push(`${path}: ${JSON.stringify(value)} fuera de enum`);
  }
  switch (schema.type) {
    case 'object': {
      if (typeof value !== 'object' || Array.isArray(value))
        return void errors.push(`${path}: no es objeto`);
      const record = value as Record<string, unknown>;
      for (const key of schema.required ?? []) {
        if (!(key in record)) errors.push(`${path}.${key}: obligatorio ausente`);
      }
      for (const [key, v] of Object.entries(record)) {
        const child = schema.properties?.[key];
        if (child) check(child, v, `${path}.${key}`, errors);
        else if (schema.additionalProperties === false)
          errors.push(`${path}.${key}: propiedad no definida`);
      }
      return;
    }
    case 'array': {
      if (!Array.isArray(value)) return void errors.push(`${path}: no es arreglo`);
      if (schema.maxItems !== undefined && value.length > schema.maxItems)
        errors.push(`${path}: demasiados elementos`);
      value.forEach(
        (item, i) => schema.items && check(schema.items, item, `${path}[${i}]`, errors),
      );
      return;
    }
    case 'string': {
      if (typeof value !== 'string') return void errors.push(`${path}: no es texto`);
      if (schema.pattern && !new RegExp(schema.pattern).test(value))
        errors.push(`${path}: ${value} no cumple el patrón`);
      if (schema.maxLength !== undefined && value.length > schema.maxLength)
        errors.push(`${path}: demasiado largo`);
      // `format: uuid` NO se exige: el mock usa ids legibles (`sucursal-1`, slugs de producto) en todo el catálogo (ver `mocks/fixtures`).
      if (schema.format === 'date-time' && Number.isNaN(Date.parse(value)))
        errors.push(`${path}: no es fecha-hora`);
      return;
    }
    case 'integer':
    case 'number': {
      if (typeof value !== 'number' || (schema.type === 'integer' && !Number.isInteger(value))) {
        return void errors.push(`${path}: no es ${schema.type}`);
      }
      if (schema.minimum !== undefined && value < schema.minimum)
        errors.push(`${path}: menor que el mínimo`);
      if (schema.maximum !== undefined && value > schema.maximum)
        errors.push(`${path}: mayor que el máximo`);
      return;
    }
    case 'boolean':
      if (typeof value !== 'boolean') errors.push(`${path}: no es booleano`);
  }
}

/** Errores de `value` frente al esquema `name` del contrato (vacío = válido). */
export function validateContract(name: string, value: unknown): string[] {
  const errors: string[] = [];
  check({ $ref: `#/components/schemas/${name}` }, value, name, errors);
  return errors;
}
