/**
 * Il calendario dei giorni passati (docs/adr/0032): mesi e settimane da lunedì, sui giorni `AAAA-MM-GG` del calendario,
 * senza fuso (a mezzogiorno UTC il giorno non cambia mai).
 */

/** `2026-11` di `2026-11-17`. */
export function monthOf(day: string): string {
  return day.slice(0, 7);
}

/** Il mese prima o dopo, `2026-01` → `2025-12`. */
export function shiftMonth(month: string, by: number): string {
  const [year, m] = month.split('-').map(Number);
  const index = year * 12 + (m - 1) + by;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
}

/** Le settimane del mese, da lunedì a domenica: `null` nelle caselle fuori dal mese. */
export function monthWeeks(month: string): (string | null)[][] {
  const [year, m] = month.split('-').map(Number);
  const lead = (new Date(Date.UTC(year, m - 1, 1)).getUTCDay() + 6) % 7;
  const length = new Date(Date.UTC(year, m, 0)).getUTCDate();
  const cells: (string | null)[] = Array.from({ length: lead }, () => null);
  for (let d = 1; d <= length; d++) {
    cells.push(`${month}-${String(d).padStart(2, '0')}`);
  }
  while (cells.length % 7 !== 0) {
    cells.push(null);
  }
  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) {
    weeks.push(cells.slice(i, i + 7));
  }
  return weeks;
}

const MONTH_TITLE = new Intl.DateTimeFormat('it-IT', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const DATE = new Intl.DateTimeFormat('it-IT', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
const DATE_YEAR = new Intl.DateTimeFormat('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const ROME_YEAR = new Intl.DateTimeFormat('en-CA', { year: 'numeric', timeZone: 'Europe/Rome' });

/** «Novembre 2026». */
export function monthTitle(month: string): string {
  const text = MONTH_TITLE.format(new Date(`${month}-15T12:00:00Z`));
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** «martedì 17 novembre», con l'anno quando non è quello di `now` (ora di Roma). */
export function dateText(day: string, now: Date): string {
  const date = new Date(`${day}T12:00:00Z`);
  return day.slice(0, 4) === ROME_YEAR.format(now) ? DATE.format(date) : DATE_YEAR.format(date);
}

/** Il numero del giorno, `17`. */
export function dayNumber(day: string): number {
  return Number(day.slice(8, 10));
}
