import { Component, computed, input } from '@angular/core';
import { WeekMinutes } from './training';

/**
 * I minuti di allenamento per settimana (docs/adr/0042): una colonna per settimana, l'ultima è questa. Il numero è
 * scritto sopra ogni colonna; chi usa un lettore di schermo sente l'elenco.
 */
@Component({
  selector: 'app-week-minutes',
  styles: `
    :host {
      display: block;
    }
    ol {
      display: grid;
      grid-template-columns: repeat(var(--weeks, 8), 1fr);
      gap: 6px;
      align-items: end;
      margin: 0;
      padding: 0;
      list-style: none;
    }
    li {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 4px;
    }
    .value {
      font-family: var(--rl-font-mono);
      font-size: 12px;
      color: var(--rl-text-2);
    }
    .bar {
      width: 100%;
      max-width: 28px;
      min-height: 2px;
      border-radius: 4px 4px 0 0;
      background: var(--rl-past);
    }
    li.current .bar {
      background: var(--rl-text);
    }
    .label {
      font-size: 11px;
      line-height: 14px;
      color: var(--rl-muted);
      white-space: nowrap;
    }
  `,
  template: `
    <ol [style.--weeks]="weeks().length" aria-label="Minuti di allenamento per settimana">
      @for (week of weeks(); track week.label; let last = $last) {
        <li
          [class.current]="last"
          [attr.aria-label]="
            (last ? 'Questa settimana' : 'Settimana del ' + week.label) +
            ': ' +
            week.minutes +
            ' minuti'
          "
        >
          <span class="value" aria-hidden="true">{{ week.minutes }}</span>
          <span class="bar" aria-hidden="true" [style.height.px]="height(week.minutes)"></span>
          <span class="label" aria-hidden="true">{{ last ? 'ora' : week.label }}</span>
        </li>
      }
    </ol>
  `,
})
export class WeekMinutesComponent {
  readonly weeks = input.required<readonly WeekMinutes[]>();

  private readonly max = computed(() => Math.max(30, ...this.weeks().map((w) => w.minutes)));

  /** Fino a 72 px per la settimana più lunga (almeno 30 minuti di scala, così pochi minuti restano bassi). */
  protected height(minutes: number): number {
    return Math.round((minutes / this.max()) * 72);
  }
}
