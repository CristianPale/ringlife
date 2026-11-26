import { Component, input, output, viewChild } from '@angular/core';
import { MAX_INTENSITY, MIN_INTENSITY } from './headache.model';
import { WhenFieldComponent } from './when-field.component';

export interface HeadacheStart {
  intensity: number;
  startedAt: Date;
}

/** Le altre voci che si registrano dallo stesso sheet (ADR 0020). */
export type OtherEntry = 'caffeine' | 'alcohol' | 'note';

const LEVELS = Array.from({ length: MAX_INTENSITY - MIN_INTENSITY + 1 }, (_, i) => MIN_INTENSITY + i);

/**
 * Contenuto dello sheet «Registra» (ADR 0020): si apre sull'intensità della cefalea, un tocco apre l'episodio.
 * Sotto, Caffeina, Alcol e Nota aprono i loro sheet.
 */
@Component({
  selector: 'app-headache-sheet',
  imports: [WhenFieldComponent],
  styleUrl: './headache-sheet.component.scss',
  template: `
    <section class="sheet" aria-labelledby="sheet-title">
      <app-when-field #when title="Cefalea" lead="Inizio" question="A che ora è iniziata?"></app-when-field>

      <div class="intensity">
        <p class="question">Quanto è forte? Un tocco la registra, i dettagli dopo.</p>
        <div class="levels" role="group" aria-label="Intensità da 1 a 10">
          @for (level of levels; track level) {
            <button type="button" class="level" [attr.aria-label]="levelLabel(level)" (click)="choose(level)">
              {{ level }}
            </button>
          }
        </div>
      </div>

      @if (showOthers()) {
        <div class="others">
          <span class="others-title">Oppure registra altro</span>
          <div class="other-buttons">
            <button type="button" class="other" (click)="other.emit('caffeine')">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M5 9h11v4a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5z"></path>
                <path d="M16 10h1.5a2.5 2.5 0 0 1 0 5H16M9 3v3M12 3v3"></path>
              </svg>
              Caffeina
            </button>
            <button type="button" class="other" (click)="other.emit('alcohol')">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M8 3h8l-.7 6.2a3.3 3.3 0 0 1-6.6 0z"></path>
                <path d="M12 12.5V20M8.5 20h7"></path>
              </svg>
              Alcol
            </button>
            <button type="button" class="other" (click)="other.emit('note')">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4 20h4L19 9l-4-4L4 16z"></path>
                <path d="M13.5 6.5l4 4"></path>
              </svg>
              Nota
            </button>
          </div>
        </div>
      }

      <button type="button" class="cancel" (click)="cancelled.emit()">Annulla</button>
    </section>
  `,
})
export class HeadacheSheetComponent {
  readonly started = output<HeadacheStart>();
  readonly other = output<OtherEntry>();
  readonly cancelled = output<void>();
  readonly showOthers = input(true);

  protected readonly levels = LEVELS;

  private readonly when = viewChild.required<WhenFieldComponent>('when');

  protected levelLabel(level: number): string {
    const name = level === 1 ? ', lieve' : level === 5 ? ', moderata' : level === 10 ? ', la peggiore' : '';
    return `Intensità ${level}${name}`;
  }

  protected choose(intensity: number): void {
    // L'ora è calcolata al tocco, non all'apertura: «adesso» è davvero adesso.
    this.started.emit({ intensity, startedAt: this.when().resolve() });
  }
}
