import { Component, computed, inject, input, signal } from '@angular/core';
import { Clock } from './clock';
import { formatClock, resolveStart } from './headache-time';

/**
 * Testata di uno sheet di registrazione: titolo, «adesso, alle HH:mm» e «Cambia ora».
 * Chi la usa chiama `resolve()` al tocco: così «adesso» è davvero il momento del tocco.
 */
@Component({
  selector: 'app-when-field',
  styleUrl: './when-field.component.scss',
  template: `
    <div class="head">
      <div class="head-text">
        <h2 id="sheet-title">{{ title() }}</h2>
        <span class="when">{{ whenLabel() }}</span>
      </div>
      <button type="button" class="link" [attr.aria-expanded]="editing()" (click)="toggleEditing()">
        Cambia ora
      </button>
    </div>

    @if (editing()) {
      <div class="time-field">
        <label for="start-time">{{ question() }}</label>
        <input id="start-time" type="time" [value]="time()" (input)="onTime($event)" />
      </div>
    }
  `,
})
export class WhenFieldComponent {
  private readonly clock = inject(Clock);

  readonly title = input.required<string>();
  /** Parola che apre la frase: «Inizio» → «Inizio adesso, alle 07:44». Vuota: «Adesso, alle 07:44». */
  readonly lead = input('');
  readonly question = input('A che ora?');

  protected readonly editing = signal(false);
  /** Orario scelto («HH:mm»). Vuoto: adesso. */
  protected readonly time = signal('');

  /** Orario effettivo: quello scelto, altrimenti adesso. */
  resolve(): Date {
    const now = this.clock.now();
    const chosen = this.time();
    return (chosen ? resolveStart(chosen, now) : null) ?? now;
  }

  protected readonly whenLabel = computed(() => {
    const lead = this.lead();
    const start = this.resolve();
    if (!this.time()) {
      return lead ? `${lead} adesso, alle ${formatClock(start)}` : `Adesso, alle ${formatClock(start)}`;
    }
    const day = start.getDate() !== this.clock.now().getDate() ? 'ieri ' : '';
    const text = `${day}alle ${formatClock(start)}`;
    return lead ? `${lead} ${text}` : text.charAt(0).toUpperCase() + text.slice(1);
  });

  protected toggleEditing(): void {
    const next = !this.editing();
    this.editing.set(next);
    if (next && !this.time()) {
      this.time.set(formatClock(this.clock.now()));
    }
  }

  protected onTime(event: Event): void {
    this.time.set((event.target as HTMLInputElement).value);
  }
}
