import { arcPath, clockText, describeGiro, localMinutes, normalizeMinutes, pointAt, tickLine } from './giro';

describe('normalizeMinutes', () => {
  it('riporta gli orari nelle 24 ore', () => {
    expect(normalizeMinutes(-20)).toBe(1420);
    expect(normalizeMinutes(1500)).toBe(60);
    expect(normalizeMinutes(0)).toBe(0);
  });
});

describe('pointAt', () => {
  it('mette mezzanotte in alto e le sei a destra', () => {
    expect(pointAt(0)).toEqual({ x: 108, y: 12 });
    expect(pointAt(360)).toEqual({ x: 204, y: 108 });
    expect(pointAt(720)).toEqual({ x: 108, y: 204 });
    expect(pointAt(1080)).toEqual({ x: 12, y: 108 });
  });

  it('riproduce l’adesso del disegno (07:42)', () => {
    expect(pointAt(7 * 60 + 42)).toEqual({ x: 194.65, y: 149.33 });
  });
});

describe('arcPath', () => {
  it('disegna il sonno abituale a cavallo della mezzanotte (23:40-07:00)', () => {
    expect(arcPath({ startMin: -20, endMin: 420 })).toBe('M99.63 12.37A96 96 0 0 1 200.73 132.85');
  });

  it('gira dall’altra parte quando l’arco supera mezzo giro', () => {
    expect(arcPath({ startMin: 0, endMin: 1000 })).toContain(' 0 1 1 ');
    expect(arcPath({ startMin: 0, endMin: 300 })).toContain(' 0 0 1 ');
  });

  it('accetta un inizio negativo e una fine oltre le 24 ore', () => {
    expect(arcPath({ startMin: -20, endMin: 420 })).toBe(arcPath({ startMin: 1420, endMin: 1860 }));
  });

  it('riproduce la finestra caffeina del disegno (9:00-14:30)', () => {
    expect(arcPath({ startMin: 540, endMin: 870 })).toBe('M175.88 175.88A96 96 0 0 1 49.56 184.16');
  });
});

describe('tickLine', () => {
  it('va dal raggio 88 al 104', () => {
    expect(tickLine(-20)).toEqual({ x1: 100.33, y1: 20.33, x2: 98.94, y2: 4.4 });
  });
});

describe('clockText', () => {
  it('scrive l’orario con due cifre, anche prima di mezzanotte', () => {
    expect(clockText(425)).toBe('07:05');
    expect(clockText(-20)).toBe('23:40');
  });
});

describe('describeGiro', () => {
  it('dice a parole sonno, orario abituale, caffeina e adesso', () => {
    const text = describeGiro(
      {
        usual: { startMin: -20, endMin: 420 },
        sleep: { startMin: 48, endMin: 425 },
        caffeine: { startMin: 540, endMin: 870 },
        nowMin: 462,
      },
      'Recupero 64, peggio del solito.',
    );
    expect(text).toContain('Sonno dalle 00:48 alle 07:05.');
    expect(text).toContain('Di solito dalle 23:40 alle 07:00.');
    expect(text).toContain('Finestra della caffeina dalle 09:00 alle 14:30.');
    expect(text).toContain('Adesso sono le 07:42.');
    expect(text.endsWith('Recupero 64, peggio del solito.')).toBe(true);
  });

  it('salta quello che non c’è', () => {
    const text = describeGiro({ usual: null, sleep: null, caffeine: null, nowMin: 60 }, 'In calibrazione.');
    expect(text).toBe('Giro delle 24 ore. Adesso sono le 01:00. In calibrazione.');
  });
});

describe('localMinutes', () => {
  it('conta i minuti dalla mezzanotte di Roma, ora legale compresa', () => {
    expect(localMinutes(new Date('2026-11-03T06:42:00Z'))).toBe(7 * 60 + 42);
    expect(localMinutes(new Date('2026-07-03T05:42:00Z'))).toBe(7 * 60 + 42);
    expect(localMinutes(new Date('2026-11-02T23:00:00Z'))).toBe(0);
  });
});
