import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OrderCreated } from '@/lib/data-access/models';
import {
  clearConfirmation,
  isConfirmationPersisted,
  readOrderNumber,
  orderConfirmationKey,
  readGuestToken,
  saveConfirmation,
} from './confirmation-store';

const created = (access: OrderCreated['access'], id = 'ord-1'): OrderCreated =>
  ({ order: { id, displayNumber: 'MON-001042' }, access }) as OrderCreated;
const TOKEN = `smo_${'a'.repeat(43)}`;

beforeEach(() => {
  window.sessionStorage.clear();
  window.localStorage.clear();
});

describe('confirmation-store · credencial de invitado (F20)', () => {
  it('guarda el token SOLO en sessionStorage (nunca localStorage) y lo lee de vuelta', () => {
    saveConfirmation(created({ guestToken: TOKEN, expiresAt: '2999-01-01T00:00:00.000Z' }));
    expect(window.sessionStorage.getItem(orderConfirmationKey('ord-1'))).toContain(TOKEN);
    expect(JSON.stringify({ ...window.localStorage })).not.toContain(TOKEN);
    expect(readGuestToken('ord-1')).toBe(TOKEN);
  });

  it('un pedido de cliente autenticado (access=null) guarda solo el número visible, sin credencial', () => {
    saveConfirmation(created(null));
    expect(readGuestToken('ord-1')).toBeNull();
    expect(readOrderNumber('ord-1')).toBe('MON-001042');
    expect(window.sessionStorage.getItem(orderConfirmationKey('ord-1'))).not.toContain('smo_');
  });

  it('W2: si sessionStorage falla, devuelve false y la credencial sigue accesible en memoria (sin perderla en silencio)', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    const ok = saveConfirmation(
      created({ guestToken: TOKEN, expiresAt: '2999-01-01T00:00:00.000Z' }, 'ord-mem'),
    );
    spy.mockRestore();
    expect(ok).toBe(false);
    expect(isConfirmationPersisted('ord-mem')).toBe(false);
    expect(readGuestToken('ord-mem')).toBe(TOKEN);
    expect(readOrderNumber('ord-mem')).toBe('MON-001042');
  });

  it('ignora credenciales vencidas, mal formadas o de otro pedido', () => {
    saveConfirmation(created({ guestToken: TOKEN, expiresAt: '2000-01-01T00:00:00.000Z' }));
    expect(readGuestToken('ord-1')).toBeNull();
    window.sessionStorage.setItem(
      orderConfirmationKey('ord-2'),
      '{"guestToken":"x","expiresAt":"2999-01-01T00:00:00.000Z"}',
    );
    expect(readGuestToken('ord-2')).toBeNull();
    window.sessionStorage.setItem(orderConfirmationKey('ord-3'), 'no es json');
    expect(readGuestToken('ord-3')).toBeNull();
    expect(readGuestToken('ord-9')).toBeNull();
  });

  it('clearConfirmation la elimina', () => {
    saveConfirmation(created({ guestToken: TOKEN, expiresAt: '2999-01-01T00:00:00.000Z' }));
    clearConfirmation('ord-1');
    expect(readGuestToken('ord-1')).toBeNull();
  });
});
