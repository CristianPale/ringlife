import { Component, computed, input } from '@angular/core';
import {
  HYPNOGRAM_HEIGHT,
  HYPNOGRAM_PLOT,
  HYPNOGRAM_WIDTH,
  STAGE_ROWS,
  hypnogramBlocks,
  rowY,
} from './hypnogram';
import { SleepSegment, SleepStage, asleepMinutes, formatHoursMinutes, totalsByStage } from './sonno.model';

const STAGE_NAMES: Record<SleepStage, string> = {
  awake: 'Sveglio',
  rem: 'REM',
  light: 'Leggero',
  deep: 'Profondo',
};

/**
 * Ipnogramma: le fasi della notte, una riga per fase. La fase si legge dalla riga e dall'etichetta,
 * mai solo dal colore. Le fasi le calcola l'anello: l'app le mostra così come arrivano.
 */
@Component({
  selector: 'app-hypnogram',
  styleUrl: './hypnogram.component.scss',
  template: `
    <svg class="chart" [attr.viewBox]="'0 0 ' + width + ' ' + height" role="img" [attr.aria-label]="summary()">
      @for (stage of rows; track stage) {
        <text class="row-label" x="0" [attr.y]="labelY(stage)">{{ names[stage] }}</text>
        <rect
          class="row-track"
          [attr.x]="plot.left"
          [attr.y]="rowTop(stage)"
          [attr.width]="plot.right - plot.left"
          [attr.height]="plot.rowHeight"
          rx="4"
        ></rect>
      }
      @for (block of blocks(); track $index) {
        <rect
          class="block"
          [attr.data-stage]="block.stage"
          [attr.x]="block.x"
          [attr.y]="block.y"
          [attr.width]="block.width"
          [attr.height]="block.height"
          rx="3"
        ></rect>
      }
    </svg>
    <div class="axis" aria-hidden="true">
      <span>{{ bedTime() }}</span>
      <span>{{ wakeTime() }}</span>
    </div>
  `,
})
export class HypnogramComponent {
  readonly segments = input.required<readonly SleepSegment[]>();
  readonly bedTime = input.required<string>();
  readonly wakeTime = input.required<string>();

  protected readonly width = HYPNOGRAM_WIDTH;
  protected readonly height = HYPNOGRAM_HEIGHT;
  protected readonly plot = HYPNOGRAM_PLOT;
  protected readonly rows = STAGE_ROWS;
  protected readonly names = STAGE_NAMES;

  protected readonly blocks = computed(() => hypnogramBlocks(this.segments()));
  protected readonly summary = computed(() => {
    const totals = totalsByStage(this.segments());
    return (
      `Fasi della notte dalle ${this.bedTime()} alle ${this.wakeTime()}: ` +
      `${formatHoursMinutes(asleepMinutes(this.segments()))} di sonno, ` +
      `${formatHoursMinutes(totals.deep)} profondo, ${formatHoursMinutes(totals.rem)} REM, ` +
      `${formatHoursMinutes(totals.light)} leggero, ${formatHoursMinutes(totals.awake)} sveglio`
    );
  });

  protected rowTop(stage: SleepStage): number {
    return rowY(stage);
  }

  protected labelY(stage: SleepStage): number {
    return rowY(stage) + HYPNOGRAM_PLOT.rowHeight / 2 + 4;
  }
}
