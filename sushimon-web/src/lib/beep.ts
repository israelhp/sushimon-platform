/**
 * Aviso sonoro de pedido nuevo (opt-in, F22 spec 023 §10.4). Sin archivos de audio: un tono corto con Web Audio. El contexto se
 * crea/reanuda SOLO desde `primeBeep()`, llamado en el gesto del usuario que activa el sonido; sin ese gesto `playBeep()` no hace
 * nada (los navegadores bloquean el audio automático y jamás debe sonar al cargar la página).
 */
type AudioContextCtor = typeof AudioContext;

let context: AudioContext | null = null;

function ctor(): AudioContextCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    AudioContext?: AudioContextCtor;
    webkitAudioContext?: AudioContextCtor;
  };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

/** Llamar dentro del manejador del clic que activa el sonido. */
export function primeBeep(): void {
  const Ctx = ctor();
  if (!Ctx) return;
  try {
    context ??= new Ctx();
    if (context.state === 'suspended') void context.resume();
  } catch {
    context = null;
  }
}

/** Un tono breve (880 Hz, 0,25 s). No hace nada si el audio no fue activado por un gesto. */
export function playBeep(): void {
  if (!context || context.state !== 'running') return;
  try {
    const osc = context.createOscillator();
    const gain = context.createGain();
    osc.type = 'sine';
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.2, context.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.25);
    osc.connect(gain).connect(context.destination);
    osc.start();
    osc.stop(context.currentTime + 0.27);
  } catch {
    // el audio es opcional
  }
}

/** Solo pruebas. */
export function resetBeepForTests(): void {
  context = null;
}
