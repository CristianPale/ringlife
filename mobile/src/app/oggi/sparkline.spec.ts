import { sparkline } from './sparkline';

describe('sparkline', () => {
  it('puts the minimum at the bottom and the maximum at the top', () => {
    const { points } = sparkline([10, 20]);
    expect(points).toBe('2,22 140,5');
  });

  it('ends on the last value', () => {
    const line = sparkline([78, 82, 76, 72, 80, 69, 64]);
    expect(line.lastX).toBe(140);
    expect(line.lastY).toBe(22);
    expect(line.points.split(' ')).toHaveLength(7);
  });

  it('draws a flat series in the middle', () => {
    expect(sparkline([5, 5, 5]).points).toBe('2,13.5 71,13.5 140,13.5');
  });

  it('handles empty and single-value series without NaN', () => {
    expect(sparkline([]).points).toBe('');
    expect(sparkline([7]).points).toBe('2,13.5');
  });
});
