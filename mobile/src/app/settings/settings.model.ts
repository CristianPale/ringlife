import { HabitualCaffeine, normalizeHabits } from '../diary/habits';

export type ThemeChoice = 'system' | 'dark' | 'light';

export const PLUGIN_IDS = [
  'migraine',
  'caffeine-window',
  'circadian',
  'social-jetlag',
  'vitamin-d',
  'weekly-report',
  'training',
] as const;
export type PluginId = (typeof PLUGIN_IDS)[number];

export interface RingSettings {
  /** Ogni quanti minuti l'anello misura il battito. */
  hrIntervalMin: number;
  stress: boolean;
  spo2: boolean;
  /** Variabilità del battito (HRV), misurata dall'anello soprattutto di notte. */
  hrv: boolean;
  /** Temperatura della pelle del dito: conta solo la deviazione dalla tua media. */
  temperature: boolean;
}

export type WearHand = 'left' | 'right';
export type WearFinger = 'index' | 'middle' | 'ring';

/**
 * Dove si porta l'anello (docs/adr/0030). All'anello non serve: conta per i dati (aderenza, temperatura del dito,
 * movimenti della mano). `changedAt`: quando l'utente l'ha cambiato l'ultima volta, ms, `null` se mai.
 */
export interface Wear {
  hand: WearHand;
  finger: WearFinger;
  changedAt: number | null;
}

export type Sex = 'male' | 'female' | 'unspecified';

/**
 * Profilo per stimare le calorie. Dati personali di salute: restano sul telefono (e poi sul tuo server),
 * mai in fixture, `docs/` o repo. Ogni campo può mancare.
 */
export interface Profile {
  sex: Sex;
  birthYear: number | null;
  heightCm: number | null;
  weightKg: number | null;
}

export const BIRTH_YEAR_MIN = 1920;
export const BIRTH_YEAR_MAX = 2020;
export const HEIGHT_MIN_CM = 100;
export const HEIGHT_MAX_CM = 230;
export const WEIGHT_MIN_KG = 30;
export const WEIGHT_MAX_KG = 250;

export type ProfileNumberField = 'birthYear' | 'heightCm' | 'weightKg';

export const PROFILE_LIMITS: Record<ProfileNumberField, readonly [number, number]> = {
  birthYear: [BIRTH_YEAR_MIN, BIRTH_YEAR_MAX],
  heightCm: [HEIGHT_MIN_CM, HEIGHT_MAX_CM],
  weightKg: [WEIGHT_MIN_KG, WEIGHT_MAX_KG],
};

/** Lettura in background: `intervalMin` è il minimo tra due letture (0 = spenta); iOS decide quando. */
export interface BackgroundSettings {
  intervalMin: number;
  /** Notifica al 20% e al 10% di batteria. */
  batteryAlerts: boolean;
  /** Notifica se nessuno legge l'anello per 24 ore (docs/adr/0045). */
  ringWatch: boolean;
}

export const BACKGROUND_INTERVALS: readonly number[] = [0, 30, 60, 120, 240];

export interface Settings {
  /** Obiettivo di sonno, in minuti. */
  sleepGoalMin: number;
  /** A letto entro, «HH:mm». */
  bedtime: string;
  /** Risveglio abituale, «HH:mm». */
  wakeTime: string;
  stepsGoal: number;
  theme: ThemeChoice;
  /** Palette Penombra durante un episodio di cefalea. */
  penombra: boolean;
  ring: RingSettings;
  /** Mano e dito su cui si porta l'anello. */
  wear: Wear;
  plugins: Record<PluginId, boolean>;
  /**
   * Parametri dei plugin scelti a mano, per plugin (docs/adr/0025). Un parametro collegato a Obiettivi (risveglio,
   * coricarsi, obiettivo di sonno) segue Obiettivi finché non è qui.
   */
  pluginOverrides: Record<string, string[]>;
  /** Lettura dell'anello in background e avvisi della batteria (docs/adr/0026). */
  background: BackgroundSettings;
  /** Caffeina presa ogni giorno alla stessa ora: il Diario la segna da solo (docs/adr/0036). */
  habitualCaffeine: HabitualCaffeine[];
  /** Indirizzo del server di casa. Vuoto finché non è configurato. */
  serverUrl: string;
  /**
   * Indirizzo facoltativo dello stesso server sulla rete di casa, in HTTP (docs/adr/0012). Si prova solo se l'indirizzo
   * HTTPS non risponde. Vuoto = disattivato.
   */
  homeUrl: string;
  /**
   * Usa l'anello di prova (dati inventati) al posto dell'anello vero, per provare tutto il percorso senza averlo
   * (docs/adr/0018). Spento di predefinito.
   */
  demoRing: boolean;
  /** L'assistente di prima configurazione è finito (docs/adr/0022). Sul telefono, senza, non si entra in Oggi. */
  onboarded: boolean;
  profile: Profile;
}

export const SLEEP_GOAL_MIN = 5 * 60;
export const SLEEP_GOAL_MAX = 10 * 60;
export const SLEEP_GOAL_STEP = 30;
export const STEPS_GOAL_MIN = 1000;
export const STEPS_GOAL_MAX = 50000;
export const HR_INTERVALS: readonly number[] = [1, 5, 10, 15, 30, 60];

export const DEFAULT_SETTINGS: Settings = {
  sleepGoalMin: 8 * 60,
  bedtime: '23:30',
  wakeTime: '07:00',
  stepsGoal: 8000,
  theme: 'system',
  penombra: true,
  ring: { hrIntervalMin: 5, stress: true, spo2: true, hrv: true, temperature: true },
  // Il consiglio più comune: l'indice della mano che si usa di meno (per i più, la sinistra).
  wear: { hand: 'left', finger: 'index', changedAt: null },
  plugins: {
    migraine: true,
    'caffeine-window': true,
    circadian: true,
    'social-jetlag': true,
    'vitamin-d': true,
    'weekly-report': true,
    training: true,
  },
  pluginOverrides: {},
  background: { intervalMin: 60, batteryAlerts: true, ringWatch: true },
  habitualCaffeine: [],
  serverUrl: '',
  homeUrl: '',
  demoRing: false,
  onboarded: false,
  profile: { sex: 'unspecified', birthYear: null, heightCm: null, weightKg: null },
};

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isValidTime(value: unknown): value is string {
  return typeof value === 'string' && TIME_PATTERN.test(value);
}

function intInRange(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback;
}

/** Numero intero nei limiti, altrimenti `null` (campo non compilato o fuori scala). */
function optionalInt(value: unknown, min: number, max: number): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? Math.round(value) : null;
}

/** Peso in chili con un decimale, nei limiti, altrimenti `null`. */
function optionalWeight(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= WEIGHT_MIN_KG && value <= WEIGHT_MAX_KG
    ? Math.round(value * 10) / 10
    : null;
}

/** Indirizzo valido: vuoto, oppure un URL http(s) senza spazi. Altrimenti vuoto. */
export function normalizeServerUrl(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }
  const trimmed = value.trim();
  if (trimmed === '') {
    return '';
  }
  try {
    const url = new URL(trimmed);
    return url.protocol === 'https:' || url.protocol === 'http:' ? trimmed.replace(/\/+$/, '') : '';
  } catch {
    return '';
  }
}

/** Indirizzo IPv4 di una rete locale: privato (10/8, 172.16/12, 192.168/16) o di collegamento locale (169.254/16). */
function isPrivateIPv4(host: string): boolean {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!match) {
    return false;
  }
  const parts = match.slice(1).map(Number);
  if (parts.some((part) => part > 255)) {
    return false;
  }
  const [a, b] = parts;
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
}

/** Un indirizzo che sta sulla rete di casa: IPv4 privato oppure un nome `.local`. Mai un indirizzo pubblico. */
export function isHomeNetworkHost(host: string): boolean {
  const lower = host.toLowerCase();
  return isPrivateIPv4(lower) || /^[a-z0-9-]+(\.[a-z0-9-]+)*\.local$/.test(lower);
}

/**
 * Indirizzo di casa valido: vuoto, oppure `http://` verso una rete locale, senza utente né password. Altrimenti vuoto.
 * Il traffico in HTTP non deve mai poter partire verso internet (docs/adr/0012).
 */
export function normalizeHomeUrl(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }
  const trimmed = value.trim();
  if (trimmed === '') {
    return '';
  }
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'http:' || url.username !== '' || url.password !== '' || !isHomeNetworkHost(url.hostname)) {
      return '';
    }
    return trimmed.replace(/\/+$/, '');
  } catch {
    return '';
  }
}

/** Controlla le impostazioni lette dall'archivio: ogni campo illeggibile torna al valore predefinito. */
export function normalizeSettings(raw: unknown): Settings {
  const input = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const ring = typeof input['ring'] === 'object' && input['ring'] !== null ? (input['ring'] as Record<string, unknown>) : {};
  const plugins =
    typeof input['plugins'] === 'object' && input['plugins'] !== null ? (input['plugins'] as Record<string, unknown>) : {};
  const defaults = DEFAULT_SETTINGS;
  const profile =
    typeof input['profile'] === 'object' && input['profile'] !== null ? (input['profile'] as Record<string, unknown>) : {};

  const goal = intInRange(input['sleepGoalMin'], SLEEP_GOAL_MIN, SLEEP_GOAL_MAX, defaults.sleepGoalMin);
  const interval = typeof ring['hrIntervalMin'] === 'number' ? ring['hrIntervalMin'] : defaults.ring.hrIntervalMin;

  return {
    sleepGoalMin: Math.round(goal / SLEEP_GOAL_STEP) * SLEEP_GOAL_STEP,
    bedtime: isValidTime(input['bedtime']) ? input['bedtime'] : defaults.bedtime,
    wakeTime: isValidTime(input['wakeTime']) ? input['wakeTime'] : defaults.wakeTime,
    stepsGoal: intInRange(input['stepsGoal'], STEPS_GOAL_MIN, STEPS_GOAL_MAX, defaults.stepsGoal),
    theme: input['theme'] === 'dark' || input['theme'] === 'light' || input['theme'] === 'system' ? input['theme'] : defaults.theme,
    penombra: typeof input['penombra'] === 'boolean' ? input['penombra'] : defaults.penombra,
    ring: {
      hrIntervalMin: HR_INTERVALS.includes(interval) ? interval : defaults.ring.hrIntervalMin,
      stress: typeof ring['stress'] === 'boolean' ? ring['stress'] : defaults.ring.stress,
      spo2: typeof ring['spo2'] === 'boolean' ? ring['spo2'] : defaults.ring.spo2,
      hrv: typeof ring['hrv'] === 'boolean' ? ring['hrv'] : defaults.ring.hrv,
      temperature: typeof ring['temperature'] === 'boolean' ? ring['temperature'] : defaults.ring.temperature,
    },
    wear: normalizeWear(input['wear']),
    plugins: Object.fromEntries(
      PLUGIN_IDS.map((id) => [id, typeof plugins[id] === 'boolean' ? plugins[id] : defaults.plugins[id]]),
    ) as Record<PluginId, boolean>,
    pluginOverrides: normalizeOverrides(input['pluginOverrides']),
    background: normalizeBackground(input['background']),
    habitualCaffeine: normalizeHabits(input['habitualCaffeine']),
    serverUrl: normalizeServerUrl(input['serverUrl']),
    homeUrl: normalizeHomeUrl(input['homeUrl']),
    demoRing: typeof input['demoRing'] === 'boolean' ? input['demoRing'] : defaults.demoRing,
    // Impostazioni salvate prima dell'assistente: con un server già configurato sono già a posto.
    onboarded: typeof input['onboarded'] === 'boolean' ? input['onboarded'] : normalizeServerUrl(input['serverUrl']) !== '',
    profile: {
      sex: profile['sex'] === 'male' || profile['sex'] === 'female' ? profile['sex'] : 'unspecified',
      birthYear: optionalInt(profile['birthYear'], BIRTH_YEAR_MIN, BIRTH_YEAR_MAX),
      heightCm: optionalInt(profile['heightCm'], HEIGHT_MIN_CM, HEIGHT_MAX_CM),
      weightKg: optionalWeight(profile['weightKg']),
    },
  };
}

function normalizeOverrides(value: unknown): Record<string, string[]> {
  if (typeof value !== 'object' || value === null) {
    return {};
  }
  const out: Record<string, string[]> = {};
  for (const [id, keys] of Object.entries(value as Record<string, unknown>)) {
    if (Array.isArray(keys)) {
      const clean = keys.filter((k): k is string => typeof k === 'string');
      if (clean.length > 0) {
        out[id] = [...new Set(clean)];
      }
    }
  }
  return out;
}

function normalizeWear(value: unknown): Wear {
  const v = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  const defaults = DEFAULT_SETTINGS.wear;
  return {
    hand: v['hand'] === 'left' || v['hand'] === 'right' ? v['hand'] : defaults.hand,
    finger: v['finger'] === 'index' || v['finger'] === 'middle' || v['finger'] === 'ring' ? v['finger'] : defaults.finger,
    changedAt: typeof v['changedAt'] === 'number' && Number.isFinite(v['changedAt']) ? v['changedAt'] : null,
  };
}

function normalizeBackground(value: unknown): BackgroundSettings {
  const v = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  const interval = typeof v['intervalMin'] === 'number' && BACKGROUND_INTERVALS.includes(v['intervalMin']) ? v['intervalMin'] : 60;
  return {
    intervalMin: interval,
    batteryAlerts: typeof v['batteryAlerts'] === 'boolean' ? v['batteryAlerts'] : true,
    ringWatch: typeof v['ringWatch'] === 'boolean' ? v['ringWatch'] : true,
  };
}
