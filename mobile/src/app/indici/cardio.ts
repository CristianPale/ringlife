import { Sex } from '../settings/settings.model';

/**
 * Stime del cuore dall'età e dal battito a riposo (docs/adr/0031, formule in docs/scores.md). Si fanno sul telefono
 * perché servono l'età e il sesso del profilo, che non lasciano il telefono. Stime grezze, non misure né diagnosi.
 */

/** Battito massimo stimato dall'età (formula di Tanaka): 208 − 0,7 × età. */
export function estimatedMaxHr(age: number): number {
  return Math.round(208 - 0.7 * age);
}

/** VO2max stimato (formula di Uth e colleghi): 15,3 × battito massimo / battito a riposo, in ml/kg/min. */
export function estimatedVo2max(maxHr: number, restingHr: number): number {
  return (15.3 * maxHr) / restingHr;
}

/**
 * VO2max mediano (percentile 50) per età, dal registro FRIEND (Kaminsky e altri, Mayo Clinic Proceedings 2015,
 * tabella 3, test su tapis roulant), al centro di ogni decade dai 20 ai 79 anni.
 */
const DECADE_CENTERS = [25, 35, 45, 55, 65, 75] as const;
const FRIEND_MEDIAN: Record<'male' | 'female', readonly number[]> = {
  male: [48.0, 42.4, 37.8, 32.6, 28.2, 24.4],
  female: [37.6, 30.2, 26.7, 23.4, 20.0, 18.3],
};

/** Quanto si allarga l'età cardio fuori dalla tabella: sotto i 20 e sopra gli 80 si dice solo «meno di» o «più di». */
export const CARDIO_AGE_MIN = 20;
export const CARDIO_AGE_MAX = 80;

function medianCurve(sex: Sex): readonly number[] {
  if (sex === 'male' || sex === 'female') {
    return FRIEND_MEDIAN[sex];
  }
  // Sesso non indicato: la media delle due curve.
  return FRIEND_MEDIAN.male.map((v, i) => (v + FRIEND_MEDIAN.female[i]) / 2);
}

/** Il VO2max mediano a un'età, interpolato tra le decadi e prolungato con la pendenza del tratto più vicino. */
export function populationVo2max(age: number, sex: Sex): number {
  const curve = medianCurve(sex);
  const last = DECADE_CENTERS.length - 1;
  const i = age <= DECADE_CENTERS[0] ? 0 : age >= DECADE_CENTERS[last] ? last - 1 : DECADE_CENTERS.findIndex((c, k) => age < DECADE_CENTERS[k + 1]);
  const x0 = DECADE_CENTERS[i];
  const x1 = DECADE_CENTERS[i + 1];
  return curve[i] + ((curve[i + 1] - curve[i]) * (age - x0)) / (x1 - x0);
}

/**
 * L'età a cui il VO2max mediano della popolazione vale `vo2max`: la curva scende con l'età, quindi si inverte tratto per
 * tratto. Limitata tra `CARDIO_AGE_MIN` e `CARDIO_AGE_MAX`.
 */
export function cardioAgeFor(vo2max: number, sex: Sex): number {
  const curve = medianCurve(sex);
  const last = curve.length - 1;
  let i = curve.findIndex((v, k) => k < last && vo2max <= v && vo2max >= curve[k + 1]);
  if (i < 0) {
    i = vo2max > curve[0] ? 0 : last - 1;
  }
  const x0 = DECADE_CENTERS[i];
  const x1 = DECADE_CENTERS[i + 1];
  const age = x0 + ((vo2max - curve[i]) * (x1 - x0)) / (curve[i + 1] - curve[i]);
  return Math.min(CARDIO_AGE_MAX, Math.max(CARDIO_AGE_MIN, Math.round(age)));
}

/** Notti di battito a riposo guardate e minime per una stima. */
export const RESTING_NIGHTS = 14;
export const MIN_RESTING_NIGHTS = 5;

export interface CardioEstimate {
  age: number;
  maxHr: number;
  /** Mediana del battito a riposo delle ultime notti. */
  restingHr: number;
  nights: number;
  vo2max: number;
  cardioAge: number;
}

export type CardioResult =
  | { kind: 'ok'; estimate: CardioEstimate }
  | { kind: 'no-birth-year' }
  | { kind: 'few-nights'; nights: number };

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * L'età cardio dal profilo e dal battito a riposo delle notti (`restingHr`, dalla più vecchia; si usano le ultime
 * `RESTING_NIGHTS`). Senza anno di nascita o con poche notti non si stima niente.
 */
export function estimateCardio(birthYear: number | null, sex: Sex, restingHr: readonly number[], today: Date): CardioResult {
  if (birthYear === null) {
    return { kind: 'no-birth-year' };
  }
  const recent = restingHr.filter((v) => Number.isFinite(v) && v > 0).slice(-RESTING_NIGHTS);
  if (recent.length < MIN_RESTING_NIGHTS) {
    return { kind: 'few-nights', nights: recent.length };
  }
  const age = today.getFullYear() - birthYear;
  const maxHr = estimatedMaxHr(age);
  const rest = median(recent);
  const vo2max = estimatedVo2max(maxHr, rest);
  return {
    kind: 'ok',
    estimate: {
      age,
      maxHr,
      restingHr: Math.round(rest),
      nights: recent.length,
      vo2max: Math.round(vo2max * 10) / 10,
      cardioAge: cardioAgeFor(vo2max, sex),
    },
  };
}
