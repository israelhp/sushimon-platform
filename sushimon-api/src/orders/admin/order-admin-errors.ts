import { HttpException, HttpStatus } from '@nestjs/common';
import { codedException } from '../../common/errors/coded-exception.js';
import type { ViolationCode } from './order-transition.matrix.js';

/** Estado actual que viaja en 409/422 (`current`, contrato `AdminOrderStateSnapshot`). */
export interface CurrentState {
  status: string;
  updatedAt: Date;
}

const currentOf = (state: CurrentState) => ({
  status: state.status,
  updatedAt: state.updatedAt.toISOString(),
});

/** 404 ÚNICO para pedido inexistente y pedido fuera del alcance (anti-IDOR): mismo cuerpo y cabeceras. */
export const adminOrderNotFound = () =>
  codedException(HttpStatus.NOT_FOUND, 'ORDER_NOT_FOUND', 'Pedido no encontrado');

export const adminBranchNotFound = () =>
  codedException(HttpStatus.NOT_FOUND, 'BRANCH_NOT_FOUND', 'Sucursal no encontrada');

export const orderActionForbidden = () =>
  codedException(
    HttpStatus.FORBIDDEN,
    'ORDER_ACTION_FORBIDDEN',
    'No tienes permiso para esta acción en la sucursal del pedido',
  );

export const orderReasonRequired = () =>
  codedException(
    HttpStatus.BAD_REQUEST,
    'ORDER_REASON_REQUIRED',
    'El motivo es obligatorio (3 a 280 caracteres)',
  );

export const orderCursorInvalid = () =>
  codedException(HttpStatus.BAD_REQUEST, 'ORDER_CURSOR_INVALID', 'Cursor inválido');

export const orderStateConflict = (current: CurrentState) =>
  new HttpException(
    {
      message: 'El pedido cambió mientras lo veías',
      code: 'ORDER_STATE_CONFLICT',
      extra: { current: currentOf(current) },
    },
    HttpStatus.CONFLICT,
  );

const VIOLATION_MESSAGES: Readonly<Record<ViolationCode, string>> = {
  ORDER_TERMINAL: 'El pedido ya está finalizado',
  ORDER_FULFILLMENT_MISMATCH: 'La acción no corresponde a la modalidad de entrega del pedido',
  ORDER_SOURCE_INVALID: 'El estado de origen no permite esta acción',
  ORDER_DISPATCH_NOT_AVAILABLE: 'El despacho aún no está disponible',
  ORDER_PROVIDER_BLOCKED_EXTERNAL: 'La integración con el proveedor externo no está disponible',
  ORDER_CANCEL_NOT_ALLOWED: 'No se puede cancelar un pedido que ya salió a entrega',
};

export const orderTransitionInvalid = (code: ViolationCode, current: CurrentState) =>
  new HttpException(
    {
      message: 'La transición del pedido no está permitida',
      code: 'ORDER_TRANSITION_INVALID',
      violations: [{ path: 'expectedStatus', code, message: VIOLATION_MESSAGES[code] }],
      extra: { current: currentOf(current) },
    },
    HttpStatus.UNPROCESSABLE_ENTITY,
  );
