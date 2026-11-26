import { readCards, readInsights } from './plugin.model';

describe('readCards', () => {
  it('reads the five card types', () => {
    const cards = readCards([
      { type: 'score', title: 'Sonno', value: 80.4, zone: 'buono', caption: 'ok' },
      { type: 'trend', title: 'Passi', points: [1, null, 3], unit: 'passi', caption: null },
      { type: 'list', title: 'Riepilogo', rows: [{ label: 'Giorni', value: '7' }] },
      { type: 'text', title: null, body: 'Un testo' },
      { type: 'action', label: 'Apri il diario', action: 'open-diary' },
    ]);
    expect(cards.map((c) => c.type)).toEqual(['score', 'trend', 'list', 'text', 'action']);
    expect(cards[0]).toMatchObject({ value: 80, caption: 'ok' });
    expect(cards[1]).toMatchObject({ points: [1, null, 3] });
  });

  it('ignores a card type it does not know, so a newer server does not break an older app', () => {
    const cards = readCards([{ type: 'hologram', title: 'x' }, { type: 'text', title: null, body: 'resta' }]);
    expect(cards).toHaveLength(1);
    expect(cards[0].type).toBe('text');
  });

  it('drops malformed cards instead of drawing them', () => {
    expect(
      readCards([
        null,
        'testo',
        { type: 'score', title: 'x', value: 101, zone: 'buono' },
        { type: 'score', title: 'x', value: 50, zone: 'rosso' },
        { type: 'score', title: '', value: 50, zone: 'buono' },
        { type: 'trend', title: 'x', points: 'no' },
        { type: 'list', rows: [] },
        { type: 'text', body: '  ' },
      ]),
    ).toEqual([]);
  });

  it('never lets a server send the user anywhere: an action must be one of the app\'s own', () => {
    expect(readCards([{ type: 'action', label: 'Vai', action: 'https://example.org' }])).toEqual([]);
    expect(readCards([{ type: 'action', label: 'Vai', action: 'open-diary' }])).toHaveLength(1);
  });

  it('keeps only the list rows that have a label and a value', () => {
    const [card] = readCards([
      { type: 'list', title: 'T', rows: [{ label: 'a', value: '1' }, { label: '', value: '2' }, { label: 'c' }, 5] },
    ]);
    expect(card).toMatchObject({ rows: [{ label: 'a', value: '1' }] });
  });

  it('turns non-numeric trend points into gaps', () => {
    const [card] = readCards([{ type: 'trend', title: 'T', points: [1, 'x', null, Infinity, 2] }]);
    expect(card).toMatchObject({ points: [1, null, null, null, 2] });
  });
});

describe('readInsights', () => {
  it('keeps well-formed insights and drops the rest', () => {
    expect(
      readInsights([
        { level: 'info', title: 'A', text: 'b' },
        { level: 'grave', title: 'A', text: 'b' },
        { level: 'attenzione', title: '', text: 'b' },
        null,
      ]),
    ).toEqual([{ level: 'info', title: 'A', text: 'b' }]);
  });
});
