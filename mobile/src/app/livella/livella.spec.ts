import { bubblePosition, livellaLayout, standingOf, usualRange } from './livella';

describe('standingOf', () => {
  it('sta dentro il solito fino alle tacche, estremi compresi', () => {
    expect(standingOf(0)).toBe('solito');
    expect(standingOf(1.5)).toBe('solito');
    expect(standingOf(-1.5)).toBe('solito');
  });

  it('oltre le tacche è meglio o peggio, con il verso della metrica', () => {
    expect(standingOf(1.6)).toBe('meglio');
    expect(standingOf(-1.6)).toBe('peggio');
    // Battito a riposo: più basso è meglio.
    expect(standingOf(1.6, 'down')).toBe('peggio');
    expect(standingOf(-1.6, 'down')).toBe('meglio');
  });
});

describe('standingOf, senza un verso migliore', () => {
  it('non dice mai peggio né meglio, neanche fuori dalle tacche', () => {
    expect(standingOf(-3, 'neutral')).toBe('solito');
    expect(standingOf(3, 'neutral')).toBe('solito');
  });
});

describe('bubblePosition', () => {
  it('va da 0 a 1 sul tubo e non esce dagli estremi', () => {
    expect(bubblePosition(-3)).toBe(0);
    expect(bubblePosition(0)).toBe(0.5);
    expect(bubblePosition(3)).toBe(1);
    expect(bubblePosition(-7)).toBe(0);
    expect(bubblePosition(9)).toBe(1);
  });

  it('mette le tacche a un quarto e a tre quarti', () => {
    expect(bubblePosition(-1.5)).toBe(0.25);
    expect(bubblePosition(1.5)).toBe(0.75);
  });
});

describe('livellaLayout', () => {
  it('riproduce il disegno da 120 px: fascia da 30 a 90', () => {
    const layout = livellaLayout(120, -1.9);
    expect(layout.usualX).toBe(30);
    expect(layout.usualWidth).toBe(60);
    expect(layout.bubbleX).toBe(22);
  });

  it('tiene la bolla dentro il tubo agli estremi', () => {
    expect(livellaLayout(120, -3).bubbleX).toBe(5);
    expect(livellaLayout(120, 3).bubbleX).toBe(115);
  });

  it('in calibrazione non ha la bolla', () => {
    expect(livellaLayout(120, null).bubbleX).toBeNull();
  });
});

describe('usualRange', () => {
  it('va da mediana meno a mediana più 1,5 unità', () => {
    const range = usualRange(74, 5.4);
    expect(range?.low).toBeCloseTo(65.9, 5);
    expect(range?.high).toBeCloseTo(82.1, 5);
  });

  it('senza unità dal server non c’è fascia in numeri', () => {
    expect(usualRange(74, undefined)).toBeNull();
    expect(usualRange(74, 0)).toBeNull();
  });
});
