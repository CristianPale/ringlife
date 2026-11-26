import { DayView } from '../api/api.model';
import { serverNoteText } from '../ring/ring-status';
import { pendingNightText } from './pending-night';

describe('pending night and server note (docs/adr/0043)', () => {
  const now = new Date('2026-11-24T10:00:00Z');
  const night = {
    start: Date.parse('2026-11-23T22:30:00Z'),
    end: Date.parse('2026-11-24T06:00:00Z'),
    asleepMs: (7 * 60 + 5) * 60_000,
  };
  const withSleep = (key: string) =>
    ({ day: key, scores: { sleep: { value: 70 } }, metrics: {} }) as unknown as DayView;

  it('tells about last night read from the ring while the server is behind and does not have it', () => {
    expect(pendingNightText(night, [withSleep('2026-11-23')], 1_000, night.end + 60_000, now)).toBe(
      "Stanotte: 7 h 05 di sonno, dall'anello. Il server di casa la calcolerà appena risponde: qui sotto c'è l'ultima notte calcolata.",
    );
    expect(pendingNightText({ ...night, asleepMs: null }, [], null, null, now)).toContain(
      'Stanotte: 7 h 30 a letto',
    );
  });

  it('says nothing when the server already has that night, or is newer than the last reading', () => {
    expect(
      pendingNightText(night, [withSleep('2026-11-24')], 1_000, night.end + 60_000, now),
    ).toBeNull();
    expect(pendingNightText(night, [], night.end + 120_000, night.end + 60_000, now)).toBeNull();
    expect(pendingNightText(null, [], null, null, now)).toBeNull();
  });

  it('says since when the data shown are, when the server does not answer', () => {
    expect(serverNoteText(Date.parse('2026-11-23T21:10:00Z'), now)).toBe(
      'Server di casa non raggiungibile: dati scaricati ieri alle 22:10.',
    );
    expect(serverNoteText(Date.parse('2026-11-24T06:41:00Z'), now)).toBe(
      'Server di casa non raggiungibile: dati scaricati alle 07:41.',
    );
    expect(serverNoteText(null, now)).toBe(
      'Server di casa non raggiungibile: nessun dato salvato sul telefono.',
    );
  });
});
