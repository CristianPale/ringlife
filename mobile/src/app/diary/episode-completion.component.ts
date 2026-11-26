import { Component, computed, inject, input, signal } from '@angular/core';
import { ChipGroupComponent } from '../shared/chip-group.component';
import {
  Cause,
  EMPTY_DETAILS,
  EpisodeDetails,
  HeadacheEpisode,
  HeadacheLocation,
  MedicationHelp,
  Symptom,
} from './headache.model';
import { HeadacheService } from './headache.service';
import {
  CAUSE_OPTIONS,
  LOCATION_OPTIONS,
  MEDICATION_HELP_OPTIONS,
  SYMPTOM_OPTIONS,
  episodeSummary,
} from './headache-labels';

/** «Completa la cefalea di stamattina»: i dettagli che non si chiedono durante l'attacco. */
@Component({
  selector: 'app-episode-completion',
  imports: [ChipGroupComponent],
  styleUrl: './episode-completion.component.scss',
  template: `
    <section class="card" aria-labelledby="completa-titolo">
      <div class="head">
        <h2 id="completa-titolo">Completa la cefalea di {{ whenLabel() }}</h2>
        <span class="summary">{{ summary() }}</span>
      </div>

      <fieldset>
        <legend>Sintomi</legend>
        <app-chip-group
          label="Sintomi"
          [options]="symptoms"
          [selected]="form().symptoms"
          [multiple]="true"
          (changed)="setSymptoms($event)"
        ></app-chip-group>
      </fieldset>

      <fieldset>
        <legend>Dove</legend>
        <app-chip-group
          label="Dove"
          [options]="locations"
          [selected]="form().location ? [form().location!] : []"
          (changed)="setLocation($event)"
        ></app-chip-group>
      </fieldset>

      @if (tookMedication()) {
        <fieldset>
          <legend>Il farmaco ha aiutato?</legend>
          <app-chip-group
            label="Il farmaco ha aiutato?"
            variant="segment"
            [options]="helps"
            [selected]="form().medicationHelp ? [form().medicationHelp!] : []"
            (changed)="setHelp($event)"
          ></app-chip-group>
        </fieldset>
      }

      <fieldset>
        <legend>Possibili cause <span class="legend-hint">(anche più di una)</span></legend>
        <app-chip-group
          label="Possibili cause"
          [options]="causes"
          [selected]="form().causes"
          [multiple]="true"
          (changed)="setCauses($event)"
        ></app-chip-group>
      </fieldset>

      <div class="notes">
        <label for="note">Note</label>
        <input
          id="note"
          type="text"
          maxlength="500"
          placeholder="Facoltative"
          [value]="form().notes"
          (input)="setNotes($event)"
        />
      </div>

      <button type="button" class="save" (click)="save()">Salva</button>
      <button type="button" class="skip" (click)="skip()">Salta</button>
    </section>
  `,
})
export class EpisodeCompletionComponent {
  private readonly headaches = inject(HeadacheService);

  readonly episode = input.required<HeadacheEpisode>();

  protected readonly symptoms = SYMPTOM_OPTIONS;
  protected readonly locations = LOCATION_OPTIONS;
  protected readonly helps = MEDICATION_HELP_OPTIONS;
  protected readonly causes = CAUSE_OPTIONS;

  protected readonly form = signal<EpisodeDetails>({ ...EMPTY_DETAILS });

  protected readonly summary = computed(() => episodeSummary(this.episode()));
  protected readonly tookMedication = computed(() => this.episode().medicationAt.length > 0);

  /** «stamattina», «ieri sera»… in modo semplice: il momento della giornata in cui è iniziata. */
  protected readonly whenLabel = computed(() => {
    const hour = new Date(this.episode().startedAt).getHours();
    const part = hour < 6 ? 'stanotte' : hour < 12 ? 'stamattina' : hour < 18 ? 'questo pomeriggio' : 'stasera';
    return part;
  });

  protected setSymptoms(values: string[]): void {
    this.form.update((f) => ({ ...f, symptoms: values as Symptom[] }));
  }

  protected setLocation(values: string[]): void {
    this.form.update((f) => ({ ...f, location: (values[0] as HeadacheLocation | undefined) ?? null }));
  }

  protected setHelp(values: string[]): void {
    this.form.update((f) => ({ ...f, medicationHelp: (values[0] as MedicationHelp | undefined) ?? null }));
  }

  protected setCauses(values: string[]): void {
    this.form.update((f) => ({ ...f, causes: values as Cause[] }));
  }

  protected setNotes(event: Event): void {
    const notes = (event.target as HTMLInputElement).value;
    this.form.update((f) => ({ ...f, notes }));
  }

  protected save(): Promise<void> {
    const details = this.tookMedication() ? this.form() : { ...this.form(), medicationHelp: null };
    return this.headaches.complete(this.episode().id, details);
  }

  /** Chiude la richiesta senza aggiungere nulla. */
  protected skip(): Promise<void> {
    return this.headaches.complete(this.episode().id, { ...EMPTY_DETAILS });
  }
}
