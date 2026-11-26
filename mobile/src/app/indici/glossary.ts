/**
 * Spiegazioni delle sigle e dei segnali mostrati nell'app. Regola: nessuna sigla (HRV, bpm, ms…)
 * compare senza il suo significato. Le descrizioni sono in italiano semplice, senza gergo.
 */
export interface GlossaryEntry {
  /** Nome esteso, mostrato accanto alla sigla. Assente se il nome è già chiaro. */
  fullName?: string;
  /** Una o due frasi: che cosa misura e che cosa vuol dire un valore alto o basso. */
  help: string;
}

export const GLOSSARY = {
  hrv: {
    fullName: 'Variabilità della frequenza cardiaca',
    help: 'Quanto varia il tempo tra un battito e il successivo, in millisecondi (ms). Di notte, più è alta, più il corpo è rilassato e recuperato.',
  },
  'hr-riposo': {
    help: 'Quanti battiti al minuto (bpm) fa il cuore mentre dormi. Più è bassa rispetto al tuo solito, più sei recuperato.',
  },
  temperatura: {
    help: 'Di quanti gradi la temperatura notturna del dito si scosta dalla tua media. Un aumento può indicare fatica o malessere in arrivo. Il valore assoluto non conta.',
  },
  sonno: {
    help: "L'indice Sonno di stanotte, da 0 a 100: durata, risvegli e fasi del sonno.",
  },
  stress: {
    help: "L'indice Stress di ieri, da 0 a 100: più è alto, più la giornata è stata tranquilla.",
  },
  'stress-load': {
    help: 'La quota dei campioni di stress, tra le 07:00 e le 23:00, in cui il valore era alto (60 o più). Meno ce ne sono, più la giornata è stata tranquilla.',
  },
  'stress-evening': {
    help: 'Confronta lo stress della sera (dalle 19:00 alle 23:00) con quello del giorno. Se la sera è più calma, il corpo ha recuperato.',
  },
  'sleep-duration': {
    help: 'Quanto hai dormito davvero, senza contare i minuti svegli. Si confronta con il tuo obiettivo.',
  },
  'sleep-efficiency': {
    help: 'La quota del tempo passato a letto in cui dormivi davvero. Più è alta, meno tempo hai passato sveglio.',
  },
  'sleep-deep': {
    fullName: 'Sonno profondo',
    help: 'La fase più riposante, in cui il corpo si ripara. Più è abbondante, più la notte è rigenerante.',
  },
  'sleep-rem': {
    fullName: 'Sonno REM (Rapid Eye Movement, movimenti rapidi degli occhi)',
    help: 'La fase in cui si sogna di più e la mente elabora la giornata.',
  },
  'sleep-awakenings': {
    help: 'Quante volte ti sei svegliato e per quanti minuti in totale. Meno sono, più il sonno è continuo.',
  },
  'sleep-regularity': {
    help: "Quanto resta costante l'orario del sonno da una notte all'altra. Un orario stabile aiuta il corpo a rispettare il suo ritmo.",
  },
  'sleep-min-hr': {
    help: 'Il battito più basso della notte, in battiti al minuto (bpm). Di solito scende quando il corpo riposa bene.',
  },
  spo2: {
    fullName: 'Saturazione di ossigeno nel sangue (SpO2)',
    help: "La percentuale di ossigeno che il sangue trasporta. Qui conta l'andamento rispetto al tuo solito, non il valore in sé: il dito dà una misura approssimata.",
  },
  'move-steps': {
    help: "I passi di un giorno intero, contro l'obiettivo che hai scelto.",
  },
  'move-active-hours': {
    help: 'Le ore della giornata in cui hai fatto almeno 250 passi. Conta quante volte ti sei mosso, non solo quanto.',
  },
  'move-hr-minutes': {
    fullName: 'Minuti con il battito in zona moderata o alta',
    help: 'I minuti in cui il cuore ha lavorato più del solito, come in una camminata veloce o in una corsa.',
  },
  'move-sedentary': {
    help: 'Le pause di almeno 2 ore di fila, tra le 07:00 e le 23:00, con meno di 250 passi all\'ora. Meno sono, meglio è.',
  },
  'stage-awake': { help: 'Minuti di veglia passati a letto, dopo esserti addormentato.' },
  'stage-rem': {
    fullName: 'REM (Rapid Eye Movement, movimenti rapidi degli occhi)',
    help: 'Fase in cui si sogna di più e la mente elabora la giornata.',
  },
  'stage-light': { help: 'La fase più lunga della notte: un sonno di passaggio tra le altre.' },
  'stage-deep': { help: 'La fase più riposante, in cui il corpo si ripara.' },
  vo2max: {
    fullName: 'Consumo massimo di ossigeno (VO2max)',
    help: "Quanto ossigeno il corpo riesce a usare al massimo sforzo, in millilitri per chilo di peso al minuto (ml/kg/min). Più è alto, più cuore e polmoni sono allenati.",
  },
  'cardio-age': {
    help: "L'età a cui una persona tipica ha il tuo stesso VO2max. Più è bassa della tua età, più il cuore è in forma.",
  },
} as const satisfies Record<string, GlossaryEntry>;

export type GlossaryId = keyof typeof GLOSSARY;
