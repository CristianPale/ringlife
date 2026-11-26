import { SamplePayload } from '../../api/api.model';
import { RingSettings } from '../../settings/settings.model';
import { RingDeviceInfo } from '../ring-device.model';
import { MeasureKind } from '../measure.model';
import { BatteryStatus, LiveSession, RingError, RingMeasureStates, RingReading, RingSource } from '../ring-source';
import { RingChannel, RingLink } from './ring-link';
import {
  BIG_SLEEP,
  BigAccumulator,
  HISTORY_DAYS,
  OP,
  batteryFrame,
  hrHistoryFrame,
  hrSettingsWriteFrame,
  hrvSettingsWriteFrame,
  temperatureSettingsWriteFrame,
  hrSettingsReadFrame,
  parseHrSettings,
  parseMeasureSwitch,
  spo2SettingsReadFrame,
  stressSettingsReadFrame,
  hrvSettingsReadFrame,
  temperatureSettingsReadFrame,
  spo2SettingsWriteFrame,
  stressSettingsWriteFrame,
  localMidnight,
  parseBattery,
  parseHrHistory,
  parseSleep,
  parseSpo2,
  parseStressHistory,
  parseHrvHistory,
  parseTemperature,
  spo2Request,
  stressHistoryFrame,
  parseWorkoutHeartRate,
  workoutFrame,
  WORKOUT_END,
  WORKOUT_PAUSE,
  WORKOUT_RESUME,
  WORKOUT_START,
  hrvHistoryFrame,
  temperatureRequest,
  BIG_SPO2,
  BIG_TEMPERATURE,
  parseSteps,
  setTimeFrame,
  sleepRequest,
  stepsFrame,
  measureStartFrame,
  measureStopFrame,
  parseMeasure,
} from './ring-protocol';

const DAY_MS = 86_400_000;
/**
 * Quanto silenzio si aspetta prima di dare una richiesta per persa. L'anello risponde in 25-250 ms; il tempo riparte a
 * ogni pacchetto, così una risposta lunga su un collegamento lento non scade a metà (docs/adr/0027).
 */
const REPLY_TIMEOUT_MS = 2_000;
/** Battito dal vivo: l'anello manda un secondo d'allenamento al secondo; se tace per 3 s si chiede la ripresa (docs/adr/0024). */
export const LIVE_SILENCE_MS = 3_000;
const LIVE_CHECK_MS = 1_000;
/**
 * Misura a comando (docs/adr/0039): quanto si aspetta un valore. Con l'app del produttore arriva dopo circa 25 secondi,
 * dopo circa 55 per l'HRV.
 */
const MEASURE_MAX_MS: Record<MeasureKind, number> = {
  heartRate: 60_000,
  spo2: 60_000,
  stress: 60_000,
  temperature: 60_000,
  hrv: 90_000,
};
/**
 * Quanti valori si raccolgono prima di fermare la misura (circa mezzo secondo l'uno dall'altro). L'HRV ne dà uno solo,
 * e l'app del produttore ferma subito; ossigeno e stress cambiano a ogni pacchetto, e lei ferma dopo 6-9 valori.
 */
const MEASURE_VALUES: Record<MeasureKind, number> = {
  heartRate: 6,
  spo2: 6,
  stress: 9,
  temperature: 6,
  hrv: 1,
};
/** Tre valori uguali di fila bastano: la misura è ferma. */
const MEASURE_STABLE = 3;

interface Waiter {
  accept: (channel: RingChannel, data: Uint8Array) => boolean;
  /** È arrivato un pezzo su `channel` (anche un frammento del canale lungo): il tempo d'attesa riparte. */
  touch: (channel: RingChannel) => void;
  /** L'anello si è scollegato: inutile aspettare. */
  lost: () => void;
}

/**
 * Legge l'anello vero: orario, batteria, passi, battito, sonno (docs/protocol.md). Ogni richiesta aspetta la sua
 * risposta, mai più di `REPLY_TIMEOUT_MS` di silenzio. Non sa di Bluetooth (`RingLink`) né di Angular.
 */
export class BleRingSource extends RingSource {
  readonly kind = 'ble' as const;
  private tzOffsetMin = 0;
  private nowMs = Date.now();
  private waiter: Waiter | null = null;
  private readonly big = new BigAccumulator();
  private live: ((bpm: number | null) => void) | null = null;
  private liveLastPacket = 0;

  constructor(
    private readonly link: RingLink,
    private readonly now: () => Date = () => new Date(),
  ) {
    super();
  }

  async connect(): Promise<void> {
    this.waiter = null;
    this.big.reset();
    await this.link.connect(
      (channel, data) => this.onNotify(channel, data),
      () => this.waiter?.lost(),
    );
  }

  async setTime(now: Date, tzOffsetMin: number): Promise<void> {
    this.tzOffsetMin = tzOffsetMin;
    this.nowMs = now.getTime();
    await this.twice(() => this.command(setTimeFrame(now, tzOffsetMin), OP.setTime));
  }

  /**
   * Si accendono o spengono il battito (`hrIntervalMin` 0 = spento), la SpO2, lo stress, l'HRV e la temperatura. Per
   * questi ultimi quattro non si sa ancora com'è fatta la risposta dell'anello: si manda il comando e, se non risponde in tempo, non è un errore.
   */
  async applySettings(settings: RingSettings): Promise<void> {
    const enabled = settings.hrIntervalMin > 0;
    await this.twice(() => this.command(hrSettingsWriteFrame(enabled, enabled ? settings.hrIntervalMin : 30), OP.hrSettings));
    await this.commandIfAnswered(spo2SettingsWriteFrame(settings.spo2), OP.spo2Settings);
    await this.commandIfAnswered(stressSettingsWriteFrame(settings.stress), OP.stressSettings);
    await this.commandIfAnswered(hrvSettingsWriteFrame(settings.hrv), OP.hrvSettings);
    await this.commandIfAnswered(temperatureSettingsWriteFrame(settings.temperature), OP.temperatureSettings);
  }

  /**
   * Le misure accese sull'anello (docs/adr/0049): l'anello può perderle (scarico, ripristino, un'altra app), e l'app le
   * scriveva solo quando cambiavano in Impostazioni. Una lettura senza risposta vale `null`, non un errore.
   */
  override async readSettings(): Promise<RingMeasureStates> {
    const read = async <T>(frame: Uint8Array, opcode: number, parse: (payload: Uint8Array) => T | null): Promise<T | null> => {
      try {
        return parse((await this.command(frame, opcode)).slice(1));
      } catch (error) {
        if (error instanceof RingError && error.code === 'connection_timeout') {
          return null;
        }
        throw error;
      }
    };
    const hr = await read(hrSettingsReadFrame(), OP.hrSettings, parseHrSettings);
    return {
      hrIntervalMin: hr === null ? null : hr.enabled ? hr.intervalMin : 0,
      spo2: await read(spo2SettingsReadFrame(), OP.spo2Settings, (p) => parseMeasureSwitch(p, [0x01])),
      stress: await read(stressSettingsReadFrame(), OP.stressSettings, (p) => parseMeasureSwitch(p, [0x01])),
      hrv: await read(hrvSettingsReadFrame(), OP.hrvSettings, (p) => parseMeasureSwitch(p, [0x01])),
      temperature: await read(temperatureSettingsReadFrame(), OP.temperatureSettings, (p) => parseMeasureSwitch(p, [0x03, 0x01])),
    };
  }

  /** Dal servizio standard Device Information, non dal protocollo dell'anello (docs/adr/0030). */
  override deviceInfo(): Promise<RingDeviceInfo> {
    return this.link.deviceInfo();
  }

  async battery(): Promise<BatteryStatus> {
    const reply = await this.twice(() => this.command(batteryFrame(), OP.battery));
    return parseBattery(reply.slice(1, 15));
  }

  async readHistory(sinceMs: number | null): Promise<RingReading> {
    const now = this.now().getTime();
    this.nowMs = now;
    const today = localMidnight(now, this.tzOffsetMin);
    const firstDay = sinceMs === null ? HISTORY_DAYS - 1 : Math.min(HISTORY_DAYS - 1, Math.max(0, Math.round((today - localMidnight(sinceMs, this.tzOffsetMin)) / DAY_MS)));

    const samples: SamplePayload[] = [];
    for (let day = firstDay; day >= 0; day--) {
      samples.push(...parseSteps(await this.twice(() => this.steps(day)), this.tzOffsetMin));
      samples.push(...parseHrHistory(await this.twice(() => this.heartRate(today - day * DAY_MS)), this.tzOffsetMin));
      // Stress e HRV: se l'anello non risponde non è un errore (può non averle accese o non averle).
      const dayStart = today - day * DAY_MS;
      samples.push(...parseStressHistory(await this.optional(() => this.indexedHistory(stressHistoryFrame(day), OP.stressHistory), []), dayStart));
      samples.push(...parseHrvHistory(await this.optional(() => this.indexedHistory(hrvHistoryFrame(day), OP.hrvHistory), []), dayStart));
    }
    const sessions = parseSleep(await this.twice(() => this.sleep()), now, this.tzOffsetMin);
    samples.push(...parseSpo2(await this.optional(() => this.bigQuery(spo2Request(), BIG_SPO2), new Uint8Array(0)), now, this.tzOffsetMin));
    samples.push(...parseTemperature(await this.optional(() => this.bigQuery(temperatureRequest(), BIG_TEMPERATURE), new Uint8Array(0)), now, this.tzOffsetMin));

    // L'ora in corso non è finita: i suoi passi cresceranno, quindi si rileggono al prossimo sync.
    const fresh = (s: SamplePayload) => s.ts <= now && (sinceMs === null || s.ts > sinceMs);
    // Le notti tornano tutte: una letta a metà (prima del risveglio) ha la fine prima di `sinceMs` anche quando poi
    // cresce. Le sceglie la coda, che sa quali ha già e fin dove (docs/adr/0034).
    return { samples: samples.filter(fresh), sessions };
  }

  override async startLiveHeartRate(listener: (bpm: number | null) => void): Promise<LiveSession> {
    await this.connect();
    this.live = listener;
    this.liveLastPacket = Date.now();
    try {
      // Come l'app del produttore: avvio e subito la ripresa.
      await this.link.send('command', workoutFrame(WORKOUT_START));
      await this.link.send('command', workoutFrame(WORKOUT_RESUME));
    } catch (error) {
      this.live = null;
      await this.disconnect();
      throw error;
    }
    // In pausa l'anello può tacere: la ripresa automatica dopo il silenzio aspetta «Riprendi» (docs/adr/0042).
    let paused = false;
    const timer = setInterval(() => {
      if (!paused && Date.now() - this.liveLastPacket > LIVE_SILENCE_MS) {
        this.liveLastPacket = Date.now();
        void this.link.send('command', workoutFrame(WORKOUT_RESUME)).catch(() => undefined);
      }
    }, LIVE_CHECK_MS);
    let stopped = false;
    return {
      pause: async () => {
        if (stopped || paused) {
          return;
        }
        paused = true;
        await this.link.send('command', workoutFrame(WORKOUT_PAUSE));
      },
      resume: async () => {
        if (stopped || !paused) {
          return;
        }
        paused = false;
        this.liveLastPacket = Date.now();
        await this.link.send('command', workoutFrame(WORKOUT_RESUME));
      },
      stop: async () => {
        if (stopped) {
          return;
        }
        stopped = true;
        clearInterval(timer);
        this.live = null;
        try {
          // Come l'app del produttore: pausa, poi fine.
          await this.link.send('command', workoutFrame(WORKOUT_PAUSE));
          await this.link.send('command', workoutFrame(WORKOUT_END));
        } catch {
          // Già scollegato: si scollega comunque qui sotto.
        } finally {
          await this.disconnect();
        }
      },
    };
  }

  /**
   * Misura a comando (docs/adr/0039, docs/protocol.md): `69 <tipo> 25`, poi l'anello manda circa due pacchetti al
   * secondo con il valore a `00` finché non ha finito. Si raccolgono i valori (`MEASURE_VALUES`, o tre uguali di fila),
   * poi si ferma la misura con `6a <tipo>`, sempre, anche dopo un errore. Il risultato è il valore di mezzo di quelli
   * raccolti: ossigeno e stress cambiano a ogni pacchetto. I pacchetti tengono vivo il tempo d'attesa; se l'anello smette
   * di mandarli senza un valore, o non ne dà uno entro `MEASURE_MAX_MS`, la misura è fallita.
   */
  override async measure(kind: MeasureKind): Promise<number> {
    const started = this.now().getTime();
    const values: number[] = [];
    let lastRaw = 0;
    let answered = false;
    let errorByte = 0;
    try {
      await this.collect('command', measureStartFrame(kind), (data) => {
        const reading = parseMeasure(data, kind);
        if (!reading) {
          return false;
        }
        answered = true;
        if (reading.error !== 0) {
          errorByte = reading.error;
          return true;
        }
        if (reading.value !== null) {
          values.push(reading.value);
          lastRaw = reading.raw;
        }
        const last = values.slice(-MEASURE_STABLE);
        const stable = last.length === MEASURE_STABLE && last.every((v) => v === last[0]);
        return stable || values.length >= MEASURE_VALUES[kind] || this.now().getTime() - started > MEASURE_MAX_MS[kind];
      });
    } catch (error) {
      // Un anello che ha cominciato a misurare e poi tace si è fermato da solo: è una misura fallita, non un comando perso.
      if (!(answered && error instanceof RingError && error.code === 'connection_timeout')) {
        throw error;
      }
    } finally {
      await this.commandIfAnswered(measureStopFrame(kind, lastRaw), OP.realTimeStop).catch(() => undefined);
    }
    if (errorByte !== 0) {
      throw new RingError('measure_failed', `errore ${errorByte.toString(16).padStart(2, '0')} dalla misura`);
    }
    if (values.length === 0) {
      throw new RingError('measure_failed');
    }
    // Il valore di mezzo (il più basso dei due, se sono pari): sempre un valore che l'anello ha dato davvero.
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor((sorted.length - 1) / 2)];
  }

  async disconnect(): Promise<void> {
    this.live = null;
    // Una risposta attesa non arriverà più: chi aspetta lo sa subito, non dopo il silenzio (docs/adr/0043).
    const waiter = this.waiter;
    this.waiter = null;
    waiter?.lost();
    await this.link.disconnect();
  }

  // ---- Scambi ---------------------------------------------------------------------------------------------------

  private onNotify(channel: RingChannel, data: Uint8Array): void {
    if (channel === 'command' && this.live) {
      const bpm = parseWorkoutHeartRate(data);
      if (bpm !== undefined) {
        this.liveLastPacket = Date.now();
        this.live(bpm);
        return;
      }
    }
    if (channel === 'big') {
      this.waiter?.touch('big');
      const message = this.big.push(data);
      if (message) {
        this.waiter?.accept('big', Uint8Array.from([OP.big, message.command, ...message.data]));
      }
      return;
    }
    this.waiter?.accept('command', data);
  }

  /**
   * Aspetta pacchetti finché `accept` dice basta (`true`). Finisce con un errore dopo `REPLY_TIMEOUT_MS` di silenzio
   * sul canale, o subito se l'anello si scollega.
   */
  private collect(channel: RingChannel, request: Uint8Array, accept: (data: Uint8Array) => boolean): Promise<void> {
    const name = `${request[0] === 0xbc ? 'bc ' : ''}${(request[0] === 0xbc ? request[1] : request[0]).toString(16).padStart(2, '0')}`;
    return new Promise<void>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const finish = (error?: Error) => {
        clearTimeout(timer);
        if (this.waiter === waiter) {
          this.waiter = null;
        }
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      };
      const arm = () => {
        clearTimeout(timer);
        timer = setTimeout(() => finish(new RingError('connection_timeout', `nessuna risposta al comando ${name}`)), REPLY_TIMEOUT_MS);
      };
      const waiter: Waiter = {
        accept: (ch, data) => {
          if (ch !== channel) {
            return false;
          }
          if (accept(data)) {
            finish();
          } else {
            arm();
          }
          return true;
        },
        touch: (ch) => {
          if (ch === channel) {
            arm();
          }
        },
        lost: () => finish(new RingError('disconnected', `scollegato durante il comando ${name}`)),
      };
      this.waiter = waiter;
      arm();
      this.link.send(channel, request).catch((error) => finish(error));
    });
  }

  /**
   * Una richiesta necessaria: se l'anello non risponde la si manda una seconda volta (un pacchetto perso, un
   * collegamento lento). Le facoltative no: un anello che non le conosce costerebbe il doppio dell'attesa.
   */
  private async twice<T>(read: () => Promise<T>): Promise<T> {
    try {
      return await read();
    } catch (error) {
      if (error instanceof RingError && error.code === 'connection_timeout') {
        return read();
      }
      throw error;
    }
  }

  /** Un comando con una sola risposta con lo stesso primo byte. */
  private async command(request: Uint8Array, opcode: number): Promise<Uint8Array> {
    let reply: Uint8Array | null = null;
    await this.collect('command', request, (data) => {
      if (data[0] !== opcode) {
        return false;
      }
      reply = data;
      return true;
    });
    return reply!;
  }

  /** Come `command`, ma una risposta che non arriva non fa fallire la lettura (comandi dalla risposta ancora ignota). */
  private async commandIfAnswered(request: Uint8Array, opcode: number): Promise<void> {
    try {
      await this.command(request, opcode);
    } catch (error) {
      if (!(error instanceof RingError) || error.code !== 'connection_timeout') {
        throw error;
      }
    }
  }

  /** Passi di un giorno: o `43 ff` (vuoto), o l'intestazione `43 f0 <n>` e `n` righe. */
  private async steps(dayOffset: number): Promise<Uint8Array[]> {
    const frames: Uint8Array[] = [];
    let expected: number | null = null;
    await this.collect('command', stepsFrame(dayOffset), (data) => {
      if (data[0] !== OP.steps) {
        return false;
      }
      frames.push(data);
      if (data[1] === 0xff) {
        return true;
      }
      if (data[1] === 0xf0) {
        expected = data[2];
        return expected === 0;
      }
      return expected !== null && frames.length - 1 >= expected;
    });
    return frames;
  }

  /** Battito di un giorno: o `15 ff`, o `15 00 <n> <intervallo>` seguito dai pacchetti fino all'indice `n − 1`. */
  private heartRate(dayMidnightUtcMs: number): Promise<Uint8Array[]> {
    return this.indexedHistory(hrHistoryFrame(dayMidnightUtcMs, this.tzOffsetMin), OP.hrHistory);
  }

  /** Storico a pacchetti numerati (battito, stress, HRV): lo stesso schema, cambia solo il comando. */
  private async indexedHistory(request: Uint8Array, opcode: number): Promise<Uint8Array[]> {
    const frames: Uint8Array[] = [];
    let total: number | null = null;
    await this.collect('command', request, (data) => {
      if (data[0] !== opcode) {
        return false;
      }
      frames.push(data);
      if (data[1] === 0xff) {
        return true;
      }
      if (data[1] === 0x00) {
        total = data[2];
      }
      return total !== null && data[1] >= total - 1;
    });
    return frames;
  }

  /** Una risposta del canale lungo a una richiesta: i dati del messaggio `bc <comando> ...`, senza i 6 byte di testa. */
  private async bigQuery(request: Uint8Array, command: number): Promise<Uint8Array> {
    // Un messaggio rimasto a metà (richiesta scaduta) non deve mescolarsi con la risposta a questa.
    this.big.reset();
    let data = new Uint8Array(0);
    await this.collect('big', request, (message) => {
      if (message[1] !== command) {
        return false;
      }
      data = message.slice(2);
      return true;
    });
    return data;
  }

  /** Una lettura facoltativa: se l'anello non risponde in tempo si prosegue senza. Ogni altro errore resta. */
  private async optional<T>(read: () => Promise<T>, fallback: T): Promise<T> {
    try {
      return await read();
    } catch (error) {
      if (error instanceof RingError && error.code === 'connection_timeout') {
        return fallback;
      }
      throw error;
    }
  }

  /** Sonno: il canale lungo risponde con un messaggio `bc 27 ...`; prima arriva una conferma `bc 3e` da ignorare. */
  private sleep(): Promise<Uint8Array> {
    return this.bigQuery(sleepRequest(), BIG_SLEEP);
  }
}
