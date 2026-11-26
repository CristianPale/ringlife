import { HeadacheEpisode } from '../diary/headache.model';

const ZONE = 'Europe/Rome';

export type DayKind = 'none' | 'episode' | 'medication';

export interface MonthCell {
  /** Giorno del mese, `null` per le caselle di riempimento. */
  day: number | null;
  /** Con farmaco: almeno un episodio del giorno ha un farmaco segnato. */
  kind: DayKind;
}

export interface MonthView {
  /** «Novembre 2026». */
  title: string;
  /** Settimane da lunedì a domenica. */
  weeks: MonthCell[][];
  /** Cefalee iniziate nel mese. */
  episodes: number;
  /** Giorni del mese con un farmaco segnato. */
  medicationDays: number;
  /** Durata media degli episodi finiti, in minuti. `null` senza episodi finiti. */
  averageDurationMin: number | null;
}

interface LocalDate {
  year: number;
  month: number;
  day: number;
}

function localDate(iso: string): LocalDate {
  const parts = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: ZONE }).formatToParts(
    new Date(iso),
  );
  const value = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { year: value('year'), month: value('month'), day: value('day') };
}

/** Il mese (anno e mese 1-12) di un istante, spostato di `offset` mesi. */
export function monthOf(now: Date, offset = 0): { year: number; month: number } {
  const { year, month } = localDate(now.toISOString());
  const index = year * 12 + (month - 1) + offset;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

/** Il calendario di un mese con gli episodi: un giorno è «con farmaco» se un episodio di quel giorno ne ha uno. */
export function buildMonth(episodes: readonly HeadacheEpisode[], year: number, month: number): MonthView {
  const inMonth = episodes.filter((e) => {
    const date = localDate(e.startedAt);
    return date.year === year && date.month === month;
  });
  const byDay = new Map<number, DayKind>();
  for (const episode of inMonth) {
    const day = localDate(episode.startedAt).day;
    const kind: DayKind = episode.medicationAt.length > 0 ? 'medication' : 'episode';
    byDay.set(day, byDay.get(day) === 'medication' ? 'medication' : kind);
  }

  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  // Lunedì = 0: il giorno della settimana UTC del primo del mese, spostato.
  const lead = (new Date(Date.UTC(year, month - 1, 1)).getUTCDay() + 6) % 7;
  const cells: MonthCell[] = [
    ...Array.from({ length: lead }, (): MonthCell => ({ day: null, kind: 'none' })),
    ...Array.from({ length: daysInMonth }, (_, i): MonthCell => ({ day: i + 1, kind: byDay.get(i + 1) ?? 'none' })),
  ];
  while (cells.length % 7 !== 0) {
    cells.push({ day: null, kind: 'none' });
  }
  const weeks = Array.from({ length: cells.length / 7 }, (_, i) => cells.slice(i * 7, i * 7 + 7));

  const finished = inMonth.filter((e) => e.endedAt !== null);
  const total = finished.reduce((sum, e) => sum + (new Date(e.endedAt as string).getTime() - new Date(e.startedAt).getTime()), 0);
  const title = new Intl.DateTimeFormat('it-IT', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(year, month - 1, 15)));

  return {
    title: title.charAt(0).toUpperCase() + title.slice(1),
    weeks,
    episodes: inMonth.length,
    medicationDays: [...byDay.values()].filter((k) => k === 'medication').length,
    averageDurationMin: finished.length === 0 ? null : Math.round(total / finished.length / 60_000),
  };
}
