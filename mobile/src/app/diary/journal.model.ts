export type CaffeineDrink = 'coffee' | 'tea' | 'energy' | 'other';
export type AlcoholDrink = 'wine' | 'beer' | 'spirits' | 'other';

interface BaseEntry {
  id: string;
  /** ISO 8601, UTC. */
  at: string;
}

/** Una porzione di bevanda con caffeina. Due caffè sono due voci. */
export interface CaffeineEntry extends BaseEntry {
  kind: 'caffeine';
  drink: CaffeineDrink;
}

/** Un bicchiere o una porzione di bevanda alcolica. Due bicchieri sono due voci. */
export interface AlcoholEntry extends BaseEntry {
  kind: 'alcohol';
  drink: AlcoholDrink;
}

export interface NoteEntry extends BaseEntry {
  kind: 'note';
  text: string;
}

/** Voce del diario (modello dati: `journal_entry`, con il tipo e un contenuto specifico). */
export type JournalEntry = CaffeineEntry | AlcoholEntry | NoteEntry;
export type JournalKind = JournalEntry['kind'];

export const MAX_NOTE_LENGTH = 1000;

const CAFFEINE_DRINKS: readonly string[] = ['coffee', 'tea', 'energy', 'other'];
const ALCOHOL_DRINKS: readonly string[] = ['wine', 'beer', 'spirits', 'other'];

/** Controlla una voce letta dall'archivio. Scarta quelle illeggibili invece di bloccare l'app. */
export function normalizeEntry(raw: unknown): JournalEntry | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const entry = raw as Record<string, unknown>;
  if (typeof entry['id'] !== 'string' || typeof entry['at'] !== 'string') {
    return null;
  }
  const base = { id: entry['id'], at: entry['at'] };
  switch (entry['kind']) {
    case 'caffeine':
      return typeof entry['drink'] === 'string' && CAFFEINE_DRINKS.includes(entry['drink'])
        ? { ...base, kind: 'caffeine', drink: entry['drink'] as CaffeineDrink }
        : null;
    case 'alcohol':
      return typeof entry['drink'] === 'string' && ALCOHOL_DRINKS.includes(entry['drink'])
        ? { ...base, kind: 'alcohol', drink: entry['drink'] as AlcoholDrink }
        : null;
    case 'note':
      return typeof entry['text'] === 'string' && entry['text'].trim() !== ''
        ? { ...base, kind: 'note', text: entry['text'] }
        : null;
    default:
      return null;
  }
}
