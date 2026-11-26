import { DOCUMENT, Injectable, NgZone, effect, inject, signal } from '@angular/core';
import { LiveSessionService } from '../session/live-session.service';
import { RingSyncService } from './ring-sync.service';

/** Ogni quanto si rilegge la batteria mentre l'anello è in carica e l'app è aperta. */
export const CHARGING_POLL_MS = 60_000;

/**
 * La carica che sale (docs/adr/0029): mentre l'anello è in carica e l'app è in primo piano, legge la sola batteria una
 * volta al minuto. Si ferma quando l'anello lascia il caricatore o l'app va in background, e salta il giro durante una
 * sessione di respirazione o allenamento (la sincronizzazione la esclude già `RingSyncService`).
 */
@Injectable({ providedIn: 'root' })
export class ChargingMonitorService {
  private readonly document = inject(DOCUMENT);
  private readonly zone = inject(NgZone);
  private readonly ring = inject(RingSyncService);
  private readonly live = inject(LiveSessionService);
  /** Capacitor manda `pause` e `resume` al `document`: in mezzo l'app è in background. */
  private readonly foreground = signal(true);
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor() {
    this.document.addEventListener('pause', () => this.zone.run(() => this.foreground.set(false)));
    this.document.addEventListener('resume', () => this.zone.run(() => this.foreground.set(true)));
    effect(() => {
      if (this.ring.charging() && this.foreground()) {
        this.start();
      } else {
        this.stop();
      }
    });
  }

  /** Un giro: legge la batteria se l'anello è libero. */
  async poll(): Promise<boolean> {
    if (['connecting', 'waiting', 'live'].includes(this.live.status())) {
      return false;
    }
    return this.ring.refreshBattery();
  }

  private start(): void {
    if (this.timer !== undefined) {
      return;
    }
    // Fuori dalla zona: un timer in attesa non deve impedire all'app di risultare «stabile».
    this.timer = this.zone.runOutsideAngular(() =>
      setInterval(() => this.zone.run(() => void this.poll()), CHARGING_POLL_MS),
    );
  }

  private stop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }
}
