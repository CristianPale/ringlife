import { JournalEntry } from '../diary/journal.model';

export type StrainSignalId = 'rhr' | 'hrv' | 'temp';

/** Possibili cause comuni, tratte dal diario. Citate nell'insight, non alzano mai il livello. */
export type StrainCause = 'alcohol' | 'late-meal';

/** `alto` = tre segnali insieme, `attenzione` = due, `nessuno` = meno di due. `null` = calibrazione in corso. */
export type StrainLevel = 'nessuno' | 'attenzione' | 'alto';

/** Soglia di ogni segnale, in scostamenti dalla tua media (docs/nuove-funzioni.md, sezione 1). Iniziale, da tarare. */
export const STRAIN_THRESHOLD = 1;

/**
 * Scostamenti dalla tua media, NON orientati: positivo = valore sopra la media.
 * `null` se la baseline di quel segnale non è ancora valida.
 */
export interface StrainDeviations {
  /** Battito a riposo notturno. */
  rhr: number | null;
  /** HRV notturna. */
  hrv: number | null;
  /** Temperatura notturna, relativa. */
  temp: number | null;
}

export interface StrainSignal {
  id: StrainSignalId;
  deviation: number;
  /** Il segnale è oltre la soglia, nella direzione della fatica. */
  active: boolean;
}

export interface StrainResult {
  level: StrainLevel | null;
  /** Quanti dei tre segnali sono attivi. */
  count: number;
  signals: readonly StrainSignal[];
  /** Possibile causa da citare, solo se c'è un livello. */
  cause: StrainCause | null;
}

/**
 * Segnali di affaticamento: battito a riposo su, HRV giù e temperatura su, tutti rispetto alla tua media.
 * Nessun livello senza baseline valida per tutti e tre. Alcol o pasto tardo spiegano in parte i valori:
 * l'insight li cita e il livello non supera «attenzione».
 */
export function evaluateStrain(deviations: StrainDeviations, causes: readonly StrainCause[] = []): StrainResult {
  const { rhr, hrv, temp } = deviations;
  if (rhr === null || hrv === null || temp === null) {
    return { level: null, count: 0, signals: [], cause: null };
  }
  const signals: StrainSignal[] = [
    { id: 'rhr', deviation: rhr, active: rhr >= STRAIN_THRESHOLD },
    { id: 'hrv', deviation: hrv, active: hrv <= -STRAIN_THRESHOLD },
    { id: 'temp', deviation: temp, active: temp >= STRAIN_THRESHOLD },
  ];
  const count = signals.filter((s) => s.active).length;
  const cause = causes[0] ?? null;
  if (count >= 3) {
    return { level: cause ? 'attenzione' : 'alto', count, signals, cause };
  }
  if (count === 2) {
    return { level: 'attenzione', count, signals, cause };
  }
  return { level: 'nessuno', count, signals, cause: null };
}

const EVENING_START_HOUR = 18;
const NIGHT_END_HOUR = 5;

/** Alcol registrato la sera prima: dalle 18:00 del giorno precedente alle 05:00 del giorno del risveglio. */
export function alcoholEveningBefore(entries: readonly JournalEntry[], wakeDate: Date): boolean {
  const start = new Date(wakeDate);
  start.setDate(start.getDate() - 1);
  start.setHours(EVENING_START_HOUR, 0, 0, 0);
  const end = new Date(wakeDate);
  end.setHours(NIGHT_END_HOUR, 0, 0, 0);
  return entries.some((entry) => {
    if (entry.kind !== 'alcohol') {
      return false;
    }
    const at = new Date(entry.at).getTime();
    return at >= start.getTime() && at < end.getTime();
  });
}
