/** Tipos internos del módulo de modificadores (F12). Los importes viajan como cadena decimal exacta. */

export interface GroupRow {
  id: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface OptionRow {
  id: string;
  groupId: string;
  name: string;
  /** `"0.00"`–`"9999.99"`. */
  extraPrice: string;
  active: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

/** Grupo con conteos agregados (una sola consulta). */
export interface GroupSummaryRow extends GroupRow {
  optionCount: number;
  activeOptionCount: number;
  productCount: number;
}

export interface NewGroupData {
  name: string;
  minSelect: number;
  maxSelect: number;
  active: boolean;
}

export interface GroupPatch {
  name?: string;
  minSelect?: number;
  maxSelect?: number;
  active?: boolean;
  updatedAt: Date;
}

export interface NewOptionData {
  groupId: string;
  name: string;
  extraPrice: string;
  active: boolean;
  sortOrder: number;
}

export interface OptionPatch {
  name?: string;
  extraPrice?: string;
  active?: boolean;
  updatedAt: Date;
}

export interface GroupPageFilter {
  /** Patrón LIKE ya escapado y plegado (o `null`). */
  pattern: string | null;
  active?: boolean;
  page: number;
  pageSize: number;
}

/** Fila plana del JOIN producto → grupos → opciones (ficha pública y validador). */
export interface OfferRow {
  groupId: string | null;
  groupName: string | null;
  minSelect: number | null;
  maxSelect: number | null;
  groupActive: boolean | null;
  modifierId: string | null;
  modifierName: string | null;
  extraPrice: string | null;
  modifierActive: boolean | null;
}

export interface OfferOption {
  id: string;
  name: string;
  extraPrice: string;
  active: boolean;
}

/** Grupo asociado a un producto con todas sus opciones, en orden. */
export interface OfferGroup {
  id: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  active: boolean;
  options: OfferOption[];
}

// ---------- vistas (formas de la API) ----------

export interface PublicModifierOptionView {
  id: string;
  name: string;
  extraPrice: string;
}

export interface PublicModifierGroupView {
  id: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  required: boolean;
  options: PublicModifierOptionView[];
}

export interface AdminModifierView {
  id: string;
  groupId: string;
  name: string;
  extraPrice: string;
  active: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface AdminModifierGroupSummaryView {
  id: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  required: boolean;
  active: boolean;
  optionCount: number;
  activeOptionCount: number;
  productCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface AdminModifierGroupView extends AdminModifierGroupSummaryView {
  options: AdminModifierView[];
}

export interface AdminModifierGroupPageView {
  items: AdminModifierGroupSummaryView[];
  page: number;
  pageSize: number;
  total: number;
}

export interface AdminProductModifiersView {
  productId: string;
  groups: AdminModifierGroupView[];
}

// ---------- selección (validador) ----------

export interface ModifierSelection {
  groupId: string;
  modifierIds: readonly string[];
}

export interface SelectedModifierItem {
  groupId: string;
  modifierId: string;
  name: string;
  extraPrice: string;
}

export interface ModifierSelectionResult {
  ok: true;
  /** Extras por UNIDAD de producto (la cantidad la aplica F19). */
  extraTotal: string;
  items: SelectedModifierItem[];
}
