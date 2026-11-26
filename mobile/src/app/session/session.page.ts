import { Component, DestroyRef, computed, inject, input, signal } from '@angular/core';
import { IonBackButton, IonButtons, IonContent, IonHeader, IonToolbar } from '@ionic/angular';
import { RouterLink } from '@angular/router';
import { InfoLinkComponent } from '../guida/info-link.component';
import { LogoComponent } from '../brand/logo.component';
import { HrChartComponent } from '../shared/hr-chart.component';
import { ChipGroupComponent } from '../shared/chip-group.component';
import { estimatedMaxHr } from '../indici/cardio';
import { SettingsService } from '../settings/settings.service';
import { HR_ZONES, zoneLabel, zoneOf } from './hr-zones';
import { LiveSessionService } from './live-session.service';
import { SessionHistoryService } from './session-history.service';
import { ZoneTimesComponent } from './zone-times.component';
import {
  SessionMode,
  breathPhase,
  formatElapsed,
  normalizeSessionMode,
  sessionStats,
} from './session.model';
import {
  ACTIVITIES,
  Activity,
  RECOVERY_MS,
  activityLabel,
  isActivity,
  recoveryText,
  targetStanding,
  targetText,
} from './training';

/** Le scelte della zona obiettivo: nessuna o una delle cinque. */
const TARGET_OPTIONS = [
  { code: 'none', label: 'Nessuna' },
  ...HR_ZONES.map((z) => ({ code: String(z.zone), label: String(z.zone) })),
];

/**
 * Sessione a schermo intero (docs/adr/0024, docs/adr/0042): la respirazione guidata con il battito dal vivo, o
 * l'allenamento con attività, zona obiettivo, pausa, recupero del battito e calorie. Uscendo dalla pagina la sessione si
 * ferma e l'anello si scollega.
 */
@Component({
  selector: 'app-session',
  imports: [
    InfoLinkComponent,
    IonHeader,
    IonToolbar,
    IonButtons,
    IonBackButton,
    IonContent,
    LogoComponent,
    HrChartComponent,
    RouterLink,
    ZoneTimesComponent,
    ChipGroupComponent,
  ],
  styleUrl: './session.page.scss',
  template: `
    <ion-header [translucent]="false">
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button
            defaultHref="/tabs/corpo"
            text=""
            aria-label="Indietro"
          ></ion-back-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>
    <ion-content>
      <main class="page">
        <h1>
          {{ breathing() ? 'Respirazione guidata' : 'Allenamento' }}
          <app-info [topic]="breathing() ? 'respirazione' : 'allenamento'"></app-info>
        </h1>

        @switch (live.status()) {
          @case ('idle') {
            @if (breathing()) {
              <p>
                Respira seguendo il cerchio: 4 secondi dentro, 6 fuori. Accanto vedi il tuo battito,
                che di solito scende mentre l'espirazione si allunga.
              </p>
            } @else {
              <p>
                Il battito dal vivo, la zona d'intensità e alla fine quanto scende in un minuto.
              </p>
              <div class="choice">
                <p class="choice-label" id="attivita">Attività</p>
                <app-chip-group
                  label="Attività"
                  [options]="activities"
                  [selected]="[activity()]"
                  (changed)="chooseActivity($event)"
                ></app-chip-group>
              </div>
              @if (maxHr()) {
                <div class="choice">
                  <p class="choice-label">Zona obiettivo</p>
                  <app-chip-group
                    label="Zona obiettivo"
                    [options]="targetOptions"
                    [selected]="[target() === null ? 'none' : '' + target()]"
                    (changed)="chooseTarget($event)"
                  ></app-chip-group>
                  @if (target(); as t) {
                    <p class="hint">
                      {{ zoneText(t) }}, da {{ bounds()[t - 1].from }} a
                      {{ bounds()[t - 1].to }} battiti al minuto.
                    </p>
                  }
                </div>
              } @else {
                <p class="hint">
                  Per le zone del battito serve l'anno di nascita, in Impostazioni › Profilo.
                </p>
              }
            }
            <p class="hint">Tieni l'anello al dito. Il battito compare dopo qualche secondo.</p>
            <button type="button" class="button primary" (click)="start()">Inizia</button>
          }
          @case ('connecting') {
            <div class="wait" role="status">
              <app-logo [size]="48" [animated]="true"></app-logo>
              <p>Collego l'anello…</p>
            </div>
          }
          @case ('error') {
            <p class="error" role="alert">{{ live.error() }}</p>
            <button type="button" class="button primary" (click)="start()">Riprova</button>
          }
          @case ('recovering') {
            <h2>Recupero del battito</h2>
            <p>Resta fermo, in piedi o seduto: misuro quanto scende il battito in un minuto.</p>
            <div class="reading" role="status">
              @if (live.bpm(); as bpm) {
                <span class="bpm">{{ bpm }}</span>
                <span class="unit">battiti al minuto</span>
              }
            </div>
            <p class="elapsed" aria-live="off">{{ recoveryLeft() }} s</p>
            <button type="button" class="button" (click)="skip()">Salta</button>
          }
          @case ('ended') {
            <h2>Riepilogo</h2>
            <dl class="stats">
              @if (!breathing()) {
                <div>
                  <dt>Attività</dt>
                  <dd class="word">{{ activityName() }}</dd>
                </div>
              }
              <div>
                <dt>Durata</dt>
                <dd>{{ elapsedText() }}</dd>
              </div>
              @if (stats(); as s) {
                @if (breathing()) {
                  <div>
                    <dt>Battito all'inizio</dt>
                    <dd>{{ s.start }} <small>battiti al minuto</small></dd>
                  </div>
                  <div>
                    <dt>Battito alla fine</dt>
                    <dd>{{ s.end }} <small>battiti al minuto</small></dd>
                  </div>
                } @else {
                  <div>
                    <dt>Battito medio</dt>
                    <dd>{{ s.avg }} <small>battiti al minuto</small></dd>
                  </div>
                  <div>
                    <dt>Battito massimo</dt>
                    <dd>{{ s.max }} <small>battiti al minuto</small></dd>
                  </div>
                  @if (live.kcal() !== null) {
                    <div>
                      <dt>Calorie, stima</dt>
                      <dd>{{ live.kcal() }} <small>kcal</small></dd>
                    </div>
                  }
                }
              } @else {
                <div>
                  <dt>Battito</dt>
                  <dd>Nessun valore ricevuto</dd>
                </div>
              }
            </dl>
            @if (!breathing() && stats()) {
              @if (live.recovery(); as r) {
                <p class="recovery"><strong>Recupero del battito.</strong> {{ recovery(r) }}</p>
              } @else {
                <p class="hint">Recupero del battito non misurato.</p>
              }
              @if (live.kcal() === null) {
                <p class="hint">
                  Per le calorie servono anno di nascita e peso, in Impostazioni › Profilo.
                </p>
              }
            }
            @if (live.samples().length > 1) {
              <app-hr-chart [points]="live.samples()" [interactive]="true"></app-hr-chart>
              <p class="hint">Tocca o trascina sul grafico per leggere minuto e battito.</p>
            }
            @if (!breathing() && live.samples().length > 0) {
              <h2>Tempo nelle zone <app-info topic="zone-battito"></app-info></h2>
              @if (maxHr(); as max) {
                <app-zone-times [samples]="live.samples()" [maxHr]="max"></app-zone-times>
              } @else {
                <p class="hint">
                  Per le zone del battito serve l'anno di nascita, in Impostazioni › Profilo.
                </p>
              }
            }
            <div class="actions">
              <button type="button" class="button primary" (click)="restart()">Ricomincia</button>
              <a class="button" routerLink="/sessioni">Storico</a>
            </div>
          }
          @default {
            <!-- waiting / live / paused -->
            @if (breathing()) {
              <div class="breath" [attr.data-phase]="phase().phase" aria-live="polite">
                <div
                  class="circle"
                  [style.transform]="
                    reduceMotion ? null : 'scale(' + (0.55 + 0.45 * phase().openness) + ')'
                  "
                ></div>
                <p class="phase">
                  {{ phase().phase === 'inspira' ? 'Inspira' : 'Espira' }}
                  <span class="count">{{ phase().remaining }}</span>
                </p>
              </div>
            } @else {
              <p class="activity">{{ activityName() }}</p>
            }
            <div class="reading" role="status">
              @if (live.status() === 'paused') {
                <span class="paused">In pausa</span>
              } @else if (live.bpm(); as bpm) {
                <span class="bpm">{{ bpm }}</span>
                <span class="unit">battiti al minuto</span>
              } @else {
                <span class="hint">Aggancio il battito…</span>
              }
            </div>
            @if (!breathing() && live.status() !== 'paused') {
              @if (maxHr(); as max) {
                @if (live.bpm(); as bpm) {
                  <div class="zone-now">
                    <p class="zone-label">{{ zoneText(zoneAt(bpm, max)) }}</p>
                    <div class="zone-strip" aria-hidden="true">
                      @for (z of zones; track z.zone) {
                        <span
                          [class.is-on]="z.zone === zoneAt(bpm, max)"
                          [class.is-target]="z.zone === live.options()?.targetZone"
                        ></span>
                      }
                    </div>
                    @if (standing(); as st) {
                      <p
                        class="target"
                        [attr.data-tone]="st === 'dentro' ? null : 'peggio'"
                        aria-live="polite"
                      >
                        @if (st !== 'dentro') {
                          <svg viewBox="0 0 16 16" aria-hidden="true">
                            <path d="M8 2.5 14.5 13.5h-13z"></path>
                            <path d="M8 6.5v3.5"></path>
                          </svg>
                        }
                        {{ targetWords(st) }}
                      </p>
                    }
                  </div>
                }
              } @else {
                <p class="hint">
                  Per le zone del battito serve l'anno di nascita, in Impostazioni › Profilo.
                </p>
              }
            }
            <p class="elapsed">{{ elapsedText() }}</p>
            <app-hr-chart [points]="live.samples()" [live]="true"></app-hr-chart>
            <div class="actions">
              @if (!breathing()) {
                @if (live.status() === 'paused') {
                  <button type="button" class="button primary" (click)="resume()">Riprendi</button>
                } @else {
                  <button type="button" class="button" (click)="pause()">Pausa</button>
                }
              }
              <button type="button" class="button" (click)="finish()">Fine</button>
            </div>
          }
        }

        <p class="disclaimer">
          RingLife non è un dispositivo medico. Battito e calorie sono stime dell'anello, non
          indicazioni mediche.
        </p>
      </main>
    </ion-content>
  `,
})
export class SessionPage {
  protected readonly live = inject(LiveSessionService);
  private readonly history = inject(SessionHistoryService);

  /** Dalla rotta `/sessione/:mode`; `battito` è il vecchio nome dell'allenamento. */
  readonly mode = input<string>('respirazione');
  private readonly currentMode = computed<SessionMode>(
    () => normalizeSessionMode(this.mode()) ?? 'respirazione',
  );
  protected readonly breathing = computed(() => this.currentMode() === 'respirazione');

  protected readonly reduceMotion =
    typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  /** L'orologio della schermata: avanza ogni decimo di secondo durante la sessione. */
  private readonly now = signal(Date.now());
  private readonly timer = setInterval(() => this.now.set(Date.now()), 100);

  protected readonly phase = computed(() =>
    breathPhase(this.now() - (this.live.startedAt() ?? this.now())),
  );
  protected readonly elapsedText = computed(() => formatElapsed(this.live.activeMs(this.now())));
  protected readonly stats = computed(() => sessionStats(this.live.samples()));
  protected readonly recoveryLeft = computed(() => {
    const end = this.live.endedAt();
    return end === null ? 60 : Math.max(0, Math.ceil((RECOVERY_MS - (this.now() - end)) / 1000));
  });

  protected readonly activities = ACTIVITIES;
  protected readonly targetOptions = TARGET_OPTIONS;
  /** Le scelte proposte: quelle dell'ultimo allenamento. */
  protected readonly activity = signal<Activity>(
    this.history.lastTraining()?.activity ?? 'camminata',
  );
  protected readonly target = signal<number | null>(
    this.history.lastTraining()?.targetZone ?? null,
  );
  protected readonly activityName = computed(() =>
    activityLabel(this.live.options()?.activity ?? this.activity()),
  );

  private readonly settings = inject(SettingsService);
  protected readonly zones = HR_ZONES;
  /** Il battito massimo stimato dall'età del profilo (docs/adr/0031); senza anno di nascita non ci sono zone. */
  protected readonly maxHr = computed(() => {
    const birthYear = this.settings.settings().profile.birthYear;
    return birthYear === null ? null : estimatedMaxHr(new Date().getFullYear() - birthYear);
  });
  protected readonly bounds = computed(() => {
    const max = this.maxHr() ?? 0;
    return HR_ZONES.map((z) => ({ from: Math.round(z.from * max), to: Math.round(z.to * max) }));
  });
  protected readonly zoneAt = zoneOf;
  /** Dove sta il battito rispetto alla zona obiettivo, se c'è. */
  protected readonly standing = computed(() => {
    const target = this.live.options()?.targetZone ?? null;
    const bpm = this.live.bpm();
    const max = this.maxHr();
    return target === null || bpm === null || max === null
      ? null
      : targetStanding(bpm, max, target);
  });

  protected zoneText(zone: number): string {
    return zoneLabel(zone);
  }

  protected targetWords = targetText;
  protected recovery = recoveryText;

  constructor() {
    this.live.reset();
    inject(DestroyRef).onDestroy(() => {
      clearInterval(this.timer);
      // Uscendo si ferma sempre: l'anello deve tornare libero.
      void this.live.stop();
    });
  }

  protected chooseActivity(codes: string[]): void {
    // Una sola scelta, sempre: un secondo tocco sulla stessa non la toglie.
    if (isActivity(codes[0])) {
      this.activity.set(codes[0]);
    }
  }

  protected chooseTarget(codes: string[]): void {
    const zone = Number(codes[0]);
    this.target.set(Number.isInteger(zone) && zone >= 1 && zone <= 5 ? zone : null);
  }

  protected start(): void {
    const options = this.breathing()
      ? null
      : { activity: this.activity(), targetZone: this.maxHr() ? this.target() : null };
    void this.live.start(this.currentMode(), Date.now, options);
  }

  protected pause(): void {
    void this.live.pause();
  }

  protected resume(): void {
    void this.live.resume();
  }

  protected finish(): void {
    void this.live.finish();
  }

  protected skip(): void {
    void this.live.skipRecovery();
  }

  protected restart(): void {
    this.live.reset();
    this.start();
  }
}
