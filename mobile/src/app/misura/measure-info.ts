import { MeasureKind } from '../ring/measure.model';

// I testi della pagina «Misura ora» (docs/adr/0039): fuori da `measure.model.ts`, che usa anche la sincronizzazione,
// così restano nel pezzo dell'app caricato con la pagina.

export interface MeasureInfo {
  /** Nome esteso, con la sigla tra parentesi dove c'è. */
  name: string;
  /** Che cosa misura, in una frase. */
  help: string;
  /** Quanto dura, detto a parole. */
  duration: string;
}

export const MEASURES: Record<MeasureKind, MeasureInfo> = {
  heartRate: {
    name: 'Battito',
    help: 'Quanti battiti fa il cuore in un minuto (bpm, battiti al minuto). Da fermo è il tuo battito a riposo.',
    duration: 'circa 30 secondi',
  },
  spo2: {
    name: 'Ossigeno nel sangue (SpO2, saturazione)',
    help: 'La percentuale di ossigeno che il sangue trasporta. Dal dito è una stima approssimata.',
    duration: 'circa 30 secondi',
  },
  hrv: {
    name: 'Variabilità della frequenza cardiaca (HRV)',
    help: 'Quanto varia il tempo tra un battito e il successivo, in millisecondi (ms). Da fermo, più è alta, più il corpo è rilassato.',
    duration: 'circa un minuto',
  },
  stress: {
    name: 'Stress',
    help: "Lo stress che l'anello stima dal battito, da 0 a 100: più è alto, più il corpo è sotto sforzo.",
    duration: 'circa 30 secondi',
  },
  temperature: {
    name: 'Temperatura',
    help: "La temperatura che l'anello stima dalla pelle del dito. Non è la misura di un termometro.",
    duration: 'circa 30 secondi',
  },
};

/** Il valore con la sua unità: «72 battiti al minuto», «97 %», «46 ms», «37 su 100», «36,6 °C». */
export function measureText(kind: MeasureKind, value: number): string {
  switch (kind) {
    case 'heartRate':
      return `${Math.round(value)} battiti al minuto`;
    case 'spo2':
      return `${Math.round(value)} %`;
    case 'hrv':
      return `${Math.round(value)} ms`;
    case 'stress':
      return `${Math.round(value)} su 100`;
    case 'temperature':
      return `${value.toFixed(1).replace('.', ',')} °C`;
  }
}
