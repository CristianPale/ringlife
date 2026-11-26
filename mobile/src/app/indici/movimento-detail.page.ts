import { Component, computed, inject, input, linkedSignal } from '@angular/core';
import { DaysService } from '../api/days.service';
import { DayPickerComponent } from '../shared/day-picker.component';
import { chosenDay, dayName } from '../shared/day-history';
import { movementDays, movimentoFromServer } from './movimento.from-server';
import { MOVIMENTO_SAMPLE } from './movimento.sample';
import { NoDataComponent } from '../shared/no-data.component';
import { RouterLink } from '@angular/router';
import { IonBackButton, IonButtons, IonContent, IonHeader, IonTitle, IonToolbar } from '@ionic/angular';
import { average, BASELINE_DAYS, normalBand, isOutside } from '../andamento/andamento.model';
import { BandChartComponent } from '../andamento/band-chart.component';
import { HourlyStepsComponent } from '../andamento/hourly-steps.component';
import { formatThousands } from '../shared/format';
import { zoneForScore } from '../oggi/zone';
import { ZoneBadgeComponent } from '../oggi/zone-badge.component';
import { SettingsService } from '../settings/settings.service';
import { SignalRowComponent } from '../shared/signal-row.component';
import { DIGESTION_FACTOR, dailyCalories, isProfileComplete } from './calories';
import { GLOSSARY } from './glossary';
import {
  ACTIVE_HOURS_TARGET,
  HR_MINUTES_TARGET,
  MOVEMENT_WEIGHTS,
  evaluateMovementDay,
  formatStretch,
} from './movimento.model';
import { MOVIMENTO_DATA } from './movimento.data';
import { InfoLinkComponent } from '../guida/info-link.component';

const FORMULA_ROWS: readonly { label: string; weight: number }[] = [
  { label: "Passi rispetto all'obiettivo", weight: MOVEMENT_WEIGHTS['move-steps'] },
  { label: 'Ore attive (almeno 250 passi)', weight: MOVEMENT_WEIGHTS['move-active-hours'] },
  { label: 'Minuti con il battito in zona moderata o alta', weight: MOVEMENT_WEIGHTS['move-hr-minutes'] },
  { label: 'Assenza di pause lunghe senza movimento', weight: MOVEMENT_WEIGHTS['move-sedentary'] },
];

/**
 * Dettaglio Movimento: oggi in corso, l'indice di ieri con i suoi quattro segnali, le ore ora per ora,
 * le calorie giornaliere e l'andamento dei passi. Per ora usa dati sintetici.
 */
@Component({
  selector: 'app-movimento-detail',
  imports: [
    InfoLinkComponent,
    NoDataComponent,
    RouterLink,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonButtons,
    IonBackButton,
    IonContent,
    ZoneBadgeComponent,
    SignalRowComponent,
    HourlyStepsComponent,
    BandChartComponent,
    DayPickerComponent,
  ],
  styleUrl: './movimento-detail.page.scss',
  template: `
    <ion-header [translucent]="false">
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button defaultHref="/tabs/oggi" text="" aria-label="Indietro a Oggi"></ion-back-button>
        </ion-buttons>
        <ion-title>Movimento</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content>
      @if (hasData()) {
      <main class="page" data-domain="movimento">
        @if (selectedDay() === null) {
        <section class="hero" aria-label="Movimento di oggi">
          <p class="eyebrow">Oggi · in corso</p>
          @if (data().source === 'esempio') {
            <p class="sample-note">Dati d'esempio. Collega il telefono a un server in Impostazioni per vedere i tuoi.</p>
          }
          <div class="value-row">
            <span class="number">{{ stepsToday() }}</span>
            <span class="of">passi su {{ goalText() }}</span>
          </div>
          <div
            class="progress"
            role="progressbar"
            aria-valuemin="0"
            [attr.aria-valuemax]="goal()"
            [attr.aria-valuenow]="data().stepsToday"
            aria-label="Passi di oggi"
          >
            <span class="progress-fill" [style.width.%]="progress()"></span>
          </div>
          <p class="hint">Il giorno non è finito: l'indice si calcola a fine giornata.</p>
        </section>
        }

        @if (finishedDays().length > 1) {
          <app-day-picker [days]="finishedDays()" [selected]="selectedDay()" (changed)="requested.set($event)"></app-day-picker>
        }
        <section aria-labelledby="ieri">
          <h2 id="ieri" class="section-title">{{ dayTitle() }} <app-info topic="movimento"></app-info></h2>
          <div class="value-row">
            <span class="index">{{ day().value }}</span>
            <span class="of">su 100</span>
            <app-zone-badge [zone]="zone()"></app-zone-badge>
          </div>
          <ul class="signals">
            @for (s of day().signals; track s.id) {
              <li><app-signal-row [signal]="s" domain="movimento" [showAverage]="false"></app-signal-row></li>
            }
          </ul>
          <p class="note">Ogni barra misura quanto sei vicino al punteggio pieno di quel segnale.</p>
        </section>

        <section aria-labelledby="ore">
          <h2 id="ore" class="section-title">Ore di {{ dayWords() }}</h2>
          <article class="card">
            <app-hourly-steps [steps]="data().stepsYesterdayByHour"></app-hourly-steps>
            @if (day().stretches.length > 0) {
              <p class="stretches">
                Pause lunghe senza movimento:
                @for (stretch of day().stretches; track stretch.from; let last = $last) {
                  <strong>{{ format(stretch) }}</strong>{{ last ? '.' : ', ' }}
                }
              </p>
            } @else {
              <p class="stretches">Nessuna pausa lunga senza movimento.</p>
            }
            <p class="hint">Un'ora è attiva se contiene almeno 250 passi. Le pause contano tra le 07:00 e le 23:00.</p>
          </article>
        </section>

        <section aria-labelledby="calorie">
          <h2 id="calorie" class="section-title">Calorie giornaliere <app-info topic="calorie"></app-info></h2>
          @if (calories(); as kcal) {
            <article class="card">
              <p class="kcal"><strong>{{ thousands(kcal.total) }}</strong> kcal</p>
              <p class="hint">{{ dayTitle() }}. kcal sono le chilocalorie, quelle scritte sulle etichette degli alimenti.</p>
              <ul class="parts">
                <li>
                  <span>Metabolismo a riposo</span><strong>{{ thousands(kcal.rest) }} kcal</strong>
                  <small>Le calorie che il corpo brucia anche stando fermo.</small>
                </li>
                <li>
                  <span>Attività</span><strong>{{ thousands(kcal.activity) }} kcal</strong>
                  <small>Stimate dai passi e dal tuo peso.</small>
                </li>
                <li>
                  <span>Digestione</span><strong>{{ thousands(kcal.digestion) }} kcal</strong>
                  <small>Circa il {{ digestionPercent }}% in più su tutto il resto.</small>
                </li>
              </ul>
              <p class="hint">È una stima, non una misura. Nessun obiettivo dietetico né consiglio alimentare.</p>
            </article>
          } @else {
            <article class="card">
              <p class="plain">
                Per stimare le calorie servono anno di nascita, altezza e peso. Restano sul tuo telefono.
              </p>
              <a class="link" routerLink="/impostazioni">Apri Impostazioni › Profilo</a>
            </article>
          }
        </section>

        <section aria-labelledby="andamento">
          <h2 id="andamento" class="section-title">Passi, ultimi 30 giorni</h2>
          <article class="card">
            <p class="chart-value">
              <strong>{{ thousands(lastSteps()) }}</strong>
              <span> · media {{ thousands(averageSteps()) }}</span>
              <span class="state" [class.is-out]="stepsOutside()">
                {{ stepsOutside() ? 'Fuori fascia' : 'In fascia' }}
              </span>
            </p>
            <app-band-chart [values]="shownSteps()" [band]="band()" label="Passi" domain="movimento"></app-band-chart>
            <p class="hint">
              La banda grigia è la tua fascia normale, la linea tratteggiata la tua media. Il valore di oggi non c'è:
              l'ultimo punto è ieri.
            </p>
          </article>
        </section>

        <details class="formula">
          <summary>Come si calcola</summary>
          <p>
            L'indice di un giorno è la somma pesata di quattro segnali, ognuno da 0 a 100. I passi si confrontano con
            il tuo obiettivo; ore attive e minuti di sforzo con un valore pieno di {{ activeTarget }} ore e
            {{ hrTarget }} minuti.
          </p>
          <ul>
            @for (row of formulaRows; track row.label) {
              <li>
                <span>{{ row.label }}</span>
                <span>{{ percent(row.weight) }}%</span>
              </li>
            }
          </ul>
          <p class="version">Formula v1, pesi e valori pieni iniziali da tarare.</p>
        </details>

        <p class="disclaimer">RingLife non è un dispositivo medico. Stime e suggerimenti non sono diagnosi.</p>
      </main>
      } @else {
        <app-no-data title="Movimento"></app-no-data>
      }
    </ion-content>
  `,
})
export class MovimentoDetailPage {
  private readonly settings = inject(SettingsService);

  private readonly latest = inject(MOVIMENTO_DATA);
  private readonly days = inject(DaysService);
  /** Il giorno da mostrare, dall'indirizzo (`?giorno=2026-11-17`). */
  readonly giorno = input<string | undefined>(undefined);
  /** Scelto con le frecce; riparte dall'indirizzo quando l'indirizzo cambia. `null` = oggi e ieri. */
  protected readonly requested = linkedSignal<string | null>(() => this.giorno() ?? null);
  /** I giorni conclusi che si possono rivedere (dal server; con i dati d'esempio nessuno). */
  protected readonly finishedDays = computed(() => (this.days.connected() ? movementDays(this.days.days()) : []));
  protected readonly selectedDay = computed(() => chosenDay(this.requested(), this.finishedDays()));
  private readonly source = computed(() => {
    const day = this.selectedDay();
    return day === null ? this.latest() : movimentoFromServer(MOVIMENTO_SAMPLE, this.days.days(), day);
  });
  /** «ieri» o «lunedì 17 novembre»: il giorno concluso mostrato. */
  protected readonly dayWords = computed(() => {
    const day = this.selectedDay() ?? this.finishedDays().at(-1);
    return day ? dayName(day, new Date()) : 'ieri';
  });
  protected readonly dayTitle = computed(() => this.dayWords().charAt(0).toUpperCase() + this.dayWords().slice(1));
  /** Il server non ha ancora questo risultato: la pagina dice «nessun dato», mai l'esempio. */
  protected readonly hasData = computed(() => this.source() !== null);
  protected readonly data = computed(() => this.source()!);
  protected readonly formulaRows = FORMULA_ROWS;
  protected readonly activeTarget = ACTIVE_HOURS_TARGET;
  protected readonly hrTarget = HR_MINUTES_TARGET;
  protected readonly digestionPercent = Math.round(DIGESTION_FACTOR * 100);

  protected readonly goal = computed(() => this.settings.settings().stepsGoal);
  protected readonly goalText = computed(() => formatThousands(this.goal()));
  protected readonly stepsToday = computed(() => formatThousands(this.data().stepsToday));
  protected readonly progress = computed(() => Math.min(100, Math.round((this.data().stepsToday / this.goal()) * 100)));

  private readonly stepsYesterday = computed(() => this.data().stepsYesterdayByHour.reduce((sum, v) => sum + v, 0));

  protected readonly day = computed(() =>
    evaluateMovementDay(
      {
        steps: this.stepsYesterday(),
        stepsGoal: this.goal(),
        stepsByHour: this.data().stepsYesterdayByHour,
        hrMinutes: this.data().hrMinutesYesterday,
      },
      {
        'move-steps': GLOSSARY['move-steps'],
        'move-active-hours': GLOSSARY['move-active-hours'],
        'move-hr-minutes': GLOSSARY['move-hr-minutes'],
        'move-sedentary': GLOSSARY['move-sedentary'],
      },
      formatThousands,
    ),
  );
  protected readonly zone = computed(() => zoneForScore(this.day().value));

  protected readonly calories = computed(() => {
    const profile = this.settings.settings().profile;
    return isProfileComplete(profile) ? dailyCalories(profile, this.stepsYesterday(), this.data().today) : null;
  });

  protected readonly shownSteps = computed(() => this.data().stepsHistory.slice(-30));
  protected readonly band = computed(() => normalBand(this.data().stepsHistory));
  protected readonly lastSteps = computed(() => this.shownSteps()[this.shownSteps().length - 1]);
  protected readonly averageSteps = computed(() => Math.round(average(this.data().stepsHistory.slice(-BASELINE_DAYS))));
  protected readonly stepsOutside = computed(() => isOutside(this.lastSteps(), this.band()));

  protected format = formatStretch;

  protected thousands(value: number): string {
    return formatThousands(Math.round(value));
  }

  protected percent(weight: number): number {
    return Math.round(weight * 100);
  }
}
