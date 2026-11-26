import { Injectable, computed, inject, signal } from '@angular/core';
import { SamplePayload } from '../api/api.model';
import { KeyValueStore, PLAIN_STORE } from '../api/key-value-store';

/** Una misura del battito fatta dall'anello da solo: istante e battiti al minuto. */
export interface HeartRateReading {
  ts: number;
  bpm: number;
}

const KEY = 'ring-hr.v1';
/** Quanto si tengono le misure sul telefono: bastano per oggi e per la notte passata. */
export const HEART_RATE_KEEP_MS = 48 * 60 * 60 * 1000;

function isReading(value: unknown): value is HeartRateReading {
  const v = value as Record<string, unknown>;
  return typeof v === 'object' && v !== null && typeof v['ts'] === 'number' && typeof v['bpm'] === 'number';
}

/**
 * Il battito misurato dall'anello nelle ultime 48 ore, dal telefono (docs/adr/0035): serve al grafico di Oggi. Lo
 * riempie ogni lettura dell'anello, in primo piano e in background; il server riceve gli stessi campioni come sempre.
 * Dal più vecchio. Stesso schema delle misure di temperatura (docs/adr/0033).
 */
@Injectable({ providedIn: 'root' })
export class HeartRateLogService {
  private readonly store = inject<KeyValueStore>(PLAIN_STORE, { optional: true });
  private readonly state = signal<readonly HeartRateReading[]>([]);

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

  /** Tiene i campioni `HR` di una lettura: niente doppioni per istante, niente più vecchio di 48 ore da `now`. */
  async add(samples: readonly SamplePayload[], now: number): Promise<void> {
    const fresh = samples.filter((s) => s.metric === 'HR').map((s) => ({ ts: s.ts, bpm: s.value }));
    if (fresh.length === 0) {
      return;
    }
    const byTs = new Map<number, HeartRateReading>();
    for (const reading of [...this.state(), ...fresh]) {
      byTs.set(reading.ts, reading);
    }
    const next = [...byTs.values()].filter((r) => r.ts >= now - HEART_RATE_KEEP_MS && r.ts <= now).sort((a, b) => a.ts - b.ts);
    this.state.set(next);
    await this.store?.set(KEY, JSON.stringify(next));
  }
}
