import {
  Contributor,
  ContributorId,
  RECOVERY_WEIGHTS,
  RecuperoData,
  recoveryScore,
  scoreFromDeviation,
} from './recupero.model';
import { Direction } from '../livella/livella';
import { zoneForScore } from '../oggi/zone';
import { GLOSSARY, GlossaryEntry } from './glossary';

function contributor(
  id: ContributorId,
  label: string,
  score: number,
  valueText: string,
  baselineText: string | undefined,
  deviation: number,
  direction: Direction,
): Contributor {
  const entry: GlossaryEntry = GLOSSARY[id];
  return {
    id,
    label,
    weight: RECOVERY_WEIGHTS[id],
    score,
    zone: zoneForScore(score),
    fullName: entry.fullName,
    help: entry.help,
    valueText,
    baselineText,
    deviation,
    direction,
  };
}

/** Ultimi 7 giorni: gli stessi della tile di Oggi. */
const LAST_WEEK = [78, 82, 76, 72, 80, 69, 64];

/** Serie sintetica ripetibile (stesso valore a ogni avvio) per i 90 giorni. */
function syntheticHistory(days: number): number[] {
  let state = 7;
  const earlier: number[] = [];
  for (let i = 0; i < days - LAST_WEEK.length; i++) {
    state = (state * 1103515245 + 12345) % 2147483648;
    const noise = (state / 2147483648 - 0.5) * 26;
    const wave = Math.sin(i / 5) * 6;
    earlier.push(Math.round(Math.max(35, Math.min(95, 74 + wave + noise))));
  }
  return [...earlier, ...LAST_WEEK];
}

/**
 * Dati SINTETICI del dettaglio Recupero. Gli scostamenti sono quelli che il backend calcolerà
 * con mediana e MAD (docs/scores.md): HRV 43 ms contro 52 ms è -1,5 volte la scala della tua
 * variabilità, quindi il sotto-punteggio è 75 - 1,5 × 12,5 ≈ 56.
 */
const HRV_DEVIATION = -1.5;
const RHR_DEVIATION = 0.8;
const TEMP_DEVIATION = 0;

const contributors: readonly Contributor[] = [
  contributor('hrv', 'HRV', scoreFromDeviation(HRV_DEVIATION), '43 ms', 'La tua media: 52 ms', HRV_DEVIATION, 'up'),
  // Un battito più alto del solito è peggio: nello score lo scostamento si inverte.
  contributor('hr-riposo', 'Battito a riposo', scoreFromDeviation(-RHR_DEVIATION), '56 bpm', 'La tua media: 54 bpm', RHR_DEVIATION, 'down'),
  contributor('temperatura', 'Temperatura', scoreFromDeviation(-TEMP_DEVIATION), '+0,0 °C', 'Scostamento dalla tua media', TEMP_DEVIATION, 'neutral'),
  contributor('sonno', 'Sonno', 62, '62 su 100', undefined, -1.7, 'up'),
  contributor('stress', 'Stress di ieri', 74, '74 su 100', undefined, 0.2, 'up'),
];

const value = recoveryScore(contributors);

export const RECUPERO_SAMPLE: RecuperoData = {
  date: new Date('2026-11-03T08:00:00+01:00'),
  deviations: { rhr: RHR_DEVIATION, hrv: HRV_DEVIATION, temp: TEMP_DEVIATION },
  value,
  zone: zoneForScore(value),
  indexDeviation: -1.9,
  indexRange: { low: 66, high: 82 },
  contributors,
  history: syntheticHistory(90),
  source: 'esempio',
};
