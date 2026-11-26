import { RingDeviceInfo } from '../ring-device.model';

/** I due canali dell'anello (docs/protocol.md): comandi da 16 byte, e canale lungo (`bc ...`, usato per il sonno). */
export type RingChannel = 'command' | 'big';

/**
 * Il collegamento all'anello, senza sapere cosa si dicono: manda byte, riceve notifiche. Dietro questa interfaccia sta
 * il Bluetooth vero (`CapacitorRingLink`); nei test, una finta.
 */
export abstract class RingLink {
  /**
   * Si collega e inizia ad ascoltare le notifiche di entrambi i canali. Lancia `RingError`. `onLost` si chiama se
   * l'anello si scollega da solo, mai dopo `disconnect`.
   */
  abstract connect(onNotify: (channel: RingChannel, data: Uint8Array) => void, onLost?: () => void): Promise<void>;
  abstract send(channel: RingChannel, data: Uint8Array): Promise<void>;
  /** Sempre sicuro da chiamare, anche se non si è collegati. */
  abstract disconnect(): Promise<void>;
  /** Chi è l'anello collegato (docs/adr/0030). Di base non si sa: il collegamento che lo sa leggere lo ridefinisce. */
  deviceInfo(): Promise<RingDeviceInfo> {
    return Promise.resolve({ name: null, firmware: null, hardware: null, address: null });
  }
}
