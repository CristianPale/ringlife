import { MigraineReportData } from '../api/api.model';

/** Quanti episodi servono per cercare ricorrenze (docs/adr/0015). */
export const MIN_EPISODES_FOR_RECURRENCES = 5;

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function duration(minutes: number): string {
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')} min`;
}

/** Le righe dell'anteprima: le stesse cose che finiscono nel PDF, in breve. */
export function previewLines(data: MigraineReportData): string[] {
  const s = data.summary;
  if (s === null) {
    return [`Nessuna cefalea registrata negli ultimi ${data.days} giorni.`];
  }
  const lines = [
    `${plural(s.episodes, 'cefalea', 'cefalee')} in ${plural(s.headacheDays, 'giorno', 'giorni')}.`,
    `Intensità massima ${s.peakMax} su 10, picco medio ${s.peakAverage.toFixed(1).replace('.', ',')} su 10.`,
    s.averageDurationMin === null
      ? 'Durata media non calcolabile: nessun episodio chiuso.'
      : `Durata media degli episodi chiusi: ${duration(s.averageDurationMin)}.`,
    `${plural(s.medicationIntakes, 'assunzione', 'assunzioni')} di farmaco in ${plural(s.medicationDays, 'giorno', 'giorni')}.`,
    `${plural(data.episodes.length, 'episodio elencato', 'episodi elencati')}, uno per riga.`,
  ];
  if (s.episodes < MIN_EPISODES_FOR_RECURRENCES) {
    lines.push(`Ricorrenze non cercate: servono almeno ${MIN_EPISODES_FOR_RECURRENCES} cefalee.`);
  } else {
    lines.push(
      data.recurrences.length === 0
        ? 'Nessuna ricorrenza evidente.'
        : `${plural(data.recurrences.length, 'ricorrenza trovata', 'ricorrenze trovate')}, con l'avvertenza che sono coincidenze.`,
    );
  }
  return lines;
}
