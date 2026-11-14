import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import type { Principal } from '../auth/auth.types.js';
import { PrismaService } from '../database/prisma.service.js';
import { IdentityService, type CustomerRecord } from '../identity/identity.service.js';
import type { StaffContext } from '../identity/identity.types.js';
import { buildProfilePatch, safeAvatarUrl, type ProfilePatch } from './customer-profile.policy.js';
import type {
  UpdateCustomerProfileDto,
  CustomerStorefrontContextDto,
} from './dto/customer-profile.dto.js';

/** Secciones de Mi cuenta que todavía no tienen contrato (F05, F06, F23). Sin contadores. */
export const PENDING_SECTIONS = ['addresses', 'favorites', 'orders'] as const;

export interface CustomerProfileView {
  authUserId: string;
  email: string | null;
  customer: CustomerRecord;
  isStaff: boolean;
}

/**
 * Perfil comercial del cliente (F04). La identidad (UUID, correo, proveedor) viene SIEMPRE del principal verificado
 * por el JWT; el cuerpo de la solicitud nunca elige a quién se modifica. El correo de Auth no es editable aquí.
 * La pertenencia del personal (F03) no interviene: un empleado que compra usa su propio perfil de cliente.
 */
@Injectable()
export class CustomerProfileService {
  private readonly logger = new Logger(CustomerProfileService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(IdentityService) private readonly identity: IdentityService,
  ) {}

  /** Lee el perfil; lo crea de forma idempotente si todavía no existe (vía IdentityService, UNIQUE auth_user_id). */
  async getProfile(principal: Principal): Promise<CustomerProfileView> {
    const [customer, staff] = await Promise.all([
      this.identity.ensureCustomer(principal),
      this.identity.getStaffContext(principal),
    ]);
    return this.view(principal, customer, staff);
  }

  /**
   * Actualización parcial de nombre y teléfono. Un PATCH sin campos devuelve el perfil sin escribir.
   * Camino normal: un único UPDATE por `auth_user_id`. Si el perfil no existe, se crea (idempotente) y se reintenta.
   */
  async updateProfile(
    principal: Principal,
    input: UpdateCustomerProfileDto,
  ): Promise<CustomerProfileView> {
    const built = buildProfilePatch(input);
    if (!built.ok) throw new BadRequestException(built.errors);

    const [customer, staff] = await Promise.all([
      this.applyPatch(principal, built.patch),
      this.identity.getStaffContext(principal),
    ]);
    return this.view(principal, customer, staff);
  }

  /** Contexto agregado de Mi cuenta: una lectura de perfil y de personal, sin consultas por sección. */
  async getStorefront(principal: Principal): Promise<CustomerStorefrontContextDto> {
    const profile = await this.getProfile(principal);
    return {
      authUserId: principal.authUserId,
      email: principal.email,
      provider: principal.provider,
      avatarUrl: safeAvatarUrl(principal.avatarUrl),
      customer: toCustomerDto(profile.customer),
      isStaff: profile.isStaff,
      pendingSections: [...PENDING_SECTIONS],
    };
  }

  private async applyPatch(principal: Principal, patch: ProfilePatch): Promise<CustomerRecord> {
    if (Object.keys(patch).length === 0) return this.identity.ensureCustomer(principal);

    try {
      return await this.updateByAuthUser(principal.authUserId, patch);
    } catch (error) {
      if ((error as { code?: string }).code !== 'P2025') throw error;
      // Sin perfil todavía: se crea (idempotente) y se aplica el mismo cambio.
      await this.identity.ensureCustomer(principal);
      return this.updateByAuthUser(principal.authUserId, patch);
    }
  }

  private updateByAuthUser(authUserId: string, patch: ProfilePatch): Promise<CustomerRecord> {
    // Solo los campos presentes: un PATCH que envía solo el teléfono no toca el nombre.
    const data: ProfilePatch = {};
    if (patch.fullName !== undefined) data.fullName = patch.fullName;
    if (patch.phone !== undefined) data.phone = patch.phone;
    return this.prisma.customer.update({ where: { authUserId }, data }).then((row) => {
      this.logger.log(`Perfil de cliente actualizado (campos: ${Object.keys(data).join(',')})`);
      return row;
    });
  }

  private view(
    principal: Principal,
    customer: CustomerRecord,
    staff: StaffContext | null,
  ): CustomerProfileView {
    return {
      authUserId: principal.authUserId,
      email: principal.email,
      customer,
      isStaff: staff !== null,
    };
  }
}

/** Proyección pública del perfil: sin datos internos ni de identidad más allá del correo de contacto guardado. */
export function toCustomerDto(customer: CustomerRecord) {
  return {
    id: customer.id,
    fullName: customer.fullName,
    email: customer.email,
    phone: customer.phone,
    createdAt: customer.createdAt.toISOString(),
  };
}
