import { Component, computed, input, output } from '@angular/core';
import { SPARKLINE_WIDTH, sparkline } from '../oggi/sparkline';
import { ZoneBadgeComponent } from '../oggi/zone-badge.component';
import { PluginAction, PluginCard } from './plugin.model';

/** Una card di plugin, disegnata dal suo tipo (docs/adr/0013). I testi li ha già scritti il server. */
@Component({
  selector: 'app-plugin-card',
  imports: [ZoneBadgeComponent],
  styles: `
    :host {
      display: block;
      padding: 16px;
      border-radius: var(--rl-radius-card);
      background: var(--rl-surface);
      color: var(--rl-text);
    }
    .title {
      margin: 0;
      font-size: 13px;
      line-height: 18px;
      font-weight: 500;
      color: var(--rl-text-2);
    }
    .value-row {
      display: flex;
      align-items: baseline;
      gap: 8px;
      margin-top: 4px;
    }
    .number {
      font-family: var(--rl-font-mono);
      font-size: 30px;
      line-height: 36px;
      font-weight: 500;
      letter-spacing: -0.03em;
    }
    .caption {
      margin: 6px 0 0;
      font-size: 13px;
      line-height: 18px;
      color: var(--rl-muted);
    }
    .body {
      margin: 6px 0 0;
      font-size: 16px;
      line-height: 23px;
      color: var(--rl-text);
    }
    .rows {
      margin: 8px 0 0;
      padding: 0;
      font-size: 15px;
      line-height: 21px;
    }
    /* Ogni riga ha le sue colonne: con una griglia comune un valore lungo restringeva l'etichetta di tutte le righe. */
    .rows .row {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 16px;
      padding: 10px 0;
      border-top: 1px solid var(--rl-line);
    }
    .rows dt {
      flex: 1 1 auto;
      min-width: 0;
      color: var(--rl-text);
    }
    .rows dd {
      flex: 0 1 auto;
      max-width: 60%;
      margin: 0;
      font-family: var(--rl-font-mono);
      font-size: 14px;
      color: var(--rl-text-2);
      text-align: right;
    }
    .trend {
      fill: none;
      stroke: var(--rl-text);
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    .action {
      min-height: 44px;
      padding: 0 18px;
      border: 1px solid var(--rl-chip-border);
      border-radius: var(--rl-radius-control);
      background: transparent;
      color: var(--rl-text);
      font: inherit;
      font-size: 15px;
      font-weight: 600;
    }
  `,
  template: `
    @switch (card().type) {
      @case ('score') {
        @if (score(); as c) {
          <h3 class="title">{{ c.title }}</h3>
          <div class="value-row">
            <span class="number">{{ c.value }}</span>
            <app-zone-badge [zone]="c.zone"></app-zone-badge>
          </div>
          @if (c.caption) {
            <p class="caption">{{ c.caption }}</p>
          }
        }
      }
      @case ('trend') {
        @if (trend(); as c) {
          <h3 class="title">{{ c.title }}</h3>
          <svg [attr.width]="width" height="26" [attr.viewBox]="'0 0 ' + width + ' 26'" role="img" [attr.aria-label]="trendLabel()" style="overflow: visible">
            <polyline [attr.points]="line().points" class="trend"></polyline>
          </svg>
          @if (c.caption) {
            <p class="caption">{{ c.caption }}</p>
          }
        }
      }
      @case ('list') {
        @if (list(); as c) {
          <h3 class="title">{{ c.title }}</h3>
          <dl class="rows">
            @for (row of c.rows; track $index) {
              <div class="row">
                <dt>{{ row.label }}</dt>
                <dd>{{ row.value }}</dd>
              </div>
            }
          </dl>
        }
      }
      @case ('text') {
        @if (text(); as c) {
          @if (c.title) {
            <h3 class="title">{{ c.title }}</h3>
          }
          <p class="body">{{ c.body }}</p>
        }
      }
      @case ('action') {
        @if (action(); as c) {
          <button type="button" class="action" (click)="act.emit(c.action)">{{ c.label }}</button>
        }
      }
    }
  `,
})
export class PluginCardComponent {
  readonly card = input.required<PluginCard>();
  readonly act = output<PluginAction>();
  protected readonly width = SPARKLINE_WIDTH;

  protected readonly score = computed(() => (this.card().type === 'score' ? (this.card() as Extract<PluginCard, { type: 'score' }>) : null));
  protected readonly trend = computed(() => (this.card().type === 'trend' ? (this.card() as Extract<PluginCard, { type: 'trend' }>) : null));
  protected readonly list = computed(() => (this.card().type === 'list' ? (this.card() as Extract<PluginCard, { type: 'list' }>) : null));
  protected readonly text = computed(() => (this.card().type === 'text' ? (this.card() as Extract<PluginCard, { type: 'text' }>) : null));
  protected readonly action = computed(() => (this.card().type === 'action' ? (this.card() as Extract<PluginCard, { type: 'action' }>) : null));

  /** I giorni senza dato non si disegnano: la linea unisce quelli che ci sono. */
  private readonly present = computed(() => (this.trend()?.points ?? []).filter((p): p is number => p !== null));
  protected readonly line = computed(() => sparkline(this.present()));
  protected readonly trendLabel = computed(() => {
    const points = this.present();
    return points.length === 0
      ? 'Nessun dato'
      : `Da ${points[0]} a ${points[points.length - 1]}${this.trend()?.unit ? ' ' + this.trend()?.unit : ''}`;
  });
}
