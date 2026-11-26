import { Component, computed, input, output, signal } from '@angular/core';
import { IonModal } from '@ionic/angular';
import { DayCalendarComponent } from './day-calendar.component';
import { dateText } from './day-calendar';
import { dayName } from './day-history';

const ROME_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' });

/**
 * Le frecce per tornare ai giorni passati di un dettaglio e rivenire avanti, con la data in mezzo: toccandola si apre il
 * calendario del mese (docs/adr/0032). `days` sono i giorni che la pagina sa mostrare, dal più vecchio; `selected` è
 * quello mostrato (`null` = il più recente). Con un giorno solo non compare.
 */
@Component({
  selector: 'app-day-picker',
  imports: [IonModal, DayCalendarComponent],
  styles: `
    :host {
      display: block;
    }
    .picker {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }
    .step {
      flex: none;
      display: grid;
      place-items: center;
      width: 44px;
      height: 44px;
      border: 1px solid var(--rl-chip-border);
      border-radius: var(--rl-radius-control);
      background: none;
      color: var(--rl-text);

      &:disabled {
        color: var(--rl-muted);
        opacity: 0.4;
      }

      svg {
        width: 20px;
        height: 20px;
        fill: none;
        stroke: currentColor;
        stroke-width: 2;
        stroke-linecap: round;
        stroke-linejoin: round;
      }
    }
    .open {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 2px;
      min-height: 44px;
      padding: 4px 8px;
      border: 0;
      border-radius: var(--rl-radius-control);
      background: none;
      color: var(--rl-text);
      font: inherit;

      &:focus-visible {
        outline: 2px solid var(--rl-text);
        outline-offset: 2px;
      }
    }
    .date {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 15px;
      font-weight: 600;
      line-height: 20px;

      svg {
        flex: none;
        width: 16px;
        height: 16px;
        fill: none;
        stroke: currentColor;
        stroke-width: 1.8;
        stroke-linecap: round;
        stroke-linejoin: round;
      }
    }
    .label {
      font-size: 13px;
      line-height: 18px;
      color: var(--rl-text-2);
      text-align: center;
    }
    .latest {
      display: block;
      margin: 4px auto 0;
      min-height: 44px;
      padding: 0 12px;
      border: 0;
      background: none;
      color: var(--rl-text-2);
      font: inherit;
      font-size: 14px;
      text-decoration: underline;
    }
    ion-modal.day-sheet {
      --width: 100%;
      --height: auto;
      --border-radius: var(--rl-radius-sheet) var(--rl-radius-sheet) 0 0;
      --background: var(--rl-surface);
      align-items: flex-end;
    }
    .sheet {
      position: relative;
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      gap: 16px;
      padding: 22px var(--rl-gutter) 34px;
      background: var(--rl-surface);
      color: var(--rl-text);

      &::before {
        content: '';
        position: absolute;
        top: 10px;
        left: 50%;
        width: 36px;
        height: 4px;
        margin-left: -18px;
        border-radius: 2px;
        background: var(--rl-usual);
      }

      h2 {
        margin: 0;
        font-size: 20px;
        font-weight: 600;
      }

      .hint {
        margin: -8px 0 0;
        font-size: 15px;
        line-height: 20px;
        color: var(--rl-text-2);
      }

      .close {
        min-height: 48px;
        border: 1px solid var(--rl-chip-border);
        border-radius: var(--rl-radius-control);
        background: none;
        color: var(--rl-text);
        font: inherit;
        font-size: 17px;
      }
    }
  `,
  template: `
    @if (days().length > 1) {
      <nav class="picker" aria-label="Giorno mostrato">
        <button type="button" class="step" [disabled]="previous() === undefined" aria-label="Giorno precedente" (click)="go(previous())">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6"></path></svg>
        </button>
        <button type="button" class="open" aria-haspopup="dialog" (click)="open.set(true)">
          <span class="date" aria-live="polite">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <rect x="4" y="5" width="16" height="15" rx="2"></rect>
              <path d="M4 10h16M9 3v4M15 3v4"></path>
            </svg>
            {{ date() }}
          </span>
          @if (label(); as text) {
            <span class="label">{{ text }}</span>
          }
        </button>
        <button type="button" class="step" [disabled]="next() === undefined" aria-label="Giorno successivo" (click)="go(next())">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"></path></svg>
        </button>
      </nav>
      @if (selected() !== null) {
        <button type="button" class="latest" (click)="changed.emit(null)">Torna al più recente</button>
      }

      <ion-modal class="day-sheet" [isOpen]="open()" (didDismiss)="open.set(false)">
        <ng-template>
          <section class="sheet" aria-labelledby="day-sheet-title">
            <h2 id="day-sheet-title">Scegli il giorno</h2>
            <p class="hint">Si aprono i giorni con i dati.</p>
            <app-day-calendar [days]="days()" [selected]="shown()" [today]="today()" (picked)="pick($event)"></app-day-calendar>
            <button type="button" class="close" (click)="open.set(false)">Chiudi</button>
          </section>
        </ng-template>
      </ion-modal>
    }
  `,
})
export class DayPickerComponent {
  readonly days = input.required<readonly string[]>();
  readonly selected = input<string | null>(null);
  /** Una riga sotto la data, se serve: per esempio «Notte da domenica a lunedì». */
  readonly label = input<string | null>(null);
  /** Il giorno scelto; `null` = torna al più recente. */
  readonly changed = output<string | null>();

  /** Il calendario è aperto. */
  protected readonly open = signal(false);

  private readonly index = computed(() => {
    const days = this.days();
    const selected = this.selected();
    const i = selected === null ? -1 : days.indexOf(selected);
    return i < 0 ? days.length - 1 : i;
  });
  /** Il giorno mostrato: quello scelto o il più recente. */
  protected readonly shown = computed(() => this.days()[this.index()]);
  /** «Ieri, mercoledì 18 novembre», «Martedì 17 novembre». */
  protected readonly date = computed(() => {
    const now = new Date();
    const day = this.shown();
    const near = dayName(day, now);
    const text = near === 'oggi' || near === 'ieri' ? `${near}, ${dateText(day, now)}` : dateText(day, now);
    return text.charAt(0).toUpperCase() + text.slice(1);
  });
  protected readonly today = computed(() => ROME_DAY.format(new Date()));
  /** `undefined` = non c'è; `null` = il più recente. */
  protected readonly previous = computed(() => (this.index() > 0 ? this.days()[this.index() - 1] : undefined));
  protected readonly next = computed(() => {
    const days = this.days();
    const i = this.index() + 1;
    if (i >= days.length) {
      return undefined;
    }
    return i === days.length - 1 ? null : days[i];
  });

  protected go(day: string | null | undefined): void {
    if (day !== undefined) {
      this.changed.emit(day);
    }
  }

  /** Un giorno dal calendario: si chiude e si mostra; l'ultimo vale come «il più recente». */
  protected pick(day: string): void {
    this.open.set(false);
    this.changed.emit(day === this.days().at(-1) ? null : day);
  }
}
