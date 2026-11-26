import { Injectable } from '@angular/core';
import { BleClient } from '@capacitor-community/bluetooth-le';
import { classifyBleError } from './capacitor-ring-link';

/** Com'è il Bluetooth per questa app: permesso dato, permesso negato, o Bluetooth spento. */
export type BluetoothState = 'granted' | 'denied' | 'off';

/**
 * Il permesso Bluetooth, chiesto da solo (docs/adr/0022). Su iOS il primo `initialize` fa comparire la richiesta di
 * sistema e risponde quando l'utente ha scelto; poi `isEnabled` dice se il Bluetooth è acceso. Dietro una classe
 * astratta: nei test e nel browser non c'è Bluetooth.
 */
@Injectable({ providedIn: 'root', useFactory: () => new CapacitorBluetoothAccess() })
export abstract class BluetoothAccess {
  /** Chiede il permesso se serve e aspetta la risposta. Non lancia: il risultato è sempre uno stato. */
  abstract request(): Promise<BluetoothState>;
  /** Apre le impostazioni giuste: quelle dell'app se il permesso è negato, quelle del Bluetooth se è spento. */
  abstract openSettings(state: Exclude<BluetoothState, 'granted'>): Promise<void>;
}

export class CapacitorBluetoothAccess extends BluetoothAccess {
  async request(): Promise<BluetoothState> {
    try {
      await BleClient.initialize();
      return (await BleClient.isEnabled()) ? 'granted' : 'off';
    } catch (error) {
      return classifyBleError(error) === 'bluetooth_off' ? 'off' : 'denied';
    }
  }

  async openSettings(state: Exclude<BluetoothState, 'granted'>): Promise<void> {
    try {
      await (state === 'denied' ? BleClient.openAppSettings() : BleClient.openBluetoothSettings());
    } catch {
      // Su alcuni sistemi l'apertura non è disponibile: resta il testo che dice dove andare.
    }
  }
}
