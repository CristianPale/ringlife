import { SamplePayload, SleepSessionPayload, SleepStageName } from './api.model';

/**
 * Dati INVENTATI per provare il percorso telefono → server → punteggi prima che arrivi l'anello.
 * Niente di reale: valori generati da un seme fisso, quindi lo stesso giorno dà sempre gli stessi dati
 * e un secondo caricamento non duplica niente (il server riconosce metrica e istante).
 */

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** Giorni di dati: la baseline personale ne chiede almeno 7 (docs/scores.md). */
export const DEMO_DAYS = 10;

/** Una notte stabile come quella dei test del backend: 450 minuti a letto, un risveglio. */
const NIGHT_PATTERN: readonly (readonly [SleepStageName, number])[] = [
  ['awake', 10],
  ['light', 120],
  ['deep', 70],
  ['light', 60],
  ['rem', 50],
  ['light', 60],
  ['awake', 5],
  ['rem', 45],
  ['light', 30],
];

export interface DemoData {
  samples: SamplePayload[];
  sessions: SleepSessionPayload[];
}

/** Generatore pseudo-casuale con seme (mulberry32): nessuna dipendenza, risultato ripetibile. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Inizio (UTC, ms) del giorno locale di `now`, per un telefono con quell'offset da UTC. */
export function localDayStart(now: Date, tzOffsetMin: number): number {
  const local = new Date(now.getTime() + tzOffsetMin * MIN);
  return Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - tzOffsetMin * MIN;
}

/**
 * Dati degli ultimi `days` giorni locali, oggi compreso, fino a `now`. Una notte entra solo se è finita:
 * il server si aspetta sessioni complete. I passi di oggi arrivano fino all'ora corrente.
 */
export function buildDemoData(now: Date, tzOffsetMin: number, days: number = DEMO_DAYS): DemoData {
  const nowMs = now.getTime();
  const today = localDayStart(now, tzOffsetMin);
  const samples: SamplePayload[] = [];
  const sessions: SleepSessionPayload[] = [];
  const push = (metric: SamplePayload['metric'], ts: number, value: number) => {
    if (ts <= nowMs) {
      samples.push({ metric, ts, value: Math.round(value * 10) / 10 });
    }
  };

  for (let back = days - 1; back >= 0; back--) {
    const dayStart = today - back * DAY;
    const random = seededRandom(Math.floor(dayStart / DAY));
    const jitter = (spread: number) => (random() * 2 - 1) * spread;

    // La notte che finisce in questo giorno: a letto verso le 23:30 del giorno prima.
    const start = dayStart - 30 * MIN + Math.round(jitter(15)) * MIN;
    const end = start + 450 * MIN;
    if (end <= nowMs) {
      let cursor = start;
      const stages = NIGHT_PATTERN.map(([stage, minutes]) => {
        const item = { stage, start: cursor, end: cursor + minutes * MIN };
        cursor = item.end;
        return item;
      });
      sessions.push({ start, end, stages });

      const hr = 56 + jitter(3);
      const hrv = 48 + jitter(6);
      const temp = 34.2 + jitter(0.3);
      for (let t = start; t < end; t += 5 * MIN) {
        push('HR', t, hr + jitter(2));
      }
      for (let t = start; t < end; t += 30 * MIN) {
        push('HRV', t, hrv + jitter(3));
        push('TEMP', t, temp + jitter(0.1));
      }
      for (let t = start; t < end; t += 15 * MIN) {
        push('SPO2', t, 96 + Math.round(jitter(1)));
      }
    }

    // Passi: circa 800 all'ora dalle 8 alle 20 (il campione è il totale dell'ora che finisce a `ts`).
    for (let hour = 8; hour <= 20; hour++) {
      push('STEPS', dayStart + hour * HOUR + 30 * MIN, Math.round(800 + jitter(250)));
    }
    // Stress: un campione ogni 30 minuti dalle 7 alle 23. Di giorno intorno a 38, la sera più calmo (intorno a 25),
    // con qualche picco alto: un giorno normale, che il server legge come tranquillo.
    for (let minute = 7 * 60; minute < 23 * 60; minute += 30) {
      const evening = minute >= 19 * 60;
      const peak = !evening && random() < 0.08 ? 28 : 0;
      push('STRESS', dayStart + minute * MIN, (evening ? 25 : 38) + peak + jitter(9));
    }
    // Un po' di battito alto la sera, per i minuti in zona.
    if (back > 0) {
      for (let i = 0; i < 6; i++) {
        push('HR', dayStart + 18 * HOUR + i * 5 * MIN, 120 + jitter(8));
      }
    }
  }
  samples.sort((a, b) => a.ts - b.ts);
  return { samples, sessions };
}
