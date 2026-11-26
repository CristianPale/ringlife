const WIDTH = 143;
const X_START = 2;
const X_END = 140;
const Y_TOP = 5;
const Y_BOTTOM = 22;

export interface Sparkline {
  points: string;
  lastX: number;
  lastY: number;
}

/** Punti di una polilinea 143 x 26 per una serie di valori. Il valore minimo sta in basso. */
export function sparkline(values: readonly number[]): Sparkline {
  if (values.length === 0) {
    return { points: '', lastX: X_END, lastY: Y_BOTTOM };
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const step = values.length > 1 ? (X_END - X_START) / (values.length - 1) : 0;
  const coords = values.map((value, index) => {
    const x = X_START + index * step;
    const y = max === min ? (Y_TOP + Y_BOTTOM) / 2 : Y_BOTTOM - ((value - min) / (max - min)) * (Y_BOTTOM - Y_TOP);
    return [round(x), round(y)] as const;
  });
  const last = coords[coords.length - 1];
  return {
    points: coords.map(([x, y]) => `${x},${y}`).join(' '),
    lastX: last[0],
    lastY: last[1],
  };
}

export const SPARKLINE_WIDTH = WIDTH;

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
