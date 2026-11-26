import { DOCUMENT, Injectable, NgZone, inject } from '@angular/core';
import { Clock, SystemClock } from '../diary/clock';
import { HabitualCaffeineService } from '../diary/habitual-caffeine.service';
import { OggiDataService } from '../oggi/oggi-data.service';
import { LiveSessionService } from '../session/live-session.service';
import { SettingsService } from '../settings/settings.service';
import { StartupSyncService } from '../startup/startup-sync.service';
import { FullSyncService } from './full-sync.service';
import { RingSyncService } from './ring-sync.service';

/** Tornando nell'app si rilegge l'anello solo se l'ultima sincronizzazione è cominciata almeno 15 minuti prima. */
export const RESUME_MIN_MS = 15 * 60_000;

/**
 * La lettura al ritorno nell'app (docs/adr/0028). iOS tiene l'app sospesa per ore: tornarci non è un'apertura, e senza
 * questo Oggi resterebbe ai dati dell'ultima apertura. Fa la sincronizzazione completa di «tira per aggiornare», con il
 * marchio che gira in cima e la finestra d'errore se qualcosa non va.
 */
@Injectable({ providedIn: 'root' })
export class ResumeSyncService {
  private readonly document = inject(DOCUMENT);
  private readonly zone = inject(NgZone);
  private readonly ring = inject(RingSyncService);
  private readonly fullSync = inject(FullSyncService);
  private readonly live = inject(LiveSessionService);
  private readonly startup = inject(StartupSyncService);
  private readonly settings = inject(SettingsService);
  private readonly oggi = inject(OggiDataService);
  private readonly clock = inject(Clock, { optional: true }) ?? new SystemClock();
  private readonly habits = inject(HabitualCaffeineService);
  private listening = false;

  /** Ascolta il ritorno nell'app: Capacitor manda `resume` al `document`, su iOS e su Android. */
  listen(): void {
    if (this.listening) {
      return;
    }
    this.listening = true;
    this.document.addEventListener('resume', () => this.zone.run(() => void this.onResume()));
  }

  /** `true` se la sincronizzazione è partita. */
  async onResume(): Promise<boolean> {
    this.oggi.tick(this.clock.now());
    // Il giorno può essere cambiato mentre l'app era sospesa: la caffeina abituale di stamattina entra nel diario.
    await this.habits.apply(this.clock.now());
    if (!this.ring.hasRing() || !this.settings.settings().onboarded || this.startup.visible() || this.ring.syncing()) {
      return false;
    }
    // L'anello parla con una connessione alla volta: mai durante una sessione di respirazione o allenamento.
    if (['connecting', 'waiting', 'live'].includes(this.live.status())) {
      return false;
    }
    const last = this.ring.lastStarted();
    if (last !== null && this.clock.now().getTime() - last < RESUME_MIN_MS) {
      return false;
    }
    await this.fullSync.run();
    this.oggi.tick(this.clock.now());
    return true;
  }
}
