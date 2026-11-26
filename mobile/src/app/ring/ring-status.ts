const TIME = new Intl.DateTimeFormat('it-IT', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome' });
const DAY = new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'long', timeZone: 'Europe/Rome' });
const DAY_KEY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' });

/** «Sincronizzato alle 07:41», «ieri alle 22:10» o «il 3 novembre alle 22:10». */
export function syncedText(at: number, now: Date): string {
  const when = new Date(at);
  const time = TIME.format(when);
  const key = DAY_KEY.format(when);
  if (key === DAY_KEY.format(now)) {
    return `Sincronizzato alle ${time}`;
  }
  if (key === DAY_KEY.format(new Date(now.getTime() - 24 * 60 * 60 * 1000))) {
    return `Sincronizzato ieri alle ${time}`;
  }
  return `Sincronizzato il ${DAY.format(when)} alle ${time}`;
}

/**
 * Lo stato del server quando non risponde (docs/adr/0043): «Server di casa non raggiungibile: dati di ieri alle 22:10.»
 * Senza dati salvati lo dice.
 */
export function serverNoteText(fetchedAt: number | null, now: Date): string {
  if (fetchedAt === null) {
    return 'Server di casa non raggiungibile: nessun dato salvato sul telefono.';
  }
  const when = syncedText(fetchedAt, now).replace(/^Sincronizzato /, '');
  return `Server di casa non raggiungibile: dati scaricati ${when}.`;
}
