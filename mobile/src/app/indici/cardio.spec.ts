import { cardioAgeFor, estimateCardio, estimatedMaxHr, estimatedVo2max, populationVo2max } from './cardio';

describe('cardio', () => {
  it('estimates the maximum heart rate from age (Tanaka)', () => {
    expect(estimatedMaxHr(40)).toBe(180);
    expect(estimatedMaxHr(25)).toBe(191);
  });

  it('estimates VO2max from maximum and resting heart rate (Uth)', () => {
    expect(estimatedVo2max(180, 55)).toBeCloseTo(50.07, 2);
  });

  it('gives the FRIEND medians at the centre of each decade and interpolates between them', () => {
    expect(populationVo2max(25, 'male')).toBeCloseTo(48.0, 5);
    expect(populationVo2max(75, 'male')).toBeCloseTo(24.4, 5);
    expect(populationVo2max(30, 'female')).toBeCloseTo(33.9, 5);
    expect(populationVo2max(45, 'unspecified')).toBeCloseTo((37.8 + 26.7) / 2, 5);
  });

  it('turns a VO2max into the age at which it is the median, within 20 and 80', () => {
    expect(cardioAgeFor(48.0, 'male')).toBe(25);
    expect(cardioAgeFor(33.9, 'female')).toBe(30);
    expect(cardioAgeFor(populationVo2max(52, 'unspecified'), 'unspecified')).toBe(52);
    expect(cardioAgeFor(70, 'male')).toBe(20);
    expect(cardioAgeFor(10, 'male')).toBe(80);
  });

  it('needs the birth year and at least five nights, and uses the median of the last fourteen', () => {
    const today = new Date('2026-11-18T08:00:00');
    expect(estimateCardio(null, 'male', [55, 55, 55, 55, 55], today)).toEqual({ kind: 'no-birth-year' });
    expect(estimateCardio(1986, 'male', [55, 55, 55, 55], today)).toEqual({ kind: 'few-nights', nights: 4 });
    // Le notti più vecchie delle ultime 14 non contano: i 90 restano fuori.
    const nights = [90, 90, ...Array(14).fill(55)];
    const result = estimateCardio(1986, 'male', nights, today);
    expect(result).toEqual({
      kind: 'ok',
      estimate: { age: 40, maxHr: 180, restingHr: 55, nights: 14, vo2max: 50.1, cardioAge: 21 },
    });
  });
});
