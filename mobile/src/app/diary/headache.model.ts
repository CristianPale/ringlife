/** Una variazione di intensità durante l'episodio. */
export interface IntensityPoint {
  /** ISO 8601, UTC. */
  at: string;
  /** 1-10. */
  value: number;
}

export type Symptom = 'photophobia' | 'nausea' | 'phonophobia' | 'aura' | 'other';
export type HeadacheLocation = 'left' | 'right' | 'both' | 'nape';
export type MedicationHelp = 'a_lot' | 'a_little' | 'not_at_all';
export type Cause = 'little_sleep' | 'stress' | 'skipped_meal' | 'weather' | 'screens' | 'other';

/** Dettagli che si aggiungono dopo l'episodio, quando si sta meglio. */
export interface EpisodeDetails {
  symptoms: Symptom[];
  location: HeadacheLocation | null;
  /** Solo se è stato segnato un farmaco. */
  medicationHelp: MedicationHelp | null;
  /** Possibili cause: ricorrenze da verificare, non cause accertate. */
  causes: Cause[];
  notes: string;
}

export const EMPTY_DETAILS: EpisodeDetails = {
  symptoms: [],
  location: null,
  medicationHelp: null,
  causes: [],
  notes: '',
};

/**
 * Episodio di cefalea (docs: modello dati, `headache_episode`).
 * Aura, sintomi, sede, efficacia del farmaco e possibili cause si aggiungono dopo, nel Diario.
 */
export interface HeadacheEpisode {
  /** UUID generato sul telefono: il caricamento sul server sarà idempotente. */
  id: string;
  /** ISO 8601, UTC. */
  startedAt: string;
  /** ISO 8601, UTC. Null finché l'episodio è in corso. */
  endedAt: string | null;
  /** Intensità attuale, 1-10. */
  intensity: number;
  /** Intensità nel tempo, dalla prima registrazione. */
  intensityLog: IntensityPoint[];
  /** Orari in cui è stato segnato un farmaco. Nessun nome né dose: non diamo indicazioni sui farmaci. */
  medicationAt: string[];
  details: EpisodeDetails;
  /** ISO 8601, UTC. Null finché i dettagli non sono stati salvati (o saltati). */
  completedAt: string | null;
}

/** Ricostruisce un episodio da dati salvati con una versione precedente: mancano i campi aggiunti dopo. */
export function normalizeEpisode(raw: Partial<HeadacheEpisode>): HeadacheEpisode | null {
  if (typeof raw.id !== 'string' || typeof raw.startedAt !== 'string') {
    return null;
  }
  return {
    id: raw.id,
    startedAt: raw.startedAt,
    endedAt: raw.endedAt ?? null,
    intensity: raw.intensity ?? MIN_INTENSITY,
    intensityLog: raw.intensityLog ?? [],
    medicationAt: raw.medicationAt ?? [],
    details: { ...EMPTY_DETAILS, ...(raw.details ?? {}) },
    completedAt: raw.completedAt ?? null,
  };
}

export const MIN_INTENSITY = 1;
export const MAX_INTENSITY = 10;
