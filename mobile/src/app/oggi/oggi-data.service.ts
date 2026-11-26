import { Injectable, computed, inject, signal } from '@angular/core';
import { CredentialsService } from '../api/credentials.service';
import { DaysService } from '../api/days.service';
import { SettingsService } from '../settings/settings.service';
import { PluginsService } from '../plugins/plugins.service';
import { RingSyncService } from '../ring/ring-sync.service';
import { HeartRateLogService } from '../ring/heart-rate-log.service';
import { heartToday, restingAverage } from './heart-today';
import { minuteOfDay, romeDay } from '../temperatura/temperatura.model';
import { serverNoteText, syncedText } from '../ring/ring-status';
import { StepsLogService, stepsOfDay } from '../ring/steps-log.service';
import { oggiFromServer } from './oggi.from-server';
import { OGGI_SAMPLE } from './oggi.sample';

/**
 * Dati della schermata Oggi: quelli d'esempio finché il telefono non è collegato a un server,
 * poi i risultati del server (Recupero e Sonno). Un errore di rete non cancella quello che si vede: gli ultimi risultati
 * restano sul telefono, e quando sono più vecchi dell'ultima lettura dell'anello passi e notte vengono dall'anello
 * (docs/adr/0043).
 */
@Injectable({ providedIn: 'root' })
export class OggiDataService {
  private readonly days = inject(DaysService);
  private readonly ring = inject(RingSyncService);
  private readonly plugins = inject(PluginsService);
  private readonly credentials = inject(CredentialsService);
  private readonly settings = inject(SettingsService);
  private readonly heartLog = inject(HeartRateLogService);
  private readonly stepsLog = inject(StepsLogService);

  /** L'ora che la schermata mostra: la bolla «adesso» del giro e il giorno. Si aggiorna con `tick`. */
  private readonly clock = signal(new Date());

  /** Il telefono è collegato a un server: da qui in poi mai valori d'esempio, solo quello che il server ha. */
  private readonly connected = computed(() => this.credentials.paired() !== null && this.settings.settings().serverUrl !== '');

  /** I risultati del server sono più vecchi dell'ultima lettura dell'anello, o non ci sono (docs/adr/0043). */
  private readonly serverBehind = computed(() => {
    const fetchedAt = this.days.fetchedAt();
    const readAt = this.ring.last()?.at ?? null;
    return fetchedAt === null || (readAt !== null && readAt > fetchedAt);
  });

  private readonly fromServer = computed(() => {
    if (!this.connected()) {
      return null;
    }
    const now = this.clock();
    const local = {
      stepsToday: stepsOfDay(this.stepsLog.readings(), romeDay(now.getTime())),
      lastNight: this.ring.lastNight(),
      serverBehind: this.serverBehind(),
    };
    return oggiFromServer(OGGI_SAMPLE, this.days.days(), now, this.plugins.caffeineWindow(), local);
  });

  /**
   * Sotto la data, quando l'ultimo tentativo di scaricare dal server non è riuscito: da quando sono i dati che si vedono.
   * `null` se il server ha risposto, o non si è ancora provato.
   */
  readonly serverNote = computed(() =>
    this.connected() && this.days.reachable() === false ? serverNoteText(this.days.fetchedAt(), this.clock()) : null,
  );

  /** Batteria e orario dell'ultima lettura vengono dall'anello quando ce n'è stata una, altrimenti dall'esempio. */
  readonly data = computed(() => {
    const base = this.fromServer() ?? OGGI_SAMPLE;
    const last = this.ring.last();
    return last
      ? { ...base, batteryPercent: last.battery ?? base.batteryPercent, syncText: syncedText(last.at, new Date()) }
      : base;
  });
  /** L'anello è sul caricatore (docs/adr/0029): il simbolo accanto alla batteria diventa un anello che si riempie. */
  readonly charging = computed(() => this.ring.charging());
  /** `server` quando il telefono è collegato a un server (anche se non ha ancora risultati). */
  readonly source = computed<'esempio' | 'server'>(() => (this.fromServer() ? 'server' : 'esempio'));

  /** Il battito misurato oggi dall'anello, dal telefono (docs/adr/0035). `null` senza misure oggi. */
  readonly heart = computed(() => heartToday(this.heartLog.readings(), this.clock().getTime()));
  /** Minuti dalla mezzanotte di Roma di adesso: la linea sottile del grafico del battito. */
  readonly nowMin = computed(() => minuteOfDay(this.clock().getTime()));
  /** Il tuo battito a riposo di notte, la linea tratteggiata del grafico. `null` senza server o in calibrazione. */
  readonly restingAverage = computed(() => (this.connected() ? restingAverage(this.days.days()) : null));
  /** C'è un anello, o ci sono misure: la sezione del battito ha senso. Senza, Oggi mostra solo l'esempio. */
  readonly showHeart = computed(() => this.ring.hasRing() || this.heartLog.readings().length > 0);

  /** Aggiorna l'ora mostrata. Lo chiama la pagina una volta al minuto mentre è aperta. */
  tick(now: Date = new Date()): void {
    this.clock.set(now);
  }

  refresh(now: Date = new Date()): Promise<void> {
    this.tick(now);
    return this.days.refresh(now);
  }
}
