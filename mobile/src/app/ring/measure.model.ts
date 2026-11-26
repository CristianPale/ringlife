import { MetricName } from '../api/api.model';

/**
 * Le misure che l'anello fa a comando, in circa 30 secondi (un minuto l'HRV): «Misura ora» (docs/adr/0039). Ognuna è un
 * tipo della misura in tempo reale `69 <tipo>` (docs/protocol.md).
 */
export type MeasureKind = 'heartRate' | 'spo2' | 'hrv' | 'stress' | 'temperature';

/** L'ordine della pagina «Misura ora». */
export const MEASURE_KINDS: readonly MeasureKind[] = ['heartRate', 'spo2', 'hrv', 'stress', 'temperature'];

/** La metrica dell'API con lo stesso significato: serve al controllo dei valori impossibili (`sample-contract.ts`). */
export const MEASURE_METRIC: Record<MeasureKind, MetricName> = {
  heartRate: 'HR',
  spo2: 'SPO2',
  hrv: 'HRV',
  stress: 'STRESS',
  temperature: 'TEMP',
};
