import { CHART_HEIGHT, areaPath, chartPoints, polyline, seriesStats, yFor } from './trend-chart';

describe('trend chart', () => {
  it('puts 100 above 0 and keeps values inside the plot', () => {
    expect(yFor(100)).toBeLessThan(yFor(50));
    expect(yFor(50)).toBeLessThan(yFor(0));
    expect(yFor(-20)).toBe(yFor(0));
    expect(yFor(140)).toBe(yFor(100));
    expect(yFor(0)).toBeLessThan(CHART_HEIGHT);
  });

  it('spreads points from the left edge to the right edge', () => {
    const points = chartPoints([10, 20, 30, 40]);
    expect(points).toHaveLength(4);
    expect(points[0].x).toBeLessThan(points[3].x);
    expect(points[1].x - points[0].x).toBeCloseTo(points[3].x - points[2].x, 5);
  });

  it('handles a single value and an empty series', () => {
    expect(chartPoints([50])).toHaveLength(1);
    expect(areaPath([])).toBe('');
  });

  it('closes the area on the bottom of the plot', () => {
    const path = areaPath(chartPoints([40, 60, 50]));
    expect(path.startsWith('M')).toBe(true);
    expect(path.endsWith('Z')).toBe(true);
    expect(path.split('L').length).toBe(5);
  });

  it('writes one coordinate pair per point', () => {
    expect(polyline(chartPoints([1, 2, 3])).split(' ')).toHaveLength(3);
  });

  it('computes min, max and rounded average', () => {
    expect(seriesStats([60, 70, 85])).toEqual({ min: 60, max: 85, average: 72 });
  });
});
