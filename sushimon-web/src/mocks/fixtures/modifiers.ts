import type { ModifierExtraPrice } from '@/lib/data-access/models';

/**
 * F12 — Modificadores sembrados (grupos y opciones del contrato; datos de demostración coherentes con el catálogo mock).
 * Derivados del DBML (`modifier_groups`, `modifiers`, `product_modifier_groups`): el prototipo NO trae extras. Los precios son
 * cadenas decimales. El orden de las opciones es el del arreglo (`sortOrder`); el de los grupos de un producto, el de
 * `PRODUCT_MODIFIER_GROUP_SEEDS`. Los ids son legibles (no UUID) como el resto del mock.
 */
export interface ModifierGroupSeed {
  id: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  active: boolean;
  options: { id: string; name: string; extraPrice: ModifierExtraPrice; active: boolean }[];
}

export const MODIFIER_GROUP_SEEDS: readonly ModifierGroupSeed[] = [
  {
    id: 'mgroup-extras',
    name: 'Extras',
    minSelect: 0,
    maxSelect: 3,
    active: true,
    options: [
      { id: 'mopt-queso-crema', name: 'Queso crema', extraPrice: '5.00', active: true },
      { id: 'mopt-aguacate', name: 'Aguacate', extraPrice: '4.00', active: true },
      { id: 'mopt-salsa-extra', name: 'Salsa extra', extraPrice: '3.00', active: true },
      { id: 'mopt-tempura-crunch', name: 'Crunch de tempura', extraPrice: '6.00', active: false },
    ],
  },
  {
    id: 'mgroup-salsa',
    name: 'Salsa',
    minSelect: 1,
    maxSelect: 1,
    active: true,
    options: [
      { id: 'mopt-anguila', name: 'Salsa de anguila', extraPrice: '0.00', active: true },
      { id: 'mopt-mayo-spicy', name: 'Mayo spicy', extraPrice: '0.00', active: true },
      { id: 'mopt-ponzu', name: 'Ponzu', extraPrice: '0.00', active: true },
    ],
  },
  {
    // Grupo inactivo (preparado, aún no ofrecido): no aparece en la ficha ni se puede asociar a un producto.
    id: 'mgroup-bebida',
    name: 'Bebida del combo',
    minSelect: 1,
    maxSelect: 1,
    active: false,
    options: [
      { id: 'mopt-te-frio', name: 'Té frío', extraPrice: '0.00', active: true },
      { id: 'mopt-gaseosa', name: 'Gaseosa', extraPrice: '2.00', active: true },
    ],
  },
];

/** Producto (id del mock = slug) → ids de grupos en orden de asociación. */
export const PRODUCT_MODIFIER_GROUP_SEEDS: Readonly<Record<string, readonly string[]>> = {
  'california-roll': ['mgroup-extras'],
  'cayibel-roll': ['mgroup-extras'],
  'sushi-pizza': ['mgroup-salsa', 'mgroup-extras'],
  'poporopos-cangrejo': ['mgroup-salsa'],
};
