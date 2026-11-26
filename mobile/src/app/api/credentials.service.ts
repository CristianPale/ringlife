import { Injectable, computed, inject, signal } from '@angular/core';
import { newId } from '../diary/headache-time';
import { CredentialsRepository, PairedCredentials, StoredCredentials } from './credentials.repository';

/** Forma accettata per un identificativo scelto a mano: lettere, cifre, punto, trattino e trattino basso. */
export const HARDWARE_ID = /^[A-Za-z0-9._-]{8,80}$/;

/** Credenziali di questo telefono. L'identificativo hardware si crea una volta e non cambia più. */
@Injectable({ providedIn: 'root' })
export class CredentialsService {
  private readonly repository = inject(CredentialsRepository, { optional: true });

  private readonly state = signal<StoredCredentials>({ hardwareId: `phone-${newId()}`, paired: null });

  readonly hardwareId = computed(() => this.state().hardwareId);
  readonly paired = computed(() => this.state().paired);

  async init(): Promise<void> {
    let stored: StoredCredentials | null;
    try {
      stored = (await this.repository?.load()) ?? null;
    } catch {
      // Il portachiavi non risponde: non si sa se c'è un collegamento. Non si scrive niente sopra; l'app parte
      // come non collegata e riprova al prossimo avvio.
      return;
    }
    if (stored) {
      this.state.set(stored);
    } else {
      // Primo avvio: l'identificativo nuovo si salva subito, così resta quello anche se non ci si collega.
      await this.repository?.save(this.state());
    }
  }

  /**
   * Usa un identificativo esistente, per ripristinare un telefono precedente: registrandosi con lo stesso
   * identificativo il server riconosce lo stesso dispositivo e ridà accesso ai suoi dati (docs/adr/0008).
   * Solo prima del collegamento. Restituisce `false` se l'identificativo non è accettabile o il telefono è già collegato.
   */
  async useHardwareId(id: string): Promise<boolean> {
    const clean = id.trim();
    if (this.state().paired !== null || !HARDWARE_ID.test(clean)) {
      return false;
    }
    await this.commit({ ...this.state(), hardwareId: clean });
    return true;
  }

  async savePaired(paired: PairedCredentials): Promise<void> {
    await this.commit({ ...this.state(), paired });
  }

  /** Dimentica il collegamento su questo telefono. L'identificativo hardware resta. */
  async forget(): Promise<void> {
    if (this.state().paired !== null) {
      await this.commit({ ...this.state(), paired: null });
    }
  }

  private async commit(next: StoredCredentials): Promise<void> {
    this.state.set(next);
    await this.repository?.save(next);
  }
}
