import { CredentialsRepository, StoredCredentials } from './credentials.repository';
import { KeyValueStore } from './key-value-store';

/** Solo per i test: archivio delle credenziali in memoria. */
export class InMemoryCredentialsRepository extends CredentialsRepository {
  saved: StoredCredentials[] = [];

  constructor(private stored: StoredCredentials | null = null) {
    super();
  }

  async load(): Promise<StoredCredentials | null> {
    return this.stored;
  }

  async save(credentials: StoredCredentials): Promise<void> {
    this.stored = credentials;
    this.saved.push(credentials);
  }
}

/** Un archivio in memoria. `failing` simula un portachiavi che non risponde. */
export class InMemoryKeyValueStore extends KeyValueStore {
  readonly values = new Map<string, string>();
  failing = false;

  async get(key: string): Promise<string | null> {
    this.check();
    return this.values.get(key) ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    this.check();
    this.values.set(key, value);
  }

  async remove(key: string): Promise<void> {
    this.check();
    this.values.delete(key);
  }

  private check(): void {
    if (this.failing) {
      throw new Error('keychain unavailable');
    }
  }
}
