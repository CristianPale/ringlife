import { InjectionToken } from '@angular/core';
import { KeychainAccess, SecureStorage } from '@aparajita/capacitor-secure-storage';
import { Preferences } from '@capacitor/preferences';

/** Un archivio di stringhe per chiave. Dietro questa interfaccia sta il supporto vero (Preferences o portachiavi). */
export abstract class KeyValueStore {
  /** `null` se la chiave non esiste. Un errore dell'archivio si propaga: non vuol dire «assente». */
  abstract get(key: string): Promise<string | null>;
  abstract set(key: string, value: string): Promise<void>;
  abstract remove(key: string): Promise<void>;
}

/** Dati non segreti: `Preferences` (non cifrata, rientra nei backup del telefono). */
export class PreferencesStore extends KeyValueStore {
  async get(key: string): Promise<string | null> {
    const { value } = await Preferences.get({ key });
    return value ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    await Preferences.set({ key, value });
  }

  async remove(key: string): Promise<void> {
    await Preferences.remove({ key });
  }
}

/**
 * Segreti: Keychain su iOS, Keystore su Android. Accessibili dopo il primo sblocco (servirà alla sync in background)
 * e solo su questo telefono: non migrano in un backup verso un altro. Sul web il plugin usa `localStorage` in chiaro:
 * va bene solo per sviluppare.
 */
export class SecureStore extends KeyValueStore {
  private access: Promise<void> | null = null;

  /** Il livello di accesso si imposta una volta, prima della prima scrittura. */
  private configured(): Promise<void> {
    this.access ??= SecureStorage.setDefaultKeychainAccess(KeychainAccess.afterFirstUnlockThisDeviceOnly);
    return this.access;
  }

  async get(key: string): Promise<string | null> {
    const value = await SecureStorage.getItem(key);
    return value ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    await this.configured();
    await SecureStorage.setItem(key, value);
  }

  async remove(key: string): Promise<void> {
    await SecureStorage.removeItem(key);
  }
}

export const PLAIN_STORE = new InjectionToken<KeyValueStore>('PLAIN_STORE');
export const SECRET_STORE = new InjectionToken<KeyValueStore>('SECRET_STORE');
