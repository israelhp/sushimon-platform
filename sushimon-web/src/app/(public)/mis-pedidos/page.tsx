import { redirect } from 'next/navigation';

/** Alias del prototipo: `mis-pedidos` renderiza la misma lista que `cuenta/pedidos`. */
export default function MyOrdersAlias() {
  redirect('/cuenta/pedidos');
}
