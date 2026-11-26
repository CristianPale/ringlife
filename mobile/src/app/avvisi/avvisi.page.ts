import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  IonBackButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonTitle,
  IonToolbar,
} from '@ionic/angular';
import { InfoLinkComponent } from '../guida/info-link.component';
import { dayName } from '../shared/day-history';
import { AlertsService } from './alerts.service';

/**
 * L'elenco degli avvisi (docs/adr/0045), dalla campanella in Oggi: in cima quelli di servizio del telefono, poi quelli
 * del server dal più recente. Aprirlo li segna come visti. Una notifica persa non fa perdere l'avviso.
 */
@Component({
  selector: 'app-avvisi',
  imports: [
    IonHeader,
    IonToolbar,
    IonTitle,
    IonButtons,
    IonBackButton,
    IonContent,
    RouterLink,
    InfoLinkComponent,
  ],
  styleUrl: './avvisi.page.scss',
  template: `
    <ion-header [translucent]="false">
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button defaultHref="/tabs/oggi" text="" aria-label="Indietro"></ion-back-button>
        </ion-buttons>
        <ion-title>Avvisi</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content>
      <main class="page">
        <p class="intro">
          Quando un valore è lontano dal tuo solito, o qualcosa non va con l'anello o il server.
          <app-info topic="avvisi"></app-info>
        </p>

        @if (service().length > 0) {
          <ul class="list" aria-label="Anello e server">
            @for (item of service(); track item.id) {
              <li>
                <a class="row" [routerLink]="item.route" data-level="servizio">
                  <span class="title">{{ item.title }}</span>
                  <span class="body">{{ item.body }}</span>
                </a>
              </li>
            }
          </ul>
        }

        @if (groups().length === 0 && service().length === 0) {
          <p class="empty">Nessun avviso negli ultimi 30 giorni.</p>
        }
        @for (group of groups(); track group.day) {
          <section [attr.aria-labelledby]="'giorno-' + group.day">
            <h2 class="day" [id]="'giorno-' + group.day">{{ group.label }}</h2>
            <ul class="list">
              @for (event of group.events; track event.id) {
                <li>
                  <a
                    class="row"
                    [routerLink]="event.route ?? '/tabs/oggi'"
                    [attr.data-level]="event.level"
                    [class.unseen]="event.unseen"
                  >
                    <span class="title">
                      @if (event.level === 'alto') {
                        <svg viewBox="0 0 16 16" aria-hidden="true">
                          <path d="M8 2.5 14.5 13.5h-13z"></path>
                          <path d="M8 6.5v3.5"></path>
                        </svg>
                      }
                      {{ event.title }}
                    </span>
                    <span class="body">{{ event.body }}</span>
                  </a>
                </li>
              }
            </ul>
          </section>
        }

        <a class="settings" routerLink="/impostazioni/notifiche">Impostazioni degli avvisi</a>
        <p class="disclaimer">
          RingLife non è un dispositivo medico. Gli avvisi confrontano i tuoi valori con il tuo
          solito: non sono diagnosi.
        </p>
      </main>
    </ion-content>
  `,
})
export class AvvisiPage {
  private readonly alerts = inject(AlertsService);
  protected readonly service = this.alerts.service;
  /** Quelli non visti all'apertura restano evidenziati finché la pagina è aperta. */
  private readonly unseenAtOpen = new Set(
    this.alerts
      .events()
      .filter((e) => e.seenAt === null)
      .map((e) => e.id),
  );

  protected readonly groups = computed(() => {
    const now = new Date();
    const byDay = new Map<
      string,
      {
        id: string;
        title: string;
        body: string;
        route: string | null;
        level: string;
        unseen: boolean;
      }[]
    >();
    for (const e of this.alerts.events()) {
      const list = byDay.get(e.day) ?? [];
      list.push({
        id: e.id,
        title: e.title,
        body: e.body,
        route: e.route,
        level: e.level,
        unseen: this.unseenAtOpen.has(e.id),
      });
      byDay.set(e.day, list);
    }
    return [...byDay.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([day, events]) => {
        const name = dayName(day, now);
        return { day, label: name.charAt(0).toUpperCase() + name.slice(1), events };
      });
  });

  constructor() {
    void this.alerts.markAllSeen();
  }
}
