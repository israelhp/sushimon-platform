import 'reflect-metadata';
import { Controller, Get, Post } from '@nestjs/common';
import { ModulesContainer } from '@nestjs/core';
import { Test } from '@nestjs/testing';

/**
 * Prueba de arquitectura (auditoría M1): TODA ruta cuyo path completo empiece por `admin` debe pasar por
 * `StaffGuard` y `MfaGuard` (lo que aplica `@RequireStaff`, a nivel de clase o de método). Si alguien añade una
 * ruta admin sin el decorador, esta prueba falla. No es un sustituto de las pruebas de autorización por recurso.
 */
type Ctor = abstract new (...args: never[]) => unknown;

interface AdminRoute {
  label: string;
  guards: unknown[];
}

const PATH_METADATA = 'path';
const METHOD_METADATA = 'method';
const GUARDS_METADATA = '__guards__';

function asPaths(value: unknown): string[] {
  const list = Array.isArray(value) ? value : [value ?? ''];
  return list.map((p) => String(p).replace(/^\/+|\/+$/g, ''));
}

function guardsOf(target: object): unknown[] {
  return (Reflect.getMetadata(GUARDS_METADATA, target) as unknown[] | undefined) ?? [];
}

/** Rutas HTTP (controlador + método) cuyo path completo empieza por `admin`, con los guards que las cubren. */
function adminRoutes(controllers: Ctor[]): AdminRoute[] {
  const routes: AdminRoute[] = [];
  for (const controller of controllers) {
    const proto = controller.prototype as Record<string, unknown>;
    const classGuards = guardsOf(controller);
    for (const name of Object.getOwnPropertyNames(proto)) {
      const handler = proto[name];
      if (typeof handler !== 'function') continue;
      if (Reflect.getMetadata(METHOD_METADATA, handler) === undefined) continue;
      const basePaths = asPaths(Reflect.getMetadata(PATH_METADATA, controller));
      const methodPaths = asPaths(Reflect.getMetadata(PATH_METADATA, handler));
      for (const base of basePaths) {
        for (const sub of methodPaths) {
          const full = [base, sub].filter(Boolean).join('/');
          if (full !== 'admin' && !full.startsWith('admin/')) continue;
          routes.push({
            label: `${controller.name}.${name} (/${full})`,
            guards: [...classGuards, ...guardsOf(handler)],
          });
        }
      }
    }
  }
  return routes;
}

function violations(routes: AdminRoute[], staffGuard: unknown, mfaGuard: unknown): string[] {
  return routes
    .filter((r) => !r.guards.includes(staffGuard) || !r.guards.includes(mfaGuard))
    .map((r) => r.label);
}

async function loadApp() {
  Object.assign(process.env, {
    SUPABASE_URL: 'http://127.0.0.1:54341',
    HEALTH_READY_TOKEN: 'token-e2e-123456789',
  });
  const { AppModule } = await import('../src/app.module.js');
  const { PrismaService } = await import('../src/database/prisma.service.js');
  const { StaffGuard } = await import('../src/auth/staff.guard.js');
  const { MfaGuard } = await import('../src/auth/mfa.guard.js');
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(PrismaService)
    .useValue({ $disconnect: () => Promise.resolve() })
    .compile();
  const controllers: Ctor[] = [];
  for (const mod of moduleRef.get(ModulesContainer).values()) {
    for (const wrapper of mod.controllers.values()) {
      if (wrapper.metatype) controllers.push(wrapper.metatype as unknown as Ctor);
    }
  }
  return { moduleRef, controllers, StaffGuard, MfaGuard };
}

describe('Arquitectura: toda ruta /v1/admin exige StaffGuard y MfaGuard', () => {
  it('las rutas admin reales los tienen (RequireStaff) y no hay menos de 29', async () => {
    const { moduleRef, controllers, StaffGuard, MfaGuard } = await loadApp();
    try {
      const routes = adminRoutes(controllers);
      expect(routes.length).toBeGreaterThanOrEqual(29);
      expect(violations(routes, StaffGuard, MfaGuard)).toEqual([]);
    } finally {
      await moduleRef.close();
    }
  });

  it('prueba negativa: una ruta admin sin @RequireStaff se detecta', async () => {
    const { moduleRef, StaffGuard, MfaGuard } = await loadApp();
    try {
      const { RequireStaff } = await import('../src/auth/staff.guard.js');

      @Controller('admin/ejemplo-inseguro')
      class UnguardedController {
        @Get()
        list() {
          return [];
        }
      }

      @Controller('admin/ejemplo-parcial')
      class MethodGuardedController {
        @Get()
        @RequireStaff('x.read')
        guarded() {
          return [];
        }

        @Post()
        unguarded() {
          return {};
        }
      }

      @Controller('admin/ejemplo-ok')
      @RequireStaff()
      class GuardedController {
        @Get()
        list() {
          return [];
        }
      }

      @Controller('publico')
      class PublicController {
        @Get()
        list() {
          return [];
        }
      }

      const routes = adminRoutes([
        UnguardedController,
        MethodGuardedController,
        GuardedController,
        PublicController,
      ]);
      expect(routes).toHaveLength(4); // la ruta pública no cuenta
      expect(violations(routes, StaffGuard, MfaGuard)).toEqual([
        'UnguardedController.list (/admin/ejemplo-inseguro)',
        'MethodGuardedController.unguarded (/admin/ejemplo-parcial)',
      ]);
    } finally {
      await moduleRef.close();
    }
  });
});
