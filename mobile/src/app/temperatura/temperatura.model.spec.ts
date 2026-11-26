import { celsiusText, dayChart, minuteOfDay, romeDay, temperatureDay } from './temperatura.model';

describe('temperatura model', () => {
  // 19 novembre 2026, ora di Roma = UTC + 1.
  const at = (hhmm: string) => Date.parse(`2026-11-19T${hhmm}:00+01:00`);
  const readings = [
    { ts: Date.parse('2026-11-18T23:30:00+01:00'), celsius: 35.9 },
    { ts: at('00:00'), celsius: 36.1 },
    { ts: at('03:30'), celsius: 36.6 },
    { ts: at('14:00'), celsius: 36.0 },
  ];

  it('takes the readings of one Rome day with the lowest and the highest', () => {
    const day = temperatureDay(readings, '2026-11-19')!;
    expect(day.readings).toHaveLength(3);
    expect(day.min.celsius).toBe(36.0);
    expect(day.max.celsius).toBe(36.6);
    expect(temperatureDay(readings, '2026-11-17')).toBeNull();
    expect(romeDay(readings[0].ts)).toBe('2026-11-18');
  });

  it('places the readings on the 24 hours', () => {
    expect(minuteOfDay(at('03:30'))).toBe(210);
    const chart = dayChart(temperatureDay(readings, '2026-11-19')!, 340, 120);
    expect(chart.points[0].x).toBe(8);
    expect(chart.low).toBe(35.8);
    expect(chart.high).toBe(36.8);
    // La più alta sta più in alto (y più piccola) della più bassa.
    expect(chart.points[1].y).toBeLessThan(chart.points[2].y);
    expect(celsiusText(36.25)).toBe('36,3');
  });
});
