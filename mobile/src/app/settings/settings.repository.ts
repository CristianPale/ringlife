import { Injectable } from '@angular/core';
import { Preferences } from '@capacitor/preferences';
import { DEFAULT_SETTINGS, Settings, normalizeSettings } from './settings.model';

/** Archivio locale delle impostazioni (ADR 0007). */
export abstract class SettingsRepository {
  abstract load(): Promise<Settings>;
  abstract save(settings: Settings): Promise<void>;
}

const PREFERENCE_NAME = 'settings.v1';

@Injectable()
export class PreferencesSettingsRepository extends SettingsRepository {
  async load(): Promise<Settings> {
    const { value } = await Preferences.get({ key: PREFERENCE_NAME });
    if (!value) {
      return DEFAULT_SETTINGS;
    }
    try {
      return normalizeSettings(JSON.parse(value));
    } catch {
      return DEFAULT_SETTINGS;
    }
  }

  async save(settings: Settings): Promise<void> {
    await Preferences.set({ key: PREFERENCE_NAME, value: JSON.stringify(settings) });
  }
}
