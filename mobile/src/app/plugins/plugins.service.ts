import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { alignedConfig } from './linked-params';
import { CredentialsService } from '../api/credentials.service';
import { RingLifeApi } from '../api/ringlife-api';
import { KeyValueStore, PLAIN_STORE } from '../api/key-value-store';
import { PLUGIN_IDS, PluginId } from '../settings/settings.model';
import { SettingsService } from '../settings/settings.service';
import { DayRange } from '../livella/giro';
import { caffeineWindowOf } from './caffeine-window';
import {
  PluginCadence,
  PluginCard,
  PluginHeadline,
  PluginInsight,
  PluginView,
  cadenceOf,
  readCards,
  readHeadline,
  readInsights,
} from './plugin.model';

/** Le card di un plugin acceso, pronte da disegnare. */
export interface PluginGroup {
  id: string;
  name: string;
  cards: readonly PluginCard[];
  insights: readonly PluginInsight[];
  /** Quotidiano in Oggi, settimanale in Andamento (docs/adr/0041). */
  cadence: PluginCadence;
  /** La sintesi in poche parole per la riga di Oggi; `null` se il server non la manda. */
  headline: PluginHeadline | null;
}

const isLocalPlugin = (id: string): id is PluginId => (PLUGIN_IDS as readonly string[]).includes(id);

/** Dove stanno sul telefono gli ultimi plugin scaricati (docs/adr/0043). */
export const PLUGINS_CACHE_KEY = 'plugins.v1';

interface PluginsCache {
  deviceId: string;
  fetchedAt: number;
  views: PluginView[];
}

/**
 * I plugin del server (docs/adr/0013). Le card si leggono quando il telefono è collegato; senza server la sezione
 * resta vuota. L'interruttore delle Impostazioni vale su questo telefono e si riporta sul server, che altrimenti
 * valuterebbe anche i plugin spenti.
 */
@Injectable({ providedIn: 'root' })
export class PluginsService {
  private readonly api = inject(RingLifeApi);
  private readonly credentials = inject(CredentialsService);
  private readonly settings = inject(SettingsService);
  private readonly store = inject<KeyValueStore>(PLAIN_STORE, { optional: true });

  readonly views = signal<readonly PluginView[]>([]);
  /** Plugin per cui si sta già mandando la configurazione allineata: evita di mandarla due volte. */
  private readonly aligning = new Set<string>();

  constructor() {
    // I parametri collegati (risveglio, coricarsi, obiettivo di sonno) seguono Obiettivi (docs/adr/0025): quando
    // cambiano le impostazioni o arrivano i plugin dal server, il server si allinea.
    effect(() => {
      const settings = this.settings.settings();
      const views = this.views();
      untracked(() => {
        for (const view of views) {
          const config = alignedConfig(view, settings);
          const id = view.manifest.id;
          if (config && !this.aligning.has(id)) {
            this.aligning.add(id);
            void this.saveConfig(id, config).finally(() => this.aligning.delete(id));
          }
        }
      });
    });
  }

  /** Solo i plugin accesi sia qui sia sul server, con almeno una card o un commento da mostrare. */
  readonly groups = computed<PluginGroup[]>(() =>
    this.views()
      .filter((view) => view.enabled && this.localEnabled(view.manifest.id) && view.result !== null)
      .map((view) => ({
        id: view.manifest.id,
        name: view.manifest.name,
        cards: readCards(view.result?.cards ?? []),
        insights: readInsights(view.result?.insights ?? []),
        cadence: cadenceOf(view.manifest),
        headline: readHeadline(view.result?.headline),
      }))
      .filter((group) => group.cards.length > 0 || group.insights.length > 0),
  );

  /** I plugin di ogni giorno: una riga ciascuno in «Per oggi». */
  readonly dailyGroups = computed(() => this.groups().filter((group) => group.cadence === 'daily'));
  /** I plugin che cambiano a settimana: «Le tue settimane» in Andamento. */
  readonly weeklyGroups = computed(() => this.groups().filter((group) => group.cadence === 'weekly'));

  /** La finestra caffeina come arco del giro, solo con il plugin acceso qui e sul server (ADR 0020). */
  readonly caffeineWindow = computed<DayRange | null>(() => {
    const view = this.views().find((v) => v.manifest.id === 'caffeine-window');
    return view && view.enabled && this.localEnabled('caffeine-window') ? caffeineWindowOf(view) : null;
  });

  /** Carica gli ultimi plugin salvati, se sono di questo dispositivo (docs/adr/0043). Non lancia. */
  async init(): Promise<void> {
    try {
      const raw = await this.store?.get(PLUGINS_CACHE_KEY);
      const cache = raw ? (JSON.parse(raw) as Partial<PluginsCache>) : null;
      const paired = this.credentials.paired();
      if (cache && paired && cache.deviceId === paired.deviceId && Array.isArray(cache.views)) {
        this.views.set(cache.views);
      }
    } catch {
      // Una cache illeggibile vale come assente.
    }
  }

  async refresh(): Promise<void> {
    if (!this.credentials.paired() || this.settings.settings().serverUrl === '') {
      return;
    }
    try {
      let views = await this.api.getPlugins();
      // Quello che si è scelto su questo telefono vince: il server si allinea.
      for (const view of views) {
        const id = view.manifest.id;
        if (isLocalPlugin(id) && view.enabled !== this.localEnabled(id)) {
          const updated = await this.api.setPluginEnabled(id, this.localEnabled(id));
          views = views.map((v) => (v.manifest.id === id ? updated : v));
        }
      }
      this.views.set(views);
      await this.save();
    } catch {
      // Si continua a mostrare quello che c'è.
    }
  }

  /** Salva i plugin che si vedono, per l'apertura dopo senza server. Senza spazio si perde solo la copia. */
  private async save(): Promise<void> {
    const paired = this.credentials.paired();
    if (!paired) {
      return;
    }
    const cache: PluginsCache = { deviceId: paired.deviceId, fetchedAt: Date.now(), views: [...this.views()] };
    await this.store?.set(PLUGINS_CACHE_KEY, JSON.stringify(cache)).catch(() => undefined);
  }

  /** Dopo un interruttore: lo riporta sul server, senza bloccare l'utente se il server non risponde. */
  async pushEnabled(id: PluginId, enabled: boolean): Promise<void> {
    if (!this.credentials.paired() || this.settings.settings().serverUrl === '') {
      return;
    }
    if (!this.views().some((view) => view.manifest.id === id)) {
      return;
    }
    try {
      const updated = await this.api.setPluginEnabled(id, enabled);
      this.views.update((views) => views.map((v) => (v.manifest.id === id ? updated : v)));
    } catch {
      // Al prossimo `refresh` si riallinea.
    }
  }

  /** Salva i parametri di un plugin. `false` se il server non risponde o rifiuta un valore. */
  async saveConfig(id: string, config: Record<string, unknown>): Promise<boolean> {
    try {
      const updated = await this.api.setPluginConfig(id, config);
      this.views.update((views) => views.map((v) => (v.manifest.id === id ? updated : v)));
      return true;
    } catch {
      return false;
    }
  }

  private localEnabled(id: string): boolean {
    return isLocalPlugin(id) ? this.settings.settings().plugins[id] : true;
  }
}
