import { Inject, Injectable } from '@nestjs/common';
import { HttpException } from '@nestjs/common';
import {
  assertSelectionShape,
  buildOfferGroups,
  evaluateSelections,
  MAX_VIOLATIONS,
  productNotFound,
  sumPrices,
  validateSelections,
} from './modifier-policy.js';
import { ModifiersRepository } from './modifiers.repository.js';
import type {
  ModifierSelection,
  OfferGroup,
  ModifierSelectionBatchItem,
  ModifierSelectionBatchResult,
  ModifierSelectionResult,
} from './modifiers.types.js';

/**
 * Validador reutilizable de selecciones de extras (spec F12 D10). SIN endpoint HTTP: lo consumirán F19 (cotización) y
 * F20 (pedido). El cliente nunca aporta nombres ni precios: salen de la BD. Una consulta (producto → grupos →
 * opciones) y validación en memoria. Producto inexistente => 404 `PRODUCT_NOT_FOUND`; selección inválida => 422
 * `MODIFIER_SELECTION_INVALID` con todas las `violations`. `extraTotal` es por UNIDAD de producto.
 *
 * IMPORTANTE (F19): este servicio NO comprueba que el producto sea visible/activo ni que su categoría sea visible
 * (solo que exista). La cotización (F19) DEBE verificarlo con `ProductsQueryService` antes de cotizar. Nunca debe
 * aceptar precios ni nombres del cliente: usa `extraTotal`/`items` de aquí y, ante un 422, devuelve el precio vigente
 * para que la UI se refresque.
 * Guardas defensivas: `selections`/`modifierIds` que no sean arreglos, más de 10 selecciones o de 20 ids por selección
 * => 422 `MODIFIER_SELECTION_INVALID` (nunca TypeError); las `violations` se cortan en 50.
 */
@Injectable()
export class ModifierSelectionService {
  constructor(@Inject(ModifiersRepository) private readonly repo: ModifiersRepository) {}

  async validate(
    productId: string,
    selections: readonly ModifierSelection[],
  ): Promise<ModifierSelectionResult> {
    assertSelectionShape(selections); // antes de la BD: una entrada malformada no cuesta una consulta
    const rows = await this.repo.findOffer(productId);
    if (rows === null) throw productNotFound();
    return validateSelections(buildOfferGroups(rows), selections);
  }

  /**
   * Lector de SOLO LECTURA (F23, spec 024 §8.4): grupos y opciones ACTUALES (incluidos los inactivos, con su bandera) de
   * VARIOS productos en UNA consulta (`findOffersMany`), sin validar nada. Un producto inexistente no aparece en el mapa.
   * No cambia el comportamiento de `validate`/`validateMany`.
   */
  async findOffers(productIds: readonly string[]): Promise<Map<string, OfferGroup[]>> {
    if (productIds.length === 0) return new Map();
    const rows = await this.repo.findOffersMany([...new Set(productIds)]);
    return new Map([...rows].map(([productId, offer]) => [productId, buildOfferGroups(offer)]));
  }

  /**
   * Variante por LOTE y NO lanzante (F19/F20): UNA consulta `ANY(uuid[])` para todos los productos distintos y las
   * MISMAS reglas (`evaluateSelections`) por elemento. Devuelve un resultado por elemento, en el mismo orden. Una
   * entrada malformada (forma, más de 10 selecciones, más de 20 ids por selección) es `INVALID` con el código
   * `MODIFIER_SELECTION_INVALID` y no cuesta consulta propia; un producto inexistente es `NOT_FOUND`. No comprueba
   * visibilidad del producto (ver nota de arriba).
   */
  async validateMany(
    items: readonly ModifierSelectionBatchItem[],
  ): Promise<ModifierSelectionBatchResult[]> {
    const shapeErrors = new Map<number, ModifierSelectionBatchResult>();
    items.forEach((item, i) => {
      try {
        assertSelectionShape(item.selections);
      } catch (error) {
        if (!(error instanceof HttpException)) throw error;
        shapeErrors.set(i, {
          status: 'INVALID',
          violations: [
            {
              path: 'selections',
              code: 'MODIFIER_SELECTION_INVALID',
              message: 'La selección de extras no es válida',
            },
          ],
        });
      }
    });
    const productIds = [
      ...new Set(items.filter((_, i) => !shapeErrors.has(i)).map((item) => item.productId)),
    ];
    const offers = await this.repo.findOffersMany(productIds);
    return items.map((item, i) => {
      const shape = shapeErrors.get(i);
      if (shape) return shape;
      const rows = offers.get(item.productId);
      if (!rows) return { status: 'NOT_FOUND' };
      const { violations, items: chosen } = evaluateSelections(
        buildOfferGroups(rows),
        item.selections,
      );
      if (violations.length > 0)
        return { status: 'INVALID', violations: violations.slice(0, MAX_VIOLATIONS) };
      return {
        status: 'OK',
        extraTotal: sumPrices(chosen.map((it) => it.extraPrice)),
        items: chosen,
      };
    });
  }
}
