import { DayView } from '../api/api.model';
import { HeartRateReading } from '../ring/heart-rate-log.service';
import { minuteOfDay, romeDay } from '../temperatura/temperatura.model';

/** Un punto del grafico: minuti dalla mezzanotte di Roma e battiti al minuto. */
export interface DayHrPoint {
  min: number;
  bpm: number;
}

/** Il battito misurato oggi dall'anello, con l'ultima misura, la più bassa e la più alta. */
export interface HeartToday {
  points: DayHrPoint[];
  last: HeartRateReading;
  low: HeartRateReading;
  high: HeartRateReading;
}

/** Le misure del giorno di Roma di `now`, fino a `now`. `null` senza misure. */
export function heartToday(readings: readonly HeartRateReading[], now: number): HeartToday | null {
  const day = romeDay(now);
  const today = readings.filter((r) => r.ts <= now && romeDay(r.ts) === day);
  if (today.length === 0) {
    return null;
  }
  let low = today[0];
  let high = today[0];
  for (const r of today) {
    if (r.bpm < low.bpm) {
      low = r;
    }
    if (r.bpm > high.bpm) {
      high = r;
    }
  }
  return { points: today.map((r) => ({ min: minuteOfDay(r.ts), bpm: r.bpm })), last: today[today.length - 1], low, high };
}

/**
 * I tratti di linea: due misure vicine si uniscono, una pausa più lunga di `gapMin` (anello tolto o in carica) lascia
 * il vuoto. Un tratto di una misura sola si disegna come un punto.
 */
export function segments(points: readonly DayHrPoint[], gapMin: number): DayHrPoint[][] {
  const out: DayHrPoint[][] = [];
  for (const p of points) {
    const current = out.at(-1);
    const previous = current?.at(-1);
    if (current && previous && p.min - previous.min <= gapMin) {
      current.push(p);
    } else {
      out.push([p]);
    }
  }
  return out;
}

/** Oltre quanti minuti senza misure la linea si interrompe: tre misure saltate, almeno 20 minuti. */
export function gapFor(intervalMin: number): number {
  return Math.max(20, intervalMin * 3);
}

/** Il tuo battito a riposo di notte (la mediana del server), dall'ultimo giorno che ce l'ha. `null` in calibrazione. */
export function restingAverage(days: readonly DayView[]): number | null {
  for (let i = days.length - 1; i >= 0; i--) {
    const median = days[i].references?.['resting_hr']?.median;
    if (typeof median === 'number') {
      return median;
    }
  }
  return null;
}
