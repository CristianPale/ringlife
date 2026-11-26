import { bodyRows } from '../sonno/sonno.rows';
import { OggiSample } from './oggi.model';

/**
 * Dati SINTETICI per sviluppare la schermata prima che esistano sync e backend.
 * Il riepilogo e gli indici arriveranno dal backend (ADR 0006); qui sono valori di esempio.
 */
export const OGGI_SAMPLE: OggiSample = {
  date: new Date('2026-11-03T08:00:00+01:00'),
  batteryPercent: 62,
  syncText: 'Sincronizzato alle 07:41',
  summary: [
    { text: 'Hai dormito 5 h 52 e la variabilità del battito (HRV) è ' },
    { text: 'sotto la tua media', tone: 'peggio' },
    { text: '. Oggi recuperi meno del solito.' },
  ],
  summaryDetail: [{ text: 'Debito di sonno: 4 h 10 negli ultimi 7 giorni.' }],
  calibration: null,
  night: bodyRows(
    { restingHr: 52, hrv: 38, tempDeviation: 0.2, spo2: 96 },
    { restingHr: 0.4, hrv: -1.8, temp: 0.8, spo2: -0.4 },
  ),
  recupero: { domain: 'recupero', label: 'Recupero', value: 64, deviation: -1.9, calibrationDays: 28 },
  sonno: { domain: 'sonno', label: 'Sonno', value: 62, deviation: -2.65, calibrationDays: 28 },
  movimento: { steps: 1240, goal: 8000 },
  stress: { domain: 'stress', label: 'Stress, ieri', value: 74, deviation: 0.2, calibrationDays: 28 },
  giro: {
    usual: { startMin: -20, endMin: 420 },
    sleep: { startMin: 48, endMin: 425 },
    caffeine: { startMin: 540, endMin: 870 },
    nowMin: 462,
  },
};
