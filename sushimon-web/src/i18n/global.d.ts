import type messages from './messages/es.json';
import type { Locale } from './config';

// Tipado de next-intl: claves de mensajes verificadas en tiempo de compilación (es.json es la referencia).
declare module 'next-intl' {
  interface AppConfig {
    Locale: Locale;
    Messages: typeof messages;
  }
}
