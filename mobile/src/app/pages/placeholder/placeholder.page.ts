import { Component, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { IonBackButton, IonButtons, IonContent, IonHeader, IonTitle, IonToolbar } from '@ionic/angular';

/** Segnaposto per le schermate non ancora costruite. Titolo e freccia indietro arrivano dalla rotta. */
@Component({
  selector: 'app-placeholder',
  imports: [IonHeader, IonToolbar, IonTitle, IonContent, IonButtons, IonBackButton],
  template: `
    <ion-header>
      <ion-toolbar>
        @if (back) {
          <ion-buttons slot="start">
            <ion-back-button defaultHref="/tabs/oggi" text="" aria-label="Indietro a Oggi"></ion-back-button>
          </ion-buttons>
        }
        <ion-title>{{ title }}</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content class="ion-padding">
      <p>Questa schermata arriva nelle prossime fasi.</p>
    </ion-content>
  `,
})
export class PlaceholderPage {
  private readonly route = inject(ActivatedRoute);
  protected readonly title: string = this.route.snapshot.data['title'] ?? '';
  protected readonly back: boolean = this.route.snapshot.data['back'] === true;
}
