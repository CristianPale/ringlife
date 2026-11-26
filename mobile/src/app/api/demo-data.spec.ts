import { MAX_SESSIONS_PER_REQUEST } from './api.model';
import { DEMO_DAYS, buildDemoData, localDayStart, seededRandom } from './demo-data';

const ROME_WINTER = 60;
// 12 novembre 2026, 12:00 a Roma.
const NOON = new Date('2026-11-12T11:00:00Z');

describe('demo data', () => {
  it('gives the same numbers for the same seed, and different ones for another', () => {
    const a = seededRandom(7);
    const b = seededRandom(7);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
    expect(seededRandom(8)()).not.toBe(seededRandom(7)());
  });

  it('finds the start of the local day for the phone offset', () => {
    expect(new Date(localDayStart(NOON, ROME_WINTER)).toISOString()).toBe('2026-11-11T23:00:00.000Z');
    // Poco dopo mezzanotte a Roma è ancora il giorno prima in UTC: conta l'ora del telefono.
    expect(new Date(localDayStart(new Date('2026-11-12T23:30:00Z'), ROME_WINTER)).toISOString()).toBe('2026-11-12T23:00:00.000Z');
  });

  it('builds ten complete nights, enough to calibrate the personal average', () => {
    const { sessions } = buildDemoData(NOON, ROME_WINTER);
    expect(DEMO_DAYS).toBeGreaterThanOrEqual(7);
    expect(sessions).toHaveLength(DEMO_DAYS);
    expect(sessions.length).toBeLessThanOrEqual(MAX_SESSIONS_PER_REQUEST);
  });

  it('is repeatable, so a second upload adds nothing new', () => {
    expect(buildDemoData(NOON, ROME_WINTER)).toEqual(buildDemoData(NOON, ROME_WINTER));
  });

  it('keeps stages in order, without overlaps, inside the session', () => {
    for (const session of buildDemoData(NOON, ROME_WINTER).sessions) {
      let cursor = session.start;
      for (const stage of session.stages) {
        expect(stage.start).toBe(cursor);
        expect(stage.end).toBeGreaterThan(stage.start);
        cursor = stage.end;
      }
      expect(cursor).toBe(session.end);
    }
  });

  it('puts every night before the next morning and only the nights that are over', () => {
    const early = buildDemoData(new Date('2026-11-12T04:00:00Z'), ROME_WINTER);
    expect(early.sessions).toHaveLength(DEMO_DAYS - 1);
    const nowMs = new Date('2026-11-12T04:00:00Z').getTime();
    for (const session of early.sessions) {
      expect(session.end).toBeLessThanOrEqual(nowMs);
    }
  });

  it('never sends a sample from the future, and sorts them by time', () => {
    const now = new Date('2026-11-12T09:15:00Z');
    const { samples } = buildDemoData(now, ROME_WINTER);
    expect(samples.every((s) => s.ts <= now.getTime())).toBe(true);
    expect(samples.every((s, i) => i === 0 || samples[i - 1].ts <= s.ts)).toBe(true);
  });

  it('has the metrics the backend turns into indices, with believable values', () => {
    const { samples } = buildDemoData(NOON, ROME_WINTER);
    const by = (metric: string) => samples.filter((s) => s.metric === metric);
    for (const metric of ['HR', 'HRV', 'TEMP', 'SPO2', 'STEPS']) {
      expect(by(metric).length).toBeGreaterThan(0);
    }
    expect(by('SPO2').every((s) => s.value >= 90 && s.value <= 100)).toBe(true);
    expect(by('HR').every((s) => s.value > 40 && s.value < 150)).toBe(true);
    expect(by('STEPS').every((s) => s.value > 0 && s.value < 2000)).toBe(true);
  });

  it('has no duplicated (metric, time) pair', () => {
    const { samples } = buildDemoData(NOON, ROME_WINTER);
    const keys = new Set(samples.map((s) => `${s.metric}:${s.ts}`));
    expect(keys.size).toBe(samples.length);
  });
});
