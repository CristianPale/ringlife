import { Component, computed, input, output } from '@angular/core';

export interface ChipOption {
  code: string;
  label: string;
}

/**
 * Gruppo di scelte con `aria-pressed`: una sola scelta o più d'una.
 * Varianti: `pill` (pillole), `segment` (tre colonne), `filter` (piccole, per i filtri).
 */
@Component({
  selector: 'app-chip-group',
  styleUrl: './chip-group.component.scss',
  host: { '[attr.data-variant]': 'variant()' },
  template: `
    <div class="group" role="group" [attr.aria-label]="label()">
      @for (option of options(); track option.code) {
        <button
          type="button"
          class="chip"
          [attr.aria-pressed]="isSelected(option.code)"
          (click)="toggle(option.code)"
        >
          {{ option.label }}
        </button>
      }
    </div>
  `,
})
export class ChipGroupComponent {
  readonly options = input.required<readonly ChipOption[]>();
  readonly selected = input<readonly string[]>([]);
  /** Più scelte insieme. Se falso, un tocco su una scelta già attiva la toglie. */
  readonly multiple = input(false);
  readonly variant = input<'pill' | 'segment' | 'filter'>('pill');
  /** Nome del gruppo per chi usa uno screen reader. */
  readonly label = input<string | null>(null);

  readonly changed = output<string[]>();

  private readonly selectedSet = computed(() => new Set(this.selected()));

  protected isSelected(code: string): boolean {
    return this.selectedSet().has(code);
  }

  protected toggle(code: string): void {
    const current = this.selected();
    if (this.multiple()) {
      this.changed.emit(current.includes(code) ? current.filter((c) => c !== code) : [...current, code]);
    } else {
      this.changed.emit(current.includes(code) ? [] : [code]);
    }
  }
}
