import { DayView } from '../api/api.model';
import { DayRange, localMinutes } from '../livella/giro';
import { STANDING_LABELS, Standing, standingOf } from '../livella/livella';
import { nightsProgress } from '../indici/calibration';
import { bodyRows } from '../sonno/sonno.rows';
import { MeasureRowData } from '../shared/measure-row.component';
import { MovementRowData, OggiData, OggiSample, ScoreRowData, SummarySegment } from './oggi.model';
import { QueuedNight } from '../ring/ring-queue.model';
import { minuteOfDay, romeDay } from '../temperatura/temperatura.model';

/** Ore decimali in «5 h 15». */
export function formatHours(hours: number): string {
  const total = Math.round(hours * 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${h} h ${m.toString().padStart(2, '0')}`;
}

/** Ultimo giorno che soddisfa la condizione (la libreria di destinazione non ha `findLast`). */
function lastIndexWith(days: readonly DayView[], has: (day: DayView) => unknown): number {
  for (let i = days.length - 1; i >= 0; i--) {
    if (has(days[i])) {
      return i;
    }
  }
  return -1;
}

function rowFrom(base: Pick<ScoreRowData, 'domain' | 'label'>, key: string, days: readonly DayView[]): ScoreRowData | null {
  // Dopo mezzanotte «oggi» non ha ancora la notte: vale l'ultimo giorno che ha l'indice.
  const index = lastIndexWith(days, (d) => d.scores[key]);
  if (index < 0) {
    return null;
  }
  const day = days[index];
  const prior = days.slice(0, index).filter((d) => d.scores[key]).length;
  return {
    ...base,
    value: Math.round(day.scores[key].value),
    deviation: day.scoreReferences?.[key]?.deviation ?? null,
    calibrationDays: prior,
  };
}

/**
 * «Mancano N notti» finché la tua media non è pronta: le notti con l'indice Sonno, perché il primo confronto è quello del
 * Sonno. Sparisce quando Recupero o Sonno hanno il confronto con la tua media.
 */
function calibrationOf(days: readonly DayView[], rows: readonly (ScoreRowData | null)[]): { nightsToGo: number } | null {
  if (rows.some((row) => row !== null && row.deviation !== null)) {
    return null;
  }
  const { toGo } = nightsProgress(days, (d) => !!d.scores['sleep']);
  return toGo > 0 ? { nightsToGo: toGo } : null;
}

/** Le misure del corpo dell'ultima notte che le ha: battito a riposo, HRV, temperatura (scostamento), SpO2. */
function nightRows(days: readonly DayView[]): MeasureRowData[] {
  const index = lastIndexWith(
    days,
    (d) =>
      ['resting_hr', 'hrv_night', 'spo2_median', 'temp_night'].some((k) => typeof d.features?.[k] === 'number') ||
      typeof d.metrics['temp_deviation']?.value === 'number',
  );
  if (index < 0) {
    return [];
  }
  const day = days[index];
  const features = day.features ?? {};
  const dev = (key: string) => day.references?.[key]?.deviation ?? null;
  const temp = day.metrics['temp_deviation']?.value;
  return bodyRows(
    {
      restingHr: features['resting_hr'],
      hrv: features['hrv_night'],
      tempDeviation: typeof temp === 'number' ? temp : undefined,
      tempNight: features['temp_night'],
      spo2: features['spo2_median'],
    },
    { restingHr: dev('resting_hr'), hrv: dev('hrv_night'), temp: dev('temp_night'), spo2: dev('spo2_median') },
  );
}

/**
 * Lo stress di oggi quando l'indice non c'è ancora (si calcola a giornata finita): l'ultima ora con misure del giorno
 * in corso, senza confronto con la tua media.
 */
function stressNow(base: Pick<ScoreRowData, 'domain'>, today: DayView | undefined): ScoreRowData | null {
  const hours = today?.stressByHour ?? [];
  for (let h = hours.length - 1; h >= 0; h--) {
    const value = hours[h];
    if (typeof value === 'number') {
      return { domain: base.domain, label: `Stress, alle ${String(h).padStart(2, '0')}`, value: Math.round(value), deviation: null, calibrationDays: 0 };
    }
  }
  return null;
}

/** Le parole sul tuo solito, con il tono solo quando non è «come al solito». */
function standingSegment(standing: Standing): SummarySegment {
  const text = STANDING_LABELS[standing].toLowerCase();
  return standing === 'solito' ? { text } : { text, tone: standing };
}

function sentence(subject: string, row: ScoreRowData, closing: string): SummarySegment[] {
  if (row.deviation === null) {
    return [{ text: `${subject} è ${row.value} su 100, in calibrazione.${closing}` }];
  }
  return [{ text: `${subject} è ` }, standingSegment(standingOf(row.deviation)), { text: `.${closing}` }];
}

/** L'orario abituale di sonno: la tua mediana di inizio e fine, dall'ultimo giorno che li ha. */
function usualSleep(days: readonly DayView[]): DayRange | null {
  const index = lastIndexWith(
    days,
    (d) => d.references?.['sleep_start_min'] !== undefined && d.references?.['sleep_end_min'] !== undefined,
  );
  if (index < 0) {
    return null;
  }
  const references = days[index].references!;
  return { startMin: references['sleep_start_min'].median, endMin: references['sleep_end_min'].median };
}

/** Il sonno di stanotte, solo se è la notte di oggi: quella che finisce nel giorno in corso. */
function tonightSleep(today: DayView | undefined): DayRange | null {
  const start = today?.features?.['sleep_start_min'];
  const end = today?.features?.['sleep_end_min'];
  return typeof start === 'number' && typeof end === 'number' ? { startMin: start, endMin: end } : null;
}

/**
 * Quello che il telefono sa da sé, dall'anello (docs/adr/0043): serve quando i risultati del server sono più vecchi
 * dell'ultima lettura, per esempio fuori casa. Nessun indice: quelli li calcola solo il server.
 */
export interface OggiLocal {
  /** I passi di oggi dal registro dell'anello sul telefono; `null` se non ce ne sono. */
  stepsToday: number | null;
  /** L'ultima notte letta dall'anello. */
  lastNight: QueuedNight | null;
  /** I risultati del server sono più vecchi dell'ultima lettura dell'anello, o non ci sono. */
  serverBehind: boolean;
}

export const NO_LOCAL: OggiLocal = { stepsToday: null, lastNight: null, serverBehind: false };

/** La notte letta dall'anello come arco del giro, se finisce oggi: minuti dalla mezzanotte, negativi prima. */
function localNight(night: QueuedNight | null, todayKey: string): DayRange | null {
  if (!night || romeDay(night.end) !== todayKey) {
    return null;
  }
  const start = minuteOfDay(night.start) - (romeDay(night.start) === todayKey ? 0 : 24 * 60);
  return { startMin: start, endMin: minuteOfDay(night.end) };
}

/** «Stanotte: 7 h 05 di sonno, dall'anello. …», o le ore a letto se le fasi non sono più sul telefono. */
function localNightSentence(night: QueuedNight, range: DayRange): SummarySegment {
  const hours = (ms: number) => formatHours(ms / 3_600_000);
  const what =
    night.asleepMs !== null
      ? `Stanotte: ${hours(night.asleepMs)} di sonno`
      : `Stanotte: ${hours(night.end - night.start)} a letto, dalle ${clock(range.startMin)} alle ${clock(range.endMin)}`;
  return { text: `${what}, dall'anello. Il server di casa calcolerà gli indici appena risponde.` };
}

function clock(minutes: number): string {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/**
 * Mette i risultati del server dentro la schermata Oggi. `days` va dal più vecchio al più recente e finisce oggi.
 * Un indice che il server non ha ancora calcolato è `null`: la schermata dice «nessun dato ancora», mai un valore
 * d'esempio. `base` dà solo i nomi delle righe e l'obiettivo. Senza giorni (server collegato ma ancora vuoto) tutte le righe sono vuote.
 * `caffeine` è la finestra del plugin, se acceso (ADR 0020).
 */
export function oggiFromServer(
  base: OggiSample,
  days: readonly DayView[],
  now: Date,
  caffeine: DayRange | null = null,
  local: OggiLocal = NO_LOCAL,
): OggiData {
  // Oggi è il giorno di Roma di adesso: con i risultati salvati sul telefono l'ultimo della lista può essere di ieri.
  const todayKey = romeDay(now.getTime());
  const today = days.find((d) => d.day === todayKey);
  const recupero = rowFrom(base.recupero, 'recovery', days);
  const sonno = rowFrom(base.sonno, 'sleep', days);
  // Lo Stress è quello di ieri (il giorno in corso non ha un indice): l'ultimo giorno che lo ha.
  const stress = rowFrom(base.stress, 'stress', days) ?? stressNow(base.stress, today);

  const summary: SummarySegment[] = [];
  if (recupero) {
    summary.push(...sentence('Il tuo recupero', recupero, ' '));
  }
  if (sonno) {
    summary.push(...sentence('Il sonno', sonno, ''));
  }

  const debt = days[lastIndexWith(days, (d) => d.metrics['sleep_debt'])]?.metrics['sleep_debt']?.value;
  if (summary.length === 0) {
    summary.push({ text: 'Ancora nessun indice: servono alcuni giorni di dati dall\'anello.' });
  }
  const summaryDetail: SummarySegment[] =
    typeof debt === 'number' ? [{ text: `Debito di sonno: ${formatHours(debt)} negli ultimi 7 giorni.` }] : [];

  // La notte letta dall'anello che il server non ha ancora: nel giro e in una frase, senza indice.
  const serverNight = tonightSleep(today);
  const ringNight = serverNight === null && local.serverBehind ? localNight(local.lastNight, todayKey) : null;
  if (ringNight && local.lastNight) {
    summaryDetail.unshift(localNightSentence(local.lastNight, ringNight));
  }

  // I passi di oggi sono quelli del giorno in corso, non dell'ultimo con un indice. Se il server è indietro rispetto
  // all'anello, valgono quelli contati sul telefono (docs/adr/0043).
  const serverSteps = today?.features?.['steps'];
  const steps = local.serverBehind && local.stepsToday !== null ? local.stepsToday : (serverSteps ?? local.stepsToday);
  const movimento: MovementRowData | null = typeof steps === 'number' ? { ...base.movimento, steps: Math.round(steps) } : null;

  const sources = [recupero && 'Recupero', sonno && 'Sonno', movimento && 'Movimento', stress && 'Stress'].filter(Boolean);
  const fromServer = sources.join(', ').replace(/, ([^,]*)$/, ' e $1');
  return {
    ...base,
    batteryPercent: base.batteryPercent,
    date: now,
    recupero,
    sonno,
    movimento,
    stress,
    summary,
    summaryDetail,
    calibration: calibrationOf(days, [recupero, sonno]),
    night: nightRows(days),
    syncText: sources.length === 0 ? 'Dal server: ancora nessun risultato.' : `Dal server: ${fromServer}.`,
    giro: { usual: usualSleep(days), sleep: serverNight ?? ringNight, caffeine, nowMin: localMinutes(now) },
  };
}
