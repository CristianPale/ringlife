import { Injectable, inject, signal } from '@angular/core';
import { KeyValueStore, PLAIN_STORE } from '../api/key-value-store';
import { MEASURE_KINDS, MeasureKind } from './measure.model';

/** L'ultima misura a comando di un tipo: istante e valore. */
export interface ManualMeasure {
  ts: number;
  value: number;
}

const KEY = 'ring-manual.v1';

function isMeasure(value: unknown): value is ManualMeasure {
  const v = value as Record<string, unknown>;
  return typeof v === 'object' && v !== null && typeof v['ts'] === 'number' && typeof v['value'] === 'number';
}

/**
 * L'ultima misura a comando di ogni tipo (docs/adr/0039), sul telefono. Il server non le riceve: gli indici usano le
 * misure che l'anello fa da solo.
 */
@Injectable({ providedIn: 'root' })
export class ManualMeasureLogService {
  private readonly store = inject<KeyValueStore>(PLAIN_STORE, { optional: true });
  private readonly state = signal<Partial<Record<MeasureKind, ManualMeasure>>>({});

  readonly measures = this.state.asReadonly();

  async init(): Promise<void> {
    try {
      const raw = await this.store?.get(KEY);
      const saved = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      const next: Partial<Record<MeasureKind, ManualMeasure>> = {};
      for (const kind of MEASURE_KINDS) {
        const value = saved?.[kind];
        if (isMeasure(value)) {
          next[kind] = { ts: value.ts, value: value.value };
        }
      }
      this.state.set(next);
    } catch {
      this.state.set({});
    }
  }

  async record(kind: MeasureKind, ts: number, value: number): Promise<void> {
    const next = { ...this.state(), [kind]: { ts, value } };
    this.state.set(next);
    await this.store?.set(KEY, JSON.stringify(next));
  }
}
