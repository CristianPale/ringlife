import { median } from '../andamento/andamento.model';

/** Misure SpO2 minime in una notte per dire qualcosa (docs/nuove-funzioni.md, sezione 6). */
export const MIN_SAMPLES = 10;
export const BASELINE_NIGHTS = 28;
/** Notti precedenti minime per avere una media personale. */
export const MIN_BASELINE_NIGHTS = 7;
/** Scostamento, in unità di variabilità, sotto cui una notte conta. Iniziale, da tarare. */
export const WATCH_DEVIATION = -2;
/** Notti consecutive sotto soglia per il livello «da guardare». */
export const WATCH_NIGHTS = 3;
/**
 * Variabilità minima, in punti percentuali. Le misure SpO2 sono intere e la MAD di una persona stabile
 * può essere 0: senza un minimo ogni minimo scarto sembrerebbe enorme.
 */
export const MAD_FLOOR = 0.5;

export interface NightSummary {
  /** Mediana delle misure della notte, in %. */
  median: number;
  /** Misura più bassa della notte, in %. */
  min: number;
  count: number;
}

/** Riassunto di una notte. `null` con meno di 10 misure. */
export function nightSummary(samples: readonly number[]): NightSummary | null {
  if (samples.length < MIN_SAMPLES) {
    return null;
  }
  return { median: median(samples), min: Math.min(...samples), count: samples.length };
}

/** Scostamento di una notte dalla tua media (mediana e MAD sulle notti precedenti), limitato a [-3, 3]. */
export function spo2Deviation(value: number, previousMedians: readonly number[]): number | null {
  const window = previousMedians.slice(-BASELINE_NIGHTS);
  if (window.length < MIN_BASELINE_NIGHTS) {
    return null;
  }
  const mid = median(window);
  const mad = median(window.map((v) => Math.abs(v - mid)));
  const spread = Math.max(1.4826 * mad, MAD_FLOOR);
  return Math.max(-3, Math.min(3, (value - mid) / spread));
}

export type BreathingStatus = 'insufficient' | 'calibrating' | 'ok' | 'watch';

export interface BreathingResult {
  status: BreathingStatus;
  median: number | null;
  min: number | null;
  count: number;
  /** Scostamento di stanotte dalla tua media. */
  deviation: number | null;
  /** La tua media, in %. */
  baseline: number | null;
  /** Notti consecutive, fino a stanotte, sotto soglia. */
  streak: number;
}

/**
 * Respiro notturno: trend della saturazione di ossigeno (SpO2). Nessuna soglia assoluta in v1.
 * «Da guardare» se la mediana è sotto il tuo solito da 3 notti di fila.
 *
 * @param tonight misure SpO2 tra l'inizio e la fine del sonno
 * @param history mediane delle notti precedenti, dalla più vecchia, senza stanotte
 */
export function evaluateBreathing(tonight: readonly number[], history: readonly number[]): BreathingResult {
  const summary = nightSummary(tonight);
  if (!summary) {
    return { status: 'insufficient', median: null, min: null, count: tonight.length, deviation: null, baseline: null, streak: 0 };
  }
  const all = [...history, summary.median];
  const deviations = all.map((value, i) => spo2Deviation(value, all.slice(0, i)));
  const deviation = deviations[deviations.length - 1];
  const baseline = history.length >= MIN_BASELINE_NIGHTS ? median(history.slice(-BASELINE_NIGHTS)) : null;
  if (deviation === null) {
    return { status: 'calibrating', ...summary, deviation: null, baseline, streak: 0 };
  }
  let streak = 0;
  for (let i = deviations.length - 1; i >= 0; i--) {
    const d = deviations[i];
    if (d === null || d > WATCH_DEVIATION) {
      break;
    }
    streak++;
  }
  return { status: streak >= WATCH_NIGHTS ? 'watch' : 'ok', ...summary, deviation, baseline, streak };
}
