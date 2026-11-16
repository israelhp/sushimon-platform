import type { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';

const loaded = vi.hoisted(() => ({ s3: false, presigner: false }));
vi.mock('@aws-sdk/client-s3', async (importOriginal) => {
  loaded.s3 = true;
  return importOriginal();
});
vi.mock('@aws-sdk/s3-request-presigner', async (importOriginal) => {
  loaded.presigner = true;
  return importOriginal();
});

const config = (values: Record<string, unknown>) =>
  ({ get: (key: string) => values[key] }) as unknown as ConfigService<Env, true>;

const R2 = {
  R2_ACCOUNT_ID: 'cuenta0123456789',
  R2_BUCKET: 'bucket-pruebas',
  R2_ACCESS_KEY_ID: 'AKIAPRUEBAPRUEBA01',
  R2_SECRET_ACCESS_KEY: 'valor-de-prueba-no-real-0123456789',
  R2_PUBLIC_BASE_URL: 'https://cdn.pruebas.example.com',
  R2_REGION: 'auto',
};

beforeEach(() => {
  loaded.s3 = false;
  loaded.presigner = false;
});

// El primer `import('./media.module.js')` arrastra Nest, Prisma y la política: con la suite entera en paralelo puede superar
// los 5 s por defecto de vitest, por eso el tiempo máximo es explícito.
const SLOW_IMPORT_TIMEOUT = 30_000;

describe('carga perezosa del SDK de AWS (F14)', () => {
  it(
    'importar el módulo de medios y usar UNAVAILABLE o MOCK NO carga el SDK',
    async () => {
      const { buildMediaConfig, selectMediaStorage } = await import('./media.module.js');
      const base = { NODE_ENV: 'test', MEDIA_MAX_BYTES: 5_242_880, MEDIA_UPLOAD_TTL_SECONDS: 300 };
      const none = config({ ...base });
      const unavailable = await selectMediaStorage(none, buildMediaConfig(none));
      expect(unavailable.mode).toBe('UNAVAILABLE');
      const mockCfg = config({ ...base, MEDIA_STORAGE_ADAPTER: 'mock' });
      const mock = await selectMediaStorage(mockCfg, buildMediaConfig(mockCfg));
      expect(mock.mode).toBe('MOCK');
      expect(loaded).toEqual({ s3: false, presigner: false });
    },
    SLOW_IMPORT_TIMEOUT,
  );

  it(
    'solo el modo R2 importa el SDK (y construye el adaptador sin hacer red)',
    async () => {
      const { buildMediaConfig, selectMediaStorage } = await import('./media.module.js');
      const cfg = config({
        NODE_ENV: 'test',
        MEDIA_MAX_BYTES: 5_242_880,
        MEDIA_UPLOAD_TTL_SECONDS: 300,
        ...R2,
      });
      const storage = await selectMediaStorage(cfg, buildMediaConfig(cfg));
      expect(storage.mode).toBe('R2');
      expect(loaded.s3).toBe(true);
    },
    SLOW_IMPORT_TIMEOUT,
  );
});
