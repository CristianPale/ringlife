import { Direction, USUAL_BAND, standingOf } from './livella';

export interface Wording {
  /** Sotto il tuo solito, per esempio «Meno del solito». */
  below: string;
  above: string;
}

export interface MeasureWords {
  sub: string;
  tone: 'peggio' | 'meglio' | null;
}

/**
 * Le parole sotto il nome di una misura (ADR 0020): dentro le tacche la descrizione della misura, fuori le parole
 * sul solito («Più bassa del solito»), colorate solo se la misura è peggio o meglio. Senza media, «In calibrazione».
 */
export function measureWords(deviation: number | null, direction: Direction, descriptor: string, wording: Wording): MeasureWords {
  if (deviation === null) {
    return { sub: 'In calibrazione', tone: null };
  }
  if (Math.abs(deviation) <= USUAL_BAND) {
    return { sub: descriptor, tone: null };
  }
  const standing = standingOf(deviation, direction);
  return { sub: deviation < 0 ? wording.below : wording.above, tone: standing === 'solito' ? null : standing };
}

/** Durata in minuti come valore e unità: «48 minuti», «4:08 ore». */
export function durationReading(minutes: number): { value: string; unit: string } {
  const total = Math.max(0, Math.round(minutes));
  if (total < 60) {
    return { value: String(total), unit: total === 1 ? 'minuto' : 'minuti' };
  }
  return { value: `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`, unit: 'ore' };
}

/** Scostamento in gradi con la virgola e il segno: «+0,2», «−0,4». */
export function signedDegrees(value: number): string {
  const abs = Math.abs(value).toFixed(1).replace('.', ',');
  return value > 0 ? `+${abs}` : value < 0 ? `−${abs}` : abs;
}
