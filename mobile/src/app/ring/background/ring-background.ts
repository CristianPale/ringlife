import { Injectable } from '@angular/core';
import { registerPlugin } from '@capacitor/core';
import { BackgroundAttempt, parseBackgroundAttempts } from './background-attempts';

/** Il plugin nativo locale (iOS, `RingBackgroundPlugin.swift`, docs/adr/0026). */
/** Una notifica locale (docs/adr/0045): subito, o all'ora `at` (ms). */
export interface LocalNotification {
  id: string;
  title: string;
  body: string;
  at?: number;
  important?: boolean;
  /** La pagina dell'app da aprire al tocco. */
  route?: string;
}

/** Dopo quante ore senza letture arriva «Anello non letto» (docs/adr/0045). */
export const RING_WATCH_HOURS = 24;

/**
 * I passi della catena dopo una lettura in background (docs/adr/0048). `alerts`, `failed`, `skipped` e `stop`
 * chiudono la catena; `stop` registra l'ultimo passo raggiunto.
 */
export type ChainStep = 'started' | 'decoded' | 'uploaded' | 'alerts' | 'failed' | 'skipped' | 'stop';

/**
 * Il token delle push e la chiave di cifratura (docs/adr/0047), o il motivo per cui non ci sono: `not_configured`
 * (manca la configurazione Apple), `denied` (notifiche non permesse), `unsupported` (non è un iPhone), `failed`.
 */
export type PushRegisterResult =
  | { ok: true; token: string; key: string; environment: 'production' | 'sandbox' }
  | { ok: false; reason: 'not_configured' | 'denied' | 'unsupported' | 'keychain' | 'failed' };

/** Risveglio abituale in minuti dalla mezzanotte, per il compito notturno; -1 = spento (docs/adr/0048). */
export interface BackgroundConfig {
  intervalMin: number;
  batteryAlerts: boolean;
  ringWatchHours: number;
  wakeMin: number;
}

interface RingBackgroundPlugin {
  configure(options: BackgroundConfig): Promise<void>;
  notify(options: LocalNotification): Promise<void>;
  cancelNotifications(options: { ids: string[] }): Promise<void>;
  ringRead(): Promise<void>;
  addListener(event: 'notificationTap', handler: (data: { route: string }) => void): Promise<{ remove: () => Promise<void> }>;
  addListener(event: 'backgroundRead', handler: (data: { source: string }) => void): Promise<{ remove: () => Promise<void> }>;
  chainStep(options: { step: ChainStep }): Promise<void>;
  openShortcuts(): Promise<void>;
  pushRegister(): Promise<PushRegisterResult>;
  pushUnregister(): Promise<void>;
  drain(): Promise<{ json: string; lastRun?: number }>;
  attempts(): Promise<{ json: string }>;
  batteryReading(options: { percent: number }): Promise<void>;
  appState(): Promise<{ background: boolean }>;
}

const native = registerPlugin<RingBackgroundPlugin>('RingBackground');

/**
 * La lettura in background e gli avvisi della batteria, dietro una classe astratta: su Android, nel browser e nei
 * test non c'è niente da fare (docs/adr/0026).
 */
@Injectable({ providedIn: 'root', useFactory: () => new CapacitorBackgroundBridge() })
export abstract class BackgroundBridge {
  /**
   * Intervallo minimo in minuti (0 = spenta), avvisi della batteria, ore prima di «Anello non letto» (0 = spento),
   * risveglio abituale per il compito notturno (-1 = spento).
   */
  abstract configure(config: BackgroundConfig): Promise<void>;
  /** Il nativo ha salvato una lettura in background: la catena può partire (docs/adr/0048). */
  abstract onBackgroundRead(handler: (source: string) => void): void;
  /** A che punto è la catena: il nativo chiude il compito in background all'ultimo passo. */
  abstract chainStep(step: ChainStep): Promise<void>;
  /** Apre l'app Comandi, per creare le automazioni (docs/adr/0048). */
  abstract openShortcuts(): Promise<void>;
  /** Token delle push e chiave di cifratura (docs/adr/0047). Non lancia. */
  abstract pushRegister(): Promise<PushRegisterResult>;
  /** Toglie la chiave dal telefono e smette di ricevere push. */
  abstract pushUnregister(): Promise<void>;
  /** Una notifica locale, subito o programmata (docs/adr/0045). */
  abstract notify(notification: LocalNotification): Promise<void>;
  abstract cancelNotifications(ids: readonly string[]): Promise<void>;
  /** Una lettura in primo piano è riuscita: «Anello non letto» si sposta in avanti. */
  abstract ringRead(): Promise<void>;
  /** Il tocco su una notifica: la pagina da aprire. */
  abstract onNotificationTap(handler: (route: string) => void): void;
  /** Le letture salvate in background (JSON) e l'ultima lettura, che il nativo toglie dopo averle date. */
  abstract drain(): Promise<{ json: string; lastRun: number | null }>;
  /** Una lettura in primo piano ha letto la batteria: il nativo decide se avvisare. */
  abstract batteryReading(percent: number): Promise<void>;
  /** Gli ultimi tentativi di lettura in background, riusciti o no, dal più recente. Non toglie niente. */
  abstract attempts(): Promise<BackgroundAttempt[]>;
  /** `true` se iOS ha avviato l'app in background (Comandi, lettura in background) e non è ancora in primo piano. */
  abstract inBackground(): Promise<boolean>;
}

/** Il plugin vero. Dove non c'è (Android, browser) ogni chiamata fallisce in silenzio. */
export class CapacitorBackgroundBridge extends BackgroundBridge {
  async configure(config: BackgroundConfig): Promise<void> {
    await native.configure(config).catch(() => undefined);
  }

  onBackgroundRead(handler: (source: string) => void): void {
    void native.addListener('backgroundRead', (data) => handler(data.source)).catch(() => undefined);
  }

  async chainStep(step: ChainStep): Promise<void> {
    await native.chainStep({ step }).catch(() => undefined);
  }

  async openShortcuts(): Promise<void> {
    await native.openShortcuts().catch(() => undefined);
  }

  async pushRegister(): Promise<PushRegisterResult> {
    try {
      return await native.pushRegister();
    } catch {
      return { ok: false, reason: 'unsupported' };
    }
  }

  async pushUnregister(): Promise<void> {
    await native.pushUnregister().catch(() => undefined);
  }

  async notify(notification: LocalNotification): Promise<void> {
    await native.notify(notification).catch(() => undefined);
  }

  async cancelNotifications(ids: readonly string[]): Promise<void> {
    await native.cancelNotifications({ ids: [...ids] }).catch(() => undefined);
  }

  async ringRead(): Promise<void> {
    await native.ringRead().catch(() => undefined);
  }

  onNotificationTap(handler: (route: string) => void): void {
    void native.addListener('notificationTap', (data) => handler(data.route)).catch(() => undefined);
  }

  async drain(): Promise<{ json: string; lastRun: number | null }> {
    try {
      const result = await native.drain();
      return { json: result.json, lastRun: result.lastRun ? result.lastRun : null };
    } catch {
      return { json: '[]', lastRun: null };
    }
  }

  async batteryReading(percent: number): Promise<void> {
    await native.batteryReading({ percent }).catch(() => undefined);
  }

  async attempts(): Promise<BackgroundAttempt[]> {
    try {
      return parseBackgroundAttempts((await native.attempts()).json);
    } catch {
      return [];
    }
  }

  async inBackground(): Promise<boolean> {
    try {
      return (await native.appState()).background === true;
    } catch {
      return false;
    }
  }
}

/** Solo per i test: un ponte in memoria. */
export class FakeBackgroundBridge extends BackgroundBridge {
  configured: BackgroundConfig[] = [];
  steps: ChainStep[] = [];
  shortcutsOpened = 0;
  backgroundRead: ((source: string) => void) | null = null;
  batteries: number[] = [];
  json = '[]';
  lastRun: number | null = null;
  notifications: LocalNotification[] = [];
  cancelled: string[] = [];
  ringReads = 0;
  tap: ((route: string) => void) | null = null;

  async configure(config: BackgroundConfig): Promise<void> {
    this.configured.push(config);
  }

  onBackgroundRead(handler: (source: string) => void): void {
    this.backgroundRead = handler;
  }

  async chainStep(step: ChainStep): Promise<void> {
    this.steps.push(step);
  }

  async openShortcuts(): Promise<void> {
    this.shortcutsOpened++;
  }

  push: PushRegisterResult = { ok: false, reason: 'unsupported' };
  pushUnregistered = 0;

  async pushRegister(): Promise<PushRegisterResult> {
    return this.push;
  }

  async pushUnregister(): Promise<void> {
    this.pushUnregistered++;
  }

  async notify(notification: LocalNotification): Promise<void> {
    this.notifications.push(notification);
  }

  async cancelNotifications(ids: readonly string[]): Promise<void> {
    this.cancelled.push(...ids);
  }

  async ringRead(): Promise<void> {
    this.ringReads++;
  }

  onNotificationTap(handler: (route: string) => void): void {
    this.tap = handler;
  }

  async drain(): Promise<{ json: string; lastRun: number | null }> {
    const json = this.json;
    this.json = '[]';
    return { json, lastRun: this.lastRun };
  }

  async batteryReading(percent: number): Promise<void> {
    this.batteries.push(percent);
  }

  log: BackgroundAttempt[] = [];

  async attempts(): Promise<BackgroundAttempt[]> {
    return this.log;
  }

  background = false;

  async inBackground(): Promise<boolean> {
    return this.background;
  }
}
