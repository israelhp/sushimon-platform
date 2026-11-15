import type { DataClient } from '@/lib/data-access/types';
import type {
  Address,
  AddressInput,
  Customer,
  CustomerStorefrontContext,
  MeResponse,
  Order,
  UpdateCustomerProfileRequest,
} from '@/lib/data-access/models';
import { paths } from '@/lib/data-access/paths';

/** Cuenta del cliente. Requiere sesión de cliente (simulada en la Etapa 1). */

/** Campos que F04 permite editar: nombre y teléfono. El correo es de la identidad y no se envía. */
export type CustomerUpdate = UpdateCustomerProfileRequest;

/**
 * Respuesta de /v1/me. `defaultAddressId` es una extensión de SIMULACIÓN de F05 (aún no está en el contrato
 * de F04); la API real no lo devuelve y en ese caso queda en null.
 */
type MeWithSimulatedAddress = MeResponse & { defaultAddressId?: string | null };

/** Aplana el perfil del contrato al modelo de UI (`Customer`). */
export function toCustomer(me: MeWithSimulatedAddress): Customer {
  return {
    email: me.email ?? me.customer.email ?? '',
    fullName: me.customer.fullName,
    phone: me.customer.phone ?? '',
    defaultAddressId: me.defaultAddressId ?? null,
  };
}

export const getMe = async (client: DataClient): Promise<Customer> =>
  toCustomer(await client.get<MeWithSimulatedAddress>(paths.me()));

export const updateMe = async (client: DataClient, input: CustomerUpdate): Promise<Customer> =>
  toCustomer(await client.patch<MeWithSimulatedAddress>(paths.me(), input));

/** F04 (contrato): contexto agregado de Mi cuenta, una sola solicitud. */
export const getCustomerStorefront = (client: DataClient) =>
  client.get<CustomerStorefrontContext>(paths.myStorefront());

/** 🎭 F05 simulado: marca la dirección predeterminada (null = ninguna). Nunca por PATCH /v1/me. */
export const setDefaultAddress = async (client: DataClient, id: string | null): Promise<void> => {
  await client.put<{ defaultAddressId: string | null }>(paths.demoDefaultAddress(), {
    addressId: id,
  });
};

export const listAddresses = (client: DataClient) => client.get<Address[]>(paths.myAddresses());

export const createAddress = (client: DataClient, input: AddressInput) =>
  client.post<Address>(paths.myAddresses(), input);

export const updateAddress = (client: DataClient, id: string, input: Partial<AddressInput>) =>
  client.patch<Address>(paths.myAddress(id), input);

export const deleteAddress = (client: DataClient, id: string) =>
  client.delete<void>(paths.myAddress(id));

export const listMyOrders = (client: DataClient) => client.get<Order[]>(paths.myOrders());
