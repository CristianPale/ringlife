import { DayView } from '../api/api.model';
import { usualRange } from '../livella/livella';
import { zoneForScore } from '../oggi/zone';
import { GLOSSARY } from './glossary';
import { STRESS_WEIGHTS, StressData, StressSignalId, sharePercent } from './stress.model';

interface ServerComponent {
  id: string;
  weight: number;
  score: number | null;
}

function isSignalId(id: string): id is StressSignalId {
  return id in STRESS_WEIGHTS;
}

/**
 * Il dettaglio Stress dai risultati del server: l'ultimo giorno finito che ha l'indice. I numeri dei segnali
 * (quota con stress alto, mediane del giorno e della sera) vengono dai valori del giorno; senza, la riga dice
 * solo il punteggio. Un segnale che il server non ha usato non compare e i pesi si riscalano a 1.
 * Senza un indice Stress calcolato torna `null`.
 */
export function stressFromServer(base: StressData, days: readonly DayView[]): StressData | null {
  let latest: DayView | undefined;
  for (let i = days.length - 1; i >= 0 && !latest; i--) {
    if (days[i].scores['stress']) {
      latest = days[i];
    }
  }
  if (!latest) {
    return null;
  }
  const features = latest.features ?? {};
  const share = features['stress_high_share'];
  const dayMedian = features['stress_day_median'];
  const eveningMedian = features['stress_evening_median'];

  const raw = latest.scores['stress'].components;
  const used = (Array.isArray(raw) ? (raw as ServerComponent[]) : []).filter(
    (c): c is ServerComponent & { score: number } => typeof c.score === 'number' && isSignalId(c.id),
  );
  const totalWeight = used.reduce((sum, c) => sum + c.weight, 0);

  const readout = (id: StressSignalId, score: number): { valueText: string; baselineText?: string } => {
    if (id === 'stress-load') {
      return { valueText: typeof share === 'number' ? `${sharePercent(share)}% del tempo` : `${score} su 100` };
    }
    return typeof dayMedian === 'number' && typeof eveningMedian === 'number'
      ? {
          valueText: `giorno ${Math.round(dayMedian)} · sera ${Math.round(eveningMedian)}`,
          baselineText: 'Più basso la sera è meglio',
        }
      : { valueText: `${score} su 100` };
  };

  const signals = used.map((c) => {
    const id = c.id as StressSignalId;
    const template = base.signals.find((s) => s.id === id);
    const entry: { fullName?: string; help: string } = GLOSSARY[id];
    return {
      id,
      label: template?.label ?? id,
      weight: totalWeight > 0 ? c.weight / totalWeight : c.weight,
      score: c.score,
      zone: zoneForScore(c.score),
      fullName: entry.fullName,
      help: entry.help,
      ...readout(id, c.score),
    };
  });

  const value = Math.round(latest.scores['stress'].value);
  const reference = latest.scoreReferences?.['stress'];
  return {
    date: new Date(`${latest.day}T12:00:00`),
    value,
    zone: zoneForScore(value),
    indexDeviation: reference?.deviation ?? null,
    indexRange: reference ? usualRange(reference.median, reference.spread) : null,
    signals,
    highShare: typeof share === 'number' ? share : null,
    byHour: latest.stressByHour?.length === 24 ? latest.stressByHour : Array<null>(24).fill(null),
    history: days.map((d) => d.scores['stress']?.value).filter((v): v is number => typeof v === 'number'),
    source: 'server',
  };
}
