import { Injectable } from '@angular/core';
import { Preferences } from '@capacitor/preferences';
import { HeadacheEpisode, normalizeEpisode } from './headache.model';

/** Archivio locale degli episodi (ADR 0007). Con il sync passerà a SQLite senza cambiare questa interfaccia. */
export abstract class HeadacheRepository {
  abstract load(): Promise<HeadacheEpisode[]>;
  abstract save(episodes: readonly HeadacheEpisode[]): Promise<void>;
}

const STORAGE_KEY = 'headache.episodes.v1';

@Injectable()
export class PreferencesHeadacheRepository extends HeadacheRepository {
  async load(): Promise<HeadacheEpisode[]> {
    const { value } = await Preferences.get({ key: STORAGE_KEY });
    if (!value) {
      return [];
    }
    try {
      const parsed: unknown = JSON.parse(value);
      if (!Array.isArray(parsed)) {
        return [];
      }
      return parsed
        .map((raw) => normalizeEpisode(raw as Partial<HeadacheEpisode>))
        .filter((episode): episode is HeadacheEpisode => episode !== null);
    } catch {
      // Dati illeggibili: meglio ripartire da vuoto che bloccare l'app all'avvio.
      return [];
    }
  }

  async save(episodes: readonly HeadacheEpisode[]): Promise<void> {
    await Preferences.set({ key: STORAGE_KEY, value: JSON.stringify(episodes) });
  }
}
