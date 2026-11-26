import { Injectable } from '@angular/core';
import { Preferences } from '@capacitor/preferences';
import { DEVICE_KEY } from './ble/capacitor-ring-link';
import { EMPTY_DEVICE_STATE, RingDeviceState, normalizeDevice } from './ring-device.model';

/** Archivio locale di ciò che il telefono sa dell'anello (docs/adr/0030). */
export abstract class RingDeviceRepository {
  abstract load(): Promise<RingDeviceState>;
  abstract save(state: RingDeviceState): Promise<void>;
  /** Dimentica l'identificativo che il sistema dà all'anello: la volta dopo l'app lo cerca di nuovo per nome (docs/adr/0027). */
  abstract forgetPairing(): Promise<void>;
}

const DEVICE_INFO_KEY = 'ring-device.v1';
/**
 * Chiave a sé, testo semplice: la legge anche il raccoglitore nativo in background (`RingCollector.swift`, come
 * `CapacitorStorage.ring.unlinked.v1`) per non collegarsi a un anello scollegato.
 */
export const UNLINKED_KEY = 'ring.unlinked.v1';

@Injectable()
export class PreferencesRingDeviceRepository extends RingDeviceRepository {
  async load(): Promise<RingDeviceState> {
    const [{ value: info }, { value: unlinked }] = await Promise.all([
      Preferences.get({ key: DEVICE_INFO_KEY }),
      Preferences.get({ key: UNLINKED_KEY }),
    ]);
    let device = null;
    try {
      device = info ? normalizeDevice(JSON.parse(info)) : null;
    } catch {
      device = null;
    }
    return { ...EMPTY_DEVICE_STATE, device, unlinked: unlinked === 'true' };
  }

  async save(state: RingDeviceState): Promise<void> {
    await (state.device
      ? Preferences.set({ key: DEVICE_INFO_KEY, value: JSON.stringify(state.device) })
      : Preferences.remove({ key: DEVICE_INFO_KEY }));
    await (state.unlinked ? Preferences.set({ key: UNLINKED_KEY, value: 'true' }) : Preferences.remove({ key: UNLINKED_KEY }));
  }

  async forgetPairing(): Promise<void> {
    await Preferences.remove({ key: DEVICE_KEY });
  }
}

/** Solo per i test: archivio in memoria. */
export class InMemoryRingDeviceRepository extends RingDeviceRepository {
  saved: RingDeviceState[] = [];
  pairingForgotten = 0;

  constructor(private stored: RingDeviceState = EMPTY_DEVICE_STATE) {
    super();
  }

  async load(): Promise<RingDeviceState> {
    return this.stored;
  }

  async save(state: RingDeviceState): Promise<void> {
    this.stored = state;
    this.saved.push(state);
  }

  async forgetPairing(): Promise<void> {
    this.pairingForgotten++;
  }
}
