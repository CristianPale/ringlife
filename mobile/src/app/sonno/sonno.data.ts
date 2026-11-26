import { InjectionToken, Signal, computed, inject } from '@angular/core';
import { DaysService } from '../api/days.service';
import { SonnoData } from './sonno.model';
import { sonnoFromServer } from './sonno.from-server';
import { SONNO_SAMPLE } from './sonno.sample';

/**
 * Dati del dettaglio Sonno: quelli d'esempio finché il telefono non è collegato a un server; poi quelli del server, o `null` se il server non ha ancora il dato (mai l'esempio),
 * poi quelli calcolati dal server. È un segnale: si aggiorna quando arrivano i giorni.
 */
export const SONNO_DATA = new InjectionToken<Signal<SonnoData | null>>('SONNO_DATA', {
  providedIn: 'root',
  factory: () => {
    const days = inject(DaysService);
    return computed(() => (days.connected() ? sonnoFromServer(SONNO_SAMPLE, days.days()) : SONNO_SAMPLE));
  },
});
