import type { AuthorizationService } from '../../auth/authorization.service.js';
import type { StaffContext } from '../../identity/identity.types.js';
import type { AdminOrderRow } from './admin-orders.types.js';
import { availableActionsFor, type ActionState } from './order-transition.matrix.js';

/** Acciones de ESTE personal sobre ESTE pedido: cada permiso se resuelve EN LA SUCURSAL DEL PEDIDO (nunca por unión plana). */
export function actionsForStaff(
  authorization: AuthorizationService,
  staff: StaffContext,
  order: Pick<AdminOrderRow, 'status' | 'fulfillmentType' | 'deliveryProvider' | 'branchId'>,
): ActionState[] {
  return availableActionsFor(order, (permission) =>
    authorization.canAccess(staff, permission, order.branchId),
  );
}
