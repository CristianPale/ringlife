import { zoneForScore } from '../oggi/zone';
import { GLOSSARY } from '../indici/glossary';
import {
  NightMidpoint,
  SLEEP_WEIGHTS,
  SleepSignalId,
  SleepStage,
  SonnoData,
  asleepMinutes,
  awakeningCount,
  efficiency,
  expandSegments,
  formatHoursMinutes,
  regularity,
  sleepScore,
  totalsByStage,
} from './sonno.model';
import { bodyRows, stageRows } from './sonno.rows';

/** Notte SINTETICA: a letto alle 23:40, in piedi alle 06:17 (6 h 37), 5 h 52 di sonno. */
const PARTS: readonly (readonly [SleepStage, number])[] = [
  ['awake', 14],
  ['light', 22],
  ['deep', 24],
  ['light', 18],
  ['rem', 10],
  ['light', 26],
  ['deep', 18],
  ['light', 16],
  ['awake', 9],
  ['light', 20],
  ['rem', 14],
  ['light', 28],
  ['awake', 12],
  ['light', 24],
  ['rem', 16],
  ['light', 22],
  ['awake', 10],
  ['light', 30],
  ['rem', 22],
  ['light', 42],
];

const segments = expandSegments(PARTS);

/** Ultime 7 notti, dal mercoledì al martedì di oggi. I risvegli del sabato e della domenica sono il fine settimana. */
const NIGHTS: readonly NightMidpoint[] = [
  { midpointMin: 190, weekend: false },
  { midpointMin: 180, weekend: false },
  { midpointMin: 200, weekend: false },
  { midpointMin: 250, weekend: true },
  { midpointMin: 265, weekend: true },
  { midpointMin: 185, weekend: false },
  { midpointMin: 150, weekend: false },
];

const regularityResult = regularity(NIGHTS) ?? { score: 0, variationMin: 0, weekendGapMin: null };

function historySeries(days: number, last: number): number[] {
  let state = 11;
  const earlier: number[] = [];
  for (let i = 0; i < days - 1; i++) {
    state = (state * 1103515245 + 12345) % 2147483648;
    const noise = (state / 2147483648 - 0.5) * 30;
    earlier.push(Math.round(Math.max(25, Math.min(95, 62 + Math.sin(i / 6) * 8 + noise))));
  }
  return [...earlier, last];
}

function entry(id: SleepSignalId, label: string, score: number, valueText: string, baselineText?: string) {
  const glossary: { fullName?: string; help: string } = GLOSSARY[id];
  return {
    id,
    label,
    weight: SLEEP_WEIGHTS[id],
    score,
    zone: zoneForScore(score),
    fullName: glossary.fullName,
    help: glossary.help,
    valueText,
    baselineText,
  };
}

const totals = totalsByStage(segments);
const asleep = asleepMinutes(segments);
const bedMin = asleep + totals.awake;

const signals = [
  entry('sleep-duration', 'Durata', 55, formatHoursMinutes(asleep), 'Il tuo obiettivo: 8 h 00'),
  entry('sleep-efficiency', 'Efficienza', 80, `${Math.round(efficiency(segments) * 100)}%`),
  entry('sleep-deep', 'Profondo', 65, formatHoursMinutes(totals.deep), `${Math.round((totals.deep / asleep) * 100)}% del sonno`),
  entry('sleep-rem', 'REM', 55, formatHoursMinutes(totals.rem), `${Math.round((totals.rem / asleep) * 100)}% del sonno`),
  entry('sleep-awakenings', 'Risvegli', 70, `${awakeningCount(segments)} · ${totals.awake} min svegli`),
  entry('sleep-regularity', 'Regolarità', regularityResult.score, `${regularityResult.score} su 100`),
  entry('sleep-min-hr', 'Battito minimo', 70, '49 bpm', 'La tua media: 51 bpm'),
] as const;

const sampleAwakenings = awakeningCount(segments);

export const SONNO_SAMPLE: SonnoData = {
  wakeDate: new Date('2026-11-03T08:00:00+01:00'),
  segments,
  bedTime: '23:40',
  wakeTime: '06:17',
  value: sleepScore(signals),
  indexDeviation: -1.7,
  indexRange: { low: 68, high: 80 },
  stageRows: stageRows(segments, sampleAwakenings, { deep: -2.0, rem: -0.5, light: 0.7, awake: 1.0 }),
  bodyRows: bodyRows({ minHr: 49, hrv: 38, tempDeviation: 0.2, spo2: 96 }, { minHr: 0.6, hrv: -1.8, temp: 0.8, spo2: -0.4 }),
  nights: [
    ['mer', 495],
    ['gio', 527],
    ['ven', 454],
    ['sab', 500],
    ['dom', 540],
    ['lun', 467],
    ['mar', asleep],
  ].map(([label, minutes]) => ({ label: label as string, minutes: minutes as number })),
  signals,
  regularity: regularityResult,
  regularityHistory: historySeries(90, regularityResult.score),
  debtMin: 250,
  source: 'esempio',
};

export const SONNO_BED_MINUTES = bedMin;
