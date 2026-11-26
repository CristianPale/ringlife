/**
 * Pacchetti dell'anello: 16 byte, il primo è il comando, poi 14 di dati, l'ultimo è il checksum dei 15 precedenti
 * (docs/protocol.md). Quale formula di checksum usi l'R09 NON è deciso: il README di un progetto dice «modulo 255»,
 * l'esempio dello stesso autore fa `sum & 255`. Per questo `ChecksumKind` si passa sempre: il giorno dell'anello
 * si sceglie con un test su pacchetti veri (`tools/checksum_check.py`) e si registra in `docs/protocol.md`.
 */
export const FRAME_LENGTH = 16;
export const PAYLOAD_LENGTH = 14;

export type ChecksumKind = 'mod255' | 'mod256';

/** Checksum dei primi 15 byte (tutto tranne l'ultimo). */
export function checksum(body: Uint8Array, kind: ChecksumKind): number {
  let sum = 0;
  for (const byte of body) {
    sum += byte;
  }
  return kind === 'mod255' ? sum % 255 : sum & 255;
}

/** Costruisce un pacchetto: comando, dati (al massimo 14, il resto a zero) e checksum. */
export function buildFrame(opcode: number, payload: ArrayLike<number>, kind: ChecksumKind): Uint8Array {
  if (!Number.isInteger(opcode) || opcode < 0 || opcode > 255) {
    throw new RangeError('Il comando è un byte');
  }
  if (payload.length > PAYLOAD_LENGTH) {
    throw new RangeError(`Al massimo ${PAYLOAD_LENGTH} byte di dati`);
  }
  const frame = new Uint8Array(FRAME_LENGTH);
  frame[0] = opcode;
  for (let i = 0; i < payload.length; i++) {
    const byte = payload[i];
    if (!Number.isInteger(byte) || byte < 0 || byte > 255) {
      throw new RangeError('Ogni dato è un byte');
    }
    frame[1 + i] = byte;
  }
  frame[FRAME_LENGTH - 1] = checksum(frame.subarray(0, FRAME_LENGTH - 1), kind);
  return frame;
}

export interface ParsedFrame {
  opcode: number;
  payload: Uint8Array;
}

/** Il pacchetto, o `null` se non ha 16 byte o il checksum non torna. */
export function parseFrame(frame: Uint8Array, kind: ChecksumKind): ParsedFrame | null {
  if (frame.length !== FRAME_LENGTH || frame[FRAME_LENGTH - 1] !== checksum(frame.subarray(0, FRAME_LENGTH - 1), kind)) {
    return null;
  }
  return { opcode: frame[0], payload: frame.slice(1, FRAME_LENGTH - 1) };
}

/** Quanti pacchetti tornano con ciascuna formula: serve a sceglierla su pacchetti catturati. */
export function checksumFit(frames: readonly Uint8Array[]): Record<ChecksumKind, number> {
  const fit: Record<ChecksumKind, number> = { mod255: 0, mod256: 0 };
  for (const frame of frames) {
    for (const kind of ['mod255', 'mod256'] as const) {
      if (parseFrame(frame, kind)) {
        fit[kind]++;
      }
    }
  }
  return fit;
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/[\s:-]/g, '');
  if (clean.length % 2 !== 0 || /[^0-9a-fA-F]/.test(clean)) {
    throw new RangeError('Esadecimale non valido');
  }
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}
