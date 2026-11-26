import { MetricName, SamplePayload } from '../api/api.model';

/**
 * Valori plausibili per metrica, estremi inclusi (docs/api.md, «Cosa significa ogni campione»). Il server accetta
 * qualsiasi numero: qui si scarta prima dell'invio ciò che non può essere una misura vera, cosi' un parser sbagliato
 * (un byte al posto di due, una scala diversa) si nota subito invece di sporcare le baseline.
 */
export const PLAUSIBLE_RANGE: Record<MetricName, readonly [number, number]> = {
  HR: [30, 230],
  SPO2: [70, 100],
  STRESS: [0, 100],
  HRV: [1, 300],
  TEMP: [25, 42],
  STEPS: [0, 20_000],
  CALORIES: [0, 10_000],
};

export function isPlausible(sample: SamplePayload): boolean {
  const range = PLAUSIBLE_RANGE[sample.metric];
  return range !== undefined && Number.isFinite(sample.value) && sample.value >= range[0] && sample.value <= range[1];
}

export function splitPlausible(samples: readonly SamplePayload[]): { kept: SamplePayload[]; rejected: SamplePayload[] } {
  const kept: SamplePayload[] = [];
  const rejected: SamplePayload[] = [];
  for (const sample of samples) {
    (isPlausible(sample) ? kept : rejected).push(sample);
  }
  return { kept, rejected };
}
