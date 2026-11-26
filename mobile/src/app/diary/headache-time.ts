const MINUTE_MS = 60_000;

/** Orario di inizio da un campo «HH:mm». Un orario nel futuro vale per il giorno prima (es. le 23:30 alle 00:10). */
export function resolveStart(time: string, now: Date): Date | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);
  if (!match) {
    return null;
  }
  const start = new Date(now);
  start.setHours(Number(match[1]), Number(match[2]), 0, 0);
  if (start.getTime() > now.getTime()) {
    start.setDate(start.getDate() - 1);
  }
  return start;
}

/** «07:44», nell'ora del telefono. */
export function formatClock(date: Date): string {
  return new Intl.DateTimeFormat('it-IT', { hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
}

/** «42 min» sotto l'ora, poi «1 h 12». Mai negativa. */
/** Minuti interi tra due istanti, mai negativi. */
export function minutesBetween(from: Date, to: Date): number {
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / MINUTE_MS));
}

export function formatDuration(from: Date, to: Date): string {
  const minutes = Math.max(0, Math.floor((to.getTime() - from.getTime()) / MINUTE_MS));
  if (minutes < 60) {
    return `${minutes} min`;
  }
  const hours = Math.floor(minutes / 60);
  return `${hours} h ${String(minutes % 60).padStart(2, '0')}`;
}

/** UUID v4. `crypto.randomUUID` manca su iOS prima della 15.4. */
export function newId(): string {
  // Il tipo dice che randomUUID c'è sempre; a runtime su iOS < 15.4 no.
  const randomUUID: (() => string) | undefined = crypto.randomUUID?.bind(crypto);
  if (randomUUID) {
    return randomUUID();
  }
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0'));
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10).join('')}`;
}
