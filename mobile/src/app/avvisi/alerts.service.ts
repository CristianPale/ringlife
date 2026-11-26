import { Injectable, computed, inject, signal } from '@angular/core';
import { CredentialsService } from '../api/credentials.service';
import { DaysService } from '../api/days.service';
import { KeyValueStore, PLAIN_STORE } from '../api/key-value-store';
import { RingLifeApi } from '../api/ringlife-api';
import { BackgroundBridge } from '../ring/background/ring-background';
import { RingSyncService } from '../ring/ring-sync.service';
import { SettingsService } from '../settings/settings.service';
import { romeDay } from '../temperatura/temperatura.model';
import {
  AlertDelivery,
  AlertEvent,
  AlertSettings,
  AlertsConfig,
  AlertsConfigPatch,
  CustomRuleDraft,
  planNotifications,
} from './alerts.model';

/** Dove stanno sul telefono gli ultimi avvisi e la configurazione (docs/adr/0045). */
export const ALERTS_CACHE_KEY = 'alerts.v1';

const DAY_MS = 86_400_000;
/** Dopo quanti giorni la coda ferma diventa un avviso di servizio. */
export const QUEUE_STUCK_DAYS = 3;
/** Dopo quanti giorni senza server arriva l'avviso di servizio. */
export const SERVER_DOWN_DAYS = 2;

export const DEFAULT_ALERT_SETTINGS: AlertSettings = {
  quietStart: '22:30',
  quietEnd: '07:00',
  lockScreen: 'breve',
  homeAssistant: false,
};

interface AlertsCache {
  deviceId: string;
  events: AlertEvent[];
  config: AlertsConfig | null;
  /** Eventi già notificati su questo telefono. */
  notified: string[];
  /** La prima lettura c'è stata: gli avvisi vecchi di prima non si notificano. */
  primed: boolean;
  /** «Visti» segnati senza server: si mandano alla lettura dopo. */
  pendingSeen: boolean;
}

/** Un avviso di servizio, calcolato sul telefono e mostrato in cima all'elenco. */
export interface ServiceAlert {
  id: 'queue-stuck' | 'server-unreachable';
  title: string;
  body: string;
  route: string;
}

function daysText(days: number): string {
  return days === 1 ? '1 giorno' : `${days} giorni`;
}

/** Gli avvisi di servizio del telefono (docs/adr/0045): dati non inviati da 3 giorni, server irraggiungibile da 2. */
export function serviceAlertsOf(
  oldestPending: number | null,
  reachable: boolean | null,
  fetchedAt: number | null,
  now: number,
): ServiceAlert[] {
  const alerts: ServiceAlert[] = [];
  if (oldestPending !== null && now - oldestPending >= QUEUE_STUCK_DAYS * DAY_MS) {
    alerts.push({
      id: 'queue-stuck',
      title: `Dati dell'anello non inviati da ${daysText(Math.floor((now - oldestPending) / DAY_MS))}`,
      body: 'Restano sul telefono e partono appena il server di casa risponde. Controlla Tailscale e il server.',
      route: '/impostazioni/server',
    });
  }
  if (reachable === false && (fetchedAt === null || now - fetchedAt >= SERVER_DOWN_DAYS * DAY_MS)) {
    alerts.push({
      id: 'server-unreachable',
      title:
        fetchedAt === null
          ? 'Server di casa non raggiungibile'
          : `Server di casa non raggiungibile da ${daysText(Math.floor((now - fetchedAt) / DAY_MS))}`,
      body: "Gli indici restano quelli dell'ultimo scaricamento. Controlla Tailscale e il server di casa.",
      route: '/impostazioni/server',
    });
  }
  return alerts;
}

/**
 * Gli avvisi (docs/adr/0045): li calcola il server, il telefono li scarica, li tiene per quando il server non risponde,
 * e notifica quelli nuovi. La configurazione sta sul server (ADR 0044): senza server si legge ma non si cambia.
 */
@Injectable({ providedIn: 'root' })
export class AlertsService {
  private readonly api = inject(RingLifeApi);
  private readonly credentials = inject(CredentialsService);
  private readonly phone = inject(SettingsService);
  private readonly store = inject<KeyValueStore>(PLAIN_STORE, { optional: true });
  private readonly bridge = inject(BackgroundBridge);
  private readonly ring = inject(RingSyncService);
  private readonly days = inject(DaysService);

  /** Dal più recente. */
  readonly events = signal<readonly AlertEvent[]>([]);
  readonly config = signal<AlertsConfig | null>(null);
  private notified = new Set<string>();
  private primed = false;
  private pendingSeen = false;
  private readonly clock = signal(Date.now());

  readonly service = computed(() =>
    serviceAlertsOf(
      this.ring.oldestPending(),
      this.days.reachable(),
      this.days.fetchedAt(),
      this.clock(),
    ),
  );
  /** Il numero sulla campanella di Oggi. */
  readonly unseen = computed(
    () => this.events().filter((e) => e.seenAt === null).length + this.service().length,
  );

  private readonly connected = computed(
    () => this.credentials.paired() !== null && this.phone.settings().serverUrl !== '',
  );

  async init(): Promise<void> {
    try {
      const raw = await this.store?.get(ALERTS_CACHE_KEY);
      const cache = raw ? (JSON.parse(raw) as Partial<AlertsCache>) : null;
      const paired = this.credentials.paired();
      if (cache && paired && cache.deviceId === paired.deviceId && Array.isArray(cache.events)) {
        this.events.set(cache.events);
        this.config.set(cache.config ?? null);
        this.notified = new Set(cache.notified ?? []);
        this.primed = cache.primed === true;
        this.pendingSeen = cache.pendingSeen === true;
      }
    } catch {
      // Una cache illeggibile vale come assente.
    }
  }

  /** Scarica avvisi e configurazione e notifica quelli nuovi. Senza server resta quello che c'è. Non lancia. */
  async refresh(now: Date = new Date()): Promise<void> {
    this.clock.set(now.getTime());
    if (!this.connected()) {
      return;
    }
    try {
      if (this.pendingSeen) {
        await this.api.markAlertsSeen('all');
        this.pendingSeen = false;
      }
      const [{ events }, config] = await Promise.all([
        this.api.getAlerts(),
        this.api.getAlertsConfig(),
      ]);
      this.events.set([...events].sort((a, b) => b.createdAt - a.createdAt));
      this.config.set(config);
    } catch {
      return;
    }
    await this.notifyNew(now);
  }

  /** L'elenco è stato aperto: tutto visto, anche senza server (si manda dopo). */
  async markAllSeen(now: Date = new Date()): Promise<void> {
    if (this.events().every((e) => e.seenAt !== null)) {
      return;
    }
    this.events.update((list) =>
      list.map((e) => (e.seenAt === null ? { ...e, seenAt: now.getTime() } : e)),
    );
    try {
      await this.api.markAlertsSeen('all');
      this.pendingSeen = false;
    } catch {
      this.pendingSeen = true;
    }
    // Una notifica programmata di un avviso ormai visto non serve più.
    await this.bridge.cancelNotifications(this.events().map((e) => `alert-${e.id}`));
    await this.save();
  }

  /** Scarica solo la configurazione (Impostazioni › Notifiche, wizard). `false` senza server. */
  async loadConfig(): Promise<boolean> {
    if (!this.connected()) {
      return false;
    }
    try {
      this.config.set(await this.api.getAlertsConfig());
      await this.save();
      return true;
    } catch {
      return false;
    }
  }

  /** Cambia la configurazione sul server. `false` senza server o con un valore rifiutato: niente finto salvataggio. */
  async saveConfig(patch: AlertsConfigPatch): Promise<boolean> {
    return this.applyConfig(() => this.api.setAlertsConfig(patch));
  }

  /** Crea un avviso tuo (docs/adr/0046). `false` senza server o con un valore rifiutato. */
  async addCustom(draft: CustomRuleDraft): Promise<boolean> {
    return this.applyConfig(() => this.api.createCustomAlert(draft));
  }

  async updateCustom(id: string, patch: Partial<CustomRuleDraft>): Promise<boolean> {
    return this.applyConfig(() => this.api.updateCustomAlert(id, patch));
  }

  async removeCustom(id: string): Promise<boolean> {
    return this.applyConfig(() => this.api.deleteCustomAlert(id));
  }

  private async applyConfig(call: () => Promise<AlertsConfig>): Promise<boolean> {
    try {
      this.config.set(await call());
      await this.save();
      return true;
    } catch {
      return false;
    }
  }

  private deliveryOf(rule: string): AlertDelivery {
    const config = this.config();
    return (
      config?.rules.find((r) => r.id === rule)?.delivery ??
      config?.custom?.find((r) => r.id === rule)?.delivery ??
      'notifica'
    );
  }

  private async notifyNew(now: Date): Promise<void> {
    const fresh = this.events().filter((e) => !this.notified.has(e.id));
    if (!this.primed) {
      // La prima volta: gli avvisi già sul server stanno nell'elenco, senza una raffica di notifiche.
      fresh.forEach((e) => this.notified.add(e.id));
      this.primed = true;
      await this.save();
      return;
    }
    const plans = planNotifications(
      fresh,
      (rule) => this.deliveryOf(rule),
      this.config()?.settings ?? DEFAULT_ALERT_SETTINGS,
      now,
      romeDay(now.getTime()),
    );
    for (const plan of plans) {
      await this.bridge.notify({
        id: plan.id,
        title: plan.title,
        body: plan.body,
        at: plan.at,
        important: plan.important,
        route: plan.route,
      });
    }
    fresh.forEach((e) => this.notified.add(e.id));
    await this.save();
  }

  private async save(): Promise<void> {
    const paired = this.credentials.paired();
    if (!paired) {
      return;
    }
    // Si ricordano solo gli eventi ancora nell'elenco: la lista dei notificati non cresce per sempre.
    const ids = new Set(this.events().map((e) => e.id));
    const cache: AlertsCache = {
      deviceId: paired.deviceId,
      events: [...this.events()],
      config: this.config(),
      notified: [...this.notified].filter((id) => ids.has(id)),
      primed: this.primed,
      pendingSeen: this.pendingSeen,
    };
    await this.store?.set(ALERTS_CACHE_KEY, JSON.stringify(cache)).catch(() => undefined);
  }
}
