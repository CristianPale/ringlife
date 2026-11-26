import { Injectable, InjectionToken, computed, inject, signal } from '@angular/core';
import { ApiError, toApiError } from '../api/api-error';
import { tzOffsetMin } from '../api/api.model';
import { CredentialsService } from '../api/credentials.service';
import { RingLifeApi } from '../api/ringlife-api';
import { Clock, SystemClock } from '../diary/clock';
import { SettingsService } from '../settings/settings.service';
import {
  EMPTY_QUEUE,
  MEASURE_NAMES,
  RingQueue,
  enqueue,
  lastNightOf,
  markSent,
  measureMismatches,
  oldestPendingOf,
  pendingCount,
  sameRingSettings,
  sinceOf,
} from './ring-queue.model';
import { RingQueueRepository } from './ring-queue.repository';
import { RingDeviceService } from './ring-device.service';
import { TemperatureLogService } from './temperature-log.service';
import { HeartRateLogService } from './heart-rate-log.service';
import { StepsLogService } from './steps-log.service';
import { ManualMeasureLogService } from './manual-measure-log.service';
import { MEASURE_METRIC, MeasureKind } from './measure.model';
import { splitPlausible } from './sample-contract';
import { RingError, RingMeasureStates, RingSource, describeRingError } from './ring-source';
import { RingSourceProvider } from './ring-source.provider';
import { BackgroundBridge } from './background/ring-background';
import { parseBackgroundRuns } from './background/background-runs';
import { BackgroundAttempt } from './background/background-attempts';

/** Dove sta lavorando il sync: legge l'anello o invia al server. */
export type RingSyncStep = 'ring' | 'upload';

/** Quante letture complete si tentano quando l'anello non risponde o si scollega (docs/adr/0027). */
const RING_ATTEMPTS = 2;

/** La pausa prima del secondo tentativo: l'anello ha il tempo di tornare libero. Nei test vale 0. */
export const RING_RETRY_PAUSE_MS = new InjectionToken<number>('RING_RETRY_PAUSE_MS', {
  providedIn: 'root',
  factory: () => 1_500,
});

/** Com'è andata una misura a comando (docs/adr/0039): valore e istante, o il messaggio d'errore. */
export type MeasureResult = { ok: true; kind: MeasureKind; value: number; ts: number } | { ok: false; kind: MeasureKind; message: string };

/** Un errore per cui una seconda lettura può riuscire: l'anello c'era ma non ha risposto, o si è scollegato. */
function worthRetrying(error: unknown): boolean {
  return error instanceof RingError && (error.code === 'connection_timeout' || error.code === 'disconnected');
}

/**
 * Il sync dell'anello (docs/adr/0002, 0018), a passi: legge l'anello e mette tutto in coda sul telefono, poi invia la
 * coda al server. Le due fasi sono indipendenti: senza server si legge e si accoda, senza anello si invia quello che c'è.
 * Il primo errore di una fase la ferma, non l'altra, e quello che è in coda non si perde. Non lancia mai.
 */
@Injectable({ providedIn: 'root' })
export class RingSyncService {
  private readonly repository = inject(RingQueueRepository, { optional: true });
  private readonly sources = inject(RingSourceProvider);
  private readonly api = inject(RingLifeApi);
  private readonly credentials = inject(CredentialsService);
  private readonly settings = inject(SettingsService);
  private readonly clock = inject(Clock, { optional: true }) ?? new SystemClock();
  private readonly background = inject(BackgroundBridge);
  private readonly devices = inject(RingDeviceService);
  private readonly temperature = inject(TemperatureLogService);
  private readonly heartRate = inject(HeartRateLogService);
  private readonly steps = inject(StepsLogService);
  private readonly manual = inject(ManualMeasureLogService);
  private readonly retryPauseMs = inject(RING_RETRY_PAUSE_MS);
  /** L'ultima lettura fatta in background, ms (docs/adr/0026). `null` se non ce ne sono state. */
  readonly lastBackground = signal<number | null>(null);
  /** Gli ultimi tentativi di lettura in background, riusciti o no, dal più recente (docs/adr/0026). */
  readonly backgroundAttempts = signal<readonly BackgroundAttempt[]>([]);

  private readonly queueState = signal<RingQueue>(EMPTY_QUEUE);
  private running: Promise<void> | null = null;
  /** «Salta» all'apertura (docs/adr/0043): la lettura in corso si ferma e non si invia niente. */
  private cancelled = false;
  private batteryRun: Promise<boolean> | null = null;
  private measureRun: Promise<MeasureResult> | null = null;
  /** La catena in background in corso (docs/adr/0048): una sincronizzazione chiesta intanto aspetta che finisca. */
  private chainRun: Promise<boolean> | null = null;

  readonly syncing = signal(false);
  /** L'anello era sul caricatore all'ultima lettura (docs/adr/0029). Solo in memoria: lo ridà la lettura all'apertura. */
  readonly charging = signal(false);
  /** È in corso una lettura della sola batteria. */
  readonly readingBattery = signal(false);
  /** La misura a comando in corso, circa 30 secondi (docs/adr/0039); `null` se nessuna. */
  readonly measuring = signal<MeasureKind | null>(null);
  /** L'anello è impegnato da una sincronizzazione, una lettura della batteria o una misura: una sessione dal vivo aspetta. */
  readonly busy = computed(() => this.syncing() || this.readingBattery() || this.measuring() !== null);
  /** Quando è cominciata l'ultima sincronizzazione, ms; `null` se non ce ne sono state. Serve alla lettura al ritorno. */
  readonly lastStarted = signal<number | null>(null);
  readonly step = signal<RingSyncStep | null>(null);
  /** Messaggio in italiano dell'ultimo errore dell'anello, `null` se l'ultima lettura è andata bene. */
  readonly ringError = signal<string | null>(null);
  readonly uploadError = signal<ApiError | null>(null);
  /**
   * Misure che l'anello aveva spento da solo e che la lettura ha riacceso (docs/adr/0049): quando e quali. Solo in
   * memoria, per Impostazioni › Anello.
   */
  readonly measuresRestored = signal<{ at: number; names: string[] } | null>(null);
  /** Messaggio se le misure scelte in Impostazioni non si sono potute scrivere sull'anello. */
  readonly settingsError = signal<string | null>(null);
  /** Quanti valori dell'ultima lettura erano impossibili e non sono stati tenuti (un parser sbagliato, di solito). */
  readonly discarded = signal(0);

  readonly last = computed(() => this.queueState().last);
  /** L'ultima notte letta dall'anello, inviata o no (docs/adr/0043): serve quando il server non l'ha ancora calcolata. */
  readonly lastNight = computed(() => lastNightOf(this.queueState()));
  /** Il dato più vecchio ancora da inviare, ms (docs/adr/0045). */
  readonly oldestPending = computed(() => oldestPendingOf(this.queueState()));
  /** Elementi letti dall'anello che il server non ha ancora. */
  readonly pending = computed(() => pendingCount(this.queueState()));
  /** C'è un anello da leggere (anche quello di prova). */
  readonly hasRing = computed(() => this.sources.current().kind !== 'none');
  /** Si può inviare: il telefono è collegato a un server. */
  readonly serverConnected = computed(() => this.credentials.paired() !== null && this.settings.settings().serverUrl !== '');
  /** Il sync ha qualcosa da fare: un anello da leggere, o una coda da inviare a un server. */
  readonly active = computed(() => this.hasRing() || (this.pending() > 0 && this.serverConnected()));

  async init(): Promise<void> {
    this.queueState.set((await this.repository?.load()) ?? EMPTY_QUEUE);
  }

  /**
   * Una chiamata mentre un sync è in corso aspetta quello. Una lettura della batteria o una misura in corso si lasciano
   * finire prima.
   */
  sync(): Promise<void> {
    if (!this.running) {
      this.cancelled = false;
      this.running = Promise.all([this.batteryRun, this.measureRun, this.chainRun])
        .then(() => this.run())
        .finally(() => (this.running = null));
    }
    return this.running;
  }

  /**
   * La catena dopo una lettura in background (docs/adr/0048): importa le letture del raccoglitore nativo e le invia,
   * senza il Bluetooth, perché l'anello l'ha appena letto il nativo. Dice a che punto è con `report`. `true` se ha
   * inviato tutto; `false` senza server, con un errore d'invio, o con un'altra lettura in corso (allora non fa niente).
   */
  backgroundChain(report: (step: 'decoded' | 'uploaded') => Promise<void>): Promise<boolean> {
    if (this.running || this.batteryRun || this.measureRun || this.chainRun) {
      return Promise.resolve(false);
    }
    this.chainRun = (async () => {
      this.uploadError.set(null);
      await this.importBackground();
      await report('decoded');
      if (!this.serverConnected()) {
        return false;
      }
      await this.upload();
      if (this.uploadError() !== null) {
        return false;
      }
      await report('uploaded');
      return true;
    })().finally(() => (this.chainRun = null));
    return this.chainRun;
  }

  /**
   * Annulla la sincronizzazione in corso (docs/adr/0043): scollega l'anello anche a metà collegamento, niente secondo
   * tentativo, niente invio e nessun errore da mostrare. Quello che è già in coda resta. Senza sync in corso non fa niente.
   */
  async cancel(): Promise<void> {
    if (!this.running) {
      return;
    }
    this.cancelled = true;
    try {
      await this.sources.current().disconnect();
    } catch {
      // Già scollegato.
    }
  }

  /**
   * Solo la batteria, mentre l'anello è in carica (docs/adr/0029): si collega, legge carica e stato, si scollega.
   * Aggiorna la percentuale salvata e `charging`. Non parte durante una sincronizzazione o un'altra lettura. Un errore
   * non si mostra: si riprova alla lettura dopo. `true` se ha letto.
   */
  refreshBattery(): Promise<boolean> {
    const source = this.sources.current();
    if (source.kind === 'none' || this.running || this.batteryRun || this.measureRun) {
      return Promise.resolve(false);
    }
    this.batteryRun = this.readBattery(source).finally(() => (this.batteryRun = null));
    return this.batteryRun;
  }

  private async readBattery(source: RingSource): Promise<boolean> {
    this.readingBattery.set(true);
    try {
      await source.connect();
      const status = await source.battery();
      this.charging.set(status.charging);
      void this.background.batteryReading(status.percent);
      const last = this.queueState().last;
      if (last) {
        await this.persist({ ...this.queueState(), last: { ...last, battery: status.percent } });
      }
      return true;
    } catch {
      return false;
    } finally {
      try {
        await source.disconnect();
      } catch {
        // Già scollegato.
      }
      this.readingBattery.set(false);
    }
  }

  /**
   * Misura a comando (docs/adr/0039): si collega, l'anello misura (circa 30 secondi, un minuto l'HRV), si scollega
   * sempre. La misura resta sul telefono (la temperatura anche tra le misure di temperatura) e non va al server. Non
   * parte durante una sincronizzazione, una lettura della batteria o un'altra misura. Non lancia.
   */
  measure(kind: MeasureKind): Promise<MeasureResult> {
    const source = this.sources.current();
    if (source.kind === 'none') {
      return Promise.resolve({ ok: false, kind, message: describeRingError(new RingError('unsupported')) });
    }
    if (this.running || this.batteryRun || this.measureRun) {
      return Promise.resolve({ ok: false, kind, message: "L'anello è impegnato in un'altra lettura. Riprova tra poco." });
    }
    this.measureRun = this.measureOnce(source, kind).finally(() => (this.measureRun = null));
    return this.measureRun;
  }

  private async measureOnce(source: RingSource, kind: MeasureKind): Promise<MeasureResult> {
    this.measuring.set(kind);
    try {
      await source.connect();
      const value = await source.measure(kind);
      const ts = this.clock.now().getTime();
      // Lo stesso controllo dei campioni dello storico: un valore impossibile è un formato letto male.
      if (splitPlausible([{ metric: MEASURE_METRIC[kind], ts, value }]).kept.length === 0) {
        return { ok: false, kind, message: describeRingError(new RingError('measure_failed', 'valore impossibile')) };
      }
      await this.manual.record(kind, ts, value);
      if (kind === 'temperature') {
        await this.temperature.addMeasure(ts, value);
      }
      return { ok: true, kind, value, ts };
    } catch (error) {
      return { ok: false, kind, message: describeRingError(error) };
    } finally {
      try {
        await source.disconnect();
      } catch {
        // Già scollegato.
      }
      this.measuring.set(null);
    }
  }

  private async run(): Promise<void> {
    this.lastStarted.set(this.clock.now().getTime());
    this.syncing.set(true);
    this.ringError.set(null);
    this.uploadError.set(null);
    this.settingsError.set(null);
    try {
      await this.importBackground();
      const source = this.sources.current();
      if (source.kind !== 'none' && !this.cancelled) {
        this.step.set('ring');
        await this.readRing(source);
      }
      if (this.cancelled) {
        return;
      }
      this.step.set('upload');
      await this.upload();
    } finally {
      this.step.set(null);
      this.syncing.set(false);
    }
  }

  /** Le letture fatte in background dal nativo entrano nella coda come una lettura normale, poi si inviano. */
  private async importBackground(): Promise<void> {
    const { json, lastRun } = await this.background.drain();
    if (lastRun !== null) {
      this.lastBackground.set(lastRun);
    }
    await this.loadBackgroundAttempts();
    for (const run of parseBackgroundRuns(json)) {
      const { kept } = splitPlausible(run.reading.samples);
      await this.temperature.add(kept, this.clock.now().getTime());
      await this.heartRate.add(kept, this.clock.now().getTime());
      await this.steps.add(kept, this.clock.now().getTime());
      const queue = enqueue(this.queueState(), { ...run.reading, samples: kept }, run.tzOffsetMin);
      const last = this.queueState().last;
      // L'ultima lettura resta quella più recente tra primo piano e background.
      const newer = !last || run.at > last.at;
      await this.persist({
        ...queue,
        last: newer ? { at: run.at, battery: run.battery, firmware: last?.firmware ?? null } : queue.last,
      });
    }
  }

  /**
   * Legge l'anello; se non ha risposto o si è scollegato, riprova una volta da capo. La lettura entra in coda solo se
   * completa, quindi rifarla non duplica niente.
   */
  /** Rilegge il registro dei tentativi in background, senza toccare le letture salvate. Non lancia. */
  async loadBackgroundAttempts(): Promise<void> {
    try {
      this.backgroundAttempts.set(await this.background.attempts());
    } catch {
      // Senza registro (browser, Android) la pagina non mostra niente.
    }
  }

  private async readRing(source: RingSource): Promise<void> {
    for (let attempt = 1; ; attempt++) {
      const error = await this.readOnce(source);
      if (error === null || this.cancelled) {
        return;
      }
      if (attempt >= RING_ATTEMPTS || !worthRetrying(error)) {
        this.ringError.set(describeRingError(error));
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, this.retryPauseMs));
      if (this.cancelled) {
        return;
      }
    }
  }

  /** Una lettura completa, dal collegamento allo scollegamento. Restituisce l'errore, o `null` se è andata bene. */
  private async readOnce(source: RingSource): Promise<unknown> {
    const now = this.clock.now();
    const offset = tzOffsetMin(now);
    try {
      await source.connect();
      // Chi è l'anello: solo per quello vero, la prova non deve sporcare la sua scheda. Non riuscire non ferma niente.
      const info = source.kind === 'ble' ? await source.deviceInfo().catch(() => null) : null;
      if (info) {
        await this.devices.recordSeen(info, now.getTime());
      }
      await source.setTime(now, offset);
      await this.applySettings(source);
      const { percent: battery, charging } = await source.battery();
      this.charging.set(charging);
      void this.background.batteryReading(battery);
      const read = await source.readHistory(sinceOf(this.queueState()));
      const { kept, rejected } = splitPlausible(read.samples);
      await this.temperature.add(kept, now.getTime());
      await this.heartRate.add(kept, now.getTime());
      await this.steps.add(kept, now.getTime());
      this.discarded.set(rejected.length);
      const reading = { ...read, samples: kept };
      const queue = enqueue(this.queueState(), reading, offset);
      // «Anello non letto» si sposta in avanti di 24 ore (docs/adr/0045).
      void this.background.ringRead();
      // La posizione avanza qui, a dati salvati in coda: un server spento non fa rileggere lo stesso storico.
      await this.persist({
        ...queue,
        last: { at: now.getTime(), battery, firmware: info?.firmware ?? reading.firmware ?? queue.last?.firmware ?? null },
      });
      return null;
    } catch (error) {
      return error ?? new Error('unknown');
    } finally {
      // Sempre: un solo central alla volta, e l'anello deve tornare libero anche dopo un errore.
      try {
        await source.disconnect();
      } catch {
        // Già scollegato.
      }
    }
  }

  /**
   * Scrive sull'anello le misure scelte in Impostazioni quando l'anello ne ha di diverse (docs/adr/0049): prima le
   * rilegge dall'anello, perché l'anello può perderle (scarico, ripristino, un'altra app). Una sorgente che non sa
   * rileggerle le scrive solo se sono cambiate dall'ultima volta. Un errore qui non ferma la lettura: si riprova al
   * prossimo sync.
   */
  private async applySettings(source: RingSource): Promise<void> {
    const wanted = this.settings.settings().ring;
    const applied = this.queueState().applied;
    let onRing: RingMeasureStates | null = null;
    try {
      onRing = await source.readSettings();
    } catch {
      onRing = null;
    }
    const different = onRing ? measureMismatches(onRing, wanted, applied) : sameRingSettings(applied, wanted) ? [] : null;
    if (different !== null && different.length === 0) {
      if (!sameRingSettings(applied, wanted)) {
        await this.persist({ ...this.queueState(), applied: { ...wanted } });
      }
      return;
    }
    try {
      await source.applySettings(wanted);
      await this.persist({ ...this.queueState(), applied: { ...wanted } });
      // Misure che l'anello aveva perso, pur scritte prima: lo si dice in Impostazioni › Anello.
      const lost = onRing && sameRingSettings(applied, wanted) ? (different ?? []) : [];
      if (lost.length > 0) {
        this.measuresRestored.set({ at: this.clock.now().getTime(), names: lost.map((key) => MEASURE_NAMES[key]) });
      }
      // Un primo tentativo fallito qui non deve restare come errore se il secondo le ha scritte.
      this.settingsError.set(null);
    } catch (error) {
      this.settingsError.set(describeRingError(error));
    }
  }

  private async upload(): Promise<void> {
    if (!this.serverConnected()) {
      return;
    }
    try {
      while (this.queueState().batches.length > 0 && !this.cancelled) {
        const batch = this.queueState().batches[0];
        if (batch.samples.length > 0) {
          await this.api.uploadSamples(batch.samples, batch.tzOffsetMin);
          await this.persist(markSent(this.queueState(), 0, { samples: true }));
        }
        if (batch.sessions.length > 0) {
          await this.api.uploadSleep(batch.sessions, batch.tzOffsetMin);
          await this.persist(markSent(this.queueState(), 0, { sessions: true }));
        }
      }
    } catch (error) {
      this.uploadError.set(error instanceof ApiError ? error : toApiError(error));
    }
  }

  private async persist(queue: RingQueue): Promise<void> {
    this.queueState.set(queue);
    await this.repository?.save(queue);
  }
}
