/**
 * La livella (ADR 0020): ogni indice e ogni misura si confrontano con la tua media allo stesso modo. Un tubo da −3 a +3
 * scostamenti, due tacche a ±1,5 («il tuo solito») e una bolla per il valore di oggi.
 * Lo scostamento è `(x − mediana) / (1,4826 · MAD)` limitato a [−3, 3] (docs/scores.md), calcolato dal server.
 */

export type Standing = 'meglio' | 'solito' | 'peggio';

/**
 * `up`: più alto è meglio (tutti gli indici 0-100, HRV). `down`: più basso è meglio (battito a riposo).
 * `neutral`: non c'è un verso migliore (sonno leggero, temperatura): fuori dalle tacche non è mai «peggio».
 */
export type Direction = 'up' | 'down' | 'neutral';

export const MAX_DEVIATION = 3;
/** Le tacche: la fascia «il tuo solito» è mediana ± 1,5 scostamenti. */
export const USUAL_BAND = 1.5;

export const STANDING_LABELS: Record<Standing, string> = {
  meglio: 'Meglio del solito',
  solito: 'Come al solito',
  peggio: 'Peggio del solito',
};

/** Dentro le tacche (estremi compresi) è «come al solito». */
export function standingOf(deviation: number, direction: Direction = 'up'): Standing {
  if (direction === 'neutral') {
    return 'solito';
  }
  const better = direction === 'up' ? deviation : -deviation;
  if (better > USUAL_BAND) {
    return 'meglio';
  }
  if (better < -USUAL_BAND) {
    return 'peggio';
  }
  return 'solito';
}

/** Posizione sul tubo, da 0 (−3) a 1 (+3). */
export function bubblePosition(deviation: number): number {
  const clamped = Math.max(-MAX_DEVIATION, Math.min(MAX_DEVIATION, deviation));
  return (clamped + MAX_DEVIATION) / (2 * MAX_DEVIATION);
}

export interface LivellaLayout {
  width: number;
  /** Fascia «il tuo solito»: dalla prima alla seconda tacca. */
  usualX: number;
  usualWidth: number;
  /** Ascisse centrali delle due tacche. */
  markLeft: number;
  markRight: number;
  /** Ascissa della bolla, tenuta dentro il tubo per non tagliarla. `null` in calibrazione. */
  bubbleX: number | null;
}

const BUBBLE_RADIUS = 5;

export function livellaLayout(width: number, deviation: number | null, bubbleRadius = BUBBLE_RADIUS): LivellaLayout {
  const left = width * bubblePosition(-USUAL_BAND);
  const right = width * bubblePosition(USUAL_BAND);
  const bubbleX =
    deviation === null
      ? null
      : Math.max(bubbleRadius, Math.min(width - bubbleRadius, width * bubblePosition(deviation)));
  return { width, usualX: left, usualWidth: right - left, markLeft: left, markRight: right, bubbleX: bubbleX === null ? null : round(bubbleX) };
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Estremi della fascia nella unità della metrica, dal riferimento del server. `null` se il server non manda l'unità. */
export function usualRange(median: number, spread: number | undefined): { low: number; high: number } | null {
  if (spread === undefined || !Number.isFinite(spread) || spread <= 0) {
    return null;
  }
  return { low: median - USUAL_BAND * spread, high: median + USUAL_BAND * spread };
}
