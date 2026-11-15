import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach } from 'vitest';

// `findBy*`/`waitFor` esperan hasta 5 s (por defecto 1 s): bajo carga (archivos de ~20 s como `bo-admin.test.tsx`) 1 s daba
// falsos negativos intermitentes. Solo alarga el TOPE de espera: las aserciones no cambian y un fallo real sigue fallando.
configure({ asyncUtilTimeout: 5000 });

afterEach(() => {
  cleanup();
});

// jsdom no implementa matchMedia (lo usa ThemeProvider).
if (!window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
}
