import { LiveSample } from './session.model';

/**
 * Zone del battito in percentuale del battito massimo stimato dall'età (docs/adr/0031). Sotto la zona 1 non si conta
 * come allenamento.
 */
export interface HrZone {
  /** 1-5. */
  zone: number;
  name: string;
  /** Inizio della zona, frazione del battito massimo. */
  from: number;
  to: number;
}

export const HR_ZONES: readonly HrZone[] = [
  { zone: 1, name: 'molto leggera', from: 0.5, to: 0.6 },
  { zone: 2, name: 'leggera', from: 0.6, to: 0.7 },
  { zone: 3, name: 'moderata', from: 0.7, to: 0.8 },
  { zone: 4, name: 'intensa', from: 0.8, to: 0.9 },
  { zone: 5, name: 'massima', from: 0.9, to: 1 },
];

/** La zona di un battito: 0 sotto la zona 1, 5 anche sopra il massimo stimato. */
export function zoneOf(bpm: number, maxHr: number): number {
  const share = bpm / maxHr;
  let zone = 0;
  for (const z of HR_ZONES) {
    if (share >= z.from) {
      zone = z.zone;
    }
  }
  return zone;
}

/** «Zona 3 · moderata, 70-80% del massimo» o «Sotto la zona 1». */
export function zoneLabel(zone: number): string {
  const z = HR_ZONES[zone - 1];
  return z ? `Zona ${z.zone} · ${z.name}, ${Math.round(z.from * 100)}-${Math.round(z.to * 100)}% del massimo` : 'Sotto la zona 1';
}

/** I battiti al minuto dove comincia ogni zona, per un battito massimo. */
export function zoneBounds(maxHr: number): { zone: number; from: number; to: number }[] {
  return HR_ZONES.map((z) => ({ zone: z.zone, from: Math.round(z.from * maxHr), to: Math.round(z.to * maxHr) }));
}

/** Un battito vale fino al successivo, ma non oltre questo: un buco nel segnale non diventa tempo in una zona. */
export const MAX_SAMPLE_GAP_MS = 5_000;

/**
 * Millisecondi passati in ogni zona, indice 0 = sotto la zona 1, 1-5 = zone. Ogni battito vale fino al successivo
 * (al massimo `MAX_SAMPLE_GAP_MS`); l'ultimo vale un secondo.
 */
export function timeInZones(samples: readonly LiveSample[], maxHr: number): number[] {
  const totals = [0, 0, 0, 0, 0, 0];
  samples.forEach((sample, i) => {
    const next = samples[i + 1];
    const span = next ? Math.min(Math.max(0, next.t - sample.t), MAX_SAMPLE_GAP_MS) : 1_000;
    totals[zoneOf(sample.bpm, maxHr)] += span;
  });
  return totals;
}
