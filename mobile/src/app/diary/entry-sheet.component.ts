import { Component, input, output, viewChild } from '@angular/core';
import { ChipOption } from '../shared/chip-group.component';
import { WhenFieldComponent } from './when-field.component';

export interface EntryChoice {
  code: string;
  at: Date;
}

/** Sheet di Caffeina e Alcol: un tocco sulla bevanda registra una porzione, adesso o all'ora scelta. */
@Component({
  selector: 'app-entry-sheet',
  imports: [WhenFieldComponent],
  styleUrl: './entry-sheet.component.scss',
  template: `
    <section class="sheet" aria-labelledby="sheet-title">
      <app-when-field #when [title]="title()"></app-when-field>

      <div class="choices">
        <h3>{{ question() }}</h3>
        <div class="options" role="group" [attr.aria-label]="question()">
          @for (option of options(); track option.code) {
            <button type="button" class="option" (click)="choose(option.code)">{{ option.label }}</button>
          }
        </div>
      </div>

      <p class="hint">Un tocco registra una porzione. Se ne hai prese due, registrale una dopo l'altra.</p>

      <button type="button" class="cancel" (click)="cancelled.emit()">Annulla</button>
    </section>
  `,
})
export class EntrySheetComponent {
  readonly title = input.required<string>();
  readonly question = input.required<string>();
  readonly options = input.required<readonly ChipOption[]>();

  readonly chosen = output<EntryChoice>();
  readonly cancelled = output<void>();

  private readonly when = viewChild.required<WhenFieldComponent>('when');

  protected choose(code: string): void {
    this.chosen.emit({ code, at: this.when().resolve() });
  }
}
