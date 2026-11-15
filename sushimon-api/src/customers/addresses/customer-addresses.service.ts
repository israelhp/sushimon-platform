import { BadRequestException, HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';
import { AuditService } from '../../audit/audit.service.js';
import type { Principal } from '../../auth/auth.types.js';
import { codedException, type ErrorViolation } from '../../common/errors/coded-exception.js';
import { PrismaService } from '../../database/prisma.service.js';
import { IdentityService } from '../../identity/identity.service.js';
import {
  ADDRESS_LIMIT,
  canAddAddress,
  duplicateKey,
  normalizeAddressFields,
  type AddressViolation,
  type NormalizedAddressFields,
} from './customer-address.policy.js';
import type {
  CreateCustomerAddressDto,
  CustomerAddressDto,
  CustomerAddressListDto,
  UpdateCustomerAddressDto,
} from './dto/customer-address.dto.js';

const ENTITY = 'customer_address';

/** Espera máxima para obtener una conexión/transacción y tiempo máximo de la transacción (ms). */
const TX_MAX_WAIT_MS = 10_000;
const TX_TIMEOUT_MS = 15_000;

/** Forma que el servicio lee de Prisma: sin columnas innecesarias y con departamento en una sola consulta. */
const ADDRESS_SELECT = {
  id: true,
  customerId: true,
  label: true,
  zone: true,
  addressLine: true,
  referenceNote: true,
  latitude: true,
  longitude: true,
  isDefault: true,
  createdAt: true,
  municipalityId: true,
  municipality: {
    select: { id: true, name: true, department: { select: { id: true, name: true } } },
  },
} satisfies Prisma.CustomerAddressSelect;

type AddressRow = Prisma.CustomerAddressGetPayload<{ select: typeof ADDRESS_SELECT }>;

/** Textos de error sin datos personales ni identificadores de otros clientes. */
const NOT_FOUND = 'Dirección no encontrada';

/**
 * Direcciones guardadas del cliente autenticado (F05). El propietario SIEMPRE sale de la identidad verificada
 * (JWT → `app.customers.id`); el cuerpo nunca elige a quién pertenece. Toda consulta y mutación filtra por
 * `customerId`: una dirección ajena responde 404, igual que una inexistente (sin enumeración).
 *
 * Concurrencia: las mutaciones toman `SELECT … FOR UPDATE` sobre la fila del cliente. Así límite, duplicados y
 * predeterminada se comprueban y escriben de forma serializada por cliente. El índice único parcial de SQL es la
 * última barrera para la predeterminada.
 */
@Injectable()
export class CustomerAddressesService {
  private readonly logger = new Logger(CustomerAddressesService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(IdentityService) private readonly identity: IdentityService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async list(principal: Principal): Promise<CustomerAddressListDto> {
    const customerId = await this.existingOwnerId(principal);
    if (!customerId) return { items: [] };
    const rows = await this.prisma.customerAddress.findMany({
      where: { customerId },
      select: ADDRESS_SELECT,
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }, { id: 'asc' }],
    });
    return { items: rows.map(toDto) };
  }

  async get(principal: Principal, id: string): Promise<CustomerAddressDto> {
    const customerId = await this.requireOwnerId(principal);
    const row = await this.prisma.customerAddress.findFirst({
      where: { id, customerId },
      select: ADDRESS_SELECT,
    });
    if (!row) throw notFound();
    return toDto(row);
  }

  async create(principal: Principal, input: CreateCustomerAddressDto): Promise<CustomerAddressDto> {
    const customerId = await this.ensureOwnerId(principal);
    const fields = normalizeOrThrow({
      label: input.label,
      zone: input.zone,
      addressLine: input.addressLine,
      referenceNote: input.referenceNote,
      latitude: input.latitude,
      longitude: input.longitude,
    });
    const complete = requireComplete(fields);

    return this.transactional(async (tx) => {
      await lockCustomer(tx, customerId);

      const existing = await tx.customerAddress.findMany({
        where: { customerId },
        select: { id: true, addressLine: true, zone: true, municipalityId: true, isDefault: true },
      });
      if (!canAddAddress(existing.length)) {
        throw codedException(
          HttpStatus.CONFLICT,
          'ADDRESS_LIMIT_REACHED',
          `Podés guardar hasta ${ADDRESS_LIMIT} direcciones. Eliminá una para agregar otra.`,
        );
      }
      await assertMunicipality(tx, input.municipalityId);
      const key = duplicateKey({
        addressLine: complete.addressLine,
        municipalityId: input.municipalityId,
        zone: complete.zone,
      });
      if (existing.some((e) => duplicateKey(e) === key)) throw duplicateError();

      // La primera dirección siempre es predeterminada; después solo si se pide explícitamente.
      const makeDefault = existing.length === 0 || input.isDefault === true;
      if (makeDefault && existing.some((e) => e.isDefault)) {
        await tx.customerAddress.updateMany({
          where: { customerId, isDefault: true },
          data: { isDefault: false },
        });
      }

      const created = await tx.customerAddress.create({
        data: {
          customerId,
          municipalityId: input.municipalityId,
          label: complete.label,
          zone: complete.zone,
          addressLine: complete.addressLine,
          referenceNote: complete.referenceNote,
          latitude: complete.latitude,
          longitude: complete.longitude,
          isDefault: makeDefault,
        },
        select: ADDRESS_SELECT,
      });
      await this.audit.record(tx, {
        actorId: null,
        entityType: ENTITY,
        entityId: created.id,
        action: 'customer_address.created',
        newValues: { customerId, isDefault: makeDefault },
      });
      this.logger.log(`Dirección creada (id=${created.id}, customer=${customerId})`);
      return toDto(created);
    });
  }

  async update(
    principal: Principal,
    id: string,
    input: UpdateCustomerAddressDto,
  ): Promise<CustomerAddressDto> {
    const customerId = await this.requireOwnerId(principal);
    const touched = changedKeys(input);
    if (touched.length === 0) return this.get(principal, id);

    return this.transactional(async (tx) => {
      await lockCustomer(tx, customerId);
      const current = await tx.customerAddress.findFirst({
        where: { id, customerId },
        select: ADDRESS_SELECT,
      });
      if (!current) throw notFound();

      // Fusiona con lo guardado y valida el resultado completo: un campo nuevo no puede romper uno ya válido.
      const merged = {
        label: input.label ?? current.label,
        zone: input.zone !== undefined ? input.zone : current.zone,
        addressLine: input.addressLine ?? current.addressLine,
        referenceNote:
          input.referenceNote !== undefined ? input.referenceNote : current.referenceNote,
        latitude: input.latitude !== undefined ? input.latitude : toNumber(current.latitude),
        longitude: input.longitude !== undefined ? input.longitude : toNumber(current.longitude),
      };
      const fields = normalizeOrThrow(merged);
      const complete = requireComplete(fields);

      const municipalityId = input.municipalityId ?? current.municipalityId;
      if (input.municipalityId !== undefined && input.municipalityId !== current.municipalityId) {
        await assertMunicipality(tx, municipalityId);
      }

      const others = await tx.customerAddress.findMany({
        where: { customerId, NOT: { id } },
        select: { addressLine: true, zone: true, municipalityId: true },
      });
      const key = duplicateKey({
        addressLine: complete.addressLine,
        municipalityId,
        zone: complete.zone,
      });
      if (others.some((o) => duplicateKey(o) === key)) throw duplicateError();

      const updated = await tx.customerAddress.update({
        where: { id },
        data: {
          municipalityId,
          label: complete.label,
          zone: complete.zone,
          addressLine: complete.addressLine,
          referenceNote: complete.referenceNote,
          latitude: complete.latitude,
          longitude: complete.longitude,
        },
        select: ADDRESS_SELECT,
      });
      // Auditoría sin contenido: solo los nombres de los campos que cambiaron (la dirección es PII).
      await this.audit.record(tx, {
        actorId: null,
        entityType: ENTITY,
        entityId: id,
        action: 'customer_address.updated',
        newValues: { customerId, changedFields: touched },
      });
      return toDto(updated);
    });
  }

  /** Marca la predeterminada. Idempotente: si ya lo es, no escribe. */
  async setDefault(principal: Principal, id: string): Promise<CustomerAddressDto> {
    const customerId = await this.requireOwnerId(principal);
    return this.transactional(async (tx) => {
      await lockCustomer(tx, customerId);
      const target = await tx.customerAddress.findFirst({
        where: { id, customerId },
        select: { id: true, isDefault: true },
      });
      if (!target) throw notFound();
      if (!target.isDefault) {
        await tx.customerAddress.updateMany({
          where: { customerId, isDefault: true, NOT: { id } },
          data: { isDefault: false },
        });
        await tx.customerAddress.update({ where: { id }, data: { isDefault: true } });
        await this.audit.record(tx, {
          actorId: null,
          entityType: ENTITY,
          entityId: id,
          action: 'customer_address.default_changed',
          newValues: { customerId, isDefault: true },
        });
      }
      const row = await tx.customerAddress.findUniqueOrThrow({
        where: { id },
        select: ADDRESS_SELECT,
      });
      return toDto(row);
    });
  }

  /**
   * Borra la dirección. Si era la predeterminada, reasigna una de forma determinista: la más antigua restante
   * (createdAt, id). Los pedidos confirmados conservan su snapshot (F20); no hay borrado en cascada hacia ellos.
   */
  async remove(principal: Principal, id: string): Promise<void> {
    const customerId = await this.requireOwnerId(principal);
    await this.transactional(async (tx) => {
      await lockCustomer(tx, customerId);
      const target = await tx.customerAddress.findFirst({
        where: { id, customerId },
        select: { id: true, isDefault: true },
      });
      if (!target) throw notFound();

      await tx.customerAddress.delete({ where: { id } });
      await this.audit.record(tx, {
        actorId: null,
        entityType: ENTITY,
        entityId: id,
        action: 'customer_address.deleted',
        newValues: { customerId, wasDefault: target.isDefault },
      });

      if (target.isDefault) {
        const next = await tx.customerAddress.findFirst({
          where: { customerId },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          select: { id: true },
        });
        if (next) {
          await tx.customerAddress.update({ where: { id: next.id }, data: { isDefault: true } });
        }
      }
    });
  }

  /** Lectura sin efectos: el cliente de la identidad, o null si aún no tiene fila (no la crea). */
  private async existingOwnerId(principal: Principal): Promise<string | null> {
    const customer = await this.identity.findCustomer(principal);
    return customer?.id ?? null;
  }

  /** Sin fila de cliente no puede haber direcciones propias: 404 como una dirección inexistente. */
  private async requireOwnerId(principal: Principal): Promise<string> {
    const id = await this.existingOwnerId(principal);
    if (!id) throw notFound();
    return id;
  }

  /** Solo el alta crea el perfil de cliente (idempotente, reutiliza F04/F01). */
  private async ensureOwnerId(principal: Principal): Promise<string> {
    const customer = await this.identity.ensureCustomer(principal);
    return customer.id;
  }

  /**
   * Transacción de direcciones con espera explícita. Las mutaciones de un mismo cliente se serializan con
   * `FOR UPDATE`: las peticiones concurrentes esperan su turno (maxWait) en lugar de fallar con
   * «Unable to start a transaction» (error interno) cuando el pool se llena.
   */
  private transactional<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(fn, { maxWait: TX_MAX_WAIT_MS, timeout: TX_TIMEOUT_MS });
  }
}

/** Serializa las mutaciones de un cliente. Bloquea su fila hasta el COMMIT/ROLLBACK de la transacción. */
async function lockCustomer(tx: Prisma.TransactionClient, customerId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM app.customers WHERE id = ${customerId}::uuid FOR UPDATE`;
}

async function assertMunicipality(tx: Prisma.TransactionClient, municipalityId: string) {
  const found = await tx.municipality.findUnique({
    where: { id: municipalityId },
    select: { id: true },
  });
  if (!found) {
    throw codedException(
      HttpStatus.BAD_REQUEST,
      'MUNICIPALITY_NOT_FOUND',
      'Municipio inexistente',
      [
        {
          path: 'municipalityId',
          code: 'MUNICIPALITY_NOT_FOUND',
          message: 'Municipio inexistente',
        },
      ],
    );
  }
}

function normalizeOrThrow(input: {
  label?: string;
  zone?: string | null;
  addressLine?: string;
  referenceNote?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}) {
  const result = normalizeAddressFields(input);
  if (!result.ok) throw validationError(result.violations);
  return result.value;
}

/** Tras normalizar, un registro nuevo debe tener todos los campos obligatorios. */
function requireComplete(fields: Partial<NormalizedAddressFields>): NormalizedAddressFields {
  const violations: AddressViolation[] = [];
  if (fields.label === undefined) {
    violations.push({ path: 'label', code: 'LABEL_REQUIRED', message: 'label: obligatoria' });
  }
  if (fields.addressLine === undefined) {
    violations.push({
      path: 'addressLine',
      code: 'ADDRESS_LINE_REQUIRED',
      message: 'addressLine: obligatoria',
    });
  }
  if (violations.length > 0) throw validationError(violations);
  return {
    label: fields.label as string,
    addressLine: fields.addressLine as string,
    zone: fields.zone ?? null,
    referenceNote: fields.referenceNote ?? null,
    latitude: fields.latitude ?? null,
    longitude: fields.longitude ?? null,
  };
}

function validationError(violations: AddressViolation[]): BadRequestException {
  return new BadRequestException({
    message: 'Datos de dirección inválidos',
    code: 'ADDRESS_INVALID',
    violations: violations as ErrorViolation[],
  });
}

function notFound() {
  return codedException(HttpStatus.NOT_FOUND, 'ADDRESS_NOT_FOUND', NOT_FOUND);
}

function duplicateError() {
  return codedException(
    HttpStatus.CONFLICT,
    'ADDRESS_DUPLICATE',
    'Ya tenés esta dirección guardada.',
  );
}

/** Campos realmente presentes en el PATCH (para auditoría y para omitir la escritura si no hay cambios). */
function changedKeys(input: UpdateCustomerAddressDto): string[] {
  return Object.keys(input).filter((k) => (input as Record<string, unknown>)[k] !== undefined);
}

function toNumber(value: Prisma.Decimal | null): number | null {
  return value === null ? null : value.toNumber();
}

export function toDto(row: AddressRow): CustomerAddressDto {
  return {
    id: row.id,
    label: row.label,
    department: { id: row.municipality.department.id, name: row.municipality.department.name },
    municipality: { id: row.municipality.id, name: row.municipality.name },
    zone: row.zone,
    addressLine: row.addressLine,
    referenceNote: row.referenceNote,
    latitude: toNumber(row.latitude),
    longitude: toNumber(row.longitude),
    isDefault: row.isDefault,
    createdAt: row.createdAt.toISOString(),
  };
}
