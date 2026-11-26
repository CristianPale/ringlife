import { InjectionToken, Signal, computed, inject } from '@angular/core';
import { DaysService } from '../api/days.service';
import { HeadacheService } from '../diary/headache.service';
import { andamentoFromServer } from './andamento.from-server';
import { ANDAMENTO_SAMPLE, AndamentoData } from './andamento.sample';

/**
 * Dati della scheda Andamento: quelli d'esempio finché il telefono non è collegato a un server,
 * poi quelli del server (le cefalee restano quelle del diario del telefono). È un segnale.
 */
export const ANDAMENTO_DATA = new InjectionToken<Signal<AndamentoData | null>>('ANDAMENTO_DATA', {
  providedIn: 'root',
  factory: () => {
    const days = inject(DaysService);
    const headaches = inject(HeadacheService);
    return computed(() => (days.connected() ? andamentoFromServer(ANDAMENTO_SAMPLE, days.days(), headaches.episodes()) : ANDAMENTO_SAMPLE));
  },
});
