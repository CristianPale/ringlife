import { InjectionToken, Signal, computed, inject } from '@angular/core';
import { DaysService } from '../api/days.service';
import { movimentoFromServer } from './movimento.from-server';
import { MOVIMENTO_SAMPLE, MovimentoData } from './movimento.sample';

/**
 * Dati del dettaglio Movimento: quelli d'esempio finché il telefono non è collegato a un server; poi quelli del server, o `null` se il server non ha ancora il dato (mai l'esempio),
 * poi quelli del server. È un segnale: si aggiorna quando arrivano i giorni.
 */
export const MOVIMENTO_DATA = new InjectionToken<Signal<MovimentoData | null>>('MOVIMENTO_DATA', {
  providedIn: 'root',
  factory: () => {
    const days = inject(DaysService);
    return computed(() => (days.connected() ? movimentoFromServer(MOVIMENTO_SAMPLE, days.days()) : MOVIMENTO_SAMPLE));
  },
});
