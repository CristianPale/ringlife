import { Injectable, NgZone, inject, signal } from '@angular/core';
import { CHOOSE_TIMEOUT_MS, RingCandidate } from './ble/capacitor-ring-link';

/** Cosa chiedere: gli anelli sentiti (dal segnale più forte) e se l'anello salvato manca. */
export interface RingChoice {
  rings: readonly RingCandidate[];
  replacing: boolean;
}

/** La forza del segnale a parole: il proprio anello, vicino al telefono, ha di solito il segnale più forte. */
export function signalText(rssi: number | null): string {
  if (rssi === null) {
    return 'segnale sconosciuto';
  }
  if (rssi >= -60) {
    return 'segnale forte';
  }
  return rssi >= -75 ? 'segnale medio' : 'segnale debole';
}

/**
 * La scelta dell'anello quando non è ovvio quale sia (docs/adr/0027): più anelli vicini, o uno diverso da quello salvato.
 * La finestra è `RingChooserComponent`. Una sola domanda alla volta; senza risposta si chiude dopo `CHOOSE_TIMEOUT_MS`.
 */
@Injectable({ providedIn: 'root' })
export class RingChooserService {
  private readonly zone = inject(NgZone);
  readonly request = signal<RingChoice | null>(null);
  private answer: ((id: string | null) => void) | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;

  /** Apre la finestra e aspetta: l'identificativo scelto, o `null` («Annulla», tempo scaduto, un'altra domanda). */
  choose(choice: RingChoice): Promise<string | null> {
    // Il Bluetooth chiama fuori da Angular: si rientra perché la finestra compaia.
    return this.zone.run(() => {
      this.close(null);
      return new Promise<string | null>((resolve) => {
        this.answer = resolve;
        this.request.set(choice);
        this.timer = setTimeout(() => this.close(null), CHOOSE_TIMEOUT_MS);
      });
    });
  }

  pick(id: string): void {
    this.close(id);
  }

  cancel(): void {
    this.close(null);
  }

  private close(id: string | null): void {
    clearTimeout(this.timer);
    const answer = this.answer;
    this.answer = null;
    this.request.set(null);
    answer?.(id);
  }
}
