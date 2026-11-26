import { Direction, STANDING_LABELS, USUAL_BAND, standingOf } from '../livella/livella';
import { Zone } from '../oggi/zone';
import { StrainDeviations } from './strain.model';

export type ContributorId = 'hrv' | 'hr-riposo' | 'temperatura' | 'sonno' | 'stress';

/** Un segnale che entra nel Recupero (docs/scores.md, sezione Recovery Score). */
export interface Contributor {
  id: ContributorId;
  label: string;
  /** Peso nel punteggio, da 0 a 1. */
  weight: number;
  /** Sotto-punteggio 0-100: 75 è «nella tua media», sopra è meglio, sotto è peggio. */
  score: number;
  zone: Zone;
  /** Valore di oggi, con unità. */
  valueText: string;
  /** Nome esteso se `label` è una sigla (HRV). Va sempre mostrato accanto. */
  fullName?: string;
  /** Che cosa misura il segnale, in parole semplici. */
  help: string;
  /** Riferimento alla tua media. Assente per Sonno e Stress, che sono già indici 0-100. */
  baselineText?: string;
  /** Dove sta rispetto alla tua media, da −3 a 3 (ADR 0020). `null` o assente in calibrazione. */
  deviation?: number | null;
  direction?: Direction;
}

/** Pesi iniziali (algo_version v1, da tarare). Devono sommare a 1. */
export const RECOVERY_WEIGHTS: Record<ContributorId, number> = {
  hrv: 0.35,
  'hr-riposo': 0.25,
  temperatura: 0.15,
  sonno: 0.15,
  stress: 0.1,
};

/** Sotto-punteggio di una media personale: il valore «nella tua media» vale 75. */
export const TYPICAL_SCORE = 75;

const POINTS_PER_DEVIATION = 12.5;

/**
 * Traduce lo scostamento dalla tua media (già limitato a [-3, 3] e orientato: positivo = meglio)
 * in un sotto-punteggio 0-100.
 */
export function scoreFromDeviation(deviation: number): number {
  const clamped = Math.max(-3, Math.min(3, deviation));
  return Math.round(Math.max(0, Math.min(100, TYPICAL_SCORE + POINTS_PER_DEVIATION * clamped)));
}

export function recoveryScore(contributors: readonly Contributor[]): number {
  const total = contributors.reduce((sum, c) => sum + c.weight * c.score, 0);
  return Math.round(total);
}

export interface Verdict {
  title: string;
  detail: string;
}

/** Soglie come le zone dell'indice: 85 e 70. Suggerimenti di benessere, non indicazioni mediche. */
export function verdictFor(score: number): Verdict {
  if (score >= 85) {
    return { title: 'Puoi spingere', detail: 'Sei ben recuperato. Un allenamento impegnativo è alla tua portata.' };
  }
  if (score >= 70) {
    return { title: 'Giornata nella norma', detail: 'Il recupero è in linea con il tuo solito. Segui il tuo programma.' };
  }
  return {
    title: 'Vai piano oggi',
    detail: 'Il recupero è sotto il tuo solito. Meglio movimento leggero e una sera tranquilla.',
  };
}

/** Quanto un segnale sta sotto il tuo solito, in punti di Recupero persi. Zero se è in media o meglio. */
export function shortfall(contributor: Contributor): number {
  return contributor.weight * Math.max(0, TYPICAL_SCORE - contributor.score);
}

const MIN_SHORTFALL = 1;
const MAX_DRAGGING = 2;

/** I segnali che pesano di più sul punteggio di oggi, dal più al meno rilevante. */
export function draggingContributors(contributors: readonly Contributor[]): Contributor[] {
  return contributors
    .filter((c) => shortfall(c) >= MIN_SHORTFALL)
    .sort((a, b) => shortfall(b) - shortfall(a))
    .slice(0, MAX_DRAGGING);
}

/** La frase «Pesa soprattutto…»: ogni segnale con il suo articolo e il nome esteso delle sigle. */
export const CONTRIBUTOR_PHRASE: Record<ContributorId, string> = {
  hrv: 'la variabilità della frequenza cardiaca (HRV)',
  'hr-riposo': 'il battito a riposo',
  temperatura: 'la temperatura',
  sonno: 'il sonno',
  stress: 'lo stress di ieri',
};

const UNIT_WORDS: Record<string, string> = { ms: 'millisecondi', bpm: 'battiti al minuto', '°C': 'gradi' };

/** «38 ms» in valore e unità scritta per esteso («38», «millisecondi»). «—» resta senza unità. */
export function splitReading(text: string): { value: string; unit: string } {
  const match = /^(\S+)\s+(.+)$/.exec(text.trim());
  if (!match) {
    return { value: text.trim(), unit: '' };
  }
  return { value: match[1], unit: UNIT_WORDS[match[2]] ?? match[2] };
}

/**
 * Le parole sotto un segnale: dove sta contro il tuo solito, con il peso nel punteggio («Peggio del solito, peso 35%»).
 * Un segnale senza verso migliore (la temperatura) fuori dal solito dice solo più alta o più bassa.
 */
export function contributorWords(
  deviation: number | null | undefined,
  direction: Direction,
  weight: number,
): { sub: string; tone: 'peggio' | 'meglio' | null } {
  const pct = `peso ${Math.round(weight * 100)}%`;
  if (deviation === null || deviation === undefined) {
    return { sub: `In calibrazione, ${pct}`, tone: null };
  }
  if (Math.abs(deviation) <= USUAL_BAND) {
    return { sub: `Come al solito, ${pct}`, tone: null };
  }
  if (direction === 'neutral') {
    return { sub: `${deviation > 0 ? 'Più alta' : 'Più bassa'} del solito, ${pct}`, tone: null };
  }
  const standing = standingOf(deviation, direction);
  return { sub: `${STANDING_LABELS[standing]}, ${pct}`, tone: standing === 'solito' ? null : standing };
}

export interface RecuperoData {
  /** Giorno del risveglio a cui si riferisce il punteggio. */
  date: Date;
  /** Scostamenti dalla tua media (non orientati) per i Segnali di affaticamento. */
  deviations: StrainDeviations;
  value: number;
  zone: Zone;
  /** Dove sta il Recupero rispetto alla tua media e gli estremi del tuo solito nella sua unità (ADR 0020). */
  indexDeviation: number | null;
  indexRange: { low: number; high: number } | null;
  contributors: readonly Contributor[];
  /** Serie giornaliera del Recupero, dal più vecchio al più recente. Almeno 90 giorni. */
  history: readonly number[];
  /** `esempio` finché il telefono non è collegato a un server: la schermata lo dice. */
  source: 'esempio' | 'server';
}
