import { DayView } from '../api/api.model';
import { GLOSSARY } from '../indici/glossary';
import { usualRange } from '../livella/livella';
import { zoneForScore } from '../oggi/zone';
import {
  RegularityResult,
  SLEEP_WEIGHTS,
  SleepSegment,
  SleepSignalId,
  SonnoData,
  asleepMinutes,
  efficiency,
  NightSleep,
  formatHoursMinutes,
  totalsByStage,
} from './sonno.model';
import { bodyRows, stageRows } from './sonno.rows';

interface ServerComponent {
  id: string;
  weight: number;
  score: number | null;
}

const MIN_MS = 60_000;

function isSignalId(id: string): id is SleepSignalId {
  return id in SLEEP_WEIGHTS;
}

function clock(ms: number): string {
  return new Intl.DateTimeFormat('it-IT', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome' }).format(ms);
}

function lastWith(days: readonly DayView[], has: (day: DayView) => unknown): DayView | undefined {
  for (let i = days.length - 1; i >= 0; i--) {
    if (has(days[i])) {
      return days[i];
    }
  }
  return undefined;
}

/** Le fasi del server in tratti con inizio in minuti dall'andare a letto. Un buco tra due fasi si conta come veglia. */
export function segmentsFrom(sleep: NonNullable<DayView['sleep']>): SleepSegment[] {
  const segments: SleepSegment[] = [];
  let cursor = sleep.start;
  for (const stage of sleep.stages) {
    if (stage.start > cursor) {
      segments.push({ stage: 'awake', startMin: Math.round((cursor - sleep.start) / MIN_MS), durationMin: Math.round((stage.start - cursor) / MIN_MS) });
    }
    segments.push({
      stage: stage.stage,
      startMin: Math.round((stage.start - sleep.start) / MIN_MS),
      durationMin: Math.round((stage.end - stage.start) / MIN_MS),
    });
    cursor = Math.max(cursor, stage.end);
  }
  return segments.filter((s) => s.durationMin > 0);
}

/** Le ultime 7 notti fino a quella mostrata, per le barre del debito. */
function nightsFrom(days: readonly DayView[], latest: DayView): NightSleep[] {
  const end = days.indexOf(latest) + 1;
  return days.slice(Math.max(0, end - 7), end).map((d) => ({
    label: new Intl.DateTimeFormat('it-IT', { weekday: 'short', timeZone: 'Europe/Rome' })
      .format(new Date(`${d.day}T12:00:00Z`))
      .replace('.', ''),
    minutes: typeof d.features?.['sleep_asleep_min'] === 'number' ? Math.round(d.features['sleep_asleep_min']) : null,
  }));
}

function regularityFrom(day: DayView | undefined): RegularityResult | null {
  const score = day?.scores['sleep_regularity'];
  if (!score) {
    return null;
  }
  const detail = (score.components ?? {}) as { variationMin?: number; weekendGapMin?: number | null };
  return {
    score: Math.round(score.value),
    variationMin: Math.round(detail.variationMin ?? 0),
    weekendGapMin: typeof detail.weekendGapMin === 'number' ? Math.round(detail.weekendGapMin) : null,
  };
}

/**
 * Il dettaglio Sonno dai risultati del server. `days` va dal più vecchio al più recente.
 * Usa l'ultimo giorno con un indice Sonno e le sue fasi. Senza fasi non c'è ipnogramma e torna `null`.
 * Come per il Recupero, i segnali che il server non ha usato non compaiono e i pesi si riscalano a 1.
 */
export function sonnoFromServer(base: SonnoData, days: readonly DayView[]): SonnoData | null {
  const latest = lastWith(days, (d) => d.scores['sleep'] && d.sleep && d.sleep.stages.length > 0);
  if (!latest || !latest.sleep) {
    return null;
  }
  const segments = segmentsFrom(latest.sleep);
  const totals = totalsByStage(segments);
  const asleep = asleepMinutes(segments);
  const features = latest.features ?? {};
  const references = latest.references ?? {};
  const regularity = regularityFrom(latest) ?? base.regularity;

  const raw = latest.scores['sleep'].components;
  const used = (Array.isArray(raw) ? (raw as ServerComponent[]) : []).filter(
    (c): c is ServerComponent & { score: number } => typeof c.score === 'number' && isSignalId(c.id),
  );
  const totalWeight = used.reduce((sum, c) => sum + c.weight, 0);

  const readout = (id: SleepSignalId): { valueText: string; baselineText?: string } => {
    const share = (minutes: number) => (asleep > 0 ? `${Math.round((minutes / asleep) * 100)}% del sonno` : undefined);
    switch (id) {
      case 'sleep-duration':
        return { valueText: formatHoursMinutes(asleep) };
      case 'sleep-efficiency':
        return { valueText: `${Math.round(efficiency(segments) * 100)}%` };
      case 'sleep-deep':
        return { valueText: formatHoursMinutes(totals.deep), baselineText: share(totals.deep) };
      case 'sleep-rem':
        return { valueText: formatHoursMinutes(totals.rem), baselineText: share(totals.rem) };
      case 'sleep-awakenings':
        return { valueText: `${Math.round(features['sleep_awakenings'] ?? 0)} · ${totals.awake} min svegli` };
      case 'sleep-regularity':
        return { valueText: `${regularity.score} su 100` };
      default: {
        const value = features['min_hr'];
        const median = references['min_hr']?.median;
        return {
          valueText: value === undefined ? '—' : `${Math.round(value)} bpm`,
          baselineText: median === undefined ? undefined : `La tua media: ${Math.round(median)} bpm`,
        };
      }
    }
  };

  const signals = used.map((c) => {
    const id = c.id as SleepSignalId;
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
      ...readout(id),
    };
  });

  const debt = lastWith(days, (d) => d.metrics['sleep_debt'])?.metrics['sleep_debt']?.value;
  const dev = (key: string) => references[key]?.deviation ?? null;
  const indexReference = latest.scoreReferences?.['sleep'];
  const tempDeviation = latest.metrics['temp_deviation']?.value;
  return {
    wakeDate: new Date(`${latest.day}T08:00:00`),
    segments,
    bedTime: clock(latest.sleep.start),
    wakeTime: clock(latest.sleep.end),
    value: Math.round(latest.scores['sleep'].value),
    indexDeviation: indexReference?.deviation ?? null,
    indexRange: indexReference ? usualRange(indexReference.median, indexReference.spread) : null,
    stageRows: stageRows(segments, Math.round(features['sleep_awakenings'] ?? 0), {
      deep: dev('sleep_deep_min'),
      rem: dev('sleep_rem_min'),
      light: dev('sleep_light_min'),
      awake: dev('sleep_awake_min'),
    }),
    bodyRows: bodyRows(
      {
        minHr: features['min_hr'],
        hrv: features['hrv_night'],
        tempDeviation: typeof tempDeviation === 'number' ? tempDeviation : undefined,
        tempNight: features['temp_night'],
        spo2: features['spo2_median'],
      },
      { minHr: dev('min_hr'), hrv: dev('hrv_night'), temp: dev('temp_night'), spo2: dev('spo2_median') },
    ),
    nights: nightsFrom(days, latest),
    signals,
    regularity,
    regularityHistory: days.map((d) => d.scores['sleep_regularity']?.value).filter((v): v is number => typeof v === 'number'),
    debtMin: typeof debt === 'number' ? Math.round(debt * 60) : 0,
    source: 'server',
  };
}
