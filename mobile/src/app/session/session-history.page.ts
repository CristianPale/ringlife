import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IonBackButton, IonButtons, IonContent, IonHeader, IonToolbar } from '@ionic/angular';
import { SessionHistoryService, sessionDate, sessionSummary } from './session-history.service';
import { sessionName } from './session.model';
import { weeklyMinutes } from './training';
import { WeekMinutesComponent } from './week-minutes.component';

/** Lo storico delle sessioni di battito dal vivo (docs/adr/0024), dal più recente. */
@Component({
  selector: 'app-session-history',
  imports: [IonHeader, IonToolbar, IonButtons, IonBackButton, IonContent, RouterLink, WeekMinutesComponent],
  styleUrl: './session-history.page.scss',
  template: `
    <ion-header [translucent]="false">
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button defaultHref="/tabs/corpo" text="" aria-label="Indietro"></ion-back-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>
    <ion-content>
      <main class="page">
        <h1>Le tue sessioni</h1>
        @if (hasTraining()) {
          <section aria-labelledby="settimane">
            <h2 id="settimane">Minuti di allenamento</h2>
            <app-week-minutes [weeks]="weeks()"></app-week-minutes>
          </section>
        }
        @if (rows().length === 0) {
          <p class="hint">Nessuna sessione ancora. Si avviano dalla scheda Corpo.</p>
        } @else {
          <ul class="list">
            @for (row of rows(); track row.id) {
              <li>
                <a class="row" [routerLink]="['/sessioni', row.id]">
                  <span class="name">{{ row.mode }}</span>
                  <span class="when">{{ row.when }}</span>
                  <span class="summary">{{ row.summary }}</span>
                </a>
              </li>
            }
          </ul>
        }
        <p class="hint">Le sessioni restano su questo telefono e non vanno al server.</p>
      </main>
    </ion-content>
  `,
})
export class SessionHistoryPage {
  private readonly history = inject(SessionHistoryService);
  protected readonly hasTraining = computed(() => this.history.trainings().length > 0);
  protected readonly weeks = computed(() => weeklyMinutes(this.history.trainings(), new Date()));
  protected readonly rows = computed(() =>
    this.history.sessions().map((s) => ({
      id: s.id,
      mode: sessionName(s.mode),
      when: sessionDate(s.start),
      summary: sessionSummary(s),
    })),
  );
}
