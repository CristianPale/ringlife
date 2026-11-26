import { SamplePayload, SleepSessionPayload } from '../api/api.model';
import { RingSettings } from '../settings/settings.model';
import { RingDeviceInfo } from './ring-device.model';
import { MeasureKind } from './measure.model';

/** Ciò che l'anello ha dato in una lettura, già nei formati dell'API. */
export interface RingReading {
  samples: SamplePayload[];
  sessions: SleepSessionPayload[];
  firmware?: string;
}

/** La batteria dell'anello: carica 0-100 e se è sul caricatore (docs/adr/0029). */
export interface BatteryStatus {
  percent: number;
  charging: boolean;
}

/** Perché una lettura dell'anello non è riuscita. Ogni codice ha un messaggio in italiano. */
export type RingErrorCode =
  | 'permission_denied'
  | 'bluetooth_off'
  | 'ring_not_found'
  | 'connection_timeout'
  | 'disconnected'
  | 'ring_busy'
  | 'not_linked'
  | 'unsupported'
  | 'measure_failed'
  /** La lettura è stata annullata da chi la usa («Salta», docs/adr/0043): non si mostra mai come errore. */
  | 'cancelled'
  | 'unknown';

export class RingError extends Error {
  constructor(
    readonly code: RingErrorCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'RingError';
  }
}

const RING_MESSAGES: Record<RingErrorCode, string> = {
  permission_denied: 'Manca il permesso Bluetooth. Consentilo dalle impostazioni del telefono.',
  bluetooth_off: 'Il Bluetooth è spento. Accendilo e riprova.',
  ring_not_found:
    "Non trovo l'anello. Avvicinalo al telefono e controlla che sia carico. Se non basta, spegni e riaccendi il Bluetooth del telefono e riprova.",
  connection_timeout: "L'anello non ha risposto in tempo. Riprova tra poco.",
  disconnected: "L'anello si è scollegato durante la lettura. Tienilo vicino al telefono e riprova.",
  ring_busy: "L'anello è collegato a un'altra app (per esempio l'app del produttore). Chiudila e riprova.",
  not_linked: "L'anello è scollegato da RingLife. Ricollegalo da Impostazioni.",
  unsupported: 'Questo telefono non può leggere l\'anello.',
  measure_failed: "L'anello non è riuscito a misurare. Controlla che sia ben indossato, tieni ferma la mano e riprova.",
  cancelled: 'Lettura annullata.',
  unknown: "Lettura dell'anello non riuscita.",
};

export function describeRingError(error: unknown): string {
  const base = RING_MESSAGES[error instanceof RingError ? error.code : 'unknown'];
  // Il dettaglio (per esempio quale comando non ha avuto risposta) serve a capire dove si è fermato.
  return error instanceof RingError && error.message !== error.code ? `${base} (${error.message})` : base;
}

/**
 * Le misure che l'anello fa da solo, come le dice l'anello (docs/adr/0049): `hrIntervalMin` 0 = battito spento.
 * `null` dove l'anello non ha risposto alla lettura.
 */
export interface RingMeasureStates {
  hrIntervalMin: number | null;
  stress: boolean | null;
  spo2: boolean | null;
  hrv: boolean | null;
  temperature: boolean | null;
}

/**
 * Da dove arrivano i dati dell'anello (docs/adr/0018). Indipendente da Capacitor: la sorgente vera (Bluetooth) e quella
 * di prova hanno la stessa forma, così il resto dell'app non sa quale sta usando.
 *
 * Una lettura segue sempre quest'ordine: `connect`, `setTime`, `applySettings` (solo se cambiate), `battery`,
 * `readHistory`, `disconnect`. Chi chiama garantisce `disconnect` anche dopo un errore.
 */
export abstract class RingSource {
  /** `none`: nessun anello collegato, il sync dell'anello non parte. */
  abstract readonly kind: 'ble' | 'demo' | 'none';
  abstract connect(): Promise<void>;
  /** L'anello non ha fuso orario: a ogni sync gli si dà l'ora del telefono. */
  abstract setTime(now: Date, tzOffsetMin: number): Promise<void>;
  /** Le misure che l'anello fa da solo: ogni quanto il battito, se lo stress e la SpO2. Si scrivono solo quando cambiano. */
  abstract applySettings(settings: RingSettings): Promise<void>;
  /** Carica della batteria, 0-100, e se l'anello è in carica. */
  abstract battery(): Promise<BatteryStatus>;
  /** Ciò che l'anello ha dopo `sinceMs` (istante dell'ultima lettura già salvata), o tutto se `null`. */
  abstract readHistory(sinceMs: number | null): Promise<RingReading>;
  abstract disconnect(): Promise<void>;

  /**
   * Chi è l'anello (docs/adr/0030): nome, firmware, hardware, indirizzo. Si chiama da collegati. `null`: questa sorgente
   * non lo sa.
   */
  deviceInfo(): Promise<RingDeviceInfo | null> {
    return Promise.resolve(null);
  }

  /**
   * Quali misure l'anello ha accese adesso (docs/adr/0049). Si chiama da collegati, prima di `applySettings`. `null`:
   * questa sorgente non lo sa, e valgono le misure scritte l'ultima volta.
   */
  readSettings(): Promise<RingMeasureStates | null> {
    return Promise.resolve(null);
  }

  /**
   * Battito dal vivo (docs/adr/0024): si collega e resta collegata finché non si chiama `stop` della sessione, che
   * scollega sempre. `listener` riceve i battiti al minuto, o `null` finché l'anello non ha agganciato il segnale.
   * Di base non c'è: la sorgente che lo sa fare lo ridefinisce.
   */
  startLiveHeartRate(_listener: (bpm: number | null) => void): Promise<LiveSession> {
    return Promise.reject(new RingError('unsupported'));
  }

  /**
   * Misura a comando (docs/adr/0039): l'anello misura adesso, in circa 30 secondi (un minuto l'HRV). Il valore è in
   * battiti al minuto, percentuale, millisecondi, livello di stress o gradi. Si chiama da collegati; chi chiama scollega.
   * Di base non c'è: la sorgente che lo sa fare la ridefinisce.
   */
  measure(_kind: MeasureKind): Promise<number> {
    return Promise.reject(new RingError('unsupported'));
  }
}

/** Una sessione di battito dal vivo in corso. */
export interface LiveSession {
  stop(): Promise<void>;
  /**
   * Pausa e ripresa dell'allenamento (docs/adr/0042). Facoltative: una sorgente che non le ha lascia all'app il compito
   * di non registrare i battiti in pausa.
   */
  pause?(): Promise<void>;
  resume?(): Promise<void>;
}

/**
 * Nessun anello: la sorgente di chi non ne ha uno da leggere. `reason` dice perché: il telefono non può (`unsupported`)
 * o l'utente l'ha scollegato da RingLife (`not_linked`, docs/adr/0030).
 */
export class NoRingSource extends RingSource {
  readonly kind = 'none' as const;

  constructor(private readonly reason: 'unsupported' | 'not_linked' = 'unsupported') {
    super();
  }

  async connect(): Promise<void> {
    throw new RingError(this.reason);
  }
  async setTime(): Promise<void> {
    throw new RingError(this.reason);
  }
  async applySettings(): Promise<void> {
    throw new RingError(this.reason);
  }
  async battery(): Promise<BatteryStatus> {
    throw new RingError(this.reason);
  }
  async readHistory(): Promise<RingReading> {
    throw new RingError(this.reason);
  }
  override startLiveHeartRate(): Promise<LiveSession> {
    return Promise.reject(new RingError(this.reason));
  }
  override measure(): Promise<number> {
    return Promise.reject(new RingError(this.reason));
  }
  async disconnect(): Promise<void> {
    // Niente da chiudere.
  }
}
