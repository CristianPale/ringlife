import { Component } from '@angular/core';
import { IonTabBar, IonTabButton, IonTabs } from '@ionic/angular';

/** Cinque schede: Oggi, Sonno, Corpo, Diario, Andamento (ADR 0006, ADR 0041). Icone in linea, 24 px. */
@Component({
  selector: 'app-tabs',
  imports: [IonTabs, IonTabBar, IonTabButton],
  styleUrl: './tabs.page.scss',
  template: `
    <ion-tabs>
      <ion-tab-bar slot="bottom" aria-label="Sezioni">
        <ion-tab-button tab="oggi">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="4"></circle>
            <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"></path>
          </svg>
          Oggi
        </ion-tab-button>
        <ion-tab-button tab="sonno">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"></path>
          </svg>
          Sonno
        </ion-tab-button>
        <ion-tab-button tab="corpo">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.4 4.3 4.3 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10z"></path>
            <path d="M4.5 12.5h4l1.5-2.5 2.5 5 1.5-2.5h5.5"></path>
          </svg>
          Corpo
        </ion-tab-button>
        <ion-tab-button tab="diario">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5z"></path>
            <path d="M5 19.5A1.5 1.5 0 0 0 6.5 21H19M9 7h6"></path>
          </svg>
          Diario
        </ion-tab-button>
        <ion-tab-button tab="andamento">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 19h16M5 15l4.5-4.5 3.5 3 6-6.5"></path>
          </svg>
          Andamento
        </ion-tab-button>
      </ion-tab-bar>
    </ion-tabs>
  `,
})
export class TabsPage {}
