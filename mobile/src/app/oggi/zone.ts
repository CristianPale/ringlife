/** Zone di un indice (docs/design/analisi.md, sezione 5.1). «alto» è solo del rischio emicrania. */
export type Zone = 'ottimo' | 'buono' | 'attenzione' | 'alto';

export const ZONE_LABELS: Record<Zone, string> = {
  ottimo: 'Ottimo',
  buono: 'Buono',
  attenzione: 'Attenzione',
  alto: 'Alto',
};

/** Soglie iniziali: 85-100 ottimo, 70-84 buono, sotto 70 attenzione. Da tarare. */
export function zoneForScore(score: number): Zone {
  if (score >= 85) {
    return 'ottimo';
  }
  if (score >= 70) {
    return 'buono';
  }
  return 'attenzione';
}
