import { DayView } from '../api/api.model';
import { Direction, usualRange } from '../livella/livella';
import { zoneForScore } from '../oggi/zone';
import { GLOSSARY } from './glossary';
import { Contributor, ContributorId, RecuperoData } from './recupero.model';

interface ServerComponent {
  id: string;
  weight: number;
  score: number | null;
}

const CONTRIBUTOR_IDS: readonly ContributorId[] = ['hrv', 'hr-riposo', 'temperatura', 'sonno', 'stress'];

function isContributorId(id: string): id is ContributorId {
  return (CONTRIBUTOR_IDS as readonly string[]).includes(id);
}

/** Numero con la virgola decimale e segno opzionale: «+0,3». */
function decimal(value: number, signed = false): string {
  const text = (Math.round(value * 10) / 10).toFixed(1).replace('.', ',');
  return signed && value > 0 ? `+${text}` : text;
}

function components(day: DayView): ServerComponent[] {
  const raw = day.scores['recovery']?.components;
  return Array.isArray(raw) ? (raw as ServerComponent[]) : [];
}

/** Valore di oggi e riferimento alla tua media per un segnale, come testo. Vuoto se il server non li ha. */
function readout(id: ContributorId, day: DayView, score: number): { valueText: string; baselineText?: string } {
  const features = day.features ?? {};
  const references = day.references ?? {};
  switch (id) {
    case 'hrv': {
      const value = features['hrv_night'];
      const median = references['hrv_night']?.median;
      return {
        valueText: value === undefined ? '—' : `${Math.round(value)} ms`,
        baselineText: median === undefined ? undefined : `La tua media: ${Math.round(median)} ms`,
      };
    }
    case 'hr-riposo': {
      const value = features['resting_hr'];
      const median = references['resting_hr']?.median;
      return {
        valueText: value === undefined ? '—' : `${Math.round(value)} bpm`,
        baselineText: median === undefined ? undefined : `La tua media: ${Math.round(median)} bpm`,
      };
    }
    case 'temperatura': {
      const deviation = day.metrics['temp_deviation']?.value;
      return {
        valueText: typeof deviation === 'number' ? `${decimal(deviation, true)} °C` : '—',
        baselineText: 'Scostamento dalla tua media',
      };
    }
    default:
      return { valueText: `${score} su 100` };
  }
}

/**
 * Il dettaglio Recupero dai risultati del server. `days` va dal più vecchio al più recente.
 * Usa l'ultimo giorno che ha il Recupero. I segnali che il server non ha usato (dato mancante, o Stress, che non
 * calcola ancora) non compaiono, e i pesi dei rimasti si riscalano a 1 come fa il server nel punteggio.
 * Etichette e spiegazioni restano quelle di `base`. Senza un Recupero calcolato torna `null`.
 */
export function recuperoFromServer(base: RecuperoData, days: readonly DayView[]): RecuperoData | null {
  let latest: DayView | undefined;
  for (let i = days.length - 1; i >= 0 && !latest; i--) {
    if (days[i].scores['recovery']) {
      latest = days[i];
    }
  }
  if (!latest) {
    return null;
  }

  const references = latest.references ?? {};
  const previous = days[days.indexOf(latest) - 1];
  // Dove sta ogni segnale contro la tua media: le feature dalle loro baseline, Sonno e Stress dai loro indici.
  const standing: Record<ContributorId, { deviation: number | null; direction: Direction }> = {
    hrv: { deviation: references['hrv_night']?.deviation ?? null, direction: 'up' },
    'hr-riposo': { deviation: references['resting_hr']?.deviation ?? null, direction: 'down' },
    temperatura: { deviation: references['temp_night']?.deviation ?? null, direction: 'neutral' },
    sonno: { deviation: latest.scoreReferences?.['sleep']?.deviation ?? null, direction: 'up' },
    stress: { deviation: previous?.scoreReferences?.['stress']?.deviation ?? null, direction: 'up' },
  };

  const used = components(latest).filter((c): c is ServerComponent & { score: number } => typeof c.score === 'number' && isContributorId(c.id));
  const totalWeight = used.reduce((sum, c) => sum + c.weight, 0);
  const contributors: Contributor[] = used.map((c) => {
    const id = c.id as ContributorId;
    const template = base.contributors.find((b) => b.id === id);
    const entry = GLOSSARY[id];
    const { valueText, baselineText } = readout(id, latest, c.score);
    return {
      id,
      label: template?.label ?? id,
      weight: totalWeight > 0 ? c.weight / totalWeight : c.weight,
      score: c.score,
      zone: zoneForScore(c.score),
      fullName: 'fullName' in entry ? entry.fullName : undefined,
      help: entry.help,
      valueText,
      baselineText,
      ...standing[id],
    };
  });

  const indexReference = latest.scoreReferences?.['recovery'];
  const value = Math.round(latest.scores['recovery'].value);
  return {
    date: new Date(`${latest.day}T08:00:00`),
    deviations: {
      rhr: references['resting_hr']?.deviation ?? null,
      hrv: references['hrv_night']?.deviation ?? null,
      temp: references['temp_night']?.deviation ?? null,
    },
    value,
    zone: zoneForScore(value),
    indexDeviation: indexReference?.deviation ?? null,
    indexRange: indexReference ? usualRange(indexReference.median, indexReference.spread) : null,
    contributors,
    history: days.map((d) => d.scores['recovery']?.value).filter((v): v is number => typeof v === 'number'),
    source: 'server',
  };
}
