import { Component, computed, input, linkedSignal, output } from '@angular/core';
import { dateText, dayNumber, monthOf, monthTitle, monthWeeks, shiftMonth } from './day-calendar';

const WEEKDAYS = ['lun', 'mar', 'mer', 'gio', 'ven', 'sab', 'dom'];

/**
 * Un mese da sfogliare per scegliere un giorno passato (docs/adr/0032). Si toccano solo i giorni che la pagina sa
 * mostrare (`days`); gli altri si vedono spenti. Si sfoglia dal mese del primo giorno a quello dell'ultimo.
 */
@Component({
  selector: 'app-day-calendar',
  styles: `
    :host {
      display: block;
    }
    .month {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      margin-bottom: 8px;
    }
    .title {
      flex: 1;
      margin: 0;
      text-align: center;
      font-size: 17px;
      font-weight: 600;
      color: var(--rl-text);
    }
    .step {
      flex: none;
      display: grid;
      place-items: center;
      width: 44px;
      height: 44px;
      border: 0;
      border-radius: var(--rl-radius-control);
      background: none;
      color: var(--rl-text);

      &:disabled {
        opacity: 0.3;
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
    .grid {
      display: grid;
      grid-template-columns: repeat(7, minmax(0, 1fr));
      row-gap: 4px;
    }
    .weekday {
      padding-bottom: 4px;
      text-align: center;
      font-size: 12px;
      color: var(--rl-muted);
    }
    .day {
      justify-self: center;
      display: grid;
      place-items: center;
      width: 44px;
      height: 44px;
      border: 0;
      border-radius: 50%;
      background: none;
      color: var(--rl-text);
      font-family: var(--rl-font-numbers);
      font-size: 15px;

      &:disabled {
        color: var(--rl-muted);
        opacity: 0.45;
      }

      &.today:not(.chosen) {
        box-shadow: inset 0 0 0 1px var(--rl-chip-border);
      }

      &.chosen {
        background: var(--rl-text);
        color: var(--rl-bg);
        font-weight: 600;
      }

      &:focus-visible {
        outline: 2px solid var(--rl-text);
        outline-offset: 2px;
      }
    }
  `,
  template: `
    <div class="month">
      <button type="button" class="step" [disabled]="!canGoBack()" aria-label="Mese precedente" (click)="month.set(shift(-1))">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6"></path></svg>
      </button>
      <h3 class="title" aria-live="polite">{{ title() }}</h3>
      <button type="button" class="step" [disabled]="!canGoForward()" aria-label="Mese successivo" (click)="month.set(shift(1))">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"></path></svg>
      </button>
    </div>
    <div class="grid" role="group" [attr.aria-label]="title()">
      @for (name of weekdays; track name) {
        <span class="weekday" aria-hidden="true">{{ name }}</span>
      }
      @for (week of weeks(); track $index) {
        @for (day of week; track $index) {
          @if (day) {
            <button
              type="button"
              class="day"
              [class.chosen]="day === selected()"
              [class.today]="day === today()"
              [disabled]="!available().has(day)"
              [attr.aria-pressed]="day === selected()"
              [attr.aria-label]="dayLabel(day)"
              (click)="picked.emit(day)"
            >
              {{ number(day) }}
            </button>
          } @else {
            <span aria-hidden="true"></span>
          }
        }
      }
    </div>
  `,
})
export class DayCalendarComponent {
  /** I giorni che la pagina sa mostrare, dal più vecchio. */
  readonly days = input.required<readonly string[]>();
  /** Il giorno mostrato adesso. */
  readonly selected = input.required<string>();
  /** Oggi, `AAAA-MM-GG` (ora di Roma). */
  readonly today = input<string | null>(null);
  readonly picked = output<string>();

  protected readonly weekdays = WEEKDAYS;
  /** Il mese sfogliato: all'inizio quello del giorno mostrato. */
  protected readonly month = linkedSignal(() => monthOf(this.selected()));
  protected readonly available = computed(() => new Set(this.days()));
  protected readonly weeks = computed(() => monthWeeks(this.month()));
  protected readonly title = computed(() => monthTitle(this.month()));
  protected readonly canGoBack = computed(() => {
    const first = this.days()[0];
    return first !== undefined && this.month() > monthOf(first);
  });
  protected readonly canGoForward = computed(() => {
    const last = this.days().at(-1);
    return last !== undefined && this.month() < monthOf(last);
  });

  protected shift(by: number): string {
    return shiftMonth(this.month(), by);
  }

  protected number(day: string): number {
    return dayNumber(day);
  }

  protected dayLabel(day: string): string {
    const text = dateText(day, new Date());
    return this.available().has(day) ? text : `${text}, nessun dato`;
  }
}
