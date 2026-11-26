import { Component, computed, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { IonBackButton, IonButtons, IonContent, IonHeader, IonToolbar } from '@ionic/angular';
import { HeadacheService } from '../diary/headache.service';
import { MigraineReportComponent } from '../reports/migraine-report.component';
import { PluginCardComponent } from './plugin-card.component';
import { buildMonth, monthOf } from './migraine-month';
import { PluginAction, PluginCard } from './plugin.model';
import { PluginsService } from './plugins.service';
import { InfoLinkComponent } from '../guida/info-link.component';
import { PLUGIN_GUIDE } from '../guida/guide';

/** Episodi che servono al modello personale (CLAUDE.md, Emicrania v2). */
const PERSONAL_MODEL_EPISODES = 20;

/** I nomi dei plugin, per quando il server non risponde e il manifest non c'è. */
const PLUGIN_NAMES: Record<string, string> = {
  migraine: 'Emicrania',
  'caffeine-window': 'Finestra caffeina',
  circadian: 'Ritmo circadiano',
  'social-jetlag': 'Jet lag sociale',
  'vitamin-d': 'Vitamina D',
  'weekly-report': 'Report settimanale',
  training: 'Allenamento e respirazione',
};

const WEEKDAYS = ['lun', 'mar', 'mer', 'gio', 'ven', 'sab', 'dom'] as const;

/**
 * La pagina di un plugin (`/plugin/<id>`), che si apre da «Dettagli» in Oggi: tutte le sue card e i suoi commenti.
 * Per Emicrania aggiunge il mese delle cefalee, il report per il medico e a che punto è il modello personale.
 * L'id arriva dall'indirizzo come input del componente.
 */
@Component({
  selector: 'app-plugin-page',
  imports: [
    IonHeader,
    IonToolbar,
    IonButtons,
    IonBackButton,
    IonContent,
    RouterLink,
    PluginCardComponent,
    MigraineReportComponent,
    InfoLinkComponent,
  ],
  styleUrl: './plugin.page.scss',
  template: `
    <ion-header [translucent]="false">
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button defaultHref="/tabs/oggi" text="" aria-label="Indietro a Oggi"></ion-back-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content>
      <main class="page">
        <h1 class="title">
          {{ name() }}
          @if (guide(); as topic) {
            <app-info [topic]="topic"></app-info>
          }
        </h1>

        @if (cards().length > 0) {
          <section class="cards" aria-label="Oggi">
            @for (card of cards(); track $index) {
              <app-plugin-card [card]="card" (act)="runAction($event)"></app-plugin-card>
            }
          </section>
        } @else {
          <p class="empty" role="status">
            Nessun risultato per ora. Si calcola dopo ogni caricamento dei dati: servono un server collegato e il plugin
            acceso.
          </p>
        }

        @if (id() === 'migraine') {
          <section aria-labelledby="mese">
            <div class="month-head">
              <h2 id="mese" class="section-title">{{ month().title }}</h2>
              <span class="month-nav">
                <button type="button" class="nav" aria-label="Mese precedente" (click)="move(-1)">
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6"></path></svg>
                </button>
                <button type="button" class="nav" aria-label="Mese successivo" [disabled]="offset() >= 0" (click)="move(1)">
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"></path></svg>
                </button>
              </span>
            </div>
            <table class="calendar">
              <caption class="sr-only">Giorni con una cefalea in {{ month().title }}</caption>
              <thead>
                <tr>
                  @for (weekday of weekdays; track weekday) {
                    <th scope="col">{{ weekday }}</th>
                  }
                </tr>
              </thead>
              <tbody>
                @for (week of month().weeks; track $index) {
                  <tr>
                    @for (cell of week; track $index) {
                      <td>
                        @if (cell.day !== null) {
                          <span class="day" [attr.data-kind]="cell.kind">
                            {{ cell.day }}
                            @if (cell.kind !== 'none') {
                              <span class="sr-only">{{ cell.kind === 'medication' ? ', cefalea con farmaco' : ', cefalea senza farmaco' }}</span>
                            }
                          </span>
                        }
                      </td>
                    }
                  </tr>
                }
              </tbody>
            </table>
            <ul class="key" aria-hidden="true">
              <li><span class="mark mark-medication"></span>con farmaco</li>
              <li><span class="mark mark-episode"></span>senza farmaco</li>
            </ul>
            <dl class="facts">
              <div>
                <dt>Cefalee</dt>
                <dd>{{ month().episodes }}</dd>
              </div>
              <div>
                <dt>Giorni con farmaco</dt>
                <dd>{{ month().medicationDays }}</dd>
              </div>
              <div>
                <dt>Durata media</dt>
                <dd>{{ averageText() }}</dd>
              </div>
            </dl>
          </section>

          <section aria-labelledby="report">
            <h2 id="report" class="sr-only">Report per il medico</h2>
            <app-migraine-report></app-migraine-report>
          </section>

          <section aria-labelledby="modello">
            <h2 id="modello" class="section-title">Modello di stima</h2>
            <p class="plain">
              Oggi il rischio usa regole fisse. Il modello personale si prova da {{ personalModelEpisodes }} cefalee
              registrate e si attiva solo se stima meglio delle regole.
            </p>
            <div
              class="progress"
              role="progressbar"
              aria-label="Cefalee registrate per il modello personale"
              aria-valuemin="0"
              [attr.aria-valuemax]="personalModelEpisodes"
              [attr.aria-valuenow]="progressCount()"
            >
              <span class="progress-fill" [style.width.%]="progressPercent()"></span>
            </div>
            <p class="note">{{ episodeCount() }} di {{ personalModelEpisodes }} cefalee registrate.</p>
          </section>
        }

        <a class="settings-link" routerLink="/impostazioni/plugin">Parametri del plugin</a>

        <p class="disclaimer">RingLife non è un dispositivo medico. Stime e suggerimenti non sono diagnosi.</p>
      </main>
    </ion-content>
  `,
})
export class PluginPage {
  private readonly plugins = inject(PluginsService);
  private readonly headaches = inject(HeadacheService);
  private readonly router = inject(Router);

  /** L'id del plugin, dall'indirizzo `/plugin/<id>`. */
  readonly id = input<string>('');

  protected readonly weekdays = WEEKDAYS;
  protected readonly personalModelEpisodes = PERSONAL_MODEL_EPISODES;
  protected readonly offset = signal(0);

  protected readonly name = computed(
    () => this.plugins.views().find((view) => view.manifest.id === this.id())?.manifest.name ?? PLUGIN_NAMES[this.id()] ?? 'Plugin',
  );

  /** La pagina della Guida del plugin, se c'è: il pulsante «i» accanto al titolo. */
  protected readonly guide = computed(() => PLUGIN_GUIDE[this.id()] ?? null);

  /** Le card del plugin e i suoi commenti come card di testo. Le azioni che qui non si sanno eseguire si tolgono. */
  protected readonly cards = computed<PluginCard[]>(() => {
    const group = this.plugins.groups().find((g) => g.id === this.id());
    if (!group) {
      return [];
    }
    const insights = group.insights.map((i): PluginCard => ({ type: 'text', title: i.title, body: i.text }));
    return [...group.cards, ...insights].filter((c) => c.type !== 'action' || c.action === 'open-diary');
  });

  protected readonly month = computed(() => {
    const { year, month } = monthOf(new Date(), this.offset());
    return buildMonth(this.headaches.episodes(), year, month);
  });
  protected readonly averageText = computed(() => {
    const minutes = this.month().averageDurationMin;
    if (minutes === null) {
      return '—';
    }
    return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')}`;
  });

  protected readonly episodeCount = computed(() => this.headaches.episodes().length);
  protected readonly progressCount = computed(() => Math.min(this.episodeCount(), PERSONAL_MODEL_EPISODES));
  protected readonly progressPercent = computed(() => Math.round((this.progressCount() / PERSONAL_MODEL_EPISODES) * 100));

  protected move(delta: number): void {
    this.offset.update((value) => Math.min(0, value + delta));
  }

  protected runAction(action: PluginAction): void {
    if (action === 'open-diary') {
      void this.router.navigateByUrl('/tabs/diario');
    }
  }
}
