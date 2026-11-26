import { DayView } from '../api/api.model';
import { HeadacheEpisode } from '../diary/headache.model';
import { AndamentoData } from './andamento.sample';

const DAY_KEY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' });

/** Valori consecutivi che finiscono al giorno `end`, dal più vecchio. Si ferma al primo giorno senza valore. */
function runEndingAt(days: readonly DayView[], end: number, get: (day: DayView) => number | undefined): number[] {
  const values: number[] = [];
  for (let i = end; i >= 0; i--) {
    const value = get(days[i]);
    if (typeof value !== 'number') {
      break;
    }
    values.unshift(value);
  }
  return values;
}

/**
 * Episodi di cefalea per giorno, dal diario del telefono, dal primo giorno in cui il server ha dati fino a `days[end]`.
 * Prima di quel giorno non si sa niente: scrivere «zero episodi» sarebbe un'affermazione senza base.
 */
function headacheCounts(days: readonly DayView[], end: number, episodes: readonly HeadacheEpisode[]): number[] {
  let first = days.findIndex((d) => Object.keys(d.features ?? {}).length > 0 || d.sleep);
  first = first < 0 ? 0 : first;
  const perDay = new Map<string, number>();
  for (const episode of episodes) {
    const key = DAY_KEY.format(new Date(episode.startedAt));
    perDay.set(key, (perDay.get(key) ?? 0) + 1);
  }
  return days.slice(first, end + 1).map((d) => perDay.get(d.day) ?? 0);
}

/**
 * La scheda Andamento dai risultati del server. `days` va dal più vecchio al più recente.
 * «Oggi» è l'ultimo giorno con una notte di sonno. Ogni serie prende i giorni consecutivi che finiscono
 * lì: un giorno senza valore la interrompe, così le date sotto il grafico restano giuste e non si inventa niente.
 * I passi finiscono ieri. Le cefalee vengono dal diario del telefono, non dal server.
 * Senza una notte di sonno torna `null`.
 */
export function andamentoFromServer(
  base: AndamentoData,
  days: readonly DayView[],
  episodes: readonly HeadacheEpisode[],
): AndamentoData | null {
  let end = -1;
  for (let i = days.length - 1; i >= 0 && end < 0; i--) {
    if (typeof days[i].features?.['sleep_asleep_min'] === 'number') {
      end = i;
    }
  }
  if (end < 0) {
    return null;
  }
  const yesterday = end > 0 ? days[end - 1] : undefined;
  return {
    today: new Date(`${days[end].day}T08:00:00`),
    sleepMinutes: runEndingAt(days, end, (d) => d.features?.['sleep_asleep_min']),
    recovery: runEndingAt(days, end, (d) => d.scores['recovery']?.value),
    steps: end > 0 ? runEndingAt(days, end - 1, (d) => d.features?.['steps']) : [],
    headaches: headacheCounts(days, end, episodes),
    hrv: runEndingAt(days, end, (d) => d.features?.['hrv_night']),
    restingHr: runEndingAt(days, end, (d) => d.features?.['resting_hr']),
    restingHrRecent: days
      .slice(Math.max(0, end - 13), end + 1)
      .map((d) => d.features?.['resting_hr'])
      .filter((v): v is number => typeof v === 'number'),
    temperature: runEndingAt(days, end, (d) => d.metrics['temp_deviation']?.value ?? undefined),
    stepsYesterdayByHour: yesterday?.stepsByHour?.length === 24 ? yesterday.stepsByHour : Array(24).fill(0),
    source: 'server',
  };
}
