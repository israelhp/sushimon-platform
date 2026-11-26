import type { CSSProperties } from 'react';
import type { StaffRole } from '@/lib/data-access/models';
import { TIME_ZONE } from '@/lib/format';

/** Iniciales para el avatar ("Ana Lucía Pérez" → "AL"). */
export function staffInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase();
}

/** Color del avatar por rol (admin azul marino, encargado rojo, cocina gris), con los tokens del backoffice. */
export function avatarStyle(role: StaffRole): CSSProperties {
  switch (role) {
    case 'admin':
      return { background: 'var(--bo-band-navy)', color: 'var(--bo-white)' };
    case 'manager':
      return { background: 'var(--bo-primary)', color: 'var(--bo-on-primary)' };
    case 'kitchen':
      return { background: 'var(--bo-muted)', color: 'var(--bo-on-primary)' };
    case 'staff':
      return { background: 'var(--bo-secondary)', color: 'var(--bo-on-secondary)' };
  }
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "Mié 11 nov" (fecha de la barra superior). */
export function formatTopbarDate(date: Date): string {
  const parts = new Intl.DateTimeFormat('es-GT', {
    timeZone: TIME_ZONE,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).formatToParts(date);
  const get = (type: string) => (parts.find((p) => p.type === type)?.value ?? '').replace('.', '');
  return `${capitalize(get('weekday'))} ${get('day')} ${get('month')}`;
}

/** "Miércoles 11 de noviembre de 2026" (subtítulo del panel). */
export function formatLongDate(date: Date): string {
  return capitalize(
    new Intl.DateTimeFormat('es-GT', {
      timeZone: TIME_ZONE,
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    })
      .format(date)
      .replace(',', ''),
  );
}

/** Saludo según la hora local de Guatemala (antes de 12 h, 19 h). */
export function greetingKey(
  hour: number,
): 'greetingMorning' | 'greetingAfternoon' | 'greetingEvening' {
  return hour < 12 ? 'greetingMorning' : hour < 19 ? 'greetingAfternoon' : 'greetingEvening';
}
