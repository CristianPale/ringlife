/** Tipi dell'API del backend (docs/api.md). I timestamp sono millisecondi dall'epoca, UTC. */

export type MetricName = 'HR' | 'SPO2' | 'STRESS' | 'HRV' | 'TEMP' | 'STEPS' | 'CALORIES';
export type SleepStageName = 'deep' | 'light' | 'rem' | 'awake';

export interface SamplePayload {
  metric: MetricName;
  ts: number;
  value: number;
}

export interface SleepStagePayload {
  stage: SleepStageName;
  start: number;
  end: number;
}

export interface SleepSessionPayload {
  start: number;
  end: number;
  stages: SleepStagePayload[];
}

/** `received` = elementi inviati, `inserted` = nuovi, `duplicates` = già presenti. */
export interface UploadResult {
  received: number;
  inserted: number;
  duplicates: number;
}

export interface ScoreView {
  value: number;
  algoVersion: string;
  components: unknown;
}

export interface MetricView {
  value: number | null;
  unit: string | null;
  detail: unknown;
  algoVersion: string;
}

/**
 * Risultati di un giorno locale. Un indice assente non è calcolabile (dati mancanti o calibrazione in corso).
 * `baselines` dice su quanti giorni si basa la tua media: una feature assente non ha ancora una baseline.
 */
export interface DayView {
  day: string;
  scores: Record<string, ScoreView>;
  metrics: Record<string, MetricView>;
  baselines: Record<string, number>;
  /** Valori del giorno (`hrv_night`, `resting_hr`, `temp_night`…). Assenti nei server più vecchi. */
  features?: Record<string, number>;
  /** La tua media di una feature e lo scostamento di oggi: `(x − mediana) / (1,4826 · MAD)`, tra −3 e 3. */
  references?: Record<string, ReferenceView>;
  /** Lo stesso per ogni indice del giorno, rispetto ai 28 giorni precedenti (ADR 0020). Assente senza almeno 7 giorni di storia. */
  scoreReferences?: Record<string, ReferenceView>;
  /** La notte che finisce in questo giorno, con le fasi. `null` o assente senza sonno. */
  sleep?: SleepView | null;
  /** Passi per ora locale (24 valori). `null` o assente senza passi. */
  stepsByHour?: number[] | null;
  /** Stress medio per ora locale (24 valori, `null` per le ore senza misure). `null` o assente senza misure. */
  stressByHour?: (number | null)[] | null;
}

export interface SleepView {
  start: number;
  end: number;
  stages: { stage: SleepStageName; start: number; end: number }[];
}

export interface ReferenceView {
  median: number;
  /** L'unità dello scostamento nella unità della metrica: il tuo solito va da `median − 1,5 · spread` a `median + 1,5 · spread`. Assente nei server più vecchi. */
  spread?: number;
  /** Positivo = sopra la tua media. `null` se quel giorno non ha il valore. */
  deviation: number | null;
}

/** Il diario sul filo (docs/adr/0010): istanti in millisecondi UTC, un elemento per voce o episodio. */
export interface DiaryEntryPayload {
  id: string;
  ts: number;
  kind: 'caffeine' | 'alcohol' | 'note';
  drink?: string;
  text?: string;
}

export interface DiaryEpisodePayload {
  id: string;
  start: number;
  end: number | null;
  intensity: number;
  intensityLog: { at: number; value: number }[];
  medicationAt: number[];
  details: {
    symptoms: string[];
    location: string | null;
    medicationHelp: string | null;
    causes: string[];
    notes: string;
  };
  completedAt: number | null;
}

export interface DiaryPayload {
  entries?: DiaryEntryPayload[];
  episodes?: DiaryEpisodePayload[];
  deletedEntries?: string[];
  deletedEpisodes?: string[];
}

/** Il diario com'è sul server: stessa forma dell'invio. */
export interface DiaryView {
  entries: DiaryEntryPayload[];
  episodes: DiaryEpisodePayload[];
}

/** Limiti del diario per richiesta: oltre, il server rifiuta (400), quindi si spezza prima. */
export const MAX_DIARY_ENTRIES = 500;
export const MAX_DIARY_EPISODES = 100;
export const MAX_DIARY_DELETED = 1000;

/** Limiti del backend: una richiesta più grande viene rifiutata (400), quindi si spezza prima. */
export const MAX_SAMPLES_PER_REQUEST = 5000;
export const MAX_SESSIONS_PER_REQUEST = 31;

/** Spezza una lista in gruppi di al massimo `size` elementi, mantenendo l'ordine. */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  if (size < 1) {
    throw new RangeError('La dimensione del gruppo deve essere almeno 1');
  }
  const groups: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    groups.push(items.slice(i, i + size));
  }
  return groups;
}

/** Offset del telefono rispetto a UTC in minuti (+60 in inverno a Roma). Va inviato a ogni caricamento. */
export function tzOffsetMin(date: Date = new Date()): number {
  // `getTimezoneOffset` è l'opposto: minuti che UTC è in anticipo sull'ora locale.
  return -date.getTimezoneOffset();
}

/** Il contenuto del report delle cefalee per il medico (docs/adr/0019). Mai le note libere. */
export interface MigraineReportData {
  from: string;
  to: string;
  days: number;
  /** Assente (`null`) senza cefalee nel periodo. */
  summary: MigraineReportSummary | null;
  episodes: MigraineReportEpisode[];
  recurrences: MigraineReportRecurrence[];
}

export interface MigraineReportSummary {
  episodes: number;
  headacheDays: number;
  peakMax: number;
  peakAverage: number;
  medicationDays: number;
  medicationIntakes: number;
  averageDurationMin: number | null;
}

export interface MigraineReportEpisode {
  start: number;
  end: number | null;
  peak: number;
  symptoms: string[];
  location: string | null;
  medicationCount: number;
  medicationHelp: string | null;
  causes: string[];
}

export interface MigraineReportRecurrence {
  label: string;
  headacheTriggered: number;
  headacheEvaluated: number;
  otherTriggered: number;
  otherEvaluated: number;
}

/** Periodi del report, in giorni: gli stessi che il server accetta. */
export const REPORT_PERIODS = [30, 90, 180] as const;
export type ReportPeriod = (typeof REPORT_PERIODS)[number];
