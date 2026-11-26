export const CHART_WIDTH = 340;
export const CHART_HEIGHT = 150;

const PAD_LEFT = 28;
const PAD_RIGHT = 8;
const PAD_TOP = 10;
const PAD_BOTTOM = 10;

export interface ChartPoint {
  x: number;
  y: number;
}

/** Posizione verticale di un valore 0-100: 100 in alto, 0 in basso. */
export function yFor(value: number): number {
  const clamped = Math.max(0, Math.min(100, value));
  const plot = CHART_HEIGHT - PAD_TOP - PAD_BOTTOM;
  return round(PAD_TOP + plot * (1 - clamped / 100));
}

/** Punti di una serie, distribuiti sull'intera larghezza del grafico. */
export function chartPoints(values: readonly number[]): ChartPoint[] {
  const plot = CHART_WIDTH - PAD_LEFT - PAD_RIGHT;
  const step = values.length > 1 ? plot / (values.length - 1) : 0;
  return values.map((value, index) => ({ x: round(PAD_LEFT + index * step), y: yFor(value) }));
}

export function polyline(points: readonly ChartPoint[]): string {
  return points.map((p) => `${p.x},${p.y}`).join(' ');
}

/** Stessa linea chiusa sul fondo del grafico, per l'area sotto la curva. */
export function areaPath(points: readonly ChartPoint[]): string {
  if (points.length === 0) {
    return '';
  }
  const bottom = CHART_HEIGHT - PAD_BOTTOM;
  const first = points[0];
  const last = points[points.length - 1];
  return `M${first.x},${bottom} L${polyline(points).replaceAll(' ', ' L')} L${last.x},${bottom} Z`;
}

export interface SeriesStats {
  min: number;
  max: number;
  average: number;
}

export function seriesStats(values: readonly number[]): SeriesStats {
  const total = values.reduce((sum, v) => sum + v, 0);
  return {
    min: Math.min(...values),
    max: Math.max(...values),
    average: Math.round(total / values.length),
  };
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
