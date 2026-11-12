import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

// next-intl sin enrutado por idioma (ADR-0005): la configuración por petición está en src/i18n/request.ts.
const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

/**
 * Cabeceras de seguridad básicas. La CSP aquí es SOLO `frame-ancestors` (anti-clickjacking).
 * TODO(Etapa 3): CSP completa con nonce por petición (script-src/style-src/connect-src, etc.); se
 * deja fuera a propósito porque rompería `next dev` y los estilos/scripts en línea de Next.
 */
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
];

const nextConfig: NextConfig = {
  reactCompiler: true,
  turbopack: {
    rules: {
      '*.css': { loaders: ['@tailwindcss/turbopack'], as: '*.css' },
    },
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default withNextIntl(nextConfig);
