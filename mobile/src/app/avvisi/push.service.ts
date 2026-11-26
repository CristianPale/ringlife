import { Injectable, computed, inject, signal } from '@angular/core';
import { CredentialsService } from '../api/credentials.service';
import { KeyValueStore, PLAIN_STORE } from '../api/key-value-store';
import { RingLifeApi } from '../api/ringlife-api';
import { BackgroundBridge } from '../ring/background/ring-background';
import { SettingsService } from '../settings/settings.service';
import { PushStatus } from './push.model';

/** Dove sta sul telefono la scelta delle push (docs/adr/0047). Token e chiave no: li tiene iOS. */
export const PUSH_STORE_KEY = 'push.v1';

interface PushPrefs {
  deviceId: string;
  enabled: boolean;
}

/** Perché le push non sono attive, o non si sono potute cambiare. */
export type PushProblem = 'not_configured' | 'denied' | 'unsupported' | 'keychain' | 'failed' | 'offline';

/**
 * Le push dal server di casa con il testo cifrato (docs/adr/0047). Accenderle chiede a iOS il token, crea (o riusa) la
 * chiave di cifratura nel portachiavi e li manda al server. A ogni apertura, se accese, si registrano di nuovo: il token
 * può cambiare. Senza la configurazione Apple nell'app iOS rifiuta, e lo stato lo dice.
 */
@Injectable({ providedIn: 'root' })
export class PushService {
  private readonly api = inject(RingLifeApi);
  private readonly bridge = inject(BackgroundBridge);
  private readonly credentials = inject(CredentialsService);
  private readonly phone = inject(SettingsService);
  private readonly store = inject<KeyValueStore>(PLAIN_STORE, { optional: true });

  readonly enabled = signal(false);
  readonly status = signal<PushStatus | null>(null);
  readonly problem = signal<PushProblem | null>(null);
  readonly busy = signal(false);

  private readonly connected = computed(
    () => this.credentials.paired() !== null && this.phone.settings().serverUrl !== '',
  );

  async init(): Promise<void> {
    try {
      const raw = await this.store?.get(PUSH_STORE_KEY);
      const prefs = raw ? (JSON.parse(raw) as Partial<PushPrefs>) : null;
      const paired = this.credentials.paired();
      this.enabled.set(prefs?.enabled === true && paired !== null && prefs.deviceId === paired.deviceId);
    } catch {
      this.enabled.set(false);
    }
  }

  /** Accende le push: token e chiave dal telefono, registrazione sul server. */
  async enable(): Promise<void> {
    if (!this.connected()) {
      this.problem.set('offline');
      return;
    }
    this.busy.set(true);
    try {
      if (await this.register()) {
        this.enabled.set(true);
        await this.save();
      }
    } finally {
      this.busy.set(false);
    }
  }

  /** Spegne le push: prima sul server, così non ne manda più; poi la chiave sul telefono. */
  async disable(): Promise<void> {
    this.busy.set(true);
    try {
      try {
        await this.api.deletePush();
      } catch {
        this.problem.set('offline');
        return;
      }
      await this.bridge.pushUnregister();
      this.enabled.set(false);
      this.status.set(null);
      this.problem.set(null);
      await this.save();
    } finally {
      this.busy.set(false);
    }
  }

  /** All'apertura, con le push accese: registra di nuovo token e chiave, e legge lo stato del server. Non lancia. */
  async ensure(): Promise<void> {
    if (!this.enabled() || !this.connected()) {
      return;
    }
    await this.register();
  }

  private async register(): Promise<boolean> {
    const native = await this.bridge.pushRegister();
    if (!native.ok) {
      this.problem.set(native.reason);
      return false;
    }
    try {
      this.status.set(
        await this.api.setPush({ token: native.token, key: native.key, environment: native.environment }),
      );
      this.problem.set(null);
      return true;
    } catch {
      this.problem.set('offline');
      return false;
    }
  }

  private async save(): Promise<void> {
    const paired = this.credentials.paired();
    if (!paired) {
      return;
    }
    const prefs: PushPrefs = { deviceId: paired.deviceId, enabled: this.enabled() };
    await this.store?.set(PUSH_STORE_KEY, JSON.stringify(prefs)).catch(() => undefined);
  }
}

/** Lo stato in parole, per Impostazioni › Notifiche. */
export function pushText(enabled: boolean, status: PushStatus | null, problem: PushProblem | null): string {
  switch (problem) {
    case 'not_configured':
      return "Su questo iPhone non sono ancora disponibili: manca la configurazione di Apple nell'app. Finché manca, gli avvisi arrivano quando l'app legge l'anello.";
    case 'denied':
      return "Le notifiche di RingLife sono spente nelle Impostazioni dell'iPhone.";
    case 'unsupported':
      return "Disponibili solo nell'app sull'iPhone.";
    case 'offline':
      return 'Non salvato: il server di casa non risponde.';
    case 'keychain':
    case 'failed':
      return 'Non riuscito: riprova più tardi.';
    default:
      break;
  }
  if (!enabled) {
    return "Spente: gli avvisi arrivano quando l'app legge l'anello, all'apertura o in background.";
  }
  if (status && !status.serverReady) {
    return "Il server di casa non ha ancora la chiave di Apple: finché manca, gli avvisi arrivano quando l'app legge l'anello.";
  }
  const error = status?.lastError ? ` Ultimo invio non riuscito: ${status.lastError}.` : '';
  return `Attive: ogni avviso arriva appena il server lo calcola, anche con l'app chiusa. Apple vede solo «Avviso di RingLife»: il testo vero è cifrato e lo legge solo il telefono.${error}`;
}
