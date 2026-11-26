import { formatClock, formatDuration, newId, resolveStart } from './headache-time';

describe('resolveStart', () => {
  const now = new Date(2026, 10, 3, 7, 44);

  it('uses today for a past time', () => {
    const start = resolveStart('06:30', now);
    expect(start).toEqual(new Date(2026, 10, 3, 6, 30));
  });

  it('treats a future time as yesterday, e.g. 23:30 at 00:10', () => {
    const justAfterMidnight = new Date(2026, 10, 3, 0, 10);
    expect(resolveStart('23:30', justAfterMidnight)).toEqual(new Date(2026, 10, 2, 23, 30));
  });

  it('accepts the current minute', () => {
    expect(resolveStart('07:44', now)).toEqual(new Date(2026, 10, 3, 7, 44));
  });

  it('rejects malformed values', () => {
    expect(resolveStart('', now)).toBeNull();
    expect(resolveStart('7:44', now)).toBeNull();
    expect(resolveStart('25:00', now)).toBeNull();
    expect(resolveStart('07:60', now)).toBeNull();
  });
});

describe('formatDuration', () => {
  const from = new Date(2026, 10, 3, 7, 44);

  it('shows minutes under an hour', () => {
    expect(formatDuration(from, new Date(2026, 10, 3, 8, 26))).toBe('42 min');
    expect(formatDuration(from, from)).toBe('0 min');
  });

  it('shows hours and two-digit minutes from an hour on', () => {
    expect(formatDuration(from, new Date(2026, 10, 3, 8, 56))).toBe('1 h 12');
    expect(formatDuration(from, new Date(2026, 10, 3, 9, 44))).toBe('2 h 00');
  });

  it('is never negative', () => {
    expect(formatDuration(from, new Date(2026, 10, 3, 7, 0))).toBe('0 min');
  });
});

describe('formatClock', () => {
  it('writes hours and minutes with two digits', () => {
    expect(formatClock(new Date(2026, 10, 3, 7, 4))).toBe('07:04');
    expect(formatClock(new Date(2026, 10, 3, 19, 58))).toBe('19:58');
  });
});

describe('newId', () => {
  it('returns a UUID v4 shape', () => {
    expect(newId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('does not repeat', () => {
    expect(newId()).not.toBe(newId());
  });
});
