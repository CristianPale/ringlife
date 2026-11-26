import { Injectable, inject, signal } from '@angular/core';
import { SamplePayload } from '../api/api.model';
import { KeyValueStore, PLAIN_STORE } from '../api/key-value-store';
import { romeDay } from '../temperatura/temperatura.model';

/** I passi di un intervallo dell'anello: istante d'inizio e passi. */
export interface StepsReading {
  ts: number;
  steps: number;
}

const KEY = 'ring-steps.v1';
/** Quanto si tengono sul telefono: bastano per i passi di oggi. */
export const STEPS_KEEP_MS = 48 * 60 * 60 * 1000;

function isReading(value: unknown): value is StepsReading {
  const v = value as Record<string, unknown>;
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof v['ts'] === 'number' &&
    typeof v['steps'] === 'number'
  );
}

/** I passi di un giorno di Roma (`2026-11-24`) dal registro. `null` se non c'è nessun intervallo di quel giorno. */
export function stepsOfDay(readings: readonly StepsReading[], day: string): number | null {
  const today = readings.filter((r) => romeDay(r.ts) === day);
  return today.length === 0 ? null : today.reduce((sum, r) => sum + r.steps, 0);
}

/**
 * I passi letti dall'anello nelle ultime 48 ore, dal telefono (docs/adr/0043): danno i passi di oggi quando il server di
 * casa non ha ancora quelli dell'ultima lettura. Lo riempie ogni lettura, in primo piano e in background. Un intervallo
 * riletto (l'ora in corso cresce) prende il posto di quello con lo stesso istante, così non si conta due volte.
 */
@Injectable({ providedIn: 'root' })
export class StepsLogService {
  private readonly store = inject<KeyValueStore>(PLAIN_STORE, { optional: true });
  private readonly state = signal<readonly StepsReading[]>([]);

  readonly readings = this.state.asReadonly();

  async init(): Promise<void> {
    try {
      const raw = await this.store?.get(KEY);
      const list = raw ? (JSON.parse(raw) as unknown[]) : [];
      this.state.set(Array.isArray(list) ? list.filter(isReading).sort((a, b) => a.ts - b.ts) : []);
    } catch {
      this.state.set([]);
    }
  }

  /** Tiene i campioni `STEPS` di una lettura: uno per istante (l'ultimo letto vince), niente più vecchio di 48 ore. */
  async add(samples: readonly SamplePayload[], now: number): Promise<void> {
    const fresh = samples
      .filter((s) => s.metric === 'STEPS')
      .map((s) => ({ ts: s.ts, steps: s.value }));
    if (fresh.length === 0) {
      return;
    }
    const byTs = new Map<number, StepsReading>();
    for (const reading of [...this.state(), ...fresh]) {
      byTs.set(reading.ts, reading);
    }
    const next = [...byTs.values()]
      .filter((r) => r.ts >= now - STEPS_KEEP_MS && r.ts <= now)
      .sort((a, b) => a.ts - b.ts);
    this.state.set(next);
    await this.store?.set(KEY, JSON.stringify(next));
  }
}
