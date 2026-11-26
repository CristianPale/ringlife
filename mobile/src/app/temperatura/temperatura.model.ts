import { TemperatureReading } from '../ring/temperature-log.service';

const KEY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' });
const TIME = new Intl.DateTimeFormat('it-IT', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome' });
const HOUR = new Intl.DateTimeFormat('it-IT', { hour: 'numeric', minute: 'numeric', hourCycle: 'h23', timeZone: 'Europe/Rome' });

/** «36,4». */
export function celsiusText(value: number): string {
  return value.toFixed(1).replace('.', ',');
}

/** «14:30». */
export function timeText(ts: number): string {
  return TIME.format(new Date(ts));
}

/** Il giorno di Roma, `2026-11-19`. */
export function romeDay(ts: number): string {
  return KEY.format(new Date(ts));
}

/** Minuti dalla mezzanotte di Roma. */
export function minuteOfDay(ts: number): number {
  const [h, m] = HOUR.format(new Date(ts)).split(':').map(Number);
  return h * 60 + m;
}

export interface TemperatureDay {
  readings: TemperatureReading[];
  min: TemperatureReading;
  max: TemperatureReading;
}

/** Le misure di un giorno (di Roma) con la più bassa e la più alta. `null` senza misure. */
export function temperatureDay(readings: readonly TemperatureReading[], day: string): TemperatureDay | null {
  const list = readings.filter((r) => romeDay(r.ts) === day);
  if (list.length === 0) {
    return null;
  }
  const min = list.reduce((a, b) => (b.celsius < a.celsius ? b : a));
  const max = list.reduce((a, b) => (b.celsius > a.celsius ? b : a));
  return { readings: list, min, max };
}

/** Il disegno delle misure del giorno: ascisse sulle 24 ore, ordinate tra la minima e la massima con un margine. */
export function dayChart(day: TemperatureDay, width: number, height: number, pad = 8): { line: string; points: { x: number; y: number }[]; low: number; high: number } {
  // Decimi interi prima di arrotondare: (36,6 + 0,2) × 10 in virgola mobile fa 368,00000000000006.
  const tenths = (value: number) => Number((value * 10).toFixed(6));
  const low = Math.floor(tenths(day.min.celsius - 0.2)) / 10;
  const high = Math.ceil(tenths(day.max.celsius + 0.2)) / 10;
  const x = (ts: number) => pad + (minuteOfDay(ts) / (24 * 60)) * (width - pad * 2);
  const y = (c: number) => pad + (1 - (c - low) / (high - low || 1)) * (height - pad * 2);
  const points = day.readings.map((r) => ({ x: Math.round(x(r.ts) * 10) / 10, y: Math.round(y(r.celsius) * 10) / 10 }));
  return { line: points.map((p) => `${p.x},${p.y}`).join(' '), points, low, high };
}
