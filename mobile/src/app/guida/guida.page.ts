import { Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  IonBackButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonTitle,
  IonToolbar,
} from '@ionic/angular';
import { GUIDE_GROUPS, guideGroup, guideTopic } from './guide';

/**
 * La Guida (docs/adr/0040). Senza argomento (`/guida`) è l'elenco di tutte le pagine, per gruppo; con un argomento
 * (`/guida/<id>`) è la pagina che lo spiega, con i rimandi alle pagine vicine. Si apre dai pulsanti «i» e da
 * Impostazioni. L'id arriva dall'indirizzo come input del componente.
 */
@Component({
  selector: 'app-guida',
  imports: [IonHeader, IonToolbar, IonTitle, IonButtons, IonBackButton, IonContent, RouterLink],
  styleUrl: './guida.page.scss',
  template: `
    <ion-header [translucent]="false">
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button
            [defaultHref]="topic() ? '/guida' : '/tabs/oggi'"
            text=""
            [attr.aria-label]="topic() ? 'Indietro' : 'Indietro a Oggi'"
          ></ion-back-button>
        </ion-buttons>
        <ion-title>Guida</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content>
      <main class="page">
        @if (topic(); as id) {
          @if (page(); as p) {
            <h1>{{ p.title }}</h1>
            <p class="lead">{{ p.lead }}</p>
            @for (section of p.sections; track $index) {
              <section>
                @if (section.heading) {
                  <h2>{{ section.heading }}</h2>
                }
                @for (paragraph of section.paragraphs; track $index) {
                  <p>{{ paragraph }}</p>
                }
              </section>
            }
            @if (related().length > 0) {
              <section aria-labelledby="vedi-anche">
                <h2 id="vedi-anche" class="group-title">Vedi anche</h2>
                <ul class="topics">
                  @for (item of related(); track item.id) {
                    <li>
                      <a class="topic-link" [routerLink]="['/guida', item.id]">
                        <span class="topic-text">
                          <span class="topic-title">{{ item.title }}</span>
                        </span>
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path d="M9 6l6 6-6 6"></path>
                        </svg>
                      </a>
                    </li>
                  }
                </ul>
              </section>
            }
            <a class="all" routerLink="/guida">Tutta la guida</a>
          } @else {
            <h1>Pagina non trovata</h1>
            <p>Questa pagina della guida non c'è.</p>
            <a class="all" routerLink="/guida">Tutta la guida</a>
          }
        } @else {
          <p class="intro">
            Che cosa vuol dire ogni numero dell'app, come si calcola e da dove vengono i dati.
          </p>
          @for (group of groups; track group.id) {
            <section [attr.aria-labelledby]="'gruppo-' + group.id">
              <h2 class="group-title" [id]="'gruppo-' + group.id">{{ group.title }}</h2>
              <ul class="topics">
                @for (item of group.topics; track item.id) {
                  <li>
                    <a class="topic-link" [routerLink]="['/guida', item.id]">
                      <span class="topic-text">
                        <span class="topic-title">{{ item.title }}</span>
                        <span class="topic-lead">{{ item.lead }}</span>
                      </span>
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M9 6l6 6-6 6"></path>
                      </svg>
                    </a>
                  </li>
                }
              </ul>
            </section>
          }
        }
        <p class="disclaimer">
          RingLife non è un dispositivo medico. Stime e suggerimenti non sono diagnosi.
        </p>
      </main>
    </ion-content>
  `,
})
export class GuidaPage {
  /** L'argomento, dall'indirizzo `/guida/<id>`. Senza, si vede l'elenco. */
  readonly topic = input<string | undefined>(undefined);

  protected readonly page = computed(() => {
    const id = this.topic();
    return id ? guideTopic(id) : null;
  });

  protected readonly related = computed(() =>
    (this.page()?.related ?? [])
      .map((id) => guideTopic(id))
      .filter((item): item is NonNullable<typeof item> => item !== null),
  );

  protected readonly groups = GUIDE_GROUPS.map((group) => ({
    ...group,
    topics: guideGroup(group.id),
  }));
}
