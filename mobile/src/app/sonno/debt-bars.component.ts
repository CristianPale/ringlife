import { Component, computed, input } from '@angular/core';
import { NightSleep, formatHoursMinutes } from './sonno.model';

const WIDTH = 342;
const BAR_WIDTH = 30;
const PITCH = 44;
const FIRST_X = 6;
const TOP = 10;
const BASE = 100;
const GOAL_LABEL_WIDTH = 36;

/** Ore di sonno delle ultime 7 notti contro l'obiettivo (la riga tratteggiata). Stanotte in evidenza. */
@Component({
  selector: 'app-debt-bars',
  styles: `
    :host {
      display: block;
      line-height: 0;
    }
    svg {
      display: block;
      width: 100%;
      height: auto;
    }
    .goal {
      stroke: var(--rl-muted);
      stroke-width: 1;
      stroke-dasharray: 3 4;
    }
    .bar {
      fill: var(--rl-past);
    }
    .bar.tonight {
      fill: var(--rl-text);
    }
    text {
      fill: var(--rl-muted);
      font-size: 12px;
      font-family: var(--rl-font-text);
    }
    text.tonight {
      fill: var(--rl-text);
    }
    text.number {
      font-family: var(--rl-font-mono);
    }
  `,
  template: `
    <svg [attr.viewBox]="'0 0 ' + width + ' 122'" role="img" [attr.aria-label]="description()">
      <line class="goal" x1="0" [attr.y1]="goalY()" [attr.x2]="width - goalLabelWidth" [attr.y2]="goalY()"></line>
      <text class="number" [attr.x]="width" [attr.y]="goalY() + 4" text-anchor="end">{{ goalLabel() }}</text>
      @for (bar of bars(); track $index) {
        @if (bar.height > 0) {
          <rect class="bar" [class.tonight]="bar.tonight" [attr.x]="bar.x" [attr.y]="bar.y" [attr.width]="barWidth" [attr.height]="bar.height" rx="3"></rect>
        }
        <text [class.tonight]="bar.tonight" [attr.x]="bar.x + barWidth / 2" y="118" text-anchor="middle">{{ bar.label }}</text>
      }
    </svg>
  `,
})
export class DebtBarsComponent {
  readonly nights = input.required<readonly NightSleep[]>();
  /** Obiettivo di sonno in minuti, da Impostazioni. */
  readonly goalMin = input.required<number>();

  protected readonly width = WIDTH;
  protected readonly barWidth = BAR_WIDTH;
  protected readonly goalLabelWidth = GOAL_LABEL_WIDTH;

  private readonly pxPerMin = computed(() => {
    const longest = Math.max(this.goalMin(), ...this.nights().map((n) => n.minutes ?? 0));
    return (BASE - TOP) / longest;
  });
  protected readonly goalY = computed(() => round(BASE - this.goalMin() * this.pxPerMin()));
  protected readonly goalLabel = computed(() => `${Math.round(this.goalMin() / 60)} h`);
  protected readonly bars = computed(() => {
    const nights = this.nights();
    return nights.map((night, index) => {
      const height = round((night.minutes ?? 0) * this.pxPerMin());
      return {
        x: FIRST_X + index * PITCH,
        y: round(BASE - height),
        height,
        label: night.label,
        tonight: index === nights.length - 1,
      };
    });
  });
  protected readonly description = computed(() => {
    const nights = this.nights();
    const last = nights.at(-1)?.minutes;
    return (
      `Ore di sonno delle ultime ${nights.length} notti rispetto all'obiettivo di ${formatHoursMinutes(this.goalMin())}.` +
      (typeof last === 'number' ? ` Stanotte ${formatHoursMinutes(last)}.` : '')
    );
  });
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
