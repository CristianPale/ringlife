import { Component, DestroyRef, NgZone, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IonContent } from '@ionic/angular';
import { InfoLinkComponent } from '../guida/info-link.component';
import { HeartTodayComponent } from '../oggi/heart-today.component';
import { gapFor } from '../oggi/heart-today';
import { OggiDataService } from '../oggi/oggi-data.service';
import { TemperatureLogService } from '../ring/temperature-log.service';
import {
  SessionHistoryService,
  sessionDate,
  sessionSummary,
} from '../session/session-history.service';
import { weeklyMinutes } from '../session/training';
import { WeekMinutesComponent } from '../session/week-minutes.component';
import { SettingsService } from '../settings/settings.service';
import { HrChartComponent } from '../shared/hr-chart.component';
import { dayName } from '../shared/day-history';
import { celsiusText, romeDay, timeText } from '../temperatura/temperatura.model';

const CLOCK_MS = 60_000;

/**
 * Scheda Corpo (docs/adr/0041): quello che l'anello misura adesso e quello che fai con l'anello. Battito di oggi,
 * temperatura, Misura ora e, con il plugin Allenamento e respirazione acceso, le due sessioni con i minuti di
 * allenamento delle ultime settimane.
 */
@Component({
  selector: 'app-corpo',
  imports: [
    IonContent,
    RouterLink,
    InfoLinkComponent,
    HeartTodayComponent,
    HrChartComponent,
    WeekMinutesComponent,
  ],
  styleUrl: './corpo.page.scss',
  template: `
    <ion-content [fullscreen]="true">
      <main class="page">
        <header class="header">
          <h1 class="title">Corpo <app-info topic="corpo"></app-info></h1>
        </header>

        @if (showHeart()) {
          <app-heart-today
            [heart]="heart()"
            [nowMin]="nowMin()"
            [resting]="restingAverage()"
            [intervalMin]="hrInterval()"
            [gapMin]="heartGap()"
          ></app-heart-today>
        } @else {
          <section aria-labelledby="battito-vuoto">
            <h2 id="battito-vuoto" class="section-title">
              Battito di oggi <app-info topic="battito-oggi"></app-info>
            </h2>
            <p class="empty">
              Nessuna misura del battito ancora: compare dopo la prossima lettura dell'anello.
            </p>
          </section>
        }

        <nav class="rows" aria-label="Misure">
          <a class="row" routerLink="/temperatura">
            <span class="row-text">
              <span class="row-name">Temperatura</span>
              <span class="row-value">{{ temperatureText() }}</span>
            </span>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"></path></svg>
          </a>
          <a class="row" routerLink="/misura">
            <span class="row-text">
              <span class="row-name">Misura ora</span>
              <span class="row-value">Battito, ossigeno, HRV, stress, temperatura</span>
            </span>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"></path></svg>
          </a>
        </nav>

        @if (trainingOn()) {
          <section aria-labelledby="sessioni">
            <h2 id="sessioni" class="section-title">
              Allenamento e respirazione <app-info topic="allenamento"></app-info>
            </h2>
            @for (item of sessionPreviews(); track item.mode) {
              <a class="session-preview" [routerLink]="['/sessione', item.mode]">
                <span class="session-head">
                  <span class="session-name">{{ item.name }}</span>
                  <span class="session-start">Inizia ›</span>
                </span>
                <span class="session-last">{{ item.last }}</span>
                @if (item.points; as points) {
                  <app-hr-chart class="session-mini" [points]="points"></app-hr-chart>
                }
              </a>
            }
            @if (hasTraining()) {
              <div class="weeks">
                <p class="weeks-title">Minuti di allenamento, ultime 8 settimane</p>
                <app-week-minutes [weeks]="weeks()"></app-week-minutes>
              </div>
            }
            <a class="session-history" routerLink="/sessioni">Storico delle sessioni</a>
          </section>
        }

        <p class="disclaimer">
          RingLife non è un dispositivo medico. Battito, temperatura e calorie sono stime
          dell'anello.
        </p>
      </main>
    </ion-content>
  `,
})
export class CorpoPage {
  private readonly oggiData = inject(OggiDataService);
  private readonly settings = inject(SettingsService);
  private readonly temperature = inject(TemperatureLogService);
  private readonly history = inject(SessionHistoryService);

  /** Il battito misurato oggi dall'anello (docs/adr/0035). */
  protected readonly heart = this.oggiData.heart;
  protected readonly restingAverage = this.oggiData.restingAverage;
  protected readonly showHeart = this.oggiData.showHeart;
  protected readonly nowMin = this.oggiData.nowMin;
  protected readonly hrInterval = computed(() => this.settings.settings().ring.hrIntervalMin);
  protected readonly heartGap = computed(() => gapFor(this.hrInterval()));

  /** L'ultima misura di temperatura dell'anello (docs/adr/0033), o cosa c'è nella pagina. */
  protected readonly temperatureText = computed(() => {
    const last = this.temperature.latest();
    if (!last) {
      return 'Ultima misura e misure di oggi';
    }
    const day = dayName(romeDay(last.ts), new Date());
    return `${celsiusText(last.celsius)} °C, ${day === 'oggi' ? '' : `${day} `}alle ${timeText(last.ts)}`;
  });

  /** Il plugin Allenamento e respirazione vive solo nell'app (ADR 0024, ADR 0042). */
  protected readonly trainingOn = computed(() => this.settings.settings().plugins.training);
  protected readonly hasTraining = computed(() => this.history.trainings().length > 0);
  protected readonly weeks = computed(() => weeklyMinutes(this.history.trainings(), new Date()));
  /** Anteprima di ciascuna sessione: l'ultima fatta, con il suo grafico, o un invito a provarla. */
  protected readonly sessionPreviews = computed(() =>
    (
      [
        ['allenamento', 'Allenamento', this.history.lastTraining()],
        ['respirazione', 'Respirazione guidata', this.history.lastBreathing()],
      ] as const
    ).map(([mode, name, last]) => ({
      mode,
      name,
      last: last
        ? `Ultima: ${sessionDate(last.start)} · ${sessionSummary(last)}`
        : 'Nessuna sessione ancora: tocca per iniziare.',
      points: last && last.samples.length > 1 ? last.samples : null,
    })),
  );

  constructor() {
    // Il grafico del battito segue l'ora: un aggiornamento al minuto, fuori dalla zona come in Oggi.
    const zone = inject(NgZone);
    const clock = zone.runOutsideAngular(() => setInterval(() => this.oggiData.tick(), CLOCK_MS));
    inject(DestroyRef).onDestroy(() => clearInterval(clock));
  }
}
