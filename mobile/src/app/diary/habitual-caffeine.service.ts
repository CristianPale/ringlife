import { Injectable, inject, signal } from '@angular/core';
import { KeyValueStore, PLAIN_STORE } from '../api/key-value-store';
import { SettingsService } from '../settings/settings.service';
import { Clock, SystemClock } from './clock';
import { HABIT_BACKFILL_DAYS, HabitualCaffeine, dueHabitEntries, habitEntryDay, localDayKey, newHabitId } from './habits';
import { JournalService } from './journal.service';
import { CaffeineDrink } from './journal.model';

const SKIPPED_KEY = 'journal-habit-skips.v1';
/** Le voci tolte si ricordano un po' più a lungo dei giorni che si recuperano: oltre non tornerebbero comunque. */
const SKIPPED_KEEP_DAYS = HABIT_BACKFILL_DAYS + 7;

/**
 * La caffeina abituale (docs/adr/0036): ogni giorno, passata l'ora, il Diario ha la voce dell'abitudine senza un tocco.
 * Le voci sono voci vere del diario, con un id fisso per abitudine e giorno: vanno al server come le altre e contano
 * per il plugin Emicrania. Tolta dal Diario, la voce di quel giorno non torna.
 */
@Injectable({ providedIn: 'root' })
export class HabitualCaffeineService {
  private readonly settings = inject(SettingsService);
  private readonly journal = inject(JournalService);
  private readonly clock = inject(Clock, { optional: true }) ?? new SystemClock();
  private readonly store = inject<KeyValueStore>(PLAIN_STORE, { optional: true });
  private readonly skipped = signal<ReadonlySet<string>>(new Set());

  readonly habits = () => this.settings.settings().habitualCaffeine;

  async init(): Promise<void> {
    try {
      const raw = await this.store?.get(SKIPPED_KEY);
      const list = raw ? (JSON.parse(raw) as unknown) : [];
      this.skipped.set(new Set(Array.isArray(list) ? list.filter((id): id is string => typeof id === 'string') : []));
    } catch {
      this.skipped.set(new Set());
    }
  }

  /** Aggiunge al diario le voci delle abitudini che mancano fino ad adesso. Restituisce quante. */
  async apply(now: Date = this.clock.now()): Promise<number> {
    const known = new Set(this.journal.entries().map((e) => e.id));
    const due = dueHabitEntries(this.habits(), known, this.skipped(), now);
    if (due.length === 0) {
      return 0;
    }
    return (await this.journal.restore(due)).length;
  }

  /** Nuova abitudine: conta da oggi, e se l'ora è già passata la voce di oggi c'è subito. */
  async add(drink: CaffeineDrink, time: string): Promise<void> {
    const habits = this.habits();
    const habit: HabitualCaffeine = { id: newHabitId(habits), drink, time, since: localDayKey(this.clock.now()) };
    await this.settings.update({ habitualCaffeine: [...habits, habit] });
    await this.apply();
  }

  /** Toglie l'abitudine. Le voci già nel diario restano: sono quello che hai bevuto. */
  async remove(habitId: string): Promise<void> {
    await this.settings.update({ habitualCaffeine: this.habits().filter((h) => h.id !== habitId) });
  }

  /** Toglie dal diario la voce abituale di un giorno («oggi no») e se lo ricorda, così non torna. */
  async skip(entryId: string): Promise<void> {
    const keepFrom = localDayKey(new Date(this.clock.now().getTime() - SKIPPED_KEEP_DAYS * 86_400_000));
    const next = new Set([...this.skipped(), entryId].filter((id) => (habitEntryDay(id) ?? '') >= keepFrom));
    this.skipped.set(next);
    await this.store?.set(SKIPPED_KEY, JSON.stringify([...next]));
    await this.journal.remove(entryId);
  }
}
