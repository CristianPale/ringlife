import { syncedText } from './ring-status';

describe('syncedText', () => {
  const now = new Date('2026-11-05T12:00:00Z');

  it('says the time on the same day', () => {
    expect(syncedText(new Date('2026-11-05T06:41:00Z').getTime(), now)).toBe('Sincronizzato alle 07:41');
  });

  it('says yesterday', () => {
    expect(syncedText(new Date('2026-11-04T21:10:00Z').getTime(), now)).toBe('Sincronizzato ieri alle 22:10');
  });

  it('says the date for older readings', () => {
    expect(syncedText(new Date('2026-11-01T21:10:00Z').getTime(), now)).toBe('Sincronizzato il 1 novembre alle 22:10');
  });
});
