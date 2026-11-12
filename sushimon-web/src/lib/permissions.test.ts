import { describe, expect, it } from 'vitest';
import en from '@/i18n/messages/en.json';
import es from '@/i18n/messages/es.json';
import { ROLE_MENU, ROLE_PERMISSIONS } from './permissions';

describe('etiquetas de roles y permisos (i18n)', () => {
  const roles = Object.keys(ROLE_MENU);
  const permissions = [...new Set(Object.values(ROLE_PERMISSIONS).flat())];

  for (const [name, messages] of [
    ['es', es],
    ['en', en],
  ] as const) {
    it(`${name}: cada rol y permiso tiene etiqueta y descripción`, () => {
      const bo = messages.backoffice as unknown as Record<string, Record<string, string>>;
      for (const r of roles) {
        expect(bo.roles?.[r], `roles.${r}`).toBeTruthy();
        expect(bo.roleDescriptions?.[r], `roleDescriptions.${r}`).toBeTruthy();
      }
      for (const p of permissions) {
        // Las claves con punto ("orders.accept") son anidadas en el JSON (next-intl no admite "." en claves).
        const label = p
          .split('.')
          .reduce<unknown>(
            (node, key) => (node as Record<string, unknown> | undefined)?.[key],
            bo.permissions,
          );
        expect(label, `permissions.${p}`).toEqual(expect.any(String));
      }
    });
  }

  it('el backoffice es solo español: en.json copia el español', () => {
    expect(en.backoffice.permissions).toEqual(es.backoffice.permissions);
    expect(en.backoffice.roleDescriptions).toEqual(es.backoffice.roleDescriptions);
  });
});
