import { durationReading, measureWords, signedDegrees } from './measure';

const WORDING = { below: 'Più bassa del solito', above: 'Più alta del solito' };

describe('measureWords', () => {
  it('dice che cos’è la misura quando sta dentro le tacche', () => {
    expect(measureWords(0.4, 'up', 'Media della notte', WORDING)).toEqual({ sub: 'Media della notte', tone: null });
    expect(measureWords(-1.5, 'up', 'Media della notte', WORDING)).toEqual({ sub: 'Media della notte', tone: null });
  });

  it('dice come sta rispetto al solito fuori dalle tacche, in ambra se peggio', () => {
    expect(measureWords(-1.8, 'up', 'x', WORDING)).toEqual({ sub: 'Più bassa del solito', tone: 'peggio' });
    expect(measureWords(2, 'up', 'x', WORDING)).toEqual({ sub: 'Più alta del solito', tone: 'meglio' });
  });

  it('segue il verso della misura: un battito più basso è meglio', () => {
    expect(measureWords(-2, 'down', 'x', WORDING).tone).toBe('meglio');
    expect(measureWords(2, 'down', 'x', WORDING).tone).toBe('peggio');
  });

  it('non colora una misura senza un verso migliore', () => {
    expect(measureWords(-2, 'neutral', 'x', WORDING)).toEqual({ sub: 'Più bassa del solito', tone: null });
  });

  it('senza media dice che è in calibrazione', () => {
    expect(measureWords(null, 'up', 'x', WORDING)).toEqual({ sub: 'In calibrazione', tone: null });
  });
});

describe('durationReading', () => {
  it('scrive i minuti sotto l’ora e le ore con i due punti sopra', () => {
    expect(durationReading(48)).toEqual({ value: '48', unit: 'minuti' });
    expect(durationReading(1)).toEqual({ value: '1', unit: 'minuto' });
    expect(durationReading(248)).toEqual({ value: '4:08', unit: 'ore' });
    expect(durationReading(60)).toEqual({ value: '1:00', unit: 'ore' });
  });
});

describe('signedDegrees', () => {
  it('mette il segno e la virgola', () => {
    expect(signedDegrees(0.2)).toBe('+0,2');
    expect(signedDegrees(-0.44)).toBe('−0,4');
    expect(signedDegrees(0)).toBe('0,0');
  });
});
