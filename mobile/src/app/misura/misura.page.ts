import { Component, inject } from '@angular/core';
import { IonBackButton, IonButtons, IonContent, IonHeader, IonTitle, IonToolbar } from '@ionic/angular';
import { ManualMeasureLogService } from '../ring/manual-measure-log.service';
import { MEASURE_KINDS, MeasureKind } from '../ring/measure.model';
import { MEASURES, MeasureInfo, measureText } from './measure-info';
import { dayName } from '../shared/day-history';
import { romeDay, timeText } from '../temperatura/temperatura.model';
import { MeasureControlComponent } from './measure-control.component';
import { InfoLinkComponent } from '../guida/info-link.component';
import { GuideTopicId } from '../guida/guide';

/** La pagina della Guida di ogni misura. */
const MEASURE_GUIDE: Record<MeasureKind, GuideTopicId> = {
  heartRate: 'battito-oggi',
  spo2: 'ossigeno',
  hrv: 'hrv',
  stress: 'stress',
  temperature: 'temperatura',
};

/**
 * Misura ora (docs/adr/0039): battito, ossigeno, HRV, stress e temperatura misurati adesso dall'anello, uno alla volta,
 * con l'ultima misura a comando di ognuno. Le misure restano sul telefono.
 */
@Component({
  selector: 'app-misura',
  imports: [IonHeader, IonToolbar, IonTitle, IonButtons, IonBackButton, IonContent, MeasureControlComponent, InfoLinkComponent],
  styleUrl: './misura.page.scss',
  template: `
    <ion-header [translucent]="false">
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button defaultHref="/tabs/oggi" text="" aria-label="Indietro a Oggi"></ion-back-button>
        </ion-buttons>
        <ion-title>Misura ora</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content>
      <main class="page">
        <p class="intro">
          L'anello misura adesso, al dito. Tieni la mano ferma e il telefono vicino: una misura alla volta.
          <app-info topic="misura-ora"></app-info>
        </p>
        @for (kind of kinds; track kind) {
          <section class="measure" [attr.aria-labelledby]="'misura-' + kind">
            <h2 class="name" [id]="'misura-' + kind">{{ info(kind).name }} <app-info [topic]="guide[kind]"></app-info></h2>
            <p class="help">{{ info(kind).help }} Dura {{ info(kind).duration }}.</p>
            <p class="last">{{ lastText(kind) }}</p>
            <app-measure-control [kind]="kind" label="Misura"></app-measure-control>
          </section>
        }
        <p class="note">
          Le misure a comando restano sul telefono. Gli indici usano le misure che l'anello fa da solo, di giorno e di
          notte.
        </p>
        <p class="disclaimer">Sono stime dell'anello, non misure cliniche. RingLife non è un dispositivo medico.</p>
      </main>
    </ion-content>
  `,
})
export class MisuraPage {
  private readonly log = inject(ManualMeasureLogService);
  protected readonly kinds = MEASURE_KINDS;
  protected readonly guide = MEASURE_GUIDE;

  protected info(kind: MeasureKind): MeasureInfo {
    return MEASURES[kind];
  }

  protected lastText(kind: MeasureKind): string {
    const last = this.log.measures()[kind];
    if (!last) {
      return 'Nessuna misura a comando ancora.';
    }
    return `Ultima: ${measureText(kind, last.value)}, ${dayName(romeDay(last.ts), new Date()).toLowerCase()} alle ${timeText(last.ts)}.`;
  }
}
