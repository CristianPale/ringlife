import { JournalEntry } from '../diary/journal.model';
import { STRAIN_THRESHOLD, alcoholEveningBefore, evaluateStrain } from './strain.model';

const ON = { rhr: 1.5, hrv: -1.5, temp: 1.5 };
const OFF = { rhr: 0, hrv: 0, temp: 0 };

describe('evaluateStrain', () => {
  it('has no level with 0 or 1 signals', () => {
    expect(evaluateStrain(OFF)).toMatchObject({ level: 'nessuno', count: 0 });
    expect(evaluateStrain({ ...OFF, hrv: -2 })).toMatchObject({ level: 'nessuno', count: 1 });
    expect(evaluateStrain({ ...OFF, rhr: 3 })).toMatchObject({ level: 'nessuno', count: 1 });
  });

  it('is "attenzione" with exactly 2 signals, whichever they are', () => {
    expect(evaluateStrain({ rhr: 1.5, hrv: -1.5, temp: 0 })).toMatchObject({ level: 'attenzione', count: 2 });
    expect(evaluateStrain({ rhr: 1.5, hrv: 0, temp: 1.5 })).toMatchObject({ level: 'attenzione', count: 2 });
    expect(evaluateStrain({ rhr: 0, hrv: -1.5, temp: 1.5 })).toMatchObject({ level: 'attenzione', count: 2 });
  });

  it('is "alto" with all three signals', () => {
    expect(evaluateStrain(ON)).toMatchObject({ level: 'alto', count: 3 });
  });

  it('counts a signal at the threshold, not just below it', () => {
    expect(evaluateStrain({ rhr: STRAIN_THRESHOLD, hrv: -STRAIN_THRESHOLD, temp: 0 }).count).toBe(2);
    expect(evaluateStrain({ rhr: STRAIN_THRESHOLD - 0.01, hrv: 0, temp: 0 }).count).toBe(0);
  });

  it('only counts each signal in the direction of fatigue', () => {
    // Battito più basso, HRV più alta e temperatura più bassa del solito sono il contrario della fatica.
    expect(evaluateStrain({ rhr: -2, hrv: 2, temp: -2 })).toMatchObject({ level: 'nessuno', count: 0 });
  });

  it('gives no level without a valid baseline for all three', () => {
    expect(evaluateStrain({ rhr: 2, hrv: -2, temp: null }).level).toBeNull();
    expect(evaluateStrain({ rhr: null, hrv: null, temp: null }).level).toBeNull();
    expect(evaluateStrain({ rhr: 2, hrv: null, temp: 2 }).signals).toEqual([]);
  });

  it('cites alcohol as a possible cause and never goes above "attenzione"', () => {
    expect(evaluateStrain(ON, ['alcohol'])).toMatchObject({ level: 'attenzione', count: 3, cause: 'alcohol' });
    expect(evaluateStrain({ rhr: 1.5, hrv: -1.5, temp: 0 }, ['late-meal'])).toMatchObject({
      level: 'attenzione',
      cause: 'late-meal',
    });
  });

  it('does not cite a cause when there is nothing to explain', () => {
    expect(evaluateStrain(OFF, ['alcohol']).cause).toBeNull();
  });
});

describe('alcoholEveningBefore', () => {
  const wake = new Date(2026, 10, 3, 8, 0);
  const alcohol = (at: Date): JournalEntry => ({ id: 'a', at: at.toISOString(), kind: 'alcohol', drink: 'wine' });

  it('finds a drink the evening before', () => {
    expect(alcoholEveningBefore([alcohol(new Date(2026, 10, 2, 21, 30))], wake)).toBe(true);
  });

  it('includes a drink after midnight, before 05:00', () => {
    expect(alcoholEveningBefore([alcohol(new Date(2026, 10, 3, 1, 10))], wake)).toBe(true);
  });

  it('ignores a drink at lunch, two days ago or in the morning', () => {
    expect(alcoholEveningBefore([alcohol(new Date(2026, 10, 2, 13, 0))], wake)).toBe(false);
    expect(alcoholEveningBefore([alcohol(new Date(2026, 10, 1, 21, 0))], wake)).toBe(false);
    expect(alcoholEveningBefore([alcohol(new Date(2026, 10, 3, 7, 0))], wake)).toBe(false);
  });

  it('ignores caffeine and notes', () => {
    const at = new Date(2026, 10, 2, 21, 0).toISOString();
    const others: JournalEntry[] = [
      { id: 'c', at, kind: 'caffeine', drink: 'coffee' },
      { id: 'n', at, kind: 'note', text: 'cena tardi' },
    ];
    expect(alcoholEveningBefore(others, wake)).toBe(false);
  });
});
