import { Profile } from '../settings/settings.model';
import { ageFromBirthYear, dailyCalories, isProfileComplete } from './calories';

const TODAY = new Date(2026, 10, 3);
const MALE: Profile = { sex: 'male', birthYear: 1985, heightCm: 178, weightKg: 75 };

describe('calories', () => {
  it('computes age from the birth year', () => {
    expect(ageFromBirthYear(1985, TODAY)).toBe(41);
  });

  it('estimates a full day for a synthetic male profile', () => {
    // BMR 10*75 + 6,25*178 - 5*41 + 5 = 1662,5; attività 5470*75*0,0005 = 205,1; digestione 10%.
    expect(dailyCalories(MALE, 5470, TODAY)).toEqual({ rest: 1663, activity: 205, digestion: 187, total: 2054 });
  });

  it('uses the female formula, 166 kcal lower at rest', () => {
    const male = dailyCalories(MALE, 0, TODAY)!;
    const female = dailyCalories({ ...MALE, sex: 'female' }, 0, TODAY)!;
    expect(male.rest - female.rest).toBe(166);
  });

  it('averages the two formulas when the sex is not stated', () => {
    const male = dailyCalories(MALE, 0, TODAY)!.rest;
    const female = dailyCalories({ ...MALE, sex: 'female' }, 0, TODAY)!.rest;
    const none = dailyCalories({ ...MALE, sex: 'unspecified' }, 0, TODAY)!.rest;
    expect(none).toBeGreaterThanOrEqual(female);
    expect(none).toBeLessThanOrEqual(male);
    expect(Math.abs(none - (male + female) / 2)).toBeLessThanOrEqual(1);
  });

  it('rises with steps: 0, 5.000 and 15.000', () => {
    const totals = [0, 5000, 15000].map((steps) => dailyCalories(MALE, steps, TODAY)!.total);
    expect(totals[0]).toBeLessThan(totals[1]);
    expect(totals[1]).toBeLessThan(totals[2]);
    expect(dailyCalories(MALE, 0, TODAY)!.activity).toBe(0);
  });

  it('never goes below the resting energy, even with negative steps', () => {
    expect(dailyCalories(MALE, -500, TODAY)!.activity).toBe(0);
  });

  it('estimates nothing without a complete profile', () => {
    expect(dailyCalories({ ...MALE, weightKg: null }, 5000, TODAY)).toBeNull();
    expect(dailyCalories({ ...MALE, heightCm: null }, 5000, TODAY)).toBeNull();
    expect(dailyCalories({ ...MALE, birthYear: null }, 5000, TODAY)).toBeNull();
    expect(isProfileComplete(MALE)).toBe(true);
    expect(isProfileComplete({ sex: 'unspecified', birthYear: null, heightCm: null, weightKg: null })).toBe(false);
  });

  it('parts add up to the total within rounding', () => {
    const kcal = dailyCalories(MALE, 8000, TODAY)!;
    expect(Math.abs(kcal.rest + kcal.activity + kcal.digestion - kcal.total)).toBeLessThanOrEqual(1);
  });
});
