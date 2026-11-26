import { SignalRow } from '../shared/signal-row.component';
import { zoneForScore } from '../oggi/zone';
import { ACTIVE_HOUR_STEPS, activeHours } from '../andamento/andamento.model';

export type MovementSignalId = 'move-steps' | 'move-active-hours' | 'move-hr-minutes' | 'move-sedentary';

/** Pesi iniziali del Movement Index (docs/scores.md, algo_version v1). Devono sommare a 1. */
export const MOVEMENT_WEIGHTS: Record<MovementSignalId, number> = {
  'move-steps': 0.4,
  'move-active-hours': 0.3,
  'move-hr-minutes': 0.2,
  'move-sedentary': 0.1,
};

/** Ore attive che valgono il punteggio pieno. Valore iniziale, da tarare. */
export const ACTIVE_HOURS_TARGET = 10;
/** Minuti con il battito in zona moderata o alta che valgono il punteggio pieno. Valore iniziale, da tarare. */
export const HR_MINUTES_TARGET = 30;
/** Ore della giornata in cui l'inattività conta: dalle 07:00 alle 23:00. */
export const WAKING_FROM = 7;
export const WAKING_TO = 23;
/** Una pausa è «lunga» da 2 ore senza passi sufficienti. */
export const LONG_STRETCH_HOURS = 2;
/** Punti persi per ogni ora passata in una pausa lunga. Due pause di 2 ore tolgono 50 punti. */
export const STRETCH_PENALTY_PER_HOUR = 12.5;

const clampScore = (value: number) => Math.round(Math.max(0, Math.min(100, value)));

export function stepsScore(steps: number, goal: number): number {
  return goal <= 0 ? 0 : clampScore((steps / goal) * 100);
}

export function activeHoursScore(hours: number): number {
  return clampScore((hours / ACTIVE_HOURS_TARGET) * 100);
}

export function hrMinutesScore(minutes: number): number {
  return clampScore((minutes / HR_MINUTES_TARGET) * 100);
}

export interface SedentaryStretch {
  /** Prima ora della pausa. */
  from: number;
  /** Ora in cui finisce (esclusa). */
  to: number;
}

/**
 * Pause lunghe: almeno 2 ore di fila, tra le 07:00 e le 23:00, con meno di 250 passi all'ora.
 * Una pausa che arriva fino alle 23:00 si ferma lì.
 */
export function sedentaryStretches(stepsByHour: readonly number[]): SedentaryStretch[] {
  const stretches: SedentaryStretch[] = [];
  let start: number | null = null;
  for (let hour = WAKING_FROM; hour <= WAKING_TO; hour++) {
    const idle = hour < WAKING_TO && (stepsByHour[hour] ?? 0) < ACTIVE_HOUR_STEPS;
    if (idle && start === null) {
      start = hour;
    } else if (!idle && start !== null) {
      if (hour - start >= LONG_STRETCH_HOURS) {
        stretches.push({ from: start, to: hour });
      }
      start = null;
    }
  }
  return stretches;
}

/** Più lunga è la pausa, più pesa: una giornata intera ferma dà 0, non solo un tratto di penalità. */
export function sedentaryScore(stretches: readonly SedentaryStretch[]): number {
  const hours = stretches.reduce((sum, s) => sum + (s.to - s.from), 0);
  return clampScore(100 - STRETCH_PENALTY_PER_HOUR * hours);
}

export function movementScore(signals: readonly Pick<SignalRow, 'weight' | 'score'>[]): number {
  return Math.round(signals.reduce((sum, s) => sum + s.weight * s.score, 0));
}

export interface MovementDayInput {
  steps: number;
  stepsGoal: number;
  stepsByHour: readonly number[];
  /** Minuti con il battito in zona moderata o alta. */
  hrMinutes: number;
}

export interface MovementDay {
  value: number;
  signals: (SignalRow & { id: MovementSignalId })[];
  stretches: SedentaryStretch[];
}

/** «15:00–17:00»: l'intervallo di una pausa lunga. */
export function formatStretch(stretch: SedentaryStretch): string {
  const pad = (h: number) => `${String(h).padStart(2, '0')}:00`;
  return `${pad(stretch.from)}–${pad(stretch.to)}`;
}

export function evaluateMovementDay(
  input: MovementDayInput,
  help: Record<MovementSignalId, { help: string; fullName?: string }>,
  formatThousands: (n: number) => string,
): MovementDay {
  const hours = activeHours(input.stepsByHour);
  const stretches = sedentaryStretches(input.stepsByHour);
  const row = (
    id: MovementSignalId,
    label: string,
    score: number,
    valueText: string,
    baselineText?: string,
  ): SignalRow & { id: MovementSignalId } => ({
    id,
    label,
    weight: MOVEMENT_WEIGHTS[id],
    score,
    zone: zoneForScore(score),
    fullName: help[id].fullName,
    help: help[id].help,
    valueText,
    baselineText,
  });
  const signals = [
    row(
      'move-steps',
      'Passi',
      stepsScore(input.steps, input.stepsGoal),
      formatThousands(input.steps),
      `Il tuo obiettivo: ${formatThousands(input.stepsGoal)}`,
    ),
    row(
      'move-active-hours',
      'Ore attive',
      activeHoursScore(hours),
      `${hours} su 24`,
      `Punteggio pieno da ${ACTIVE_HOURS_TARGET} ore`,
    ),
    row(
      'move-hr-minutes',
      'Minuti di sforzo',
      hrMinutesScore(input.hrMinutes),
      `${input.hrMinutes} min`,
      `Punteggio pieno da ${HR_MINUTES_TARGET} min`,
    ),
    row(
      'move-sedentary',
      'Pause lunghe',
      sedentaryScore(stretches),
      stretches.length === 0 ? 'Nessuna' : String(stretches.length),
      stretches.length === 0 ? undefined : stretches.map(formatStretch).join(' e '),
    ),
  ];
  return { value: movementScore(signals), signals, stretches };
}
