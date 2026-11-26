/**
 * Il giro delle 24 ore (ADR 0020): il tubo della livella piegato a cerchio, mezzanotte in alto, senso orario.
 * Funzioni pure: gli orari sono minuti dopo la mezzanotte locale, anche negativi (23:40 prima di mezzanotte = −20).
 */

export const DAY_MINUTES = 1440;

/** Un intervallo del giorno. La fine può essere prima dell'inizio se attraversa la mezzanotte. */
export interface DayRange {
  startMin: number;
  endMin: number;
}

export interface GiroData {
  /** L'orario abituale di sonno: mediana di inizio e fine delle ultime 28 notti. `null` in calibrazione. */
  usual: DayRange | null;
  /** Il sonno di stanotte. `null` se la notte non è ancora arrivata dall'anello. */
  sleep: DayRange | null;
  /** La finestra caffeina, solo con il plugin acceso. */
  caffeine: DayRange | null;
  /** Adesso, in minuti dopo la mezzanotte locale. */
  nowMin: number;
}

/** Minuti dopo la mezzanotte, riportati nell'intervallo [0, 1440). */
export function normalizeMinutes(minutes: number): number {
  return ((minutes % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
}

export const GIRO_SIZE = 216;
export const GIRO_CENTER = GIRO_SIZE / 2;
export const GIRO_RADIUS = 96;

export interface Point {
  x: number;
  y: number;
}

/** Punto del cerchio per un orario. 0:00 è in alto e le ore crescono in senso orario. */
export function pointAt(minutes: number, radius = GIRO_RADIUS): Point {
  const angle = (2 * Math.PI * normalizeMinutes(minutes)) / DAY_MINUTES;
  return {
    x: round(GIRO_CENTER + radius * Math.sin(angle)),
    y: round(GIRO_CENTER - radius * Math.cos(angle)),
  };
}

/** Arco tra due orari, in senso orario. Una fine prima dell'inizio attraversa la mezzanotte. */
export function arcPath(range: DayRange, radius = GIRO_RADIUS): string {
  const start = normalizeMinutes(range.startMin);
  let span = normalizeMinutes(range.endMin) - start;
  if (span <= 0) {
    span += DAY_MINUTES;
  }
  const from = pointAt(start, radius);
  const to = pointAt(start + span, radius);
  const large = span > DAY_MINUTES / 2 ? 1 : 0;
  return `M${from.x} ${from.y}A${radius} ${radius} 0 ${large} 1 ${to.x} ${to.y}`;
}

/** Segmento radiale per una tacca: dal raggio interno a quello esterno. */
export function tickLine(minutes: number, inner = 88, outer = 104): { x1: number; y1: number; x2: number; y2: number } {
  const a = pointAt(minutes, inner);
  const b = pointAt(minutes, outer);
  return { x1: a.x, y1: a.y, x2: b.x, y2: b.y };
}

/** Minuti dopo la mezzanotte locale di un istante, nel fuso di presentazione (`Europe/Rome`). */
export function localMinutes(date: Date, timeZone = 'Europe/Rome'): number {
  const parts = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone }).formatToParts(date);
  const value = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return value('hour') * 60 + value('minute');
}

/** «07:05» da minuti dopo la mezzanotte. */
export function clockText(minutes: number): string {
  const m = Math.round(normalizeMinutes(minutes));
  const hh = Math.floor(m / 60) % 24;
  return `${hh.toString().padStart(2, '0')}:${(m % 60).toString().padStart(2, '0')}`;
}

/** Descrizione per VoiceOver: il cerchio non si può leggere a colpo d'occhio, quindi si dice tutto a parole. */
export function describeGiro(data: GiroData, centerText: string): string {
  const parts: string[] = ['Giro delle 24 ore.'];
  if (data.sleep) {
    parts.push(`Sonno dalle ${clockText(data.sleep.startMin)} alle ${clockText(data.sleep.endMin)}.`);
  }
  if (data.usual) {
    parts.push(`Di solito dalle ${clockText(data.usual.startMin)} alle ${clockText(data.usual.endMin)}.`);
  }
  if (data.caffeine) {
    parts.push(`Finestra della caffeina dalle ${clockText(data.caffeine.startMin)} alle ${clockText(data.caffeine.endMin)}.`);
  }
  parts.push(`Adesso sono le ${clockText(data.nowMin)}.`, centerText);
  return parts.join(' ');
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
