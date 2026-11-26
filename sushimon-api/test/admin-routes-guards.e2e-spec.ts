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
  it('las rutas admin reales los tienen (RequireStaff) y no hay menos de 30', async () => {
    const { moduleRef, controllers, StaffGuard, MfaGuard } = await loadApp();
    try {
      const routes = adminRoutes(controllers);
      expect(routes.length).toBeGreaterThanOrEqual(30);
      expect(violations(routes, StaffGuard, MfaGuard)).toEqual([]);
    } finally {
      await moduleRef.close();
    }
  });

  it('las 5 rutas admin de categorías (F10 + ADR-0034) están registradas y protegidas', async () => {
    const { moduleRef, controllers, StaffGuard, MfaGuard } = await loadApp();
    try {
      const routes = adminRoutes(controllers).filter((r) => r.label.includes('/admin/categories'));
      expect(routes.map((r) => r.label).sort()).toEqual([
        'AdminCategoriesController.create (/admin/categories)',
        'AdminCategoriesController.list (/admin/categories)',
        'AdminCategoriesController.remove (/admin/categories/:id)',
        'AdminCategoriesController.reorder (/admin/categories/reorder)',
        'AdminCategoriesController.update (/admin/categories/:id)',
      ]);
      expect(violations(routes, StaffGuard, MfaGuard)).toEqual([]);
    } finally {
      await moduleRef.close();
    }
  });

  it('las 4 rutas admin de productos (F11) están registradas y protegidas', async () => {
    const { moduleRef, controllers, StaffGuard, MfaGuard } = await loadApp();
    try {
      const routes = adminRoutes(controllers).filter((r) =>
        r.label.startsWith('AdminProductsController.'),
      );
      expect(routes.map((r) => r.label).sort()).toEqual([
        'AdminProductsController.create (/admin/products)',
        'AdminProductsController.get (/admin/products/:id)',
        'AdminProductsController.list (/admin/products)',
        'AdminProductsController.update (/admin/products/:id)',
      ]);
      expect(violations(routes, StaffGuard, MfaGuard)).toEqual([]);
    } finally {
      await moduleRef.close();
    }
  });

  it('las 9 rutas admin de modificadores (F12) están registradas y protegidas', async () => {
    const { moduleRef, controllers, StaffGuard, MfaGuard } = await loadApp();
    try {
      const routes = adminRoutes(controllers).filter((r) =>
        r.label.startsWith('AdminModifiersController.'),
      );
      expect(routes.map((r) => r.label).sort()).toEqual([
        'AdminModifiersController.createGroup (/admin/modifier-groups)',
        'AdminModifiersController.createModifier (/admin/modifier-groups/:id/modifiers)',
        'AdminModifiersController.getGroup (/admin/modifier-groups/:id)',
        'AdminModifiersController.getProductModifiers (/admin/products/:id/modifiers)',
        'AdminModifiersController.listGroups (/admin/modifier-groups)',
        'AdminModifiersController.reorder (/admin/modifier-groups/:id/modifiers/reorder)',
        'AdminModifiersController.replaceProductGroups (/admin/products/:id/modifier-groups)',
        'AdminModifiersController.updateGroup (/admin/modifier-groups/:id)',
        'AdminModifiersController.updateModifier (/admin/modifiers/:id)',
      ]);
      expect(violations(routes, StaffGuard, MfaGuard)).toEqual([]);
    } finally {
      await moduleRef.close();
    }
  });

  it('las 4 rutas admin de precio y disponibilidad por sucursal (F13) están registradas y protegidas', async () => {
    const { moduleRef, controllers, StaffGuard, MfaGuard } = await loadApp();
    try {
      const routes = adminRoutes(controllers).filter((r) =>
        r.label.startsWith('AdminBranchProductsController.'),
      );
      expect(routes.map((r) => r.label).sort()).toEqual([
        'AdminBranchProductsController.listForBranch (/admin/branches/:id/products)',
        'AdminBranchProductsController.listForProduct (/admin/products/:id/branches)',
        'AdminBranchProductsController.setAvailability (/admin/products/:id/availability)',
        'AdminBranchProductsController.setPricing (/admin/branches/:id/products/:productId/pricing)',
      ]);
      expect(violations(routes, StaffGuard, MfaGuard)).toEqual([]);
    } finally {
      await moduleRef.close();
    }
  });

  it('las 5 rutas admin de la biblioteca de medios (F14) están registradas y protegidas', async () => {
    const { moduleRef, controllers, StaffGuard, MfaGuard } = await loadApp();
    try {
      const routes = adminRoutes(controllers).filter((r) =>
        r.label.startsWith('AdminMediaController.'),
      );
      expect(routes.map((r) => r.label).sort()).toEqual([
        'AdminMediaController.complete (/admin/media/complete)',
        'AdminMediaController.createUpload (/admin/media/upload-intents)',
        'AdminMediaController.get (/admin/media/:id)',
        'AdminMediaController.list (/admin/media)',
        'AdminMediaController.remove (/admin/media/:id)',
      ]);
      expect(violations(routes, StaffGuard, MfaGuard)).toEqual([]);
    } finally {
      await moduleRef.close();
    }
  });

  it('las 4 rutas admin de imágenes de producto (F14) están registradas y protegidas', async () => {
    const { moduleRef, controllers, StaffGuard, MfaGuard } = await loadApp();
    try {
      const routes = adminRoutes(controllers).filter((r) =>
        r.label.startsWith('AdminProductMediaController.'),
      );
      expect(routes.map((r) => r.label).sort()).toEqual([
        'AdminProductMediaController.attach (/admin/products/:id/media)',
        'AdminProductMediaController.detach (/admin/products/:id/media/:mediaId)',
        'AdminProductMediaController.reorder (/admin/products/:id/media/order)',
        'AdminProductMediaController.update (/admin/products/:id/media/:mediaId)',
      ]);
      expect(violations(routes, StaffGuard, MfaGuard)).toEqual([]);
    } finally {
      await moduleRef.close();
    }
  });

  it('las 5 rutas admin de promociones (F15) están registradas y protegidas', async () => {
    const { moduleRef, controllers, StaffGuard, MfaGuard } = await loadApp();
    try {
      const routes = adminRoutes(controllers).filter((r) =>
        r.label.startsWith('AdminPromotionsController.'),
      );
      expect(routes.map((r) => r.label).sort()).toEqual([
        'AdminPromotionsController.create (/admin/promotions)',
        'AdminPromotionsController.get (/admin/promotions/:id)',
        'AdminPromotionsController.list (/admin/promotions)',
        'AdminPromotionsController.update (/admin/promotions/:id)',
        'AdminPromotionsController.updateStatus (/admin/promotions/:id/status)',
      ]);
      expect(violations(routes, StaffGuard, MfaGuard)).toEqual([]);
    } finally {
      await moduleRef.close();
    }
  });

  it('las 5 rutas admin de banners (F16) están registradas y protegidas', async () => {
    const { moduleRef, controllers, StaffGuard, MfaGuard } = await loadApp();
    try {
      const routes = adminRoutes(controllers).filter((r) =>
        r.label.startsWith('AdminBannersController.'),
      );
      expect(routes.map((r) => r.label).sort()).toEqual([
        'AdminBannersController.create (/admin/banners)',
        'AdminBannersController.get (/admin/banners/:id)',
        'AdminBannersController.list (/admin/banners)',
        'AdminBannersController.remove (/admin/banners/:id)',
        'AdminBannersController.update (/admin/banners/:id)',
      ]);
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
