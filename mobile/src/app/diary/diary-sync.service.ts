import { DestroyRef, Injectable, NgZone, computed, effect, inject, signal } from '@angular/core';
import { DiaryPayload } from '../api/api.model';
import { ApiError, toApiError } from '../api/api-error';
import { CredentialsService } from '../api/credentials.service';
import { RingLifeApi } from '../api/ringlife-api';
import { SettingsService } from '../settings/settings.service';
import {
  EMPTY_SYNCED,
  SyncedDiary,
  applySent,
  diffDiary,
  entryPayload,
  episodePayload,
  isEmpty,
  pendingCount,
  requestsFor,
  restorable,
  syncedFor,
} from './diary-sync.model';
import { DiarySyncRepository } from './diary-sync.repository';
import { HeadacheService } from './headache.service';
import { JournalService } from './journal.service';

/** Attesa dopo una modifica prima di inviare: più modifiche ravvicinate partono insieme. */
const DEBOUNCE_MS = 3000;

/**
 * Invia il diario al server (docs/adr/0010). Tiene l'elenco di ciò che il server ha già ricevuto e manda solo
 * il resto. Se la rete cade non si perde niente: l'elenco si aggiorna richiesta per richiesta e il prossimo invio
 * riparte da ciò che manca. Parte da solo dopo ogni modifica e all'apertura; non fa niente senza un server collegato.
 */
@Injectable({ providedIn: 'root' })
export class DiarySyncService {
  private readonly repository = inject(DiarySyncRepository, { optional: true });
  private readonly api = inject(RingLifeApi);
  private readonly credentials = inject(CredentialsService);
  private readonly settings = inject(SettingsService);
  private readonly journal = inject(JournalService);
  private readonly headaches = inject(HeadacheService);
  private readonly zone = inject(NgZone);

  private readonly syncedState = signal<SyncedDiary>(EMPTY_SYNCED);
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running: Promise<void> | null = null;
  private again = false;

  readonly syncing = signal(false);
  readonly restoring = signal(false);
  /** L'ultimo errore dell'invio, per dirlo nelle Impostazioni. `null` se l'ultimo invio è andato bene. */
  readonly error = signal<ApiError | null>(null);

  /** Il server e il dispositivo a cui si invia: se cambiano, ciò che era stato inviato prima non vale più. */
  private readonly target = computed(() => `${this.settings.settings().serverUrl}|${this.credentials.paired()?.deviceId ?? ''}`);
  private readonly synced = computed(() => syncedFor(this.syncedState(), this.target()));
  private readonly diff = computed(() => diffDiary(this.synced(), this.journal.entries(), this.headaches.episodes()));
  /** Elementi che il server non ha ancora (nuovi, cambiati o da cancellare). */
  readonly pending = computed(() => pendingCount(this.diff()));
  /** Si può inviare: il telefono è collegato a un server. */
  readonly connected = computed(() => this.credentials.paired() !== null && this.settings.settings().serverUrl !== '');

  constructor() {
    effect(() => {
      // Ogni modifica del diario, e il collegamento a un server, riarmano l'invio.
      this.diff();
      this.connected();
      this.schedule();
    });
    inject(DestroyRef).onDestroy(() => clearTimeout(this.timer));
  }

  async init(): Promise<void> {
    this.syncedState.set((await this.repository?.load()) ?? EMPTY_SYNCED);
  }

  /** Invia subito quello che manca. Una chiamata mentre un invio è in corso lo fa ripartire alla fine. */
  sync(): Promise<void> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = this.run().finally(() => {
      this.running = null;
      if (this.again) {
        this.again = false;
        void this.sync();
      }
    });
    return this.running;
  }

  /**
   * Riporta sul telefono il diario che il server ha e il telefono no (telefono nuovo, app reinstallata).
   * Ciò che c'è già non si tocca. Le voci riportate contano come già inviate, così non si rimandano.
   * Restituisce quante voci ed episodi ha aggiunto.
   */
  async restore(): Promise<number> {
    if (!this.connected()) {
      return 0;
    }
    this.restoring.set(true);
    this.error.set(null);
    try {
      const server = await this.api.getDiary();
      const missing = restorable(server, this.synced(), this.journal.entries(), this.headaches.episodes());
      const entries = await this.journal.restore(missing.entries);
      const episodes = await this.headaches.restore(missing.episodes);
      // Si segna come inviato ciò che torna dal server, con l'impronta di come l'app lo invierebbe.
      const sent: DiaryPayload = {
        entries: entries.map((e) => entryPayload(e)).filter((p): p is NonNullable<typeof p> => p !== null),
        episodes: episodes.map((e) => episodePayload(e)).filter((p): p is NonNullable<typeof p> => p !== null),
      };
      const next = applySent(this.synced(), sent);
      this.syncedState.set(next);
      await this.repository?.save(next);
      return entries.length + episodes.length;
    } catch (error) {
      this.error.set(error instanceof ApiError ? error : toApiError(error));
      return 0;
    } finally {
      this.restoring.set(false);
    }
  }

  /** Il diario del telefono è vuoto e non ha mai inviato niente: il caso di un telefono appena ripristinato. */
  readonly isBlank = computed(
    () =>
      this.journal.entries().length === 0 &&
      this.headaches.episodes().length === 0 &&
      Object.keys(this.synced().entries).length === 0 &&
      Object.keys(this.synced().episodes).length === 0,
  );

  private schedule(): void {
    clearTimeout(this.timer);
    if (!this.connected() || isEmpty(this.diff())) {
      return;
    }
    // Fuori dalla zona: un timer in attesa non deve impedire all'app di risultare «stabile».
    this.timer = this.zone.runOutsideAngular(() => setTimeout(() => this.zone.run(() => void this.sync()), DEBOUNCE_MS));
  }

  private async run(): Promise<void> {
    if (!this.connected()) {
      return;
    }
    this.syncing.set(true);
    this.error.set(null);
    try {
      for (const request of requestsFor(this.diff())) {
        await this.api.syncDiary(request);
        const next = applySent(syncedFor(this.syncedState(), this.target()), request);
        this.syncedState.set(next);
        await this.repository?.save(next);
      }
    } catch (error) {
      this.error.set(error instanceof ApiError ? error : toApiError(error));
    } finally {
      this.syncing.set(false);
    }
  }
}
