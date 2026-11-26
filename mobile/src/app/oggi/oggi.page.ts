import { Component, DestroyRef, NgZone, computed, effect, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IonContent, IonModal, IonRefresher, IonRefresherContent } from '@ionic/angular';
import { FullSyncService } from '../ring/full-sync.service';
import { EntryChoice, EntrySheetComponent } from '../diary/entry-sheet.component';
import { EpisodeViewComponent } from '../diary/episode-view.component';
import { HeadacheSheetComponent, HeadacheStart } from '../diary/headache-sheet.component';
import { HeadacheService } from '../diary/headache.service';
import { AlcoholDrink, CaffeineDrink, JournalEntry } from '../diary/journal.model';
import { ALCOHOL_OPTIONS, CAFFEINE_OPTIONS, confirmationText } from '../diary/journal-labels';
import { JournalService } from '../diary/journal.service';
import { NoteChoice, NoteSheetComponent } from '../diary/note-sheet.component';
import { GiroComponent } from '../livella/giro.component';
import { PluginsService } from '../plugins/plugins.service';
import { SettingsService } from '../settings/settings.service';
import { StartupSyncService } from '../startup/startup-sync.service';
import { RevealDirective } from '../shared/reveal.directive';
import { MovementRowComponent } from './movement-row.component';
import { OggiDataService } from './oggi-data.service';
import { ScoreRowComponent } from './score-row.component';
import { nightsToGoText } from '../indici/calibration';
import { InfoLinkComponent } from '../guida/info-link.component';
import { AlertsService } from '../avvisi/alerts.service';
import { PLUGIN_GUIDE, GuideTopicId } from '../guida/guide';

type SheetKind = 'headache' | 'caffeine' | 'alcohol' | 'note';

const CONFIRMATION_MS = 8000;
const CLOCK_MS = 60_000;

/** Prima lettera maiuscola: «martedì 3 novembre» → «Martedì 3 novembre». */
export function formatDay(date: Date): string {
  const text = new Intl.DateTimeFormat('it-IT', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'Europe/Rome',
  }).format(date);
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Schermata «Oggi» (ADR 0006, ADR 0020, ADR 0041): all'apertura il giro delle 24 ore si apre dal centro, da solo, con il
 * Recupero al centro; scorrendo compaiono in dissolvenza la frase del giorno, le righe degli altri indici in ordine fisso
 * e una riga per ogni plugin quotidiano. Registra è un pulsante fisso sopra la barra delle schede.
 * Usa dati sintetici finché il telefono non è collegato al server. Le card dei plugin («Per oggi») arrivano dal server (docs/adr/0013).
 */
/** Quanto dura l'apertura di Oggi: giro (circa 2,4 s) e comparsa di intestazione, legenda e Registra (fino a 2,1 s). */
const INTRO_MS = 2800;

@Component({
  selector: 'app-oggi',
  imports: [
    IonContent,
    IonModal,
    IonRefresher,
    IonRefresherContent,
    RouterLink,
    GiroComponent,
    ScoreRowComponent,
    MovementRowComponent,
    HeadacheSheetComponent,
    EntrySheetComponent,
    NoteSheetComponent,
    EpisodeViewComponent,
    RevealDirective,
    InfoLinkComponent,
  ],
  styleUrl: './oggi.page.scss',
  template: `
    <ion-content [fullscreen]="true">
      <!-- Tira per aggiornare: il segnale è il marchio che gira in cima (SyncIndicator), non il cerchio di Ionic. -->
      <ion-refresher slot="fixed" (ionRefresh)="pull($event)">
        <ion-refresher-content [pullingIcon]="null" [refreshingSpinner]="null"></ion-refresher-content>
      </ion-refresher>
      @if (episodeOpen()) {
        <app-episode-view slot="fixed"></app-episode-view>
      } @else {
      <main class="page" [class.ready]="ready()" [class.intro]="intro()">
        <header class="header after-ring">
          <span class="header-text">
            <span class="date">{{ day() }}</span>
            <span class="sync" role="status">{{ data().syncText }}</span>
            @if (serverNote(); as note) {
              <!-- Fuori casa: gli ultimi dati del server salvati sul telefono, e da quando (docs/adr/0043). -->
              <span class="server-note" role="status">{{ note }}</span>
            }
            @if (data().calibration; as c) {
              <span class="calibration">Dati in calibrazione: {{ nightsText(c.nightsToGo) }}</span>
            }
          </span>
          <span class="header-actions">
          @if (alertsOn()) {
            <!-- Avvisi (docs/adr/0045): la campanella con il numero dei non visti. -->
            <a
              class="bell"
              routerLink="/avvisi"
              [attr.aria-label]="unseen() > 0 ? 'Avvisi, ' + unseen() + ' da vedere' : 'Avvisi'"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z"></path>
                <path d="M10 20.5a2 2 0 0 0 4 0"></path>
              </svg>
              @if (unseen() > 0) {
                <span class="bell-count" aria-hidden="true">{{ unseen() > 9 ? '9+' : unseen() }}</span>
              }
            </a>
          }
          <a
            class="ring-button"
            routerLink="/impostazioni"
            [attr.aria-label]="'Anello e impostazioni, batteria ' + data().batteryPercent + '%' + (charging() ? ', in carica' : '')"
          >
            <span class="battery">
              <span>{{ data().batteryPercent }}%</span>
              @if (charging()) {
                <span class="charging-label">in carica</span>
              }
            </span>
            @if (charging()) {
              <!-- In carica (ADR 0029): l'anello si riempie fino alla percentuale letta, con il fulmine al centro. -->
              <svg class="charge" viewBox="0 0 24 24" aria-hidden="true">
                <circle class="charge-track" cx="12" cy="12" r="8.8"></circle>
                <circle
                  class="charge-level"
                  cx="12"
                  cy="12"
                  r="8.8"
                  transform="rotate(-90 12 12)"
                  [attr.stroke-dasharray]="chargeCircumference"
                  [style.stroke-dashoffset]="chargeOffset()"
                ></circle>
                <path class="charge-bolt" d="M12.9 7.2 9 12.8h2.6l-.5 4 3.9-5.6h-2.6z"></path>
              </svg>
            } @else {
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path class="ring-arc" d="M19.96 11.2A8 8 0 1 1 12.8 4.04"></path>
                <circle class="ring-dot" cx="17.66" cy="6.34" r="2.2"></circle>
              </svg>
            }
          </a>
          </span>
        </header>

        <div class="stage">
          <a class="giro-link" routerLink="/indici/recupero">
            <app-giro [giro]="data().giro" [center]="center()" [play]="ready()"></app-giro>
          </a>
          <ul class="legend after-ring" aria-label="Legenda del giro">
            <li><span class="key key-sleep" aria-hidden="true"></span>sonno</li>
            <li><span class="key key-usual" aria-hidden="true"></span>il tuo solito</li>
            @if (data().giro.caffeine) {
              <li><span class="key key-caffeine" aria-hidden="true"></span>caffeina</li>
            }
            <li><span class="key key-now" aria-hidden="true"></span>adesso</li>
            <li class="legend-info"><app-info topic="giro"></app-info></li>
          </ul>
        </div>

        <div class="rest">
        <section class="summary" aria-label="Riepilogo" appReveal="riepilogo">
          <h1 class="summary-main">
            @for (part of data().summary; track $index) {
              <span [attr.data-tone]="part.tone ?? null">{{ part.text }}</span>
            }
          </h1>
          @if (data().summaryDetail.length > 0) {
            <p class="summary-detail">
              @for (part of data().summaryDetail; track $index) {
                <span [attr.data-tone]="part.tone ?? null">{{ part.text }}</span>
              }
            </p>
          }
        </section>

        <section class="indices" aria-label="Indici">
          <a class="row-link" routerLink="/tabs/sonno" appReveal="riga-sonno">
            @if (data().sonno; as row) {
              <app-score-row [row]="row"></app-score-row>
            } @else {
              <p class="row-empty"><span class="name">Sonno</span> Nessun dato ancora</p>
            }
          </a>
          <a class="row-link" routerLink="/indici/movimento" appReveal="riga-movimento">
            @if (movement(); as row) {
              <app-movement-row [row]="row"></app-movement-row>
            } @else {
              <p class="row-empty"><span class="name">Movimento</span> Nessun dato ancora</p>
            }
          </a>
          <a class="row-link" routerLink="/indici/stress" appReveal="riga-stress">
            @if (data().stress; as row) {
              <app-score-row [row]="row"></app-score-row>
            } @else {
              <p class="row-empty"><span class="name">Stress</span> Nessun dato ancora</p>
            }
          </a>
        </section>
        <p class="index-note" appReveal="nota-indici">
          Gli indici vanno da 0 a 100: più alto è meglio. <app-info topic="come-leggere"></app-info>
        </p>
        @if (pluginGroups().length > 0) {
          <section class="plugins" aria-labelledby="per-oggi">
            <h2 id="per-oggi" class="section-title">Per oggi</h2>
            <ul class="plugin-rows">
              @for (group of pluginGroups(); track group.id) {
                <!-- Una riga per plugin (docs/adr/0041): la sintesi e il tocco verso tutte le card. -->
                <li class="plugin-row" [appReveal]="'plugin-' + group.id">
                  <span class="plugin-title">{{ group.name }}</span>
                  @if (guideOf(group.id); as topic) {
                    <app-info [topic]="topic"></app-info>
                  }
                  <a
                    class="plugin-link"
                    [routerLink]="'/plugin/' + group.id"
                    [attr.aria-label]="group.name + ': ' + (group.headline?.value ?? 'apri i dettagli')"
                  >
                    @if (group.headline; as h) {
                      <span class="plugin-value" [attr.data-tone]="h.tone">
                        @if (h.tone === 'attenzione') {
                          <svg class="warn" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2.5 14.5 13.5h-13z"></path><path d="M8 6.5v3.5"></path></svg>
                        }
                        {{ h.value }}
                      </span>
                    }
                    <svg class="chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"></path></svg>
                  </a>
                </li>
              }
            </ul>
          </section>
        }

        <p class="disclaimer" appReveal="avviso">RingLife non è un dispositivo medico. Stime e suggerimenti non sono diagnosi.</p>
        </div>
      </main>

      <!-- Sempre a portata di dito, anche quando la prima schermata è solo il giro: la cefalea resta a due tocchi. -->
      <button
        type="button"
        class="register"
        [class.intro-wait]="intro() && !ready()"
        [class.intro-play]="intro() && ready()"
        slot="fixed"
        (click)="open('headache')"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"></path></svg>
        Registra
      </button>
      }

      @if (confirmation(); as saved) {
        <div class="undo" slot="fixed" role="status">
          <span>{{ saved.text }}</span>
          <button type="button" (click)="undo(saved.id)">Annulla</button>
        </div>
      }
    </ion-content>

    <ion-modal class="registra-sheet" [isOpen]="sheet() !== null" (didDismiss)="close()">
      <ng-template>
        @switch (sheet()) {
          @case ('headache') {
            <app-headache-sheet (started)="startEpisode($event)" (other)="open($event)" (cancelled)="close()"></app-headache-sheet>
          }
          @case ('caffeine') {
            <app-entry-sheet
              title="Caffeina"
              question="Che cosa hai preso?"
              [options]="caffeineOptions"
              (chosen)="addCaffeine($event)"
              (cancelled)="close()"
            ></app-entry-sheet>
          }
          @case ('alcohol') {
            <app-entry-sheet
              title="Alcol"
              question="Che cosa hai bevuto?"
              [options]="alcoholOptions"
              (chosen)="addAlcohol($event)"
              (cancelled)="close()"
            ></app-entry-sheet>
          }
          @case ('note') {
            <app-note-sheet (saved)="addNote($event)" (cancelled)="close()"></app-note-sheet>
          }
        }
      </ng-template>
    </ion-modal>
  `,
})
export class OggiPage {
  private readonly headaches = inject(HeadacheService);
  private readonly journal = inject(JournalService);
  private readonly zone = inject(NgZone);
  private readonly settings = inject(SettingsService);
  private readonly startup = inject(StartupSyncService);
  /** Il caricamento iniziale è finito o è stato saltato: da qui parte l'apertura del giro. */
  protected readonly ready = computed(() => !this.startup.visible());
  /**
   * L'apertura di Oggi (giro, poi intestazione, legenda e Registra) si fa una volta per sessione, come il giro: finita,
   * la classe si toglie e le scritte restano visibili, anche quando Ionic nasconde e rimostra la pagina.
   */
  private static introPlayed = false;
  protected readonly intro = signal(!OggiPage.introPlayed);

  private readonly oggiData = inject(OggiDataService);
  /** Dati d'esempio, o i risultati del server quando il telefono è collegato. */
  protected readonly data = this.oggiData.data;
  protected readonly charging = this.oggiData.charging;
  protected readonly serverNote = this.oggiData.serverNote;
  private readonly alerts = inject(AlertsService);
  /** La campanella c'è con il telefono collegato a un server: gli avvisi li calcola lui (docs/adr/0044). */
  protected readonly alertsOn = computed(() => this.oggiData.source() === 'server');
  protected readonly unseen = this.alerts.unseen;
  /** Lunghezza dell'anello della carica (raggio 8,8): la parte piena è la percentuale letta. */
  protected readonly chargeCircumference = 2 * Math.PI * 8.8;
  protected readonly chargeOffset = computed(
    () => this.chargeCircumference * (1 - Math.min(100, Math.max(0, this.data().batteryPercent)) / 100),
  );
  protected readonly day = computed(() => formatDay(this.data().date));
  /** Passi di oggi (dato di esempio) contro l'obiettivo scelto in Impostazioni. */
  protected readonly movement = computed(() => {
    const movimento = this.data().movimento;
    return movimento ? { steps: movimento.steps, goal: this.settings.settings().stepsGoal } : null;
  });
  protected readonly nightsText = nightsToGoText;
  /** Il Recupero al centro del giro. */
  protected readonly center = computed(() => {
    const recupero = this.data().recupero;
    return recupero
      ? { label: recupero.label, value: recupero.value, deviation: recupero.deviation }
      : { label: 'Recupero', value: null, deviation: null };
  });
  private readonly fullSync = inject(FullSyncService);

  /** «Tira per aggiornare»: sincronizzazione completa; il cerchio si chiude solo alla fine. */
  protected async pull(event: Event): Promise<void> {
    const refresher = event.target as HTMLIonRefresherElement;
    try {
      await this.fullSync.run();
      this.oggiData.tick();
    } finally {
      await refresher.complete();
    }
  }

  protected readonly sheet = signal<SheetKind | null>(null);
  /** Con una cefalea aperta Oggi è sostituita dall'episodio in corso. */
  protected readonly episodeOpen = computed(() => this.headaches.active() !== null);

  protected readonly caffeineOptions = CAFFEINE_OPTIONS;
  protected readonly alcoholOptions = ALCOHOL_OPTIONS;

  /** Conferma dell'ultima voce, con «Annulla» per un tocco sbagliato. Sparisce da sola. */
  protected readonly confirmation = signal<{ id: string; text: string } | null>(null);
  private confirmationTimer: ReturnType<typeof setTimeout> | undefined;

  private readonly plugins = inject(PluginsService);
  /** Solo i plugin quotidiani, una riga ciascuno; i settimanali stanno in Andamento (docs/adr/0041). */
  protected readonly pluginGroups = this.plugins.dailyGroups;

  constructor() {
    // Quando parte l'apertura (caricamento finito o saltato), la si lascia finire e poi si toglie la classe.
    effect(() => {
      if (this.intro() && this.ready()) {
        OggiPage.introPlayed = true;
        setTimeout(() => this.intro.set(false), INTRO_MS);
      }
    });
    const destroyRef = inject(DestroyRef);
    destroyRef.onDestroy(() => clearTimeout(this.confirmationTimer));
    // La bolla «adesso» del giro scorre: un aggiornamento al minuto, fuori dalla zona per non tenere l'app «instabile».
    const clock = this.zone.runOutsideAngular(() => setInterval(() => this.oggiData.tick(), CLOCK_MS));
    destroyRef.onDestroy(() => clearInterval(clock));
    void this.oggiData.refresh();
    void this.plugins.refresh();
  }

  /** La pagina della Guida di un plugin, se c'è: il pulsante «i» accanto al nome. */
  protected guideOf(pluginId: string): GuideTopicId | null {
    return PLUGIN_GUIDE[pluginId] ?? null;
  }

  protected open(kind: SheetKind): void {
    this.sheet.set(kind);
  }

  protected close(): void {
    this.sheet.set(null);
  }

  protected async startEpisode(start: HeadacheStart): Promise<void> {
    this.close();
    await this.headaches.start(start.intensity, start.startedAt);
  }

  protected async addCaffeine(choice: EntryChoice): Promise<void> {
    this.close();
    this.confirm(await this.journal.addCaffeine(choice.code as CaffeineDrink, choice.at));
  }

  protected async addAlcohol(choice: EntryChoice): Promise<void> {
    this.close();
    this.confirm(await this.journal.addAlcohol(choice.code as AlcoholDrink, choice.at));
  }

  protected async addNote(choice: NoteChoice): Promise<void> {
    this.close();
    const entry = await this.journal.addNote(choice.text, choice.at);
    if (entry) {
      this.confirm(entry);
    }
  }

  protected async undo(id: string): Promise<void> {
    this.clearConfirmation();
    await this.journal.remove(id);
  }

  private confirm(entry: JournalEntry): void {
    this.confirmation.set({ id: entry.id, text: confirmationText(entry) });
    clearTimeout(this.confirmationTimer);
    // Fuori dalla zona: un timer in attesa non deve impedire all'app di risultare «stabile».
    this.confirmationTimer = this.zone.runOutsideAngular(() =>
      setTimeout(() => this.confirmation.set(null), CONFIRMATION_MS),
    );
  }

  private clearConfirmation(): void {
    clearTimeout(this.confirmationTimer);
    this.confirmation.set(null);
  }
}
