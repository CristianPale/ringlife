import { describeAttempt, parseBackgroundAttempts, stageText } from './background-attempts';

const NOW = new Date('2026-11-18T17:00:00Z');
const at = (iso: string) => new Date(iso).getTime();

describe('background attempts', () => {
  it('reads the native log newest first and drops unreadable rows', () => {
    const json = JSON.stringify([
      { at: at('2026-11-17T23:00:00Z'), end: at('2026-11-17T23:00:14Z'), source: 'shortcut', outcome: 'saved', stage: '', done: 13, total: 13 },
      { nope: true },
      { at: at('2026-11-18T07:00:00Z'), outcome: 'time_limit', stage: 'hr:0', done: 5, total: 13 },
    ]);
    const list = parseBackgroundAttempts(json);
    expect(list.map((a) => a.outcome)).toEqual(['time_limit', 'saved']);
    expect(list[0]).toMatchObject({ source: 'background', end: list[0].at });
    expect(parseBackgroundAttempts('not json')).toEqual([]);
  });

  it('says when, who and how it went, and where a failed one stopped', () => {
    const [failed, saved] = parseBackgroundAttempts(
      JSON.stringify([
        { at: at('2026-11-17T23:00:00Z'), end: at('2026-11-17T23:00:14Z'), source: 'shortcut', outcome: 'saved', stage: '', done: 13, total: 13 },
        { at: at('2026-11-18T13:05:00Z'), end: at('2026-11-18T13:05:25Z'), source: 'shortcut', outcome: 'time_limit', stage: 'hr:0', done: 5, total: 13 },
      ]),
    );
    expect(describeAttempt(saved, NOW)).toBe('oggi alle 00:00 · Comandi · riuscita in 14 s');
    expect(describeAttempt(failed, NOW)).toBe(
      'oggi alle 14:05 · Comandi · non riuscita: tempo scaduto, fermata al battito di oggi, 5 richieste su 13',
    );
  });

  it('names skipped attempts without a stage', () => {
    const [skipped] = parseBackgroundAttempts(
      JSON.stringify([{ at: at('2026-11-17T08:00:00Z'), source: 'shortcut', outcome: 'app_active', stage: '', done: 0, total: 0 }]),
    );
    expect(describeAttempt(skipped, NOW)).toBe("ieri alle 09:00 · Comandi · saltata: l'app era aperta");
  });

  it('says how far the chain after a reading got (docs/adr/0048)', () => {
    const [night, shortcut] = parseBackgroundAttempts(
      JSON.stringify([
        { at: at('2026-11-18T06:40:00Z'), end: at('2026-11-18T06:40:21Z'), source: 'night', outcome: 'saved', stage: '', done: 13, total: 13, chain: 'alerts' },
        { at: at('2026-11-18T05:00:00Z'), end: at('2026-11-18T05:00:12Z'), source: 'shortcut', outcome: 'saved', stage: '', done: 13, total: 13, chain: 'no_page' },
      ]),
    );
    expect(describeAttempt(night, NOW)).toBe('oggi alle 07:40 · iOS, di notte · riuscita in 21 s, inviata e avvisi controllati');
    expect(describeAttempt(shortcut, NOW)).toBe("oggi alle 06:00 · Comandi · riuscita in 12 s, dati sul telefono fino all'apertura");
    expect(parseBackgroundAttempts(JSON.stringify([{ at: 1, outcome: 'saved' }]))[0].chain).toBe('');
  });

  it('says that a reading out of time kept the requests already done', () => {
    const [partial] = parseBackgroundAttempts(
      JSON.stringify([
        { at: at('2026-11-18T16:46:00Z'), end: at('2026-11-18T16:46:18Z'), source: 'background', outcome: 'partial', stage: 'temp', done: 12, total: 13, chain: 'uploaded' },
      ]),
    );
    expect(describeAttempt(partial, NOW)).toBe(
      'oggi alle 17:46 · iOS · in parte: tempo scaduto alla temperatura, tenute 12 richieste su 13, inviata, avvisi non scaricati',
    );
  });

  it('describes every stage of a reading', () => {
    expect(stageText('connecting')).toBe('durante il collegamento');
    expect(stageText('hrv:1')).toBe('alla variabilità del battito (HRV) di ieri');
    expect(stageText('sleep')).toBe('al sonno');
    expect(stageText('mystery')).toBe('');
  });
});
