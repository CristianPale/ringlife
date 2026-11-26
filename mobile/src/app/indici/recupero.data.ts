import { InjectionToken, Signal, computed, inject } from '@angular/core';
import { DaysService } from '../api/days.service';
import { RecuperoData } from './recupero.model';
import { recuperoFromServer } from './recupero.from-server';
import { RECUPERO_SAMPLE } from './recupero.sample';

/**
 * Dati del dettaglio Recupero: quelli d'esempio finché il telefono non è collegato a un server; poi quelli del server, o `null` se il server non ha ancora il dato (mai l'esempio),
 * poi quelli calcolati dal server. È un segnale: si aggiorna quando arrivano i giorni.
 */
export const RECUPERO_DATA = new InjectionToken<Signal<RecuperoData | null>>('RECUPERO_DATA', {
  providedIn: 'root',
  factory: () => {
    const days = inject(DaysService);
    return computed(() => (days.connected() ? recuperoFromServer(RECUPERO_SAMPLE, days.days()) : RECUPERO_SAMPLE));
  },
});
