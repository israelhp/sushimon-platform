'use client';

import {
  hashKey,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { useToast } from '@/components/ui/Toast';
import type { CustomerFavorites } from '@/lib/data-access/models';
import { useDataClient } from '@/lib/data-access/provider';
import { addMyFavorite, listMyFavoriteIds, removeMyFavorite } from '@/services/favorites';
import { queryKeys } from '../query-keys';
import { useCustomerScope } from '../session/customer-scope';
import { useAuthModal } from '../store-shell/store-shell-context';
import { applyToggle, removeFromPage, rollbackToggle } from './cache';
import { favoriteErrorKind } from './errors';
import { DEFAULT_LIMIT, IDS_STALE_MS, NO_SCOPE } from './hooks';

/**
 * F06 — Estado de los corazones (spec 010 D15–D17). UN proveedor por tienda con UN observer de `ids`, UNA mutación y UN
 * lector de la identidad, en lugar de un `useQuery` + `useMutation` + `useMutationState` por tarjeta. Cada corazón se
 * suscribe solo a SU producto (`useIsFavorite`, `useIsFavoritePending`): al marcar A no se re-renderiza B.
 */

export interface ToggleVariables {
  productId: string;
  /** Estado deseado: `true` = marcar, `false` = quitar. */
  favorite: boolean;
  /** Nombre para los avisos (ya localizado). */
  name: string;
}

interface ToggleContext {
  scope: string;
  was: { favorite: boolean; index: number };
}

/** Conjunto de productos con una alta/baja en vuelo, observable por producto (sin re-render global). */
function createPendingStore() {
  const ids = new Set<string>();
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((l) => l());
  return {
    has: (id: string) => ids.has(id),
    add: (id: string) => {
      ids.add(id);
      emit();
    },
    delete: (id: string) => {
      if (ids.delete(id)) emit();
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}
type PendingStore = ReturnType<typeof createPendingStore>;

export interface FavoritesApi {
  /** Identidad: `guest` (sin sesión) · `pending` (resolviéndose) · `ready`. */
  state: 'guest' | 'pending' | 'ready';
  /** `scope` de la caché (null sin sesión). */
  scope: string | null;
  /** Aún no se conoce el estado de los corazones. */
  isPending: boolean;
  isError: boolean;
  refetch: () => void;
  /** Alta/baja optimista. `false` si se ignoró (sin sesión o ya hay una de ese producto en vuelo). */
  toggle: (variables: ToggleVariables) => boolean;
  /** Abre el inicio de sesión (visitante). Estable: no cambia con los overlays de la tienda. */
  openLogin: () => void;
  pending: PendingStore;
}

const FavoritesContext = createContext<FavoritesApi | null>(null);

export function useFavoritesApi(): FavoritesApi {
  const ctx = useContext(FavoritesContext);
  if (!ctx) throw new Error('useFavoritesApi debe usarse dentro de <FavoritesProvider>');
  return ctx;
}

export function FavoritesProvider({ children }: { children: ReactNode }) {
  const client = useDataClient();
  const queryClient = useQueryClient();
  const identity = useCustomerScope();
  const auth = useAuthModal();
  const { notify } = useToast();
  const t = useTranslations('fav');
  const scope = identity.state === 'ready' ? identity.scope : null;
  const [pending] = useState(createPendingStore);

  // Los callbacks de la mutación leen siempre lo último sin cambiar la identidad del contexto.
  const latest = useRef({ auth, notify, t });
  useEffect(() => {
    latest.current = { auth, notify, t };
  });

  const query = useQuery({
    queryKey: queryKeys.customer.favorites.ids(scope ?? NO_SCOPE),
    queryFn: ({ signal }) => listMyFavoriteIds(client, signal),
    enabled: scope !== null,
    staleTime: IDS_STALE_MS,
  });

  const mutationKey = queryKeys.customer.favorites.mutation(scope ?? NO_SCOPE);
  const { mutate } = useMutation<void, unknown, ToggleVariables, ToggleContext | undefined>({
    mutationKey,
    mutationFn: ({ productId, favorite }) =>
      favorite ? addMyFavorite(client, productId) : removeMyFavorite(client, productId),
    onMutate: async ({ productId, favorite }) => {
      if (scope === null) return undefined;
      const keys = queryKeys.customer.favorites;
      // Una consulta en vuelo podría pisar el cambio optimista con datos anteriores a la mutación.
      await queryClient.cancelQueries({ queryKey: keys.all(scope) });
      const before = queryClient.getQueryData<CustomerFavorites>(keys.ids(scope));
      const index = before?.favoriteProductIds.indexOf(productId) ?? -1;
      queryClient.setQueryData<CustomerFavorites>(
        keys.ids(scope),
        (old) => old && applyToggle(old, productId, favorite),
      );
      if (!favorite) {
        queryClient.setQueriesData<CustomerFavorites>({ queryKey: keys.lists(scope) }, (old) =>
          old ? removeFromPage(old, productId) : old,
        );
      }
      return { scope, was: { favorite: index >= 0, index } };
    },
    onError: (error, { productId }, context) => {
      const { notify: say, t: tr, auth: login } = latest.current;
      // Siempre contra el `scope` CAPTURADO al marcar: si entretanto cambió la cuenta, la caché nueva no se toca
      // (la anterior ya fue descartada y `setQueryData` con un updater que devuelve undefined no la recrea).
      if (context) {
        queryClient.setQueryData<CustomerFavorites>(
          queryKeys.customer.favorites.ids(context.scope),
          (old) => old && rollbackToggle(old, productId, context.was),
        );
      }
      const kind = favoriteErrorKind(error);
      const limit = queryClient.getQueryData<CustomerFavorites>(
        queryKeys.customer.favorites.ids(context?.scope ?? NO_SCOPE),
      )?.limit;
      switch (kind) {
        case 'limit':
          say(tr('errorLimit', { a: limit ?? DEFAULT_LIMIT }));
          break;
        case 'catalog':
          say(tr('errorCatalog'));
          break;
        case 'busy':
          say(tr('errorBusy'));
          break;
        case 'notFound':
          say(tr('errorNotFound'));
          break;
        case 'rateLimited':
          say(tr('errorRate'));
          break;
        case 'offline':
          say(tr('errorOffline'));
          break;
        case 'unauthorized':
          // La sesión terminó: se descarta todo dato del cliente y se invita a iniciar sesión.
          queryClient.removeQueries({ queryKey: queryKeys.customer.all });
          say(tr('errorSession'));
          login.open();
          break;
        default:
          say(tr('error'));
      }
    },
    onSuccess: (_data, { favorite, name }) => {
      const { notify: say, t: tr } = latest.current;
      say(favorite ? tr('added', { a: name }) : tr('removed', { a: name }));
    },
    onSettled: async (_data, _error, { productId }, context) => {
      try {
        if (!context) return;
        // Esta mutación sigue contada como "en curso" durante `onSettled`: solo la última refresca.
        const inFlight = queryClient.isMutating({
          mutationKey: queryKeys.customer.favorites.mutation(context.scope),
        });
        if (inFlight <= 1) {
          await queryClient.invalidateQueries({
            queryKey: queryKeys.customer.favorites.all(context.scope),
          });
        }
      } finally {
        pending.delete(productId);
      }
    },
  });

  const toggle = useCallback(
    (variables: ToggleVariables): boolean => {
      if (scope === null || pending.has(variables.productId)) return false;
      pending.add(variables.productId);
      mutate(variables);
      return true;
    },
    [scope, pending, mutate],
  );
  const openLogin = useCallback(() => latest.current.auth.open(), []);
  const { refetch: refetchQuery } = query;
  const refetch = useCallback(() => void refetchQuery(), [refetchQuery]);

  const isPending = identity.state === 'pending' || (scope !== null && query.isPending);
  const isError = scope !== null && query.isError;
  const api = useMemo<FavoritesApi>(
    () => ({
      state: identity.state,
      scope,
      isPending,
      isError,
      refetch,
      toggle,
      openLogin,
      pending,
    }),
    [identity.state, scope, isPending, isError, refetch, toggle, openLogin, pending],
  );
  return <FavoritesContext.Provider value={api}>{children}</FavoritesContext.Provider>;
}

const setCache = new WeakMap<object, ReadonlySet<string>>();
function idSet(data: CustomerFavorites | undefined): ReadonlySet<string> | undefined {
  if (!data) return undefined;
  let set = setCache.get(data);
  if (!set) {
    set = new Set(data.favoriteProductIds);
    setCache.set(data, set);
  }
  return set;
}

/** ¿Es favorito este producto? Solo cambia (y re-renderiza) cuando cambia ESE booleano. */
export function useIsFavorite(productId: string): boolean {
  const { scope } = useFavoritesApi();
  const queryClient: QueryClient = useQueryClient();
  const key = queryKeys.customer.favorites.ids(scope ?? NO_SCOPE);
  const hash = hashKey(key);
  const subscribe = useCallback(
    (onChange: () => void) =>
      queryClient.getQueryCache().subscribe((event) => {
        if (event.query.queryHash === hash) onChange();
      }),
    [queryClient, hash],
  );
  return useSyncExternalStore(
    subscribe,
    () => idSet(queryClient.getQueryData<CustomerFavorites>(key))?.has(productId) ?? false,
    () => false,
  );
}

/** ¿Hay una alta/baja de este producto en vuelo? */
export function useIsFavoritePending(productId: string): boolean {
  const { pending } = useFavoritesApi();
  return useSyncExternalStore(
    pending.subscribe,
    () => pending.has(productId),
    () => false,
  );
}
