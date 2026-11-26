import { DayView, ReferenceView } from '../api/api.model';
import { OggiData } from './oggi.model';
import { formatHours, oggiFromServer } from './oggi.from-server';
import { OGGI_SAMPLE } from './oggi.sample';

const NOW = new Date('2026-11-12T11:00:00Z');

function ref(deviation: number): ReferenceView {
  return { median: 70, spread: 5, deviation };
}

function day(
  date: string,
  scores: Record<string, number>,
  metrics: DayView['metrics'] = {},
  deviations: Record<string, number> = {},
): DayView {
  return {
    day: date,
    scores: Object.fromEntries(Object.entries(scores).map(([k, value]) => [k, { value, algoVersion: 'v1', components: [] }])),
    metrics,
    baselines: {},
    scoreReferences: Object.fromEntries(Object.entries(deviations).map(([k, d]) => [k, ref(d)])),
  };
}

describe('oggiFromServer', () => {
  it('with no days at all, every row is empty (a server with no data yet), never the example', () => {
    const result = oggiFromServer(OGGI_SAMPLE, [], NOW);
    expect([result.recupero, result.sonno, result.movimento, result.stress]).toEqual([null, null, null, null]);
  });

  it('with days but no index, shows empty rows and never the example values', () => {
    const result = oggiFromServer(OGGI_SAMPLE, [day('2026-11-12', { movement: 60 })], NOW)!;
    expect(result.recupero).toBeNull();
    expect(result.sonno).toBeNull();
    expect(result.stress).toBeNull();
    expect(result.summary[0].text).toContain('Ancora nessun indice');
    expect(result.syncText).toBe('Dal server: ancora nessun risultato.');
  });

  it('takes the value and where it stands against your average from the last day', () => {
    const result = oggiFromServer(
      OGGI_SAMPLE,
      [day('2026-11-11', { recovery: 50 }, {}, { recovery: -2 }), day('2026-11-12', { recovery: 88 }, {}, { recovery: 1.8 })],
      NOW,
    )!;
    expect(result.recupero!.value).toBe(88);
    expect(result.recupero!.deviation).toBe(1.8);
  });

  it('has no deviation, and counts the days seen, while the average is not ready', () => {
    const days = [day('2026-11-10', { sleep: 70 }), day('2026-11-11', { sleep: 71 }), day('2026-11-12', { sleep: 72 })];
    const result = oggiFromServer(OGGI_SAMPLE, days, NOW)!;
    expect(result.sonno!.deviation).toBeNull();
    expect(result.sonno!.calibrationDays).toBe(2);
  });

  it('counts the days before the last one that has the index, not the days without it', () => {
    const days = [day('2026-11-09', { sleep: 70 }), day('2026-11-10', {}), day('2026-11-11', { sleep: 71 }), day('2026-11-12', {})];
    const result = oggiFromServer(OGGI_SAMPLE, days, NOW)!;
    expect(result.sonno!.value).toBe(71);
    expect(result.sonno!.calibrationDays).toBe(1);
  });

  it('uses the last day that has the index when today has none yet', () => {
    const days = [day('2026-11-11', { sleep: 82 }), day('2026-11-12', {})];
    expect(oggiFromServer(OGGI_SAMPLE, days, NOW)!.sonno!.value).toBe(82);
  });

  it('leaves the row empty for an index the server did not calculate (never the example)', () => {
    const result = oggiFromServer(OGGI_SAMPLE, [day('2026-11-12', { sleep: 75 })], NOW)!;
    expect(result.sonno!.value).toBe(75);
    expect(result.recupero).toBeNull();
    expect(result.stress).toBeNull();
    expect(result.movimento).toBeNull();
    expect(result.syncText).toBe('Dal server: Sonno.');
  });

  it('writes a summary from where the real values stand, not the example one', () => {
    const result: OggiData = oggiFromServer(
      OGGI_SAMPLE,
      [day('2026-11-12', { recovery: 64, sleep: 90 }, {}, { recovery: -2, sleep: 2.2 })],
      NOW,
    )!;
    const text = result.summary.map((s) => s.text).join('');
    expect(text).toBe('Il tuo recupero è peggio del solito. Il sonno è meglio del solito.');
    expect(text).not.toContain('5 h 52');
    expect(result.summary.filter((s) => s.tone).map((s) => [s.text, s.tone])).toEqual([
      ['peggio del solito', 'peggio'],
      ['meglio del solito', 'meglio'],
    ]);
  });

  it('does not colour «come al solito»', () => {
    const result = oggiFromServer(OGGI_SAMPLE, [day('2026-11-12', { recovery: 70, sleep: 70 }, {}, { recovery: 0.3, sleep: -1 })], NOW)!;
    expect(result.summary.map((s) => s.text).join('')).toBe('Il tuo recupero è come al solito. Il sonno è come al solito.');
    expect(result.summary.some((s) => s.tone)).toBe(false);
  });

  it('says the value and that it is calibrating when there is no average yet', () => {
    const result = oggiFromServer(OGGI_SAMPLE, [day('2026-11-12', { recovery: 64, sleep: 62 })], NOW)!;
    expect(result.summary.map((s) => s.text).join('')).toBe('Il tuo recupero è 64 su 100, in calibrazione. Il sonno è 62 su 100, in calibrazione.');
  });

  it('adds the sleep debt when the server has it, and nothing otherwise', () => {
    const withDebt = oggiFromServer(OGGI_SAMPLE, [day('2026-11-12', { sleep: 70 }, { sleep_debt: { value: 5.25, unit: 'h', detail: null, algoVersion: 'v1' } })], NOW)!;
    expect(withDebt.summaryDetail.map((s) => s.text).join('')).toBe('Debito di sonno: 5 h 15 negli ultimi 7 giorni.');
    expect(oggiFromServer(OGGI_SAMPLE, [day('2026-11-12', { sleep: 70 })], NOW)!.summaryDetail).toEqual([]);
  });

  it('formats hours as hours and minutes', () => {
    expect(formatHours(5.25)).toBe('5 h 15');
    expect(formatHours(0)).toBe('0 h 00');
    expect(formatHours(1.999)).toBe('2 h 00');
  });

  it("takes today's steps from the last day, even without an index that day", () => {
    const days = [day('2026-11-11', { sleep: 80 }), { ...day('2026-11-12', {}), features: { steps: 1239.6 } }];
    const result = oggiFromServer(OGGI_SAMPLE, days, NOW)!;
    expect(result.movimento!.steps).toBe(1240);
    expect(result.movimento!.goal).toBe(OGGI_SAMPLE.movimento.goal);
    expect(result.syncText).toBe('Dal server: Sonno e Movimento.');
  });

  it('names three sources with commas and a final «e»', () => {
    const days = [{ ...day('2026-11-12', { recovery: 70, sleep: 80 }), features: { steps: 100 } }];
    expect(oggiFromServer(OGGI_SAMPLE, days, NOW)!.syncText).toContain('Recupero, Sonno e Movimento');
  });

  it("takes yesterday's Stress from the last day that has it, and says so", () => {
    const days = [
      day('2026-11-11', { recovery: 70, sleep: 80, stress: 62 }, {}, { stress: -1.9 }),
      day('2026-11-12', { recovery: 71, sleep: 81 }),
    ];
    const result = oggiFromServer(OGGI_SAMPLE, days, NOW)!;
    expect(result.stress!.value).toBe(62);
    expect(result.stress!.deviation).toBe(-1.9);
    expect(result.stress!.label).toBe(OGGI_SAMPLE.stress.label);
    expect(result.syncText).toContain('Recupero, Sonno e Stress');
  });

  it('does not call the rest an example when everything comes from the server', () => {
    const days = [{ ...day('2026-11-12', { recovery: 70, sleep: 80, stress: 62 }), features: { steps: 10 } }];
    expect(oggiFromServer(OGGI_SAMPLE, days, NOW)!.syncText).toBe('Dal server: Recupero, Sonno, Movimento e Stress.');
  });

  it('leaves Stress empty while the server has none', () => {
    expect(oggiFromServer(OGGI_SAMPLE, [day('2026-11-12', { sleep: 80 })], NOW).stress).toBeNull();
  });

  describe('calibration notice', () => {
    it('says how many nights are still needed: 7 for the average and one to compare', () => {
      const days = [day('2026-11-10', { sleep: 70 }), day('2026-11-11', { sleep: 71 }), day('2026-11-12', { sleep: 72 })];
      expect(oggiFromServer(OGGI_SAMPLE, days, NOW).calibration).toEqual({ nightsToGo: 5 });
      expect(oggiFromServer(OGGI_SAMPLE, [], NOW).calibration).toEqual({ nightsToGo: 8 });
    });

    it('does not count days without a night, even with steps', () => {
      const days = [{ ...day('2026-11-11', {}), features: { steps: 4000 } }, day('2026-11-12', { sleep: 72 })];
      expect(oggiFromServer(OGGI_SAMPLE, days, NOW).calibration).toEqual({ nightsToGo: 7 });
    });

    it('goes away once Recovery or Sleep has the comparison with your average', () => {
      const days = [day('2026-11-12', { sleep: 72 }, {}, { sleep: 0.4 })];
      expect(oggiFromServer(OGGI_SAMPLE, days, NOW).calibration).toBeNull();
    });
  });

  describe('giro', () => {
    const withTimes = (): DayView => ({
      ...day('2026-11-12', { sleep: 70 }),
      features: { sleep_start_min: 48, sleep_end_min: 425 },
      references: { sleep_start_min: { median: -20, deviation: 0.5 }, sleep_end_min: { median: 420, deviation: 0.1 } },
    });

    it('puts now at the local time of the phone, in Rome', () => {
      expect(oggiFromServer(OGGI_SAMPLE, [day('2026-11-12', { sleep: 70 })], NOW)!.giro.nowMin).toBe(12 * 60);
    });

    it('draws your usual sleep from the median start and end, and last night from the day values', () => {
      const giro = oggiFromServer(OGGI_SAMPLE, [withTimes()], NOW)!.giro;
      expect(giro.usual).toEqual({ startMin: -20, endMin: 420 });
      expect(giro.sleep).toEqual({ startMin: 48, endMin: 425 });
    });

    it('has no usual band and no night arc without the data', () => {
      const giro = oggiFromServer(OGGI_SAMPLE, [day('2026-11-12', { sleep: 70 })], NOW)!.giro;
      expect(giro.usual).toBeNull();
      expect(giro.sleep).toBeNull();
      expect(giro.caffeine).toBeNull();
    });

    it("draws last night only when it is today's night", () => {
      const yesterday = { ...withTimes(), day: '2026-11-11' };
      const today = day('2026-11-12', {});
      expect(oggiFromServer(OGGI_SAMPLE, [yesterday, today], NOW)!.giro.sleep).toBeNull();
    });

    it('does not take the last saved day for today: away from home it can be yesterday', () => {
      const yesterday = { ...withTimes(), day: '2026-11-11', features: { sleep_start_min: 48, sleep_end_min: 425, steps: 9000 } };
      const result = oggiFromServer(OGGI_SAMPLE, [yesterday], NOW)!;
      expect(result.giro.sleep).toBeNull();
      expect(result.movimento).toBeNull();
      // Gli indici restano quelli dell'ultimo calcolo del server.
      expect(result.sonno?.value).toBe(70);
    });

    it('passes the caffeine window of the plugin through', () => {
      const giro = oggiFromServer(OGGI_SAMPLE, [day('2026-11-12', { sleep: 70 })], NOW, { startMin: 510, endMin: 900 })!.giro;
      expect(giro.caffeine).toEqual({ startMin: 510, endMin: 900 });
    });
  });

  describe('with the ring data on the phone (docs/adr/0043)', () => {
    // NOW è il 12 novembre alle 12:00 di Roma. La notte va dalle 23:30 dell'11 alle 07:00 del 12.
    const night = { start: Date.parse('2026-11-11T22:30:00Z'), end: Date.parse('2026-11-12T06:00:00Z'), asleepMs: (7 * 60 + 5) * 60_000 };
    const cached = { ...day('2026-11-11', { sleep: 70 }), features: { steps: 9000 } };

    it('uses the steps counted on the phone when the server is behind the ring', () => {
      const today = { ...day('2026-11-12', {}), features: { steps: 1200 } };
      const behind = oggiFromServer(OGGI_SAMPLE, [cached, today], NOW, null, { stepsToday: 4300, lastNight: null, serverBehind: true })!;
      expect(behind.movimento?.steps).toBe(4300);
      const fresh = oggiFromServer(OGGI_SAMPLE, [cached, today], NOW, null, { stepsToday: 4300, lastNight: null, serverBehind: false })!;
      expect(fresh.movimento?.steps).toBe(1200);
      const noToday = oggiFromServer(OGGI_SAMPLE, [cached], NOW, null, { stepsToday: 4300, lastNight: null, serverBehind: false })!;
      expect(noToday.movimento?.steps).toBe(4300);
    });

    it('draws last night from the ring and says the indices will come from the server', () => {
      const result = oggiFromServer(OGGI_SAMPLE, [cached], NOW, null, { stepsToday: null, lastNight: night, serverBehind: true })!;
      expect(result.giro.sleep).toEqual({ startMin: -30, endMin: 420 });
      expect(result.summaryDetail[0].text).toBe(
        "Stanotte: 7 h 05 di sonno, dall'anello. Il server di casa calcolerà gli indici appena risponde.",
      );
      const sent = oggiFromServer(OGGI_SAMPLE, [cached], NOW, null, { stepsToday: null, lastNight: { ...night, asleepMs: null }, serverBehind: true })!;
      expect(sent.summaryDetail[0].text).toContain('Stanotte: 7 h 30 a letto, dalle 23:30 alle 07:00');
    });

    it('leaves last night to the server when it is up to date, or when it is not tonight', () => {
      expect(oggiFromServer(OGGI_SAMPLE, [cached], NOW, null, { stepsToday: null, lastNight: night, serverBehind: false })!.giro.sleep).toBeNull();
      const older = { start: night.start - 86_400_000, end: night.end - 86_400_000, asleepMs: null };
      expect(oggiFromServer(OGGI_SAMPLE, [cached], NOW, null, { stepsToday: null, lastNight: older, serverBehind: true })!.giro.sleep).toBeNull();
    });
  });

  describe('tonight', () => {
    it('shows resting heart rate, HRV, temperature and SpO2 of the last night that has them', () => {
      const night: DayView = {
        ...day('2026-11-12', { sleep: 70 }),
        features: { resting_hr: 51.6, hrv_night: 46, spo2_median: 96 },
        metrics: { temp_deviation: { value: -0.2, unit: '°C', detail: null, algoVersion: 'v1' } },
        references: { hrv_night: { median: 50, deviation: -0.8 } },
      };
      const rows = oggiFromServer(OGGI_SAMPLE, [night], NOW).night;
      expect(rows.map((r) => [r.id, r.value])).toEqual([
        ['resting-hr', '52'],
        ['hrv', '46'],
        ['temp', expect.stringContaining('0,2')],
        ['spo2', '96'],
      ]);
      expect(rows[1].deviation).toBe(-0.8);
    });

    it('is empty without night measures (never the example)', () => {
      expect(oggiFromServer(OGGI_SAMPLE, [day('2026-11-12', { sleep: 70 })], NOW).night).toEqual([]);
    });
  });

  it("shows today's latest stress reading while the index of the day is not ready", () => {
    const hours: (number | null)[] = new Array(24).fill(null);
    hours[8] = 38.4;
    hours[9] = 41.2;
    const today: DayView = { ...day('2026-11-12', {}), stressByHour: hours };
    const stress = oggiFromServer(OGGI_SAMPLE, [today], NOW).stress!;
    expect(stress.value).toBe(41);
    expect(stress.label).toBe('Stress, alle 09');
    expect(stress.deviation).toBeNull();
  });
});
