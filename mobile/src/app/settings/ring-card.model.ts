import { RingDevice, firmwareLabel, firmwareNote } from '../ring/ring-device.model';
import { LastReading } from '../ring/ring-queue.model';
import { syncedText } from '../ring/ring-status';
import { Wear, WearFinger, WearHand } from './settings.model';

/**
 * Gli stati della scheda dell'anello (docs/adr/0030). L'app non tiene l'anello collegato: «collegato» vuol dire che
 * RingLife lo legge, e l'ultima lettura è riuscita.
 */
export type RingCardState = 'connected' | 'unreachable' | 'unlinked' | 'none' | 'demo' | 'web';
export type RingCardAction = 'disconnect' | 'reconnect' | 'connect';

export interface RingCardInput {
  /** Sul telefono (il browser non ha Bluetooth). */
  native: boolean;
  demo: boolean;
  linked: boolean;
  device: RingDevice | null;
  last: LastReading | null;
  /** Messaggio dell'ultimo errore dell'anello, `null` se l'ultima lettura è andata bene. */
  ringError: string | null;
  wear: Wear;
  now: Date;
}

/** Una riga della scheda. `mono`: è un valore letto (voce dei numeri), non una frase. */
export interface RingCardRow {
  label: string;
  value: string;
  mono: boolean;
}

export interface RingCardView {
  state: RingCardState;
  title: string;
  status: string;
  rows: RingCardRow[];
  /** Firmware, errore o cosa succede adesso. */
  note: string | null;
  action: { kind: RingCardAction; label: string } | null;
  /** Cosa fa il pulsante, sotto il pulsante. */
  hint: string | null;
  /** «Usa un altro anello»: solo da scollegato. */
  canForget: boolean;
}

const HAND: Record<WearHand, string> = { left: 'sinistro', right: 'destro' };
const FINGER: Record<WearFinger, string> = { index: 'indice', middle: 'medio', ring: 'anulare' };

/** «indice sinistro», «anulare destro». */
export function wearLabel(wear: Pick<Wear, 'hand' | 'finger'>): string {
  return `${FINGER[wear.finger]} ${HAND[wear.hand]}`;
}

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

function deviceRows(device: RingDevice, input: RingCardInput, withBattery: boolean): RingCardRow[] {
  const firmware = firmwareLabel(device.firmware);
  const rows: RingCardRow[] = [
    { label: 'Firmware', value: firmware ?? 'non ancora letto', mono: firmware !== null },
    // iOS non dà l'indirizzo delle periferiche alle app: c'è solo su Android.
    { label: 'Indirizzo (MAC)', value: device.address ?? 'iPhone non lo mostra alle app', mono: device.address !== null },
  ];
  if (withBattery && input.last?.battery != null) {
    rows.push({ label: 'Batteria', value: `${input.last.battery}%`, mono: true });
  }
  rows.push({ label: 'Al dito', value: wearLabel(input.wear), mono: false });
  return rows;
}

export function describeRingCard(input: RingCardInput): RingCardView {
  const empty = { rows: [], note: null, action: null, hint: null, canForget: false };
  if (input.demo) {
    return {
      ...empty,
      state: 'demo',
      title: 'Anello di prova',
      status: 'Dati inventati, non tuoi',
      note: "Per leggere l'anello vero spegni «Anello di prova» nella sezione Anello.",
    };
  }
  if (!input.native) {
    return {
      ...empty,
      state: 'web',
      title: 'Anello',
      status: "Nel browser l'anello non si legge",
      note: "Collegalo dall'app sul telefono: qui vedi i dati che arrivano dal server.",
    };
  }
  const device = input.device;
  if (device && !input.linked) {
    return {
      ...empty,
      state: 'unlinked',
      title: device.name ?? 'Anello',
      status: 'Scollegato da RingLife',
      rows: deviceRows(device, input, false),
      note: 'RingLife non lo legge, nemmeno in background, finché non tocchi Riconnetti.',
      action: { kind: 'reconnect', label: 'Riconnetti' },
      canForget: true,
    };
  }
  if (device && input.ringError) {
    return {
      ...empty,
      state: 'unreachable',
      title: device.name ?? 'Anello',
      status: "Non raggiunto all'ultima lettura",
      rows: deviceRows(device, input, false),
      note: input.ringError,
      action: { kind: 'reconnect', label: 'Riconnetti' },
    };
  }
  if (device) {
    const synced = input.last ? ` · ${lowerFirst(syncedText(input.last.at, input.now))}` : '';
    return {
      ...empty,
      state: 'connected',
      title: device.name ?? 'Anello',
      status: `Collegato${synced}`,
      rows: deviceRows(device, input, true),
      note: firmwareNote(device, input.now.getTime()),
      action: { kind: 'disconnect', label: 'Disconnetti' },
      hint: 'Disconnetti mette in pausa la lettura, anche in background, finché non lo riconnetti.',
    };
  }
  return {
    ...empty,
    state: 'none',
    title: 'Nessun anello collegato',
    status: input.ringError ? 'Collegamento non riuscito' : 'Collega il tuo anello per leggere i dati',
    note:
      input.ringError ??
      "Tienilo carico e vicino al telefono: l'app lo cerca per nome e, se ne sente più di uno, ti chiede quale.",
    action: { kind: 'connect', label: 'Collega dispositivo' },
  };
}
