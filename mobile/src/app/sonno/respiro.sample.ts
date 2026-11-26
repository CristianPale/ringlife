import { BreathingResult } from './respiro.model';
/** Mediane SpO2 SINTETICHE delle notti precedenti, dalla più vecchia: 96-98%, ripetibili. */
function history(nights: number): number[] {
  let state = 17;
  const values: number[] = [];
  for (let i = 0; i < nights; i++) {
    state = (state * 1103515245 + 12345) % 2147483648;
    const r = state / 2147483648;
    values.push(r < 0.15 ? 95 : r < 0.55 ? 96 : r < 0.9 ? 97 : 98);
  }
  return values;
}

/** Stanotte: 42 misure, quasi tutte 95-97%, con un minimo a 91%. */
const TONIGHT: number[] = [
  ...Array(12).fill(96),
  ...Array(14).fill(97),
  ...Array(10).fill(95),
  96,
  96,
  94,
  93,
  91,
  95,
];

export interface RespiroData {
  /** Misure SpO2 di stanotte, in %. Vuoto quando il risultato arriva già calcolato dal server. */
  tonight: readonly number[];
  /** Mediane delle 89 notti precedenti, dalla più vecchia. */
  history: readonly number[];
  /** Risultato già calcolato dal server: se c'è, `tonight` non serve. */
  result?: BreathingResult;
  /** `esempio` finché il telefono non è collegato a un server: la schermata lo dice. */
  source: 'esempio' | 'server';
}

export const RESPIRO_SAMPLE: RespiroData = { tonight: TONIGHT, history: history(89), source: 'esempio' };
