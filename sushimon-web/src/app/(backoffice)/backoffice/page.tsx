import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Backoffice', robots: { index: false, follow: false } };

export default function BackofficeHome() {
  return (
    <main className="mx-auto max-w-3xl p-8">
      <h1 className="text-3xl font-bold">Backoffice Sushi Mon</h1>
      <p className="mt-2 text-muted">
        Estructura inicial. El acceso real será con Google OAuth y permisos internos; no existe
        autenticación aún.
      </p>
    </main>
  );
}
