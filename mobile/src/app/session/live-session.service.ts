import { Injectable, NgZone, inject, signal } from '@angular/core';
import { RingSyncService } from '../ring/ring-sync.service';
import { RingSourceProvider } from '../ring/ring-source.provider';
import { LiveSession, describeRingError } from '../ring/ring-source';
import { SettingsService } from '../settings/settings.service';
import { SessionHistoryService, TrainingExtras } from './session-history.service';
import { LiveSample, SessionMode } from './session.model';
import {
  Activity,
  HeartRateRecovery,
  RECOVERY_MS,
  calorieProfile,
  heartRateRecovery,
  sessionKcal,
} from './training';

export type LiveStatus =
  'idle' | 'connecting' | 'waiting' | 'live' | 'paused' | 'recovering' | 'ended' | 'error';

/** Le scelte prima di un allenamento (docs/adr/0042). */
export interface TrainingOptions {
  activity: Activity;
  /** Zona obiettivo 1-5, o `null` senza obiettivo. */
  targetZone: number | null;
}

/**
 * Una sessione di battito dal vivo (docs/adr/0024, docs/adr/0042): si collega all'anello, raccoglie i battiti finché non
 * si ferma e si scollega sempre. L'allenamento ha la pausa e, dopo «Fine», un minuto di recupero del battito. Mai
 * durante una sincronizzazione: l'anello parla con un solo telefono e una connessione alla volta.
 */
@Injectable({ providedIn: 'root' })
export class LiveSessionService {
  private readonly sources = inject(RingSourceProvider);
  private readonly sync = inject(RingSyncService);
  private readonly zone = inject(NgZone);
  private readonly history = inject(SessionHistoryService);
  private readonly settings = inject(SettingsService, { optional: true });

  readonly status = signal<LiveStatus>('idle');
  readonly bpm = signal<number | null>(null);
  readonly samples = signal<readonly LiveSample[]>([]);
  readonly startedAt = signal<number | null>(null);
  /** La fine dell'attività («Fine»), prima del minuto di recupero. */
  readonly endedAt = signal<number | null>(null);
  readonly error = signal<string | null>(null);
  /** La sessione appena salvata nello storico, per aprirne il dettaglio. */
  readonly savedId = signal<string | null>(null);
  /** Le scelte dell'allenamento in corso; `null` per la respirazione. */
  readonly options = signal<TrainingOptions | null>(null);
  /** Millisecondi passati in pausa, pause finite. */
  readonly pausedMs = signal(0);
  /** I battiti del minuto di recupero, in millisecondi dalla fine. */
  readonly recoverySamples = signal<readonly LiveSample[]>([]);
  readonly recovery = signal<HeartRateRecovery | null>(null);
  readonly kcal = signal<number | null>(null);
  private mode: SessionMode = 'respirazione';
  private pausedAt: number | null = null;
  private recoveryTimer: ReturnType<typeof setTimeout> | undefined;

  private session: LiveSession | null = null;

  async start(
    mode: SessionMode,
    now: () => number = Date.now,
    options: TrainingOptions | null = null,
  ): Promise<void> {
    if (this.session || this.status() === 'connecting') {
      return;
    }
    if (this.sync.busy()) {
      this.fail("Sto sincronizzando l'anello: riprova tra qualche secondo.");
      return;
    }
    this.mode = mode;
    this.clear();
    this.options.set(mode === 'allenamento' ? options : null);
    this.status.set('connecting');
    try {
      this.session = await this.sources.current().startLiveHeartRate((value) =>
        // Il Bluetooth chiama fuori da Angular: si rientra perché la schermata si aggiorni.
        this.zone.run(() => this.onValue(value, now())),
      );
      this.startedAt.set(now());
      this.status.set('waiting');
    } catch (error) {
      this.session = null;
      this.fail(describeRingError(error));
    }
  }

  /** Il tempo attivo fino a `at`: le pause non contano, il minuto di recupero nemmeno. */
  activeMs(at: number): number {
    const start = this.startedAt();
    if (start === null) {
      return 0;
    }
    const end = this.endedAt() ?? at;
    const pausing = this.pausedAt !== null ? Math.max(0, end - this.pausedAt) : 0;
    return Math.max(0, end - start - this.pausedMs() - pausing);
  }

  /** Pausa dell'allenamento: i battiti non si registrano e il tempo attivo si ferma. */
  async pause(now: () => number = Date.now): Promise<void> {
    if (this.status() !== 'live' && this.status() !== 'waiting') {
      return;
    }
    this.pausedAt = now();
    this.status.set('paused');
    await this.session?.pause?.().catch(() => undefined);
  }

  async resume(now: () => number = Date.now): Promise<void> {
    if (this.status() !== 'paused') {
      return;
    }
    this.closePause(now());
    this.status.set(this.samples().length > 0 ? 'live' : 'waiting');
    await this.session?.resume?.().catch(() => undefined);
  }

  /**
   * «Fine». L'allenamento con almeno un battito resta collegato un minuto per il recupero del battito, poi si chiude da
   * solo; la respirazione si chiude subito.
   */
  async finish(now: () => number = Date.now): Promise<void> {
    const status = this.status();
    if (status !== 'waiting' && status !== 'live' && status !== 'paused') {
      return;
    }
    const end = now();
    const wasPaused = status === 'paused';
    this.closePause(end);
    this.endedAt.set(end);
    if (this.mode === 'allenamento' && this.samples().length > 0 && this.session) {
      this.status.set('recovering');
      this.recoverySamples.set([]);
      this.recoveryEnd = end;
      if (wasPaused) {
        // Per il recupero l'anello deve tornare a misurare.
        await this.session.resume?.().catch(() => undefined);
      }
      this.recoveryTimer = setTimeout(() => void this.complete(true), RECOVERY_MS);
      return;
    }
    await this.complete(false);
  }

  /** Chiude il minuto di recupero prima del tempo: niente recupero del battito. */
  async skipRecovery(): Promise<void> {
    if (this.status() === 'recovering') {
      await this.complete(false);
    }
  }

  /** Ferma tutto adesso, per esempio uscendo dalla pagina. Un recupero a metà tiene quello che ha. */
  async stop(now: () => number = Date.now): Promise<void> {
    const status = this.status();
    if (status === 'recovering') {
      await this.complete(true);
      return;
    }
    if (
      status === 'waiting' ||
      status === 'live' ||
      status === 'paused' ||
      status === 'connecting'
    ) {
      const end = now();
      this.closePause(end);
      this.endedAt.set(end);
      await this.complete(false);
      return;
    }
    await this.closeRing();
  }

  /** Torna all'inizio, senza sessione. */
  reset(): void {
    this.clear();
    this.status.set('idle');
  }

  private recoveryEnd = 0;

  private async complete(withRecovery: boolean): Promise<void> {
    clearTimeout(this.recoveryTimer);
    await this.closeRing();
    if (this.status() === 'ended') {
      return;
    }
    const recovery = withRecovery
      ? heartRateRecovery(this.samples(), this.recoverySamples())
      : null;
    this.recovery.set(recovery);
    this.kcal.set(this.mode === 'allenamento' ? this.estimateKcal() : null);
    this.status.set('ended');
    const start = this.startedAt();
    const end = this.endedAt();
    if (start !== null && end !== null) {
      const options = this.options();
      const extras: TrainingExtras =
        this.mode === 'allenamento'
          ? {
              activity: options?.activity ?? 'altro',
              targetZone: options?.targetZone ?? null,
              kcal: this.kcal(),
              recovery,
            }
          : {};
      const saved = await this.history.add(
        this.mode,
        start,
        this.activeMs(end),
        this.samples(),
        extras,
      );
      this.savedId.set(saved?.id ?? null);
    }
  }

  private estimateKcal(): number | null {
    const profile = this.settings
      ? calorieProfile(this.settings.settings().profile, new Date().getFullYear())
      : null;
    return profile && this.samples().length > 0 ? sessionKcal(this.samples(), profile) : null;
  }

  private async closeRing(): Promise<void> {
    const session = this.session;
    this.session = null;
    if (session) {
      try {
        await session.stop();
      } catch {
        // La sessione si chiude comunque: l'anello si scollega da solo se il telefono smette di parlargli.
      }
    }
  }

  private closePause(at: number): void {
    if (this.pausedAt !== null) {
      this.pausedMs.update((ms) => ms + Math.max(0, at - this.pausedAt!));
      this.pausedAt = null;
    }
  }

  private clear(): void {
    clearTimeout(this.recoveryTimer);
    this.bpm.set(null);
    this.samples.set([]);
    this.startedAt.set(null);
    this.endedAt.set(null);
    this.error.set(null);
    this.savedId.set(null);
    this.options.set(null);
    this.pausedMs.set(0);
    this.pausedAt = null;
    this.recoverySamples.set([]);
    this.recovery.set(null);
    this.kcal.set(null);
  }

  private onValue(value: number | null, at: number): void {
    if (!this.session || this.status() === 'paused') {
      return;
    }
    this.bpm.set(value);
    if (value === null) {
      return;
    }
    if (this.status() === 'recovering') {
      this.recoverySamples.update((list) => [...list, { t: at - this.recoveryEnd, bpm: value }]);
      return;
    }
    this.status.set('live');
    const start = this.startedAt() ?? at;
    this.samples.update((list) => [...list, { t: at - start, bpm: value }]);
  }

  private fail(message: string): void {
    this.error.set(message);
    this.status.set('error');
  }
}
