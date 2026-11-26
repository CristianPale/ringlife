import { Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { DaysService } from '../api/days.service';
import { shiftDay } from '../shared/day-history';
import { NoDataComponent } from '../shared/no-data.component';
import { IonContent } from '@ionic/angular';
import { GLOSSARY } from '../indici/glossary';
import { CARDIO_AGE_MAX, CARDIO_AGE_MIN, MIN_RESTING_NIGHTS, estimateCardio } from '../indici/cardio';
import { SettingsService } from '../settings/settings.service';
import { formatThousands } from '../shared/format';
import { ChipGroupComponent, ChipOption } from '../shared/chip-group.component';
import { formatHoursMinutes } from '../sonno/sonno.model';
import {
  PERIODS,
  Period,
  activeHours,
  average,
  BASELINE_DAYS,
  compareTotals,
  comparePeriods,
  formatSignedTemperature,
  isOutside,
  normalBand,
} from './andamento.model';
import { ANDAMENTO_DATA } from './andamento.data';
import { BandChartComponent } from './band-chart.component';
import { HourlyStepsComponent } from './hourly-steps.component';
import { InfoLinkComponent } from '../guida/info-link.component';
import { RouterLink } from '@angular/router';
import { PluginCardComponent } from '../plugins/plugin-card.component';
import { PluginCard } from '../plugins/plugin.model';
import { PluginGroup, PluginsService } from '../plugins/plugins.service';
import { GuideTopicId, PLUGIN_GUIDE } from '../guida/guide';

const PERIOD_OPTIONS: readonly ChipOption[] = PERIODS.map((p) => ({ code: String(p), label: `${p} giorni` }));

type Domain = 'recupero' | 'sonno' | 'movimento' | 'stress';

interface ChartMetric {
  id: string;
  title: string;
  fullName?: string;
  help: string;
  domain: 'recupero' | 'sonno';
  /** Dove si apre un giorno della serie: la scheda Sonno o il dettaglio Recupero. */
  target: 'sonno' | 'recupero';
  values: readonly number[];
  format: (value: number) => string;
  /** Testo sulla tua media; assente se non ha senso (la temperatura è già uno scostamento). */
  baseline?: (average: string) => string;
}

const DAY_KEY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' });

function formatDay(date: Date): string {
  return new Intl.DateTimeFormat('it-IT', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'Europe/Rome',
  }).format(date);
}

function deltaWord(delta: number, more: string, less: string): string {
  return delta > 0 ? more : less;
}

/**
 * Scheda Andamento: la tendenza. Confronto con il periodo precedente, quattro segnali con la tua fascia
 * normale e i passi di ieri ora per ora. Per ora usa dati sintetici.
 */
@Component({
  selector: 'app-andamento',
  imports: [
    InfoLinkComponent,
    RouterLink,
    PluginCardComponent,
    NoDataComponent,IonContent, ChipGroupComponent, BandChartComponent, HourlyStepsComponent],
  styleUrl: './andamento.page.scss',
  template: `
    <ion-content [fullscreen]="true">
      @if (hasData()) {
      <main class="page">
        <header class="header">
          <h1 class="title">Andamento</h1>
          @if (data().source === 'esempio') {
            <p class="sample-note">Dati d'esempio. Collega il telefono a un server in Impostazioni per vedere i tuoi.</p>
          }
        </header>

        <app-chip-group
          variant="segment"
          label="Periodo"
          [options]="periodOptions"
          [selected]="[selectedCode()]"
          (changed)="setPeriod($event)"
        ></app-chip-group>

        <section aria-labelledby="confronto">
          <h2 id="confronto" class="section-title">{{ comparisonTitle() }} <app-info topic="come-leggere"></app-info></h2>
          <div class="compare-grid">
            @for (card of comparison(); track card.id) {
              <article class="compare-card" [attr.data-domain]="card.domain">
                <h3 class="compare-name">{{ card.label }}</h3>
                <p class="compare-value">{{ card.value }}</p>
                <p class="compare-delta">
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    @switch (card.direction) {
                      @case ('up') {
                        <path d="M12 19V5M6 11l6-6 6 6"></path>
                      }
                      @case ('down') {
                        <path d="M12 5v14M6 13l6 6 6-6"></path>
                      }
                      @default {
                        <path d="M5 12h14"></path>
                      }
                    }
                  </svg>
                  {{ card.delta }}
                </p>
              </article>
            }
          </div>
        </section>

        <section aria-labelledby="fascia">
          <h2 id="fascia" class="section-title">Ultimi {{ period() }} giorni</h2>
          <p class="legend">
            La banda grigia è la tua fascia normale, calcolata sugli ultimi {{ baselineDays }} giorni. La linea
            tratteggiata è la tua media.
          </p>
          <div class="charts">
            @for (metric of metrics(); track metric.id) {
              <article class="chart-card">
                <div class="chart-head">
                  <h3 class="chart-title">
                    {{ metric.title }}
                    @if (metric.fullName) {
                      <span class="full-name">{{ metric.fullName }}</span>
                    }
                  </h3>
                  <span class="chart-state" [class.is-out]="metric.outside">
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      @if (metric.outside) {
                        <path d="M12 4l9 16H3z"></path>
                        <path d="M12 10v4"></path>
                      } @else {
                        <path d="M5 12l4 4 10-10"></path>
                      }
                    </svg>
                    {{ metric.outside ? 'Fuori fascia' : 'In fascia' }}
                  </span>
                </div>
                <p class="chart-value">
                  <strong>{{ metric.latest }}</strong>
                  @if (metric.baselineText) {
                    <span> · {{ metric.baselineText }}</span>
                  }
                </p>
                <app-band-chart
                  [values]="metric.shown"
                  [band]="metric.band"
                  [label]="metric.title"
                  [domain]="metric.domain"
                  [dates]="metric.dates"
                  [format]="metric.format"
                  [openable]="metric.openable"
                  (opened)="openDay(metric.target, $event)"
                ></app-band-chart>
                <p class="chart-help">{{ metric.help }}</p>
                <details class="days">
                  <summary>Valori giorno per giorno</summary>
                  <table>
                    <caption class="sr-only">{{ metric.title }}, ultimi {{ period() }} giorni</caption>
                    <thead>
                      <tr>
                        <th scope="col">Giorno</th>
                        <th scope="col">Valore</th>
                        <th scope="col">Fascia</th>
                      </tr>
                    </thead>
                    <tbody>
                      @for (row of metric.rows; track row.label) {
                        <tr>
                          <th scope="row">{{ row.label }}</th>
                          <td>{{ row.value }}</td>
                          <td>{{ row.outside ? 'Fuori' : 'In fascia' }}</td>
                        </tr>
                      }
                    </tbody>
                  </table>
                </details>
              </article>
            }
          </div>
          <p class="note">Un cerchio ambra vuoto indica un valore fuori dalla tua fascia normale. Tocca un punto per leggere quel giorno.</p>
        </section>

        <section aria-labelledby="cuore">
          <h2 id="cuore" class="section-title">Età cardio <app-info topic="eta-cardio"></app-info></h2>
          <article class="chart-card cardio">
            @switch (cardio().kind) {
              @case ('ok') {
                @if (cardioView(); as c) {
                  <p class="chart-value">
                    <strong>{{ c.ageText }}</strong>
                    <span> · {{ c.compare }}</span>
                  </p>
                  <dl class="cardio-rows">
                    <div>
                      <dt>{{ glossary.vo2max.fullName }}</dt>
                      <dd>{{ c.vo2max }} ml/kg/min</dd>
                    </div>
                    <div>
                      <dt>Battito a riposo, mediana di {{ c.nights }} notti</dt>
                      <dd>{{ c.restingHr }} bpm</dd>
                    </div>
                    <div>
                      <dt>Battito massimo stimato dall'età</dt>
                      <dd>{{ c.maxHr }} bpm</dd>
                    </div>
                  </dl>
                  <p class="chart-help">{{ glossary['cardio-age'].help }} {{ glossary.vo2max.help }}</p>
                  <p class="chart-help">
                    Stima grezza da età e battito a riposo, non un test da sforzo. Il battito di notte è più basso di quello
                    da sveglio, quindi la stima tende a essere ottimista. bpm sono i battiti al minuto.
                  </p>
                }
              }
              @case ('no-birth-year') {
                <p class="chart-help">
                  Per stimarla serve l'anno di nascita, in Impostazioni › Profilo. Resta sul tuo telefono.
                </p>
              }
              @case ('few-nights') {
                <p class="chart-help">
                  Servono almeno {{ minNights }} notti con il battito a riposo nelle ultime due settimane. Notti trovate:
                  {{ fewNights() }}.
                </p>
              }
            }
          </article>
        </section>

        <section aria-labelledby="ieri">
          <h2 id="ieri" class="section-title">Movimento di ieri</h2>
          <article class="chart-card" data-domain="movimento">
            <p class="chart-value">
              <strong>{{ stepsYesterday() }} passi</strong>
              <span> · {{ activeHoursYesterday() }} ore attive su 24</span>
            </p>
            <app-hourly-steps [steps]="data().stepsYesterdayByHour"></app-hourly-steps>
            <p class="chart-help">
              Un'ora è attiva se contiene almeno 250 passi. La linea tratteggiata mostra quella soglia.
            </p>
          </article>
        </section>

        @if (weekly().length > 0) {
          <!-- I plugin che cambiano a settimana (docs/adr/0041): le card complete, non solo la sintesi. -->
          <section aria-labelledby="settimane">
            <h2 id="settimane" class="section-title">Le tue settimane</h2>
            @for (group of weekly(); track group.id) {
              <div class="plugin-group" role="group" [attr.aria-label]="group.name">
                <div class="plugin-head">
                  <h3 class="plugin-name">
                    {{ group.name }}
                    @if (guideOf(group.id); as topic) {
                      <app-info [topic]="topic"></app-info>
                    }
                  </h3>
                  <a class="plugin-details" [routerLink]="'/plugin/' + group.id" [attr.aria-label]="'Dettagli di ' + group.name">
                    Dettagli
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"></path></svg>
                  </a>
                </div>
                @for (card of cardsOf(group); track $index) {
                  <app-plugin-card [card]="card"></app-plugin-card>
                }
              </div>
            }
          </section>
        }

        <p class="disclaimer">RingLife non è un dispositivo medico. Stime e suggerimenti non sono diagnosi.</p>
      </main>
      } @else {
        <app-no-data title="Andamento"></app-no-data>
      }
    </ion-content>
  `,
})
export class AndamentoPage {
  private readonly plugins = inject(PluginsService);
  /** I plugin settimanali accesi, con le loro card (docs/adr/0041). */
  protected readonly weekly = this.plugins.weeklyGroups;

  /** La pagina della Guida di un plugin, se c'è. */
  protected guideOf(pluginId: string): GuideTopicId | null {
    return PLUGIN_GUIDE[pluginId] ?? null;
  }

  /** Le card e i commenti come card di testo; le azioni restano nella pagina del plugin. */
  protected cardsOf(group: PluginGroup): PluginCard[] {
    const insights = group.insights.map((i): PluginCard => ({ type: 'text', title: i.title, body: i.text }));
    return [...group.cards, ...insights].filter((c) => c.type !== 'action');
  }

  private readonly source = inject(ANDAMENTO_DATA);
  private readonly settings = inject(SettingsService);
  protected readonly glossary = GLOSSARY;
  protected readonly minNights = MIN_RESTING_NIGHTS;

  /** Età cardio (docs/adr/0031): dal profilo, che resta sul telefono, e dal battito a riposo delle ultime notti. */
  protected readonly cardio = computed(() => {
    const profile = this.settings.settings().profile;
    const data = this.data();
    return estimateCardio(profile.birthYear, profile.sex, data.restingHrRecent ?? data.restingHr.slice(-14), data.today);
  });
  protected readonly fewNights = computed(() => {
    const result = this.cardio();
    return result.kind === 'few-nights' ? result.nights : 0;
  });
  protected readonly cardioView = computed(() => {
    const result = this.cardio();
    if (result.kind !== 'ok') {
      return null;
    }
    const e = result.estimate;
    const ageText =
      e.cardioAge <= CARDIO_AGE_MIN ? `${CARDIO_AGE_MIN} anni o meno` : e.cardioAge >= CARDIO_AGE_MAX ? `${CARDIO_AGE_MAX} anni o più` : `${e.cardioAge} anni`;
    const diff = e.cardioAge - e.age;
    const years = (n: number) => `${n} ${n === 1 ? 'anno' : 'anni'}`;
    // Al limite della tabella la differenza vera può essere più grande: si dice «almeno».
    const atLimit = e.cardioAge <= CARDIO_AGE_MIN || e.cardioAge >= CARDIO_AGE_MAX ? 'almeno ' : '';
    const compare =
      diff === 0 ? 'come la tua età' : diff < 0 ? `${atLimit}${years(-diff)} meno della tua età` : `${atLimit}${years(diff)} più della tua età`;
    return {
      ageText,
      compare,
      vo2max: e.vo2max.toLocaleString('it-IT', { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
      restingHr: e.restingHr,
      nights: e.nights,
      maxHr: e.maxHr,
    };
  });
  /** Il server non ha ancora questo risultato: la pagina dice «nessun dato», mai l'esempio. */
  protected readonly hasData = computed(() => this.source() !== null);
  protected readonly data = computed(() => this.source()!);
  protected readonly periodOptions = PERIOD_OPTIONS;
  protected readonly baselineDays = BASELINE_DAYS;

  protected readonly period = signal<Period>(30);
  protected readonly selectedCode = computed(() => String(this.period()));

  protected readonly comparisonTitle = computed(() =>
    this.period() === 7
      ? 'Questa settimana contro la precedente'
      : `Gli ultimi ${this.period()} giorni contro i ${this.period()} precedenti`,
  );

  protected readonly comparison = computed(() => {
    const days = this.period();
    const d = this.data();
    const cards: {
      id: string;
      label: string;
      domain: Domain;
      value: string;
      delta: string;
      direction: 'up' | 'down' | 'same';
    }[] = [];

    const sleep = comparePeriods(d.sleepMinutes, days);
    if (sleep) {
      const diff = Math.round(sleep.delta);
      cards.push({
        id: 'sleep',
        label: 'Sonno medio',
        domain: 'sonno',
        value: formatHoursMinutes(sleep.current),
        delta:
          diff === 0
            ? 'come il periodo precedente'
            : `${formatHoursMinutes(Math.abs(diff))} ${deltaWord(diff, 'in più', 'in meno')}`,
        direction: diff === 0 ? 'same' : diff > 0 ? 'up' : 'down',
      });
    }

    const recovery = comparePeriods(d.recovery, days);
    if (recovery) {
      const diff = Math.round(recovery.delta);
      cards.push({
        id: 'recovery',
        label: 'Recupero medio',
        domain: 'recupero',
        value: String(Math.round(recovery.current)),
        delta:
          diff === 0
            ? 'come il periodo precedente'
            : `${Math.abs(diff)} ${Math.abs(diff) === 1 ? 'punto' : 'punti'} ${deltaWord(diff, 'in più', 'in meno')}`,
        direction: diff === 0 ? 'same' : diff > 0 ? 'up' : 'down',
      });
    }

    const steps = comparePeriods(d.steps, days);
    if (steps) {
      const diff = Math.round(steps.delta);
      cards.push({
        id: 'steps',
        label: 'Passi al giorno',
        domain: 'movimento',
        value: formatThousands(Math.round(steps.current)),
        delta:
          diff === 0
            ? 'come il periodo precedente'
            : `${formatThousands(Math.abs(diff))} ${deltaWord(diff, 'in più', 'in meno')}`,
        direction: diff === 0 ? 'same' : diff > 0 ? 'up' : 'down',
      });
    }

    const headaches = compareTotals(d.headaches, days);
    if (headaches) {
      const diff = headaches.current - headaches.previous;
      cards.push({
        id: 'headaches',
        label: 'Episodi di cefalea',
        domain: 'stress',
        value: String(headaches.current),
        delta: diff === 0 ? 'come il periodo precedente' : `${Math.abs(diff)} ${deltaWord(diff, 'in più', 'in meno')}`,
        direction: diff === 0 ? 'same' : diff > 0 ? 'up' : 'down',
      });
    }
    return cards;
  });

  private readonly chartMetrics = computed<readonly ChartMetric[]>(() => [
    {
      id: 'hrv',
      title: 'HRV notturna',
      fullName: GLOSSARY.hrv.fullName,
      help: GLOSSARY.hrv.help,
      domain: 'recupero',
      target: 'recupero',
      values: this.data().hrv,
      format: (v) => `${Math.round(v)} ms`,
      baseline: (avg) => `media ${avg}`,
    },
    {
      id: 'rhr',
      title: 'Battito a riposo',
      help: GLOSSARY['hr-riposo'].help,
      domain: 'recupero',
      target: 'recupero',
      values: this.data().restingHr,
      format: (v) => `${Math.round(v)} bpm`,
      baseline: (avg) => `media ${avg}`,
    },
    {
      id: 'temp',
      title: 'Temperatura notturna',
      help: GLOSSARY.temperatura.help,
      domain: 'recupero',
      target: 'recupero',
      values: this.data().temperature,
      format: (v) => formatSignedTemperature(v),
    },
    {
      id: 'sleep',
      title: 'Durata del sonno',
      help: GLOSSARY['sleep-duration'].help,
      domain: 'sonno',
      target: 'sonno',
      values: this.data().sleepMinutes,
      format: (v) => formatHoursMinutes(v),
      baseline: (avg) => `media ${avg}`,
    },
  ]);

  protected readonly metrics = computed(() => {
    const days = this.period();
    const today = this.data().today;
    const end = DAY_KEY.format(today);
    // Una serie vuota (il server non ha ancora quei giorni) non si disegna: niente grafico, niente numeri inventati.
    return this.chartMetrics().filter((metric) => metric.values.length > 0).map((metric) => {
      const band = normalBand(metric.values);
      const shown = metric.values.slice(-days);
      const latest = shown[shown.length - 1];
      const avg = metric.format(average(metric.values.slice(-BASELINE_DAYS)));
      return {
        id: metric.id,
        title: metric.title,
        fullName: metric.fullName,
        help: metric.help,
        domain: metric.domain,
        target: metric.target,
        band,
        shown,
        latest: metric.format(latest),
        baselineText: metric.baseline ? metric.baseline(avg) : null,
        outside: isOutside(latest, band),
        dates: shown.map((_, i) => shiftDay(end, i - (shown.length - 1))),
        format: metric.format,
        openable: this.openable(metric.target),
        rows: [...shown].reverse().map((value, i) => ({
          label: formatDay(new Date(today.getTime() - i * 24 * 60 * 60 * 1000)),
          value: metric.format(value),
          outside: isOutside(value, band),
        })),
      };
    });
  });

  protected readonly stepsYesterday = computed(() =>
    formatThousands(this.data().stepsYesterdayByHour.reduce((sum, v) => sum + v, 0)),
  );
  protected readonly activeHoursYesterday = computed(() => activeHours(this.data().stepsYesterdayByHour));

  private readonly days = inject(DaysService);
  private readonly router = inject(Router, { optional: true });

  /** I giorni che il dettaglio sa mostrare: con i dati d'esempio nessuno. */
  private readonly openableDays = computed(() => {
    if (this.data().source !== 'server') {
      return { sonno: new Set<string>(), recupero: new Set<string>() };
    }
    const all = this.days.days();
    return {
      sonno: new Set(all.filter((d) => d.scores['sleep'] && d.sleep && d.sleep.stages.length > 0).map((d) => d.day)),
      recupero: new Set(all.filter((d) => d.scores['recovery']).map((d) => d.day)),
    };
  });

  private openable(target: 'sonno' | 'recupero'): (day: string) => boolean {
    const set = this.openableDays()[target];
    return (day) => set.has(day);
  }

  /** Un punto di un grafico apre quel giorno nel suo dettaglio. */
  protected openDay(target: 'sonno' | 'recupero', day: string): void {
    void this.router?.navigate([target === 'sonno' ? '/tabs/sonno' : '/indici/recupero'], { queryParams: { giorno: day } });
  }

  protected setPeriod(codes: string[]): void {
    // Gruppo a scelta singola: un secondo tocco sulla voce attiva non deve lasciare la pagina senza periodo.
    if (codes.length > 0) {
      this.period.set(Number(codes[0]) as Period);
    }
  }
}
