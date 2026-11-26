import { DayView } from '../api/api.model';

/**
 * Tornare ai giorni passati nei dettagli (Sonno, Recupero, Stress, Movimento). Le funzioni `…FromServer` prendono
 * l'ultimo giorno con i dati: tagliando l'elenco al giorno scelto mostrano quel giorno, con la storia fino a lì.
 */

/** I giorni fino a `day` compreso. `null` = tutti (il più recente). */
export function daysUpTo(days: readonly DayView[], day: string | null): readonly DayView[] {
  return day === null ? days : days.filter((d) => d.day <= day);
}

/** I giorni che una pagina sa mostrare, dal più vecchio. */
export function daysWith(days: readonly DayView[], has: (day: DayView) => boolean): string[] {
  return days.filter(has).map((d) => d.day);
}

/** Il giorno chiesto, se la pagina lo sa mostrare e non è già il più recente; altrimenti `null` (il più recente). */
export function chosenDay(requested: string | null | undefined, available: readonly string[]): string | null {
  if (!requested || !available.includes(requested)) {
    return null;
  }
  return requested === available[available.length - 1] ? null : requested;
}

const WEEKDAY_DAY = new Intl.DateTimeFormat('it-IT', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
const KEY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' });

/** `2026-11-17` del calendario, senza fuso: a mezzogiorno UTC il giorno non cambia mai. */
function calendarDate(day: string): Date {
  return new Date(`${day}T12:00:00Z`);
}

/** Il giorno prima o dopo, `2026-11-17` → `2026-11-16`. */
export function shiftDay(day: string, by: number): string {
  return new Date(calendarDate(day).getTime() + by * 86_400_000).toISOString().slice(0, 10);
}

/** «oggi», «ieri» o «lunedì 17 novembre», rispetto all'ora di Roma di `now`. */
export function dayName(day: string, now: Date): string {
  const today = KEY.format(now);
  if (day === today) {
    return 'oggi';
  }
  if (day === shiftDay(today, -1)) {
    return 'ieri';
  }
  return WEEKDAY_DAY.format(calendarDate(day));
}

/** «Notte da domenica a lunedì»: la notte che finisce la mattina di `day` (il sonno appartiene al giorno del risveglio). */
export function nightName(day: string): string {
  const weekday = new Intl.DateTimeFormat('it-IT', { weekday: 'long', timeZone: 'UTC' });
  return `Notte da ${weekday.format(calendarDate(shiftDay(day, -1)))} a ${weekday.format(calendarDate(day))}`;
}
