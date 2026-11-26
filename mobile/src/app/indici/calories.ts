import { Profile } from '../settings/settings.model';

/** kcal bruciate per passo e per chilo di peso. Coefficiente iniziale, da tarare (docs/nuove-funzioni.md, sezione 5). */
export const KCAL_PER_STEP_PER_KG = 0.0005;

/** Quota aggiunta per la digestione sul totale di metabolismo e attività. Valore iniziale. */
export const DIGESTION_FACTOR = 0.1;

export interface DailyCalories {
  /** Metabolismo a riposo: le calorie che il corpo brucia anche stando fermo. */
  rest: number;
  /** Calorie dell'attività, stimate dai passi. */
  activity: number;
  /** Quota per la digestione. */
  digestion: number;
  total: number;
}

export function isProfileComplete(profile: Profile): boolean {
  return profile.birthYear !== null && profile.heightCm !== null && profile.weightKg !== null;
}

/** Età in anni interi, dall'anno di nascita. Approssimata: non si chiede il giorno. */
export function ageFromBirthYear(birthYear: number, today: Date): number {
  return today.getFullYear() - birthYear;
}

/** Metabolismo a riposo (formula di Mifflin-St Jeor). Sesso non indicato: media delle due formule. */
export function restingEnergy(profile: Required<{ [K in keyof Profile]: NonNullable<Profile[K]> }>, age: number): number {
  const base = 10 * profile.weightKg + 6.25 * profile.heightCm - 5 * age;
  switch (profile.sex) {
    case 'male':
      return base + 5;
    case 'female':
      return base - 161;
    default:
      return base + (5 - 161) / 2;
  }
}

/**
 * Calorie di un giorno intero. `null` se il profilo non è completo: senza età, altezza e peso
 * non si stima niente, invece di usare valori medi inventati.
 */
export function dailyCalories(profile: Profile, steps: number, today: Date): DailyCalories | null {
  if (profile.birthYear === null || profile.heightCm === null || profile.weightKg === null) {
    return null;
  }
  const complete = {
    sex: profile.sex,
    birthYear: profile.birthYear,
    heightCm: profile.heightCm,
    weightKg: profile.weightKg,
  };
  const rest = restingEnergy(complete, ageFromBirthYear(profile.birthYear, today));
  const activity = Math.max(0, steps) * profile.weightKg * KCAL_PER_STEP_PER_KG;
  const digestion = (rest + activity) * DIGESTION_FACTOR;
  return {
    rest: Math.round(rest),
    activity: Math.round(activity),
    digestion: Math.round(digestion),
    total: Math.round(rest + activity + digestion),
  };
}
