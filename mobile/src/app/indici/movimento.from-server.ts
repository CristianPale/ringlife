import { DayView } from '../api/api.model';
import { MovimentoData } from './movimento.sample';

/** I giorni conclusi (non l'ultimo, che è oggi) con i passi per ora: quelli che il dettaglio sa mostrare. */
export function movementDays(days: readonly DayView[]): string[] {
  return days
    .slice(0, -1)
    .filter((d) => d.stepsByHour?.length === 24)
    .map((d) => d.day);
}

/**
 * Il dettaglio Movimento dai dati del server. `days` va dal più vecchio al più recente e l'ultimo è oggi.
 * Ieri è l'ultimo giorno concluso con i passi per ora; i minuti di sforzo di ieri e lo storico dei passi
 * vengono dai valori dei giorni. Senza un giorno concluso con i passi per ora non c'è niente da mostrare: `null`.
 * Con `day` mostra quel giorno concluso al posto di ieri, con lo storico fino a lì (`stepsToday` sono i suoi passi).
 */
export function movimentoFromServer(base: MovimentoData, days: readonly DayView[], day?: string): MovimentoData | null {
  if (day !== undefined) {
    const index = days.findIndex((d) => d.day === day);
    const chosen = days[index];
    if (!chosen || chosen.stepsByHour?.length !== 24) {
      return null;
    }
    return {
      today: new Date(`${chosen.day}T08:00:00`),
      stepsToday: Math.round(chosen.features?.['steps'] ?? 0),
      stepsYesterdayByHour: chosen.stepsByHour,
      hrMinutesYesterday: Math.round(chosen.features?.['hr_minutes'] ?? 0),
      stepsHistory: days
        .slice(0, index + 1)
        .map((d) => d.features?.['steps'])
        .filter((v): v is number => typeof v === 'number')
        .map(Math.round),
      source: 'server',
    };
  }
  if (days.length < 2) {
    return null;
  }
  const today = days[days.length - 1];
  const finished = days.slice(0, -1);
  let yesterday: DayView | undefined;
  for (let i = finished.length - 1; i >= 0 && !yesterday; i--) {
    if (finished[i].stepsByHour && finished[i].stepsByHour!.length === 24) {
      yesterday = finished[i];
    }
  }
  if (!yesterday) {
    return null;
  }
  return {
    today: new Date(`${today.day}T08:00:00`),
    stepsToday: Math.round(today.features?.['steps'] ?? 0),
    stepsYesterdayByHour: yesterday.stepsByHour!,
    hrMinutesYesterday: Math.round(yesterday.features?.['hr_minutes'] ?? 0),
    stepsHistory: finished.map((d) => d.features?.['steps']).filter((v): v is number => typeof v === 'number').map(Math.round),
    source: 'server',
  };
}
