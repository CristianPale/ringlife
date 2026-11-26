import { NightMidpoint, SLEEP_WEIGHTS, awakeningCount, efficiency, expandSegments, formatHoursMinutes, regularity } from './sonno.model';
import { SONNO_SAMPLE } from './sonno.sample';
import { hypnogramBlocks, rowY } from './hypnogram';

function nights(values: number[], weekendFrom = values.length): NightMidpoint[] {
  return values.map((midpointMin, i) => ({ midpointMin, weekend: i >= weekendFrom }));
}

describe('sonno model', () => {
  it('has weights that sum to one', () => {
    const total = Object.values(SLEEP_WEIGHTS).reduce((sum, w) => sum + w, 0);
    expect(total).toBeCloseTo(1, 10);
  });

  it('matches the Sonno tile on Oggi (62)', () => {
    expect(SONNO_SAMPLE.value).toBe(62);
  });

  it('formats hours and minutes', () => {
    expect(formatHoursMinutes(352)).toBe('5 h 52');
    expect(formatHoursMinutes(480)).toBe('8 h 00');
    expect(formatHoursMinutes(45)).toBe('45 min');
    expect(formatHoursMinutes(-3)).toBe('0 min');
  });

  it('computes the sample night: 5 h 52 asleep, 6 h 37 in bed, 3 awakenings', () => {
    const segments = SONNO_SAMPLE.segments;
    const bed = segments.reduce((sum, s) => sum + s.durationMin, 0);
    expect(bed).toBe(397);
    expect(Math.round(efficiency(segments) * 100)).toBe(89);
    expect(awakeningCount(segments)).toBe(3);
  });

  it('does not count falling asleep as an awakening', () => {
    const segments = expandSegments([['awake', 10], ['light', 30], ['awake', 5], ['deep', 20]]);
    expect(awakeningCount(segments)).toBe(1);
    expect(awakeningCount(expandSegments([['awake', 10]]))).toBe(0);
  });

  describe('regularity', () => {
    it('is 100 with the same midpoint every night', () => {
      expect(regularity(nights([180, 180, 180, 180, 180, 180, 180], 5))?.score).toBe(100);
    });

    it('needs at least 5 nights', () => {
      expect(regularity(nights([180, 180, 180, 180]))).toBeNull();
    });

    it('drops with a 90-minute swing between nights', () => {
      const swing = regularity(nights([180, 270, 180, 270, 180, 270, 180]));
      expect(swing?.score).toBeLessThan(75);
      expect(swing?.variationMin).toBeGreaterThan(35);
    });

    it('penalises a weekend shifted by 2 hours even when weekdays are constant', () => {
      const shifted = regularity(nights([180, 180, 180, 180, 180, 300, 300], 5));
      expect(shifted?.weekendGapMin).toBe(120);
      expect(shifted?.score).toBeLessThan(regularity(nights([180, 180, 180, 180, 180, 180, 180], 5))!.score);
    });

    it('puts all the weight on constancy with fewer than 2 weekend nights', () => {
      const oneWeekendNight = regularity(nights([180, 180, 180, 180, 180, 180, 300], 6));
      const noWeekend = regularity(nights([180, 180, 180, 180, 300, 180, 180]));
      expect(oneWeekendNight?.weekendGapMin).toBeNull();
      expect(noWeekend?.weekendGapMin).toBeNull();
      // Con lo scarto escluso conta solo la costanza: una sola notte sfasata non dà 100.
      expect(oneWeekendNight?.score).toBeLessThan(100);
    });

    it('handles midpoints before midnight (negative minutes)', () => {
      expect(regularity(nights([-30, -30, -30, -30, -30]))?.score).toBe(100);
    });

    it('gives 52 for the sample week', () => {
      expect(SONNO_SAMPLE.regularity.score).toBe(52);
      expect(SONNO_SAMPLE.regularity.weekendGapMin).toBe(77);
    });
  });
});

describe('hypnogram geometry', () => {
  it('draws one block per segment, in time order', () => {
    const blocks = hypnogramBlocks(SONNO_SAMPLE.segments);
    expect(blocks).toHaveLength(SONNO_SAMPLE.segments.length);
    for (let i = 1; i < blocks.length; i++) {
      expect(blocks[i].x).toBeGreaterThanOrEqual(blocks[i - 1].x);
    }
  });

  it('puts awake above REM, light and deep', () => {
    expect(rowY('awake')).toBeLessThan(rowY('rem'));
    expect(rowY('rem')).toBeLessThan(rowY('light'));
    expect(rowY('light')).toBeLessThan(rowY('deep'));
  });

  it('keeps a short awakening visible', () => {
    const blocks = hypnogramBlocks(expandSegments([['light', 600], ['awake', 1]]));
    expect(blocks[1].width).toBeGreaterThanOrEqual(1.5);
  });

  it('returns nothing for an empty night', () => {
    expect(hypnogramBlocks([])).toEqual([]);
  });
});
