import { buildDemoData } from '../api/demo-data';
import { RingSettings } from '../settings/settings.model';
import { MeasureKind } from './measure.model';
import { BatteryStatus, LiveSession, RingReading, RingSource } from './ring-source';

/** Quanti giorni di storico dà la prima lettura di prova. */
const DEMO_HISTORY_DAYS = 10;
/** I valori inventati della misura a comando. */
const DEMO_MEASURES: Record<MeasureKind, number> = { heartRate: 64, spo2: 97, hrv: 52, stress: 32, temperature: 36.5 };

/**
 * Un anello finto, per provare adesso tutto il percorso anello → telefono → server (docs/adr/0018). I dati sono
 * quelli inventati di `buildDemoData`: gli orari avanzano con l'orologio, quindi ogni lettura dà solo ciò che è
 * «successo» dopo la precedente, come farebbe un anello vero. Nessun dato reale.
 */
export class DemoRingSource extends RingSource {
  readonly kind = 'demo' as const;
  private tzOffsetMin = 0;
  private connected = false;
  /** Le ultime impostazioni «scritte» sull'anello finto: si vedono nei test e nella prova. */
  applied: RingSettings | null = null;

  constructor(
    private readonly now: () => Date = () => new Date(),
    private readonly batteryPercent = 62,
  ) {
    super();
  }

  async connect(): Promise<void> {
    this.connected = true;
  }

  async setTime(_now: Date, tzOffsetMin: number): Promise<void> {
    this.tzOffsetMin = tzOffsetMin;
  }

  async applySettings(settings: RingSettings): Promise<void> {
    this.applied = { ...settings };
  }

  async battery(): Promise<BatteryStatus> {
    return { percent: this.batteryPercent, charging: false };
  }

  async readHistory(sinceMs: number | null): Promise<RingReading> {
    if (!this.connected) {
      throw new Error('anello non collegato');
    }
    const data = buildDemoData(this.now(), this.tzOffsetMin, DEMO_HISTORY_DAYS);
    return {
      samples: data.samples.filter((s) => sinceMs === null || s.ts > sinceMs),
      sessions: data.sessions.filter((s) => sinceMs === null || s.end > sinceMs),
      firmware: 'demo',
    };
  }

  async disconnect(): Promise<void> {
    this.connected = false;
  }

  /** Misura a comando inventata: subito, senza i 30 secondi dell'anello vero. */
  override async measure(kind: MeasureKind): Promise<number> {
    if (!this.connected) {
      throw new Error('anello non collegato');
    }
    return DEMO_MEASURES[kind];
  }

  /** Battito dal vivo inventato: dopo qualche secondo di «aggancio», un valore al secondo intorno a 68. */
  override async startLiveHeartRate(listener: (bpm: number | null) => void): Promise<LiveSession> {
    this.connected = true;
    let tick = 0;
    const timer = setInterval(() => {
      tick++;
      listener(tick < 4 ? null : Math.round(68 + 6 * Math.sin(tick / 5)));
    }, 1000);
    return {
      stop: async () => {
        clearInterval(timer);
        this.connected = false;
      },
    };
  }
}
