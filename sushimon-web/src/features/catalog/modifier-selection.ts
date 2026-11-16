'use client';

import { useCallback, useMemo, useState } from 'react';
import type { PublicModifierGroup } from '@/lib/data-access/models';
import {
  compactSelections,
  extraPriceToCents,
  isRequiredGroup,
  validateSelection,
  type ModifierSelection,
  type SelectionResult,
} from '@/lib/modifier-rules';

/**
 * F12 — Estado de la selección de extras de la ficha pública. La selección es ESTRUCTURADA
 * (`{ groupId, modifierIds[] }[]`, solo grupos con algo elegido): es el contrato que F18 (carrito) consumirá y F19 (cotización)
 * reenviará al servidor, que NUNCA confía en nombres ni precios del cliente y recalcula. Los importes extra son estimados,
 * en CÉNTIMOS enteros (sin coma flotante). Radio cuando `maxSelect = 1`, casillas con tope cuando `maxSelect > 1`.
 */
export type ModifierGroupIssue =
  | { kind: 'required'; min: number; chosen: number }
  | { kind: 'tooMany'; max: number; chosen: number };

export interface ModifierSelectionState {
  /** Selección estructurada (grupos vacíos omitidos), lista para F18. */
  selections: ModifierSelection[];
  /** Ids elegidos por grupo (todos los grupos, vacíos incluidos). */
  chosen: Readonly<Record<string, readonly string[]>>;
  result: SelectionResult;
  /** ¿Cumple mínimos y máximos de TODOS los grupos? */
  valid: boolean;
  /** Extras estimados por unidad en céntimos enteros. */
  extraCents: number;
  /** Problema de un grupo (mínimo no alcanzado o máximo superado) o `null`. */
  issueOf: (group: PublicModifierGroup) => ModifierGroupIssue | null;
  isChosen: (groupId: string, modifierId: string) => boolean;
  /** Radio (`maxSelect = 1`): elige esa opción (reemplaza). Casillas: alterna, sin pasar de `maxSelect`. */
  toggle: (group: PublicModifierGroup, modifierId: string) => void;
  /** Quita todo lo elegido en el grupo (opción «Ninguno» de un grupo opcional de elección única). */
  clearGroup: (groupId: string) => void;
  reset: () => void;
}

export function useModifierSelection(
  groups: readonly PublicModifierGroup[],
): ModifierSelectionState {
  const [chosen, setChosen] = useState<Record<string, readonly string[]>>({});

  // Solo se consideran ids que existen en los grupos actuales (los datos pueden cambiar tras un refresco).
  const effective = useMemo(() => {
    const out: Record<string, readonly string[]> = {};
    for (const g of groups) {
      const known = new Set(g.options.map((o) => o.id));
      out[g.id] = (chosen[g.id] ?? []).filter((id) => known.has(id));
    }
    return out;
  }, [groups, chosen]);

  const selections = useMemo(
    () =>
      compactSelections(
        groups.map((g) => ({ groupId: g.id, modifierIds: [...(effective[g.id] ?? [])] })),
      ),
    [groups, effective],
  );
  const result = useMemo(() => validateSelection(groups, selections), [groups, selections]);

  const issueOf = useCallback(
    (group: PublicModifierGroup): ModifierGroupIssue | null => {
      const count = effective[group.id]?.length ?? 0;
      if (count > group.maxSelect) return { kind: 'tooMany', max: group.maxSelect, chosen: count };
      if (isRequiredGroup(group.minSelect) && count < group.minSelect) {
        return { kind: 'required', min: group.minSelect, chosen: count };
      }
      return null;
    },
    [effective],
  );

  const toggle = useCallback((group: PublicModifierGroup, modifierId: string) => {
    setChosen((prev) => {
      const current = prev[group.id] ?? [];
      if (group.maxSelect === 1) return { ...prev, [group.id]: [modifierId] };
      if (current.includes(modifierId)) {
        return { ...prev, [group.id]: current.filter((id) => id !== modifierId) };
      }
      if (current.length >= group.maxSelect) return prev;
      return { ...prev, [group.id]: [...current, modifierId] };
    });
  }, []);

  return {
    selections,
    chosen: effective,
    result,
    valid: result.ok,
    extraCents: result.extraCents,
    issueOf,
    isChosen: (groupId, modifierId) => effective[groupId]?.includes(modifierId) ?? false,
    toggle,
    clearGroup: (groupId) => setChosen((prev) => ({ ...prev, [groupId]: [] })),
    reset: () => setChosen({}),
  };
}

/** Precio estimado por unidad en céntimos: `basePrice` (cadena) + extras. `null` si el precio base no es un importe válido. */
export function estimatedUnitCents(basePrice: string, extraCents: number): number | null {
  const m = /^(\d{1,6})\.(\d{2})$/.exec(basePrice);
  if (!m) return null;
  return Number(m[1]) * 100 + Number(m[2]) + extraCents;
}

/** Céntimos de un precio extra para mostrar (`"5.00"` → 500). */
export const optionExtraCents = (price: string): number => extraPriceToCents(price) ?? 0;
