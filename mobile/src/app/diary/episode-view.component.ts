import { Component, DestroyRef, NgZone, computed, inject, signal } from '@angular/core';
import { MAX_INTENSITY, MIN_INTENSITY } from './headache.model';
import { Clock, HeadacheService } from './headache.service';
import { durationReading } from '../livella/measure';
import { formatClock, minutesBetween } from './headache-time';

const TICK_MS = 30_000;

/**
 * «Episodio in corso»: sostituisce Oggi finché la cefalea è aperta (ADR 0006, ADR 0020). Palette Penombra,
 * nessun colore, nessuna animazione, bersagli da 64 px. Non dà indicazioni sui farmaci: registra solo l'orario.
 */
@Component({
  selector: 'app-episode-view',
  styleUrl: './episode-view.component.scss',
  template: `
    @if (episode(); as ep) {
      <main class="episode">
        <p class="label">Episodio in corso</p>

        <section aria-label="Durata" class="duration-block">
          <h1 class="since">Cefalea iniziata alle {{ startedClock() }}.</h1>
          <span class="duration-line">
            <span class="duration">{{ duration().value }}</span>
            <span class="duration-unit">{{ duration().unit }}</span>
          </span>
        </section>

        <section aria-labelledby="intensita" class="intensity-block">
          <h2 id="intensita" class="intensity-caption">Intensità, da 1 a 10</h2>
          <div class="intensity-row">
            <button
              type="button"
              class="stepper"
              aria-label="Diminuisci intensità"
              [disabled]="ep.intensity <= min"
              (click)="adjust(-1)"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12h12"></path></svg>
            </button>
            <span class="intensity-value" aria-live="polite">{{ ep.intensity }}</span>
            <button
              type="button"
              class="stepper"
              aria-label="Aumenta intensità"
              [disabled]="ep.intensity >= max"
              (click)="adjust(1)"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12h12M12 6v12"></path></svg>
            </button>
          </div>
        </section>

        <div class="actions">
          <button type="button" class="action" (click)="takeMedication()">
            Ho preso un farmaco
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 6v12M6 12h12"></path></svg>
          </button>
          @if (lastMedication(); as time) {
            <p class="note" role="status">Registrato: farmaco alle {{ time }}</p>
          }
        </div>

        <div class="spacer"></div>

        <div class="footer">
          <button type="button" class="finish" (click)="finish()">È finito</button>
          <p class="disclaimer">
            Se il dolore è diverso dal solito o molto forte, contatta un medico. RingLife non è un dispositivo medico.
          </p>
        </div>
      </main>
    }
  `,
})
export class EpisodeViewComponent {
  private readonly headaches = inject(HeadacheService);
  private readonly clock = inject(Clock);

  protected readonly min = MIN_INTENSITY;
  protected readonly max = MAX_INTENSITY;

  protected readonly episode = this.headaches.active;

  /** Aggiornato ogni 30 secondi: la durata non mostra i secondi. */
  private readonly now = signal(this.clock.now());

  /** «1:24» con «ore e minuti» accanto; sotto l'ora «48» con «minuti». */
  protected readonly duration = computed(() => {
    const ep = this.episode();
    if (!ep) {
      return { value: '', unit: '' };
    }
    const { value, unit } = durationReading(minutesBetween(new Date(ep.startedAt), this.now()));
    return { value, unit: unit === 'ore' ? 'ore e minuti' : unit };
  });

  protected readonly startedClock = computed(() => {
    const ep = this.episode();
    return ep ? formatClock(new Date(ep.startedAt)) : '';
  });

  protected readonly lastMedication = computed(() => {
    const times = this.episode()?.medicationAt ?? [];
    return times.length ? formatClock(new Date(times[times.length - 1])) : null;
  });

  constructor() {
    // Fuori dalla zona: un timer perenne dentro la zona impedirebbe all'app di risultare «stabile».
    // Il segnale aggiorna comunque la vista.
    const timer = inject(NgZone).runOutsideAngular(() => setInterval(() => this.now.set(this.clock.now()), TICK_MS));
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }

  protected adjust(delta: number): Promise<void> {
    return this.headaches.adjustIntensity(delta);
  }

  protected takeMedication(): Promise<void> {
    return this.headaches.addMedication();
  }

  protected finish(): Promise<void> {
    return this.headaches.finish();
  }
}
