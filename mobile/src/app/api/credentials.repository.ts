import { Injectable, inject } from '@angular/core';
import { KeyValueStore, PLAIN_STORE, SECRET_STORE } from './key-value-store';

/** L'accesso a un server: chi è questo telefono per il server e il token che lo prova. */
export interface PairedCredentials {
  deviceId: string;
  token: string;
}

export interface StoredCredentials {
  /** Identificativo stabile scelto dall'app: il server lo usa per riconoscere il dispositivo (docs/adr/0008). */
  hardwareId: string;
  paired: PairedCredentials | null;
}

/**
 * Archivio locale delle credenziali. Il token apre l'accesso ai dati sanitari: sta nel portachiavi (Keychain,
 * Keystore) e non in `Preferences`. L'identificativo hardware non è un segreto e resta in `Preferences`, così rientra
 * nei backup del telefono e un telefono nuovo ripristinato da backup può ricollegarsi come lo stesso dispositivo
 * (docs/adr/0010).
 */
export abstract class CredentialsRepository {
  abstract load(): Promise<StoredCredentials | null>;
  abstract save(credentials: StoredCredentials): Promise<void>;
}

const PREFERENCE_NAME = 'credentials.v1';

export function normalizeCredentials(raw: unknown): StoredCredentials | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const value = raw as Record<string, unknown>;
  if (typeof value['hardwareId'] !== 'string' || value['hardwareId'] === '') {
    return null;
  }
  const paired = value['paired'];
  if (typeof paired === 'object' && paired !== null) {
    const { deviceId, token } = paired as Record<string, unknown>;
    if (typeof deviceId === 'string' && deviceId !== '' && typeof token === 'string' && token !== '') {
      return { hardwareId: value['hardwareId'], paired: { deviceId, token } };
    }
  }
  return { hardwareId: value['hardwareId'], paired: null };
}

const SECRET_NAME = 'credentials.paired.v1';

@Injectable()
export class SplitCredentialsRepository extends CredentialsRepository {
  private readonly plain = inject(PLAIN_STORE);
  private readonly secret = inject(SECRET_STORE);

  /**
   * Lancia se il portachiavi non risponde (per esempio a telefono ancora bloccato): non è «nessun collegamento», e chi
   * chiama non deve scrivere sopra ciò che non ha potuto leggere.
   */
  async load(): Promise<StoredCredentials | null> {
    const stored = parse(await this.plain.get(PREFERENCE_NAME));
    if (!stored) {
      return null;
    }
    const inKeychain = parsePaired(await this.secret.get(SECRET_NAME));
    if (inKeychain) {
      return { hardwareId: stored.hardwareId, paired: inKeychain };
    }
    if (stored.paired) {
      // Versioni precedenti tenevano il token in `Preferences`: lo si sposta nel portachiavi. Se la scrittura
      // fallisce resta dov'è e il collegamento continua a funzionare.
      try {
        await this.secret.set(SECRET_NAME, JSON.stringify(stored.paired));
        await this.plain.set(PREFERENCE_NAME, JSON.stringify({ hardwareId: stored.hardwareId, paired: null }));
      } catch {
        // Lo spostamento si ritenta al prossimo avvio.
      }
    }
    return stored;
  }

  async save(credentials: StoredCredentials): Promise<void> {
    // Prima il segreto: se fallisce non si tocca altro e il vecchio stato resta coerente.
    if (credentials.paired) {
      await this.secret.set(SECRET_NAME, JSON.stringify(credentials.paired));
    } else {
      await this.secret.remove(SECRET_NAME);
    }
    await this.plain.set(PREFERENCE_NAME, JSON.stringify({ hardwareId: credentials.hardwareId, paired: null }));
  }
}

function parse(raw: string | null): StoredCredentials | null {
  if (!raw) {
    return null;
  }
  try {
    return normalizeCredentials(JSON.parse(raw));
  } catch {
    return null;
  }
}

function parsePaired(raw: string | null): PairedCredentials | null {
  if (!raw) {
    return null;
  }
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    return normalizeCredentials({ hardwareId: '-', paired: value })?.paired ?? null;
  } catch {
    return null;
  }
}
