import { Component, computed, output, signal, viewChild } from '@angular/core';
import { MAX_NOTE_LENGTH } from './journal.model';
import { WhenFieldComponent } from './when-field.component';

export interface NoteChoice {
  text: string;
  at: Date;
}

/** Sheet della Nota: testo libero, salvato con l'ora (adesso o scelta). */
@Component({
  selector: 'app-note-sheet',
  imports: [WhenFieldComponent],
  styleUrl: './entry-sheet.component.scss',
  template: `
    <section class="sheet" aria-labelledby="sheet-title">
      <app-when-field #when title="Nota"></app-when-field>

      <div class="choices">
        <label for="note-text"><h3>Cosa vuoi annotare?</h3></label>
        <textarea
          id="note-text"
          rows="4"
          [attr.maxlength]="maxLength"
          [value]="text()"
          (input)="onText($event)"
        ></textarea>
      </div>

      <button type="button" class="save" [disabled]="!canSave()" (click)="save()">Salva</button>
      <button type="button" class="cancel" (click)="cancelled.emit()">Annulla</button>
    </section>
  `,
  styles: `
    textarea {
      box-sizing: border-box;
      width: 100%;
      padding: 12px 14px;
      border: 0;
      border-radius: var(--rl-radius-control);
      background: var(--rl-surface-2);
      color: var(--rl-text);
      font: inherit;
      font-size: 17px;
      line-height: 24px;
      resize: none;
    }

    label h3 {
      margin: 0;
    }

    .save {
      min-height: 52px;
      border: 0;
      border-radius: 999px;
      background: var(--rl-text);
      color: var(--rl-bg);
      font: inherit;
      font-size: 17px;
      font-weight: 700;
    }

    .save:disabled {
      opacity: 0.4;
    }
  `,
})
export class NoteSheetComponent {
  readonly saved = output<NoteChoice>();
  readonly cancelled = output<void>();

  protected readonly maxLength = MAX_NOTE_LENGTH;
  protected readonly text = signal('');
  protected readonly canSave = computed(() => this.text().trim() !== '');

  private readonly when = viewChild.required<WhenFieldComponent>('when');

  protected onText(event: Event): void {
    this.text.set((event.target as HTMLTextAreaElement).value);
  }

  protected save(): void {
    if (this.canSave()) {
      this.saved.emit({ text: this.text(), at: this.when().resolve() });
    }
  }
}
