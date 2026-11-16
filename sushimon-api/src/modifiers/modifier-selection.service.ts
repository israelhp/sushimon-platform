import { Inject, Injectable } from '@nestjs/common';
import {
  assertSelectionShape,
  buildOfferGroups,
  productNotFound,
  validateSelections,
} from './modifier-policy.js';
import { ModifiersRepository } from './modifiers.repository.js';
import type { ModifierSelection, ModifierSelectionResult } from './modifiers.types.js';

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
}
