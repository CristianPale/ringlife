import { Injectable, inject, signal } from '@angular/core';
import { describeApiError } from '../api/api-error';
import { RingSyncService } from './ring-sync.service';

/**
 * Dice perché una sincronizzazione non è andata a buon fine, con una finestra (`SyncAlertComponent`) e «Riprova».
 * Si guarda dopo ogni sincronizzazione completa: all'apertura e a «tira per aggiornare».
 */
@Injectable({ providedIn: 'root' })
export class SyncAlertService {
  private readonly ring = inject(RingSyncService);

  /** I motivi, uno per riga. `null` = niente da mostrare. */
  readonly problems = signal<readonly string[] | null>(null);

  /** Raccoglie gli errori dell'ultima sincronizzazione e, se ce ne sono, apre la finestra. */
  check(): void {
    const problems: string[] = [];
    const ring = this.ring.ringError();
    if (ring) {
      problems.push(ring);
    }
    const upload = this.ring.uploadError();
    if (upload) {
      problems.push(`Invio al server: ${describeApiError(upload.kind)}`);
    }
    const settings = this.ring.settingsError();
    if (settings) {
      problems.push(`Misure non scritte sull'anello: ${settings}`);
    }
    this.problems.set(problems.length > 0 ? problems : null);
  }

  dismiss(): void {
    this.problems.set(null);
  }

  /** Richiude la finestra, rifà la lettura e, se va ancora male, la riapre. */
  async retry(): Promise<void> {
    this.dismiss();
    await this.ring.sync();
    this.check();
  }
}
