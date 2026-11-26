import { ChipOption } from '../shared/chip-group.component';
import { HeadacheEpisode } from './headache.model';
import { formatClock, formatDuration } from './headache-time';

export const SYMPTOM_OPTIONS: readonly ChipOption[] = [
  { code: 'photophobia', label: 'Fotofobia' },
  { code: 'nausea', label: 'Nausea' },
  { code: 'phonophobia', label: 'Fonofobia' },
  { code: 'aura', label: 'Aura' },
  { code: 'other', label: 'Altro' },
];

export const LOCATION_OPTIONS: readonly ChipOption[] = [
  { code: 'left', label: 'Sinistra' },
  { code: 'right', label: 'Destra' },
  { code: 'both', label: 'Entrambi i lati' },
  { code: 'nape', label: 'Nuca' },
];

export const MEDICATION_HELP_OPTIONS: readonly ChipOption[] = [
  { code: 'a_lot', label: 'Molto' },
  { code: 'a_little', label: "Un po'" },
  { code: 'not_at_all', label: 'Per niente' },
];

export const CAUSE_OPTIONS: readonly ChipOption[] = [
  { code: 'little_sleep', label: 'Poco sonno' },
  { code: 'stress', label: 'Stress' },
  { code: 'skipped_meal', label: 'Pasto saltato' },
  { code: 'weather', label: 'Meteo' },
  { code: 'screens', label: 'Schermi' },
  { code: 'other', label: 'Altro' },
];

/** Intensità più alta raggiunta durante l'episodio. */
export function peakIntensity(episode: HeadacheEpisode): number {
  const values = [episode.intensity, ...episode.intensityLog.map((p) => p.value)];
  return Math.max(...values);
}

/** «farmaco alle 07:58», «2 farmaci», o niente. */
function medicationText(episode: HeadacheEpisode): string | null {
  const taken = episode.medicationAt;
  if (taken.length === 0) {
    return null;
  }
  return taken.length === 1 ? `farmaco alle ${formatClock(new Date(taken[0]))}` : `${taken.length} farmaci`;
}

/** «07:44–08:56 · intensità massima 6 · farmaco alle 07:58», per un episodio finito. */
export function episodeSummary(episode: HeadacheEpisode): string {
  const start = new Date(episode.startedAt);
  const range = episode.endedAt
    ? `${formatClock(start)}–${formatClock(new Date(episode.endedAt))}`
    : `dalle ${formatClock(start)}`;
  return [range, `intensità massima ${peakIntensity(episode)}`, medicationText(episode)].filter(Boolean).join(' · ');
}

/** «Cefalea · intensità massima 6 · 1 h 12», o «in corso». */
export function timelineText(episode: HeadacheEpisode): string {
  if (episode.endedAt === null) {
    return `Cefalea · in corso, intensità ${episode.intensity}`;
  }
  const duration = formatDuration(new Date(episode.startedAt), new Date(episode.endedAt));
  return `Cefalea · intensità massima ${peakIntensity(episode)} · ${duration}`;
}
