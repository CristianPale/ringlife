import { InjectionToken, Signal, computed, inject } from '@angular/core';
import { DaysService } from '../api/days.service';
import { StressData } from './stress.model';
import { stressFromServer } from './stress.from-server';
import { STRESS_SAMPLE } from './stress.sample';

/**
 * Dati del dettaglio Stress: quelli d'esempio finché il telefono non è collegato a un server; poi quelli del server, o `null` se il server non ha ancora il dato (mai l'esempio),
 * poi quelli calcolati dal server. È un segnale: si aggiorna quando arrivano i giorni.
 */
export const STRESS_DATA = new InjectionToken<Signal<StressData | null>>('STRESS_DATA', {
  providedIn: 'root',
  factory: () => {
    const days = inject(DaysService);
    return computed(() => (days.connected() ? stressFromServer(STRESS_SAMPLE, days.days()) : STRESS_SAMPLE));
  },
});
