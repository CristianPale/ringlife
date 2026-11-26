import { Component, computed, input } from '@angular/core';
import { formatElapsed, LiveSample } from './session.model';
import { HR_ZONES, timeInZones, zoneBounds } from './hr-zones';

/**
 * Il tempo passato in ogni zona del battito (docs/adr/0031), dalla più intensa. Una barra per zona, larga quanto la
 * sua quota della sessione; il tempo è sempre scritto accanto.
 */
@Component({
  selector: 'app-zone-times',
  styles: `
    :host {
      display: block;
    }
    ul {
      display: flex;
      flex-direction: column;
      gap: 10px;
      margin: 0;
      padding: 0;
      list-style: none;
    }
    li {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 4px 12px;
      align-items: baseline;
    }
    .name {
      font-size: 15px;
      color: var(--rl-text);
    }
    .range {
      font-family: var(--rl-font-mono);
      font-size: 13px;
      color: var(--rl-muted);
    }
    .time {
      font-family: var(--rl-font-mono);
      font-size: 15px;
      color: var(--rl-text);
    }
    .bar {
      grid-column: 1 / -1;
      height: 6px;
      border-radius: 3px;
      background: var(--rl-surface-2);
      overflow: hidden;
    }
    .fill {
      height: 100%;
      background: var(--rl-text-2);
    }
    .note {
      margin: 12px 0 0;
      font-size: 14px;
      line-height: 20px;
      color: var(--rl-muted);
    }
  `,
  template: `
    <ul aria-label="Tempo nelle zone del battito">
      @for (row of rows(); track row.zone) {
        <li>
          <span class="name">
            Zona {{ row.zone }} · {{ row.name }}
            <span class="range">{{ row.range }}</span>
          </span>
          <span class="time">{{ row.time }}</span>
          <span class="bar" aria-hidden="true"><span class="fill" [style.width.%]="row.share"></span></span>
        </li>
      }
    </ul>
    <p class="note">
      Battito massimo stimato dall'età: {{ maxHr() }} battiti al minuto (208 − 0,7 × età). Sotto la zona 1:
      {{ below() }}.
    </p>
  `,
})
export class ZoneTimesComponent {
  readonly samples = input.required<readonly LiveSample[]>();
  readonly maxHr = input.required<number>();

  private readonly totals = computed(() => timeInZones(this.samples(), this.maxHr()));
  protected readonly below = computed(() => formatElapsed(this.totals()[0]));
  protected readonly rows = computed(() => {
    const totals = this.totals();
    const all = totals.reduce((a, b) => a + b, 0) || 1;
    const bounds = zoneBounds(this.maxHr());
    return [...HR_ZONES].reverse().map((z) => {
      const b = bounds[z.zone - 1];
      return {
        zone: z.zone,
        name: z.name,
        range: z.zone === 5 ? `da ${b.from}` : `${b.from}-${b.to - 1}`,
        time: formatElapsed(totals[z.zone]),
        share: Math.round((totals[z.zone] / all) * 100),
      };
    });
  });
}
