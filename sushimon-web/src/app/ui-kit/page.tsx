import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { UiKit } from './UiKit';

export const metadata: Metadata = { title: 'UI kit', robots: { index: false, follow: false } };

/** Página interna de componentes (solo desarrollo). En producción responde 404. */
export default function UiKitPage() {
  if (process.env.NODE_ENV === 'production') notFound();
  return <UiKit />;
}
