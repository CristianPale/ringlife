import { HeadacheEpisode } from './headache.model';
import { formatClock } from './headache-time';
import { timelineText } from './headache-labels';
import { JournalEntry } from './journal.model';
import { journalText } from './journal-labels';
import { isHabitual } from './habits';

export type EntryKind = 'headache' | 'caffeine' | 'alcohol' | 'note';

export const KIND_LABELS: Record<EntryKind, string> = {
  headache: 'Cefalea',
  caffeine: 'Caffeina',
  alcohol: 'Alcol',
  note: 'Note',
};

/** Ordine dei filtri nel Diario. */
export const KIND_ORDER: readonly EntryKind[] = ['headache', 'caffeine', 'alcohol', 'note'];

export interface TimelineEntry {
  id: string;
  kind: EntryKind;
  at: Date;
  time: string;
  text: string;
  /** Segnata da sola da un'abitudine (docs/adr/0036): nel Diario si può togliere per quel giorno. */
  habitual?: boolean;
}

export interface TimelineDay {
  /** «Oggi», «Ieri» o «lunedì 2 novembre». */
  label: string;
  /** AAAA-MM-GG, giorno del telefono. */
  key: string;
  entries: TimelineEntry[];
}

function dayKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

export function dayLabel(date: Date, now: Date): string {
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (dayKey(date) === dayKey(now)) {
    return 'Oggi';
  }
  if (dayKey(date) === dayKey(yesterday)) {
    return 'Ieri';
  }
  return new Intl.DateTimeFormat('it-IT', { weekday: 'long', day: 'numeric', month: 'long' }).format(date);
}

export function headacheEntry(episode: HeadacheEpisode): TimelineEntry {
  const at = new Date(episode.startedAt);
  return { id: episode.id, kind: 'headache', at, time: formatClock(at), text: timelineText(episode) };
}

export function journalEntry(entry: JournalEntry): TimelineEntry {
  const at = new Date(entry.at);
  const base = { id: entry.id, kind: entry.kind, at, time: formatClock(at), text: journalText(entry) };
  return isHabitual(entry.id) ? { ...base, habitual: true } : base;
}

/** Tipi di voce presenti, nell'ordine dei filtri. */
export function kindsPresent(
  episodes: readonly HeadacheEpisode[],
  entries: readonly JournalEntry[],
): EntryKind[] {
  const present = new Set<EntryKind>(entries.map((e) => e.kind));
  if (episodes.length > 0) {
    present.add('headache');
  }
  return KIND_ORDER.filter((kind) => present.has(kind));
}

/** Voci raggruppate per giorno, dalla più recente. `kinds` vuoto = tutte. */
export function buildTimeline(
  episodes: readonly HeadacheEpisode[],
  journal: readonly JournalEntry[],
  now: Date,
  kinds: readonly EntryKind[] = [],
): TimelineDay[] {
  const entries = [...episodes.map(headacheEntry), ...journal.map(journalEntry)]
    .filter((entry) => kinds.length === 0 || kinds.includes(entry.kind))
    .sort((a, b) => b.at.getTime() - a.at.getTime());

  const days: TimelineDay[] = [];
  for (const entry of entries) {
    const key = dayKey(entry.at);
    const last = days[days.length - 1];
    if (last && last.key === key) {
      last.entries.push(entry);
    } else {
      days.push({ key, label: dayLabel(entry.at, now), entries: [entry] });
    }
  }
  return days;
}
