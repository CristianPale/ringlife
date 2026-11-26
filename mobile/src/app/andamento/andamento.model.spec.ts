import {
  activeHours,
  average,
  comparePeriods,
  compareTotals,
  formatSignedTemperature,
  isOutside,
  median,
  normalBand,
} from './andamento.model';
import { bandGeometry } from './band-chart';
import { ANDAMENTO_SAMPLE } from './andamento.sample';

describe('andamento model', () => {
  it('computes median and average', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBeNaN();
    expect(average([2, 4])).toBe(3);
  });

  it('builds the normal band around the median, scaled MAD, over the last 28 days', () => {
    const flat = normalBand(Array(40).fill(50));
    expect(flat).toEqual({ median: 50, low: 50, high: 50 });

    const values = [...Array(30).fill(0), ...[40, 50, 60, 50, 40, 60, 50]];
    const band = normalBand(values);
    expect(band.median).toBe(0);
    // Gli ultimi 28 giorni contengono 21 zeri e 7 valori alti: la mediana è 0, la MAD è 0.
    expect(band.high).toBe(0);
  });

  it('puts about one day in eight outside the band on noisy data', () => {
    const values = ANDAMENTO_SAMPLE.hrv.slice(-90);
    const band = normalBand(ANDAMENTO_SAMPLE.hrv);
    const outside = values.filter((v) => isOutside(v, band)).length;
    expect(outside).toBeGreaterThan(2);
    expect(outside).toBeLessThan(values.length * 0.35);
  });

  it('flags values outside the band, not on its edge', () => {
    const band = { median: 50, low: 45, high: 55 };
    expect(isOutside(45, band)).toBe(false);
    expect(isOutside(55, band)).toBe(false);
    expect(isOutside(44.9, band)).toBe(true);
    expect(isOutside(55.1, band)).toBe(true);
  });

  it('compares the last period with the one before', () => {
    const series = [1, 1, 1, 1, 1, 1, 1, 3, 3, 3, 3, 3, 3, 3];
    expect(comparePeriods(series, 7)).toEqual({ current: 3, previous: 1, delta: 2 });
  });

  it('cannot compare without enough history', () => {
    expect(comparePeriods([1, 2, 3], 7)).toBeNull();
    expect(compareTotals([1, 0, 1], 7)).toBeNull();
  });

  it('totals episodes in each period', () => {
    const series = [1, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0];
    expect(compareTotals(series, 7)).toEqual({ current: 1, previous: 2 });
  });

  it('counts active hours at 250 steps or more', () => {
    expect(activeHours([0, 249, 250, 251, 1000])).toBe(3);
    expect(activeHours(ANDAMENTO_SAMPLE.stepsYesterdayByHour)).toBe(11);
  });

  it('formats a signed temperature deviation', () => {
    expect(formatSignedTemperature(0.2)).toBe('+0,2 °C');
    expect(formatSignedTemperature(-0.3)).toBe('-0,3 °C');
    expect(formatSignedTemperature(0)).toBe('0,0 °C');
    expect(formatSignedTemperature(0.04)).toBe('0,0 °C');
  });

  it('has 180 days of sample data, ending with the values shown elsewhere', () => {
    expect(ANDAMENTO_SAMPLE.sleepMinutes).toHaveLength(180);
    expect(ANDAMENTO_SAMPLE.sleepMinutes.at(-1)).toBe(352);
    expect(ANDAMENTO_SAMPLE.hrv.at(-1)).toBe(43);
    expect(ANDAMENTO_SAMPLE.restingHr.at(-1)).toBe(56);
    expect(ANDAMENTO_SAMPLE.recovery).toHaveLength(180);
    expect(ANDAMENTO_SAMPLE.recovery.slice(-7)).toEqual([78, 82, 76, 72, 80, 69, 64]);
    expect(ANDAMENTO_SAMPLE.stepsYesterdayByHour.reduce((s, v) => s + v, 0)).toBe(5470);
    expect(ANDAMENTO_SAMPLE.steps.at(-1)).toBe(5470);
  });
});

describe('band chart geometry', () => {
  const band = { median: 50, low: 45, high: 55 };

  it('keeps a series and its band inside the chart', () => {
    const g = bandGeometry([30, 50, 70], band);
    for (const p of g.points) {
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(110);
    }
    expect(g.bandTop).toBeLessThan(g.bandBottom);
  });

  it('puts higher values higher on the chart and marks outliers', () => {
    const g = bandGeometry([30, 50, 70], band);
    expect(g.points[2].y).toBeLessThan(g.points[0].y);
    expect(g.points.map((p) => p.outside)).toEqual([true, false, true]);
  });

  it('handles a flat series without dividing by zero', () => {
    const g = bandGeometry([50, 50, 50], { median: 50, low: 50, high: 50 });
    expect(g.points.every((p) => Number.isFinite(p.y))).toBe(true);
  });
});
