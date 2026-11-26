import { DemoRingSource } from './demo-ring-source';

describe('DemoRingSource', () => {
  const start = new Date('2026-11-05T12:00:00Z');

  async function read(source: DemoRingSource, since: number | null) {
    await source.connect();
    await source.setTime(new Date(), 60);
    const reading = await source.readHistory(since);
    await source.disconnect();
    return reading;
  }

  it('gives the whole history the first time', async () => {
    const reading = await read(new DemoRingSource(() => start), null);
    expect(reading.samples.length).toBeGreaterThan(500);
    expect(reading.sessions.length).toBeGreaterThanOrEqual(9);
  });

  it('gives only what happened after the last reading', async () => {
    let now = start;
    const source = new DemoRingSource(() => now);
    const first = await read(source, null);
    const cursor = Math.max(...first.samples.map((s) => s.ts));
    const nothing = await read(source, cursor);
    expect(nothing.samples).toEqual([]);
    now = new Date(start.getTime() + 6 * 3600 * 1000);
    const later = await read(source, cursor);
    expect(later.samples.length).toBeGreaterThan(0);
    expect(later.samples.every((s) => s.ts > cursor)).toBe(true);
  });

  it('refuses to read before connecting', async () => {
    await expect(new DemoRingSource(() => start).readHistory(null)).rejects.toThrow();
  });
});
