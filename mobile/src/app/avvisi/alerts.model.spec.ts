import {
  AlertEvent,
  AlertSettings,
  CustomMetric,
  afterQuietHours,
  comparisonsOf,
  customRuleName,
  defaultCustomDraft,
  italianNumber,
  planNotifications,
  proposedQuietHours,
  proposedThresholds,
  validCustomDraft,
} from './alerts.model';

const SETTINGS: AlertSettings = { quietStart: '22:30', quietEnd: '07:00', lockScreen: 'breve', homeAssistant: false };

function event(id: string, overrides: Partial<AlertEvent> = {}): AlertEvent {
  return {
    id,
    rule: 'temperature',
    day: '2026-11-24',
    level: 'attenzione',
    title: `Titolo ${id}`,
    body: `Testo ${id}`,
    route: '/indici/recupero',
    createdAt: 1,
    deliverAfter: null,
    seenAt: null,
    ...overrides,
  };
}

describe('alerts model (docs/adr/0045)', () => {
  it('moves a notification out of the quiet hours, also across midnight', () => {
    const at = (h: number, m = 0) => new Date(2026, 10, 24, h, m);
    expect(afterQuietHours(at(12), '22:30', '07:00')).toEqual(at(12));
    expect(afterQuietHours(at(23), '22:30', '07:00')).toEqual(new Date(2026, 10, 25, 7, 0));
    expect(afterQuietHours(at(6, 59), '22:30', '07:00')).toEqual(at(7));
    expect(afterQuietHours(at(7), '22:30', '07:00')).toEqual(at(7));
    expect(afterQuietHours(at(14), '13:00', '15:00')).toEqual(at(15));
    expect(afterQuietHours(at(23), '07:00', '07:00')).toEqual(at(23));
  });

  it('notifies one event with its own text and page', () => {
    const now = new Date(2026, 10, 24, 8, 0);
    const [plan] = planNotifications([event('a')], () => 'notifica', SETTINGS, now, '2026-11-24');
    expect(plan).toMatchObject({ id: 'alert-a', title: 'Titolo a', body: 'Testo a', route: '/indici/recupero', at: now.getTime(), important: false });
  });

  it('joins several events in one notification, and says when they come from days without server', () => {
    const now = new Date(2026, 10, 24, 8, 0);
    const today = planNotifications([event('a'), event('b', { title: 'Titolo b' })], () => 'notifica', SETTINGS, now, '2026-11-24');
    expect(today).toHaveLength(1);
    expect(today[0]).toMatchObject({ title: '2 avvisi', body: 'Titolo a; Titolo b.', route: '/avvisi', events: ['a', 'b'] });
    const old = planNotifications(
      // Lo stesso avviso in due giorni: il titolo una volta sola, con i giorni.
      [event('a', { day: '2026-11-21' }), event('b', { day: '2026-11-22', title: 'Titolo a' })],
      () => 'notifica',
      SETTINGS,
      now,
      '2026-11-24',
    );
    expect(old[0].title).toBe('Mentre il server non rispondeva: 2 avvisi');
    expect(old[0].body).toBe('Titolo a, il 21 e il 22.');
  });

  it('leaves out seen events and those to show only in the list, and marks the important ones', () => {
    const now = new Date(2026, 10, 24, 8, 0);
    const plans = planNotifications(
      [event('a', { seenAt: 5 }), event('b', { rule: 'sleep-debt' }), event('c', { rule: 'fatigue' })],
      (rule) => (rule === 'sleep-debt' ? 'elenco' : 'importante'),
      SETTINGS,
      now,
      '2026-11-24',
    );
    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({ id: 'alert-c', important: true });
  });

  it('schedules an event with a later delivery on its own, and respects the quiet hours', () => {
    const now = new Date(2026, 10, 24, 14, 0);
    const evening = new Date(2026, 10, 24, 21, 0).getTime();
    const plans = planNotifications([event('a', { rule: 'sleep-debt', deliverAfter: evening })], () => 'notifica', SETTINGS, now, '2026-11-24');
    expect(plans[0].at).toBe(evening);
    const night = planNotifications([event('b')], () => 'notifica', SETTINGS, new Date(2026, 10, 24, 23, 30), '2026-11-24');
    expect(night[0].at).toBe(new Date(2026, 10, 25, 7, 0).getTime());
  });

  it('does not say the problem on the lock screen with the generic text', () => {
    const plans = planNotifications([event('a')], () => 'notifica', { ...SETTINGS, lockScreen: 'generico' }, new Date(2026, 10, 24, 8), '2026-11-24');
    expect(plans[0]).toMatchObject({ title: 'RingLife', body: 'Un nuovo avviso.' });
  });

  it('proposes quiet hours and thresholds from the goals', () => {
    expect(proposedQuietHours('23:30', '07:00')).toEqual({ quietStart: '23:00', quietEnd: '07:00' });
    expect(proposedQuietHours('00:15', '06:30')).toEqual({ quietStart: '23:45', quietEnd: '06:30' });
    expect(proposedThresholds(480, 8000)).toEqual({ sleepDebtHours: 6, stepsLow: 4000 });
    expect(proposedThresholds(450, 10000)).toEqual({ sleepDebtHours: 5.5, stepsLow: 5000 });
  });
});

const STEPS: CustomMetric = { id: 'steps', name: 'Passi', unit: 'passi', night: false, average: false, value: { min: 500, max: 30000, step: 500 } };
const RESTING: CustomMetric = {
  id: 'resting_hr',
  name: 'Battito a riposo',
  unit: 'battiti al minuto',
  night: true,
  average: true,
  value: { min: 30, max: 120, step: 1 },
};
const TEMPERATURE: CustomMetric = { id: 'temperature', name: 'Temperatura della notte', unit: null, night: true, average: true, value: null };
const SLEEP: CustomMetric = { id: 'sleep_hours', name: 'Ore di sonno', unit: 'h', night: true, average: false, value: { min: 2, max: 12, step: 0.5 } };

describe('custom alerts (docs/adr/0046)', () => {
  it('writes numbers the Italian way', () => {
    expect(italianNumber(3000)).toBe('3.000');
    expect(italianNumber(6.5)).toBe('6,5');
    expect(italianNumber(1.5)).toBe('1,5');
    expect(italianNumber(12000.25)).toBe('12.000,25');
    expect(italianNumber(70)).toBe('70');
  });

  it('names a rule like the server does', () => {
    expect(customRuleName(STEPS, { comparison: 'below', amount: 3000, days: 3 })).toBe('Passi sotto 3.000 per 3 giorni di fila');
    expect(customRuleName(SLEEP, { comparison: 'below', amount: 6, days: 2 })).toBe('Ore di sonno sotto 6 per 2 notti di fila');
    expect(customRuleName(RESTING, { comparison: 'above_average', amount: 1.5, days: 1 })).toBe(
      'Battito a riposo sopra la tua media di 1,5 scostamenti',
    );
    expect(customRuleName(RESTING, { comparison: 'above_average', amount: 1, days: 2 })).toBe(
      'Battito a riposo sopra la tua media di 1 scostamento per 2 notti di fila',
    );
    expect(customRuleName(RESTING, { comparison: 'above', amount: 70, days: 1 })).toBe('Battito a riposo sopra 70 battiti al minuto');
  });

  it('offers only the comparisons a metric has', () => {
    expect(comparisonsOf(STEPS)).toEqual(['above', 'below']);
    expect(comparisonsOf(TEMPERATURE)).toEqual(['above_average', 'below_average']);
    expect(comparisonsOf(RESTING)).toEqual(['above_average', 'below_average', 'above', 'below']);
  });

  it('validates amount, days and comparison against the catalogue', () => {
    const base = defaultCustomDraft(STEPS);
    expect(validCustomDraft(STEPS, base)).toBe(true);
    expect(validCustomDraft(STEPS, { ...base, amount: 100 })).toBe(false);
    expect(validCustomDraft(STEPS, { ...base, amount: 3100 })).toBe(false);
    expect(validCustomDraft(STEPS, { ...base, amount: 3000 })).toBe(true);
    expect(validCustomDraft(RESTING, { ...defaultCustomDraft(RESTING), amount: 1.5 })).toBe(true);
    expect(validCustomDraft(RESTING, { ...defaultCustomDraft(RESTING), amount: 1.25 })).toBe(false);
    expect(validCustomDraft(STEPS, { ...base, days: 8 })).toBe(false);
    expect(validCustomDraft(STEPS, { ...base, comparison: 'below_average', amount: 2 })).toBe(false);
    expect(validCustomDraft(TEMPERATURE, { ...defaultCustomDraft(TEMPERATURE), amount: 3.5 })).toBe(false);
    expect(defaultCustomDraft(TEMPERATURE)).toMatchObject({ comparison: 'above_average', amount: 2, days: 2 });
  });

  it('leaves to the server the events it delivers with a push (docs/adr/0047)', () => {
    const now = new Date(2026, 10, 24, 12);
    const plans = planNotifications(
      [event('a', { push: 'sent' }), event('b', { push: 'pending' }), event('c', { push: 'failed' }), event('d', { push: 'none' })],
      () => 'notifica',
      SETTINGS,
      now,
      '2026-11-24',
    );
    expect(plans).toHaveLength(1);
    expect(plans[0].events).toEqual(['c', 'd']);
  });
});
