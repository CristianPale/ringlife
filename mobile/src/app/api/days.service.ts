import { Injectable, computed, inject, signal } from '@angular/core';
import { CredentialsService } from './credentials.service';
import { DayView, tzOffsetMin } from './api.model';
import { localDayStart } from './demo-data';
import { KeyValueStore, PLAIN_STORE } from './key-value-store';
import { RingLifeApi } from './ringlife-api';
import { SettingsService } from '../settings/settings.service';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Quanti giorni leggere: bastano per l'andamento a 90 giorni. Il server ne dà al massimo 120. */
export const DAYS_TO_LOAD = 90;

/** Dove stanno sul telefono gli ultimi giorni scaricati (docs/adr/0043). */
export const DAYS_CACHE_KEY = 'days.v1';

interface DaysCache {
  deviceId: string;
  fetchedAt: number;
  days: DayView[];
}

/** Giorno locale in forma `2026-11-12` per l'API. */
export function localDayKey(now: Date, offsetMin: number, daysBack = 0): string {
  return new Date(localDayStart(now, offsetMin) + offsetMin * 60_000 - daysBack * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

function isCache(value: unknown): value is DaysCache {
  const v = value as Record<string, unknown>;
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof v['deviceId'] === 'string' &&
    typeof v['fetchedAt'] === 'number' &&
    Array.isArray(v['days'])
  );
}

/**
 * I risultati giornalieri del server, letti una volta e condivisi dalle schermate (Oggi, dettaglio Recupero).
 * Vuoto finché il telefono non è collegato. Gli ultimi scaricati restano sul telefono (docs/adr/0043): all'apertura si
 * vedono subito, anche fuori casa con il server irraggiungibile. Un errore di rete lascia quello che c'è già.
 */
@Injectable({ providedIn: 'root' })
export class DaysService {
  private readonly api = inject(RingLifeApi);
  private readonly credentials = inject(CredentialsService);
  private readonly settings = inject(SettingsService);
  private readonly store = inject<KeyValueStore>(PLAIN_STORE, { optional: true });

  /** Il telefono è collegato a un server: da qui in poi le schermate non mostrano mai valori d'esempio. */
  readonly connected = computed(
    () => this.credentials.paired() !== null && this.settings.settings().serverUrl !== '',
  );

  /** Dal più vecchio al più recente. */
  readonly days = signal<readonly DayView[]>([]);
  /** Quando sono stati scaricati i giorni che si vedono, ms; `null` se non ce ne sono. */
  readonly fetchedAt = signal<number | null>(null);
  /** Com'è andato l'ultimo tentativo: `null` finché non se n'è fatto uno in questa apertura dell'app. */
  readonly reachable = signal<boolean | null>(null);

  /** Carica gli ultimi giorni salvati, se sono di questo dispositivo. Non lancia. */
  async init(): Promise<void> {
    try {
      const raw = await this.store?.get(DAYS_CACHE_KEY);
      const cache = raw ? (JSON.parse(raw) as unknown) : null;
      const paired = this.credentials.paired();
      if (isCache(cache) && paired && cache.deviceId === paired.deviceId) {
        this.days.set([...cache.days].sort((a, b) => a.day.localeCompare(b.day)));
        this.fetchedAt.set(cache.fetchedAt);
      }
    } catch {
      // Una cache illeggibile vale come assente: la riempirà il prossimo scaricamento.
    }
  }

  async refresh(now: Date = new Date()): Promise<void> {
    const paired = this.credentials.paired();
    if (!paired || this.settings.settings().serverUrl === '') {
      return;
    }
    const offset = tzOffsetMin(now);
    let days: DayView[];
    try {
      days = [
        ...(await this.api.getDays(
          localDayKey(now, offset, DAYS_TO_LOAD - 1),
          localDayKey(now, offset),
        )),
      ];
    } catch {
      // Si continua a mostrare quello che c'è, e si dice che il server non ha risposto.
      this.reachable.set(false);
      return;
    }
    days.sort((a, b) => a.day.localeCompare(b.day));
    this.days.set(days);
    this.fetchedAt.set(now.getTime());
    this.reachable.set(true);
    try {
      await this.store?.set(
        DAYS_CACHE_KEY,
        JSON.stringify({
          deviceId: paired.deviceId,
          fetchedAt: now.getTime(),
          days,
        } satisfies DaysCache),
      );
    } catch {
      // Senza spazio si perde solo la copia sul telefono: i dati restano sul server.
    }
  }
}
