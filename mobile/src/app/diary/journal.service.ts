import { Injectable, inject, signal } from '@angular/core';
import { AlcoholDrink, CaffeineDrink, JournalEntry, MAX_NOTE_LENGTH } from './journal.model';
import { JournalRepository } from './journal.repository';
import { newId } from './headache-time';

/** Caffeina, alcol e note del Diario. Un tocco, una voce. */
@Injectable({ providedIn: 'root' })
export class JournalService {
  private readonly repository = inject(JournalRepository);

  private readonly entriesState = signal<readonly JournalEntry[]>([]);
  readonly entries = this.entriesState.asReadonly();

  async init(): Promise<void> {
    this.entriesState.set(await this.repository.load());
  }

  async addCaffeine(drink: CaffeineDrink, at: Date): Promise<JournalEntry> {
    return this.add({ id: newId(), at: at.toISOString(), kind: 'caffeine', drink });
  }

  async addAlcohol(drink: AlcoholDrink, at: Date): Promise<JournalEntry> {
    return this.add({ id: newId(), at: at.toISOString(), kind: 'alcohol', drink });
  }

  /** Restituisce null se il testo è vuoto: una nota vuota non si registra. */
  async addNote(text: string, at: Date): Promise<JournalEntry | null> {
    const trimmed = text.trim().slice(0, MAX_NOTE_LENGTH);
    if (trimmed === '') {
      return null;
    }
    return this.add({ id: newId(), at: at.toISOString(), kind: 'note', text: trimmed });
  }

  /** Toglie una voce: serve per «Annulla» subito dopo un tocco sbagliato. */
  async remove(id: string): Promise<void> {
    const next = this.entriesState().filter((e) => e.id !== id);
    if (next.length === this.entriesState().length) {
      return;
    }
    this.entriesState.set(next);
    await this.repository.save(next);
  }

  /**
   * Aggiunge le voci che il telefono non ha ancora (per id): quelle del server o quelle delle abitudini. Quelle già
   * presenti restano come sono. Restituisce quelle aggiunte.
   */
  async restore(entries: readonly JournalEntry[]): Promise<JournalEntry[]> {
    const known = new Set(this.entriesState().map((e) => e.id));
    const added = entries.filter((e) => !known.has(e.id));
    if (added.length > 0) {
      const next = [...this.entriesState(), ...added];
      this.entriesState.set(next);
      await this.repository.save(next);
    }
    return added;
  }

  private async add(entry: JournalEntry): Promise<JournalEntry> {
    const next = [...this.entriesState(), entry];
    this.entriesState.set(next);
    await this.repository.save(next);
    return entry;
  }
}
