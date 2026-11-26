import { NormalBand, isOutside } from './andamento.model';

export const BAND_WIDTH = 340;
export const BAND_HEIGHT = 110;

const PAD_X = 8;
const PAD_Y = 10;

export interface BandPoint {
  x: number;
  y: number;
  outside: boolean;
}

export interface BandGeometry {
  points: BandPoint[];
  line: string;
  bandTop: number;
  bandBottom: number;
  medianY: number;
}

/** Scala verticale su misura: serie e fascia stanno sempre interamente nel grafico. */
export function bandGeometry(values: readonly number[], band: NormalBand): BandGeometry {
  const all = [...values, band.low, band.high];
  const min = Math.min(...all);
  const max = Math.max(...all);
  const span = max - min || 1;
  const plotHeight = BAND_HEIGHT - PAD_Y * 2;
  const y = (value: number) => round(PAD_Y + plotHeight * (1 - (value - min) / span));
  const plotWidth = BAND_WIDTH - PAD_X * 2;
  const step = values.length > 1 ? plotWidth / (values.length - 1) : 0;
  const points = values.map((value, index) => ({
    x: round(PAD_X + index * step),
    y: y(value),
    outside: isOutside(value, band),
  }));
  return {
    points,
    line: points.map((p) => `${p.x},${p.y}`).join(' '),
    bandTop: y(band.high),
    bandBottom: y(band.low),
    medianY: y(band.median),
  };
}

export const BAND_PLOT = { left: PAD_X, right: BAND_WIDTH - PAD_X };

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
