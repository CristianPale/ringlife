import { Component, computed, inject, input } from '@angular/core';
import { Router } from '@angular/router';
import { IonBackButton, IonButtons, IonContent, IonHeader, IonToolbar } from '@ionic/angular';
import { HrChartComponent } from '../shared/hr-chart.component';
import { estimatedMaxHr } from '../indici/cardio';
import { SettingsService } from '../settings/settings.service';
import { ZoneTimesComponent } from './zone-times.component';
import { SessionHistoryService, sessionDate } from './session-history.service';
import { formatElapsed, sessionName, sessionStats } from './session.model';
import { activityLabel, recoveryText } from './training';

/** Il dettaglio di una sessione salvata: riepilogo e grafico con minuto e battito al tocco. */
@Component({
  selector: 'app-session-detail',
  imports: [IonHeader, IonToolbar, IonButtons, IonBackButton, IonContent, HrChartComponent, ZoneTimesComponent],
  styleUrl: './session-history.page.scss',
  template: `
    <ion-header [translucent]="false">
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button defaultHref="/sessioni" text="" aria-label="Indietro allo storico"></ion-back-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>
    <ion-content>
      <main class="page">
        @if (session(); as s) {
          <h1>{{ name(s.mode) }}</h1>
          <p class="hint">{{ when() }}</p>
          <dl class="stats">
            @if (s.activity) {
              <div><dt>Attività</dt><dd class="word">{{ activity(s.activity) }}</dd></div>
            }
            <div><dt>Durata</dt><dd>{{ duration() }}</dd></div>
            @if (stats(); as st) {
              @if (s.mode === 'respirazione') {
                <div><dt>Battito all'inizio</dt><dd>{{ st.start }}</dd></div>
                <div><dt>Battito alla fine</dt><dd>{{ st.end }}</dd></div>
              } @else {
                <div><dt>Media</dt><dd>{{ st.avg }}</dd></div>
                <div><dt>Minimo</dt><dd>{{ st.min }}</dd></div>
                <div><dt>Massimo</dt><dd>{{ st.max }}</dd></div>
                @if (s.kcal !== undefined && s.kcal !== null) {
                  <div><dt>Calorie, stima</dt><dd>{{ s.kcal }} <small>kcal</small></dd></div>
                }
              }
            }
          </dl>
          @if (s.recovery; as r) {
            <p class="recovery"><strong>Recupero del battito.</strong> {{ recovery(r) }}</p>
          }
          <app-hr-chart [points]="s.samples" [interactive]="true"></app-hr-chart>
          <p class="hint">Tocca o trascina sul grafico per leggere minuto e battito (battiti al minuto).</p>
          @if (s.mode === 'allenamento' && s.samples.length > 0) {
            <h2>Tempo nelle zone</h2>
            @if (maxHr(); as max) {
              <app-zone-times [samples]="s.samples" [maxHr]="max"></app-zone-times>
            } @else {
              <p class="hint">Per le zone del battito serve l'anno di nascita, in Impostazioni › Profilo.</p>
            }
          }
          <button type="button" class="remove" (click)="remove()">Elimina questa sessione</button>
        } @else {
          <h1>Sessione non trovata</h1>
          <p class="hint">Forse è stata eliminata.</p>
        }
        <p class="hint">RingLife non è un dispositivo medico.</p>
      </main>
    </ion-content>
  `,
})
export class SessionDetailPage {
  private readonly history = inject(SessionHistoryService);
  private readonly router = inject(Router);

  /** Dalla rotta `/sessioni/:id`. */
  readonly id = input('');
  protected readonly session = computed(() => this.history.sessions().find((s) => s.id === this.id()) ?? null);
  protected readonly stats = computed(() => sessionStats(this.session()?.samples ?? []));
  protected readonly when = computed(() => (this.session() ? sessionDate(this.session()!.start) : ''));
  protected readonly name = sessionName;
  protected readonly activity = activityLabel;
  protected readonly recovery = recoveryText;
  protected readonly duration = computed(() => formatElapsed(this.session()?.durationMs ?? 0));
  private readonly settings = inject(SettingsService);
  /** Con l'età di oggi: per una sessione di pochi mesi fa la differenza è al più un battito. */
  protected readonly maxHr = computed(() => {
    const birthYear = this.settings.settings().profile.birthYear;
    return birthYear === null ? null : estimatedMaxHr(new Date().getFullYear() - birthYear);
  });

  protected async remove(): Promise<void> {
    const s = this.session();
    if (s) {
      await this.history.remove(s.id);
      await this.router.navigateByUrl('/sessioni', { replaceUrl: true });
    }
  }
}
