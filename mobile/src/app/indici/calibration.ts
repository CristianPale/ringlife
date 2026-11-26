import { DayView } from '../api/api.model';

/** Notti che servono per la tua media (docs/scores.md). La media di un giorno usa i giorni prima, il giorno escluso. */
export const BASELINE_NIGHTS = 7;
/** La finestra della tua media. */
const WINDOW_DAYS = 28;

export interface NightsProgress {
  /** Notti con il dato negli ultimi 28 giorni, oggi compreso. */
  recorded: number;
  /** Notti che servono ancora prima che una notte abbia il confronto con la tua media. 0 = ci sono già. */
  toGo: number;
}

/**
 * A che punto è la tua media per un dato che arriva una volta a notte. `days` va dal più vecchio a oggi. La notte che
 * ha il primo confronto ne ha 7 prima di sé: con 6 notti registrate ne servono ancora 2, la settima per la media e
 * l'ottava da confrontare.
 */
export function nightsProgress(days: readonly DayView[], has: (day: DayView) => boolean): NightsProgress {
  const recorded = days.slice(-WINDOW_DAYS).filter(has).length;
  return { recorded, toGo: Math.max(0, BASELINE_NIGHTS + 1 - recorded) };
}

/** «manca 1 notte», «mancano 3 notti». */
export function nightsToGoText(toGo: number): string {
  return toGo === 1 ? 'manca 1 notte' : `mancano ${toGo} notti`;
}

/** Una notte conta per il Recupero quando ha il battito a riposo o l'HRV: i due segnali che pesano di più. */
function hasRecoveryNight(day: DayView): boolean {
  return typeof day.features?.['resting_hr'] === 'number' || typeof day.features?.['hrv_night'] === 'number';
}

/**
 * Che cosa dire quando il server non ha ancora nessun Recupero. Quasi sempre è la calibrazione: il Recupero confronta
 * battito a riposo e HRV della notte con la tua media, e la media chiede 7 notti prima.
 */
export function recoveryWaiting(days: readonly DayView[]): { lead: string; hint: string } {
  const { recorded, toGo } = nightsProgress(days, hasRecoveryNight);
  if (toGo === 0) {
    return {
      lead: 'Nessun dato ancora.',
      hint: 'Le notti per la tua media ci sono. Il Recupero compare dopo la prossima sincronizzazione dell\'anello, quando il server lo ha calcolato.',
    };
  }
  const sofar = recorded === 0 ? 'Finora non ce n\'è nessuna' : `Finora ne hai ${recorded}`;
  const when = toGo === 1 ? 'dopo la prossima notte' : recorded === 0 ? `dopo ${toGo} notti` : `dopo altre ${toGo} notti`;
  return {
    lead: 'In calibrazione.',
    hint: `Il Recupero confronta la notte con la tua media, e la media si forma con ${BASELINE_NIGHTS} notti. ${sofar}: il primo Recupero arriva ${when} con l'anello al dito.`,
  };
}
