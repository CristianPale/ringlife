import { Component, input, output } from '@angular/core';

/** Riga con interruttore: un pulsante `role="switch"`, area di tocco di almeno 44 px su tutta la riga. */
@Component({
  selector: 'app-switch-row',
  styleUrl: './switch-row.component.scss',
  template: `
    <button type="button" class="row" role="switch" [attr.aria-checked]="checked()" (click)="toggled.emit(!checked())">
      <span class="text">
        <span class="label">{{ label() }}</span>
        @if (description()) {
          <span class="description">{{ description() }}</span>
        }
      </span>
      <span class="track" [class.on]="checked()" aria-hidden="true"><span class="thumb"></span></span>
      <span class="state">{{ checked() ? 'Acceso' : 'Spento' }}</span>
    </button>
  `,
})
export class SwitchRowComponent {
  readonly label = input.required<string>();
  readonly description = input<string | null>(null);
  readonly checked = input.required<boolean>();
  readonly toggled = output<boolean>();
}
