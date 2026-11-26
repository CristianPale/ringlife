import { expandSegments } from './sonno.model';
import { bodyRows, nightSentence, stageRows } from './sonno.rows';

const SEGMENTS = expandSegments([
  ['awake', 10],
  ['light', 200],
  ['deep', 48],
  ['rem', 56],
  ['awake', 15],
  ['light', 48],
]);

describe('stageRows', () => {
  it('has the four stages with their minutes and unit', () => {
    const rows = stageRows(SEGMENTS, 1, {});
    expect(rows.map((r) => [r.id, r.value, r.unit])).toEqual([
      ['deep', '48', 'minuti'],
      ['rem', '56', 'minuti'],
      ['light', '4:08', 'ore'],
      ['awake', '25', 'minuti'],
    ]);
  });

  it('says less than usual in amber for the deep sleep, more awake time is worse', () => {
    const rows = stageRows(SEGMENTS, 2, { deep: -2, rem: 0, light: 0.7, awake: 2 });
    expect(rows[0]).toMatchObject({ sub: 'Meno del solito', tone: 'peggio' });
    expect(rows[1]).toMatchObject({ sub: 'Come al solito', tone: null });
    expect(rows[2]).toMatchObject({ sub: 'Come al solito', tone: null });
    expect(rows[3]).toMatchObject({ sub: 'Più del solito', tone: 'peggio' });
  });

  it('counts the awakenings when awake time is within the usual', () => {
    expect(stageRows(SEGMENTS, 2, { awake: 0 })[3].sub).toBe('2 risvegli');
    expect(stageRows(SEGMENTS, 1, { awake: 0 })[3].sub).toBe('1 risveglio');
  });

  it('never colours the light sleep, even far from the usual', () => {
    expect(stageRows(SEGMENTS, 0, { light: -3 })[2]).toMatchObject({ sub: 'Meno del solito', tone: null });
  });

  it('says it is calibrating without an average', () => {
    expect(stageRows(SEGMENTS, 0, {})[0]).toMatchObject({ sub: 'In calibrazione', deviation: null });
  });
});

describe('bodyRows', () => {
  const READINGS = { minHr: 49.4, hrv: 38, tempDeviation: 0.2, spo2: 96 };

  it('writes each measure with its unit', () => {
    expect(bodyRows(READINGS, {}).map((r) => [r.id, r.value, r.unit])).toEqual([
      ['min-hr', '49', 'battiti al minuto'],
      ['hrv', '38', 'millisecondi'],
      ['temp', '+0,2', 'gradi'],
      ['spo2', '96', 'per cento'],
    ]);
  });

  it('puts the full name of the abbreviations next to them', () => {
    const labels = bodyRows(READINGS, {}).map((r) => r.label);
    expect(labels).toContain('Variabilità del battito (HRV)');
    expect(labels).toContain('Ossigeno nel sangue (SpO2)');
  });

  it('a lower HRV is worse, a lower resting heart rate is better', () => {
    const rows = bodyRows(READINGS, { hrv: -1.8, minHr: -2 });
    expect(rows.find((r) => r.id === 'hrv')).toMatchObject({ sub: 'Più bassa del solito', tone: 'peggio' });
    expect(rows.find((r) => r.id === 'min-hr')).toMatchObject({ sub: 'Più basso del solito', tone: 'meglio' });
  });

  it('skips a measure the ring did not give', () => {
    expect(bodyRows({ hrv: 40 }, {}).map((r) => r.id)).toEqual(['hrv']);
  });
});

describe('nightSentence', () => {
  const text = (parts: { text: string }[]) => parts.map((p) => p.text).join('');

  it('names the stage that is furthest below the usual, in amber', () => {
    const parts = nightSentence('5 h 52', '00:48', '07:05', stageRows(SEGMENTS, 1, { deep: -2.1, rem: -1.6, light: 0, awake: 0 }));
    expect(text(parts)).toBe('5 h 52 di sonno, dalle 00:48 alle 07:05. Il sonno profondo è sotto il tuo solito.');
    expect(parts.filter((p) => p.tone)).toEqual([{ text: 'sotto il tuo solito', tone: 'peggio' }]);
  });

  it('says the stages are as usual when none is far from it', () => {
    const parts = nightSentence('7 h 10', '23:20', '06:30', stageRows(SEGMENTS, 1, { deep: 0.2, rem: -0.5, light: 0, awake: 0 }));
    expect(text(parts)).toBe('7 h 10 di sonno, dalle 23:20 alle 06:30. Le fasi sono nel tuo solito.');
  });

  it('says only the hours while calibrating', () => {
    expect(text(nightSentence('5 h 52', '00:48', '07:05', stageRows(SEGMENTS, 1, {})))).toBe('5 h 52 di sonno, dalle 00:48 alle 07:05.');
  });

  it('colours an excess in green', () => {
    const parts = nightSentence('8 h 00', '23:00', '07:00', stageRows(SEGMENTS, 0, { deep: 2, rem: 0, light: 0, awake: 0 }));
    expect(parts.find((p) => p.tone)).toEqual({ text: 'sopra il tuo solito', tone: 'meglio' });
  });
});
