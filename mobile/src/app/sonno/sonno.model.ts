import { MeasureRowData } from '../shared/measure-row.component';
import { SignalRow } from '../shared/signal-row.component';

export type SleepStage = 'awake' | 'rem' | 'light' | 'deep';

/** Un tratto della notte, con inizio in minuti dall'andare a letto. */
export interface SleepSegment {
  stage: SleepStage;
  startMin: number;
  durationMin: number;
}

export type SleepSignalId =
  | 'sleep-duration'
  | 'sleep-efficiency'
  | 'sleep-deep'
  | 'sleep-rem'
  | 'sleep-awakenings'
  | 'sleep-regularity'
  | 'sleep-min-hr';

/** Pesi iniziali dell'indice Sonno (docs/scores.md, algo_version v1). Devono sommare a 1. */
export const SLEEP_WEIGHTS: Record<SleepSignalId, number> = {
  'sleep-duration': 0.3,
  'sleep-efficiency': 0.15,
  'sleep-deep': 0.15,
  'sleep-rem': 0.15,
  'sleep-awakenings': 0.1,
  'sleep-regularity': 0.1,
  'sleep-min-hr': 0.05,
};

export function sleepScore(signals: readonly Pick<SignalRow, 'weight' | 'score'>[]): number {
  return Math.round(signals.reduce((sum, s) => sum + s.weight * s.score, 0));
}

/** Trasforma una lista (fase, durata) in tratti con inizio progressivo. */
export function expandSegments(parts: readonly (readonly [SleepStage, number])[]): SleepSegment[] {
  let start = 0;
  return parts.map(([stage, durationMin]) => {
    const segment = { stage, startMin: start, durationMin };
    start += durationMin;
    return segment;
  });
}

export function totalsByStage(segments: readonly SleepSegment[]): Record<SleepStage, number> {
  const totals: Record<SleepStage, number> = { awake: 0, rem: 0, light: 0, deep: 0 };
  for (const segment of segments) {
    totals[segment.stage] += segment.durationMin;
  }
  return totals;
}

export function inBedMinutes(segments: readonly SleepSegment[]): number {
  return segments.reduce((sum, s) => sum + s.durationMin, 0);
}

export function asleepMinutes(segments: readonly SleepSegment[]): number {
  const totals = totalsByStage(segments);
  return totals.rem + totals.light + totals.deep;
}

/** Quota del tempo a letto passata dormendo, 0-1. */
export function efficiency(segments: readonly SleepSegment[]): number {
  const bed = inBedMinutes(segments);
  return bed === 0 ? 0 : asleepMinutes(segments) / bed;
}

/** Numero di risvegli: tratti di veglia dopo il primo addormentamento. */
export function awakeningCount(segments: readonly SleepSegment[]): number {
  const firstSleep = segments.findIndex((s) => s.stage !== 'awake');
  if (firstSleep < 0) {
    return 0;
  }
  return segments.slice(firstSleep).filter((s) => s.stage === 'awake').length;
}

/** «5 h 52», «45 min». */
export function formatHoursMinutes(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  if (hours === 0) {
    return `${rest} min`;
  }
  return `${hours} h ${String(rest).padStart(2, '0')}`;
}

/** Una notte per la regolarità: punto medio del sonno in minuti dopo la mezzanotte del giorno del risveglio
 *  (le 23:30 valgono -30) e se il risveglio cade nel fine settimana. */
export interface NightMidpoint {
  midpointMin: number;
  weekend: boolean;
}

const MIN_NIGHTS = 5;
const SD_LIMIT_MIN = 90;
const JETLAG_LIMIT_MIN = 120;
const SD_WEIGHT = 0.7;

function mean(values: readonly number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

export interface RegularityResult {
  /** Regolarità 0-100. */
  score: number;
  /** Quanto varia il punto medio da una notte all'altra (deviazione standard), in minuti. */
  variationMin: number;
  /** Scarto tra giorni feriali e fine settimana, in minuti. Assente con meno di 2 notti nel fine settimana. */
  weekendGapMin: number | null;
}

/**
 * Regolarità del sonno (docs/nuove-funzioni.md, sezione 3): 0,7 per la costanza dell'orario
 * e 0,3 per lo scarto tra settimana e fine settimana. Servono almeno 5 notti, altrimenti `null`.
 * Con meno di 2 notti nel fine settimana lo scarto non pesa e conta solo la costanza.
 */
export function regularity(nights: readonly NightMidpoint[]): RegularityResult | null {
  if (nights.length < MIN_NIGHTS) {
    return null;
  }
  const all = nights.map((n) => n.midpointMin);
  const average = mean(all);
  const variationMin = Math.sqrt(mean(all.map((v) => (v - average) ** 2)));
  const sdComponent = 100 * (1 - Math.min(variationMin / SD_LIMIT_MIN, 1));

  const weekdays = nights.filter((n) => !n.weekend).map((n) => n.midpointMin);
  const weekends = nights.filter((n) => n.weekend).map((n) => n.midpointMin);
  if (weekends.length < 2 || weekdays.length === 0) {
    return { score: Math.round(sdComponent), variationMin: Math.round(variationMin), weekendGapMin: null };
  }
  const weekendGapMin = Math.abs(mean(weekdays) - mean(weekends));
  const gapComponent = 100 * (1 - Math.min(weekendGapMin / JETLAG_LIMIT_MIN, 1));
  return {
    score: Math.round(SD_WEIGHT * sdComponent + (1 - SD_WEIGHT) * gapComponent),
    variationMin: Math.round(variationMin),
    weekendGapMin: Math.round(weekendGapMin),
  };
}

/** Il sonno di una notte, per le barre del debito. `minutes` è `null` se quella notte non c'è. */
export interface NightSleep {
  /** Giorno della settimana abbreviato («mer»). */
  label: string;
  minutes: number | null;
}

export interface SonnoData {
  /** Notte da lunedì a martedì: data del risveglio. */
  wakeDate: Date;
  segments: readonly SleepSegment[];
  /** Ora di andare a letto e di alzarsi, già formattate («23:40»). */
  bedTime: string;
  wakeTime: string;
  value: number;
  /** Dove sta l'indice rispetto alla tua media, da −3 a 3. `null` in calibrazione. */
  indexDeviation: number | null;
  /** Gli estremi del tuo solito nella unità dell'indice (68 e 80). `null` se il server non li manda. */
  indexRange: { low: number; high: number } | null;
  /** Le quattro fasi e le misure del corpo, ognuna contro la tua media (ADR 0020). */
  stageRows: readonly MeasureRowData[];
  bodyRows: readonly MeasureRowData[];
  /** Ultime 7 notti, dalla più vecchia a stanotte. */
  nights: readonly NightSleep[];
  signals: readonly (SignalRow & { id: SleepSignalId })[];
  regularity: RegularityResult;
  /** Regolarità degli ultimi 90 giorni, dal più vecchio al più recente. */
  regularityHistory: readonly number[];
  /** Debito di sonno degli ultimi 7 giorni, in minuti. */
  debtMin: number;
  /** `esempio` finché il telefono non è collegato a un server: la schermata lo dice. */
  source: 'esempio' | 'server';
}
