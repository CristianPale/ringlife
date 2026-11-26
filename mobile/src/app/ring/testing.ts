import { RingSettings } from '../settings/settings.model';
import { RingDeviceInfo } from './ring-device.model';
import { MeasureKind } from './measure.model';
import { BatteryStatus, RingMeasureStates, RingReading, RingSource } from './ring-source';

/** Solo per i test: una sorgente che fa quello che le si dice e ricorda in che ordine l'hanno chiamata. */
export class ScriptedRingSource extends RingSource {
  readonly kind = 'ble' as const;
  readonly calls: string[] = [];
  sinceSeen: (number | null)[] = [];
  failAt: 'connect' | 'setTime' | 'applySettings' | 'battery' | 'readHistory' | null = null;
  appliedSettings: RingSettings[] = [];
  failWith: Error = new Error('boom');
  /** Quante volte fallisce a `failAt` prima di riuscire. */
  failures = Infinity;
  reading: RingReading = { samples: [], sessions: [] };
  batteryPercent = 80;
  charging = false;
  /** Ciò che l'anello dice di sé; `null` come una sorgente che non lo sa. Non entra in `calls`. */
  info: RingDeviceInfo | null = null;
  /** Le misure accese sull'anello; `null` come una sorgente che non sa rileggerle. Non entra in `calls`. */
  measures: RingMeasureStates | null = null;

  private step(name: 'connect' | 'setTime' | 'applySettings' | 'battery' | 'readHistory'): void {
    this.calls.push(name);
    if (this.failAt === name && this.failures > 0) {
      this.failures--;
      throw this.failWith;
    }
  }

  async connect(): Promise<void> {
    this.step('connect');
  }
  async setTime(): Promise<void> {
    this.step('setTime');
  }
  async applySettings(settings: RingSettings): Promise<void> {
    this.step('applySettings');
    this.appliedSettings.push({ ...settings });
  }
  override async deviceInfo(): Promise<RingDeviceInfo | null> {
    return this.info;
  }
  override async readSettings(): Promise<RingMeasureStates | null> {
    return this.measures;
  }
  async battery(): Promise<BatteryStatus> {
    this.step('battery');
    return { percent: this.batteryPercent, charging: this.charging };
  }
  async readHistory(sinceMs: number | null): Promise<RingReading> {
    this.sinceSeen.push(sinceMs);
    this.step('readHistory');
    return this.reading;
  }
  /** Ciò che dà la misura a comando: il valore, o un errore da lanciare. */
  measured: Record<MeasureKind, number | Error> = { heartRate: 64, spo2: 97, hrv: 52, stress: 32, temperature: 36.5 };
  override async measure(kind: MeasureKind): Promise<number> {
    this.calls.push(`measure:${kind}`);
    const result = this.measured[kind];
    if (result instanceof Error) {
      throw result;
    }
    return result;
  }
  async disconnect(): Promise<void> {
    this.calls.push('disconnect');
  }
}
