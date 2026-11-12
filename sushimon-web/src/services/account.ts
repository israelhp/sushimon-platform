import type { DataClient } from '@/lib/data-access/types';
import type { Address, AddressInput, Customer, Order } from '@/lib/data-access/models';
import { paths } from '@/lib/data-access/paths';

/** Cuenta del cliente (`/v1/me`). Requiere sesión de cliente (simulada en la Etapa 1). */

export type CustomerUpdate = Partial<
  Pick<Customer, 'fullName' | 'phone' | 'email' | 'defaultAddressId'>
>;

export const getMe = (client: DataClient) => client.get<Customer>(paths.me());

export const updateMe = (client: DataClient, input: CustomerUpdate) =>
  client.patch<Customer>(paths.me(), input);

export const listAddresses = (client: DataClient) => client.get<Address[]>(paths.myAddresses());

export const createAddress = (client: DataClient, input: AddressInput) =>
  client.post<Address>(paths.myAddresses(), input);

export const updateAddress = (client: DataClient, id: string, input: Partial<AddressInput>) =>
  client.patch<Address>(paths.myAddress(id), input);

export const deleteAddress = (client: DataClient, id: string) =>
  client.delete<void>(paths.myAddress(id));

export const setDefaultAddress = (client: DataClient, id: string | null) =>
  updateMe(client, { defaultAddressId: id });

export const listFavorites = (client: DataClient) => client.get<string[]>(paths.myFavorites());

export const addFavorite = (client: DataClient, productId: string) =>
  client.put<string[]>(paths.myFavorite(productId));

export const removeFavorite = (client: DataClient, productId: string) =>
  client.delete<string[]>(paths.myFavorite(productId));

export const listMyOrders = (client: DataClient) => client.get<Order[]>(paths.myOrders());
