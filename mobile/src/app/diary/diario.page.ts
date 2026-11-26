import { Component, computed, inject, signal } from '@angular/core';
import { IonContent } from '@ionic/angular';
import { ChipGroupComponent, ChipOption } from '../shared/chip-group.component';
import { EntryKind, KIND_LABELS, buildTimeline, kindsPresent } from './diary-timeline';
import { EpisodeCompletionComponent } from './episode-completion.component';
import { Clock, HeadacheService } from './headache.service';
import { JournalService } from './journal.service';
import { HabitualCaffeineService } from './habitual-caffeine.service';

/**
 * Scheda Diario: completare l'ultima cefalea e rileggere la cronologia di cefalee, caffeina, alcol e note.
 * I filtri compaiono quando ci sono almeno due tipi di voci. Le voci della caffeina abituale si possono togliere.
 */
@Component({
  selector: 'app-diario',
  imports: [IonContent, ChipGroupComponent, EpisodeCompletionComponent],
  styleUrl: './diario.page.scss',
  template: `
    <ion-content [fullscreen]="true">
      <main class="page">
        <header class="header">
          <h1>Diario</h1>
        </header>

        @if (pending(); as episode) {
          <app-episode-completion [episode]="episode"></app-episode-completion>
        }

        <section aria-labelledby="cronologia">
          <h2 id="cronologia" class="section-title">Cronologia</h2>

          @if (filterOptions().length > 1) {
            <app-chip-group
              class="filters"
              label="Filtra"
              variant="filter"
              [options]="filterOptions()"
              [selected]="[filter()]"
              (changed)="setFilter($event)"
            ></app-chip-group>
          }

          @for (day of timeline(); track day.key) {
            <h3 class="day">{{ day.label }}</h3>
            <ul class="entries">
              @for (entry of day.entries; track entry.id) {
                <li [class.habitual]="entry.habitual">
                  <span class="time">{{ entry.time }}</span>
                  <span class="text">{{ entry.text }}@if (entry.habitual) {<span class="habit-note">abituale, segnata da sola</span>}</span>
                  @if (entry.habitual) {
                    <button type="button" class="habit-skip" [attr.aria-label]="'Togli ' + entry.text + ', ' + day.label" (click)="skip(entry.id)">
                      Togli
                    </button>
                  }
                </li>
              }
            </ul>
          } @empty {
            <p class="empty">Ancora niente qui. Cefalee, caffeina, alcol e note che registri compaiono in questa lista.</p>
          }
        </section>
      </main>
    </ion-content>
  `,
})
export class DiarioPage {
  private readonly headaches = inject(HeadacheService);
  private readonly journal = inject(JournalService);
  private readonly clock = inject(Clock);
  private readonly habits = inject(HabitualCaffeineService);

  protected readonly pending = this.headaches.pendingCompletion;
  protected readonly filter = signal<'all' | EntryKind>('all');

  /** Tipi di voce presenti: i filtri servono solo se ce n'è più di uno. */
  private readonly kinds = computed(() => kindsPresent(this.headaches.episodes(), this.journal.entries()));

  protected readonly filterOptions = computed<ChipOption[]>(() => {
    const kinds = this.kinds();
    return kinds.length < 2
      ? []
      : [{ code: 'all', label: 'Tutto' }, ...kinds.map((k) => ({ code: k, label: KIND_LABELS[k] }))];
  });

  protected readonly timeline = computed(() => {
    const selected = this.filter();
    return buildTimeline(
      this.headaches.episodes(),
      this.journal.entries(),
      this.clock.now(),
      selected === 'all' ? [] : [selected],
    );
  });

  /** «Togli» su una voce abituale: quel giorno non l'hai bevuta. Non torna alla prossima apertura. */
  protected skip(id: string): Promise<void> {
    return this.habits.skip(id);
  }

  protected setFilter(values: string[]): void {
    this.filter.set((values[0] as 'all' | EntryKind | undefined) ?? 'all');
  }
}
