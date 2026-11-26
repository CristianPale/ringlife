import { Injectable, computed, inject, signal } from '@angular/core';
import { SamplePayload } from '../api/api.model';
import { KeyValueStore, PLAIN_STORE } from '../api/key-value-store';

/** Una misura di temperatura dell'anello: istante e gradi. `manual`: misurata a comando, non dallo storico. */
export interface TemperatureReading {
  ts: number;
  celsius: number;
  manual?: boolean;
}

const KEY = 'ring-temperature.v1';
/** Quanto si tengono le misure sul telefono: bastano per «oggi» e per ieri sera. */
export const TEMPERATURE_KEEP_MS = 48 * 60 * 60 * 1000;

function isReading(value: unknown): value is TemperatureReading {
  const v = value as Record<string, unknown>;
  return typeof v === 'object' && v !== null && typeof v['ts'] === 'number' && typeof v['celsius'] === 'number';
}

/**
 * Le misure di temperatura delle ultime 48 ore, dal telefono (docs/adr/0033). Le aggiunge ogni lettura dell'anello;
 * il server riceve gli stessi campioni come sempre. Dal più vecchio.
 */
@Injectable({ providedIn: 'root' })
export class TemperatureLogService {
  private readonly store = inject<KeyValueStore>(PLAIN_STORE, { optional: true });
  private readonly state = signal<readonly TemperatureReading[]>([]);

  readonly readings = this.state.asReadonly();
  readonly latest = computed(() => this.state().at(-1) ?? null);

  async init(): Promise<void> {
    try {
      const raw = await this.store?.get(KEY);
      const list = raw ? (JSON.parse(raw) as unknown[]) : [];
      this.state.set(Array.isArray(list) ? list.filter(isReading).sort((a, b) => a.ts - b.ts) : []);
    } catch {
      this.state.set([]);
    }
  }

  /** Tiene i campioni `TEMP` di una lettura: niente doppioni per istante, niente più vecchio di 48 ore da `now`. */
  async add(samples: readonly SamplePayload[], now: number): Promise<void> {
    await this.keep(
      samples.filter((s) => s.metric === 'TEMP').map((s) => ({ ts: s.ts, celsius: s.value })),
      now,
    );
  }

  /** Una misura a comando (docs/adr/0033): resta sul telefono, il server non la riceve. */
  async addMeasure(ts: number, celsius: number): Promise<void> {
    await this.keep([{ ts, celsius, manual: true }], ts);
  }

  private async keep(fresh: readonly TemperatureReading[], now: number): Promise<void> {
    if (fresh.length === 0) {
      return;
    }
    const byTs = new Map<number, TemperatureReading>();
    for (const reading of [...this.state(), ...fresh]) {
      byTs.set(reading.ts, reading);
    }
    const next = [...byTs.values()].filter((r) => r.ts >= now - TEMPERATURE_KEEP_MS && r.ts <= now).sort((a, b) => a.ts - b.ts);
    this.state.set(next);
    await this.store?.set(KEY, JSON.stringify(next));
  }
}
