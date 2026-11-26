import { Zone } from '../oggi/zone';
import { SignalRow } from '../shared/signal-row.component';

export type StressSignalId = 'stress-load' | 'stress-evening';

/** Pesi iniziali dello Stress (docs/scores.md, algo_version v1). Devono sommare a 1. */
export const STRESS_WEIGHTS: Record<StressSignalId, number> = {
  'stress-load': 0.7,
  'stress-evening': 0.3,
};

/** Un campione conta come «stress alto» da questo valore in su (docs/scores.md). Iniziale, da tarare. */
export const HIGH_STRESS = 60;
/** Ore diurne mostrate: dalle 07:00 alle 23:00. */
export const WAKING_FROM = 7;
export const WAKING_TO = 23;

export interface StressData {
  /** Il giorno a cui si riferisce l'indice: l'ultimo giorno finito. */
  date: Date;
  value: number;
  zone: Zone;
  /** Dove sta lo Stress di quel giorno rispetto alla tua media e gli estremi del tuo solito (ADR 0020). */
  indexDeviation: number | null;
  indexRange: { low: number; high: number } | null;
  signals: readonly (SignalRow & { id: StressSignalId })[];
  /** Quota di campioni diurni con stress alto, 0-1. `null` se il server non la manda. */
  highShare: number | null;
  /** Stress medio per ora locale, 24 valori. `null` per le ore senza misure. */
  byHour: readonly (number | null)[];
  /** Indice Stress dei giorni con un valore, dal più vecchio al più recente. */
  history: readonly number[];
  /** `esempio` finché il telefono non è collegato a un server: la schermata lo dice. */
  source: 'esempio' | 'server';
}

export interface Verdict {
  title: string;
  detail: string;
}

/** Soglie come le zone dell'indice: 85 e 70. Descrive la giornata, non dà indicazioni mediche. */
export function verdictFor(score: number): Verdict {
  if (score >= 85) {
    return { title: 'Giornata tranquilla', detail: 'Lo stress è rimasto basso quasi tutto il giorno.' };
  }
  if (score >= 70) {
    return { title: 'Giornata nella norma', detail: 'Qualche momento di tensione, poi la giornata si è calmata.' };
  }
  return {
    title: 'Giornata tesa',
    detail: 'Lo stress è stato alto per buona parte del giorno o non è calato la sera.',
  };
}

/** Ore con almeno una misura, tra le 07:00 e le 23:00. */
export function hoursWithData(byHour: readonly (number | null)[]): number {
  return byHour.slice(WAKING_FROM, WAKING_TO).filter((v) => v !== null).length;
}

/** «12%», «0%»: la quota di campioni con stress alto. */
export function sharePercent(share: number): number {
  return Math.round(share * 100);
}
