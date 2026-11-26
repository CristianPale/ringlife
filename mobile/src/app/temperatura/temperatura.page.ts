import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IonBackButton, IonButtons, IonContent, IonHeader, IonTitle, IonToolbar } from '@ionic/angular';
import { DaysService } from '../api/days.service';
import { formatSignedTemperature } from '../andamento/andamento.model';
import { MeasureControlComponent } from '../misura/measure-control.component';
import { RingSyncService } from '../ring/ring-sync.service';
import { TemperatureLogService } from '../ring/temperature-log.service';
import { SettingsService } from '../settings/settings.service';
import { dayName } from '../shared/day-history';
import { celsiusText, dayChart, romeDay, temperatureDay, timeText } from './temperatura.model';
import { InfoLinkComponent } from '../guida/info-link.component';

const CHART_W = 340;
const CHART_H = 120;

/**
 * Temperatura (docs/adr/0033): l'ultima misura dell'anello, le misure di oggi ogni 30 minuti, lo scostamento della
 * notte dalla tua media e «Misura ora», che fa misurare l'anello adesso (circa 30 secondi). È la stima dell'anello dalla
 * pelle del dito, non la misura di un termometro.
 */
@Component({
  selector: 'app-temperatura',
  imports: [InfoLinkComponent, IonHeader, IonToolbar, IonTitle, IonButtons, IonBackButton, IonContent, RouterLink, MeasureControlComponent],
  styleUrl: './temperatura.page.scss',
  template: `
    <ion-header [translucent]="false">
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button defaultHref="/tabs/oggi" text="" aria-label="Indietro a Oggi"></ion-back-button>
        </ion-buttons>
        <ion-title>Temperatura</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content>
      <main class="page">
        @if (latest(); as last) {
          <section class="hero" aria-label="Ultima misura">
            <p class="eyebrow">Ultima misura dell'anello</p>
            <p class="value"><span class="number">{{ celsius(last.celsius) }}</span> <span class="unit">°C</span></p>
            <p class="when">{{ lastWhen() }}</p>
          </section>
        } @else {
          <section class="hero" aria-label="Ultima misura">
            <p class="eyebrow">Nessuna misura ancora</p>
            <p class="plain">
              @if (temperatureOn()) {
                L'anello la misura da solo ogni 30 minuti mentre lo porti e compare qui dopo la prossima lettura. Per
                averla adesso tocca «Misura ora».
              } @else {
                La misura automatica della temperatura è spenta. Accendila in Impostazioni › Anello, oppure tocca
                «Misura ora».
              }
            </p>
          </section>
        }

        <div class="read">
          <app-measure-control kind="temperature"></app-measure-control>
          <p class="hint">
            @if (ringSync.measuring() === 'temperature') {
              Tieni l'anello al dito e la mano ferma: la misura dura circa 30 secondi.
            } @else {
              L'anello misura adesso la temperatura del dito, in circa 30 secondi. Da solo ne prende una ogni 30 minuti
              mentre lo porti.
            }
          </p>
        </div>

        @if (today(); as day) {
          <section aria-labelledby="oggi">
            <h2 id="oggi" class="section-title">Oggi</h2>
            <svg class="chart" [attr.viewBox]="'0 0 ' + chartW + ' ' + chartH" role="img" [attr.aria-label]="chartSummary()">
              <polyline class="line" [attr.points]="chart()!.line"></polyline>
              @for (p of chart()!.points; track $index) {
                <circle class="dot" [attr.cx]="p.x" [attr.cy]="p.y" r="2.5"></circle>
              }
            </svg>
            <div class="axis" aria-hidden="true"><span>00</span><span>06</span><span>12</span><span>18</span><span>24</span></div>
            <ul class="facts">
              <li><span>Misure di oggi</span><strong>{{ day.readings.length }}</strong></li>
              <li><span>La più bassa</span><strong>{{ celsius(day.min.celsius) }} °C alle {{ time(day.min.ts) }}</strong></li>
              <li><span>La più alta</span><strong>{{ celsius(day.max.celsius) }} °C alle {{ time(day.max.ts) }}</strong></li>
            </ul>
          </section>
        }

        @if (nightDeviation(); as deviation) {
          <section aria-labelledby="notte">
            <h2 id="notte" class="section-title">Stanotte <app-info topic="temperatura"></app-info></h2>
            <p class="plain">
              <strong>{{ deviation }}</strong> rispetto alla tua media notturna. Per gli indici conta questo scostamento:
              un aumento può indicare fatica o malessere in arrivo.
            </p>
            <a class="link" routerLink="/tabs/andamento">Andamento della temperatura notturna</a>
          </section>
        }

        <p class="disclaimer">
          È la temperatura che l'anello stima dalla pelle del dito: segue bene i cambiamenti, ma non è la misura di un
          termometro. Per la febbre usa un termometro. RingLife non è un dispositivo medico.
        </p>
      </main>
    </ion-content>
  `,
})
export class TemperaturaPage {
  private readonly log = inject(TemperatureLogService);
  private readonly days = inject(DaysService);
  private readonly settings = inject(SettingsService);
  protected readonly ringSync = inject(RingSyncService);

  protected readonly chartW = CHART_W;
  protected readonly chartH = CHART_H;
  protected readonly latest = this.log.latest;
  protected readonly temperatureOn = computed(() => this.settings.settings().ring.temperature);

  protected readonly lastWhen = computed(() => {
    const last = this.latest();
    if (!last) {
      return '';
    }
    const when = `${dayName(romeDay(last.ts), new Date())} alle ${timeText(last.ts)}`.replace(/^./, (c) => c.toUpperCase());
    return last.manual ? `${when}, misura a comando` : when;
  });
  protected readonly today = computed(() => temperatureDay(this.log.readings(), romeDay(Date.now())));
  protected readonly chart = computed(() => {
    const day = this.today();
    return day ? dayChart(day, CHART_W, CHART_H) : null;
  });
  protected readonly chartSummary = computed(() => {
    const day = this.today();
    return day
      ? `Temperatura di oggi, ${day.readings.length} misure: da ${celsiusText(day.min.celsius)} a ${celsiusText(day.max.celsius)} gradi`
      : '';
  });
  /** Lo scostamento della notte più recente dalla tua media, dal server. */
  protected readonly nightDeviation = computed(() => {
    const all = this.days.days();
    for (let i = all.length - 1; i >= 0; i--) {
      const value = all[i].metrics['temp_deviation']?.value;
      if (typeof value === 'number') {
        return formatSignedTemperature(value);
      }
    }
    return null;
  });

  protected celsius(value: number): string {
    return celsiusText(value);
  }

  protected time(ts: number): string {
    return timeText(ts);
  }
}
