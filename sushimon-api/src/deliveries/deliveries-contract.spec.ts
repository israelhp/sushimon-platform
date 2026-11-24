import type { components } from '../../../packages/contracts/src/schema.js';
import type {
  AdminDeliveryActionStateDto,
  AdminDeliveryAddressDto,
  AdminDeliveryCommandResultDto,
  AdminDeliveryCustomerDto,
  AdminDeliveryDto,
  AdminDeliveryHistoryEntryDto,
  AdminDeliveryOrderRefDto,
  AdminDeliveryPageDto,
  AdminDeliveryRiderDto,
  AdminDeliverySummaryDto,
  AdminDeliveryTransitionDto,
} from './dto/deliveries-responses.dto.js';
import type {
  AdminDeliveryCommandRequest,
  AssignOwnRiderRequest,
  CancelAdminDeliveryRequest,
  CreateAdminDeliveryRequest,
  UnassignRiderRequest,
} from './dto/deliveries-requests.dto.js';
import { COMMAND_SPECS, DELIVERY_EVENTS, DELIVERY_STATUSES } from './delivery-policy.js';

type S = components['schemas'];
/** Igualdad EXACTA de conjuntos de claves (falla de compilación si el DTO añade o pierde una propiedad del contrato). */
type SameKeys<A, B> = [keyof A] extends [keyof B]
  ? [keyof B] extends [keyof A]
    ? true
    : never
  : never;
const same = <T extends true>(value: T): void => void value;

describe('R39 DTOs alineados con el contrato OpenAPI (comprobación de tipos y de enums)', () => {
  it('claves de cada respuesta y petición idénticas a `schema.d.ts` (si no, `pnpm typecheck` falla)', () => {
    same<SameKeys<AdminDeliverySummaryDto, S['AdminDeliverySummary']>>(true);
    same<SameKeys<AdminDeliveryDto, S['AdminDelivery']>>(true);
    same<SameKeys<AdminDeliveryPageDto, S['AdminDeliveryPage']>>(true);
    same<SameKeys<AdminDeliveryCommandResultDto, S['AdminDeliveryCommandResult']>>(true);
    same<SameKeys<AdminDeliveryTransitionDto, S['AdminDeliveryTransition']>>(true);
    same<SameKeys<AdminDeliveryRiderDto, S['AdminDeliveryRider']>>(true);
    same<SameKeys<AdminDeliveryOrderRefDto, S['AdminDeliveryOrderRef']>>(true);
    same<SameKeys<AdminDeliveryAddressDto, S['AdminDeliveryAddress']>>(true);
    same<SameKeys<AdminDeliveryCustomerDto, S['AdminDeliveryCustomer']>>(true);
    same<SameKeys<AdminDeliveryActionStateDto, S['AdminDeliveryActionState']>>(true);
    same<SameKeys<AdminDeliveryHistoryEntryDto, S['AdminDeliveryHistoryEntry']>>(true);
    same<SameKeys<CreateAdminDeliveryRequest, S['CreateAdminDeliveryRequest']>>(true);
    same<SameKeys<AssignOwnRiderRequest, S['AssignOwnRiderRequest']>>(true);
    same<SameKeys<AdminDeliveryCommandRequest, S['AdminDeliveryCommandRequest']>>(true);
    same<SameKeys<UnassignRiderRequest, S['UnassignRiderRequest']>>(true);
    same<SameKeys<CancelAdminDeliveryRequest, S['CancelAdminDeliveryRequest']>>(true);
    expect(true).toBe(true);
  });

  it('un valor del contrato es asignable a la forma que la API emite (estados y eventos)', () => {
    const status: S['AdminDeliveryStatus'] = 'picked_up';
    const event: S['AdminDeliveryEvent'] = 'rider_reassigned';
    const asDto: AdminDeliveryTransitionDto = {
      from: status,
      to: status,
      event,
      at: '2026-11-18T19:00:00.000Z',
      replayed: false,
      appliedByMe: true,
    };
    expect(asDto.event).toBe('rider_reassigned');
  });

  it('los enums de la política coinciden con los del contrato', () => {
    const statuses: S['AdminDeliveryStatus'][] = [...DELIVERY_STATUSES];
    const events: S['AdminDeliveryEvent'][] = [...DELIVERY_EVENTS];
    expect(statuses).toHaveLength(6);
    expect(events).toHaveLength(9);
    const actions: S['AdminDeliveryAction'][] = [
      'assign_rider',
      'reassign_rider',
      'unassign_rider',
      'mark_picked_up',
      'mark_delivered',
      'return_to_branch',
      'cancel',
    ];
    expect(actions).toHaveLength(7);
    expect(Object.values(COMMAND_SPECS).map((s) => s.route)).toEqual([
      'assign-own-rider',
      'unassign-rider',
      'mark-picked-up',
      'mark-delivered',
      'return-to-branch',
      'cancel',
    ]);
  });
});
