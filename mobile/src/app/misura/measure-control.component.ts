import { Component, DestroyRef, computed, inject, input, signal } from '@angular/core';
import { MeasureKind } from '../ring/measure.model';
import { measureText } from './measure-info';
import { RingSyncService } from '../ring/ring-sync.service';
import { timeText } from '../temperatura/temperatura.model';

/**
 * Il pulsante di una misura a comando (docs/adr/0039): fa misurare l'anello, conta i secondi mentre misura e poi dice
 * il valore o perché non c'è. Spento senza anello e mentre l'anello è impegnato (una misura alla volta).
 */
@Component({
  selector: 'app-measure-control',
  template: `
    <button type="button" class="button" [disabled]="!ringSync.hasRing() || ringSync.busy()" (click)="run()">
      {{ text() }}
    </button>
    @if (outcome(); as message) {
      <p class="outcome" role="status">{{ message }}</p>
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .button {
      align-self: flex-start;
      min-height: 44px;
      padding: 0 20px;
      border: 1px solid var(--rl-chip-border);
      border-radius: var(--rl-radius-control);
      background: none;
      color: var(--rl-text);
      font: inherit;
      font-weight: 600;
    }
    .button:disabled {
      color: var(--rl-muted);
    }
    .outcome {
      margin: 0;
      font-size: 15px;
      line-height: 20px;
      color: var(--rl-text);
    }
  `,
})
export class MeasureControlComponent {
  readonly kind = input.required<MeasureKind>();
  readonly label = input('Misura ora');

  protected readonly ringSync = inject(RingSyncService);
  protected readonly outcome = signal<string | null>(null);
  /** Secondi dall'inizio della misura in corso. */
  private readonly elapsed = signal(0);
  private ticker: ReturnType<typeof setInterval> | undefined;

  protected readonly text = computed(() => {
    if (this.ringSync.measuring() === this.kind()) {
      return `Misuro… ${this.elapsed()} s`;
    }
    return this.ringSync.syncing() ? "Leggo l'anello…" : this.label();
  });

  constructor() {
    inject(DestroyRef).onDestroy(() => clearInterval(this.ticker));
  }

  protected async run(): Promise<void> {
    this.outcome.set(null);
    this.elapsed.set(0);
    const started = Date.now();
    clearInterval(this.ticker);
    this.ticker = setInterval(() => this.elapsed.set(Math.floor((Date.now() - started) / 1000)), 1000);
    try {
      const result = await this.ringSync.measure(this.kind());
      this.outcome.set(result.ok ? `Misurata alle ${timeText(result.ts)}: ${measureText(result.kind, result.value)}.` : result.message);
    } finally {
      clearInterval(this.ticker);
    }
  }
}
