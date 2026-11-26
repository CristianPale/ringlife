import { Profile, Sex } from '../settings/settings.model';
import { MAX_SAMPLE_GAP_MS, zoneOf } from './hr-zones';
import { LiveSample } from './session.model';

// L'Allenamento (docs/adr/0042): funzioni pure, provate senza anello.

export const ACTIVITIES = [
  { code: 'camminata', label: 'Camminata' },
  { code: 'corsa', label: 'Corsa' },
  { code: 'bici', label: 'Bici' },
  { code: 'palestra', label: 'Palestra' },
  { code: 'altro', label: 'Altro' },
] as const;
export type Activity = (typeof ACTIVITIES)[number]['code'];

export function isActivity(value: unknown): value is Activity {
  return ACTIVITIES.some((a) => a.code === value);
}

export function activityLabel(activity: Activity): string {
  return ACTIVITIES.find((a) => a.code === activity)?.label ?? 'Altro';
}

/** Dove sta il battito rispetto alla zona obiettivo (1-5). */
export type TargetStanding = 'sotto' | 'dentro' | 'sopra';

export function targetStanding(bpm: number, maxHr: number, target: number): TargetStanding {
  const zone = zoneOf(bpm, maxHr);
  return zone < target ? 'sotto' : zone > target ? 'sopra' : 'dentro';
}

export function targetText(standing: TargetStanding): string {
  switch (standing) {
    case 'dentro':
      return 'Nella zona obiettivo';
    case 'sotto':
      return 'Sotto la zona obiettivo';
    case 'sopra':
      return 'Sopra la zona obiettivo';
  }
}

// ---- Calorie (Keytel e colleghi, 2005, modello senza VO2max) -------------------------------------------------------

export interface CalorieProfile {
  age: number;
  weightKg: number;
  sex: Sex;
}

/** Il profilo che serve alle calorie: età e peso. Senza, niente stima. */
export function calorieProfile(profile: Profile, year: number): CalorieProfile | null {
  if (profile.birthYear === null || profile.weightKg === null) {
    return null;
  }
  return { age: year - profile.birthYear, weightKg: profile.weightKg, sex: profile.sex };
}

/** Kilojoule al minuto per un battito: uomini e donne hanno due formule; senza sesso, la media. Mai sotto zero. */
export function keytelKjPerMin(bpm: number, p: CalorieProfile): number {
  const male = -55.0969 + 0.6309 * bpm + 0.1988 * p.weightKg + 0.2017 * p.age;
  const female = -20.4022 + 0.4472 * bpm - 0.1263 * p.weightKg + 0.074 * p.age;
  const value = p.sex === 'male' ? male : p.sex === 'female' ? female : (male + female) / 2;
  return Math.max(0, value);
}

export const KJ_PER_KCAL = 4.184;

/**
 * Kilocalorie di una sessione, arrotondate. Ogni battito vale fino al successivo, al massimo `MAX_SAMPLE_GAP_MS` (una
 * pausa non conta), l'ultimo un secondo: come il tempo nelle zone.
 */
export function sessionKcal(samples: readonly LiveSample[], profile: CalorieProfile): number {
  let kj = 0;
  samples.forEach((sample, i) => {
    const next = samples[i + 1];
    const span = next ? Math.min(Math.max(0, next.t - sample.t), MAX_SAMPLE_GAP_MS) : 1_000;
    kj += (keytelKjPerMin(sample.bpm, profile) * span) / 60_000;
  });
  return Math.round(kj / KJ_PER_KCAL);
}

// ---- Recupero del battito -------------------------------------------------------------------------------------------

/** Quanto dura il recupero dopo «Fine». */
export const RECOVERY_MS = 60_000;
/** Il battito di fine allenamento: la media degli ultimi secondi d'attività. */
export const RECOVERY_END_WINDOW_MS = 10_000;
/** Il battito dopo un minuto: la media dei secondi da 50 a 60 dopo la fine. */
export const RECOVERY_AFTER_FROM_MS = 50_000;

export interface HeartRateRecovery {
  /** Battito alla fine dell'attività. */
  end: number;
  /** Battito un minuto dopo. */
  after: number;
}

/**
 * Il recupero del battito: `active` sono i battiti dell'allenamento (millisecondi dall'inizio), `recovery` quelli dopo
 * «Fine» (millisecondi dalla fine). `null` se manca una delle due medie.
 */
export function heartRateRecovery(
  active: readonly LiveSample[],
  recovery: readonly LiveSample[],
): HeartRateRecovery | null {
  if (active.length === 0) {
    return null;
  }
  const last = active[active.length - 1].t;
  const tail = active.filter((s) => last - s.t <= RECOVERY_END_WINDOW_MS).map((s) => s.bpm);
  const after = recovery
    .filter((s) => s.t >= RECOVERY_AFTER_FROM_MS && s.t <= RECOVERY_MS)
    .map((s) => s.bpm);
  if (after.length === 0) {
    return null;
  }
  const mean = (list: readonly number[]) =>
    Math.round(list.reduce((a, b) => a + b, 0) / list.length);
  return { end: mean(tail), after: mean(after) };
}

/** «Sceso di 22 battiti in un minuto, da 142 a 120.» */
export function recoveryText(r: HeartRateRecovery): string {
  const drop = r.end - r.after;
  if (drop > 0) {
    return `Sceso di ${drop} battiti in un minuto, da ${r.end} a ${r.after}.`;
  }
  return drop === 0
    ? `Rimasto a ${r.end} battiti al minuto dopo un minuto.`
    : `Salito di ${-drop} battiti in un minuto, da ${r.end} a ${r.after}.`;
}

// ---- Minuti per settimana ---------------------------------------------------------------------------------------------

export interface WeekMinutes {
  /** Il lunedì della settimana, a mezzanotte locale. */
  start: Date;
  /** «17 nov». */
  label: string;
  minutes: number;
}

function mondayOf(date: Date): Date {
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  day.setDate(day.getDate() - ((day.getDay() + 6) % 7));
  return day;
}

/** I minuti di allenamento delle ultime `weeks` settimane, da lunedì a domenica, dalla più vecchia a questa. */
export function weeklyMinutes(
  sessions: readonly { start: number; durationMs: number }[],
  now: Date,
  weeks = 8,
): WeekMinutes[] {
  const thisWeek = mondayOf(now);
  const format = new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'short' });
  return Array.from({ length: weeks }, (_, i) => {
    const start = new Date(thisWeek);
    start.setDate(start.getDate() - 7 * (weeks - 1 - i));
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    const ms = sessions
      .filter((s) => s.start >= start.getTime() && s.start < end.getTime())
      .reduce((sum, s) => sum + s.durationMs, 0);
    return { start, label: format.format(start), minutes: Math.round(ms / 60_000) };
  });
}
