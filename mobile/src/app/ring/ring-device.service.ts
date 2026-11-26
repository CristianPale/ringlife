import { Injectable, computed, inject, signal } from '@angular/core';
import { EMPTY_DEVICE_STATE, RingDeviceInfo, RingDeviceState, mergeDevice } from './ring-device.model';
import { RingDeviceRepository } from './ring-device.repository';

/**
 * Ciò che il telefono sa dell'anello vero (docs/adr/0030): chi è (nome, firmware, indirizzo) e se l'utente l'ha
 * scollegato da RingLife. Scollegato, l'app non lo legge, né all'apertura né in background, finché non si ricollega.
 */
@Injectable({ providedIn: 'root' })
export class RingDeviceService {
  private readonly repository = inject(RingDeviceRepository, { optional: true });
  private readonly state = signal<RingDeviceState>(EMPTY_DEVICE_STATE);

  /** L'anello visto l'ultima volta, `null` se l'app non ne ha mai letto uno (o l'ha dimenticato). */
  readonly device = computed(() => this.state().device);
  readonly linked = computed(() => !this.state().unlinked);

  async init(): Promise<void> {
    this.state.set((await this.repository?.load()) ?? EMPTY_DEVICE_STATE);
  }

  /** Una lettura riuscita: l'anello ha detto chi è. */
  async recordSeen(info: RingDeviceInfo, at: number): Promise<void> {
    await this.persist({ ...this.state(), device: mergeDevice(this.state().device, info, at) });
  }

  /** «Disconnetti»: l'anello resta ricordato ma l'app non lo legge più. */
  async unlink(): Promise<void> {
    await this.persist({ ...this.state(), unlinked: true });
  }

  /** «Riconnetti», o una ricerca dell'anello dall'assistente. */
  async relink(): Promise<void> {
    if (this.state().unlinked) {
      await this.persist({ ...this.state(), unlinked: false });
    }
  }

  /** «Usa un altro anello»: dimentica questo. La lettura dopo cerca l'anello per nome e, se ne sente più di uno, chiede quale. */
  async forget(): Promise<void> {
    await this.repository?.forgetPairing();
    await this.persist({ device: null, unlinked: false });
  }

  private async persist(state: RingDeviceState): Promise<void> {
    this.state.set(state);
    await this.repository?.save(state);
  }
}
