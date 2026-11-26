import { SamplePayload } from '../../api/api.model';
import { RingReading } from '../ring-source';
import { hexToBytes } from '../ble/frame';
import {
  BigAccumulator,
  localMidnight,
  parseHrHistory,
  parseHrvHistory,
  parseSleep,
  parseSpo2,
  parseSteps,
  parseStressHistory,
  parseTemperature,
} from '../ble/ring-protocol';

const DAY_MS = 86_400_000;

/** Una lettura fatta in background dal raccoglitore nativo, già decodificata (docs/adr/0026). */
export interface BackgroundReading {
  at: number;
  tzOffsetMin: number;
  battery: number | null;
  reading: RingReading;
}

interface RawRequest {
  tag: string;
  frames: { ch: string; hex: string }[];
}

interface RawRun {
  at: number;
  tzOffsetMin: number;
  battery: number | null;
  requests: RawRequest[];
}

function isRun(value: unknown): value is RawRun {
  const v = value as Record<string, unknown>;
  return typeof v === 'object' && v !== null && typeof v['at'] === 'number' && typeof v['tzOffsetMin'] === 'number' && Array.isArray(v['requests']);
}

/** I pacchetti di un canale come byte. Un pacchetto illeggibile si scarta. */
function frames(request: RawRequest, channel: 'command' | 'big'): Uint8Array[] {
  const out: Uint8Array[] = [];
  for (const frame of request.frames ?? []) {
    if (frame.ch === channel) {
      try {
        out.push(hexToBytes(frame.hex));
      } catch {
        // Un pacchetto rovinato non ferma gli altri.
      }
    }
  }
  return out;
}

/** I dati di un messaggio del canale lungo con quel comando, rimessi insieme dai pezzi. */
function bigData(request: RawRequest, command: number): Uint8Array {
  const acc = new BigAccumulator();
  for (const chunk of frames(request, 'big')) {
    const message = acc.push(chunk);
    if (message && message.command === command) {
      return message.data;
    }
  }
  return new Uint8Array(0);
}

/**
 * Le letture salvate in background (JSON del nativo) passate ai parser verificati, una richiesta per volta: lo stesso
 * risultato di una lettura in primo piano. Una lettura illeggibile si scarta; i valori «dopo» la lettura si tolgono.
 */
export function parseBackgroundRuns(json: string): BackgroundReading[] {
  let list: unknown;
  try {
    list = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(list)) {
    return [];
  }
  return list.filter(isRun).map((run) => {
    const offset = run.tzOffsetMin;
    const today = localMidnight(run.at, offset);
    const samples: SamplePayload[] = [];
    let sessions: RingReading['sessions'] = [];
    for (const request of run.requests) {
      const [kind, arg] = request.tag.split(':');
      const day = Number(arg ?? 0);
      const dayStart = today - day * DAY_MS;
      switch (kind) {
        case 'steps':
          samples.push(...parseSteps(frames(request, 'command'), offset));
          break;
        case 'hr':
          samples.push(...parseHrHistory(frames(request, 'command'), offset));
          break;
        case 'stress':
          samples.push(...parseStressHistory(frames(request, 'command'), dayStart));
          break;
        case 'hrv':
          samples.push(...parseHrvHistory(frames(request, 'command'), dayStart));
          break;
        case 'sleep':
          sessions = parseSleep(bigData(request, 0x27), run.at, offset);
          break;
        case 'spo2':
          samples.push(...parseSpo2(bigData(request, 0x2a), run.at, offset));
          break;
        case 'temp':
          samples.push(...parseTemperature(bigData(request, 0x25), run.at, offset));
          break;
        default:
          break;
      }
    }
    return {
      at: run.at,
      tzOffsetMin: offset,
      battery: typeof run.battery === 'number' ? run.battery : null,
      reading: { samples: samples.filter((s) => s.ts <= run.at), sessions },
    };
  });
}
