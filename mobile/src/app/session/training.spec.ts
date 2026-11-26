import {
  calorieProfile,
  heartRateRecovery,
  keytelKjPerMin,
  recoveryText,
  sessionKcal,
  targetStanding,
  targetText,
  weeklyMinutes,
} from './training';

describe('training', () => {
  it('says where the heart rate is against the target zone', () => {
    // Battito massimo 180: zona 3 da 126 a 144.
    expect(targetStanding(120, 180, 3)).toBe('sotto');
    expect(targetStanding(130, 180, 3)).toBe('dentro');
    expect(targetStanding(150, 180, 3)).toBe('sopra');
    expect(targetText('sopra')).toBe('Sopra la zona obiettivo');
  });

  it('needs birth year and weight for the calories', () => {
    expect(calorieProfile({ sex: 'male', birthYear: null, heightCm: null, weightKg: 70 }, 2026)).toBeNull();
    expect(calorieProfile({ sex: 'male', birthYear: 1986, heightCm: null, weightKg: null }, 2026)).toBeNull();
    expect(calorieProfile({ sex: 'female', birthYear: 1986, heightCm: null, weightKg: 60 }, 2026)).toEqual({ age: 40, weightKg: 60, sex: 'female' });
  });

  it('uses the two Keytel equations, their mean without sex, and never goes below zero', () => {
    const p = { age: 40, weightKg: 70 };
    const male = -55.0969 + 0.6309 * 140 + 0.1988 * 70 + 0.2017 * 40;
    const female = -20.4022 + 0.4472 * 140 - 0.1263 * 70 + 0.074 * 40;
    expect(keytelKjPerMin(140, { ...p, sex: 'male' })).toBeCloseTo(male, 6);
    expect(keytelKjPerMin(140, { ...p, sex: 'female' })).toBeCloseTo(female, 6);
    expect(keytelKjPerMin(140, { ...p, sex: 'unspecified' })).toBeCloseTo((male + female) / 2, 6);
    expect(keytelKjPerMin(20, { ...p, sex: 'female' })).toBe(0);
  });

  it('adds up the calories second by second, without counting a pause', () => {
    const profile = { age: 40, weightKg: 70, sex: 'male' as const };
    // Dieci minuti a 140, un battito al secondo.
    const steady = Array.from({ length: 600 }, (_, i) => ({ t: i * 1_000, bpm: 140 }));
    const expected = Math.round((keytelKjPerMin(140, profile) * 10) / 4.184);
    expect(sessionKcal(steady, profile)).toBe(expected);
    // Una pausa di un'ora tra due battiti conta al massimo 5 secondi.
    expect(sessionKcal([{ t: 0, bpm: 140 }, { t: 3_600_000, bpm: 140 }], profile)).toBe(Math.round((keytelKjPerMin(140, profile) * 6) / 60 / 4.184));
  });

  it('measures the heart rate recovery from the last 10 seconds to the seconds 50-60 after the end', () => {
    const active = [
      { t: 0, bpm: 100 },
      { t: 50_000, bpm: 150 },
      { t: 55_000, bpm: 148 },
      { t: 60_000, bpm: 152 },
    ];
    const recovery = [
      { t: 10_000, bpm: 140 },
      { t: 50_000, bpm: 122 },
      { t: 60_000, bpm: 118 },
    ];
    expect(heartRateRecovery(active, recovery)).toEqual({ end: 150, after: 120 });
    expect(heartRateRecovery(active, [{ t: 30_000, bpm: 130 }])).toBeNull();
    expect(heartRateRecovery([], recovery)).toBeNull();
    expect(recoveryText({ end: 150, after: 120 })).toBe('Sceso di 30 battiti in un minuto, da 150 a 120.');
    expect(recoveryText({ end: 120, after: 124 })).toBe('Salito di 4 battiti in un minuto, da 120 a 124.');
  });

  it('counts the training minutes per week, Monday to Sunday, oldest first', () => {
    // Martedì 24 novembre 2026: la settimana comincia lunedì 23.
    const now = new Date(2026, 10, 24, 12, 0);
    const sessions = [
      { start: new Date(2026, 10, 23, 7, 0).getTime(), durationMs: 30 * 60_000 },
      { start: new Date(2026, 10, 24, 7, 0).getTime(), durationMs: 15 * 60_000 },
      { start: new Date(2026, 10, 22, 7, 0).getTime(), durationMs: 40 * 60_000 },
    ];
    const weeks = weeklyMinutes(sessions, now, 3);
    expect(weeks.map((w) => w.minutes)).toEqual([0, 40, 45]);
    expect(weeks[2].start.getDate()).toBe(23);
    expect(weeks[1].label).toBe('16 nov');
  });
});
