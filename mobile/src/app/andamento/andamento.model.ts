export type Period = 7 | 30 | 90;

export const PERIODS: readonly Period[] = [7, 30, 90];

/** Giorni su cui si calcola «la tua media» e la fascia normale (docs/scores.md, baseline). */
export const BASELINE_DAYS = 28;

/**
 * Ampiezza della fascia normale, in scostamenti dalla tua media (MAD scalata: 1,4826 * MAD).
 * Con 1 scostamento il 32% dei giorni cadrebbe fuori e quasi ogni grafico avrebbe punti ambra:
 * 1,5 lascia fuori circa uno su otto. Valore iniziale, da tarare.
 */
export const BAND_DEVIATIONS = 1.5;

const MAD_SCALE = 1.4826;

export function median(values: readonly number[]): number {
  if (values.length === 0) {
    return NaN;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function average(values: readonly number[]): number {
  return values.length === 0 ? NaN : values.reduce((sum, v) => sum + v, 0) / values.length;
}

export interface NormalBand {
  median: number;
  low: number;
  high: number;
}

/** Fascia normale: mediana ± `BAND_DEVIATIONS` scostamenti, sugli ultimi 28 giorni della serie. */
export function normalBand(series: readonly number[], deviations = BAND_DEVIATIONS): NormalBand {
  const window = series.slice(-BASELINE_DAYS);
  const mid = median(window);
  const mad = median(window.map((v) => Math.abs(v - mid)));
  const half = deviations * MAD_SCALE * mad;
  return { median: mid, low: mid - half, high: mid + half };
}

export function isOutside(value: number, band: NormalBand): boolean {
  return value < band.low || value > band.high;
}

export interface PeriodComparison {
  /** Media degli ultimi `days` giorni. */
  current: number;
  /** Media dei `days` giorni precedenti. */
  previous: number;
  delta: number;
}

/** Ultimi `days` giorni contro i `days` precedenti. `null` se la serie non basta per entrambi. */
export function comparePeriods(series: readonly number[], days: number): PeriodComparison | null {
  if (series.length < days * 2) {
    return null;
  }
  const current = average(series.slice(-days));
  const previous = average(series.slice(-days * 2, -days));
  return { current, previous, delta: current - previous };
}

/** Totale degli ultimi `days` giorni contro i `days` precedenti (per gli episodi di cefalea). */
export function compareTotals(series: readonly number[], days: number): { current: number; previous: number } | null {
  if (series.length < days * 2) {
    return null;
  }
  const sum = (values: readonly number[]) => values.reduce((total, v) => total + v, 0);
  return { current: sum(series.slice(-days)), previous: sum(series.slice(-days * 2, -days)) };
}

export interface DailySeries {
  /** Un valore per giorno, dal più vecchio al più recente. L'ultimo è oggi (o ieri per i passi). */
  values: readonly number[];
}

/** Ore con almeno 250 passi (docs/scores.md, Movement Index). */
export const ACTIVE_HOUR_STEPS = 250;

export function activeHours(stepsByHour: readonly number[]): number {
  return stepsByHour.filter((steps) => steps >= ACTIVE_HOUR_STEPS).length;
}

/** «+0,2 °C», «-0,3 °C», «0,0 °C». */
export function formatSignedTemperature(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  const text = Math.abs(rounded).toFixed(1).replace('.', ',');
  if (rounded > 0) {
    return `+${text} °C`;
  }
  if (rounded < 0) {
    return `-${text} °C`;
  }
  return `${text} °C`;
}
