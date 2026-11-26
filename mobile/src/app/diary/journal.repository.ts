import { Injectable } from '@angular/core';
import { Preferences } from '@capacitor/preferences';
import { JournalEntry, normalizeEntry } from './journal.model';

/** Archivio locale delle voci del diario (ADR 0007). Con il sync passerà a SQLite. */
export abstract class JournalRepository {
  abstract load(): Promise<JournalEntry[]>;
  abstract save(entries: readonly JournalEntry[]): Promise<void>;
}

const PREFERENCE_NAME = 'journal.entries.v1';

@Injectable()
export class PreferencesJournalRepository extends JournalRepository {
  async load(): Promise<JournalEntry[]> {
    const { value } = await Preferences.get({ key: PREFERENCE_NAME });
    if (!value) {
      return [];
    }
    try {
      const parsed: unknown = JSON.parse(value);
      return Array.isArray(parsed)
        ? parsed.map(normalizeEntry).filter((entry): entry is JournalEntry => entry !== null)
        : [];
    } catch {
      return [];
    }
  }

  async save(entries: readonly JournalEntry[]): Promise<void> {
    await Preferences.set({ key: PREFERENCE_NAME, value: JSON.stringify(entries) });
  }
}
