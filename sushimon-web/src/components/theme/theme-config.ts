/** Preferencia de tema: solo preferencia visual (nunca autenticación). Misma clave que el prototipo de la tienda. */
export const THEME_STORAGE_KEY = 'monsushi-theme';
export type Theme = 'light' | 'dark';

/** Color de la barra del navegador (`<meta name="theme-color">`), igual a `--bg` de cada tema. */
export const THEME_COLORS: Record<Theme, string> = { light: '#FAF7F2', dark: '#0B0B0F' };

/**
 * Script inline (en <head>, antes de pintar) que aplica `.dark` en <html> según `localStorage` o, si no hay
 * preferencia guardada, según `prefers-color-scheme`. Envuelto en try/catch (modo privado, storage bloqueado).
 */
export const THEME_SCRIPT = `(function(){try{var d=document.documentElement,t=null;try{t=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)})}catch(e){}var k=t==='dark'||(t!=='light'&&window.matchMedia('(prefers-color-scheme: dark)').matches);d.classList.toggle('dark',k);d.style.colorScheme=k?'dark':'light';var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute('content',k?${JSON.stringify(
  THEME_COLORS.dark,
)}:${JSON.stringify(THEME_COLORS.light)})}catch(e){}})();`;
