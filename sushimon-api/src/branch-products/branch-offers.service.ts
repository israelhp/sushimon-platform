import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { CategoriesQueryService } from '../categories/categories-query.service.js';
import { codedException, type ErrorViolation } from '../common/errors/coded-exception.js';
import {
  branchNotAvailable,
  isUuid,
  MAX_RESOLVE_IDS,
  MAX_VIOLATIONS,
} from './branch-product-policy.js';
import { BranchProductsRepository } from './branch-products.repository.js';
import type { BranchOffer } from './branch-products.types.js';

const notAvailable = (violations: ErrorViolation[]) =>
  codedException(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'PRODUCT_NOT_AVAILABLE',
    'Algún producto no está disponible en la sucursal',
    violations.slice(0, MAX_VIOLATIONS),
  );

const invalidList = () =>
  notAvailable([
    { path: 'productIds', code: 'PRODUCT_UNKNOWN', message: 'Lista de productos inválida' },
  ]);

/**
 * Servicio reutilizable (spec F13 D6), SIN endpoint: lo consumirán F17 (agregados) y F19 (cotización). El precio sale
 * SIEMPRE de la BD, nunca del cliente.
 * - `resolve`: SOLO precio/disponibilidad (`price`, `basePrice`, `available`) en UNA consulta. NO decide si un producto es
 *   ordenable: no aplica visibilidad (producto inactivo o categoría oculta aparecen igual) y no existe campo `offered`
 *   (calcularlo exigiría la lectura de categorías; para eso está `assertOrderable`). F19 debe cobrar `price`, NUNCA
 *   `basePrice`. Es seguro ante entradas malas: no arreglo o más de 200 ids => 422 `PRODUCT_NOT_AVAILABLE`; branchId mal
 *   formado => 422 `BRANCH_NOT_AVAILABLE`; ids que no son UUID se tratan como ausentes (jamás llegan a `::uuid[]`).
 * - `assertOrderable`: ÚNICO punto de decisión de "ordenable". 422 `PRODUCT_NOT_AVAILABLE` con TODAS las violaciones
 *   (`PRODUCT_UNKNOWN`/`PRODUCT_HIDDEN`/`PRODUCT_SOLD_OUT`, `path` `productIds[i]` con el índice de la primera aparición);
 *   lista vacía, no arreglo o con más de 200 ids => 422 (path `productIds`); sucursal inexistente o inactiva => 422
 *   `BRANCH_NOT_AVAILABLE`. Nunca TypeError ni SQL con entradas malformadas.
 */
@Injectable()
export class BranchOffersService {
  constructor(
    @Inject(BranchProductsRepository) private readonly repo: BranchProductsRepository,
    @Inject(CategoriesQueryService) private readonly categories: CategoriesQueryService,
  ) {}

  async resolve(
    branchId: string,
    productIds: readonly string[],
  ): Promise<Map<string, BranchOffer>> {
    if (!Array.isArray(productIds) || productIds.length > MAX_RESOLVE_IDS) throw invalidList();
    if (!isUuid(branchId)) throw branchNotAvailable();
    const unique = [...new Set((productIds as unknown[]).filter(isUuid))];
    const out = new Map<string, BranchOffer>();
    if (unique.length === 0) return out;
    for (const row of await this.repo.resolveMany(branchId, unique)) {
      out.set(row.id, { price: row.price, basePrice: row.basePrice, available: row.available });
    }
    return out;
  }

  async assertOrderable(branchId: string, productIds: readonly string[]): Promise<void> {
    if (
      !Array.isArray(productIds) ||
      productIds.length === 0 ||
      productIds.length > MAX_RESOLVE_IDS
    ) {
      throw invalidList();
    }
    if (!isUuid(branchId)) throw branchNotAvailable();
    const violations: ErrorViolation[] = [];
    const firstIndex = new Map<string, number>();
    (productIds as unknown[]).forEach((id, index) => {
      if (isUuid(id)) {
        if (!firstIndex.has(id)) firstIndex.set(id, index);
      } else {
        violations.push({
          path: `productIds[${index}]`,
          code: 'PRODUCT_UNKNOWN',
          message: 'Producto inexistente',
        });
      }
    });
    const unique = [...firstIndex.keys()];
    const [branch, visibleIds, rows] = await Promise.all([
      this.repo.findBranchStatus(branchId),
      this.categories.getVisibleIds(),
      this.repo.resolveMany(branchId, unique),
    ]);
    if (!branch?.active) throw branchNotAvailable();
    const visible = new Set(visibleIds);
    const byId = new Map(rows.map((r) => [r.id, r]));
    for (const id of unique) {
      const row = byId.get(id);
      const path = `productIds[${firstIndex.get(id)}]`;
      if (!row) {
        violations.push({ path, code: 'PRODUCT_UNKNOWN', message: 'Producto inexistente' });
      } else if (!row.active || !visible.has(row.categoryId)) {
        violations.push({ path, code: 'PRODUCT_HIDDEN', message: 'Producto no disponible' });
      } else if (!row.available) {
        violations.push({
          path,
          code: 'PRODUCT_SOLD_OUT',
          message: 'Producto agotado en la sucursal',
        });
      }
    }
    if (violations.length > 0) throw notAvailable(violations);
  }
}
