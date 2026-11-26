import { MAX_SAMPLE_GAP_MS, timeInZones, zoneBounds, zoneLabel, zoneOf } from './hr-zones';

describe('hr zones', () => {
  it('puts a heart rate in its zone as a share of the maximum', () => {
    expect(zoneOf(80, 200)).toBe(0);
    expect(zoneOf(100, 200)).toBe(1);
    expect(zoneOf(139, 200)).toBe(2);
    expect(zoneOf(140, 200)).toBe(3);
    expect(zoneOf(170, 200)).toBe(4);
    expect(zoneOf(180, 200)).toBe(5);
    expect(zoneOf(215, 200)).toBe(5);
  });

  it('names a zone with its share of the maximum', () => {
    expect(zoneLabel(3)).toBe('Zona 3 · moderata, 70-80% del massimo');
    expect(zoneLabel(0)).toBe('Sotto la zona 1');
    expect(zoneBounds(180)[0]).toEqual({ zone: 1, from: 90, to: 108 });
  });

  it('counts each beat until the next one, never across a gap in the signal', () => {
    const samples = [
      { t: 0, bpm: 150 },
      { t: 1_000, bpm: 150 },
      { t: 2_000, bpm: 185 },
      { t: 60_000, bpm: 100 },
    ];
    const totals = timeInZones(samples, 200);
    expect(totals[3]).toBe(2_000);
    expect(totals[5]).toBe(MAX_SAMPLE_GAP_MS);
    expect(totals[1]).toBe(1_000);
    expect(timeInZones([], 200)).toEqual([0, 0, 0, 0, 0, 0]);
  });
});
