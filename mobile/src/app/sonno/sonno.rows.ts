import { Direction } from '../livella/livella';
import { durationReading, measureWords, signedDegrees } from '../livella/measure';
import { MeasureRowData } from '../shared/measure-row.component';
import { SleepSegment, totalsByStage } from './sonno.model';

/** Scostamento dalla tua media di ogni misura, da −3 a 3. `null` o assente: senza media. */
export type Deviations = Partial<Record<'deep' | 'rem' | 'light' | 'awake' | 'restingHr' | 'minHr' | 'hrv' | 'temp' | 'spo2', number | null>>;

const LESS_OR_MORE = { below: 'Meno del solito', above: 'Più del solito' };
const LOWER_OR_HIGHER = { below: 'Più bassa del solito', above: 'Più alta del solito' };

function row(
  id: string,
  label: string,
  deviation: number | null | undefined,
  direction: Direction,
  descriptor: string,
  wording: { below: string; above: string },
  reading: { value: string; unit: string },
): MeasureRowData {
  const dev = deviation ?? null;
  return { id, label, deviation: dev, direction, ...measureWords(dev, direction, descriptor, wording), ...reading };
}

/** Le quattro fasi della notte contro il tuo solito. Più profondo e più REM sono meglio, più veglia è peggio. */
export function stageRows(segments: readonly SleepSegment[], awakenings: number, deviations: Deviations): MeasureRowData[] {
  const totals = totalsByStage(segments);
  return [
    row('deep', 'Profondo', deviations.deep, 'up', 'Come al solito', LESS_OR_MORE, durationReading(totals.deep)),
    row('rem', 'REM', deviations.rem, 'up', 'Come al solito', LESS_OR_MORE, durationReading(totals.rem)),
    row('light', 'Leggero', deviations.light, 'neutral', 'Come al solito', LESS_OR_MORE, durationReading(totals.light)),
    row(
      'awake',
      'Sveglio',
      deviations.awake,
      'down',
      awakenings === 1 ? '1 risveglio' : `${awakenings} risvegli`,
      LESS_OR_MORE,
      durationReading(totals.awake),
    ),
  ];
}

export interface BodyReadings {
  /** Battito a riposo della notte (mediana). Si mostra in Oggi; Sonno usa il minimo. */
  restingHr?: number;
  minHr?: number;
  hrv?: number;
  /** Scostamento notturno dalla tua media, in gradi. */
  tempDeviation?: number;
  /** Temperatura notturna del dito, in gradi: si mostra solo finché lo scostamento non c'è (calibrazione). */
  tempNight?: number;
  spo2?: number;
}

/** Le misure del corpo di stanotte. Una misura che l'anello non ha dato non compare. */
export function bodyRows(readings: BodyReadings, deviations: Deviations): MeasureRowData[] {
  const rows: MeasureRowData[] = [];
  if (readings.restingHr !== undefined) {
    rows.push(
      row('resting-hr', 'Battito a riposo', deviations.restingHr, 'down', 'Mediana della notte', { below: 'Più basso del solito', above: 'Più alto del solito' }, {
        value: String(Math.round(readings.restingHr)),
        unit: 'battiti al minuto',
      }),
    );
  }
  if (readings.minHr !== undefined) {
    rows.push(
      row('min-hr', 'Battito minimo', deviations.minHr, 'down', 'Il più basso della notte', { below: 'Più basso del solito', above: 'Più alto del solito' }, {
        value: String(Math.round(readings.minHr)),
        unit: 'battiti al minuto',
      }),
    );
  }
  if (readings.hrv !== undefined) {
    rows.push(
      row('hrv', 'Variabilità del battito (HRV)', deviations.hrv, 'up', 'Come al solito', LOWER_OR_HIGHER, {
        value: String(Math.round(readings.hrv)),
        unit: 'millisecondi',
      }),
    );
  }
  if (readings.tempDeviation !== undefined) {
    rows.push(
      row('temp', 'Temperatura', deviations.temp, 'neutral', 'Rispetto alla tua media', LOWER_OR_HIGHER, {
        value: signedDegrees(readings.tempDeviation),
        unit: 'gradi',
      }),
    );
  }
  if (readings.tempDeviation === undefined && readings.tempNight !== undefined) {
    rows.push({
      id: 'temp',
      label: 'Temperatura',
      sub: 'Del dito: conta lo scostamento dalla tua media, dal 7º giorno',
      tone: null,
      deviation: null,
      direction: 'neutral',
      value: readings.tempNight.toFixed(1).replace('.', ','),
      unit: 'gradi',
    });
  }
  if (readings.spo2 !== undefined) {
    rows.push(
      row('spo2', 'Ossigeno nel sangue (SpO2)', deviations.spo2, 'up', 'Media della notte', LOWER_OR_HIGHER, {
        value: String(Math.round(readings.spo2)),
        unit: 'per cento',
      }),
    );
  }
  return rows;
}

/** La frase d'apertura: quanto, da quando a quando, e la fase che si scosta di più dal tuo solito. */
export function nightSentence(
  asleepText: string,
  bedTime: string,
  wakeTime: string,
  stages: readonly MeasureRowData[],
): { text: string; tone?: 'peggio' | 'meglio' }[] {
  const lead = { text: `${asleepText} di sonno, dalle ${bedTime} alle ${wakeTime}. ` };
  if (stages.every((s) => s.deviation === null)) {
    return [{ text: lead.text.trimEnd() }];
  }
  // Solo profondo e REM: sono le fasi che dicono qualcosa sul recupero.
  const candidates = stages.filter((s) => (s.id === 'deep' || s.id === 'rem') && s.deviation !== null && Math.abs(s.deviation) > 1.5);
  if (candidates.length === 0) {
    return [lead, { text: 'Le fasi sono nel tuo solito.' }];
  }
  const worst = candidates.reduce((a, b) => (Math.abs(b.deviation!) > Math.abs(a.deviation!) ? b : a));
  const name = worst.id === 'deep' ? 'profondo' : 'REM';
  return [
    lead,
    { text: `Il sonno ${name} è ` },
    { text: worst.deviation! < 0 ? 'sotto il tuo solito' : 'sopra il tuo solito', tone: worst.tone ?? undefined },
    { text: '.' },
  ];
}
