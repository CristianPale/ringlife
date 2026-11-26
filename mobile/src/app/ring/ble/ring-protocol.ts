import { SamplePayload, SleepSessionPayload, SleepStageName } from '../../api/api.model';
import { MeasureKind } from '../measure.model';
import { FRAME_LENGTH, buildFrame } from './frame';

/**
 * Comandi e formati dell'R09 letti da catture vere (docs/protocol.md). TypeScript puro: niente Bluetooth qui, così
 * ogni funzione si prova con pacchetti in esadecimale.
 *
 * Il checksum è `sum & 255` (decisione in docs/protocol.md). L'anello non ha fuso orario: ogni orario che manda è
 * l'ora locale impostata dall'ultimo `01`, e si converte in UTC con l'offset del telefono al momento del sync.
 */
export const CHECKSUM = 'mod256' as const;

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

export const OP = {
  setTime: 0x01,
  battery: 0x03,
  hrSettings: 0x16,
  /** Misura automatica della SpO2 (ossigeno nel sangue): scrittura `2c 02 <stato>`. */
  spo2Settings: 0x2c,
  /** Monitoraggio dello stress: scrittura `36 02 <stato>`. */
  /** Storico dello stress: `37 <giorno>`, valori da 1 byte ogni 30 minuti. */
  stressHistory: 0x37,
  stressSettings: 0x36,
  /** Storico dell'HRV: `39 <giorno>`, valori da 2 byte (big-endian) ogni 30 minuti. */
  hrvHistory: 0x39,
  /** Misura dell'HRV: scrittura `38 02 <stato> 0a 60`. */
  hrvSettings: 0x38,
  /** Misura della temperatura: scrittura `3a 03 02 <stato>`. */
  temperatureSettings: 0x3a,
  hrHistory: 0x15,
  steps: 0x43,
  /** Misura in tempo reale: avvio `69 <tipo>` e stop `6a <tipo>` (docs/protocol.md). */
  realTime: 0x69,
  realTimeStop: 0x6a,
  /** Canale lungo: `bc <comando> <lunghezza LE 2> <crc LE 2> <dati>`. */
  big: 0xbc,
} as const;

export const BIG_SLEEP = 0x27;
/** Canale lungo: temperatura (`bc 25`) e SpO2 (`bc 2a`). */
export const BIG_TEMPERATURE = 0x25;
export const BIG_SPO2 = 0x2a;

/** Quanti giorni indietro si chiede allo storico dei passi e del battito. L'anello ne tiene 7 (0..6). */
export const HISTORY_DAYS = 7;

// ---- Ora ---------------------------------------------------------------------------------------------------------

function bcd(value: number): number {
  return ((Math.floor(value / 10) % 10) << 4) | value % 10;
}

function fromBcd(byte: number): number {
  return (byte >> 4) * 10 + (byte & 0x0f);
}

/** Ora «a muro» dell'anello: l'istante UTC spostato dall'offset del telefono, letto come se fosse UTC. */
function wall(ms: number, tzOffsetMin: number): Date {
  return new Date(ms + tzOffsetMin * MINUTE_MS);
}

/** Impostazione dell'ora: `01 <aa mm gg hh mm ss in BCD> 06`. L'ultimo byte lo manda l'app del produttore sempre uguale (da capire). */
export function setTimeFrame(now: Date, tzOffsetMin: number): Uint8Array {
  const w = wall(now.getTime(), tzOffsetMin);
  const payload = [
    bcd(w.getUTCFullYear() % 100),
    bcd(w.getUTCMonth() + 1),
    bcd(w.getUTCDate()),
    bcd(w.getUTCHours()),
    bcd(w.getUTCMinutes()),
    bcd(w.getUTCSeconds()),
    0x06,
  ];
  return buildFrame(OP.setTime, payload, CHECKSUM);
}

/** Mezzanotte locale del giorno che contiene `ms`, in ms UTC. */
export function localMidnight(ms: number, tzOffsetMin: number): number {
  const w = wall(ms, tzOffsetMin);
  return Date.UTC(w.getUTCFullYear(), w.getUTCMonth(), w.getUTCDate()) - tzOffsetMin * MINUTE_MS;
}

// ---- Batteria ----------------------------------------------------------------------------------------------------

export function batteryFrame(): Uint8Array {
  return buildFrame(OP.battery, [], CHECKSUM);
}

/** Percentuale 0-100 dalla risposta `03 <percento> <in carica>`. */
export function parseBattery(payload: Uint8Array): { percent: number; charging: boolean } {
  return { percent: Math.min(100, payload[0]), charging: payload[1] === 1 };
}

// ---- Impostazione del battito ------------------------------------------------------------------------------------

export function hrSettingsReadFrame(): Uint8Array {
  return buildFrame(OP.hrSettings, [0x01], CHECKSUM);
}

/** Attiva (`01`) o spegne (`02`) la misura periodica. `intervalMin` in minuti. */
export function hrSettingsWriteFrame(enabled: boolean, intervalMin: number): Uint8Array {
  return buildFrame(OP.hrSettings, [0x02, enabled ? 0x01 : 0x02, intervalMin], CHECKSUM);
}

/** Risposta di lettura `16 01 <stato> <intervallo> ...`. */
export function parseHrSettings(payload: Uint8Array): { enabled: boolean; intervalMin: number } | null {
  if (payload[0] !== 0x01) {
    return null;
  }
  return { enabled: payload[1] === 0x01, intervalMin: payload[2] };
}

/** Accende (`01`) o spegne (`00`) la misura automatica della SpO2. L'accensione è quella che manda l'app del produttore; lo spegnimento è per analogia, da verificare. */
export function spo2SettingsWriteFrame(enabled: boolean): Uint8Array {
  return buildFrame(OP.spo2Settings, [0x02, enabled ? 0x01 : 0x00], CHECKSUM);
}

/** Accende (`01`) o spegne (`00`) il monitoraggio dello stress. Come sopra: l'accensione è catturata, lo spegnimento no. */
export function stressSettingsWriteFrame(enabled: boolean): Uint8Array {
  return buildFrame(OP.stressSettings, [0x02, enabled ? 0x01 : 0x00], CHECKSUM);
}

/**
 * HRV: `38 02 <stato> 0a 60`. I due byte dopo lo stato (10 e 96) li manda l'app del produttore così all'accensione e non se ne conosce il
 * significato: si ripetono uguali. Lo spegnimento è per analogia, da verificare.
 */
export function hrvSettingsWriteFrame(enabled: boolean): Uint8Array {
  return buildFrame(OP.hrvSettings, [0x02, enabled ? 0x01 : 0x00, 0x0a, 0x60], CHECKSUM);
}

/** Temperatura: `3a 03 02 <stato>`. L'accensione è quella dell'app del produttore; lo spegnimento è per analogia, da verificare. */
export function temperatureSettingsWriteFrame(enabled: boolean): Uint8Array {
  return buildFrame(OP.temperatureSettings, [0x03, 0x02, enabled ? 0x01 : 0x00], CHECKSUM);
}

/** Letture delle misure automatiche (docs/protocol.md, Impostazione del battito `0x16`): `2c 01`, `36 01`, `38 01`, `3a 03 01`. */
export function spo2SettingsReadFrame(): Uint8Array {
  return buildFrame(OP.spo2Settings, [0x01], CHECKSUM);
}

export function stressSettingsReadFrame(): Uint8Array {
  return buildFrame(OP.stressSettings, [0x01], CHECKSUM);
}

export function hrvSettingsReadFrame(): Uint8Array {
  return buildFrame(OP.hrvSettings, [0x01], CHECKSUM);
}

export function temperatureSettingsReadFrame(): Uint8Array {
  return buildFrame(OP.temperatureSettings, [0x03, 0x01], CHECKSUM);
}

/**
 * Lo stato di una misura dalla risposta a una lettura: dopo i byte della lettura (`prefix`, per esempio `01` o `03 01`)
 * viene lo stato, `01` = accesa. `null` se la risposta non è quella di una lettura.
 */
export function parseMeasureSwitch(payload: Uint8Array, prefix: readonly number[]): boolean | null {
  if (payload.length <= prefix.length || prefix.some((b, i) => payload[i] !== b)) {
    return null;
  }
  return payload[prefix.length] === 0x01;
}

// ---- Passi -------------------------------------------------------------------------------------------------------

/** Giorno 0 = oggi, 1 = ieri, fino a 6. */
export function stepsFrame(dayOffset: number): Uint8Array {
  return buildFrame(OP.steps, [dayOffset, 0x0f, 0x00, 0x5f, 0x01], CHECKSUM);
}

/**
 * Passi di un giorno: un pacchetto di intestazione `43 f0 <n> 01` e `n` pacchetti
 * `43 <aa mm gg BCD> <quarto d'ora> <indice> <n> <calorie LE 2> <passi LE 2> <distanza LE 2>`, uno per ora con attività.
 * Un giorno senza dati dà il solo pacchetto `43 ff`. Ogni campione `STEPS` vale l'ora che **finisce** a `ts`.
 */
export function parseSteps(frames: readonly Uint8Array[], tzOffsetMin: number): SamplePayload[] {
  const samples: SamplePayload[] = [];
  for (const frame of frames) {
    if (frame.length !== FRAME_LENGTH || frame[0] !== OP.steps || frame[1] === 0xff || frame[1] === 0xf0) {
      continue;
    }
    const year = 2000 + fromBcd(frame[1]);
    const month = fromBcd(frame[2]) - 1;
    const day = fromBcd(frame[3]);
    const quarter = frame[4];
    const steps = frame[9] | (frame[10] << 8);
    if (quarter > 95 || steps === 0) {
      continue;
    }
    const startLocal = Date.UTC(year, month, day) + quarter * 15 * MINUTE_MS;
    samples.push({ metric: 'STEPS', ts: startLocal - tzOffsetMin * MINUTE_MS + HOUR_MS, value: steps });
  }
  return samples;
}

// ---- Battito -----------------------------------------------------------------------------------------------------

/** `15 <mezzanotte LE 4>`: secondi dall'epoca Unix **in ora locale** del giorno voluto. */
export function hrHistoryFrame(dayMidnightUtcMs: number, tzOffsetMin: number): Uint8Array {
  const localSeconds = Math.floor((dayMidnightUtcMs + tzOffsetMin * MINUTE_MS) / 1000);
  return buildFrame(
    OP.hrHistory,
    [localSeconds & 0xff, (localSeconds >>> 8) & 0xff, (localSeconds >>> 16) & 0xff, (localSeconds >>> 24) & 0xff],
    CHECKSUM,
  );
}

/**
 * Battito di un giorno: `15 00 <n> <intervallo>`, `15 01 <mezzanotte LE 4> <9 valori>`, poi `15 <indice> <13 valori>`.
 * Un valore è un byte (battiti al minuto), 0 = nessuna misura. Il valore `k` è alle `k × intervallo` minuti dalla mezzanotte.
 * Senza dati l'anello risponde `15 ff`. Restituisce `[]` se manca qualche pacchetto: meglio niente che orari sbagliati.
 */
export function parseHrHistory(frames: readonly Uint8Array[], tzOffsetMin: number): SamplePayload[] {
  const packets = frames.filter((f) => f.length === FRAME_LENGTH && f[0] === OP.hrHistory && f[1] !== 0xff);
  const header = packets.find((f) => f[1] === 0x00);
  if (!header) {
    return [];
  }
  const total = header[2];
  const intervalMin = header[3];
  const byIndex = new Map(packets.map((f) => [f[1], f]));
  const first = byIndex.get(1);
  if (!first || intervalMin === 0) {
    return [];
  }
  for (let i = 1; i < total; i++) {
    if (!byIndex.has(i)) {
      return [];
    }
  }
  const midnightLocalMs = (first[2] | (first[3] << 8) | (first[4] << 16) | (first[5] << 24)) >>> 0;
  const midnightUtc = midnightLocalMs * 1000 - tzOffsetMin * MINUTE_MS;

  const values: number[] = [];
  for (let i = 1; i < total; i++) {
    const frame = byIndex.get(i)!;
    values.push(...(i === 1 ? frame.slice(6, 15) : frame.slice(2, 15)));
  }
  const samples: SamplePayload[] = [];
  values.forEach((value, k) => {
    if (value > 0) {
      samples.push({ metric: 'HR', ts: midnightUtc + k * intervalMin * MINUTE_MS, value });
    }
  });
  return samples;
}

// ---- Canale lungo (sonno) ----------------------------------------------------------------------------------------

/**
 * CRC-16/MODBUS (init `ffff`, polinomio riflesso `a001`) dei dati di un messaggio del canale lungo, scritto little-endian
 * nel messaggio. Verificato su cinque richieste e una risposta vere dell'app del produttore; senza dati vale `ffff`.
 */
export function crc16(data: ArrayLike<number>): number {
  let crc = 0xffff;
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i];
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xa001 : crc >>> 1;
    }
  }
  return crc;
}

/** Messaggio del canale lungo: `bc <comando> <lunghezza LE 2> <crc LE 2> <dati>`. */
export function bigFrame(command: number, data: readonly number[] = []): Uint8Array {
  const crc = crc16(data);
  return Uint8Array.from([OP.big, command, data.length & 0xff, (data.length >> 8) & 0xff, crc & 0xff, crc >> 8, ...data]);
}

/** Sonno: stesso messaggio che manda l'app del produttore (`bc 27 02 00 81 80 ff 01`): `ff` = tutti i giorni che l'anello ha. */
export function sleepRequest(): Uint8Array {
  return bigFrame(BIG_SLEEP, [0xff, 0x01]);
}

/** SpO2: `bc 2a 01 00 ff 00 ff`, tutti i giorni. */
export function spo2Request(): Uint8Array {
  return bigFrame(BIG_SPO2, [0xff]);
}

/** Temperatura: `bc 25 01 00 3f 42 06`, come l'app del produttore. */
export function temperatureRequest(): Uint8Array {
  return bigFrame(BIG_TEMPERATURE, [0x06]);
}

/** Mette insieme i pezzi di una risposta del canale lungo finché c'è tutta (6 byte di testa + lunghezza). */
export class BigAccumulator {
  private buffer = new Uint8Array(0);

  /** Aggiunge una notifica; restituisce `{command, data}` quando il messaggio è completo, altrimenti `null`. */
  push(chunk: Uint8Array): { command: number; data: Uint8Array } | null {
    const merged = new Uint8Array(this.buffer.length + chunk.length);
    merged.set(this.buffer);
    merged.set(chunk, this.buffer.length);
    this.buffer = merged;
    if (this.buffer.length > 0 && this.buffer[0] !== OP.big) {
      // Un messaggio comincia sempre con `bc`: il resto è un avanzo da scartare, altrimenti rovina i messaggi dopo.
      this.buffer = new Uint8Array(0);
      return null;
    }
    if (this.buffer.length < 6) {
      return null;
    }
    const length = this.buffer[2] | (this.buffer[3] << 8);
    if (this.buffer.length < 6 + length) {
      return null;
    }
    const result = { command: this.buffer[1], data: this.buffer.slice(6, 6 + length) };
    this.buffer = new Uint8Array(0);
    return result;
  }

  /** Dimentica un messaggio a metà (anello scollegato, richiesta scaduta): il prossimo riparte da capo. */
  reset(): void {
    this.buffer = new Uint8Array(0);
  }
}

/** Ipotesi da confrontare con l'app del produttore: 2 leggero, 3 profondo, 4 REM, 5 sveglio. Un codice ignoto fa scartare la notte. */
const STAGES: Record<number, SleepStageName> = { 2: 'light', 3: 'deep', 4: 'rem', 5: 'awake' };

/**
 * Dati del sonno: `<giorni> { <giorni fa> <lunghezza> <inizio LE 2> <fine LE 2> { <fase> <minuti> }* }*`. Inizio e fine
 * sono minuti dalla mezzanotte del giorno del risveglio; un inizio dopo la fine è la sera prima. `nowMs` serve a sapere
 * quale giorno è «oggi».
 */
export function parseSleep(data: Uint8Array, nowMs: number, tzOffsetMin: number): SleepSessionPayload[] {
  const sessions: SleepSessionPayload[] = [];
  const days = data[0] ?? 0;
  let pos = 1;
  const today = localMidnight(nowMs, tzOffsetMin);
  for (let d = 0; d < days && pos + 2 <= data.length; d++) {
    const daysAgo = data[pos];
    const length = data[pos + 1];
    const block = data.slice(pos + 2, pos + 2 + length);
    pos += 2 + length;
    if (block.length < 4 || length < 4 || (length - 4) % 2 !== 0) {
      continue;
    }
    let start = block[0] | (block[1] << 8);
    const end = block[2] | (block[3] << 8);
    if (start > end) {
      start -= 1440;
    }
    const wakeDay = today - daysAgo * DAY_MS;
    const stages: SleepSessionPayload['stages'] = [];
    let cursor = start;
    let valid = true;
    for (let i = 4; i + 1 < block.length; i += 2) {
      const stage = STAGES[block[i]];
      const minutes = block[i + 1];
      if (!stage || minutes === 0) {
        valid = false;
        break;
      }
      stages.push({
        stage,
        start: wakeDay + cursor * MINUTE_MS,
        end: wakeDay + (cursor + minutes) * MINUTE_MS,
      });
      cursor += minutes;
    }
    // La somma dei tratti deve arrivare esattamente alla fine: così si vede subito un formato letto male.
    if (valid && stages.length > 0 && cursor === end) {
      sessions.push({ start: wakeDay + start * MINUTE_MS, end: wakeDay + end * MINUTE_MS, stages });
    }
  }
  return sessions;
}

// ---- Stress, HRV: storico a slot di 30 minuti ----------------------------------------------------------------------

/** Giorno 0 = oggi. */
export function stressHistoryFrame(dayOffset: number): Uint8Array {
  return buildFrame(OP.stressHistory, [dayOffset], CHECKSUM);
}

export function hrvHistoryFrame(dayOffset: number): Uint8Array {
  return buildFrame(OP.hrvHistory, [dayOffset], CHECKSUM);
}

/**
 * Storico a slot: `<op> 00 <n> <intervallo>` e poi i pacchetti `<op> <indice> <13 byte>` fino all'indice `n − 1`. I byte di
 * tutti i pacchetti, uno dopo l'altro, sono i valori dallo slot 0 (la mezzanotte). Senza dati l'anello risponde `<op> ff`.
 * Se manca un pacchetto torna `null`: meglio niente che orari sbagliati.
 */
function slotBytes(frames: readonly Uint8Array[], opcode: number): { intervalMin: number; bytes: number[] } | null {
  const packets = frames.filter((f) => f.length === FRAME_LENGTH && f[0] === opcode && f[1] !== 0xff);
  const header = packets.find((f) => f[1] === 0x00);
  if (!header || header[3] === 0) {
    return null;
  }
  const byIndex = new Map(packets.map((f) => [f[1], f]));
  const bytes: number[] = [];
  for (let i = 1; i < header[2]; i++) {
    const frame = byIndex.get(i);
    if (!frame) {
      return null;
    }
    bytes.push(...frame.slice(2, 15));
  }
  return { intervalMin: header[3], bytes };
}

/**
 * Stress di un giorno: un byte per slot, 0 = nessuna misura. **Verificato** sui dati veri: l'ultimo valore dello storico
 * era quello che mostrava l'app del produttore. La scala è quella dell'anello.
 */
export function parseStressHistory(frames: readonly Uint8Array[], dayMidnightUtcMs: number): SamplePayload[] {
  const slots = slotBytes(frames, OP.stressHistory);
  if (!slots) {
    return [];
  }
  const samples: SamplePayload[] = [];
  slots.bytes.forEach((value, k) => {
    if (value > 0) {
      samples.push({ metric: 'STRESS', ts: dayMidnightUtcMs + k * slots.intervalMin * MINUTE_MS, value });
    }
  });
  return samples;
}

/**
 * HRV di un giorno, in millisecondi: due byte per slot, big-endian (a cavallo dei pacchetti), 0 = nessuna misura.
 * **Verificato**: l'ultimo valore era quello che mostrava l'app del produttore.
 */
export function parseHrvHistory(frames: readonly Uint8Array[], dayMidnightUtcMs: number): SamplePayload[] {
  const slots = slotBytes(frames, OP.hrvHistory);
  if (!slots) {
    return [];
  }
  const samples: SamplePayload[] = [];
  for (let k = 0; k * 2 + 1 < slots.bytes.length; k++) {
    const value = (slots.bytes[k * 2] << 8) | slots.bytes[k * 2 + 1];
    if (value > 0) {
      samples.push({ metric: 'HRV', ts: dayMidnightUtcMs + k * slots.intervalMin * MINUTE_MS, value });
    }
  }
  return samples;
}

// ---- Canale lungo: SpO2 e temperatura -----------------------------------------------------------------------------

/** Quanti byte ha il blocco di un giorno di SpO2 (`<giorni fa>` + 24 coppie) e di temperatura (`<giorni fa> <intervallo>` + 48 valori). */
const SPO2_BLOCK = 1 + 24 * 2;
const TEMPERATURE_BLOCK = 2 + 48;

/**
 * SpO2: blocchi `<giorni fa> { <minimo> <massimo> }×24`, una coppia per ora dalla mezzanotte, in percentuale; 0 = nessuna
 * misura. **Verificato**: l'ultima coppia era quella che mostrava l'app del produttore. Ogni coppia dà due campioni (minimo
 * al quarto d'ora, massimo ai tre quarti), anche se uguali.
 */
export function parseSpo2(data: Uint8Array, nowMs: number, tzOffsetMin: number): SamplePayload[] {
  const samples: SamplePayload[] = [];
  const today = localMidnight(nowMs, tzOffsetMin);
  for (let pos = 0; pos + SPO2_BLOCK <= data.length; pos += SPO2_BLOCK) {
    const dayStart = today - data[pos] * DAY_MS;
    for (let hour = 0; hour < 24; hour++) {
      const min = data[pos + 1 + hour * 2];
      const max = data[pos + 2 + hour * 2];
      if (min > 0) {
        samples.push({ metric: 'SPO2', ts: dayStart + hour * HOUR_MS + 15 * MINUTE_MS, value: min });
      }
      // Sempre due campioni per ora, anche se uguali: il server vuole almeno 10 misure per notte e la SpO2 arriva per
      // ora; una notte di 8 ore con un solo campione orario non arrivava mai alla mediana notturna.
      if (max > 0) {
        samples.push({ metric: 'SPO2', ts: dayStart + hour * HOUR_MS + 45 * MINUTE_MS, value: max });
      }
    }
  }
  return samples;
}

/**
 * Temperatura: blocchi `<giorni fa> <intervallo> { <valore> }×48`. Il valore è in decimi di grado sopra 20: `v / 10 + 20`
 * (0xa2 = 162 = 36,2 °C). **Verificato**: l'ultimo valore era quello che mostrava l'app del produttore. 0 = nessuna misura.
 */
export function parseTemperature(data: Uint8Array, nowMs: number, tzOffsetMin: number): SamplePayload[] {
  const samples: SamplePayload[] = [];
  const today = localMidnight(nowMs, tzOffsetMin);
  for (let pos = 0; pos + TEMPERATURE_BLOCK <= data.length; pos += TEMPERATURE_BLOCK) {
    const dayStart = today - data[pos] * DAY_MS;
    const intervalMin = data[pos + 1];
    for (let k = 0; k < 48; k++) {
      const raw = data[pos + 2 + k];
      if (raw > 0 && intervalMin > 0) {
        samples.push({ metric: 'TEMP', ts: dayStart + k * intervalMin * MINUTE_MS, value: celsiusOf(raw) });
      }
    }
  }
  return samples;
}

/** Un byte di temperatura dell'anello, in decimi di grado sopra 20, in gradi con un decimale. */
function celsiusOf(raw: number): number {
  return Math.round((20 + raw / 10) * 10) / 10;
}

// ---- Misura a comando (`0x69` e `0x6a`) -------------------------------------------------------------------------

/**
 * Il tipo di ogni misura nei comandi `69` e `6a`, dalle catture della misura manuale dell'app del produttore
 * (`temp-manuale`, `misure-manuali`; il battito dalla prima cattura). docs/protocol.md, Misura in tempo reale.
 */
export const MEASURE_TYPE: Record<MeasureKind, number> = {
  heartRate: 0x01,
  spo2: 0x03,
  stress: 0x08,
  hrv: 0x0a,
  temperature: 0x0b,
};

/**
 * Avvio: `69 <tipo> 25`, come lo manda l'app del produttore; il significato di `25` non si conosce. Il battito parte con
 * `69 01` senza `25`, come nella prima cattura e nella versione provata sull'iPhone.
 */
export function measureStartFrame(kind: MeasureKind): Uint8Array {
  return buildFrame(OP.realTime, [MEASURE_TYPE[kind], kind === 'heartRate' ? 0x00 : 0x25], CHECKSUM);
}

/**
 * Stop: `6a <tipo> <x>`, come l'app del produttore: con l'ultimo valore per battito e HRV, `00` per gli altri. L'anello
 * risponde `6a <tipo> <...>`. `lastRaw`: l'ultimo byte di valore ricevuto, 0 se nessuno.
 */
export function measureStopFrame(kind: MeasureKind, lastRaw: number): Uint8Array {
  const withValue = kind === 'heartRate' || kind === 'hrv';
  return buildFrame(OP.realTimeStop, [MEASURE_TYPE[kind], withValue ? lastRaw & 0xff : 0x00], CHECKSUM);
}

/**
 * Un pacchetto della misura, circa due al secondo: `69 <tipo> <errore> <valore> ...`. Il valore vale `00` finché l'anello
 * non ha finito (circa 25 secondi, circa 55 per l'HRV); poi è in battiti al minuto, percentuale, millisecondi o livello
 * di stress, e per la temperatura in decimi di grado sopra 20 come lo storico. I byte 6-7 cambiano a ogni pacchetto e
 * non si usano. `undefined` se il pacchetto non è di questa misura.
 */
export function parseMeasure(frame: Uint8Array, kind: MeasureKind): { error: number; raw: number; value: number | null } | undefined {
  if (frame.length !== FRAME_LENGTH || frame[0] !== OP.realTime || frame[1] !== MEASURE_TYPE[kind]) {
    return undefined;
  }
  const raw = frame[3];
  return { error: frame[2], raw, value: raw === 0 ? null : kind === 'temperature' ? celsiusOf(raw) : raw };
}

// ---- Battito dal vivo: allenamento (`0x77` e `0x78`) -----------------------------------------------------------------

/**
 * Il battito continuo è quello dell'allenamento dell'app del produttore (cattura `allenamento`, docs/protocol.md): `77 <azione> <sport>`
 * e l'anello manda da solo `78` una volta al secondo, col battito già dal primo pacchetto. La «misura ora» (`69 01`)
 * invece si ferma da sola dopo circa 30 secondi e riaggancia da capo: non serve a una sessione.
 */
export const WORKOUT = 0x77;
export const WORKOUT_TICK = 0x78;
/** Il tipo di sport scelto nella cattura. L'anello ne registra il riepilogo, che noi non leggiamo. */
export const WORKOUT_SPORT = 0x04;
export const WORKOUT_START = 0x01;
export const WORKOUT_PAUSE = 0x02;
export const WORKOUT_RESUME = 0x03;
export const WORKOUT_END = 0x04;

/** `77 <azione> 04`: avvio `01`, pausa `02`, ripresa `03`, fine `04`, come li manda l'app del produttore. */
export function workoutFrame(action: number): Uint8Array {
  return buildFrame(WORKOUT, [action, WORKOUT_SPORT], CHECKSUM);
}

/**
 * `78 <sport> <stato> <secondi BE 2> <bpm> ...`, uno al secondo (stato `01` in corso, `02` in pausa). `undefined` se il
 * pacchetto non è un secondo d'allenamento; `null` se il battito è 0; altrimenti i battiti al minuto.
 */
export function parseWorkoutHeartRate(frame: Uint8Array): number | null | undefined {
  if (frame.length !== FRAME_LENGTH || frame[0] !== WORKOUT_TICK) {
    return undefined;
  }
  return frame[5] > 0 ? frame[5] : null;
}
