import { BadRequestException } from '@nestjs/common';
import { dbErrorCodes as codes, uniqueTarget } from '../common/db/db-error-codes.js';
import {
  busy,
  groupInvalid,
  groupNameTaken,
  groupNotFound,
  limitReached,
  modifierNameTaken,
  productNotFound,
} from './modifier-policy.js';

/** Operación en curso: decide la traducción de un UNIQUE sin restricción identificable. */
export type ModifierDbContext = 'group' | 'option';

const textOf = (error: unknown): string => {
  const parts: string[] = [];
  const e = error as {
    message?: unknown;
    meta?: { message?: unknown };
    cause?: { message?: unknown };
  };
  for (const m of [e?.message, e?.meta?.message, e?.cause?.message])
    if (typeof m === 'string') parts.push(m);
  return `${parts.join(' ')} ${uniqueTarget(error) ?? ''}`;
};

/**
 * Red de seguridad: traduce errores de BD esperables a HTTP; devuelve el MISMO error si no son del dominio
 * (=> 500 genérico, sin detalles).
 * - P2028/55P03/40P01/40001: 503 `MODIFIERS_BUSY` (mensaje fijo, reintentable).
 * - UNIQUE `*_sort_key` (también diferida al COMMIT): 503 `MODIFIERS_BUSY`.
 * - UNIQUE (P2002/23505) según la restricción: `modifier_groups_name_lower_key` => 409 `MODIFIER_GROUP_NAME_TAKEN`;
 *   `modifiers_group_name_lower_key` => 409 `MODIFIER_NAME_TAKEN`. Si el driver NO informa la restricción, se traduce por
 *   `context`: 'group' => `MODIFIER_GROUP_NAME_TAKEN`, 'option' => `MODIFIER_NAME_TAKEN`; sin contexto => 500.
 * - CHECK/trigger (P2004/23514): `modifier_group_max_options` / `product_max_modifier_groups` => 422
 *   `MODIFIER_LIMIT_REACHED`; otro CHECK => 400 genérico.
 * - FK (P2003/23503): grupo/producto inexistente al insertar.
 */
export function translateModifierDbError(error: unknown, context?: ModifierDbContext): unknown {
  if (typeof error !== 'object' || error === null) return error;
  const found = codes(error);
  if (
    found.includes('55P03') ||
    found.includes('P2028') ||
    found.includes('40P01') ||
    found.includes('40001')
  )
    return busy();
  if (found.includes('P2002') || found.includes('23505')) {
    const text = textOf(error);
    // Violación (posiblemente diferida, al COMMIT) de la UNIQUE de sort_order: carrera de reordenamiento => reintentable.
    if (/_sort_key/.test(text)) return busy();
    if (/modifiers_group_name_lower_key/.test(text)) return modifierNameTaken();
    if (/modifier_groups_name_lower_key/.test(text)) return groupNameTaken();
    // El driver puede no informar la restricción: se traduce por la operación (única unicidad posible allí).
    if (context === 'group') return groupNameTaken();
    if (context === 'option') return modifierNameTaken();
    return error;
  }
  if (found.includes('P2004') || found.includes('23514')) {
    const text = textOf(error);
    if (/modifier_group_max_options/.test(text))
      return limitReached('Un grupo admite como máximo 30 opciones');
    if (/product_max_modifier_groups/.test(text))
      return limitReached('Un producto admite como máximo 10 grupos');
    return new BadRequestException(['Datos inválidos']);
  }
  if (found.includes('P2003') || found.includes('23503')) {
    const text = textOf(error);
    if (/product_modifier_groups_group_id_fkey/.test(text))
      return groupInvalid('El grupo no existe');
    if (/product_modifier_groups_product_id_fkey/.test(text)) return productNotFound();
    if (/modifiers_group_id_fkey/.test(text)) return groupNotFound();
    return error;
  }
  return error;
}
