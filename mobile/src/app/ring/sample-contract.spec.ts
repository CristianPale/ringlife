import { SamplePayload } from '../api/api.model';
import { PLAUSIBLE_RANGE, isPlausible, splitPlausible } from './sample-contract';

const sample = (metric: SamplePayload['metric'], value: number): SamplePayload => ({ metric, ts: 1, value });

describe('sample contract', () => {
  it('has a range for every metric of the API', () => {
    expect(Object.keys(PLAUSIBLE_RANGE).sort()).toEqual(['CALORIES', 'HR', 'HRV', 'SPO2', 'STEPS', 'STRESS', 'TEMP']);
  });

  it('accepts the limits and values between them', () => {
    expect(isPlausible(sample('HR', 30))).toBe(true);
    expect(isPlausible(sample('HR', 230))).toBe(true);
    expect(isPlausible(sample('SPO2', 97))).toBe(true);
    expect(isPlausible(sample('TEMP', 34.2))).toBe(true);
  });

  it('refuses what cannot be a real reading', () => {
    expect(isPlausible(sample('HR', 255))).toBe(false);
    expect(isPlausible(sample('HR', 0))).toBe(false);
    expect(isPlausible(sample('SPO2', 101))).toBe(false);
    expect(isPlausible(sample('TEMP', 340))).toBe(false);
    expect(isPlausible(sample('STEPS', -1))).toBe(false);
    expect(isPlausible(sample('HR', Number.NaN))).toBe(false);
  });

  it('splits a reading and keeps the order', () => {
    const { kept, rejected } = splitPlausible([sample('HR', 60), sample('HR', 255), sample('SPO2', 96)]);
    expect(kept.map((s) => s.value)).toEqual([60, 96]);
    expect(rejected.map((s) => s.value)).toEqual([255]);
  });
});
