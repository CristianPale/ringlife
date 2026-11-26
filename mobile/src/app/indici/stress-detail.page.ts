import { Component, computed, inject, input, linkedSignal, signal } from '@angular/core';
import { DaysService } from '../api/days.service';
import { DayPickerComponent } from '../shared/day-picker.component';
import { chosenDay, dayName, daysUpTo, daysWith } from '../shared/day-history';
import { stressFromServer } from './stress.from-server';
import { STRESS_SAMPLE } from './stress.sample';
import { NoDataComponent } from '../shared/no-data.component';
import { IonBackButton, IonButtons, IonContent, IonHeader, IonTitle, IonToolbar } from '@ionic/angular';
import { LivellaComponent } from '../livella/livella.component';
import { ZoneBadgeComponent } from '../oggi/zone-badge.component';
import { ChipGroupComponent, ChipOption } from '../shared/chip-group.component';
import { SignalRowComponent } from '../shared/signal-row.component';
import { HourlyStressComponent } from './hourly-stress.component';
import { HIGH_STRESS, STRESS_WEIGHTS, hoursWithData, sharePercent, verdictFor } from './stress.model';
import { STRESS_DATA } from './stress.data';
import { TrendChartComponent } from './trend-chart.component';
import { InfoLinkComponent } from '../guida/info-link.component';

const RANGES: readonly ChipOption[] = [
  { code: '7', label: '7 giorni' },
  { code: '30', label: '30 giorni' },
  { code: '90', label: '90 giorni' },
];

const FORMULA_ROWS: readonly { label: string; weight: number }[] = [
  { label: 'Quota di misure con stress alto, tra le 07:00 e le 23:00', weight: STRESS_WEIGHTS['stress-load'] },
  { label: 'Recupero serale: la sera più calma del giorno', weight: STRESS_WEIGHTS['stress-evening'] },
];

/**
 * Dettaglio dell'indice Stress: com'è andata la giornata, lo stress ora per ora, i due segnali con il loro peso,
 * l'andamento a 7, 30 o 90 giorni e la formula. Più alto è l'indice, più la giornata è stata tranquilla.
 */
@Component({
  selector: 'app-stress-detail',
  imports: [
    InfoLinkComponent,
    DayPickerComponent,
    NoDataComponent,
    IonHeader,
    IonToolbar,
    IonButtons,
    IonBackButton,
    IonContent,
    ZoneBadgeComponent,
    LivellaComponent,
    SignalRowComponent,
    ChipGroupComponent,
    TrendChartComponent,
    HourlyStressComponent,
  ],
  styleUrl: './stress-detail.page.scss',
  template: `
    <ion-header [translucent]="false">
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button defaultHref="/tabs/oggi" text="" aria-label="Indietro a Oggi"></ion-back-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content>
      @if (hasData()) {
      <main class="page" data-domain="stress">
        @if (stressDays().length > 1) {
          <app-day-picker [days]="stressDays()" [selected]="selectedDay()" (changed)="requested.set($event)"></app-day-picker>
        } @else {
          <p class="eyebrow">{{ dayText() }}</p>
        }
        <h1 class="verdict">{{ verdict().title }}</h1>

        <section class="hero" aria-label="Stress di ieri">
          <div class="hero-head">
            <span class="number">{{ data().value }}</span>
            <span class="hero-side">
              <app-zone-badge [zone]="data().zone"></app-zone-badge>
              <span class="of">Stress, su 100</span>
            </span>
          </div>
          <app-livella [deviation]="data().indexDeviation" [width]="342" [labels]="indexLabels()" [description]="data().value + ' su 100'"></app-livella>
          @if (data().source === 'esempio') {
            <p class="sample-note">Dati d'esempio. Collega il telefono a un server in Impostazioni per vedere i tuoi.</p>
          }
          <p class="verdict-detail">{{ verdict().detail }}</p>
          <p class="verdict-detail">Più alto è l'indice, più la giornata è stata tranquilla.</p>
        </section>

        @if (hasHours()) {
          <section aria-labelledby="ore">
            <h2 id="ore" class="section-title">La giornata ora per ora</h2>
            <app-hourly-stress [values]="data().byHour"></app-hourly-stress>
            <p class="note">
              Ogni colonna è lo stress medio dell'ora. Le colonne arancioni arrivano a {{ highStress }} o più, la
              linea tratteggiata è quella soglia.
            </p>
            @if (shareText(); as text) {
              <p class="plain">{{ text }}</p>
            }
          </section>
        }

        <section aria-labelledby="segnali">
          <h2 id="segnali" class="section-title">I segnali <app-info topic="stress"></app-info></h2>
          <ul class="signals">
            @for (s of data().signals; track s.id) {
              <li><app-signal-row [signal]="s" domain="stress" [showAverage]="false"></app-signal-row></li>
            }
          </ul>
        </section>

        <section aria-labelledby="andamento">
          <h2 id="andamento" class="section-title">Andamento</h2>
          <app-chip-group
            class="ranges"
            variant="segment"
            label="Periodo"
            [options]="ranges"
            [selected]="[range()]"
            (changed)="setRange($event)"
          ></app-chip-group>
          <app-trend-chart [values]="series()" label="Stress" domain="stress"></app-trend-chart>
        </section>

        <details class="formula">
          <summary>Come si calcola</summary>
          <p>
            Si calcola a giornata finita, sulle misure di stress dell'anello tra le 07:00 e le 23:00. Un indice più
            alto vuol dire meno tempo in stress alto e una sera più calma del giorno.
          </p>
          <ul>
            @for (row of formulaRows; track row.label) {
              <li>
                <span>{{ row.label }}</span>
                <span>{{ percent(row.weight) }}%</span>
              </li>
            }
          </ul>
          <p class="version">Formula v1, pesi e soglia iniziali da tarare.</p>
        </details>

        <p class="disclaimer">RingLife non è un dispositivo medico. Stime e suggerimenti non sono diagnosi.</p>
      </main>
      } @else {
        <app-no-data title="Stress"></app-no-data>
      }
    </ion-content>
  `,
})
export class StressDetailPage {
  private readonly latest = inject(STRESS_DATA);
  private readonly days = inject(DaysService);
  /** Il giorno da mostrare, dall'indirizzo (`?giorno=2026-11-17`). */
  readonly giorno = input<string | undefined>(undefined);
  /** Scelto con le frecce; riparte dall'indirizzo quando l'indirizzo cambia. `null` = il giorno più recente. */
  protected readonly requested = linkedSignal<string | null>(() => this.giorno() ?? null);
  protected readonly stressDays = computed(() => (this.days.connected() ? daysWith(this.days.days(), (d) => !!d.scores['stress']) : []));
  protected readonly selectedDay = computed(() => chosenDay(this.requested(), this.stressDays()));
  private readonly source = computed(() => {
    const day = this.selectedDay();
    return day === null ? this.latest() : stressFromServer(STRESS_SAMPLE, daysUpTo(this.days.days(), day));
  });
  /** Il server non ha ancora questo risultato: la pagina dice «nessun dato», mai l'esempio. */
  protected readonly hasData = computed(() => this.source() !== null);
  protected readonly data = computed(() => this.source()!);
  protected readonly ranges = RANGES;
  protected readonly formulaRows = FORMULA_ROWS;
  protected readonly highStress = HIGH_STRESS;

  protected readonly range = signal('30');
  protected readonly verdict = computed(() => verdictFor(this.data().value));
  protected readonly series = computed(() => this.data().history.slice(-Number(this.range())));
  protected readonly indexLabels = computed(() => {
    const range = this.data().indexRange;
    return range ? { low: String(Math.round(range.low)), high: String(Math.round(range.high)) } : null;
  });
  protected readonly hasHours = computed(() => hoursWithData(this.data().byHour) > 0);

  protected readonly dayText = computed(() => {
    const text = new Intl.DateTimeFormat('it-IT', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      timeZone: 'Europe/Rome',
    }).format(this.data().date);
    return `Giornata di ${text}`;
  });

  protected readonly shareText = computed(() => {
    const share = this.data().highShare;
    return share === null ? null : `Il ${sharePercent(share)}% delle misure di giorno aveva uno stress alto.`;
  });

  protected percent(weight: number): number {
    return Math.round(weight * 100);
  }

  protected setRange(codes: string[]): void {
    // Il gruppo è a scelta singola: un secondo tocco sulla stessa voce non deve lasciare il grafico senza periodo.
    if (codes.length > 0) {
      this.range.set(codes[0]);
    }
  }
}
