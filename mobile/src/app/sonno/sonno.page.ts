import { Component, computed, inject, input, linkedSignal } from '@angular/core';
import { DaysService } from '../api/days.service';
import { DayPickerComponent } from '../shared/day-picker.component';
import { chosenDay, daysUpTo, daysWith } from '../shared/day-history';
import { sonnoFromServer } from './sonno.from-server';
import { SONNO_SAMPLE } from './sonno.sample';
import { respiroFromServer } from './respiro.from-server';
import { NoDataComponent } from '../shared/no-data.component';
import { IonContent } from '@ionic/angular';
import { normalBand } from '../andamento/andamento.model';
import { BandChartComponent } from '../andamento/band-chart.component';
import { GLOSSARY } from '../indici/glossary';
import { TrendChartComponent } from '../indici/trend-chart.component';
import { LivellaComponent } from '../livella/livella.component';
import { ZoneBadgeComponent } from '../oggi/zone-badge.component';
import { zoneForScore } from '../oggi/zone';
import { MeasureRowComponent } from '../shared/measure-row.component';
import { SignalRowComponent } from '../shared/signal-row.component';
import { DebtBarsComponent } from './debt-bars.component';
import { HypnogramComponent } from './hypnogram.component';
import {
  SLEEP_WEIGHTS,
  SleepStage,
  asleepMinutes,
  formatHoursMinutes,
  inBedMinutes,
  totalsByStage,
} from './sonno.model';
import { SettingsService } from '../settings/settings.service';
import { RESPIRO_DATA } from './respiro.data';
import { RESPIRO_SAMPLE } from './respiro.sample';
import { evaluateBreathing } from './respiro.model';
import { SONNO_DATA } from './sonno.data';
import { nightSentence } from './sonno.rows';
import { InfoLinkComponent } from '../guida/info-link.component';
import { RingSyncService } from '../ring/ring-sync.service';
import { pendingNightText } from './pending-night';

const FORMULA_ROWS: readonly { label: string; weight: number }[] = [
  { label: 'Durata rispetto al tuo obiettivo', weight: SLEEP_WEIGHTS['sleep-duration'] },
  { label: 'Efficienza', weight: SLEEP_WEIGHTS['sleep-efficiency'] },
  { label: 'Sonno profondo', weight: SLEEP_WEIGHTS['sleep-deep'] },
  { label: 'Sonno REM (Rapid Eye Movement)', weight: SLEEP_WEIGHTS['sleep-rem'] },
  { label: 'Risvegli e minuti svegli', weight: SLEEP_WEIGHTS['sleep-awakenings'] },
  { label: 'Regolarità del punto medio del sonno', weight: SLEEP_WEIGHTS['sleep-regularity'] },
  { label: 'Battito minimo notturno rispetto alla tua media', weight: SLEEP_WEIGHTS['sleep-min-hr'] },
];

const STAGE_LIST: readonly { stage: SleepStage; name: string; glossary: keyof typeof GLOSSARY }[] = [
  { stage: 'deep', name: 'Profondo', glossary: 'stage-deep' },
  { stage: 'rem', name: 'REM', glossary: 'stage-rem' },
  { stage: 'light', name: 'Leggero', glossary: 'stage-light' },
  { stage: 'awake', name: 'Sveglio', glossary: 'stage-awake' },
];

function result(history: readonly number[], tonight: number | null): number[] {
  return tonight === null ? [...history] : [...history, tonight];
}

function nightLabel(wake: Date): string {
  const weekday = (date: Date) =>
    new Intl.DateTimeFormat('it-IT', { weekday: 'long', timeZone: 'Europe/Rome' }).format(date);
  const before = new Date(wake.getTime() - 24 * 60 * 60 * 1000);
  return `Notte da ${weekday(before)} a ${weekday(wake)}`;
}

/**
 * Scheda Sonno (ADR 0020): frase della notte, indice con la livella, ipnogramma, fasi e misure del corpo contro il tuo
 * solito, debito di sonno, poi i sette segnali dell'indice, la regolarità e il respiro notturno.
 * Senza server usa dati sintetici.
 */
@Component({
  selector: 'app-sonno',
  imports: [
    InfoLinkComponent,
    NoDataComponent,
    IonContent,
    ZoneBadgeComponent,
    LivellaComponent,
    MeasureRowComponent,
    SignalRowComponent,
    DebtBarsComponent,
    HypnogramComponent,
    TrendChartComponent,
    BandChartComponent,
    DayPickerComponent,
  ],
  styleUrl: './sonno.page.scss',
  template: `
    <ion-content [fullscreen]="true">
      @if (hasData()) {
      <main class="page">
        <header class="header">
          @if (nightDays().length > 1) {
            <app-day-picker [days]="nightDays()" [selected]="selectedDay()" [label]="night()" (changed)="requested.set($event)"></app-day-picker>
          } @else {
            <span class="date">{{ night() }}</span>
          }
        </header>

        <h1 class="lead">
          @for (part of lead(); track $index) {
            <span [attr.data-tone]="part.tone ?? null">{{ part.text }}</span>
          }
        </h1>
        @if (data().source === 'esempio') {
          <p class="sample-note">Dati d'esempio. Collega il telefono a un server in Impostazioni per vedere i tuoi.</p>
        }
        @if (pendingNight(); as pending) {
          <p class="sample-note" role="status">{{ pending }}</p>
        }

        <section class="hero" aria-label="Indice del sonno">
          <div class="hero-head">
            <span class="hero-name">
              <span class="hero-title">Indice del sonno, su 100</span>
              <app-zone-badge [zone]="zone()"></app-zone-badge>
            </span>
            <span class="number">{{ data().value }}</span>
          </div>
          <app-livella [deviation]="data().indexDeviation" [width]="342" [labels]="indexLabels()" [description]="data().value + ' su 100'"></app-livella>
          <p class="verdict">{{ verdict() }}</p>
          <p class="detail">
            {{ asleepText() }} di sonno · {{ bedText() }} a letto · debito di sonno negli ultimi 7 giorni:
            {{ debtText() }}
          </p>
        </section>

        <section aria-labelledby="notte">
          <h2 id="notte" class="section-title">La notte <app-info topic="fasi-sonno"></app-info></h2>
          <app-hypnogram [segments]="data().segments" [bedTime]="data().bedTime" [wakeTime]="data().wakeTime"></app-hypnogram>
        </section>

        <section aria-labelledby="fasi">
          <h2 id="fasi" class="section-title">Fasi rispetto al tuo solito <app-info topic="come-leggere"></app-info></h2>
          <div class="measures">
            @for (row of data().stageRows; track row.id) {
              <app-measure-row [row]="row"></app-measure-row>
            }
          </div>
          <details class="glossary">
            <summary>Cosa sono le fasi</summary>
            <ul class="stages">
              @for (row of stages(); track row.stage) {
                <li class="stage" [attr.data-stage]="row.stage">
                  <span class="stage-name">{{ row.name }}@if (row.fullName) { <span class="full-name"> ({{ row.fullName }})</span> }</span>
                  <span class="stage-help">{{ row.help }} {{ row.time }}, {{ row.percent }}%.</span>
                </li>
              }
            </ul>
          </details>
          <p class="note">Le fasi le calcola l'anello. Le percentuali sono sul tempo di sonno, quella di veglia sul tempo a letto.</p>
        </section>

        @if (data().bodyRows.length > 0) {
          <section aria-labelledby="corpo">
            <h2 id="corpo" class="section-title">Il corpo, stanotte <app-info topic="stanotte"></app-info></h2>
            <div class="measures">
              @for (row of data().bodyRows; track row.id) {
                <app-measure-row [row]="row"></app-measure-row>
              }
            </div>
            <p class="note">La barra è il tuo solito: tra le due tacche stai come sempre.</p>
          </section>
        }

        <section aria-labelledby="debito">
          <div class="debt-head">
            <h2 id="debito" class="section-title">Debito di sonno <app-info topic="debito-sonno"></app-info></h2>
            <span class="debt-number">{{ debtText() }}</span>
          </div>
          <app-debt-bars [nights]="data().nights" [goalMin]="goalMin()"></app-debt-bars>
          <p class="note">Somma delle ore mancate rispetto all'obiettivo nelle ultime 7 notti. Le notti recenti pesano di più.</p>
        </section>

        <section aria-labelledby="segnali">
          <h2 id="segnali" class="section-title">I segnali <app-info topic="indice-sonno"></app-info></h2>
          <ul class="signals">
            @for (s of signals(); track s.id) {
              <li><app-signal-row [signal]="s" domain="sonno"></app-signal-row></li>
            }
          </ul>
          <p class="note">La linea sulla barra è la tua media: sopra stai meglio del solito, sotto peggio.</p>
        </section>

        <section aria-labelledby="regolarita">
          <h2 id="regolarita" class="section-title">Regolarità del sonno <app-info topic="regolarita"></app-info></h2>
          <div class="reg-head">
            <span class="reg-number">{{ data().regularity.score }}</span>
            <span class="of">su 100</span>
            <app-zone-badge [zone]="regularityZone()"></app-zone-badge>
          </div>
          <p class="plain">{{ regularityHelp }}</p>
          <ul class="reg-facts">
            <li>
              <span>Variazione dell'orario tra una notte e l'altra</span>
              <strong>circa {{ data().regularity.variationMin }} min</strong>
            </li>
            @if (data().regularity.weekendGapMin !== null) {
              <li>
                <span>Differenza tra giorni feriali e fine settimana</span>
                <strong>circa {{ data().regularity.weekendGapMin }} min</strong>
              </li>
            } @else {
              <li class="pending">
                <span>Differenza tra giorni feriali e fine settimana</span>
                <span class="why">Si calcola quando ci sono almeno 2 notti nel fine settimana.</span>
              </li>
            }
          </ul>
          <app-trend-chart [values]="regularityTrend()" label="Regolarità del sonno" domain="sonno"></app-trend-chart>
        </section>

        @if (hasRespiro()) {
        <section aria-labelledby="respiro">
          <h2 id="respiro" class="section-title">Respiro notturno <app-info topic="respiro-notturno"></app-info></h2>
          <div class="breath" [attr.data-status]="breathing().status">
            <p class="breath-title">{{ breathingText().title }}</p>
            <p class="breath-detail">{{ breathingText().detail }}</p>
          </div>
          <p class="plain">
            <strong>{{ spo2.fullName }}</strong>. {{ spo2.help }}
          </p>
          @if (breathing().median !== null) {
            <ul class="reg-facts">
              <li><span>Mediana della notte</span><strong>{{ breathing().median }}%</strong></li>
              <li><span>Valore più basso</span><strong>{{ breathing().min }}%</strong></li>
              <li><span>Misure di stanotte</span><strong>{{ breathing().count }}</strong></li>
              @if (breathing().baseline !== null) {
                <li><span>La tua media</span><strong>{{ breathing().baseline }}%</strong></li>
              }
            </ul>
          }
          <app-band-chart
            [values]="breathingTrend()"
            [band]="breathingBand()"
            label="Respiro notturno (SpO2)"
            domain="sonno"
          ></app-band-chart>
          <p class="note">
            Ogni punto è la mediana di una notte, ultimi {{ breathingTrend().length }} giorni. Un cerchio ambra vuoto è
            una notte fuori dalla tua fascia normale. Non è una diagnosi: se un calo persiste, parlane con un medico.
          </p>
        </section>
        }

        <details class="formula">
          <summary>Come si calcola</summary>
          <p>
            Ogni segnale è confrontato con il tuo obiettivo o con la tua media degli ultimi 28 giorni. L'indice è la
            somma pesata dei sette segnali. Servono almeno 7 giorni di dati: prima l'app mostra «calibrazione in
            corso».
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
        <app-no-data title="Sonno"></app-no-data>
      }
    </ion-content>
  `,
})
export class SonnoPage {
  private readonly settings = inject(SettingsService);
  private readonly latest = inject(SONNO_DATA);
  private readonly days = inject(DaysService);
  private readonly ring = inject(RingSyncService);
  /** Una notte letta dall'anello che il server non ha ancora calcolato, per esempio fuori casa (docs/adr/0043). */
  protected readonly pendingNight = computed(() =>
    this.days.connected()
      ? pendingNightText(this.ring.lastNight(), this.days.days(), this.days.fetchedAt(), this.ring.last()?.at ?? null, new Date())
      : null,
  );
  /** Il giorno da mostrare, dall'indirizzo (`?giorno=2026-11-17`, per esempio da un punto di Andamento). */
  readonly giorno = input<string | undefined>(undefined);
  /** Scelto con le frecce; riparte dall'indirizzo quando l'indirizzo cambia. `null` = la notte più recente. */
  protected readonly requested = linkedSignal<string | null>(() => this.giorno() ?? null);
  /** Le notti che si possono rivedere: indice del sonno e fasi (dal server; con i dati d'esempio nessuna). */
  protected readonly nightDays = computed(() =>
    this.days.connected() ? daysWith(this.days.days(), (d) => !!d.scores['sleep'] && !!d.sleep && d.sleep.stages.length > 0) : [],
  );
  protected readonly selectedDay = computed(() => chosenDay(this.requested(), this.nightDays()));
  private readonly source = computed(() => {
    const day = this.selectedDay();
    return day === null ? this.latest() : sonnoFromServer(SONNO_SAMPLE, daysUpTo(this.days.days(), day));
  });
  /** Il server non ha ancora questo risultato: la pagina dice «nessun dato», mai l'esempio. */
  protected readonly hasData = computed(() => this.source() !== null);
  protected readonly data = computed(() => this.source()!);
  protected readonly formulaRows = FORMULA_ROWS;
  protected readonly regularityHelp = GLOSSARY['sleep-regularity'].help;
  protected readonly spo2 = GLOSSARY.spo2;
  private readonly latestRespiro = inject(RESPIRO_DATA);
  /** Il respiro della notte scelta; se quella notte non ha la SpO2 la sezione non c'è (mai un'altra notte). */
  private readonly respiroSource = computed(() => {
    const day = this.selectedDay();
    if (day === null) {
      return this.latestRespiro();
    }
    const upTo = daysUpTo(this.days.days(), day);
    return upTo[upTo.length - 1]?.metrics['spo2_night'] ? respiroFromServer(RESPIRO_SAMPLE, upTo) : null;
  });
  /** Senza misure di SpO2 il server non ha il respiro notturno: la sezione si nasconde (mai l'esempio). */
  protected readonly hasRespiro = computed(() => this.respiroSource() !== null);
  private readonly respiro = computed(() => this.respiroSource() ?? RESPIRO_SAMPLE);

  protected readonly breathing = computed(() => {
    const data = this.respiro();
    return data.result ?? evaluateBreathing(data.tonight, data.history);
  });
  protected readonly breathingTrend = computed(() => {
    const result = this.breathing();
    const history = this.respiro().history;
    const medians = result.median === null ? history : [...history, result.median];
    return medians.slice(-30);
  });
  protected readonly breathingBand = computed(() =>
    normalBand(result(this.respiro().history, this.breathing().median)),
  );
  protected readonly breathingText = computed(() => {
    const r = this.breathing();
    switch (r.status) {
      case 'insufficient':
        return { title: 'Dati insufficienti', detail: `Stanotte ci sono ${r.count} misure: ne servono almeno 10.` };
      case 'calibrating':
        return {
          title: 'Calibrazione in corso',
          detail: 'Servono almeno 7 notti per confrontarti con la tua media.',
        };
      case 'watch':
        return {
          title: 'Da guardare',
          detail: `La mediana è sotto il tuo solito da ${r.streak} notti di fila. È un andamento, non una diagnosi.`,
        };
      default:
        return {
          title: 'In linea con la tua media',
          detail: `La mediana di stanotte è ${r.median}% e la tua media è ${r.baseline}%.`,
        };
    }
  });

  protected readonly night = computed(() => nightLabel(this.data().wakeDate));
  protected readonly goalMin = computed(() => this.settings.settings().sleepGoalMin);
  protected readonly lead = computed(() =>
    nightSentence(this.asleepText(), this.data().bedTime, this.data().wakeTime, this.data().stageRows),
  );
  protected readonly indexLabels = computed(() => {
    const range = this.data().indexRange;
    return range ? { low: String(Math.round(range.low)), high: String(Math.round(range.high)) } : null;
  });
  protected readonly zone = computed(() => zoneForScore(this.data().value));
  protected readonly regularityZone = computed(() => zoneForScore(this.data().regularity.score));
  protected readonly regularityTrend = computed(() => this.data().regularityHistory.slice(-30));

  private readonly asleep = computed(() => asleepMinutes(this.data().segments));

  protected readonly asleepText = computed(() => formatHoursMinutes(this.asleep()));
  protected readonly bedText = computed(() => formatHoursMinutes(inBedMinutes(this.data().segments)));
  protected readonly debtText = computed(() => formatHoursMinutes(this.data().debtMin));
  protected readonly verdict = computed(() => {
    const goal = this.settings.settings().sleepGoalMin;
    const missing = goal - this.asleep();
    return missing > 0
      ? `Hai dormito ${formatHoursMinutes(missing)} meno del tuo obiettivo di ${formatHoursMinutes(goal)}.`
      : `Hai raggiunto il tuo obiettivo di ${formatHoursMinutes(goal)}.`;
  });

  /** I segnali dell'indice: la riga Durata cita l'obiettivo scelto in Impostazioni. */
  protected readonly signals = computed(() =>
    this.data().signals.map((signal) =>
      signal.id === 'sleep-duration'
        ? { ...signal, baselineText: `Il tuo obiettivo: ${formatHoursMinutes(this.settings.settings().sleepGoalMin)}` }
        : signal,
    ),
  );

  protected readonly stages = computed(() => {
    const totals = totalsByStage(this.data().segments);
    const asleep = this.asleep();
    const bed = inBedMinutes(this.data().segments);
    return STAGE_LIST.map(({ stage, name, glossary }) => {
      const entry: { fullName?: string; help: string } = GLOSSARY[glossary];
      const minutes = totals[stage];
      const base = stage === 'awake' ? bed : asleep;
      return {
        stage,
        name,
        fullName: entry.fullName,
        help: entry.help,
        time: formatHoursMinutes(minutes),
        percent: Math.round((minutes / base) * 100),
      };
    });
  });

  protected percent(weight: number): number {
    return Math.round(weight * 100);
  }
}
