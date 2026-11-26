import { zoneForScore } from '../oggi/zone';
import { GLOSSARY } from './glossary';
import { STRESS_WEIGHTS, StressData, StressSignalId } from './stress.model';

function signal(id: StressSignalId, label: string, score: number, valueText: string, baselineText?: string) {
  const entry: { fullName?: string; help: string } = GLOSSARY[id];
  return {
    id,
    label,
    weight: STRESS_WEIGHTS[id],
    score,
    zone: zoneForScore(score),
    fullName: entry.fullName,
    help: entry.help,
    valueText,
    baselineText,
  };
}

/** Andamento SINTETICO ripetibile (stesso valore a ogni avvio): gli ultimi sette sono quelli della tile di Oggi. */
function history(days: number): number[] {
  const last = [70, 72, 68, 76, 71, 73, 74];
  let state = 13;
  const earlier: number[] = [];
  for (let i = 0; i < days - last.length; i++) {
    state = (state * 1103515245 + 12345) % 2147483648;
    const noise = (state / 2147483648 - 0.5) * 24;
    earlier.push(Math.round(Math.max(40, Math.min(95, 72 + Math.sin(i / 6) * 5 + noise))));
  }
  return [...earlier, ...last];
}

/** Dati SINTETICI del dettaglio Stress: 80 per il carico e 60 per la sera danno 0,7 × 80 + 0,3 × 60 = 74. */
export const STRESS_SAMPLE: StressData = {
  date: new Date('2026-11-02T12:00:00+01:00'),
  value: 74,
  zone: zoneForScore(74),
  indexDeviation: 0.2,
  indexRange: { low: 66, high: 80 },
  signals: [
    signal('stress-load', 'Tempo in stress alto', 80, '10% del tempo'),
    signal('stress-evening', 'Recupero serale', 60, 'giorno 42 · sera 38', 'Più basso la sera è meglio'),
  ],
  highShare: 0.1,
  byHour: [
    ...Array<null>(7).fill(null),
    36, 40, 44, 62, 48, 41, 38, 43, 66, 45, 40, 37, 34, 32, 30, 28,
    null,
  ],
  history: history(90),
  source: 'esempio',
};
