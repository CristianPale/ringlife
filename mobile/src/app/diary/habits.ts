import { CaffeineDrink, CaffeineEntry } from './journal.model';

/**
 * Una bevanda con caffeina presa ogni giorno alla stessa ora (docs/adr/0036): il Diario la segna da solo. `id` è breve e
 * stabile, entra negli id delle voci; `since` è il primo giorno che conta (`2026-11-22`, giorno del telefono): i giorni
 * prima non si toccano.
 */
export interface HabitualCaffeine {
  id: string;
  drink: CaffeineDrink;
  /** «HH:mm», ora del telefono. */
  time: string;
  since: string;
}

/** Quante abitudini al massimo: bastano per un caffè a colazione, uno a pranzo e uno nel pomeriggio, con margine. */
export const MAX_HABITS = 6;
/** Quanti giorni indietro si recuperano le voci mancanti, se l'app non è stata aperta: le letture dell'anello ne coprono 7. */
export const HABIT_BACKFILL_DAYS = 14;

const PREFIX = 'habit-';
const HABIT_ID = /^[a-z0-9]{1,8}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const DRINKS: readonly string[] = ['coffee', 'tea', 'energy', 'other'];

/** Giorno del telefono, `2026-11-22`. */
export function localDayKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** L'id della voce di un'abitudine in un giorno: `habit-<id>-20261122`. Lo stesso su ogni telefono e a ogni apertura. */
export function habitEntryId(habitId: string, day: string): string {
  return `${PREFIX}${habitId}-${day.replaceAll('-', '')}`;
}

/** La voce viene da un'abitudine, non da un tocco. */
export function isHabitual(entryId: string): boolean {
  return entryId.startsWith(PREFIX);
}

/** Il giorno di una voce abituale, `2026-11-22`; `null` se l'id non è di un'abitudine. */
export function habitEntryDay(entryId: string): string | null {
  const match = /^habit-[a-z0-9]{1,8}-(\d{4})(\d{2})(\d{2})$/.exec(entryId);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

/** Un id nuovo per un'abitudine, diverso da quelli esistenti. */
export function newHabitId(existing: readonly HabitualCaffeine[], random: () => number = Math.random): string {
  const used = new Set(existing.map((h) => h.id));
  for (;;) {
    const id = Math.floor(random() * 36 ** 6)
      .toString(36)
      .padStart(6, '0');
    if (!used.has(id)) {
      return id;
    }
  }
}

/** Controlla le abitudini lette dall'archivio: quelle illeggibili si scartano, senza doppioni di id. */
export function normalizeHabits(value: unknown): HabitualCaffeine[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const out: HabitualCaffeine[] = [];
  for (const raw of value) {
    const h = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
    if (
      typeof h['id'] === 'string' &&
      HABIT_ID.test(h['id']) &&
      typeof h['drink'] === 'string' &&
      DRINKS.includes(h['drink']) &&
      typeof h['time'] === 'string' &&
      TIME.test(h['time']) &&
      typeof h['since'] === 'string' &&
      DAY.test(h['since']) &&
      !out.some((o) => o.id === h['id'])
    ) {
      out.push({ id: h['id'], drink: h['drink'] as CaffeineDrink, time: h['time'], since: h['since'] });
    }
  }
  return out.slice(0, MAX_HABITS);
}

/**
 * Le voci delle abitudini che mancano fino a `now`: per ogni giorno da `since` (al massimo 14 giorni indietro) la cui
 * ora è passata, se il diario non ha già la voce e se non è stata tolta per quel giorno.
 */
export function dueHabitEntries(
  habits: readonly HabitualCaffeine[],
  known: ReadonlySet<string>,
  skipped: ReadonlySet<string>,
  now: Date,
): CaffeineEntry[] {
  const due: CaffeineEntry[] = [];
  for (const habit of habits) {
    const [hours, minutes] = habit.time.split(':').map(Number);
    for (let back = HABIT_BACKFILL_DAYS - 1; back >= 0; back--) {
      const at = new Date(now.getFullYear(), now.getMonth(), now.getDate() - back, hours, minutes);
      const day = localDayKey(at);
      const id = habitEntryId(habit.id, day);
      if (day < habit.since || at.getTime() > now.getTime() || known.has(id) || skipped.has(id)) {
        continue;
      }
      due.push({ id, at: at.toISOString(), kind: 'caffeine', drink: habit.drink });
    }
  }
  return due.sort((a, b) => a.at.localeCompare(b.at));
}
