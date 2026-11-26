import { Injectable } from '@angular/core';
import { Preferences } from '@capacitor/preferences';
import { EMPTY_SYNCED, SyncedDiary } from './diary-sync.model';

/** Archivio di ciò che il server ha già ricevuto del diario (docs/adr/0010). Perderlo costa solo un nuovo invio. */
export abstract class DiarySyncRepository {
  abstract load(): Promise<SyncedDiary>;
  abstract save(synced: SyncedDiary): Promise<void>;
}

const PREFERENCE_NAME = 'diary.synced.v1';

function normalizeMap(raw: unknown): Record<string, string> {
  if (typeof raw !== 'object' || raw === null) {
    return {};
  }
  return Object.fromEntries(Object.entries(raw).filter((pair): pair is [string, string] => typeof pair[1] === 'string'));
}

export function normalizeSynced(raw: unknown): SyncedDiary {
  if (typeof raw !== 'object' || raw === null) {
    return EMPTY_SYNCED;
  }
  const value = raw as Record<string, unknown>;
  return {
    target: typeof value['target'] === 'string' ? value['target'] : '',
    entries: normalizeMap(value['entries']),
    episodes: normalizeMap(value['episodes']),
  };
}

@Injectable()
export class PreferencesDiarySyncRepository extends DiarySyncRepository {
  async load(): Promise<SyncedDiary> {
    const { value } = await Preferences.get({ key: PREFERENCE_NAME });
    if (!value) {
      return EMPTY_SYNCED;
    }
    try {
      return normalizeSynced(JSON.parse(value));
    } catch {
      return EMPTY_SYNCED;
    }
  }

  async save(synced: SyncedDiary): Promise<void> {
    await Preferences.set({ key: PREFERENCE_NAME, value: JSON.stringify(synced) });
  }
}
