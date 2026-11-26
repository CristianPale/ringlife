import { DayView } from '../api/api.model';
import { formatHours } from '../oggi/oggi.from-server';
import { QueuedNight } from '../ring/ring-queue.model';
import { dayName } from '../shared/day-history';
import { romeDay } from '../temperatura/temperatura.model';

/**
 * L'avviso di Sonno per una notte che l'anello ha dato e il server non ha ancora calcolato (docs/adr/0043): fuori casa,
 * o prima che il server risponda. `null` se il server ha già quella notte, o se i suoi risultati sono più recenti
 * dell'ultima lettura dell'anello.
 */
export function pendingNightText(
  night: QueuedNight | null,
  days: readonly DayView[],
  fetchedAt: number | null,
  lastReadAt: number | null,
  now: Date,
): string | null {
  if (!night) {
    return null;
  }
  const behind = fetchedAt === null || (lastReadAt !== null && lastReadAt > fetchedAt);
  const day = romeDay(night.end);
  if (!behind || days.some((d) => d.day === day && d.scores['sleep'])) {
    return null;
  }
  const name = dayName(day, now);
  const which =
    name === 'oggi' ? 'Stanotte' : `La notte finita ${name === 'ieri' ? 'ieri' : `il ${name}`}`;
  const amount =
    night.asleepMs !== null
      ? `${formatHours(night.asleepMs / 3_600_000)} di sonno`
      : `${formatHours((night.end - night.start) / 3_600_000)} a letto`;
  return `${which}: ${amount}, dall'anello. Il server di casa la calcolerà appena risponde: qui sotto c'è l'ultima notte calcolata.`;
}
