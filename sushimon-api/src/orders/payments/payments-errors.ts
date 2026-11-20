import { HttpException, HttpStatus } from '@nestjs/common';
import { codedException } from '../../common/errors/coded-exception.js';

/** Razones de 422 `PAYMENT_NOT_COLLECTABLE` (`violations[].code`, contrato). */
export type NotCollectableCode =
  'PROVIDER_BLOCKED_EXTERNAL' | 'LEGACY_PAYMENT_METHOD' | 'AMOUNT_ZERO';

export const paymentAmountInvalid = () =>
  codedException(
    HttpStatus.BAD_REQUEST,
    'PAYMENT_AMOUNT_INVALID',
    'El efectivo entregado debe ser un importe mayor que cero con hasta 2 decimales',
  );

export const paymentConfirmationRequired = () =>
  codedException(
    HttpStatus.BAD_REQUEST,
    'PAYMENT_CONFIRMATION_REQUIRED',
    'Debes confirmar que recibiste físicamente el dinero',
  );

export const paymentActionForbidden = () =>
  codedException(
    HttpStatus.FORBIDDEN,
    'PAYMENT_ACTION_FORBIDDEN',
    'No tienes permiso para registrar pagos en la sucursal del pedido',
  );

export const cashAmountInsufficient = () =>
  codedException(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'CASH_AMOUNT_INSUFFICIENT',
    'El efectivo entregado es menor que el total del pedido',
  );

export const cashTenderedTooLarge = () =>
  codedException(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'CASH_TENDERED_TOO_LARGE',
    'El efectivo entregado supera el máximo permitido',
  );

const NOT_COLLECTABLE_MESSAGES: Readonly<Record<NotCollectableCode, string>> = {
  PROVIDER_BLOCKED_EXTERNAL: 'Los pedidos de PedidosYa no se cobran desde aquí',
  LEGACY_PAYMENT_METHOD: 'El pedido es histórico y no tiene un pago en efectivo',
  AMOUNT_ZERO: 'El pedido no tiene importe que cobrar',
};

export const paymentNotCollectable = (code: NotCollectableCode) =>
  codedException(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'PAYMENT_NOT_COLLECTABLE',
    'El pedido no se puede cobrar',
    [{ path: 'order', code, message: NOT_COLLECTABLE_MESSAGES[code] }],
  );

/** 409 con el pago ACTUAL (`current`, contrato `AdminPaymentConflict`; el filtro global lo propaga como cuerpo extra). */
const conflictWithCurrent = (code: string, message: string, current: unknown) =>
  new HttpException({ message, code, extra: { current } }, HttpStatus.CONFLICT);

export const paymentAlreadyRegistered = (current: unknown) =>
  conflictWithCurrent(
    'PAYMENT_ALREADY_REGISTERED',
    'El pago de este pedido ya fue registrado',
    current,
  );

export const orderNotPayable = (current: unknown) =>
  conflictWithCurrent(
    'ORDER_NOT_PAYABLE',
    'El pedido está cancelado o rechazado: no se cobra',
    current,
  );
