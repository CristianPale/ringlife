/** Le due sessioni a schermo intero del plugin Allenamento e respirazione (docs/adr/0024, docs/adr/0042). */
export type SessionMode = 'respirazione' | 'allenamento';

export function isSessionMode(value: unknown): value is SessionMode {
  return value === 'respirazione' || value === 'allenamento';
}

/**
 * Il modo di una sessione, anche dai nomi vecchi: `battito` (il Monitoraggio del battito) è diventato l'Allenamento
 * (docs/adr/0042). `null` per un valore sconosciuto.
 */
export function normalizeSessionMode(value: unknown): SessionMode | null {
  if (value === 'respirazione') {
    return 'respirazione';
  }
  return value === 'allenamento' || value === 'battito' ? 'allenamento' : null;
}

/** Il nome della sessione nella UI. */
export function sessionName(mode: SessionMode): string {
  return mode === 'respirazione' ? 'Respirazione guidata' : 'Allenamento';
}

/** Un battito della sessione: millisecondi dall'inizio e battiti al minuto. */
export interface LiveSample {
  t: number;
  bpm: number;
}

export interface SessionStats {
  min: number;
  avg: number;
  max: number;
  /** Media dei primi e degli ultimi 30 secondi: dice se il battito è sceso durante la respirazione. */
  start: number;
  end: number;
}

export function sessionStats(samples: readonly LiveSample[]): SessionStats | null {
  if (samples.length === 0) {
    return null;
  }
  const values = samples.map((s) => s.bpm);
  const mean = (list: readonly number[]) => Math.round(list.reduce((a, b) => a + b, 0) / list.length);
  const first = samples[0].t;
  const last = samples[samples.length - 1].t;
  const head = samples.filter((s) => s.t - first <= 30_000).map((s) => s.bpm);
  const tail = samples.filter((s) => last - s.t <= 30_000).map((s) => s.bpm);
  return { min: Math.min(...values), avg: mean(values), max: Math.max(...values), start: mean(head), end: mean(tail) };
}

export const INHALE_MS = 4_000;
export const EXHALE_MS = 6_000;

export interface BreathPhase {
  phase: 'inspira' | 'espira';
  /** Secondi che mancano al cambio, arrotondati per eccesso. */
  remaining: number;
  /** Quanto è aperto il cerchio, da 0 (vuoto) a 1 (pieno). */
  openness: number;
}

/** Dove si è nel respiro dopo `elapsedMs`: 4 secondi di inspirazione, 6 di espirazione, all'infinito. */
export function breathPhase(elapsedMs: number): BreathPhase {
  const cycle = INHALE_MS + EXHALE_MS;
  const t = ((elapsedMs % cycle) + cycle) % cycle;
  if (t < INHALE_MS) {
    return { phase: 'inspira', remaining: Math.ceil((INHALE_MS - t) / 1000), openness: easeInOut(t / INHALE_MS) };
  }
  const e = (t - INHALE_MS) / EXHALE_MS;
  return { phase: 'espira', remaining: Math.ceil((EXHALE_MS - (t - INHALE_MS)) / 1000), openness: 1 - easeInOut(e) };
}

function easeInOut(x: number): number {
  return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;
}

/** «12:05» da millisecondi. */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}
