import { DEFAULT_SETTINGS, Settings } from './settings.model';
import { SettingsRepository } from './settings.repository';

/** Solo per i test: archivio in memoria. */
export class InMemorySettingsRepository extends SettingsRepository {
  saved: Settings[] = [];

  constructor(private stored: Settings = DEFAULT_SETTINGS) {
    super();
  }

  async load(): Promise<Settings> {
    return this.stored;
  }

  async save(settings: Settings): Promise<void> {
    this.stored = settings;
    this.saved.push(settings);
  }
}
