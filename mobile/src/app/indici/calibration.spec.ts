import { DayView } from '../api/api.model';
import { nightsProgress, nightsToGoText, recoveryWaiting } from './calibration';

const day = (key: string, features: Record<string, number> = {}): DayView => ({
  day: key,
  scores: {},
  metrics: {},
  baselines: {},
  features,
});

/** `n` giorni fino al 22 novembre; `withNight` dice quali hanno il battito a riposo della notte. */
function days(n: number, withNight: (i: number) => boolean): DayView[] {
  return Array.from({ length: n }, (_, i) => {
    const date = new Date(Date.UTC(2026, 10, 22 - (n - 1 - i))).toISOString().slice(0, 10);
    return day(date, withNight(i) ? { resting_hr: 55 } : { steps: 3000 });
  });
}

describe('calibration', () => {
  it('needs 7 nights before the night that gets the first comparison', () => {
    const has = (d: DayView) => typeof d.features?.['resting_hr'] === 'number';
    expect(nightsProgress(days(6, () => true), has)).toEqual({ recorded: 6, toGo: 2 });
    expect(nightsProgress(days(8, () => true), has)).toEqual({ recorded: 8, toGo: 0 });
    expect(nightsProgress([], has)).toEqual({ recorded: 0, toGo: 8 });
  });

  it('counts only the last 28 days', () => {
    const has = (d: DayView) => typeof d.features?.['resting_hr'] === 'number';
    // Le notti vecchie di 40 giorni non contano.
    expect(nightsProgress(days(40, (i) => i < 10), has).recorded).toBe(0);
  });

  it('writes the nights to go', () => {
    expect(nightsToGoText(1)).toBe('manca 1 notte');
    expect(nightsToGoText(3)).toBe('mancano 3 notti');
  });

  it('explains a missing Recovery with the nights still needed', () => {
    // Sei notti con il battito e un giorno solo con i passi.
    const waiting = recoveryWaiting(days(7, (i) => i > 0));
    expect(waiting.lead).toBe('In calibrazione.');
    expect(waiting.hint).toContain('Finora ne hai 6');
    expect(waiting.hint).toContain('dopo altre 2 notti');
    expect(recoveryWaiting(days(7, (i) => i > 0)).hint).not.toContain('sincronizzazione');
  });

  it('counts HRV nights too, and says when one night is left', () => {
    const list = days(7, () => true).map((d) => ({ ...d, features: { hrv_night: 40 } }));
    expect(recoveryWaiting(list).hint).toContain('dopo la prossima notte');
  });

  it('says there is no night yet before the first one', () => {
    expect(recoveryWaiting([]).hint).toContain('Finora non ce n\'è nessuna: il primo Recupero arriva dopo 8 notti');
  });

  it('falls back to waiting for the server when the nights are there', () => {
    const waiting = recoveryWaiting(days(9, () => true));
    expect(waiting.lead).toBe('Nessun dato ancora.');
    expect(waiting.hint).toContain('Le notti per la tua media ci sono');
  });
});
