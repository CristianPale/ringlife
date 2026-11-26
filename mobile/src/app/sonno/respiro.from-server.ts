import { DayView } from '../api/api.model';
import { BreathingResult, BreathingStatus } from './respiro.model';
import { RespiroData } from './respiro.sample';

const STATUSES: readonly BreathingStatus[] = ['insufficient', 'calibrating', 'ok', 'watch'];

interface ServerDetail {
  status?: string;
  count?: number;
  streak?: number;
  min?: number;
  deviation?: number;
}

/**
 * Il respiro notturno dai risultati del server: usa l'ultimo giorno che ha `spo2_night`. Il server ha già
 * valutato la notte (stessa regola dell'app), quindi qui si traduce soltanto. La storia delle mediane
 * delle notti precedenti serve al grafico. Senza una notte valutata torna `null`.
 */
export function respiroFromServer(base: RespiroData, days: readonly DayView[]): RespiroData | null {
  let index = -1;
  for (let i = days.length - 1; i >= 0 && index < 0; i--) {
    if (days[i].metrics['spo2_night']) {
      index = i;
    }
  }
  if (index < 0) {
    return null;
  }
  const latest = days[index];
  const metric = latest.metrics['spo2_night'];
  const detail = (metric.detail ?? {}) as ServerDetail;
  const status = STATUSES.find((s) => s === detail.status);
  if (!status) {
    return null;
  }

  const result: BreathingResult = {
    status,
    median: typeof metric.value === 'number' ? metric.value : null,
    min: typeof detail.min === 'number' ? detail.min : null,
    count: detail.count ?? 0,
    deviation: typeof detail.deviation === 'number' ? detail.deviation : null,
    baseline: latest.references?.['spo2_median']?.median ?? null,
    streak: detail.streak ?? 0,
  };
  const history = days
    .slice(0, index)
    .map((d) => d.features?.['spo2_median'])
    .filter((v): v is number => typeof v === 'number');
  return { tonight: [], history, result, source: 'server' };
}
