import { ANDAMENTO_SAMPLE } from '../andamento/andamento.sample';
import { OGGI_SAMPLE } from '../oggi/oggi.sample';

/**
 * Dati SINTETICI del dettaglio Movimento: oggi è in corso, ieri è un giorno intero con i suoi minuti di sforzo.
 * Le ore e i passi di ieri sono quelli della scheda Andamento.
 */
export interface MovimentoData {
  today: Date;
  stepsToday: number;
  /** Passi di ieri per ora locale (24 valori). */
  stepsYesterdayByHour: readonly number[];
  /** Minuti di ieri con il battito in zona moderata o alta. */
  hrMinutesYesterday: number;
  /** Passi dei giorni conclusi, dal più vecchio al più recente: oggi è escluso. */
  stepsHistory: readonly number[];
  /** `esempio` finché il telefono non è collegato a un server: la schermata lo dice. */
  source: 'esempio' | 'server';
}

export const MOVIMENTO_SAMPLE: MovimentoData = {
  today: ANDAMENTO_SAMPLE.today,
  stepsToday: OGGI_SAMPLE.movimento.steps,
  stepsYesterdayByHour: ANDAMENTO_SAMPLE.stepsYesterdayByHour,
  hrMinutesYesterday: 18,
  stepsHistory: ANDAMENTO_SAMPLE.steps,
  source: 'esempio',
};
