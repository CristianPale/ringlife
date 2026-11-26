import { GiroData } from '../livella/giro';
import { MeasureRowData } from '../shared/measure-row.component';

export type ScoreDomain = 'recupero' | 'sonno' | 'stress';

/**
 * Un pezzo del riepilogo. Il tono colora solo le parole che dicono come stai rispetto alla tua media
 * (ADR 0020): ambra se peggio, verde se meglio. Mai il nome di un indice.
 */
export interface SummarySegment {
  text: string;
  tone?: 'peggio' | 'meglio';
}

/** Una riga di indice 0-100: nome, numero e dove sta rispetto alla tua media. */
export interface ScoreRowData {
  domain: ScoreDomain;
  label: string;
  value: number;
  /** Scostamento dalla tua media, da −3 a 3. `null` finché non ci sono almeno 7 giorni (calibrazione). */
  deviation: number | null;
  /** Giorni con questo indice prima di oggi: dice a che punto è la calibrazione. */
  calibrationDays: number;
}

export interface MovementRowData {
  steps: number;
  goal: number;
}

export interface OggiData {
  date: Date;
  batteryPercent: number;
  syncText: string;
  summary: readonly SummarySegment[];
  summaryDetail: readonly SummarySegment[];
  /** `null`: il server non l'ha ancora calcolato. Mai un valore d'esempio al suo posto (solo senza server). */
  recupero: ScoreRowData | null;
  sonno: ScoreRowData | null;
  movimento: MovementRowData | null;
  stress: ScoreRowData | null;
  /** Le misure del corpo di stanotte (battito a riposo, HRV, temperatura, SpO2). Vuoto senza misure. */
  night: readonly MeasureRowData[];
  /** «Dati in calibrazione: mancano N notti». `null` quando la tua media è pronta, o senza server (dati d'esempio). */
  calibration: { nightsToGo: number } | null;
  /** Il giro delle 24 ore in testa a Oggi. */
  giro: GiroData;
}

/** I dati d'esempio: tutte le righe presenti. Si usano solo finché il telefono non è collegato a un server. */
export type OggiSample = OggiData & {
  recupero: ScoreRowData;
  sonno: ScoreRowData;
  movimento: MovementRowData;
  stress: ScoreRowData;
};
