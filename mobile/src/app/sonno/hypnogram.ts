import { SleepSegment, SleepStage, inBedMinutes } from './sonno.model';

export const HYPNOGRAM_WIDTH = 340;
export const HYPNOGRAM_HEIGHT = 140;

const PLOT_LEFT = 74;
const PLOT_RIGHT = 336;
const ROW_HEIGHT = 26;
const ROW_GAP = 8;
const PLOT_TOP = 2;

/** Dall'alto al basso: veglia, REM, leggero, profondo (come nelle app di sonno più diffuse). */
export const STAGE_ROWS: readonly SleepStage[] = ['awake', 'rem', 'light', 'deep'];

export interface HypnogramBlock {
  stage: SleepStage;
  x: number;
  y: number;
  width: number;
  height: number;
}

export function rowY(stage: SleepStage): number {
  return PLOT_TOP + STAGE_ROWS.indexOf(stage) * (ROW_HEIGHT + ROW_GAP);
}

export function hypnogramBlocks(segments: readonly SleepSegment[]): HypnogramBlock[] {
  const bed = inBedMinutes(segments);
  if (bed === 0) {
    return [];
  }
  const plot = PLOT_RIGHT - PLOT_LEFT;
  return segments.map((segment) => ({
    stage: segment.stage,
    x: round(PLOT_LEFT + (segment.startMin / bed) * plot),
    y: rowY(segment.stage),
    // Larghezza minima di 1,5 px: anche un risveglio di pochi minuti deve restare visibile.
    width: Math.max(1.5, round((segment.durationMin / bed) * plot)),
    height: ROW_HEIGHT,
  }));
}

export const HYPNOGRAM_PLOT = { left: PLOT_LEFT, right: PLOT_RIGHT, rowHeight: ROW_HEIGHT };

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
