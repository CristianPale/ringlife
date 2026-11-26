import { Component, computed, inject, input, linkedSignal, signal } from '@angular/core';
import { DaysService } from '../api/days.service';
import { DayPickerComponent } from '../shared/day-picker.component';
import { chosenDay, dayName, daysUpTo, daysWith } from '../shared/day-history';
import { recuperoFromServer } from './recupero.from-server';
import { RECUPERO_SAMPLE } from './recupero.sample';
import { NoDataComponent } from '../shared/no-data.component';
import { IonBackButton, IonButtons, IonContent, IonHeader, IonToolbar } from '@ionic/angular';
import { normalBand } from '../andamento/andamento.model';
import { BandChartComponent } from '../andamento/band-chart.component';
import { JournalService } from '../diary/journal.service';
import { LivellaComponent } from '../livella/livella.component';
import { standingOf } from '../livella/livella';
import { ZoneBadgeComponent } from '../oggi/zone-badge.component';
import { MeasureRowComponent, MeasureRowData } from '../shared/measure-row.component';
import { ChipGroupComponent, ChipOption } from '../shared/chip-group.component';
import {
  CONTRIBUTOR_PHRASE,
  Contributor,
  RECOVERY_WEIGHTS,
  contributorWords,
  draggingContributors,
  splitReading,
  verdictFor,
} from './recupero.model';
import { RECUPERO_DATA } from './recupero.data';
import { recoveryWaiting } from './calibration';
import { StrainCause, StrainSignalId, alcoholEveningBefore, evaluateStrain } from './strain.model';
import { InfoLinkComponent } from '../guida/info-link.component';

const RANGES: readonly ChipOption[] = [
  { code: '7', label: '7 giorni' },
  { code: '30', label: '30 giorni' },
  { code: '90', label: '90 giorni' },
];

const STRAIN_SIGNALS: Record<
  StrainSignalId,
  { label: string; fullName?: string; rule: string; contributor: 'hrv' | 'hr-riposo' | 'temperatura' }
> = {
  rhr: { label: 'Battito a riposo', rule: 'Conta se è più alto del solito', contributor: 'hr-riposo' },
  hrv: {
    label: 'HRV',
    fullName: 'Variabilità della frequenza cardiaca',
    rule: 'Conta se è più bassa del solito',
    contributor: 'hrv',
  },
  temp: { label: 'Temperatura', rule: 'Conta se è più alta del solito', contributor: 'temperatura' },
};

const FORMULA_ROWS: readonly { label: string; weight: number }[] = [
  { label: 'Variabilità della frequenza cardiaca (HRV) rispetto alla tua media', weight: RECOVERY_WEIGHTS.hrv },
  { label: 'Battito a riposo di notte rispetto alla tua media', weight: RECOVERY_WEIGHTS['hr-riposo'] },
  { label: 'Temperatura: scostamento notturno', weight: RECOVERY_WEIGHTS.temperatura },
  { label: 'Indice Sonno', weight: RECOVERY_WEIGHTS.sonno },
  { label: 'Stress del giorno prima', weight: RECOVERY_WEIGHTS.stress },
];

/**
 * Dettaglio dell'indice Recupero (ADR 0020): frase del giorno, numero con la livella, che cosa pesa sul numero con il
 * peso di ogni segnale, segnali di affaticamento, andamento a 7, 30 o 90 giorni con il tuo solito, formula.
 * Senza server usa dati sintetici.
 */
@Component({
  selector: 'app-recupero-detail',
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
    MeasureRowComponent,
    ChipGroupComponent,
    BandChartComponent,
  ],
  styleUrl: './recupero-detail.page.scss',
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
      <main class="page">
        @if (recoveryDays().length > 1) {
          <app-day-picker [days]="recoveryDays()" [selected]="selectedDay()" (changed)="requested.set($event)"></app-day-picker>
        }
        <h1 class="lead">
          @for (part of lead(); track $index) {
            <span [attr.data-tone]="part.tone ?? null">{{ part.text }}</span>
          }
        </h1>

        <section class="hero" aria-label="Recupero di oggi">
          <div class="hero-head">
            <span class="number">{{ data().value }}</span>
            <span class="hero-side">
              <app-zone-badge [zone]="data().zone"></app-zone-badge>
              <span class="of">Recupero, su 100</span>
            </span>
          </div>
          <app-livella [deviation]="data().indexDeviation" [width]="342" [labels]="indexLabels()" [description]="data().value + ' su 100'"></app-livella>
          @if (data().source === 'esempio') {
            <p class="sample-note">Dati d'esempio. Collega il telefono a un server in Impostazioni per vedere i tuoi.</p>
          }
          <p class="verdict-detail"><strong class="verdict">{{ verdict().title }}.</strong> {{ verdict().detail }}</p>
        </section>

        <section aria-labelledby="pesa">
          <h2 id="pesa" class="section-title">Cosa pesa sul numero <app-info topic="recupero"></app-info></h2>
          <div class="measures">
            @for (row of rows(); track row.id) {
              <app-measure-row [row]="row" layout="stacked"></app-measure-row>
            }
          </div>
          <details class="glossary">
            <summary>Cosa misura ogni segnale</summary>
            <ul>
              @for (c of data().contributors; track c.id) {
                <li>
                  <strong>{{ c.label }}</strong>
                  @if (c.fullName) {
                    <span class="full-name"> ({{ c.fullName }})</span>
                  }
                  <span>. {{ c.help }}</span>
                </li>
              }
            </ul>
          </details>
          <p class="note">Tra le due tacche stai come sempre. Il peso è quanto il segnale conta nel numero.</p>
        </section>

        <section aria-labelledby="fatica">
          <h2 id="fatica" class="section-title">Segnali di affaticamento <app-info topic="affaticamento"></app-info></h2>
          <div class="strain" [attr.data-level]="strain().level ?? 'calibrazione'">
            <p class="strain-title">{{ strainText().title }}</p>
            <p class="strain-detail">{{ strainText().detail }}</p>
            @if (strain().cause; as cause) {
              <p class="strain-cause">{{ causeText(cause) }}</p>
            }
          </div>
          @if (strain().level !== null) {
            <ul class="strain-rows">
              @for (row of strainRows(); track row.id) {
                <li class="strain-row" [class.is-active]="row.active">
                  <div class="strain-row-head">
                    <span class="signal-name">
                      {{ row.label }}
                      @if (row.fullName) {
                        <span class="full-name">{{ row.fullName }}</span>
                      }
                    </span>
                    <span class="strain-state">
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        @if (row.active) {
                          <path d="M12 4l9 16H3z"></path>
                          <path d="M12 10v4"></path>
                        } @else {
                          <path d="M5 12l4 4 10-10"></path>
                        }
                      </svg>
                      {{ row.active ? 'Oltre la soglia' : 'In linea' }}
                    </span>
                  </div>
                  <span class="strain-value">{{ row.valueText }}</span>
                  <span class="strain-rule">{{ row.rule }}</span>
                </li>
              }
            </ul>
          }
          <p class="note">
            Indica fatica quando almeno due dei tre segnali si scostano insieme dalla tua media. Non è una diagnosi.
          </p>
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
          <app-band-chart [values]="series()" [band]="band()" label="Recupero"></app-band-chart>
          <p class="note">La fascia grigia è il tuo solito: i valori più frequenti degli ultimi 28 giorni.</p>
        </section>

        <details class="formula">
          <summary>Come si calcola</summary>
          <p>
            Ogni segnale è confrontato con la tua media degli ultimi 28 giorni. Il punteggio è la somma pesata
            dei cinque segnali. Servono almeno 7 giorni di dati: prima l'app mostra «calibrazione in corso».
          </p>
          <ul>
            @for (row of formulaRows; track row.label) {
              <li>
                <span>{{ row.label }}</span>
                <span>{{ percent(row.weight) }}%</span>
              </li>
            }
          </ul>
          <p class="version">Formula v1, pesi iniziali da tarare.</p>
        </details>

        <p class="disclaimer">RingLife non è un dispositivo medico. Stime e suggerimenti non sono diagnosi.</p>
      </main>
      } @else {
        <app-no-data title="Recupero" [lead]="waiting().lead" [hint]="waiting().hint"></app-no-data>
      }
    </ion-content>
  `,
})
export class RecuperoDetailPage {
  private readonly latest = inject(RECUPERO_DATA);
  private readonly days = inject(DaysService);
  /** Il giorno da mostrare, dall'indirizzo (`?giorno=2026-11-17`, per esempio da un punto di Andamento). */
  readonly giorno = input<string | undefined>(undefined);
  /** Scelto con le frecce; riparte dall'indirizzo quando l'indirizzo cambia. `null` = il giorno più recente. */
  protected readonly requested = linkedSignal<string | null>(() => this.giorno() ?? null);
  protected readonly recoveryDays = computed(() => (this.days.connected() ? daysWith(this.days.days(), (d) => !!d.scores['recovery']) : []));
  protected readonly selectedDay = computed(() => chosenDay(this.requested(), this.recoveryDays()));
  private readonly source = computed(() => {
    const day = this.selectedDay();
    return day === null ? this.latest() : recuperoFromServer(RECUPERO_SAMPLE, daysUpTo(this.days.days(), day));
  });
  /** Il server non ha ancora questo risultato: la pagina dice «nessun dato», mai l'esempio. */
  protected readonly hasData = computed(() => this.source() !== null);
  protected readonly data = computed(() => this.source()!);
  /** Senza Recupero: quasi sempre la calibrazione, con quante notti mancano. */
  protected readonly waiting = computed(() => recoveryWaiting(this.days.days()));
  private readonly journal = inject(JournalService);
  protected readonly ranges = RANGES;
  protected readonly formulaRows = FORMULA_ROWS;

  protected readonly range = signal('30');
  protected readonly verdict = computed(() => verdictFor(this.data().value));
  protected readonly dragging = computed(() => draggingContributors(this.data().contributors));
  protected readonly series = computed(() => this.data().history.slice(-Number(this.range())));
  /** La fascia del tuo solito sull'intero storico, anche con un periodo corto: sono i 28 giorni, non il periodo scelto. */
  protected readonly band = computed(() => normalBand(this.data().history));
  protected readonly indexLabels = computed(() => {
    const range = this.data().indexRange;
    return range ? { low: String(Math.round(range.low)), high: String(Math.round(range.high)) } : null;
  });

  /** La frase del giorno: come sta il Recupero contro il tuo solito e che cosa pesa di più. */
  protected readonly lead = computed(() => {
    const deviation = this.data().indexDeviation;
    const heaviest = this.dragging()[0];
    const day = this.selectedDay();
    const when = day === null ? 'di oggi' : `di ${dayName(day, new Date())}`;
    const parts: { text: string; tone?: 'peggio' | 'meglio' }[] = [{ text: `Il recupero ${when} è ` }];
    if (deviation === null) {
      parts.push({ text: 'ancora in calibrazione' });
    } else {
      const standing = standingOf(deviation);
      const words = standing === 'peggio' ? 'sotto il tuo solito' : standing === 'meglio' ? 'sopra il tuo solito' : 'come il tuo solito';
      parts.push(standing === 'solito' ? { text: words } : { text: words, tone: standing });
    }
    parts.push({ text: '.' });
    if (heaviest) {
      parts.push({ text: ` Pesa soprattutto ${CONTRIBUTOR_PHRASE[heaviest.id]}.` });
    }
    return parts;
  });

  protected readonly rows = computed<MeasureRowData[]>(() => this.data().contributors.map((c) => this.rowOf(c)));

  protected readonly strain = computed(() => {
    const causes: StrainCause[] = alcoholEveningBefore(this.journal.entries(), this.data().date) ? ['alcohol'] : [];
    return evaluateStrain(this.data().deviations, causes);
  });

  protected readonly strainText = computed(() => {
    const strain = this.strain();
    switch (strain.level) {
      case null:
        return {
          title: 'Calibrazione in corso',
          detail: 'Servono almeno 7 giorni di dati per confrontarti con la tua media.',
        };
      case 'alto':
        return { title: 'Riposo consigliato oggi', detail: 'Tutti e tre i segnali indicano fatica insieme.' };
      case 'attenzione':
        return { title: 'Riposo consigliato oggi', detail: `${strain.count} segnali su 3 indicano fatica.` };
      default:
        return {
          title: 'Nessun segnale di affaticamento',
          detail:
            strain.count === 0
              ? 'Tutti e tre i segnali sono in linea con la tua media.'
              : `${strain.count} segnale su 3 è oltre la soglia: ne servono almeno 2.`,
        };
    }
  });

  protected readonly strainRows = computed(() =>
    this.strain().signals.map((signal) => {
      const meta = STRAIN_SIGNALS[signal.id];
      const contributor = this.data().contributors.find((c) => c.id === meta.contributor);
      return {
        id: signal.id,
        label: meta.label,
        fullName: meta.fullName,
        rule: meta.rule,
        valueText: contributor?.valueText ?? '',
        baselineText: contributor?.baselineText,
        active: signal.active,
      };
    }),
  );

  private rowOf(c: Contributor): MeasureRowData {
    const direction = c.direction ?? 'up';
    const deviation = c.deviation ?? null;
    const words = contributorWords(deviation, direction, c.weight);
    return {
      id: c.id,
      label: c.fullName ? `${c.fullName} (${c.label})` : c.label,
      ...words,
      deviation,
      direction,
      ...splitReading(c.valueText),
    };
  }

  protected causeText(cause: StrainCause): string {
    return cause === 'alcohol'
      ? 'Ieri sera hai registrato alcol: può spiegare in parte questi valori.'
      : 'Ieri sera hai registrato un pasto tardo: può spiegare in parte questi valori.';
  }

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
