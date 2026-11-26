import { BleClient, BleClientInterface, BleDevice } from '@capacitor-community/bluetooth-le';
import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import { RingDeviceInfo, decodeDeviceText } from '../ring-device.model';
import { RingError, RingErrorCode } from '../ring-source';
import { RingChannel, RingLink } from './ring-link';

/** UUID del protocollo (docs/protocol.md): sono gli stessi su ogni R09, non sono dati personali. */
const COMMAND_SERVICE = '6e40fff0-b5a3-f393-e0a9-e50e24dcca9e';
const COMMAND_WRITE = '6e400002-b5a3-f393-e0a9-e50e24dcca9e';
const COMMAND_NOTIFY = '6e400003-b5a3-f393-e0a9-e50e24dcca9e';
const BIG_SERVICE = 'de5bf728-d711-4e47-af26-65e3012a5dc7';
const BIG_WRITE = 'de5bf72a-d711-4e47-af26-65e3012a5dc7';
const BIG_NOTIFY = 'de5bf729-d711-4e47-af26-65e3012a5dc7';
/** Device Information (docs/protocol.md, Collegamento): firmware e hardware, testo in sola lettura (docs/adr/0030). */
const DEVICE_INFO_SERVICE = '0000180a-0000-1000-8000-00805f9b34fb';
const FIRMWARE_REVISION = '00002a26-0000-1000-8000-00805f9b34fb';
const HARDWARE_REVISION = '00002a27-0000-1000-8000-00805f9b34fb';

/** Il nome dell'anello comincia così (`COLMI Ring 2` sul nostro R09). */
const NAME_PREFIX = 'COLMI';
/** L'identificativo che il telefono dà all'anello: sta solo qui, mai nel repo né nei log. */
export const DEVICE_KEY = 'ring.device-id.v1';
/** Quanto si aspetta il collegamento: iOS aggancia l'anello appena lo sente, se è vicino (docs/adr/0027). */
export const CONNECT_TIMEOUT_MS = 10_000;
/** La ricerca per nome, quando l'anello non è collegato al sistema e l'identificativo salvato non basta. */
export const SCAN_MS = 6_000;
/** Dopo il primo anello sentito si ascolta ancora un po': ce ne possono essere altri vicini. */
export const SETTLE_MS = 2_000;
/** Quanto si aspetta la scelta nella finestra dell'app. La finestra stessa si chiude da sola a questo tempo. */
export const CHOOSE_TIMEOUT_MS = 60_000;
/** Tetto per le chiamate al plugin che si chiudono da sole in pochi istanti (elenchi, scritture, notifiche). */
export const CALL_TIMEOUT_MS = 7_000;
/** Margine oltre il tempo del plugin: se il plugin non risponde affatto, il collegamento finisce lo stesso. */
const GRACE_MS = 2_000;
/**
 * Servizi standard: Generic Access, Device Information, batteria, HID (i gesti). Servono a trovare l'anello già
 * collegato a iOS quando il sistema non lo restituisce per i suoi servizi.
 */
const GENERIC_SERVICES = [
  '00001800-0000-1000-8000-00805f9b34fb',
  '0000180a-0000-1000-8000-00805f9b34fb',
  '0000180f-0000-1000-8000-00805f9b34fb',
  '00001812-0000-1000-8000-00805f9b34fb',
];

/** Le chiamate del plugin che servono: il plugin vero (`BleClient`) o, nei test, un finto. */
export type BleApi = Pick<
  BleClientInterface,
  | 'initialize'
  | 'isEnabled'
  | 'getDevices'
  | 'getConnectedDevices'
  | 'requestLEScan'
  | 'stopLEScan'
  | 'connect'
  | 'disconnect'
  | 'startNotifications'
  | 'writeWithoutResponse'
  | 'read'
>;

/** Dove sta l'identificativo dell'anello. Lo legge anche la lettura in background (`RingCollector.swift`). */
export interface RingIdStore {
  get(): Promise<string | null>;
  set(id: string): Promise<void>;
}

/** Un anello sentito nella ricerca. `rssi` è la forza del segnale in dBm (più alta = più vicino), se il sistema la dà. */
export interface RingCandidate {
  id: string;
  name: string;
  rssi: number | null;
}

/**
 * Cosa chiedere a chi usa l'app: quale anello tra quelli sentiti (`rings`, dal segnale più forte), e se l'anello salvato
 * manca (`replacing`). Restituisce l'identificativo scelto, o `null` se non ne sceglie nessuno.
 */
export type RingChooser = (choice: { rings: readonly RingCandidate[]; replacing: boolean }) => Promise<string | null>;

/** Senza una finestra (test, nessuna interfaccia): non si sceglie al posto di nessuno. */
const noChoice: RingChooser = async () => null;

const preferencesIds: RingIdStore = {
  get: async () => (await Preferences.get({ key: DEVICE_KEY })).value,
  set: (id) => Preferences.set({ key: DEVICE_KEY, value: id }),
};

/** Il testo di un errore del plugin → il nostro codice. Il plugin non ha codici stabili: si legge il messaggio. */
export function classifyBleError(error: unknown): RingErrorCode {
  const text = String((error as { message?: string })?.message ?? error).toLowerCase();
  if (text.includes('permission') || text.includes('not authorized') || text.includes('denied')) {
    return 'permission_denied';
  }
  if (text.includes('not enabled') || text.includes('powered off') || text.includes('bluetooth is off') || text.includes('disabled')) {
    return 'bluetooth_off';
  }
  if (text.includes('not connected') || text.includes('disconnected')) {
    return 'disconnected';
  }
  if (text.includes('timeout') || text.includes('timed out')) {
    return 'connection_timeout';
  }
  if (text.includes('cancel') || text.includes('not found') || text.includes('no device')) {
    return 'ring_not_found';
  }
  return 'unknown';
}

function toRingError(error: unknown): RingError {
  return error instanceof RingError ? error : new RingError(classifyBleError(error));
}

/** Errori dopo i quali non ha senso provare la strada successiva: valgono per qualunque anello. */
function isFatal(error: RingError): boolean {
  return error.code === 'permission_denied' || error.code === 'bluetooth_off';
}

/** Una chiamata al plugin con un tetto di tempo: una promessa del plugin che non si chiude non blocca la lettura. */
function bounded<T>(work: Promise<T>, ms: number, detail: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new RingError('connection_timeout', detail)), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

const bytes = (v: DataView) => new Uint8Array(v.buffer, v.byteOffset, v.byteLength).slice();

/**
 * Il Bluetooth vero, con `@capacitor-community/bluetooth-le`. Da provare su un telefono: il simulatore non ha Bluetooth.
 * Come trova l'anello e quanto aspetta: docs/adr/0027.
 */
export class CapacitorRingLink extends RingLink {
  private deviceId: string | null = null;
  private initialized = false;
  /** Cresce a ogni collegamento e scollegamento: un avviso di scollegamento di un collegamento vecchio non conta. */
  private session = 0;
  /** L'anello a cui ci si sta collegando: un annullamento lo scollega. */
  private pendingId: string | null = null;
  /** Ferma la ricerca in corso, se c'è. */
  private stopScan: (() => void) | null = null;
  /** Si rifiuta con `cancelled` al primo `disconnect` dopo `connect`: chiude subito un collegamento in sospeso. */
  private abort: { promise: Promise<never>; fire: () => void } | null = null;
  /** L'ultima scelta nella finestra: il secondo tentativo della stessa lettura non la richiede. */
  private chosen: string | null = null;

  private readonly ble: BleApi;
  private readonly ids: RingIdStore;
  private readonly choose: RingChooser;

  constructor(options: { ble?: BleApi; ids?: RingIdStore; choose?: RingChooser } = {}) {
    super();
    this.ble = options.ble ?? BleClient;
    this.ids = options.ids ?? preferencesIds;
    this.choose = options.choose ?? noChoice;
  }

  async connect(onNotify: (channel: RingChannel, data: Uint8Array) => void, onLost?: () => void): Promise<void> {
    await this.disconnect();
    const session = this.session;
    let fire: () => void = () => undefined;
    const promise = new Promise<never>((_, reject) => (fire = () => reject(new RingError('cancelled'))));
    // Nessuno la aspetta fuori da un collegamento: il suo rifiuto non deve risultare «non gestito».
    promise.catch(() => undefined);
    this.abort = { promise, fire };
    try {
      if (!this.initialized) {
        await bounded(this.ble.initialize(), CALL_TIMEOUT_MS, 'Bluetooth non pronto');
        this.initialized = true;
      }
      if (!(await bounded(this.ble.isEnabled(), CALL_TIMEOUT_MS, 'Bluetooth non pronto'))) {
        throw new RingError('bluetooth_off');
      }
      const id = await this.open(session, onLost);
      this.stopIfCancelled(session);
      await bounded(
        this.ble.startNotifications(id, COMMAND_SERVICE, COMMAND_NOTIFY, (v) => onNotify('command', bytes(v))),
        CALL_TIMEOUT_MS,
        'notifiche non attivate',
      );
      await bounded(
        this.ble.startNotifications(id, BIG_SERVICE, BIG_NOTIFY, (v) => onNotify('big', bytes(v))),
        CALL_TIMEOUT_MS,
        'notifiche non attivate',
      );
    } catch (error) {
      await this.disconnect();
      throw toRingError(error);
    }
  }

  /**
   * Trova l'anello e si collega, in quest'ordine: 1) già collegato al sistema (Impostazioni › Bluetooth, i gesti, un'altra
   * app): non si annuncia e una ricerca non lo vedrebbe, ma il sistema lo restituisce per servizio; 2) l'identificativo
   * salvato, che iOS aggancia appena sente l'anello; 3) una ricerca per nome, a tempo, con la scelta in una finestra
   * quando non è ovvio quale anello sia (`pick`). L'identificativo salvato cambia solo dopo un collegamento riuscito a
   * un anello diverso: un errore non lo cancella.
   */
  private async open(session: number, onLost?: () => void): Promise<string> {
    const known = await this.ids.get().catch(() => null);
    let failure: RingError | null = null;

    const attached = await this.attachedToSystem(known);
    this.stopIfCancelled(session);
    if (attached) {
      failure = await this.tryAttach(attached, session, onLost);
      if (!failure) {
        return this.remember(attached, known);
      }
      this.stopIfCancelled(session);
    }
    // Dopo un riavvio dell'app il plugin non conosce l'anello: `getDevices` glielo fa conoscere, senza ricerca. Un
    // collegamento non riuscito qui non dice che l'anello c'è: può essere lontano.
    if (known && known !== attached && (await this.knownToSystem(known))) {
      this.stopIfCancelled(session);
      if (!(await this.tryAttach(known, session, onLost))) {
        return known;
      }
    }
    this.stopIfCancelled(session);
    const heard = await this.scan(known);
    this.stopIfCancelled(session);
    const found = await this.pick(heard, known);
    this.stopIfCancelled(session);
    if (found) {
      failure = await this.tryAttach(found, session, onLost);
      if (!failure) {
        return this.remember(found, known);
      }
    }
    this.stopIfCancelled(session);
    if (attached || found) {
      const detail = failure && failure.message !== failure.code ? `: ${failure.message}` : '';
      throw new RingError('connection_timeout', `collegamento non riuscito${detail}`);
    }
    throw new RingError('ring_not_found', heard.length > 0 ? 'nessun anello scelto' : `non visto in ${SCAN_MS / 1000} s di ricerca`);
  }

  /**
   * Quale anello tra quelli sentiti. L'anello salvato, se c'è. Senza anello salvato e con uno solo sentito, quello. Negli
   * altri casi si chiede: due o più anelli vicini, o un anello diverso da quello salvato (i suoi dati finirebbero nello
   * storico di chi usa l'app).
   */
  private async pick(heard: readonly RingCandidate[], known: string | null): Promise<string | null> {
    if (heard.length === 0) {
      return null;
    }
    if (known && heard.some((r) => r.id === known)) {
      return known;
    }
    if (!known && heard.length === 1) {
      return heard[0].id;
    }
    if (this.chosen && heard.some((r) => r.id === this.chosen)) {
      return this.chosen;
    }
    const rings = [...heard].sort((a, b) => (b.rssi ?? -999) - (a.rssi ?? -999));
    const chosen = await bounded(this.choose({ rings, replacing: known !== null }), CHOOSE_TIMEOUT_MS + GRACE_MS, 'scelta').catch(() => null);
    this.chosen = rings.some((r) => r.id === chosen) ? chosen : null;
    return this.chosen;
  }

  /**
   * `null` se il collegamento è riuscito, altrimenti perché no, con il testo del plugin: dice se il collegamento è
   * scaduto o se il sistema l'ha rifiutato. Permesso negato e Bluetooth spento si lanciano.
   */
  private async tryAttach(id: string, session: number, onLost?: () => void): Promise<RingError | null> {
    try {
      await this.attach(id, session, onLost);
      return null;
    } catch (error) {
      const ringError = toRingError(error);
      if (isFatal(ringError)) {
        throw ringError;
      }
      return error instanceof RingError ? error : new RingError(ringError.code, String((error as { message?: string })?.message ?? error));
    }
  }

  private async remember(id: string, known: string | null): Promise<string> {
    if (id !== known) {
      await this.ids.set(id).catch(() => undefined);
    }
    return id;
  }

  private async knownToSystem(id: string): Promise<boolean> {
    const devices = await bounded(this.ble.getDevices([id]), CALL_TIMEOUT_MS, 'elenco').catch(() => [] as BleDevice[]);
    return devices.some((d) => d.deviceId === id);
  }

  /** Si collega a `id`. Il plugin ha già un suo tempo massimo; il nostro, poco più lungo, vale se il plugin tace. */
  private async attach(id: string, session: number, onLost?: () => void): Promise<void> {
    this.pendingId = id;
    try {
      const connecting = this.ble.connect(id, (lost) => this.onDisconnect(lost, session, onLost), {
        timeout: CONNECT_TIMEOUT_MS,
        // Le notifiche si accendono anche senza conoscere i descrittori: meno scambi, meno occasioni di errore.
        skipDescriptorDiscovery: true,
      });
      await bounded(
        this.abort ? Promise.race([connecting, this.abort.promise]) : connecting,
        CONNECT_TIMEOUT_MS + GRACE_MS,
        'collegamento senza risposta',
      );
    } catch (error) {
      // Annulla un collegamento rimasto in sospeso; se non c'è, non fa niente.
      await bounded(this.ble.disconnect(id), CALL_TIMEOUT_MS, 'scollegamento').catch(() => undefined);
      throw error;
    } finally {
      this.pendingId = null;
    }
    if (session !== this.session) {
      // Annullato mentre si collegava: l'anello torna libero subito.
      await bounded(this.ble.disconnect(id), CALL_TIMEOUT_MS, 'scollegamento').catch(() => undefined);
      throw new RingError('cancelled');
    }
    this.deviceId = id;
  }

  private onDisconnect(id: string, session: number, onLost?: () => void): void {
    if (session !== this.session || id !== this.deviceId) {
      return;
    }
    this.deviceId = null;
    onLost?.();
  }

  /**
   * L'anello già collegato al sistema, per i suoi servizi e poi per i servizi standard. Si tiene solo l'identificativo
   * salvato o un nome `COLMI`: su Android l'elenco comprende ogni dispositivo collegato, qualunque servizio abbia.
   */
  private async attachedToSystem(known: string | null): Promise<string | null> {
    const own = await this.connectedTo([COMMAND_SERVICE, BIG_SERVICE]);
    const ownRing = own.find((d) => d.deviceId === known) ?? own.find((d) => !d.name || d.name.startsWith(NAME_PREFIX));
    if (ownRing) {
      return ownRing.deviceId;
    }
    const generic = await this.connectedTo(GENERIC_SERVICES);
    const ring = generic.find((d) => d.deviceId === known) ?? generic.find((d) => (d.name ?? '').startsWith(NAME_PREFIX));
    return ring?.deviceId ?? null;
  }

  private connectedTo(services: string[]): Promise<BleDevice[]> {
    return bounded(this.ble.getConnectedDevices(services), CALL_TIMEOUT_MS, 'elenco').catch(() => [] as BleDevice[]);
  }

  /**
   * Ricerca per nome, al massimo `SCAN_MS`: gli anelli `COLMI` sentiti. Dopo il primo si ascolta ancora `SETTLE_MS`, per
   * sapere se ce ne sono altri; se si sente l'anello salvato si smette subito. Si ferma sempre.
   */
  private async scan(known: string | null): Promise<RingCandidate[]> {
    const heard = new Map<string, RingCandidate>();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await new Promise<void>((resolve, reject) => {
        // Un annullamento ferma la ricerca subito (`disconnect`).
        this.stopScan = resolve;
        timer = setTimeout(resolve, SCAN_MS);
        bounded(
          this.ble.requestLEScan({ namePrefix: NAME_PREFIX }, (result) => {
            const id = result.device.deviceId;
            if (heard.has(id)) {
              return;
            }
            heard.set(id, { id, name: result.localName ?? result.device.name ?? 'Anello', rssi: result.rssi ?? null });
            if (id === known) {
              resolve();
            } else if (heard.size === 1) {
              clearTimeout(timer);
              timer = setTimeout(resolve, SETTLE_MS);
            }
          }),
          CALL_TIMEOUT_MS,
          'ricerca',
        ).catch(reject);
      });
    } catch (error) {
      const ringError = toRingError(error);
      if (isFatal(ringError)) {
        throw ringError;
      }
    } finally {
      clearTimeout(timer);
      this.stopScan = null;
      await bounded(this.ble.stopLEScan(), CALL_TIMEOUT_MS, 'ricerca').catch(() => undefined);
    }
    return [...heard.values()];
  }

  /**
   * Nome dal sistema, firmware e hardware da Device Information (docs/adr/0030). Ogni lettura che non riesce resta `null`
   * e non ferma niente. L'indirizzo MAC c'è solo su Android, dove è l'identificativo stesso; iOS non lo dà alle app.
   */
  override async deviceInfo(): Promise<RingDeviceInfo> {
    const id = this.deviceId;
    if (!id) {
      throw new RingError('unknown');
    }
    const known = await bounded(this.ble.getDevices([id]), CALL_TIMEOUT_MS, 'nome non letto').catch(() => [] as BleDevice[]);
    return {
      name: known[0]?.name || null,
      firmware: await this.readText(id, FIRMWARE_REVISION),
      hardware: await this.readText(id, HARDWARE_REVISION),
      address: Capacitor.getPlatform() === 'android' ? id : null,
    };
  }

  private async readText(id: string, characteristic: string): Promise<string | null> {
    try {
      const view = await bounded(
        this.ble.read(id, DEVICE_INFO_SERVICE, characteristic, { timeout: CALL_TIMEOUT_MS }),
        CALL_TIMEOUT_MS + GRACE_MS,
        'Device Information non letto',
      );
      return decodeDeviceText(bytes(view));
    } catch {
      return null;
    }
  }

  async send(channel: RingChannel, data: Uint8Array): Promise<void> {
    const id = this.deviceId;
    if (!id) {
      throw new RingError('disconnected');
    }
    const [service, characteristic] = channel === 'command' ? [COMMAND_SERVICE, COMMAND_WRITE] : [BIG_SERVICE, BIG_WRITE];
    try {
      await bounded(
        this.ble.writeWithoutResponse(id, service, characteristic, new DataView(data.buffer, data.byteOffset, data.byteLength)),
        CALL_TIMEOUT_MS,
        'scrittura senza risposta',
      );
    } catch (error) {
      throw toRingError(error);
    }
  }

  /**
   * Scollega. Chiamato durante un collegamento lo annulla (docs/adr/0043): ferma la ricerca, annulla il collegamento in
   * sospeso, e `connect` finisce con `cancelled`.
   */
  async disconnect(): Promise<void> {
    const id = this.deviceId;
    const pending = this.pendingId;
    this.deviceId = null;
    this.session++;
    this.stopScan?.();
    this.abort?.fire();
    this.abort = null;
    if (pending && pending !== id) {
      await bounded(this.ble.disconnect(pending), CALL_TIMEOUT_MS, 'scollegamento').catch(() => undefined);
    }
    if (id) {
      // Già scollegato, o il plugin non risponde: in entrambi i casi si va avanti.
      await bounded(this.ble.disconnect(id), CALL_TIMEOUT_MS, 'scollegamento').catch(() => undefined);
    }
  }

  /** Dopo un `disconnect` arrivato durante il collegamento non si fa il passo dopo. */
  private stopIfCancelled(session: number): void {
    if (session !== this.session) {
      throw new RingError('cancelled');
    }
  }
}
