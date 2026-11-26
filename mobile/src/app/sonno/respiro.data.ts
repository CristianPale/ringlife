import { InjectionToken, Signal, computed, inject } from '@angular/core';
import { DaysService } from '../api/days.service';
import { respiroFromServer } from './respiro.from-server';
import { RESPIRO_SAMPLE, RespiroData } from './respiro.sample';

/**
 * Dati del respiro notturno: quelli d'esempio finché il telefono non è collegato a un server; poi quelli del server, o `null` se il server non ha ancora il dato (mai l'esempio),
 * poi la valutazione del server. È un segnale: si aggiorna quando arrivano i giorni.
 */
export const RESPIRO_DATA = new InjectionToken<Signal<RespiroData | null>>('RESPIRO_DATA', {
  providedIn: 'root',
  factory: () => {
    const days = inject(DaysService);
    return computed(() => (days.connected() ? respiroFromServer(RESPIRO_SAMPLE, days.days()) : RESPIRO_SAMPLE));
  },
});
