import { SamplePayload, SleepSessionPayload } from '../api/api.model';
import { RingSettings } from '../settings/settings.model';

/** Ciò che una lettura ha dato e il server non ha ancora, con l'offset di fuso usato in quel momento (docs/adr/0018). */
export interface QueuedBatch {
  tzOffsetMin: number;
  samples: SamplePayload[];
  sessions: SleepSessionPayload[];
}

/** L'ultima lettura riuscita: serve a mostrare batteria e orario in Oggi e in Impostazioni. */
export interface LastReading {
  at: number;
  battery: number | null;
  firmware: string | null;
}

/** Chiave della posizione delle sessioni di sonno, accanto a quelle delle metriche. */
export const SLEEP_KEY = 'sleep';

export interface RingQueue {
  /** Dal più vecchio al più recente. */
  batches: QueuedBatch[];
  /**
   * Fin dove si è già letto, metrica per metrica (e `sleep` per il sonno): l'anello non aggiorna tutto allo stesso
   * ritmo, e una posizione sola farebbe perdere i dati di chi è più lento.
   */
  cursors: Record<string, number>;
  last: LastReading | null;
  /** Le impostazioni che l'anello ha già ricevuto: si riscrivono solo se cambiano. `null` = mai scritte. */
  applied: RingSettings | null;
  /**
   * Le notti già messe in coda (inviate o no): inizio in ms → la fine più lontana vista (docs/adr/0034). L'anello dà
   * anche la notte in corso: una lettura alle 3 la vede finire alle 3, quella del mattino la vede intera. Una notte si
   * rimette in coda solo se arriva più lunga.
   */
  nights: Record<string, number>;
}

export const EMPTY_QUEUE: RingQueue = { batches: [], cursors: {}, last: null, applied: null, nights: {} };

/** Per quanto si ricordano le notti già messe in coda: l'anello ne tiene al massimo 7. */
export const NIGHTS_KEEP_MS = 14 * 86_400_000;

export function sameRingSettings(a: RingSettings | null, b: RingSettings): boolean {
  return a !== null && a.hrIntervalMin === b.hrIntervalMin && a.stress === b.stress && a.spo2 === b.spo2 && a.hrv === b.hrv && a.temperature === b.temperature;
}

/** I nomi delle misure, per dire quali l'anello aveva diverse da quelle scelte (docs/adr/0049). */
export const MEASURE_NAMES: Record<keyof RingSettings, string> = {
  hrIntervalMin: 'battito',
  stress: 'stress',
  spo2: 'ossigeno nel sangue (SpO2)',
  hrv: 'variabilità del battito (HRV)',
  temperature: 'temperatura',
};

/**
 * Le misure che l'anello ha diverse da quelle scelte (docs/adr/0049), per chiave. Una misura che l'anello non ha detto
 * (`null`) conta come diversa solo se le misure scelte non sono quelle scritte l'ultima volta.
 */
export function measureMismatches(
  onRing: { [K in keyof RingSettings]: RingSettings[K] | null },
  wanted: RingSettings,
  applied: RingSettings | null,
): (keyof RingSettings)[] {
  const written = sameRingSettings(applied, wanted);
  return (Object.keys(MEASURE_NAMES) as (keyof RingSettings)[]).filter((key) =>
    onRing[key] === null ? !written : onRing[key] !== wanted[key],
  );
}

/** Da dove chiedere all'anello: la posizione più indietro tra tutte, o `null` alla prima lettura. */
export function sinceOf(queue: RingQueue): number | null {
  const values = Object.values(queue.cursors);
  return values.length === 0 ? null : Math.min(...values);
}

/** Campioni al massimo in un lotto: un invio resta sotto il limite di 5000 del server (docs/api.md). */
export const BATCH_SAMPLES = 4000;

/**
 * Tetto di sicurezza: oltre, i lotti più vecchi si scartano. Le letture con lo stesso fuso si uniscono nell'ultimo lotto
 * fino a `BATCH_SAMPLES` (docs/adr/0044): prima ogni lettura era un lotto, e con le letture in background ogni ora il
 * tetto arrivava dopo due o tre giorni senza server. Ora sono mesi.
 */
export const MAX_BATCHES = 60;

/** Mette campioni e notti in coda: nell'ultimo lotto se ha lo stesso fuso e spazio, poi in lotti nuovi da `BATCH_SAMPLES`. */
function appendBatches(
  batches: readonly QueuedBatch[],
  tzOffsetMin: number,
  samples: readonly SamplePayload[],
  sessions: readonly SleepSessionPayload[],
): QueuedBatch[] {
  const result = [...batches];
  let rest = [...samples];
  let nights = [...sessions];
  const last = result.at(-1);
  if (last && last.tzOffsetMin === tzOffsetMin && last.samples.length < BATCH_SAMPLES) {
    const room = BATCH_SAMPLES - last.samples.length;
    result[result.length - 1] = { ...last, samples: [...last.samples, ...rest.slice(0, room)], sessions: [...last.sessions, ...nights] };
    rest = rest.slice(room);
    nights = [];
  }
  while (rest.length > 0 || nights.length > 0) {
    result.push({ tzOffsetMin, samples: rest.slice(0, BATCH_SAMPLES), sessions: nights });
    rest = rest.slice(BATCH_SAMPLES);
    nights = [];
  }
  return result;
}

export function sampleKey(sample: SamplePayload): string {
  return `${sample.metric}|${sample.ts}`;
}

/**
 * Aggiunge una lettura alla coda e fa avanzare le posizioni. Non si rimette ciò che è prima della posizione della sua
 * metrica (già letto, inviato o in coda: l'anello può ridarlo) né ciò che è già in coda. Il server comunque lo
 * riconoscerebbe, ma si evita di rimandarlo a ogni sync. Le notti seguono `nights`, non la posizione: una notte letta a
 * metà e poi intera ha lo stesso inizio e una fine più lontana, e la versione intera prende il posto di quella in coda.
 */
export function enqueue(
  queue: RingQueue,
  reading: { samples: readonly SamplePayload[]; sessions: readonly SleepSessionPayload[] },
  tzOffsetMin: number,
): RingQueue {
  const seenSamples = new Set(queue.batches.flatMap((b) => b.samples.map(sampleKey)));
  const samples = reading.samples.filter((s) => {
    const after = queue.cursors[s.metric];
    return (after === undefined || s.ts > after) && !seenSamples.has(sampleKey(s));
  });
  const nights = { ...queue.nights };
  const sessions: SleepSessionPayload[] = [];
  for (const session of reading.sessions) {
    const known = nights[String(session.start)];
    if (known === undefined || session.end > known) {
      nights[String(session.start)] = session.end;
      sessions.push(session);
    }
  }

  const cursors = { ...queue.cursors };
  for (const sample of reading.samples) {
    cursors[sample.metric] = Math.max(cursors[sample.metric] ?? sample.ts, sample.ts);
  }
  for (const session of reading.sessions) {
    cursors[SLEEP_KEY] = Math.max(cursors[SLEEP_KEY] ?? session.end, session.end);
  }
  const kept = pruneNights(nights);
  if (samples.length === 0 && sessions.length === 0) {
    return { ...queue, cursors, nights: kept };
  }
  // Una notte che arriva più lunga sostituisce la sua versione corta ancora in coda: il server non la vuole due volte.
  const replaced = new Set(sessions.map((s) => s.start));
  const waiting = queue.batches
    .map((b) => ({ ...b, sessions: b.sessions.filter((s) => !replaced.has(s.start)) }))
    .filter((b) => b.samples.length > 0 || b.sessions.length > 0);
  const batches = appendBatches(waiting, tzOffsetMin, samples, sessions).slice(-MAX_BATCHES);
  return { ...queue, batches, cursors, nights: kept };
}

/** Tiene solo le notti delle ultime due settimane, dalla più recente: l'anello non ridà quelle più vecchie. */
function pruneNights(nights: Record<string, number>): Record<string, number> {
  const starts = Object.keys(nights).map(Number);
  if (starts.length === 0) {
    return nights;
  }
  const newest = Math.max(...starts);
  return Object.fromEntries(Object.entries(nights).filter(([start]) => Number(start) >= newest - NIGHTS_KEEP_MS));
}

/** Una notte letta dall'anello: inizio e fine in ms, e il tempo di sonno dalle fasi se la notte è ancora in coda. */
export interface QueuedNight {
  start: number;
  end: number;
  /** Senza le veglie. `null` se la notte è già stata inviata: in coda resta solo inizio e fine. */
  asleepMs: number | null;
}

/** L'ultima notte letta (quella che finisce più tardi), inviata o no (docs/adr/0043). `null` se non ce ne sono. */
export function lastNightOf(queue: RingQueue): QueuedNight | null {
  const nights = Object.entries(queue.nights).map(([start, end]) => ({ start: Number(start), end }));
  if (nights.length === 0) {
    return null;
  }
  const last = nights.reduce((a, b) => (b.end > a.end ? b : a));
  const session = queue.batches
    .flatMap((b) => b.sessions)
    .filter((s) => s.start === last.start)
    .reduce<SleepSessionPayload | null>((a, b) => (a === null || b.end > a.end ? b : a), null);
  const asleepMs = session
    ? session.stages.filter((stage) => stage.stage !== 'awake').reduce((sum, stage) => sum + (stage.end - stage.start), 0)
    : null;
  return { start: last.start, end: last.end, asleepMs };
}

/** Il dato più vecchio ancora da inviare, ms; `null` con la coda vuota. Serve all'avviso «dati non inviati». */
export function oldestPendingOf(queue: RingQueue): number | null {
  const times = queue.batches.flatMap((b) => [...b.samples.map((s) => s.ts), ...b.sessions.map((s) => s.start)]);
  return times.length === 0 ? null : Math.min(...times);
}

/** Quanti elementi aspettano di essere inviati. */
export function pendingCount(queue: RingQueue): number {
  return queue.batches.reduce((n, b) => n + b.samples.length + b.sessions.length, 0);
}

/** Toglie dal lotto ciò che il server ha confermato, e i lotti rimasti vuoti. */
export function markSent(queue: RingQueue, index: number, sent: { samples?: boolean; sessions?: boolean }): RingQueue {
  const batches = queue.batches
    .map((b, i) => (i === index ? { ...b, samples: sent.samples ? [] : b.samples, sessions: sent.sessions ? [] : b.sessions } : b))
    .filter((b) => b.samples.length > 0 || b.sessions.length > 0);
  return { ...queue, batches };
}

/** Controlla la coda letta dall'archivio: ciò che non torna si scarta, mai un errore. */
export function normalizeQueue(raw: unknown): RingQueue {
  if (typeof raw !== 'object' || raw === null) {
    return EMPTY_QUEUE;
  }
  const value = raw as Record<string, unknown>;
  const batches = Array.isArray(value['batches'])
    ? value['batches'].filter(isBatch).map((b) => ({ tzOffsetMin: b.tzOffsetMin, samples: b.samples, sessions: b.sessions }))
    : [];
  const rawCursors = typeof value['cursors'] === 'object' && value['cursors'] !== null ? (value['cursors'] as Record<string, unknown>) : {};
  const cursors = Object.fromEntries(
    Object.entries(rawCursors).filter((entry): entry is [string, number] => typeof entry[1] === 'number' && Number.isFinite(entry[1])),
  );
  const last = value['last'];
  // Una coda salvata prima di `nights` non lo ha: le notti che l'anello ha ancora si rimandano una volta, e il server
  // allunga quelle che aveva tenuto a metà (docs/adr/0034).
  const rawNights = typeof value['nights'] === 'object' && value['nights'] !== null ? (value['nights'] as Record<string, unknown>) : {};
  const nights = Object.fromEntries(
    Object.entries(rawNights).filter((entry): entry is [string, number] => typeof entry[1] === 'number' && Number.isFinite(entry[1])),
  );
  return { batches, cursors, last: isLast(last) ? last : null, applied: normalizeApplied(value['applied']), nights };
}

function isBatch(value: unknown): value is QueuedBatch {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const b = value as Record<string, unknown>;
  return typeof b['tzOffsetMin'] === 'number' && Array.isArray(b['samples']) && Array.isArray(b['sessions']);
}

function isLast(value: unknown): value is LastReading {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const l = value as Record<string, unknown>;
  return (
    typeof l['at'] === 'number' &&
    (l['battery'] === null || typeof l['battery'] === 'number') &&
    (l['firmware'] === null || typeof l['firmware'] === 'string')
  );
}

function normalizeApplied(value: unknown): RingSettings | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const v = value as Record<string, unknown>;
  // Le impostazioni scritte prima di HRV e temperatura non le avevano: tornano `null` e si riscrivono tutte.
  return typeof v['hrIntervalMin'] === 'number' &&
    typeof v['stress'] === 'boolean' &&
    typeof v['spo2'] === 'boolean' &&
    typeof v['hrv'] === 'boolean' &&
    typeof v['temperature'] === 'boolean'
    ? { hrIntervalMin: v['hrIntervalMin'], stress: v['stress'], spo2: v['spo2'], hrv: v['hrv'], temperature: v['temperature'] }
    : null;
}
