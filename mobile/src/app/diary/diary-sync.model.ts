import {
  DiaryEntryPayload,
  DiaryEpisodePayload,
  DiaryView,
  MAX_DIARY_DELETED,
  MAX_DIARY_ENTRIES,
  MAX_DIARY_EPISODES,
  DiaryPayload,
} from '../api/api.model';
import { HeadacheEpisode } from './headache.model';
import { JournalEntry } from './journal.model';

/** Gli identificativi che il server accetta (docs/adr/0010). Gli UUID dell'app lo sono sempre. */
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Ciò che il server ha già ricevuto: per ogni id, l'impronta del contenuto inviato.
 * Serve a sapere cosa è nuovo, cosa è cambiato e cosa è sparito, senza rileggere dal server.
 */
export interface SyncedDiary {
  /** A quale server e dispositivo si riferisce l'elenco. Un server diverso riparte da zero. */
  target: string;
  entries: Record<string, string>;
  episodes: Record<string, string>;
}

export const EMPTY_SYNCED: SyncedDiary = { target: '', entries: {}, episodes: {} };

const time = (iso: string): number => Date.parse(iso);

export function entryPayload(entry: JournalEntry): DiaryEntryPayload | null {
  const ts = time(entry.at);
  if (!SAFE_ID.test(entry.id) || !Number.isFinite(ts)) {
    return null;
  }
  return entry.kind === 'note'
    ? { id: entry.id, ts, kind: 'note', text: entry.text }
    : { id: entry.id, ts, kind: entry.kind, drink: entry.drink };
}

export function episodePayload(episode: HeadacheEpisode): DiaryEpisodePayload | null {
  const start = time(episode.startedAt);
  if (!SAFE_ID.test(episode.id) || !Number.isFinite(start)) {
    return null;
  }
  const optional = (iso: string | null): number | null => {
    const value = iso === null ? NaN : time(iso);
    return Number.isFinite(value) ? value : null;
  };
  return {
    id: episode.id,
    start,
    end: optional(episode.endedAt),
    intensity: episode.intensity,
    intensityLog: episode.intensityLog
      .map((point) => ({ at: time(point.at), value: point.value }))
      .filter((point) => Number.isFinite(point.at)),
    medicationAt: episode.medicationAt.map(time).filter(Number.isFinite),
    details: {
      symptoms: episode.details.symptoms,
      location: episode.details.location,
      medicationHelp: episode.details.medicationHelp,
      causes: episode.details.causes,
      notes: episode.details.notes,
    },
    completedAt: optional(episode.completedAt),
  };
}

const iso = (ms: number): string => new Date(ms).toISOString();

/** Una voce del server come voce del telefono. `null` se il tipo o i campi non sono leggibili. */
export function entryFromPayload(payload: DiaryEntryPayload): JournalEntry | null {
  const base = { id: payload.id, at: iso(payload.ts) };
  switch (payload.kind) {
    case 'caffeine':
      return payload.drink ? ({ ...base, kind: 'caffeine', drink: payload.drink } as JournalEntry) : null;
    case 'alcohol':
      return payload.drink ? ({ ...base, kind: 'alcohol', drink: payload.drink } as JournalEntry) : null;
    case 'note':
      return payload.text ? { ...base, kind: 'note', text: payload.text } : null;
    default:
      return null;
  }
}

export function episodeFromPayload(payload: DiaryEpisodePayload): HeadacheEpisode {
  const details = payload.details;
  return {
    id: payload.id,
    startedAt: iso(payload.start),
    endedAt: payload.end === null ? null : iso(payload.end),
    intensity: payload.intensity,
    intensityLog: payload.intensityLog.map((point) => ({ at: iso(point.at), value: point.value })),
    medicationAt: payload.medicationAt.map(iso),
    details: {
      symptoms: (details?.symptoms ?? []) as HeadacheEpisode['details']['symptoms'],
      location: (details?.location ?? null) as HeadacheEpisode['details']['location'],
      medicationHelp: (details?.medicationHelp ?? null) as HeadacheEpisode['details']['medicationHelp'],
      causes: (details?.causes ?? []) as HeadacheEpisode['details']['causes'],
      notes: details?.notes ?? '',
    },
    completedAt: payload.completedAt === null ? null : iso(payload.completedAt),
  };
}

export interface Restorable {
  entries: JournalEntry[];
  episodes: HeadacheEpisode[];
}

/**
 * Cosa del server il telefono non ha. Si aggiunge ciò che manca per id. Non si riporta indietro ciò che il telefono
 * aveva già inviato e poi ha tolto (è in `synced` ma non c'è più sul telefono): è una cancellazione ancora da inviare,
 * non qualcosa da ripristinare. Ciò che c'è già sul telefono resta com'è: vince il telefono.
 */
export function restorable(
  server: DiaryView,
  synced: SyncedDiary,
  entries: readonly JournalEntry[],
  episodes: readonly HeadacheEpisode[],
): Restorable {
  const entryIds = new Set(entries.map((e) => e.id));
  const episodeIds = new Set(episodes.map((e) => e.id));
  return {
    entries: server.entries
      .filter((e) => !entryIds.has(e.id) && !(e.id in synced.entries))
      .map(entryFromPayload)
      .filter((e): e is JournalEntry => e !== null),
    episodes: server.episodes.filter((e) => !episodeIds.has(e.id) && !(e.id in synced.episodes)).map(episodeFromPayload),
  };
}

export interface DiaryDiff {
  entries: DiaryEntryPayload[];
  episodes: DiaryEpisodePayload[];
  deletedEntries: string[];
  deletedEpisodes: string[];
}

export function isEmpty(diff: DiaryDiff): boolean {
  return (
    diff.entries.length === 0 &&
    diff.episodes.length === 0 &&
    diff.deletedEntries.length === 0 &&
    diff.deletedEpisodes.length === 0
  );
}

export function pendingCount(diff: DiaryDiff): number {
  return diff.entries.length + diff.episodes.length + diff.deletedEntries.length + diff.deletedEpisodes.length;
}

/** Impronta del contenuto di un elemento: due invii uguali hanno la stessa. */
export const signature = (payload: object): string => JSON.stringify(payload);

/**
 * Cosa manca al server: elementi nuovi o cambiati (impronta diversa) e id che il server ha ricevuto
 * ma che sul telefono non ci sono più. Gli elementi che non si possono inviare (id o date illeggibili) si saltano.
 */
export function diffDiary(
  synced: SyncedDiary,
  entries: readonly JournalEntry[],
  episodes: readonly HeadacheEpisode[],
): DiaryDiff {
  const diff: DiaryDiff = { entries: [], episodes: [], deletedEntries: [], deletedEpisodes: [] };
  const entryIds = new Set<string>();
  for (const entry of entries) {
    const payload = entryPayload(entry);
    if (payload) {
      entryIds.add(payload.id);
      if (synced.entries[payload.id] !== signature(payload)) {
        diff.entries.push(payload);
      }
    }
  }
  const episodeIds = new Set<string>();
  for (const episode of episodes) {
    const payload = episodePayload(episode);
    if (payload) {
      episodeIds.add(payload.id);
      if (synced.episodes[payload.id] !== signature(payload)) {
        diff.episodes.push(payload);
      }
    }
  }
  diff.deletedEntries = Object.keys(synced.entries).filter((id) => !entryIds.has(id));
  diff.deletedEpisodes = Object.keys(synced.episodes).filter((id) => !episodeIds.has(id));
  return diff;
}

/** Spezza la differenza in richieste che il server accetta, nell'ordine: prima gli elementi, poi le cancellazioni. */
export function requestsFor(diff: DiaryDiff): DiaryPayload[] {
  const requests: DiaryPayload[] = [];
  const take = <T>(list: T[], size: number) => list.splice(0, size);
  const rest: DiaryDiff = {
    entries: [...diff.entries],
    episodes: [...diff.episodes],
    deletedEntries: [...diff.deletedEntries],
    deletedEpisodes: [...diff.deletedEpisodes],
  };
  while (!isEmpty(rest)) {
    requests.push({
      entries: take(rest.entries, MAX_DIARY_ENTRIES),
      episodes: take(rest.episodes, MAX_DIARY_EPISODES),
      deletedEntries: take(rest.deletedEntries, MAX_DIARY_DELETED),
      deletedEpisodes: take(rest.deletedEpisodes, MAX_DIARY_DELETED),
    });
  }
  return requests;
}

/** L'elenco di ciò che il server ha ricevuto vale solo per il server e il dispositivo a cui si riferisce. */
export function syncedFor(synced: SyncedDiary, target: string): SyncedDiary {
  return synced.target === target ? synced : { ...EMPTY_SYNCED, target };
}

/** Aggiorna l'elenco di ciò che il server ha ricevuto, dopo che una richiesta è andata a buon fine. */
export function applySent(synced: SyncedDiary, sent: DiaryPayload): SyncedDiary {
  const entries = { ...synced.entries };
  const episodes = { ...synced.episodes };
  for (const entry of sent.entries ?? []) {
    entries[entry.id] = signature(entry);
  }
  for (const episode of sent.episodes ?? []) {
    episodes[episode.id] = signature(episode);
  }
  for (const id of sent.deletedEntries ?? []) {
    delete entries[id];
  }
  for (const id of sent.deletedEpisodes ?? []) {
    delete episodes[id];
  }
  return { target: synced.target, entries, episodes };
}
