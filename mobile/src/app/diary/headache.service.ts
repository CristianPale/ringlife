import { Injectable, computed, inject, signal } from '@angular/core';
import { EMPTY_DETAILS, EpisodeDetails, HeadacheEpisode, MAX_INTENSITY, MIN_INTENSITY } from './headache.model';
import { HeadacheRepository } from './headache.repository';
import { Clock } from './clock';
import { newId } from './headache-time';

export { Clock, SystemClock } from './clock';

/** Stato degli episodi di cefalea sul telefono. Un solo episodio può essere in corso. */
@Injectable({ providedIn: 'root' })
export class HeadacheService {
  private readonly repository = inject(HeadacheRepository);
  private readonly clock = inject(Clock);

  private readonly episodesState = signal<readonly HeadacheEpisode[]>([]);

  readonly episodes = this.episodesState.asReadonly();
  /** L'episodio in corso, se c'è. */
  readonly active = computed(() => this.episodesState().find((e) => e.endedAt === null) ?? null);
  /** L'ultimo episodio finito di cui mancano i dettagli: il Diario chiede di completarlo. */
  readonly pendingCompletion = computed(() => {
    const open = this.episodesState().filter((e) => e.endedAt !== null && e.completedAt === null);
    return open.sort((a, b) => (b.endedAt as string).localeCompare(a.endedAt as string))[0] ?? null;
  });

  async init(): Promise<void> {
    this.episodesState.set(await this.repository.load());
  }

  /** Apre un episodio. Con un episodio già aperto non ne apre un secondo e restituisce quello. */
  async start(intensity: number, startedAt: Date): Promise<HeadacheEpisode> {
    const open = this.active();
    if (open) {
      return open;
    }
    const value = clampIntensity(intensity);
    const at = startedAt.toISOString();
    const episode: HeadacheEpisode = {
      id: newId(),
      startedAt: at,
      endedAt: null,
      intensity: value,
      intensityLog: [{ at, value }],
      medicationAt: [],
      details: { ...EMPTY_DETAILS },
      completedAt: null,
    };
    await this.commit([...this.episodesState(), episode]);
    return episode;
  }

  /** Aggiunge gli episodi che il telefono non ha ancora (per id). Quelli già presenti restano come sono. Restituisce quelli aggiunti. */
  async restore(episodes: readonly HeadacheEpisode[]): Promise<HeadacheEpisode[]> {
    const known = new Set(this.episodesState().map((e) => e.id));
    const added = episodes.filter((e) => !known.has(e.id));
    if (added.length > 0) {
      await this.commit([...this.episodesState(), ...added]);
    }
    return added;
  }

  /** Cambia l'intensità dell'episodio in corso di `delta` punti, tra 1 e 10. */
  async adjustIntensity(delta: number): Promise<void> {
    await this.updateActive((episode) => {
      const value = clampIntensity(episode.intensity + delta);
      if (value === episode.intensity) {
        return episode;
      }
      return {
        ...episode,
        intensity: value,
        intensityLog: [...episode.intensityLog, { at: this.clock.now().toISOString(), value }],
      };
    });
  }

  async addMedication(): Promise<void> {
    await this.updateActive((episode) => ({
      ...episode,
      medicationAt: [...episode.medicationAt, this.clock.now().toISOString()],
    }));
  }

  async finish(): Promise<void> {
    await this.updateActive((episode) => ({ ...episode, endedAt: this.clock.now().toISOString() }));
  }

  /** Salva i dettagli di un episodio finito. Salta con `EMPTY_DETAILS` se non si vuole aggiungere nulla. */
  async complete(id: string, details: EpisodeDetails): Promise<void> {
    const target = this.episodesState().find((e) => e.id === id);
    if (!target || target.endedAt === null) {
      return;
    }
    const completedAt = this.clock.now().toISOString();
    await this.commit(this.episodesState().map((e) => (e.id === id ? { ...e, details, completedAt } : e)));
  }

  private async updateActive(change: (episode: HeadacheEpisode) => HeadacheEpisode): Promise<void> {
    const open = this.active();
    if (!open) {
      return;
    }
    await this.commit(this.episodesState().map((e) => (e.id === open.id ? change(e) : e)));
  }

  /** Aggiorna lo stato e poi salva. Se il salvataggio fallisce lo stato resta aggiornato: l'errore arriva al chiamante. */
  private async commit(next: readonly HeadacheEpisode[]): Promise<void> {
    this.episodesState.set(next);
    await this.repository.save(next);
  }
}

function clampIntensity(value: number): number {
  return Math.min(MAX_INTENSITY, Math.max(MIN_INTENSITY, Math.round(value)));
}
