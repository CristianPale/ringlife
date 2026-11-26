import { RECUPERO_SAMPLE } from '../indici/recupero.sample';

/** Giorni di storia sintetica: 180, per confrontare 90 giorni con i 90 precedenti. */
export const SAMPLE_DAYS = 180;

interface SeriesOptions {
  seed: number;
  base: number;
  wave: number;
  noise: number;
  min: number;
  max: number;
  decimals?: number;
  /** Ultimi valori, forzati: coincidono con le altre schermate di esempio. */
  last: readonly number[];
}

/** Serie SINTETICA ripetibile: stesso risultato a ogni avvio. */
function series(days: number, options: SeriesOptions): number[] {
  const factor = 10 ** (options.decimals ?? 0);
  let state = options.seed;
  const values: number[] = [];
  for (let i = 0; i < days - options.last.length; i++) {
    state = (state * 1103515245 + 12345) % 2147483648;
    const noise = (state / 2147483648 - 0.5) * 2 * options.noise;
    const raw = options.base + Math.sin(i / 7) * options.wave + noise;
    values.push(Math.round(Math.max(options.min, Math.min(options.max, raw)) * factor) / factor);
  }
  return [...values, ...options.last];
}

/** Episodi di cefalea per giorno: 0 o 1, circa uno ogni 8 giorni. */
function headacheSeries(days: number): number[] {
  let state = 5;
  const values: number[] = [];
  for (let i = 0; i < days; i++) {
    state = (state * 1103515245 + 12345) % 2147483648;
    values.push(state / 2147483648 < 0.12 ? 1 : 0);
  }
  return values;
}

/** Passi di ieri, ora per ora, dalla mezzanotte: 5.470 in tutto, 11 ore attive. */
const STEPS_YESTERDAY_BY_HOUR: readonly number[] = [
  0, 0, 0, 0, 0, 0, 0, 180, 640, 420, 310, 120, 380, 520, 260, 140, 90, 410, 720, 480, 300, 150, 70, 280,
];

export interface AndamentoData {
  /** Giorno di «oggi»: l'ultimo valore delle serie notturne. */
  today: Date;
  sleepMinutes: readonly number[];
  recovery: readonly number[];
  /** Passi al giorno: l'ultimo valore è ieri, il giorno completo più recente. */
  steps: readonly number[];
  headaches: readonly number[];
  hrv: readonly number[];
  restingHr: readonly number[];
  /**
   * Battito a riposo delle ultime notti che lo hanno, anche non consecutive, dalla più vecchia: serve all'età cardio
   * (docs/adr/0031). Assente = gli ultimi valori di `restingHr`.
   */
  restingHrRecent?: readonly number[];
  /** Scostamento notturno della temperatura dalla tua media, in °C. */
  temperature: readonly number[];
  stepsYesterdayByHour: readonly number[];
  /** `esempio` finché il telefono non è collegato a un server: la schermata lo dice. */
  source: 'esempio' | 'server';
}

export const ANDAMENTO_SAMPLE: AndamentoData = {
  today: new Date('2026-11-03T08:00:00+01:00'),
  sleepMinutes: series(SAMPLE_DAYS, { seed: 3, base: 410, wave: 35, noise: 55, min: 240, max: 540, last: [352] }),
  // Ultimi 90 giorni: gli stessi del dettaglio Recupero. I 90 precedenti sono sintetici.
  recovery: [
    ...series(SAMPLE_DAYS - RECUPERO_SAMPLE.history.length, {
      seed: 9,
      base: 72,
      wave: 6,
      noise: 12,
      min: 35,
      max: 95,
      last: [],
    }),
    ...RECUPERO_SAMPLE.history,
  ],
  steps: series(SAMPLE_DAYS, { seed: 21, base: 7200, wave: 1200, noise: 2600, min: 800, max: 16000, last: [5470] }),
  headaches: headacheSeries(SAMPLE_DAYS),
  hrv: series(SAMPLE_DAYS, { seed: 33, base: 52, wave: 4, noise: 7, min: 25, max: 85, last: [43] }),
  restingHr: series(SAMPLE_DAYS, { seed: 41, base: 54, wave: 1.5, noise: 3, min: 44, max: 68, last: [56] }),
  temperature: series(SAMPLE_DAYS, {
    seed: 57,
    base: 0,
    wave: 0.1,
    noise: 0.35,
    min: -1,
    max: 1,
    decimals: 1,
    last: [0],
  }),
  stepsYesterdayByHour: STEPS_YESTERDAY_BY_HOUR,
  source: 'esempio',
};
