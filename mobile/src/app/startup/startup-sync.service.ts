import { DOCUMENT, Injectable, NgZone, computed, inject, signal } from '@angular/core';
import { DaysService } from '../api/days.service';
import { DiarySyncService } from '../diary/diary-sync.service';
import { PluginsService } from '../plugins/plugins.service';
import { AlertsService } from '../avvisi/alerts.service';
import { PushService } from '../avvisi/push.service';
import { RingSyncService } from '../ring/ring-sync.service';
import { SyncAlertService } from '../ring/sync-alert.service';
import { BackgroundBridge } from '../ring/background/ring-background';

/**
 * Oltre questo tempo l'app parte comunque (la lettura continua in sottofondo e, a fine lavoro, un eventuale errore si
 * mostra lo stesso). È largo perché la prima lettura dell'anello, sette giorni di storico, può durare più di dieci secondi.
 */
export const STARTUP_MAX_MS = 45000;

/** Il marchio resta almeno questo tempo: sotto, una schermata che lampeggia e basta. */
export const STARTUP_MIN_MS = 600;

/**
 * Sincronizzazione all'apertura (ADR 0002, 0018): legge l'anello e invia al server i suoi dati e il diario che manca,
 * poi riscarica indici e plugin.
 * Mentre lavora mostra la schermata con il logo e **aspetta la fine** (con un tetto di `STARTUP_MAX_MS`). Senza un anello e
 * senza un server non fa niente e non si vede. Un errore non toglie i dati che il telefono ha già, ma si dice: a fine
 * lavoro una finestra spiega cosa non è andato e offre «Riprova» (`SyncAlertService`).
 *
 * iOS può avviare l'app in background (un'automazione di Comandi, la lettura in background): lì legge l'anello il
 * raccoglitore nativo, e una lettura d'apertura lo interromperebbe (docs/adr/0026). Allora si aspetta il primo piano, con
 * il logo già sopra l'app.
 */
/** Ogni quanto si ricontrolla se l'app avviata in background è passata in primo piano. */
const FOREGROUND_POLL_MS = 1000;

@Injectable({ providedIn: 'root' })
export class StartupSyncService {
  private readonly diary = inject(DiarySyncService);
  private readonly days = inject(DaysService);
  private readonly plugins = inject(PluginsService);
  private readonly alertsService = inject(AlertsService);
  private readonly push = inject(PushService);
  private readonly ring = inject(RingSyncService);
  private readonly alerts = inject(SyncAlertService);
  private readonly zone = inject(NgZone);
  private readonly document = inject(DOCUMENT);
  private readonly bridge = inject(BackgroundBridge);

  /** Cosa dice la schermata di avvio: a che punto è la lettura. */
  readonly label = computed(() => {
    const step = this.ring.step?.() ?? null;
    if (step === 'ring') {
      return "Leggo l'anello…";
    }
    if (step === 'upload') {
      return 'Invio i dati al server di casa…';
    }
    return this.ring.hasRing() ? "Sincronizzo l'anello e il server di casa…" : 'Sincronizzo con il server di casa…';
  });

  /** `true` mentre la schermata di avvio è sopra l'app. */
  readonly visible = signal(false);
  private skipped: (() => void) | null = null;
  /** «Salta» premuto in questa apertura: niente invio, niente scaricamento, nessuna finestra d'errore (docs/adr/0043). */
  private cancelled = false;

  async run(): Promise<void> {
    if (!this.diary.connected() && !this.ring.active()) {
      return;
    }
    this.visible.set(true);
    this.cancelled = false;
    const skip = new Promise<void>((resolve) => (this.skipped = resolve));
    await this.foreground();
    const started = Date.now();
    // Prima l'anello e l'invio dei suoi dati, poi si riscaricano i risultati che ne dipendono. Il diario va per conto suo.
    const work = Promise.allSettled([
      this.diary.sync(),
      // Push accese: token e chiave si registrano di nuovo a ogni apertura, il token può cambiare (docs/adr/0047).
      this.push.ensure(),
      this.ring
        .sync()
        .then(() => (this.cancelled ? undefined : Promise.allSettled([this.days.refresh(), this.plugins.refresh()])))
        // Gli avvisi dopo l'invio: il server li ha appena calcolati sui dati nuovi (docs/adr/0045).
        .then(() => (this.cancelled ? undefined : this.alertsService.refresh())),
    ]);
    // A lavoro finito (anche dopo il tetto di tempo) si dice se qualcosa non è andato; dopo «Salta» no: l'ha chiesto chi usa l'app.
    void work.then(() => {
      if (!this.cancelled) {
        this.alerts.check();
      }
    });
    await Promise.race([work, skip, this.wait(STARTUP_MAX_MS)]);
    const rest = STARTUP_MIN_MS - (Date.now() - started);
    if (rest > 0) {
      await Promise.race([this.wait(rest), skip]);
    }
    this.skipped = null;
    this.visible.set(false);
  }

  /**
   * «Salta» (docs/adr/0043): l'app si apre subito sugli ultimi dati salvati e la sincronizzazione si annulla. La lettura
   * dell'anello si ferma anche a metà collegamento, non si invia e non si scarica niente; quello che è in coda resta
   * per la lettura dopo (ritorno nell'app, tira per aggiornare).
   */
  skip(): void {
    if (!this.skipped) {
      return;
    }
    this.cancelled = true;
    void this.ring.cancel();
    this.skipped();
  }

  /**
   * Torna subito se l'app è in primo piano; avviata in background, aspetta il ritorno (`resume` di Capacitor). Il nativo
   * dice «in background» anche quando l'app non è ancora attiva e il raccoglitore sta leggendo (docs/adr/0048): allora
   * non arriva nessun `resume`, e si ricontrolla ogni secondo finché la lettura non finisce.
   */
  private async foreground(): Promise<void> {
    let resumed = false;
    let wake: () => void = () => undefined;
    const back = new Promise<void>((resolve) => (wake = resolve));
    const onResume = () => {
      // Tornare in primo piano è aprire l'app: da qui legge l'app, anche se il raccoglitore stava leggendo.
      resumed = true;
      wake();
    };
    // In ascolto prima di chiedere: un ritorno in primo piano mentre il nativo risponde non si perde.
    this.document.addEventListener('resume', onResume);
    try {
      while (!resumed && (await this.bridge.inBackground())) {
        await Promise.race([back, this.wait(FOREGROUND_POLL_MS)]);
      }
    } finally {
      this.document.removeEventListener('resume', onResume);
    }
  }

  // Fuori dalla zona: un timer in attesa non deve impedire all'app di risultare «stabile».
  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => this.zone.runOutsideAngular(() => setTimeout(resolve, ms)));
  }
}
